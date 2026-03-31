import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  __testInternals,
  runLifecyclemodelOrchestrate,
} from '../src/lib/lifecyclemodel-orchestrate.js';
import { CliError } from '../src/lib/errors.js';

type JsonRecord = Record<string, unknown>;

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function textItem(text: string, lang = 'en'): JsonRecord {
  return {
    '@xml:lang': lang,
    '#text': text,
  };
}

function createExchange(options: {
  internalId: string;
  flowId: string;
  direction: 'Input' | 'Output';
  meanAmount: number;
}): JsonRecord {
  return {
    '@dataSetInternalID': options.internalId,
    exchangeDirection: options.direction,
    referenceToFlowDataSet: {
      '@refObjectId': options.flowId,
      '@type': 'flow data set',
    },
    meanAmount: options.meanAmount,
  };
}

function createProcessPayload(options: {
  id: string;
  referenceInternalId: string;
  exchanges: JsonRecord[];
  baseName: string;
  classificationPath: string[];
  includeEnteringRef?: boolean;
}): JsonRecord {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          'common:UUID': options.id,
          name: {
            baseName: [textItem(options.baseName, 'en'), textItem(`${options.baseName}-zh`, 'zh')],
            treatmentStandardsRoutes: [textItem('route', 'en')],
            mixAndLocationTypes: [textItem('mix', 'en')],
          },
          classificationInformation: {
            classification: {
              class: options.classificationPath.map((entry, index) => ({
                '@level': index + 1,
                '#text': entry,
              })),
            },
          },
        },
        quantitativeReference: {
          referenceToReferenceFlow: options.referenceInternalId,
          ...(options.includeEnteringRef === false
            ? {}
            : {
                referenceToFunctionalUnitOrOther: {
                  '@refObjectId': options.referenceInternalId,
                },
              }),
        },
      },
      exchanges: {
        exchange: options.exchanges,
      },
      administrativeInformation: {
        publicationAndOwnership: {
          'common:dataSetVersion': '00.00.001',
        },
      },
      modellingAndValidation: {
        LCIMethodAndAllocation: {
          typeOfDataSet: 'Unit process, single operation',
        },
      },
      complianceDeclarations: {
        compliance: {},
      },
    },
  };
}

function createProcessInstance(options: {
  instanceId: string;
  processId: string;
  version?: string;
}): JsonRecord {
  return {
    '@dataSetInternalID': options.instanceId,
    '@multiplicationFactor': '1',
    referenceToProcess: {
      '@refObjectId': options.processId,
      '@version': options.version ?? '00.00.001',
      name: {
        baseName: [textItem(options.processId, 'en')],
      },
    },
    connections: {
      outputExchange: [],
    },
  };
}

