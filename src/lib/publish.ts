import path from 'node:path';
import { CliError } from './errors.js';
import { writeJsonArtifact } from './artifacts.js';
import type { FetchLike } from './http.js';
import { readJsonInput } from './io.js';
import {
  syncLifecyclemodelBundleRecord,
  type LifecyclemodelPublishMetadata,
} from './lifecyclemodel-bundle-save.js';
import {
  summarizeProcessPayloadValidation,
  validateProcessPayload,
  type ProcessPayloadValidationResult,
} from './process-payload-validation.js';
import { syncStateAwareProcessRecord } from './process-save-draft.js';
import { buildRunId, resolveRunLayout } from './run.js';
import { getRuntimeRuleset } from './runtime-rulesets.js';
import {
  hasSupabaseRestRuntime,
  syncSupabaseJsonOrderedRecord,
  type SupabaseJsonOrderedTable,
  type SupabaseJsonOrderedWriteMode,
} from './supabase-json-ordered-write.js';

type JsonObject = Record<string, unknown>;

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_RETRY_DELAY_SECONDS = 2.0;
const DEFAULT_DATASET_VERSION = '01.01.000';
const PUBLISH_VERIFICATION_RULESET_ID = 'publish-run/default';
const PUBLISH_VERIFICATION_RULESET_VERSION = '1';

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ensure_list(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function first_non_empty(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function to_positive_integer(value: unknown, defaultValue: number): number {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError('Publish request expected a positive integer value.', {
      code: 'PUBLISH_INVALID_INTEGER',
      exitCode: 2,
      details: value,
    });
  }
  return parsed;
}

function to_non_negative_number(value: unknown, defaultValue: number): number {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new CliError('Publish request expected a non-negative number value.', {
      code: 'PUBLISH_INVALID_NUMBER',
      exitCode: 2,
      details: value,
    });
  }
  return parsed;
}

function to_boolean(value: unknown, defaultValue: boolean): boolean {
  return value === undefined ? defaultValue : Boolean(value);
}

function resolve_path(baseDir: string, value: string): string {
  return path.resolve(baseDir, value);
}

function load_json_object(filePath: string): JsonObject {
  const value = readJsonInput(filePath);
  if (!isRecord(value)) {
    throw new CliError(`Expected JSON object input: ${filePath}`, {
      code: 'PUBLISH_INPUT_NOT_OBJECT',
      exitCode: 2,
    });
  }
  return value;
}

function default_out_dir(baseDir: string, commit: boolean, now: Date = new Date()): string {
  const runId = buildRunId({
    namespace: 'publish',
    operation: commit ? 'commit' : 'dry_run',
    now,
  });
  return resolveRunLayout(path.join(baseDir, 'artifacts'), 'publish', runId).runRoot;
}

function serialize_error(error: unknown): { message: string } {
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: String(error) };
}

export type PublishDatasetEntry =
  | string
  | {
      file?: string;
      path?: string;
      json_ordered?: JsonObject;
      jsonOrdered?: JsonObject;
      payload?: JsonObject;
      [key: string]: unknown;
    };

export type PublishProcessBuildRunEntry =
  | string
  | {
      run_id?: string;
      run_root?: string;
      exports_dir?: string;
      [key: string]: unknown;
    };

export type PublishCollectedOrigin = {
  source: 'bundle' | 'input';
  base_dir: string;
  bundle_path: string | null;
};

export type PublishCollectedDatasetEntry = {
  entry: PublishDatasetEntry;
  origin: PublishCollectedOrigin;
};

export type PublishCollectedProcessBuildRunEntry = {
  entry: PublishProcessBuildRunEntry;
  origin: PublishCollectedOrigin;
};

export type PublishCollectedRelationEntry = {
  entry: unknown;
  origin: PublishCollectedOrigin;
};

export type PublishRequest = {
  inputs: {
    bundle_paths: string[];
    lifecyclemodels: PublishDatasetEntry[];
    processes: PublishDatasetEntry[];
    sources: PublishDatasetEntry[];
    relations: unknown[];
    process_build_runs: PublishProcessBuildRunEntry[];
  };
  publish: {
    commit: boolean;
    publish_lifecyclemodels: boolean;
    publish_processes: boolean;
    publish_sources: boolean;
    publish_relations: boolean;
    publish_process_build_runs: boolean;
    relation_mode: 'local_manifest_only';
    max_attempts: number;
    retry_delay_seconds: number;
    process_build_forward_args: string[];
  };
  out_dir: string;
};

