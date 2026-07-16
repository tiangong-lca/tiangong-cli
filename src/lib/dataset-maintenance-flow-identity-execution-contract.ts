import {
  assertCurrentFlowIdentityAuthority,
  parseFlowIdentityPlan,
  type FlowIdentityPlan,
  type FlowIdentityProcessManifest,
} from './dataset-maintenance-flow-identity-contract.js';
import {
  isJsonObject,
  sha256Json,
  sha256Text,
  type JsonObject,
} from './dataset-maintenance-contract.js';
import { flowIdentityRestrictedSha256 } from './dataset-maintenance-flow-identity-wire.js';
import { CliError } from './errors.js';

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

export type FlowIdentityFreeze = {
  schema_version: 'dataset-flow-identity-freeze.v2';
  generated_at_utc: string;
  environment: 'production';
  project_ref: string;
  actor: { user_id: string; email: string };
  plan_sha256: string;
  operation_id: string;
  capture_artifact_sha256: string;
  receipt_id: string;
  receipt_proof_sha256: string;
  capture_request_sha256: string;
  source_guard_set_sha256: string;
  support_guard_set_sha256: string;
  target_guard_set_sha256: string;
  mapping_guard_set_sha256: string;
  process_intent_set_sha256: string;
  receipt_protected_closure_sha256: string;
  capture_whole_scope_proof_sha256: string;
  source_universe_artifact_sha256: string;
  support_snapshot_artifact_sha256: string;
  mapping_artifact_sha256: string;
  process_manifest_artifact_sha256: string;
  protected_closure_artifact_sha256: string;
  policy_approval_text_sha256: string;
  toolchain_evidence_sha256: string;
  freeze_sha256: string;
};

export type FlowIdentityApproval = {
  schema_version: 'dataset-flow-identity-execution-approval.v2';
  approved_at_utc: string;
  actor: { user_id: string; email: string };
  plan_sha256: string;
  freeze_sha256: string;
  toolchain_evidence_sha256: string;
  policy_approval_text_sha256: string;
  execution_approval_request_sha256: string;
  execution_approval_text_sha256: string;
  execution_approval_identity_sha256: string;
};

export type FlowIdentityExecutionIdentity = {
  request_id: string;
  identity_sha256: string;
  environment: 'production';
  project_ref: string;
  actor: { user_id: string; email: string };
  target_visibility: 'owner_draft';
  operation_id: string;
  plan_sha256: string;
  freeze_sha256: string;
  receipt_id: string;
  receipt_proof_sha256: string;
  policy_approval_text_sha256: string;
  execution_approval_request_sha256: string;
  execution_approval_text_sha256: string;
  execution_approval_identity_sha256: string;
  toolchain_evidence_sha256: string;
};

export type FlowIdentityScopePreflightProof = {
  ok: true;
  command: 'cmd_dataset_flow_identity_scope_preflight_guarded';
  schema_version: 'dataset-flow-identity-scope-preflight-result.v2';
  receipt_id: string;
  receipt_proof_sha256: string;
  scope_id: string;
  operation_id: string;
  plan_sha256: string;
  scope_proof_sha256: string;
  status: 'sealed' | 'running' | 'primary_complete' | 'derivatives_pending' | 'completed';
  process_count: number;
  mapping_count: number;
  mapping_guard_set_sha256: string;
  process_intent_set_sha256: string;
  support_snapshot_count: number;
  source_universe_count: 305;
  rewrite_count: number;
  next_ordinal: number;
  audit_id: string;
  replay: boolean;
};

export type FlowIdentityProcessProof = {
  ok: true;
  command: 'cmd_dataset_flow_identity_process_rewrite_guarded';
  schema_version: 'dataset-flow-identity-process-rewrite-result.v2';
  scope_id: string;
  receipt_id: string;
  receipt_proof_sha256: string;
  mapping_guard_set_sha256: string;
  process_intent_set_sha256: string;
  ordinal: number;
  process_id: string;
  process_version: string;
  process_request_sha256: string;
  process_intent_proof_sha256: string;
  desired_payload_sha256: string;
  desired_exchange_set_sha256: string;
  completed_process_count: number;
  next_ordinal: number | null;
  primary_complete: boolean;
  before_payload_sha256: string;
  before_exchange_set_sha256: string;
  after_payload_sha256: string;
  after_exchange_set_sha256: string;
  rewrite_count: number;
  audit_id: string;
  derivative_batch_id: string;
  status: 'completed';
  replay: boolean;
};

export type FlowIdentityScopeProcessStatus = {
  ordinal: number;
  id: string;
  version: string;
  status: 'pending' | 'completed' | 'failed';
  process_request_sha256: string | null;
  process_intent_proof_sha256: string;
  desired_payload_sha256: string;
  desired_exchange_set_sha256: string;
  rewrite_count: number;
  audit_id: string | null;
  before_payload_sha256: string;
  before_exchange_set_sha256: string;
  after_payload_sha256: string | null;
  after_exchange_set_sha256: string | null;
  derivative_batch_id: string | null;
  derivative_request_id: string | null;
  derivative_status: string | null;
  causal_terminal_proof: unknown;
  completed_at: string | null;
  last_error: unknown;
};

export type FlowIdentityDerivativeResidue = {
  http_requests: number;
  embedding_jobs: number;
  pending_jobs: number;
  failure_rows: number;
  other_active_fences: number;
};

export type FlowIdentityDerivativeTargetProof = {
  ordinal: number;
  id: string;
  version: string;
  original_batch_id: string;
  effective_reference_id: string | null;
  effective_reference_kind: 'protected_batch' | 'separate_compensation';
  status: 'completed' | 'pending' | 'failed';
  request_status:
    | 'queued'
    | 'dispatching'
    | 'markdown_pending'
    | 'embedding_pending'
    | 'completed'
    | 'stale'
    | 'failed'
    | 'missing';
  phase: string;
  lineage_ok: boolean;
  proposals_committed: boolean;
  terminal_audit_present: boolean;
  residue: FlowIdentityDerivativeResidue;
  current_snapshot_sha256: string;
  current_json_ordered_sha256: string;
  causal_terminal_proof: boolean;
};

export type FlowIdentityDerivativeSetProof = {
  ok: boolean;
  schema_version: 'dataset-flow-identity-derivative-set-proof.v1';
  scope_id: string;
  status: 'failed' | 'compensation_required' | 'pending' | 'completed';
  target_count: number;
  completed_count: number;
  pending_count: number;
  failed_count: number;
  causal_terminal_proof: boolean;
  targets: FlowIdentityDerivativeTargetProof[];
  compensation_targets: FlowIdentityCompensationTarget[];
  proof_sha256: string;
};

export type FlowIdentityCompensationTarget = {
  ordinal: number;
  table: 'processes';
  id: string;
  version: string;
  original_batch_id: string;
  original_request_id?: string | null;
  original_status: 'failed' | 'stale' | 'missing';
  original_error?: unknown;
  original_code?: string;
  desired_payload_sha256: string;
  current_json_ordered_sha256: string;
  current_snapshot_sha256: string;
  current_modified_at: string;
  components: ['extracted_md', 'embedding_ft'];
  reason_code: string;
  operation_id_prefix: string;
  latest_compensation_request_id: string | null;
  latest_compensation_status: string | null;
  latest_compensation_plan_sha256: string | null;
  requires_new_plan_freeze_approval: true;
  automatic_retry: false;
};

export type FlowIdentityWholeScopeProof = {
  schema_version: 'dataset-flow-identity-whole-scope-proof.v2';
  scope_id: string;
  receipt_id: string;
  primary_current: boolean;
  audit_current: boolean;
  source_guards_current: boolean;
  support_guards_current: boolean;
  target_guards_current: boolean;
  approved_reference_residue_count: number;
  protected_closure_current: boolean;
  occurrence_closure_current: boolean;
  derivatives_current: boolean;
  primary_closure_sha256: string;
  source_guard_set_sha256: string;
  support_guard_set_sha256: string;
  target_guard_set_sha256: string;
  protected_closure_sha256: string;
  derivative_proof_set_sha256: string;
  causal_terminal_proof: boolean;
  proof_sha256: string;
};

