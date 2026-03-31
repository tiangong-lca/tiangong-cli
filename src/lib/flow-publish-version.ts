import { existsSync } from 'node:fs';
import path from 'node:path';
import { writeJsonArtifact, writeJsonLinesArtifact } from './artifacts.js';
import { CliError } from './errors.js';
import {
  coerceText,
  deepGet,
  isRecord,
  loadRowsFromFile,
  type JsonRecord,
} from './flow-governance.js';
import type { FetchLike, ResponseLike } from './http.js';
import { deriveSupabaseRestBaseUrl, requireSupabaseRestRuntime } from './supabase-rest.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_WORKERS = 4;
const LEGACY_OUTPUT_PREFIX = 'flows_tidas_sdk_plus_classification';

type FlowPublishMode = 'dry_run' | 'commit';
type FlowPublishOperation =
  | 'would_insert'
  | 'would_update_existing'
  | 'insert'
  | 'update_existing'
  | 'update_after_insert_error';

type FlowPublishFailureReason = {
  validator: 'remote_rest';
  stage: string;
  path: string;
  message: string;
  code: string;
  visible_user_id?: string;
  visible_state_code?: string;
};

type VisibleFlowRow = {
  id: string;
  version: string;
  user_id: string;
  state_code: number | null;
};

type FlowPublishFailureRow = {
  id: unknown;
  user_id: unknown;
  json_ordered: JsonRecord;
  reason: FlowPublishFailureReason[];
  state_code: unknown;
};

type FlowPublishSuccessRow = {
  id: string;
  version: string;
  operation: FlowPublishOperation;
};

type FlowPublishFiles = {
  successList: string;
  remoteFailed: string;
  report: string;
};

type FlowPublishOutcome =
  | {
      status: 'success';
      success: FlowPublishSuccessRow;
    }
  | {
      status: 'failure';
      failure: FlowPublishFailureRow;
    };

export type FlowPublishVersionReport = {
  schema_version: 1;
  generated_at_utc: string;
  status:
    | 'prepared_flow_publish_version'
    | 'completed_flow_publish_version'
    | 'completed_flow_publish_version_with_failures';
  mode: FlowPublishMode;
  input_file: string;
  out_dir: string;
  counts: {
    total_rows: number;
    success_count: number;
    failure_count: number;
  };
  operation_counts: Record<string, number>;
  max_workers: number;
  limit: number | null;
  target_user_id_override: string | null;
  files: {
    success_list: string;
    remote_failed: string;
    report: string;
  };
};

export type RunFlowPublishVersionOptions = {
  inputFile: string;
  outDir: string;
  commit?: boolean;
  maxWorkers?: number;
  limit?: number;
  targetUserId?: string | null;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: Date;
};