export type PublishCollectedInputs = {
  bundle_paths: string[];
  lifecyclemodels: PublishCollectedDatasetEntry[];
  processes: PublishCollectedDatasetEntry[];
  sources: PublishCollectedDatasetEntry[];
  relations: PublishCollectedRelationEntry[];
  process_build_runs: PublishCollectedProcessBuildRunEntry[];
};

export type DatasetPublishExecutorArgs = {
  table: 'lifecyclemodels' | 'processes' | 'sources';
  id: string;
  version: string;
  payload: JsonObject;
  metadata?: LifecyclemodelPublishMetadata | null;
  source: 'bundle' | 'input';
  bundle_path: string | null;
  publish: PublishRequest['publish'];
};

export type ProcessBuildRunPublishExecutorArgs = {
  run_id: string;
  entry: PublishProcessBuildRunEntry;
  source: 'bundle' | 'input';
  bundle_path: string | null;
  forward_args: string[];
  publish: PublishRequest['publish'];
};

export type PublishExecutors = {
  lifecyclemodels?: (args: DatasetPublishExecutorArgs) => Promise<unknown> | unknown;
  processes?: (args: DatasetPublishExecutorArgs) => Promise<unknown> | unknown;
  sources?: (args: DatasetPublishExecutorArgs) => Promise<unknown> | unknown;
  process_build_runs?: (args: ProcessBuildRunPublishExecutorArgs) => Promise<unknown> | unknown;
};

export type PublishDatasetReport = {
  table: 'lifecyclemodels' | 'processes' | 'sources';
  id: string | null;
  version: string | null;
  status:
    'prepared' | 'executed' | 'deferred_no_executor' | 'deferred_projection_payload' | 'failed';
  source: 'bundle' | 'input';
  bundle_path: string | null;
  reason?: string;
  validation?: ProcessPayloadValidationResult;
  execution?: unknown;
  error?: { message: string };
};

export type PublishProcessBuildRunReport = {
  run_id: string;
  status: 'prepared' | 'executed' | 'deferred_no_executor' | 'failed';
  source: 'bundle' | 'input';
  bundle_path: string | null;
  forward_args: string[];
  execution?: unknown;
  error?: { message: string };
};

export type PublishRelationManifest = {
  generated_at_utc: string;
  relation_mode: 'local_manifest_only';
  status: 'prepared_local_relation_manifest';
  relations: unknown[];
};

export type PublishVerificationFinding = {
  code: string;
  severity: 'warning' | 'blocker';
  message: string;
  table: 'lifecyclemodels' | 'processes' | 'sources' | 'process_build_runs';
  id: string | null;
  version: string | null;
  path?: string;
  bundle_path?: string | null;
};

export type PublishVerificationReport = {
  schema_version: 1;
  generated_at_utc: string;
  command: 'publish run';
  status: 'passed' | 'blocked';
  ruleset_id: string;
  ruleset_version: string;
  ruleset_source_version: string;
  ruleset_rule_ids: string[];
  commit: boolean;
  findings: PublishVerificationFinding[];
  blockers: PublishVerificationFinding[];
  next_action: 'ready_for_commit_or_publish' | 'fix_blockers';
  counts: {
    findings: number;
    blockers: number;
    failed: number;
    deferred: number;
    executed: number;
  };
};

export type PublishReport = {
  generated_at_utc: string;
  request_path: string;
  out_dir: string;
  commit: boolean;
  status: 'completed' | 'completed_with_failures';
  counts: {
    bundle_paths: number;
    lifecyclemodels: number;
    processes: number;
    sources: number;
    relations: number;
    process_build_runs: number;
    executed: number;
    deferred: number;
    failed: number;
  };
  files: {
    normalized_request: string;
    collected_inputs: string;
    relation_manifest: string;
    verification_report: string;
    publish_report: string;
  };
  verification: PublishVerificationReport;
  lifecyclemodels: PublishDatasetReport[];
  processes: PublishDatasetReport[];
  sources: PublishDatasetReport[];
  process_build_runs: PublishProcessBuildRunReport[];
  relations: PublishRelationManifest;
};

export type RunPublishOptions = {
  inputPath: string;
  rawRequest?: unknown;
  outDir?: string | null;
  commit?: boolean | null;
  executors?: PublishExecutors;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: Date;
  validateProcessPayloadImpl?: (payload: JsonObject) => ProcessPayloadValidationResult;
};

type PreparedPublishDatasetReport = PublishDatasetReport & {
  id: string;
  version: string;
};

