// data-api-relations: lifecyclemodels, processes
import path from 'node:path';
import { writeJsonArtifact } from './artifacts.js';
import { CliError } from './errors.js';
import type { FetchLike, ResponseLike } from './http.js';
import { readJsonInput } from './io.js';
import { getRuntimeRuleset, resolveRuntimeRuleId } from './runtime-rulesets.js';
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

type JsonRecord = Record<string, unknown>;
type ProcessGroupId = string | number;

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_PAGE_SIZE = 100;

type ExchangeSummaryRow = {
  exchange_internal_id: string;
  flow_id: string;
  flow_version: string;
  direction: string;
  mean_amount: string;
  resulting_amount: string;
  flow_short_description_en: string;
  flow_short_description_zh: string;
};

type DedupInputProcess = {
  process_id: string;
  version: string;
  name_en: string;
  name_zh: string;
  exchange_count: number | null;
  overview_fingerprint: string;
  sheet_exchange_rows: ExchangeSummaryRow[];
};

type DedupInputGroup = {
  group_id: ProcessGroupId;
  processes: DedupInputProcess[];
};

type RemoteMetadataRecord = {
  process_id: string;
  version: string;
  state_code: number | null;
  created_at: string | null;
  modified_at: string | null;
  user_id: string | null;
  team_id: string | null;
  model_id: string | null;
  remote_name_en: string;
  remote_name_zh: string;
  remote_exchanges: ExchangeSummaryRow[];
};

type ReferenceHitRecord = {
  id: string;
  version: string;
  state_code: number | null;
  model_id?: string | null;
};

type ReferenceHits = {
  processes: Record<string, ReferenceHitRecord[]>;
  lifecyclemodels: Record<string, ReferenceHitRecord[]>;
};

type RemoteStatus = {
  enabled: boolean;
  loaded: number;
  error: string | null;
  reference_scan:
    | 'not_run'
    | 'skipped_by_flag'
    | 'skipped_missing_user_id'
    | 'current_user_completed'
    | 'failed';
};

type ProcessDedupGate = {
  status: 'passed' | 'blocked';
  ruleset_id: 'process-dedup/default';
  ruleset_version: '1';
  ruleset_source_version: string;
  ruleset_rule_ids: string[];
  counts: {
    duplicate_groups: number;
    blocker_groups: number;
  };
  blockers: Array<{
    group_id: ProcessGroupId;
    code: 'process_exact_duplicate_fingerprint';
    methodology_rule_id: string | null;
    severity: 'blocker';
    message: string;
  }>;
  next_action: 'continue' | 'resolve_duplicate_processes';
};

type DedupAnalyzedProcess = DedupInputProcess &
  Partial<RemoteMetadataRecord> & {
    analysis_exchanges: ExchangeSummaryRow[];
    normalized_exchange_signature: Array<[string, string, string, string]>;
    name_score: number;
    name_score_reasons: string[];
  };

export type ProcessDedupReviewGroup = {
  group_id: ProcessGroupId;
  group_pattern: string;
  exact_duplicate: boolean;
  rule_id?: 'process_exact_duplicate_fingerprint';
  methodology_rule_id?: string | null;
  severity?: 'blocker';
  blocker?: boolean;
  processes: DedupAnalyzedProcess[];
};

type DeletePlanGroup = {
  group_id: ProcessGroupId;
  status: 'priority_delete_candidates';
  confidence: 'high' | 'medium' | 'low';
  current_user_reference_hits: {
    keep_process_refs: number;
    keep_lifecyclemodel_refs: number;
    delete_refs: Record<
      string,
      {
        process_refs: number;
        lifecyclemodel_refs: number;
      }
    >;
  };
  keep: {
    process_id: string;
    name_en: string;
    name_zh: string;
    score: number;
    reasons: string[];
  };
  delete: Array<{
    process_id: string;
    name_en: string;
    name_zh: string;
    score: number;
    reasons: string[];
  }>;
  notes: string[];
};

type RemoteAuthContext = {
  projectBaseUrl: string;
  publishableKey: string;
  accessToken: string;
  userId: string | null;
};

export type RunProcessDedupReviewOptions = {
  inputPath: string;
  outDir: string;
  skipRemote?: boolean;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxRetries?: number;
  now?: Date;
};

