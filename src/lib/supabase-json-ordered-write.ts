import { CliError } from './errors.js';
import type { FetchLike, ResponseLike } from './http.js';
import { deriveSupabaseRestBaseUrl, requireSupabaseRestRuntime } from './supabase-rest.js';

type JsonObject = Record<string, unknown>;

const DEFAULT_TIMEOUT_MS = 10_000;

export type SupabaseJsonOrderedTable = 'lifecyclemodels' | 'processes' | 'sources';
export type SupabaseJsonOrderedWriteMode = 'upsert_current_version' | 'append_only_insert';
export type SupabaseJsonOrderedWriteOperation =
  | 'insert'
  | 'update_existing'
  | 'update_after_insert_error'
  | 'skipped_existing';

export type SupabaseJsonOrderedWriteResult = {
  status: 'success';
  operation: SupabaseJsonOrderedWriteOperation;
};

type VisibleRow = {
  id: string;
  version: string;
  state_code: number | null;
};

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimToken(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
    apikey: apiKey,
  };
}

function buildSelectUrl(
  restBaseUrl: string,
  table: SupabaseJsonOrderedTable,
  id: string,
  version: string,
): string {
  const url = new URL(`${restBaseUrl.replace(/\/+$/u, '')}/${table}`);
  url.searchParams.set('select', 'id,version,state_code');
  url.searchParams.set('id', `eq.${id}`);
  url.searchParams.set('version', `eq.${version}`);
  return url.toString();
}

function buildUpdateUrl(
  restBaseUrl: string,
  table: SupabaseJsonOrderedTable,
  id: string,
  version: string,
): string {
  const url = new URL(`${restBaseUrl.replace(/\/+$/u, '')}/${table}`);
  url.searchParams.set('id', `eq.${id}`);
  url.searchParams.set('version', `eq.${version}`);
  return url.toString();
}

async function parseResponse(response: ResponseLike, url: string): Promise<unknown> {
  const rawText = await response.text();
  const contentType = response.headers.get('content-type') ?? '';

  if (!response.ok) {
    throw new CliError(`HTTP ${response.status} returned from ${url}`, {
      code: 'REMOTE_REQUEST_FAILED',
      exitCode: 1,
      details: rawText,
    });
  }

  if (!rawText) {
    return null;
  }

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(rawText);
    } catch (error) {
      throw new CliError(`Remote response was not valid JSON for ${url}`, {
        code: 'REMOTE_INVALID_JSON',
        exitCode: 1,
        details: String(error),
      });
    }
  }

  return rawText;
}

async function requestJson(options: {
  method: 'GET' | 'POST' | 'PATCH';
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  fetchImpl: FetchLike;
}): Promise<unknown> {
  const response = await options.fetchImpl(options.url, {
    method: options.method,
    headers: options.headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  return parseResponse(response, options.url);
}

function parseVisibleRows(payload: unknown, url: string): VisibleRow[] {
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
      id: trimToken(item.id),
      version: trimToken(item.version),
      state_code: typeof item.state_code === 'number' ? item.state_code : null,
    };
  });
}

async function exactVisibleRows(options: {
  restBaseUrl: string;
  table: SupabaseJsonOrderedTable;
  apiKey: string;
  id: string;
  version: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
}): Promise<VisibleRow[]> {
  const url = buildSelectUrl(options.restBaseUrl, options.table, options.id, options.version);
  const payload = await requestJson({
    method: 'GET',
    url,
    headers: buildHeaders(options.apiKey),
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  });
  return parseVisibleRows(payload, url);
}