type NormalizePublishRequestOptions = {
  requestPath: string;
  outDirOverride?: string;
  commitOverride?: boolean;
  now?: Date;
};

type PublishRequestOptions = {
  commit: boolean;
  executor:
    | PublishExecutors['lifecyclemodels']
    | PublishExecutors['processes']
    | PublishExecutors['sources']
    | undefined;
  publish: PublishRequest['publish'];
};

type ProcessPublishRequestOptions = PublishRequestOptions & {
  validateProcessPayloadImpl?: (payload: JsonObject) => ProcessPayloadValidationResult;
};

type LoadedLifecyclemodelPublishEntry = {
  payload: JsonObject;
  metadata: LifecyclemodelPublishMetadata | null;
};

function extract_lifecyclemodel_identity(payload: JsonObject): [string, string] {
  const root = isRecord(payload.lifeCycleModelDataSet) ? payload.lifeCycleModelDataSet : payload;
  const lifeCycleModelInformation = isRecord(root.lifeCycleModelInformation)
    ? root.lifeCycleModelInformation
    : {};
  const dataSetInformation = isRecord(lifeCycleModelInformation.dataSetInformation)
    ? lifeCycleModelInformation.dataSetInformation
    : {};
  const administrativeInformation = isRecord(root.administrativeInformation)
    ? root.administrativeInformation
    : {};
  const publicationAndOwnership = isRecord(administrativeInformation.publicationAndOwnership)
    ? administrativeInformation.publicationAndOwnership
    : {};
  const datasetId = first_non_empty(payload['@id'], payload.id, dataSetInformation['common:UUID']);
  const version = first_non_empty(
    payload['@version'],
    payload.version,
    publicationAndOwnership['common:dataSetVersion'],
    DEFAULT_DATASET_VERSION,
  )!;
  if (!datasetId) {
    throw new CliError('Lifecycle model payload missing @id/id.', {
      code: 'PUBLISH_LIFECYCLEMODEL_ID_MISSING',
      exitCode: 2,
    });
  }
  return [datasetId, version];
}

function extract_process_identity(payload: JsonObject): [string, string] {
  const root = isRecord(payload.processDataSet) ? payload.processDataSet : payload;
  const processInformation = isRecord(root.processInformation) ? root.processInformation : {};
  const dataSetInformation = isRecord(processInformation.dataSetInformation)
    ? processInformation.dataSetInformation
    : {};
  const administrativeInformation = isRecord(root.administrativeInformation)
    ? root.administrativeInformation
    : {};
  const publicationAndOwnership = isRecord(administrativeInformation.publicationAndOwnership)
    ? administrativeInformation.publicationAndOwnership
    : {};
  const datasetId = first_non_empty(dataSetInformation['common:UUID']);
  const version = first_non_empty(
    publicationAndOwnership['common:dataSetVersion'],
    DEFAULT_DATASET_VERSION,
  )!;
  if (!datasetId) {
    throw new CliError(
      'Process payload missing processInformation.dataSetInformation.common:UUID.',
      {
        code: 'PUBLISH_PROCESS_ID_MISSING',
        exitCode: 2,
      },
    );
  }
  return [datasetId, version];
}

function extract_source_identity(payload: JsonObject): [string, string] {
  const root = isRecord(payload.sourceDataSet) ? payload.sourceDataSet : payload;
  const sourceInformation = isRecord(root.sourceInformation) ? root.sourceInformation : {};
  const dataSetInformation = isRecord(sourceInformation.dataSetInformation)
    ? sourceInformation.dataSetInformation
    : {};
  const administrativeInformation = isRecord(root.administrativeInformation)
    ? root.administrativeInformation
    : {};
  const publicationAndOwnership = isRecord(administrativeInformation.publicationAndOwnership)
    ? administrativeInformation.publicationAndOwnership
    : {};
  const datasetId = first_non_empty(dataSetInformation['common:UUID']);
  const version = first_non_empty(
    publicationAndOwnership['common:dataSetVersion'],
    DEFAULT_DATASET_VERSION,
  )!;
  if (!datasetId) {
    throw new CliError('Source payload missing sourceInformation.dataSetInformation.common:UUID.', {
      code: 'PUBLISH_SOURCE_ID_MISSING',
      exitCode: 2,
    });
  }
  return [datasetId, version];
}

