import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { readJsonInput } from './io.js';
import { writeJsonArtifact } from './artifacts.js';
import { CliError, toErrorPayload, type ErrorPayload } from './errors.js';
import {
  normalizeProcessAutoBuildRequest,
  runProcessAutoBuild,
  type ProcessAutoBuildReport,
} from './process-auto-build.js';
import {
  buildRunId,
  buildRunManifest,
  ensureRunLayout,
  sanitizeRunToken,
  writeLatestRunId,
  type RunLayout,
} from './run.js';

type JsonRecord = Record<string, unknown>;

type ProcessBatchBuildStatus = 'completed' | 'completed_with_failures';
type ProcessBatchBuildItemStatus = 'prepared' | 'failed' | 'skipped';

type ProcessBatchBuildManifestItem = {
  item_id: string;
  input_path: string;
  out_dir: string;
};

export type ProcessBatchBuildLayout = RunLayout & {
  requestDir: string;
  runsDir: string;
  requestSnapshotPath: string;
  normalizedRequestPath: string;
  invocationIndexPath: string;
  runManifestPath: string;
  reportPath: string;
};

export type NormalizedProcessBatchBuildRequest = {
  schema_version: 1;
  manifest_path: string;
  batch_id: string;
  batch_root: string;
  continue_on_error: boolean;
  items: ProcessBatchBuildManifestItem[];
};

export type ProcessBatchBuildItemReport = {
  item_id: string;
  index: number;
  input_path: string;
  out_dir: string;
  status: ProcessBatchBuildItemStatus;
  run_id: string | null;
  run_root: string | null;
  request_id: string | null;
  files: {
    request_snapshot: string | null;
    report: string | null;
    state: string | null;
    handoff_summary: string | null;
    run_manifest: string | null;
  };
  error: ErrorPayload['error'] | null;
};

export type ProcessBatchBuildReport = {
  schema_version: 1;
  generated_at_utc: string;
  status: ProcessBatchBuildStatus;
  manifest_path: string;
  batch_id: string;
  batch_root: string;
  continue_on_error: boolean;
  counts: {
    total: number;
    prepared: number;
    failed: number;
    skipped: number;
  };
  files: {
    request_snapshot: string;
    normalized_request: string;
    invocation_index: string;
    run_manifest: string;
    report: string;
  };
  items: ProcessBatchBuildItemReport[];
  next_actions: string[];
};

