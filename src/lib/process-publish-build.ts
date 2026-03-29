import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { readJsonArtifact, writeJsonArtifact } from './artifacts.js';
import { CliError } from './errors.js';
import { normalizePublishRequest } from './publish.js';
import { withStateFileLock } from './state-lock.js';

type JsonRecord = Record<string, unknown>;

type DatasetOrigin = 'exports' | 'state';

export type ProcessPublishBuildLayout = {
  runId: string;
  runRoot: string;
  collectionDir: string;
  cacheDir: string;
  manifestsDir: string;
  reportsDir: string;
  processExportsDir: string;
  sourceExportsDir: string;
  publishStageDir: string;
  statePath: string;
  handoffSummaryPath: string;
  runManifestPath: string;
  invocationIndexPath: string;
  publishBundlePath: string;
  publishRequestPath: string;
  publishIntentPath: string;
  reportPath: string;
};

export type ProcessPublishBuildReport = {
  schema_version: 1;
  generated_at_utc: string;
  status: 'prepared_local_process_publish_bundle';
  run_id: string;
  run_root: string;
  request_id: string | null;
  state_summary: {
    build_status: string | null;
    next_stage: string | null;
    stop_after: string | null;
  };
  dataset_origins: {
    processes: DatasetOrigin;
    sources: DatasetOrigin;
  };
  counts: {
    processes: number;
    sources: number;
    relations: number;
  };
  publish_defaults: {
    commit: boolean;
    publish_lifecyclemodels: boolean;
    publish_processes: boolean;
    publish_sources: boolean;
    publish_relations: boolean;
    publish_process_build_runs: boolean;
    relation_mode: 'local_manifest_only';
  };
  files: {
    state: string;
    handoff_summary: string;
    run_manifest: string;
    invocation_index: string;
    publish_bundle: string;
    publish_request: string;
    publish_intent: string;
    report: string;
  };
  next_actions: string[];
};

