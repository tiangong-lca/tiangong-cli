import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  ensurePrivateArtifactDirectory,
  readProtectedJsonArtifact,
  writePrivateImmutableJson,
} from './dataset-maintenance-protected-artifacts.js';
import {
  buildFlowIdentityFinalizeRequest,
  buildFlowIdentityProcessRequest,
  flowIdentityScopeHasCurrentDerivativeClosure,
  flowIdentityScopeIsReadyToFinalize,
  parseFlowIdentityFinalizeProof,
  parseFlowIdentityProcessProof,
  parseFlowIdentityScopePreflightProof,
  parseFlowIdentityScopeStatus,
  prepareFlowIdentityExecution,
  type FlowIdentityFinalizeProof,
  type FlowIdentityScopePreflightProof,
  type FlowIdentityScopeStatus,
} from './dataset-maintenance-flow-identity-execution-contract.js';
import { isJsonObject, sha256Json, stableJsonText } from './dataset-maintenance-contract.js';
import { flowIdentityRestrictedSha256 } from './dataset-maintenance-flow-identity-wire.js';
import type {
  FlowIdentityPlan,
  FlowIdentityProcessTemplate,
} from './dataset-maintenance-flow-identity-contract.js';
import {
  finalizeMaintenanceFlowIdentityScope,
  preflightMaintenanceFlowIdentityScope,
  readMaintenanceFlowIdentityScope,
  resolveMaintenanceRemoteContext,
  rewriteMaintenanceFlowIdentityProcess,
  type DatasetMaintenanceRemoteContext,
} from './dataset-maintenance-remote.js';
import { CliError } from './errors.js';
import type { FetchLike } from './http.js';
import { withStateFileLock } from './state-lock.js';

export type FlowIdentityRunStatus = 'passed' | 'pending' | 'blocked' | 'failed' | 'indeterminate';

export type RunFlowIdentityOptions = {
  planPath: string;
  freezePath: string;
  approvalPath: string;
  outDir: string;
  commit: boolean;
  statusOnly: boolean;
  approveExecution?: string;
  confirm?: string;
  waitSeconds?: number;
  pollMs?: number;
  timeoutMs?: number;
  env: NodeJS.ProcessEnv;
  fetchImpl: FetchLike;
  now?: Date;
  sleep?: (ms: number) => Promise<void>;
};

export type FlowIdentityRunReport = {
  schema_version: 'dataset-flow-identity-run-report.v2';
  generated_at_utc: string;
  mode: 'commit' | 'status_only';
  status: FlowIdentityRunStatus;
  operation_id: string;
  plan_sha256: string;
  request_id: string;
  identity_sha256: string;
  scope_id: string | null;
  database_status: FlowIdentityScopeStatus['status'] | null;
  process_count: number;
  completed_process_count: number;
  next_ordinal: number | null;
  automatic_retry: false;
  issues: Array<{ code: string; message: string; details?: unknown }>;
};

type ProcessTemplate = Pick<
  FlowIdentityProcessTemplate,
  'process' | 'rewrites' | 'collision_ledger'
>;

type PreparedRun = ReturnType<typeof prepareFlowIdentityExecution> & {
  planPath: string;
  outDir: string;
  templates: ProcessTemplate[];
};

type RunDependencies = {
  resolveContext: typeof resolveMaintenanceRemoteContext;
  preflight: typeof preflightMaintenanceFlowIdentityScope;
  rewrite: typeof rewriteMaintenanceFlowIdentityProcess;
  read: typeof readMaintenanceFlowIdentityScope;
  finalize: typeof finalizeMaintenanceFlowIdentityScope;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
};

const DEFAULT_POLL_MS = 10_000;

function fail(message: string, code: string, details?: unknown): never {
  throw new CliError(message, {
    code,
    exitCode: 1,
    ...(details === undefined ? {} : { details }),
  });
}

function errorDetails(error: unknown): { name: string; message: string; code: string | null } {
  return {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
    code:
      error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : null,
  };
}

function readCanonicalJson(filePath: string, label: string): unknown {
  const artifact = readProtectedJsonArtifact({ filePath, label });
  if (artifact.text !== `${stableJsonText(artifact.value)}\n`) {
    fail(
      `${label} must be canonical JSON with exactly one trailing newline.`,
      'DATASET_FLOW_IDENTITY_ARTIFACT_NONCANONICAL',
    );
  }
  return artifact.value;
}

