import { CliError } from './errors.js';
import type { FetchLike } from './http.js';
import {
  buildSupabaseAuthHeaders,
  deriveSupabaseProjectBaseUrl,
  requireSupabaseRestRuntime,
} from './supabase-client.js';
import { resolveSupabaseUserSession } from './supabase-session.js';
import {
  isJsonObject,
  MAINTENANCE_SCAN_TABLES,
  type DatasetMaintenanceMutableTable,
  type DatasetMaintenanceRemoteRow,
  type DatasetMaintenanceScanTable,
  type JsonObject,
} from './dataset-maintenance-contract.js';

const DEFAULT_PAGE_SIZE = 1_000;
const DEFAULT_TIMEOUT_MS = 10_000;

export type DatasetMaintenanceRemoteContext = {
  rest_base_url: string;
  publishable_key: string;
  access_token: string;
  account: {
    user_id: string;
    email: string;
    session_source: string;
  };
  fetch_impl: FetchLike;
  timeout_ms: number;
};

function trimToken(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeStateCode(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  return typeof value === 'string' && /^-?\d+$/u.test(value.trim())
    ? Number.parseInt(value.trim(), 10)
    : null;
}

export function normalizeMaintenancePageSize(value?: number): number {
  const normalized = value ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 5_000) {
    throw new CliError('Maintenance page size must be an integer between 1 and 5000.', {
      code: 'DATASET_MAINTENANCE_PAGE_SIZE_INVALID',
      exitCode: 2,
      details: value,
    });
  }
  return normalized;
}

export function normalizeMaintenanceTimeout(value?: number): number {
  const normalized = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new CliError('Maintenance timeout must be a positive integer.', {
      code: 'DATASET_MAINTENANCE_TIMEOUT_INVALID',
      exitCode: 2,
      details: value,
    });
  }
  return normalized;
}

