import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { executeCli } from '../src/cli.js';
import {
  runDatasetCurationQueueBuild,
  __testInternals,
  type DatasetCurationQueueBuildReport,
} from '../src/lib/dataset-curation-queue.js';
import type { DotEnvLoadResult } from '../src/lib/dotenv.js';
import type { FetchLike } from '../src/lib/http.js';

const dotEnvStatus: DotEnvLoadResult = {
  loaded: false,
  path: '/tmp/.env',
  count: 0,
};

const deps = {
  env: {},
  dotEnvStatus,
  fetchImpl: (async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({ ok: true }),
  })) as FetchLike,
};

function writeJsonl(filePath: string, rows: unknown[]): void {
  writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function makeFlow(id = 'flow-1') {
  return {
    id,
    version: '01.00.000',
    json_ordered: {
      flowDataSet: {
        flowInformation: {
          dataSetInformation: {
            'common:UUID': id,
          },
        },
        administrativeInformation: {
          publicationAndOwnership: {
            'common:dataSetVersion': '01.00.000',
          },
        },
      },
    },
  };
}

function makeProcess(flowId = 'flow-1') {
  return {
    id: 'process-1',
    version: '01.00.000',
    json_ordered: {
      processDataSet: {
        processInformation: {
          dataSetInformation: {
            'common:UUID': 'process-1',
          },
        },
        exchanges: {
          exchange: [
            {
              referenceToFlowDataSet: {
                '@refObjectId': flowId,
                '@version': '01.00.000',
              },
            },
          ],
        },
        administrativeInformation: {
          publicationAndOwnership: {
            'common:dataSetVersion': '01.00.000',
          },
        },
      },
    },
  };
}

function makeSource() {
  return {
    sourceDataSet: {
      sourceInformation: {
        dataSetInformation: {
          'common:UUID': 'source-1',
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          'common:dataSetVersion': '01.00.000',
        },
      },
    },
  };
}

test('runDatasetCurationQueueBuild writes entity-level queue artifacts', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-curation-queue-'));
  const processes = path.join(dir, 'processes.jsonl');
  const flows = path.join(dir, 'flows.jsonl');
  const support = path.join(dir, 'sources.jsonl');
  const outDir = path.join(dir, 'queue');
  writeJsonl(processes, [makeProcess()]);
  writeJsonl(flows, [makeFlow()]);
  writeJsonl(support, [makeSource()]);

  try {
    const report = await runDatasetCurationQueueBuild({
      processesPath: processes,
      flowsPath: flows,
      supportPaths: [support],
      outDir,
    });

    assert.equal(report.status, 'ready');
    assert.equal(report.counts.tasks, 3);
    assert.equal(report.counts.blockers, 0);
    assert.equal(existsSync(report.files.manifest), true);
    assert.equal(existsSync(report.files.tasks), true);
    assert.equal(existsSync(report.files.locks), true);
    assert.equal(existsSync(report.files.blockers), true);

    const supportTask = report.tasks.find((task) => task.entity_type === 'support');
    assert.ok(supportTask);
    assert.equal(supportTask.entity_id, 'source-1');
    assert.equal(supportTask.version, '01.00.000');

    const processTask = report.tasks.find((task) => task.entity_type === 'process');
    assert.ok(processTask);
    assert.deepEqual(processTask.depends_on, ['flow:flow-1@01.00.000']);
    assert.equal(existsSync(processTask.input_rows_file), true);
    assert.equal(existsSync(processTask.closure_file), true);
    assert.equal(existsSync(processTask.run_plan_file), true);
    assert.match(readFileSync(processTask.run_plan_file, 'utf8'), /dependency_closure/u);

    const manifest = readJson(report.files.manifest) as DatasetCurationQueueBuildReport;
    assert.equal(manifest.hashes.task_order, report.hashes.task_order);
    assert.deepEqual(manifest.counts, report.counts);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runDatasetCurationQueueBuild blocks unresolved process flow references', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-curation-queue-blocker-'));
  const processes = path.join(dir, 'processes.jsonl');
  const flows = path.join(dir, 'flows.jsonl');
  const outDir = path.join(dir, 'queue');
  writeJsonl(processes, [makeProcess('missing-flow')]);
  writeJsonl(flows, [makeFlow()]);

  try {
    const report = await runDatasetCurationQueueBuild({
      processesPath: processes,
      flowsPath: flows,
      outDir,
    });

    assert.equal(report.status, 'blocked');
    assert.equal(report.counts.blockers, 1);
    assert.equal(report.blockers[0]?.code, 'process_flow_reference_unresolved');
    assert.match(readFileSync(report.files.blockers, 'utf8'), /missing-flow/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runDatasetCurationQueueBuild accepts external flow refs and focused process subsets', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-curation-queue-external-'));
  const processes = path.join(dir, 'processes.jsonl');
  const externalRefs = path.join(dir, 'external-flows.jsonl');
  const outDir = path.join(dir, 'queue');
  writeJsonl(processes, [makeProcess('external-flow'), makeProcess('skipped-flow')]);
  writeJsonl(externalRefs, [
    { id: 'external-flow', version: '02.00.000' },
    { id: 'external-unused' },
  ]);

  try {
    const report = await runDatasetCurationQueueBuild({
      processesPath: processes,
      externalFlowRefPaths: [externalRefs],
      excludeProcessIds: ['skipped-process', 'process-skip', 'process-2'],
      processLimit: 1,
      outDir,
    });

    assert.equal(report.status, 'ready');
    assert.equal(report.inputs.flows, null);
    assert.equal(report.counts.flow_rows, 0);
    assert.equal(report.counts.process_rows, 1);
    assert.equal(report.counts.external_flow_refs, 2);

    const processTask = report.tasks.find((task) => task.entity_type === 'process');
    assert.ok(processTask);
    const closure = readJson(processTask.closure_file) as {
      dependencies?: { external_refs?: Array<{ entity_id: string }> };
    };
    assert.equal(closure.dependencies?.external_refs?.[0]?.entity_id, 'external-flow');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runDatasetCurationQueueBuild supports unversioned rows and sanitized entity directories', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-curation-queue-unversioned-'));
  const processes = path.join(dir, 'processes.jsonl');
  const outDir = path.join(dir, 'queue');
  writeJsonl(processes, [
    {
      id: '$$$',
      json_ordered: {
        processDataSet: {
          processInformation: {
            dataSetInformation: {
              'common:UUID': '$$$',
            },
          },
        },
      },
    },
  ]);

  try {
    const report = await runDatasetCurationQueueBuild({
      processesPath: processes,
      outDir,
    });

    assert.equal(report.status, 'ready');
    assert.equal(report.tasks[0]?.version, 'unversioned');
    assert.match(report.tasks[0]?.work_dir ?? '', /unknown__unversioned/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runDatasetCurationQueueBuild validates required flags and row identities', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-curation-queue-errors-'));
  const processes = path.join(dir, 'processes.jsonl');
  const externalRefs = path.join(dir, 'external-flows.jsonl');
  writeJsonl(processes, [makeProcess()]);
  writeJsonl(externalRefs, [{ payload: {} }]);

  try {
    await assert.rejects(
      () => runDatasetCurationQueueBuild({ processesPath: '', outDir: path.join(dir, 'queue') }),
      /--processes is required/u,
    );
    await assert.rejects(
      () =>
        runDatasetCurationQueueBuild({
          processesPath: path.join(dir, 'missing.jsonl'),
          outDir: path.join(dir, 'queue'),
        }),
      /file does not exist/u,
    );
    await assert.rejects(
      () =>
        runDatasetCurationQueueBuild({
          processesPath: processes,
          processLimit: 0,
          outDir: path.join(dir, 'queue'),
        }),
      /--process-limit must be a positive integer/u,
    );
    await assert.rejects(
      () =>
        runDatasetCurationQueueBuild({
          processesPath: externalRefs,
          outDir: path.join(dir, 'queue'),
        }),
      /process row is missing a stable id/u,
    );
    await assert.rejects(
      () =>
        runDatasetCurationQueueBuild({
          processesPath: processes,
          externalFlowRefPaths: [externalRefs],
          outDir: path.join(dir, 'queue'),
        }),
      /External flow ref is missing id/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dataset curation queue flow ref extraction covers supported reference shapes', () => {
  const refs = __testInternals.extractProcessFlowRefs({
    noRef: 'ignored',
    flow_dataset: {
      refObjectId: 'flow-a',
      version: '01',
    },
    nested: [
      null,
      {
        reference_to_flow_dataset: {
          ref_object_id: 'flow-b',
          dataSetVersion: '02',
        },
      },
      {
        flowDataSet: {
          uuid: 'flow-c',
          'common:dataSetVersion': '03',
        },
      },
      {
        referenceToFlowDataSet: {
          'common:UUID': 'flow-d',
        },
      },
      {
        referenceToFlowDataSet: {
          id: 'flow-e',
        },
      },
    ],
  });

  assert.deepEqual(
    refs.map((ref) => `${ref.id}@${ref.version ?? ''}`),
    ['flow-a@01', 'flow-b@02', 'flow-c@03', 'flow-d@', 'flow-e@'],
  );
});

