import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  __testInternals,
  runLifecyclemodelValidateBuild,
} from '../src/lib/lifecyclemodel-validate-build.js';
import { runValidation, type ValidationRunReport } from '../src/lib/validation.js';

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
    includeAutoBuildReport?: boolean;
    writeInvocationIndex?: boolean;
    manifestRunId?: string;
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

  if (options?.includeAutoBuildReport) {
    writeJson(path.join(runRoot, 'reports', 'lifecyclemodel-auto-build-report.json'), {
      status: 'completed_local_lifecyclemodel_auto_build_run',
    });
  }

  return runRoot;
}

function makeValidationRunReport(
  inputDir: string,
  ok: boolean,
  reportFile: string,
  mode: ValidationRunReport['mode'] = 'auto',
): ValidationRunReport {
  return {
    input_dir: inputDir,
    mode,
    ok,
    summary: {
      engine_count: 1,
      ok_count: ok ? 1 : 0,
      failed_count: ok ? 0 : 1,
    },
    files: {
      report: reportFile,
    },
    reports: [
      {
        engine: 'sdk',
        ok,
        duration_ms: 0,
        location: '/tmp/sdk.js',
        report: {
          input_dir: inputDir,
          ok,
          summary: {
            category_count: 1,
            issue_count: ok ? 0 : 1,
            error_count: ok ? 0 : 1,
            warning_count: 0,
            info_count: 0,
          },
          categories: [],
          issues: ok
            ? []
            : [
                {
                  issue_code: 'schema_error',
                  severity: 'error',
                  category: 'lifecyclemodels',
                  file_path: path.join(inputDir, 'lifecyclemodels', 'demo.json'),
                  message: 'Broken lifecycle model dataset',
                  location: '<root>',
                  context: {},
                },
              ],
        },
      },
    ],
    comparison: null,
  };
}

