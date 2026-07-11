import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  __testInternals as applyInternals,
  runDatasetMaintenanceApply,
} from '../src/lib/dataset-maintenance-apply.js';
import {
  appendStableJsonLine,
  computePlanSha256,
  isJsonObject,
  maintenanceRowKey,
  parseMaintenancePlan,
  parseMaintenanceScope,
  readJsonFile,
  readJsonLinesIfPresent,
  resolveMaintenancePlanArtifactPath,
  safeActionFileName,
  sha256Text,
  snapshotRemoteRow,
  stableJsonText,
  stableJsonValue,
  writeImmutableJson,
  writeImmutableJsonLines,
  type DatasetMaintenancePlan,
  type DatasetMaintenancePlanAction,
  type DatasetMaintenanceProgressEntry,
  type DatasetMaintenanceRemoteRow,
  type DatasetMaintenanceScopeAction,
  type JsonObject,
} from '../src/lib/dataset-maintenance-contract.js';
import {
  __testInternals as planInternals,
  runDatasetMaintenancePlan,
} from '../src/lib/dataset-maintenance-plan.js';
import {
  __testInternals as remoteInternals,
  deleteMaintenanceRow,
  fetchMaintenanceAccountRows,
  fetchMaintenanceExactRows,
  normalizeMaintenancePageSize,
  normalizeMaintenanceTimeout,
  resolveMaintenanceRemoteContext,
  saveDraftMaintenanceRow,
} from '../src/lib/dataset-maintenance-remote.js';
import {
  __testInternals as verifyInternals,
  runDatasetMaintenanceVerify,
} from '../src/lib/dataset-maintenance-verify.js';
import type { FetchLike, ResponseLike } from '../src/lib/http.js';
import {
  buildSupabaseTestEnv,
  isSupabaseAuthTokenUrl,
  makeSupabaseAuthResponse,
} from './helpers/supabase-auth.js';

type StoredRow = Omit<DatasetMaintenanceRemoteRow, 'table'>;

function jsonResponse(body: unknown, status = 200): ResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string): string | null {
        return name.toLowerCase() === 'content-type' ? 'application/json' : null;
      },
    },
    async text(): Promise<string> {
      return JSON.stringify(body);
    },
  };
}

function processPayload(options: { id: string; version: string; sourceId?: string }): JsonObject {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: { 'common:UUID': options.id },
      },
      ...(options.sourceId
        ? {
            modellingAndValidation: {
              dataSourcesTreatmentAndRepresentativeness: {
                referenceToDataSource: {
                  '@refObjectId': options.sourceId,
                  '@version': '01.00.000',
                  '@type': 'source data set',
                },
              },
            },
          }
        : {}),
      administrativeInformation: {
        publicationAndOwnership: { 'common:dataSetVersion': options.version },
      },
    },
  };
}

function sourcePayload(id: string, version = '01.00.000'): JsonObject {
  return {
    sourceDataSet: {
      sourceInformation: { dataSetInformation: { 'common:UUID': id } },
      administrativeInformation: {
        publicationAndOwnership: { 'common:dataSetVersion': version },
      },
    },
  };
}

function flowPayload(id: string, version = '01.00.000'): JsonObject {
  return {
    flowDataSet: {
      flowInformation: { dataSetInformation: { 'common:UUID': id } },
      administrativeInformation: {
        publicationAndOwnership: { 'common:dataSetVersion': version },
      },
    },
  };
}

class FakeMaintenanceRemote {
  readonly userId = '11111111-1111-4111-8111-111111111111';
  readonly email = 'owner@example.com';
  readonly env: NodeJS.ProcessEnv;
  readonly rows = new Map<string, StoredRow[]>();
  readonly rpcOrder: string[] = [];
  failDeleteOnce = false;
  invalidJson = false;

  constructor(label: string) {
    this.env = buildSupabaseTestEnv({
      TIANGONG_LCA_API_BASE_URL: `https://${label}.example.com/functions/v1`,
      TIANGONG_LCA_DISABLE_SESSION_CACHE: '1',
      TIANGONG_LCA_FORCE_REAUTH: '1',
    });
    for (const table of [
      'contacts',
      'sources',
      'flows',
      'processes',
      'lifecyclemodels',
      'unitgroups',
      'flowproperties',
    ]) {
      this.rows.set(table, []);
    }
  }

  add(table: string, id: string, payload: JsonObject, extras: Partial<StoredRow> = {}): void {
    this.rows.get(table)?.push({
      id,
      version: '01.00.000',
      user_id: this.userId,
      state_code: 0,
      modified_at: '2026-07-01T00:00:00.000Z',
      json_ordered: payload,
      model_id: null,
      rule_verification: null,
      ...extras,
    });
  }

  readonly fetch: FetchLike = async (input, init) => {
    const textUrl = String(input);
    if (isSupabaseAuthTokenUrl(textUrl)) {
      return makeSupabaseAuthResponse({ email: this.email, userId: this.userId });
    }
    if (textUrl.endsWith('/auth/v1/user')) {
      return jsonResponse({ id: this.userId, email: this.email });
    }
    if (this.invalidJson) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        async text() {
          return '{bad';
        },
      };
    }
    const url = new URL(textUrl);
    const rpc = url.pathname.split('/rpc/')[1];
    if (rpc) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      this.rpcOrder.push(rpc);
      if (rpc === 'cmd_dataset_delete' && this.failDeleteOnce) {
        this.failDeleteOnce = false;
        return jsonResponse({ message: 'injected delete failure' }, 500);
      }
      const table = String(body.p_table);
      const tableRows = this.rows.get(table) ?? [];
      const rowIndex = tableRows.findIndex(
        (row) => row.id === body.p_id && row.version === body.p_version,
      );
      if (rpc === 'cmd_dataset_delete') {
        if (rowIndex >= 0) {
          tableRows.splice(rowIndex, 1);
        }
      } else if (rowIndex >= 0) {
        tableRows[rowIndex] = {
          ...tableRows[rowIndex]!,
          json_ordered: body.p_json_ordered as JsonObject,
          model_id: (body.p_model_id as string | null) ?? null,
          rule_verification: (body.p_rule_verification as boolean | null) ?? null,
          modified_at: '2026-07-02T00:00:00.000Z',
        };
      }
      return jsonResponse({ ok: true, audit: body.p_audit });
    }
    const table = url.pathname.split('/rest/v1/')[1] ?? '';
    let values = [...(this.rows.get(table) ?? [])];
    const id = url.searchParams.get('id')?.replace(/^eq\./u, '');
    const version = url.searchParams.get('version')?.replace(/^eq\./u, '');
    const userId = url.searchParams.get('user_id')?.replace(/^eq\./u, '');
    if (id) values = values.filter((row) => row.id === id);
    if (version) values = values.filter((row) => row.version === version);
    if (userId) values = values.filter((row) => row.user_id === userId);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? values.length);
    return jsonResponse(values.slice(offset, offset + limit));
  };
}

function buildScopeFiles(options: {
  root: string;
  remote: FakeMaintenanceRemote;
  includeSave?: boolean;
}): { scopePath: string; desiredPath: string; outDir: string } {
  const desiredPath = path.join(options.root, 'desired-process.json');
  writeFileSync(
    desiredPath,
    JSON.stringify(
      processPayload({ id: '22222222-2222-4222-8222-222222222222', version: '01.00.000' }),
    ),
  );
  const actions: object[] = [
    {
      action_id: 'delete-source',
      action: 'delete',
      table: 'sources',
      id: '33333333-3333-4333-8333-333333333333',
      version: '01.00.000',
      expected_user_id: options.remote.userId,
      expected_state_code: 0,
      reason_code: 'DUPLICATE_SOURCE',
      reason: 'Source is superseded after references are repaired.',
      evidence: ['assessment/source-audit.json'],
    },
  ];
  if (options.includeSave !== false) {
    actions.push({
      action_id: 'repair-process-source',
      action: 'save_draft',
      table: 'processes',
      id: '22222222-2222-4222-8222-222222222222',
      version: '01.00.000',
      expected_user_id: options.remote.userId,
      expected_state_code: 0,
      reason_code: 'REWRITE_SOURCE_REFERENCE',
      reason: 'Remove reference to the superseded source.',
      evidence: ['assessment/source-audit.json'],
      desired_payload_path: path.basename(desiredPath),
    });
  }
  const scopePath = path.join(options.root, 'scope.json');
  writeFileSync(
    scopePath,
    JSON.stringify({
      schema_version: 1,
      task_id: 'bafu-cleanup-test',
      operation: 'repair-references',
      account: { user_id: options.remote.userId, email: options.remote.email },
      actions,
    }),
  );
  return { scopePath, desiredPath, outDir: path.join(options.root, 'maintenance') };
}