export type RunProcessPublishBuildOptions = {
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

function copyJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readRequiredJsonObject(
  filePath: string,
  missingCode: string,
  invalidCode: string,
  label: string,
): JsonRecord {
  if (!existsSync(filePath)) {
    throw new CliError(`Required process publish artifact not found: ${filePath}`, {
      code: missingCode,
      exitCode: 2,
      details: { label, filePath },
    });
  }

  const value = readJsonArtifact(filePath);
  if (!isRecord(value)) {
    throw new CliError(`Expected process publish artifact JSON object: ${filePath}`, {
      code: invalidCode,
      exitCode: 2,
      details: { label, filePath },
    });
  }

  return value;
}

function buildLayout(runRoot: string, runId: string): ProcessPublishBuildLayout {
  return {
    runId,
    runRoot,
    collectionDir: path.dirname(runRoot),
    cacheDir: path.join(runRoot, 'cache'),
    manifestsDir: path.join(runRoot, 'manifests'),
    reportsDir: path.join(runRoot, 'reports'),
    processExportsDir: path.join(runRoot, 'exports', 'processes'),
    sourceExportsDir: path.join(runRoot, 'exports', 'sources'),
    publishStageDir: path.join(runRoot, 'stage_outputs', '10_publish'),
    statePath: path.join(runRoot, 'cache', 'process_from_flow_state.json'),
    handoffSummaryPath: path.join(runRoot, 'cache', 'agent_handoff_summary.json'),
    runManifestPath: path.join(runRoot, 'manifests', 'run-manifest.json'),
    invocationIndexPath: path.join(runRoot, 'manifests', 'invocation-index.json'),
    publishBundlePath: path.join(runRoot, 'stage_outputs', '10_publish', 'publish-bundle.json'),
    publishRequestPath: path.join(runRoot, 'stage_outputs', '10_publish', 'publish-request.json'),
    publishIntentPath: path.join(runRoot, 'stage_outputs', '10_publish', 'publish-intent.json'),
    reportPath: path.join(runRoot, 'reports', 'process-publish-build-report.json'),
  };
}

function resolveLayout(options: RunProcessPublishBuildOptions): ProcessPublishBuildLayout {
  const runId = nonEmptyString(options.runId);
  const runDir = nonEmptyString(options.runDir);

  if (!runId && !runDir) {
    throw new CliError('Missing required --run-id or --run-dir for process publish-build.', {
      code: 'PROCESS_PUBLISH_RUN_REQUIRED',
      exitCode: 2,
    });
  }

  const runRoot = runDir
    ? path.resolve(runDir)
    : path.resolve('artifacts', 'process_from_flow', runId as string);
  const derivedRunId = path.basename(runRoot);

  if (runDir && runId && derivedRunId !== runId) {
    throw new CliError(
      `process publish-build run-id does not match run-dir basename: ${runId} !== ${derivedRunId}`,
      {
        code: 'PROCESS_PUBLISH_RUN_ID_MISMATCH',
        exitCode: 2,
      },
    );
  }

  return buildLayout(runRoot, runId ?? derivedRunId);
}

function ensureRunRootExists(layout: ProcessPublishBuildLayout): void {
  if (!existsSync(layout.runRoot)) {
    throw new CliError(`process publish-build run root not found: ${layout.runRoot}`, {
      code: 'PROCESS_PUBLISH_RUN_NOT_FOUND',
      exitCode: 2,
    });
  }
}

function readRequiredRunManifest(layout: ProcessPublishBuildLayout): JsonRecord {
  const manifest = readRequiredJsonObject(
    layout.runManifestPath,
    'PROCESS_PUBLISH_RUN_MANIFEST_MISSING',
    'PROCESS_PUBLISH_RUN_MANIFEST_INVALID',
    'run-manifest',
  );

  const manifestRunId = nonEmptyString(manifest.runId);
  if (manifestRunId && manifestRunId !== layout.runId) {
    throw new CliError(
      `process publish-build run manifest runId mismatch: ${layout.runManifestPath}`,
      {
        code: 'PROCESS_PUBLISH_RUN_MANIFEST_MISMATCH',
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

function readRequiredState(layout: ProcessPublishBuildLayout): JsonRecord {
  const state = readRequiredJsonObject(
    layout.statePath,
    'PROCESS_PUBLISH_STATE_MISSING',
    'PROCESS_PUBLISH_STATE_INVALID',
    'state',
  );

  const stateRunId = nonEmptyString(state.run_id);
  if (stateRunId && stateRunId !== layout.runId) {
    throw new CliError(`process publish-build state run_id mismatch: ${layout.statePath}`, {
      code: 'PROCESS_PUBLISH_STATE_RUN_ID_MISMATCH',
      exitCode: 2,
      details: {
        expected: layout.runId,
        actual: stateRunId,
      },
    });
  }

  return state;
}

function readRequiredHandoffSummary(layout: ProcessPublishBuildLayout): JsonRecord {
  return readRequiredJsonObject(
    layout.handoffSummaryPath,
    'PROCESS_PUBLISH_HANDOFF_MISSING',
    'PROCESS_PUBLISH_HANDOFF_INVALID',
    'handoff-summary',
  );
}

function readInvocationIndex(layout: ProcessPublishBuildLayout): JsonRecord {
  if (!existsSync(layout.invocationIndexPath)) {
    return {
      schema_version: 1,
      invocations: [],
    };
  }

  const value = readJsonArtifact(layout.invocationIndexPath);
  if (!isRecord(value)) {
    throw new CliError(
      `Expected process publish invocation index JSON object: ${layout.invocationIndexPath}`,
      {
        code: 'PROCESS_PUBLISH_INVOCATION_INDEX_INVALID',
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
      `Expected process publish invocation index to contain an invocations array: ${layout.invocationIndexPath}`,
      {
        code: 'PROCESS_PUBLISH_INVOCATION_INDEX_INVALID',
        exitCode: 2,
      },
    );
  }

  return value;
}

function buildStateSummary(state: JsonRecord): ProcessPublishBuildReport['state_summary'] {
  return {
    build_status: nonEmptyString(state.build_status),
    next_stage: nonEmptyString(state.next_stage),
    stop_after: nonEmptyString(state.stop_after),
  };
}

function readDatasetArrayFromState(
  state: JsonRecord,
  key: 'process_datasets' | 'source_datasets',
): JsonRecord[] {
  if (state[key] === undefined) {
    return [];
  }

  if (!Array.isArray(state[key])) {
    throw new CliError(`process publish-build expected state.${key} to be an array.`, {
      code: 'PROCESS_PUBLISH_STATE_DATASETS_INVALID',
      exitCode: 2,
      details: { key },
    });
  }

  return state[key].map((item, index) => {
    if (!isRecord(item)) {
      throw new CliError(`process publish-build expected state.${key}[${index}] to be an object.`, {
        code: 'PROCESS_PUBLISH_STATE_DATASETS_INVALID',
        exitCode: 2,
        details: { key, index },
      });
    }

    return item;
  });
}

function readDatasetDir(dirPath: string, label: string): JsonRecord[] {
  if (!existsSync(dirPath)) {
    return [];
  }

  return readdirSync(dirPath)
    .filter((entry) => entry.endsWith('.json'))
    .sort()
    .map((entry) => {
      const filePath = path.join(dirPath, entry);
      const value = readJsonArtifact(filePath);
      if (!isRecord(value)) {
        throw new CliError(`Expected ${label} export JSON object: ${filePath}`, {
          code: 'PROCESS_PUBLISH_EXPORT_INVALID',
          exitCode: 2,
          details: { label, filePath },
        });
      }

      return value;
    });
}

function collectCanonicalDatasets(
  layout: ProcessPublishBuildLayout,
  state: JsonRecord,
): {
  processes: JsonRecord[];
  processOrigin: DatasetOrigin;
  sources: JsonRecord[];
  sourceOrigin: DatasetOrigin;
} {
  const processExports = readDatasetDir(layout.processExportsDir, 'process');
  const sourceExports = readDatasetDir(layout.sourceExportsDir, 'source');

  const stateProcesses = readDatasetArrayFromState(state, 'process_datasets');
  const stateSources = readDatasetArrayFromState(state, 'source_datasets');

  return {
    processes: processExports.length > 0 ? processExports : stateProcesses,
    processOrigin: processExports.length > 0 ? 'exports' : 'state',
    sources: sourceExports.length > 0 ? sourceExports : stateSources,
    sourceOrigin: sourceExports.length > 0 ? 'exports' : 'state',
  };
}

function updateStepMarkers(stepMarkers: unknown, completedAt: string): JsonRecord {
  const markers = isRecord(stepMarkers) ? { ...stepMarkers } : {};
  markers.publish_handoff_prepared = {
    status: 'completed',
    completed_at: completedAt,
  };
  return markers;
}

function buildUpdatedState(
  state: JsonRecord,
  layout: ProcessPublishBuildLayout,
  counts: ProcessPublishBuildReport['counts'],
  datasetOrigins: ProcessPublishBuildReport['dataset_origins'],
  now: Date,
): JsonRecord {
  return {
    ...state,
    publish_build_requested_at: now.toISOString(),
    last_publish_build: {
      status: 'prepared_local_process_publish_bundle',
      prepared_at: now.toISOString(),
      publish_bundle_path: layout.publishBundlePath,
      publish_request_path: layout.publishRequestPath,
      publish_intent_path: layout.publishIntentPath,
      process_count: counts.processes,
      source_count: counts.sources,
      relation_count: counts.relations,
      dataset_origins: datasetOrigins,
    },
    step_markers: updateStepMarkers(state.step_markers, now.toISOString()),
  };
}

function buildInvocationIndex(
  layout: ProcessPublishBuildLayout,
  invocationIndex: JsonRecord,
  options: RunProcessPublishBuildOptions,
  now: Date,
): JsonRecord {
  const priorInvocations = Array.isArray(invocationIndex.invocations)
    ? [...invocationIndex.invocations]
    : [];
  const command = ['process', 'publish-build'];

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
        publish_request_path: layout.publishRequestPath,
      },
    ],
  };
}

function buildPublishBundle(
  layout: ProcessPublishBuildLayout,
  state: JsonRecord,
  runManifest: JsonRecord,
  processes: JsonRecord[],
  sources: JsonRecord[],
  counts: ProcessPublishBuildReport['counts'],
  datasetOrigins: ProcessPublishBuildReport['dataset_origins'],
  now: Date,
): JsonRecord {
  return {
    generated_at_utc: now.toISOString(),
    run_id: layout.runId,
    run_root: layout.runRoot,
    request_id: nonEmptyString(state.request_id),
    status: 'prepared_local_process_publish_bundle',
    counts,
    dataset_origins: datasetOrigins,
    source_run: {
      build_status: nonEmptyString(state.build_status),
      next_stage: nonEmptyString(state.next_stage),
      stop_after: nonEmptyString(state.stop_after),
      run_manifest: copyJson(runManifest),
    },
    processes: copyJson(processes),
    sources: copyJson(sources),
    relations: [],
  };
}

function buildPublishRequest(): JsonRecord {
  return {
    inputs: {
      bundle_paths: ['./publish-bundle.json'],
    },
    publish: {
      commit: false,
      publish_lifecyclemodels: false,
      publish_processes: true,
      publish_sources: true,
      publish_relations: true,
      publish_process_build_runs: false,
      relation_mode: 'local_manifest_only',
    },
    out_dir: './publish-run',
  };
}

function buildPublishIntent(
  layout: ProcessPublishBuildLayout,
  counts: ProcessPublishBuildReport['counts'],
): JsonRecord {
  return {
    ok: true,
    command: 'publish run',
    input_path: layout.publishRequestPath,
    run_id: layout.runId,
    run_root: layout.runRoot,
    status: 'prepared_local_process_publish_bundle',
    process_count: counts.processes,
    source_count: counts.sources,
    relation_count: counts.relations,
  };
}

function buildNextActions(layout: ProcessPublishBuildLayout): string[] {
  return [
    `inspect: ${layout.publishBundlePath}`,
    `inspect: ${layout.publishRequestPath}`,
    `run: tiangong publish run --input ${layout.publishRequestPath}`,
    'future: wire publish executors before remote commit mode is expected',
  ];
}

function stateArrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function buildAgentHandoffSummary(
  layout: ProcessPublishBuildLayout,
  state: JsonRecord,
  counts: ProcessPublishBuildReport['counts'],
  now: Date,
): JsonRecord {
  return {
    schema_version: 1,
    generated_at_utc: now.toISOString(),
    run_id: layout.runId,
    command: 'process publish-build',
    flow_path: nonEmptyString(state.flow_path),
    operation: nonEmptyString(state.operation),
    stop_after: nonEmptyString(state.stop_after),
    process_count: counts.processes,
    matched_exchange_count: stateArrayLength(state.matched_process_exchanges),
    process_dataset_count: counts.processes,
    source_dataset_count: counts.sources,
    remaining_placeholder_refs: stateArrayLength(state.placeholder_resolutions),
    placeholder_examples: [],
    publish_summary: {},
    artifacts: {
      state_path: layout.statePath,
      publish_bundle: layout.publishBundlePath,
      publish_request: layout.publishRequestPath,
      publish_intent: layout.publishIntentPath,
      process_update_report: null,
      flow_auto_build_manifest: null,
      publish_summary: null,
      timing_report: null,
      llm_cost_report: null,
    },
    next_actions: buildNextActions(layout),
    extra: {
      status: 'prepared_local_process_publish_bundle',
      request_id: nonEmptyString(state.request_id),
    },
  };
}

function buildReport(
  layout: ProcessPublishBuildLayout,
  state: JsonRecord,
  counts: ProcessPublishBuildReport['counts'],
  datasetOrigins: ProcessPublishBuildReport['dataset_origins'],
  publishDefaults: ProcessPublishBuildReport['publish_defaults'],
  now: Date,
): ProcessPublishBuildReport {
  return {
    schema_version: 1,
    generated_at_utc: now.toISOString(),
    status: 'prepared_local_process_publish_bundle',
    run_id: layout.runId,
    run_root: layout.runRoot,
    request_id: nonEmptyString(state.request_id),
    state_summary: buildStateSummary(state),
    dataset_origins: datasetOrigins,
    counts,
    publish_defaults: publishDefaults,
    files: {
      state: layout.statePath,
      handoff_summary: layout.handoffSummaryPath,
      run_manifest: layout.runManifestPath,
      invocation_index: layout.invocationIndexPath,
      publish_bundle: layout.publishBundlePath,
      publish_request: layout.publishRequestPath,
      publish_intent: layout.publishIntentPath,
      report: layout.reportPath,
    },
    next_actions: buildNextActions(layout),
  };
}

export async function runProcessPublishBuild(
  options: RunProcessPublishBuildOptions,
): Promise<ProcessPublishBuildReport> {
  const now = options.now ?? new Date();
  const layout = resolveLayout(options);
  ensureRunRootExists(layout);
  const runManifest = readRequiredRunManifest(layout);
  readRequiredHandoffSummary(layout);
  const invocationIndex = readInvocationIndex(layout);

  return await withStateFileLock(
    layout.statePath,
    { reason: 'process-publish-build.prepare_publish', now },
    () => {
      const state = readRequiredState(layout);
      const datasets = collectCanonicalDatasets(layout, state);

      if (datasets.processes.length === 0) {
        throw new CliError(
          'process publish-build run does not contain any process datasets to publish.',
          {
            code: 'PROCESS_PUBLISH_PROCESSES_MISSING',
            exitCode: 2,
          },
        );
      }

      const counts: ProcessPublishBuildReport['counts'] = {
        processes: datasets.processes.length,
        sources: datasets.sources.length,
        relations: 0,
      };
      const datasetOrigins: ProcessPublishBuildReport['dataset_origins'] = {
        processes: datasets.processOrigin,
        sources: datasets.sourceOrigin,
      };
      const publishBundle = buildPublishBundle(
        layout,
        state,
        runManifest,
        datasets.processes,
        datasets.sources,
        counts,
        datasetOrigins,
        now,
      );
      const publishRequest = buildPublishRequest();
      const normalizedPublishRequest = normalizePublishRequest(publishRequest, {
        requestPath: layout.publishRequestPath,
        now,
      });
      const publishIntent = buildPublishIntent(layout, counts);
      const updatedState = buildUpdatedState(state, layout, counts, datasetOrigins, now);
      const updatedInvocationIndex = buildInvocationIndex(layout, invocationIndex, options, now);
      const handoffSummary = buildAgentHandoffSummary(layout, updatedState, counts, now);
      const report = buildReport(
        layout,
        updatedState,
        counts,
        datasetOrigins,
        {
          commit: normalizedPublishRequest.publish.commit,
          publish_lifecyclemodels: normalizedPublishRequest.publish.publish_lifecyclemodels,
          publish_processes: normalizedPublishRequest.publish.publish_processes,
          publish_sources: normalizedPublishRequest.publish.publish_sources,
          publish_relations: normalizedPublishRequest.publish.publish_relations,
          publish_process_build_runs: normalizedPublishRequest.publish.publish_process_build_runs,
          relation_mode: normalizedPublishRequest.publish.relation_mode,
        },
        now,
      );

      writeJsonArtifact(layout.statePath, updatedState);
      writeJsonArtifact(layout.invocationIndexPath, updatedInvocationIndex);
      writeJsonArtifact(layout.publishBundlePath, publishBundle);
      writeJsonArtifact(layout.publishRequestPath, publishRequest);
      writeJsonArtifact(layout.publishIntentPath, publishIntent);
      writeJsonArtifact(layout.handoffSummaryPath, handoffSummary);
      writeJsonArtifact(layout.reportPath, report);

      return report;
    },
  );
}

export const __testInternals = {
  buildLayout,
  resolveLayout,
  buildStateSummary,
  readDatasetArrayFromState,
  collectCanonicalDatasets,
  buildPublishRequest,
  buildPublishIntent,
  buildUpdatedState,
  buildInvocationIndex,
  buildNextActions,
  buildReport,
};
