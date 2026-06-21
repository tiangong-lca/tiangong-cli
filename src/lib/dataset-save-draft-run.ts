import path from 'node:path';
import * as tidasSdk from '@tiangong-lca/tidas-sdk';
import { writeJsonArtifact, writeJsonLinesArtifact } from './artifacts.js';
import { collectImportContentIssues } from './dataset-validate.js';
import {
  createDatasetRecord,
  saveDraftDatasetRecord,
  type DatasetCommandTable,
} from './dataset-command.js';
import { readDatasetRowsInput } from './dataset-local.js';
import { CliError } from './errors.js';
import type { FetchLike } from './http.js';
import {
  normalizeIssuePath,
  type SafeParseSchema,
  type SdkValidationFactory,
  validateSchemaWithDeepFallback,
} from './tidas-sdk-validation.js';
import {
  collectProcessPlaceholderIssues,
  collectProcessRequiredFieldIssues,
} from './process-required-fields.js';
import { buildDatasetCommandTransport } from './dataset-command.js';
import {
  createSupabaseDataClient,
  requireSupabaseRestRuntime,
  runSupabaseArrayQuery,
  type SupabaseDataRuntime,
} from './supabase-client.js';
import { createSupabaseDataRuntime } from './supabase-session.js';
import {
  collectRemoteReferences,
  lookupRemoteDataset,
  type RemoteDatasetLookup,
  type RemoteDatasetReference,
  type RemoteDatasetTable,
} from './dataset-remote-verify.js';

type JsonObject = Record<string, unknown>;

const DEFAULT_TIMEOUT_MS = 10_000;

export type DatasetSaveDraftType =
  | 'auto'
  | 'contact'
  | 'source'
  | 'unitgroup'
  | 'flowproperty'
  | 'flow'
  | 'process';

type ConcreteDatasetSaveDraftType = Exclude<DatasetSaveDraftType, 'auto'>;

type DatasetTypeConfig = {
  table: DatasetCommandTable;
  rootKey: string;
  informationKey: string;
  schemaName: keyof typeof tidasSdk;
  factoryName: keyof typeof tidasSdk;
};

type DatasetSaveDraftValidationIssue = {
  path: string;
  message: string;
  code: string;
};

type DatasetSaveDraftValidationResult =
  | {
      ok: true;
      validator: string;
      issue_count: 0;
      issues: [];
    }
  | {
      ok: false;
      validator: string;
      issue_count: number;
      issues: DatasetSaveDraftValidationIssue[];
    };

function normalizeValidationIssue(issue: {
  path?: Array<string | number>;
  message?: string;
  code?: string;
}): DatasetSaveDraftValidationIssue {
  return {
    path: normalizeIssuePath(issue.path ?? []),
    message: issue.message ?? 'Validation failed',
    code: issue.code ?? 'custom',
  };
}

export type DatasetSaveDraftRowReport = {
  index: number;
  id: string | null;
  version: string | null;
  type: ConcreteDatasetSaveDraftType | null;
  table: DatasetCommandTable | null;
  status: 'prepared' | 'executed' | 'failed';
  operation:
    | 'would_sync'
    | 'insert'
    | 'save_draft'
    | 'skipped_invalid'
    | 'reference_only_type'
    | 'type_unknown'
    | 'identity_missing'
    | 'elementary_flow_insert_blocked'
    | 'remote_reference_unresolved'
    | null;
  validation: DatasetSaveDraftValidationResult | null;
  visible_row?: VisibleDatasetRow | null;
  error?: { message: string; details?: unknown };
};

export type DatasetSaveDraftReport = {
  schema_version: 1;
  generated_at_utc: string;
  input_path: string;
  requested_type: DatasetSaveDraftType;
  out_dir: string;
  commit: boolean;
  mode: 'dry_run' | 'commit';
  status: 'completed' | 'completed_with_failures';
  counts: {
    selected: number;
    prepared: number;
    executed: number;
    failed: number;
    by_table: Partial<Record<DatasetCommandTable, number>>;
    operations: Record<string, number>;
  };
  files: {
    selected_rows: string;
    progress_jsonl: string;
    failures_jsonl: string;
    summary_json: string;
  };
  rows: DatasetSaveDraftRowReport[];
};