function seed(remote: FakeMaintenanceRemote): void {
  remote.add(
    'processes',
    '22222222-2222-4222-8222-222222222222',
    processPayload({
      id: '22222222-2222-4222-8222-222222222222',
      version: '01.00.000',
      sourceId: '33333333-3333-4333-8333-333333333333',
    }),
    { model_id: '44444444-4444-4444-8444-444444444444', rule_verification: true },
  );
  remote.add(
    'sources',
    '33333333-3333-4333-8333-333333333333',
    sourcePayload('33333333-3333-4333-8333-333333333333'),
  );
  remote.add(
    'flows',
    '55555555-5555-4555-8555-555555555555',
    flowPayload('55555555-5555-4555-8555-555555555555'),
  );
}

async function prepareSeededScenario(
  root: string,
  label: string,
): Promise<{
  remote: FakeMaintenanceRemote;
  files: ReturnType<typeof buildScopeFiles>;
  plan: DatasetMaintenancePlan;
  context: Awaited<ReturnType<typeof resolveMaintenanceRemoteContext>>;
}> {
  const scenarioRoot = path.join(root, label);
  mkdirSync(scenarioRoot, { recursive: true });
  const remote = new FakeMaintenanceRemote(label);
  seed(remote);
  const files = buildScopeFiles({ root: scenarioRoot, remote });
  const plan = await runDatasetMaintenancePlan({
    scopePath: files.scopePath,
    operation: 'repair-references',
    outDir: files.outDir,
    env: remote.env,
    fetchImpl: remote.fetch,
    now: new Date('2026-07-11T00:00:00.000Z'),
  });
  const context = await resolveMaintenanceRemoteContext({
    env: remote.env,
    fetchImpl: remote.fetch,
    now: new Date('2026-07-11T00:00:00.000Z'),
  });
  return { remote, files, plan, context };
}

function scopeAction(
  remote: FakeMaintenanceRemote,
  overrides: Record<string, unknown> = {},
): DatasetMaintenanceScopeAction {
  return {
    action_id: 'delete-source',
    action: 'delete',
    table: 'sources',
    id: '33333333-3333-4333-8333-333333333333',
    version: '01.00.000',
    expected_user_id: remote.userId,
    expected_state_code: 0,
    reason_code: 'TEST',
    reason: 'test reason',
    evidence: [],
    ...overrides,
  } as DatasetMaintenanceScopeAction;
}

function scopeValue(
  remote: FakeMaintenanceRemote,
  actions: unknown[] = [scopeAction(remote)],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: 1,
    task_id: 'edge-task',
    operation: 'delete',
    account: { user_id: remote.userId },
    actions,
    ...overrides,
  };
}

function successProgressEntry(
  plan: DatasetMaintenancePlan,
  action: DatasetMaintenancePlanAction,
): DatasetMaintenanceProgressEntry {
  return {
    schema_version: 1,
    plan_sha256: plan.plan_sha256,
    operation_id: plan.operation_id,
    action_id: action.action_id,
    action: action.action,
    table: action.table,
    id: action.id,
    version: action.version,
    reason_code: action.reason_code,
    audit_context: {
      plan_sha256: plan.plan_sha256,
      operation_id: plan.operation_id,
      action_id: action.action_id,
      reason_code: action.reason_code,
      source: 'tiangong-lca dataset maintenance apply',
    },
    actor: { user_id: plan.account.user_id, email: plan.account.email ?? '' },
    started_at_utc: '2026-07-11T00:00:00.000Z',
    ended_at_utc: '2026-07-11T00:00:00.000Z',
    before_sha256: action.before?.row_sha256 ?? '',
    after_sha256: action.desired_payload?.sha256 ?? null,
    remote_result_sha256: 'a'.repeat(64),
    result: 'success',
    error: null,
    rollback: action.rollback,
  };
}