function load_dataset_entry(entry: PublishDatasetEntry, baseDir: string): JsonObject {
  const source = load_dataset_entry_source(entry, baseDir);
  if (isRecord(source)) {
    for (const key of ['json_ordered', 'jsonOrdered', 'payload'] as const) {
      const candidate = source[key];
      if (isRecord(candidate)) {
        return candidate;
      }
    }
  }

  return source;
}

function load_dataset_entry_source(entry: PublishDatasetEntry, baseDir: string): JsonObject {
  if (isRecord(entry)) {
    const fileValue = first_non_empty(entry.file, entry.path);
    if (fileValue) {
      return load_json_object(resolve_path(baseDir, fileValue));
    }
    return entry;
  }

  if (typeof entry === 'string' && entry.trim()) {
    return load_json_object(resolve_path(baseDir, entry));
  }

  throw new CliError('Unsupported dataset entry in publish request.', {
    code: 'PUBLISH_UNSUPPORTED_DATASET_ENTRY',
    exitCode: 2,
    details: entry,
  });
}

function load_lifecyclemodel_publish_entry(
  entry: PublishDatasetEntry,
  baseDir: string,
): LoadedLifecyclemodelPublishEntry {
  const source = load_dataset_entry_source(entry, baseDir);
  const payload = load_dataset_entry(entry, baseDir);
  const metadata: LifecyclemodelPublishMetadata = {};
  const jsonTg = isRecord(source.json_tg)
    ? source.json_tg
    : isRecord(source.jsonTg)
      ? source.jsonTg
      : null;
  if (jsonTg) {
    metadata.json_tg = jsonTg;
  }

  const processMutations = source.processMutations ?? source.process_mutations;
  if (Array.isArray(processMutations)) {
    metadata.processMutations = processMutations as JsonObject[];
  }

  const ruleVerification =
    typeof source.ruleVerification === 'boolean'
      ? source.ruleVerification
      : typeof source.rule_verification === 'boolean'
        ? source.rule_verification
        : undefined;
  if (typeof ruleVerification === 'boolean') {
    metadata.ruleVerification = ruleVerification;
  }

  return {
    payload,
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
  };
}

function push_collected_entries<T>(
  target: Array<{ entry: T; origin: PublishCollectedOrigin }>,
  entries: unknown[],
  origin: PublishCollectedOrigin,
): void {
  for (const entry of entries) {
    target.push({ entry: entry as T, origin });
  }
}

export function normalizePublishRequest(
  raw: unknown,
  options: NormalizePublishRequestOptions,
): PublishRequest {
  if (!isRecord(raw)) {
    throw new CliError('Publish request must be a JSON object.', {
      code: 'PUBLISH_REQUEST_NOT_OBJECT',
      exitCode: 2,
    });
  }

  const requestDir = path.dirname(options.requestPath);
  const inputs = isRecord(raw.inputs) ? raw.inputs : {};
  const publish = isRecord(raw.publish) ? raw.publish : {};
  const commit =
    options.commitOverride === undefined
      ? to_boolean(publish.commit, false)
      : options.commitOverride;
  const outDirValue = first_non_empty(options.outDirOverride, raw.out_dir, raw.output_dir);
  const outDir = outDirValue
    ? resolve_path(requestDir, outDirValue)
    : default_out_dir(requestDir, commit, options.now);
  const relationMode = first_non_empty(publish.relation_mode, 'local_manifest_only');

  if (relationMode !== 'local_manifest_only') {
    throw new CliError("publish.relation_mode only supports 'local_manifest_only'.", {
      code: 'PUBLISH_UNSUPPORTED_RELATION_MODE',
      exitCode: 2,
      details: relationMode,
    });
  }

  return {
    inputs: {
      bundle_paths: ensure_list(inputs.bundle_paths)
        .map((value) => String(value).trim())
        .filter(Boolean)
        .map((value) => resolve_path(requestDir, value)),
      lifecyclemodels: ensure_list(inputs.lifecyclemodels) as PublishDatasetEntry[],
      processes: ensure_list(inputs.processes) as PublishDatasetEntry[],
      sources: ensure_list(inputs.sources) as PublishDatasetEntry[],
      relations: ensure_list(inputs.relations),
      process_build_runs: ensure_list(inputs.process_build_runs) as PublishProcessBuildRunEntry[],
    },
    publish: {
      commit,
      publish_lifecyclemodels: to_boolean(publish.publish_lifecyclemodels, true),
      publish_processes: to_boolean(publish.publish_processes, true),
      publish_sources: to_boolean(publish.publish_sources, true),
      publish_relations: to_boolean(publish.publish_relations, true),
      publish_process_build_runs: to_boolean(publish.publish_process_build_runs, true),
      relation_mode: 'local_manifest_only',
      max_attempts: to_positive_integer(publish.max_attempts, DEFAULT_MAX_ATTEMPTS),
      retry_delay_seconds: to_non_negative_number(
        publish.retry_delay_seconds,
        DEFAULT_RETRY_DELAY_SECONDS,
      ),
      process_build_forward_args: ensure_list(publish.process_build_forward_args)
        .map((value) => String(value).trim())
        .filter(Boolean),
    },
    out_dir: outDir,
  };
}