export type RunDatasetSaveDraftOptions = {
  inputPath: string;
  type?: string | null;
  outDir?: string | null;
  commit?: boolean | null;
  rawInput?: unknown;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: Date;
  /**
   * Explicit opt-in to write account-local (My Data, state_code=0) Unit Group and
   * Flow Property support rows that are otherwise reference-only. Default false keeps
   * the CLI safe-by-default for interactive operators.
   */
  allowReferenceOnlySupport?: boolean | null;
};

type PreparedDatasetRow = {
  index: number;
  row: JsonObject;
  payload: JsonObject;
  type: ConcreteDatasetSaveDraftType | null;
  config: DatasetTypeConfig | null;
  id: string | null;
  version: string | null;
  validation: DatasetSaveDraftValidationResult | null;
};

type VisibleDatasetRow = {
  id: string;
  version: string;
  user_id: string | null;
  state_code: number | null;
};

type SupabaseDataClient = ReturnType<typeof createSupabaseDataClient>['client'];

type MissingFlowRemoteReference = {
  table: RemoteDatasetTable | null;
  id: string | null;
  version: string | null;
  path: string;
  short_description: string | null;
  status:
    | 'missing_dataset'
    | 'missing_version'
    | 'unsupported_type'
    | 'version_missing'
    | 'version_outdated';
  latest_version: string | null;
};

const DATASET_CONFIGS: Record<ConcreteDatasetSaveDraftType, DatasetTypeConfig> = {
  contact: {
    table: 'contacts',
    rootKey: 'contactDataSet',
    informationKey: 'contactInformation',
    schemaName: 'ContactSchema',
    factoryName: 'createContact',
  },
  source: {
    table: 'sources',
    rootKey: 'sourceDataSet',
    informationKey: 'sourceInformation',
    schemaName: 'SourceSchema',
    factoryName: 'createSource',
  },
  unitgroup: {
    table: 'unitgroups',
    rootKey: 'unitGroupDataSet',
    informationKey: 'unitGroupInformation',
    schemaName: 'UnitGroupSchema',
    factoryName: 'createUnitGroup',
  },
  flowproperty: {
    table: 'flowproperties',
    rootKey: 'flowPropertyDataSet',
    informationKey: 'flowPropertiesInformation',
    schemaName: 'FlowPropertySchema',
    factoryName: 'createFlowProperty',
  },
  flow: {
    table: 'flows',
    rootKey: 'flowDataSet',
    informationKey: 'flowInformation',
    schemaName: 'FlowSchema',
    factoryName: 'createFlow',
  },
  process: {
    table: 'processes',
    rootKey: 'processDataSet',
    informationKey: 'processInformation',
    schemaName: 'ProcessSchema',
    factoryName: 'createProcess',
  },
};

const REFERENCE_ONLY_SAVE_DRAFT_TYPES = new Set<ConcreteDatasetSaveDraftType>([
  'unitgroup',
  'flowproperty',
]);

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimToken(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function serializeError(error: unknown): { message: string; details?: unknown } {
  if (error instanceof CliError) {
    return { message: error.message, details: error.details };
  }
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: String(error) };
}

function normalizeType(
  value: string | null | undefined,
  allowReferenceOnlySupport = false,
): DatasetSaveDraftType {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'auto') {
    return 'auto';
  }
  if (normalized === 'contact' || normalized === 'contacts') {
    return 'contact';
  }
  if (normalized === 'source' || normalized === 'sources') {
    return 'source';
  }
  if (
    normalized === 'unitgroup' ||
    normalized === 'unitgroups' ||
    normalized === 'unit-group' ||
    normalized === 'unit-groups'
  ) {
    if (allowReferenceOnlySupport) {
      return 'unitgroup';
    }
    throw new CliError(
      'Unit groups are reference-only support data for dataset save-draft. Select an existing database row instead of creating a custom My Data unit group.',
      {
        code: 'DATASET_SAVE_DRAFT_REFERENCE_ONLY_TYPE',
        exitCode: 2,
        details: { type: normalized },
      },
    );
  }
  if (
    normalized === 'flowproperty' ||
    normalized === 'flowproperties' ||
    normalized === 'flow-property' ||
    normalized === 'flow-properties'
  ) {
    if (allowReferenceOnlySupport) {
      return 'flowproperty';
    }
    throw new CliError(
      'Flow properties are reference-only support data for dataset save-draft. Select an existing database row instead of creating a custom My Data flow property.',
      {
        code: 'DATASET_SAVE_DRAFT_REFERENCE_ONLY_TYPE',
        exitCode: 2,
        details: { type: normalized },
      },
    );
  }
  if (normalized === 'flow' || normalized === 'flows') {
    return 'flow';
  }
  if (normalized === 'process' || normalized === 'processes') {
    return 'process';
  }

  throw new CliError('Expected --type to be auto, contact, source, flow, or process.', {
    code: 'DATASET_SAVE_DRAFT_TYPE_INVALID',
    exitCode: 2,
    details: value,
  });
}

