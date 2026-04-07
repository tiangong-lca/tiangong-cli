import path from 'node:path';
import { writeJsonArtifact, writeJsonLinesArtifact } from './artifacts.js';
import { CliError } from './errors.js';
import { loadRowsFromFile, type JsonRecord } from './flow-governance.js';
import type { FetchLike } from './http.js';
import {
  fetchOneFlowRow,
  normalizeSupabaseFlowPayload,
  type SupabaseFlowLookup,
} from './flow-read.js';
import { requireSupabaseRestRuntime } from './supabase-rest.js';
import { createSupabaseDataRuntime } from './supabase-session.js';

const FLOW_FETCH_ROWS_TIMEOUT_MS = 10_000;

type FlowFetchRef = {
  id: string;
  version: string | null;
  userId: string | null;
  stateCode: number | null;
  clusterId: string | null;
  source: string | null;
};

type FlowFetchMaterializationContext = {
  input_index: number;
  requested_ref: {
    id: string;
    version: string | null;
    user_id: string | null;
    state_code: number | null;
    cluster_id: string | null;
    source: string | null;
  };
  resolution: SupabaseFlowLookup['resolution'];
  source_url: string;
  resolved_flow_id: string;
  resolved_version: string;
};

type FlowFetchSummaryStatus =
  | 'completed_flow_row_materialization'
  | 'completed_flow_row_materialization_with_gaps';

export type RunFlowFetchRowsOptions = {
  refsFile: string;
  outDir: string;
  allowLatestFallback?: boolean;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: Date;
};

export type FlowFetchRowsReport = {
  schema_version: 1;
  generated_at_utc: string;
  status: FlowFetchSummaryStatus;
  refs_file: string;
  out_dir: string;
  allow_latest_fallback: boolean;
  requested_ref_count: number;
  resolved_ref_count: number;
  review_input_row_count: number;
  duplicate_review_input_rows_collapsed: number;
  missing_ref_count: number;
  ambiguous_ref_count: number;
  resolution_counts: Record<SupabaseFlowLookup['resolution'], number>;
  files: {
    resolved_flow_rows: string;
    review_input_rows: string;
    fetch_summary: string;
    missing_flow_refs: string;
    ambiguous_flow_refs: string;
  };
};

function normalizeToken(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalNonNegativeInteger(
  value: unknown,
  label: string,
  code: string,
): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed =
    typeof value === 'number' && Number.isInteger(value)
      ? value
      : Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CliError(`Expected ${label} to be a non-negative integer.`, {
      code,
      exitCode: 2,
      details: value,
    });
  }
  return parsed;
}

function normalizeFlowFetchRef(row: JsonRecord, index: number): FlowFetchRef {
  const id = normalizeToken(row.id);
  if (!id) {
    throw new CliError(`Flow ref row ${index + 1} is missing required id.`, {
      code: 'FLOW_FETCH_ROWS_REF_ID_REQUIRED',
      exitCode: 2,
      details: row,
    });
  }

  return {
    id,
    version: normalizeToken(row.version),
    userId: normalizeToken(row.user_id ?? row.userId),
    stateCode: normalizeOptionalNonNegativeInteger(
      row.state_code ?? row.stateCode,
      'flow ref state_code',
      'FLOW_FETCH_ROWS_INVALID_STATE_CODE',
    ),
    clusterId: normalizeToken(row.cluster_id ?? row.clusterId),
    source: normalizeToken(row.source),
  };
}

function toRequestedRefSummary(
  ref: FlowFetchRef,
): FlowFetchMaterializationContext['requested_ref'] {
  return {
    id: ref.id,
    version: ref.version,
    user_id: ref.userId,
    state_code: ref.stateCode,
    cluster_id: ref.clusterId,
    source: ref.source,
  };
}

function buildMaterializedRow(
  lookup: SupabaseFlowLookup,
  context: FlowFetchMaterializationContext,
): JsonRecord {
  const resolvedFlowId = lookup.row.id || context.requested_ref.id;
  const resolvedVersion = lookup.row.version || context.requested_ref.version || '';

  return {
    id: resolvedFlowId,
    version: resolvedVersion,
    user_id: lookup.row.user_id,
    state_code: lookup.row.state_code,
    modified_at: lookup.row.modified_at,
    json: normalizeSupabaseFlowPayload(lookup.row.json, `${resolvedFlowId}@${resolvedVersion}`),
    _materialization: context,
  };
}

function buildReviewInputRow(
  row: JsonRecord,
  flowKey: string,
  contexts: FlowFetchMaterializationContext[],
): JsonRecord {
  return {
    ...row,
    _materialization: {
      flow_key: flowKey,
      materialized_ref_count: contexts.length,
      materialized_from_refs: contexts,
    },
  };
}

function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