export type FlowIdentityScopeStatus = {
  ok: boolean;
  command: 'cmd_dataset_flow_identity_scope_read';
  schema_version: 'dataset-flow-identity-scope-status.v2';
  scope_id: string;
  receipt_id: string;
  receipt_proof_sha256: string;
  mapping_guard_set_sha256: string;
  process_intent_set_sha256: string;
  operation_id: string;
  plan_sha256: string;
  scope_proof_sha256: string;
  status:
    | 'sealed'
    | 'running'
    | 'primary_complete'
    | 'derivatives_pending'
    | 'completed'
    | 'live_drift'
    | 'failed';
  process_count: number;
  rewrite_count: number;
  completed_process_count: number;
  pending_process_count: number;
  failed_process_count: number;
  completed_rewrite_count: number;
  next_ordinal: number;
  primary_complete: boolean;
  primary_current: boolean;
  live_guard_current: boolean;
  derivatives_current: boolean;
  derivative_pending_count: number;
  derivative_failed_count: number;
  derivative_set_proof: FlowIdentityDerivativeSetProof;
  derivative_proof_set_sha256: string;
  protected_closure_current: boolean;
  protected_closure_proof: JsonObject;
  processes: FlowIdentityScopeProcessStatus[];
  terminal_proof_sha256: string | null;
  completed_at: string | null;
  cancellable: boolean;
  strict_continuation_required: boolean;
  whole_scope_proof: FlowIdentityWholeScopeProof;
  whole_scope_proof_sha256: string;
  code?: string;
  compensation_required?: boolean;
  automatic_retry?: false;
  compensation_targets?: FlowIdentityCompensationTarget[];
};

export type FlowIdentityFinalizeProof = {
  ok: boolean;
  command: 'cmd_dataset_flow_identity_scope_finalize_guarded';
  schema_version: 'dataset-flow-identity-scope-finalize-result.v2';
  scope_id: string;
  receipt_id: string;
  receipt_proof_sha256: string;
  mapping_guard_set_sha256: string;
  process_intent_set_sha256: string;
  operation_id: string;
  plan_sha256: string;
  scope_proof_sha256: string;
  status: 'derivatives_pending' | 'completed' | 'live_drift' | 'failed';
  process_count: number;
  rewrite_count: number;
  completed_process_count: number;
  primary_closure_sha256: string;
  protected_closure_sha256: string;
  derivative_target_set_sha256: string;
  derivative_proof_set_sha256: string;
  primary_current: boolean;
  live_guard_current: boolean;
  derivatives_current: boolean;
  terminal_proof_sha256: string | null;
  whole_scope_proof: FlowIdentityWholeScopeProof;
  whole_scope_proof_sha256: string;
  audit_id: string | null;
  replay: boolean;
  code?: string;
  compensation_required?: boolean;
  automatic_retry?: false;
  compensation_targets?: FlowIdentityCompensationTarget[];
};

function fail(message: string, code = 'DATASET_FLOW_IDENTITY_EXECUTION_CONTRACT_INVALID'): never {
  throw new CliError(message, { code, exitCode: 2 });
}

function token(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a non-empty string.`);
  return value.trim();
}

function hash(value: unknown, label: string): string {
  const normalized = token(value, label);
  if (!HASH_PATTERN.test(normalized)) fail(`${label} must be a lowercase SHA-256.`);
  return normalized;
}

function uuid(value: unknown, label: string): string {
  const normalized = token(value, label);
  if (!UUID_PATTERN.test(normalized)) fail(`${label} must be a canonical lowercase UUID.`);
  return normalized;
}

function instant(value: unknown, label: string): string {
  const normalized = token(value, label);
  if (!Number.isFinite(Date.parse(normalized))) fail(`${label} must be an RFC3339 timestamp.`);
  return normalized;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    fail(`${label} must be an integer >= ${minimum}.`);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label} must be boolean.`);
  return value;
}

