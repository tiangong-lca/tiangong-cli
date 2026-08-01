// data-api-relations: processes
import { CliError } from './errors.js';
import { normalizeStateCodeList, normalizeTokenList } from './flow-read.js';
import type { FetchLike } from './http.js';
import { normalizeSupabaseProcessPayload, requireSupabaseRestRuntime } from './supabase-rest.js';
import { createSupabaseDataClient, runSupabaseArrayQuery } from './supabase-client.js';
import { createSupabaseDataRuntime } from './supabase-session.js';

type JsonObject = Record<string, unknown>;

const PROCESS_LIST_TIMEOUT_MS = 10_000;
const DEFAULT_PROCESS_LIST_LIMIT = 100;
const DEFAULT_PROCESS_LIST_PAGE_SIZE = 100;
const DEFAULT_PROCESS_LIST_ORDER = 'id.asc,version.asc';
const DEFAULT_PROCESS_LIST_MAX_ATTEMPTS = 3;

type ProcessListQueryFilters = {
  ids?: string[];
  version?: string | null;
  userId?: string | null;
  stateCodes?: number[];
  order?: string | null;
  limit?: number | null;
  offset?: number | null;
};

type SupabaseProcessListRow = {
  id: string;
  version: string;
  user_id: string | null;
  state_code: number | null;
  modified_at: string | null;
  json: unknown;
};

type QueryWithUrl = {
  url: URL;
  limit: (count: number) => QueryWithUrl;
};

export type RunProcessListOptions = {
  ids?: string[];
  version?: string | null;
  userId?: string | null;
  stateCodes?: number[];
  limit?: number | null;
  offset?: number | null;
  all?: boolean;
  pageSize?: number | null;
  order?: string | null;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: Date;
  maxAttempts?: number | null;
};

export type ProcessListReport = {
  schema_version: 1;
  generated_at_utc: string;
  status: 'listed_remote_processes';
  filters: {
    ids: string[];
    requested_version: string | null;
    requested_user_id: string | null;
    requested_state_codes: number[];
    order: string;
    all: boolean;
    limit: number | null;
    offset: number;
    page_size: number | null;
  };
  count: number;
  source_urls: string[];
  rows: Array<{
    id: string;
    version: string;
    user_id: string | null;
    state_code: number | null;
    modified_at: string | null;
    process: JsonObject;
  }>;
};

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeToken(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

function toPositiveInteger(value: number | null | undefined, label: string, code: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new CliError(`Expected ${label} to be a positive integer.`, {
      code,
      exitCode: 2,
    });
  }
  return value as number;
}

function toNonNegativeInteger(
  value: number | null | undefined,
  label: string,
  code: string,
): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new CliError(`Expected ${label} to be a non-negative integer.`, {
      code,
      exitCode: 2,
    });
  }
  return value as number;
}

function optionalPositiveInteger(value: number | null | undefined): number | null {
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : null;
}

function optionalNonNegativeInteger(value: number | null | undefined): number | null {
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null;
}

function buildProcessListUrl(restBaseUrl: string, filters: ProcessListQueryFilters): string {
  const url = new URL(`${restBaseUrl.replace(/\/+$/u, '')}/processes`);
  url.searchParams.set('select', 'id,version,user_id,state_code,modified_at,json');

  const ids = normalizeTokenList(filters.ids);
  if (ids.length === 1) {
    url.searchParams.set('id', `eq.${ids[0]}`);
  } else if (ids.length > 1) {
    url.searchParams.set('id', `in.(${ids.join(',')})`);
  }

  if (typeof filters.version === 'string' && filters.version.trim()) {
    url.searchParams.set('version', `eq.${filters.version.trim()}`);
  }

  if (typeof filters.userId === 'string' && filters.userId.trim()) {
    url.searchParams.set('user_id', `eq.${filters.userId.trim()}`);
  }

  const stateCodes = normalizeStateCodeList(filters.stateCodes);
  if (stateCodes.length === 1) {
    url.searchParams.set('state_code', `eq.${stateCodes[0]}`);
  } else if (stateCodes.length > 1) {
    url.searchParams.set('state_code', `in.(${stateCodes.join(',')})`);
  }

  if (typeof filters.order === 'string' && filters.order.trim()) {
    url.searchParams.set('order', filters.order.trim());
  }

  if (Number.isInteger(filters.limit) && (filters.limit as number) > 0) {
    url.searchParams.set('limit', String(filters.limit));
  }

  if (Number.isInteger(filters.offset) && (filters.offset as number) >= 0) {
    url.searchParams.set('offset', String(filters.offset));
  }

  return url.toString();
}

