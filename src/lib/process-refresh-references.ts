// data-api-relations: contacts, flowproperties, flows, lciamethods, processes, sources, unitgroups
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writeJsonArtifact, writeJsonLinesArtifact, writeTextArtifact } from './artifacts.js';
import { CliError } from './errors.js';
import type { FetchLike, ResponseLike } from './http.js';
import {
  syncStateAwareProcessRecord,
  type ProcessStateAwareWriteResult,
  type SyncStateAwareProcessRecordOptions,
} from './process-save-draft.js';
import {
  validateProcessPayload,
  type ProcessPayloadValidationResult,
} from './process-payload-validation.js';
import {
  deriveSupabaseProjectBaseUrl,
  deriveSupabaseRestBaseUrl,
  requireSupabaseRestRuntime,
} from './supabase-client.js';
import {
  applyDataApiProfileHeaders,
  buildDataApiUrl,
  resolveDataApiCapability,
} from './supabase-data-api-contract.js';
import { resolveSupabaseUserSession } from './supabase-session.js';
import { redactEmail } from './user-api-key.js';

type JsonObject = Record<string, unknown>;

type ProcessManifestRow = {
  id: string;
  version: string;
  modified_at: string | null;
  state_code: number | null;
  model_id: string | null;
};

type ProcessDetailRow = ProcessManifestRow & {
  user_id: string | null;
  json: JsonObject;
};

type LatestReferenceRow = {
  id: string;
  version: string;
  json: JsonObject;
  modified_at: string | null;
  state_code: number | null;
  user_id: string | null;
  team_id: string | null;
};

type LatestReferenceCacheEntry = {
  row: LatestReferenceRow | null;
  count: number;
  error?: string;
};

type ReferenceNode = JsonObject & {
  '@refObjectId': string;
  '@version': string;
  '@type': string;
};

type CollectedReference = {
  node: ReferenceNode;
  path: string;
};

type TouchedReference = {
  id: string;
  type: string;
  from_version: string;
  to_version: string;
  path: string;
};

type UnresolvedReference = {
  id: string;
  type: string;
  version: string;
  reason: string;
};

type UpdateSummary = {
  version_updates: number;
  description_updates: number;
  touched_refs: TouchedReference[];
  unresolved_refs: UnresolvedReference[];
};

type ProgressStatus = 'saved' | 'dry_run' | 'skipped' | 'validation_blocked' | 'error';

type ProgressRecord = {
  time: string;
  key: string;
  id?: string;
  version?: string;
  status: ProgressStatus;
  note?: string;
  ref_count?: number;
  version_updates?: number;
  description_updates?: number;
  unresolved_count?: number;
  changed_ref_count?: number;
  schema_validator?: string;
  schema_issue_count?: number;
  schema_issues?: ProcessPayloadValidationResult['issues'];
  touched_refs?: TouchedReference[];
  unresolved_refs?: UnresolvedReference[];
  write_path?: string;
  write_operation?: string;
  error?: string;
};

type RefreshManifest = {
  schema_version: 1;
  generated_at_utc: string;
  user_id: string;
  masked_user_email: string;
  source: 'current_user_processes';
  order: 'modified_at.desc,id.asc';
  page_size: number;
  count: number;
  rows: ProcessManifestRow[];
};

export type ProcessRefreshReferencesReport = {
  schema_version: 1;
  generated_at_utc: string;
  status: 'completed_process_reference_refresh' | 'completed_process_reference_refresh_with_errors';
  out_dir: string;
  mode: 'dry_run' | 'apply';
  user_id: string;
  masked_user_email: string;
  counts: {
    manifest: number;
    selected: number;
    already_completed: number;
    pending: number;
    saved: number;
    dry_run: number;
    skipped: number;
    validation_blocked: number;
    errors: number;
  };
  files: {
    manifest: string;
    progress_jsonl: string;
    errors_jsonl: string;
    validation_blockers_jsonl: string;
    summary_json: string;
    report_md: string;
  };
};

