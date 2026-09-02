// data-api-relations: lifecyclemodels, processes, sources
// data-api-dynamic-relation-expression: options.table
import { CliError } from './errors.js';
import {
  buildDatasetCommandTransport,
  createDatasetRecord,
  saveDraftDatasetRecord,
  type DatasetCommandTransport,
} from './dataset-command.js';
import type { FetchLike } from './http.js';
import {
  createSupabaseDataClient,
  requireSupabaseRestRuntime,
  runSupabaseArrayQuery,
} from './supabase-client.js';
import { createSupabaseDataRuntime } from './supabase-session.js';

type JsonObject = Record<string, unknown>;

const DEFAULT_TIMEOUT_MS = 10_000;

export type SupabaseJsonOrderedTable = 'lifecyclemodels' | 'processes' | 'sources';
export type SupabaseJsonOrderedWriteMode = 'upsert_current_version' | 'append_only_insert';
export type SupabaseJsonOrderedWriteOperation =
  'insert' | 'update_existing' | 'update_after_insert_error' | 'skipped_existing';

export type SupabaseJsonOrderedWriteResult = {
  status: 'success';
  operation: SupabaseJsonOrderedWriteOperation;
};

type VisibleRow = {
  id: string;
  version: string;
  state_code: number | null;
};

type SupabaseDataClient = ReturnType<typeof createSupabaseDataClient>['client'];

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimToken(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
  client: SupabaseDataClient;
  restBaseUrl: string;
  table: SupabaseJsonOrderedTable;
  id: string;
  version: string;
}): Promise<VisibleRow[]> {
  const url = buildSelectUrl(options.restBaseUrl, options.table, options.id, options.version);
  const payload = await runSupabaseArrayQuery(
    options.client
      .from(options.table)
      .select('id,version,state_code')
      .eq('id', options.id)
      .eq('version', options.version),
    url,
  );
  return parseVisibleRows(payload, url);
}

async function insertJsonOrderedRow(options: {
  transport: DatasetCommandTransport;
  table: SupabaseJsonOrderedTable;
  id: string;
  payload: JsonObject;
  extraData?: JsonObject;
}): Promise<void> {
  await createDatasetRecord({
    transport: options.transport,
    table: options.table,
    id: options.id,
    payload: options.payload,
    extraData: options.extraData,
  });
}

async function updateJsonOrderedRow(options: {
  transport: DatasetCommandTransport;
  table: SupabaseJsonOrderedTable;
  id: string;
  version: string;
  payload: JsonObject;
  extraData?: JsonObject;
}): Promise<void> {
  await saveDraftDatasetRecord({
    transport: options.transport,
    table: options.table,
    id: options.id,
    version: options.version,
    payload: options.payload,
    extraData: options.extraData,
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
  try {
    // Config-free auth must not turn an otherwise local workflow into a remote
    // publisher merely because the official Production profile is available.
    requireSupabaseRestRuntime(env, { allowProductionDefaults: false });
    return true;
  } catch {
    return false;
  }
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
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const runtime = createSupabaseDataRuntime({
    runtime: requireSupabaseRestRuntime(options.env),
    fetchImpl: options.fetchImpl,
    timeoutMs,
  });
  const commandTransport = await buildDatasetCommandTransport({
    runtime,
    fetchImpl: options.fetchImpl,
    timeoutMs,
  });
  const { client, restBaseUrl } = createSupabaseDataClient(runtime, options.fetchImpl, timeoutMs);

  const visibleBefore = await exactVisibleRows({
    client,
    restBaseUrl,
    table: options.table,
    id,
    version,
  });

  if (options.writeMode === 'append_only_insert' && visibleBefore.length > 0) {
    return {
      status: 'success',
      operation: 'skipped_existing',
    };
  }

  if (visibleBefore.length > 0) {
    await updateJsonOrderedRow({
      transport: commandTransport,
      table: options.table,
      id,
      version,
      payload: options.payload,
      extraData: options.extraData,
    });
    return {
      status: 'success',
      operation: 'update_existing',
    };
  }

  try {
    await insertJsonOrderedRow({
      transport: commandTransport,
      table: options.table,
      id,
      payload: options.payload,
      extraData: options.extraData,
    });
    return {
      status: 'success',
      operation: 'insert',
    };
  } catch (error) {
    const visibleAfter = await exactVisibleRows({
      client,
      restBaseUrl,
      table: options.table,
      id,
      version,
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
      transport: commandTransport,
      table: options.table,
      id,
      version,
      payload: options.payload,
      extraData: options.extraData,
    });
    return {
      status: 'success',
      operation: 'update_after_insert_error',
    };
  }
}

export const __testInternals = {
  buildSelectUrl,
  buildUpdateUrl,
  parseVisibleRows,
  exactVisibleRows,
  insertJsonOrderedRow,
  updateJsonOrderedRow,
  requireNonEmptyToken,
};
