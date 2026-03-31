import { CliError } from './errors.js';
import type { FetchLike } from './http.js';
import {
  listFlowRows,
  normalizeStateCodeList,
  normalizeSupabaseFlowPayload,
  normalizeTokenList,
} from './flow-read.js';
import { requireSupabaseRestRuntime } from './supabase-rest.js';

type JsonObject = Record<string, unknown>;

const FLOW_LIST_TIMEOUT_MS = 10_000;
const DEFAULT_FLOW_LIST_LIMIT = 100;
const DEFAULT_FLOW_LIST_PAGE_SIZE = 100;
const DEFAULT_FLOW_LIST_ORDER = 'id.asc,version.asc';

export type RunFlowListOptions = {
  ids?: string[];
  version?: string | null;
  userId?: string | null;
  stateCodes?: number[];
  typeOfDataset?: string[];
  limit?: number | null;
  offset?: number | null;
  all?: boolean;
  pageSize?: number | null;
  order?: string | null;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: Date;
};

export type FlowListReport = {
  schema_version: 1;
  generated_at_utc: string;
  status: 'listed_remote_flows';
  filters: {
    ids: string[];
    requested_version: string | null;
    requested_user_id: string | null;
    requested_state_codes: number[];
    requested_type_of_dataset: string[];
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
    flow: JsonObject;
  }>;
};

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

export async function runFlowList(options: RunFlowListOptions): Promise<FlowListReport> {
  const ids = normalizeTokenList(options.ids);
  const requestedVersion = normalizeToken(options.version ?? null);
  const requestedUserId = normalizeToken(options.userId ?? null);
  const requestedStateCodes = normalizeStateCodeList(options.stateCodes);
  const requestedTypeOfDataset = normalizeTokenList(options.typeOfDataset);
  const all = Boolean(options.all);
  const order = normalizeToken(options.order ?? null) ?? DEFAULT_FLOW_LIST_ORDER;

  if (all && options.limit !== null && options.limit !== undefined) {
    throw new CliError('Cannot combine --all with --limit.', {
      code: 'FLOW_LIST_ALL_LIMIT_CONFLICT',
      exitCode: 2,
    });
  }

  if (all && options.offset !== null && options.offset !== undefined) {
    throw new CliError('Cannot combine --all with --offset.', {
      code: 'FLOW_LIST_ALL_OFFSET_CONFLICT',
      exitCode: 2,
    });
  }

  if (
    all &&
    ids.length === 0 &&
    requestedVersion === null &&
    requestedUserId === null &&
    requestedStateCodes.length === 0 &&
    requestedTypeOfDataset.length === 0
  ) {
    throw new CliError('Refusing to run --all without at least one narrowing filter.', {
      code: 'FLOW_LIST_ALL_FILTER_REQUIRED',
      exitCode: 2,
    });
  }

  const runtime = requireSupabaseRestRuntime(options.env ?? process.env);
  const fetchImpl = options.fetchImpl ?? (fetch as FetchLike);
  const timeoutMs = options.timeoutMs ?? FLOW_LIST_TIMEOUT_MS;
  const sourceUrls: string[] = [];

  const rows: FlowListReport['rows'] = [];
  if (all) {
    const pageSizeValue = options.pageSize ?? DEFAULT_FLOW_LIST_PAGE_SIZE;
    const pageSize = toPositiveInteger(pageSizeValue, '--page-size', 'FLOW_LIST_PAGE_SIZE_INVALID');
    let currentOffset = 0;
    while (true) {
      const page = await listFlowRows({
        runtime,
        filters: {
          ids,
          version: requestedVersion,
          userId: requestedUserId,
          stateCodes: requestedStateCodes,
          typeOfDataset: requestedTypeOfDataset,
          order,
          limit: pageSize,
          offset: currentOffset,
        },
        timeoutMs,
        fetchImpl,
      });
      sourceUrls.push(page.sourceUrl);
      rows.push(
        ...page.rows.map((row) => ({
          id: row.id,
          version: row.version,
          user_id: row.user_id,
          state_code: row.state_code,
          modified_at: row.modified_at,
          flow: normalizeSupabaseFlowPayload(row.json, `${row.id}@${row.version}`),
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
      status: 'listed_remote_flows',
      filters: {
        ids,
        requested_version: requestedVersion,
        requested_user_id: requestedUserId,
        requested_state_codes: requestedStateCodes,
        requested_type_of_dataset: requestedTypeOfDataset,
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
    options.limit ?? DEFAULT_FLOW_LIST_LIMIT,
    '--limit',
    'FLOW_LIST_LIMIT_INVALID',
  );
  const offset = toNonNegativeInteger(options.offset ?? 0, '--offset', 'FLOW_LIST_OFFSET_INVALID');
  const page = await listFlowRows({
    runtime,
    filters: {
      ids,
      version: requestedVersion,
      userId: requestedUserId,
      stateCodes: requestedStateCodes,
      typeOfDataset: requestedTypeOfDataset,
      order,
      limit,
      offset,
    },
    timeoutMs,
    fetchImpl,
  });

  return {
    schema_version: 1,
    generated_at_utc: nowIso(options.now),
    status: 'listed_remote_flows',
    filters: {
      ids,
      requested_version: requestedVersion,
      requested_user_id: requestedUserId,
      requested_state_codes: requestedStateCodes,
      requested_type_of_dataset: requestedTypeOfDataset,
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
      flow: normalizeSupabaseFlowPayload(row.json, `${row.id}@${row.version}`),
    })),
  };
}

export const __testInternals = {
  normalizeToken,
  nowIso,
  toPositiveInteger,
  toNonNegativeInteger,
};