export function collectPublishInputs(
  normalized: PublishRequest,
  requestBaseDir: string,
): PublishCollectedInputs {
  const collected: PublishCollectedInputs = {
    bundle_paths: [...normalized.inputs.bundle_paths],
    lifecyclemodels: [],
    processes: [],
    sources: [],
    relations: [],
    process_build_runs: [],
  };

  for (const bundlePath of normalized.inputs.bundle_paths) {
    const bundle = load_json_object(bundlePath);
    const origin: PublishCollectedOrigin = {
      source: 'bundle',
      base_dir: path.dirname(bundlePath),
      bundle_path: bundlePath,
    };
    push_collected_entries<PublishDatasetEntry>(
      collected.lifecyclemodels,
      ensure_list(bundle.lifecyclemodels),
      origin,
    );
    push_collected_entries<PublishDatasetEntry>(
      collected.processes,
      [...ensure_list(bundle.projected_processes), ...ensure_list(bundle.processes)],
      origin,
    );
    push_collected_entries<PublishDatasetEntry>(
      collected.sources,
      ensure_list(bundle.sources),
      origin,
    );
    push_collected_entries(
      collected.relations,
      [...ensure_list(bundle.resulting_process_relations), ...ensure_list(bundle.relations)],
      origin,
    );
    push_collected_entries<PublishProcessBuildRunEntry>(
      collected.process_build_runs,
      ensure_list(bundle.process_build_runs),
      origin,
    );
  }

  const directOrigin: PublishCollectedOrigin = {
    source: 'input',
    base_dir: requestBaseDir,
    bundle_path: null,
  };

  push_collected_entries<PublishDatasetEntry>(
    collected.lifecyclemodels,
    normalized.inputs.lifecyclemodels,
    directOrigin,
  );
  push_collected_entries<PublishDatasetEntry>(
    collected.processes,
    normalized.inputs.processes,
    directOrigin,
  );
  push_collected_entries<PublishDatasetEntry>(
    collected.sources,
    normalized.inputs.sources,
    directOrigin,
  );
  push_collected_entries(collected.relations, normalized.inputs.relations, directOrigin);
  push_collected_entries<PublishProcessBuildRunEntry>(
    collected.process_build_runs,
    normalized.inputs.process_build_runs,
    directOrigin,
  );

  return collected;
}

async function maybe_execute_dataset(
  report: PreparedPublishDatasetReport,
  payload: JsonObject,
  options: PublishRequestOptions & {
    table: 'lifecyclemodels' | 'processes' | 'sources';
    metadata?: LifecyclemodelPublishMetadata | null;
  },
): Promise<PublishDatasetReport> {
  if (!options.commit) {
    return report;
  }

  if (!options.executor) {
    report.status = 'deferred_no_executor';
    return report;
  }

  try {
    report.execution = await options.executor({
      table: options.table,
      id: report.id,
      version: report.version,
      payload,
      metadata: options.metadata,
      source: report.source,
      bundle_path: report.bundle_path,
      publish: options.publish,
    });
    report.status = 'executed';
  } catch (error) {
    report.status = 'failed';
    report.error = serialize_error(error);
  }

  return report;
}

async function publish_lifecyclemodels(
  entries: PublishCollectedDatasetEntry[],
  options: PublishRequestOptions,
): Promise<PublishDatasetReport[]> {
  const reports: PublishDatasetReport[] = [];
  for (const item of entries) {
    const loaded = load_lifecyclemodel_publish_entry(item.entry, item.origin.base_dir);
    const payload = loaded.payload;
    const [datasetId, version] = extract_lifecyclemodel_identity(payload);
    const report: PreparedPublishDatasetReport = {
      table: 'lifecyclemodels',
      id: datasetId,
      version,
      status: 'prepared',
      source: item.origin.source,
      bundle_path: item.origin.bundle_path,
    };
    reports.push(
      await maybe_execute_dataset(report, payload, {
        ...options,
        table: 'lifecyclemodels',
        executor: options.executor,
        metadata: loaded.metadata,
      }),
    );
  }
  return reports;
}

