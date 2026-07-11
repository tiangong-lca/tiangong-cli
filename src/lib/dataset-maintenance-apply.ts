import { existsSync } from 'node:fs';
import path from 'node:path';
import { writeJsonArtifact } from './artifacts.js';
import { CliError } from './errors.js';
import type { FetchLike } from './http.js';
import { withStateFileLock } from './state-lock.js';
import {
  appendStableJsonLine,
  isJsonObject,
  maintenanceRowKey,
  parseMaintenancePlan,
  readJsonFile,
  readJsonLinesIfPresent,
  resolveMaintenancePlanArtifactPath,
  sha256Json,
  snapshotRemoteRow,
  writeImmutableJson,
  type DatasetMaintenancePlan,
  type DatasetMaintenancePlanAction,
  type DatasetMaintenanceProgressEntry,
  type DatasetMaintenanceMutableTable,
  type DatasetMaintenancePublishTable,
  type DatasetMaintenanceRemoteRow,
  type JsonObject,
} from './dataset-maintenance-contract.js';
import { maintenanceProjectedReferenceFingerprint } from './dataset-maintenance-plan.js';
import {
  deleteMaintenanceRow,
  fetchMaintenanceAccountRows,
  fetchMaintenanceExactRows,
  publishMaintenanceRow,
  resolveMaintenanceRemoteContext,
  saveDraftMaintenanceRow,
  type DatasetMaintenanceRemoteContext,
} from './dataset-maintenance-remote.js';

export type DatasetMaintenanceApplyReport = {
  schema_version: 1;
  generated_at_utc: string;
  status: 'completed' | 'completed_with_failures';
  task_id: string;
  operation: DatasetMaintenancePlan['operation'];
  operation_id: string;
  plan_sha256: string;
  actor: { user_id: string; email: string };
  summary: {
    actions: number;
    success: number;
    failed: number;
    pending: number;
    resumed_successes: number;
  };
  actions: Array<{
    action_id: string;
    action: DatasetMaintenancePlanAction['action'];
    table: DatasetMaintenancePlanAction['table'];
    id: string;
    version: string;
    status: 'success' | 'failed' | 'pending';
    error: string | null;
  }>;
  artifacts: {
    approval_record: string;
    apply_progress: string;
    commit_report: string;
    attempt_report: string;
  };
  database_audit: {
    rpc_transaction_log: 'public.command_audit_log';
    source: 'tiangong-lca dataset maintenance apply';
    correlation_fields: ['plan_sha256', 'operation_id', 'action_id', 'reason_code'];
  };
};

export type RunDatasetMaintenanceApplyOptions = {
  planPath: string;
  commit: boolean;
  approvePlan: string;
  confirm: string;
  timeoutMs?: number;
  env: NodeJS.ProcessEnv;
  fetchImpl: FetchLike;
  now?: Date;
};

type ProgressState = {
  entries: DatasetMaintenanceProgressEntry[];
  successes: Map<string, DatasetMaintenanceProgressEntry>;
  latestFailures: Map<string, DatasetMaintenanceProgressEntry>;
};