function processStem(ordinal: number, id: string, version: string): string {
  return `${String(ordinal).padStart(6, '0')}-${id}-${version}`;
}

function loadProcessTemplates(planPath: string, plan: FlowIdentityPlan): ProcessTemplate[] {
  const planDir = path.dirname(planPath);
  return plan.processes.map((process) => {
    const filePath = path.join(
      planDir,
      plan.artifacts.process_request_dir,
      `${processStem(process.ordinal, process.id, process.version)}.json`,
    );
    const value = readCanonicalJson(filePath, `Flow identity process template ${process.ordinal}`);
    if (
      !isJsonObject(value) ||
      !isJsonObject(value.process) ||
      !Array.isArray(value.rewrites) ||
      !isJsonObject(value.collision_ledger) ||
      sha256Json(value.process) !== sha256Json(process) ||
      sha256Json(value.rewrites) !== process.rewrite_set_sha256 ||
      sha256Json(value.collision_ledger) !== process.collision_ledger_sha256 ||
      value.rewrites.length !== process.rewrite_count
    ) {
      fail(
        `Process template ${process.ordinal} does not bind the sealed manifest.`,
        'DATASET_FLOW_IDENTITY_PROCESS_TEMPLATE_INVALID',
      );
    }
    return value as unknown as ProcessTemplate;
  });
}

function prepareRun(options: RunFlowIdentityOptions): PreparedRun {
  if (options.commit === options.statusOnly) {
    fail('Choose exactly one of commit or statusOnly.', 'DATASET_FLOW_IDENTITY_RUN_MODE_INVALID');
  }
  const planPath = path.resolve(options.planPath);
  const prepared = prepareFlowIdentityExecution({
    plan: readCanonicalJson(planPath, 'Flow identity plan'),
    freeze: readCanonicalJson(options.freezePath, 'Flow identity freeze'),
    approval: readCanonicalJson(options.approvalPath, 'Flow identity approval'),
  });
  if (options.commit) {
    if (
      options.approveExecution !== prepared.identity.identity_sha256 ||
      options.confirm !== prepared.plan.account.email
    ) {
      fail(
        'Commit requires the exact execution identity hash and frozen account email.',
        'DATASET_FLOW_IDENTITY_EXECUTION_APPROVAL_REQUIRED',
      );
    }
  }
  const outDir = ensurePrivateArtifactDirectory(options.outDir);
  return {
    ...prepared,
    planPath,
    outDir,
    templates: loadProcessTemplates(planPath, prepared.plan),
  };
}

function assertContext(prepared: PreparedRun, context: DatasetMaintenanceRemoteContext): void {
  if (
    context.project_ref !== prepared.plan.project_ref ||
    context.account.user_id !== prepared.plan.account.user_id ||
    context.account.email.trim().toLowerCase() !== prepared.plan.account.email
  ) {
    fail(
      'Authenticated production RLS context does not match the sealed plan.',
      'DATASET_FLOW_IDENTITY_CONTEXT_MISMATCH',
      {
        expected_project_ref: prepared.plan.project_ref,
        observed_project_ref: context.project_ref,
        expected_user_id: prepared.plan.account.user_id,
        observed_user_id: context.account.user_id,
      },
    );
  }
}

function numberedArtifact(directory: string, prefix: string): string {
  let ordinal = 1;
  while (existsSync(path.join(directory, `${prefix}.${String(ordinal).padStart(6, '0')}.json`))) {
    ordinal += 1;
  }
  return path.join(directory, `${prefix}.${String(ordinal).padStart(6, '0')}.json`);
}

function writeStatusSnapshot(prepared: PreparedRun, value: unknown): void {
  writePrivateImmutableJson(numberedArtifact(prepared.outDir, 'scope-status'), value);
}

function readStoredPreflight(prepared: PreparedRun): FlowIdentityScopePreflightProof | null {
  const filePath = path.join(prepared.outDir, 'scope-preflight-proof.json');
  if (!existsSync(filePath)) return null;
  return parseFlowIdentityScopePreflightProof(
    readCanonicalJson(filePath, 'Flow identity scope preflight proof'),
    prepared.plan,
  );
}

