import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  DATASET_MAINTENANCE_SUPPORT_APPROVAL_SCHEMA,
  isJsonObject,
  normalizeMaintenanceAuditId,
  parseMaintenancePlan,
  parseMaintenanceSupportApprovalRecord,
  readJsonFile,
  snapshotRemoteRow,
  writeImmutableJson,
  type DatasetMaintenancePlan,
  type DatasetMaintenancePlanAction,
  type DatasetMaintenancePublishTable,
  type DatasetMaintenanceRemoteRow,
  type DatasetMaintenanceSupportApprovalAction,
  type DatasetMaintenanceSupportApprovalRecord,
} from './dataset-maintenance-contract.js';
import { CliError } from './errors.js';
import type { FetchLike } from './http.js';
import {
  approveMaintenanceSupportRow,
  resolveMaintenanceRemoteContext,
  type DatasetMaintenanceRemoteContext,
} from './dataset-maintenance-remote.js';
import { withStateFileLock } from './state-lock.js';

export type RunDatasetMaintenanceApproveSupportOptions = {
  planPath: string;
  approvePlan: string;
  confirm: string;
  outPath?: string;
  timeoutMs?: number;
  env: NodeJS.ProcessEnv;
  fetchImpl: FetchLike;
  now?: Date;
};

function clock(options: RunDatasetMaintenanceApproveSupportOptions): string {
  return (options.now ?? new Date()).toISOString();
}

function assertApprovablePlan(plan: DatasetMaintenancePlan, approvePlan: string): void {
  if (plan.operation !== 'publish-support') {
    throw new CliError('approve-support accepts only publish-support maintenance plans.', {
      code: 'DATASET_MAINTENANCE_SUPPORT_APPROVAL_OPERATION_INVALID',
      exitCode: 2,
    });
  }
  if (approvePlan !== plan.plan_sha256) {
    throw new CliError('approvePlan must exactly match the canonical maintenance plan hash.', {
      code: 'DATASET_MAINTENANCE_PLAN_APPROVAL_REQUIRED',
      exitCode: 2,
    });
  }
  if (
    plan.status !== 'ready' ||
    plan.blockers.length > 0 ||
    plan.actions.some((action) => action.action !== 'publish' || !action.before)
  ) {
    throw new CliError('Only a ready, publish-only support plan can be approved.', {
      code: 'DATASET_MAINTENANCE_SUPPORT_APPROVAL_PLAN_BLOCKED',
      exitCode: 1,
      details: plan.blockers,
    });
  }
}

function normalizedTargetRow(
  action: DatasetMaintenancePlanAction,
  value: unknown,
): DatasetMaintenanceRemoteRow | null {
  if (
    !isJsonObject(value) ||
    value.id !== action.id ||
    value.version !== action.version ||
    typeof value.user_id !== 'string' ||
    typeof value.state_code !== 'number' ||
    typeof value.modified_at !== 'string' ||
    !isJsonObject(value.json_ordered)
  ) {
    return null;
  }
  return {
    table: action.table,
    id: value.id,
    version: value.version,
    user_id: value.user_id,
    state_code: value.state_code,
    modified_at: value.modified_at,
    json_ordered: value.json_ordered,
    model_id: typeof value.model_id === 'string' ? value.model_id : null,
    rule_verification:
      typeof value.rule_verification === 'boolean' ? value.rule_verification : null,
  };
}

async function approveAction(options: {
  action: DatasetMaintenancePlanAction;
  plan: DatasetMaintenancePlan;
  context: DatasetMaintenanceRemoteContext;
}): Promise<DatasetMaintenanceSupportApprovalAction> {
  const before = options.action.before;
  if (
    options.action.action !== 'publish' ||
    !before ||
    typeof before.modified_at !== 'string' ||
    typeof before.payload_sha256 !== 'string' ||
    !before.json_ordered
  ) {
    throw new CliError(
      `Publish action is missing its frozen snapshot: ${options.action.action_id}`,
      {
        code: 'DATASET_MAINTENANCE_SUPPORT_APPROVAL_PLAN_INVALID',
        exitCode: 2,
      },
    );
  }
  const result = await approveMaintenanceSupportRow({
    context: options.context,
    table: options.action.table as DatasetMaintenancePublishTable,
    id: options.action.id,
    version: options.action.version,
    expectedModifiedAt: before.modified_at,
    expectedPayload: before.json_ordered,
    audit: {
      plan_sha256: options.plan.plan_sha256,
      operation_id: options.plan.operation_id,
      action_id: options.action.action_id,
      reason_code: options.action.reason_code,
      source: 'tiangong-lca dataset maintenance approve-support',
    },
  });
  const data = isJsonObject(result.data) ? result.data : null;
  const approvalAuditId = normalizeMaintenanceAuditId(
    data?.approval_audit_id,
    `Approval RPC audit id for ${options.action.action_id}`,
  );
  const responseAuditId = normalizeMaintenanceAuditId(
    result.audit_id,
    `Approval RPC top-level audit id for ${options.action.action_id}`,
  );
  const target = normalizedTargetRow(options.action, data?.target);
  const targetSnapshot = target ? snapshotRemoteRow(target) : null;
  if (
    responseAuditId !== approvalAuditId ||
    data?.reviewer_user_id !== options.context.account.user_id ||
    data?.target_owner_user_id !== options.action.expected_user_id ||
    typeof result.idempotent_replay !== 'boolean' ||
    !target ||
    target.user_id !== options.action.expected_user_id ||
    target.state_code !== 0 ||
    target.modified_at !== before.modified_at ||
    targetSnapshot?.row_sha256 !== before.row_sha256 ||
    targetSnapshot.payload_sha256 !== before.payload_sha256
  ) {
    throw new CliError(
      `Approval RPC did not return the exact reviewer, target, snapshot, and audit binding for ${options.action.action_id}.`,
      {
        code: 'DATASET_MAINTENANCE_SUPPORT_APPROVAL_RPC_MISMATCH',
        exitCode: 1,
        details: result,
      },
    );
  }
  return {
    ordinal: options.action.ordinal,
    action_id: options.action.action_id,
    action: 'publish',
    table: options.action.table as DatasetMaintenancePublishTable,
    id: options.action.id,
    version: options.action.version,
    reason_code: options.action.reason_code,
    expected_user_id: options.action.expected_user_id,
    expected_state_code: 0,
    expected_modified_at: before.modified_at,
    expected_before_sha256: before.row_sha256,
    expected_payload_sha256: before.payload_sha256,
    plan_sha256: options.plan.plan_sha256,
    operation_id: options.plan.operation_id,
    approval_audit_id: approvalAuditId,
    reviewer_user_id: options.context.account.user_id,
    idempotent_replay: result.idempotent_replay,
  };
}

