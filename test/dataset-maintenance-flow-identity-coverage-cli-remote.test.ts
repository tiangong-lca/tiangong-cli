import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCli, type CliDeps } from '../src/cli.js';
import type { DotEnvLoadResult } from '../src/lib/dotenv.js';
import type { FetchLike } from '../src/lib/http.js';
import {
  attestMaintenanceFlowIdentityCapture,
  fetchMaintenanceAccountTableRows,
  finalizeMaintenanceFlowIdentityScope,
  preflightMaintenanceFlowIdentityScope,
  readMaintenanceFlowIdentityScope,
  rewriteMaintenanceFlowIdentityProcess,
  type DatasetMaintenanceRemoteContext,
} from '../src/lib/dataset-maintenance-remote.js';

const dotEnvStatus: DotEnvLoadResult = {
  loaded: false,
  path: '/tmp/.env',
  count: 0,
};

function response(value: unknown, contentRange?: string): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      ...(contentRange ? { 'content-range': contentRange } : {}),
    },
  });
}

function remoteContext(fetchImpl: FetchLike): DatasetMaintenanceRemoteContext {
  return {
    project_ref: 'production-ref',
    rest_base_url: 'https://production-ref.supabase.co/rest/v1',
    publishable_key: 'publishable',
    access_token: 'access',
    account: {
      user_id: 'owner-id',
      email: 'owner@example.com',
      session_source: 'test',
    },
    fetch_impl: fetchImpl,
    timeout_ms: 1_000,
  };
}

function cliDeps(overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    env: {},
    dotEnvStatus,
    fetchImpl: (async () => response({ ok: true })) as FetchLike,
    ...overrides,
  };
}

test('flow-identity single-table remote census preserves exact pagination fences', async () => {
  const urls: URL[] = [];
  const fetchImpl: FetchLike = async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    const withStateFence = url.searchParams.get('state_code') === 'eq.0';
    const rows = withStateFence
      ? [
          {
            id: '00000000-0000-4000-8000-000000000001',
            version: '00.00.001',
            user_id: 'owner-id',
            state_code: 0,
            modified_at: '2026-07-16T00:00:00.000Z',
            json: { flowDataSet: {} },
            json_ordered: { flowDataSet: {} },
            rule_verification: true,
          },
          {
            id: '00000000-0000-4000-8000-000000000002',
            version: '00.00.001',
            user_id: 'owner-id',
            state_code: 0,
            modified_at: '2026-07-16T00:00:01.000Z',
            json: { flowDataSet: { second: true } },
            json_ordered: { flowDataSet: { second: true } },
            rule_verification: false,
          },
        ]
      : [
          {
            id: '00000000-0000-4000-8000-000000000003',
            version: '00.00.001',
            user_id: 'owner-id',
            state_code: 100,
            modified_at: '2026-07-16T00:00:02.000Z',
            json_ordered: { flowDataSet: { third: true } },
            rule_verification: null,
          },
        ];
    return response(rows, `0-${rows.length - 1}/${rows.length}`);
  };
  const context = remoteContext(fetchImpl);

  const ownerDraft = await fetchMaintenanceAccountTableRows({
    context,
    userId: 'owner-id',
    table: 'flows',
    stateCode: 0,
    includeJson: true,
    pageSize: 2,
  });
  const allStates = await fetchMaintenanceAccountTableRows({
    context,
    userId: 'owner-id',
    table: 'flows',
    pageSize: 2,
  });

  assert.equal(ownerDraft.rows.length, 2);
  assert.deepEqual(
    ownerDraft.rows.map((row) => row.json),
    [{ flowDataSet: {} }, { flowDataSet: { second: true } }],
  );
  assert.equal(ownerDraft.completeness.rows_fetched, 2);
  assert.equal(allStates.rows.length, 1);
  assert.equal(allStates.completeness.rows_fetched, 1);
  assert.equal(urls.length, 2);
  assert.equal(urls[0]?.searchParams.get('state_code'), 'eq.0');
  assert.equal(urls[0]?.searchParams.get('select')?.includes('json,'), true);
  assert.equal(urls[1]?.searchParams.has('state_code'), false);
  assert.equal(urls[1]?.searchParams.get('select')?.includes('json,'), false);
  assert.deepEqual(
    urls.map((url) => [url.searchParams.get('limit'), url.searchParams.get('offset')]),
    [
      ['2', '0'],
      ['2', '0'],
    ],
  );

  await assert.rejects(
    fetchMaintenanceAccountTableRows({
      context: remoteContext((async () =>
        response(
          [
            {
              id: '00000000-0000-4000-8000-000000000004',
              version: '00.00.001',
              user_id: 'foreign-owner',
              state_code: 100,
              modified_at: '2026-07-16T00:00:03.000Z',
              json_ordered: { flowDataSet: {} },
              rule_verification: null,
            },
          ],
          '0-0/1',
        )) as FetchLike),
      userId: 'owner-id',
      table: 'flows',
      stateCode: 0,
      pageSize: 2,
    }),
    /account\/state fence/u,
  );
});

