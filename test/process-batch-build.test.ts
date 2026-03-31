import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { __testInternals, runProcessBatchBuild } from '../src/lib/process-batch-build.js';
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

function writeProcessRequest(
  dir: string,
  fileName: string,
  options?: {
    flowPath?: string;
    overrides?: Record<string, unknown>;
  },
): string {
  const flowPath = options?.flowPath ?? writeFlowFixture(dir);
  const requestPath = path.join(dir, fileName);
  writeJson(requestPath, {
    flow_file: `./${path.basename(flowPath)}`,
    ...(options?.overrides ?? {}),
  });
  return requestPath;
}

test('runProcessBatchBuild prepares multiple process auto-build runs from one batch manifest', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-batch-build-success-'));
  const flowPath = writeFlowFixture(dir);
  writeProcessRequest(dir, 'request-a.json', {
    flowPath,
  });
  writeProcessRequest(dir, 'request-b.json', {
    flowPath,
  });
  const manifestPath = path.join(dir, 'batch-request.json');
  const explicitRunRoot = path.join(dir, 'custom-run-root');
  writeJson(manifestPath, {
    batch_id: 'batch-demo',
    out_dir: './batch-artifacts',
    items: [
      './request-a.json',
      {
        input_path: './request-b.json',
        item_id: 'second-item',
        out_dir: './custom-run-root',
      },
    ],
  });

  try {
    const report = await runProcessBatchBuild({
      inputPath: manifestPath,
      now: new Date('2026-03-29T07:00:00Z'),
      cwd: '/tmp/process-batch-build-success',
    });

    assert.equal(report.status, 'completed');
    assert.equal(report.batch_id, 'batch-demo');
    assert.equal(realpathSync(report.batch_root), realpathSync(path.join(dir, 'batch-artifacts')));
    assert.equal(report.continue_on_error, true);
    assert.deepEqual(report.counts, {
      total: 2,
      prepared: 2,
      failed: 0,
      skipped: 0,
    });
    assert.equal(existsSync(report.files.request_snapshot), true);
    assert.equal(existsSync(report.files.normalized_request), true);
    assert.equal(existsSync(report.files.invocation_index), true);
    assert.equal(existsSync(report.files.run_manifest), true);
    assert.equal(existsSync(report.files.report), true);

    const firstItem = report.items[0];
    assert.equal(firstItem?.status, 'prepared');
    assert.equal(firstItem?.run_id?.endsWith('_b001'), true);
    assert.equal(firstItem?.request_id, `pff-${firstItem?.run_id}`);
    assert.equal(
      realpathSync(firstItem?.run_root ?? ''),
      realpathSync(path.join(report.batch_root, 'runs', '001_request_a')),
    );

    const secondItem = report.items[1];
    assert.equal(secondItem?.status, 'prepared');
    assert.equal(secondItem?.run_id?.endsWith('_b002'), true);
    assert.equal(realpathSync(secondItem?.run_root ?? ''), realpathSync(explicitRunRoot));
    assert.equal(existsSync(secondItem?.files.report ?? ''), true);

    const invocationIndex = readJson<{
      invocations: Array<Record<string, unknown>>;
    }>(report.files.invocation_index);
    assert.equal(invocationIndex.invocations.length, 1);
    assert.deepEqual(invocationIndex.invocations[0]?.command, [
      'process',
      'batch-build',
      '--input',
      manifestPath,
    ]);

    const normalizedRequest = readJson<Record<string, unknown>>(report.files.normalized_request);
    assert.equal(normalizedRequest.batch_id, 'batch-demo');
    assert.equal((normalizedRequest.items as unknown[]).length, 2);

    const persistedReport = readJson(report.files.report);
    assert.deepEqual(persistedReport, report);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessBatchBuild supports partial failures when continue_on_error is true', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-batch-build-continue-'));
  const flowPath = writeFlowFixture(dir);
  writeProcessRequest(dir, 'request-a.json', {
    flowPath,
  });
  writeProcessRequest(dir, 'request-b.json', {
    flowPath,
    overrides: {
      request_id: 'req-custom',
    },
  });
  const manifestPath = path.join(dir, 'batch-request.json');
  writeJson(manifestPath, {
    batch_id: 'batch-continue',
    items: ['./request-a.json', './missing.json', './request-b.json'],
  });

  try {
    const report = await runProcessBatchBuild({
      inputPath: manifestPath,
      now: new Date('2026-03-29T07:30:00Z'),
      cwd: '/tmp/process-batch-build-continue',
    });

    assert.equal(report.status, 'completed_with_failures');
    assert.deepEqual(report.counts, {
      total: 3,
      prepared: 2,
      failed: 1,
      skipped: 0,
    });
    assert.equal(report.items[0]?.status, 'prepared');
    assert.equal(report.items[1]?.status, 'failed');
    assert.equal(report.items[1]?.error?.code, 'INPUT_NOT_FOUND');
    assert.equal(report.items[2]?.status, 'prepared');
    assert.equal(report.items[2]?.request_id, 'req-custom');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessBatchBuild stops after the first failure when continue_on_error is false', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-batch-build-stop-'));
  const flowPath = writeFlowFixture(dir);
  writeProcessRequest(dir, 'request-a.json', {
    flowPath,
  });
  writeProcessRequest(dir, 'request-c.json', {
    flowPath,
  });
  const manifestPath = path.join(dir, 'batch-request.json');
  writeJson(manifestPath, {
    batch_id: 'batch-stop',
    continue_on_error: false,
    items: ['./request-a.json', './missing.json', './request-c.json'],
  });

  try {
    const report = await runProcessBatchBuild({
      inputPath: manifestPath,
      now: new Date('2026-03-29T08:00:00Z'),
      cwd: '/tmp/process-batch-build-stop',
    });

    assert.equal(report.status, 'completed_with_failures');
    assert.deepEqual(report.counts, {
      total: 3,
      prepared: 1,
      failed: 1,
      skipped: 1,
    });
    assert.equal(report.items[0]?.status, 'prepared');
    assert.equal(report.items[1]?.status, 'failed');
    assert.equal(report.items[2]?.status, 'skipped');
    assert.equal(existsSync(path.join(report.batch_root, 'runs', '003_request_c')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessBatchBuild records explicit CLI outDir and handles non-object item requests', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-batch-build-cli-outdir-'));
  const flowPath = writeFlowFixture(dir);
  writeProcessRequest(dir, 'request-a.json', {
    flowPath,
    overrides: {
      run_id: 'cli-fixed-run',
      request_id: 'cli-fixed-request',
    },
  });
  const invalidRequestPath = path.join(dir, 'request-invalid.json');
  writeJson(invalidRequestPath, 'not-an-object');
  const manifestPath = path.join(dir, 'batch-request.json');
  const explicitBatchRoot = path.join(dir, 'cli-batch-root');
  writeJson(manifestPath, {
    batch_id: 'batch-cli-outdir',
    items: ['./request-a.json', './request-invalid.json'],
  });

  try {
    const report = await runProcessBatchBuild({
      inputPath: manifestPath,
      outDir: explicitBatchRoot,
      now: new Date('2026-03-29T08:15:00Z'),
      cwd: '/tmp/process-batch-build-cli-outdir',
    });

    assert.equal(report.status, 'completed_with_failures');
    assert.equal(realpathSync(report.batch_root), realpathSync(explicitBatchRoot));
    assert.equal(report.items[0]?.status, 'prepared');
    assert.equal(report.items[0]?.run_id, 'cli-fixed-run');
    assert.equal(report.items[0]?.request_id, 'cli-fixed-request');
    assert.equal(report.items[1]?.status, 'failed');
    assert.equal(report.items[1]?.error?.code, 'PROCESS_AUTO_BUILD_REQUEST_INVALID');

    const runManifest = readJson<{
      command: string[];
      layout: {
        runRoot: string;
      };
    }>(report.files.run_manifest);
    assert.deepEqual(runManifest.command, [
      'process',
      'batch-build',
      '--input',
      manifestPath,
      '--out-dir',
      explicitBatchRoot,
    ]);
    assert.equal(realpathSync(runManifest.layout.runRoot), realpathSync(explicitBatchRoot));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessBatchBuild rejects invalid manifests and duplicate runtime identifiers', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-batch-build-invalid-'));
  const flowPath = writeFlowFixture(dir);
  writeProcessRequest(dir, 'request-a.json', {
    flowPath,
    overrides: {
      run_id: 'fixed-run',
    },
  });
  writeProcessRequest(dir, 'request-b.json', {
    flowPath,
    overrides: {
      run_id: 'fixed-run',
    },
  });

  try {
    const invalidRootPath = path.join(dir, 'invalid-root.json');
    writeJson(invalidRootPath, 'not-an-object');
    await assert.rejects(
      () => runProcessBatchBuild({ inputPath: invalidRootPath }),
      /request must be a JSON object/u,
    );

    const missingItemsPath = path.join(dir, 'missing-items.json');
    writeJson(missingItemsPath, {});
    await assert.rejects(
      () => runProcessBatchBuild({ inputPath: missingItemsPath }),
      /items must be an array/u,
    );

    const emptyItemsPath = path.join(dir, 'empty-items.json');
    writeJson(emptyItemsPath, {
      items: [],
    });
    await assert.rejects(
      () => runProcessBatchBuild({ inputPath: emptyItemsPath }),
      /items must not be empty/u,
    );

    const badItemPath = path.join(dir, 'bad-item.json');
    writeJson(badItemPath, {
      items: [true],
    });
    await assert.rejects(
      () => runProcessBatchBuild({ inputPath: badItemPath }),
      /entries must be strings or objects/u,
    );

    const missingInputPath = path.join(dir, 'missing-input.json');
    writeJson(missingInputPath, {
      items: [{}],
    });
    await assert.rejects(
      () => runProcessBatchBuild({ inputPath: missingInputPath }),
      /missing 'input_path'/u,
    );

    const duplicateItemIdPath = path.join(dir, 'duplicate-item-id.json');
    writeJson(duplicateItemIdPath, {
      items: [
        { input_path: './request-a.json', item_id: 'same' },
        { input_path: './request-b.json', item_id: 'same' },
      ],
    });
    await assert.rejects(
      () => runProcessBatchBuild({ inputPath: duplicateItemIdPath }),
      /Duplicate process batch-build item_id/u,
    );

    const duplicateRunIdPath = path.join(dir, 'duplicate-run-id.json');
    writeJson(duplicateRunIdPath, {
      batch_id: 'batch-duplicate-runid',
      items: ['./request-a.json', './request-b.json'],
    });
    const duplicateRunIdReport = await runProcessBatchBuild({
      inputPath: duplicateRunIdPath,
      now: new Date('2026-03-29T08:30:00Z'),
      cwd: '/tmp/process-batch-build-duplicate-runid',
    });
    assert.equal(duplicateRunIdReport.status, 'completed_with_failures');
    assert.equal(duplicateRunIdReport.items[0]?.status, 'prepared');
    assert.equal(duplicateRunIdReport.items[1]?.status, 'failed');
    assert.equal(
      duplicateRunIdReport.items[1]?.error?.code,
      'PROCESS_BATCH_BUILD_RUN_ID_DUPLICATE',
    );

    const existingRootPath = path.join(dir, 'existing-root.json');
    const existingRootDir = path.join(dir, 'existing-root');
    mkdirSync(existingRootDir, { recursive: true });
    writeFileSync(path.join(existingRootDir, 'keep.txt'), 'busy', 'utf8');
    writeJson(existingRootPath, {
      batch_id: 'batch-existing-root',
      out_dir: './existing-root',
      items: ['./request-a.json'],
    });
    await assert.rejects(
      () => runProcessBatchBuild({ inputPath: existingRootPath }),
      /run root already exists and is not empty/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('process batch-build internals cover layout, normalization, and helper fallbacks', () => {
  const layout = __testInternals.buildLayout('/tmp/process-batch/batch-1', 'batch-1');
  assert.equal(layout.runId, 'batch-1');
  assert.equal(layout.requestSnapshotPath, '/tmp/process-batch/batch-1/request/batch-request.json');

  assert.equal(
    __testInternals.resolveBatchRoot('/tmp/work', 'batch-1', './override', null),
    path.resolve('/tmp/work', './override'),
  );
  assert.equal(
    __testInternals.resolveBatchRoot('/tmp/work', 'batch-1', null, './request-root'),
    path.resolve('/tmp/work', './request-root'),
  );
  assert.equal(
    __testInternals.resolveBatchRoot('/tmp/work', 'batch-1', '   ', './request-root'),
    path.resolve('/tmp/work', './request-root'),
  );

  const normalized = __testInternals.normalizeProcessBatchBuildRequest(
    {
      batch_id: 'batch-inline',
      continue_on_error: false,
      items: ['./request-a.json', './request-a.json'],
    },
    {
      inputPath: '/tmp/work/batch-request.json',
      outDir: './batch-root',
      now: new Date('2026-03-29T09:00:00Z'),
    },
  );
  assert.equal(normalized.batch_id, 'batch-inline');
  assert.equal(normalized.continue_on_error, false);
  assert.equal(normalized.items[0]?.item_id, 'request_a');
  assert.equal(normalized.items[1]?.item_id, 'request_a_2');

  const normalizedWithoutNow = __testInternals.normalizeProcessBatchBuildRequest(
    {
      batch_id: 'batch-inline-default-now',
      items: ['./request-a.json'],
    },
    {
      inputPath: '/tmp/work/batch-request.json',
    },
  );
  assert.equal(normalizedWithoutNow.batch_id, 'batch-inline-default-now');

  const normalizedWithOccupiedSuffix = __testInternals.normalizeProcessBatchBuildRequest(
    {
      batch_id: 'batch-inline-loop',
      items: [
        './request-a.json',
        {
          input_path: './request-b.json',
          item_id: 'request_a_2',
        },
        './request-a.json',
      ],
    },
    {
      inputPath: '/tmp/work/batch-request.json',
      now: new Date('2026-03-29T09:05:00Z'),
    },
  );
  assert.equal(normalizedWithOccupiedSuffix.items[2]?.item_id, 'request_a_3');

  const invocationIndex = __testInternals.buildInvocationIndex(
    normalized,
    {
      inputPath: '/tmp/work/batch-request.json',
      outDir: './batch-root',
      cwd: '/tmp/workspace',
    },
    layout,
    new Date('2026-03-29T09:10:00Z'),
  ) as {
    invocations: Array<Record<string, unknown>>;
  };
  assert.deepEqual(invocationIndex.invocations[0]?.command, [
    'process',
    'batch-build',
    '--input',
    '/tmp/work/batch-request.json',
    '--out-dir',
    './batch-root',
  ]);

  const invocationIndexWithoutCwd = __testInternals.buildInvocationIndex(
    normalized,
    {
      inputPath: '/tmp/work/batch-request.json',
    },
    layout,
    new Date('2026-03-29T09:15:00Z'),
  ) as {
    invocations: Array<Record<string, unknown>>;
  };
  assert.equal(invocationIndexWithoutCwd.invocations[0]?.cwd, process.cwd());

  const report = __testInternals.buildReport(
    normalized,
    layout,
    [
      {
        item_id: 'request_a',
        index: 0,
        input_path: '/tmp/work/request-a.json',
        out_dir: '/tmp/work/batch-root/runs/001_request_a',
        status: 'prepared',
        run_id: 'run-1',
        run_root: '/tmp/work/batch-root/runs/001_request_a',
        request_id: 'req-1',
        files: {
          request_snapshot: '/tmp/work/req.json',
          report: '/tmp/work/report.json',
          state: '/tmp/work/state.json',
          handoff_summary: '/tmp/work/handoff.json',
          run_manifest: '/tmp/work/run-manifest.json',
        },
        error: null,
      },
      {
        item_id: 'request_b',
        index: 1,
        input_path: '/tmp/work/request-b.json',
        out_dir: '/tmp/work/batch-root/runs/002_request_b',
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
      },
    ],
    new Date('2026-03-29T09:20:00Z'),
  );
  assert.equal(report.status, 'completed');
  assert.equal(report.counts.skipped, 1);

  const nextActions = __testInternals.buildNextActions(layout);
  assert.match(nextActions[2] ?? '', /consume items\[\]\.run_root/u);
});