export type RunProcessRefreshReferencesOptions = {
  outDir: string;
  apply?: boolean | null;
  reuseManifest?: boolean | null;
  limit?: number | null;
  pageSize?: number | null;
  concurrency?: number | null;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxRetries?: number;
  now?: Date;
  validateProcessPayloadImpl?: (payload: JsonObject) => ProcessPayloadValidationResult;
  syncStateAwareProcessRecordImpl?: (
    options: SyncStateAwareProcessRecordOptions,
  ) => Promise<ProcessStateAwareWriteResult>;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_CONCURRENCY = 1;
const MAX_PAGE_SIZE = 1_000;
const MAX_CONCURRENCY = 8;

const TABLE_BY_TYPE = new Map<string, string>([
  ['contact data set', 'contacts'],
  ['source data set', 'sources'],
  ['unit group data set', 'unitgroups'],
  ['flow property data set', 'flowproperties'],
  ['flow data set', 'flows'],
  ['process data set', 'processes'],
  ['lifeCycleModel data set', 'lifecyclemodels'],
  ['LCIA method data set', 'lciamethods'],
] as const);

function normalizeReferenceType(type: string): string {
  return type.trim().toLowerCase();
}

function tableForReferenceType(type: string): string | null {
  return TABLE_BY_TYPE.get(type) ?? TABLE_BY_TYPE.get(normalizeReferenceType(type)) ?? null;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requiredNonEmpty(value: string, label: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new CliError(`Missing required ${label}.`, {
      code,
      exitCode: 2,
    });
  }
  return normalized;
}

function toPositiveInteger(value: number, label: string, code: string, max?: number): number {
  if (!Number.isInteger(value) || value <= 0 || (max !== undefined && value > max)) {
    throw new CliError(
      max === undefined
        ? `Expected ${label} to be a positive integer.`
        : `Expected ${label} to be a positive integer not greater than ${max}.`,
      {
        code,
        exitCode: 2,
      },
    );
  }
  return value;
}

function toOptionalPositiveInteger(
  value: number | null | undefined,
  label: string,
  code: string,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return toPositiveInteger(value, label, code);
}

function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

function recordKey(row: Pick<ProcessManifestRow, 'id' | 'version'>): string {
  return `${row.id}:${row.version}`;
}

function parseContentRangeTotal(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const match = value.match(/\/(\d+|\*)$/u);
  if (!match || match[1] === '*') {
    return null;
  }
  return Number.parseInt(match[1]!, 10);
}

function normalizeVersion(version: string): string {
  return version.trim();
}

function compareVersions(left: string, right: string): number {
  const leftParts = normalizeVersion(left)
    .split('.')
    .map((part) => Number(part));
  const rightParts = normalizeVersion(right)
    .split('.')
    .map((part) => Number(part));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = Number.isFinite(leftParts[index]) ? leftParts[index] : 0;
    const rightValue = Number.isFinite(rightParts[index]) ? rightParts[index] : 0;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return normalizeVersion(left).localeCompare(normalizeVersion(right));
}

function jsonToList(value: unknown): unknown[] {
  if (value === null || value === undefined || value === '') {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function getLangList(value: unknown): JsonObject[] {
  if (value === null || value === undefined || value === '') {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is JsonObject => isRecord(entry));
  }
  if (isRecord(value)) {
    const langString = value['common:langString'];
    if (Array.isArray(langString)) {
      return langString.filter((entry): entry is JsonObject => isRecord(entry));
    }
    if (isRecord(langString)) {
      return [langString];
    }
    if (value['#text'] !== undefined || value['@xml:lang'] !== undefined) {
      return [value];
    }
  }
  if (typeof value === 'string') {
    return [{ '@xml:lang': 'en', '#text': value }];
  }
  return [];
}

function getLangText(value: unknown, lang: string | null): string {
  const entries = getLangList(value);
  if (lang) {
    for (const entry of entries) {
      if (
        trimText(entry['@xml:lang']).toLowerCase() === lang.toLowerCase() &&
        trimText(entry['#text'])
      ) {
        return trimText(entry['#text']);
      }
    }
  }
  for (const entry of entries) {
    if (trimText(entry['#text'])) {
      return trimText(entry['#text']);
    }
  }
  return '';
}

function genFlowName(name: JsonObject | null, lang: string): string {
  if (!name) {
    return '';
  }
  const parts = [
    getLangText(name.baseName, lang),
    getLangText(name.treatmentStandardsRoutes, lang),
    getLangText(name.mixAndLocationTypes, lang),
    getLangText(name.flowProperties, lang),
  ].filter(Boolean);
  return parts.join('; ');
}

function genFlowNameJson(name: JsonObject | null): JsonObject[] {
  if (!name) {
    return [];
  }
  const results: JsonObject[] = [];
  for (const item of jsonToList(name.baseName)) {
    const entry = isRecord(item) ? item : {};
    const lang = trimText(entry['@xml:lang']);
    const text = lang ? genFlowName(name, lang) : '';
    if (lang && text) {
      results.push({ '@xml:lang': lang, '#text': text });
    }
  }
  return results;
}

function genProcessName(name: JsonObject | null, lang: string): string {
  if (!name) {
    return '';
  }
  const parts = [
    getLangText(name.baseName, lang),
    getLangText(name.treatmentStandardsRoutes, lang),
    getLangText(name.mixAndLocationTypes, lang),
    getLangText(name.functionalUnitFlowProperties, lang),
  ].filter(Boolean);
  return parts.join('; ');
}

function genProcessNameJson(name: JsonObject | null): JsonObject[] {
  if (!name) {
    return [];
  }
  const results: JsonObject[] = [];
  for (const item of jsonToList(name.baseName)) {
    const entry = isRecord(item) ? item : {};
    const lang = trimText(entry['@xml:lang']);
    const text = lang ? genProcessName(name, lang) : '';
    if (lang && text) {
      results.push({ '@xml:lang': lang, '#text': text });
    }
  }
  return results;
}

function normalizeDatasetPayload(payload: unknown, label: string): JsonObject {
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (!isRecord(parsed)) {
        throw new CliError(`Remote dataset payload was not a JSON object for ${label}.`, {
          code: 'PROCESS_REFRESH_REMOTE_PAYLOAD_INVALID',
          exitCode: 1,
          details: parsed,
        });
      }
      return parsed;
    } catch (error) {
      if (error instanceof CliError) {
        throw error;
      }
      throw new CliError(`Remote dataset payload was not valid JSON for ${label}.`, {
        code: 'PROCESS_REFRESH_REMOTE_PAYLOAD_INVALID_JSON',
        exitCode: 1,
        details: String(error),
      });
    }
  }

  if (!isRecord(payload)) {
    throw new CliError(`Remote dataset payload was missing json for ${label}.`, {
      code: 'PROCESS_REFRESH_REMOTE_PAYLOAD_MISSING',
      exitCode: 1,
      details: payload,
    });
  }

  return payload;
}