function parseProcessRows(payload: unknown, url: string): SupabaseProcessListRow[] {
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
      id: typeof item.id === 'string' ? item.id : '',
      version: typeof item.version === 'string' ? item.version : '',
      user_id: typeof item.user_id === 'string' ? item.user_id : null,
      state_code: typeof item.state_code === 'number' ? item.state_code : null,
      modified_at: typeof item.modified_at === 'string' ? item.modified_at : null,
      json: item.json,
    };
  });
}

function applyOrder<Query extends { order: (column: string, options?: object) => Query }>(
  query: Query,
  orderValue: string | null | undefined,
): Query {
  const normalizedOrder = typeof orderValue === 'string' ? orderValue.trim() : '';
  if (!normalizedOrder) {
    return query;
  }

  let nextQuery = query;
  for (const rawToken of normalizedOrder.split(',')) {
    const token = rawToken.trim();
    if (!token) {
      continue;
    }

    const [column, direction, nulls] = token.split('.');
    if (!column) {
      continue;
    }

    nextQuery = nextQuery.order(column, {
      ascending: direction !== 'desc',
      nullsFirst: nulls === 'nullsfirst' ? true : nulls === 'nullslast' ? false : undefined,
    });
  }

  return nextQuery;
}

async function listProcessRows(options: {
  runtime: ReturnType<typeof createSupabaseDataRuntime>;
  filters: ProcessListQueryFilters;
  timeoutMs: number;
  fetchImpl: FetchLike;
}): Promise<{ rows: SupabaseProcessListRow[]; sourceUrl: string }> {
  const { client, restBaseUrl } = createSupabaseDataClient(
    options.runtime,
    options.fetchImpl,
    options.timeoutMs,
  );
  const sourceUrl = buildProcessListUrl(restBaseUrl, options.filters);
  let query = client.from('processes').select('id,version,user_id,state_code,modified_at,json');

  const ids = normalizeTokenList(options.filters.ids);
  if (ids.length === 1) {
    query = query.eq('id', ids[0] as string);
  } else if (ids.length > 1) {
    query = query.filter('id', 'in', `(${ids.join(',')})`);
  }

  if (typeof options.filters.version === 'string' && options.filters.version.trim()) {
    query = query.eq('version', options.filters.version.trim());
  }

  if (typeof options.filters.userId === 'string' && options.filters.userId.trim()) {
    query = query.eq('user_id', options.filters.userId.trim());
  }

  const stateCodes = normalizeStateCodeList(options.filters.stateCodes);
  if (stateCodes.length === 1) {
    query = query.eq('state_code', stateCodes[0] as number);
  } else if (stateCodes.length > 1) {
    query = query.filter('state_code', 'in', `(${stateCodes.join(',')})`);
  }

  query = applyOrder(query, options.filters.order);

  const limit = optionalPositiveInteger(options.filters.limit);
  const offset = optionalNonNegativeInteger(options.filters.offset);

  if (limit !== null) {
    query = query.limit(limit);
    if (offset !== null) {
      (query as unknown as QueryWithUrl).url.searchParams.set('offset', String(offset));
    }
  }

  const payload = await runSupabaseArrayQuery(query, sourceUrl);
  return {
    rows: parseProcessRows(payload, sourceUrl),
    sourceUrl,
  };
}

function isRetryableError(error: unknown): boolean {
  return !(error instanceof CliError && error.exitCode === 2);
}

async function listProcessRowsWithRetry(options: {
  runtime: ReturnType<typeof createSupabaseDataRuntime>;
  filters: ProcessListQueryFilters;
  timeoutMs: number;
  fetchImpl: FetchLike;
  maxAttempts: number;
}): Promise<{ rows: SupabaseProcessListRow[]; sourceUrl: string }> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await listProcessRows(options);
    } catch (error) {
      if (attempt >= options.maxAttempts || !isRetryableError(error)) {
        throw error;
      }
    }
  }
}

