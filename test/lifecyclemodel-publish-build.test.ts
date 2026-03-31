import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  __testInternals,
  runLifecyclemodelPublishBuild,
} from '../src/lib/lifecyclemodel-publish-build.js';
import { runPublish } from '../src/lib/publish.js';

type JsonRecord = Record<string, unknown>;

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function createLifecyclemodelPayload(id: string, version = '01.01.000'): JsonRecord {
  return {
    lifeCycleModelDataSet: {
      lifeCycleModelInformation: {
        dataSetInformation: {
          'common:UUID': id,
          referenceToResultingProcess: {
            '@refObjectId': `${id}-result`,
          },
        },
        quantitativeReference: {
          referenceToReferenceProcess: '1',
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          'common:dataSetVersion': version,
        },
      },
    },
  };
}

function createLifecyclemodelRunFixture(
  rootDir: string,
  runName: string,
  modelNames: string[] = ['model-a'],
  options?: {
    writeInvocationIndex?: boolean;
    manifestRunId?: string;
    validationReport?: JsonRecord;
  },
): string {
  const runRoot = path.join(rootDir, runName);
  writeJson(path.join(runRoot, 'manifests', 'run-manifest.json'), {
    schemaVersion: 1,
    runId: options?.manifestRunId ?? runName,
  });

  if (options?.writeInvocationIndex !== false) {
    writeJson(path.join(runRoot, 'manifests', 'invocation-index.json'), {
      schema_version: 1,
      invocations: [],
    });
  }

  for (const modelName of modelNames) {
    writeJson(
      path.join(
        runRoot,
        'models',
        modelName,
        'tidas_bundle',
        'lifecyclemodels',
        `${modelName}.json`,
      ),
      createLifecyclemodelPayload(`${modelName}-uuid`),
    );
  }

  if (options?.validationReport) {
    writeJson(
      path.join(runRoot, 'reports', 'lifecyclemodel-validate-build-report.json'),
      options.validationReport,
    );
  }

  return runRoot;
}