function getShortDescription(payload: JsonObject, type: string): JsonObject[] {
  const normalizedType = normalizeReferenceType(type);
  if (normalizedType === 'flow data set') {
    const flowDataSet = isRecord(payload.flowDataSet) ? payload.flowDataSet : {};
    const info = isRecord(flowDataSet.flowInformation) ? flowDataSet.flowInformation : {};
    const dataSetInformation = isRecord(info.dataSetInformation) ? info.dataSetInformation : {};
    const name = isRecord(dataSetInformation.name) ? dataSetInformation.name : null;
    return genFlowNameJson(name);
  }

  if (normalizedType === 'process data set') {
    const processDataSet = isRecord(payload.processDataSet) ? payload.processDataSet : {};
    const info = isRecord(processDataSet.processInformation)
      ? processDataSet.processInformation
      : {};
    const dataSetInformation = isRecord(info.dataSetInformation) ? info.dataSetInformation : {};
    const name = isRecord(dataSetInformation.name) ? dataSetInformation.name : null;
    return genProcessNameJson(name);
  }

  if (normalizedType === 'contact data set') {
    const contactDataSet = isRecord(payload.contactDataSet) ? payload.contactDataSet : {};
    const info = isRecord(contactDataSet.contactInformation)
      ? contactDataSet.contactInformation
      : {};
    const dataSetInformation = isRecord(info.dataSetInformation) ? info.dataSetInformation : {};
    return getLangList(dataSetInformation['common:shortName']);
  }

  if (normalizedType === 'source data set') {
    const sourceDataSet = isRecord(payload.sourceDataSet) ? payload.sourceDataSet : {};
    const info = isRecord(sourceDataSet.sourceInformation) ? sourceDataSet.sourceInformation : {};
    const dataSetInformation = isRecord(info.dataSetInformation) ? info.dataSetInformation : {};
    return getLangList(dataSetInformation['common:shortName']);
  }

  if (normalizedType === 'flow property data set') {
    const flowPropertyDataSet = isRecord(payload.flowPropertyDataSet)
      ? payload.flowPropertyDataSet
      : {};
    const info = isRecord(flowPropertyDataSet.flowPropertyInformation)
      ? flowPropertyDataSet.flowPropertyInformation
      : {};
    const dataSetInformation = isRecord(info.dataSetInformation) ? info.dataSetInformation : {};
    return getLangList(dataSetInformation['common:shortName']);
  }

  if (normalizedType === 'unit group data set') {
    const unitGroupDataSet = isRecord(payload.unitGroupDataSet) ? payload.unitGroupDataSet : {};
    const info = isRecord(unitGroupDataSet.unitGroupInformation)
      ? unitGroupDataSet.unitGroupInformation
      : {};
    const dataSetInformation = isRecord(info.dataSetInformation) ? info.dataSetInformation : {};
    return getLangList(dataSetInformation['common:shortName']);
  }

  if (normalizedType === 'lcia method data set') {
    const lciaMethodDataSet = isRecord(payload.lciaMethodDataSet) ? payload.lciaMethodDataSet : {};
    const info = isRecord(lciaMethodDataSet.LCIAMethodInformation)
      ? lciaMethodDataSet.LCIAMethodInformation
      : {};
    const dataSetInformation = isRecord(info.dataSetInformation) ? info.dataSetInformation : {};
    return getLangList(dataSetInformation['common:shortName']);
  }

  return [];
}

async function parseJsonResponse(response: ResponseLike, label: string): Promise<unknown> {
  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  if (!text.trim()) {
    return null;
  }
  if (!contentType.includes('application/json')) {
    return text;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CliError(`${label} returned invalid JSON.`, {
      code: 'PROCESS_REFRESH_REMOTE_INVALID_JSON',
      exitCode: 1,
      details: String(error),
    });
  }
}