export async function runFlowFetchRows(
  options: RunFlowFetchRowsOptions,
): Promise<FlowFetchRowsReport> {
  const refsFile = normalizeToken(options.refsFile);
  if (!refsFile) {
    throw new CliError('Missing required --refs-file value.', {
      code: 'FLOW_FETCH_ROWS_REFS_FILE_REQUIRED',
      exitCode: 2,
    });
  }

  const outDir = normalizeToken(options.outDir);
  if (!outDir) {
    throw new CliError('Missing required --out-dir value.', {
      code: 'FLOW_FETCH_ROWS_OUT_DIR_REQUIRED',
      exitCode: 2,
    });
  }

  const resolvedRefsFile = path.resolve(refsFile);
  const resolvedOutDir = path.resolve(outDir);
  const allowLatestFallback = options.allowLatestFallback !== false;
  const rows = loadRowsFromFile(resolvedRefsFile);

  const fetchImpl = options.fetchImpl ?? (fetch as FetchLike);
  const timeoutMs = options.timeoutMs ?? FLOW_FETCH_ROWS_TIMEOUT_MS;
  const runtime = createSupabaseDataRuntime({
    runtime: requireSupabaseRestRuntime(options.env ?? process.env),
    fetchImpl,
    timeoutMs,
    now: options.now,
  });

  const resolvedRowArtifacts: JsonRecord[] = [];
  const missingRefs: JsonRecord[] = [];
  const ambiguousRefs: JsonRecord[] = [];
  const reviewInputByKey = new Map<
    string,
    { row: JsonRecord; contexts: FlowFetchMaterializationContext[] }
  >();
  const resolutionCounts: FlowFetchRowsReport['resolution_counts'] = {
    remote_supabase_exact: 0,
    remote_supabase_latest: 0,
    remote_supabase_latest_fallback: 0,
  };

  for (let index = 0; index < rows.length; index += 1) {
    const ref = normalizeFlowFetchRef(rows[index] as JsonRecord, index);
    const requestedRef = toRequestedRefSummary(ref);

    let lookup: SupabaseFlowLookup | null;
    try {
      lookup = await fetchOneFlowRow({
        runtime,
        id: ref.id,
        version: ref.version,
        userId: ref.userId,
        stateCode: ref.stateCode,
        timeoutMs,
        fetchImpl,
        fallbackToLatest: allowLatestFallback && ref.version !== null,
      });
    } catch (error) {
      if (error instanceof CliError && error.code === 'FLOW_GET_AMBIGUOUS') {
        ambiguousRefs.push({
          input_index: index,
          requested_ref: requestedRef,
          code: error.code,
          message: error.message,
          details: error.details,
        });
        continue;
      }
      throw error;
    }

    if (!lookup) {
      missingRefs.push({
        input_index: index,
        requested_ref: requestedRef,
        code: 'FLOW_GET_NOT_FOUND',
        message: ref.version
          ? `Could not resolve flow dataset for ${ref.id}@${ref.version}.`
          : `Could not resolve flow dataset for ${ref.id}.`,
      });
      continue;
    }

    resolutionCounts[lookup.resolution] += 1;
    const resolvedFlowId = lookup.row.id || ref.id;
    const resolvedVersion = lookup.row.version || ref.version || '';
    const context: FlowFetchMaterializationContext = {
      input_index: index,
      requested_ref: requestedRef,
      resolution: lookup.resolution,
      source_url: lookup.sourceUrl,
      resolved_flow_id: resolvedFlowId,
      resolved_version: resolvedVersion,
    };
    const materializedRow = buildMaterializedRow(lookup, context);
    resolvedRowArtifacts.push(materializedRow);

    const flowKey = `${resolvedFlowId}@${resolvedVersion}`;
    const existing = reviewInputByKey.get(flowKey);
    if (existing) {
      existing.contexts.push(context);
    } else {
      reviewInputByKey.set(flowKey, {
        row: materializedRow,
        contexts: [context],
      });
    }
  }

  const reviewInputRows = [...reviewInputByKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([flowKey, entry]) => buildReviewInputRow(entry.row, flowKey, entry.contexts));

  const duplicateReviewInputRowsCollapsed = resolvedRowArtifacts.length - reviewInputRows.length;
  const unresolvedRefCount = missingRefs.length + ambiguousRefs.length;
  const status: FlowFetchSummaryStatus =
    unresolvedRefCount > 0
      ? 'completed_flow_row_materialization_with_gaps'
      : 'completed_flow_row_materialization';

  const resolvedRowsPath = path.join(resolvedOutDir, 'resolved-flow-rows.jsonl');
  const reviewInputRowsPath = path.join(resolvedOutDir, 'review-input-rows.jsonl');
  const missingRefsPath = path.join(resolvedOutDir, 'missing-flow-refs.jsonl');
  const ambiguousRefsPath = path.join(resolvedOutDir, 'ambiguous-flow-refs.jsonl');
  const summaryPath = path.join(resolvedOutDir, 'fetch-summary.json');

  writeJsonLinesArtifact(resolvedRowsPath, resolvedRowArtifacts);
  writeJsonLinesArtifact(reviewInputRowsPath, reviewInputRows);
  writeJsonLinesArtifact(missingRefsPath, missingRefs);
  writeJsonLinesArtifact(ambiguousRefsPath, ambiguousRefs);

  const report: FlowFetchRowsReport = {
    schema_version: 1,
    generated_at_utc: nowIso(options.now),
    status,
    refs_file: resolvedRefsFile,
    out_dir: resolvedOutDir,
    allow_latest_fallback: allowLatestFallback,
    requested_ref_count: rows.length,
    resolved_ref_count: resolvedRowArtifacts.length,
    review_input_row_count: reviewInputRows.length,
    duplicate_review_input_rows_collapsed: duplicateReviewInputRowsCollapsed,
    missing_ref_count: missingRefs.length,
    ambiguous_ref_count: ambiguousRefs.length,
    resolution_counts: resolutionCounts,
    files: {
      resolved_flow_rows: resolvedRowsPath,
      review_input_rows: reviewInputRowsPath,
      fetch_summary: summaryPath,
      missing_flow_refs: missingRefsPath,
      ambiguous_flow_refs: ambiguousRefsPath,
    },
  };

  writeJsonArtifact(summaryPath, report);
  return report;
}

export const __testInternals = {
  normalizeFlowFetchRef,
  normalizeOptionalNonNegativeInteger,
  normalizeToken,
  toRequestedRefSummary,
};