test('runLifecyclemodelPublishBuild writes lifecyclemodel publish handoff artifacts', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-lifecyclemodel-publish-build-'));
  const runRoot = createLifecyclemodelRunFixture(dir, 'lm-publish-1', ['model-a', 'model-b']);

  try {
    const report = await runLifecyclemodelPublishBuild({
      runDir: runRoot,
      now: new Date('2026-03-30T00:00:00.000Z'),
      cwd: '/tmp/lifecyclemodel-publish',
    });

    assert.equal(report.status, 'prepared_local_lifecyclemodel_publish_bundle');
    assert.deepEqual(report.counts, {
      lifecyclemodels: 2,
    });
    assert.deepEqual(report.publish_defaults, {
      commit: false,
      publish_lifecyclemodels: true,
      publish_processes: false,
      publish_sources: false,
      publish_relations: false,
      publish_process_build_runs: false,
      relation_mode: 'local_manifest_only',
    });
    assert.deepEqual(report.validation, {
      available: false,
      ok: null,
      report: null,
    });

    const publishBundle = readJson<JsonRecord>(report.files.publish_bundle);
    assert.equal((publishBundle.lifecyclemodels as JsonRecord[]).length, 2);
    assert.equal((publishBundle.relations as JsonRecord[]).length, 0);
    assert.equal((publishBundle.source_run as JsonRecord).run_manifest instanceof Object, true);

    const publishRequest = readJson<JsonRecord>(report.files.publish_request);
    assert.deepEqual((publishRequest.inputs as JsonRecord).bundle_paths, ['./publish-bundle.json']);
    const publishIntent = readJson<JsonRecord>(report.files.publish_intent);
    assert.equal(publishIntent.command, 'publish run');
    assert.match(report.next_actions[2], /tiangong publish run/u);

    const invocationIndex = readJson<{ invocations: Array<Record<string, unknown>> }>(
      report.files.invocation_index,
    );
    assert.equal(invocationIndex.invocations.length, 1);
    assert.deepEqual(invocationIndex.invocations[0]?.command, [
      'lifecyclemodel',
      'publish-build',
      '--run-dir',
      runRoot,
    ]);

    const publishRunReport = await runPublish({
      inputPath: report.files.publish_request,
      now: new Date('2026-03-30T01:00:00.000Z'),
    });
    assert.equal(publishRunReport.status, 'completed');
    assert.equal(publishRunReport.counts.lifecyclemodels, 2);
    assert.equal(publishRunReport.lifecyclemodels[0]?.status, 'prepared');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runLifecyclemodelPublishBuild surfaces validation summary when available', async () => {
  const dir = mkdtempSync(
    path.join(os.tmpdir(), 'tg-cli-lifecyclemodel-publish-build-validation-'),
  );
  const runRoot = createLifecyclemodelRunFixture(dir, 'lm-publish-2', ['model-a'], {
    writeInvocationIndex: false,
    validationReport: {
      ok: false,
    },
  });

  try {
    const report = await runLifecyclemodelPublishBuild({
      runDir: runRoot,
    });

    assert.deepEqual(report.validation, {
      available: true,
      ok: false,
      report: path.join(runRoot, 'reports', 'lifecyclemodel-validate-build-report.json'),
    });
    assert.equal(readJson<JsonRecord>(report.files.invocation_index).schema_version, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runLifecyclemodelPublishBuild rejects missing runs and mismatched manifests', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-lifecyclemodel-publish-build-errors-'));
  const missingRunDir = path.join(dir, 'missing-run');
  const missingManifestRunDir = path.join(dir, 'lm-publish-missing-manifest');
  mkdirSync(missingManifestRunDir, { recursive: true });
  const invalidManifestRunDir = path.join(dir, 'lm-publish-invalid-manifest');
  writeJson(path.join(invalidManifestRunDir, 'manifests', 'run-manifest.json'), []);
  const mismatchRunDir = createLifecyclemodelRunFixture(dir, 'lm-publish-3', ['model-a'], {
    manifestRunId: 'other-run-id',
  });

  try {
    await assert.rejects(
      async () =>
        runLifecyclemodelPublishBuild({
          runDir: missingRunDir,
        }),
      /run root not found/u,
    );

    await assert.rejects(
      async () =>
        runLifecyclemodelPublishBuild({
          runDir: missingManifestRunDir,
        }),
      /run-manifest artifact not found/u,
    );

    await assert.rejects(
      async () =>
        runLifecyclemodelPublishBuild({
          runDir: invalidManifestRunDir,
        }),
      /run-manifest artifact JSON object/u,
    );

    await assert.rejects(
      async () =>
        runLifecyclemodelPublishBuild({
          runDir: mismatchRunDir,
        }),
      /run manifest runId mismatch/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('lifecyclemodel publish-build internals cover layout, invocation index, validation, and payload edge cases', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-lifecyclemodel-publish-build-helpers-'));

  try {
    assert.throws(
      () =>
        __testInternals.resolveLayout({
          runDir: '',
        }),
      /Missing required --run-dir/u,
    );

    assert.throws(
      () =>
        __testInternals.resolveLayout({
          runDir: 123 as unknown as string,
        }),
      /Missing required --run-dir/u,
    );

    const layout = __testInternals.buildLayout(path.join(dir, 'lm-publish-helpers'));

    assert.deepEqual(__testInternals.readInvocationIndex(layout), {
      schema_version: 1,
      invocations: [],
    });

    mkdirSync(layout.manifestsDir, { recursive: true });
    writeJson(layout.invocationIndexPath, {});
    assert.deepEqual(__testInternals.readInvocationIndex(layout), {
      schema_version: 1,
      invocations: [],
    });

    writeJson(layout.invocationIndexPath, []);
    assert.throws(
      () => __testInternals.readInvocationIndex(layout),
      /Expected lifecyclemodel publish invocation index JSON object/u,
    );

    writeJson(layout.invocationIndexPath, {
      invocations: {},
    });
    assert.throws(() => __testInternals.readInvocationIndex(layout), /invocations array/u);

    assert.deepEqual(__testInternals.readValidationSummary(layout), {
      available: false,
      ok: null,
      report: null,
    });

    writeJson(layout.validationReportPath, []);
    assert.throws(
      () => __testInternals.readValidationSummary(layout),
      /validate-build report JSON object/u,
    );

    writeJson(layout.validationReportPath, {});
    assert.deepEqual(__testInternals.readValidationSummary(layout), {
      available: true,
      ok: false,
      report: layout.validationReportPath,
    });

    assert.throws(
      () => __testInternals.collectLifecyclemodelPayloads(layout),
      /does not contain any lifecyclemodel payloads/u,
    );

    mkdirSync(path.join(layout.modelsDir, 'ignored-entry'), { recursive: true });
    writeJson(
      path.join(layout.modelsDir, 'model-a', 'tidas_bundle', 'lifecyclemodels', 'model-a.json'),
      createLifecyclemodelPayload('lm-helper'),
    );
    assert.equal(__testInternals.collectLifecyclemodelPayloads(layout).length, 1);

    writeJson(
      path.join(layout.modelsDir, 'model-b', 'tidas_bundle', 'lifecyclemodels', 'broken.json'),
      [],
    );
    assert.throws(
      () => __testInternals.collectLifecyclemodelPayloads(layout),
      /publish payload JSON object/u,
    );

    const publishRequest = __testInternals.buildPublishRequest();
    assert.equal((publishRequest.publish as JsonRecord).publish_lifecyclemodels, true);
    const publishIntent = __testInternals.buildPublishIntent(layout, 2);
    assert.equal(publishIntent.lifecyclemodel_count, 2);
    const invocationIndex = __testInternals.buildInvocationIndex(
      layout,
      {
        schema_version: 'bad',
        invocations: {},
      },
      {
        runDir: layout.runRoot,
        cwd: '/tmp/publish-cwd',
      },
      new Date('2026-03-30T00:00:00.000Z'),
    );
    const firstInvocation = (invocationIndex.invocations as JsonRecord[])[0];
    assert.deepEqual(firstInvocation.command, [
      'lifecyclemodel',
      'publish-build',
      '--run-dir',
      layout.runRoot,
    ]);
    assert.equal(invocationIndex.schema_version, 1);
    assert.equal(__testInternals.buildNextActions(layout).length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