async function fetchJsonWithRetry(options: {
  url: string;
  init: RequestInit;
  label: string;
  fetchImpl: FetchLike;
  timeoutMs: number;
  maxRetries: number;
}): Promise<{ status: number; headers: Headers; body: unknown }> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= options.maxRetries; attempt += 1) {
    try {
      const response = await options.fetchImpl(options.url, {
        ...options.init,
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      const body = await parseJsonResponse(response, options.label);
      if (!response.ok) {
        throw new CliError(`${options.label} failed with ${response.status}.`, {
          code: 'PROCESS_REFRESH_REMOTE_REQUEST_FAILED',
          exitCode: 1,
          details: {
            status: response.status,
            body,
            url: options.url,
          },
        });
      }
      return {
        status: response.status,
        headers: new Headers({
          'content-range': response.headers.get('content-range') ?? '',
          'content-type': response.headers.get('content-type') ?? '',
        }),
        body,
      };
    } catch (error) {
      lastError = error;
      if (attempt >= options.maxRetries) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
    }
  }

  if (lastError instanceof CliError) {
    throw lastError;
  }

  throw new CliError(`${options.label} failed after ${options.maxRetries} attempt(s).`, {
    code: 'PROCESS_REFRESH_REMOTE_REQUEST_FAILED',
    exitCode: 1,
    details: String(lastError),
  });
}

async function resolveRemoteAuth(options: {
  env: NodeJS.ProcessEnv;
  fetchImpl: FetchLike;
  timeoutMs: number;
  now: Date;
  maxRetries: number;
}): Promise<{
  projectBaseUrl: string;
  publishableKey: string;
  accessToken: string;
  userId: string;
  maskedUserEmail: string;
}> {
  const runtime = requireSupabaseRestRuntime(options.env);
  const session = await resolveSupabaseUserSession({
    runtime,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    now: options.now,
  });
  const userResponse = await fetchJsonWithRetry({
    url: `${deriveSupabaseProjectBaseUrl(runtime.apiBaseUrl)}/auth/v1/user`,
    init: {
      method: 'GET',
      headers: {
        apikey: runtime.publishableKey,
        Authorization: `Bearer ${session.accessToken}`,
        Accept: 'application/json',
      },
    },
    label: 'supabase current-user lookup',
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
  });
  const userId = isRecord(userResponse.body) ? trimText(userResponse.body.id) : '';
  if (!userId) {
    throw new CliError('Supabase current-user lookup succeeded without a user id.', {
      code: 'PROCESS_REFRESH_CURRENT_USER_ID_MISSING',
      exitCode: 1,
    });
  }

  return {
    projectBaseUrl: deriveSupabaseProjectBaseUrl(runtime.apiBaseUrl),
    publishableKey: runtime.publishableKey,
    accessToken: session.accessToken,
    userId,
    maskedUserEmail: redactEmail(session.userEmail),
  };
}

function normalizeManifestRow(value: unknown): ProcessManifestRow | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = trimText(value.id);
  const version = trimText(value.version);
  if (!id || !version) {
    return null;
  }
  return {
    id,
    version,
    modified_at: trimText(value.modified_at) || null,
    state_code: typeof value.state_code === 'number' ? value.state_code : null,
    model_id: trimText(value.model_id) || null,
  };
}

function readManifest(filePath: string): RefreshManifest | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.rows)) {
      throw new Error('manifest rows missing');
    }
    const rows = parsed.rows
      .map((row) => normalizeManifestRow(row))
      .filter((row): row is ProcessManifestRow => row !== null);
    const userId = trimText(parsed.user_id);
    const maskedUserEmail = trimText(parsed.masked_user_email);
    if (!userId || !maskedUserEmail) {
      throw new Error('manifest user metadata missing');
    }
    return {
      schema_version: 1,
      generated_at_utc: trimText(parsed.generated_at_utc) || nowIso(),
      user_id: userId,
      masked_user_email: maskedUserEmail,
      source: 'current_user_processes',
      order: 'modified_at.desc,id.asc',
      page_size:
        typeof parsed.page_size === 'number' && Number.isInteger(parsed.page_size)
          ? parsed.page_size
          : DEFAULT_PAGE_SIZE,
      count:
        typeof parsed.count === 'number' && Number.isInteger(parsed.count)
          ? parsed.count
          : rows.length,
      rows,
    };
  } catch (error) {
    throw new CliError(`Manifest file is not valid JSON: ${filePath}`, {
      code: 'PROCESS_REFRESH_MANIFEST_INVALID',
      exitCode: 2,
      details: String(error),
    });
  }
}

async function snapshotProcesses(options: {
  projectBaseUrl: string;
  publishableKey: string;
  accessToken: string;
  userId: string;
  pageSize: number;
  fetchImpl: FetchLike;
  timeoutMs: number;
  maxRetries: number;
}): Promise<ProcessManifestRow[]> {
  const capability = resolveDataApiCapability({ kind: 'relation', name: 'processes' });
  const rows: ProcessManifestRow[] = [];
  let total: number | null = null;

  for (let offset = 0; total === null || offset < total; offset += options.pageSize) {
    const url = new URL(
      buildDataApiUrl(deriveSupabaseRestBaseUrl(options.projectBaseUrl), capability),
    );
    url.searchParams.set('select', 'id,version,modified_at,state_code,model_id');
    url.searchParams.set('user_id', `eq.${options.userId}`);
    url.searchParams.set('order', 'modified_at.desc,id.asc');
    url.searchParams.set('limit', String(options.pageSize));
    url.searchParams.set('offset', String(offset));

    const page = await fetchJsonWithRetry({
      url: url.toString(),
      init: {
        method: 'GET',
        headers: applyDataApiProfileHeaders(
          {
            apikey: options.publishableKey,
            Authorization: `Bearer ${options.accessToken}`,
            Accept: 'application/json',
            Prefer: 'count=exact',
          },
          capability,
        ),
      },
      label: `process refresh snapshot page fetch (offset=${offset})`,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
    });

    const pageRows = Array.isArray(page.body) ? page.body : [];
    const normalizedRows = pageRows
      .map((row) => normalizeManifestRow(row))
      .filter((row): row is ProcessManifestRow => row !== null);
    rows.push(...normalizedRows);
    total = parseContentRangeTotal(page.headers.get('content-range')) ?? rows.length;
    if (normalizedRows.length === 0) {
      break;
    }
  }

  const deduped: ProcessManifestRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = recordKey(row);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }

  return deduped;
}