async function fetchJson(options: {
  context: Pick<
    DatasetMaintenanceRemoteContext,
    'publishable_key' | 'access_token' | 'fetch_impl' | 'timeout_ms'
  >;
  url: string;
  init?: RequestInit;
  label: string;
}): Promise<unknown> {
  const response = await options.context.fetch_impl(options.url, {
    ...options.init,
    headers: {
      ...buildSupabaseAuthHeaders(options.context.publishable_key, options.context.access_token),
      ...(options.init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(options.context.timeout_ms),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new CliError(`HTTP ${response.status} returned from ${options.label}`, {
      code: 'DATASET_MAINTENANCE_REMOTE_REQUEST_FAILED',
      exitCode: 1,
      details: { url: options.url, response: text },
    });
  }
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CliError(`Remote response was not valid JSON for ${options.label}`, {
      code: 'DATASET_MAINTENANCE_REMOTE_INVALID_JSON',
      exitCode: 1,
      details: {
        url: options.url,
        error: String(error),
      },
    });
  }
}

function selectForTable(table: DatasetMaintenanceScanTable): string {
  const common = 'id,version,user_id,state_code,modified_at,json_ordered,rule_verification';
  return table === 'processes' ? `${common},model_id` : common;
}

function normalizeRemoteRow(
  table: DatasetMaintenanceScanTable,
  value: unknown,
): DatasetMaintenanceRemoteRow | null {
  if (!isJsonObject(value)) {
    return null;
  }
  const id = trimToken(value.id);
  const version = trimToken(value.version);
  if (!id || !version) {
    return null;
  }
  return {
    table,
    id,
    version,
    user_id: trimToken(value.user_id),
    state_code: normalizeStateCode(value.state_code),
    modified_at: trimToken(value.modified_at),
    json_ordered: isJsonObject(value.json_ordered) ? value.json_ordered : null,
    model_id: trimToken(value.model_id),
    rule_verification:
      typeof value.rule_verification === 'boolean' ? value.rule_verification : null,
  };
}

function normalizeRemoteRows(
  table: DatasetMaintenanceScanTable,
  value: unknown,
  label: string,
): DatasetMaintenanceRemoteRow[] {
  if (!Array.isArray(value)) {
    throw new CliError(`Remote response was not an array for ${label}.`, {
      code: 'DATASET_MAINTENANCE_REMOTE_ROWS_INVALID',
      exitCode: 1,
      details: value,
    });
  }
  const rows = value.map((entry) => normalizeRemoteRow(table, entry));
  if (rows.some((row) => row === null)) {
    throw new CliError(`Remote response contained an invalid row for ${label}.`, {
      code: 'DATASET_MAINTENANCE_REMOTE_ROW_INVALID',
      exitCode: 1,
    });
  }
  return rows as DatasetMaintenanceRemoteRow[];
}

export async function resolveMaintenanceRemoteContext(options: {
  env: NodeJS.ProcessEnv;
  fetchImpl: FetchLike;
  timeoutMs?: number;
  now?: Date;
}): Promise<DatasetMaintenanceRemoteContext> {
  const timeoutMs = normalizeMaintenanceTimeout(options.timeoutMs);
  const runtime = requireSupabaseRestRuntime(options.env);
  const session = await resolveSupabaseUserSession({
    runtime,
    fetchImpl: options.fetchImpl,
    timeoutMs,
    now: options.now,
  });
  const projectBaseUrl = deriveSupabaseProjectBaseUrl(runtime.apiBaseUrl);
  const partialContext = {
    publishable_key: runtime.publishableKey,
    access_token: session.accessToken,
    fetch_impl: options.fetchImpl,
    timeout_ms: timeoutMs,
  };
  const currentUser = await fetchJson({
    context: partialContext,
    url: `${projectBaseUrl}/auth/v1/user`,
    label: 'supabase current-user lookup',
  });
  const userId = isJsonObject(currentUser) ? trimToken(currentUser.id) : null;
  const email = isJsonObject(currentUser)
    ? (trimToken(currentUser.email) ?? trimToken(session.userEmail))
    : trimToken(session.userEmail);
  if (!userId || !email) {
    throw new CliError('Supabase current-user lookup did not return id and email.', {
      code: 'DATASET_MAINTENANCE_CURRENT_USER_INVALID',
      exitCode: 1,
    });
  }
  return {
    rest_base_url: `${projectBaseUrl}/rest/v1`,
    publishable_key: runtime.publishableKey,
    access_token: session.accessToken,
    account: {
      user_id: userId,
      email,
      session_source: session.source,
    },
    fetch_impl: options.fetchImpl,
    timeout_ms: timeoutMs,
  };
}

export async function fetchMaintenanceExactRows(options: {
  context: DatasetMaintenanceRemoteContext;
  table: DatasetMaintenanceScanTable;
  id: string;
  version: string;
}): Promise<{ rows: DatasetMaintenanceRemoteRow[]; source_url: string }> {
  const url = new URL(`${options.context.rest_base_url}/${options.table}`);
  url.searchParams.set('select', selectForTable(options.table));
  url.searchParams.set('id', `eq.${options.id}`);
  url.searchParams.set('version', `eq.${options.version}`);
  url.searchParams.set('limit', '2');
  const sourceUrl = url.toString();
  const body = await fetchJson({
    context: options.context,
    url: sourceUrl,
    label: `${options.table} exact maintenance lookup`,
  });
  return {
    rows: normalizeRemoteRows(options.table, body, sourceUrl),
    source_url: sourceUrl,
  };
}

export async function fetchMaintenanceAccountRows(options: {
  context: DatasetMaintenanceRemoteContext;
  userId: string;
  pageSize?: number;
}): Promise<{ rows: DatasetMaintenanceRemoteRow[]; source_urls: string[] }> {
  const pageSize = normalizeMaintenancePageSize(options.pageSize);
  const rows: DatasetMaintenanceRemoteRow[] = [];
  const sourceUrls: string[] = [];
  for (const table of MAINTENANCE_SCAN_TABLES) {
    let offset = 0;
    while (true) {
      const url = new URL(`${options.context.rest_base_url}/${table}`);
      url.searchParams.set('select', selectForTable(table));
      url.searchParams.set('user_id', `eq.${options.userId}`);
      url.searchParams.set('order', 'id.asc,version.asc');
      url.searchParams.set('limit', String(pageSize));
      url.searchParams.set('offset', String(offset));
      const sourceUrl = url.toString();
      const body = await fetchJson({
        context: options.context,
        url: sourceUrl,
        label: `${table} account maintenance snapshot`,
      });
      const page = normalizeRemoteRows(table, body, sourceUrl);
      rows.push(...page);
      sourceUrls.push(sourceUrl);
      if (page.length < pageSize) {
        break;
      }
      offset += pageSize;
    }
  }
  return { rows, source_urls: sourceUrls };
}

async function invokeMaintenanceRpc(options: {
  context: DatasetMaintenanceRemoteContext;
  rpc: 'cmd_dataset_save_draft' | 'cmd_dataset_delete';
  body: JsonObject;
}): Promise<JsonObject> {
  const url = `${options.context.rest_base_url}/rpc/${options.rpc}`;
  const body = await fetchJson({
    context: options.context,
    url,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options.body),
    },
    label: options.rpc,
  });
  if (!isJsonObject(body) || body.ok !== true) {
    throw new CliError(`${options.rpc} returned an unexpected response.`, {
      code: 'DATASET_MAINTENANCE_RPC_FAILED',
      exitCode: 1,
      details: body,
    });
  }
  return body;
}

export async function saveDraftMaintenanceRow(options: {
  context: DatasetMaintenanceRemoteContext;
  table: DatasetMaintenanceMutableTable;
  id: string;
  version: string;
  payload: JsonObject;
  modelId: string | null;
  ruleVerification: boolean | null;
  audit: JsonObject;
}): Promise<JsonObject> {
  return invokeMaintenanceRpc({
    context: options.context,
    rpc: 'cmd_dataset_save_draft',
    body: {
      p_table: options.table,
      p_id: options.id,
      p_version: options.version,
      p_json_ordered: options.payload,
      p_model_id: options.modelId,
      p_rule_verification: options.ruleVerification,
      p_audit: options.audit,
    },
  });
}

export async function deleteMaintenanceRow(options: {
  context: DatasetMaintenanceRemoteContext;
  table: DatasetMaintenanceMutableTable;
  id: string;
  version: string;
  audit: JsonObject;
}): Promise<JsonObject> {
  return invokeMaintenanceRpc({
    context: options.context,
    rpc: 'cmd_dataset_delete',
    body: {
      p_table: options.table,
      p_id: options.id,
      p_version: options.version,
      p_audit: options.audit,
    },
  });
}

export const __testInternals = {
  fetchJson,
  normalizeRemoteRow,
  normalizeRemoteRows,
  selectForTable,
};