test('executeCli executes dataset curation-queue build with injected implementation', async () => {
  const result = await executeCli(
    [
      'dataset',
      'curation-queue',
      'build',
      '--json',
      '--processes',
      './processes.jsonl',
      '--flows',
      './flows.jsonl',
      '--support',
      './sources.jsonl',
      '--external-flow-ref',
      './external-flows.jsonl',
      '--exclude-process-id',
      'process-skip',
      '--process-limit',
      '2',
      '--out-dir',
      './queue',
    ],
    {
      ...deps,
      runDatasetCurationQueueBuildImpl: async (options) => {
        assert.equal(options.processesPath, './processes.jsonl');
        assert.equal(options.flowsPath, './flows.jsonl');
        assert.deepEqual(options.supportPaths, ['./sources.jsonl']);
        assert.deepEqual(options.externalFlowRefPaths, ['./external-flows.jsonl']);
        assert.deepEqual(options.excludeProcessIds, ['process-skip']);
        assert.equal(options.processLimit, 2);
        assert.equal(options.outDir, './queue');
        return {
          schema_version: 1,
          generated_at_utc: '2026-06-02T00:00:00.000Z',
          status: 'ready',
          out_dir: '/tmp/queue',
          inputs: {
            processes: '/tmp/processes.jsonl',
            flows: '/tmp/flows.jsonl',
            support: ['/tmp/sources.jsonl'],
            external_flow_refs: ['/tmp/external-flows.jsonl'],
          },
          counts: {
            support_rows: 1,
            flow_rows: 1,
            process_rows: 1,
            external_flow_refs: 1,
            tasks: 3,
            blockers: 0,
          },
          hashes: {
            inputs: {},
            task_order: 'abc',
          },
          files: {
            manifest: '/tmp/queue/outputs/curation-queue-manifest.json',
            tasks: '/tmp/queue/outputs/curation-queue-tasks.jsonl',
            locks: '/tmp/queue/outputs/curation-queue-locks.json',
            blockers: '/tmp/queue/outputs/curation-queue-blockers.jsonl',
          },
          tasks: [],
          blockers: [],
        };
      },
    },
  );

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /"status":"ready"/u);
});