async function obtainScope(options: {
  command: RunFlowIdentityOptions;
  prepared: PreparedRun;
  context: DatasetMaintenanceRemoteContext;
  dependencies: RunDependencies;
}): Promise<FlowIdentityScopePreflightProof> {
  const stored = readStoredPreflight(options.prepared);
  if (stored) return stored;
  if (options.command.statusOnly) {
    fail(
      'Status-only recovery requires the immutable local scope preflight proof.',
      'DATASET_FLOW_IDENTITY_SCOPE_PROOF_REQUIRED',
    );
  }
  writePrivateImmutableJson(path.join(options.prepared.outDir, 'scope-preflight-attempt.json'), {
    schema_version: 'dataset-flow-identity-preflight-attempt.v2',
    generated_at_utc: options.dependencies.now().toISOString(),
    request_id: options.prepared.identity.request_id,
    plan_sha256: options.prepared.plan.plan_sha256,
    request_sha256: flowIdentityRestrictedSha256(options.prepared.preflightRequest),
    exact_replay_allowed: true,
    automatic_retry: false,
  });
  const raw = await options.dependencies.preflight({
    context: options.context,
    request: options.prepared.preflightRequest,
  });
  const proof = parseFlowIdentityScopePreflightProof(raw, options.prepared.plan);
  writePrivateImmutableJson(
    path.join(options.prepared.outDir, 'scope-preflight-proof.json'),
    proof,
  );
  return proof;
}

async function readScope(options: {
  prepared: PreparedRun;
  context: DatasetMaintenanceRemoteContext;
  scope: FlowIdentityScopePreflightProof;
  dependencies: RunDependencies;
}): Promise<FlowIdentityScopeStatus> {
  const raw = await options.dependencies.read({
    context: options.context,
    scopeId: options.scope.scope_id,
  });
  const status = parseFlowIdentityScopeStatus(
    raw,
    options.prepared.plan,
    options.scope.scope_id,
    options.scope.scope_proof_sha256,
  );
  writeStatusSnapshot(options.prepared, status);
  return status;
}

function validateCompletedRequests(prepared: PreparedRun, status: FlowIdentityScopeStatus): void {
  for (const ledger of status.processes.filter((entry) => entry.status === 'completed')) {
    const template = prepared.templates[ledger.ordinal - 1];
    if (!template) {
      fail(
        'Database progress contains a foreign completed ordinal.',
        'DATASET_FLOW_IDENTITY_PROGRESS_INVALID',
      );
    }
    const request = buildFlowIdentityProcessRequest({
      scopeProofSha256: status.scope_proof_sha256,
      ordinal: ledger.ordinal,
      processIntentProofSha256: ledger.process_intent_proof_sha256,
    });
    if (ledger.process_request_sha256 !== request.process_request_sha256) {
      fail(
        `Completed process ${ledger.ordinal} used a foreign request hash.`,
        'DATASET_FLOW_IDENTITY_PROGRESS_INVALID',
      );
    }
  }
}

function requirePendingProcess(
  prepared: PreparedRun,
  status: FlowIdentityScopeStatus,
  ordinal: number,
): { ledger: FlowIdentityScopeStatus['processes'][number]; template: ProcessTemplate } {
  const ledger = status.processes[ordinal - 1];
  const template = prepared.templates[ordinal - 1];
  if (!ledger || !template || ledger.status !== 'pending') {
    fail(
      'Durable scope did not expose exactly one pending next ordinal.',
      'DATASET_FLOW_IDENTITY_NEXT_ORDINAL_INVALID',
    );
  }
  return { ledger, template };
}

function report(options: {
  prepared: PreparedRun;
  mode: 'commit' | 'status_only';
  status: FlowIdentityRunStatus;
  scope: FlowIdentityScopePreflightProof | null;
  database: FlowIdentityScopeStatus | null;
  issues?: FlowIdentityRunReport['issues'];
  now: Date;
}): FlowIdentityRunReport {
  const value: FlowIdentityRunReport = {
    schema_version: 'dataset-flow-identity-run-report.v2',
    generated_at_utc: options.now.toISOString(),
    mode: options.mode,
    status: options.status,
    operation_id: options.prepared.plan.operation_id,
    plan_sha256: options.prepared.plan.plan_sha256,
    request_id: options.prepared.identity.request_id,
    identity_sha256: options.prepared.identity.identity_sha256,
    scope_id: options.scope?.scope_id ?? null,
    database_status: options.database?.status ?? null,
    process_count: options.prepared.plan.processes.length,
    completed_process_count: options.database?.completed_process_count ?? 0,
    next_ordinal: options.database?.next_ordinal ?? null,
    automatic_retry: false,
    issues: options.issues ?? [],
  };
  writePrivateImmutableJson(numberedArtifact(options.prepared.outDir, 'run-report'), value);
  return value;
}