function createLifecycleModel(options: {
  id: string;
  name: string;
  referenceProcessInstanceId: string;
  referenceToResultingProcessId: string;
  instances: JsonRecord[];
}): JsonRecord {
  return {
    lifeCycleModelDataSet: {
      '@id': options.id,
      '@version': '00.00.001',
      lifeCycleModelInformation: {
        dataSetInformation: {
          'common:UUID': options.id,
          name: {
            baseName: [textItem(options.name, 'en')],
          },
          referenceToResultingProcess: {
            '@refObjectId': options.referenceToResultingProcessId,
            '@version': '00.00.001',
          },
        },
        quantitativeReference: {
          referenceToReferenceProcess: options.referenceProcessInstanceId,
        },
        technology: {
          processes: {
            processInstance: options.instances,
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          'common:dataSetVersion': '00.00.001',
        },
      },
    },
  };
}

function createProcessRunFixture(rootDir: string, runName: string): string {
  const runDir = path.join(rootDir, runName);
  const statePath = path.join(runDir, 'cache', 'process_from_flow_state.json');
  const processDir = path.join(runDir, 'exports', 'processes');
  mkdirSync(processDir, { recursive: true });

  writeJson(statePath, {
    flow_summary: {
      uuid: 'flow-target',
      base_name: 'Target flow',
      base_name_en: 'Target flow',
      base_name_zh: '目标流',
    },
    flow_dataset: {
      flowDataSet: {
        flowInformation: {
          dataSetInformation: {
            name: {
              baseName: [textItem('Target flow', 'en'), textItem('目标流', 'zh')],
              treatmentStandardsRoutes: [textItem('target route', 'en')],
              mixAndLocationTypes: [textItem('target mix', 'en')],
            },
          },
        },
      },
    },
  });

  const upstream = createProcessPayload({
    id: 'process-upstream',
    referenceInternalId: '10',
    exchanges: [
      createExchange({
        internalId: '10',
        flowId: 'flow-intermediate',
        direction: 'Output',
        meanAmount: 2,
      }),
    ],
    baseName: 'Upstream process',
    classificationPath: ['chemicals', 'intermediate'],
  });
  const downstream = createProcessPayload({
    id: 'process-downstream',
    referenceInternalId: '21',
    exchanges: [
      createExchange({
        internalId: '20',
        flowId: 'flow-intermediate',
        direction: 'Input',
        meanAmount: 4,
      }),
      createExchange({
        internalId: '21',
        flowId: 'flow-target',
        direction: 'Output',
        meanAmount: 1,
      }),
    ],
    baseName: 'Downstream process',
    classificationPath: ['chemicals', 'target'],
  });

  writeJson(path.join(processDir, 'process-upstream_00.00.001.json'), upstream);
  writeJson(path.join(processDir, 'process-downstream_00.00.001.json'), downstream);
  return runDir;
}

function createStaticProjectorRequestFixture(rootDir: string): string {
  const modelDir = path.join(rootDir, 'projector-static');
  const processDir = path.join(modelDir, 'processes');
  mkdirSync(processDir, { recursive: true });
  const modelPath = path.join(modelDir, 'model.json');

  const process = createProcessPayload({
    id: 'process-static',
    referenceInternalId: '99',
    exchanges: [
      createExchange({
        internalId: '99',
        flowId: 'flow-static',
        direction: 'Output',
        meanAmount: 1,
      }),
    ],
    baseName: 'Static process',
    classificationPath: ['static'],
    includeEnteringRef: false,
  });
  writeJson(path.join(processDir, 'process-static_00.00.001.json'), process);
  writeJson(
    modelPath,
    createLifecycleModel({
      id: 'lm-static',
      name: 'Static model',
      referenceProcessInstanceId: 'static-inst',
      referenceToResultingProcessId: 'proc-static-result',
      instances: [
        createProcessInstance({
          instanceId: 'static-inst',
          processId: 'process-static',
        }),
      ],
    }),
  );

  const requestPath = path.join(modelDir, 'projector-request.json');
  writeJson(requestPath, {
    source_model: {
      json_ordered_path: modelPath,
    },
    projection: {
      mode: 'primary-only',
      metadata_overrides: {
        projection_source: 'static-fixture',
      },
    },
    process_sources: {
      process_json_dirs: [processDir],
      allow_remote_lookup: false,
    },
    publish: {
      intent: 'prepare_only',
      prepare_process_payloads: true,
      prepare_relation_payloads: true,
    },
  });

  return requestPath;
}

function flowFixturePath(): string {
  return path.resolve(process.cwd(), '../tidas-sdk/test-data/tidas-example-flow.json');
}

test('lifecyclemodel orchestrate internals normalize plans, warnings, and projector policy', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-lm-orchestrate-internals-'));
  try {
    const requestPath = path.join(dir, 'request.json');
    const plan = __testInternals.buildPlan(
      {
        request_id: 'plan-demo',
        goal: {
          name: 'Demo goal',
        },
        root: {
          node_id: 'root-model',
          kind: 'lifecyclemodel',
          lifecyclemodel: {
            id: 'lm-root',
          },
          requested_action: 'build_submodel',
          submodel_builder: {
            manifest: './manifest.json',
          },
          projector: {
            projection_role: 'primary',
          },
        },
        orchestration: {
          mode: 'collapsed',
          max_depth: 2,
          reuse_resulting_process_first: true,
          allow_process_build: true,
          allow_submodel_build: true,
          pin_child_versions: true,
          stop_at_elementary_flow: false,
          fail_fast: true,
        },
        publish: {
          intent: 'prepare_only',
        },
        nodes: [
          {
            node_id: 'child-process',
            kind: 'process',
            depends_on: ['unknown-node'],
            requested_action: 'reuse_existing_process',
            existing_process_candidates: ['proc-1'],
          },
        ],
      },
      requestPath,
      path.join(dir, 'out'),
      new Date('2026-03-30T00:00:00Z'),
    );

    assert.equal(plan.nodes.length, 2);
    assert.equal(plan.invocations.length, 2);
    assert.match(plan.warnings[0] ?? '', /depends on unknown node/u);
    assert.equal(plan.nodes[0]?.resolution, 'build_via_lifecyclemodel_automated_builder');
    assert.equal(plan.nodes[1]?.selected_candidate?.id, 'proc-1');
    assert.equal(
      __testInternals.shouldRunProjector(plan.nodes[0]!, plan.nodes[0]!.resolution!),
      true,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('lifecyclemodel orchestrate plan writes artifacts and publish works without invocation results', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-lm-orchestrate-plan-'));
  const processRunDir = createProcessRunFixture(dir, 'process-run');
  const manifestPath = path.join(dir, 'lifecyclemodel-request.json');
  const requestPath = path.join(dir, 'orchestrate-request.json');
  const outDir = path.join(dir, 'orchestrator-run');

  writeJson(manifestPath, {
    local_runs: [processRunDir],
  });
  writeJson(requestPath, {
    request_id: 'plan-only',
    goal: {
      name: 'Plan only demo',
    },
    root: {
      node_id: 'root-model',
      kind: 'lifecyclemodel',
      lifecyclemodel: {
        id: 'lm-plan',
      },
      requested_action: 'build_submodel',
      submodel_builder: {
        manifest: './lifecyclemodel-request.json',
      },
    },
    orchestration: {
      mode: 'collapsed',
      max_depth: 1,
      reuse_resulting_process_first: true,
      allow_process_build: false,
      allow_submodel_build: true,
      pin_child_versions: true,
      stop_at_elementary_flow: false,
      fail_fast: true,
    },
    publish: {
      intent: 'prepare_only',
      prepare_lifecyclemodel_payload: true,
      prepare_resulting_process_payload: true,
      prepare_relation_payload: true,
    },
  });

  try {
    const planReport = await runLifecyclemodelOrchestrate({
      action: 'plan',
      inputPath: requestPath,
      outDir,
      now: new Date('2026-03-30T00:00:00Z'),
    });
    assert.equal(planReport.status, 'planned');
    assert.equal(
      readJson<JsonRecord>(path.join(outDir, 'assembly-plan.json')).request_id,
      'plan-only',
    );

    const publishReport = await runLifecyclemodelOrchestrate({
      action: 'publish',
      runDir: outDir,
      now: new Date('2026-03-30T00:00:00Z'),
    });
    assert.equal(publishReport.status, 'prepared_local_publish_bundle');
    assert.equal(publishReport.counts.lifecyclemodels, 0);
    assert.equal(publishReport.counts.projected_processes, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('lifecyclemodel orchestrate execute runs CLI-backed builders and publish collects outputs', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-lm-orchestrate-execute-'));
  const processRunDir = createProcessRunFixture(dir, 'process-run');
  const manifestPath = path.join(dir, 'lifecyclemodel-request.json');
  const staticProjectorRequest = createStaticProjectorRequestFixture(dir);
  const requestPath = path.join(dir, 'orchestrate-request.json');
  const outDir = path.join(dir, 'orchestrator-run');

  writeJson(manifestPath, {
    local_runs: [processRunDir],
  });
  writeJson(requestPath, {
    request_id: 'execute-demo',
    goal: {
      name: 'Execute demo',
    },
    root: {
      node_id: 'model-live',
      kind: 'lifecyclemodel',
      lifecyclemodel: {
        id: 'lm-live',
      },
      requested_action: 'build_submodel',
      depends_on: ['process-node'],
      submodel_builder: {
        manifest: './lifecyclemodel-request.json',
      },
      projector: {
        projection_role: 'primary',
      },
    },
    orchestration: {
      mode: 'collapsed',
      max_depth: 2,
      reuse_resulting_process_first: true,
      allow_process_build: false,
      allow_submodel_build: false,
      pin_child_versions: true,
      stop_at_elementary_flow: false,
      fail_fast: true,
    },
    publish: {
      intent: 'prepare_only',
      prepare_lifecyclemodel_payload: true,
      prepare_resulting_process_payload: true,
      prepare_relation_payload: true,
    },
    nodes: [
      {
        node_id: 'process-node',
        kind: 'process',
        requested_action: 'build_process',
        process_builder: {
          mode: 'workflow',
          flow_file: flowFixturePath(),
        },
      },
      {
        node_id: 'model-dry',
        kind: 'lifecyclemodel',
        requested_action: 'build_submodel',
        submodel_builder: {
          manifest: './lifecyclemodel-request.json',
          dry_run: true,
        },
        projector: {
          request: staticProjectorRequest,
        },
      },
    ],
  });

  try {
    const executeReport = await runLifecyclemodelOrchestrate({
      action: 'execute',
      inputPath: requestPath,
      outDir,
      allowProcessBuild: true,
      allowSubmodelBuild: true,
      now: new Date('2026-03-30T00:00:00Z'),
    });
    assert.equal(executeReport.status, 'completed');
    assert.equal(executeReport.execution.failed_invocations, 0);
    assert.equal(executeReport.execution.successful_invocations, 5);

    const publishReport = await runLifecyclemodelOrchestrate({
      action: 'publish',
      runDir: outDir,
      now: new Date('2026-03-30T00:00:00Z'),
    });
    assert.equal(publishReport.action, 'publish');
    assert.equal(publishReport.counts.lifecyclemodels, 1);
    assert.equal(publishReport.counts.projected_processes, 2);
    assert.equal(publishReport.counts.process_build_runs, 1);

    const bundle = readJson<JsonRecord>(path.join(outDir, 'publish-bundle.json'));
    assert.equal((bundle.status as string) ?? '', 'prepared_local_publish_bundle');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('lifecyclemodel orchestrate marks removed legacy process-builder configs as failed and skips later work', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-lm-orchestrate-legacy-fail-'));
  const processRunDir = createProcessRunFixture(dir, 'process-run');
  const manifestPath = path.join(dir, 'lifecyclemodel-request.json');
  const requestPath = path.join(dir, 'orchestrate-request.json');
  const outDir = path.join(dir, 'orchestrator-run');

  writeJson(manifestPath, {
    local_runs: [processRunDir],
  });
  writeJson(requestPath, {
    request_id: 'legacy-fail',
    goal: {
      name: 'Legacy fail demo',
    },
    root: {
      node_id: 'model-live',
      kind: 'lifecyclemodel',
      lifecyclemodel: {
        id: 'lm-live',
      },
      requested_action: 'build_submodel',
      depends_on: ['legacy-node'],
      submodel_builder: {
        manifest: './lifecyclemodel-request.json',
      },
      projector: {
        projection_role: 'primary',
      },
    },
    orchestration: {
      mode: 'collapsed',
      max_depth: 2,
      reuse_resulting_process_first: true,
      allow_process_build: true,
      allow_submodel_build: true,
      pin_child_versions: true,
      stop_at_elementary_flow: false,
      fail_fast: true,
    },
    publish: {
      intent: 'prepare_only',
    },
    nodes: [
      {
        node_id: 'legacy-node',
        kind: 'process',
        requested_action: 'build_process',
        process_builder: {
          mode: 'langgraph',
          flow_file: flowFixturePath(),
        },
      },
    ],
  });

  try {
    const report = await runLifecyclemodelOrchestrate({
      action: 'execute',
      inputPath: requestPath,
      outDir,
      now: new Date('2026-03-30T00:00:00Z'),
    });
    assert.equal(report.status, 'failed');
    assert.equal(report.execution.failed_invocations, 1);
    assert.equal(report.execution.blocked_invocations, 2);

    const firstInvocation = readJson<JsonRecord>(
      path.join(outDir, 'invocations', 'legacy-node-process-builder.json'),
    );
    assert.equal(firstInvocation.status, 'failed');
    assert.match(String(firstInvocation.error ?? ''), /langgraph/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('lifecyclemodel orchestrate validates required options', async () => {
  await assert.rejects(
    () =>
      runLifecyclemodelOrchestrate({
        action: 'plan',
      }),
    (error) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, 'LIFECYCLEMODEL_ORCHESTRATE_INPUT_REQUIRED');
      return true;
    },
  );

  await assert.rejects(
    () =>
      runLifecyclemodelOrchestrate({
        action: 'execute',
        inputPath: '/tmp/request.json',
      }),
    (error) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, 'LIFECYCLEMODEL_ORCHESTRATE_OUT_DIR_REQUIRED');
      return true;
    },
  );

  await assert.rejects(
    () =>
      runLifecyclemodelOrchestrate({
        action: 'publish',
      }),
    (error) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, 'LIFECYCLEMODEL_ORCHESTRATE_RUN_DIR_REQUIRED');
      return true;
    },
  );
});

test('lifecyclemodel orchestrate helper internals validate primitive values and normalize config shapes', () => {
  const baseDir = path.join(os.tmpdir(), 'tg-cli-lm-orchestrate-helpers');

  assert.equal(__testInternals.invariant('ready', 'value should exist'), 'ready');
  assert.throws(
    () => __testInternals.invariant(undefined, 'missing helper invariant'),
    (error) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, 'LIFECYCLEMODEL_ORCHESTRATE_INTERNAL_STATE');
      return true;
    },
  );
  assert.equal(__testInternals.safeSlug('Hello, World!'), 'hello-world');
  assert.equal(__testInternals.safeSlug('---'), 'item');

  assert.deepEqual(__testInternals.requireObject({ ok: true }, 'request'), { ok: true });
  assert.throws(
    () => __testInternals.requireObject(null, 'request'),
    (error) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, 'LIFECYCLEMODEL_ORCHESTRATE_INVALID_REQUEST');
      return true;
    },
  );

  assert.equal(
    __testInternals.requireEnum('build', ['build', 'project'], 'projector.command'),
    'build',
  );
  assert.throws(
    () => __testInternals.requireEnum('invalid', ['build', 'project'], 'projector.command'),
    /projector.command must be one of/u,
  );

  assert.equal(__testInternals.requireBoolean(true, 'flag'), true);
  assert.throws(() => __testInternals.requireBoolean('true', 'flag'), /flag must be a boolean/u);

  assert.equal(__testInternals.requireInteger(2, 'depth'), 2);
  assert.throws(
    () => __testInternals.requireInteger(-1, 'depth'),
    /depth must be a non-negative integer/u,
  );

  assert.equal(__testInternals.resolveInputPath(baseDir, ''), null);
  assert.equal(
    __testInternals.resolveInputPath(baseDir, 'https://example.com/request.json'),
    'https://example.com/request.json',
  );
  assert.equal(
    __testInternals.resolveInputPath(baseDir, 'file:///tmp/request.json'),
    'file:///tmp/request.json',
  );
  assert.equal(
    __testInternals.resolveInputPath(baseDir, './request.json'),
    path.resolve(baseDir, './request.json'),
  );

  assert.deepEqual(__testInternals.defaultCandidateSources(), {
    my_processes: true,
    team_processes: true,
    public_processes: true,
    existing_lifecyclemodels: true,
    existing_resulting_processes: true,
  });
  assert.deepEqual(
    __testInternals.entityFromRoot({ kind: 'reference_flow', flow: { id: 'f-1' } }),
    {
      id: 'f-1',
    },
  );
  assert.deepEqual(__testInternals.entityFromRoot({ kind: 'reference_flow', flow: 'bad' }), {});
  assert.deepEqual(
    __testInternals.entityFromRoot({ kind: 'lifecyclemodel', lifecyclemodel: null }),
    {},
  );
  assert.deepEqual(
    __testInternals.entityFromRoot({ kind: 'resulting_process', resulting_process: [] }),
    {},
  );

  assert.deepEqual(__testInternals.normalizeCandidate('candidate-a'), {
    id: 'candidate-a',
    score: 1,
  });
  assert.deepEqual(__testInternals.normalizeCandidateList('candidate-single'), [
    { id: 'candidate-single', score: 1 },
  ]);
  assert.deepEqual(
    __testInternals.normalizeCandidate({ id: 'candidate-b', score: -1, extra: true }),
    {
      id: 'candidate-b',
      score: 1,
      extra: true,
    },
  );
  assert.throws(
    () => __testInternals.normalizeCandidate(1),
    /candidate must be an object or string/u,
  );
  assert.throws(
    () => __testInternals.normalizeCandidate({ score: 3 }),
    /candidate.id is required/u,
  );

  assert.deepEqual(
    __testInternals.normalizeCandidateList([
      { id: 'low', score: 0 },
      { id: 'high', score: 3 },
      'mid',
    ]),
    [
      { id: 'high', score: 3 },
      { id: 'mid', score: 1 },
      { id: 'low', score: 0 },
    ],
  );

  assert.equal(__testInternals.normalizeRequestedAction(undefined), 'auto');
  assert.equal(__testInternals.normalizeRequestedAction('cutoff'), 'cutoff');
  assert.throws(
    () => __testInternals.normalizeRequestedAction('bad-action'),
    /requested_action must be one of/u,
  );
  assert.deepEqual(__testInternals.normalizeDependsOn(['a', '', null, 'b']), ['a', 'b']);
  assert.deepEqual(
    __testInternals.normalizePublishConfig({
      intent: 'publish',
      prepare_lifecyclemodel_payload: false,
      prepare_resulting_process_payload: false,
    }),
    {
      intent: 'publish',
      prepare_lifecyclemodel_payload: false,
      prepare_resulting_process_payload: false,
      prepare_relation_payload: true,
    },
  );
  assert.deepEqual(
    __testInternals.normalizeInvocationFailure(
      new CliError('boom', {
        code: 'TEST',
        exitCode: 7,
      }),
    ),
    {
      exit_code: 7,
      error: 'boom',
    },
  );
  assert.deepEqual(__testInternals.normalizeInvocationFailure('plain failure'), {
    exit_code: 1,
    error: 'plain failure',
  });

  assert.equal(__testInternals.normalizeProcessBuilderConfig(null, baseDir), undefined);
  assert.deepEqual(
    __testInternals.normalizeProcessBuilderConfig(
      {
        mode: 'workflow',
        flow_file: './flow.json',
        flow_json: { flowDataSet: {} },
        run_id: 'run-1',
        python_bin: 'python3',
        publish: 1,
        commit: 1,
        forward_args: ['--alpha', '', '  ', '--beta'],
      },
      baseDir,
    ),
    {
      mode: 'workflow',
      flow_file: path.resolve(baseDir, './flow.json'),
      flow_json: { flowDataSet: {} },
      run_id: 'run-1',
      python_bin: 'python3',
      publish: true,
      commit: true,
      forward_args: ['--alpha', '--beta'],
    },
  );
  assert.deepEqual(
    __testInternals.serializeInvocationConfig(
      {
        mode: 'workflow',
        flow_file: null,
        flow_json: null,
        run_id: null,
        python_bin: null,
        publish: false,
        commit: false,
        forward_args: [],
      },
      'config should exist',
    ),
    {
      mode: 'workflow',
      flow_file: null,
      flow_json: null,
      run_id: null,
      python_bin: null,
      publish: false,
      commit: false,
      forward_args: [],
    },
  );
  assert.throws(
    () => __testInternals.serializeInvocationConfig(undefined, 'config should exist'),
    /config should exist/u,
  );

  assert.equal(__testInternals.normalizeSubmodelBuilderConfig(null, baseDir), undefined);
  assert.deepEqual(
    __testInternals.normalizeSubmodelBuilderConfig(
      {
        manifest: './manifest.json',
        out_dir: './out',
        dry_run: 1,
      },
      baseDir,
    ),
    {
      manifest: path.resolve(baseDir, './manifest.json'),
      out_dir: path.resolve(baseDir, './out'),
      dry_run: true,
    },
  );

  assert.equal(__testInternals.normalizeProjectorConfig(null, baseDir), undefined);
  assert.deepEqual(
    __testInternals.normalizeProjectorConfig(
      {
        command: 'build',
        request: './request.json',
        model_file: 'https://example.com/model.json',
        out_dir: './projector-out',
        projection_role: 'all',
        run_always: 1,
        publish_processes: 1,
        publish_relations: 1,
      },
      baseDir,
    ),
    {
      command: 'build',
      request: path.resolve(baseDir, './request.json'),
      model_file: 'https://example.com/model.json',
      out_dir: path.resolve(baseDir, './projector-out'),
      projection_role: 'all',
      run_always: true,
      publish_processes: true,
      publish_relations: true,
    },
  );
});

test('lifecyclemodel orchestrate root/entity helpers, edges, and topo sort cover cycle and fallback branches', () => {
  const baseDir = path.join(os.tmpdir(), 'tg-cli-lm-orchestrate-root');

  assert.deepEqual(
    __testInternals.deriveRootNode(
      {
        kind: 'reference_flow',
        flow: { id: 'flow-root', name: 'Flow root' },
        node_id: 'flow-root-node',
      },
      { name: 'Goal' },
      baseDir,
    ).entity,
    { id: 'flow-root', name: 'Flow root' },
  );

  const processRoot = __testInternals.deriveRootNode(
    {
      kind: 'process',
    },
    { name: 'Fallback goal' },
    baseDir,
  );
  assert.equal(processRoot.label, 'Fallback goal');
  assert.equal(processRoot.node_id, 'root');
  assert.deepEqual(processRoot.entity, {});

  assert.deepEqual(
    __testInternals.deriveRootNode(
      {
        kind: 'lifecyclemodel',
        lifecyclemodel: { id: 'lm-root', name: 'LM root' },
      },
      { name: 'Goal' },
      baseDir,
    ).entity,
    { id: 'lm-root', name: 'LM root' },
  );
  assert.deepEqual(
    __testInternals.deriveRootNode(
      {
        kind: 'resulting_process',
        resulting_process: { id: 'rp-1', name: 'Resulting process' },
      },
      { name: 'Goal' },
      baseDir,
    ).entity,
    { id: 'rp-1', name: 'Resulting process' },
  );
  assert.throws(
    () => __testInternals.deriveRootNode({ kind: 'unexpected-kind' } as never, {}, baseDir),
    /node.kind must be one of/u,
  );

  const defaultNode = __testInternals.normalizeNode({}, 7, baseDir);
  assert.equal(defaultNode.node_id, 'node-7');
  assert.equal(defaultNode.kind, 'process');
  assert.equal(defaultNode.label, 'node-7');

  const normalizedNode = __testInternals.normalizeNode(
    {
      id: 'child-node',
      kind: 'process',
      process: { id: 'proc-child', name: 'Process child' },
      parent_node_id: 'parent-node',
      depends_on: ['dep-b', 'parent-node', '', null],
      requested_action: 'reuse_existing_process',
      existing_process_candidates: [
        { id: 'proc-low', score: 0.1 },
        { id: 'proc-high', score: 0.9 },
      ],
      process_builder: {
        flow_file: './flow.json',
      },
      projector: {
        request: './projector.json',
      },
    },
    1,
    baseDir,
  );
  assert.equal(normalizedNode.label, 'Process child');
  assert.deepEqual(normalizedNode.depends_on, ['dep-b', 'parent-node']);
  assert.equal(normalizedNode.process_builder?.flow_file, path.resolve(baseDir, './flow.json'));
  assert.equal(normalizedNode.projector?.request, path.resolve(baseDir, './projector.json'));
  assert.deepEqual(
    normalizedNode.existing_process_candidates.map((entry) => entry.id),
    ['proc-high', 'proc-low'],
  );

  assert.deepEqual(
    __testInternals.buildEdges(
      [
        null,
        { from: 'child-node', to: 'dep-b' },
        { from: 'child-node', to: 'dep-b' },
        { from: 'child-node', to: 'custom-target', relation: 'supplies' },
        { from: '', to: 'missing' },
      ],
      [normalizedNode],
    ),
    [
      { from: 'child-node', to: 'dep-b', relation: 'depends_on' },
      { from: 'child-node', to: 'custom-target', relation: 'supplies' },
      { from: 'child-node', to: 'parent-node', relation: 'depends_on' },
    ],
  );

  const acyclic = __testInternals.topoSortNodes([
    {
      ...normalizedNode,
      node_id: 'upstream',
      depends_on: [],
    },
    {
      ...normalizedNode,
      node_id: 'downstream',
      depends_on: ['upstream'],
    },
  ]);
  assert.deepEqual(
    acyclic.ordered.map((entry) => entry.node_id),
    ['upstream', 'downstream'],
  );
  const fanOut = __testInternals.topoSortNodes([
    {
      ...normalizedNode,
      node_id: 'fan-root',
      depends_on: [],
    },
    {
      ...normalizedNode,
      node_id: 'fan-child-b',
      depends_on: ['fan-root'],
    },
    {
      ...normalizedNode,
      node_id: 'fan-child-a',
      depends_on: ['fan-root'],
    },
  ]);
  assert.deepEqual(
    fanOut.ordered.map((entry) => entry.node_id),
    ['fan-root', 'fan-child-b', 'fan-child-a'],
  );

  const cyclic = __testInternals.topoSortNodes([
    {
      ...normalizedNode,
      node_id: 'cycle-a',
      depends_on: ['cycle-b'],
    },
    {
      ...normalizedNode,
      node_id: 'cycle-b',
      depends_on: ['cycle-a'],
    },
  ]);
  assert.equal(cyclic.ordered.length, 2);
  assert.match(cyclic.warnings[0] ?? '', /Dependency cycle detected/u);
});

test('lifecyclemodel orchestrate selectResolution and projector policy cover explicit and automatic branches', () => {
  const makeNode = (overrides: JsonRecord = {}) =>
    ({
      node_id: 'node-1',
      kind: 'process',
      label: 'Node 1',
      entity: {},
      requested_action: 'auto',
      depends_on: [],
      parent_node_id: null,
      existing_resulting_process_candidates: [],
      existing_process_candidates: [],
      existing_lifecyclemodel_candidates: [],
      planned_invocations: [],
      ...overrides,
    }) as JsonRecord;

  const allowAll = {
    allow_process_build: true,
    allow_submodel_build: true,
    reuse_resulting_process_first: true,
  };

  assert.equal(
    __testInternals.selectResolution(makeNode({ requested_action: 'cutoff' }) as never, allowAll)
      .boundary_reason,
    'explicit_cutoff',
  );
  assert.equal(
    __testInternals.selectResolution(
      makeNode({ requested_action: 'unresolved' }) as never,
      allowAll,
    ).resolution,
    'unresolved',
  );
  assert.equal(
    __testInternals.selectResolution(
      makeNode({ requested_action: 'reuse_existing_resulting_process' }) as never,
      allowAll,
    ).resolution,
    'unresolved',
  );
  assert.equal(
    __testInternals.selectResolution(
      makeNode({
        requested_action: 'reuse_existing_resulting_process',
        existing_resulting_process_candidates: [{ id: 'rp-1', score: 1 }],
      }) as never,
      allowAll,
    ).resolution,
    'reused_existing_resulting_process',
  );
  assert.equal(
    __testInternals.selectResolution(
      makeNode({ requested_action: 'reuse_existing_process' }) as never,
      allowAll,
    ).resolution,
    'unresolved',
  );
  assert.equal(
    __testInternals.selectResolution(
      makeNode({
        requested_action: 'reuse_existing_process',
        existing_process_candidates: [{ id: 'proc-1', score: 1 }],
      }) as never,
      allowAll,
    ).resolution,
    'reused_existing_process',
  );
  assert.equal(
    __testInternals.selectResolution(
      makeNode({ requested_action: 'reuse_existing_model' }) as never,
      allowAll,
    ).resolution,
    'unresolved',
  );
  assert.equal(
    __testInternals.selectResolution(
      makeNode({
        requested_action: 'reuse_existing_model',
        kind: 'lifecyclemodel',
        existing_lifecyclemodel_candidates: [{ id: 'lm-1', score: 1 }],
      }) as never,
      allowAll,
    ).resolution,
    'reused_existing_model',
  );
  assert.equal(
    __testInternals.selectResolution(
      makeNode({ requested_action: 'build_process' }) as never,
      allowAll,
    ).resolution,
    'unresolved',
  );
  assert.equal(
    __testInternals.selectResolution(
      makeNode({
        requested_action: 'build_process',
        process_builder: { mode: 'workflow' },
      }) as never,
      {
        ...allowAll,
        allow_process_build: false,
      },
    ).resolution,
    'unresolved',
  );
  assert.equal(
    __testInternals.selectResolution(
      makeNode({
        requested_action: 'build_process',
        process_builder: { mode: 'workflow' },
      }) as never,
      allowAll,
    ).resolution,
    'build_via_process_automated_builder',
  );
  assert.equal(
    __testInternals.selectResolution(
      makeNode({
        requested_action: 'build_submodel',
        kind: 'lifecyclemodel',
      }) as never,
      allowAll,
    ).resolution,
    'unresolved',
  );
  assert.equal(
    __testInternals.selectResolution(
      makeNode({
        requested_action: 'build_submodel',
        kind: 'lifecyclemodel',
        submodel_builder: { manifest: '/tmp/manifest.json' },
      }) as never,
      {
        ...allowAll,
        allow_submodel_build: false,
      },
    ).resolution,
    'unresolved',
  );
  assert.equal(
    __testInternals.selectResolution(
      makeNode({
        requested_action: 'build_submodel',
        kind: 'lifecyclemodel',
        submodel_builder: { manifest: '/tmp/manifest.json' },
      }) as never,
      allowAll,
    ).resolution,
    'build_via_lifecyclemodel_automated_builder',
  );

  assert.equal(
    __testInternals.selectResolution(
      makeNode({
        existing_resulting_process_candidates: [{ id: 'rp-auto', score: 1 }],
      }) as never,
      allowAll,
    ).resolution,
    'reused_existing_resulting_process',
  );
  assert.equal(
    __testInternals.selectResolution(
      makeNode({
        existing_resulting_process_candidates: [{ id: 'rp-auto', score: 1 }],
        existing_process_candidates: [{ id: 'proc-auto', score: 2 }],
      }) as never,
      {
        ...allowAll,
        reuse_resulting_process_first: false,
      },
    ).resolution,
    'reused_existing_process',
  );
  assert.equal(
    __testInternals.selectResolution(
      makeNode({
        kind: 'subsystem',
        existing_lifecyclemodel_candidates: [{ id: 'lm-auto', score: 1 }],
      }) as never,
      allowAll,
    ).resolution,
    'reused_existing_model',
  );
  assert.equal(
    __testInternals.selectResolution(
      makeNode({
        kind: 'subsystem',
        submodel_builder: { manifest: '/tmp/manifest.json' },
      }) as never,
      allowAll,
    ).resolution,
    'build_via_lifecyclemodel_automated_builder',
  );
  assert.equal(
    __testInternals.selectResolution(
      makeNode({
        process_builder: { mode: 'workflow' },
      }) as never,
      allowAll,
    ).resolution,
    'build_via_process_automated_builder',
  );
  assert.equal(
    __testInternals.selectResolution(
      makeNode({
        existing_lifecyclemodel_candidates: [{ id: 'lm-fallback', score: 1 }],
      }) as never,
      allowAll,
    ).resolution,
    'reused_existing_model',
  );
  assert.equal(
    __testInternals.selectResolution(makeNode() as never, allowAll).resolution,
    'unresolved',
  );

  assert.equal(
    __testInternals.shouldRunProjector(makeNode() as never, 'build_via_process_automated_builder'),
    false,
  );
  assert.equal(
    __testInternals.shouldRunProjector(
      makeNode({ projector: { run_always: true } }) as never,
      'reused_existing_process',
    ),
    true,
  );
  assert.equal(
    __testInternals.shouldRunProjector(
      makeNode({ projector: { run_always: false } }) as never,
      'reused_existing_model',
    ),
    true,
  );
});

test('lifecyclemodel orchestrate validates request shapes and buildPlan handles generated ids and duplicate nodes', () => {
  const validOrchestration = {
    mode: 'collapsed',
    max_depth: 1,
    reuse_resulting_process_first: true,
    allow_process_build: true,
    allow_submodel_build: true,
    pin_child_versions: true,
    stop_at_elementary_flow: false,
  };

  const makeValidRequest = (root: JsonRecord): JsonRecord => ({
    goal: {
      name: 'Validation goal',
    },
    root,
    orchestration: validOrchestration,
    publish: {
      intent: 'prepare_only',
    },
  });

  assert.doesNotThrow(() =>
    __testInternals.validateRequestShape(
      makeValidRequest({
        kind: 'reference_flow',
        flow: { id: 'flow-1' },
      }),
    ),
  );
  assert.doesNotThrow(() =>
    __testInternals.validateRequestShape(
      makeValidRequest({
        kind: 'process',
        process: { id: 'proc-1' },
      }),
    ),
  );
  assert.doesNotThrow(() =>
    __testInternals.validateRequestShape(
      makeValidRequest({
        kind: 'resulting_process',
        resulting_process: { id: 'rp-1' },
      }),
    ),
  );

  assert.throws(
    () =>
      __testInternals.validateRequestShape({
        ...makeValidRequest({
          kind: 'process',
          process: { id: 'proc-1' },
        }),
        goal: {},
      }),
    /goal.name is required/u,
  );
  assert.throws(
    () =>
      __testInternals.validateRequestShape(
        makeValidRequest({
          kind: 'process',
          process: {},
        }),
      ),
    /root.process.id is required/u,
  );
  assert.throws(
    () =>
      __testInternals.validateRequestShape({
        ...makeValidRequest({
          kind: 'process',
          process: { id: 'proc-1' },
        }),
        orchestration: {
          ...validOrchestration,
          max_depth: -1,
        },
      }),
    /orchestration.max_depth must be a non-negative integer/u,
  );
  assert.throws(
    () =>
      __testInternals.validateRequestShape({
        ...makeValidRequest({
          kind: 'process',
          process: { id: 'proc-1' },
        }),
        publish: {
          intent: 'invalid',
        },
      }),
    /publish.intent must be one of/u,
  );
  assert.throws(
    () =>
      __testInternals.validateRequestShape({
        ...makeValidRequest({
          kind: 'process',
          process: { id: 'proc-1' },
        }),
        nodes: {},
      }),
    /nodes must be an array/u,
  );
  assert.throws(
    () =>
      __testInternals.validateRequestShape({
        ...makeValidRequest({
          kind: 'process',
          process: { id: 'proc-1' },
        }),
        edges: {},
      }),
    /edges must be an array/u,
  );

  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-lm-orchestrate-build-plan-'));
  try {
    const requestPath = path.join(dir, 'request.json');
    const outDir = path.join(dir, 'out');

    const generatedPlan = __testInternals.buildPlan(
      {
        ...makeValidRequest({
          node_id: 'root',
          kind: 'process',
          process: { id: 'proc-root', name: 'Root process' },
        }),
        candidate_sources: [],
        notes: ['keep me', '', '  '],
        nodes: [
          {
            node_id: 'root',
            kind: 'process',
            process: { id: 'proc-root', name: 'Root process' },
            requested_action: 'cutoff',
          },
          {
            node_id: 'root',
            kind: 'process',
            process: { id: 'proc-root-duplicate', name: 'Root duplicate' },
            requested_action: 'unresolved',
          },
        ],
      },
      requestPath,
      outDir,
      new Date('2026-03-31T00:00:00Z'),
    );
    assert.match(generatedPlan.request_id, /^run-\d{8}T\d{6}000Z$/u);
    assert.deepEqual(generatedPlan.notes, ['keep me']);
    assert.equal(generatedPlan.nodes.length, 1);
    assert.deepEqual(generatedPlan.candidate_sources, __testInternals.defaultCandidateSources());
    const mergedCandidatePlan = __testInternals.buildPlan(
      {
        ...makeValidRequest({
          node_id: 'root',
          kind: 'process',
          process: { id: 'proc-root', name: 'Root process' },
        }),
        candidate_sources: {
          my_processes: false,
          external_catalogs: ['db-1'],
        },
      },
      requestPath,
      outDir,
      new Date('2026-03-31T00:00:00Z'),
    );
    assert.deepEqual(mergedCandidatePlan.candidate_sources, {
      ...__testInternals.defaultCandidateSources(),
      my_processes: false,
      external_catalogs: ['db-1'],
    });

    const unresolvedPlan = __testInternals.buildPlan(
      {
        request_id: 'boundary-demo',
        ...makeValidRequest({
          kind: 'process',
          process: { id: 'proc-root' },
        }),
        nodes: [
          {
            node_id: 'cut-node',
            kind: 'process',
            process: { id: 'cut-proc' },
            requested_action: 'cutoff',
          },
          {
            node_id: 'unknown-node',
            kind: 'process',
            process: { id: 'unknown-proc' },
            requested_action: 'unresolved',
          },
        ],
      },
      requestPath,
      outDir,
      new Date('2026-03-31T00:00:00Z'),
    );
    assert.deepEqual(
      unresolvedPlan.boundaries.map((entry) => entry.reason),
      ['unresolved', 'explicit_cutoff', 'unresolved'],
    );
    assert.deepEqual(unresolvedPlan.unresolved, [
      {
        node_id: 'proc-root',
        label: 'Validation goal',
        reason: 'No reusable candidate or build config satisfied the node policy',
      },
      {
        node_id: 'unknown-node',
        label: 'unknown-node',
        reason: 'Explicit unresolved marker provided.',
      },
    ]);

    assert.throws(
      () =>
        __testInternals.buildPlan(
          {
            request_id: 'duplicate-demo',
            ...makeValidRequest({
              kind: 'process',
              process: { id: 'proc-root' },
            }),
            nodes: [
              {
                node_id: 'dup-node',
                kind: 'process',
                process: { id: 'proc-a' },
              },
              {
                node_id: 'dup-node',
                kind: 'process',
                process: { id: 'proc-b' },
              },
            ],
          },
          requestPath,
          outDir,
          new Date('2026-03-31T00:00:00Z'),
        ),
      /Duplicate node_id: dup-node/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('lifecyclemodel orchestrate helper artifacts cover file checks, inline JSON, statuses, manifests, and publish bundle flags', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-lm-orchestrate-artifacts-'));
  try {
    const existingFile = path.join(dir, 'existing.json');
    writeJson(existingFile, { ok: true });
    __testInternals.requireFile(existingFile, 'existing fixture');
    assert.throws(
      () => __testInternals.requireFile(path.join(dir, 'missing.json'), 'missing fixture'),
      /Missing missing fixture/u,
    );

    assert.deepEqual(__testInternals.parseInlineJson({ ok: true }, 'inline payload'), { ok: true });
    assert.deepEqual(__testInternals.parseInlineJson('{"ok":true}', 'inline payload'), {
      ok: true,
    });
    assert.throws(
      () => __testInternals.parseInlineJson('[1,2,3]', 'inline payload'),
      /Invalid inline payload JSON string/u,
    );
    assert.throws(
      () => __testInternals.parseInlineJson(undefined, 'inline payload'),
      /inline payload must be a JSON object or JSON string/u,
    );

    const projectionBundlePath = path.join(dir, 'projection-bundle.json');
    const projectionBundleScalarPath = path.join(dir, 'projection-bundle-scalar.json');
    const modelFile = path.join(dir, 'model.json');
    writeJson(modelFile, { lifeCycleModelDataSet: { '@id': 'lm-1' } });
    writeJson(projectionBundlePath, {
      projected_processes: [{ id: 'projected-1' }, 1],
      relations: [{ id: 'relation-1' }, 2],
    });
    writeJson(projectionBundleScalarPath, 1);

    const invocationsDir = path.join(dir, 'invocations');
    mkdirSync(invocationsDir, { recursive: true });
    writeJson(path.join(invocationsDir, '000-ignore.json'), 1);
    writeJson(path.join(invocationsDir, '001-valid.json'), {
      invocation_id: 'loaded-1',
      node_id: 'completed-node',
      kind: 'projector',
      status: 'success',
      exit_code: 0,
      result_file: path.join(invocationsDir, '001-valid.json'),
    });

    assert.deepEqual(__testInternals.loadInvocationResults(path.join(dir, 'missing-dir')), []);
    assert.deepEqual(__testInternals.loadInvocationResults(invocationsDir), [
      {
        invocation_id: 'loaded-1',
        node_id: 'completed-node',
        kind: 'projector',
        status: 'success',
        exit_code: 0,
        result_file: path.join(invocationsDir, '001-valid.json'),
      },
    ]);

    const plan = {
      skill: 'lifecyclemodel-recursive-orchestrator',
      request_id: 'artifact-demo',
      created_at: '2026-03-31T00:00:00.000Z',
      request_file: path.join(dir, 'request.json'),
      goal: { name: 'Artifact goal' },
      root: { kind: 'process', process: { id: 'proc-root' } },
      orchestration: { mode: 'collapsed', max_depth: 1 },
      candidate_sources: { my_processes: true },
      publish: {
        intent: 'prepare_only',
        prepare_lifecyclemodel_payload: false,
        prepare_resulting_process_payload: false,
        prepare_relation_payload: true,
      },
      notes: ['note-1'],
      nodes: [
        {
          node_id: 'unresolved-node',
          label: 'Unresolved node',
          kind: 'process',
          depends_on: [],
          resolution: 'unresolved',
        },
        {
          node_id: 'cutoff-node',
          label: 'Cutoff node',
          kind: 'process',
          depends_on: [],
          resolution: 'cutoff',
        },
        {
          node_id: 'reused-node',
          label: 'Reused node',
          kind: 'process',
          depends_on: [],
          resolution: 'reused_existing_process',
          selected_candidate: { id: 'candidate-1', version: '00.00.001' },
        },
        {
          node_id: 'reused-null-node',
          label: 'Reused null node',
          kind: 'process',
          depends_on: [],
          resolution: 'reused_existing_model',
          selected_candidate: {},
        },
        {
          node_id: 'planned-node',
          label: 'Planned node',
          kind: 'process',
          depends_on: [],
          resolution: 'build_via_process_automated_builder',
        },
        {
          node_id: 'failed-node',
          label: 'Failed node',
          kind: 'process',
          depends_on: [],
          resolution: 'build_via_process_automated_builder',
        },
        {
          node_id: 'blocked-node',
          label: 'Blocked node',
          kind: 'process',
          depends_on: [],
          resolution: 'build_via_process_automated_builder',
        },
        {
          node_id: 'completed-node',
          label: 'Completed node',
          kind: 'lifecyclemodel',
          depends_on: [],
          resolution: 'build_via_lifecyclemodel_automated_builder',
        },
        {
          node_id: 'incomplete-node',
          label: 'Incomplete node',
          kind: 'process',
          depends_on: [],
          resolution: 'build_via_process_automated_builder',
        },
      ],
      edges: [{ from: 'completed-node', to: 'reused-node', relation: 'depends_on' }],
      invocations: [
        {
          invocation_id: 'failed-node:process-builder',
          node_id: 'failed-node',
          kind: 'process_builder',
          artifact_dir: path.join(dir, 'failed-node'),
        },
        {
          invocation_id: 'completed-node:lifecyclemodel-builder',
          node_id: 'completed-node',
          kind: 'lifecyclemodel_builder',
          artifact_dir: path.join(dir, 'completed-node'),
        },
        {
          invocation_id: 'completed-node:projector',
          node_id: 'completed-node',
          kind: 'projector',
          artifact_dir: path.join(dir, 'completed-node-projector'),
        },
      ],
      planner_summary: {
        status: 'planned',
        message: 'demo',
      },
      warnings: ['warn-1'],
      unresolved: [
        { node_id: 'unresolved-node', label: 'Unresolved node', reason: 'missing data' },
      ],
      boundaries: [{ node_id: 'cutoff-node', reason: 'explicit_cutoff' }],
      artifacts: {
        root: dir,
        request_normalized: path.join(dir, 'request.normalized.json'),
        assembly_plan: path.join(dir, 'assembly-plan.json'),
        graph_manifest: path.join(dir, 'graph-manifest.json'),
        lineage_manifest: path.join(dir, 'lineage-manifest.json'),
        boundary_report: path.join(dir, 'boundary-report.json'),
        invocations_dir: invocationsDir,
        publish_bundle: path.join(dir, 'publish-bundle.json'),
        publish_summary: path.join(dir, 'publish-summary.json'),
      },
      summary: {
        node_count: 9,
        edge_count: 1,
        invocation_count: 3,
        unresolved_count: 1,
      },
    } as JsonRecord;

    const executionResults = [
      {
        invocation_id: 'failed-node:process-builder',
        node_id: 'failed-node',
        kind: 'process_builder',
        status: 'failed',
        exit_code: 1,
        result_file: path.join(dir, 'failed-node.json'),
      },
      {
        invocation_id: 'blocked-node:process-builder',
        node_id: 'blocked-node',
        kind: 'process_builder',
        status: 'skipped_due_to_dependency_failed',
        exit_code: null,
        result_file: path.join(dir, 'blocked-node.json'),
      },
      {
        invocation_id: 'completed-node:lifecyclemodel-builder',
        node_id: 'completed-node',
        kind: 'lifecyclemodel_builder',
        status: 'success',
        exit_code: 0,
        result_file: path.join(dir, 'completed-builder.json'),
        artifacts: {
          produced_model_files: [modelFile, '', path.join(dir, 'missing-model.json')],
          process_catalog_files: [path.join(dir, 'catalog.json')],
          source_run_dirs: [path.join(dir, 'run-dir')],
        },
      },
      {
        invocation_id: 'completed-node:projector',
        node_id: 'completed-node',
        kind: 'projector',
        status: 'success',
        exit_code: 0,
        result_file: path.join(dir, 'completed-projector.json'),
        artifacts: {
          projection_bundle: projectionBundlePath,
        },
      },
      {
        invocation_id: 'completed-node:projector-scalar',
        node_id: 'completed-node',
        kind: 'projector',
        status: 'success',
        exit_code: 0,
        result_file: path.join(dir, 'completed-projector-scalar.json'),
        artifacts: {
          projection_bundle: projectionBundleScalarPath,
        },
      },
      {
        invocation_id: 'incomplete-node:process-builder-a',
        node_id: 'incomplete-node',
        kind: 'process_builder',
        status: 'success',
        exit_code: 0,
        result_file: path.join(dir, 'incomplete-a.json'),
      },
      {
        invocation_id: 'incomplete-node:process-builder-b',
        node_id: 'incomplete-node',
        kind: 'process_builder',
        status: 'partial',
        exit_code: null,
        result_file: path.join(dir, 'incomplete-b.json'),
      },
    ] as JsonRecord[];

    assert.deepEqual(
      __testInternals.executionStatusByNode(plan as never, executionResults as never),
      {
        'unresolved-node': 'unresolved',
        'cutoff-node': 'cutoff',
        'reused-node': 'reused',
        'reused-null-node': 'reused',
        'planned-node': 'planned',
        'failed-node': 'failed',
        'blocked-node': 'blocked',
        'completed-node': 'completed',
        'incomplete-node': 'incomplete',
      },
    );

    const graphManifest = __testInternals.buildGraphManifest(
      plan as never,
      executionResults as never,
    );
    assert.equal(graphManifest.stats.completed_invocation_count, 4);

    const lineageManifest = __testInternals.buildLineageManifest(
      plan as never,
      executionResults as never,
    );
    assert.deepEqual(lineageManifest.published_dependencies, [
      {
        node_id: 'reused-node',
        dependency_type: 'reused_existing_process',
        candidate_id: 'candidate-1',
        candidate_version: '00.00.001',
      },
      {
        node_id: 'reused-null-node',
        dependency_type: 'reused_existing_model',
        candidate_id: null,
        candidate_version: null,
      },
    ]);
    assert.deepEqual(lineageManifest.resulting_process_relations, [
      {
        id: 'relation-1',
        node_id: 'completed-node',
      },
    ]);

    const boundaryReport = __testInternals.buildBoundaryReport(
      plan as never,
      executionResults as never,
    );
    assert.deepEqual(boundaryReport.execution_summary, {
      successful_invocations: 4,
      failed_invocations: 1,
      blocked_invocations: 1,
    });

    assert.equal(
      __testInternals.inferProjectorModelFile(
        {
          config: {
            model_file: modelFile,
          },
        } as never,
        new Map(),
      ),
      modelFile,
    );
    assert.equal(
      __testInternals.inferProjectorModelFile(
        {
          config: {},
          depends_on_invocation_id: 'completed-node:lifecyclemodel-builder',
        } as never,
        new Map([
          [
            'completed-node:lifecyclemodel-builder',
            {
              artifacts: {
                produced_model_files: [modelFile],
              },
            },
          ],
        ]) as never,
      ),
      modelFile,
    );
    assert.equal(
      __testInternals.inferProjectorModelFile(
        {
          config: {},
          depends_on_invocation_id: 'completed-node:projector',
        } as never,
        new Map([
          [
            'completed-node:projector',
            {
              invocation_id: 'completed-node:projector',
              node_id: 'completed-node',
              kind: 'projector',
              status: 'success',
              exit_code: 0,
              result_file: path.join(dir, 'completed-projector.json'),
              artifacts: {
                produced_model_files: [],
              },
            },
          ],
        ]),
      ),
      null,
    );
    assert.equal(
      __testInternals.inferProjectorModelFile(
        {
          config: {},
        } as never,
        new Map(),
      ),
      null,
    );
    assert.deepEqual(
      __testInternals.collectProjectorDependencyArtifacts(
        {
          depends_on_invocation_id: 'completed-node:lifecyclemodel-builder',
        } as never,
        new Map([
          [
            'completed-node:lifecyclemodel-builder',
            {
              artifacts: {
                process_catalog_files: ['', path.join(dir, 'catalog.json')],
                source_run_dirs: ['', path.join(dir, 'run-a'), null, path.join(dir, 'run-b')],
              },
            },
          ],
        ]) as never,
      ),
      {
        processCatalogPath: path.join(dir, 'catalog.json'),
        sourceRunDirs: [path.join(dir, 'run-a'), path.join(dir, 'run-b')],
      },
    );
    assert.deepEqual(
      __testInternals.collectProjectorDependencyArtifacts(
        {
          depends_on_invocation_id: 'missing-dependency',
        } as never,
        new Map(),
      ),
      {
        processCatalogPath: null,
        sourceRunDirs: [],
      },
    );
    assert.deepEqual(
      __testInternals.collectProjectorDependencyArtifacts(
        {
          config: {},
        } as never,
        new Map(),
      ),
      {
        processCatalogPath: null,
        sourceRunDirs: [],
      },
    );

    assert.deepEqual(__testInternals.normalizeRequestForArtifacts(plan as never), {
      request_id: 'artifact-demo',
      goal: { name: 'Artifact goal' },
      root: { kind: 'process', process: { id: 'proc-root' } },
      orchestration: { mode: 'collapsed', max_depth: 1 },
      candidate_sources: { my_processes: true },
      publish: {
        intent: 'prepare_only',
        prepare_lifecyclemodel_payload: false,
        prepare_resulting_process_payload: false,
        prepare_relation_payload: true,
      },
      nodes: plan.nodes,
      edges: plan.edges,
      notes: ['note-1'],
    });

    const projectorRequest = __testInternals.buildProjectorRequest(
      {
        config: {
          projection_role: 'all',
        },
      } as never,
      modelFile,
      plan as never,
      null,
      [],
    );
    assert.deepEqual(projectorRequest.publish, {
      intent: 'prepare_only',
      prepare_process_payloads: false,
      prepare_relation_payloads: true,
    });
    const projectorRequestWithExplicitIntent = __testInternals.buildProjectorRequest(
      {
        config: {
          projection_role: 'primary',
        },
      } as never,
      modelFile,
      {
        ...plan,
        publish: {
          intent: 'publish',
          prepare_resulting_process_payload: true,
          prepare_relation_payload: false,
        },
      } as never,
      path.join(dir, 'catalog.json'),
      [path.join(dir, 'run-dir')],
    );
    assert.deepEqual(projectorRequestWithExplicitIntent.publish, {
      intent: 'publish',
      prepare_process_payloads: true,
      prepare_relation_payloads: false,
    });

    const bundleWithoutPublishables = __testInternals.collectPublishBundle(
      dir,
      plan as never,
      graphManifest,
      lineageManifest,
      executionResults as never,
      false,
      false,
    ) as {
      lifecyclemodels: unknown[];
      projected_processes: unknown[];
      resulting_process_relations: unknown[];
    };
    assert.equal(bundleWithoutPublishables.lifecyclemodels.length, 0);
    assert.equal(bundleWithoutPublishables.projected_processes.length, 0);
    assert.equal(bundleWithoutPublishables.resulting_process_relations.length, 0);

    const bundleWithPublishables = __testInternals.collectPublishBundle(
      dir,
      plan as never,
      graphManifest,
      lineageManifest,
      executionResults as never,
      true,
      true,
    ) as {
      lifecyclemodels: unknown[];
      projected_processes: unknown[];
      resulting_process_relations: unknown[];
    };
    assert.equal(bundleWithPublishables.lifecyclemodels.length, 1);
    assert.equal(bundleWithPublishables.projected_processes.length, 1);
    assert.equal(bundleWithPublishables.resulting_process_relations.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('lifecyclemodel orchestrate execution internals cover inline flow payloads and removed python_bin configs', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-lm-orchestrate-exec-internals-'));
  try {
    const invocationDir = path.join(dir, 'invocations');
    const plan = {
      request_id: 'inline-demo',
      artifacts: {
        invocations_dir: invocationDir,
      },
    } as JsonRecord;
    const flowJson = JSON.stringify(readJson<JsonRecord>(flowFixturePath()));

    const inlineResult = await __testInternals.executeProcessBuilderInvocation(
      {
        invocation_id: 'inline-node:process-builder',
        node_id: 'inline-node',
        kind: 'process_builder',
        config: {
          flow_json: flowJson,
        },
        artifact_dir: path.join(dir, 'inline-run'),
      } as never,
      plan as never,
      path.join(dir, 'inline-result.json'),
      new Date('2026-03-31T00:00:00Z'),
    );
    assert.equal(inlineResult.status, 'success');
    assert.match(readFileSync(path.join(dir, 'inline-result.json'), 'utf8'), /inline-node/u);

    await assert.rejects(
      () =>
        __testInternals.executeProcessBuilderInvocation(
          {
            invocation_id: 'legacy-node:process-builder',
            node_id: 'legacy-node',
            kind: 'process_builder',
            config: {
              python_bin: 'python3',
              flow_file: flowFixturePath(),
            },
            artifact_dir: path.join(dir, 'legacy-run'),
          } as never,
          plan as never,
          path.join(dir, 'legacy-result.json'),
          new Date('2026-03-31T00:00:00Z'),
        ),
      /python_bin/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('lifecyclemodel orchestrate execute handles missing submodel manifests, blocked dependencies, and missing projector inputs', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-lm-orchestrate-missing-runtime-'));
  const missingManifestRequest = path.join(dir, 'missing-manifest.request.json');
  const missingManifestOutDir = path.join(dir, 'missing-manifest-run');

  writeJson(missingManifestRequest, {
    request_id: 'missing-manifest',
    goal: {
      name: 'Missing manifest demo',
    },
    root: {
      node_id: 'model-root',
      kind: 'lifecyclemodel',
      lifecyclemodel: {
        id: 'lm-missing',
      },
      requested_action: 'build_submodel',
      submodel_builder: {},
      projector: {
        projection_role: 'primary',
      },
    },
    orchestration: {
      mode: 'collapsed',
      max_depth: 1,
      reuse_resulting_process_first: true,
      allow_process_build: false,
      allow_submodel_build: true,
      pin_child_versions: true,
      stop_at_elementary_flow: false,
      fail_fast: false,
    },
    publish: {
      intent: 'prepare_only',
    },
  });

  try {
    const blockedReport = await runLifecyclemodelOrchestrate({
      action: 'execute',
      inputPath: missingManifestRequest,
      outDir: missingManifestOutDir,
      now: new Date('2026-03-31T00:00:00Z'),
    });
    assert.equal(blockedReport.status, 'failed');
    assert.equal(blockedReport.execution.failed_invocations, 1);
    assert.equal(blockedReport.execution.blocked_invocations, 1);

    const failedInvocation = readJson<JsonRecord>(
      path.join(missingManifestOutDir, 'invocations', 'model-root-lifecyclemodel-builder.json'),
    );
    assert.match(String(failedInvocation.error ?? ''), /missing submodel_builder\.manifest/u);

    const blockedInvocation = readJson<JsonRecord>(
      path.join(missingManifestOutDir, 'invocations', 'model-root-projector.json'),
    );
    assert.equal(blockedInvocation.status, 'skipped_due_to_dependency_failed');

    const missingProjectorRequest = path.join(dir, 'missing-projector.request.json');
    const missingProjectorOutDir = path.join(dir, 'missing-projector-run');
    writeJson(missingProjectorRequest, {
      request_id: 'missing-projector',
      goal: {
        name: 'Missing projector input demo',
      },
      root: {
        node_id: 'model-projector',
        kind: 'lifecyclemodel',
        lifecyclemodel: {
          id: 'lm-projector',
        },
        existing_lifecyclemodel_candidates: [
          {
            id: 'lm-existing',
            score: 1,
          },
        ],
        projector: {
          projection_role: 'primary',
        },
      },
      orchestration: {
        mode: 'collapsed',
        max_depth: 1,
        reuse_resulting_process_first: true,
        allow_process_build: false,
        allow_submodel_build: false,
        pin_child_versions: true,
        stop_at_elementary_flow: false,
        fail_fast: false,
      },
      publish: {
        intent: 'prepare_only',
      },
    });

    const projectorReport = await runLifecyclemodelOrchestrate({
      action: 'execute',
      inputPath: missingProjectorRequest,
      outDir: missingProjectorOutDir,
      now: new Date('2026-03-31T00:00:00Z'),
    });
    assert.equal(projectorReport.status, 'failed');
    assert.equal(projectorReport.execution.failed_invocations, 1);

    const projectorInvocation = readJson<JsonRecord>(
      path.join(missingProjectorOutDir, 'invocations', 'model-projector-projector.json'),
    );
    assert.match(
      String(projectorInvocation.error ?? ''),
      /requires projector\.request or a prior lifecyclemodel build result/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('lifecyclemodel orchestrate publish includes projector outputs when prepare_relation_payload remains enabled', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-lm-orchestrate-publish-flags-'));
  const runDir = path.join(dir, 'run');
  const invocationsDir = path.join(runDir, 'invocations');
  mkdirSync(invocationsDir, { recursive: true });

  const projectionBundlePath = path.join(runDir, 'projection-bundle.json');
  writeJson(projectionBundlePath, {
    projected_processes: [{ id: 'projected-1' }],
    relations: [{ id: 'relation-1' }],
  });

  writeJson(path.join(runDir, 'assembly-plan.json'), {
    skill: 'lifecyclemodel-recursive-orchestrator',
    request_id: 'publish-flags',
    created_at: '2026-03-31T00:00:00.000Z',
    request_file: path.join(runDir, 'request.json'),
    goal: { name: 'Publish flags goal' },
    root: { kind: 'lifecyclemodel', lifecyclemodel: { id: 'lm-publish' } },
    orchestration: { mode: 'collapsed', max_depth: 1 },
    candidate_sources: {},
    publish: {
      intent: 'prepare_only',
      prepare_lifecyclemodel_payload: false,
      prepare_resulting_process_payload: false,
      prepare_relation_payload: true,
    },
    notes: [],
    nodes: [],
    edges: [],
    invocations: [],
    planner_summary: {
      status: 'executed',
      message: 'publish demo',
    },
    warnings: [],
    unresolved: [],
    boundaries: [],
    artifacts: {
      root: runDir,
      request_normalized: path.join(runDir, 'request.normalized.json'),
      assembly_plan: path.join(runDir, 'assembly-plan.json'),
      graph_manifest: path.join(runDir, 'graph-manifest.json'),
      lineage_manifest: path.join(runDir, 'lineage-manifest.json'),
      boundary_report: path.join(runDir, 'boundary-report.json'),
      invocations_dir: invocationsDir,
      publish_bundle: path.join(runDir, 'publish-bundle.json'),
      publish_summary: path.join(runDir, 'publish-summary.json'),
    },
    summary: {
      node_count: 0,
      edge_count: 0,
      invocation_count: 0,
      unresolved_count: 0,
    },
  });
  writeJson(path.join(runDir, 'graph-manifest.json'), {
    root: {},
    nodes: [],
    edges: [],
    boundaries: [],
    unresolved: [],
    stats: {},
  });
  writeJson(path.join(runDir, 'lineage-manifest.json'), {
    root_request: {},
    builder_invocations: [],
    node_resolution_log: [],
    published_dependencies: [],
    resulting_process_relations: [],
    unresolved_history: [],
  });
  writeJson(path.join(invocationsDir, '000-ignore.json'), 1);
  writeJson(path.join(invocationsDir, '001-projector.json'), {
    invocation_id: 'model-projector',
    node_id: 'model-node',
    kind: 'projector',
    status: 'success',
    exit_code: 0,
    result_file: path.join(invocationsDir, '001-projector.json'),
    artifacts: {
      projection_bundle: projectionBundlePath,
    },
  });

  try {
    const publishReport = await runLifecyclemodelOrchestrate({
      action: 'publish',
      runDir,
      now: new Date('2026-03-31T01:00:00Z'),
    });
    assert.equal(publishReport.action, 'publish');
    assert.equal(publishReport.counts.lifecyclemodels, 0);
    assert.equal(publishReport.counts.projected_processes, 1);
    assert.equal(publishReport.counts.resulting_process_relations, 1);

    const publishBundle = readJson<JsonRecord>(path.join(runDir, 'publish-bundle.json'));
    assert.equal(publishBundle.include_resulting_process_relations, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