async function insertJsonOrderedRow(options: {
  restBaseUrl: string;
  table: SupabaseJsonOrderedTable;
  apiKey: string;
  id: string;
  payload: JsonObject;
  timeoutMs: number;
  fetchImpl: FetchLike;
  extraData?: JsonObject;
}): Promise<void> {
  await requestJson({
    method: 'POST',
    url: `${options.restBaseUrl.replace(/\/+$/u, '')}/${options.table}`,
    headers: {
      ...buildHeaders(options.apiKey),
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: {
      id: options.id,
      json_ordered: options.payload,
      ...(options.extraData ?? {}),
    },
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  });
}

async function updateJsonOrderedRow(options: {
  restBaseUrl: string;
  table: SupabaseJsonOrderedTable;
  apiKey: string;
  id: string;
  version: string;
  payload: JsonObject;
  timeoutMs: number;
  fetchImpl: FetchLike;
  extraData?: JsonObject;
}): Promise<void> {
  await requestJson({
    method: 'PATCH',
    url: buildUpdateUrl(options.restBaseUrl, options.table, options.id, options.version),
    headers: {
      ...buildHeaders(options.apiKey),
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: {
      json_ordered: options.payload,
      ...(options.extraData ?? {}),
    },
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  });
}

function requireNonEmptyToken(value: string, label: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new CliError(`Missing required ${label}.`, {
      code,
      exitCode: 2,
    });
  }
  return normalized;
}

export function hasSupabaseRestRuntime(env: NodeJS.ProcessEnv | undefined): boolean {
  if (!env) {
    return false;
  }

  return Boolean(trimToken(env.TIANGONG_LCA_API_BASE_URL) && trimToken(env.TIANGONG_LCA_API_KEY));
}

export async function syncSupabaseJsonOrderedRecord(options: {
  table: SupabaseJsonOrderedTable;
  id: string;
  version: string;
  payload: JsonObject;
  writeMode: SupabaseJsonOrderedWriteMode;
  env: NodeJS.ProcessEnv;
  fetchImpl: FetchLike;
  timeoutMs?: number;
  extraData?: JsonObject;
}): Promise<SupabaseJsonOrderedWriteResult> {
  const id = requireNonEmptyToken(options.id, 'dataset id', 'SUPABASE_JSON_ORDERED_ID_REQUIRED');
  const version = requireNonEmptyToken(
    options.version,
    'dataset version',
    'SUPABASE_JSON_ORDERED_VERSION_REQUIRED',
  );
  const runtime = requireSupabaseRestRuntime(options.env);
  const restBaseUrl = deriveSupabaseRestBaseUrl(runtime.apiBaseUrl);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const visibleBefore = await exactVisibleRows({
    restBaseUrl,
    table: options.table,
    apiKey: runtime.apiKey,
    id,
    version,
    timeoutMs,
    fetchImpl: options.fetchImpl,
  });

  if (options.writeMode === 'append_only_insert' && visibleBefore.length > 0) {
    return {
      status: 'success',
      operation: 'skipped_existing',
    };
  }

  if (visibleBefore.length > 0) {
    await updateJsonOrderedRow({
      restBaseUrl,
      table: options.table,
      apiKey: runtime.apiKey,
      id,
      version,
      payload: options.payload,
      timeoutMs,
      fetchImpl: options.fetchImpl,
      extraData: options.extraData,
    });
    return {
      status: 'success',
      operation: 'update_existing',
    };
  }

  try {
    await insertJsonOrderedRow({
      restBaseUrl,
      table: options.table,
      apiKey: runtime.apiKey,
      id,
      payload: options.payload,
      timeoutMs,
      fetchImpl: options.fetchImpl,
      extraData: options.extraData,
    });
    return {
      status: 'success',
      operation: 'insert',
    };
  } catch (error) {
    const visibleAfter = await exactVisibleRows({
      restBaseUrl,
      table: options.table,
      apiKey: runtime.apiKey,
      id,
      version,
      timeoutMs,
      fetchImpl: options.fetchImpl,
    });

    if (visibleAfter.length === 0) {
      throw error;
    }

    if (options.writeMode === 'append_only_insert') {
      return {
        status: 'success',
        operation: 'skipped_existing',
      };
    }

    await updateJsonOrderedRow({
      restBaseUrl,
      table: options.table,
      apiKey: runtime.apiKey,
      id,
      version,
      payload: options.payload,
      timeoutMs,
      fetchImpl: options.fetchImpl,
      extraData: options.extraData,
    });
    return {
      status: 'success',
      operation: 'update_after_insert_error',
    };
  }
}

export const __testInternals = {
  buildHeaders,
  buildSelectUrl,
  buildUpdateUrl,
  parseVisibleRows,
  exactVisibleRows,
  insertJsonOrderedRow,
  updateJsonOrderedRow,
  requireNonEmptyToken,
};
