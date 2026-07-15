import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAliasBatchRequest } from '../src/lib/dataset-maintenance-alias-request.js';
import {
  buildProtectedAdmitRequest,
  buildProtectedPreflightRequest,
  parseProtectedGateProof,
  parseProtectedPreflightProof,
  parseProtectedStatusProof,
  type ProtectedExecutionIdentity,
} from '../src/lib/dataset-maintenance-protected-contract.js';

const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function identity(): ProtectedExecutionIdentity {
  const derivativeTargets = Array.from({ length: 50 }, (_, index) => ({
    table: index < 23 ? ('flows' as const) : ('processes' as const),
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    version: '00.00.001',
    user_id: USER_ID,
    state_code: 0 as const,
    baseline_snapshot_sha256: HASH,
  }));
  return {
    request_id: REQUEST_ID,
    identity_sha256: HASH,
    environment: 'production',
    project_ref: 'production-ref',
    actor: { user_id: USER_ID, email: 'bafudata@126.com' },
    target_visibility: 'owner_draft',
    plan_sha256: HASH,
    operation_id: 'bafu-step-2',
    bindings: {
      plan_file_sha256: HASH,
      freeze_file_sha256: HASH,
      freeze_sha256: HASH,
      approval_file_sha256: HASH,
      approval_identity_sha256: HASH,
      approval_text_sha256: HASH,
      alias_plan_request_sha256: HASH,
      before_hash_set_sha256: HASH,
      desired_hash_set_sha256: HASH,
      exchange_rewrite_set_sha256: HASH,
      support_snapshot_set_sha256: HASH,
      derivative_baseline_set_sha256: HASH,
      derivative_target_set_sha256: HASH,
      toolchain_evidence_sha256: HASH,
    },
    expected: {
      action_count: 52,
      batch_count: 2,
      exchange_count: 59,
      amount_field_count: 118,
      unrelated_exchange_count: 309,
      audit_count: 55,
      flowproperty_count: 2,
      flow_count: 23,
      process_count: 27,
      derivative_target_count: 50,
    },
    derivative_targets: derivativeTargets,
  };
}

function preflightResponse() {
  return {
    ok: true,
    command: 'cmd_dataset_alias_execution_preflight_guarded',
    schema_version: 'dataset-alias-execution-preflight-proof.v1',
    request_id: REQUEST_ID,
    actor_user_id: USER_ID,
    environment: 'production',
    project_ref: 'production-ref',
    server_context_sha256: HASH,
    plan_sha256: HASH,
    operation_id: 'bafu-step-2',
    alias_plan_request_sha256: HASH,
    freeze_sha256: HASH,
    approval_identity_sha256: HASH,
    plan_request_sha256: HASH,
    bindings_sha256: HASH,
    expected_sha256: HASH,
    derivative_targets_sha256: HASH,
    gate_expectations: {
      primary_support_plan_sha256: HASH,
      execution_unused_sha256: HASH,
      derivative_quiescence_sha256: HASH,
    },
    gate_expectations_sha256: HASH,
    failure_baseline_sha256: HASH,
    preflight_request_sha256: HASH,
    preflight_token: HASH,
    preflight_proof_sha256: HASH,
    completed_at: '2026-07-15T00:00:00.000Z',
    expires_at: '2026-07-15T00:01:00.000Z',
    simulation: {
      plan_rows: 52,
      plan_exchanges: 59,
      alias_audits: 55,
      derivative_targets: 50,
      rolled_back: true,
    },
  };
}

test('protected preflight sends exactly the six sealed derivative target fields', () => {
  const request = buildProtectedPreflightRequest({
    identity: identity(),
    plan: { plan: true },
    freeze: { frozen: true } as never,
    approval: { approved: true } as never,
  });
  assert.deepEqual(Object.keys(request).sort(), [
    'actor',
    'approval',
    'bindings',
    'derivative_targets',
    'environment',
    'expected',
    'freeze',
    'plan',
    'project_ref',
    'request_id',
    'schema_version',
    'target_visibility',
  ]);
  const target = (request.derivative_targets as Array<Record<string, unknown>>)[0]!;
  assert.deepEqual(Object.keys(target).sort(), [
    'baseline_snapshot_sha256',
    'id',
    'state_code',
    'table',
    'user_id',
    'version',
  ]);
  assert.equal('expected_json_ordered_sha256' in target, false);
});

test('protected preflight, server gate receipt, and five-key admission bind together', () => {
  const sealed = identity();
  const preflight = parseProtectedPreflightProof(
    preflightResponse(),
    sealed,
    new Date('2026-07-15T00:00:30.000Z'),
  );
  assert.equal(preflight.failure_baseline_sha256, HASH);
  const gate = parseProtectedGateProof(
    {
      ok: true,
      command: 'cmd_dataset_alias_execution_gate_guarded',
      schema_version: 'dataset-alias-execution-gate-receipt.v1',
      request_id: REQUEST_ID,
      actor_user_id: USER_ID,
      preflight_proof_sha256: HASH,
      gate: 'primary_support_plan',
      expected_sha256: HASH,
      observed_sha256: HASH,
      status: 'passed',
      captured_at: '2026-07-15T00:00:40.000Z',
      receipt_sha256: OTHER_HASH,
    },
    { identity: sealed, preflight, gate: 'primary_support_plan' },
  );
  assert.equal(gate.receipt_sha256, OTHER_HASH);
  const admission = buildProtectedAdmitRequest({
    preflight,
    gateResults: {
      primary_support_plan: gate.result,
      execution_unused: gate.result,
      derivative_quiescence: gate.result,
    },
  });
  assert.deepEqual(Object.keys(admission).sort(), [
    'gate_results',
    'preflight_proof_sha256',
    'preflight_token',
    'request_id',
    'schema_version',
  ]);
});

test('status-only read normalizes a server not-admitted proof without dispatch state', () => {
  const proof = parseProtectedStatusProof(
    {
      ok: true,
      command: 'cmd_dataset_alias_execution_read',
      schema_version: 'dataset-alias-execution-status.v1',
      request_id: REQUEST_ID,
      status: 'indeterminate',
      execution_status: 'not_admitted',
      retry_allowed: false,
      actor_user_id: USER_ID,
      environment: 'production',
      project_ref: 'production-ref',
      plan_sha256: HASH,
      operation_id: 'bafu-step-2',
      plan_request_sha256: HASH,
      preflight_proof_sha256: HASH,
      gate_count: 0,
      gates: [],
    },
    identity(),
  );
  assert.equal(proof.status, 'indeterminate');
  assert.equal(proof.execution_status, 'not_admitted');
  assert.equal(proof.attempt_count, 0);
  assert.equal(proof.dispatch_count, 0);
  assert.equal(proof.derivative_readback.status, 'not_started');
});

test('alias request extraction rejects a batch whose action evidence is incomplete', () => {
  assert.throws(
    () =>
      buildAliasBatchRequest({
        plan: { target_mode: 'owner_draft', actions: [] } as never,
        planDir: '.',
        batch: { action_ids: ['missing-action'] } as never,
      }),
    /Alias action is incomplete/u,
  );
});