function readCompleted(progressFile: string, applyMode: boolean): Set<string> {
  const completed = new Set<string>();
  if (!existsSync(progressFile)) {
    return completed;
  }
  const doneStatuses = applyMode
    ? new Set<ProgressStatus>(['saved', 'skipped', 'validation_blocked'])
    : new Set<ProgressStatus>(['dry_run', 'skipped', 'validation_blocked']);
  const lines = readFileSync(progressFile, 'utf8').split(/\r?\n/u).filter(Boolean);

  for (const line of lines) {
    try {
      const record = JSON.parse(line) as unknown;
      if (!isRecord(record)) {
        continue;
      }
      const key = trimText(record.key);
      const status = trimText(record.status) as ProgressStatus;
      if (key && doneStatuses.has(status)) {
        completed.add(key);
      }
    } catch {
      // Ignore corrupt progress rows and continue resuming from the valid ones.
    }
  }

  return completed;
}

async function fetchProcessDetail(options: {
  projectBaseUrl: string;
  publishableKey: string;
  accessToken: string;
  row: ProcessManifestRow;
  fetchImpl: FetchLike;
  timeoutMs: number;
  maxRetries: number;
}): Promise<ProcessDetailRow> {
  const capability = resolveDataApiCapability({ kind: 'relation', name: 'processes' });
  const url = new URL(
    buildDataApiUrl(deriveSupabaseRestBaseUrl(options.projectBaseUrl), capability),
  );
  url.searchParams.set('select', 'id,version,json,modified_at,state_code,model_id,user_id');
  url.searchParams.set('id', `eq.${options.row.id}`);
  url.searchParams.set('version', `eq.${options.row.version}`);
  url.searchParams.set('limit', '1');

  const response = await fetchJsonWithRetry({
    url: url.toString(),
    init: {
      method: 'GET',
      headers: applyDataApiProfileHeaders(
        {
          apikey: options.publishableKey,
          Authorization: `Bearer ${options.accessToken}`,
          Accept: 'application/json',
        },
        capability,
      ),
    },
    label: `process refresh detail fetch (${recordKey(options.row)})`,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
  });

  const rows = Array.isArray(response.body) ? response.body : [];
  const firstRow = rows[0];
  if (!isRecord(firstRow)) {
    throw new CliError(`Process not found for ${recordKey(options.row)}.`, {
      code: 'PROCESS_REFRESH_DETAIL_NOT_FOUND',
      exitCode: 1,
    });
  }

  return {
    id: trimText(firstRow.id) || options.row.id,
    version: trimText(firstRow.version) || options.row.version,
    modified_at: trimText(firstRow.modified_at) || null,
    state_code: typeof firstRow.state_code === 'number' ? firstRow.state_code : null,
    model_id: trimText(firstRow.model_id) || null,
    user_id: trimText(firstRow.user_id) || null,
    json: normalizeDatasetPayload(firstRow.json, recordKey(options.row)),
  };
}

function collectRefs(root: JsonObject): CollectedReference[] {
  const refs: CollectedReference[] = [];
  const visited = new WeakSet<object>();

  const walk = (current: unknown, pathParts: string[]) => {
    if (!isRecord(current) && !Array.isArray(current)) {
      return;
    }
    if (visited.has(current)) {
      return;
    }
    visited.add(current);

    if (
      isRecord(current) &&
      typeof current['@refObjectId'] === 'string' &&
      typeof current['@version'] === 'string' &&
      typeof current['@type'] === 'string' &&
      tableForReferenceType(current['@type'])
    ) {
      refs.push({
        node: current as ReferenceNode,
        path: pathParts.join('.'),
      });
    }

    if (Array.isArray(current)) {
      current.forEach((item, index) => walk(item, [...pathParts, String(index)]));
      return;
    }

    Object.entries(current).forEach(([key, value]) => walk(value, [...pathParts, key]));
  };

  walk(root, []);
  return refs;
}

