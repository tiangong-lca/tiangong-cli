import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeCli } from '../src/cli.js';
import type { DotEnvLoadResult } from '../src/lib/dotenv.js';
import type { FetchLike } from '../src/lib/http.js';
import type {
  RunFlowApplyProcessFlowRepairsOptions,
  RunFlowPlanProcessFlowRepairsOptions,
  RunFlowScanProcessFlowRefsOptions,
} from '../src/lib/flow-regen-product.js';

const dotEnvStatus: DotEnvLoadResult = {
  loaded: false,
  path: '/tmp/.env',
  count: 0,
};

const makeDeps = () => ({
  env: {
    TIANGONG_LCA_API_BASE_URL: 'https://example.com/functions/v1',
    TIANGONG_LCA_API_KEY: 'secret-token',
    TIANGONG_LCA_REGION: 'us-east-1',
  } as NodeJS.ProcessEnv,
  dotEnvStatus,
  fetchImpl: (async () => ({
    ok: true,
    status: 200,
    headers: {
      get: () => 'application/json',
    },
    text: async () => JSON.stringify({ ok: true }),
  })) as FetchLike,
});

test('executeCli returns help for the flow process-ref scan and repair subcommands', async () => {
  const flowHelp = await executeCli(['flow', '--help'], makeDeps());
  assert.equal(flowHelp.exitCode, 0);
  assert.match(flowHelp.stdout, /scan-process-flow-refs/u);
  assert.match(flowHelp.stdout, /plan-process-flow-repairs/u);
  assert.match(flowHelp.stdout, /apply-process-flow-repairs/u);

  const scanHelp = await executeCli(['flow', 'scan-process-flow-refs', '--help'], makeDeps());
  assert.equal(scanHelp.exitCode, 0);
  assert.match(
    scanHelp.stdout,
    /tiangong flow scan-process-flow-refs --processes-file <file> --scope-flow-file <file> --out-dir <dir>/u,
  );
  assert.match(scanHelp.stdout, /--catalog-flow-file/u);

  const planHelp = await executeCli(['flow', 'plan-process-flow-repairs', '--help'], makeDeps());
  assert.equal(planHelp.exitCode, 0);
  assert.match(
    planHelp.stdout,
    /tiangong flow plan-process-flow-repairs --processes-file <file> --scope-flow-file <file> --out-dir <dir>/u,
  );
  assert.match(planHelp.stdout, /--scan-findings/u);

  const applyHelp = await executeCli(['flow', 'apply-process-flow-repairs', '--help'], makeDeps());
  assert.equal(applyHelp.exitCode, 0);
  assert.match(
    applyHelp.stdout,
    /tiangong flow apply-process-flow-repairs --processes-file <file> --scope-flow-file <file> --out-dir <dir>/u,
  );
  assert.match(applyHelp.stdout, /--process-pool-file/u);
});