export type RunProcessBatchBuildOptions = {
  inputPath: string;
  outDir?: string | null;
  now?: Date;
  cwd?: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function requiredRequestObject(input: unknown): JsonRecord {
  if (!isRecord(input)) {
    throw new CliError('process batch-build request must be a JSON object.', {
      code: 'PROCESS_BATCH_BUILD_REQUEST_INVALID',
      exitCode: 2,
    });
  }

  return input;
}

function resolveBatchRoot(
  manifestDir: string,
  batchId: string,
  outDirOverride: string | null | undefined,
  requestOutDir: unknown,
): string {
  const override = nonEmptyString(outDirOverride);
  if (override) {
    return path.resolve(manifestDir, override);
  }

  const requestValue = nonEmptyString(requestOutDir);
  if (requestValue) {
    return path.resolve(manifestDir, requestValue);
  }

  return path.join(manifestDir, 'artifacts', 'process_batch', batchId);
}

function buildLayout(batchRoot: string, batchId: string): ProcessBatchBuildLayout {
  const collectionDir = path.dirname(batchRoot);
  const layout: RunLayout = {
    namespace: 'process_batch',
    runId: batchId,
    artifactsRoot: path.dirname(collectionDir),
    collectionDir,
    runRoot: batchRoot,
    cacheDir: path.join(batchRoot, 'cache'),
    inputsDir: path.join(batchRoot, 'request'),
    outputsDir: path.join(batchRoot, 'runs'),
    reportsDir: path.join(batchRoot, 'reports'),
    logsDir: path.join(batchRoot, 'logs'),
    manifestsDir: path.join(batchRoot, 'manifests'),
    latestRunIdPath: path.join(collectionDir, '.latest_run_id'),
  };

  return {
    ...layout,
    requestDir: path.join(batchRoot, 'request'),
    runsDir: path.join(batchRoot, 'runs'),
    requestSnapshotPath: path.join(batchRoot, 'request', 'batch-request.json'),
    normalizedRequestPath: path.join(batchRoot, 'request', 'request.normalized.json'),
    invocationIndexPath: path.join(batchRoot, 'manifests', 'invocation-index.json'),
    runManifestPath: path.join(batchRoot, 'manifests', 'run-manifest.json'),
    reportPath: path.join(batchRoot, 'reports', 'process-batch-build-report.json'),
  };
}

function ensureEmptyRunRoot(runRoot: string): void {
  if (!existsSync(runRoot)) {
    return;
  }

  const entries = readdirSync(runRoot);
  if (entries.length > 0) {
    throw new CliError(`process batch-build run root already exists and is not empty: ${runRoot}`, {
      code: 'PROCESS_BATCH_BUILD_RUN_EXISTS',
      exitCode: 2,
    });
  }
}

function ensureProcessBatchBuildLayout(layout: ProcessBatchBuildLayout): void {
  ensureRunLayout(layout);
  [layout.requestDir, layout.runsDir].forEach((dirPath) => {
    mkdirSync(dirPath, { recursive: true });
  });
}

function normalizeBatchId(inputPath: string, request: JsonRecord, now: Date): string {
  const explicit = nonEmptyString(request.batch_id);
  if (explicit) {
    return explicit;
  }

  return buildRunId({
    namespace: 'process_batch',
    subject: path.basename(inputPath, path.extname(inputPath)),
    operation: 'build',
    now,
  });
}

function normalizeItemId(
  request: JsonRecord,
  inputPath: string,
  index: number,
  seenIds: Set<string>,
): string {
  const explicit = nonEmptyString(request.item_id);
  const baseId = sanitizeRunToken(
    explicit ?? path.basename(inputPath, path.extname(inputPath)),
    `item_${index + 1}`,
  );

  if (explicit) {
    if (seenIds.has(baseId)) {
      throw new CliError(`Duplicate process batch-build item_id: ${baseId}`, {
        code: 'PROCESS_BATCH_BUILD_ITEM_DUPLICATE',
        exitCode: 2,
      });
    }

    seenIds.add(baseId);
    return baseId;
  }

  if (!seenIds.has(baseId)) {
    seenIds.add(baseId);
    return baseId;
  }

  let suffix = 2;
  while (seenIds.has(`${baseId}_${suffix}`)) {
    suffix += 1;
  }

  const deduped = `${baseId}_${suffix}`;
  seenIds.add(deduped);
  return deduped;
}

function normalizeItems(
  value: unknown,
  manifestDir: string,
  batchRoot: string,
): ProcessBatchBuildManifestItem[] {
  if (!Array.isArray(value)) {
    throw new CliError('process batch-build items must be an array.', {
      code: 'PROCESS_BATCH_BUILD_REQUEST_INVALID',
      exitCode: 2,
    });
  }

  if (value.length === 0) {
    throw new CliError('process batch-build items must not be empty.', {
      code: 'PROCESS_BATCH_BUILD_REQUEST_INVALID',
      exitCode: 2,
    });
  }

  const seenIds = new Set<string>();

  return value.map((entry, index) => {
    const request = typeof entry === 'string' ? { input_path: entry } : entry;
    if (!isRecord(request)) {
      throw new CliError('process batch-build items entries must be strings or objects.', {
        code: 'PROCESS_BATCH_BUILD_REQUEST_INVALID',
        exitCode: 2,
        details: { index },
      });
    }

    const inputValue = nonEmptyString(request.input_path);
    if (!inputValue) {
      throw new CliError("process batch-build items[] is missing 'input_path'.", {
        code: 'PROCESS_BATCH_BUILD_REQUEST_INVALID',
        exitCode: 2,
        details: { index },
      });
    }

    const inputPath = path.resolve(manifestDir, inputValue);
    const itemId = normalizeItemId(request, inputPath, index, seenIds);
    const explicitOutDir = nonEmptyString(request.out_dir);
    const outDir = explicitOutDir
      ? path.resolve(manifestDir, explicitOutDir)
      : path.join(batchRoot, 'runs', `${String(index + 1).padStart(3, '0')}_${itemId}`);

    return {
      item_id: itemId,
      input_path: inputPath,
      out_dir: outDir,
    };
  });
}

export function normalizeProcessBatchBuildRequest(
  input: unknown,
  options: {
    inputPath: string;
    outDir?: string | null;
    now?: Date;
  },
): NormalizedProcessBatchBuildRequest {
  const request = requiredRequestObject(input);
  const manifestPath = path.resolve(options.inputPath);
  const manifestDir = path.dirname(manifestPath);
  const now = options.now ?? new Date();
  const batchId = normalizeBatchId(manifestPath, request, now);
  const batchRoot = resolveBatchRoot(manifestDir, batchId, options.outDir, request.out_dir);

  return {
    schema_version: 1,
    manifest_path: manifestPath,
    batch_id: batchId,
    batch_root: batchRoot,
    continue_on_error: normalizeBoolean(request.continue_on_error, true),
    items: normalizeItems(request.items, manifestDir, batchRoot),
  };
}

function buildInvocationIndex(
  normalized: NormalizedProcessBatchBuildRequest,
  options: RunProcessBatchBuildOptions,
  layout: ProcessBatchBuildLayout,
  now: Date,
): JsonRecord {
  const command = ['process', 'batch-build', '--input', options.inputPath];
  if (options.outDir) {
    command.push('--out-dir', options.outDir);
  }

  return {
    schema_version: 1,
    invocations: [
      {
        command,
        cwd: options.cwd ?? process.cwd(),
        created_at: now.toISOString(),
        manifest_path: normalized.manifest_path,
        batch_id: normalized.batch_id,
        report_path: layout.reportPath,
      },
    ],
  };
}

function buildNextActions(layout: ProcessBatchBuildLayout): string[] {
  return [
    `inspect: ${layout.normalizedRequestPath}`,
    `inspect: ${layout.reportPath}`,
    `future: consume items[].run_root for downstream resume-build or publish-build steps`,
  ];
}

function buildPreparedItemResult(
  item: ProcessBatchBuildManifestItem,
  index: number,
  report: ProcessAutoBuildReport,
): ProcessBatchBuildItemReport {
  return {
    item_id: item.item_id,
    index,
    input_path: item.input_path,
    out_dir: item.out_dir,
    status: 'prepared',
    run_id: report.run_id,
    run_root: report.run_root,
    request_id: report.request_id,
    files: {
      request_snapshot: report.files.request_snapshot,
      report: report.files.report,
      state: report.files.state,
      handoff_summary: report.files.handoff_summary,
      run_manifest: report.files.run_manifest,
    },
    error: null,
  };
}

function buildFailedItemResult(
  item: ProcessBatchBuildManifestItem,
  index: number,
  error: unknown,
): ProcessBatchBuildItemReport {
  return {
    item_id: item.item_id,
    index,
    input_path: item.input_path,
    out_dir: item.out_dir,
    status: 'failed',
    run_id: null,
    run_root: null,
    request_id: null,
    files: {
      request_snapshot: null,
      report: null,
      state: null,
      handoff_summary: null,
      run_manifest: null,
    },
    error: toErrorPayload(error).error,
  };
}

function buildSkippedItemResult(
  item: ProcessBatchBuildManifestItem,
  index: number,
): ProcessBatchBuildItemReport {
  return {
    item_id: item.item_id,
    index,
    input_path: item.input_path,
    out_dir: item.out_dir,
    status: 'skipped',
    run_id: null,
    run_root: null,
    request_id: null,
    files: {
      request_snapshot: null,
      report: null,
      state: null,
      handoff_summary: null,
      run_manifest: null,
    },
    error: null,
  };
}

function buildReport(
  normalized: NormalizedProcessBatchBuildRequest,
  layout: ProcessBatchBuildLayout,
  items: ProcessBatchBuildItemReport[],
  now: Date,
): ProcessBatchBuildReport {
  const counts = items.reduce(
    (summary, item) => {
      summary.total += 1;
      if (item.status === 'prepared') {
        summary.prepared += 1;
      } else if (item.status === 'failed') {
        summary.failed += 1;
      } else {
        summary.skipped += 1;
      }

      return summary;
    },
    {
      total: 0,
      prepared: 0,
      failed: 0,
      skipped: 0,
    },
  );

  return {
    schema_version: 1,
    generated_at_utc: now.toISOString(),
    status: counts.failed > 0 ? 'completed_with_failures' : 'completed',
    manifest_path: normalized.manifest_path,
    batch_id: normalized.batch_id,
    batch_root: normalized.batch_root,
    continue_on_error: normalized.continue_on_error,
    counts,
    files: {
      request_snapshot: layout.requestSnapshotPath,
      normalized_request: layout.normalizedRequestPath,
      invocation_index: layout.invocationIndexPath,
      run_manifest: layout.runManifestPath,
      report: layout.reportPath,
    },
    items,
    next_actions: buildNextActions(layout),
  };
}

function resolveItemOverrides(
  itemInput: unknown,
  item: ProcessBatchBuildManifestItem,
  index: number,
  now: Date,
): {
  runIdOverride?: string;
  requestIdOverride?: string;
  finalRunId: string | null;
} {
  if (!isRecord(itemInput)) {
    return {
      finalRunId: null,
    };
  }

  const explicitRunId = nonEmptyString(itemInput.run_id);
  const explicitRequestId = nonEmptyString(itemInput.request_id);
  if (explicitRunId) {
    return {
      finalRunId: explicitRunId,
      requestIdOverride: explicitRequestId ? undefined : `pff-${explicitRunId}`,
    };
  }

  const preview = normalizeProcessAutoBuildRequest(itemInput, {
    inputPath: item.input_path,
    outDir: item.out_dir,
    now,
  });
  const runIdOverride = `${preview.run_id}_b${String(index + 1).padStart(3, '0')}`;

  return {
    runIdOverride,
    requestIdOverride: explicitRequestId ?? `pff-${runIdOverride}`,
    finalRunId: runIdOverride,
  };
}

export async function runProcessBatchBuild(
  options: RunProcessBatchBuildOptions,
): Promise<ProcessBatchBuildReport> {
  const input = readJsonInput(options.inputPath);
  const now = options.now ?? new Date();
  const normalized = normalizeProcessBatchBuildRequest(input, {
    inputPath: options.inputPath,
    outDir: options.outDir,
    now,
  });
  const layout = buildLayout(normalized.batch_root, normalized.batch_id);

  ensureEmptyRunRoot(layout.runRoot);
  ensureProcessBatchBuildLayout(layout);

  writeJsonArtifact(layout.requestSnapshotPath, input);
  writeJsonArtifact(layout.normalizedRequestPath, normalized);
  writeJsonArtifact(
    layout.invocationIndexPath,
    buildInvocationIndex(normalized, options, layout, now),
  );
  writeJsonArtifact(
    layout.runManifestPath,
    buildRunManifest({
      layout,
      command: options.outDir
        ? ['process', 'batch-build', '--input', options.inputPath, '--out-dir', options.outDir]
        : ['process', 'batch-build', '--input', options.inputPath],
      cwd: options.cwd,
      createdAt: now,
    }),
  );

  const seenRunIds = new Set<string>();
  const items: ProcessBatchBuildItemReport[] = [];
  let stopAfterFailure = false;

  for (const [index, item] of normalized.items.entries()) {
    if (stopAfterFailure) {
      items.push(buildSkippedItemResult(item, index));
      continue;
    }

    try {
      const itemInput = readJsonInput(item.input_path);
      const overrides = resolveItemOverrides(itemInput, item, index, now);

      if (overrides.finalRunId && seenRunIds.has(overrides.finalRunId)) {
        throw new CliError(`Duplicate process batch-build run_id: ${overrides.finalRunId}`, {
          code: 'PROCESS_BATCH_BUILD_RUN_ID_DUPLICATE',
          exitCode: 2,
          details: { itemId: item.item_id, index },
        });
      }

      if (overrides.finalRunId) {
        seenRunIds.add(overrides.finalRunId);
      }

      const report = await runProcessAutoBuild({
        inputPath: item.input_path,
        inputValue: itemInput,
        outDir: item.out_dir,
        now,
        cwd: options.cwd,
        requestIdOverride: overrides.requestIdOverride,
        runIdOverride: overrides.runIdOverride,
      });
      items.push(buildPreparedItemResult(item, index, report));
    } catch (error) {
      items.push(buildFailedItemResult(item, index, error));
      if (!normalized.continue_on_error) {
        stopAfterFailure = true;
      }
    }
  }

  const report = buildReport(normalized, layout, items, now);
  writeJsonArtifact(layout.reportPath, report);
  writeLatestRunId(layout, normalized.batch_id);
  return report;
}

export const __testInternals = {
  buildLayout,
  resolveBatchRoot,
  normalizeItems,
  normalizeProcessBatchBuildRequest,
  buildInvocationIndex,
  buildNextActions,
  buildReport,
};