function deterministicUuidFromSha256(digest: string): string {
  const chars = digest.slice(0, 32).split('');
  chars[12] = '5';
  chars[16] = ((Number.parseInt(chars[16]!, 16) & 0x3) | 0x8).toString(16);
  const hex = chars.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function computeFlowIdentityFreezeSha256(freeze: FlowIdentityFreeze): string {
  return sha256Json({ ...freeze, freeze_sha256: '' });
}

export function computeFlowIdentityApprovalIdentitySha256(approval: FlowIdentityApproval): string {
  return sha256Json({ ...approval, execution_approval_identity_sha256: '' });
}

export function parseFlowIdentityFreeze(
  value: unknown,
  plan: FlowIdentityPlan,
): FlowIdentityFreeze {
  if (!isJsonObject(value) || !isJsonObject(value.actor)) fail('Flow identity freeze is invalid.');
  const freeze = value as FlowIdentityFreeze;
  if (
    freeze.schema_version !== 'dataset-flow-identity-freeze.v2' ||
    freeze.environment !== 'production' ||
    plan.environment !== 'production' ||
    freeze.project_ref !== plan.project_ref ||
    freeze.actor.user_id !== plan.account.user_id ||
    freeze.actor.email !== plan.account.email ||
    freeze.plan_sha256 !== plan.plan_sha256 ||
    freeze.operation_id !== plan.operation_id ||
    freeze.capture_artifact_sha256 !== plan.capture_artifact_sha256 ||
    freeze.receipt_id !== plan.receipt_id ||
    freeze.receipt_proof_sha256 !== plan.receipt_proof_sha256 ||
    freeze.capture_request_sha256 !== plan.capture_request_sha256 ||
    freeze.source_guard_set_sha256 !== plan.source_guard_set_sha256 ||
    freeze.support_guard_set_sha256 !== plan.support_guard_set_sha256 ||
    freeze.target_guard_set_sha256 !== plan.target_guard_set_sha256 ||
    freeze.mapping_guard_set_sha256 !== plan.mapping_guard_set_sha256 ||
    freeze.process_intent_set_sha256 !== plan.process_intent_set_sha256 ||
    freeze.receipt_protected_closure_sha256 !== plan.receipt_protected_closure_sha256 ||
    freeze.capture_whole_scope_proof_sha256 !== plan.capture_whole_scope_proof_sha256 ||
    freeze.source_universe_artifact_sha256 !== plan.source_universe_artifact_sha256 ||
    freeze.support_snapshot_artifact_sha256 !== plan.support_snapshot_artifact_sha256 ||
    freeze.mapping_artifact_sha256 !== plan.mapping_artifact_sha256 ||
    freeze.process_manifest_artifact_sha256 !== plan.process_manifest_artifact_sha256 ||
    freeze.protected_closure_artifact_sha256 !== plan.protected_closure_artifact_sha256 ||
    freeze.policy_approval_text_sha256 !== plan.compatibility_policy.approval_text_sha256 ||
    !UUID_PATTERN.test(freeze.receipt_id) ||
    ![
      freeze.receipt_proof_sha256,
      freeze.capture_request_sha256,
      freeze.source_guard_set_sha256,
      freeze.support_guard_set_sha256,
      freeze.target_guard_set_sha256,
      freeze.mapping_guard_set_sha256,
      freeze.process_intent_set_sha256,
      freeze.receipt_protected_closure_sha256,
      freeze.capture_whole_scope_proof_sha256,
    ].every((digest) => HASH_PATTERN.test(digest)) ||
    !HASH_PATTERN.test(freeze.toolchain_evidence_sha256) ||
    !Number.isFinite(Date.parse(freeze.generated_at_utc)) ||
    freeze.freeze_sha256 !== computeFlowIdentityFreezeSha256(freeze)
  ) {
    fail('Flow identity freeze does not exactly bind the immutable production plan.');
  }
  return freeze;
}

export function parseFlowIdentityApproval(
  value: unknown,
  plan: FlowIdentityPlan,
  freeze: FlowIdentityFreeze,
): FlowIdentityApproval {
  if (!isJsonObject(value) || !isJsonObject(value.actor))
    fail('Flow identity approval is invalid.');
  const approval = value as FlowIdentityApproval;
  assertCurrentFlowIdentityAuthority({ oracleSha256: approval.policy_approval_text_sha256 });
  if (
    approval.schema_version !== 'dataset-flow-identity-execution-approval.v2' ||
    approval.actor.user_id !== plan.account.user_id ||
    approval.actor.email !== plan.account.email ||
    approval.plan_sha256 !== plan.plan_sha256 ||
    approval.freeze_sha256 !== freeze.freeze_sha256 ||
    approval.toolchain_evidence_sha256 !== freeze.toolchain_evidence_sha256 ||
    approval.policy_approval_text_sha256 !== plan.compatibility_policy.approval_text_sha256 ||
    !HASH_PATTERN.test(approval.policy_approval_text_sha256) ||
    !HASH_PATTERN.test(approval.execution_approval_request_sha256) ||
    !HASH_PATTERN.test(approval.execution_approval_text_sha256) ||
    new Set([
      approval.policy_approval_text_sha256,
      approval.execution_approval_request_sha256,
      approval.execution_approval_text_sha256,
      approval.execution_approval_identity_sha256,
    ]).size !== 4 ||
    !Number.isFinite(Date.parse(approval.approved_at_utc)) ||
    Date.parse(approval.approved_at_utc) < Date.parse(freeze.generated_at_utc) ||
    approval.execution_approval_identity_sha256 !==
      computeFlowIdentityApprovalIdentitySha256(approval)
  ) {
    fail('Flow identity approval does not exactly bind the plan/freeze/account/toolchain.');
  }
  return approval;
}

export function buildFlowIdentityExecutionIdentity(options: {
  plan: FlowIdentityPlan;
  freeze: FlowIdentityFreeze;
  approval: FlowIdentityApproval;
}): FlowIdentityExecutionIdentity {
  const body = {
    environment: 'production' as const,
    project_ref: options.plan.project_ref,
    actor: options.plan.account,
    target_visibility: 'owner_draft' as const,
    operation_id: options.plan.operation_id,
    plan_sha256: options.plan.plan_sha256,
    freeze_sha256: options.freeze.freeze_sha256,
    receipt_id: options.plan.receipt_id,
    receipt_proof_sha256: options.plan.receipt_proof_sha256,
    policy_approval_text_sha256: options.approval.policy_approval_text_sha256,
    execution_approval_request_sha256: options.approval.execution_approval_request_sha256,
    execution_approval_text_sha256: options.approval.execution_approval_text_sha256,
    execution_approval_identity_sha256: options.approval.execution_approval_identity_sha256,
    toolchain_evidence_sha256: options.freeze.toolchain_evidence_sha256,
  };
  const identitySha256 = flowIdentityRestrictedSha256(body);
  return {
    request_id: deterministicUuidFromSha256(
      sha256Text(`dataset-flow-identity-scope.v2\u0000${identitySha256}`),
    ),
    identity_sha256: identitySha256,
    ...body,
  };
}

export function buildFlowIdentityScopePreflightRequest(options: {
  plan: FlowIdentityPlan;
  identity: FlowIdentityExecutionIdentity;
}): JsonObject {
  const request = {
    schema_version: 'dataset-flow-identity-scope-preflight.v2',
    request_id: options.identity.request_id,
    receipt_id: options.identity.receipt_id,
    receipt_proof_sha256: options.identity.receipt_proof_sha256,
    environment: options.identity.environment,
    project_ref: options.identity.project_ref,
    actor: options.identity.actor,
    target_visibility: options.identity.target_visibility,
    operation_id: options.identity.operation_id,
    plan_sha256: options.identity.plan_sha256,
    freeze_sha256: options.identity.freeze_sha256,
    policy_approval_text_sha256: options.identity.policy_approval_text_sha256,
    execution_approval_request_sha256: options.identity.execution_approval_request_sha256,
    execution_approval_text_sha256: options.identity.execution_approval_text_sha256,
    execution_approval_identity_sha256: options.identity.execution_approval_identity_sha256,
    toolchain_evidence_sha256: options.identity.toolchain_evidence_sha256,
  };
  return request;
}

export function computeFlowIdentityProcessRequestSha256(request: JsonObject): string {
  const body = { ...request };
  delete body.process_request_sha256;
  return flowIdentityRestrictedSha256(body);
}

export function buildFlowIdentityProcessRequest(options: {
  scopeProofSha256: string;
  ordinal: number;
  processIntentProofSha256: string;
}): JsonObject {
  const body: JsonObject = {
    schema_version: 'dataset-flow-identity-process-rewrite.v2',
    request_id: deterministicUuidFromSha256(
      sha256Text(
        `dataset-flow-identity-process.v2\u0000${options.scopeProofSha256}\u0000${options.ordinal}\u0000${options.processIntentProofSha256}`,
      ),
    ),
    scope_proof_sha256: hash(options.scopeProofSha256, 'scope_proof_sha256'),
    ordinal: integer(options.ordinal, 'ordinal', 1),
    process_intent_proof_sha256: hash(
      options.processIntentProofSha256,
      'process_intent_proof_sha256',
    ),
    process_request_sha256: '',
  };
  body.process_request_sha256 = computeFlowIdentityProcessRequestSha256(body);
  return body;
}

export function buildFlowIdentityFinalizeRequest(options: {
  scopeProofSha256: string;
  plan: FlowIdentityPlan;
  status: FlowIdentityScopeStatus;
}): JsonObject {
  const completed = options.status.processes.filter((process) => process.status === 'completed');
  if (
    completed.length !== options.plan.processes.length ||
    completed.some((process) => !process.audit_id)
  ) {
    fail('Cannot finalize without an exact completed database process ledger.');
  }
  const expected = {
    process_count: options.plan.processes.length,
    rewrite_count: options.plan.summary.rewrites,
    completed_process_count: completed.length,
  };
  return {
    schema_version: 'dataset-flow-identity-scope-finalize.v2',
    request_id: deterministicUuidFromSha256(
      sha256Text(`dataset-flow-identity-finalize.v2\u0000${options.scopeProofSha256}`),
    ),
    scope_proof_sha256: hash(options.scopeProofSha256, 'scope_proof_sha256'),
    expected,
  };
}

function requireScopeCounts(value: JsonObject, plan: FlowIdentityPlan): void {
  if (
    integer(value.process_count, 'process_count') !== plan.processes.length ||
    integer(value.mapping_count, 'mapping_count') !== plan.mappings.length ||
    integer(value.rewrite_count, 'rewrite_count') !== plan.summary.rewrites
  ) {
    fail('Flow identity scope proof counts do not match the plan.');
  }
}

export function parseFlowIdentityScopePreflightProof(
  value: unknown,
  plan: FlowIdentityPlan,
): FlowIdentityScopePreflightProof {
  if (!isJsonObject(value)) fail('Flow identity scope preflight proof is invalid.');
  assertExactKeys(
    value,
    [
      'ok',
      'command',
      'schema_version',
      'receipt_id',
      'receipt_proof_sha256',
      'scope_id',
      'operation_id',
      'plan_sha256',
      'scope_proof_sha256',
      'status',
      'process_count',
      'mapping_count',
      'mapping_guard_set_sha256',
      'process_intent_set_sha256',
      'support_snapshot_count',
      'source_universe_count',
      'rewrite_count',
      'next_ordinal',
      'audit_id',
      'replay',
    ],
    'scope preflight result',
  );
  requireScopeCounts(value, plan);
  if (
    value.ok !== true ||
    value.command !== 'cmd_dataset_flow_identity_scope_preflight_guarded' ||
    value.schema_version !== 'dataset-flow-identity-scope-preflight-result.v2' ||
    value.receipt_id !== plan.receipt_id ||
    value.receipt_proof_sha256 !== plan.receipt_proof_sha256 ||
    value.operation_id !== plan.operation_id ||
    value.plan_sha256 !== plan.plan_sha256 ||
    value.mapping_guard_set_sha256 !== plan.mapping_guard_set_sha256 ||
    value.process_intent_set_sha256 !== plan.process_intent_set_sha256 ||
    !['sealed', 'running', 'primary_complete', 'derivatives_pending', 'completed'].includes(
      String(value.status),
    ) ||
    typeof value.replay !== 'boolean'
  ) {
    fail('Flow identity scope preflight proof does not bind the plan.');
  }
  uuid(value.scope_id, 'scope_id');
  hash(value.scope_proof_sha256, 'scope_proof_sha256');
  integer(value.support_snapshot_count, 'support_snapshot_count');
  if (
    value.support_snapshot_count !== plan.support_snapshots.length ||
    value.source_universe_count !== 305
  ) {
    fail('Flow identity scope support/source counts do not match the plan receipt.');
  }
  integer(value.next_ordinal, 'next_ordinal', 1);
  token(value.audit_id, 'audit_id');
  return value as FlowIdentityScopePreflightProof;
}

export function parseFlowIdentityProcessProof(options: {
  value: unknown;
  scopeId: string;
  process: FlowIdentityProcessManifest;
  requestSha256: string;
  receiptId: string;
  receiptProofSha256: string;
  mappingGuardSetSha256: string;
  processIntentSetSha256: string;
  processIntentProofSha256: string;
  processCount: number;
}): FlowIdentityProcessProof {
  if (!isJsonObject(options.value)) fail('Flow identity process proof is invalid.');
  if (
    !Number.isSafeInteger(options.processCount) ||
    options.processCount < options.process.ordinal
  ) {
    fail('Flow identity process count cannot bind the sealed ordinal.');
  }
  const value = options.value;
  const completedProcessCount = value.completed_process_count;
  assertExactKeys(
    value,
    [
      'ok',
      'command',
      'schema_version',
      'scope_id',
      'receipt_id',
      'receipt_proof_sha256',
      'mapping_guard_set_sha256',
      'process_intent_set_sha256',
      'ordinal',
      'process_id',
      'process_version',
      'process_request_sha256',
      'process_intent_proof_sha256',
      'desired_payload_sha256',
      'desired_exchange_set_sha256',
      'completed_process_count',
      'next_ordinal',
      'primary_complete',
      'before_payload_sha256',
      'before_exchange_set_sha256',
      'after_payload_sha256',
      'after_exchange_set_sha256',
      'rewrite_count',
      'audit_id',
      'derivative_batch_id',
      'status',
      'replay',
    ],
    'process rewrite result',
  );
  if (
    value.ok !== true ||
    value.command !== 'cmd_dataset_flow_identity_process_rewrite_guarded' ||
    value.schema_version !== 'dataset-flow-identity-process-rewrite-result.v2' ||
    value.scope_id !== options.scopeId ||
    value.receipt_id !== options.receiptId ||
    value.receipt_proof_sha256 !== options.receiptProofSha256 ||
    value.mapping_guard_set_sha256 !== options.mappingGuardSetSha256 ||
    value.process_intent_set_sha256 !== options.processIntentSetSha256 ||
    value.ordinal !== options.process.ordinal ||
    value.process_id !== options.process.id ||
    value.process_version !== options.process.version ||
    value.process_request_sha256 !== options.requestSha256 ||
    value.process_intent_proof_sha256 !== options.processIntentProofSha256 ||
    value.desired_payload_sha256 !== options.process.desired_payload_sha256 ||
    value.desired_exchange_set_sha256 !== options.process.desired_exchange_set_sha256 ||
    !Number.isSafeInteger(completedProcessCount) ||
    Number(completedProcessCount) < options.process.ordinal ||
    Number(completedProcessCount) > options.processCount ||
    (value.replay === false && completedProcessCount !== options.process.ordinal) ||
    typeof value.primary_complete !== 'boolean' ||
    (value.primary_complete
      ? completedProcessCount !== options.processCount || value.next_ordinal !== null
      : value.next_ordinal !== Number(completedProcessCount) + 1 ||
        Number(value.next_ordinal) > options.processCount) ||
    !HASH_PATTERN.test(String(value.before_payload_sha256)) ||
    !HASH_PATTERN.test(String(value.before_exchange_set_sha256)) ||
    !HASH_PATTERN.test(String(value.after_payload_sha256)) ||
    !HASH_PATTERN.test(String(value.after_exchange_set_sha256)) ||
    value.after_payload_sha256 !== value.desired_payload_sha256 ||
    value.after_exchange_set_sha256 !== value.desired_exchange_set_sha256 ||
    value.rewrite_count !== options.process.rewrite_count ||
    value.status !== 'completed' ||
    !UUID_PATTERN.test(String(value.derivative_batch_id)) ||
    typeof value.replay !== 'boolean'
  ) {
    fail('Flow identity process proof does not bind the sealed process template.');
  }
  token(value.audit_id, 'audit_id');
  return value as FlowIdentityProcessProof;
}

function parseScopeProcess(
  value: unknown,
  expected: FlowIdentityProcessManifest,
): FlowIdentityScopeProcessStatus {
  if (!isJsonObject(value)) fail('Flow identity scope process ledger entry is invalid.');
  assertExactKeys(
    value,
    [
      'ordinal',
      'id',
      'version',
      'status',
      'process_request_sha256',
      'process_intent_proof_sha256',
      'desired_payload_sha256',
      'desired_exchange_set_sha256',
      'rewrite_count',
      'audit_id',
      'before_payload_sha256',
      'before_exchange_set_sha256',
      'after_payload_sha256',
      'after_exchange_set_sha256',
      'derivative_batch_id',
      'derivative_request_id',
      'derivative_status',
      'causal_terminal_proof',
      'completed_at',
      'last_error',
    ],
    'scope process ledger entry',
  );
  if (
    value.ordinal !== expected.ordinal ||
    value.id !== expected.id ||
    value.version !== expected.version ||
    value.rewrite_count !== expected.rewrite_count ||
    value.desired_payload_sha256 !== expected.desired_payload_sha256 ||
    value.desired_exchange_set_sha256 !== expected.desired_exchange_set_sha256 ||
    !HASH_PATTERN.test(String(value.before_payload_sha256)) ||
    !HASH_PATTERN.test(String(value.before_exchange_set_sha256)) ||
    !HASH_PATTERN.test(String(value.process_intent_proof_sha256)) ||
    !['pending', 'completed', 'failed'].includes(String(value.status))
  ) {
    fail('Flow identity scope process ledger does not match the sealed manifest.');
  }
  const completed = value.status === 'completed';
  const pending = value.status === 'pending';
  const missingOriginalDerivative =
    value.derivative_request_id === null && value.derivative_status === 'missing';
  const presentOriginalDerivative =
    UUID_PATTERN.test(String(value.derivative_request_id)) &&
    typeof value.derivative_status === 'string' &&
    Boolean(value.derivative_status.trim()) &&
    value.derivative_status !== 'missing';
  if (
    completed &&
    (!HASH_PATTERN.test(String(value.process_request_sha256)) ||
      !token(value.audit_id, 'audit_id') ||
      !HASH_PATTERN.test(String(value.after_payload_sha256)) ||
      !HASH_PATTERN.test(String(value.after_exchange_set_sha256)) ||
      value.after_payload_sha256 !== expected.desired_payload_sha256 ||
      value.after_exchange_set_sha256 !== expected.desired_exchange_set_sha256 ||
      !UUID_PATTERN.test(String(value.derivative_batch_id)) ||
      (!missingOriginalDerivative && !presentOriginalDerivative) ||
      !value.completed_at ||
      !Number.isFinite(Date.parse(String(value.completed_at))))
  ) {
    fail('Completed flow identity process ledger proof is incomplete.');
  }
  if (
    pending &&
    (value.process_request_sha256 !== null ||
      value.audit_id !== null ||
      value.after_payload_sha256 !== null ||
      value.after_exchange_set_sha256 !== null ||
      value.derivative_batch_id !== null ||
      value.derivative_request_id !== null ||
      value.derivative_status !== null ||
      value.completed_at !== null)
  ) {
    fail('Pending flow identity process ledger unexpectedly contains completion proof.');
  }
  if (value.causal_terminal_proof !== false) {
    fail('Scope status must not substitute a child status bit for terminal causal proof.');
  }
  return value as FlowIdentityScopeProcessStatus;
}

function parseCompensationTarget(
  entry: unknown,
  plan: FlowIdentityPlan,
  scopeId: string,
  source: 'scope_read' | 'finalize' | 'derivative_set',
): FlowIdentityCompensationTarget {
  if (!isJsonObject(entry)) fail('Derivative compensation target is invalid.');
  const ordinal = integer(entry.ordinal, 'compensation ordinal', 1);
  const process = plan.processes[ordinal - 1];
  const reason = `FLOW_IDENTITY_SCOPE_COMPENSATION:${scopeId}:${ordinal}`;
  if (
    !process ||
    entry.table !== 'processes' ||
    entry.id !== process.id ||
    entry.version !== process.version ||
    !UUID_PATTERN.test(String(entry.original_batch_id)) ||
    !['failed', 'stale', 'missing'].includes(String(entry.original_status)) ||
    typeof entry.original_code !== 'string' ||
    !entry.original_code.trim() ||
    !HASH_PATTERN.test(String(entry.desired_payload_sha256)) ||
    !HASH_PATTERN.test(String(entry.current_json_ordered_sha256)) ||
    !HASH_PATTERN.test(String(entry.current_snapshot_sha256)) ||
    !Number.isFinite(Date.parse(String(entry.current_modified_at))) ||
    !Array.isArray(entry.components) ||
    entry.components.length !== 2 ||
    entry.components[0] !== 'extracted_md' ||
    entry.components[1] !== 'embedding_ft' ||
    entry.reason_code !== reason ||
    entry.operation_id_prefix !== `${reason}:` ||
    entry.requires_new_plan_freeze_approval !== true ||
    entry.automatic_retry !== false ||
    (entry.latest_compensation_request_id !== null &&
      !UUID_PATTERN.test(String(entry.latest_compensation_request_id))) ||
    (entry.latest_compensation_status !== null &&
      (typeof entry.latest_compensation_status !== 'string' ||
        !entry.latest_compensation_status.trim())) ||
    (entry.latest_compensation_plan_sha256 !== null &&
      !HASH_PATTERN.test(String(entry.latest_compensation_plan_sha256)))
  ) {
    fail('Derivative compensation target does not bind the sealed process/current snapshot.');
  }
  const missingOriginalRequest =
    entry.original_status === 'missing' &&
    entry.original_code === 'DERIVATIVE_BATCH_CHILD_MISSING' &&
    entry.original_request_id === null;
  const hasOriginalRequestId = Object.prototype.hasOwnProperty.call(entry, 'original_request_id');
  const hasOriginalError = Object.prototype.hasOwnProperty.call(entry, 'original_error');
  if (
    (source === 'scope_read' &&
      (!hasOriginalRequestId ||
        !hasOriginalError ||
        (!missingOriginalRequest &&
          (!['failed', 'stale'].includes(String(entry.original_status)) ||
            !UUID_PATTERN.test(String(entry.original_request_id)))))) ||
    (source !== 'scope_read' && (hasOriginalRequestId || hasOriginalError)) ||
    (entry.original_status === 'missing' &&
      entry.original_code !== 'DERIVATIVE_BATCH_CHILD_MISSING') ||
    (entry.original_status !== 'missing' && entry.original_request_id === null)
  ) {
    fail('Derivative compensation target provenance does not match its RPC response.');
  }
  return entry as FlowIdentityCompensationTarget;
}

function parseCompensationEnvelope(
  value: JsonObject,
  plan: FlowIdentityPlan,
  scopeId: string,
  source: 'scope_read' | 'finalize',
): FlowIdentityCompensationTarget[] {
  if (value.compensation_required === undefined) return [];
  if (typeof value.compensation_required !== 'boolean') {
    fail('Flow identity compensation_required must be boolean.');
  }
  if (value.compensation_required === false) {
    if (
      value.automatic_retry !== false ||
      (value.compensation_targets !== undefined &&
        (!Array.isArray(value.compensation_targets) || value.compensation_targets.length !== 0))
    ) {
      fail('Non-required compensation envelope is malformed.');
    }
    return [];
  }
  if (
    (source === 'scope_read'
      ? !['derivatives_pending', 'completed'].includes(String(value.status))
      : value.status !== 'derivatives_pending') ||
    value.code !== 'FLOW_IDENTITY_DERIVATIVE_COMPENSATION_REQUIRED' ||
    value.automatic_retry !== false ||
    !Array.isArray(value.compensation_targets) ||
    value.compensation_targets.length === 0
  ) {
    fail('Required derivative compensation envelope is malformed.');
  }
  return value.compensation_targets.map((entry) =>
    parseCompensationTarget(entry, plan, scopeId, source),
  );
}

function assertExactKeys(value: JsonObject, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} keys do not match the database contract.`);
  }
}

function parseDerivativeResidue(value: unknown, label: string): FlowIdentityDerivativeResidue {
  if (!isJsonObject(value)) fail(`${label} must be an object.`);
  assertExactKeys(
    value,
    ['http_requests', 'embedding_jobs', 'pending_jobs', 'failure_rows', 'other_active_fences'],
    label,
  );
  return {
    http_requests: integer(value.http_requests, `${label}.http_requests`),
    embedding_jobs: integer(value.embedding_jobs, `${label}.embedding_jobs`),
    pending_jobs: integer(value.pending_jobs, `${label}.pending_jobs`),
    failure_rows: integer(value.failure_rows, `${label}.failure_rows`),
    other_active_fences: integer(value.other_active_fences, `${label}.other_active_fences`),
  };
}

function parseDerivativeTarget(options: {
  value: unknown;
  index: number;
  plan: FlowIdentityPlan;
  process: FlowIdentityScopeProcessStatus;
}): FlowIdentityDerivativeTargetProof {
  const label = `derivative_set_proof.targets[${options.index}]`;
  if (!isJsonObject(options.value)) fail(`${label} must be an object.`);
  const value = options.value;
  assertExactKeys(
    value,
    [
      'ordinal',
      'id',
      'version',
      'original_batch_id',
      'effective_reference_id',
      'effective_reference_kind',
      'status',
      'request_status',
      'phase',
      'lineage_ok',
      'proposals_committed',
      'terminal_audit_present',
      'residue',
      'current_snapshot_sha256',
      'current_json_ordered_sha256',
      'causal_terminal_proof',
    ],
    label,
  );
  const ordinal = integer(value.ordinal, `${label}.ordinal`, 1);
  const expected = options.plan.processes[ordinal - 1];
  const requestStatus = token(value.request_status, `${label}.request_status`);
  const requestIsTerminal = ['completed', 'stale', 'failed', 'missing'].includes(requestStatus);
  const causalTerminalProof = boolean(
    value.causal_terminal_proof,
    `${label}.causal_terminal_proof`,
  );
  const expectedStatus = causalTerminalProof
    ? 'completed'
    : requestIsTerminal
      ? 'failed'
      : 'pending';
  const effectiveReferenceKind = token(
    value.effective_reference_kind,
    `${label}.effective_reference_kind`,
  );
  const phase = token(value.phase, `${label}.phase`);
  const missingOriginalDerivative =
    options.process.derivative_request_id === null &&
    options.process.derivative_status === 'missing' &&
    value.effective_reference_id === null &&
    effectiveReferenceKind === 'protected_batch' &&
    requestStatus === 'missing' &&
    phase === 'missing' &&
    value.status === 'failed' &&
    value.lineage_ok === false &&
    value.proposals_committed === false &&
    value.terminal_audit_present === false &&
    causalTerminalProof === false;
  if (
    ordinal !== options.index + 1 ||
    !expected ||
    options.process.ordinal !== ordinal ||
    options.process.status !== 'completed' ||
    value.id !== expected.id ||
    value.version !== expected.version ||
    value.original_batch_id !== options.process.derivative_batch_id ||
    !UUID_PATTERN.test(String(value.original_batch_id)) ||
    (!missingOriginalDerivative && !UUID_PATTERN.test(String(value.effective_reference_id))) ||
    !['protected_batch', 'separate_compensation'].includes(effectiveReferenceKind) ||
    ![
      'queued',
      'dispatching',
      'markdown_pending',
      'embedding_pending',
      'completed',
      'stale',
      'failed',
      'missing',
    ].includes(requestStatus) ||
    ((requestStatus === 'missing' ||
      phase === 'missing' ||
      value.effective_reference_id === null) &&
      !missingOriginalDerivative) ||
    value.status !== expectedStatus ||
    (causalTerminalProof && requestStatus !== 'completed') ||
    (effectiveReferenceKind === 'protected_batch' &&
      value.effective_reference_id !== options.process.derivative_request_id) ||
    (effectiveReferenceKind === 'separate_compensation' &&
      value.effective_reference_id === options.process.derivative_request_id) ||
    !HASH_PATTERN.test(String(value.current_json_ordered_sha256)) ||
    !HASH_PATTERN.test(String(value.current_snapshot_sha256))
  ) {
    fail(`${label} does not bind the ordered process/derivative ledger.`);
  }
  return {
    ordinal,
    id: expected.id,
    version: expected.version,
    original_batch_id: String(value.original_batch_id),
    effective_reference_id:
      value.effective_reference_id === null ? null : String(value.effective_reference_id),
    effective_reference_kind: effectiveReferenceKind as 'protected_batch' | 'separate_compensation',
    status: expectedStatus,
    request_status: requestStatus as FlowIdentityDerivativeTargetProof['request_status'],
    phase,
    lineage_ok: boolean(value.lineage_ok, `${label}.lineage_ok`),
    proposals_committed: boolean(value.proposals_committed, `${label}.proposals_committed`),
    terminal_audit_present: boolean(
      value.terminal_audit_present,
      `${label}.terminal_audit_present`,
    ),
    residue: parseDerivativeResidue(value.residue, `${label}.residue`),
    current_snapshot_sha256: String(value.current_snapshot_sha256),
    current_json_ordered_sha256: String(value.current_json_ordered_sha256),
    causal_terminal_proof: causalTerminalProof,
  };
}

export function parseFlowIdentityDerivativeSetProof(options: {
  value: unknown;
  plan: FlowIdentityPlan;
  scopeId: string;
  processes: FlowIdentityScopeProcessStatus[];
}): FlowIdentityDerivativeSetProof {
  if (!isJsonObject(options.value)) fail('Flow identity derivative set proof is invalid.');
  const value = options.value;
  assertExactKeys(
    value,
    [
      'ok',
      'schema_version',
      'scope_id',
      'status',
      'target_count',
      'completed_count',
      'pending_count',
      'failed_count',
      'causal_terminal_proof',
      'targets',
      'compensation_targets',
      'proof_sha256',
    ],
    'derivative_set_proof',
  );
  if (!Array.isArray(value.targets) || !Array.isArray(value.compensation_targets)) {
    fail('Flow identity derivative set proof arrays are invalid.');
  }
  const completedProcesses = options.processes.filter((entry) => entry.status === 'completed');
  const targets = value.targets.map((entry, index) => {
    const process = completedProcesses[index];
    if (!process) fail('Derivative set proof contains a foreign target.');
    return parseDerivativeTarget({ value: entry, index, plan: options.plan, process });
  });
  const targetCount = integer(value.target_count, 'derivative_set_proof.target_count');
  const completedCount = integer(value.completed_count, 'derivative_set_proof.completed_count');
  const pendingCount = integer(value.pending_count, 'derivative_set_proof.pending_count');
  const failedCount = integer(value.failed_count, 'derivative_set_proof.failed_count');
  const causalTerminalProof = boolean(
    value.causal_terminal_proof,
    'derivative_set_proof.causal_terminal_proof',
  );
  const expectedStatus =
    targetCount === 0
      ? 'failed'
      : failedCount > 0
        ? 'compensation_required'
        : pendingCount > 0
          ? 'pending'
          : 'completed';
  const compensationTargets = value.compensation_targets.map((entry) =>
    parseCompensationTarget(entry, options.plan, options.scopeId, 'derivative_set'),
  );
  const failedOrdinals = targets
    .filter((entry) => entry.status === 'failed')
    .map((entry) => entry.ordinal);
  if (
    value.schema_version !== 'dataset-flow-identity-derivative-set-proof.v1' ||
    value.scope_id !== options.scopeId ||
    targetCount !== targets.length ||
    targetCount !== completedProcesses.length ||
    completedCount !== targets.filter((entry) => entry.status === 'completed').length ||
    pendingCount !== targets.filter((entry) => entry.status === 'pending').length ||
    failedCount !== failedOrdinals.length ||
    completedCount + pendingCount + failedCount !== targetCount ||
    compensationTargets.length !== failedCount ||
    compensationTargets.some((entry, index) => entry.ordinal !== failedOrdinals[index]) ||
    compensationTargets.some((entry) => {
      const process = options.processes[entry.ordinal - 1];
      const target = targets[entry.ordinal - 1];
      const processMissingOriginal =
        process?.derivative_request_id === null && process.derivative_status === 'missing';
      return (
        (entry.original_status === 'missing') !== processMissingOriginal ||
        (target?.request_status === 'missing' && entry.original_status !== 'missing')
      );
    }) ||
    value.status !== expectedStatus ||
    value.ok !== (targetCount > 0 && failedCount === 0) ||
    causalTerminalProof !== (targetCount > 0 && completedCount === targetCount) ||
    !HASH_PATTERN.test(String(value.proof_sha256))
  ) {
    fail('Flow identity derivative set proof counts/status do not bind its ordered targets.');
  }
  return {
    ok: Boolean(value.ok),
    schema_version: 'dataset-flow-identity-derivative-set-proof.v1',
    scope_id: options.scopeId,
    status: expectedStatus,
    target_count: targetCount,
    completed_count: completedCount,
    pending_count: pendingCount,
    failed_count: failedCount,
    causal_terminal_proof: causalTerminalProof,
    targets,
    compensation_targets: compensationTargets,
    proof_sha256: String(value.proof_sha256),
  };
}

export function parseFlowIdentityWholeScopeProof(options: {
  value: unknown;
  scopeId: string;
  receiptId: string;
}): FlowIdentityWholeScopeProof {
  if (!isJsonObject(options.value)) fail('Flow identity whole-scope proof is invalid.');
  const value = options.value;
  assertExactKeys(
    value,
    [
      'schema_version',
      'scope_id',
      'receipt_id',
      'primary_current',
      'audit_current',
      'source_guards_current',
      'support_guards_current',
      'target_guards_current',
      'approved_reference_residue_count',
      'protected_closure_current',
      'occurrence_closure_current',
      'derivatives_current',
      'primary_closure_sha256',
      'source_guard_set_sha256',
      'support_guard_set_sha256',
      'target_guard_set_sha256',
      'protected_closure_sha256',
      'derivative_proof_set_sha256',
      'causal_terminal_proof',
      'proof_sha256',
    ],
    'whole_scope_proof',
  );
  const proof: FlowIdentityWholeScopeProof = {
    schema_version: 'dataset-flow-identity-whole-scope-proof.v2',
    scope_id: uuid(value.scope_id, 'whole_scope_proof.scope_id'),
    receipt_id: uuid(value.receipt_id, 'whole_scope_proof.receipt_id'),
    primary_current: boolean(value.primary_current, 'whole_scope_proof.primary_current'),
    audit_current: boolean(value.audit_current, 'whole_scope_proof.audit_current'),
    source_guards_current: boolean(
      value.source_guards_current,
      'whole_scope_proof.source_guards_current',
    ),
    support_guards_current: boolean(
      value.support_guards_current,
      'whole_scope_proof.support_guards_current',
    ),
    target_guards_current: boolean(
      value.target_guards_current,
      'whole_scope_proof.target_guards_current',
    ),
    approved_reference_residue_count: integer(
      value.approved_reference_residue_count,
      'whole_scope_proof.approved_reference_residue_count',
    ),
    protected_closure_current: boolean(
      value.protected_closure_current,
      'whole_scope_proof.protected_closure_current',
    ),
    occurrence_closure_current: boolean(
      value.occurrence_closure_current,
      'whole_scope_proof.occurrence_closure_current',
    ),
    derivatives_current: boolean(
      value.derivatives_current,
      'whole_scope_proof.derivatives_current',
    ),
    primary_closure_sha256: hash(
      value.primary_closure_sha256,
      'whole_scope_proof.primary_closure_sha256',
    ),
    source_guard_set_sha256: hash(
      value.source_guard_set_sha256,
      'whole_scope_proof.source_guard_set_sha256',
    ),
    support_guard_set_sha256: hash(
      value.support_guard_set_sha256,
      'whole_scope_proof.support_guard_set_sha256',
    ),
    target_guard_set_sha256: hash(
      value.target_guard_set_sha256,
      'whole_scope_proof.target_guard_set_sha256',
    ),
    protected_closure_sha256: hash(
      value.protected_closure_sha256,
      'whole_scope_proof.protected_closure_sha256',
    ),
    derivative_proof_set_sha256: hash(
      value.derivative_proof_set_sha256,
      'whole_scope_proof.derivative_proof_set_sha256',
    ),
    causal_terminal_proof: boolean(
      value.causal_terminal_proof,
      'whole_scope_proof.causal_terminal_proof',
    ),
    proof_sha256: hash(value.proof_sha256, 'whole_scope_proof.proof_sha256'),
  };
  if (
    value.schema_version !== proof.schema_version ||
    proof.scope_id !== options.scopeId ||
    proof.receipt_id !== options.receiptId
  ) {
    fail('Flow identity whole-scope proof does not bind the actor scope receipt.');
  }
  return proof;
}

export function parseFlowIdentityScopeStatus(
  value: unknown,
  plan: FlowIdentityPlan,
  scopeId: string,
  scopeProofSha256: string,
): FlowIdentityScopeStatus {
  if (!isJsonObject(value) || !Array.isArray(value.processes)) {
    fail('Flow identity scope status is invalid.');
  }
  const scopeStatusKeys = [
    'ok',
    'command',
    'schema_version',
    'scope_id',
    'receipt_id',
    'receipt_proof_sha256',
    'mapping_guard_set_sha256',
    'process_intent_set_sha256',
    'operation_id',
    'plan_sha256',
    'scope_proof_sha256',
    'status',
    'process_count',
    'completed_process_count',
    'pending_process_count',
    'failed_process_count',
    'next_ordinal',
    'rewrite_count',
    'completed_rewrite_count',
    'primary_complete',
    'cancellable',
    'strict_continuation_required',
    'primary_current',
    'live_guard_current',
    'derivatives_current',
    'derivative_pending_count',
    'derivative_failed_count',
    'derivative_set_proof',
    'derivative_proof_set_sha256',
    'compensation_required',
    'automatic_retry',
    'compensation_targets',
    'protected_closure_current',
    'protected_closure_proof',
    'processes',
    'terminal_proof_sha256',
    'completed_at',
    'whole_scope_proof',
    'whole_scope_proof_sha256',
    ...(value.code === undefined ? [] : ['code']),
  ];
  assertExactKeys(value, scopeStatusKeys, 'scope status result');
  const processes = value.processes.map((entry, index) => {
    const expected = plan.processes[index];
    if (!expected) fail('Scope status contains a foreign process ledger entry.');
    return parseScopeProcess(entry, expected);
  });
  const derivativeSetProof = parseFlowIdentityDerivativeSetProof({
    value: value.derivative_set_proof,
    plan,
    scopeId,
    processes,
  });
  const wholeScopeProof = parseFlowIdentityWholeScopeProof({
    value: value.whole_scope_proof,
    scopeId,
    receiptId: plan.receipt_id,
  });
  const status = String(value.status);
  const liveDrift = status === 'live_drift';
  if (
    integer(value.process_count, 'process_count') !== plan.processes.length ||
    integer(value.rewrite_count, 'rewrite_count') !== plan.summary.rewrites ||
    integer(value.pending_process_count, 'pending_process_count') !==
      processes.filter((entry) => entry.status === 'pending').length ||
    integer(value.failed_process_count, 'failed_process_count') !==
      processes.filter((entry) => entry.status === 'failed').length ||
    integer(value.completed_rewrite_count, 'completed_rewrite_count') !==
      processes
        .filter((entry) => entry.status === 'completed')
        .reduce((sum, entry) => sum + entry.rewrite_count, 0)
  ) {
    fail('Flow identity scope status counts do not match the plan.');
  }
  if (
    value.ok !==
      (!['failed', 'live_drift'].includes(status) && value.compensation_required !== true) ||
    value.command !== 'cmd_dataset_flow_identity_scope_read' ||
    value.schema_version !== 'dataset-flow-identity-scope-status.v2' ||
    value.scope_id !== scopeId ||
    value.receipt_id !== plan.receipt_id ||
    value.receipt_proof_sha256 !== plan.receipt_proof_sha256 ||
    value.mapping_guard_set_sha256 !== plan.mapping_guard_set_sha256 ||
    value.process_intent_set_sha256 !== plan.process_intent_set_sha256 ||
    value.operation_id !== plan.operation_id ||
    value.plan_sha256 !== plan.plan_sha256 ||
    value.scope_proof_sha256 !== scopeProofSha256 ||
    ![
      'sealed',
      'running',
      'primary_complete',
      'derivatives_pending',
      'completed',
      'live_drift',
      'failed',
    ].includes(String(value.status)) ||
    processes.length !== plan.processes.length ||
    integer(value.completed_process_count, 'completed_process_count') !==
      processes.filter((entry) => entry.status === 'completed').length ||
    integer(value.next_ordinal, 'next_ordinal', 1) !==
      Math.min(
        processes.find((entry) => entry.status === 'pending')?.ordinal ?? processes.length + 1,
        processes.length + 1,
      ) ||
    typeof value.primary_complete !== 'boolean' ||
    value.primary_complete !== processes.every((entry) => entry.status === 'completed') ||
    typeof value.cancellable !== 'boolean' ||
    value.cancellable !==
      (processes.every((entry) => entry.status === 'pending') &&
        !['completed', 'failed', 'live_drift'].includes(status)) ||
    typeof value.strict_continuation_required !== 'boolean' ||
    value.strict_continuation_required !==
      (processes.some((entry) => entry.status === 'completed') &&
        processes.some((entry) => entry.status === 'pending')) ||
    typeof value.primary_current !== 'boolean' ||
    value.primary_current !== wholeScopeProof.primary_current ||
    typeof value.live_guard_current !== 'boolean' ||
    value.live_guard_current !==
      (wholeScopeProof.audit_current &&
        wholeScopeProof.source_guards_current &&
        wholeScopeProof.support_guards_current &&
        wholeScopeProof.target_guards_current &&
        wholeScopeProof.protected_closure_current &&
        wholeScopeProof.occurrence_closure_current) ||
    typeof value.derivatives_current !== 'boolean' ||
    (!liveDrift && value.derivatives_current !== derivativeSetProof.causal_terminal_proof) ||
    value.derivatives_current !== wholeScopeProof.derivatives_current ||
    integer(value.derivative_pending_count, 'derivative_pending_count') !==
      derivativeSetProof.pending_count ||
    integer(value.derivative_failed_count, 'derivative_failed_count') !==
      derivativeSetProof.failed_count ||
    value.derivative_proof_set_sha256 !== derivativeSetProof.proof_sha256 ||
    wholeScopeProof.derivative_proof_set_sha256 !== derivativeSetProof.proof_sha256 ||
    typeof value.protected_closure_current !== 'boolean' ||
    value.protected_closure_current !== wholeScopeProof.protected_closure_current ||
    !isJsonObject(value.protected_closure_proof) ||
    value.whole_scope_proof_sha256 !== wholeScopeProof.proof_sha256 ||
    value.automatic_retry !== false ||
    typeof value.compensation_required !== 'boolean' ||
    (!liveDrift && value.compensation_required !== derivativeSetProof.failed_count > 0) ||
    !Array.isArray(value.compensation_targets)
  ) {
    fail('Flow identity scope status does not match the sealed plan/progress ledger.');
  }
  if (
    (status === 'completed' &&
      (!wholeScopeProof.primary_current ||
        !wholeScopeProof.audit_current ||
        !wholeScopeProof.source_guards_current ||
        !wholeScopeProof.support_guards_current ||
        !wholeScopeProof.target_guards_current ||
        wholeScopeProof.approved_reference_residue_count !== 0 ||
        !wholeScopeProof.protected_closure_current ||
        !wholeScopeProof.occurrence_closure_current ||
        !wholeScopeProof.derivatives_current ||
        !wholeScopeProof.causal_terminal_proof)) ||
    (liveDrift &&
      (value.ok !== false ||
        !['FLOW_IDENTITY_PRIMARY_OR_GUARD_DRIFT', 'FLOW_IDENTITY_SCOPE_TERMINAL_CONFLICT'].includes(
          String(value.code),
        ) ||
        (value.primary_current === true && value.live_guard_current === true) ||
        value.derivatives_current !== false ||
        value.compensation_required !== false ||
        !Array.isArray(value.compensation_targets) ||
        value.compensation_targets.length !== 0))
  ) {
    fail('Flow identity completed/live-drift status contradicts the dynamic whole-scope proof.');
  }
  if (
    value.status === 'completed'
      ? !HASH_PATTERN.test(String(value.terminal_proof_sha256))
      : value.terminal_proof_sha256 !== null
  ) {
    fail('Flow identity scope terminal proof does not match its status.');
  }
  if (
    status === 'completed'
      ? !Number.isFinite(Date.parse(String(value.completed_at)))
      : value.completed_at !== null
  ) {
    fail('Flow identity scope completion timestamp does not match its status.');
  }
  const compensationTargets = liveDrift
    ? []
    : parseCompensationEnvelope(value, plan, scopeId, 'scope_read');
  if (
    !liveDrift &&
    (compensationTargets.length !== derivativeSetProof.compensation_targets.length ||
      compensationTargets.some((entry, index) => {
        const derivativeEntry = derivativeSetProof.compensation_targets[index];
        return (
          !derivativeEntry ||
          entry.ordinal !== derivativeEntry.ordinal ||
          entry.id !== derivativeEntry.id ||
          entry.version !== derivativeEntry.version ||
          entry.original_batch_id !== derivativeEntry.original_batch_id ||
          entry.original_status !== derivativeEntry.original_status ||
          entry.original_code !== derivativeEntry.original_code ||
          entry.desired_payload_sha256 !== derivativeEntry.desired_payload_sha256 ||
          entry.current_json_ordered_sha256 !== derivativeEntry.current_json_ordered_sha256 ||
          entry.current_snapshot_sha256 !== derivativeEntry.current_snapshot_sha256 ||
          entry.latest_compensation_request_id !== derivativeEntry.latest_compensation_request_id ||
          entry.latest_compensation_status !== derivativeEntry.latest_compensation_status ||
          entry.latest_compensation_plan_sha256 !== derivativeEntry.latest_compensation_plan_sha256
        );
      }))
  ) {
    fail('Scope compensation convenience fields do not match the dynamic derivative proof.');
  }
  return {
    ...(value as FlowIdentityScopeStatus),
    processes,
    derivative_set_proof: derivativeSetProof,
    whole_scope_proof: wholeScopeProof,
    compensation_targets: compensationTargets,
  };
}

export function flowIdentityScopeHasCurrentDerivativeClosure(
  status: FlowIdentityScopeStatus,
): boolean {
  return Boolean(
    status.status === 'completed' &&
    typeof status.terminal_proof_sha256 === 'string' &&
    HASH_PATTERN.test(status.terminal_proof_sha256) &&
    flowIdentityScopeIsReadyToFinalize(status),
  );
}

export function flowIdentityScopeIsReadyToFinalize(status: FlowIdentityScopeStatus): boolean {
  const proof = status.derivative_set_proof;
  const whole = status.whole_scope_proof;
  return Boolean(
    ['primary_complete', 'completed'].includes(status.status) &&
    status.primary_complete &&
    status.primary_current &&
    status.live_guard_current &&
    status.derivatives_current &&
    status.protected_closure_current &&
    status.derivative_pending_count === 0 &&
    status.derivative_failed_count === 0 &&
    status.compensation_required === false &&
    status.compensation_targets?.length === 0 &&
    proof.ok &&
    proof.status === 'completed' &&
    proof.target_count === status.process_count &&
    proof.completed_count === status.process_count &&
    proof.pending_count === 0 &&
    proof.failed_count === 0 &&
    proof.causal_terminal_proof &&
    proof.targets.length === status.process_count &&
    proof.compensation_targets.length === 0 &&
    HASH_PATTERN.test(proof.proof_sha256) &&
    whole.primary_current &&
    whole.audit_current &&
    whole.source_guards_current &&
    whole.support_guards_current &&
    whole.target_guards_current &&
    whole.approved_reference_residue_count === 0 &&
    whole.protected_closure_current &&
    whole.occurrence_closure_current &&
    whole.derivatives_current &&
    whole.causal_terminal_proof &&
    whole.proof_sha256 === status.whole_scope_proof_sha256 &&
    proof.targets.every((target, index) => {
      const process = status.processes[index];
      return (
        process?.status === 'completed' &&
        target.ordinal === index + 1 &&
        target.current_json_ordered_sha256 === process.desired_payload_sha256 &&
        target.status === 'completed' &&
        target.request_status === 'completed' &&
        target.phase === 'completed' &&
        target.lineage_ok &&
        target.proposals_committed &&
        target.terminal_audit_present &&
        HASH_PATTERN.test(target.current_snapshot_sha256) &&
        Object.values(target.residue).every((count) => count === 0) &&
        target.causal_terminal_proof
      );
    }),
  );
}

export function parseFlowIdentityFinalizeProof(options: {
  value: unknown;
  plan: FlowIdentityPlan;
  scopeId: string;
  scopeProofSha256: string;
  request: JsonObject;
}): FlowIdentityFinalizeProof {
  if (!isJsonObject(options.value) || !isJsonObject(options.request.expected)) {
    fail('Flow identity finalize proof is invalid.');
  }
  const value = options.value;
  const expected = options.request.expected;
  const completed = value.status === 'completed';
  const failed = value.status === 'failed';
  const liveDrift = value.status === 'live_drift';
  const compensationRequired = value.compensation_required === true;
  const derivativesPending = value.status === 'derivatives_pending';
  const wholeScopeProof = parseFlowIdentityWholeScopeProof({
    value: value.whole_scope_proof,
    scopeId: options.scopeId,
    receiptId: options.plan.receipt_id,
  });
  const finalizeKeys = [
    'ok',
    'command',
    'schema_version',
    'scope_id',
    'receipt_id',
    'receipt_proof_sha256',
    'mapping_guard_set_sha256',
    'process_intent_set_sha256',
    'operation_id',
    'plan_sha256',
    'scope_proof_sha256',
    'status',
    'process_count',
    'completed_process_count',
    'rewrite_count',
    'primary_closure_sha256',
    'protected_closure_sha256',
    'derivative_target_set_sha256',
    'derivative_proof_set_sha256',
    'primary_current',
    'live_guard_current',
    'derivatives_current',
    'terminal_proof_sha256',
    'whole_scope_proof',
    'whole_scope_proof_sha256',
    'audit_id',
    'replay',
    ...(completed
      ? []
      : ['code', 'compensation_required', 'automatic_retry', 'compensation_targets']),
  ];
  assertExactKeys(value, finalizeKeys, `${String(value.status)} finalize result`);
  if (
    value.ok !== (!failed && !liveDrift && !compensationRequired) ||
    value.command !== 'cmd_dataset_flow_identity_scope_finalize_guarded' ||
    value.schema_version !== 'dataset-flow-identity-scope-finalize-result.v2' ||
    value.scope_id !== options.scopeId ||
    value.receipt_id !== options.plan.receipt_id ||
    value.receipt_proof_sha256 !== options.plan.receipt_proof_sha256 ||
    value.mapping_guard_set_sha256 !== options.plan.mapping_guard_set_sha256 ||
    value.process_intent_set_sha256 !== options.plan.process_intent_set_sha256 ||
    value.operation_id !== options.plan.operation_id ||
    value.plan_sha256 !== options.plan.plan_sha256 ||
    value.scope_proof_sha256 !== options.scopeProofSha256 ||
    !['derivatives_pending', 'completed', 'live_drift', 'failed'].includes(String(value.status)) ||
    value.process_count !== expected.process_count ||
    value.rewrite_count !== expected.rewrite_count ||
    value.completed_process_count !== expected.completed_process_count ||
    !HASH_PATTERN.test(String(value.primary_closure_sha256)) ||
    !HASH_PATTERN.test(String(value.protected_closure_sha256)) ||
    !HASH_PATTERN.test(String(value.derivative_target_set_sha256)) ||
    !HASH_PATTERN.test(String(value.derivative_proof_set_sha256)) ||
    value.primary_closure_sha256 !== wholeScopeProof.primary_closure_sha256 ||
    value.protected_closure_sha256 !== wholeScopeProof.protected_closure_sha256 ||
    value.derivative_proof_set_sha256 !== wholeScopeProof.derivative_proof_set_sha256 ||
    typeof value.primary_current !== 'boolean' ||
    value.primary_current !== wholeScopeProof.primary_current ||
    typeof value.live_guard_current !== 'boolean' ||
    value.live_guard_current !==
      (wholeScopeProof.audit_current &&
        wholeScopeProof.source_guards_current &&
        wholeScopeProof.support_guards_current &&
        wholeScopeProof.target_guards_current &&
        wholeScopeProof.protected_closure_current &&
        wholeScopeProof.occurrence_closure_current) ||
    typeof value.derivatives_current !== 'boolean' ||
    value.derivatives_current !== wholeScopeProof.derivatives_current ||
    value.whole_scope_proof_sha256 !== wholeScopeProof.proof_sha256 ||
    (derivativesPending &&
      (typeof value.compensation_required !== 'boolean' ||
        !Array.isArray(value.compensation_targets) ||
        value.automatic_retry !== false ||
        ![
          'FLOW_IDENTITY_DERIVATIVES_PENDING',
          'FLOW_IDENTITY_DERIVATIVE_COMPENSATION_REQUIRED',
        ].includes(String(value.code)))) ||
    (completed
      ? !HASH_PATTERN.test(String(value.terminal_proof_sha256))
      : value.terminal_proof_sha256 !== null) ||
    (completed
      ? typeof value.audit_id !== 'string' || !value.audit_id.trim()
      : value.audit_id !== null &&
        (typeof value.audit_id !== 'string' || !value.audit_id.trim())) ||
    typeof value.replay !== 'boolean'
  ) {
    fail('Flow identity finalize proof does not match the exact expected closure.');
  }
  if (
    completed &&
    (!value.primary_current ||
      !value.live_guard_current ||
      !value.derivatives_current ||
      !wholeScopeProof.audit_current ||
      wholeScopeProof.approved_reference_residue_count !== 0 ||
      !wholeScopeProof.causal_terminal_proof)
  ) {
    fail('Completed finalize replay is not dynamically current across the whole scope.');
  }
  if (
    liveDrift &&
    (value.ok !== false ||
      value.code !== 'FLOW_IDENTITY_PRIMARY_OR_GUARD_DRIFT' ||
      (value.primary_current === true && value.live_guard_current === true) ||
      value.derivatives_current !== false ||
      value.compensation_required !== false ||
      !Array.isArray(value.compensation_targets) ||
      value.compensation_targets.length !== 0)
  ) {
    fail('Live-drift finalize response must be a non-compensable dynamic downgrade.');
  }
  if (
    failed &&
    (value.code !== 'FLOW_IDENTITY_FINALIZE_FAILED' ||
      value.compensation_required !== false ||
      value.automatic_retry !== false ||
      !Array.isArray(value.compensation_targets) ||
      value.compensation_targets.length !== 0)
  ) {
    fail('Failed finalize response must be the exact non-compensable v2 envelope.');
  }
  parseCompensationEnvelope(value, options.plan, options.scopeId, 'finalize');
  return {
    ...(value as FlowIdentityFinalizeProof),
    whole_scope_proof: wholeScopeProof,
  };
}

export function prepareFlowIdentityExecution(options: {
  plan: unknown;
  freeze: unknown;
  approval: unknown;
}): {
  plan: FlowIdentityPlan;
  freeze: FlowIdentityFreeze;
  approval: FlowIdentityApproval;
  identity: FlowIdentityExecutionIdentity;
  preflightRequest: JsonObject;
} {
  const plan = parseFlowIdentityPlan(options.plan);
  const freeze = parseFlowIdentityFreeze(options.freeze, plan);
  const approval = parseFlowIdentityApproval(options.approval, plan, freeze);
  const identity = buildFlowIdentityExecutionIdentity({ plan, freeze, approval });
  return {
    plan,
    freeze,
    approval,
    identity,
    preflightRequest: buildFlowIdentityScopePreflightRequest({ plan, identity }),
  };
}

export const __testInternals = {
  deterministicUuidFromSha256,
  hash,
  instant,
  integer,
  parseScopeProcess,
  parseCompensationEnvelope,
  token,
  uuid,
};