async function fetchLatestRefs(options: {
  projectBaseUrl: string;
  publishableKey: string;
  accessToken: string;
  refs: CollectedReference[];
  cache: Map<string, LatestReferenceCacheEntry>;
  fetchImpl: FetchLike;
  timeoutMs: number;
  maxRetries: number;
}): Promise<void> {
  const missingByTable = new Map<string, Set<string>>();

  for (const ref of options.refs) {
    const table = tableForReferenceType(ref.node['@type']);
    const id = ref.node['@refObjectId'];
    const cacheKey = table ? `${table}:${id}` : '';
    if (!table || options.cache.has(cacheKey)) {
      continue;
    }
    if (!missingByTable.has(table)) {
      missingByTable.set(table, new Set<string>());
    }
    missingByTable.get(table)?.add(id);
  }

  for (const [table, idSet] of missingByTable.entries()) {
    const ids = Array.from(idSet);
    const capability = resolveDataApiCapability({ kind: 'relation', name: table });
    for (let offset = 0; offset < ids.length; offset += 50) {
      const chunk = ids.slice(offset, offset + 50);
      const url = new URL(
        buildDataApiUrl(deriveSupabaseRestBaseUrl(options.projectBaseUrl), capability),
      );
      url.searchParams.set('select', 'id,version,json,modified_at,state_code,user_id,team_id');
      url.searchParams.set('id', `in.(${chunk.join(',')})`);
      url.searchParams.set('order', 'version.desc');

      try {
        const response = await fetchJsonWithRetry({
          url: url.toString(),
          init: {
            method: 'GET',
            headers: applyDataApiProfileHeaders(
              {
                apikey: options.publishableKey,
                Authorization: `Bearer ${options.accessToken}`,
                Accept: 'application/json',
              },
              capability,
            ),
          },
          label: `reference refresh ${table} lookup`,
          fetchImpl: options.fetchImpl,
          timeoutMs: options.timeoutMs,
          maxRetries: options.maxRetries,
        });

        const rows = Array.isArray(response.body) ? response.body : [];
        const byId = new Map<string, LatestReferenceRow[]>();
        for (const rawRow of rows) {
          if (!isRecord(rawRow)) {
            continue;
          }
          const id = trimText(rawRow.id);
          const version = trimText(rawRow.version);
          if (!id || !version) {
            continue;
          }
          const normalized: LatestReferenceRow = {
            id,
            version,
            json: normalizeDatasetPayload(rawRow.json, `${table}:${id}@${version}`),
            modified_at: trimText(rawRow.modified_at) || null,
            state_code: typeof rawRow.state_code === 'number' ? rawRow.state_code : null,
            user_id: trimText(rawRow.user_id) || null,
            team_id: trimText(rawRow.team_id) || null,
          };
          const existing = byId.get(id) ?? [];
          existing.push(normalized);
          byId.set(id, existing);
        }

        for (const id of chunk) {
          const versions = byId.get(id) ?? [];
          versions.sort((left, right) => compareVersions(right.version, left.version));
          options.cache.set(`${table}:${id}`, {
            row: versions[0] ?? null,
            count: versions.length,
          });
        }
      } catch (error) {
        const message = String(error);
        for (const id of chunk) {
          options.cache.set(`${table}:${id}`, {
            row: null,
            count: 0,
            error: message,
          });
        }
      }
    }
  }
}

function updateProcessJson(
  payload: JsonObject,
  refs: CollectedReference[],
  cache: Map<string, LatestReferenceCacheEntry>,
): UpdateSummary {
  let versionUpdates = 0;
  let descriptionUpdates = 0;
  const touchedRefs: TouchedReference[] = [];
  const unresolvedRefs: UnresolvedReference[] = [];

  for (const ref of refs) {
    const table = tableForReferenceType(ref.node['@type']);
    const cacheKey = table ? `${table}:${ref.node['@refObjectId']}` : '';
    const latest = cacheKey ? cache.get(cacheKey) : null;

    if (!latest?.row) {
      unresolvedRefs.push({
        id: ref.node['@refObjectId'],
        type: ref.node['@type'],
        version: ref.node['@version'],
        reason: latest?.error ?? 'no accessible version',
      });
      continue;
    }

    const currentVersion = ref.node['@version'];
    const latestVersion = latest.row.version;
    const description = getShortDescription(latest.row.json, ref.node['@type']);
    const beforeDescription = JSON.stringify(ref.node['common:shortDescription'] ?? null);
    const afterDescription = description.length ? JSON.stringify(description) : beforeDescription;

    if (compareVersions(latestVersion, currentVersion) > 0) {
      ref.node['@version'] = latestVersion;
      versionUpdates += 1;
    }

    if (description.length && beforeDescription !== afterDescription) {
      ref.node['common:shortDescription'] = description;
      descriptionUpdates += 1;
    }

    if (ref.node['@version'] !== currentVersion || beforeDescription !== afterDescription) {
      touchedRefs.push({
        id: ref.node['@refObjectId'],
        type: ref.node['@type'],
        from_version: currentVersion,
        to_version: ref.node['@version'],
        path: ref.path,
      });
    }
  }

  void payload;
  return {
    version_updates: versionUpdates,
    description_updates: descriptionUpdates,
    touched_refs: touchedRefs,
    unresolved_refs: unresolvedRefs,
  };
}

function appendReportHeader(
  reportFile: string,
  context: {
    mode: 'dry_run' | 'apply';
    generatedAtUtc: string;
    manifestCount: number;
  },
): void {
  if (existsSync(reportFile)) {
    return;
  }
  writeTextArtifact(
    reportFile,
    [
      '# TianGong Process Reference Refresh',
      '',
      `- mode: ${context.mode}`,
      `- generated_at_utc: ${context.generatedAtUtc}`,
      `- manifest_count: ${context.manifestCount}`,
      '',
      '| time | status | key | version updates | description updates | refs | note |',
      '| --- | --- | --- | ---: | ---: | ---: | --- |',
      '',
    ].join('\n'),
  );
}

function appendReportRow(reportFile: string, record: ProgressRecord): void {
  const note = trimText(record.note ?? record.error)
    .replace(/\|/gu, '/')
    .slice(0, 180);
  appendFileSync(
    reportFile,
    `| ${record.time} | ${record.status} | ${record.key} | ${record.version_updates ?? 0} | ${record.description_updates ?? 0} | ${record.ref_count ?? 0} | ${note} |\n`,
    'utf8',
  );
}

