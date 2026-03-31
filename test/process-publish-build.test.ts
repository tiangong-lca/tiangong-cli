import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runProcessAutoBuild } from '../src/lib/process-auto-build.js';
import { __testInternals, runProcessPublishBuild } from '../src/lib/process-publish-build.js';
import { resolveTidasSdkPath } from './helpers/tidas-sdk-path.js';

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson<T = Record<string, unknown>>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function bundledFlowPayload(): Record<string, unknown> {
  return readJson(resolveTidasSdkPath('test-data', 'tidas-example-flow.json')) as Record<
    string,
    unknown
  >;
}

function writeFlowFixture(dir: string): string {
  const filePath = path.join(dir, '01211_3a8d74d8_reference-flow.json');
  writeJson(filePath, bundledFlowPayload());
  return filePath;
}

function makeCanonicalProcess(id: string): Record<string, unknown> {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          'common:UUID': id,
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          'common:dataSetVersion': '01.01.000',
        },
      },
    },
  };
}

function makeSource(id: string): Record<string, unknown> {
  return {
    sourceDataSet: {
      sourceInformation: {
        dataSetInformation: {
          'common:UUID': id,
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          'common:dataSetVersion': '01.01.000',
        },
      },
    },
  };
}

async function createPreparedRun(dir: string): Promise<{
  requestPath: string;
  report: Awaited<ReturnType<typeof runProcessAutoBuild>>;
}> {
  const flowPath = writeFlowFixture(dir);
  const requestPath = path.join(dir, 'request.json');
  writeJson(requestPath, {
    flow_file: `./${path.basename(flowPath)}`,
  });

  const report = await runProcessAutoBuild({
    inputPath: requestPath,
    now: new Date('2026-03-29T02:00:00Z'),
    cwd: '/tmp/process-publish-build-auto',
  });

  return {
    requestPath,
    report,
  };
}