function normalize_token(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function assert_input_file(inputFile: string): string {
  const resolved = path.resolve(inputFile);
  if (!inputFile) {
    throw new CliError('Missing required --input-file value.', {
      code: 'FLOW_PUBLISH_VERSION_INPUT_REQUIRED',
      exitCode: 2,
    });
  }
  if (!existsSync(resolved)) {
    throw new CliError(`Flow publish-version input file not found: ${resolved}`, {
      code: 'FLOW_PUBLISH_VERSION_INPUT_NOT_FOUND',
      exitCode: 2,
    });
  }
  return resolved;
}

function assert_out_dir(outDir: string): string {
  if (!outDir) {
    throw new CliError('Missing required --out-dir value.', {
      code: 'FLOW_PUBLISH_VERSION_OUT_DIR_REQUIRED',
      exitCode: 2,
    });
  }
  return path.resolve(outDir);
}

function to_positive_integer(
  value: number | undefined,
  label: string,
  code: string,
  defaultValue: number,
): number {
  if (value === undefined) {
    return defaultValue;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new CliError(`Expected ${label} to be a positive integer.`, {
      code,
      exitCode: 2,
    });
  }
  return value;
}

function to_non_negative_integer(
  value: number | undefined,
  label: string,
  code: string,
): number | null {
  if (value === undefined) {
    return null;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new CliError(`Expected ${label} to be a non-negative integer.`, {
      code,
      exitCode: 2,
    });
  }
  return value;
}

function build_output_files(outDir: string): FlowPublishFiles {
  return {
    successList: path.join(outDir, `${LEGACY_OUTPUT_PREFIX}_mcp_success_list.json`),
    remoteFailed: path.join(outDir, `${LEGACY_OUTPUT_PREFIX}_remote_validation_failed.jsonl`),
    report: path.join(outDir, `${LEGACY_OUTPUT_PREFIX}_mcp_sync_report.json`),
  };
}

function flow_payload(row: JsonRecord): JsonRecord {
  if (isRecord(row.json_ordered)) {
    return row.json_ordered;
  }
  if (isRecord(row.jsonOrdered)) {
    return row.jsonOrdered;
  }
  if (isRecord(row.json)) {
    return row.json;
  }
  if (isRecord(row.flowDataSet)) {
    return row;
  }
  throw new CliError(
    'Flow row is missing json_ordered/jsonOrdered/json or a top-level flowDataSet payload.',
    {
      code: 'FLOW_PUBLISH_VERSION_PAYLOAD_REQUIRED',
      exitCode: 2,
    },
  );
}

function flow_id(row: JsonRecord, payload: JsonRecord): string {
  return (
    coerceText(row.id) ||
    coerceText(
      deepGet(payload, ['flowDataSet', 'flowInformation', 'dataSetInformation', 'common:UUID']),
    )
  );
}

function flow_version(payload: JsonRecord): string {
  const version = coerceText(
    deepGet(payload, [
      'flowDataSet',
      'administrativeInformation',
      'publicationAndOwnership',
      'common:dataSetVersion',
    ]),
  );
  if (!version) {
    throw new CliError(
      'Flow payload is missing flowDataSet.administrativeInformation.publicationAndOwnership.common:dataSetVersion.',
      {
        code: 'FLOW_PUBLISH_VERSION_MISSING_VERSION',
        exitCode: 2,
      },
    );
  }
  return version;
}

function resolve_target_user_id(
  row: JsonRecord,
  targetUserIdOverride: string | null,
): string | null {
  return normalize_token(coerceText(row.user_id)) ?? targetUserIdOverride;
}

function build_headers(
  apiKey: string,
  extraHeaders: Record<string, string> = {},
): Record<string, string> {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
    apikey: apiKey,
    ...extraHeaders,
  };
}

function build_visible_rows_url(restBaseUrl: string, id: string, version: string): string {
  const url = new URL(`${restBaseUrl.replace(/\/+$/u, '')}/flows`);
  url.searchParams.set('select', 'id,version,user_id,state_code');
  url.searchParams.set('id', `eq.${id}`);
  url.searchParams.set('version', `eq.${version}`);
  return url.toString();
}

function build_update_url(restBaseUrl: string, id: string, version: string): string {
  const url = new URL(`${restBaseUrl.replace(/\/+$/u, '')}/flows`);
  url.searchParams.set('id', `eq.${id}`);
  url.searchParams.set('version', `eq.${version}`);
  return url.toString();
}

async function parse_response(response: ResponseLike, url: string): Promise<unknown> {
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

async function request_json(options: {
  method: 'GET' | 'POST' | 'PATCH';
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  fetchImpl: FetchLike;
}): Promise<unknown> {
  const signal = AbortSignal.timeout(options.timeoutMs);
  const response = await options.fetchImpl(options.url, {
    method: options.method,
    headers: options.headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal,
  });
  return parse_response(response, options.url);
}

function parse_visible_rows(payload: unknown, url: string): VisibleFlowRow[] {
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
      id: coerceText(item.id),
      version: coerceText(item.version),
      user_id: coerceText(item.user_id),
      state_code: typeof item.state_code === 'number' ? item.state_code : null,
    };
  });
}

