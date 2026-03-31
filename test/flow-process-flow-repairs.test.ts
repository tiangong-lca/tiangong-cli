import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  runFlowApplyProcessFlowRepairs,
  runFlowPlanProcessFlowRepairs,
  runFlowScanProcessFlowRefs,
} from '../src/lib/flow-regen-product.js';
import { CliError } from '../src/lib/errors.js';

type JsonRecord = Record<string, unknown>;

function lang(text: string, langCode = 'en'): JsonRecord {
  return {
    '@xml:lang': langCode,
    '#text': text,
  };
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeJsonl(filePath: string, rows: unknown[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    `${rows.map((row) => JSON.stringify(row)).join('\n')}${rows.length ? '\n' : ''}`,
    'utf8',
  );
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
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
  flowText?: string;
}): JsonRecord {
  return {
    '@dataSetInternalID': options.internalId ?? '1',
    exchangeDirection: 'Output',
    referenceToFlowDataSet: {
      '@type': 'flow data set',
      '@refObjectId': options.flowId ?? '',
      '@version': options.flowVersion ?? '',
      '@uri': '../flows/example.xml',
      'common:shortDescription': [lang(options.flowText ?? 'Flow text')],
    },
  };
}

function makeProcessRow(options: {
  id: string;
  version?: string;
  name?: string;
  exchanges?: JsonRecord[];
  functionalUnit?: unknown;
}): JsonRecord {
  const version = options.version ?? '01.00.000';
  const exchanges = options.exchanges ?? [
    makeExchange({ flowId: 'flow-1', flowVersion: version, flowText: 'Scope Flow' }),
  ];

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
            referenceToReferenceFlow: String(exchanges[0]?.['@dataSetInternalID'] ?? '1'),
            functionalUnitOrOther: options.functionalUnit ?? [],
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

test('runFlowScanProcessFlowRefs writes scan artifacts with explicit catalog and alias-map inputs', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-scan-process-refs-explicit-'));
  const processesFile = path.join(dir, 'processes.jsonl');
  const scopeFlowFile = path.join(dir, 'scope-flows.jsonl');
  const catalogFlowFile = path.join(dir, 'catalog-flows.jsonl');
  const aliasMapFile = path.join(dir, 'alias-map.json');
  const outDir = path.join(dir, 'scan');

  const validProcess = makeProcessRow({
    id: 'proc-valid',
    name: 'Valid process',
  });
  const emergyProcess = makeProcessRow({
    id: 'proc-emergy',
    name: 'Emergy process',
    functionalUnit: [lang('Solar emergy basis')],
  });

  writeJsonl(processesFile, [validProcess, emergyProcess]);
  writeJsonl(scopeFlowFile, [makeFlowRow({ id: 'flow-1', name: 'Scope Flow' })]);
  writeJsonl(catalogFlowFile, [makeFlowRow({ id: 'flow-1', name: 'Scope Flow' })]);
  writeJson(aliasMapFile, {});

  try {
    const report = await runFlowScanProcessFlowRefs(
      {
        processesFile,
        scopeFlowFiles: [scopeFlowFile],
        catalogFlowFiles: [catalogFlowFile],
        aliasMapFile,
        excludeEmergy: true,
        outDir,
      },
      {
        now: () => new Date('2026-03-30T20:00:00.000Z'),
      },
    );

    assert.equal(report.status, 'completed_local_flow_scan_process_flow_refs');
    assert.equal(report.generated_at_utc, '2026-03-30T20:00:00.000Z');
    assert.deepEqual(report.scope_flow_files, [scopeFlowFile]);
    assert.deepEqual(report.catalog_flow_files, [catalogFlowFile]);
    assert.equal(report.alias_map_file, aliasMapFile);
    assert.equal(report.exclude_emergy, true);
    assert.deepEqual(report.summary, {
      process_count_before_emergy_exclusion: 2,
      process_count: 1,
      emergy_excluded_process_count: 1,
      exchange_count: 1,
      issue_counts: {
        exists_in_target: 1,
      },
      processes_with_issues: 0,
    });
    assert.equal(existsSync(report.files.summary), true);
    assert.equal(existsSync(report.files.findings_jsonl), true);
    assert.deepEqual(readJson(report.files.summary), report.summary);
    assert.deepEqual(readJson(report.files.emergy_excluded_processes), [
      {
        entity_type: 'process',
        process_id: 'proc-emergy',
        process_version: '01.00.000',
        process_name: 'Emergy process',
        reference_flow_id: 'flow-1',
        reference_flow_version: '01.00.000',
        reference_exchange_internal_id: '1',
        excluded: true,
        reason: 'reference_flow_name_mentions_emergy',
        signals: ['process_ref_text:Solar emergy basis'],
      },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runFlowScanProcessFlowRefs defaults catalog inputs to the scope files when omitted', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-scan-process-refs-default-'));
  const processesFile = path.join(dir, 'processes.json');
  const scopeFlowFile = path.join(dir, 'scope-flows.json');
  const outDir = path.join(dir, 'scan');

  writeJson(processesFile, [makeProcessRow({ id: 'proc-default' })]);
  writeJson(scopeFlowFile, [makeFlowRow({ id: 'flow-1', name: 'Scope Flow' })]);

  try {
    const report = await runFlowScanProcessFlowRefs({
      processesFile,
      scopeFlowFiles: [scopeFlowFile],
      outDir,
    });

    assert.equal(report.alias_map_file, null);
    assert.deepEqual(report.catalog_flow_files, [scopeFlowFile]);
    assert.equal(report.summary.process_count, 1);
    assert.equal(report.summary.issue_counts.exists_in_target, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runFlowPlanProcessFlowRepairs writes repair plans from alias maps and optional scan findings', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-plan-process-repairs-'));
  const processesFile = path.join(dir, 'processes.jsonl');
  const scopeFlowFile = path.join(dir, 'scope-flows.jsonl');
  const aliasMapFile = path.join(dir, 'alias-map.json');
  const scanFindingsFile = path.join(dir, 'scan-findings.json');
  const outDir = path.join(dir, 'repair-plan');

  writeJsonl(processesFile, [
    makeProcessRow({
      id: 'proc-plan',
      exchanges: [
        makeExchange({
          internalId: '1',
          flowId: 'old-flow',
          flowVersion: '01.00.000',
          flowText: 'Target Flow',
        }),
      ],
    }),
  ]);
  writeJsonl(scopeFlowFile, [makeFlowRow({ id: 'new-flow', name: 'Target Flow' })]);
  writeJson(aliasMapFile, {
    'old-flow@01.00.000': {
      id: 'new-flow',
      version: '01.00.000',
    },
  });
  writeJson(scanFindingsFile, [
    {
      process_id: 'proc-plan',
      process_version: '01.00.000',
      exchange_internal_id: '1',
      issue_type: 'missing_uuid',
    },
  ]);

  try {
    const report = await runFlowPlanProcessFlowRepairs(
      {
        processesFile,
        scopeFlowFiles: [scopeFlowFile],
        aliasMapFile,
        scanFindingsFile,
        autoPatchPolicy: 'alias-only',
        outDir,
      },
      {
        now: () => new Date('2026-03-30T20:30:00.000Z'),
      },
    );

    assert.equal(report.status, 'completed_local_flow_plan_process_flow_repairs');
    assert.equal(report.generated_at_utc, '2026-03-30T20:30:00.000Z');
    assert.equal(report.alias_map_file, aliasMapFile);
    assert.equal(report.scan_findings_file, scanFindingsFile);
    assert.deepEqual(report.summary, {
      auto_patch_policy: 'alias-only',
      process_count: 1,
      repair_item_count: 1,
      decision_counts: {
        auto_patch: 1,
      },
      patched_process_count: 0,
    });

    const repairPlan = readJson(report.files.plan) as JsonRecord[];
    assert.equal(repairPlan.length, 1);
    assert.equal(repairPlan[0]?.decision, 'auto_patch');
    assert.equal(repairPlan[0]?.current_issue_type, 'missing_uuid');
    assert.equal(repairPlan[0]?.target_flow_id, 'new-flow');
    assert.equal(existsSync(report.files.manual_review_queue), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runFlowPlanProcessFlowRepairs defaults alias-map and scan-findings inputs when omitted', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-plan-process-repairs-defaults-'));
  const processesFile = path.join(dir, 'processes.json');
  const scopeFlowFile = path.join(dir, 'scope-flows.json');
  const outDir = path.join(dir, 'repair-plan');

  writeJson(processesFile, [
    makeProcessRow({
      id: 'proc-plan-default',
      exchanges: [
        makeExchange({
          internalId: '1',
          flowId: 'scope-flow',
          flowVersion: '01.00.000',
          flowText: 'Scope Flow',
        }),
      ],
    }),
  ]);
  writeJson(scopeFlowFile, [makeFlowRow({ id: 'scope-flow', name: 'Scope Flow' })]);

  try {
    const report = await runFlowPlanProcessFlowRepairs({
      processesFile,
      scopeFlowFiles: [scopeFlowFile],
      outDir,
    });

    assert.equal(report.alias_map_file, null);
    assert.equal(report.scan_findings_file, null);
    assert.deepEqual(report.summary, {
      auto_patch_policy: 'alias-only',
      process_count: 1,
      repair_item_count: 1,
      decision_counts: {
        keep_as_is: 1,
      },
      patched_process_count: 0,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runFlowApplyProcessFlowRepairs supports no-op and patched apply runs without scan-findings input', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-apply-process-repairs-'));
  const scopeFlowFile = path.join(dir, 'scope-flows.jsonl');
  const aliasMapFile = path.join(dir, 'alias-map.json');
  const processPoolFile = path.join(dir, 'process-pool.jsonl');

  writeJsonl(scopeFlowFile, [makeFlowRow({ id: 'scope-flow', name: 'Scope Flow' })]);
  writeJson(aliasMapFile, {
    'old-flow@01.00.000': {
      id: 'scope-flow',
      version: '01.00.000',
    },
  });

  const noopProcessesFile = path.join(dir, 'noop-processes.json');
  writeJson(noopProcessesFile, [
    makeProcessRow({
      id: 'proc-noop',
      exchanges: [
        makeExchange({
          internalId: '1',
          flowId: 'scope-flow',
          flowVersion: '01.00.000',
          flowText: 'Scope Flow',
        }),
      ],
    }),
  ]);

  const patchProcessesFile = path.join(dir, 'patch-processes.jsonl');
  writeJsonl(patchProcessesFile, [
    makeProcessRow({
      id: 'proc-patch',
      exchanges: [
        makeExchange({
          internalId: '1',
          flowId: 'old-flow',
          flowVersion: '01.00.000',
          flowText: 'Scope Flow',
        }),
      ],
    }),
  ]);
  writeJsonl(processPoolFile, []);

  try {
    const noopReport = await runFlowApplyProcessFlowRepairs({
      processesFile: noopProcessesFile,
      scopeFlowFiles: [scopeFlowFile],
      outDir: path.join(dir, 'repair-apply-noop'),
    });

    assert.equal(noopReport.process_pool_file, null);
    assert.equal(noopReport.summary.patched_process_count, 0);
    assert.equal(noopReport.summary.decision_counts.keep_as_is, 1);
    assert.deepEqual(readJson(noopReport.files.patched_processes), []);

    const patchedReport = await runFlowApplyProcessFlowRepairs(
      {
        processesFile: patchProcessesFile,
        scopeFlowFiles: [scopeFlowFile],
        aliasMapFile,
        processPoolFile,
        outDir: path.join(dir, 'repair-apply-patched'),
      },
      {
        now: () => new Date('2026-03-30T21:00:00.000Z'),
      },
    );

    assert.equal(patchedReport.status, 'completed_local_flow_apply_process_flow_repairs');
    assert.equal(patchedReport.generated_at_utc, '2026-03-30T21:00:00.000Z');
    assert.equal(patchedReport.process_pool_file, processPoolFile);
    assert.equal(patchedReport.scan_findings_file, null);
    assert.equal(patchedReport.summary.auto_patch_policy, 'alias-only');
    assert.equal(patchedReport.summary.patched_process_count, 1);
    assert.equal(
      (patchedReport.summary.process_pool_sync as JsonRecord | undefined)?.pool_post_count,
      1,
    );
    assert.equal(existsSync(patchedReport.files.patched_processes), true);
    assert.equal(
      existsSync(path.join(patchedReport.files.patch_root, 'proc-patch__01.00.000', 'diff.patch')),
      true,
    );

    const patchedRows = readJson(patchedReport.files.patched_processes) as JsonRecord[];
    const patchedRef = ((
      (
        (((patchedRows[0]?.json_ordered as JsonRecord).processDataSet as JsonRecord).exchanges ??
          {}) as JsonRecord
      ).exchange as JsonRecord[]
    )[0]?.referenceToFlowDataSet ?? {}) as JsonRecord;
    assert.equal(patchedRef['@refObjectId'], 'scope-flow');
    assert.equal(patchedRef['@version'], '01.00.000');

    const syncedPool = readFileSync(processPoolFile, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as JsonRecord);
    assert.equal(syncedPool.length, 1);
    assert.equal(syncedPool[0]?.id, 'proc-patch');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('flow scan/plan/apply process-flow repair runners reject missing scope flow inputs', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-process-repairs-missing-scope-'));
  const processesFile = path.join(dir, 'processes.jsonl');

  writeJsonl(processesFile, []);

  try {
    await assert.rejects(
      () =>
        runFlowScanProcessFlowRefs({
          processesFile,
          scopeFlowFiles: undefined as unknown as string[],
          outDir: path.join(dir, 'scan'),
        }),
      (error) =>
        error instanceof CliError &&
        error.code === 'FLOW_SCAN_PROCESS_FLOW_REFS_SCOPE_FLOW_FILES_REQUIRED',
    );

    await assert.rejects(
      () =>
        runFlowPlanProcessFlowRepairs({
          processesFile,
          scopeFlowFiles: undefined as unknown as string[],
          outDir: path.join(dir, 'repair-plan'),
        }),
      (error) =>
        error instanceof CliError &&
        error.code === 'FLOW_PLAN_PROCESS_FLOW_REPAIRS_SCOPE_FLOW_FILES_REQUIRED',
    );

    await assert.rejects(
      () =>
        runFlowApplyProcessFlowRepairs({
          processesFile,
          scopeFlowFiles: undefined as unknown as string[],
          outDir: path.join(dir, 'repair-apply'),
        }),
      (error) =>
        error instanceof CliError &&
        error.code === 'FLOW_APPLY_PROCESS_FLOW_REPAIRS_SCOPE_FLOW_FILES_REQUIRED',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