function clock(options: RunDatasetMaintenanceApplyOptions): string {
  return (options.now ?? new Date()).toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function loadDesiredPayload(planDir: string, action: DatasetMaintenancePlanAction): JsonObject {
  if (!action.desired_payload) {
    throw new CliError(`save_draft action lacks desired payload: ${action.action_id}`, {
      code: 'DATASET_MAINTENANCE_PLAN_INVALID',
      exitCode: 2,
    });
  }
  const payloadPath = resolveMaintenancePlanArtifactPath(
    planDir,
    action.desired_payload.path,
    'Maintenance desired payload path',
  );
  const payload = readJsonFile(payloadPath, 'Maintenance desired payload');
  if (!isJsonObject(payload) || sha256Json(payload) !== action.desired_payload.sha256) {
    throw new CliError(`Desired payload hash mismatch for action ${action.action_id}.`, {
      code: 'DATASET_MAINTENANCE_DESIRED_PAYLOAD_HASH_MISMATCH',
      exitCode: 1,
    });
  }
  return payload;
}

function parseProgress(plan: DatasetMaintenancePlan, progressPath: string): ProgressState {
  const rawEntries = readJsonLinesIfPresent(progressPath);
  const entries: DatasetMaintenanceProgressEntry[] = [];
  const actionsById = new Map(plan.actions.map((action) => [action.action_id, action]));
  for (const value of rawEntries) {
    const action =
      isJsonObject(value) && typeof value.action_id === 'string'
        ? actionsById.get(value.action_id)
        : null;
    if (
      !isJsonObject(value) ||
      value.schema_version !== 1 ||
      value.plan_sha256 !== plan.plan_sha256 ||
      value.operation_id !== plan.operation_id ||
      typeof value.action_id !== 'string' ||
      !action ||
      value.action !== action.action ||
      value.reason_code !== action.reason_code ||
      typeof value.before_sha256 !== 'string' ||
      !isJsonObject(value.audit_context) ||
      value.audit_context.plan_sha256 !== plan.plan_sha256 ||
      value.audit_context.operation_id !== plan.operation_id ||
      value.audit_context.action_id !== action.action_id ||
      value.audit_context.reason_code !== action.reason_code ||
      value.audit_context.source !== 'tiangong-lca dataset maintenance apply' ||
      !['success', 'failed'].includes(String(value.result)) ||
      (value.result === 'success' && typeof value.remote_result_sha256 !== 'string') ||
      (value.result === 'failed' && value.remote_result_sha256 !== null)
    ) {
      throw new CliError('Apply progress contains an invalid or foreign entry.', {
        code: 'DATASET_MAINTENANCE_PROGRESS_INVALID',
        exitCode: 1,
        details: value,
      });
    }
    entries.push(value as DatasetMaintenanceProgressEntry);
  }
  const successes = new Map<string, DatasetMaintenanceProgressEntry>();
  const latestFailures = new Map<string, DatasetMaintenanceProgressEntry>();
  for (const entry of entries) {
    if (entry.result === 'success') {
      successes.set(entry.action_id, entry);
      latestFailures.delete(entry.action_id);
    } else if (!successes.has(entry.action_id)) {
      latestFailures.set(entry.action_id, entry);
    }
  }
  return { entries, successes, latestFailures };
}

function finalProjectedRows(options: {
  rows: DatasetMaintenanceRemoteRow[];
  plan: DatasetMaintenancePlan;
  planDir: string;
}): DatasetMaintenanceRemoteRow[] {
  const projected = new Map(options.rows.map((row) => [maintenanceRowKey(row), { ...row }]));
  for (const action of options.plan.actions.filter((entry) => entry.action === 'save_draft')) {
    const row = projected.get(maintenanceRowKey(action));
    if (row) {
      projected.set(maintenanceRowKey(action), {
        ...row,
        json_ordered: loadDesiredPayload(options.planDir, action),
      });
    }
  }
  for (const action of options.plan.actions.filter((entry) => entry.action === 'publish')) {
    const row = projected.get(maintenanceRowKey(action));
    if (row) {
      projected.set(maintenanceRowKey(action), { ...row, state_code: 100 });
    }
  }
  for (const action of options.plan.actions.filter((entry) => entry.action === 'delete')) {
    projected.delete(maintenanceRowKey(action));
  }
  return [...projected.values()].sort((left, right) =>
    maintenanceRowKey(left).localeCompare(maintenanceRowKey(right)),
  );
}

function assertApplyPreconditions(options: {
  plan: DatasetMaintenancePlan;
  planDir: string;
  currentRows: DatasetMaintenanceRemoteRow[];
  progress: ProgressState;
}): void {
  const current = new Map(options.currentRows.map((row) => [maintenanceRowKey(row), row]));
  const baselineKeys = new Set([
    ...options.plan.protected_rows.map(maintenanceRowKey),
    ...options.plan.actions.filter((action) => action.before).map(maintenanceRowKey),
  ]);
  for (const row of options.currentRows) {
    if (!baselineKeys.has(maintenanceRowKey(row))) {
      throw new CliError(`Unexpected current-account row appeared after planning: ${row.id}`, {
        code: 'DATASET_MAINTENANCE_PREFLIGHT_DRIFT',
        exitCode: 1,
        details: { table: row.table, id: row.id, version: row.version },
      });
    }
  }
  for (const protectedRow of options.plan.protected_rows) {
    const currentRow = current.get(maintenanceRowKey(protectedRow));
    if (!currentRow || snapshotRemoteRow(currentRow).row_sha256 !== protectedRow.row_sha256) {
      throw new CliError(`Protected row drifted after planning: ${protectedRow.id}`, {
        code: 'DATASET_MAINTENANCE_PROTECTED_ROW_DRIFT',
        exitCode: 1,
        details: protectedRow,
      });
    }
  }
  for (const action of options.plan.actions) {
    if (!action.before) {
      throw new CliError(`Ready plan action lacks before snapshot: ${action.action_id}`, {
        code: 'DATASET_MAINTENANCE_PLAN_INVALID',
        exitCode: 2,
      });
    }
    const currentRow = current.get(maintenanceRowKey(action));
    const alreadySucceeded = options.progress.successes.has(action.action_id);
    if (alreadySucceeded && action.action === 'delete') {
      if (currentRow) {
        throw new CliError(`Previously deleted row is visible again: ${action.action_id}`, {
          code: 'DATASET_MAINTENANCE_RESUME_DRIFT',
          exitCode: 1,
        });
      }
      continue;
    }
    if (!currentRow || currentRow.user_id !== action.expected_user_id) {
      throw new CliError(`Action row is missing, non-draft, or not owned: ${action.action_id}`, {
        code: 'DATASET_MAINTENANCE_ACTION_ROW_DRIFT',
        exitCode: 1,
      });
    }
    const currentSnapshot = snapshotRemoteRow(currentRow);
    if (alreadySucceeded) {
      const expectedPayloadSha256 =
        action.action === 'publish'
          ? action.before.payload_sha256
          : sha256Json(loadDesiredPayload(options.planDir, action));
      const expectedStateCode = action.action === 'publish' ? 100 : 0;
      if (
        currentRow.state_code !== expectedStateCode ||
        currentSnapshot.payload_sha256 !== expectedPayloadSha256 ||
        currentRow.model_id !== action.before.model_id ||
        currentRow.rule_verification !== action.before.rule_verification
      ) {
        const message =
          action.action === 'publish'
            ? `Previously published row drifted: ${action.action_id}`
            : `Previously saved row payload drifted: ${action.action_id}`;
        throw new CliError(message, {
          code: 'DATASET_MAINTENANCE_RESUME_DRIFT',
          exitCode: 1,
        });
      }
    } else if (action.action === 'publish' && currentRow.state_code === 100) {
      if (
        currentSnapshot.payload_sha256 !== action.before.payload_sha256 ||
        currentRow.model_id !== action.before.model_id ||
        currentRow.rule_verification !== action.before.rule_verification
      ) {
        throw new CliError(`Unlogged published row differs from the plan: ${action.action_id}`, {
          code: 'DATASET_MAINTENANCE_RESUME_DRIFT',
          exitCode: 1,
        });
      }
    } else if (
      currentRow.state_code !== 0 ||
      currentSnapshot.row_sha256 !== action.before.row_sha256
    ) {
      throw new CliError(`Pending action row drifted after planning: ${action.action_id}`, {
        code: 'DATASET_MAINTENANCE_ACTION_ROW_DRIFT',
        exitCode: 1,
      });
    }
  }
  const projected = finalProjectedRows({
    rows: options.currentRows,
    plan: options.plan,
    planDir: options.planDir,
  });
  const projectedReferenceSha256 = sha256Json(maintenanceProjectedReferenceFingerprint(projected));
  if (projectedReferenceSha256 !== options.plan.projected_reference_sha256) {
    throw new CliError('Projected reference closure drifted after planning.', {
      code: 'DATASET_MAINTENANCE_REFERENCE_PREFLIGHT_DRIFT',
      exitCode: 1,
      details: {
        expected: options.plan.projected_reference_sha256,
        actual: projectedReferenceSha256,
      },
    });
  }
}

function validateApprovalRecord(options: {
  path: string;
  plan: DatasetMaintenancePlan;
  context: DatasetMaintenanceRemoteContext;
}): void {
  if (!existsSync(options.path)) {
    return;
  }
  const record = readJsonFile(options.path, 'Maintenance approval record');
  if (
    !isJsonObject(record) ||
    record.plan_sha256 !== options.plan.plan_sha256 ||
    !isJsonObject(record.account) ||
    record.account.user_id !== options.context.account.user_id ||
    record.account.email !== options.context.account.email
  ) {
    throw new CliError('Existing approval record does not match this plan and actor.', {
      code: 'DATASET_MAINTENANCE_APPROVAL_RECORD_MISMATCH',
      exitCode: 1,
    });
  }
}

async function executeAction(options: {
  action: DatasetMaintenancePlanAction;
  plan: DatasetMaintenancePlan;
  planDir: string;
  context: DatasetMaintenanceRemoteContext;
}): Promise<{ afterSha256: string | null; remoteResultSha256: string }> {
  if (!options.action.before) {
    throw new CliError(`Action lacks a before snapshot: ${options.action.action_id}`, {
      code: 'DATASET_MAINTENANCE_PLAN_INVALID',
      exitCode: 2,
    });
  }
  const justInTime = await fetchMaintenanceExactRows({
    context: options.context,
    table: options.action.table,
    id: options.action.id,
    version: options.action.version,
  });
  const pendingRow = justInTime.rows.length === 1 ? justInTime.rows[0] : null;
  const pendingSnapshot = pendingRow ? snapshotRemoteRow(pendingRow) : null;
  const exactDraft = Boolean(
    pendingRow &&
    pendingRow.state_code === 0 &&
    pendingSnapshot?.row_sha256 === options.action.before.row_sha256,
  );
  const auditedPublishReplayCandidate = Boolean(
    options.action.action === 'publish' &&
    pendingRow &&
    pendingRow.state_code === 100 &&
    pendingSnapshot?.payload_sha256 === options.action.before.payload_sha256 &&
    pendingRow.model_id === options.action.before.model_id &&
    pendingRow.rule_verification === options.action.before.rule_verification,
  );
  if (
    !pendingRow ||
    pendingRow.user_id !== options.action.expected_user_id ||
    (!exactDraft && !auditedPublishReplayCandidate)
  ) {
    throw new CliError(`Action row drifted immediately before write: ${options.action.action_id}`, {
      code: 'DATASET_MAINTENANCE_ACTION_JUST_IN_TIME_DRIFT',
      exitCode: 1,
    });
  }
  const audit = {
    plan_sha256: options.plan.plan_sha256,
    operation_id: options.plan.operation_id,
    action_id: options.action.action_id,
    reason_code: options.action.reason_code,
    source: 'tiangong-lca dataset maintenance apply' as const,
  };
  if (options.action.action === 'save_draft') {
    const remoteResult = await saveDraftMaintenanceRow({
      context: options.context,
      table: options.action.table as DatasetMaintenanceMutableTable,
      id: options.action.id,
      version: options.action.version,
      payload: loadDesiredPayload(options.planDir, options.action),
      modelId: options.action.before?.model_id ?? null,
      ruleVerification: options.action.before?.rule_verification ?? null,
      audit,
    });
    const readback = await fetchMaintenanceExactRows({
      context: options.context,
      table: options.action.table,
      id: options.action.id,
      version: options.action.version,
    });
    const row = readback.rows[0];
    if (readback.rows.length !== 1 || !row) {
      throw new CliError(`save_draft readback failed for ${options.action.action_id}.`, {
        code: 'DATASET_MAINTENANCE_ACTION_READBACK_FAILED',
        exitCode: 1,
      });
    }
    const expectedPayload = options.action.desired_payload?.sha256;
    const readbackSnapshot = snapshotRemoteRow(row);
    if (
      readbackSnapshot.payload_sha256 !== expectedPayload ||
      row.user_id !== options.action.expected_user_id ||
      row.state_code !== 0
    ) {
      throw new CliError(`save_draft readback mismatch for ${options.action.action_id}.`, {
        code: 'DATASET_MAINTENANCE_ACTION_READBACK_FAILED',
        exitCode: 1,
      });
    }
    return {
      afterSha256: readbackSnapshot.row_sha256,
      remoteResultSha256: sha256Json(remoteResult),
    };
  }
  if (options.action.action === 'publish') {
    const remoteResult = await publishMaintenanceRow({
      context: options.context,
      table: options.action.table as DatasetMaintenancePublishTable,
      id: options.action.id,
      version: options.action.version,
      expectedModifiedAt: options.action.before.modified_at,
      expectedPayload: options.action.before.json_ordered!,
      audit,
    });
    const readback = await fetchMaintenanceExactRows({
      context: options.context,
      table: options.action.table,
      id: options.action.id,
      version: options.action.version,
    });
    const row = readback.rows[0];
    if (readback.rows.length !== 1 || !row) {
      throw new CliError(`publish readback failed for ${options.action.action_id}.`, {
        code: 'DATASET_MAINTENANCE_ACTION_READBACK_FAILED',
        exitCode: 1,
      });
    }
    const readbackSnapshot = snapshotRemoteRow(row);
    if (
      row.user_id !== options.action.expected_user_id ||
      row.state_code !== 100 ||
      readbackSnapshot.payload_sha256 !== options.action.before.payload_sha256 ||
      row.model_id !== options.action.before.model_id ||
      row.rule_verification !== options.action.before.rule_verification
    ) {
      throw new CliError(`publish readback mismatch for ${options.action.action_id}.`, {
        code: 'DATASET_MAINTENANCE_ACTION_READBACK_FAILED',
        exitCode: 1,
      });
    }
    return {
      afterSha256: readbackSnapshot.row_sha256,
      remoteResultSha256: sha256Json(remoteResult),
    };
  }
  const remoteResult = await deleteMaintenanceRow({
    context: options.context,
    table: options.action.table as DatasetMaintenanceMutableTable,
    id: options.action.id,
    version: options.action.version,
    audit,
  });
  const readback = await fetchMaintenanceExactRows({
    context: options.context,
    table: options.action.table,
    id: options.action.id,
    version: options.action.version,
  });
  if (readback.rows.length !== 0) {
    throw new CliError(`delete readback failed for ${options.action.action_id}.`, {
      code: 'DATASET_MAINTENANCE_ACTION_READBACK_FAILED',
      exitCode: 1,
    });
  }
  return { afterSha256: null, remoteResultSha256: sha256Json(remoteResult) };
}

function nextAttemptPath(planDir: string): string {
  let attempt = 1;
  while (
    existsSync(path.join(planDir, `commit-report.attempt-${String(attempt).padStart(4, '0')}.json`))
  ) {
    attempt += 1;
  }
  return path.join(planDir, `commit-report.attempt-${String(attempt).padStart(4, '0')}.json`);
}

export async function runDatasetMaintenanceApply(
  options: RunDatasetMaintenanceApplyOptions,
): Promise<DatasetMaintenanceApplyReport> {
  if (!options.commit) {
    throw new CliError('Dataset maintenance apply requires commit=true.', {
      code: 'DATASET_MAINTENANCE_COMMIT_REQUIRED',
      exitCode: 2,
    });
  }
  const planPath = path.resolve(options.planPath);
  const planDir = path.dirname(planPath);
  const plan = parseMaintenancePlan(readJsonFile(planPath, 'Maintenance plan'));
  if (options.approvePlan !== plan.plan_sha256) {
    throw new CliError('approvePlan must exactly match the canonical maintenance plan hash.', {
      code: 'DATASET_MAINTENANCE_PLAN_APPROVAL_REQUIRED',
      exitCode: 2,
    });
  }
  if (plan.status !== 'ready' || plan.blockers.length > 0) {
    throw new CliError('Blocked maintenance plan cannot be applied.', {
      code: 'DATASET_MAINTENANCE_PLAN_BLOCKED',
      exitCode: 1,
      details: plan.blockers,
    });
  }
  if (
    plan.operation === 'redo-import' &&
    !plan.source_import_run_id &&
    plan.source_lineage === null
  ) {
    throw new CliError('redo-import apply requires frozen redo source/import lineage.', {
      code: 'DATASET_MAINTENANCE_REDO_NOT_READY',
      exitCode: 1,
    });
  }

  const progressPath = path.join(planDir, 'apply-progress.jsonl');
  return withStateFileLock(
    progressPath,
    { reason: `dataset_maintenance_apply_${plan.operation_id}` },
    async () => {
      const context = await resolveMaintenanceRemoteContext({
        env: options.env,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
        now: options.now,
      });
      if (
        context.account.user_id !== plan.account.user_id ||
        context.account.email !== plan.account.email
      ) {
        throw new CliError('Current authenticated account does not match the maintenance plan.', {
          code: 'DATASET_MAINTENANCE_ACCOUNT_MISMATCH',
          exitCode: 1,
        });
      }
      if (options.confirm !== context.account.email) {
        throw new CliError('confirm must exactly match the current authenticated account email.', {
          code: 'DATASET_MAINTENANCE_CONFIRMATION_REQUIRED',
          exitCode: 2,
        });
      }
      const progress = parseProgress(plan, progressPath);
      const resumedSuccesses = progress.successes.size;
      const current = await fetchMaintenanceAccountRows({
        context,
        userId: plan.account.user_id,
      });
      assertApplyPreconditions({
        plan,
        planDir,
        currentRows: current.rows,
        progress,
      });

      const approvalPath = path.join(planDir, 'approval-record.json');
      validateApprovalRecord({ path: approvalPath, plan, context });
      if (!existsSync(approvalPath)) {
        writeImmutableJson(approvalPath, {
          schema_version: 1,
          approved_at_utc: clock(options),
          plan_path: planPath,
          plan_sha256: plan.plan_sha256,
          task_id: plan.task_id,
          operation: plan.operation,
          operation_id: plan.operation_id,
          account: {
            user_id: context.account.user_id,
            email: context.account.email,
          },
          confirmed_email: options.confirm,
          row_counts: plan.summary,
          redo_rows_ready:
            plan.operation === 'redo-import'
              ? Boolean(plan.source_import_run_id || plan.source_lineage !== null)
              : null,
        });
      }

      const ordered = [...plan.actions].sort((left, right) => {
        const rank = { save_draft: 0, publish: 1, delete: 2 } as const;
        const actionOrder = rank[left.action] - rank[right.action];
        return actionOrder || left.ordinal - right.ordinal;
      });
      for (const action of ordered) {
        if (progress.successes.has(action.action_id)) {
          continue;
        }
        const startedAt = clock(options);
        try {
          const actionResult = await executeAction({ action, plan, planDir, context });
          const entry: DatasetMaintenanceProgressEntry = {
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
            actor: { user_id: context.account.user_id, email: context.account.email },
            started_at_utc: startedAt,
            ended_at_utc: clock(options),
            before_sha256: action.before!.row_sha256,
            after_sha256: actionResult.afterSha256,
            remote_result_sha256: actionResult.remoteResultSha256,
            result: 'success',
            error: null,
            rollback: action.rollback,
          };
          appendStableJsonLine(progressPath, entry);
          progress.entries.push(entry);
          progress.successes.set(action.action_id, entry);
          progress.latestFailures.delete(action.action_id);
        } catch (error) {
          const entry: DatasetMaintenanceProgressEntry = {
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
            actor: { user_id: context.account.user_id, email: context.account.email },
            started_at_utc: startedAt,
            ended_at_utc: clock(options),
            before_sha256: action.before!.row_sha256,
            after_sha256: null,
            remote_result_sha256: null,
            result: 'failed',
            error: errorMessage(error),
            rollback: action.rollback,
          };
          appendStableJsonLine(progressPath, entry);
          progress.entries.push(entry);
          progress.latestFailures.set(action.action_id, entry);
          break;
        }
      }

      const actions = plan.actions.map((action) => {
        const success = progress.successes.get(action.action_id);
        const failure = progress.latestFailures.get(action.action_id);
        return {
          action_id: action.action_id,
          action: action.action,
          table: action.table,
          id: action.id,
          version: action.version,
          status: success
            ? ('success' as const)
            : failure
              ? ('failed' as const)
              : ('pending' as const),
          error: failure?.error ?? null,
        };
      });
      const successCount = actions.filter((action) => action.status === 'success').length;
      const failureCount = actions.filter((action) => action.status === 'failed').length;
      const attemptPath = nextAttemptPath(planDir);
      const report: DatasetMaintenanceApplyReport = {
        schema_version: 1,
        generated_at_utc: clock(options),
        status: successCount === actions.length ? 'completed' : 'completed_with_failures',
        task_id: plan.task_id,
        operation: plan.operation,
        operation_id: plan.operation_id,
        plan_sha256: plan.plan_sha256,
        actor: { user_id: context.account.user_id, email: context.account.email },
        summary: {
          actions: actions.length,
          success: successCount,
          failed: failureCount,
          pending: actions.length - successCount - failureCount,
          resumed_successes: resumedSuccesses,
        },
        actions,
        artifacts: {
          approval_record: approvalPath,
          apply_progress: progressPath,
          commit_report: path.join(planDir, 'commit-report.json'),
          attempt_report: attemptPath,
        },
        database_audit: {
          rpc_transaction_log: 'public.command_audit_log',
          source: 'tiangong-lca dataset maintenance apply',
          correlation_fields: ['plan_sha256', 'operation_id', 'action_id', 'reason_code'],
        },
      };
      writeImmutableJson(attemptPath, report);
      writeJsonArtifact(report.artifacts.commit_report, report);
      return report;
    },
  );
}

export const __testInternals = {
  assertApplyPreconditions,
  clock,
  errorMessage,
  executeAction,
  finalProjectedRows,
  loadDesiredPayload,
  nextAttemptPath,
  parseProgress,
  validateApprovalRecord,
};