test('runProcessPublishBuild writes local publish handoff artifacts from run-id using export datasets', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-publish-build-runid-'));
  const originalCwd = process.cwd();

  try {
    const { report: autoReport } = await createPreparedRun(dir);
    const state = readJson<Record<string, unknown>>(autoReport.files.state);
    state.build_status = 'resume_prepared';
    state.next_stage = '10_publish';
    state.stop_after = null;
    state.process_datasets = [makeCanonicalProcess('proc-state-ignored')];
    state.source_datasets = [makeSource('src-state-ignored')];
    state.matched_process_exchanges = [{ id: 'ex-1' }];
    state.placeholder_resolutions = [{ id: 'placeholder-1' }, { id: 'placeholder-2' }];
    state.step_markers = {
      auto_build_prepared: {
        status: 'completed',
      },
    };
    writeJson(autoReport.files.state, state);

    mkdirSync(path.join(autoReport.run_root, 'exports', 'processes'), { recursive: true });
    mkdirSync(path.join(autoReport.run_root, 'exports', 'sources'), { recursive: true });
    writeJson(
      path.join(autoReport.run_root, 'exports', 'processes', 'proc-export-1.json'),
      makeCanonicalProcess('proc-export-1'),
    );
    writeJson(
      path.join(autoReport.run_root, 'exports', 'processes', 'proc-export-2.json'),
      makeCanonicalProcess('proc-export-2'),
    );
    writeJson(
      path.join(autoReport.run_root, 'exports', 'sources', 'source-export-1.json'),
      makeSource('source-export-1'),
    );

    process.chdir(dir);
    const publishReport = await runProcessPublishBuild({
      runId: autoReport.run_id,
      now: new Date('2026-03-29T03:00:00Z'),
      cwd: '/tmp/process-publish-build-runid',
    });

    assert.equal(publishReport.status, 'prepared_local_process_publish_bundle');
    assert.equal(realpathSync(publishReport.run_root), realpathSync(autoReport.run_root));
    assert.equal(publishReport.request_id, autoReport.request_id);
    assert.deepEqual(publishReport.dataset_origins, {
      processes: 'exports',
      sources: 'exports',
    });
    assert.deepEqual(publishReport.counts, {
      processes: 2,
      sources: 1,
      relations: 0,
    });
    assert.equal(publishReport.publish_defaults.commit, false);
    assert.equal(publishReport.publish_defaults.publish_lifecyclemodels, false);
    assert.equal(publishReport.publish_defaults.publish_processes, true);
    assert.equal(publishReport.publish_defaults.publish_sources, true);
    assert.equal(publishReport.publish_defaults.publish_relations, true);
    assert.equal(publishReport.publish_defaults.publish_process_build_runs, false);
    assert.equal(publishReport.publish_defaults.relation_mode, 'local_manifest_only');
    assert.equal(existsSync(publishReport.files.publish_bundle), true);
    assert.equal(existsSync(publishReport.files.publish_request), true);
    assert.equal(existsSync(publishReport.files.publish_intent), true);
    assert.equal(existsSync(publishReport.files.report), true);

    const updatedState = readJson<Record<string, unknown>>(publishReport.files.state);
    assert.equal(updatedState.publish_build_requested_at, '2026-03-29T03:00:00.000Z');
    const lastPublishBuild = updatedState.last_publish_build as Record<string, unknown>;
    assert.equal(lastPublishBuild.status, 'prepared_local_process_publish_bundle');
    assert.equal(lastPublishBuild.process_count, 2);
    assert.equal(lastPublishBuild.source_count, 1);
    const stepMarkers = updatedState.step_markers as Record<string, { status?: unknown }>;
    assert.equal(stepMarkers.publish_handoff_prepared?.status, 'completed');

    const publishBundle = readJson<Record<string, unknown>>(publishReport.files.publish_bundle);
    assert.equal(publishBundle.generated_at_utc, '2026-03-29T03:00:00.000Z');
    assert.equal(publishBundle.run_id, autoReport.run_id);
    assert.equal(publishBundle.request_id, autoReport.request_id);
    assert.deepEqual(publishBundle.dataset_origins, {
      processes: 'exports',
      sources: 'exports',
    });
    assert.deepEqual(publishBundle.counts, {
      processes: 2,
      sources: 1,
      relations: 0,
    });
    assert.equal((publishBundle.processes as unknown[]).length, 2);
    assert.equal((publishBundle.sources as unknown[]).length, 1);
    assert.equal((publishBundle.relations as unknown[]).length, 0);

    const publishRequest = readJson<Record<string, unknown>>(publishReport.files.publish_request);
    assert.deepEqual(publishRequest, {
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
    });

    const publishIntent = readJson<Record<string, unknown>>(publishReport.files.publish_intent);
    assert.equal(publishIntent.command, 'publish run');
    assert.equal(publishIntent.input_path, publishReport.files.publish_request);
    assert.equal(publishIntent.process_count, 2);
    assert.equal(publishIntent.source_count, 1);
    assert.equal(publishIntent.relation_count, 0);

    const invocationIndex = readJson<{
      invocations: Array<Record<string, unknown>>;
    }>(publishReport.files.invocation_index);
    assert.equal(invocationIndex.invocations.length, 2);
    assert.deepEqual(invocationIndex.invocations[1]?.command, [
      'process',
      'publish-build',
      '--run-id',
      autoReport.run_id,
    ]);
    assert.equal(invocationIndex.invocations[1]?.cwd, '/tmp/process-publish-build-runid');

    const handoff = readJson<Record<string, unknown>>(publishReport.files.handoff_summary);
    assert.equal(handoff.command, 'process publish-build');
    assert.equal(handoff.process_dataset_count, 2);
    assert.equal(handoff.source_dataset_count, 1);
    assert.equal(handoff.remaining_placeholder_refs, 2);
    const extra = handoff.extra as Record<string, unknown>;
    assert.equal(extra.status, publishReport.status);
    assert.equal(extra.request_id, autoReport.request_id);

    assert.match(
      publishReport.next_actions[2] ?? '',
      new RegExp(`tiangong publish run --input ${publishReport.files.publish_request}`, 'u'),
    );
  } finally {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessPublishBuild supports run-dir mode, falls back to state datasets, and recreates invocation index', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-publish-build-rundir-'));

  try {
    const { report: autoReport } = await createPreparedRun(dir);
    const state = readJson<Record<string, unknown>>(autoReport.files.state);
    state.request_id = '';
    state.build_status = 'waiting_manual_publish';
    delete state.next_stage;
    delete state.run_id;
    state.process_datasets = [makeCanonicalProcess('proc-state-1')];
    state.source_datasets = [];
    state.step_markers = 'bad-shape';
    writeJson(autoReport.files.state, state);
    writeJson(autoReport.files.invocation_index, {
      schema_version: 9,
    });

    const publishReport = await runProcessPublishBuild({
      runDir: autoReport.run_root,
      now: new Date('2026-03-29T04:00:00Z'),
      cwd: '/tmp/process-publish-build-rundir',
    });

    assert.equal(publishReport.run_id, autoReport.run_id);
    assert.equal(publishReport.request_id, null);
    assert.deepEqual(publishReport.dataset_origins, {
      processes: 'state',
      sources: 'state',
    });
    assert.deepEqual(publishReport.counts, {
      processes: 1,
      sources: 0,
      relations: 0,
    });
    assert.equal(publishReport.state_summary.build_status, 'waiting_manual_publish');
    assert.equal(publishReport.state_summary.next_stage, null);
    assert.equal(publishReport.state_summary.stop_after, null);

    const invocationIndex = readJson<{
      schema_version: unknown;
      invocations: Array<Record<string, unknown>>;
    }>(publishReport.files.invocation_index);
    assert.equal(invocationIndex.schema_version, 1);
    assert.equal(invocationIndex.invocations.length, 1);
    assert.deepEqual(invocationIndex.invocations[0]?.command, [
      'process',
      'publish-build',
      '--run-dir',
      autoReport.run_root,
    ]);

    const publishBundle = readJson<Record<string, unknown>>(publishReport.files.publish_bundle);
    assert.equal(publishBundle.request_id, null);
    assert.equal((publishBundle.processes as unknown[]).length, 1);
    assert.equal((publishBundle.sources as unknown[]).length, 0);

    const updatedState = readJson<Record<string, unknown>>(publishReport.files.state);
    const stepMarkers = updatedState.step_markers as Record<string, { status?: unknown }>;
    assert.equal(stepMarkers.publish_handoff_prepared?.status, 'completed');

    const handoff = readJson<Record<string, unknown>>(publishReport.files.handoff_summary);
    const extra = handoff.extra as Record<string, unknown>;
    assert.equal(extra.request_id, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessPublishBuild recreates a missing invocation index for older runs', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-publish-build-no-invocations-'));

  try {
    const { report: autoReport } = await createPreparedRun(dir);
    const state = readJson<Record<string, unknown>>(autoReport.files.state);
    state.process_datasets = [makeCanonicalProcess('proc-state-recreated')];
    state.source_datasets = [];
    writeJson(autoReport.files.state, state);
    unlinkSync(autoReport.files.invocation_index);

    const publishReport = await runProcessPublishBuild({
      runDir: autoReport.run_root,
      now: new Date('2026-03-29T04:30:00Z'),
      cwd: '/tmp/process-publish-build-no-invocations',
    });

    const invocationIndex = readJson<{
      schema_version: unknown;
      invocations: Array<Record<string, unknown>>;
    }>(publishReport.files.invocation_index);
    assert.equal(invocationIndex.schema_version, 1);
    assert.equal(invocationIndex.invocations.length, 1);
    assert.deepEqual(invocationIndex.invocations[0]?.command, [
      'process',
      'publish-build',
      '--run-dir',
      autoReport.run_root,
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessPublishBuild rejects invalid inputs and corrupted publish-build artifacts', async () => {
  await assert.rejects(() => runProcessPublishBuild({}), /Missing required --run-id or --run-dir/u);

  const mismatchDir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-publish-build-mismatch-'));
  try {
    await assert.rejects(
      () =>
        runProcessPublishBuild({
          runId: 'run-a',
          runDir: path.join(mismatchDir, 'run-b'),
        }),
      /run-id does not match run-dir basename/u,
    );
  } finally {
    rmSync(mismatchDir, { recursive: true, force: true });
  }

  const missingDir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-publish-build-missing-'));
  try {
    await assert.rejects(
      () => runProcessPublishBuild({ runDir: path.join(missingDir, 'run-missing') }),
      /run root not found/u,
    );
  } finally {
    rmSync(missingDir, { recursive: true, force: true });
  }

  const invalidManifestDir = mkdtempSync(
    path.join(os.tmpdir(), 'tg-cli-process-publish-build-bad-manifest-'),
  );
  try {
    const { report: autoReport } = await createPreparedRun(invalidManifestDir);
    writeJson(autoReport.files.run_manifest, { runId: 'other-run' });
    await assert.rejects(
      () => runProcessPublishBuild({ runDir: autoReport.run_root }),
      /run manifest runId mismatch/u,
    );
  } finally {
    rmSync(invalidManifestDir, { recursive: true, force: true });
  }

  const invalidStateDir = mkdtempSync(
    path.join(os.tmpdir(), 'tg-cli-process-publish-build-bad-state-'),
  );
  try {
    const { report: autoReport } = await createPreparedRun(invalidStateDir);
    writeJson(autoReport.files.state, []);
    await assert.rejects(
      () => runProcessPublishBuild({ runDir: autoReport.run_root }),
      /Expected process publish artifact JSON object/u,
    );
  } finally {
    rmSync(invalidStateDir, { recursive: true, force: true });
  }

  const mismatchedStateDir = mkdtempSync(
    path.join(os.tmpdir(), 'tg-cli-process-publish-build-state-mismatch-'),
  );
  try {
    const { report: autoReport } = await createPreparedRun(mismatchedStateDir);
    const state = readJson<Record<string, unknown>>(autoReport.files.state);
    state.run_id = 'other-run';
    writeJson(autoReport.files.state, state);
    await assert.rejects(
      () => runProcessPublishBuild({ runDir: autoReport.run_root }),
      /state run_id mismatch/u,
    );
  } finally {
    rmSync(mismatchedStateDir, { recursive: true, force: true });
  }

  const missingHandoffDir = mkdtempSync(
    path.join(os.tmpdir(), 'tg-cli-process-publish-build-missing-handoff-'),
  );
  try {
    const { report: autoReport } = await createPreparedRun(missingHandoffDir);
    unlinkSync(autoReport.files.handoff_summary);
    await assert.rejects(
      () => runProcessPublishBuild({ runDir: autoReport.run_root }),
      /Required process publish artifact not found/u,
    );
  } finally {
    rmSync(missingHandoffDir, { recursive: true, force: true });
  }

  const invalidHandoffDir = mkdtempSync(
    path.join(os.tmpdir(), 'tg-cli-process-publish-build-bad-handoff-'),
  );
  try {
    const { report: autoReport } = await createPreparedRun(invalidHandoffDir);
    writeJson(autoReport.files.handoff_summary, []);
    await assert.rejects(
      () => runProcessPublishBuild({ runDir: autoReport.run_root }),
      /Expected process publish artifact JSON object/u,
    );
  } finally {
    rmSync(invalidHandoffDir, { recursive: true, force: true });
  }

  const invalidInvocationDir = mkdtempSync(
    path.join(os.tmpdir(), 'tg-cli-process-publish-build-bad-invocation-'),
  );
  try {
    const { report: autoReport } = await createPreparedRun(invalidInvocationDir);
    writeJson(autoReport.files.invocation_index, { invocations: {} });
    await assert.rejects(
      () => runProcessPublishBuild({ runDir: autoReport.run_root }),
      /invocations array/u,
    );
  } finally {
    rmSync(invalidInvocationDir, { recursive: true, force: true });
  }

  const invalidInvocationShapeDir = mkdtempSync(
    path.join(os.tmpdir(), 'tg-cli-process-publish-build-bad-invocation-shape-'),
  );
  try {
    const { report: autoReport } = await createPreparedRun(invalidInvocationShapeDir);
    writeJson(autoReport.files.invocation_index, []);
    await assert.rejects(
      () => runProcessPublishBuild({ runDir: autoReport.run_root }),
      /invocation index JSON object/u,
    );
  } finally {
    rmSync(invalidInvocationShapeDir, { recursive: true, force: true });
  }

  const invalidProcessStateDatasetsDir = mkdtempSync(
    path.join(os.tmpdir(), 'tg-cli-process-publish-build-bad-state-datasets-'),
  );
  try {
    const { report: autoReport } = await createPreparedRun(invalidProcessStateDatasetsDir);
    const state = readJson<Record<string, unknown>>(autoReport.files.state);
    state.process_datasets = { id: 'not-an-array' };
    writeJson(autoReport.files.state, state);
    await assert.rejects(
      () => runProcessPublishBuild({ runDir: autoReport.run_root }),
      /expected state\.process_datasets to be an array/u,
    );
  } finally {
    rmSync(invalidProcessStateDatasetsDir, { recursive: true, force: true });
  }

  const invalidSourceStateDatasetItemDir = mkdtempSync(
    path.join(os.tmpdir(), 'tg-cli-process-publish-build-bad-source-item-'),
  );
  try {
    const { report: autoReport } = await createPreparedRun(invalidSourceStateDatasetItemDir);
    const state = readJson<Record<string, unknown>>(autoReport.files.state);
    state.process_datasets = [makeCanonicalProcess('proc-ok')];
    state.source_datasets = ['bad-item'];
    writeJson(autoReport.files.state, state);
    await assert.rejects(
      () => runProcessPublishBuild({ runDir: autoReport.run_root }),
      /expected state\.source_datasets\[0\] to be an object/u,
    );
  } finally {
    rmSync(invalidSourceStateDatasetItemDir, { recursive: true, force: true });
  }

  const invalidExportDir = mkdtempSync(
    path.join(os.tmpdir(), 'tg-cli-process-publish-build-bad-export-'),
  );
  try {
    const { report: autoReport } = await createPreparedRun(invalidExportDir);
    const state = readJson<Record<string, unknown>>(autoReport.files.state);
    state.process_datasets = [makeCanonicalProcess('proc-state-ok')];
    writeJson(autoReport.files.state, state);
    mkdirSync(path.join(autoReport.run_root, 'exports', 'processes'), { recursive: true });
    writeJson(path.join(autoReport.run_root, 'exports', 'processes', 'bad.json'), ['bad-export']);
    await assert.rejects(
      () => runProcessPublishBuild({ runDir: autoReport.run_root }),
      /Expected process export JSON object/u,
    );
  } finally {
    rmSync(invalidExportDir, { recursive: true, force: true });
  }

  const zeroProcessesDir = mkdtempSync(
    path.join(os.tmpdir(), 'tg-cli-process-publish-build-zero-processes-'),
  );
  try {
    const { report: autoReport } = await createPreparedRun(zeroProcessesDir);
    const state = readJson<Record<string, unknown>>(autoReport.files.state);
    state.process_datasets = [];
    state.source_datasets = [];
    writeJson(autoReport.files.state, state);
    await assert.rejects(
      () => runProcessPublishBuild({ runDir: autoReport.run_root }),
      /does not contain any process datasets to publish/u,
    );
  } finally {
    rmSync(zeroProcessesDir, { recursive: true, force: true });
  }
});

test('process publish-build internals cover fallback layout and report helpers', () => {
  const resolvedLayout = __testInternals.resolveLayout({
    runDir: '/tmp/process-run/run-123',
  });
  assert.equal(resolvedLayout.runId, 'run-123');
  assert.equal(
    resolvedLayout.statePath,
    '/tmp/process-run/run-123/cache/process_from_flow_state.json',
  );
  assert.equal(
    __testInternals.resolveLayout({
      runId: '   ',
      runDir: '/tmp/process-run/run-123',
    }).runId,
    'run-123',
  );

  const stateSummary = __testInternals.buildStateSummary({
    build_status: 'resume_prepared',
    next_stage: '10_publish',
    stop_after: null,
  });
  assert.deepEqual(stateSummary, {
    build_status: 'resume_prepared',
    next_stage: '10_publish',
    stop_after: null,
  });

  assert.deepEqual(__testInternals.readDatasetArrayFromState({}, 'process_datasets'), []);

  const stateFallbackDatasets = __testInternals.collectCanonicalDatasets(
    __testInternals.buildLayout('/tmp/process-run/run-123', 'run-123'),
    {
      process_datasets: [makeCanonicalProcess('proc-state-only')],
      source_datasets: [makeSource('source-state-only')],
    },
  );
  assert.equal(stateFallbackDatasets.processOrigin, 'state');
  assert.equal(stateFallbackDatasets.sourceOrigin, 'state');

  const publishRequest = __testInternals.buildPublishRequest();
  assert.deepEqual(publishRequest, {
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
  });

  const publishIntent = __testInternals.buildPublishIntent(
    __testInternals.buildLayout('/tmp/process-run/run-123', 'run-123'),
    {
      processes: 2,
      sources: 1,
      relations: 0,
    },
  );
  assert.equal(publishIntent.command, 'publish run');
  assert.equal(publishIntent.process_count, 2);

  const updatedState = __testInternals.buildUpdatedState(
    {
      build_status: 'resume_prepared',
      step_markers: 'bad-shape',
    },
    __testInternals.buildLayout('/tmp/process-run/run-123', 'run-123'),
    {
      processes: 2,
      sources: 1,
      relations: 0,
    },
    {
      processes: 'exports',
      sources: 'state',
    },
    new Date('2026-03-29T06:00:00Z'),
  ) as Record<string, unknown>;
  assert.equal(updatedState.publish_build_requested_at, '2026-03-29T06:00:00.000Z');
  const updatedMarkers = updatedState.step_markers as Record<
    string,
    { status?: unknown; completed_at?: unknown }
  >;
  assert.equal(updatedMarkers.publish_handoff_prepared?.status, 'completed');

  const invocationIndex = __testInternals.buildInvocationIndex(
    __testInternals.buildLayout('/tmp/process-run/run-123', 'run-123'),
    {
      schema_version: 2,
      invocations: [{ command: ['existing'] }],
    },
    {
      runId: 'run-123',
      runDir: '/tmp/process-run/run-123',
      cwd: '/tmp/workspace',
    },
    new Date('2026-03-29T06:30:00Z'),
  ) as {
    invocations: Array<Record<string, unknown>>;
  };
  assert.equal(invocationIndex.invocations.length, 2);

  const fallbackInvocationIndex = __testInternals.buildInvocationIndex(
    __testInternals.buildLayout('/tmp/process-run/run-123', 'run-123'),
    {},
    {
      runId: 'run-123',
    },
    new Date('2026-03-29T06:45:00Z'),
  ) as {
    schema_version: unknown;
    invocations: Array<Record<string, unknown>>;
  };
  assert.equal(fallbackInvocationIndex.schema_version, 1);
  assert.equal(fallbackInvocationIndex.invocations.length, 1);
  assert.deepEqual(fallbackInvocationIndex.invocations[0]?.command, [
    'process',
    'publish-build',
    '--run-id',
    'run-123',
  ]);
  assert.equal(fallbackInvocationIndex.invocations[0]?.cwd, process.cwd());

  const report = __testInternals.buildReport(
    __testInternals.buildLayout('/tmp/process-run/run-123', 'run-123'),
    {},
    {
      processes: 2,
      sources: 1,
      relations: 0,
    },
    {
      processes: 'exports',
      sources: 'state',
    },
    {
      commit: false,
      publish_lifecyclemodels: false,
      publish_processes: true,
      publish_sources: true,
      publish_relations: true,
      publish_process_build_runs: false,
      relation_mode: 'local_manifest_only',
    },
    new Date('2026-03-29T06:47:00Z'),
  );
  assert.equal(report.request_id, null);
  assert.equal(report.counts.processes, 2);

  const nextActions = __testInternals.buildNextActions(
    __testInternals.buildLayout('/tmp/process-run/run-123', 'run-123'),
  );
  assert.match(nextActions[3] ?? '', /future: wire publish executors/u);
});