function unwrapPayload(row: JsonObject): JsonObject {
  for (const key of ['json_ordered', 'jsonOrdered', 'payload', 'json'] as const) {
    if (isRecord(row[key])) {
      return row[key];
    }
  }
  return row;
}

function detectType(payload: JsonObject): ConcreteDatasetSaveDraftType | null {
  for (const [type, config] of Object.entries(DATASET_CONFIGS)) {
    if (isRecord(payload[config.rootKey])) {
      return type as ConcreteDatasetSaveDraftType;
    }
  }
  return null;
}

function schemaForConfig(config: DatasetTypeConfig): {
  schema: SafeParseSchema;
  createEntity: SdkValidationFactory | null;
} {
  const schema = (tidasSdk as Record<string, unknown>)[config.schemaName];
  if (
    !schema ||
    typeof schema !== 'object' ||
    typeof (schema as SafeParseSchema).safeParse !== 'function'
  ) {
    throw new CliError(`${String(config.schemaName)} is unavailable in @tiangong-lca/tidas-sdk.`, {
      code: 'DATASET_SAVE_DRAFT_SCHEMA_UNAVAILABLE',
      exitCode: 2,
      details: { table: config.table },
    });
  }
  const createEntity = (tidasSdk as Record<string, unknown>)[config.factoryName];
  return {
    schema: schema as SafeParseSchema,
    createEntity:
      typeof createEntity === 'function' ? (createEntity as SdkValidationFactory) : null,
  };
}

function validatePayload(
  payload: JsonObject,
  type: ConcreteDatasetSaveDraftType,
  config: DatasetTypeConfig,
): DatasetSaveDraftValidationResult {
  const { schema, createEntity } = schemaForConfig(config);
  const outcome = validateSchemaWithDeepFallback(schema, payload, createEntity);
  const processIssues =
    type === 'process'
      ? [...collectProcessRequiredFieldIssues(payload), ...collectProcessPlaceholderIssues(payload)]
      : [];
  const importIssues = type === 'process' ? [] : collectImportContentIssues(payload);
  const issues: DatasetSaveDraftValidationIssue[] = [
    ...outcome.issues.map(normalizeValidationIssue),
    ...processIssues,
    ...importIssues,
  ];

  if (outcome.success && issues.length === 0) {
    return {
      ok: true,
      validator: `@tiangong-lca/tidas-sdk/${String(config.schemaName)}+tiangong/import-content`,
      issue_count: 0,
      issues: [],
    };
  }

  return {
    ok: false,
    validator: `@tiangong-lca/tidas-sdk/${String(config.schemaName)}+tiangong/import-content`,
    issue_count: issues.length,
    issues,
  };
}

function extractIdentity(
  payload: JsonObject,
  row: JsonObject,
  config: DatasetTypeConfig,
): {
  id: string | null;
  version: string | null;
} {
  const rootCandidate = payload[config.rootKey];
  const root: JsonObject = isRecord(rootCandidate) ? rootCandidate : payload;
  const informationCandidate = root[config.informationKey];
  const information: JsonObject = isRecord(informationCandidate) ? informationCandidate : {};
  const dataSetInformationCandidate = information.dataSetInformation;
  const dataSetInformation = isRecord(dataSetInformationCandidate)
    ? dataSetInformationCandidate
    : {};
  const administrativeInformation = isRecord(root.administrativeInformation)
    ? root.administrativeInformation
    : {};
  const publicationAndOwnership = isRecord(administrativeInformation.publicationAndOwnership)
    ? administrativeInformation.publicationAndOwnership
    : {};

  return {
    id: trimToken(row.id) ?? trimToken(dataSetInformation['common:UUID']),
    version:
      trimToken(row.version) ?? trimToken(publicationAndOwnership['common:dataSetVersion']) ?? null,
  };
}

