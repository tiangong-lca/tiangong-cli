import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  readJsonArtifact,
  readJsonLinesArtifact,
  writeJsonArtifact,
  writeJsonLinesArtifact,
} from './artifacts.js';
import { CliError } from './errors.js';
import { buildResumeMetadata, writeLatestRunId, type RunLayout } from './run.js';
import { withStateFileLock } from './state-lock.js';

type JsonRecord = Record<string, unknown>;

export type ProcessResumeBuildLayout = {
  runId: string;
  runRoot: string;
  collectionDir: string;
  cacheDir: string;
  manifestsDir: string;
  reportsDir: string;
  latestRunIdPath: string;
  statePath: string;
  handoffSummaryPath: string;
  runManifestPath: string;
  invocationIndexPath: string;
  resumeMetadataPath: string;
  resumeHistoryPath: string;
  reportPath: string;
};

export type ProcessResumeBuildReport = {
  schema_version: 1;
  generated_at_utc: string;
  status: 'prepared_local_process_resume_run';
  run_id: string;
  run_root: string;
  request_id: string | null;
  resumed_from: string;
  checkpoint: string | null;
  attempt: number;
  state_summary: {
    build_status: string | null;
    next_stage: string | null;
    stop_after: string | null;
    process_count: number;
    matched_exchange_count: number;
    process_dataset_count: number;
    source_dataset_count: number;
  };
  files: {
    state: string;
    handoff_summary: string;
    run_manifest: string;
    invocation_index: string;
    resume_metadata: string;
    resume_history: string;
    report: string;
  };
  next_actions: string[];
};