async function publish_processes(
  entries: PublishCollectedDatasetEntry[],
  options: ProcessPublishRequestOptions,
): Promise<PublishDatasetReport[]> {
  const reports: PublishDatasetReport[] = [];
  const validate = options.validateProcessPayloadImpl ?? validateProcessPayload;
  for (const item of entries) {
    const payload = load_dataset_entry(item.entry, item.origin.base_dir);
    try {
      const [datasetId, version] = extract_process_identity(payload);
      const validation = validate(payload);
      if (!validation.ok) {
        reports.push({
          table: 'processes',
          id: datasetId,
          version,
          status: 'failed',
          source: item.origin.source,
          bundle_path: item.origin.bundle_path,
          validation,
          error: {
            message: summarizeProcessPayloadValidation(validation),
          },
        });
        continue;
      }

      const report: PreparedPublishDatasetReport = {
        table: 'processes',
        id: datasetId,
        version,
        status: 'prepared',
        source: item.origin.source,
        bundle_path: item.origin.bundle_path,
        validation,
      };
      reports.push(
        await maybe_execute_dataset(report, payload, {
          ...options,
          table: 'processes',
          executor: options.executor,
        }),
      );
    } catch (error) {
      const report: PublishDatasetReport = {
        table: 'processes',
        id: first_non_empty(payload['@id'], payload.id),
        version: first_non_empty(payload['@version'], payload.version, DEFAULT_DATASET_VERSION),
        status: 'deferred_projection_payload',
        source: item.origin.source,
        bundle_path: item.origin.bundle_path,
        reason:
          error instanceof CliError && error.code === 'PUBLISH_PROCESS_ID_MISSING'
            ? 'Payload is not a canonical processDataSet wrapper; keep it in the publish bundle until a projection-to-process adapter exists.'
            : serialize_error(error).message,
      };
      reports.push(report);
    }
  }
  return reports;
}

async function publish_sources(
  entries: PublishCollectedDatasetEntry[],
  options: PublishRequestOptions,
): Promise<PublishDatasetReport[]> {
  const reports: PublishDatasetReport[] = [];
  for (const item of entries) {
    const payload = load_dataset_entry(item.entry, item.origin.base_dir);
    const [datasetId, version] = extract_source_identity(payload);
    const report: PreparedPublishDatasetReport = {
      table: 'sources',
      id: datasetId,
      version,
      status: 'prepared',
      source: item.origin.source,
      bundle_path: item.origin.bundle_path,
    };
    reports.push(
      await maybe_execute_dataset(report, payload, {
        ...options,
        table: 'sources',
        executor: options.executor,
      }),
    );
  }
  return reports;
}

async function publish_process_build_runs(
  entries: PublishCollectedProcessBuildRunEntry[],
  options: {
    commit: boolean;
    executor: PublishExecutors['process_build_runs'];
    publish: PublishRequest['publish'];
  },
): Promise<PublishProcessBuildRunReport[]> {
  const reports: PublishProcessBuildRunReport[] = [];
  for (const item of entries) {
    const runId =
      typeof item.entry === 'string' ? item.entry.trim() : first_non_empty(item.entry.run_id);

    if (!runId) {
      throw new CliError('process_build_run entry missing run_id.', {
        code: 'PUBLISH_PROCESS_BUILD_RUN_ID_MISSING',
        exitCode: 2,
        details: item.entry,
      });
    }

    const report: PublishProcessBuildRunReport = {
      run_id: runId,
      status: 'prepared',
      source: item.origin.source,
      bundle_path: item.origin.bundle_path,
      forward_args: [...options.publish.process_build_forward_args],
    };

    if (!options.commit) {
      reports.push(report);
      continue;
    }

    if (!options.executor) {
      report.status = 'deferred_no_executor';
      reports.push(report);
      continue;
    }

    try {
      report.execution = await options.executor({
        run_id: runId,
        entry: item.entry,
        source: item.origin.source,
        bundle_path: item.origin.bundle_path,
        forward_args: [...options.publish.process_build_forward_args],
        publish: options.publish,
      });
      report.status = 'executed';
    } catch (error) {
      report.status = 'failed';
      report.error = serialize_error(error);
    }

    reports.push(report);
  }
  return reports;
}

