// data-api-relations: flowproperties, unitgroups
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  runAuthIdentityReceipt,
  type ResolveAuthIdentitySession,
} from './auth-identity-receipt.js';
import { CliError } from './errors.js';
import type { FetchLike, ResponseLike } from './http.js';
import {
  buildSnapshotCompleteness,
  fetchCompletePostgrestPages,
  parseExactContentRange,
  type DatasetMaintenanceSnapshotCompleteness,
} from './dataset-maintenance-pagination.js';
import {
  buildSupabaseAuthHeaders,
  deriveSupabaseRestBaseUrl,
  requireSupabaseRestRuntime,
} from './supabase-client.js';
import {
  applyDataApiProfileHeaders,
  buildDataApiUrl,
  resolveDataApiCapabilityFromUrl,
} from './supabase-data-api-contract.js';
import {
  resolveSupabaseUserSession,
  type ResolvedSupabaseUserSession,
} from './supabase-session.js';

const TABLES = ['flowproperties', 'unitgroups'] as const;
type Table = (typeof TABLES)[number];
type Row = { id: string; version: string; state_code: number; json: Record<string, unknown> };
const MAX_ROWS = 100_000;
const MAX_PAGES = 1_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_DURATION_MS = 120_000;

export type RunDatasetSupportCacheExportOptions = {
  outDir: string;
  env: NodeJS.ProcessEnv;
  fetchImpl: FetchLike;
  cliVersion: string;
  stateCodes?: number[];
  pageSize?: number;
  timeoutMs?: number;
  expectedProjectRef?: string;
  expectedUserId?: string;
  now?: Date;
  resolveSessionImpl?: ResolveAuthIdentitySession;
  monotonicNow?: () => number;
};

export type DatasetSupportCacheExportReport = {
  schema_version: 1;
  command: 'dataset support-cache export';
  status: 'completed';
  remote_write_mode: 'read-only';
  captured_at_utc: string;
  project_ref: string;
  account: { user_id: string; session_source: string };
  filters: { state_codes: number[]; requested_page_size: number };
  snapshot: { status: 'observed-stable'; transactional_snapshot: false; observations: 2 };
  completeness: DatasetMaintenanceSnapshotCompleteness<Table>[];
  tables: Record<Table, { rows: number; sha256: string }>;
  artifacts: Record<Table | 'identity' | 'report', string>;
};

function fail(code: string, message: string, exitCode = 1): never {
  throw new CliError(message, { code: `DATASET_SUPPORT_CACHE_${code}`, exitCode });
}

function integer(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    fail('OPTION_INVALID', `${label} is outside the supported integer range.`, 2);
  return value;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rowsFrom(value: unknown, states: readonly number[]): Row[] {
  if (!Array.isArray(value)) fail('ROWS_INVALID', 'Support response must be an array.');
  return value.map((row: unknown) => {
    if (
      !object(row) ||
      typeof row.id !== 'string' ||
      !row.id.trim() ||
      typeof row.version !== 'string' ||
      !row.version.trim() ||
      !Number.isSafeInteger(row.state_code) ||
      !object(row.json)
    )
      fail('ROWS_INVALID', 'Support response contains an invalid row.');
    if (!states.includes(row.state_code as number))
      fail('STATE_FENCE_VIOLATION', 'Support response escaped the requested state filters.');
    return {
      id: row.id,
      version: row.version,
      state_code: row.state_code as number,
      json: row.json,
    };
  });
}

async function readBounded(response: ResponseLike): Promise<string> {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES)
    fail('BYTE_LIMIT', 'Support response exceeded the byte limit.');
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES)
      fail('BYTE_LIMIT', 'Support response exceeded the byte limit.');
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        fail('BYTE_LIMIT', 'Support response exceeded the byte limit.');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

function rowBytes(rows: Row[]): string {
  return rows.map((row) => JSON.stringify(row) + '\n').join('');
}