function hasFlowIdentityFinalizeDecision(status: FlowIdentityScopeStatus): boolean {
  return (
    status.status === 'completed' ||
    status.status === 'live_drift' ||
    status.status === 'failed' ||
    status.compensation_required === true ||
    flowIdentityScopeIsReadyToFinalize(status)
  );
}

function completedRunStatus(status: FlowIdentityScopeStatus): 'passed' | 'blocked' {
  return flowIdentityScopeHasCurrentDerivativeClosure(status) ? 'passed' : 'blocked';
}

async function waitForFinalizeDecision(options: {
  command: RunFlowIdentityOptions;
  prepared: PreparedRun;
  context: DatasetMaintenanceRemoteContext;
  scope: FlowIdentityScopePreflightProof;
  initial: FlowIdentityScopeStatus;
  dependencies: RunDependencies;
}): Promise<FlowIdentityScopeStatus> {
  const waitSeconds = options.command.waitSeconds ?? 0;
  const pollMs = options.command.pollMs ?? DEFAULT_POLL_MS;
  if (!Number.isInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > 86_400) {
    fail('waitSeconds must be an integer from 0 to 86400.', 'DATASET_FLOW_IDENTITY_WAIT_INVALID');
  }
  if (!Number.isInteger(pollMs) || pollMs < 100 || pollMs > 60_000) {
    fail('pollMs must be an integer from 100 to 60000.', 'DATASET_FLOW_IDENTITY_POLL_INVALID');
  }
  const deadline = Date.now() + waitSeconds * 1_000;
  let current = options.initial;
  while (!hasFlowIdentityFinalizeDecision(current) && Date.now() < deadline) {
    await options.dependencies.sleep(Math.min(pollMs, Math.max(deadline - Date.now(), 0)));
    current = await readScope(options);
    validateCompletedRequests(options.prepared, current);
  }
  return current;
}