test('runLifecyclemodelValidateBuild validates all local model bundles and writes aggregate artifacts', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-lifecyclemodel-validate-build-'));
  const runRoot = createLifecyclemodelRunFixture(dir, 'lm-run-1', ['model-a', 'model-b'], {
    includeAutoBuildReport: true,
  });

  try {
    const report = await runLifecyclemodelValidateBuild(
      {
        runDir: runRoot,
        engine: 'sdk',
        now: new Date('2026-03-30T00:00:00.000Z'),
        cwd: '/tmp/lifecyclemodel-validate',
      },
      {
        runValidationImpl: async (options) => {
          const ok = !options.inputDir.includes('model-b');
          const reportFile = path.resolve(options.reportFile as string);
          const result = makeValidationRunReport(options.inputDir, ok, reportFile, 'sdk');
          writeJson(reportFile, result);
          return result;
        },
      },
    );

    assert.equal(report.status, 'completed_lifecyclemodel_validate_build');
    assert.equal(report.run_id, 'lm-run-1');
    assert.equal(report.ok, false);
    assert.equal(report.engine, 'sdk');
    assert.deepEqual(report.counts, {
      models: 2,
      ok: 1,
      failed: 1,
    });
    assert.equal(
      report.files.auto_build_report,
      path.join(runRoot, 'reports', 'lifecyclemodel-auto-build-report.json'),
    );
    assert.equal(report.model_reports.length, 2);
    assert.equal(readJson<JsonRecord>(report.files.report).status, report.status);
    assert.equal(existsSyncLike(report.model_reports[0]?.report_file ?? ''), true);
    assert.match(report.next_actions[2] ?? '', /publish-build/u);

    const invocationIndex = readJson<{ invocations: Array<Record<string, unknown>> }>(
      report.files.invocation_index,
    );
    assert.equal(invocationIndex.invocations.length, 1);
    assert.deepEqual(invocationIndex.invocations[0]?.command, [
      'lifecyclemodel',
      'validate-build',
      '--run-dir',
      runRoot,
      '--engine',
      'sdk',
    ]);
    assert.equal(invocationIndex.invocations[0]?.cwd, '/tmp/lifecyclemodel-validate');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runLifecyclemodelValidateBuild supports missing optional artifacts and all-ok validation runs', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-lifecyclemodel-validate-build-ok-'));
  const runRoot = createLifecyclemodelRunFixture(dir, 'lm-run-2', ['model-a'], {
    writeInvocationIndex: false,
  });

  try {
    const report = await runLifecyclemodelValidateBuild(
      {
        runDir: runRoot,
        now: new Date('2026-03-30T00:00:00.000Z'),
      },
      {
        runValidationImpl: async (options) => {
          const reportFile = path.resolve(options.reportFile as string);
          const result = makeValidationRunReport(options.inputDir, true, reportFile, 'auto');
          writeJson(reportFile, result);
          return result;
        },
      },
    );

    assert.equal(report.ok, true);
    assert.equal(report.files.auto_build_report, null);
    assert.equal(report.model_reports.length, 1);
    assert.equal(readJson<JsonRecord>(report.files.invocation_index).schema_version, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runLifecyclemodelValidateBuild rejects missing runs and mismatched run manifests', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-lifecyclemodel-validate-build-errors-'));
  const missingRunDir = path.join(dir, 'missing-run');
  const missingManifestRunDir = path.join(dir, 'lm-run-missing-manifest');
  mkdirSync(missingManifestRunDir, { recursive: true });
  const invalidManifestRunDir = path.join(dir, 'lm-run-invalid-manifest');
  writeJson(path.join(invalidManifestRunDir, 'manifests', 'run-manifest.json'), []);
  const mismatchRunDir = createLifecyclemodelRunFixture(dir, 'lm-run-3', ['model-a'], {
    manifestRunId: 'other-run-id',
  });

  try {
    await assert.rejects(
      async () =>
        runLifecyclemodelValidateBuild({
          runDir: missingRunDir,
        }),
      /run root not found/u,
    );

    await assert.rejects(
      async () =>
        runLifecyclemodelValidateBuild({
          runDir: missingManifestRunDir,
        }),
      /run-manifest artifact not found/u,
    );

    await assert.rejects(
      async () =>
        runLifecyclemodelValidateBuild({
          runDir: invalidManifestRunDir,
        }),
      /run-manifest artifact JSON object/u,
    );

    await assert.rejects(
      async () =>
        runLifecyclemodelValidateBuild({
          runDir: mismatchRunDir,
        }),
      /run manifest runId mismatch/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('lifecyclemodel validate-build internals cover layout, invocation index, and discovery edge cases', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-lifecyclemodel-validate-build-helpers-'));

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

    const layout = __testInternals.buildLayout(path.join(dir, 'lm-run-helpers'));

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
      /Expected lifecyclemodel validate invocation index JSON object/u,
    );

    writeJson(layout.invocationIndexPath, {
      invocations: {},
    });
    assert.throws(() => __testInternals.readInvocationIndex(layout), /invocations array/u);

    assert.throws(
      () => __testInternals.discoverModelEntries(layout),
      /does not contain any model bundles/u,
    );

    mkdirSync(path.join(layout.modelsDir, 'ignored-entry'), { recursive: true });
    mkdirSync(path.join(layout.modelsDir, 'empty-bundle', 'tidas_bundle', 'lifecyclemodels'), {
      recursive: true,
    });
    assert.throws(
      () => __testInternals.discoverModelEntries(layout),
      /without lifecyclemodel JSON files/u,
    );

    rmSync(path.join(layout.modelsDir, 'empty-bundle'), { recursive: true, force: true });
    writeJson(
      path.join(layout.modelsDir, 'model-a', 'tidas_bundle', 'lifecyclemodels', 'model-a.json'),
      createLifecyclemodelPayload('lm-helper'),
    );

    const entries = __testInternals.discoverModelEntries(layout);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].runName, 'model-a');
    assert.equal(entries[0].modelFiles.length, 1);

    const invocationIndex = __testInternals.buildInvocationIndex(
      layout,
      {
        schema_version: 'bad',
        invocations: {},
      },
      {
        runDir: layout.runRoot,
        engine: 'sdk',
        cwd: '/tmp/validate-cwd',
      },
      new Date('2026-03-30T00:00:00.000Z'),
    );
    const firstInvocation = (invocationIndex.invocations as JsonRecord[])[0];
    assert.deepEqual(firstInvocation.command, [
      'lifecyclemodel',
      'validate-build',
      '--run-dir',
      layout.runRoot,
      '--engine',
      'sdk',
    ]);
    assert.equal(invocationIndex.schema_version, 1);
    assert.equal(__testInternals.buildNextActions(layout).length, 3);
    assert.equal(__testInternals.resolveValidationImpl({}), runValidation);

    const injectedValidationImpl = async () =>
      makeValidationRunReport(layout.modelsDir, true, path.join(layout.reportsDir, 'report.json'));
    assert.equal(
      __testInternals.resolveValidationImpl({
        runValidationImpl: injectedValidationImpl,
      }),
      injectedValidationImpl,
    );
    assert.equal(
      __testInternals.resolveReportEngine(
        [
          {
            run_name: 'model-a',
            input_dir: layout.modelsDir,
            model_files: [],
            report_file: path.join(layout.reportsDir, 'model-a.json'),
            validation: makeValidationRunReport(
              layout.modelsDir,
              true,
              path.join(layout.reportsDir, 'model-a.json'),
              'sdk',
            ),
          },
        ],
        'sdk',
      ),
      'sdk',
    );
    assert.equal(__testInternals.resolveReportEngine([], 'sdk'), 'sdk');
    assert.equal(__testInternals.resolveReportEngine([], undefined), 'auto');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function existsSyncLike(filePath: string): boolean {
  try {
    readFileSync(filePath, 'utf8');
    return true;
  } catch {
    return false;
  }
}