export type RunProcessResumeBuildOptions = {
  runId?: string;
  runDir?: string | null;
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

function readRequiredJsonObject(
  filePath: string,
  missingCode: string,
  invalidCode: string,
  label: string,
): JsonRecord {
  if (!existsSync(filePath)) {
    throw new CliError(`Required process resume artifact not found: ${filePath}`, {
      code: missingCode,
      exitCode: 2,
      details: { label, filePath },
    });
  }

  const value = readJsonArtifact(filePath);
  if (!isRecord(value)) {
    throw new CliError(`Expected process resume artifact JSON object: ${filePath}`, {
      code: invalidCode,
      exitCode: 2,
      details: { label, filePath },
    });
  }

  return value;
}

function buildLayout(runRoot: string, runId: string): ProcessResumeBuildLayout {
  const collectionDir = path.dirname(runRoot);

  return {
    runId,
    runRoot,
    collectionDir,
    cacheDir: path.join(runRoot, 'cache'),
    manifestsDir: path.join(runRoot, 'manifests'),
    reportsDir: path.join(runRoot, 'reports'),
    latestRunIdPath: path.join(collectionDir, '.latest_run_id'),
    statePath: path.join(runRoot, 'cache', 'process_from_flow_state.json'),
    handoffSummaryPath: path.join(runRoot, 'cache', 'agent_handoff_summary.json'),
    runManifestPath: path.join(runRoot, 'manifests', 'run-manifest.json'),
    invocationIndexPath: path.join(runRoot, 'manifests', 'invocation-index.json'),
    resumeMetadataPath: path.join(runRoot, 'manifests', 'resume-metadata.json'),
    resumeHistoryPath: path.join(runRoot, 'manifests', 'resume-history.jsonl'),
    reportPath: path.join(runRoot, 'reports', 'process-resume-build-report.json'),
  };
}

function resolveLayout(options: RunProcessResumeBuildOptions): ProcessResumeBuildLayout {
  const runId = nonEmptyString(options.runId);
  const runDir = nonEmptyString(options.runDir);

  if (!runId && !runDir) {
    throw new CliError('Missing required --run-id or --run-dir for process resume-build.', {
      code: 'PROCESS_RESUME_RUN_REQUIRED',
      exitCode: 2,
    });
  }

  const runRoot = runDir
    ? path.resolve(runDir)
    : path.resolve('artifacts', 'process_from_flow', runId as string);
  const derivedRunId = path.basename(runRoot);

  if (runDir && runId && derivedRunId !== runId) {
    throw new CliError(
      `process resume-build run-id does not match run-dir basename: ${runId} !== ${derivedRunId}`,
      {
        code: 'PROCESS_RESUME_RUN_ID_MISMATCH',
        exitCode: 2,
      },
    );
  }

  return buildLayout(runRoot, runId ?? derivedRunId);
}

function ensureRunRootExists(layout: ProcessResumeBuildLayout): void {
  if (!existsSync(layout.runRoot)) {
    throw new CliError(`process resume-build run root not found: ${layout.runRoot}`, {
      code: 'PROCESS_RESUME_RUN_NOT_FOUND',
      exitCode: 2,
    });
  }
}

function readRequiredRunManifest(layout: ProcessResumeBuildLayout): JsonRecord {
  const manifest = readRequiredJsonObject(
    layout.runManifestPath,
    'PROCESS_RESUME_RUN_MANIFEST_MISSING',
    'PROCESS_RESUME_RUN_MANIFEST_INVALID',
    'run-manifest',
  );

  const manifestRunId = nonEmptyString(manifest.runId);
  if (manifestRunId && manifestRunId !== layout.runId) {
    throw new CliError(
      `process resume-build run manifest runId mismatch: ${layout.runManifestPath}`,
      {
        code: 'PROCESS_RESUME_RUN_MANIFEST_MISMATCH',
        exitCode: 2,
        details: {
          expected: layout.runId,
          actual: manifestRunId,
        },
      },
    );
  }

  return manifest;
}

function readRequiredState(layout: ProcessResumeBuildLayout): JsonRecord {
  const state = readRequiredJsonObject(
    layout.statePath,
    'PROCESS_RESUME_STATE_MISSING',
    'PROCESS_RESUME_STATE_INVALID',
    'state',
  );

  const stateRunId = nonEmptyString(state.run_id);
  if (stateRunId && stateRunId !== layout.runId) {
    throw new CliError(`process resume-build state run_id mismatch: ${layout.statePath}`, {
      code: 'PROCESS_RESUME_STATE_RUN_ID_MISMATCH',
      exitCode: 2,
      details: {
        expected: layout.runId,
        actual: stateRunId,
      },
    });
  }

  return state;
}

function readRequiredHandoffSummary(layout: ProcessResumeBuildLayout): JsonRecord {
  return readRequiredJsonObject(
    layout.handoffSummaryPath,
    'PROCESS_RESUME_HANDOFF_MISSING',
    'PROCESS_RESUME_HANDOFF_INVALID',
    'handoff-summary',
  );
}

function readInvocationIndex(layout: ProcessResumeBuildLayout): JsonRecord {
  if (!existsSync(layout.invocationIndexPath)) {
    return {
      schema_version: 1,
      invocations: [],
    };
  }

  const value = readJsonArtifact(layout.invocationIndexPath);
  if (!isRecord(value)) {
    throw new CliError(
      `Expected process resume invocation index JSON object: ${layout.invocationIndexPath}`,
      {
        code: 'PROCESS_RESUME_INVOCATION_INDEX_INVALID',
        exitCode: 2,
      },
    );
  }

  if (value.invocations === undefined) {
    return {
      schema_version: 1,
      invocations: [],
    };
  }

  if (!Array.isArray(value.invocations)) {
    throw new CliError(
      `Expected process resume invocation index to contain an invocations array: ${layout.invocationIndexPath}`,
      {
        code: 'PROCESS_RESUME_INVOCATION_INDEX_INVALID',
        exitCode: 2,
      },
    );
  }

  return value;
}

function readResumeHistory(layout: ProcessResumeBuildLayout): JsonRecord[] {
  if (!existsSync(layout.resumeHistoryPath)) {
    return [];
  }

  const rows = readJsonLinesArtifact(layout.resumeHistoryPath);
  return rows.map((row, index) => {
    if (!isRecord(row)) {
      throw new CliError(
        `Expected process resume history JSONL rows to be objects: ${layout.resumeHistoryPath}`,
        {
          code: 'PROCESS_RESUME_HISTORY_INVALID',
          exitCode: 2,
          details: { index },
        },
      );
    }

    return row;
  });
}

function stateArrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function buildStateSummary(state: JsonRecord): ProcessResumeBuildReport['state_summary'] {
  return {
    build_status: nonEmptyString(state.build_status),
    next_stage: nonEmptyString(state.next_stage),
    stop_after: nonEmptyString(state.stop_after),
    process_count: stateArrayLength(state.processes),
    matched_exchange_count: stateArrayLength(state.matched_process_exchanges),
    process_dataset_count: stateArrayLength(state.process_datasets),
    source_dataset_count: stateArrayLength(state.source_datasets),
  };
}

function resolveResumedFrom(state: JsonRecord): string {
  return nonEmptyString(state.next_stage) ?? nonEmptyString(state.build_status) ?? 'unknown';
}

function nextAttempt(history: JsonRecord[]): number {
  return (
    history.reduce((maxAttempt, entry) => {
      const attempt = entry.attempt;
      return typeof attempt === 'number' && Number.isFinite(attempt) && attempt > maxAttempt
        ? attempt
        : maxAttempt;
    }, 0) + 1
  );
}

function updateStepMarkers(stepMarkers: unknown, completedAt: string): JsonRecord {
  const markers = isRecord(stepMarkers) ? { ...stepMarkers } : {};
  markers.resume_prepared = {
    status: 'completed',
    completed_at: completedAt,
  };
  return markers;
}

function buildUpdatedState(state: JsonRecord, resumeMetadata: JsonRecord, now: Date): JsonRecord {
  return {
    ...state,
    build_status: 'resume_prepared',
    stop_after: null,
    resume_attempt: resumeMetadata.attempt,
    resume_requested_at: now.toISOString(),
    last_resume_metadata: resumeMetadata,
    step_markers: updateStepMarkers(state.step_markers, now.toISOString()),
  };
}

function buildInvocationIndex(
  layout: ProcessResumeBuildLayout,
  invocationIndex: JsonRecord,
  options: RunProcessResumeBuildOptions,
  now: Date,
): JsonRecord {
  const priorInvocations = Array.isArray(invocationIndex.invocations)
    ? [...invocationIndex.invocations]
    : [];
  const command = ['process', 'resume-build'];

  if (options.runId) {
    command.push('--run-id', options.runId);
  }
  if (options.runDir) {
    command.push('--run-dir', options.runDir);
  }

  return {
    ...invocationIndex,
    schema_version:
      typeof invocationIndex.schema_version === 'number' ? invocationIndex.schema_version : 1,
    invocations: [
      ...priorInvocations,
      {
        command,
        cwd: options.cwd ?? process.cwd(),
        created_at: now.toISOString(),
        run_id: layout.runId,
        run_root: layout.runRoot,
        report_path: layout.reportPath,
      },
    ],
  };
}

function asRunLayout(layout: ProcessResumeBuildLayout): RunLayout {
  return {
    namespace: 'process_from_flow',
    runId: layout.runId,
    artifactsRoot: path.dirname(layout.collectionDir),
    collectionDir: layout.collectionDir,
    runRoot: layout.runRoot,
    cacheDir: layout.cacheDir,
    inputsDir: path.join(layout.runRoot, 'input'),
    outputsDir: path.join(layout.runRoot, 'exports'),
    reportsDir: layout.reportsDir,
    logsDir: path.join(layout.runRoot, 'logs'),
    manifestsDir: layout.manifestsDir,
    latestRunIdPath: layout.latestRunIdPath,
  };
}

function buildNextActions(
  layout: ProcessResumeBuildLayout,
  summary: ProcessResumeBuildReport['state_summary'],
): string[] {
  return [
    `inspect: ${layout.statePath}`,
    `inspect: ${layout.resumeMetadataPath}`,
    `inspect: ${layout.invocationIndexPath}`,
    summary.next_stage
      ? `future: migrate CLI stage executor for ${summary.next_stage}`
      : `future: inspect completed run state for ${layout.runId}`,
    `future: tiangong process publish-build --run-id ${layout.runId}`,
  ];
}

function buildAgentHandoffSummary(
  layout: ProcessResumeBuildLayout,
  state: JsonRecord,
  resumeMetadata: JsonRecord,
  summary: ProcessResumeBuildReport['state_summary'],
  now: Date,
): JsonRecord {
  return {
    schema_version: 1,
    generated_at_utc: now.toISOString(),
    run_id: layout.runId,
    command: 'process resume-build',
    flow_path: nonEmptyString(state.flow_path),
    operation: nonEmptyString(state.operation),
    stop_after: null,
    process_count: summary.process_count,
    matched_exchange_count: summary.matched_exchange_count,
    process_dataset_count: summary.process_dataset_count,
    source_dataset_count: summary.source_dataset_count,
    remaining_placeholder_refs: stateArrayLength(state.placeholder_resolutions),
    placeholder_examples: [],
    publish_summary: {},
    artifacts: {
      state_path: layout.statePath,
      timing_report: null,
      publish_summary: null,
      llm_cost_report: null,
      process_update_report: null,
      flow_auto_build_manifest: null,
      resume_metadata: layout.resumeMetadataPath,
      resume_history: layout.resumeHistoryPath,
      invocation_index: layout.invocationIndexPath,
    },
    next_actions: buildNextActions(layout, summary),
    extra: {
      status: 'prepared_local_process_resume_run',
      request_id: nonEmptyString(state.request_id),
      resumed_from: resumeMetadata.resumedFrom,
      checkpoint: resumeMetadata.checkpoint,
      attempt: resumeMetadata.attempt,
    },
  };
}

function buildReport(
  layout: ProcessResumeBuildLayout,
  state: JsonRecord,
  resumeMetadata: JsonRecord,
  summary: ProcessResumeBuildReport['state_summary'],
  now: Date,
): ProcessResumeBuildReport {
  return {
    schema_version: 1,
    generated_at_utc: now.toISOString(),
    status: 'prepared_local_process_resume_run',
    run_id: layout.runId,
    run_root: layout.runRoot,
    request_id: nonEmptyString(state.request_id),
    resumed_from: String(resumeMetadata.resumedFrom),
    checkpoint: resumeMetadata.checkpoint === null ? null : String(resumeMetadata.checkpoint ?? ''),
    attempt: Number(resumeMetadata.attempt ?? 1),
    state_summary: summary,
    files: {
      state: layout.statePath,
      handoff_summary: layout.handoffSummaryPath,
      run_manifest: layout.runManifestPath,
      invocation_index: layout.invocationIndexPath,
      resume_metadata: layout.resumeMetadataPath,
      resume_history: layout.resumeHistoryPath,
      report: layout.reportPath,
    },
    next_actions: buildNextActions(layout, summary),
  };
}

export async function runProcessResumeBuild(
  options: RunProcessResumeBuildOptions,
): Promise<ProcessResumeBuildReport> {
  const now = options.now ?? new Date();
  const layout = resolveLayout(options);
  ensureRunRootExists(layout);
  readRequiredRunManifest(layout);
  readRequiredHandoffSummary(layout);
  const history = readResumeHistory(layout);
  const invocationIndex = readInvocationIndex(layout);

  return await withStateFileLock(
    layout.statePath,
    { reason: 'process-resume-build.prepare_resume', now },
    () => {
      const state = readRequiredState(layout);
      const resumeMetadata = buildResumeMetadata({
        runId: layout.runId,
        resumedFrom: resolveResumedFrom(state),
        checkpoint: nonEmptyString(state.stop_after),
        attempt: nextAttempt(history),
        resumedAt: now,
      });
      const updatedState = buildUpdatedState(state, resumeMetadata, now);
      const summary = buildStateSummary(updatedState);
      const updatedInvocationIndex = buildInvocationIndex(layout, invocationIndex, options, now);
      const handoffSummary = buildAgentHandoffSummary(
        layout,
        updatedState,
        resumeMetadata,
        summary,
        now,
      );
      const report = buildReport(layout, updatedState, resumeMetadata, summary, now);

      writeJsonArtifact(layout.statePath, updatedState);
      writeJsonArtifact(layout.invocationIndexPath, updatedInvocationIndex);
      writeJsonArtifact(layout.resumeMetadataPath, resumeMetadata);
      writeJsonLinesArtifact(layout.resumeHistoryPath, resumeMetadata, { append: true });
      writeJsonArtifact(layout.handoffSummaryPath, handoffSummary);
      writeLatestRunId(asRunLayout(layout), layout.runId);
      writeJsonArtifact(layout.reportPath, report);

      return report;
    },
  );
}

// Exposed for deterministic unit coverage of process resume-build helpers.
export const __testInternals = {
  buildLayout,
  resolveLayout,
  buildStateSummary,
  resolveResumedFrom,
  nextAttempt,
  updateStepMarkers,
  buildUpdatedState,
  buildInvocationIndex,
  buildNextActions,
  buildReport,
};