function flowType(payload: JsonObject): string | null {
  const rootCandidate = payload.flowDataSet;
  const root = isRecord(rootCandidate) ? rootCandidate : payload;
  const modellingCandidate = root.modellingAndValidation;
  const modelling = isRecord(modellingCandidate) ? modellingCandidate : {};
  const lciMethodCandidate = modelling.LCIMethod;
  const lciMethod = isRecord(lciMethodCandidate) ? lciMethodCandidate : {};
  return trimToken(lciMethod.typeOfDataSet);
}

function isElementaryFlowPayload(payload: JsonObject): boolean {
  return flowType(payload)?.trim().toLowerCase() === 'elementary flow';
}

function compareVersions(left: string | null, right: string | null): number {
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return -1;
  }
  if (!right) {
    return 1;
  }
  const leftParts = left.split(/[._-]/u);
  const rightParts = right.split(/[._-]/u);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? '0';
    const rightPart = rightParts[index] ?? '0';
    const leftNumber = Number(leftPart);
    const rightNumber = Number(rightPart);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      if (leftNumber !== rightNumber) {
        return leftNumber > rightNumber ? 1 : -1;
      }
    } else {
      const compared = leftPart.localeCompare(rightPart);
      if (compared !== 0) {
        return compared > 0 ? 1 : -1;
      }
    }
  }
  return 0;
}

function supportLookupKey(reference: {
  table: RemoteDatasetTable;
  id: string;
  version: string | null;
}): string {
  return `${reference.table}:${reference.id}:${reference.version ?? ''}`;
}

function isLookupableRemoteReference(
  reference: RemoteDatasetReference,
): reference is RemoteDatasetReference & { table: RemoteDatasetTable; id: string } {
  return Boolean(reference.table && reference.id);
}

function uniqueFlowRemoteReferences(payload: JsonObject): RemoteDatasetReference[] {
  const references = new Map<string, RemoteDatasetReference>();
  for (const reference of collectRemoteReferences([payload])) {
    if (reference.role !== 'reference') {
      continue;
    }
    if (reference.table && reference.id) {
      references.set(
        supportLookupKey({
          table: reference.table,
          id: reference.id,
          version: reference.version,
        }),
        reference,
      );
    } else {
      references.set(remoteReferenceFallbackKey(reference), reference);
    }
  }
  return [...references.values()];
}

function remoteReferenceFallbackKey(
  reference: Pick<RemoteDatasetReference, 'path' | 'type'>,
): string {
  return `${reference.path}:${reference.type ?? 'unknown'}`;
}

async function lookupCachedReferenceOnlySupport(options: {
  runtime: SupabaseDataRuntime;
  fetchImpl: FetchLike;
  timeoutMs: number;
  cache: Map<string, Promise<RemoteDatasetLookup>>;
  reference: RemoteDatasetReference & { table: RemoteDatasetTable; id: string };
}): Promise<RemoteDatasetLookup> {
  const key = supportLookupKey(options.reference);
  if (!options.cache.has(key)) {
    options.cache.set(
      key,
      lookupRemoteDataset({
        runtime: options.runtime,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
        request: {
          table: options.reference.table,
          id: options.reference.id,
          version: options.reference.version,
        },
      }),
    );
  }
  return options.cache.get(key) as Promise<RemoteDatasetLookup>;
}

async function missingFlowRemoteReferences(options: {
  runtime: SupabaseDataRuntime;
  fetchImpl: FetchLike;
  timeoutMs: number;
  cache: Map<string, Promise<RemoteDatasetLookup>>;
  payload: JsonObject;
}): Promise<MissingFlowRemoteReference[]> {
  const missing: MissingFlowRemoteReference[] = [];
  for (const reference of uniqueFlowRemoteReferences(options.payload)) {
    if (!isLookupableRemoteReference(reference)) {
      missing.push({
        table: reference.table,
        id: reference.id,
        version: reference.version,
        path: reference.path,
        short_description: reference.short_description,
        status: 'unsupported_type',
        latest_version: null,
      });
      continue;
    }
    if (!reference.version) {
      missing.push({
        table: reference.table,
        id: reference.id,
        version: null,
        path: reference.path,
        short_description: reference.short_description,
        status: 'version_missing',
        latest_version: null,
      });
      continue;
    }
    const lookup = await lookupCachedReferenceOnlySupport({ ...options, reference });
    if (!lookup.latest) {
      missing.push({
        table: reference.table,
        id: reference.id,
        version: reference.version,
        path: reference.path,
        short_description: reference.short_description,
        status: 'missing_dataset',
        latest_version: null,
      });
    } else if (!lookup.exact) {
      missing.push({
        table: reference.table,
        id: reference.id,
        version: reference.version,
        path: reference.path,
        short_description: reference.short_description,
        status: 'missing_version',
        latest_version: lookup.latest.version,
      });
    } else if (compareVersions(lookup.latest.version, reference.version) > 0) {
      missing.push({
        table: reference.table,
        id: reference.id,
        version: reference.version,
        path: reference.path,
        short_description: reference.short_description,
        status: 'version_outdated',
        latest_version: lookup.latest.version,
      });
    }
  }
  return missing;
}