async function visible_exact_rows(options: {
  restBaseUrl: string;
  apiKey: string;
  id: string;
  version: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
}): Promise<VisibleFlowRow[]> {
  const url = build_visible_rows_url(options.restBaseUrl, options.id, options.version);
  const payload = await request_json({
    method: 'GET',
    url,
    headers: build_headers(options.apiKey),
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  });
  return parse_visible_rows(payload, url);
}

function own_visible_row(
  rows: VisibleFlowRow[],
  targetUserId: string | null,
): VisibleFlowRow | null {
  if (!targetUserId) {
    return null;
  }
  return rows.find((row) => row.user_id === targetUserId) ?? null;
}

function visible_conflict_reasons(
  stage: string,
  visibleRows: VisibleFlowRow[],
  targetUserId: string | null,
): FlowPublishFailureReason[] {
  if (visibleRows.length === 0) {
    return [];
  }

  if (!targetUserId) {
    return [
      {
        validator: 'remote_rest',
        stage,
        path: '',
        message:
          'Exact UUID/version is already visible, but no target user id was available to determine whether the row is writable.',
        code: 'target_user_id_required',
      },
    ];
  }

  return visibleRows.map((row) => ({
    validator: 'remote_rest',
    stage,
    path: '',
    message: 'Exact UUID/version is already visible but not writable under the target user.',
    code: 'exact_version_visible_not_owned',
    visible_user_id: row.user_id,
    visible_state_code: row.state_code === null ? '' : String(row.state_code),
  }));
}

function failure_row(
  sourceRow: JsonRecord,
  reasons: FlowPublishFailureReason[],
): FlowPublishFailureRow {
  let payload: JsonRecord;
  try {
    payload = flow_payload(sourceRow);
  } catch {
    payload = {};
  }
  return {
    id: sourceRow.id,
    user_id: sourceRow.user_id,
    json_ordered: payload,
    reason: reasons,
    state_code: sourceRow.state_code,
  };
}

function build_error_reasons(stage: string, error: unknown): FlowPublishFailureReason[] {
  if (error instanceof CliError) {
    const detailText = typeof error.details === 'string' ? error.details.trim() : error.message;
    return [
      {
        validator: 'remote_rest',
        stage,
        path: '',
        message: detailText || error.message,
        code: error.code,
      },
    ];
  }

  if (error instanceof Error) {
    return [
      {
        validator: 'remote_rest',
        stage,
        path: '',
        message: error.message,
        code: error.name || 'Error',
      },
    ];
  }

  return [
    {
      validator: 'remote_rest',
      stage,
      path: '',
      message: String(error),
      code: 'UnknownError',
    },
  ];
}

async function insert_flow_version(options: {
  restBaseUrl: string;
  apiKey: string;
  rowId: string;
  payload: JsonRecord;
  timeoutMs: number;
  fetchImpl: FetchLike;
}): Promise<void> {
  await request_json({
    method: 'POST',
    url: `${options.restBaseUrl.replace(/\/+$/u, '')}/flows`,
    headers: build_headers(options.apiKey, {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }),
    body: {
      id: options.rowId,
      json_ordered: options.payload,
    },
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  });
}

async function update_flow_version(options: {
  restBaseUrl: string;
  apiKey: string;
  rowId: string;
  version: string;
  payload: JsonRecord;
  timeoutMs: number;
  fetchImpl: FetchLike;
}): Promise<void> {
  await request_json({
    method: 'PATCH',
    url: build_update_url(options.restBaseUrl, options.rowId, options.version),
    headers: build_headers(options.apiKey, {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }),
    body: {
      json_ordered: options.payload,
    },
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  });
}