async function processOne(options: {
  row: ProcessManifestRow;
  apply: boolean;
  files: ProcessRefreshReferencesReport['files'];
  auth: Awaited<ReturnType<typeof resolveRemoteAuth>>;
  fetchImpl: FetchLike;
  timeoutMs: number;
  maxRetries: number;
  env: NodeJS.ProcessEnv;
  validateProcessPayloadImpl: (payload: JsonObject) => ProcessPayloadValidationResult;
  syncStateAwareProcessRecordImpl: (
    options: SyncStateAwareProcessRecordOptions,
  ) => Promise<ProcessStateAwareWriteResult>;
  refCache: Map<string, LatestReferenceCacheEntry>;
}): Promise<ProgressRecord> {
  const time = new Date().toISOString();
  const key = recordKey(options.row);

  try {
    if (typeof options.row.state_code === 'number' && options.row.state_code >= 20) {
      const record: ProgressRecord = {
        time,
        key,
        status: 'skipped',
        note: `state_code=${options.row.state_code}`,
      };
      writeJsonLinesArtifact(options.files.progress_jsonl, record, { append: true });
      appendReportRow(options.files.report_md, record);
      return record;
    }

    const detail = await fetchProcessDetail({
      projectBaseUrl: options.auth.projectBaseUrl,
      publishableKey: options.auth.publishableKey,
      accessToken: options.auth.accessToken,
      row: options.row,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
    });
    const payload = JSON.parse(JSON.stringify(detail.json)) as JsonObject;
    const refs = collectRefs(payload);

    await fetchLatestRefs({
      projectBaseUrl: options.auth.projectBaseUrl,
      publishableKey: options.auth.publishableKey,
      accessToken: options.auth.accessToken,
      refs,
      cache: options.refCache,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
    });

    const update = updateProcessJson(payload, refs, options.refCache);
    const validation = options.validateProcessPayloadImpl(payload);

    if (!validation.ok || update.unresolved_refs.length > 0) {
      const noteParts: string[] = [];
      if (!validation.ok) {
        noteParts.push(`schema_issue_count=${validation.issue_count}`);
      }
      if (update.unresolved_refs.length > 0) {
        noteParts.push(`unresolved_refs=${update.unresolved_refs.length}`);
      }

      const record: ProgressRecord = {
        time,
        key,
        id: options.row.id,
        version: options.row.version,
        status: 'validation_blocked',
        ref_count: refs.length,
        version_updates: update.version_updates,
        description_updates: update.description_updates,
        unresolved_count: update.unresolved_refs.length,
        changed_ref_count: update.touched_refs.length,
        schema_validator: validation.validator,
        schema_issue_count: validation.issue_count,
        schema_issues: validation.issues.slice(0, 20),
        touched_refs: update.touched_refs.slice(0, 50),
        unresolved_refs: update.unresolved_refs.slice(0, 50),
        note: noteParts.join('; '),
      };
      writeJsonLinesArtifact(options.files.validation_blockers_jsonl, record, { append: true });
      writeJsonLinesArtifact(options.files.progress_jsonl, record, { append: true });
      appendReportRow(options.files.report_md, record);
      return record;
    }

    let writeResult: ProcessStateAwareWriteResult | null = null;
    if (options.apply) {
      writeResult = await options.syncStateAwareProcessRecordImpl({
        id: detail.id,
        version: detail.version,
        payload,
        env: options.env,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
        audit: {
          command: 'process_refresh_references',
          source: 'tiangong-lca process refresh-references',
        },
        modelId: detail.model_id,
      });
    }

    const record: ProgressRecord = {
      time,
      key,
      id: options.row.id,
      version: options.row.version,
      status: options.apply ? 'saved' : 'dry_run',
      ref_count: refs.length,
      version_updates: update.version_updates,
      description_updates: update.description_updates,
      unresolved_count: update.unresolved_refs.length,
      changed_ref_count: update.touched_refs.length,
      schema_validator: validation.validator,
      schema_issue_count: validation.issue_count,
      touched_refs: update.touched_refs.slice(0, 50),
      unresolved_refs: update.unresolved_refs.slice(0, 50),
      write_path:
        writeResult && 'write_path' in writeResult ? (writeResult.write_path as string) : undefined,
      write_operation: writeResult?.operation,
    };
    writeJsonLinesArtifact(options.files.progress_jsonl, record, { append: true });
    appendReportRow(options.files.report_md, record);
    return record;
  } catch (error) {
    const record: ProgressRecord = {
      time,
      key,
      id: options.row.id,
      version: options.row.version,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
    writeJsonLinesArtifact(options.files.errors_jsonl, record, { append: true });
    writeJsonLinesArtifact(options.files.progress_jsonl, record, { append: true });
    appendReportRow(options.files.report_md, record);
    return record;
  }
}

async function workerPool<T, TResult>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  let cursor = 0;
  const results: TResult[] = [];

  async function runWorker() {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await worker(items[currentIndex] as T, currentIndex);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  return results;
}

export async function runProcessRefreshReferences(
  options: RunProcessRefreshReferencesOptions,
): Promise<ProcessRefreshReferencesReport> {
  const outDir = path.resolve(
    requiredNonEmpty(options.outDir, '--out-dir', 'PROCESS_REFRESH_OUT_DIR_REQUIRED'),
  );
  const apply = Boolean(options.apply);
  const reuseManifest = Boolean(options.reuseManifest);
  const limit = toOptionalPositiveInteger(
    options.limit ?? null,
    '--limit',
    'PROCESS_REFRESH_LIMIT_INVALID',
  );
  const pageSize = toPositiveInteger(
    options.pageSize ?? DEFAULT_PAGE_SIZE,
    '--page-size',
    'PROCESS_REFRESH_PAGE_SIZE_INVALID',
    MAX_PAGE_SIZE,
  );
  const concurrency = toPositiveInteger(
    options.concurrency ?? DEFAULT_CONCURRENCY,
    '--concurrency',
    'PROCESS_REFRESH_CONCURRENCY_INVALID',
    MAX_CONCURRENCY,
  );
  const timeoutMs = toPositiveInteger(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    'timeout',
    'PROCESS_REFRESH_TIMEOUT_INVALID',
  );
  const maxRetries = toPositiveInteger(
    options.maxRetries ?? DEFAULT_MAX_RETRIES,
    'retry count',
    'PROCESS_REFRESH_MAX_RETRIES_INVALID',
  );
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? (fetch as FetchLike);
  const generatedAtUtc = nowIso(options.now);
  const validateProcessPayloadImpl = options.validateProcessPayloadImpl ?? validateProcessPayload;
  const syncStateAwareProcessRecordImpl =
    options.syncStateAwareProcessRecordImpl ?? syncStateAwareProcessRecord;

  mkdirSync(outDir, { recursive: true });

  const files: ProcessRefreshReferencesReport['files'] = {
    manifest: path.join(outDir, 'inputs', 'processes.manifest.json'),
    progress_jsonl: path.join(outDir, 'outputs', 'progress.jsonl'),
    errors_jsonl: path.join(outDir, 'outputs', 'errors.jsonl'),
    validation_blockers_jsonl: path.join(outDir, 'outputs', 'validation-blockers.jsonl'),
    summary_json: path.join(outDir, 'outputs', 'summary.json'),
    report_md: path.join(outDir, 'reports', 'process-refresh-references.md'),
  };

  const auth = await resolveRemoteAuth({
    env,
    fetchImpl,
    timeoutMs,
    now: options.now ?? new Date(),
    maxRetries,
  });

  let manifest = readManifest(files.manifest);
  if (!manifest || !reuseManifest) {
    const rows = await snapshotProcesses({
      projectBaseUrl: auth.projectBaseUrl,
      publishableKey: auth.publishableKey,
      accessToken: auth.accessToken,
      userId: auth.userId,
      pageSize,
      fetchImpl,
      timeoutMs,
      maxRetries,
    });
    manifest = {
      schema_version: 1,
      generated_at_utc: generatedAtUtc,
      user_id: auth.userId,
      masked_user_email: auth.maskedUserEmail,
      source: 'current_user_processes',
      order: 'modified_at.desc,id.asc',
      page_size: pageSize,
      count: rows.length,
      rows,
    };
    writeJsonArtifact(files.manifest, manifest);
  }

  appendReportHeader(files.report_md, {
    mode: apply ? 'apply' : 'dry_run',
    generatedAtUtc,
    manifestCount: manifest.rows.length,
  });

  const completed = readCompleted(files.progress_jsonl, apply);
  const selectedRows = manifest.rows.slice(0, limit ?? manifest.rows.length);
  const pendingRows = selectedRows.filter((row) => !completed.has(recordKey(row)));
  const refCache = new Map<string, LatestReferenceCacheEntry>();
  const counts = {
    manifest: manifest.rows.length,
    selected: selectedRows.length,
    already_completed: selectedRows.length - pendingRows.length,
    pending: pendingRows.length,
    saved: 0,
    dry_run: 0,
    skipped: 0,
    validation_blocked: 0,
    errors: 0,
  };

  const results = await workerPool(pendingRows, concurrency, (row) =>
    processOne({
      row,
      apply,
      files,
      auth,
      fetchImpl,
      timeoutMs,
      maxRetries,
      env,
      validateProcessPayloadImpl,
      syncStateAwareProcessRecordImpl,
      refCache,
    }),
  );

  for (const record of results) {
    if (record.status === 'saved') {
      counts.saved += 1;
    } else if (record.status === 'dry_run') {
      counts.dry_run += 1;
    } else if (record.status === 'skipped') {
      counts.skipped += 1;
    } else if (record.status === 'validation_blocked') {
      counts.validation_blocked += 1;
    } else if (record.status === 'error') {
      counts.errors += 1;
    }
  }

  const report: ProcessRefreshReferencesReport = {
    schema_version: 1,
    generated_at_utc: generatedAtUtc,
    status:
      counts.errors > 0
        ? 'completed_process_reference_refresh_with_errors'
        : 'completed_process_reference_refresh',
    out_dir: outDir,
    mode: apply ? 'apply' : 'dry_run',
    user_id: manifest.user_id,
    masked_user_email: manifest.masked_user_email,
    counts,
    files,
  };

  writeJsonArtifact(files.summary_json, report);
  appendFileSync(
    files.report_md,
    `\n## Summary\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`,
    'utf8',
  );

  return report;
}

export const __testInternals = {
  appendReportHeader,
  collectRefs,
  compareVersions,
  fetchLatestRefs,
  fetchJsonWithRetry,
  genFlowName,
  genFlowNameJson,
  genProcessName,
  genProcessNameJson,
  getLangList,
  getLangText,
  getShortDescription,
  normalizeReferenceType,
  normalizeDatasetPayload,
  normalizeManifestRow,
  parseJsonResponse,
  parseContentRangeTotal,
  readCompleted,
  readManifest,
  recordKey,
  tableForReferenceType,
  updateProcessJson,
};