export type ProcessDedupReviewReport = {
  schema_version: 1;
  generated_at_utc: string;
  status: 'completed_process_dedup_review';
  input_file: string;
  out_dir: string;
  source_label: string;
  group_count: number;
  exact_duplicate_group_count: number;
  ruleset_id?: 'process-dedup/default';
  ruleset_version?: '1';
  ruleset_source_version?: string;
  ruleset_rule_ids?: string[];
  gate?: ProcessDedupGate;
  remote_status: RemoteStatus;
  files: {
    input_manifest: string;
    remote_metadata: string | null;
    duplicate_groups: string;
    delete_plan: string;
    current_user_reference_scan: string | null;
  };
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nowIso(now: Date = new Date()): string {
  return now.toISOString();
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

function toPositiveInteger(value: number | undefined, label: string, code: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new CliError(`Expected ${label} to be a positive integer.`, {
      code,
      exitCode: 2,
    });
  }
  return value as number;
}

function normalizeOptionalToken(value: unknown): string | null {
  const normalized = trimText(value);
  return normalized ? normalized : null;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null || value === undefined || value === '') {
    return [];
  }
  return [value];
}

function toGroupId(value: unknown, fallback: string): ProcessGroupId {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const normalized = trimText(value);
  if (!normalized) {
    return fallback;
  }
  if (/^\d+$/u.test(normalized)) {
    return Number.parseInt(normalized, 10);
  }
  return normalized;
}

function normalizeExchangeCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const normalized = trimText(value);
  if (!normalized) {
    return null;
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function normalizeAmount(value: unknown): string {
  const normalized = trimText(value);
  if (!normalized) {
    return '';
  }
  if (/^[+-]?\d+(?:\.\d+)?$/u.test(normalized)) {
    let result = normalized.replace(/^\+/u, '');
    result = result.replace(/^(-?)0+(?=\d)/u, '$1');
    if (result.includes('.')) {
      result = result.replace(/0+$/u, '').replace(/\.$/u, '');
    }
    if (result === '' || result === '-' || result === '-0') {
      return '0';
    }
    return result;
  }
  const parsed = Number(normalized);
  if (Number.isFinite(parsed)) {
    return parsed.toString();
  }
  return normalized;
}

function getLangList(value: unknown): JsonRecord[] {
  if (value === null || value === undefined || value === '') {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is JsonRecord => isRecord(entry));
  }
  if (isRecord(value)) {
    const langString = value['common:langString'];
    if (Array.isArray(langString)) {
      return langString.filter((entry): entry is JsonRecord => isRecord(entry));
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

function getLangText(value: unknown, lang: string): string {
  const entries = getLangList(value);
  for (const entry of entries) {
    if (
      trimText(entry['@xml:lang']).toLowerCase() === lang.toLowerCase() &&
      trimText(entry['#text'])
    ) {
      return trimText(entry['#text']);
    }
  }
  for (const entry of entries) {
    if (trimText(entry['#text'])) {
      return trimText(entry['#text']);
    }
  }
  return '';
}

function normalizeExchangeSummaryRow(value: unknown): ExchangeSummaryRow | null {
  if (!isRecord(value)) {
    return null;
  }

  const flowRef = isRecord(value.referenceToFlowDataSet) ? value.referenceToFlowDataSet : {};
  const flowShortDescription = value.flow_short_description ?? flowRef['common:shortDescription'];

  const normalized: ExchangeSummaryRow = {
    exchange_internal_id: trimText(value.exchange_internal_id ?? value['@dataSetInternalID']),
    flow_id: trimText(value.flow_id ?? flowRef['@refObjectId']),
    flow_version: trimText(value.flow_version ?? flowRef['@version']),
    direction: trimText(value.direction ?? value.exchangeDirection),
    mean_amount: trimText(value.mean_amount ?? value.meanAmount),
    resulting_amount: trimText(value.resulting_amount ?? value.resultingAmount),
    flow_short_description_en:
      trimText(value.flow_short_description_en) || getLangText(flowShortDescription, 'en'),
    flow_short_description_zh:
      trimText(value.flow_short_description_zh) || getLangText(flowShortDescription, 'zh'),
  };

  if (
    !normalized.exchange_internal_id &&
    !normalized.flow_id &&
    !normalized.direction &&
    !normalized.mean_amount &&
    !normalized.resulting_amount
  ) {
    return null;
  }

  return normalized;
}

function normalizeExchangeRows(value: unknown): ExchangeSummaryRow[] {
  return asArray(value)
    .map((entry) => normalizeExchangeSummaryRow(entry))
    .filter((entry): entry is ExchangeSummaryRow => entry !== null);
}

function normalizeInputProcess(value: unknown): DedupInputProcess {
  if (!isRecord(value)) {
    throw new CliError('Each process dedup candidate must be a JSON object.', {
      code: 'PROCESS_DEDUP_INPUT_INVALID_PROCESS',
      exitCode: 2,
    });
  }

  const processId = requiredNonEmpty(
    trimText(value.process_id ?? value.id),
    'process_id',
    'PROCESS_DEDUP_PROCESS_ID_REQUIRED',
  );

  return {
    process_id: processId,
    version: trimText(value.version),
    name_en: trimText(value.name_en ?? value.remote_name_en),
    name_zh: trimText(value.name_zh ?? value.remote_name_zh),
    exchange_count: normalizeExchangeCount(value.exchange_count),
    overview_fingerprint: trimText(value.overview_fingerprint),
    sheet_exchange_rows: normalizeExchangeRows(
      value.sheet_exchange_rows ??
        value.analysis_exchanges ??
        value.remote_exchanges ??
        value.exchanges,
    ),
  };
}

function normalizeInputGroup(
  value: unknown,
  fallbackGroupId: string,
  index: number,
): DedupInputGroup {
  if (!isRecord(value)) {
    throw new CliError('Each process dedup group must be a JSON object.', {
      code: 'PROCESS_DEDUP_INPUT_INVALID_GROUP',
      exitCode: 2,
    });
  }

  const processes = asArray(value.processes).map((entry) => normalizeInputProcess(entry));
  if (processes.length === 0) {
    throw new CliError(`Process dedup group ${index + 1} is missing processes.`, {
      code: 'PROCESS_DEDUP_GROUP_PROCESSES_REQUIRED',
      exitCode: 2,
    });
  }

  return {
    group_id: toGroupId(value.group_id, fallbackGroupId),
    processes,
  };
}

function normalizeInputDocument(
  value: unknown,
  resolvedInputPath: string,
): {
  sourceLabel: string;
  groups: DedupInputGroup[];
} {
  if (!isRecord(value)) {
    throw new CliError('Process dedup review input must be a JSON object.', {
      code: 'PROCESS_DEDUP_INPUT_INVALID',
      exitCode: 2,
    });
  }

  const sourceLabel =
    trimText(value.source_label ?? value.source_workbook ?? value.source_file) ||
    path.basename(resolvedInputPath);
  const rawGroups = value.groups;
  let groups: DedupInputGroup[] = [];

  if (Array.isArray(rawGroups)) {
    groups = rawGroups.map((entry, index) => normalizeInputGroup(entry, String(index + 1), index));
  } else if (isRecord(rawGroups)) {
    groups = Object.entries(rawGroups).map(([groupId, entry], index) =>
      normalizeInputGroup(entry, groupId, index),
    );
  }

  if (groups.length === 0) {
    throw new CliError('Process dedup review input must contain at least one group.', {
      code: 'PROCESS_DEDUP_GROUPS_REQUIRED',
      exitCode: 2,
    });
  }

  return {
    sourceLabel,
    groups,
  };
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
      code: 'PROCESS_DEDUP_REMOTE_INVALID_JSON',
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
          code: 'PROCESS_DEDUP_REMOTE_REQUEST_FAILED',
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
    code: 'PROCESS_DEDUP_REMOTE_REQUEST_FAILED',
    exitCode: 1,
    details: String(lastError),
  });
}

async function fetchCurrentUserId(options: {
  projectBaseUrl: string;
  publishableKey: string;
  accessToken: string;
  fetchImpl: FetchLike;
  timeoutMs: number;
  maxRetries: number;
}): Promise<string | null> {
  const response = await fetchJsonWithRetry({
    url: `${options.projectBaseUrl}/auth/v1/user`,
    init: {
      method: 'GET',
      headers: {
        apikey: options.publishableKey,
        Authorization: `Bearer ${options.accessToken}`,
        Accept: 'application/json',
      },
    },
    label: 'supabase current-user lookup',
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
  });

  if (!isRecord(response.body)) {
    return null;
  }
  return normalizeOptionalToken(response.body.id);
}

async function resolveRemoteAuthContext(options: {
  env: NodeJS.ProcessEnv;
  fetchImpl: FetchLike;
  timeoutMs: number;
  maxRetries: number;
  now: Date;
}): Promise<RemoteAuthContext> {
  const runtime = requireSupabaseRestRuntime(options.env);
  const session = await resolveSupabaseUserSession({
    runtime,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    now: options.now,
  });
  const projectBaseUrl = deriveSupabaseProjectBaseUrl(runtime.apiBaseUrl);

  let userId: string | null;
  try {
    userId = await fetchCurrentUserId({
      projectBaseUrl,
      publishableKey: runtime.publishableKey,
      accessToken: session.accessToken,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
    });
  } catch {
    userId = null;
  }

  return {
    projectBaseUrl,
    publishableKey: runtime.publishableKey,
    accessToken: session.accessToken,
    userId,
  };
}

function summarizeRemoteExchanges(processJson: unknown): ExchangeSummaryRow[] {
  if (!isRecord(processJson)) {
    return [];
  }
  const processDataSet = isRecord(processJson.processDataSet) ? processJson.processDataSet : {};
  const exchanges = isRecord(processDataSet.exchanges) ? processDataSet.exchanges.exchange : [];
  return normalizeExchangeRows(exchanges);
}

async function fetchRemoteMetadata(options: {
  processIds: string[];
  auth: RemoteAuthContext;
  fetchImpl: FetchLike;
  timeoutMs: number;
  maxRetries: number;
}): Promise<Record<string, RemoteMetadataRecord>> {
  if (options.processIds.length === 0) {
    return {};
  }

  const capability = resolveDataApiCapability({ kind: 'relation', name: 'processes' });
  const url = new URL(
    buildDataApiUrl(deriveSupabaseRestBaseUrl(options.auth.projectBaseUrl), capability),
  );
  url.searchParams.set(
    'select',
    'id,version,state_code,created_at,modified_at,user_id,team_id,model_id,json',
  );
  url.searchParams.set('id', `in.(${options.processIds.join(',')})`);
  url.searchParams.set('order', 'id.asc');

  const response = await fetchJsonWithRetry({
    url: url.toString(),
    init: {
      method: 'GET',
      headers: applyDataApiProfileHeaders(
        {
          apikey: options.auth.publishableKey,
          Authorization: `Bearer ${options.auth.accessToken}`,
          Accept: 'application/json',
        },
        capability,
      ),
    },
    label: 'process dedup remote metadata fetch',
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
  });

  const rows = Array.isArray(response.body) ? response.body : [];
  const byId: Record<string, RemoteMetadataRecord> = {};

  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const processId = trimText(row.id);
    if (!processId) {
      continue;
    }
    const payload = row.json;
    const processDataSet =
      isRecord(payload) && isRecord(payload.processDataSet) ? payload.processDataSet : {};
    const processInformation = isRecord(processDataSet.processInformation)
      ? processDataSet.processInformation
      : {};
    const dataSetInformation = isRecord(processInformation.dataSetInformation)
      ? processInformation.dataSetInformation
      : {};
    const name = isRecord(dataSetInformation.name) ? dataSetInformation.name : {};

    byId[processId] = {
      process_id: processId,
      version: trimText(row.version),
      state_code: typeof row.state_code === 'number' ? row.state_code : null,
      created_at: normalizeOptionalToken(row.created_at),
      modified_at: normalizeOptionalToken(row.modified_at),
      user_id: normalizeOptionalToken(row.user_id),
      team_id: normalizeOptionalToken(row.team_id),
      model_id: normalizeOptionalToken(row.model_id),
      remote_name_en: getLangText(name.baseName, 'en'),
      remote_name_zh: getLangText(name.baseName, 'zh'),
      remote_exchanges: summarizeRemoteExchanges(payload),
    };
  }

  return byId;
}