async function sync_one_row(options: {
  row: JsonRecord;
  mode: FlowPublishMode;
  restBaseUrl: string;
  apiKey: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
  targetUserIdOverride: string | null;
}): Promise<FlowPublishOutcome> {
  try {
    const payload = flow_payload(options.row);
    const rowId = flow_id(options.row, payload);
    if (!rowId) {
      throw new CliError('Flow row is missing a resolvable id/common:UUID value.', {
        code: 'FLOW_PUBLISH_VERSION_ID_REQUIRED',
        exitCode: 2,
      });
    }
    const version = flow_version(payload);
    const targetUserId = resolve_target_user_id(options.row, options.targetUserIdOverride);
    const visibleBefore = await visible_exact_rows({
      restBaseUrl: options.restBaseUrl,
      apiKey: options.apiKey,
      id: rowId,
      version,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });
    const ownBefore = own_visible_row(visibleBefore, targetUserId);

    if (options.mode === 'dry_run') {
      if (ownBefore) {
        return {
          status: 'success',
          success: {
            id: rowId,
            version,
            operation: 'would_update_existing',
          },
        };
      }

      if (visibleBefore.length > 0) {
        return {
          status: 'failure',
          failure: failure_row(
            options.row,
            visible_conflict_reasons('dry_run_preflight', visibleBefore, targetUserId),
          ),
        };
      }

      return {
        status: 'success',
        success: {
          id: rowId,
          version,
          operation: 'would_insert',
        },
      };
    }

    if (ownBefore) {
      await update_flow_version({
        restBaseUrl: options.restBaseUrl,
        apiKey: options.apiKey,
        rowId,
        version,
        payload,
        timeoutMs: options.timeoutMs,
        fetchImpl: options.fetchImpl,
      });
      return {
        status: 'success',
        success: {
          id: rowId,
          version,
          operation: 'update_existing',
        },
      };
    }

    if (visibleBefore.length > 0) {
      return {
        status: 'failure',
        failure: failure_row(
          options.row,
          visible_conflict_reasons('preflight', visibleBefore, targetUserId),
        ),
      };
    }

    try {
      await insert_flow_version({
        restBaseUrl: options.restBaseUrl,
        apiKey: options.apiKey,
        rowId,
        payload,
        timeoutMs: options.timeoutMs,
        fetchImpl: options.fetchImpl,
      });
      return {
        status: 'success',
        success: {
          id: rowId,
          version,
          operation: 'insert',
        },
      };
    } catch (error) {
      const visibleAfter = await visible_exact_rows({
        restBaseUrl: options.restBaseUrl,
        apiKey: options.apiKey,
        id: rowId,
        version,
        timeoutMs: options.timeoutMs,
        fetchImpl: options.fetchImpl,
      });
      const ownAfter = own_visible_row(visibleAfter, targetUserId);
      if (ownAfter) {
        try {
          await update_flow_version({
            restBaseUrl: options.restBaseUrl,
            apiKey: options.apiKey,
            rowId,
            version,
            payload,
            timeoutMs: options.timeoutMs,
            fetchImpl: options.fetchImpl,
          });
          return {
            status: 'success',
            success: {
              id: rowId,
              version,
              operation: 'update_after_insert_error',
            },
          };
        } catch (updateError) {
          return {
            status: 'failure',
            failure: failure_row(options.row, [
              ...build_error_reasons('insert', error),
              ...build_error_reasons('update_after_insert_error', updateError),
            ]),
          };
        }
      }

      return {
        status: 'failure',
        failure: failure_row(options.row, [
          ...build_error_reasons('insert', error),
          ...visible_conflict_reasons('post_insert_error_preflight', visibleAfter, targetUserId),
        ]),
      };
    }
  } catch (error) {
    return {
      status: 'failure',
      failure: failure_row(options.row, build_error_reasons('sync_one_unhandled', error)),
    };
  }
}

async function map_with_concurrency<T, R>(
  items: T[],
  maxWorkers: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const workerCount = Math.min(Math.max(1, maxWorkers), Math.max(items.length, 1));
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }
      results[currentIndex] = await worker(items[currentIndex] as T, currentIndex);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