export async function runProcessList(options: RunProcessListOptions): Promise<ProcessListReport> {
  const ids = normalizeTokenList(options.ids);
  const requestedVersion = normalizeToken(options.version ?? null);
  const requestedUserId = normalizeToken(options.userId ?? null);
  const requestedStateCodes = normalizeStateCodeList(options.stateCodes);
  const all = Boolean(options.all);
  const order = normalizeToken(options.order ?? null) ?? DEFAULT_PROCESS_LIST_ORDER;

  if (all && options.limit !== null && options.limit !== undefined) {
    throw new CliError('Cannot combine --all with --limit.', {
      code: 'PROCESS_LIST_ALL_LIMIT_CONFLICT',
      exitCode: 2,
    });
  }

  if (all && options.offset !== null && options.offset !== undefined) {
    throw new CliError('Cannot combine --all with --offset.', {
      code: 'PROCESS_LIST_ALL_OFFSET_CONFLICT',
      exitCode: 2,
    });
  }

  if (
    all &&
    ids.length === 0 &&
    requestedVersion === null &&
    requestedUserId === null &&
    requestedStateCodes.length === 0
  ) {
    throw new CliError('Refusing to run --all without at least one narrowing filter.', {
      code: 'PROCESS_LIST_ALL_FILTER_REQUIRED',
      exitCode: 2,
    });
  }

  const fetchImpl = options.fetchImpl ?? (fetch as FetchLike);
  const timeoutMs = options.timeoutMs ?? PROCESS_LIST_TIMEOUT_MS;
  const maxAttempts = toPositiveInteger(
    options.maxAttempts ?? DEFAULT_PROCESS_LIST_MAX_ATTEMPTS,
    'process list retry count',
    'PROCESS_LIST_MAX_ATTEMPTS_INVALID',
  );
  const runtime = createSupabaseDataRuntime({
    runtime: requireSupabaseRestRuntime(options.env ?? process.env),
    fetchImpl,
    timeoutMs,
    now: options.now,
  });
  const sourceUrls: string[] = [];
  const rows: ProcessListReport['rows'] = [];

  if (all) {
    const pageSizeValue = options.pageSize ?? DEFAULT_PROCESS_LIST_PAGE_SIZE;
    const pageSize = toPositiveInteger(
      pageSizeValue,
      '--page-size',
      'PROCESS_LIST_PAGE_SIZE_INVALID',
    );
    let currentOffset = 0;
    while (true) {
      const page = await listProcessRowsWithRetry({
        runtime,
        filters: {
          ids,
          version: requestedVersion,
          userId: requestedUserId,
          stateCodes: requestedStateCodes,
          order,
          limit: pageSize,
          offset: currentOffset,
        },
        timeoutMs,
        fetchImpl,
        maxAttempts,
      });
      sourceUrls.push(page.sourceUrl);
      rows.push(
        ...page.rows.map((row) => ({
          id: row.id,
          version: row.version,
          user_id: row.user_id,
          state_code: row.state_code,
          modified_at: row.modified_at,
          process: normalizeSupabaseProcessPayload(row.json, `${row.id}@${row.version}`),
        })),
      );
      if (page.rows.length < pageSize) {
        break;
      }
      currentOffset += pageSize;
    }

    return {
      schema_version: 1,
      generated_at_utc: nowIso(options.now),
      status: 'listed_remote_processes',
      filters: {
        ids,
        requested_version: requestedVersion,
        requested_user_id: requestedUserId,
        requested_state_codes: requestedStateCodes,
        order,
        all: true,
        limit: null,
        offset: 0,
        page_size: pageSize,
      },
      count: rows.length,
      source_urls: sourceUrls,
      rows,
    };
  }

  const limit = toPositiveInteger(
    options.limit ?? DEFAULT_PROCESS_LIST_LIMIT,
    '--limit',
    'PROCESS_LIST_LIMIT_INVALID',
  );
  const offset = toNonNegativeInteger(
    options.offset ?? 0,
    '--offset',
    'PROCESS_LIST_OFFSET_INVALID',
  );
  const page = await listProcessRowsWithRetry({
    runtime,
    filters: {
      ids,
      version: requestedVersion,
      userId: requestedUserId,
      stateCodes: requestedStateCodes,
      order,
      limit,
      offset,
    },
    timeoutMs,
    fetchImpl,
    maxAttempts,
  });

  return {
    schema_version: 1,
    generated_at_utc: nowIso(options.now),
    status: 'listed_remote_processes',
    filters: {
      ids,
      requested_version: requestedVersion,
      requested_user_id: requestedUserId,
      requested_state_codes: requestedStateCodes,
      order,
      all: false,
      limit,
      offset,
      page_size: null,
    },
    count: page.rows.length,
    source_urls: [page.sourceUrl],
    rows: page.rows.map((row) => ({
      id: row.id,
      version: row.version,
      user_id: row.user_id,
      state_code: row.state_code,
      modified_at: row.modified_at,
      process: normalizeSupabaseProcessPayload(row.json, `${row.id}@${row.version}`),
    })),
  };
}

export const __testInternals = {
  applyOrder,
  buildProcessListUrl,
  isRetryableError,
  normalizeToken,
  nowIso,
  optionalNonNegativeInteger,
  optionalPositiveInteger,
  parseProcessRows,
  toNonNegativeInteger,
  toPositiveInteger,
};