function prepareRows(
  inputPath: string,
  rawInput: unknown | undefined,
  requestedType: DatasetSaveDraftType,
): PreparedDatasetRow[] {
  const rows = readDatasetRowsInput(inputPath, rawInput);
  return rows.map((row, index) => {
    const payload = unwrapPayload(row);
    const type = requestedType === 'auto' ? detectType(payload) : requestedType;
    const config = type ? DATASET_CONFIGS[type] : null;
    const identity = config ? extractIdentity(payload, row, config) : { id: null, version: null };
    return {
      index,
      row,
      payload,
      type,
      config,
      id: identity.id,
      version: identity.version,
      validation: config && type ? validatePayload(payload, type, config) : null,
    };
  });
}

function buildFiles(outDir: string): DatasetSaveDraftReport['files'] {
  const outputDir = path.join(outDir, 'outputs', 'dataset-save-draft');
  return {
    selected_rows: path.join(outputDir, 'selected-rows.jsonl'),
    progress_jsonl: path.join(outputDir, 'progress.jsonl'),
    failures_jsonl: path.join(outputDir, 'failures.jsonl'),
    summary_json: path.join(outputDir, 'summary.json'),
  };
}

function defaultOutDir(inputPath: string, commit: boolean, now: Date): string {
  const mode = commit ? 'commit' : 'dry-run';
  const timestamp = now.toISOString().replace(/[:.]/gu, '').replace(/Z$/u, 'Z');
  return path.join(
    path.dirname(inputPath),
    'artifacts',
    'dataset-save-draft',
    `${mode}-${timestamp}`,
  );
}

