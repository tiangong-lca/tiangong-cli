import { CliError } from './errors.js';
import { getJson, type FetchLike } from './http.js';
import { deriveSupabaseRestBaseUrl, type SupabaseRestRuntime } from './supabase-rest.js';

type JsonObject = Record<string, unknown>;

export type SupabaseFlowRow = {
  id: string;
  version: string;
  user_id: string | null;
  state_code: number | null;
  modified_at: string | null;
  json: unknown;
};

export type FlowListQueryFilters = {
  ids?: string[];
  version?: string | null;
  userId?: string | null;
  stateCodes?: number[];
  typeOfDataset?: string[];
  order?: string | null;
  limit?: number | null;
  offset?: number | null;
};

export type SupabaseFlowLookup = {
  row: SupabaseFlowRow;
  sourceUrl: string;
  resolution:
    | 'remote_supabase_exact'
    | 'remote_supabase_latest'
    | 'remote_supabase_latest_fallback';
};

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
    apikey: apiKey,
  };
}

function normalizeTokenList(values: readonly string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    normalized.push(trimmed);
    seen.add(trimmed);
  }
  return normalized;
}

function normalizeStateCodeList(values: readonly number[] | undefined): number[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set<number>();
  const normalized: number[] = [];
  for (const value of values) {
    if (!Number.isInteger(value) || value < 0 || seen.has(value)) {
      continue;
    }
    normalized.push(value);
    seen.add(value);
  }
  return normalized;
}

function buildFlowListUrl(restBaseUrl: string, filters: FlowListQueryFilters): string {
  const url = new URL(`${restBaseUrl.replace(/\/+$/u, '')}/flows`);
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

  const typeOfDataset = normalizeTokenList(filters.typeOfDataset);
  const typeOfDatasetQueryPath =
    'json->flowDataSet->modellingAndValidation->LCIMethod->>typeOfDataSet';
  if (typeOfDataset.length === 1) {
    url.searchParams.set(typeOfDatasetQueryPath, `eq.${typeOfDataset[0]}`);
  } else if (typeOfDataset.length > 1) {
    url.searchParams.set(typeOfDatasetQueryPath, `in.(${typeOfDataset.join(',')})`);
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

function parseFlowRows(payload: unknown, url: string): SupabaseFlowRow[] {
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

function normalizeSupabaseFlowPayload(payload: unknown, lookupKey: string): JsonObject {
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      if (!isRecord(parsed)) {
        throw new CliError(`Supabase REST payload was not a JSON object for ${lookupKey}.`, {
          code: 'SUPABASE_REST_PAYLOAD_INVALID',
          exitCode: 1,
          details: parsed,
        });
      }
      return parsed;
    } catch (error) {
      if (error instanceof CliError) {
        throw error;
      }

      throw new CliError(`Supabase REST payload was not valid JSON for ${lookupKey}.`, {
        code: 'SUPABASE_REST_PAYLOAD_INVALID_JSON',
        exitCode: 1,
        details: String(error),
      });
    }
  }

  if (!isRecord(payload)) {
    throw new CliError(`Supabase REST payload was missing json for ${lookupKey}.`, {
      code: 'SUPABASE_REST_PAYLOAD_MISSING',
      exitCode: 1,
      details: payload,
    });
  }

  return payload;
}

async function listFlowRows(options: {
  runtime: SupabaseRestRuntime;
  filters: FlowListQueryFilters;
  timeoutMs: number;
  fetchImpl: FetchLike;
}): Promise<{ rows: SupabaseFlowRow[]; sourceUrl: string }> {
  const restBaseUrl = deriveSupabaseRestBaseUrl(options.runtime.apiBaseUrl);
  const sourceUrl = buildFlowListUrl(restBaseUrl, options.filters);
  const rows = parseFlowRows(
    await getJson({
      url: sourceUrl,
      headers: buildHeaders(options.runtime.apiKey),
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    }),
    sourceUrl,
  );
  return { rows, sourceUrl };
}

function buildAmbiguousMatchDetails(rows: SupabaseFlowRow[]): Array<{
  id: string;
  version: string;
  user_id: string | null;
  state_code: number | null;
}> {
  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    user_id: row.user_id,
    state_code: row.state_code,
  }));
}

function latestRowsAreAmbiguous(rows: SupabaseFlowRow[]): boolean {
  return rows.length > 1 && rows[0]?.version === rows[1]?.version;
}

async function fetchOneFlowRow(options: {
  runtime: SupabaseRestRuntime;
  id: string;
  version?: string | null;
  userId?: string | null;
  stateCode?: number | null;
  timeoutMs: number;
  fetchImpl: FetchLike;
  fallbackToLatest?: boolean;
}): Promise<SupabaseFlowLookup | null> {
  const stateCodes =
    Number.isInteger(options.stateCode) && (options.stateCode as number) >= 0
      ? [options.stateCode as number]
      : [];
  const sharedFilters = {
    ids: [options.id],
    userId: options.userId ?? null,
    stateCodes,
  } satisfies FlowListQueryFilters;

  if (options.version) {
    const exact = await listFlowRows({
      runtime: options.runtime,
      filters: {
        ...sharedFilters,
        version: options.version,
        order: 'version.desc',
        limit: 2,
        offset: 0,
      },
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });

    if (exact.rows.length === 1) {
      return {
        row: exact.rows[0] as SupabaseFlowRow,
        sourceUrl: exact.sourceUrl,
        resolution: 'remote_supabase_exact',
      };
    }

    if (exact.rows.length > 1) {
      throw new CliError(
        `Multiple visible flow rows matched ${options.id}@${options.version}. Add a stricter --state-code or --user-id filter.`,
        {
          code: 'FLOW_GET_AMBIGUOUS',
          exitCode: 2,
          details: {
            flow_id: options.id,
            version: options.version,
            matches: buildAmbiguousMatchDetails(exact.rows),
            source_url: exact.sourceUrl,
          },
        },
      );
    }

    if (!options.fallbackToLatest) {
      return null;
    }
  }

  const latest = await listFlowRows({
    runtime: options.runtime,
    filters: {
      ...sharedFilters,
      order: 'version.desc',
      limit: 2,
      offset: 0,
    },
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  });

  if (latest.rows.length === 0) {
    return null;
  }

  if (latestRowsAreAmbiguous(latest.rows)) {
    throw new CliError(
      `Multiple visible flow rows matched the latest version for ${options.id}. Add a stricter --state-code or --user-id filter.`,
      {
        code: 'FLOW_GET_AMBIGUOUS',
        exitCode: 2,
        details: {
          flow_id: options.id,
          version: latest.rows[0].version,
          matches: buildAmbiguousMatchDetails(latest.rows),
          source_url: latest.sourceUrl,
        },
      },
    );
  }

  return {
    row: latest.rows[0] as SupabaseFlowRow,
    sourceUrl: latest.sourceUrl,
    resolution: options.version ? 'remote_supabase_latest_fallback' : 'remote_supabase_latest',
  };
}

export {
  buildFlowListUrl,
  buildHeaders,
  buildAmbiguousMatchDetails,
  fetchOneFlowRow,
  latestRowsAreAmbiguous,
  listFlowRows,
  normalizeStateCodeList,
  normalizeSupabaseFlowPayload,
  normalizeTokenList,
  parseFlowRows,
};

export const __testInternals = {
  buildFlowListUrl,
  buildHeaders,
  buildAmbiguousMatchDetails,
  latestRowsAreAmbiguous,
  normalizeStateCodeList,
  normalizeSupabaseFlowPayload,
  normalizeTokenList,
  parseFlowRows,
};
