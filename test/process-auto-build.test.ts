import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  __testInternals,
  normalizeProcessAutoBuildRequest,
  runProcessAutoBuild,
} from '../src/lib/process-auto-build.js';
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

function writeFlowFixture(
  dir: string,
  options?: {
    fileName?: string;
    direct?: boolean;
    payload?: unknown;
  },
): string {
  const fileName = options?.fileName ?? '01211_3a8d74d8_reference-flow.json';
  const payload = options?.payload ?? bundledFlowPayload();
  const value =
    options?.direct && payload && typeof payload === 'object' && 'flowDataSet' in payload
      ? (payload as { flowDataSet: unknown }).flowDataSet
      : payload;
  const filePath = path.join(dir, fileName);
  writeJson(filePath, value);
  return filePath;
}

test('normalizeProcessAutoBuildRequest resolves defaults, flow summaries, and source inputs', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-auto-build-normalize-'));
  const flowPath = writeFlowFixture(dir);
  const sourcePath = path.join(dir, 'paper.pdf');
  const requestPath = path.join(dir, 'request.json');
  writeFileSync(sourcePath, 'paper-data', 'utf8');
  writeJson(requestPath, {
    flow_file: `./${path.basename(flowPath)}`,
    source_inputs: [
      {
        source_id: 'paper-1',
        type: 'local_file',
        path: './paper.pdf',
        intended_roles: ['tech_route', 'exchange_values'],
      },
    ],
  });

  try {
    const normalized = normalizeProcessAutoBuildRequest(readJson(requestPath), {
      inputPath: requestPath,
      now: new Date('2026-03-29T00:00:00Z'),
    });

    assert.equal(normalized.request_id, 'pff-pfw_01211_3a8d74d8_produce_20260329T000000Z');
    assert.equal(normalized.run_id, 'pfw_01211_3a8d74d8_produce_20260329T000000Z');
    assert.equal(
      normalized.run_root,
      path.join(dir, 'artifacts', 'process_from_flow', normalized.run_id),
    );
    assert.equal(normalized.flow_file, flowPath);
    assert.equal(normalized.flow_summary.wrapper, 'flowDataSet');
    assert.equal(normalized.flow_summary.uuid, '4d8a3345-51fd-44ac-87e0-59bc8d3b0fdc');
    assert.equal(normalized.flow_summary.version, '00.00.002');
    assert.match(normalized.flow_summary.base_name ?? '', /2-chloro-3-methyl/u);
    assert.equal(normalized.source_inputs.length, 1);
    assert.deepEqual(normalized.source_inputs[0]?.intended_roles, [
      'tech_route',
      'exchange_values',
    ]);
    assert.equal(
      normalized.source_inputs[0]?.artifact_path,
      path.join(
        dir,
        'artifacts',
        'process_from_flow',
        normalized.run_id,
        'evidence',
        'incoming',
        '01_paper_1.pdf',
      ),
    );
    assert.deepEqual(normalized.source_policy.step1_route.preferred, ['user_bundle', 'kb_bundle']);
    assert.equal(normalized.source_policy.step3b_exchange_values.allow_estimation, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('normalizeProcessAutoBuildRequest applies overrides, direct flow roots, and merged source policy', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-auto-build-overrides-'));
  const flowPath = writeFlowFixture(dir, {
    fileName: 'direct-flow.json',
    direct: true,
  });
  const requestPath = path.join(dir, 'request.json');
  writeJson(requestPath, {
    request_id: 'req-1',
    run_id: 'custom-run',
    flow_file: './direct-flow.json',
    workspace_run_root: './workspace-run-root',
    operation: 'treat',
    source_policy: {
      step1_route: {
        preferred: ['kb_bundle'],
        fallback: 'manual',
      },
      step3b_exchange_values: {
        allow_estimation: false,
      },
    },
  });

  try {
    const normalized = normalizeProcessAutoBuildRequest(readJson(requestPath), {
      inputPath: requestPath,
      outDir: './override-run-root',
    });

    assert.equal(normalized.request_id, 'req-1');
    assert.equal(normalized.run_id, 'custom-run');
    assert.equal(normalized.run_root, path.join(dir, 'override-run-root'));
    assert.equal(normalized.operation, 'treat');
    assert.equal(normalized.flow_file, flowPath);
    assert.equal(normalized.flow_summary.wrapper, 'direct');
    assert.deepEqual(normalized.source_policy.step1_route.preferred, ['kb_bundle']);
    assert.equal(normalized.source_policy.step1_route.fallback, 'manual');
    assert.deepEqual(normalized.source_policy.step2_process_split.preferred, [
      'user_bundle.process_split',
      'si_bundle',
      'kb_bundle.process_split',
    ]);
    assert.equal(normalized.source_policy.step3b_exchange_values.require_numeric_evidence, true);
    assert.equal(normalized.source_policy.step3b_exchange_values.allow_estimation, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('normalizeProcessAutoBuildRequest rejects invalid request and source input shapes', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-auto-build-invalid-'));
  const flowPath = writeFlowFixture(dir);
  const requestPath = path.join(dir, 'request.json');
  const sourcePath = path.join(dir, 'notes.md');
  writeFileSync(sourcePath, 'hello', 'utf8');
  writeJson(requestPath, {
    flow_file: `./${path.basename(flowPath)}`,
  });

  try {
    assert.throws(
      () =>
        normalizeProcessAutoBuildRequest('not-an-object', {
          inputPath: requestPath,
        }),
      /must be a JSON object/u,
    );

    assert.throws(
      () =>
        normalizeProcessAutoBuildRequest(
          {
            operation: 'produce',
          },
          {
            inputPath: requestPath,
          },
        ),
      /missing 'flow_file'/u,
    );

    assert.throws(
      () =>
        normalizeProcessAutoBuildRequest(
          {
            flow_file: './01211_3a8d74d8_reference-flow.json',
            operation: 'ship',
          },
          {
            inputPath: requestPath,
          },
        ),
      /must be 'produce' or 'treat'/u,
    );

    assert.throws(
      () =>
        normalizeProcessAutoBuildRequest(
          {
            flow_file: './01211_3a8d74d8_reference-flow.json',
            source_inputs: {},
          },
          {
            inputPath: requestPath,
          },
        ),
      /source_inputs must be an array/u,
    );

    assert.throws(
      () =>
        normalizeProcessAutoBuildRequest(
          {
            flow_file: './01211_3a8d74d8_reference-flow.json',
            source_inputs: ['bad'],
          },
          {
            inputPath: requestPath,
          },
        ),
      /entries must be objects/u,
    );

    assert.throws(
      () =>
        normalizeProcessAutoBuildRequest(
          {
            flow_file: './01211_3a8d74d8_reference-flow.json',
            source_inputs: [
              {
                source_id: 'src-1',
                type: 'remote_url',
                path: './notes.md',
              },
            ],
          },
          {
            inputPath: requestPath,
          },
        ),
      /type must be 'local_file' or 'local_text'/u,
    );

    assert.throws(
      () =>
        normalizeProcessAutoBuildRequest(
          {
            flow_file: './01211_3a8d74d8_reference-flow.json',
            source_inputs: [
              {
                source_id: 'src-1',
                type: 'local_text',
                path: './missing.md',
              },
            ],
          },
          {
            inputPath: requestPath,
          },
        ),
      /source input not found/u,
    );

    assert.throws(
      () =>
        normalizeProcessAutoBuildRequest(
          {
            flow_file: './01211_3a8d74d8_reference-flow.json',
            source_inputs: [
              {
                source_id: 'dup',
                type: 'local_text',
                path: './notes.md',
              },
              {
                source_id: 'dup',
                type: 'local_text',
                path: './notes.md',
              },
            ],
          },
          {
            inputPath: requestPath,
          },
        ),
      /Duplicate process auto-build source_id/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('process auto-build internals cover text extraction and fallback summaries', () => {
  assert.equal(__testInternals.extractText('direct value'), 'direct value');
  assert.equal(__testInternals.extractText('   '), null);
  assert.equal(
    __testInternals.extractText([{ '#text': 'from object' }, { '#text': 'ignored' }]),
    'from object',
  );
  assert.equal(__testInternals.extractText([]), null);
  assert.equal(__testInternals.extractText({ '#text': 'wrapped' }), 'wrapped');
  assert.equal(__testInternals.extractText({ value: 'missing' }), null);

  const directRoot = __testInternals.extractFlowDatasetRoot({
    '@id': 'flow-direct',
    '@version': '01.00.000',
  });
  assert.equal(directRoot.wrapper, 'direct');

  const summary = __testInternals.extractFlowSummary(
    {
      '@id': 'flow-direct',
      '@version': '01.00.000',
    },
    'direct',
  );
  assert.equal(summary.uuid, 'flow-direct');
  assert.equal(summary.version, '01.00.000');
  assert.equal(summary.base_name, null);

  const emptySummary = __testInternals.extractFlowSummary({}, 'direct');
  assert.equal(emptySummary.uuid, null);
  assert.equal(emptySummary.version, null);
  assert.equal(emptySummary.base_name, null);
  assert.equal(emptySummary.permanent_uri, null);

  const runId = __testInternals.buildProcessAutoBuildRunId(
    '/tmp/flow.json',
    'treat',
    {
      wrapper: 'direct',
      uuid: 'abc-1234',
      version: '01.00.000',
      base_name: null,
      permanent_uri: null,
    },
    new Date('2026-03-29T01:02:03Z'),
  );
  assert.equal(runId, 'pfw_flow_abc_1234_treat_20260329T010203Z');

  const fallbackRunId = __testInternals.buildProcessAutoBuildRunId(
    '/tmp/_.json',
    'produce',
    {
      wrapper: 'direct',
      uuid: null,
      version: null,
      base_name: 'Fallback Flow',
      permanent_uri: null,
    },
    new Date('2026-03-29T04:05:06Z'),
  );
  assert.equal(fallbackRunId, 'pfw_fallback_flow_unknown_produce_20260329T040506Z');

  const uuidFallbackRunId = __testInternals.buildProcessAutoBuildRunId(
    '/tmp/_.json',
    'treat',
    {
      wrapper: 'direct',
      uuid: 'abc-1234',
      version: null,
      base_name: null,
      permanent_uri: null,
    },
    new Date('2026-03-29T04:06:07Z'),
  );
  assert.equal(uuidFallbackRunId, 'pfw_abc_1234_abc_1234_treat_20260329T040607Z');

  const layout = __testInternals.buildLayout('/tmp/custom-run-root', 'run-1');
  assert.equal(layout.inputsDir, '/tmp/custom-run-root/input');
  assert.equal(layout.outputsDir, '/tmp/custom-run-root/exports');

  const assemblyPlan = __testInternals.buildAssemblyPlan('/tmp/custom-run-root') as {
    stages: Array<Record<string, unknown>>;
  };
  assert.equal(assemblyPlan.stages.length, 10);
  assert.equal(assemblyPlan.stages[0]?.candidates_dir, 'stage_outputs/01_route/candidates');
  assert.equal(assemblyPlan.stages[2]?.candidates_dir, null);
});

test('process auto-build internals cover source-policy and empty-stage fallbacks', () => {
  const invalidSections = __testInternals.normalizeSourcePolicy({
    step1_route: 'bad',
    step2_process_split: 'bad',
    step3b_exchange_values: 'bad',
  });
  assert.deepEqual(invalidSections.step1_route.preferred, ['user_bundle', 'kb_bundle']);
  assert.equal(invalidSections.step1_route.fallback, 'expert_judgement');
  assert.deepEqual(invalidSections.step2_process_split.preferred, [
    'user_bundle.process_split',
    'si_bundle',
    'kb_bundle.process_split',
  ]);
  assert.deepEqual(invalidSections.step3b_exchange_values.preferred, [
    'user_bundle.exchange_values',
    'si_bundle',
    'kb_bundle.exchange_values',
  ]);

  const emptyPreferred = __testInternals.normalizeSourcePolicy({
    step1_route: {
      preferred: [' ', null],
    },
  });
  assert.deepEqual(emptyPreferred.step1_route.preferred, ['user_bundle', 'kb_bundle']);
  assert.equal(emptyPreferred.step1_route.fallback, 'expert_judgement');

  const explicitStep2 = __testInternals.normalizeSourcePolicy({
    step2_process_split: {
      preferred: ['custom.process_split'],
      fallback: 'manual',
    },
  });
  assert.deepEqual(explicitStep2.step2_process_split.preferred, ['custom.process_split']);
  assert.equal(explicitStep2.step2_process_split.fallback, 'manual');

  const stages = __testInternals.PROCESS_AUTO_BUILD_STAGES;
  const originalStages = stages.splice(0, stages.length);

  try {
    const initialState = __testInternals.buildInitialState(
      {
        schema_version: 1,
        request_path: '/tmp/request.json',
        request_id: 'req-1',
        flow_file: '/tmp/flow.json',
        flow_summary: {
          wrapper: 'direct',
          uuid: null,
          version: null,
          base_name: null,
          permanent_uri: null,
        },
        flow_dataset: {},
        operation: 'produce',
        run_id: 'run-1',
        run_root: '/tmp/run-1',
        source_inputs: [],
        source_policy: __testInternals.normalizeSourcePolicy(undefined),
      },
      '/tmp/run-1/input/flow.json',
      new Date('2026-03-29T05:06:07Z'),
    ) as Record<string, unknown>;

    assert.equal(initialState.next_stage, null);
  } finally {
    stages.push(...originalStages);
  }
});

test('runProcessAutoBuild writes the local artifact scaffold, state, and handoff summary', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-auto-build-run-'));
  const flowPath = writeFlowFixture(dir);
  const requestPath = path.join(dir, 'request.json');
  writeJson(requestPath, {
    flow_file: `./${path.basename(flowPath)}`,
  });

  try {
    const report = await runProcessAutoBuild({
      inputPath: requestPath,
      now: new Date('2026-03-29T02:00:00Z'),
      cwd: '/tmp/workspace',
    });

    assert.equal(report.status, 'prepared_local_process_auto_build_run');
    assert.equal(report.run_root, path.join(dir, 'artifacts', 'process_from_flow', report.run_id));
    assert.equal(existsSync(report.files.state), true);
    assert.equal(existsSync(report.files.handoff_summary), true);
    assert.equal(existsSync(report.files.run_manifest), true);
    assert.equal(existsSync(report.files.request_snapshot), true);
    assert.equal(
      readFileSync(path.join(path.dirname(report.run_root), '.latest_run_id'), 'utf8'),
      `${report.run_id}\n`,
    );

    const inputManifest = readJson(report.files.input_manifest);
    assert.equal(inputManifest.run_id, report.run_id);
    assert.equal(inputManifest.flow_path, flowPath);

    const runManifest = readJson(report.files.run_manifest);
    assert.deepEqual(runManifest.command, ['process', 'auto-build', '--input', requestPath]);
    assert.equal(runManifest.cwd, '/tmp/workspace');

    const state = readJson(report.files.state);
    assert.equal(state.build_status, 'intake_prepared');
    assert.equal(state.next_stage, '01_route');
    const stepMarkers = state.step_markers as Record<string, { status?: unknown }>;
    assert.equal(stepMarkers.intake_prepared?.status, 'completed');
    assert.equal(Array.isArray(state.process_datasets), true);

    const handoff = readJson(report.files.handoff_summary);
    assert.equal(handoff.command, 'process auto-build');
    assert.equal((handoff.extra as Record<string, unknown>).status, report.status);
    assert.equal(Array.isArray(handoff.next_actions), true);

    const reportArtifact = readJson(report.files.report);
    assert.equal(reportArtifact.run_id, report.run_id);
    const reportArtifactFiles = reportArtifact.files as Record<string, unknown>;
    assert.equal(reportArtifactFiles.state, report.files.state);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessAutoBuild respects outDir overrides, copies source inputs, and tracks invocation metadata', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-auto-build-outdir-'));
  const flowPath = writeFlowFixture(dir);
  const sourcePath = path.join(dir, 'notes.md');
  const requestPath = path.join(dir, 'request.json');
  const overrideRoot = path.join(dir, 'existing-empty-run-root');
  mkdirSync(overrideRoot, { recursive: true });
  writeFileSync(sourcePath, '# notes\n', 'utf8');
  writeJson(requestPath, {
    request_id: 'req-override',
    run_id: 'run-override',
    flow_file: `./${path.basename(flowPath)}`,
    source_inputs: [
      {
        source_id: 'notes',
        type: 'local_text',
        path: './notes.md',
        intended_roles: ['assumptions'],
      },
    ],
  });

  try {
    const report = await runProcessAutoBuild({
      inputPath: requestPath,
      outDir: './existing-empty-run-root',
      now: new Date('2026-03-29T03:00:00Z'),
    });

    assert.equal(report.run_root, overrideRoot);
    assert.equal(
      readFileSync(path.join(report.run_root, 'input', path.basename(flowPath)), 'utf8'),
      readFileSync(flowPath, 'utf8'),
    );
    assert.equal(
      readFileSync(path.join(report.run_root, 'evidence', 'incoming', '01_notes.md'), 'utf8'),
      '# notes\n',
    );

    const lineage = readJson(report.files.lineage_manifest);
    const lineageSources = lineage.source_inputs as Array<Record<string, unknown>>;
    assert.equal(lineageSources.length, 1);
    assert.equal(
      lineageSources[0]?.artifact_path,
      path.join(report.run_root, 'evidence', 'incoming', '01_notes.md'),
    );

    const invocationIndex = readJson(report.files.invocation_index);
    const command = (invocationIndex.invocations as Array<Record<string, unknown>>)[0]
      ?.command as string[];
    assert.deepEqual(command, [
      'process',
      'auto-build',
      '--input',
      requestPath,
      '--out-dir',
      './existing-empty-run-root',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessAutoBuild rejects invalid flow payloads, non-empty run roots, and source copy failures', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-auto-build-errors-'));
  const invalidFlowPath = writeFlowFixture(dir, {
    fileName: 'invalid-flow.json',
    payload: [],
  });
  const invalidRequestPath = path.join(dir, 'invalid-request.json');
  writeJson(invalidRequestPath, {
    flow_file: `./${path.basename(invalidFlowPath)}`,
  });

  writeFlowFixture(dir, {
    fileName: 'valid-flow.json',
  });
  const existingRoot = path.join(dir, 'non-empty-run-root');
  mkdirSync(existingRoot, { recursive: true });
  writeFileSync(path.join(existingRoot, 'keep.txt'), 'busy', 'utf8');
  const existingRootRequestPath = path.join(dir, 'existing-root-request.json');
  writeJson(existingRootRequestPath, {
    flow_file: './valid-flow.json',
    workspace_run_root: './non-empty-run-root',
  });

  const sourceDir = path.join(dir, 'source-dir');
  mkdirSync(sourceDir, { recursive: true });
  const sourceDirRequestPath = path.join(dir, 'source-dir-request.json');
  writeJson(sourceDirRequestPath, {
    flow_file: './valid-flow.json',
    source_inputs: [
      {
        source_id: 'source-dir',
        type: 'local_text',
        path: './source-dir',
      },
    ],
  });

  try {
    await assert.rejects(
      () =>
        runProcessAutoBuild({
          inputPath: invalidRequestPath,
        }),
      /flow file must contain a JSON object/u,
    );

    await assert.rejects(
      () =>
        runProcessAutoBuild({
          inputPath: existingRootRequestPath,
        }),
      /run root already exists and is not empty/u,
    );

    await assert.rejects(
      () =>
        runProcessAutoBuild({
          inputPath: sourceDirRequestPath,
        }),
      /Failed to copy artifact file/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