function operationCount(rows: DatasetSaveDraftRowReport[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = row.operation ?? 'none';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function byTable(rows: PreparedDatasetRow[]): Partial<Record<DatasetCommandTable, number>> {
  const counts: Partial<Record<DatasetCommandTable, number>> = {};
  for (const row of rows) {
    if (row.config) {
      counts[row.config.table] = (counts[row.config.table] ?? 0) + 1;
    }
  }
  return counts;
}

function selectedRow(row: PreparedDatasetRow): JsonObject {
  return {
    index: row.index,
    type: row.type,
    table: row.config?.table ?? null,
    id: row.id,
    version: row.version,
    validation: row.validation,
    payload: row.payload,
  };
}

function buildPreparedFailure(
  row: PreparedDatasetRow,
  allowReferenceOnlySupport = false,
): DatasetSaveDraftRowReport | null {
  if (!row.type || !row.config) {
    return {
      index: row.index,
      id: row.id,
      version: row.version,
      type: row.type,
      table: null,
      status: 'failed',
      operation: 'type_unknown',
      validation: null,
      error: {
        message: 'Could not detect dataset type. Use --type or provide a supported TIDAS wrapper.',
      },
    };
  }

  if (REFERENCE_ONLY_SAVE_DRAFT_TYPES.has(row.type) && !allowReferenceOnlySupport) {
    return {
      index: row.index,
      id: row.id,
      version: row.version,
      type: row.type,
      table: row.config.table,
      status: 'failed',
      operation: 'reference_only_type',
      validation: row.validation,
      error: {
        message:
          'Unit Groups and Flow Properties are reference-only support data. Rewrite references to existing database rows instead of writing these rows through dataset save-draft.',
      },
    };
  }

  if (!row.id || !row.version) {
    return {
      index: row.index,
      id: row.id,
      version: row.version,
      type: row.type,
      table: row.config.table,
      status: 'failed',
      operation: 'identity_missing',
      validation: row.validation,
      error: {
        message:
          'Dataset row is missing common:UUID or common:dataSetVersion required for save-draft.',
      },
    };
  }

  if (!row.validation?.ok) {
    return {
      index: row.index,
      id: row.id,
      version: row.version,
      type: row.type,
      table: row.config.table,
      status: 'failed',
      operation: 'skipped_invalid',
      validation: row.validation,
      error: {
        message: `Local dataset validation failed with ${row.validation?.issue_count ?? 0} issue(s).`,
      },
    };
  }

  return null;
}

function buildVisibleRowsUrl(
  restBaseUrl: string,
  table: DatasetCommandTable,
  id: string,
  version: string,
): string {
  const url = new URL(`${restBaseUrl.replace(/\/+$/u, '')}/${table}`);
  url.searchParams.set('select', 'id,version,user_id,state_code');
  url.searchParams.set('id', `eq.${id}`);
  url.searchParams.set('version', `eq.${version}`);
  return url.toString();
}

function parseVisibleRows(payload: unknown, url: string): VisibleDatasetRow[] {
  if (!Array.isArray(payload)) {
    throw new CliError(`Supabase REST response was not a JSON array for ${url}`, {
      code: 'SUPABASE_REST_RESPONSE_INVALID',
      exitCode: 1,
      details: payload,
    });
  }

  return payload.map((item, index) => {
    if (!isRecord(item)) {
      throw new CliError(`Supabase REST row ${index} was not a JSON object for ${url}`, {
        code: 'SUPABASE_REST_RESPONSE_INVALID',
        exitCode: 1,
        details: item,
      });
    }
    return {
      id: trimToken(item.id) ?? '',
      version: trimToken(item.version) ?? '',
      user_id: trimToken(item.user_id),
      state_code: typeof item.state_code === 'number' ? item.state_code : null,
    };
  });
}

async function exactVisibleRows(options: {
  client: SupabaseDataClient;
  restBaseUrl: string;
  table: DatasetCommandTable;
  id: string;
  version: string;
}): Promise<VisibleDatasetRow[]> {
  const url = buildVisibleRowsUrl(options.restBaseUrl, options.table, options.id, options.version);
  const payload = await runSupabaseArrayQuery(
    options.client
      .from(options.table)
      .select('id,version,user_id,state_code')
      .eq('id', options.id)
      .eq('version', options.version),
    url,
  );
  return parseVisibleRows(payload, url);
}

export async function runDatasetSaveDraft(
  options: RunDatasetSaveDraftOptions,
): Promise<DatasetSaveDraftReport> {
  const now = options.now ?? new Date();
  const inputPath = path.resolve(options.inputPath);
  const commit = options.commit === true;
  const allowReferenceOnlySupport =
    options.allowReferenceOnlySupport === true ||
    (options.env?.TIANGONG_ALLOW_ACCOUNT_LOCAL_SUPPORT ?? '') === '1';
  const requestedType = normalizeType(options.type, allowReferenceOnlySupport);
  const outDir = path.resolve(options.outDir ?? defaultOutDir(inputPath, commit, now));
  const files = buildFiles(outDir);
  const preparedRows = prepareRows(inputPath, options.rawInput, requestedType);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (commit && (!options.env || !options.fetchImpl)) {
    throw new CliError('Dataset save-draft commit requires env and fetch runtime bindings.', {
      code: 'DATASET_SAVE_DRAFT_RUNTIME_REQUIRED',
      exitCode: 2,
    });
  }

  writeJsonLinesArtifact(files.selected_rows, preparedRows.map(selectedRow));

  const runtime =
    commit && options.env && options.fetchImpl
      ? createSupabaseDataRuntime({
          runtime: requireSupabaseRestRuntime(options.env),
          fetchImpl: options.fetchImpl,
          timeoutMs,
        })
      : null;
  const commandTransport =
    runtime && options.fetchImpl
      ? await buildDatasetCommandTransport({
          runtime,
          fetchImpl: options.fetchImpl,
          timeoutMs,
        })
      : null;
  const dataClient =
    runtime && options.fetchImpl
      ? createSupabaseDataClient(runtime, options.fetchImpl, timeoutMs)
      : null;
  const referenceOnlySupportCache = new Map<string, Promise<RemoteDatasetLookup>>();

  const reports: DatasetSaveDraftRowReport[] = [];
  for (const row of preparedRows) {
    const preparedFailure = buildPreparedFailure(row, allowReferenceOnlySupport);
    if (preparedFailure) {
      reports.push(preparedFailure);
      continue;
    }

    const baseReport: DatasetSaveDraftRowReport = {
      index: row.index,
      id: row.id,
      version: row.version,
      type: row.type,
      table: row.config!.table,
      status: 'prepared',
      operation: 'would_sync',
      validation: row.validation,
    };

    if (!commit) {
      reports.push(baseReport);
      continue;
    }

    try {
      const visibleRows = await exactVisibleRows({
        client: dataClient!.client,
        restBaseUrl: dataClient!.restBaseUrl,
        table: row.config!.table,
        id: row.id!,
        version: row.version!,
      });
      const visibleRow = visibleRows[0] ?? null;
      if (row.type === 'flow') {
        if (!visibleRow && isElementaryFlowPayload(row.payload) && !allowReferenceOnlySupport) {
          reports.push({
            ...baseReport,
            status: 'failed',
            operation: 'elementary_flow_insert_blocked',
            visible_row: null,
            error: {
              message:
                'Elementary flows are reference-only for dataset save-draft. Resolve the flow with remote hybrid search and reference the existing database row instead of creating a My Data flow.',
              details: {
                code: 'DATASET_SAVE_DRAFT_ELEMENTARY_FLOW_INSERT_BLOCKED',
              },
            },
          });
          continue;
        }

        const unresolvedReferences = await missingFlowRemoteReferences({
          runtime: runtime!,
          fetchImpl: options.fetchImpl!,
          timeoutMs,
          cache: referenceOnlySupportCache,
          payload: row.payload,
        });
        if (unresolvedReferences.length > 0) {
          reports.push({
            ...baseReport,
            status: 'failed',
            operation: 'remote_reference_unresolved',
            visible_row: visibleRow,
            error: {
              message:
                'Flow save-draft commit requires all referenced datasets to already resolve in the remote database.',
              details: {
                code: 'DATASET_SAVE_DRAFT_REMOTE_REFERENCE_UNRESOLVED',
                references: unresolvedReferences,
              },
            },
          });
          continue;
        }
      }
      if (visibleRow) {
        await saveDraftDatasetRecord({
          transport: commandTransport!,
          table: row.config!.table,
          id: row.id!,
          version: row.version!,
          payload: row.payload,
          extraData: { ruleVerification: true },
        });
        reports.push({
          ...baseReport,
          status: 'executed',
          operation: 'save_draft',
          visible_row: visibleRow,
        });
      } else {
        await createDatasetRecord({
          transport: commandTransport!,
          table: row.config!.table,
          id: row.id!,
          payload: row.payload,
          extraData: { ruleVerification: true },
        });
        reports.push({
          ...baseReport,
          status: 'executed',
          operation: 'insert',
          visible_row: null,
        });
      }
    } catch (error) {
      reports.push({
        ...baseReport,
        status: 'failed',
        error: serializeError(error),
      });
    }
  }

  const failures = reports.filter((row) => row.status === 'failed');
  writeJsonLinesArtifact(files.progress_jsonl, reports);
  writeJsonLinesArtifact(files.failures_jsonl, failures);

  const report: DatasetSaveDraftReport = {
    schema_version: 1,
    generated_at_utc: now.toISOString(),
    input_path: inputPath,
    requested_type: requestedType,
    out_dir: outDir,
    commit,
    mode: commit ? 'commit' : 'dry_run',
    status: failures.length > 0 ? 'completed_with_failures' : 'completed',
    counts: {
      selected: preparedRows.length,
      prepared: reports.filter((row) => row.status === 'prepared').length,
      executed: reports.filter((row) => row.status === 'executed').length,
      failed: failures.length,
      by_table: byTable(preparedRows),
      operations: operationCount(reports),
    },
    files,
    rows: reports,
  };

  writeJsonArtifact(files.summary_json, report);
  return report;
}

export const __testInternals = {
  DATASET_CONFIGS,
  buildFiles,
  buildPreparedFailure,
  buildVisibleRowsUrl,
  byTable,
  compareVersions,
  defaultOutDir,
  detectType,
  extractIdentity,
  flowType,
  isElementaryFlowPayload,
  isLookupableRemoteReference,
  missingFlowRemoteReferences,
  normalizeValidationIssue,
  normalizeType,
  operationCount,
  parseVisibleRows,
  prepareRows,
  remoteReferenceFallbackKey,
  selectedRow,
  serializeError,
  supportLookupKey,
  unwrapPayload,
  uniqueFlowRemoteReferences,
  validatePayload,
};