test('row-level maintenance plans update-first closure, resumes failure, and verifies readback', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-maintenance-row-'));
  const remote = new FakeMaintenanceRemote('row-maintenance-main');
  seed(remote);
  const files = buildScopeFiles({ root, remote });
  const now = new Date('2026-07-11T01:02:03.000Z');
  try {
    const plan = await runDatasetMaintenancePlan({
      scopePath: files.scopePath,
      operation: 'repair-references',
      outDir: files.outDir,
      pageSize: 1,
      timeoutMs: 1000,
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.equal(plan.status, 'ready');
    assert.equal(plan.summary.current_reference_impacts, 1);
    assert.equal(plan.summary.projected_reference_impacts, 0);
    assert.equal(plan.summary.protected_rows, 1);
    assert.equal(plan.plan_sha256, computePlanSha256(plan));
    assert.equal(parseMaintenancePlan(plan).plan_sha256, plan.plan_sha256);
    assert.equal(existsSync(path.join(files.outDir, 'maintenance-scope.json')), true);
    assert.equal(existsSync(path.join(files.outDir, 'protected-rows.jsonl')), true);

    remote.failDeleteOnce = true;
    const partial = await runDatasetMaintenanceApply({
      planPath: path.join(files.outDir, 'maintenance-plan.json'),
      commit: true,
      approvePlan: plan.plan_sha256,
      confirm: remote.email,
      timeoutMs: 1000,
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.equal(partial.status, 'completed_with_failures');
    assert.equal(partial.summary.success, 1);
    assert.equal(partial.summary.failed, 1);
    assert.deepEqual(remote.rpcOrder, ['cmd_dataset_save_draft', 'cmd_dataset_delete']);

    const failedVerify = await runDatasetMaintenanceVerify({
      planPath: path.join(files.outDir, 'maintenance-plan.json'),
      outDir: path.join(files.outDir, 'verify-partial'),
      pageSize: 2,
      timeoutMs: 1000,
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.equal(failedVerify.status, 'failed');
    assert.match(failedVerify.issues.map((entry) => entry.code).join(','), /DELETE_TARGET/u);

    const completed = await runDatasetMaintenanceApply({
      planPath: path.join(files.outDir, 'maintenance-plan.json'),
      commit: true,
      approvePlan: plan.plan_sha256,
      confirm: remote.email,
      timeoutMs: 1000,
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.summary.resumed_successes, 1);
    assert.deepEqual(remote.rpcOrder, [
      'cmd_dataset_save_draft',
      'cmd_dataset_delete',
      'cmd_dataset_delete',
    ]);
    const progress = readJsonLinesIfPresent(path.join(files.outDir, 'apply-progress.jsonl'));
    assert.deepEqual(
      progress.map((entry) => (entry as { result: string }).result),
      ['success', 'failed', 'success'],
    );
    const firstProgress = progress[0] as Record<string, unknown>;
    assert.equal(firstProgress.action, 'save_draft');
    assert.equal(firstProgress.reason_code, 'REWRITE_SOURCE_REFERENCE');
    assert.equal(typeof firstProgress.before_sha256, 'string');
    assert.equal(typeof firstProgress.after_sha256, 'string');
    assert.equal(typeof firstProgress.remote_result_sha256, 'string');
    assert.deepEqual(firstProgress.audit_context, {
      plan_sha256: plan.plan_sha256,
      operation_id: plan.operation_id,
      action_id: 'repair-process-source',
      reason_code: 'REWRITE_SOURCE_REFERENCE',
      source: 'tiangong-lca dataset maintenance apply',
    });
    assert.equal(completed.database_audit.rpc_transaction_log, 'public.command_audit_log');
    assert.match(
      readFileSync(path.join(files.outDir, 'approval-record.json'), 'utf8'),
      /plan_sha256/u,
    );

    const verified = await runDatasetMaintenanceVerify({
      planPath: path.join(files.outDir, 'maintenance-plan.json'),
      pageSize: 1,
      timeoutMs: 1000,
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.equal(verified.status, 'passed');
    assert.equal(verified.summary.action_checks_passed, 2);
    assert.equal(verified.summary.protected_checks_passed, 1);
    assert.equal(verified.summary.dangling_deleted_target_references, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('row-level plan blocks a delete with projected inbound references', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-maintenance-blocked-'));
  const remote = new FakeMaintenanceRemote('row-maintenance-blocked');
  seed(remote);
  const files = buildScopeFiles({ root, remote, includeSave: false });
  try {
    const plan = await runDatasetMaintenancePlan({
      scopePath: files.scopePath,
      operation: 'repair-references',
      outDir: files.outDir,
      env: remote.env,
      fetchImpl: remote.fetch,
      now: new Date('2026-07-11T00:00:00.000Z'),
    });
    assert.equal(plan.status, 'blocked');
    assert.equal(plan.summary.projected_reference_impacts, 1);
    assert.match(plan.blockers.map((entry) => entry.code).join(','), /PROJECTED_INBOUND/u);
    await assert.rejects(
      () =>
        runDatasetMaintenanceApply({
          planPath: path.join(files.outDir, 'maintenance-plan.json'),
          commit: true,
          approvePlan: plan.plan_sha256,
          confirm: remote.email,
          env: remote.env,
          fetchImpl: remote.fetch,
        }),
      /Blocked maintenance plan/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('maintenance contracts and remote adapters reject unsafe inputs and invalid responses', async () => {
  const remote = new FakeMaintenanceRemote('row-maintenance-edges');
  seed(remote);
  assert.equal(normalizeMaintenancePageSize(), 1000);
  assert.equal(normalizeMaintenanceTimeout(), 10000);
  assert.throws(() => normalizeMaintenancePageSize(0), /page size/u);
  assert.throws(() => normalizeMaintenancePageSize(5001), /page size/u);
  assert.throws(() => normalizeMaintenanceTimeout(0), /timeout/u);
  assert.equal(safeActionFileName(' / '), sha256Text(' / ').slice(0, 16));
  assert.throws(
    () =>
      parseMaintenanceScope({
        schema_version: 1,
        task_id: 'bad',
        operation: 'delete',
        account: { user_id: remote.userId },
        actions: [
          {
            action_id: 'bad',
            action: 'delete',
            table: 'unitgroups',
            id: 'id',
            version: '01.00.000',
            expected_user_id: remote.userId,
            expected_state_code: 0,
            reason_code: 'bad',
            reason: 'bad',
            evidence: [],
          },
        ],
      }),
    /protected or unsupported/u,
  );
  const context = await resolveMaintenanceRemoteContext({
    env: remote.env,
    fetchImpl: remote.fetch,
    timeoutMs: 1000,
  });
  const exact = await fetchMaintenanceExactRows({
    context,
    table: 'sources',
    id: '33333333-3333-4333-8333-333333333333',
    version: '01.00.000',
  });
  assert.equal(exact.rows.length, 1);
  const account = await fetchMaintenanceAccountRows({
    context,
    userId: remote.userId,
    pageSize: 1,
  });
  assert.equal(account.rows.length, 3);
  await saveDraftMaintenanceRow({
    context,
    table: 'processes',
    id: '22222222-2222-4222-8222-222222222222',
    version: '01.00.000',
    payload: processPayload({
      id: '22222222-2222-4222-8222-222222222222',
      version: '01.00.000',
    }),
    modelId: null,
    ruleVerification: false,
    audit: { source: 'test' },
  });
  await deleteMaintenanceRow({
    context,
    table: 'sources',
    id: '33333333-3333-4333-8333-333333333333',
    version: '01.00.000',
    audit: { source: 'test' },
  });

  remote.invalidJson = true;
  await assert.rejects(
    () =>
      fetchMaintenanceExactRows({
        context,
        table: 'flows',
        id: '55555555-5555-4555-8555-555555555555',
        version: '01.00.000',
      }),
    /not valid JSON/u,
  );
  assert.equal(remoteInternals.selectForTable('processes').includes('model_id'), true);
  assert.equal(remoteInternals.selectForTable('flows').includes('model_id'), false);
  assert.equal(remoteInternals.normalizeRemoteRow('flows', null), null);
  assert.equal(remoteInternals.normalizeRemoteRow('flows', { id: '', version: '' }), null);
  assert.deepEqual(
    remoteInternals.normalizeRemoteRow('flows', {
      id: ' id ',
      version: ' 01.00.000 ',
      user_id: 2,
      state_code: '0',
      modified_at: '',
      json_ordered: [],
      model_id: ' ',
      rule_verification: 'no',
    }),
    {
      table: 'flows',
      id: 'id',
      version: '01.00.000',
      user_id: null,
      state_code: 0,
      modified_at: null,
      json_ordered: null,
      model_id: null,
      rule_verification: null,
    },
  );
  assert.equal(
    remoteInternals.normalizeRemoteRow('flows', {
      id: 'id',
      version: '01.00.000',
      state_code: 'bad',
    })?.state_code,
    null,
  );
  assert.throws(() => remoteInternals.normalizeRemoteRows('flows', {}, 'test'), /not an array/u);
  assert.throws(() => remoteInternals.normalizeRemoteRows('flows', [{}], 'test'), /invalid row/u);
  const partialContext = {
    publishable_key: 'key',
    access_token: 'token',
    timeout_ms: 1000,
    fetch_impl: (async () => jsonResponse({}, 500)) as FetchLike,
  };
  await assert.rejects(
    () =>
      remoteInternals.fetchJson({
        context: partialContext,
        url: 'https://example.test/fail',
        label: 'fail',
      }),
    /HTTP 500/u,
  );
  assert.equal(
    await remoteInternals.fetchJson({
      context: {
        ...partialContext,
        fetch_impl: async () => ({
          ...jsonResponse(null),
          async text() {
            return '';
          },
        }),
      },
      url: 'https://example.test/empty',
      label: 'empty',
    }),
    null,
  );

  const fallbackRemote = new FakeMaintenanceRemote('row-maintenance-email-fallback');
  const fallbackContext = await resolveMaintenanceRemoteContext({
    env: fallbackRemote.env,
    fetchImpl: async (input, init) => {
      if (String(input).endsWith('/auth/v1/user')) {
        return jsonResponse({ id: fallbackRemote.userId });
      }
      return fallbackRemote.fetch(input, init);
    },
  });
  assert.equal(fallbackContext.account.email, fallbackRemote.email);
  const invalidUserRemote = new FakeMaintenanceRemote('row-maintenance-invalid-user');
  await assert.rejects(
    () =>
      resolveMaintenanceRemoteContext({
        env: invalidUserRemote.env,
        fetchImpl: async (input, init) =>
          String(input).endsWith('/auth/v1/user')
            ? jsonResponse({ email: invalidUserRemote.email })
            : invalidUserRemote.fetch(input, init),
      }),
    /did not return id and email/u,
  );
  const badRpcContext = {
    ...context,
    fetch_impl: (async (input, init) =>
      String(input).includes('/rpc/')
        ? jsonResponse({ ok: false })
        : remote.fetch(input, init)) as FetchLike,
  };
  await assert.rejects(
    () =>
      deleteMaintenanceRow({
        context: badRpcContext,
        table: 'sources',
        id: 'missing',
        version: '01.00.000',
        audit: {},
      }),
    /unexpected response/u,
  );
});

test('maintenance contract validates every frozen scope guard and immutable artifact edge', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-maintenance-contract-'));
  const remote = new FakeMaintenanceRemote('row-maintenance-contract');
  try {
    assert.equal(isJsonObject({}), true);
    assert.equal(isJsonObject(null), false);
    assert.equal(isJsonObject([]), false);
    assert.deepEqual(stableJsonValue({ z: [2, { b: 1, a: 0 }], a: null }), {
      a: null,
      z: [2, { a: 0, b: 1 }],
    });
    assert.equal(stableJsonText({ b: 1, a: 2 }), '{"a":2,"b":1}');
    assert.equal(
      snapshotRemoteRow({
        table: 'contacts',
        id: 'id',
        version: '01.00.000',
        user_id: null,
        state_code: null,
        modified_at: null,
        json_ordered: null,
        model_id: null,
        rule_verification: null,
      }).payload_sha256,
      null,
    );
    assert.equal(
      maintenanceRowKey({ table: 'flows', id: 'id', version: '01.00.000' }),
      'flows\u0000id\u000001.00.000',
    );

    const invalidScopes: unknown[] = [
      null,
      {},
      scopeValue(remote, [null]),
      scopeValue(remote, [scopeAction(remote, { action: 'publish' })]),
      scopeValue(remote, [scopeAction(remote, { expected_state_code: 100 })]),
      scopeValue(remote, [scopeAction(remote, { expected_user_id: 'other' })]),
      scopeValue(remote, [scopeAction(remote, { evidence: 'no' })]),
      scopeValue(remote, [scopeAction(remote, { action: 'save_draft' })]),
      scopeValue(remote, [scopeAction(remote, { expected_before_sha256: 'bad' })]),
      scopeValue(remote, [scopeAction(remote, { id: ' ' })]),
      scopeValue(remote, [scopeAction(remote)], { operation: 'unsupported' }),
      scopeValue(remote, []),
      scopeValue(remote, [scopeAction(remote), scopeAction(remote)]),
      scopeValue(remote, [
        scopeAction(remote, { action_id: 'one' }),
        scopeAction(remote, { action_id: 'two' }),
      ]),
      scopeValue(remote, [
        scopeAction(remote, { action_id: 'a/b' }),
        scopeAction(remote, {
          action_id: 'a_b',
          id: '66666666-6666-4666-8666-666666666666',
        }),
      ]),
    ];
    for (const invalid of invalidScopes) {
      assert.throws(() => parseMaintenanceScope(invalid));
    }
    assert.throws(
      () => parseMaintenanceScope(scopeValue(remote), 'repair-references'),
      /does not match requested/u,
    );
    const optional = parseMaintenanceScope(
      scopeValue(
        remote,
        [
          scopeAction(remote, {
            action: 'save_draft',
            desired_payload_path: 'payload.json',
            expected_before_sha256: 'a'.repeat(64),
          }),
        ],
        {
          account: { user_id: remote.userId, email: ' OWNER@EXAMPLE.COM ' },
          source_import_run_id: ' run ',
          source_lineage: { manifest: 'redo.json' },
        },
      ),
      'delete',
    );
    assert.equal(optional.account.email, 'OWNER@EXAMPLE.COM');
    assert.equal(optional.source_import_run_id, 'run');
    assert.deepEqual(optional.source_lineage, { manifest: 'redo.json' });

    const jsonPath = path.join(root, 'immutable.json');
    const jsonlPath = path.join(root, 'immutable.jsonl');
    assert.equal(writeImmutableJson(jsonPath, { b: 1, a: 2 }), path.resolve(jsonPath));
    assert.equal(writeImmutableJson(jsonPath, { a: 2, b: 1 }), path.resolve(jsonPath));
    assert.throws(() => writeImmutableJson(jsonPath, { a: 3 }), /immutable/u);
    assert.equal(writeImmutableJsonLines(jsonlPath, []), path.resolve(jsonlPath));
    assert.equal(writeImmutableJsonLines(jsonlPath, []), path.resolve(jsonlPath));
    const appendedPath = path.join(root, 'append.jsonl');
    appendStableJsonLine(appendedPath, { b: 1, a: 2 });
    assert.deepEqual(readJsonLinesIfPresent(appendedPath), [{ a: 2, b: 1 }]);
    assert.deepEqual(readJsonLinesIfPresent(path.join(root, 'missing.jsonl')), []);
    writeFileSync(path.join(root, 'bad.json'), '{bad');
    assert.throws(() => readJsonFile(path.join(root, 'missing.json'), 'Missing'), /not found/u);
    assert.throws(() => readJsonFile(path.join(root, 'bad.json'), 'Bad'), /not valid JSON/u);
    writeFileSync(path.join(root, 'bad.jsonl'), '{}\n{bad\n');
    assert.throws(() => readJsonLinesIfPresent(path.join(root, 'bad.jsonl')), /Invalid/u);
    assert.throws(() => parseMaintenancePlan({}), /valid schema_version/u);
    assert.throws(
      () =>
        parseMaintenancePlan({
          schema_version: 1,
          actions: [],
          protected_rows: [],
          blockers: [],
          account: {},
          artifacts: {},
          plan_sha256: 'bad',
        }),
      /hash does not match/u,
    );
    assert.equal(
      resolveMaintenancePlanArtifactPath(root, 'payloads/action.json', 'Desired payload'),
      path.join(root, 'payloads/action.json'),
    );
    for (const unsafePath of [
      '',
      path.resolve(root, 'absolute.json'),
      '.',
      '..',
      '../escape.json',
    ]) {
      assert.throws(
        () => resolveMaintenancePlanArtifactPath(root, unsafePath, 'Desired payload'),
        /must (?:be a relative path|stay inside)/u,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('maintenance plan parser rejects tampered action, snapshot, summary, and blocker contracts', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-maintenance-plan-contract-'));
  try {
    const scenario = await prepareSeededScenario(root, 'valid-plan');
    const basePlan = structuredClone(scenario.plan);
    const invalidPlan = (
      mutate: (plan: DatasetMaintenancePlan) => void,
      message: RegExp = /invalid|inconsistent|protected or unsupported|does not match|must|unsupported/iu,
    ): void => {
      const plan = structuredClone(basePlan);
      mutate(plan);
      plan.plan_sha256 = computePlanSha256(plan);
      assert.throws(() => parseMaintenancePlan(plan), message);
    };

    const withImportRun = structuredClone(basePlan);
    withImportRun.source_import_run_id = 'bafu-import-run';
    withImportRun.plan_sha256 = computePlanSha256(withImportRun);
    assert.equal(parseMaintenancePlan(withImportRun).source_import_run_id, 'bafu-import-run');

    invalidPlan((plan) => Object.assign(plan.actions[0]!, { table: 'unitgroups' }));
    invalidPlan((plan) => Object.assign(plan.actions[0]!, { expected_user_id: 'other-user' }));
    invalidPlan((plan) => Object.assign(plan.actions[0]!, { expected_state_code: 100 }));
    invalidPlan((plan) => Object.assign(plan.actions[0]!, { action: 'publish' }));
    invalidPlan((plan) => Object.assign(plan.actions[0]!, { ordinal: -1 }));
    invalidPlan((plan) => Object.assign(plan.actions[0]!, { status: 'unknown' }));
    invalidPlan((plan) => Object.assign(plan.actions[0]!, { blockers: 'not-an-array' }));
    invalidPlan((plan) => Object.assign(plan.actions[0]!, { rollback: null }));

    invalidPlan((plan) => Object.assign(plan.actions[0]!.before!, { state_code: 100 }));
    invalidPlan((plan) => Object.assign(plan.actions[0]!.before!, { user_id: 'other-user' }));
    invalidPlan((plan) => Object.assign(plan.actions[0]!.before!, { json_ordered: null }));
    invalidPlan((plan) => {
      plan.actions[0]!.before!.row_sha256 = '0'.repeat(64);
    });
    invalidPlan((plan) => Object.assign(plan.actions[0]!.rollback, { strategy: 'unknown' }));
    invalidPlan((plan) =>
      Object.assign(plan.actions[0]!.rollback, { before_payload_sha256: '0'.repeat(64) }),
    );
    invalidPlan((plan) => Object.assign(plan.actions[0]!.rollback, { before_payload: null }));
    invalidPlan((plan) => Object.assign(plan.actions[0]!.rollback, { before_payload: {} }));
    invalidPlan((plan) =>
      Object.assign(plan.actions[0]!.rollback, {
        model_id: '44444444-4444-4444-8444-444444444444',
      }),
    );
    invalidPlan((plan) => Object.assign(plan.actions[0]!.rollback, { rule_verification: true }));
    invalidPlan((plan) => {
      const saveAction = plan.actions.find((action) => action.action === 'save_draft')!;
      saveAction.desired_payload = null;
    });
    invalidPlan((plan) => {
      const deleteAction = plan.actions.find((action) => action.action === 'delete')!;
      deleteAction.desired_payload = { path: 'unexpected.json', sha256: '0'.repeat(64) };
    });

    const summaryMutations: Array<(plan: DatasetMaintenancePlan) => void> = [
      (plan) => {
        plan.summary.actions += 1;
      },
      (plan) => {
        plan.summary.save_draft += 1;
      },
      (plan) => {
        plan.summary.delete += 1;
      },
      (plan) => {
        plan.summary.protected_rows += 1;
      },
      (plan) => {
        plan.summary.blockers += 1;
      },
      (plan) => {
        plan.summary.current_reference_impacts = -1;
      },
      (plan) => {
        plan.summary.current_reference_impacts = 0.5;
      },
      (plan) => {
        plan.summary.projected_reference_impacts = -1;
      },
      (plan) => {
        plan.summary.projected_reference_impacts = 0.5;
      },
    ];
    for (const mutate of summaryMutations) {
      invalidPlan(mutate, /status or blocker contract is inconsistent/u);
    }
    invalidPlan((plan) => {
      plan.status = 'blocked';
    }, /status or blocker contract is inconsistent/u);

    const blocker = {
      code: 'TEST_BLOCKER',
      message: 'test blocker',
      action_id: basePlan.actions[0]!.action_id,
      table: basePlan.actions[0]!.table,
      id: basePlan.actions[0]!.id,
      version: basePlan.actions[0]!.version,
    };
    const validBlockedPlan = structuredClone(basePlan);
    validBlockedPlan.status = 'blocked';
    validBlockedPlan.actions[0]!.status = 'blocked';
    validBlockedPlan.actions[0]!.blockers = [blocker];
    validBlockedPlan.blockers = [blocker];
    validBlockedPlan.summary.blockers = 1;
    validBlockedPlan.plan_sha256 = computePlanSha256(validBlockedPlan);
    assert.equal(parseMaintenancePlan(validBlockedPlan).status, 'blocked');

    const mismatchedBlockers = structuredClone(validBlockedPlan);
    mismatchedBlockers.blockers[0] = {
      ...mismatchedBlockers.blockers[0]!,
      message: 'different global blocker',
    };
    mismatchedBlockers.plan_sha256 = computePlanSha256(mismatchedBlockers);
    assert.throws(
      () => parseMaintenancePlan(mismatchedBlockers),
      /status or blocker contract is inconsistent/u,
    );

    const saveAction = basePlan.actions.find((action) => action.action === 'save_draft')!;
    assert.throws(
      () =>
        applyInternals.loadDesiredPayload(scenario.files.outDir, {
          ...saveAction,
          desired_payload: {
            path: '../escaped-payload.json',
            sha256: saveAction.desired_payload!.sha256,
          },
        }),
      /stay inside/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('maintenance apply guards reject artifact, preflight, approval, and just-in-time drift', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-maintenance-apply-edges-'));
  const remote = new FakeMaintenanceRemote('row-maintenance-apply-edges');
  seed(remote);
  const files = buildScopeFiles({ root, remote });
  const now = new Date('2026-07-11T00:00:00.000Z');
  try {
    const plan = await runDatasetMaintenancePlan({
      scopePath: files.scopePath,
      operation: 'repair-references',
      outDir: files.outDir,
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    const planDir = files.outDir;
    const context = await resolveMaintenanceRemoteContext({
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    const current = await fetchMaintenanceAccountRows({ context, userId: remote.userId });
    const emptyProgress = applyInternals.parseProgress(plan, path.join(root, 'no-progress.jsonl'));
    const saveAction = plan.actions.find((action) => action.action === 'save_draft')!;
    const deleteAction = plan.actions.find((action) => action.action === 'delete')!;

    assert.equal(applyInternals.clock({ now } as never), now.toISOString());
    assert.equal(typeof applyInternals.clock({} as never), 'string');
    assert.equal(applyInternals.errorMessage(new Error('error')), 'error');
    assert.equal(applyInternals.errorMessage('string-error'), 'string-error');
    assert.throws(
      () =>
        applyInternals.loadDesiredPayload(planDir, {
          ...saveAction,
          desired_payload: null,
        }),
      /lacks desired payload/u,
    );
    const wrongPayloadPath = path.join(planDir, 'payloads', 'wrong.json');
    writeFileSync(wrongPayloadPath, '{}');
    assert.throws(
      () =>
        applyInternals.loadDesiredPayload(planDir, {
          ...saveAction,
          desired_payload: { path: 'payloads/wrong.json', sha256: '0'.repeat(64) },
        }),
      /hash mismatch/u,
    );
    const invalidProgressPath = path.join(root, 'invalid-progress.jsonl');
    writeFileSync(invalidProgressPath, '{}\n');
    assert.throws(
      () => applyInternals.parseProgress(plan, invalidProgressPath),
      /invalid or foreign/u,
    );

    assert.throws(
      () =>
        applyInternals.assertApplyPreconditions({
          plan,
          planDir,
          currentRows: [
            ...current.rows,
            {
              ...current.rows[0]!,
              id: '77777777-7777-4777-8777-777777777777',
            },
          ],
          progress: emptyProgress,
        }),
      /Unexpected current-account row/u,
    );
    assert.throws(
      () =>
        applyInternals.assertApplyPreconditions({
          plan,
          planDir,
          currentRows: current.rows.filter((row) => row.table !== 'flows'),
          progress: emptyProgress,
        }),
      /Protected row drifted/u,
    );
    const noBeforePlan = structuredClone(plan);
    noBeforePlan.actions[0]!.before = null;
    assert.throws(
      () =>
        applyInternals.assertApplyPreconditions({
          plan: noBeforePlan,
          planDir,
          currentRows: current.rows.filter((row) => row.table !== 'sources'),
          progress: emptyProgress,
        }),
      /lacks before snapshot/u,
    );
    const deleteSuccessProgress = applyInternals.parseProgress(
      plan,
      path.join(root, 'delete-success.jsonl'),
    );
    deleteSuccessProgress.successes.set(
      deleteAction.action_id,
      successProgressEntry(plan, deleteAction),
    );
    assert.throws(
      () =>
        applyInternals.assertApplyPreconditions({
          plan,
          planDir,
          currentRows: current.rows,
          progress: deleteSuccessProgress,
        }),
      /visible again/u,
    );
    assert.throws(
      () =>
        applyInternals.assertApplyPreconditions({
          plan,
          planDir,
          currentRows: current.rows.filter((row) => row.table !== 'sources'),
          progress: emptyProgress,
        }),
      /missing, non-draft, or not owned/u,
    );
    const saveSuccessProgress = applyInternals.parseProgress(
      plan,
      path.join(root, 'save-success.jsonl'),
    );
    saveSuccessProgress.successes.set(saveAction.action_id, successProgressEntry(plan, saveAction));
    assert.throws(
      () =>
        applyInternals.assertApplyPreconditions({
          plan,
          planDir,
          currentRows: current.rows,
          progress: saveSuccessProgress,
        }),
      /Previously saved row payload drifted/u,
    );
    assert.throws(
      () =>
        applyInternals.assertApplyPreconditions({
          plan,
          planDir,
          currentRows: current.rows.map((row) =>
            row.table === 'sources' ? { ...row, modified_at: 'changed' } : row,
          ),
          progress: emptyProgress,
        }),
      /Pending action row drifted/u,
    );
    const referenceDriftPlan = structuredClone(plan);
    referenceDriftPlan.projected_reference_sha256 = '0'.repeat(64);
    assert.throws(
      () =>
        applyInternals.assertApplyPreconditions({
          plan: referenceDriftPlan,
          planDir,
          currentRows: current.rows,
          progress: emptyProgress,
        }),
      /reference closure drifted/u,
    );
    const approvalPath = path.join(root, 'bad-approval.json');
    writeFileSync(approvalPath, '{}');
    assert.throws(
      () => applyInternals.validateApprovalRecord({ path: approvalPath, plan, context }),
      /does not match/u,
    );
    applyInternals.validateApprovalRecord({
      path: path.join(root, 'missing-approval.json'),
      plan,
      context,
    });

    const processRow = remote.rows.get('processes')!.find((row) => row.id === saveAction.id)!;
    processRow.modified_at = '2026-07-11T00:00:01.000Z';
    await assert.rejects(
      () => applyInternals.executeAction({ action: saveAction, plan, planDir, context }),
      /immediately before write/u,
    );
    assert.equal(remote.rpcOrder.length, 0);
    processRow.modified_at = saveAction.before!.modified_at;

    await assert.rejects(
      () =>
        runDatasetMaintenanceApply({
          planPath: path.join(planDir, 'maintenance-plan.json'),
          commit: false,
          approvePlan: plan.plan_sha256,
          confirm: remote.email,
          env: remote.env,
          fetchImpl: remote.fetch,
        }),
      /requires commit/u,
    );
    await assert.rejects(
      () =>
        runDatasetMaintenanceApply({
          planPath: path.join(planDir, 'maintenance-plan.json'),
          commit: true,
          approvePlan: 'wrong',
          confirm: remote.email,
          env: remote.env,
          fetchImpl: remote.fetch,
        }),
      /exactly match/u,
    );
    await assert.rejects(
      () =>
        runDatasetMaintenanceApply({
          planPath: path.join(planDir, 'maintenance-plan.json'),
          commit: true,
          approvePlan: plan.plan_sha256,
          confirm: 'wrong@example.com',
          env: remote.env,
          fetchImpl: remote.fetch,
        }),
      /confirm must exactly match/u,
    );

    const redoPlan = structuredClone(plan);
    redoPlan.operation = 'redo-import';
    redoPlan.source_import_run_id = null;
    redoPlan.source_lineage = null;
    redoPlan.plan_sha256 = computePlanSha256(redoPlan);
    const redoPath = path.join(root, 'redo-plan.json');
    writeImmutableJson(redoPath, redoPlan);
    await assert.rejects(
      () =>
        runDatasetMaintenanceApply({
          planPath: redoPath,
          commit: true,
          approvePlan: redoPlan.plan_sha256,
          confirm: remote.email,
          env: remote.env,
          fetchImpl: remote.fetch,
        }),
      /requires frozen redo/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('maintenance planning records target visibility, ownership, draft, payload, and identity blockers', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-maintenance-plan-edges-'));
  const now = new Date('2026-07-11T00:00:00.000Z');
  async function planScenario(
    label: string,
    remote: FakeMaintenanceRemote,
    scope: Record<string, unknown>,
    payload?: unknown,
  ): Promise<DatasetMaintenancePlan> {
    const scenario = path.join(root, label);
    mkdirSync(scenario, { recursive: true });
    const scopePath = path.join(scenario, 'scope.json');
    const desiredPath = path.join(scenario, 'desired.json');
    writeFileSync(scopePath, JSON.stringify(scope));
    if (payload !== undefined) writeFileSync(desiredPath, JSON.stringify(payload));
    return runDatasetMaintenancePlan({
      scopePath,
      operation: scope.operation as 'delete' | 'repair-references',
      outDir: path.join(scenario, 'out'),
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
  }
  try {
    const accountRemote = new FakeMaintenanceRemote('plan-account-mismatch');
    await assert.rejects(
      () =>
        planScenario(
          'account',
          accountRemote,
          scopeValue(accountRemote, [scopeAction(accountRemote, { expected_user_id: 'other' })], {
            account: { user_id: 'other' },
          }),
        ),
      /authenticated user does not match/u,
    );
    const emailRemote = new FakeMaintenanceRemote('plan-email-mismatch');
    await assert.rejects(
      () =>
        planScenario(
          'email',
          emailRemote,
          scopeValue(emailRemote, [scopeAction(emailRemote)], {
            account: { user_id: emailRemote.userId, email: 'wrong@example.com' },
          }),
        ),
      /authenticated email does not match/u,
    );

    const missingRemote = new FakeMaintenanceRemote('plan-missing');
    const missing = await planScenario('missing', missingRemote, scopeValue(missingRemote));
    assert.match(missing.blockers.map((entry) => entry.code).join(','), /TARGET_NOT_VISIBLE/u);
    assert.equal(missing.actions[0]?.before, null);

    const duplicateRemote = new FakeMaintenanceRemote('plan-duplicate');
    duplicateRemote.add(
      'sources',
      '33333333-3333-4333-8333-333333333333',
      sourcePayload('33333333-3333-4333-8333-333333333333'),
    );
    duplicateRemote.add(
      'sources',
      '33333333-3333-4333-8333-333333333333',
      sourcePayload('33333333-3333-4333-8333-333333333333'),
    );
    const duplicate = await planScenario('duplicate', duplicateRemote, scopeValue(duplicateRemote));
    assert.match(duplicate.blockers.map((entry) => entry.code).join(','), /TARGET_NOT_UNIQUE/u);

    const protectedRemote = new FakeMaintenanceRemote('plan-protected');
    protectedRemote.add(
      'sources',
      '33333333-3333-4333-8333-333333333333',
      sourcePayload('33333333-3333-4333-8333-333333333333'),
      { user_id: 'other', state_code: 100, json_ordered: null },
    );
    const protectedPlan = await planScenario(
      'protected',
      protectedRemote,
      scopeValue(protectedRemote, [
        scopeAction(protectedRemote, { expected_before_sha256: '0'.repeat(64) }),
      ]),
    );
    const protectedCodes = protectedPlan.blockers.map((entry) => entry.code).join(',');
    assert.match(protectedCodes, /TARGET_OWNER_MISMATCH/u);
    assert.match(protectedCodes, /TARGET_NOT_DRAFT/u);
    assert.match(protectedCodes, /TARGET_PAYLOAD_MISSING/u);
    assert.match(protectedCodes, /EXPECTED_BEFORE_HASH_MISMATCH/u);
    assert.match(protectedCodes, /SNAPSHOT_DRIFT/u);

    const desiredRemote = new FakeMaintenanceRemote('plan-desired');
    desiredRemote.add(
      'processes',
      '22222222-2222-4222-8222-222222222222',
      processPayload({ id: '22222222-2222-4222-8222-222222222222', version: '01.00.000' }),
    );
    const desiredAction = scopeAction(desiredRemote, {
      action_id: 'save',
      action: 'save_draft',
      table: 'processes',
      id: '22222222-2222-4222-8222-222222222222',
      desired_payload_path: 'desired.json',
    });
    await assert.rejects(
      () =>
        planScenario(
          'desired-invalid',
          desiredRemote,
          scopeValue(desiredRemote, [desiredAction]),
          [],
        ),
      /must be a JSON object/u,
    );
    const wrongIdentity = await planScenario(
      'desired-identity',
      desiredRemote,
      scopeValue(desiredRemote, [desiredAction]),
      processPayload({ id: 'wrong-id', version: '01.00.000' }),
    );
    assert.match(
      wrongIdentity.blockers.map((entry) => entry.code).join(','),
      /DESIRED_PAYLOAD_IDENTITY_MISMATCH/u,
    );
    assert.equal(wrongIdentity.protected_rows[0]?.reason, 'blocked_action_row');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('maintenance internals preserve canonical hashes and detect deleted-target references', () => {
  const row: DatasetMaintenanceRemoteRow = {
    table: 'processes',
    id: 'proc',
    version: '01.00.000',
    user_id: 'user',
    state_code: 0,
    modified_at: null,
    json_ordered: processPayload({
      id: 'proc',
      version: '01.00.000',
      sourceId: 'source',
    }),
    model_id: null,
    rule_verification: null,
  };
  const action = {
    action_id: 'delete',
    action: 'delete' as const,
    table: 'sources' as const,
    id: 'source',
    version: '01.00.000',
    expected_user_id: 'user',
    expected_state_code: 0 as const,
    reason_code: 'test',
    reason: 'test',
    evidence: [],
    ordinal: 0,
    status: 'ready' as const,
    before: null,
    desired_payload: null,
    blockers: [],
    rollback: {
      strategy: 'restore_deleted_before_snapshot' as const,
      before_payload_sha256: null,
      before_payload: null,
      model_id: null,
      rule_verification: null,
    },
  };
  assert.equal(snapshotRemoteRow(row).row_sha256.length, 64);
  assert.equal(
    planInternals.referenceImpacts({ rows: [row], deletes: [action], phase: 'current' }).length,
    1,
  );
  assert.equal(
    verifyInternals.deletedTargetReferences({ rows: [row], deletes: [action] }).length,
    1,
  );
  assert.equal(typeof applyInternals.parseProgress, 'function');
});

test('maintenance planning and remote helpers cover sparse references and runtime fallbacks', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-maintenance-plan-fallbacks-'));
  const remote = new FakeMaintenanceRemote('plan-runtime-fallbacks');
  try {
    assert.deepEqual(planInternals.desiredPayloadIdentity({}), { id: null, version: null });

    const unsupportedReferenceRow: DatasetMaintenanceRemoteRow = {
      table: 'processes',
      id: 'unsupported-reference',
      version: '01.00.000',
      user_id: remote.userId,
      state_code: 0,
      modified_at: null,
      json_ordered: {
        processDataSet: {
          customReference: { '@refObjectId': 'source-without-a-table-hint' },
        },
      },
      model_id: null,
      rule_verification: null,
    };
    const deleteAction = scopeAction(remote);
    assert.deepEqual(
      planInternals.referenceImpacts({
        rows: [unsupportedReferenceRow],
        deletes: [deleteAction],
        phase: 'current',
      }),
      [],
    );
    assert.deepEqual(
      verifyInternals.deletedTargetReferences({
        rows: [unsupportedReferenceRow],
        deletes: [
          {
            ...deleteAction,
            ordinal: 0,
            status: 'ready',
            before: null,
            desired_payload: null,
            blockers: [],
            rollback: {
              strategy: 'restore_deleted_before_snapshot',
              before_payload_sha256: null,
              before_payload: null,
              model_id: null,
              rule_verification: null,
            },
          } as DatasetMaintenancePlanAction,
        ],
      }),
      [],
    );

    const referencedRows = ['process-b', 'process-a'].map(
      (id): DatasetMaintenanceRemoteRow => ({
        table: 'processes',
        id,
        version: '01.00.000',
        user_id: remote.userId,
        state_code: 0,
        modified_at: null,
        json_ordered: processPayload({
          id,
          version: '01.00.000',
          sourceId: '33333333-3333-4333-8333-333333333333',
        }),
        model_id: null,
        rule_verification: null,
      }),
    );
    const sortedImpacts = planInternals.referenceImpacts({
      rows: referencedRows,
      deletes: [deleteAction],
      phase: 'current',
    });
    assert.deepEqual(
      sortedImpacts.map((impact) => impact.source_id),
      ['process-a', 'process-b'],
    );

    remote.add(
      'sources',
      '33333333-3333-4333-8333-333333333333',
      sourcePayload('33333333-3333-4333-8333-333333333333'),
    );
    const scopePath = path.join(root, 'scope.json');
    writeFileSync(scopePath, JSON.stringify(scopeValue(remote)));
    const plan = await runDatasetMaintenancePlan({
      scopePath,
      operation: 'delete',
      outDir: path.join(root, 'out'),
      env: remote.env,
      fetchImpl: remote.fetch,
    });
    assert.match(plan.generated_at_utc, /^\d{4}-\d{2}-\d{2}T/u);

    const nonObjectUserRemote = new FakeMaintenanceRemote('non-object-current-user');
    await assert.rejects(
      () =>
        resolveMaintenanceRemoteContext({
          env: nonObjectUserRemote.env,
          fetchImpl: async (input, init) =>
            String(input).endsWith('/auth/v1/user')
              ? jsonResponse([])
              : nonObjectUserRemote.fetch(input, init),
        }),
      /did not return id and email/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('maintenance apply defensively records resume, readback, actor, redo, and pending edges', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-maintenance-apply-defensive-'));
  try {
    const resume = await prepareSeededScenario(root, 'resume-delete');
    const saveAction = resume.plan.actions.find((action) => action.action === 'save_draft')!;
    const deleteAction = resume.plan.actions.find((action) => action.action === 'delete')!;
    const current = await fetchMaintenanceAccountRows({
      context: resume.context,
      userId: resume.remote.userId,
    });
    const resumedProgress = applyInternals.parseProgress(
      resume.plan,
      path.join(root, 'missing-progress.jsonl'),
    );
    resumedProgress.successes.set(
      deleteAction.action_id,
      successProgressEntry(resume.plan, deleteAction),
    );
    applyInternals.assertApplyPreconditions({
      plan: resume.plan,
      planDir: resume.files.outDir,
      currentRows: current.rows.filter((row) => row.table !== 'sources'),
      progress: resumedProgress,
    });

    await assert.rejects(
      () =>
        applyInternals.executeAction({
          action: { ...saveAction, before: null },
          plan: resume.plan,
          planDir: resume.files.outDir,
          context: resume.context,
        }),
      /lacks a before snapshot/u,
    );
    await assert.rejects(
      () =>
        applyInternals.executeAction({
          action: {
            ...saveAction,
            id: 'missing-row',
          },
          plan: resume.plan,
          planDir: resume.files.outDir,
          context: resume.context,
        }),
      /immediately before write/u,
    );

    const fallback = await prepareSeededScenario(root, 'optional-before-metadata');
    const fallbackAction = fallback.plan.actions.find((action) => action.action === 'save_draft')!;
    let beforeReads = 0;
    const actionWithVanishingOptionalMetadata = { ...fallbackAction };
    Object.defineProperty(actionWithVanishingOptionalMetadata, 'before', {
      enumerable: true,
      get() {
        beforeReads += 1;
        return beforeReads <= 2 ? fallbackAction.before : null;
      },
    });
    const fallbackResult = await applyInternals.executeAction({
      action: actionWithVanishingOptionalMetadata,
      plan: fallback.plan,
      planDir: fallback.files.outDir,
      context: fallback.context,
    });
    assert.equal(fallbackResult.afterSha256?.length, 64);
    assert.equal(beforeReads, 4);

    const missingReadback = await prepareSeededScenario(root, 'missing-save-readback');
    const missingReadbackAction = missingReadback.plan.actions.find(
      (action) => action.action === 'save_draft',
    )!;
    const missingReadbackContext = {
      ...missingReadback.context,
      fetch_impl: (async (input, init) => {
        const response = await missingReadback.remote.fetch(input, init);
        if (String(input).includes('/rpc/cmd_dataset_save_draft')) {
          missingReadback.remote.rows.set('processes', []);
        }
        return response;
      }) as FetchLike,
    };
    await assert.rejects(
      () =>
        applyInternals.executeAction({
          action: missingReadbackAction,
          plan: missingReadback.plan,
          planDir: missingReadback.files.outDir,
          context: missingReadbackContext,
        }),
      /save_draft readback failed/u,
    );

    const mismatchReadback = await prepareSeededScenario(root, 'mismatch-save-readback');
    const mismatchAction = mismatchReadback.plan.actions.find(
      (action) => action.action === 'save_draft',
    )!;
    const mismatchContext = {
      ...mismatchReadback.context,
      fetch_impl: (async (input, init) => {
        const response = await mismatchReadback.remote.fetch(input, init);
        if (String(input).includes('/rpc/cmd_dataset_save_draft')) {
          mismatchReadback.remote.rows.get('processes')![0]!.state_code = 100;
        }
        return response;
      }) as FetchLike,
    };
    await assert.rejects(
      () =>
        applyInternals.executeAction({
          action: mismatchAction,
          plan: mismatchReadback.plan,
          planDir: mismatchReadback.files.outDir,
          context: mismatchContext,
        }),
      /save_draft readback mismatch/u,
    );

    const deleteReadback = await prepareSeededScenario(root, 'delete-readback');
    const deleteReadbackAction = deleteReadback.plan.actions.find(
      (action) => action.action === 'delete',
    )!;
    const deleteReadbackContext = {
      ...deleteReadback.context,
      fetch_impl: (async (input, init) =>
        String(input).includes('/rpc/cmd_dataset_delete')
          ? jsonResponse({ ok: true })
          : deleteReadback.remote.fetch(input, init)) as FetchLike,
    };
    await assert.rejects(
      () =>
        applyInternals.executeAction({
          action: deleteReadbackAction,
          plan: deleteReadback.plan,
          planDir: deleteReadback.files.outDir,
          context: deleteReadbackContext,
        }),
      /delete readback failed/u,
    );

    const actorMismatch = await prepareSeededScenario(root, 'actor-mismatch');
    await assert.rejects(
      () =>
        runDatasetMaintenanceApply({
          planPath: path.join(actorMismatch.files.outDir, 'maintenance-plan.json'),
          commit: true,
          approvePlan: actorMismatch.plan.plan_sha256,
          confirm: actorMismatch.remote.email,
          env: actorMismatch.remote.env,
          fetchImpl: async (input, init) =>
            String(input).endsWith('/auth/v1/user')
              ? jsonResponse({ id: actorMismatch.remote.userId, email: 'other@example.com' })
              : actorMismatch.remote.fetch(input, init),
        }),
      /does not match the maintenance plan/u,
    );

    const pending = await prepareSeededScenario(root, 'pending-after-failure');
    const pendingReport = await runDatasetMaintenanceApply({
      planPath: path.join(pending.files.outDir, 'maintenance-plan.json'),
      commit: true,
      approvePlan: pending.plan.plan_sha256,
      confirm: pending.remote.email,
      env: pending.remote.env,
      fetchImpl: async (input, init) =>
        String(input).includes('/rpc/cmd_dataset_save_draft')
          ? jsonResponse({ message: 'save failed' }, 500)
          : pending.remote.fetch(input, init),
    });
    assert.deepEqual(
      pendingReport.actions.map((action) => action.status),
      ['pending', 'failed'],
    );

    const redoRoot = path.join(root, 'redo-delete');
    mkdirSync(redoRoot, { recursive: true });
    const redoRemote = new FakeMaintenanceRemote('redo-delete');
    for (const id of [
      '33333333-3333-4333-8333-333333333333',
      '66666666-6666-4666-8666-666666666666',
    ]) {
      redoRemote.add('sources', id, sourcePayload(id));
    }
    const redoScopePath = path.join(redoRoot, 'scope.json');
    writeFileSync(
      redoScopePath,
      JSON.stringify(
        scopeValue(redoRemote, [
          scopeAction(redoRemote),
          scopeAction(redoRemote, {
            action_id: 'delete-source-2',
            id: '66666666-6666-4666-8666-666666666666',
          }),
        ]),
      ),
    );
    const deletePlan = await runDatasetMaintenancePlan({
      scopePath: redoScopePath,
      operation: 'delete',
      outDir: path.join(redoRoot, 'planned'),
      env: redoRemote.env,
      fetchImpl: redoRemote.fetch,
      now: new Date('2026-07-11T00:00:00.000Z'),
    });
    const redoPlan = structuredClone(deletePlan);
    redoPlan.operation = 'redo-import';
    redoPlan.source_import_run_id = null;
    redoPlan.source_lineage = { manifest: 'bafu-redo-source-manifest.json' };
    redoPlan.plan_sha256 = computePlanSha256(redoPlan);
    const redoPlanPath = path.join(redoRoot, 'apply', 'maintenance-plan.json');
    writeImmutableJson(redoPlanPath, redoPlan);
    const redoReport = await runDatasetMaintenanceApply({
      planPath: redoPlanPath,
      commit: true,
      approvePlan: redoPlan.plan_sha256,
      confirm: redoRemote.email,
      env: redoRemote.env,
      fetchImpl: redoRemote.fetch,
    });
    assert.equal(redoReport.status, 'completed');
    assert.match(
      readFileSync(path.join(path.dirname(redoPlanPath), 'approval-record.json'), 'utf8'),
      /"redo_rows_ready":true/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('maintenance verify reports every incomplete readback proof without mutating rows', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-maintenance-verify-defensive-'));
  try {
    const scenario = await prepareSeededScenario(root, 'pre-apply');
    const planPath = path.join(scenario.files.outDir, 'maintenance-plan.json');
    const report = await runDatasetMaintenanceVerify({
      planPath,
      outDir: path.join(root, 'verify-before-apply'),
      env: scenario.remote.env,
      fetchImpl: scenario.remote.fetch,
    });
    const codes = report.issues.map((entry) => entry.code).join(',');
    assert.match(codes, /DELETE_TARGET_STILL_VISIBLE/u);
    assert.match(codes, /SAVE_DRAFT_READBACK_MISMATCH/u);
    assert.match(codes, /PROJECTED_REFERENCE_CLOSURE_MISMATCH/u);
    assert.match(codes, /DELETED_TARGET_REFERENCED/u);
    assert.match(codes, /ACTION_SUCCESS_LOG_MISSING/u);
    assert.match(codes, /COMMIT_REPORT_MISSING/u);

    writeFileSync(path.join(scenario.files.outDir, 'approval-record.json'), '{}');
    const malformedRollbackEntry = {
      ...successProgressEntry(scenario.plan, scenario.plan.actions[0]!),
      rollback: null,
    };
    writeFileSync(
      path.join(scenario.files.outDir, 'apply-progress.jsonl'),
      [
        'null',
        '{"action_id":"foreign-action"}',
        '{"action_id":"delete-source"}',
        JSON.stringify(malformedRollbackEntry),
        '',
      ].join('\n'),
    );
    writeFileSync(path.join(scenario.files.outDir, 'commit-report.json'), '{}');
    const invalidProofReport = await runDatasetMaintenanceVerify({
      planPath,
      outDir: path.join(root, 'verify-invalid-proof-chain'),
      env: scenario.remote.env,
      fetchImpl: scenario.remote.fetch,
      now: new Date('2026-07-11T00:00:00.000Z'),
    });
    const invalidProofCodes = invalidProofReport.issues.map((entry) => entry.code).join(',');
    assert.match(invalidProofCodes, /APPROVAL_RECORD_INVALID/u);
    assert.match(invalidProofCodes, /APPLY_PROGRESS_ENTRY_INVALID/u);
    assert.match(invalidProofCodes, /COMMIT_REPORT_INCOMPLETE/u);

    scenario.remote.rows.set('flows', []);
    scenario.remote.rows.set('processes', []);
    const protectedReport = await runDatasetMaintenanceVerify({
      planPath,
      outDir: path.join(root, 'verify-protected-change'),
      env: scenario.remote.env,
      fetchImpl: scenario.remote.fetch,
      now: new Date('2026-07-11T00:00:00.000Z'),
    });
    assert.match(
      protectedReport.issues.map((entry) => entry.code).join(','),
      /PROTECTED_ROW_CHANGED/u,
    );

    await assert.rejects(
      () =>
        runDatasetMaintenanceVerify({
          planPath,
          env: scenario.remote.env,
          fetchImpl: async (input, init) =>
            String(input).endsWith('/auth/v1/user')
              ? jsonResponse({ id: scenario.remote.userId, email: 'other@example.com' })
              : scenario.remote.fetch(input, init),
        }),
      /does not match the maintenance plan/u,
    );

    assert.deepEqual(verifyInternals.issue('CODE', 'message'), {
      code: 'CODE',
      message: 'message',
    });
    assert.deepEqual(verifyInternals.issue('CODE', 'message', undefined, { detail: true }), {
      code: 'CODE',
      message: 'message',
      details: { detail: true },
    });
    const saveAction = scenario.plan.actions.find((action) => action.action === 'save_draft')!;
    assert.equal(
      verifyInternals.desiredPayload(scenario.files.outDir, {
        ...saveAction,
        desired_payload: null,
      }),
      null,
    );
    const invalidPayloadPath = path.join(scenario.files.outDir, 'payloads', 'invalid.json');
    writeFileSync(invalidPayloadPath, '[]');
    assert.equal(
      verifyInternals.desiredPayload(scenario.files.outDir, {
        ...saveAction,
        desired_payload: {
          path: 'payloads/invalid.json',
          sha256: '0'.repeat(64),
        },
      }),
      null,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