async function fetchCurrentUserRows(options: {
  auth: RemoteAuthContext;
  tableName: 'processes' | 'lifecyclemodels';
  userId: string;
  select: string;
  fetchImpl: FetchLike;
  timeoutMs: number;
  maxRetries: number;
}): Promise<unknown[]> {
  const rows: unknown[] = [];
  let offset = 0;
  let total: number | null = null;

  while (total === null || offset < total) {
    const capability = resolveDataApiCapability({
      kind: 'relation',
      name: options.tableName,
    });
    const url = new URL(
      buildDataApiUrl(deriveSupabaseRestBaseUrl(options.auth.projectBaseUrl), capability),
    );
    url.searchParams.set('select', options.select);
    url.searchParams.set('user_id', `eq.${options.userId}`);
    url.searchParams.set('order', 'id.asc');
    url.searchParams.set('limit', String(DEFAULT_PAGE_SIZE));
    url.searchParams.set('offset', String(offset));

    const page = await fetchJsonWithRetry({
      url: url.toString(),
      init: {
        method: 'GET',
        headers: applyDataApiProfileHeaders(
          {
            apikey: options.auth.publishableKey,
            Authorization: `Bearer ${options.auth.accessToken}`,
            Accept: 'application/json',
            Prefer: total === null ? 'count=exact' : 'count=planned',
          },
          capability,
        ),
      },
      label: `${options.tableName} current-user reference scan`,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
    });

    const pageRows = Array.isArray(page.body) ? page.body : [];
    rows.push(...pageRows);

    if (total === null) {
      const contentRange = page.headers.get('content-range');
      const match = contentRange ? contentRange.match(/\/(\d+)$/u) : null;
      total = match ? Number.parseInt(match[1], 10) : rows.length;
    }

    if (pageRows.length === 0) {
      break;
    }
    offset += DEFAULT_PAGE_SIZE;
  }

  return rows;
}

