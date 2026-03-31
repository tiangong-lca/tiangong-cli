import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError } from '../src/lib/errors.js';
import { runFlowValidateProcesses } from '../src/lib/flow-regen-product.js';

type JsonRecord = Record<string, unknown>;

function lang(text: string, langCode = 'en'): JsonRecord {
  return {
    '@xml:lang': langCode,
    '#text': text,
  };
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeJsonl(filePath: string, rows: unknown[]): void {
  writeFileSync(
    filePath,
    `${rows.map((row) => JSON.stringify(row)).join('\n')}${rows.length ? '\n' : ''}`,
    'utf8',
  );
}

function makeFlowRow(options: { id: string; version?: string; name?: string }): JsonRecord {
  const version = options.version ?? '01.00.000';
  const name = options.name ?? options.id;
  return {
    id: options.id,
    version,
    json_ordered: {
      flowDataSet: {
        flowInformation: {
          dataSetInformation: {
            'common:UUID': options.id,
            name: {
              baseName: [lang(name)],
            },
            'common:shortDescription': [lang(`${name} short`)],
          },
        },
        administrativeInformation: {
          publicationAndOwnership: {
            'common:dataSetVersion': version,
          },
        },
      },
    },
  };
}

function makeExchange(options: {
  internalId?: string;
  flowId?: string;
  flowVersion?: string;
}): JsonRecord {
  return {
    '@dataSetInternalID': options.internalId ?? '1',
    exchangeDirection: 'Output',
    referenceToFlowDataSet: {
      '@type': 'flow data set',
      '@refObjectId': options.flowId ?? '',
      '@version': options.flowVersion ?? '',
      '@uri': '../flows/example.xml',
      'common:shortDescription': [lang('Flow text')],
    },
  };
}

function makeProcessRow(options: {
  id: string;
  version?: string;
  name?: string;
  qref?: string;
  exchanges?: JsonRecord[];
}): JsonRecord {
  const version = options.version ?? '01.00.000';
  const exchanges = options.exchanges ?? [makeExchange({ flowId: 'flow-1', flowVersion: version })];
  return {
    id: options.id,
    version,
    json_ordered: {
      processDataSet: {
        processInformation: {
          dataSetInformation: {
            'common:UUID': options.id,
            name: {
              baseName: [lang(options.name ?? options.id)],
            },
          },
          quantitativeReference: {
            referenceToReferenceFlow:
              options.qref ?? String(exchanges[0]?.['@dataSetInternalID'] ?? '1'),
            functionalUnitOrOther: [],
          },
        },
        administrativeInformation: {
          publicationAndOwnership: {
            'common:dataSetVersion': version,
          },
        },
        exchanges: {
          exchange: exchanges,
        },
      },
    },
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test('runFlowValidateProcesses writes validation artifacts and can use injected sdk validation in auto mode', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-validate-processes-ok-'));
  const originalProcessesFile = path.join(dir, 'original-processes.jsonl');
  const patchedProcessesFile = path.join(dir, 'patched-processes.jsonl');
  const scopeFlowFile = path.join(dir, 'scope-flows.jsonl');
  const outDir = path.join(dir, 'validate');

  const originalRow = makeProcessRow({ id: 'proc-1' });
  const patchedRow = clone(originalRow);

  writeJsonl(originalProcessesFile, [originalRow]);
  writeJsonl(patchedProcessesFile, [patchedRow]);
  writeJsonl(scopeFlowFile, [makeFlowRow({ id: 'flow-1' })]);

  try {
    const report = await runFlowValidateProcesses(
      {
        originalProcessesFile,
        patchedProcessesFile,
        scopeFlowFiles: [scopeFlowFile],
        outDir,
      },
      {
        now: () => new Date('2026-03-30T18:00:00.000Z'),
        loadSdkModule: () => ({
          createProcess: () => ({
            validateEnhanced: () => ({ success: true }),
          }),
        }),
      },
    );

    assert.equal(report.status, 'completed_local_flow_validate_processes');
    assert.equal(report.generated_at_utc, '2026-03-30T18:00:00.000Z');
    assert.equal(report.tidas_mode, 'auto');
    assert.deepEqual(report.summary, {
      patched_process_count: 1,
      passed: 1,
      failed: 0,
      tidas_validation: true,
    });
    assert.equal(report.results.length, 1);
    assert.equal(report.results[0]?.ok, true);
    assert.equal(existsSync(report.files.report), true);
    assert.equal(existsSync(report.files.failures), true);

    const persistedReport = JSON.parse(readFileSync(report.files.report, 'utf8')) as JsonRecord;
    assert.deepEqual(persistedReport.summary, report.summary);
    assert.deepEqual((persistedReport.results as unknown[]).length, 1);
    assert.equal(readFileSync(report.files.failures, 'utf8'), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runFlowValidateProcesses reports patched process failures and honors explicit skip mode', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-validate-processes-failed-'));
  const originalProcessesFile = path.join(dir, 'original-processes.json');
  const patchedProcessesFile = path.join(dir, 'patched-processes.json');
  const scopeFlowFile = path.join(dir, 'scope-flows.json');
  const outDir = path.join(dir, 'validate');

  const originalRow = makeProcessRow({ id: 'proc-2', version: '01.00.000', qref: '1' });
  const patchedRow = clone(originalRow);
  (
    (
      ((patchedRow.json_ordered as JsonRecord).processDataSet as JsonRecord)
        .processInformation as JsonRecord
    ).quantitativeReference as JsonRecord
  ).referenceToReferenceFlow = '999';
  (
    (
      (
        ((patchedRow.json_ordered as JsonRecord).processDataSet as JsonRecord)
          .exchanges as JsonRecord
      ).exchange as JsonRecord[]
    )[0]?.referenceToFlowDataSet as JsonRecord
  )['@version'] = '';

  writeJson(originalProcessesFile, [originalRow]);
  writeJson(patchedProcessesFile, [patchedRow]);
  writeJson(scopeFlowFile, [makeFlowRow({ id: 'flow-1', version: '01.00.000' })]);

  try {
    const report = await runFlowValidateProcesses({
      originalProcessesFile,
      patchedProcessesFile,
      scopeFlowFiles: [scopeFlowFile],
      outDir,
      tidasMode: 'skip',
    });

    assert.equal(report.tidas_mode, 'skip');
    assert.deepEqual(report.summary, {
      patched_process_count: 1,
      passed: 0,
      failed: 1,
      tidas_validation: false,
    });
    assert.equal(report.results[0]?.ok, false);
    assert.deepEqual(
      report.results[0]?.issues.map((issue) => issue.type),
      [
        'non_reference_changes_detected',
        'quantitative_reference_changed',
        'missing_flow_reference_after_patch',
      ],
    );

    const persistedFailures = readFileSync(report.files.failures, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as JsonRecord);
    assert.equal(persistedFailures.length, 1);
    assert.equal(
      (persistedFailures[0]?.issues as JsonRecord[]).some(
        (issue) => issue.type === 'quantitative_reference_changed',
      ) as boolean,
      true,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runFlowValidateProcesses rejects missing scope flow inputs', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-validate-processes-missing-scope-'));
  const originalProcessesFile = path.join(dir, 'original-processes.jsonl');
  const patchedProcessesFile = path.join(dir, 'patched-processes.jsonl');

  writeJsonl(originalProcessesFile, []);
  writeJsonl(patchedProcessesFile, []);

  try {
    await assert.rejects(
      () =>
        runFlowValidateProcesses({
          originalProcessesFile,
          patchedProcessesFile,
          scopeFlowFiles: undefined as unknown as string[],
          outDir: path.join(dir, 'validate'),
        }),
      (error: unknown) =>
        error instanceof CliError &&
        error.code === 'FLOW_VALIDATE_PROCESSES_SCOPE_FLOW_FILES_REQUIRED',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
