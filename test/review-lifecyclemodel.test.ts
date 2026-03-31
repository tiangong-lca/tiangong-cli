import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { __testInternals, runLifecyclemodelReview } from '../src/lib/review-lifecyclemodel.js';

type JsonRecord = Record<string, unknown>;

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function createProcessInstance(id: string, multiplicationFactor: string | number): JsonRecord {
  return {
    '@id': id,
    '@multiplicationFactor': String(multiplicationFactor),
  };
}

function createLifecyclemodelPayload(options: {
  id: string;
  version?: string;
  referenceProcessInternalId?: string;
  resultingProcessId?: string;
  processInstances?: JsonRecord[];
}): JsonRecord {
  return {
    lifeCycleModelDataSet: {
      lifeCycleModelInformation: {
        dataSetInformation: {
          'common:UUID': options.id,
          ...(options.resultingProcessId
            ? {
                referenceToResultingProcess: {
                  '@refObjectId': options.resultingProcessId,
                },
              }
            : {}),
        },
        quantitativeReference: {
          referenceToReferenceProcess: options.referenceProcessInternalId ?? '1',
        },
        technology: {
          processes: {
            processInstance:
              options.processInstances && options.processInstances.length === 1
                ? options.processInstances[0]
                : (options.processInstances ?? []),
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          'common:dataSetVersion': options.version ?? '01.00.000',
        },
      },
    },
  };
}

function createValidationIssue(filePath: string): JsonRecord {
  return {
    issue_code: 'schema_error',
    severity: 'error',
    category: 'lifecyclemodels',
    file_path: filePath,
    message: 'Broken lifecycle model dataset',
    location: '<root>',
    context: {
      detail: 'demo',
    },
  };
}

function createValidationAggregateReport(options: {
  runRoot: string;
  modelReports: Array<{
    runName: string;
    modelFiles: string[];
    reportFile: string;
    issues: JsonRecord[];
    mode?: 'auto' | 'sdk';
    ok?: boolean;
  }>;
}): JsonRecord {
  return {
    schema_version: 1,
    generated_at_utc: '2026-03-30T00:00:00.000Z',
    status: 'completed_lifecyclemodel_validate_build',
    run_id: path.basename(options.runRoot),
    run_root: options.runRoot,
    ok: options.modelReports.every((entry) => entry.ok !== false && entry.issues.length === 0),
    engine: 'sdk',
    counts: {
      models: options.modelReports.length,
      ok: options.modelReports.filter((entry) => entry.ok !== false && entry.issues.length === 0)
        .length,
      failed: options.modelReports.filter((entry) => entry.ok === false || entry.issues.length > 0)
        .length,
    },
    files: {
      run_manifest: path.join(options.runRoot, 'manifests', 'run-manifest.json'),
      invocation_index: path.join(options.runRoot, 'manifests', 'invocation-index.json'),
      auto_build_report: null,
      report: path.join(options.runRoot, 'reports', 'lifecyclemodel-validate-build-report.json'),
      model_reports_dir: path.join(options.runRoot, 'reports', 'model-validations'),
    },
    model_reports: options.modelReports.map((entry) => ({
      run_name: entry.runName,
      input_dir: path.join(options.runRoot, 'models', entry.runName, 'tidas_bundle'),
      model_files: entry.modelFiles,
      report_file: entry.reportFile,
      validation: {
        input_dir: path.join(options.runRoot, 'models', entry.runName, 'tidas_bundle'),
        mode: entry.mode ?? 'sdk',
        ok: entry.ok ?? entry.issues.length === 0,
        summary: {
          engine_count: 1,
          ok_count: entry.issues.length === 0 ? 1 : 0,
          failed_count: entry.issues.length === 0 ? 0 : 1,
        },
        files: {
          report: entry.reportFile,
        },
        reports: [
          {
            engine: 'sdk',
            ok: entry.issues.length === 0,
            duration_ms: 0,
            location: '/tmp/sdk.js',
            report: {
              input_dir: path.join(options.runRoot, 'models', entry.runName, 'tidas_bundle'),
              ok: entry.issues.length === 0,
              summary: {
                category_count: 1,
                issue_count: entry.issues.length,
                error_count: entry.issues.length,
                warning_count: 0,
                info_count: 0,
              },
              categories: [],
              issues: entry.issues,
            },
          },
        ],
        comparison: null,
      },
    })),
  };
}

function writeMinimalRunManifest(runRoot: string, runId = path.basename(runRoot)): void {
  writeJson(path.join(runRoot, 'manifests', 'run-manifest.json'), {
    schemaVersion: 1,
    runId,
  });
}

function writeLifecyclemodelBundle(
  runRoot: string,
  runName: string,
  value: JsonRecord,
  fileName = `${runName}.json`,
): string {
  const modelFile = path.join(
    runRoot,
    'models',
    runName,
    'tidas_bundle',
    'lifecyclemodels',
    fileName,
  );
  writeJson(modelFile, value);
  return modelFile;
}

test('runLifecyclemodelReview writes artifact-first outputs and dedupes validation findings', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-review-lifecyclemodel-'));
  const runRoot = path.join(dir, 'lm-run-1');
  const outDir = path.join(dir, 'review');

  writeJson(path.join(runRoot, 'manifests', 'run-manifest.json'), {
    schemaVersion: 1,
    runId: 'lm-run-1',
  });
  writeJson(path.join(runRoot, 'manifests', 'invocation-index.json'), {
    schema_version: 1,
    invocations: [],
  });

  const modelAFile = path.join(
    runRoot,
    'models',
    'model-a',
    'tidas_bundle',
    'lifecyclemodels',
    'model-a.json',
  );
  writeJson(
    modelAFile,
    createLifecyclemodelPayload({
      id: 'model-a-uuid',
      resultingProcessId: 'process-a-result',
      referenceProcessInternalId: '10',
      processInstances: [createProcessInstance('a-1', 1), createProcessInstance('a-2', 0)],
    }),
  );
  writeJson(path.join(runRoot, 'models', 'model-a', 'summary.json'), {
    run_name: 'model-a',
    model_uuid: 'model-a-uuid',
    model_version: '01.00.000',
    reference_process_uuid: 'process-a',
    reference_process_internal_id: '10',
    reference_to_resulting_process_uuid: 'process-a-result',
    process_count: 3,
    edge_count: 2,
    multiplication_factors: {
      'a-1': '1',
    },
  });
  writeJson(path.join(runRoot, 'models', 'model-a', 'connections.json'), [
    {
      src: 'process-a',
      dst: 'process-b',
    },
  ]);
  writeJson(path.join(runRoot, 'models', 'model-a', 'process-catalog.json'), [
    {
      process_uuid: 'process-a',
    },
  ]);

  const modelBFile = path.join(
    runRoot,
    'models',
    'model-b',
    'tidas_bundle',
    'lifecyclemodels',
    'model-b.json',
  );
  writeJson(
    modelBFile,
    createLifecyclemodelPayload({
      id: 'model-b-uuid',
      processInstances: [],
    }),
  );

  writeJson(
    path.join(runRoot, 'reports', 'lifecyclemodel-validate-build-report.json'),
    createValidationAggregateReport({
      runRoot,
      modelReports: [
        {
          runName: 'model-a',
          modelFiles: [modelAFile],
          reportFile: path.join(runRoot, 'reports', 'model-validations', 'model-a.json'),
          issues: [createValidationIssue(modelAFile), createValidationIssue(modelAFile)],
          mode: 'sdk',
          ok: false,
        },
        {
          runName: 'model-b',
          modelFiles: [modelBFile],
          reportFile: path.join(runRoot, 'reports', 'model-validations', 'model-b.json'),
          issues: [],
          mode: 'auto',
          ok: true,
        },
      ],
    }),
  );

  try {
    const report = await runLifecyclemodelReview({
      runDir: runRoot,
      outDir,
      logicVersion: 'review-v1',
      startTs: '2026-03-30T00:00:00.000Z',
      endTs: '2026-03-30T00:10:00.000Z',
      now: () => new Date('2026-03-30T00:11:00.000Z'),
      cwd: '/tmp/lifecyclemodel-review',
    });

    assert.equal(report.status, 'completed_local_lifecyclemodel_review');
    assert.equal(report.logic_version, 'review-v1');
    assert.equal(report.model_count, 2);
    assert.equal(report.finding_count, 11);
    assert.deepEqual(report.severity_counts, {
      error: 2,
      warning: 9,
      info: 0,
    });
    assert.deepEqual(report.validation, {
      available: true,
      ok: false,
      report: path.join(runRoot, 'reports', 'lifecyclemodel-validate-build-report.json'),
    });
    assert.equal(report.generated_at_utc, '2026-03-30T00:11:00.000Z');
    assert.ok(existsSync(report.files.model_summaries));
    assert.ok(existsSync(report.files.findings));
    assert.ok(existsSync(report.files.summary));
    assert.ok(existsSync(report.files.review_zh));
    assert.ok(existsSync(report.files.review_en));
    assert.ok(existsSync(report.files.timing));
    assert.ok(existsSync(report.files.report));

    const modelSummaries = readFileSync(report.files.model_summaries, 'utf8')
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line) as { run_name: string; finding_count: number });
    assert.deepEqual(
      modelSummaries.map((entry) => entry.run_name),
      ['model-a', 'model-b'],
    );
    assert.deepEqual(
      modelSummaries.map((entry) => entry.finding_count),
      [5, 6],
    );

    const findings = readFileSync(report.files.findings, 'utf8')
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line) as { rule_id: string; run_name: string });
    assert.equal(findings.filter((entry) => entry.rule_id === 'validation:schema_error').length, 1);
    assert.ok(
      findings.some(
        (entry) => entry.rule_id === 'missing_process_catalog' && entry.run_name === 'model-b',
      ),
    );

    const summary = readJson<{
      model_count: number;
      finding_count: number;
      validation: { available: boolean; ok: boolean | null; report: string | null };
    }>(report.files.summary);
    assert.equal(summary.model_count, 2);
    assert.equal(summary.finding_count, 11);
    assert.deepEqual(summary.validation, {
      available: true,
      ok: false,
      report: path.join(runRoot, 'reports', 'lifecyclemodel-validate-build-report.json'),
    });

    const zhReview = readFileSync(report.files.review_zh, 'utf8');
    assert.match(zhReview, /模型摘要/u);
    assert.match(zhReview, /当前命令不引入 Python、LangGraph/u);

    const timing = readFileSync(report.files.timing, 'utf8');
    assert.match(timing, /10\.00 min/u);

    const invocationIndex = readJson<{ invocations: Array<{ command: string[]; cwd: string }> }>(
      report.files.invocation_index,
    );
    assert.equal(invocationIndex.invocations.length, 1);
    assert.deepEqual(invocationIndex.invocations[0]?.command, [
      'review',
      'lifecyclemodel',
      '--run-dir',
      runRoot,
      '--out-dir',
      outDir,
      '--logic-version',
      'review-v1',
      '--start-ts',
      '2026-03-30T00:00:00.000Z',
      '--end-ts',
      '2026-03-30T00:10:00.000Z',
    ]);
    assert.equal(invocationIndex.invocations[0]?.cwd, '/tmp/lifecyclemodel-review');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runLifecyclemodelReview supports missing validation reports and consistent single-model bundles', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-review-lifecyclemodel-ok-'));
  const runRoot = path.join(dir, 'lm-run-2');
  const outDir = path.join(dir, 'review');

  writeJson(path.join(runRoot, 'manifests', 'run-manifest.json'), {
    schemaVersion: 1,
    runId: 'lm-run-2',
  });
  const modelFile = path.join(
    runRoot,
    'models',
    'model-ok',
    'tidas_bundle',
    'lifecyclemodels',
    'model-ok.json',
  );
  writeJson(
    modelFile,
    createLifecyclemodelPayload({
      id: 'model-ok-uuid',
      resultingProcessId: 'process-ok-result',
      referenceProcessInternalId: '99',
      processInstances: [createProcessInstance('ok-1', 1)],
    }),
  );
  writeJson(path.join(runRoot, 'models', 'model-ok', 'summary.json'), {
    run_name: 'model-ok',
    model_uuid: 'model-ok-uuid',
    model_version: '01.00.000',
    reference_process_uuid: 'process-ok',
    reference_process_internal_id: '99',
    reference_to_resulting_process_uuid: 'process-ok-result',
    process_count: 1,
    edge_count: 0,
    multiplication_factors: {
      'ok-1': '1',
    },
  });
  writeJson(path.join(runRoot, 'models', 'model-ok', 'connections.json'), []);
  writeJson(path.join(runRoot, 'models', 'model-ok', 'process-catalog.json'), [
    {
      process_uuid: 'process-ok',
    },
  ]);

  try {
    const report = await runLifecyclemodelReview({
      runDir: runRoot,
      outDir,
      now: () => new Date('2026-03-30T00:00:00.000Z'),
    });

    assert.equal(report.finding_count, 0);
    assert.deepEqual(report.validation, {
      available: false,
      ok: null,
      report: null,
    });
    assert.deepEqual(report.next_actions, [
      `inspect: ${path.join(outDir, 'findings.jsonl')}`,
      `run: tiangong lifecyclemodel validate-build --run-dir ${runRoot}`,
      `run: tiangong lifecyclemodel publish-build --run-dir ${runRoot}`,
    ]);
    assert.equal(report.model_summaries[0]?.validation.available, false);
    assert.equal(report.model_summaries[0]?.process_instance_count, 1);
    assert.equal(report.model_summaries[0]?.zero_multiplication_factor_count, 0);
    assert.equal(readJson<{ finding_count: number }>(report.files.summary).finding_count, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runLifecyclemodelReview rejects invalid inputs, missing runs, and malformed timestamps', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-review-lifecyclemodel-errors-'));
  const invalidRunRoot = path.join(dir, 'lm-run-invalid');
  const noModelsRunRoot = path.join(dir, 'lm-run-no-models');
  const badTimestampRunRoot = path.join(dir, 'lm-run-bad-ts');
  const outDir = path.join(dir, 'review');

  writeJson(path.join(invalidRunRoot, 'manifests', 'run-manifest.json'), []);
  writeJson(path.join(noModelsRunRoot, 'manifests', 'run-manifest.json'), {
    schemaVersion: 1,
    runId: 'lm-run-no-models',
  });
  writeJson(path.join(badTimestampRunRoot, 'manifests', 'run-manifest.json'), {
    schemaVersion: 1,
    runId: 'lm-run-bad-ts',
  });
  writeJson(
    path.join(
      badTimestampRunRoot,
      'models',
      'model-one',
      'tidas_bundle',
      'lifecyclemodels',
      'model-one.json',
    ),
    createLifecyclemodelPayload({
      id: 'model-one-uuid',
      resultingProcessId: 'process-one-result',
      processInstances: [createProcessInstance('one-1', 1)],
    }),
  );
  writeJson(path.join(badTimestampRunRoot, 'models', 'model-one', 'summary.json'), {
    run_name: 'model-one',
    model_uuid: 'model-one-uuid',
    model_version: '01.00.000',
    reference_process_uuid: 'process-one',
    process_count: 1,
    edge_count: 0,
    multiplication_factors: {
      'one-1': '1',
    },
  });
  writeJson(path.join(badTimestampRunRoot, 'models', 'model-one', 'connections.json'), []);
  writeJson(path.join(badTimestampRunRoot, 'models', 'model-one', 'process-catalog.json'), [
    {
      process_uuid: 'process-one',
    },
  ]);

  try {
    await assert.rejects(
      async () =>
        runLifecyclemodelReview({
          runDir: '',
          outDir,
        }),
      /Missing required --run-dir/u,
    );

    await assert.rejects(
      async () =>
        runLifecyclemodelReview({
          runDir: path.join(dir, 'missing'),
          outDir,
        }),
      /run root not found/u,
    );

    await assert.rejects(
      async () =>
        runLifecyclemodelReview({
          runDir: invalidRunRoot,
          outDir,
        }),
      /run-manifest artifact JSON object/u,
    );

    await assert.rejects(
      async () =>
        runLifecyclemodelReview({
          runDir: noModelsRunRoot,
          outDir,
        }),
      /does not contain any model bundles/u,
    );

    await assert.rejects(
      async () =>
        runLifecyclemodelReview({
          runDir: badTimestampRunRoot,
          outDir,
          startTs: 'bad-start',
          endTs: 'bad-end',
        }),
      /valid ISO timestamps/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('review lifecyclemodel internals cover invocation index and model discovery edge cases', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-review-lifecyclemodel-internals-'));
  const runRoot = path.join(dir, 'lm-run-internals');
  const outDir = path.join(dir, 'review');
  const layout = __testInternals.buildLayout(runRoot, outDir);

  try {
    assert.throws(
      () =>
        __testInternals.resolveLayout({
          runDir: runRoot,
          outDir: '',
        }),
      /Missing required --out-dir/u,
    );

    writeJson(layout.invocationIndexPath, []);
    assert.throws(
      () => __testInternals.readInvocationIndex(layout),
      /invocation index JSON object/u,
    );

    writeJson(layout.invocationIndexPath, {
      schema_version: 1,
    });
    assert.deepEqual(__testInternals.readInvocationIndex(layout), {
      schema_version: 1,
      invocations: [],
    });

    writeJson(layout.invocationIndexPath, {
      schema_version: 1,
      invocations: {},
    });
    assert.throws(() => __testInternals.readInvocationIndex(layout), /invocations array/u);

    mkdirSync(path.join(layout.modelsDir, 'skip-me'), { recursive: true });
    const keptModelFile = writeLifecyclemodelBundle(
      runRoot,
      'keep-me',
      createLifecyclemodelPayload({
        id: 'keep-me-uuid',
        resultingProcessId: 'keep-result',
        processInstances: [createProcessInstance('keep-1', 1)],
      }),
    );
    const discovered = __testInternals.discoverModelEntries(layout);
    assert.deepEqual(
      discovered.map((entry) => entry.runName),
      ['keep-me'],
    );
    assert.deepEqual(discovered[0]?.modelFiles, [keptModelFile]);

    const emptyRunRoot = path.join(dir, 'lm-run-empty-dir');
    const emptyLayout = __testInternals.buildLayout(emptyRunRoot, path.join(dir, 'review-empty'));
    mkdirSync(path.join(emptyLayout.modelsDir, 'empty-bundle', 'tidas_bundle', 'lifecyclemodels'), {
      recursive: true,
    });
    assert.throws(
      () => __testInternals.discoverModelEntries(emptyLayout),
      /without lifecyclemodel JSON files/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('review lifecyclemodel validation helpers cover invalid report shapes and normalization fallbacks', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-review-lifecyclemodel-validation-'));
  const runRoot = path.join(dir, 'lm-run-validation');
  const outDir = path.join(dir, 'review');
  const layout = __testInternals.buildLayout(runRoot, outDir);

  try {
    writeJson(layout.validationReportPath, {
      ok: 'maybe',
    });
    const missingModelReports = __testInternals.readValidationAggregate(layout);
    assert.equal(missingModelReports.ok, null);
    assert.equal(missingModelReports.reportPath, layout.validationReportPath);
    assert.equal(missingModelReports.modelReports.size, 0);

    writeJson(layout.validationReportPath, {
      ok: 'still-maybe',
      model_reports: [
        {
          run_name: 'model-a',
          report_file: '   ',
          validation: {
            ok: 'still-maybe',
            reports: {},
          },
        },
      ],
    });
    const reportsFallback = __testInternals.readValidationAggregate(layout);
    const modelAFallback = reportsFallback.modelReports.get('model-a');
    assert.equal(reportsFallback.ok, null);
    assert.equal(modelAFallback?.ok, null);
    assert.equal(modelAFallback?.reportFile, null);
    assert.equal(modelAFallback?.engineCount, 0);
    assert.deepEqual(modelAFallback?.issues, []);

    writeJson(layout.validationReportPath, {
      ok: false,
      model_reports: [
        {
          run_name: 'model-b',
          report_file: '',
          validation: {
            ok: false,
            reports: [
              null,
              {
                report: null,
              },
              {
                report: {
                  issues: {},
                },
              },
              {
                report: {
                  issues: [123, { severity: 'weird' }],
                },
              },
            ],
          },
        },
      ],
    });
    const normalized = __testInternals.readValidationAggregate(layout);
    const modelB = normalized.modelReports.get('model-b');
    assert.equal(modelB?.engineCount, 4);
    assert.deepEqual(modelB?.issues, [
      {
        issue_code: 'validation_issue',
        severity: 'error',
        category: 'unknown',
        file_path: '<unknown>',
        message: '123',
        location: '<root>',
        context: {},
      },
      {
        issue_code: 'validation_issue',
        severity: 'error',
        category: 'unknown',
        file_path: '<unknown>',
        message: '{"severity":"weird"}',
        location: '<root>',
        context: {},
      },
    ]);

    writeJson(layout.validationReportPath, {
      ok: true,
      model_reports: {},
    });
    assert.throws(() => __testInternals.readValidationAggregate(layout), /model_reports array/u);

    writeJson(layout.validationReportPath, {
      ok: true,
      model_reports: [123],
    });
    assert.throws(
      () => __testInternals.readValidationAggregate(layout),
      /model report entry JSON object/u,
    );

    writeJson(layout.validationReportPath, {
      ok: true,
      model_reports: [
        {
          run_name: 'model-c',
        },
      ],
    });
    assert.throws(
      () => __testInternals.readValidationAggregate(layout),
      /contain run_name and validation/u,
    );

    const invocationIndex = __testInternals.buildInvocationIndex(
      layout,
      {
        schema_version: 'bad',
        invocations: {},
      },
      {
        runDir: runRoot,
        outDir,
      },
      new Date('2026-03-30T00:00:00.000Z'),
    );
    assert.equal(invocationIndex.schema_version, 1);
    assert.deepEqual(invocationIndex.invocations, [
      {
        command: ['review', 'lifecyclemodel', '--run-dir', runRoot, '--out-dir', outDir],
        cwd: process.cwd(),
        created_at: '2026-03-30T00:00:00.000Z',
        run_id: 'lm-run-validation',
        run_root: runRoot,
        report_path: layout.reportPath,
      },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('review lifecyclemodel model helpers cover direct payload roots, fallbacks, and invalid artifacts', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-review-lifecyclemodel-model-'));

  try {
    const directModelPath = path.join(dir, 'direct-model.json');
    writeJson(directModelPath, {
      lifeCycleModelInformation: {
        quantitativeReference: {
          referenceToReferenceProcess: 'ref-1',
        },
        technology: {
          processes: {
            processInstance: createProcessInstance('proc-1', 'oops'),
          },
        },
      },
      administrativeInformation: {},
    });
    const directInfo = __testInternals.readModelFileReviewInfo(directModelPath);
    assert.equal(directInfo.modelUuid, 'direct-model.json');
    assert.equal(directInfo.modelVersion, 'unknown');
    assert.equal(directInfo.referenceProcessInternalId, 'ref-1');
    assert.equal(directInfo.resultingProcessUuid, null);
    assert.equal(directInfo.processInstanceCount, 1);
    assert.equal(directInfo.zeroMultiplicationFactorCount, 0);

    const missingProcessesPath = path.join(dir, 'no-processes.json');
    writeJson(missingProcessesPath, {
      lifeCycleModelInformation: {
        quantitativeReference: {},
      },
    });
    const missingProcessesInfo = __testInternals.readModelFileReviewInfo(missingProcessesPath);
    assert.equal(missingProcessesInfo.processInstanceCount, 0);
    assert.equal(missingProcessesInfo.zeroMultiplicationFactorCount, 0);

    const invalidModelPath = path.join(dir, 'invalid-model.json');
    writeJson(invalidModelPath, []);
    assert.throws(
      () => __testInternals.readModelFileReviewInfo(invalidModelPath),
      /payload JSON object/u,
    );

    const emptyModelFilesReview = __testInternals.buildModelReview(
      {
        runName: 'missing-artifacts',
        modelFiles: [],
        summaryPath: path.join(dir, 'missing-artifacts', 'summary.json'),
        connectionsPath: path.join(dir, 'missing-artifacts', 'connections.json'),
        processCatalogPath: path.join(dir, 'missing-artifacts', 'process-catalog.json'),
      },
      {
        ok: null,
        reportPath: null,
        modelReports: new Map(),
      },
    );
    assert.ok(
      emptyModelFilesReview.findings.some(
        (finding) => finding.rule_id === 'missing_model_summary' && finding.model_file === null,
      ),
    );
    assert.ok(
      emptyModelFilesReview.findings.some(
        (finding) =>
          finding.rule_id === 'missing_connections_artifact' && finding.model_file === null,
      ),
    );
    assert.ok(
      emptyModelFilesReview.findings.some(
        (finding) => finding.rule_id === 'missing_process_catalog' && finding.model_file === null,
      ),
    );
    assert.ok(
      emptyModelFilesReview.findings.some(
        (finding) =>
          finding.rule_id === 'missing_reference_process_uuid' && finding.model_file === null,
      ),
    );
    assert.ok(
      emptyModelFilesReview.findings.some(
        (finding) =>
          finding.rule_id === 'missing_resulting_process_ref' && finding.model_file === null,
      ),
    );
    assert.ok(
      emptyModelFilesReview.findings.some(
        (finding) => finding.rule_id === 'empty_process_instances' && finding.model_file === null,
      ),
    );

    const mismatchEntry = {
      runName: 'mismatch-artifacts',
      modelFiles: [],
      summaryPath: path.join(dir, 'mismatch-artifacts', 'summary.json'),
      connectionsPath: path.join(dir, 'mismatch-artifacts', 'connections.json'),
      processCatalogPath: path.join(dir, 'mismatch-artifacts', 'process-catalog.json'),
    };
    writeJson(mismatchEntry.summaryPath, {
      process_count: 2,
      edge_count: 3,
      multiplication_factors: {
        only: '1',
      },
    });
    writeJson(mismatchEntry.connectionsPath, [{ src: 'a', dst: 'b' }]);
    writeJson(mismatchEntry.processCatalogPath, [{ process_uuid: 'a' }]);
    const mismatchedReview = __testInternals.buildModelReview(mismatchEntry, {
      ok: null,
      reportPath: null,
      modelReports: new Map(),
    });
    assert.ok(
      mismatchedReview.findings.some(
        (finding) => finding.rule_id === 'process_count_mismatch' && finding.model_file === null,
      ),
    );
    assert.ok(
      mismatchedReview.findings.some(
        (finding) => finding.rule_id === 'edge_count_mismatch' && finding.model_file === null,
      ),
    );
    assert.ok(
      mismatchedReview.findings.some(
        (finding) =>
          finding.rule_id === 'process_catalog_count_mismatch' && finding.model_file === null,
      ),
    );
    assert.ok(
      mismatchedReview.findings.some(
        (finding) =>
          finding.rule_id === 'multiplication_factor_count_mismatch' && finding.model_file === null,
      ),
    );

    const invalidArtifactsDir = path.join(dir, 'invalid-artifacts');
    const validModelFile = path.join(invalidArtifactsDir, 'model.json');
    writeJson(
      validModelFile,
      createLifecyclemodelPayload({
        id: 'valid-model-uuid',
        processInstances: [createProcessInstance('valid-1', 1)],
      }),
    );
    const invalidArtifactsEntry = {
      runName: 'invalid-artifacts',
      modelFiles: [validModelFile],
      summaryPath: path.join(invalidArtifactsDir, 'summary.json'),
      connectionsPath: path.join(invalidArtifactsDir, 'connections.json'),
      processCatalogPath: path.join(invalidArtifactsDir, 'process-catalog.json'),
    };

    writeJson(invalidArtifactsEntry.summaryPath, []);
    assert.throws(
      () =>
        __testInternals.buildModelReview(invalidArtifactsEntry, {
          ok: null,
          reportPath: null,
          modelReports: new Map(),
        }),
      /summary artifact JSON object/u,
    );

    writeJson(invalidArtifactsEntry.summaryPath, {});
    writeJson(invalidArtifactsEntry.connectionsPath, {});
    assert.throws(
      () =>
        __testInternals.buildModelReview(invalidArtifactsEntry, {
          ok: null,
          reportPath: null,
          modelReports: new Map(),
        }),
      /connections artifact JSON array/u,
    );

    writeJson(invalidArtifactsEntry.connectionsPath, []);
    writeJson(invalidArtifactsEntry.processCatalogPath, {});
    assert.throws(
      () =>
        __testInternals.buildModelReview(invalidArtifactsEntry, {
          ok: null,
          reportPath: null,
          modelReports: new Map(),
        }),
      /process-catalog artifact JSON array/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runLifecyclemodelReview rejects missing run manifests and mismatched run ids', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-review-lifecyclemodel-manifest-'));
  const missingManifestRunRoot = path.join(dir, 'lm-run-missing-manifest');
  const mismatchRunRoot = path.join(dir, 'lm-run-mismatch');
  const outDir = path.join(dir, 'review');

  mkdirSync(missingManifestRunRoot, { recursive: true });
  writeMinimalRunManifest(mismatchRunRoot, 'some-other-run-id');

  try {
    await assert.rejects(
      async () =>
        runLifecyclemodelReview({
          runDir: missingManifestRunRoot,
          outDir,
        }),
      /run-manifest artifact not found/u,
    );

    await assert.rejects(
      async () =>
        runLifecyclemodelReview({
          runDir: mismatchRunRoot,
          outDir,
        }),
      /run manifest runId mismatch/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
