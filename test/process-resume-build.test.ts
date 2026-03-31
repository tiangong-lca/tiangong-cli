import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runProcessAutoBuild } from '../src/lib/process-auto-build.js';
import { __testInternals, runProcessResumeBuild } from '../src/lib/process-resume-build.js';
import { resolveTidasSdkPath } from './helpers/tidas-sdk-path.js';

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
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
    cwd: '/tmp/process-resume-build-auto',
  });

  return {
    requestPath,
    report,
  };
}

test('runProcessResumeBuild clears stop_after and writes resume artifacts from run-id', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-resume-build-runid-'));
  const originalCwd = process.cwd();

  try {
    const { report: autoReport } = await createPreparedRun(dir);
    const state = readJson(autoReport.files.state);
    state.build_status = 'stopped_after_matches';
    state.next_stage = '04_exchange_values';
    state.stop_after = 'matches';
    state.processes = [{ id: 'p-1' }];
    state.matched_process_exchanges = [{ id: 'ex-1' }];
    state.process_datasets = [{ id: 'proc-ds-1' }];
    state.source_datasets = [{ id: 'src-ds-1' }];
    writeJson(autoReport.files.state, state);

    process.chdir(dir);
    const resumeReport = await runProcessResumeBuild({
      runId: autoReport.run_id,
      now: new Date('2026-03-29T03:00:00Z'),
      cwd: '/tmp/process-resume-build-resume',
    });

    assert.equal(resumeReport.status, 'prepared_local_process_resume_run');
    assert.equal(realpathSync(resumeReport.run_root), realpathSync(autoReport.run_root));
    assert.equal(resumeReport.request_id, autoReport.request_id);
    assert.equal(resumeReport.resumed_from, '04_exchange_values');
    assert.equal(resumeReport.checkpoint, 'matches');
    assert.equal(resumeReport.attempt, 1);
    assert.equal(resumeReport.state_summary.build_status, 'resume_prepared');
    assert.equal(resumeReport.state_summary.next_stage, '04_exchange_values');
    assert.equal(resumeReport.state_summary.stop_after, null);
    assert.equal(resumeReport.state_summary.process_count, 1);
    assert.equal(resumeReport.state_summary.matched_exchange_count, 1);
    assert.equal(resumeReport.state_summary.process_dataset_count, 1);
    assert.equal(resumeReport.state_summary.source_dataset_count, 1);
    assert.equal(existsSync(resumeReport.files.resume_metadata), true);
    assert.equal(existsSync(resumeReport.files.resume_history), true);
    assert.equal(existsSync(resumeReport.files.invocation_index), true);
    assert.equal(existsSync(resumeReport.files.report), true);

    const updatedState = readJson(resumeReport.files.state);
    assert.equal(updatedState.build_status, 'resume_prepared');
    assert.equal(updatedState.stop_after, null);
    assert.equal(updatedState.resume_attempt, 1);
    assert.equal(updatedState.resume_requested_at, '2026-03-29T03:00:00.000Z');
    const stepMarkers = updatedState.step_markers as Record<string, { status?: unknown }>;
    assert.equal(stepMarkers.resume_prepared?.status, 'completed');

    const resumeMetadata = readJson(resumeReport.files.resume_metadata);
    assert.equal(resumeMetadata.runId, autoReport.run_id);
    assert.equal(resumeMetadata.resumedFrom, '04_exchange_values');
    assert.equal(resumeMetadata.checkpoint, 'matches');
    assert.equal(resumeMetadata.attempt, 1);
    assert.equal(resumeMetadata.resumedAt, '2026-03-29T03:00:00.000Z');

    const invocationIndex = readJson(resumeReport.files.invocation_index) as {
      invocations: Array<Record<string, unknown>>;
    };
    assert.equal(invocationIndex.invocations.length, 2);
    assert.deepEqual(invocationIndex.invocations[1]?.command, [
      'process',
      'resume-build',
      '--run-id',
      autoReport.run_id,
    ]);
    assert.equal(invocationIndex.invocations[1]?.cwd, '/tmp/process-resume-build-resume');

    const handoff = readJson(resumeReport.files.handoff_summary);
    assert.equal(handoff.command, 'process resume-build');
    assert.equal(handoff.stop_after, null);
    assert.equal((handoff.extra as Record<string, unknown>).status, resumeReport.status);

    const historyLines = readFileSync(resumeReport.files.resume_history, 'utf8')
      .trim()
      .split(/\r?\n/u);
    assert.equal(historyLines.length, 1);

    assert.equal(
      readFileSync(path.join(path.dirname(autoReport.run_root), '.latest_run_id'), 'utf8'),
      `${autoReport.run_id}\n`,
    );
  } finally {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessResumeBuild supports run-dir resume, recreates invocation history, and increments attempts', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-resume-build-rundir-'));

  try {
    const { report: autoReport } = await createPreparedRun(dir);
    const state = readJson(autoReport.files.state);
    delete state.next_stage;
    state.build_status = 'waiting_manual_review';
    writeJson(autoReport.files.state, state);
    unlinkSync(autoReport.files.invocation_index);

    const firstResume = await runProcessResumeBuild({
      runDir: autoReport.run_root,
      now: new Date('2026-03-29T04:00:00Z'),
      cwd: '/tmp/process-resume-build-rundir-1',
    });

    assert.equal(firstResume.run_id, autoReport.run_id);
    assert.equal(firstResume.resumed_from, 'waiting_manual_review');
    assert.equal(firstResume.checkpoint, null);
    assert.equal(firstResume.attempt, 1);
    const firstInvocationIndex = readJson(firstResume.files.invocation_index) as {
      invocations: Array<Record<string, unknown>>;
    };
    assert.equal(firstInvocationIndex.invocations.length, 1);
    assert.deepEqual(firstInvocationIndex.invocations[0]?.command, [
      'process',
      'resume-build',
      '--run-dir',
      autoReport.run_root,
    ]);
    assert.match(firstResume.next_actions[3] ?? '', /future: inspect completed run state/u);

    const secondResume = await runProcessResumeBuild({
      runDir: autoReport.run_root,
      now: new Date('2026-03-29T05:00:00Z'),
      cwd: '/tmp/process-resume-build-rundir-2',
    });

    assert.equal(secondResume.attempt, 2);
    const secondInvocationIndex = readJson(secondResume.files.invocation_index) as {
      invocations: Array<Record<string, unknown>>;
    };
    assert.equal(secondInvocationIndex.invocations.length, 2);
    const historyLines = readFileSync(secondResume.files.resume_history, 'utf8')
      .trim()
      .split(/\r?\n/u);
    assert.equal(historyLines.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessResumeBuild rebuilds invocation history when invocation index omits invocations', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-resume-build-no-invocations-'));

  try {
    const { report: autoReport } = await createPreparedRun(dir);
    writeJson(autoReport.files.invocation_index, {
      schema_version: 9,
    });

    const resumeReport = await runProcessResumeBuild({
      runDir: autoReport.run_root,
      now: new Date('2026-03-29T04:30:00Z'),
      cwd: '/tmp/process-resume-build-no-invocations',
    });

    const invocationIndex = readJson(resumeReport.files.invocation_index) as {
      schema_version: unknown;
      invocations: Array<Record<string, unknown>>;
    };
    assert.equal(invocationIndex.schema_version, 1);
    assert.equal(invocationIndex.invocations.length, 1);
    assert.deepEqual(invocationIndex.invocations[0]?.command, [
      'process',
      'resume-build',
      '--run-dir',
      autoReport.run_root,
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessResumeBuild rejects invalid inputs and corrupted process run artifacts', async () => {
  await assert.rejects(() => runProcessResumeBuild({}), /Missing required --run-id or --run-dir/u);

  const mismatchDir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-resume-build-mismatch-'));
  try {
    await assert.rejects(
      () =>
        runProcessResumeBuild({
          runId: 'run-a',
          runDir: path.join(mismatchDir, 'run-b'),
        }),
      /run-id does not match run-dir basename/u,
    );
  } finally {
    rmSync(mismatchDir, { recursive: true, force: true });
  }

  const missingDir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-resume-build-missing-'));
  try {
    await assert.rejects(
      () => runProcessResumeBuild({ runDir: path.join(missingDir, 'run-missing') }),
      /run root not found/u,
    );
  } finally {
    rmSync(missingDir, { recursive: true, force: true });
  }

  const invalidManifestDir = mkdtempSync(
    path.join(os.tmpdir(), 'tg-cli-process-resume-build-bad-manifest-'),
  );
  try {
    const { report: autoReport } = await createPreparedRun(invalidManifestDir);
    writeJson(autoReport.files.run_manifest, { runId: 'other-run' });
    await assert.rejects(
      () => runProcessResumeBuild({ runDir: autoReport.run_root }),
      /run manifest runId mismatch/u,
    );
  } finally {
    rmSync(invalidManifestDir, { recursive: true, force: true });
  }

  const invalidStateDir = mkdtempSync(
    path.join(os.tmpdir(), 'tg-cli-process-resume-build-bad-state-'),
  );
  try {
    const { report: autoReport } = await createPreparedRun(invalidStateDir);
    writeJson(autoReport.files.state, []);
    await assert.rejects(
      () => runProcessResumeBuild({ runDir: autoReport.run_root }),
      /Expected process resume artifact JSON object/u,
    );
  } finally {
    rmSync(invalidStateDir, { recursive: true, force: true });
  }

  const mismatchedStateDir = mkdtempSync(
    path.join(os.tmpdir(), 'tg-cli-process-resume-build-state-mismatch-'),
  );
  try {
    const { report: autoReport } = await createPreparedRun(mismatchedStateDir);
    const state = readJson(autoReport.files.state);
    state.run_id = 'other-run';
    writeJson(autoReport.files.state, state);
    await assert.rejects(
      () => runProcessResumeBuild({ runDir: autoReport.run_root }),
      /state run_id mismatch/u,
    );
  } finally {
    rmSync(mismatchedStateDir, { recursive: true, force: true });
  }

  const invalidHandoffDir = mkdtempSync(
    path.join(os.tmpdir(), 'tg-cli-process-resume-build-bad-handoff-'),
  );
  try {
    const { report: autoReport } = await createPreparedRun(invalidHandoffDir);
    writeJson(autoReport.files.handoff_summary, []);
    await assert.rejects(
      () => runProcessResumeBuild({ runDir: autoReport.run_root }),
      /Expected process resume artifact JSON object/u,
    );
  } finally {
    rmSync(invalidHandoffDir, { recursive: true, force: true });
  }

  const missingHandoffDir = mkdtempSync(
    path.join(os.tmpdir(), 'tg-cli-process-resume-build-missing-handoff-'),
  );
  try {
    const { report: autoReport } = await createPreparedRun(missingHandoffDir);
    unlinkSync(autoReport.files.handoff_summary);
    await assert.rejects(
      () => runProcessResumeBuild({ runDir: autoReport.run_root }),
      /Required process resume artifact not found/u,
    );
  } finally {
    rmSync(missingHandoffDir, { recursive: true, force: true });
  }

  const invalidInvocationDir = mkdtempSync(
    path.join(os.tmpdir(), 'tg-cli-process-resume-build-bad-invocation-'),
  );
  try {
    const { report: autoReport } = await createPreparedRun(invalidInvocationDir);
    writeJson(autoReport.files.invocation_index, { invocations: {} });
    await assert.rejects(
      () => runProcessResumeBuild({ runDir: autoReport.run_root }),
      /invocations array/u,
    );
  } finally {
    rmSync(invalidInvocationDir, { recursive: true, force: true });
  }

  const invalidInvocationShapeDir = mkdtempSync(
    path.join(os.tmpdir(), 'tg-cli-process-resume-build-bad-invocation-shape-'),
  );
  try {
    const { report: autoReport } = await createPreparedRun(invalidInvocationShapeDir);
    writeJson(autoReport.files.invocation_index, []);
    await assert.rejects(
      () => runProcessResumeBuild({ runDir: autoReport.run_root }),
      /invocation index JSON object/u,
    );
  } finally {
    rmSync(invalidInvocationShapeDir, { recursive: true, force: true });
  }

  const invalidHistoryDir = mkdtempSync(
    path.join(os.tmpdir(), 'tg-cli-process-resume-build-bad-history-'),
  );
  try {
    const { report: autoReport } = await createPreparedRun(invalidHistoryDir);
    writeFileSync(
      path.join(autoReport.run_root, 'manifests', 'resume-history.jsonl'),
      '123\n',
      'utf8',
    );
    await assert.rejects(
      () => runProcessResumeBuild({ runDir: autoReport.run_root }),
      /JSONL rows to be objects/u,
    );
  } finally {
    rmSync(invalidHistoryDir, { recursive: true, force: true });
  }
});

test('process resume-build internals cover fallback layout and metadata helpers', () => {
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
    next_stage: '04_exchange_values',
    stop_after: null,
    processes: ['a', 'b'],
  });
  assert.deepEqual(stateSummary, {
    build_status: 'resume_prepared',
    next_stage: '04_exchange_values',
    stop_after: null,
    process_count: 2,
    matched_exchange_count: 0,
    process_dataset_count: 0,
    source_dataset_count: 0,
  });

  assert.equal(
    __testInternals.resolveResumedFrom({
      build_status: 'fallback-status',
    }),
    'fallback-status',
  );
  assert.equal(__testInternals.resolveResumedFrom({}), 'unknown');

  assert.equal(__testInternals.nextAttempt([{ attempt: 2 }, { attempt: 4 }]), 5);
  assert.equal(__testInternals.nextAttempt([{ attempt: 'bad' }, { attempt: 0 }]), 1);

  const updatedMarkers = __testInternals.updateStepMarkers('bad', '2026-03-29T06:00:00.000Z') as {
    resume_prepared: { status?: unknown };
  };
  assert.equal(updatedMarkers.resume_prepared.status, 'completed');

  const updatedState = __testInternals.buildUpdatedState(
    {
      build_status: 'stopped',
      stop_after: 'sources',
    },
    {
      attempt: 3,
    },
    new Date('2026-03-29T06:00:00Z'),
  ) as Record<string, unknown>;
  assert.equal(updatedState.build_status, 'resume_prepared');
  assert.equal(updatedState.stop_after, null);
  assert.equal(updatedState.resume_attempt, 3);

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
      cwd: '/tmp/workspace',
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
    'resume-build',
    '--run-id',
    'run-123',
  ]);

  const cwdFallbackInvocationIndex = __testInternals.buildInvocationIndex(
    __testInternals.buildLayout('/tmp/process-run/run-123', 'run-123'),
    {},
    {
      runId: 'run-123',
    },
    new Date('2026-03-29T06:46:00Z'),
  ) as {
    invocations: Array<Record<string, unknown>>;
  };
  assert.equal(cwdFallbackInvocationIndex.invocations[0]?.cwd, process.cwd());

  const fallbackReport = __testInternals.buildReport(
    __testInternals.buildLayout('/tmp/process-run/run-123', 'run-123'),
    {},
    {
      resumedFrom: 'resume_prepared',
    },
    {
      build_status: 'resume_prepared',
      next_stage: null,
      stop_after: null,
      process_count: 0,
      matched_exchange_count: 0,
      process_dataset_count: 0,
      source_dataset_count: 0,
    },
    new Date('2026-03-29T06:47:00Z'),
  );
  assert.equal(fallbackReport.checkpoint, '');
  assert.equal(fallbackReport.attempt, 1);

  const nextActions = __testInternals.buildNextActions(
    __testInternals.buildLayout('/tmp/process-run/run-123', 'run-123'),
    stateSummary,
  );
  assert.match(nextActions[3] ?? '', /future: migrate CLI stage executor/u);
});