function sameDurableApprovals(
  existing: DatasetMaintenanceSupportApprovalRecord,
  actions: DatasetMaintenanceSupportApprovalAction[],
): boolean {
  const byId = new Map(existing.actions.map((action) => [action.action_id, action]));
  return actions.every((action) => {
    const prior = byId.get(action.action_id);
    return Boolean(
      prior &&
      prior.approval_audit_id === action.approval_audit_id &&
      prior.reviewer_user_id === action.reviewer_user_id,
    );
  });
}

export async function runDatasetMaintenanceApproveSupport(
  options: RunDatasetMaintenanceApproveSupportOptions,
): Promise<DatasetMaintenanceSupportApprovalRecord> {
  const planPath = path.resolve(options.planPath);
  const plan = parseMaintenancePlan(readJsonFile(planPath, 'Maintenance plan'));
  assertApprovablePlan(plan, options.approvePlan);
  const outPath = path.resolve(
    options.outPath ?? path.join(path.dirname(planPath), 'support-approval-record.json'),
  );
  if (outPath === planPath) {
    throw new CliError('Support approval output cannot overwrite the maintenance plan.', {
      code: 'DATASET_MAINTENANCE_SUPPORT_APPROVAL_OUTPUT_INVALID',
      exitCode: 2,
    });
  }

  return withStateFileLock(
    outPath,
    { reason: `dataset_maintenance_approve_support_${plan.operation_id}` },
    async () => {
      const existing = existsSync(outPath)
        ? parseMaintenanceSupportApprovalRecord(
            readJsonFile(outPath, 'Support approval record'),
            plan,
          )
        : null;
      const context = await resolveMaintenanceRemoteContext({
        env: options.env,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
        now: options.now,
      });
      if (options.confirm !== context.account.email) {
        throw new CliError('confirm must exactly match the current authenticated reviewer email.', {
          code: 'DATASET_MAINTENANCE_REVIEWER_CONFIRMATION_REQUIRED',
          exitCode: 2,
        });
      }
      if (context.account.user_id === plan.account.user_id) {
        throw new CliError('The dataset owner cannot approve their own support publication.', {
          code: 'DATASET_MAINTENANCE_INDEPENDENT_REVIEWER_REQUIRED',
          exitCode: 1,
        });
      }
      if (
        existing &&
        (existing.reviewer.user_id !== context.account.user_id ||
          existing.reviewer.email !== context.account.email)
      ) {
        throw new CliError('Existing support approval belongs to a different reviewer.', {
          code: 'DATASET_MAINTENANCE_SUPPORT_APPROVAL_REVIEWER_MISMATCH',
          exitCode: 1,
        });
      }

      const actions: DatasetMaintenanceSupportApprovalAction[] = [];
      for (const action of [...plan.actions].sort((left, right) => left.ordinal - right.ordinal)) {
        actions.push(await approveAction({ action, plan, context }));
      }
      if (existing) {
        if (!sameDurableApprovals(existing, actions)) {
          throw new CliError(
            'Durable approval replay does not match the existing local artifact.',
            {
              code: 'DATASET_MAINTENANCE_SUPPORT_APPROVAL_REPLAY_MISMATCH',
              exitCode: 1,
            },
          );
        }
        return existing;
      }

      const record: DatasetMaintenanceSupportApprovalRecord = {
        schema: DATASET_MAINTENANCE_SUPPORT_APPROVAL_SCHEMA,
        schema_version: 1,
        approved_at_utc: clock(options),
        plan_path: planPath,
        plan_sha256: plan.plan_sha256,
        task_id: plan.task_id,
        operation: 'publish-support',
        operation_id: plan.operation_id,
        target_owner: {
          user_id: plan.account.user_id,
          email: plan.account.email,
        },
        reviewer: {
          user_id: context.account.user_id,
          email: context.account.email,
        },
        authority: {
          source: 'public.command_audit_log',
          rpc: 'cmd_dataset_support_approve_guarded',
          local_artifact_is_authority: false,
        },
        actions,
      };
      writeImmutableJson(outPath, record);
      return record;
    },
  );
}

export const __testInternals = {
  approveAction,
  assertApprovablePlan,
  clock,
  normalizedTargetRow,
  sameDurableApprovals,
};