function build_relation_manifest(
  relations: PublishCollectedRelationEntry[],
  publish: PublishRequest['publish'],
  now: Date,
): PublishRelationManifest {
  return {
    generated_at_utc: now.toISOString(),
    relation_mode: publish.relation_mode,
    status: 'prepared_local_relation_manifest',
    relations: publish.publish_relations ? relations.map((item) => item.entry) : [],
  };
}

function table_write_mode_for_publish(): SupabaseJsonOrderedWriteMode {
  return 'upsert_current_version';
}

function build_default_dataset_executor(options: {
  table: SupabaseJsonOrderedTable;
  env: NodeJS.ProcessEnv;
  fetchImpl: FetchLike;
  timeoutMs?: number;
}) {
  return async (args: DatasetPublishExecutorArgs): Promise<unknown> => {
    if (options.table === 'processes') {
      return syncStateAwareProcessRecord({
        id: args.id,
        version: args.version,
        payload: args.payload,
        env: options.env,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
        audit: {
          command: 'tiangong-lca publish run',
          source: args.source,
          bundle_path: args.bundle_path,
        },
      });
    }

    if (options.table === 'lifecyclemodels') {
      return syncLifecyclemodelBundleRecord({
        id: args.id,
        version: args.version,
        payload: args.payload,
        metadata: args.metadata ?? null,
        env: options.env,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      });
    }

    return syncSupabaseJsonOrderedRecord({
      table: options.table,
      id: args.id,
      version: args.version,
      payload: args.payload,
      writeMode: table_write_mode_for_publish(),
      env: options.env,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    });
  };
}

function resolve_dataset_executors(options: RunPublishOptions): PublishExecutors {
  const explicit = options.executors ?? {};
  const env = options.env;
  const fetchImpl = options.fetchImpl;

  if (!env || !fetchImpl || !hasSupabaseRestRuntime(env)) {
    return explicit;
  }

  return {
    lifecyclemodels:
      explicit.lifecyclemodels ??
      build_default_dataset_executor({
        table: 'lifecyclemodels',
        env,
        fetchImpl,
        timeoutMs: options.timeoutMs,
      }),
    processes:
      explicit.processes ??
      build_default_dataset_executor({
        table: 'processes',
        env,
        fetchImpl,
        timeoutMs: options.timeoutMs,
      }),
    sources:
      explicit.sources ??
      build_default_dataset_executor({
        table: 'sources',
        env,
        fetchImpl,
        timeoutMs: options.timeoutMs,
      }),
    process_build_runs: explicit.process_build_runs,
  };
}

function dataset_failure_finding(
  report: PublishDatasetReport,
  fallbackCode: string,
): PublishVerificationFinding {
  const validationIssue = report.validation?.ok === false ? report.validation.issues[0] : null;
  return {
    code: validationIssue?.code ?? fallbackCode,
    severity: 'blocker',
    message:
      validationIssue?.message ??
      report.error?.message ??
      report.reason ??
      'Publish dataset failed.',
    table: report.table,
    id: report.id,
    version: report.version,
    ...(validationIssue?.path ? { path: validationIssue.path } : {}),
    ...(report.bundle_path !== undefined ? { bundle_path: report.bundle_path } : {}),
  };
}

function process_build_run_failure_finding(
  report: PublishProcessBuildRunReport,
): PublishVerificationFinding {
  return {
    code: 'process_build_run_publish_failed',
    severity: 'blocker',
    message: report.error?.message ?? 'Process build run publish failed.',
    table: 'process_build_runs',
    id: report.run_id,
    version: null,
    bundle_path: report.bundle_path,
  };
}

function build_publish_verification_report(options: {
  now: Date;
  commit: boolean;
  failed: number;
  deferred: number;
  executed: number;
  lifecyclemodels: PublishDatasetReport[];
  processes: PublishDatasetReport[];
  sources: PublishDatasetReport[];
  processBuildRuns: PublishProcessBuildRunReport[];
}): PublishVerificationReport {
  const ruleset = getRuntimeRuleset('publish-run/default');
  const datasetFindings = [
    ...options.lifecyclemodels,
    ...options.processes,
    ...options.sources,
  ].flatMap((report) =>
    report.status === 'failed'
      ? [dataset_failure_finding(report, `${report.table}_publish_failed`)]
      : [],
  );
  const processBuildRunFindings = options.processBuildRuns.flatMap((report) =>
    report.status === 'failed' ? [process_build_run_failure_finding(report)] : [],
  );
  const blockers = [...datasetFindings, ...processBuildRunFindings];

  return {
    schema_version: 1,
    generated_at_utc: options.now.toISOString(),
    command: 'publish run',
    status: blockers.length > 0 ? 'blocked' : 'passed',
    ruleset_id: PUBLISH_VERIFICATION_RULESET_ID,
    ruleset_version: PUBLISH_VERIFICATION_RULESET_VERSION,
    ruleset_source_version: ruleset.source_version,
    ruleset_rule_ids: ruleset.rule_ids,
    commit: options.commit,
    findings: blockers,
    blockers,
    next_action: blockers.length > 0 ? 'fix_blockers' : 'ready_for_commit_or_publish',
    counts: {
      findings: blockers.length,
      blockers: blockers.length,
      failed: options.failed,
      deferred: options.deferred,
      executed: options.executed,
    },
  };
}