async function executeRun(
  command: RunFlowIdentityOptions,
  dependencies: RunDependencies,
): Promise<FlowIdentityRunReport> {
  const prepared = prepareRun(command);
  const mode = command.commit ? 'commit' : 'status_only';
  const context = await dependencies.resolveContext({
    env: command.env,
    fetchImpl: command.fetchImpl,
    timeoutMs: command.timeoutMs,
    now: command.now,
  });
  assertContext(prepared, context);
  const scope = await obtainScope({ command, prepared, context, dependencies });
  let status = await readScope({ prepared, context, scope, dependencies });
  validateCompletedRequests(prepared, status);
  if (status.status === 'failed' || status.status === 'live_drift') {
    return report({
      prepared,
      mode,
      status: status.status === 'live_drift' ? 'blocked' : 'failed',
      scope,
      database: status,
      issues:
        status.status === 'live_drift'
          ? [
              {
                code: status.code ?? 'FLOW_IDENTITY_PRIMARY_OR_GUARD_DRIFT',
                message:
                  'The database dynamically reproved primary or guard drift; no process submission or compensation is allowed.',
              },
            ]
          : [],
      now: dependencies.now(),
    });
  }
  if (!status.live_guard_current || !status.protected_closure_current) {
    return report({
      prepared,
      mode,
      status: 'blocked',
      scope,
      database: status,
      issues: [
        {
          code: 'DATASET_FLOW_IDENTITY_PROTECTED_CLOSURE_DRIFT',
          message:
            'The exactly sealed pending/blocker/orphan closure changed; no process submission is allowed.',
        },
      ],
      now: dependencies.now(),
    });
  }
  if (status.status === 'completed') {
    return report({
      prepared,
      mode,
      status: completedRunStatus(status),
      scope,
      database: status,
      now: dependencies.now(),
    });
  }
  if (command.statusOnly) {
    status = await waitForFinalizeDecision({
      command,
      prepared,
      context,
      scope,
      initial: status,
      dependencies,
    });
    return report({
      prepared,
      mode,
      status:
        status.status === 'completed'
          ? completedRunStatus(status)
          : status.status === 'live_drift'
            ? 'blocked'
            : status.status === 'failed'
              ? 'failed'
              : 'pending',
      scope,
      database: status,
      issues: status.compensation_required
        ? [
            {
              code: 'FLOW_IDENTITY_DERIVATIVE_COMPENSATION_REQUIRED',
              message:
                'A derivative-only compensation needs a separate plan, freeze, and exact approval; the process mutation will not be replayed.',
              details: { compensation_targets: status.compensation_targets },
            },
          ]
        : status.status !== 'completed' && flowIdentityScopeIsReadyToFinalize(status)
          ? [
              {
                code: 'FLOW_IDENTITY_FINALIZE_READY',
                message:
                  'The derivative closure is ready. Status-only mode remains read-only; an explicit approved commit invocation is required to finalize.',
              },
            ]
          : [],
      now: dependencies.now(),
    });
  }

  let nextOrdinal: number | null = status.next_ordinal;
  let submittedProcesses = 0;
  while (
    !status.primary_complete &&
    nextOrdinal !== null &&
    nextOrdinal <= prepared.plan.processes.length
  ) {
    if (
      !status.primary_current ||
      !status.live_guard_current ||
      !status.protected_closure_current
    ) {
      return report({
        prepared,
        mode,
        status: 'blocked',
        scope,
        database: status,
        issues: [
          {
            code: 'DATASET_FLOW_IDENTITY_PROTECTED_CLOSURE_DRIFT',
            message:
              'The exactly sealed pending/blocker/orphan closure changed; no next process will be submitted.',
          },
        ],
        now: dependencies.now(),
      });
    }
    const ordinal = nextOrdinal;
    const { ledger, template } = requirePendingProcess(prepared, status, ordinal);
    const request = buildFlowIdentityProcessRequest({
      scopeProofSha256: scope.scope_proof_sha256,
      ordinal,
      processIntentProofSha256: ledger.process_intent_proof_sha256,
    });
    const markerPath = path.join(
      prepared.outDir,
      `process-attempt-${String(ordinal).padStart(6, '0')}.json`,
    );
    if (existsSync(markerPath)) {
      return report({
        prepared,
        mode,
        status: 'blocked',
        scope,
        database: status,
        issues: [
          {
            code: 'DATASET_FLOW_IDENTITY_PROCESS_ATTEMPT_AMBIGUOUS',
            message: `Process ${ordinal} has a local attempt marker but no durable completed proof; no automatic retry is allowed.`,
          },
        ],
        now: dependencies.now(),
      });
    }
    writePrivateImmutableJson(markerPath, {
      schema_version: 'dataset-flow-identity-process-attempt.v2',
      generated_at_utc: dependencies.now().toISOString(),
      scope_id: scope.scope_id,
      scope_proof_sha256: scope.scope_proof_sha256,
      ordinal,
      process_request_sha256: request.process_request_sha256,
      max_posts: 1,
      automatic_retry: false,
    });
    try {
      const raw = await dependencies.rewrite({
        context,
        scopeId: scope.scope_id,
        request,
      });
      const proof = parseFlowIdentityProcessProof({
        value: raw,
        scopeId: scope.scope_id,
        process: template.process,
        requestSha256: String(request.process_request_sha256),
        receiptId: prepared.plan.receipt_id,
        receiptProofSha256: prepared.plan.receipt_proof_sha256,
        mappingGuardSetSha256: prepared.plan.mapping_guard_set_sha256,
        processIntentSetSha256: prepared.plan.process_intent_set_sha256,
        processIntentProofSha256: ledger.process_intent_proof_sha256,
        processCount: prepared.plan.processes.length,
      });
      writePrivateImmutableJson(
        path.join(prepared.outDir, `process-proof-${String(ordinal).padStart(6, '0')}.json`),
        proof,
      );
      submittedProcesses += 1;
      nextOrdinal = proof.next_ordinal;
    } catch (error) {
      writePrivateImmutableJson(
        path.join(
          prepared.outDir,
          `process-transport-error-${String(ordinal).padStart(6, '0')}.json`,
        ),
        {
          schema_version: 'dataset-flow-identity-process-transport-error.v1',
          observed_at_utc: dependencies.now().toISOString(),
          ordinal,
          process_request_sha256: request.process_request_sha256,
          automatic_retry: false,
          recovery: 'read_scope_only',
          error: errorDetails(error),
        },
      );
      let recovered: FlowIdentityScopeStatus | null = null;
      try {
        recovered = await readScope({ prepared, context, scope, dependencies });
        validateCompletedRequests(prepared, recovered);
      } catch (readError) {
        writePrivateImmutableJson(
          path.join(
            prepared.outDir,
            `process-recovery-read-error-${String(ordinal).padStart(6, '0')}.json`,
          ),
          { observed_at_utc: dependencies.now().toISOString(), error: errorDetails(readError) },
        );
      }
      return report({
        prepared,
        mode,
        status: 'indeterminate',
        scope,
        database: recovered,
        issues: [
          {
            code: 'DATASET_FLOW_IDENTITY_PROCESS_RESPONSE_AMBIGUOUS',
            message:
              'Process response was ambiguous; durable scope was read once and no process submission was retried.',
            details: errorDetails(error),
          },
        ],
        now: dependencies.now(),
      });
    }
  }

  if (submittedProcesses > 0) {
    status = await readScope({ prepared, context, scope, dependencies });
    validateCompletedRequests(prepared, status);
  }

  if (!status.primary_current || !status.live_guard_current || !status.protected_closure_current) {
    return report({
      prepared,
      mode,
      status: 'blocked',
      scope,
      database: status,
      issues: [
        {
          code: 'DATASET_FLOW_IDENTITY_PROTECTED_CLOSURE_DRIFT',
          message:
            'The exactly sealed pending/blocker/orphan closure changed after the last process; finalize is forbidden.',
        },
      ],
      now: dependencies.now(),
    });
  }

  status = await waitForFinalizeDecision({
    command,
    prepared,
    context,
    scope,
    initial: status,
    dependencies,
  });
  if (status.status === 'completed') {
    return report({
      prepared,
      mode,
      status: completedRunStatus(status),
      scope,
      database: status,
      now: dependencies.now(),
    });
  }
  if (status.status === 'live_drift' || status.status === 'failed') {
    return report({
      prepared,
      mode,
      status: status.status === 'live_drift' ? 'blocked' : 'failed',
      scope,
      database: status,
      issues:
        status.status === 'live_drift'
          ? [
              {
                code: status.code ?? 'FLOW_IDENTITY_PRIMARY_OR_GUARD_DRIFT',
                message:
                  'The database dynamically reproved primary or guard drift while derivatives were settling; finalize was not submitted.',
              },
            ]
          : [],
      now: dependencies.now(),
    });
  }
  if (!status.primary_current || !status.live_guard_current || !status.protected_closure_current) {
    return report({
      prepared,
      mode,
      status: 'blocked',
      scope,
      database: status,
      issues: [
        {
          code: 'DATASET_FLOW_IDENTITY_PROTECTED_CLOSURE_DRIFT',
          message:
            'The exactly sealed closure changed while derivatives were settling; finalize was not submitted.',
        },
      ],
      now: dependencies.now(),
    });
  }
  if (status.compensation_required) {
    return report({
      prepared,
      mode,
      status: 'pending',
      scope,
      database: status,
      issues: [
        {
          code: 'FLOW_IDENTITY_DERIVATIVE_COMPENSATION_REQUIRED',
          message:
            'A derivative-only compensation needs a separate plan, freeze, and exact approval; finalize was not submitted and the process mutation will not be replayed.',
          details: { compensation_targets: status.compensation_targets },
        },
      ],
      now: dependencies.now(),
    });
  }
  if (!flowIdentityScopeIsReadyToFinalize(status)) {
    return report({
      prepared,
      mode,
      status: 'pending',
      scope,
      database: status,
      issues: [
        {
          code: 'FLOW_IDENTITY_DERIVATIVES_PENDING',
          message:
            'Derivative closure is still pending at the wait deadline; finalize was not submitted. A later explicit invocation may reuse the same exact approval.',
        },
      ],
      now: dependencies.now(),
    });
  }

  const finalizeRequest = buildFlowIdentityFinalizeRequest({
    scopeProofSha256: scope.scope_proof_sha256,
    plan: prepared.plan,
    status,
  });
  writePrivateImmutableJson(numberedArtifact(prepared.outDir, 'finalize-attempt'), {
    schema_version: 'dataset-flow-identity-finalize-attempt.v2',
    generated_at_utc: dependencies.now().toISOString(),
    scope_id: scope.scope_id,
    request_sha256: flowIdentityRestrictedSha256(finalizeRequest),
    max_posts: 1,
    automatic_retry: false,
  });
  let finalizeProof: FlowIdentityFinalizeProof;
  try {
    const raw = await dependencies.finalize({
      context,
      scopeId: scope.scope_id,
      request: finalizeRequest,
    });
    finalizeProof = parseFlowIdentityFinalizeProof({
      value: raw,
      plan: prepared.plan,
      scopeId: scope.scope_id,
      scopeProofSha256: scope.scope_proof_sha256,
      request: finalizeRequest,
    });
    writePrivateImmutableJson(numberedArtifact(prepared.outDir, 'finalize-proof'), finalizeProof);
  } catch (error) {
    writePrivateImmutableJson(numberedArtifact(prepared.outDir, 'finalize-transport-error'), {
      observed_at_utc: dependencies.now().toISOString(),
      automatic_retry: false,
      recovery: 'read_scope_only',
      error: errorDetails(error),
    });
    let recovered: FlowIdentityScopeStatus | null = null;
    try {
      recovered = await readScope({ prepared, context, scope, dependencies });
      validateCompletedRequests(prepared, recovered);
    } catch {
      // The immutable transport error is sufficient; never replace it with a blind finalize retry.
    }
    return report({
      prepared,
      mode,
      status: 'indeterminate',
      scope,
      database: recovered,
      issues: [
        {
          code: 'DATASET_FLOW_IDENTITY_FINALIZE_RESPONSE_AMBIGUOUS',
          message:
            'Finalize response was ambiguous; scope was read once and finalize was not retried in this invocation.',
          details: errorDetails(error),
        },
      ],
      now: dependencies.now(),
    });
  }
  status = await readScope({ prepared, context, scope, dependencies });
  validateCompletedRequests(prepared, status);
  return report({
    prepared,
    mode,
    status:
      finalizeProof.status === 'completed' &&
      status.status === 'completed' &&
      flowIdentityScopeHasCurrentDerivativeClosure(status)
        ? 'passed'
        : status.status === 'live_drift' || finalizeProof.status === 'live_drift'
          ? 'blocked'
          : status.status === 'failed' || finalizeProof.status === 'failed'
            ? 'failed'
            : 'pending',
    scope,
    database: status,
    issues: finalizeProof.compensation_required
      ? [
          {
            code: 'FLOW_IDENTITY_DERIVATIVE_COMPENSATION_REQUIRED',
            message:
              'A derivative-only compensation needs a separate plan, freeze, and exact approval; the process mutation will not be replayed.',
            details: { compensation_targets: finalizeProof.compensation_targets },
          },
        ]
      : [],
    now: dependencies.now(),
  });
}

export async function runFlowIdentity(
  options: RunFlowIdentityOptions,
): Promise<FlowIdentityRunReport> {
  const outDir = path.resolve(options.outDir);
  return withStateFileLock(
    path.join(outDir, 'flow-identity-run-state'),
    { reason: 'dataset flow identity serial runner', timeoutMs: 0 },
    () =>
      executeRun(options, {
        resolveContext: resolveMaintenanceRemoteContext,
        preflight: preflightMaintenanceFlowIdentityScope,
        rewrite: rewriteMaintenanceFlowIdentityProcess,
        read: readMaintenanceFlowIdentityScope,
        finalize: finalizeMaintenanceFlowIdentityScope,
        sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
        now: () => options.now ?? new Date(),
      }),
  );
}

export const __testInternals = {
  assertContext,
  completedRunStatus,
  errorDetails,
  executeRun,
  loadProcessTemplates,
  numberedArtifact,
  prepareRun,
  processStem,
  readCanonicalJson,
  requirePendingProcess,
  report,
  validateCompletedRequests,
  waitForFinalizeDecision,
};