function status_from_mode(
  mode: FlowPublishMode,
  failureCount: number,
): FlowPublishVersionReport['status'] {
  if (mode === 'dry_run') {
    return 'prepared_flow_publish_version';
  }
  return failureCount > 0
    ? 'completed_flow_publish_version_with_failures'
    : 'completed_flow_publish_version';
}

export async function runFlowPublishVersion(
  options: RunFlowPublishVersionOptions,
): Promise<FlowPublishVersionReport> {
  const inputFile = assert_input_file(options.inputFile);
  const outDir = assert_out_dir(options.outDir);
  const mode: FlowPublishMode = options.commit ? 'commit' : 'dry_run';
  const maxWorkers = to_positive_integer(
    options.maxWorkers,
    '--max-workers',
    'FLOW_PUBLISH_VERSION_MAX_WORKERS_INVALID',
    DEFAULT_MAX_WORKERS,
  );
  const limit = to_non_negative_integer(
    options.limit,
    '--limit',
    'FLOW_PUBLISH_VERSION_LIMIT_INVALID',
  );
  const runtime = requireSupabaseRestRuntime(options.env ?? process.env);
  const restBaseUrl = deriveSupabaseRestBaseUrl(runtime.apiBaseUrl);
  const fetchImpl = options.fetchImpl ?? (fetch as FetchLike);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const targetUserIdOverride = normalize_token(options.targetUserId ?? null);
  const files = build_output_files(outDir);

  let rows = loadRowsFromFile(inputFile);
  if (limit !== null && limit > 0) {
    rows = rows.slice(0, limit);
  }
  if (rows.length === 0) {
    throw new CliError(`No rows found in ${inputFile}`, {
      code: 'FLOW_PUBLISH_VERSION_EMPTY_INPUT',
      exitCode: 2,
    });
  }

  const outcomes = await map_with_concurrency(rows, maxWorkers, async (row) =>
    sync_one_row({
      row,
      mode,
      restBaseUrl,
      apiKey: runtime.apiKey,
      timeoutMs,
      fetchImpl,
      targetUserIdOverride,
    }),
  );

  const successes: FlowPublishSuccessRow[] = [];
  const failures: FlowPublishFailureRow[] = [];
  const operationCounts: Record<string, number> = {};

  for (const outcome of outcomes) {
    if (outcome.status === 'success') {
      successes.push(outcome.success);
      operationCounts[outcome.success.operation] =
        (operationCounts[outcome.success.operation] ?? 0) + 1;
    } else {
      failures.push(outcome.failure);
    }
  }

  await writeJsonArtifact(files.successList, successes);
  await writeJsonLinesArtifact(files.remoteFailed, failures);

  const report: FlowPublishVersionReport = {
    schema_version: 1,
    generated_at_utc: (options.now ?? new Date()).toISOString(),
    status: status_from_mode(mode, failures.length),
    mode,
    input_file: inputFile,
    out_dir: outDir,
    counts: {
      total_rows: rows.length,
      success_count: successes.length,
      failure_count: failures.length,
    },
    operation_counts: operationCounts,
    max_workers: maxWorkers,
    limit,
    target_user_id_override: targetUserIdOverride,
    files: {
      success_list: files.successList,
      remote_failed: files.remoteFailed,
      report: files.report,
    },
  };

  await writeJsonArtifact(files.report, report);
  return report;
}

export const __testInternals = {
  assert_input_file,
  assert_out_dir,
  to_positive_integer,
  to_non_negative_integer,
  build_output_files,
  flow_payload,
  flow_id,
  flow_version,
  resolve_target_user_id,
  build_visible_rows_url,
  build_update_url,
  parse_response,
  parse_visible_rows,
  visible_conflict_reasons,
  failure_row,
  build_error_reasons,
  map_with_concurrency,
  status_from_mode,
};