function digest(bytes: string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function runDatasetSupportCacheExport(
  options: RunDatasetSupportCacheExportOptions,
): Promise<DatasetSupportCacheExportReport> {
  if (!options.outDir.trim()) fail('OUT_DIR_REQUIRED', 'A fresh --out-dir is required.', 2);
  const outDir = path.resolve(options.outDir);
  if (lstatSync(outDir, { throwIfNoEntry: false }))
    fail('OUTPUT_EXISTS', 'Support export output already exists.', 2);
  const pageSize = integer(options.pageSize ?? 1000, 1, 5000, 'Page size');
  const timeoutMs = integer(options.timeoutMs ?? 10000, 1, MAX_DURATION_MS, 'Timeout');
  const states = [...new Set(options.stateCodes ?? [100])].sort((a, b) => a - b);
  if (!states.length) fail('OPTION_INVALID', 'At least one state code is required.', 2);
  states.forEach((state) => integer(state, -2147483648, 2147483647, 'State code'));
  const runtime = requireSupabaseRestRuntime(options.env);
  if (runtime.authMode !== 'oauth')
    fail('OAUTH_REQUIRED', 'Support export requires a CLI OAuth session.', 2);
  const clock = options.monotonicNow ?? (() => performance.now());
  const started = clock();
  const overall = AbortSignal.timeout(MAX_DURATION_MS);
  const fetchImpl: FetchLike = (url, init = {}) =>
    options.fetchImpl(url, {
      ...init,
      signal: AbortSignal.any([overall, init.signal ?? AbortSignal.timeout(timeoutMs)]),
    });
  const resolver = options.resolveSessionImpl ?? resolveSupabaseUserSession;
  const holder: { session?: ResolvedSupabaseUserSession } = {};
  const identity = await runAuthIdentityReceipt({
    env: options.env,
    fetchImpl,
    cliVersion: options.cliVersion,
    expectedProjectRef: options.expectedProjectRef,
    expectedUserId: options.expectedUserId,
    timeoutMs,
    now: options.now,
    resolveSessionImpl: async (request) => {
      holder.session = await resolver(request);
      return holder.session;
    },
  });
  // The canonical identity runner resolves a session before it can return this receipt.
  const session = holder.session!;
  const restBase = deriveSupabaseRestBaseUrl(runtime.apiBaseUrl);
  let totalBytes = 0;
  const observations: Array<{
    rows: Record<Table, Row[]>;
    completeness: DatasetMaintenanceSnapshotCompleteness<Table>;
  }> = [];
  for (let observation = 0; observation < 2; observation += 1) {
    const collected = {} as Record<Table, Row[]>;
    const results = [];
    for (const table of TABLES) {
      let pages = 0;
      try {
        const result = await fetchCompletePostgrestPages({
          table,
          requestedPageSize: pageSize,
          rowIdentity: (row: Row) => `${row.id}@${row.version}`,
          fetchPage: async (offset) => {
            if (++pages > MAX_PAGES) fail('PAGE_LIMIT', 'Support export exceeded the page limit.');
            if (clock() - started >= MAX_DURATION_MS)
              fail('TIME_LIMIT', 'Support export exceeded the operation deadline.');
            const url = new URL(buildDataApiUrl(restBase, { kind: 'relation', name: table }));
            url.searchParams.set('select', 'id,version,state_code,json');
            url.searchParams.set('state_code', `in.(${states.join(',')})`);
            url.searchParams.set('order', 'id.asc,version.asc');
            url.searchParams.set('limit', String(pageSize));
            url.searchParams.set('offset', String(offset));
            const headers = applyDataApiProfileHeaders(
              {
                ...buildSupabaseAuthHeaders(runtime.publishableKey, session.accessToken),
                Prefer: 'count=exact',
              },
              resolveDataApiCapabilityFromUrl({ url: url.toString(), method: 'GET' }),
              'GET',
            );
            const response = await fetchImpl(url.toString(), {
              method: 'GET',
              headers,
              redirect: 'error',
            });
            if (!response.ok) fail('READ_FAILED', 'Support export request was rejected.');
            const range = response.headers.get('content-range');
            if (parseExactContentRange(range).total > MAX_ROWS)
              fail('ROW_LIMIT', 'Support export exceeded the row limit.');
            const text = await readBounded(response);
            totalBytes += Buffer.byteLength(text);
            if (totalBytes > MAX_TOTAL_BYTES)
              fail('BYTE_LIMIT', 'Support export exceeded the total byte limit.');
            let value: unknown;
            try {
              value = JSON.parse(text);
            } catch {
              fail('INVALID_JSON', 'Support response is not valid JSON.');
            }
            return {
              rows: rowsFrom(value, states),
              source_url: url.toString(),
              content_range: range,
            };
          },
        });
        collected[table] = result.rows;
        results.push({ table, completeness: result.completeness });
      } catch (error) {
        if (error instanceof CliError && error.code.startsWith('DATASET_SUPPORT_CACHE_'))
          throw error;
        if (error instanceof CliError && error.code === 'DATASET_MAINTENANCE_SNAPSHOT_INCOMPLETE')
          fail('SNAPSHOT_INCOMPLETE', 'Support pagination completeness could not be proven.');
        fail('READ_FAILED', 'Support export request failed.');
      }
    }
    observations.push({
      rows: collected,
      completeness: buildSnapshotCompleteness({
        tables: TABLES,
        requestedPageSize: pageSize,
        results,
      }),
    });
  }
  const first = observations[0]!;
  const second = observations[1]!;
  const bytes = {
    flowproperties: rowBytes(first.rows.flowproperties),
    unitgroups: rowBytes(first.rows.unitgroups),
  };
  for (const table of TABLES) {
    if (digest(bytes[table]) !== digest(rowBytes(second.rows[table])))
      fail('CONTENT_DRIFT', 'Support rows changed between observations.');
  }
  const artifacts = {
    flowproperties: path.join(outDir, 'flowproperties.jsonl'),
    unitgroups: path.join(outDir, 'unitgroups.jsonl'),
    identity: path.join(outDir, 'identity-receipt.json'),
    report: path.join(outDir, 'export-report.json'),
  };
  const report: DatasetSupportCacheExportReport = {
    schema_version: 1,
    command: 'dataset support-cache export',
    status: 'completed',
    remote_write_mode: 'read-only',
    captured_at_utc: identity.captured_at_utc,
    project_ref: identity.project.project_ref,
    account: { user_id: identity.identity.user_id, session_source: identity.session.source },
    filters: { state_codes: states, requested_page_size: pageSize },
    snapshot: { status: 'observed-stable', transactional_snapshot: false, observations: 2 },
    completeness: observations.map((item) => item.completeness),
    tables: {
      flowproperties: {
        rows: first.rows.flowproperties.length,
        sha256: digest(bytes.flowproperties),
      },
      unitgroups: { rows: first.rows.unitgroups.length, sha256: digest(bytes.unitgroups) },
    },
    artifacts,
  };
  if (clock() - started >= MAX_DURATION_MS)
    fail('TIME_LIMIT', 'Support export exceeded the operation deadline.');
  try {
    mkdirSync(path.dirname(outDir), { recursive: true, mode: 0o700 });
    mkdirSync(outDir, { mode: 0o700 });
  } catch (error) {
    // Reservation failure must never clean another writer's output.
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      fail('OUTPUT_EXISTS', 'Support export output already exists.', 2);
    fail('ARTIFACT_WRITE_FAILED', 'Support export could not reserve its output directory.');
  }
  try {
    for (const table of TABLES)
      writeFileSync(artifacts[table], bytes[table], { flag: 'wx', mode: 0o600 });
    writeFileSync(artifacts.identity, JSON.stringify(identity) + '\n', { flag: 'wx', mode: 0o600 });
    writeFileSync(artifacts.report + '.tmp', JSON.stringify(report) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    renameSync(artifacts.report + '.tmp', artifacts.report);
  } catch {
    rmSync(outDir, { recursive: true, force: true });
    fail('ARTIFACT_WRITE_FAILED', 'Support export could not publish its completion report.');
  }
  return report;
}