test('flow-identity remote RPC adapters bind wire bodies, timeouts, and domain failures', async () => {
  const calls: Array<{ rpc: string; body: unknown }> = [];
  const timeouts: number[] = [];
  const originalTimeout = AbortSignal.timeout;
  AbortSignal.timeout = ((milliseconds: number) => {
    timeouts.push(milliseconds);
    return originalTimeout(1_000);
  }) as typeof AbortSignal.timeout;
  const fetchImpl: FetchLike = async (input, init) => {
    const rpc = String(input).split('/rpc/')[1] ?? '';
    calls.push({ rpc, body: JSON.parse(String(init?.body)) });
    return response(
      rpc === 'cmd_dataset_flow_identity_scope_read'
        ? {
            ok: false,
            schema_version: 'dataset-flow-identity-scope-status.v2',
            code: 'FLOW_IDENTITY_SCOPE_PENDING',
          }
        : { ok: true },
    );
  };
  const context = remoteContext(fetchImpl);
  const scopeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  try {
    await preflightMaintenanceFlowIdentityScope({
      context,
      request: { operation_id: 'operation-1' },
    });
    await rewriteMaintenanceFlowIdentityProcess({
      context,
      scopeId,
      request: { ordinal: 1 },
    });
    const read = await readMaintenanceFlowIdentityScope({ context, scopeId });
    assert.equal(read.ok, false);
    await finalizeMaintenanceFlowIdentityScope({
      context,
      scopeId,
      request: { finalize: true },
    });
    await attestMaintenanceFlowIdentityCapture({
      context,
      request: { request_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    });
  } finally {
    AbortSignal.timeout = originalTimeout;
  }

  assert.deepEqual(
    calls.map(({ rpc }) => rpc),
    [
      'cmd_dataset_flow_identity_scope_preflight_guarded',
      'cmd_dataset_flow_identity_process_rewrite_guarded',
      'cmd_dataset_flow_identity_scope_read',
      'cmd_dataset_flow_identity_scope_finalize_guarded',
      'cmd_dataset_flow_identity_capture_attest_guarded',
    ],
  );
  assert.deepEqual(
    calls.map(({ body }) => body),
    [
      { p_request: { operation_id: 'operation-1' } },
      { p_scope_id: scopeId, p_request: { ordinal: 1 } },
      { p_scope_id: scopeId },
      { p_scope_id: scopeId, p_request: { finalize: true } },
      { p_request: { request_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } },
    ],
  );
  assert.deepEqual(timeouts, [130_000, 90_000, 90_000, 190_000, 190_000]);
});

test('flow-identity CLI exposes parser and fail-closed command guards', async () => {
  const deps = cliDeps();
  const noAction = await executeCli(['dataset', 'maintenance', 'flow-identity'], deps);
  assert.equal(noAction.exitCode, 0);
  assert.match(noAction.stdout, /capture\|plan\|freeze\|seal-approval\|run\|verify/u);

  const actionHelp = await executeCli(
    ['dataset', 'maintenance', 'flow-identity', 'capture', '--help'],
    deps,
  );
  assert.equal(actionHelp.exitCode, 0);

  const parseFailure = await executeCli(
    ['dataset', 'maintenance', 'flow-identity', 'capture', '--unknown'],
    deps,
  );
  assert.equal(parseFailure.exitCode, 2);
  assert.match(parseFailure.stderr, /INVALID_ARGS/u);

  const missingRequired = await executeCli(
    ['dataset', 'maintenance', 'flow-identity', 'capture'],
    deps,
  );
  assert.equal(missingRequired.exitCode, 2);
  assert.match(missingRequired.stderr, /DATASET_FLOW_IDENTITY_ARGUMENT_REQUIRED/u);

  const invalidRunMode = await executeCli(['dataset', 'maintenance', 'flow-identity', 'run'], deps);
  assert.equal(invalidRunMode.exitCode, 2);
  assert.match(invalidRunMode.stderr, /DATASET_FLOW_IDENTITY_RUN_MODE_INVALID/u);

  const invalidAction = await executeCli(
    ['dataset', 'maintenance', 'flow-identity', 'not-an-action'],
    deps,
  );
  assert.equal(invalidAction.exitCode, 2);
  assert.match(invalidAction.stderr, /DATASET_FLOW_IDENTITY_ACTION_INVALID/u);
});

test('flow-identity CLI commit and failed verify branches use injected implementations', async () => {
  let runOptions: unknown;
  const runDeps = cliDeps({
    runFlowIdentityImpl: async (options) => {
      runOptions = options;
      return { status: 'passed' } as never;
    },
  });
  const run = await executeCli(
    [
      'dataset',
      'maintenance',
      'flow-identity',
      'run',
      '--plan',
      'plan.json',
      '--freeze',
      'freeze.json',
      '--approval',
      'approval.json',
      '--out-dir',
      'run-out',
      '--commit',
      '--approve-execution',
      'approval-hash',
      '--confirm',
      'owner@example.com',
      '--poll-ms',
      '25',
      '--timeout-ms',
      '5000',
      '--json',
    ],
    runDeps,
  );
  assert.equal(run.exitCode, 0);
  assert.deepEqual(runOptions, {
    planPath: 'plan.json',
    freezePath: 'freeze.json',
    approvalPath: 'approval.json',
    outDir: 'run-out',
    commit: true,
    statusOnly: false,
    approveExecution: 'approval-hash',
    confirm: 'owner@example.com',
    waitSeconds: undefined,
    pollMs: 25,
    timeoutMs: 5000,
    env: {},
    fetchImpl: runDeps.fetchImpl,
  });

  let verifyOptions: unknown;
  const deps = cliDeps({
    verifyFlowIdentityImpl: async (options) => {
      verifyOptions = options;
      return { status: 'failed' } as never;
    },
  });
  const verify = await executeCli(
    [
      'dataset',
      'maintenance',
      'flow-identity',
      'verify',
      '--plan',
      'plan.json',
      '--freeze',
      'freeze.json',
      '--approval',
      'approval.json',
      '--run-dir',
      'run-out',
      '--out-dir',
      'verify-out',
    ],
    deps,
  );
  assert.equal(verify.exitCode, 1);
  assert.deepEqual(verifyOptions, {
    planPath: 'plan.json',
    freezePath: 'freeze.json',
    approvalPath: 'approval.json',
    runDir: 'run-out',
    outDir: 'verify-out',
    pageSize: undefined,
    timeoutMs: undefined,
    env: {},
    fetchImpl: deps.fetchImpl,
  });
});