test('executeCli dispatches flow scan-process-flow-refs to the implemented CLI module', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-scan-process-refs-dispatch-'));
  const processesFile = path.join(dir, 'processes.jsonl');
  const scopeFlowFile = path.join(dir, 'scope-flows.jsonl');
  const catalogFlowFile = path.join(dir, 'catalog-flows.jsonl');
  const aliasMapFile = path.join(dir, 'alias-map.json');

  writeFileSync(processesFile, '[]\n', 'utf8');
  writeFileSync(scopeFlowFile, '[]\n', 'utf8');
  writeFileSync(catalogFlowFile, '[]\n', 'utf8');
  writeFileSync(aliasMapFile, '{}\n', 'utf8');

  try {
    let observedOptions: RunFlowScanProcessFlowRefsOptions | undefined;
    const result = await executeCli(
      [
        'flow',
        'scan-process-flow-refs',
        '--processes-file',
        processesFile,
        '--scope-flow-file',
        scopeFlowFile,
        '--catalog-flow-file',
        catalogFlowFile,
        '--alias-map',
        aliasMapFile,
        '--exclude-emergy',
        '--out-dir',
        path.join(dir, 'scan'),
        '--json',
      ],
      {
        ...makeDeps(),
        runFlowScanProcessFlowRefsImpl: async (options) => {
          observedOptions = options;
          return {
            schema_version: 1,
            generated_at_utc: '2026-03-30T22:00:00.000Z',
            status: 'completed_local_flow_scan_process_flow_refs',
            processes_file: processesFile,
            scope_flow_files: [scopeFlowFile],
            catalog_flow_files: [catalogFlowFile],
            alias_map_file: aliasMapFile,
            exclude_emergy: true,
            out_dir: path.join(dir, 'scan'),
            summary: {
              process_count_before_emergy_exclusion: 2,
              process_count: 1,
              emergy_excluded_process_count: 1,
              exchange_count: 1,
              issue_counts: { exists_in_target: 1 },
              processes_with_issues: 0,
            },
            files: {
              out_dir: path.join(dir, 'scan'),
              emergy_excluded_processes: path.join(dir, 'scan', 'emergy-excluded-processes.json'),
              summary: path.join(dir, 'scan', 'scan-summary.json'),
              findings: path.join(dir, 'scan', 'scan-findings.json'),
              findings_jsonl: path.join(dir, 'scan', 'scan-findings.jsonl'),
            },
          };
        },
      },
    );

    assert.equal(result.exitCode, 0);
    assert.equal(JSON.parse(result.stdout).status, 'completed_local_flow_scan_process_flow_refs');
    assert.deepEqual(observedOptions, {
      processesFile,
      scopeFlowFiles: [scopeFlowFile],
      catalogFlowFiles: [catalogFlowFile],
      aliasMapFile,
      excludeEmergy: true,
      outDir: path.join(dir, 'scan'),
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli dispatches flow plan-process-flow-repairs to the implemented CLI module', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-plan-process-repairs-dispatch-'));
  const processesFile = path.join(dir, 'processes.jsonl');
  const scopeFlowFile = path.join(dir, 'scope-flows.jsonl');
  const aliasMapFile = path.join(dir, 'alias-map.json');
  const scanFindingsFile = path.join(dir, 'scan-findings.json');

  writeFileSync(processesFile, '[]\n', 'utf8');
  writeFileSync(scopeFlowFile, '[]\n', 'utf8');
  writeFileSync(aliasMapFile, '{}\n', 'utf8');
  writeFileSync(scanFindingsFile, '[]\n', 'utf8');

  try {
    let observedOptions: RunFlowPlanProcessFlowRepairsOptions | undefined;
    const result = await executeCli(
      [
        'flow',
        'plan-process-flow-repairs',
        '--processes-file',
        processesFile,
        '--scope-flow-file',
        scopeFlowFile,
        '--alias-map',
        aliasMapFile,
        '--scan-findings',
        scanFindingsFile,
        '--auto-patch-policy',
        'alias-or-unique-name',
        '--out-dir',
        path.join(dir, 'repair-plan'),
        '--json',
      ],
      {
        ...makeDeps(),
        runFlowPlanProcessFlowRepairsImpl: async (options) => {
          observedOptions = options;
          return {
            schema_version: 1,
            generated_at_utc: '2026-03-30T22:10:00.000Z',
            status: 'completed_local_flow_plan_process_flow_repairs',
            processes_file: processesFile,
            scope_flow_files: [scopeFlowFile],
            alias_map_file: aliasMapFile,
            scan_findings_file: scanFindingsFile,
            auto_patch_policy: 'alias-or-unique-name',
            out_dir: path.join(dir, 'repair-plan'),
            summary: {
              auto_patch_policy: 'alias-or-unique-name',
              process_count: 1,
              repair_item_count: 1,
              decision_counts: { auto_patch: 1 },
              patched_process_count: 0,
            },
            files: {
              out_dir: path.join(dir, 'repair-plan'),
              plan: path.join(dir, 'repair-plan', 'repair-plan.json'),
              plan_jsonl: path.join(dir, 'repair-plan', 'repair-plan.jsonl'),
              manual_review_queue: path.join(dir, 'repair-plan', 'manual-review-queue.jsonl'),
              summary: path.join(dir, 'repair-plan', 'repair-summary.json'),
            },
          };
        },
      },
    );

    assert.equal(result.exitCode, 0);
    assert.equal(
      JSON.parse(result.stdout).status,
      'completed_local_flow_plan_process_flow_repairs',
    );
    assert.deepEqual(observedOptions, {
      processesFile,
      scopeFlowFiles: [scopeFlowFile],
      aliasMapFile,
      scanFindingsFile,
      autoPatchPolicy: 'alias-or-unique-name',
      outDir: path.join(dir, 'repair-plan'),
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli dispatches flow apply-process-flow-repairs to the implemented CLI module', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-apply-process-repairs-dispatch-'));
  const processesFile = path.join(dir, 'processes.jsonl');
  const scopeFlowFile = path.join(dir, 'scope-flows.jsonl');
  const aliasMapFile = path.join(dir, 'alias-map.json');
  const scanFindingsFile = path.join(dir, 'scan-findings.json');
  const processPoolFile = path.join(dir, 'process-pool.jsonl');

  writeFileSync(processesFile, '[]\n', 'utf8');
  writeFileSync(scopeFlowFile, '[]\n', 'utf8');
  writeFileSync(aliasMapFile, '{}\n', 'utf8');
  writeFileSync(scanFindingsFile, '[]\n', 'utf8');
  writeFileSync(processPoolFile, '[]\n', 'utf8');

  try {
    let observedOptions: RunFlowApplyProcessFlowRepairsOptions | undefined;
    const result = await executeCli(
      [
        'flow',
        'apply-process-flow-repairs',
        '--processes-file',
        processesFile,
        '--scope-flow-file',
        scopeFlowFile,
        '--alias-map',
        aliasMapFile,
        '--scan-findings',
        scanFindingsFile,
        '--process-pool-file',
        processPoolFile,
        '--out-dir',
        path.join(dir, 'repair-apply'),
        '--json',
      ],
      {
        ...makeDeps(),
        runFlowApplyProcessFlowRepairsImpl: async (options) => {
          observedOptions = options;
          return {
            schema_version: 1,
            generated_at_utc: '2026-03-30T22:20:00.000Z',
            status: 'completed_local_flow_apply_process_flow_repairs',
            processes_file: processesFile,
            scope_flow_files: [scopeFlowFile],
            alias_map_file: aliasMapFile,
            scan_findings_file: scanFindingsFile,
            auto_patch_policy: 'alias-only',
            process_pool_file: processPoolFile,
            out_dir: path.join(dir, 'repair-apply'),
            summary: {
              auto_patch_policy: 'alias-only',
              process_count: 1,
              repair_item_count: 1,
              decision_counts: { auto_patch: 1 },
              patched_process_count: 1,
              process_pool_sync: {
                pool_file: processPoolFile,
                pool_pre_count: 0,
                incoming_count: 1,
                pool_post_count: 1,
                inserted: 1,
                updated: 0,
                unchanged: 0,
                skipped_invalid: 0,
              },
            },
            files: {
              out_dir: path.join(dir, 'repair-apply'),
              plan: path.join(dir, 'repair-apply', 'repair-plan.json'),
              plan_jsonl: path.join(dir, 'repair-apply', 'repair-plan.jsonl'),
              manual_review_queue: path.join(dir, 'repair-apply', 'manual-review-queue.jsonl'),
              summary: path.join(dir, 'repair-apply', 'repair-summary.json'),
              patched_processes: path.join(dir, 'repair-apply', 'patched-processes.json'),
              patch_root: path.join(dir, 'repair-apply', 'process-patches'),
            },
          };
        },
      },
    );

    assert.equal(result.exitCode, 0);
    assert.equal(
      JSON.parse(result.stdout).status,
      'completed_local_flow_apply_process_flow_repairs',
    );
    assert.deepEqual(observedOptions, {
      processesFile,
      scopeFlowFiles: [scopeFlowFile],
      aliasMapFile,
      scanFindingsFile,
      autoPatchPolicy: 'alias-only',
      processPoolFile,
      outDir: path.join(dir, 'repair-apply'),
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli returns parsing errors for invalid flow scan and process-flow repair flags', async () => {
  const invalidScanArgsResult = await executeCli(
    ['flow', 'scan-process-flow-refs', '--bad-flag'],
    makeDeps(),
  );
  assert.equal(invalidScanArgsResult.exitCode, 2);
  assert.match(invalidScanArgsResult.stderr, /INVALID_ARGS/u);

  const invalidPlanArgsResult = await executeCli(
    ['flow', 'plan-process-flow-repairs', '--bad-flag'],
    makeDeps(),
  );
  assert.equal(invalidPlanArgsResult.exitCode, 2);
  assert.match(invalidPlanArgsResult.stderr, /INVALID_ARGS/u);

  const invalidPlanPolicyResult = await executeCli(
    ['flow', 'plan-process-flow-repairs', '--auto-patch-policy', 'bad-policy'],
    makeDeps(),
  );
  assert.equal(invalidPlanPolicyResult.exitCode, 2);
  assert.match(
    invalidPlanPolicyResult.stderr,
    /INVALID_FLOW_PLAN_PROCESS_FLOW_REPAIRS_AUTO_PATCH_POLICY/u,
  );

  const invalidApplyArgsResult = await executeCli(
    ['flow', 'apply-process-flow-repairs', '--bad-flag'],
    makeDeps(),
  );
  assert.equal(invalidApplyArgsResult.exitCode, 2);
  assert.match(invalidApplyArgsResult.stderr, /INVALID_ARGS/u);

  const invalidApplyPolicyResult = await executeCli(
    ['flow', 'apply-process-flow-repairs', '--auto-patch-policy', 'bad-policy'],
    makeDeps(),
  );
  assert.equal(invalidApplyPolicyResult.exitCode, 2);
  assert.match(
    invalidApplyPolicyResult.stderr,
    /INVALID_FLOW_APPLY_PROCESS_FLOW_REPAIRS_AUTO_PATCH_POLICY/u,
  );
});

test('executeCli validates missing required scan and process-flow repair inputs', async () => {
  const scanResult = await executeCli(['flow', 'scan-process-flow-refs'], makeDeps());
  assert.equal(scanResult.exitCode, 2);
  assert.match(scanResult.stderr, /FLOW_SCAN_PROCESS_FLOW_REFS_PROCESSES_FILE_REQUIRED/u);

  const planResult = await executeCli(['flow', 'plan-process-flow-repairs'], makeDeps());
  assert.equal(planResult.exitCode, 2);
  assert.match(planResult.stderr, /FLOW_PLAN_PROCESS_FLOW_REPAIRS_PROCESSES_FILE_REQUIRED/u);

  const applyResult = await executeCli(['flow', 'apply-process-flow-repairs'], makeDeps());
  assert.equal(applyResult.exitCode, 2);
  assert.match(applyResult.stderr, /FLOW_APPLY_PROCESS_FLOW_REPAIRS_PROCESSES_FILE_REQUIRED/u);
});
