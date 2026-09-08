// data-api-relations: flows, processes, lifecyclemodels
import { CliError } from './errors.js';
import {
  buildSnapshotCompleteness,
  fetchCompletePostgrestPages,
  parseExactContentRange,
} from './dataset-maintenance-pagination.js';
import type { FetchLike } from './http.js';
import {
  createSupabaseFetch,
  deriveSupabaseRestBaseUrl,
  requireSupabaseRestRuntime,
  type SupabaseDataRuntime,
} from './supabase-client.js';
import {
  applyDataApiProfileHeaders,
  buildDataApiUrl,
  resolveDataApiCapabilityFromUrl,
} from './supabase-data-api-contract.js';
import { createSupabaseDataRuntime } from './supabase-session.js';
import {
  OVERVIEW_TABLES,
  overviewError,
  parseOverviewRow,
  type OverviewRow,
} from './dataset-overview-records.js';
import { overviewHash, writeOverviewArtifacts } from './dataset-overview-io.js';

export type OverviewCaptureOptions = {
  outDir: string;
  env: NodeJS.ProcessEnv;
  fetchImpl: FetchLike;
  pageSize?: number;
  maxRows?: number;
  maxBytes?: number;
  now?: () => Date;
  dataRuntime?: SupabaseDataRuntime;
};

function integer(value: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    overviewError('Overview capture limit is outside the supported integer range.');
  return value;
}

async function boundedText(response: Response, budget: number): Promise<string> {
  if (Number(response.headers.get('content-length')) > budget)
    overviewError('Overview response byte limit exceeded.');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > budget) {
        await reader.cancel();
        overviewError('Overview response byte limit exceeded.');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function captureOverview(options: OverviewCaptureOptions) {
  if (!options.outDir.trim()) overviewError('A fresh --out-dir is required.');
  const pageSize = integer(options.pageSize ?? 250, 5000);
  const maxRows = integer(options.maxRows ?? 250_000, 1_000_000);
  const maxBytes = integer(options.maxBytes ?? 512 * 1024 * 1024, 1024 * 1024 * 1024);
  const now = options.now ?? (() => new Date());
  const started = now().toISOString();
  const runtime =
    options.dataRuntime ??
    createSupabaseDataRuntime({
      runtime: requireSupabaseRestRuntime(options.env),
      fetchImpl: options.fetchImpl,
    });
  const fetch = createSupabaseFetch(options.fetchImpl, 30_000, runtime);
  const deadline = AbortSignal.timeout(30 * 60 * 1000);
  const base = deriveSupabaseRestBaseUrl(runtime.apiBaseUrl);
  const files: Record<string, string> = {};
  const hashes: Record<string, string> = {};
  const results = [];
  let totalBytes = 0;
  for (const table of OVERVIEW_TABLES) {
    try {
      const result = await fetchCompletePostgrestPages<OverviewRow>({
        table,
        requestedPageSize: pageSize,
        rowIdentity: (row) => `${row.id}@${row.version}`,
        fetchPage: async (offset) => {
          const url = new URL(buildDataApiUrl(base, { kind: 'relation', name: table }));
          url.searchParams.set('select', 'id,version,state_code,modified_at,json');
          url.searchParams.set('state_code', 'eq.100');
          url.searchParams.set('order', 'id.asc,version.asc');
          url.searchParams.set('offset', String(offset));
          url.searchParams.set('limit', String(pageSize));
          const headers = applyDataApiProfileHeaders(
            { Prefer: 'count=exact' },
            resolveDataApiCapabilityFromUrl({ url: url.toString(), method: 'GET' }),
            'GET',
          );
          const response = await fetch(url, {
            method: 'GET',
            headers,
            redirect: 'error',
            signal: deadline,
          });
          if (!response.ok)
            overviewError(`Public ${table} capture was rejected (HTTP ${response.status}).`);
          const range = response.headers.get('content-range');
          if (parseExactContentRange(range).total > maxRows)
            overviewError(
              `Public ${table} capture exceeds --max-rows; no partial capture is accepted.`,
            );
          const bytes = await boundedText(
            response,
            Math.min(16 * 1024 * 1024, maxBytes - totalBytes),
          );
          totalBytes += Buffer.byteLength(bytes);
          const rows: unknown = JSON.parse(bytes);
          if (!Array.isArray(rows)) overviewError('Public overview response is not a row array.');
          return {
            rows: rows.map(parseOverviewRow),
            source_url: url.toString(),
            content_range: range,
          };
        },
      });
      const bytes = result.rows.map((row) => JSON.stringify(row) + '\n').join('');
      files[`${table}.jsonl`] = bytes;
      hashes[table] = overviewHash(bytes);
      results.push({ table, completeness: result.completeness });
    } catch (error) {
      if (error instanceof CliError) throw error;
      overviewError(`Public ${table} capture failed; no completed capture was written.`);
    }
  }
  const capture = {
    schema_version: 'tiangong-lca.overview-capture.v1',
    visibility: 'public_state_100_all_owners',
    remote_write_mode: 'read-only',
    source: new URL(base).origin,
    started_at_utc: started,
    finished_at_utc: now().toISOString(),
    transactional_snapshot: false,
    observation:
      'Pagination complete under stable membership/order; requests are not a transaction and concurrent content changes may be observed.',
    completeness: buildSnapshotCompleteness({
      tables: OVERVIEW_TABLES,
      requestedPageSize: pageSize,
      results,
    }),
    sha256: hashes,
  };
  // Completion marker is last. Reserving a fresh directory prevents overwriting another run.
  files['capture.json'] = JSON.stringify(capture, null, 2) + '\n';
  return { ...capture, artifacts: writeOverviewArtifacts(options.outDir, files) };
}