test('executeCli exposes dataset curation-queue help and errors', async () => {
  const namespaceHelp = await executeCli(['dataset', 'curation-queue'], deps);
  assert.equal(namespaceHelp.exitCode, 0);
  assert.match(namespaceHelp.stdout, /dataset curation-queue build/u);

  const actionHelp = await executeCli(['dataset', 'curation-queue', 'build', '--help'], deps);
  assert.equal(actionHelp.exitCode, 0);
  assert.match(actionHelp.stdout, /curation-queue-blockers\.jsonl/u);

  const invalidAction = await executeCli(['dataset', 'curation-queue', 'next'], deps);
  assert.equal(invalidAction.exitCode, 2);
  assert.match(invalidAction.stderr, /action must be 'build'/u);

  const invalidFlag = await executeCli(
    ['dataset', 'curation-queue', 'build', '--processes', './rows.jsonl', '--bad-flag'],
    deps,
  );
  assert.equal(invalidFlag.exitCode, 2);
  assert.match(invalidFlag.stderr, /Unknown option/u);
});

test('executeCli maps dataset curation-queue blockers to exit code 1', async () => {
  const result = await executeCli(
    [
      'dataset',
      'curation-queue',
      'build',
      '--processes',
      './processes.jsonl',
      '--out-dir',
      './queue',
    ],
    {
      ...deps,
      runDatasetCurationQueueBuildImpl: async () => ({
        schema_version: 1,
        generated_at_utc: '2026-06-02T00:00:00.000Z',
        status: 'blocked',
        out_dir: '/tmp/queue',
        inputs: {
          processes: '/tmp/processes.jsonl',
          flows: null,
          support: [],
          external_flow_refs: [],
        },
        counts: {
          support_rows: 0,
          flow_rows: 0,
          process_rows: 1,
          external_flow_refs: 0,
          tasks: 1,
          blockers: 1,
        },
        hashes: {
          inputs: {},
          task_order: 'abc',
        },
        files: {
          manifest: '/tmp/queue/outputs/curation-queue-manifest.json',
          tasks: '/tmp/queue/outputs/curation-queue-tasks.jsonl',
          locks: '/tmp/queue/outputs/curation-queue-locks.json',
          blockers: '/tmp/queue/outputs/curation-queue-blockers.jsonl',
        },
        tasks: [],
        blockers: [
          {
            schema_version: 1,
            code: 'process_flow_reference_unresolved',
            severity: 'blocker',
            entity_type: 'process',
            entity_id: 'process-1',
            version: '01.00.000',
            message: 'missing flow',
          },
        ],
      }),
    },
  );

  assert.equal(result.exitCode, 1);
  assert.match(result.stdout, /process_flow_reference_unresolved/u);
});