function collectReferenceHits(root: unknown, targetIds: Set<string>): string[] {
  const hits: string[] = [];
  const visited = new Set<object>();

  const walk = (value: unknown): void => {
    if (value === null || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {
      if (visited.has(value)) {
        return;
      }
      visited.add(value);
      value.forEach((entry) => walk(entry));
      return;
    }

    if (!isRecord(value)) {
      return;
    }

    if (visited.has(value)) {
      return;
    }
    visited.add(value);

    const refObjectId = trimText(value['@refObjectId']);
    if (refObjectId && targetIds.has(refObjectId)) {
      hits.push(refObjectId);
    }

    Object.values(value).forEach((entry) => walk(entry));
  };

  walk(root);
  return hits;
}

function buildEmptyReferenceHits(processIds: string[]): ReferenceHits {
  return {
    processes: Object.fromEntries(processIds.map((processId) => [processId, []])),
    lifecyclemodels: Object.fromEntries(processIds.map((processId) => [processId, []])),
  };
}

async function fetchCurrentUserReferenceHits(options: {
  auth: RemoteAuthContext;
  userId: string;
  targetProcessIds: string[];
  fetchImpl: FetchLike;
  timeoutMs: number;
  maxRetries: number;
}): Promise<ReferenceHits> {
  const targetIds = new Set(options.targetProcessIds);
  const results = buildEmptyReferenceHits(options.targetProcessIds);

  const processRows = await fetchCurrentUserRows({
    auth: options.auth,
    tableName: 'processes',
    userId: options.userId,
    select: 'id,version,state_code,user_id,model_id,json',
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
  });

  for (const row of processRows) {
    if (!isRecord(row)) {
      continue;
    }
    const rowId = trimText(row.id);
    const hits = collectReferenceHits(row.json, targetIds);
    for (const hit of hits) {
      if (rowId === hit) {
        continue;
      }
      results.processes[hit]?.push({
        id: rowId,
        version: trimText(row.version),
        state_code: typeof row.state_code === 'number' ? row.state_code : null,
        model_id: normalizeOptionalToken(row.model_id),
      });
    }
  }

  const lifecyclemodelRows = await fetchCurrentUserRows({
    auth: options.auth,
    tableName: 'lifecyclemodels',
    userId: options.userId,
    select: 'id,version,state_code,user_id,json',
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
  });

  for (const row of lifecyclemodelRows) {
    if (!isRecord(row)) {
      continue;
    }
    const hits = collectReferenceHits(row.json, targetIds);
    for (const hit of hits) {
      results.lifecyclemodels[hit]?.push({
        id: trimText(row.id),
        version: trimText(row.version),
        state_code: typeof row.state_code === 'number' ? row.state_code : null,
      });
    }
  }

  return results;
}

function normalizedSignature(
  exchanges: ExchangeSummaryRow[],
): Array<[string, string, string, string]> {
  return [...exchanges]
    .map(
      (exchange) =>
        [
          trimText(exchange.flow_id),
          trimText(exchange.direction),
          normalizeAmount(exchange.mean_amount),
          normalizeAmount(exchange.resulting_amount),
        ] as [string, string, string, string],
    )
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function normalizedSignatureKey(exchanges: ExchangeSummaryRow[]): string {
  return JSON.stringify(normalizedSignature(exchanges));
}

function detectGroupPattern(processes: DedupAnalyzedProcess[]): string {
  const sample = processes.find(
    (process) => process.analysis_exchanges.length > 0,
  )?.analysis_exchanges;
  if (!sample || sample.length === 0) {
    return 'unknown';
  }

  const inputExchanges = sample.filter(
    (exchange) => trimText(exchange.direction).toLowerCase() === 'input',
  );
  const outputExchanges = sample.filter(
    (exchange) => trimText(exchange.direction).toLowerCase() === 'output',
  );
  const inputFlowIds = new Set(
    inputExchanges.map((exchange) => trimText(exchange.flow_id)).filter(Boolean),
  );
  const outputFlowIds = new Set(
    outputExchanges.map((exchange) => trimText(exchange.flow_id)).filter(Boolean),
  );

  const hasTransportInput = inputExchanges.some((exchange) => {
    const en = trimText(exchange.flow_short_description_en).toLowerCase();
    const zh = trimText(exchange.flow_short_description_zh);
    return en.includes('transport;') || zh.includes('运输;');
  });

  if (outputFlowIds.size > 0 && [...outputFlowIds].every((flowId) => inputFlowIds.has(flowId))) {
    return hasTransportInput ? 'transport_pass_through' : 'same_flow_pass_through';
  }
  return 'other';
}

function scoreProcessName(
  process: Pick<DedupAnalyzedProcess, 'name_en' | 'name_zh' | 'remote_name_en' | 'remote_name_zh'>,
  groupPattern: string,
): { score: number; reasons: string[] } {
  const nameEn = trimText(process.remote_name_en ?? process.name_en);
  const nameZh = trimText(process.remote_name_zh ?? process.name_zh);
  const lowerEn = nameEn.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  if (groupPattern === 'transport_pass_through') {
    if (lowerEn.includes('transport') || nameZh.includes('运输')) {
      score += 30;
      reasons.push('name matches explicit transport-service input');
    }
    if (lowerEn.includes('logistics') || nameZh.includes('物流')) {
      score -= 10;
      reasons.push('name is broader than the observed transport-service input');
    }
  }

  if (groupPattern === 'same_flow_pass_through') {
    if (lowerEn.includes('processing') || nameZh.includes('加工')) {
      score -= 20;
      reasons.push('same-flow pass-through does not support a processing label');
    }
    if (lowerEn.includes('reception') || nameZh.includes('接收')) {
      score += 20;
      reasons.push('reception matches same-flow intake/output handling');
    }
  }

  if (lowerEn.includes('collection') || nameZh.includes('收集')) {
    score += 20;
    reasons.push('collection is semantically consistent with a gather/sort process');
  }
  if (lowerEn.includes('wastepaper')) {
    score -= 5;
    reasons.push("compressed English form is less standardized than 'waste paper'");
  }
  if (lowerEn.includes('waste paper')) {
    score += 3;
    reasons.push('English wording is standardized');
  }
  if (nameEn.includes('/') || nameZh.includes('/')) {
    score += 5;
    reasons.push('name keeps the broader material scope explicit');
  }

  return { score, reasons };
}

function createdAtKey(process: Pick<DedupAnalyzedProcess, 'created_at'>): string {
  return trimText(process.created_at) || '9999-12-31T23:59:59+00:00';
}

function compareGroupIds(left: ProcessGroupId, right: ProcessGroupId): number {
  return String(left).localeCompare(String(right), 'en', { numeric: true });
}

function analyzeGroups(
  groups: DedupInputGroup[],
  remoteById: Record<string, RemoteMetadataRecord>,
  referenceHits: ReferenceHits,
): {
  duplicateGroups: ProcessDedupReviewGroup[];
  deletePlanGroups: DeletePlanGroup[];
} {
  const duplicateGroups: ProcessDedupReviewGroup[] = [];
  const deletePlanGroups: DeletePlanGroup[] = [];

  for (const group of [...groups].sort((left, right) =>
    compareGroupIds(left.group_id, right.group_id),
  )) {
    const processes: DedupAnalyzedProcess[] = group.processes.map((process) => {
      const remote = remoteById[process.process_id];
      const analysisExchanges =
        remote && remote.remote_exchanges.length > 0
          ? remote.remote_exchanges
          : process.sheet_exchange_rows;
      const initialScore = scoreProcessName(
        {
          name_en: process.name_en,
          name_zh: process.name_zh,
          remote_name_en: remote?.remote_name_en,
          remote_name_zh: remote?.remote_name_zh,
        },
        'unknown',
      );

      return {
        ...process,
        ...remote,
        analysis_exchanges: analysisExchanges,
        normalized_exchange_signature: normalizedSignature(analysisExchanges),
        name_score: initialScore.score,
        name_score_reasons: initialScore.reasons,
      };
    });

    const exactDuplicate =
      processes.length > 1 &&
      new Set(processes.map((process) => normalizedSignatureKey(process.analysis_exchanges)))
        .size === 1;
    const groupPattern = detectGroupPattern(processes);

    for (const process of processes) {
      const rescored = scoreProcessName(process, groupPattern);
      process.name_score = rescored.score;
      process.name_score_reasons = rescored.reasons;
    }

    const sortedProcesses = [...processes].sort(
      (left, right) =>
        right.name_score - left.name_score ||
        createdAtKey(left).localeCompare(createdAtKey(right)) ||
        left.process_id.localeCompare(right.process_id),
    );

    duplicateGroups.push({
      group_id: group.group_id,
      group_pattern: groupPattern,
      exact_duplicate: exactDuplicate,
      ...(exactDuplicate
        ? {
            rule_id: 'process_exact_duplicate_fingerprint' as const,
            methodology_rule_id: resolveRuntimeRuleId(
              'process-dedup/default',
              'process_exact_duplicate_fingerprint',
            ),
            severity: 'blocker' as const,
            blocker: true,
          }
        : {}),
      processes,
    });

    if (!exactDuplicate) {
      continue;
    }

    const keep = sortedProcesses[0] as DedupAnalyzedProcess;
    const deleteCandidates = sortedProcesses.slice(1);
    const scoreGap = keep.name_score - deleteCandidates[0]!.name_score;
    const confidence: 'high' | 'medium' | 'low' = scoreGap >= 15 ? 'high' : 'medium';

    const keepProcessRefs = referenceHits.processes[keep.process_id]!;
    const keepLifecyclemodelRefs = referenceHits.lifecyclemodels[keep.process_id]!;
    const deleteRefs = Object.fromEntries(
      deleteCandidates.map((candidate) => [
        candidate.process_id,
        {
          process_refs: referenceHits.processes[candidate.process_id]!.length,
          lifecyclemodel_refs: referenceHits.lifecyclemodels[candidate.process_id]!.length,
        },
      ]),
    );

    const notes = ['exact duplicate confirmed by normalized exchange signature'];
    if (
      Object.values(deleteRefs).every(
        (entry) => entry.process_refs === 0 && entry.lifecyclemodel_refs === 0,
      )
    ) {
      notes.push('current-user reference scan found no downstream hits for delete candidates');
    } else {
      notes.push(
        'current-user reference scan found downstream hits; delete requires reference cleanup',
      );
    }
    notes.push('global or shared-team reference verification is outside this command');

    deletePlanGroups.push({
      group_id: group.group_id,
      status: 'priority_delete_candidates',
      confidence,
      current_user_reference_hits: {
        keep_process_refs: keepProcessRefs.length,
        keep_lifecyclemodel_refs: keepLifecyclemodelRefs.length,
        delete_refs: deleteRefs,
      },
      keep: {
        process_id: keep.process_id,
        name_en: trimText(keep.remote_name_en ?? keep.name_en),
        name_zh: trimText(keep.remote_name_zh ?? keep.name_zh),
        score: keep.name_score,
        reasons: keep.name_score_reasons,
      },
      delete: deleteCandidates.map((candidate) => ({
        process_id: candidate.process_id,
        name_en: trimText(candidate.remote_name_en ?? candidate.name_en),
        name_zh: trimText(candidate.remote_name_zh ?? candidate.name_zh),
        score: candidate.name_score,
        reasons: candidate.name_score_reasons,
      })),
      notes,
    });
  }

  return {
    duplicateGroups,
    deletePlanGroups,
  };
}

function buildDedupGate(duplicateGroups: ProcessDedupReviewGroup[]): ProcessDedupGate {
  const ruleset = getRuntimeRuleset('process-dedup/default');
  const blockers = duplicateGroups
    .filter((group) => group.exact_duplicate)
    .map((group) => ({
      group_id: group.group_id,
      code: 'process_exact_duplicate_fingerprint' as const,
      methodology_rule_id: resolveRuntimeRuleId(ruleset.id, 'process_exact_duplicate_fingerprint'),
      severity: 'blocker' as const,
      message:
        'Process group has an exact duplicate normalized exchange fingerprint and must be resolved before creating or publishing another process.',
    }));
  return {
    status: blockers.length > 0 ? 'blocked' : 'passed',
    ruleset_id: ruleset.id,
    ruleset_version: ruleset.version,
    ruleset_source_version: ruleset.source_version,
    ruleset_rule_ids: ruleset.rule_ids,
    counts: {
      duplicate_groups: duplicateGroups.length,
      blocker_groups: blockers.length,
    },
    blockers,
    next_action: blockers.length > 0 ? 'resolve_duplicate_processes' : 'continue',
  };
}

export async function runProcessDedupReview(
  options: RunProcessDedupReviewOptions,
): Promise<ProcessDedupReviewReport> {
  const inputPath = requiredNonEmpty(options.inputPath, '--input', 'PROCESS_DEDUP_INPUT_REQUIRED');
  const outDir = requiredNonEmpty(options.outDir, '--out-dir', 'PROCESS_DEDUP_OUT_DIR_REQUIRED');
  const resolvedInputPath = path.resolve(inputPath);
  const resolvedOutDir = path.resolve(outDir);
  const timeoutMs = toPositiveInteger(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    '--timeout-ms',
    'PROCESS_DEDUP_TIMEOUT_INVALID',
  );
  const maxRetries = toPositiveInteger(
    options.maxRetries ?? DEFAULT_MAX_RETRIES,
    '--max-retries',
    'PROCESS_DEDUP_MAX_RETRIES_INVALID',
  );
  const generatedAtUtc = nowIso(options.now);

  const document = normalizeInputDocument(readJsonInput(resolvedInputPath), resolvedInputPath);
  const processIds = [
    ...new Set(
      document.groups.flatMap((group) => group.processes.map((process) => process.process_id)),
    ),
  ];

  const inputManifestPath = path.join(resolvedOutDir, 'inputs', 'dedup-input.manifest.json');
  writeJsonArtifact(inputManifestPath, {
    schema_version: 1,
    generated_at_utc: generatedAtUtc,
    input_file: resolvedInputPath,
    source_label: document.sourceLabel,
    group_count: document.groups.length,
    process_count: processIds.length,
  });

  const remoteStatus: RemoteStatus = {
    enabled: false,
    loaded: 0,
    error: null,
    reference_scan: options.skipRemote ? 'skipped_by_flag' : 'not_run',
  };

  let remoteMetadataPath: string | null = null;
  let referenceScanPath: string | null = null;
  let remoteById: Record<string, RemoteMetadataRecord> = {};
  let referenceHits = buildEmptyReferenceHits(processIds);

  if (!options.skipRemote) {
    try {
      const env = options.env ?? process.env;
      const fetchImpl = options.fetchImpl ?? (fetch as FetchLike);
      const auth = await resolveRemoteAuthContext({
        env,
        fetchImpl,
        timeoutMs,
        maxRetries,
        now: options.now ?? new Date(),
      });

      remoteById = await fetchRemoteMetadata({
        processIds,
        auth,
        fetchImpl,
        timeoutMs,
        maxRetries,
      });
      remoteStatus.enabled = true;
      remoteStatus.loaded = Object.keys(remoteById).length;
      remoteMetadataPath = path.join(resolvedOutDir, 'inputs', 'processes.remote-metadata.json');
      writeJsonArtifact(remoteMetadataPath, remoteById);

      if (auth.userId) {
        try {
          referenceHits = await fetchCurrentUserReferenceHits({
            auth,
            userId: auth.userId,
            targetProcessIds: processIds,
            fetchImpl,
            timeoutMs,
            maxRetries,
          });
          referenceScanPath = path.join(
            resolvedOutDir,
            'outputs',
            'current-user-reference-scan.json',
          );
          writeJsonArtifact(referenceScanPath, referenceHits);
          remoteStatus.reference_scan = 'current_user_completed';
        } catch (error) {
          remoteStatus.reference_scan = 'failed';
          remoteStatus.error = errorMessage(error);
        }
      } else {
        remoteStatus.reference_scan = 'skipped_missing_user_id';
      }
    } catch (error) {
      remoteStatus.error = errorMessage(error);
    }
  }

  const analysis = analyzeGroups(document.groups, remoteById, referenceHits);
  const gate = buildDedupGate(analysis.duplicateGroups);
  const duplicateGroupsPath = path.join(resolvedOutDir, 'outputs', 'duplicate-groups.json');
  const deletePlanPath = path.join(resolvedOutDir, 'outputs', 'delete-plan.json');

  writeJsonArtifact(duplicateGroupsPath, {
    schema_version: 1,
    generated_at_utc: generatedAtUtc,
    input_file: resolvedInputPath,
    source_label: document.sourceLabel,
    ruleset_id: gate.ruleset_id,
    ruleset_version: gate.ruleset_version,
    ruleset_source_version: gate.ruleset_source_version,
    ruleset_rule_ids: gate.ruleset_rule_ids,
    gate,
    remote_status: remoteStatus,
    groups: analysis.duplicateGroups,
  });
  writeJsonArtifact(deletePlanPath, {
    schema_version: 1,
    generated_at_utc: generatedAtUtc,
    input_file: resolvedInputPath,
    source_label: document.sourceLabel,
    ruleset_id: gate.ruleset_id,
    ruleset_version: gate.ruleset_version,
    ruleset_source_version: gate.ruleset_source_version,
    ruleset_rule_ids: gate.ruleset_rule_ids,
    gate,
    remote_status: remoteStatus,
    groups: analysis.deletePlanGroups,
  });

  return {
    schema_version: 1,
    generated_at_utc: generatedAtUtc,
    status: 'completed_process_dedup_review',
    input_file: resolvedInputPath,
    out_dir: resolvedOutDir,
    source_label: document.sourceLabel,
    group_count: analysis.duplicateGroups.length,
    exact_duplicate_group_count: analysis.duplicateGroups.filter((group) => group.exact_duplicate)
      .length,
    ruleset_id: gate.ruleset_id,
    ruleset_version: gate.ruleset_version,
    ruleset_source_version: gate.ruleset_source_version,
    ruleset_rule_ids: gate.ruleset_rule_ids,
    gate,
    remote_status: remoteStatus,
    files: {
      input_manifest: inputManifestPath,
      remote_metadata: remoteMetadataPath,
      duplicate_groups: duplicateGroupsPath,
      delete_plan: deletePlanPath,
      current_user_reference_scan: referenceScanPath,
    },
  };
}

export const __testInternals = {
  analyzeGroups,
  buildDedupGate,
  collectReferenceHits,
  detectGroupPattern,
  errorMessage,
  fetchCurrentUserId,
  fetchCurrentUserReferenceHits,
  fetchCurrentUserRows,
  fetchJsonWithRetry,
  fetchRemoteMetadata,
  getLangList,
  getLangText,
  normalizeAmount,
  normalizeExchangeRows,
  normalizeInputDocument,
  normalizedSignature,
  parseJsonResponse,
  resolveRemoteAuthContext,
  scoreProcessName,
};