export async function runPublish(options: RunPublishOptions): Promise<PublishReport> {
  const requestPath = path.resolve(options.inputPath);
  const requestDir = path.dirname(requestPath);
  const raw = options.rawRequest ?? readJsonInput(requestPath);
  const normalized = normalizePublishRequest(raw, {
    requestPath,
    outDirOverride: options.outDir ?? undefined,
    commitOverride: options.commit ?? undefined,
    now: options.now,
  });
  const collected = collectPublishInputs(normalized, requestDir);
  const now = options.now ?? new Date();
  const outDir = normalized.out_dir;
  const executors = resolve_dataset_executors(options);

  const files = {
    normalized_request: path.join(outDir, 'normalized-request.json'),
    collected_inputs: path.join(outDir, 'collected-inputs.json'),
    relation_manifest: path.join(outDir, 'relation-manifest.json'),
    verification_report: path.join(outDir, 'verification-report.json'),
    publish_report: path.join(outDir, 'publish-report.json'),
  };

  writeJsonArtifact(files.normalized_request, normalized);
  writeJsonArtifact(files.collected_inputs, collected);

  const lifecyclemodels = normalized.publish.publish_lifecyclemodels
    ? await publish_lifecyclemodels(collected.lifecyclemodels, {
        commit: normalized.publish.commit,
        executor: executors.lifecyclemodels,
        publish: normalized.publish,
      })
    : [];
  const processes = normalized.publish.publish_processes
    ? await publish_processes(collected.processes, {
        commit: normalized.publish.commit,
        executor: executors.processes,
        publish: normalized.publish,
        validateProcessPayloadImpl: options.validateProcessPayloadImpl,
      })
    : [];
  const sources = normalized.publish.publish_sources
    ? await publish_sources(collected.sources, {
        commit: normalized.publish.commit,
        executor: executors.sources,
        publish: normalized.publish,
      })
    : [];
  const processBuildRuns = normalized.publish.publish_process_build_runs
    ? await publish_process_build_runs(collected.process_build_runs, {
        commit: normalized.publish.commit,
        executor: executors.process_build_runs,
        publish: normalized.publish,
      })
    : [];
  const relations = build_relation_manifest(collected.relations, normalized.publish, now);

  writeJsonArtifact(files.relation_manifest, relations);

  const publishEntries = [...lifecyclemodels, ...processes, ...sources, ...processBuildRuns];
  const failed = publishEntries.filter((item) => item.status === 'failed').length;
  const executed = publishEntries.filter((item) => item.status === 'executed').length;
  const deferred = publishEntries.filter((item) => item.status.startsWith('deferred')).length;
  const verification = build_publish_verification_report({
    now,
    commit: normalized.publish.commit,
    failed,
    deferred,
    executed,
    lifecyclemodels,
    processes,
    sources,
    processBuildRuns,
  });

  const report: PublishReport = {
    generated_at_utc: now.toISOString(),
    request_path: requestPath,
    out_dir: outDir,
    commit: normalized.publish.commit,
    status: failed > 0 ? 'completed_with_failures' : 'completed',
    counts: {
      bundle_paths: collected.bundle_paths.length,
      lifecyclemodels: lifecyclemodels.length,
      processes: processes.length,
      sources: sources.length,
      relations: relations.relations.length,
      process_build_runs: processBuildRuns.length,
      executed,
      deferred,
      failed,
    },
    files,
    verification,
    lifecyclemodels,
    processes,
    sources,
    process_build_runs: processBuildRuns,
    relations,
  };

  writeJsonArtifact(files.verification_report, verification);
  writeJsonArtifact(files.publish_report, report);
  return report;
}

export const __testInternals = {
  build_publish_verification_report,
};
