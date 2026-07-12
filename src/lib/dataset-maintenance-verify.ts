import { existsSync } from 'node:fs';
import path from 'node:path';
import { writeJsonArtifact } from './artifacts.js';
import { collectRemoteReferences } from './dataset-remote-verify.js';
import { CliError } from './errors.js';
import type { FetchLike } from './http.js';
import {
  isJsonObject,
  maintenanceRowKey,
  normalizeMaintenanceAuditId,
  parseMaintenancePlan,
  parseMaintenanceSupportApprovalRecord,
  readJsonFile,
  readJsonLinesIfPresent,
  resolveMaintenancePlanArtifactPath,
  sha256Json,
  snapshotRemoteRow,
  type DatasetMaintenancePlan,
  type DatasetMaintenancePlanAction,
  type DatasetMaintenanceRemoteRow,
  type DatasetMaintenanceSupportApprovalRecord,
  type JsonObject,
} from './dataset-maintenance-contract.js';
import { maintenanceProjectedReferenceFingerprint } from './dataset-maintenance-plan.js';
import {
  fetchMaintenanceAccountRows,
  fetchMaintenanceExactRows,
  normalizeMaintenancePageSize,
  resolveMaintenanceRemoteContext,
} from './dataset-maintenance-remote.js';

export type DatasetMaintenanceVerifyIssue = {
  code: string;
  message: string;
  action_id?: string;
  table?: string;
  id?: string;
  version?: string;
  details?: unknown;
};

export type DatasetMaintenanceVerifyReport = {
  schema_version: 1;
  generated_at_utc: string;
  status: 'passed' | 'failed';
  task_id: string;
  operation: DatasetMaintenancePlan['operation'];
  operation_id: string;
  plan_sha256: string;
  actor: { user_id: string; email: string };
  summary: {
    actions: number;
    action_checks_passed: number;
    protected_rows: number;
    protected_checks_passed: number;
    progress_successes: number;
    support_approval_checks_passed: number;
    dangling_deleted_target_references: number;
    issues: number;
  };
  action_checks: Array<{
    action_id: string;
    status: 'passed' | 'failed';
    observed: 'desired_payload' | 'published' | 'absent' | 'mismatch';
  }>;
  issues: DatasetMaintenanceVerifyIssue[];
  artifacts: {
    plan: string;
    approval_record: string;
    support_approval_record: string | null;
    apply_progress: string;
    commit_report: string;
    report: string;
  };
};

export type RunDatasetMaintenanceVerifyOptions = {
  planPath: string;
  outDir?: string;
  pageSize?: number;
  timeoutMs?: number;
  supportApprovalPath?: string;
  env: NodeJS.ProcessEnv;
  fetchImpl: FetchLike;
  now?: Date;
};

function issue(
  code: string,
  message: string,
  action?: DatasetMaintenancePlanAction,
  details?: unknown,
): DatasetMaintenanceVerifyIssue {
  return {
    code,
    message,
    ...(action
      ? {
          action_id: action.action_id,
          table: action.table,
          id: action.id,
          version: action.version,
        }
      : {}),
    ...(details === undefined ? {} : { details }),
  };
}

function desiredPayload(planDir: string, action: DatasetMaintenancePlanAction): JsonObject | null {
  if (!action.desired_payload) {
    return null;
  }
  const raw = readJsonFile(
    resolveMaintenancePlanArtifactPath(
      planDir,
      action.desired_payload.path,
      'Maintenance desired payload path',
    ),
    'Maintenance desired payload',
  );
  return isJsonObject(raw) && sha256Json(raw) === action.desired_payload.sha256 ? raw : null;
}

function deletedTargetReferences(options: {
  rows: DatasetMaintenanceRemoteRow[];
  deletes: DatasetMaintenancePlanAction[];
}): Array<{
  target_action_id: string;
  source_key: string;
  path: string;
}> {
  const payloadRows = options.rows
    .filter((row) => row.json_ordered)
    .map((row) => ({ ...row, json_ordered: row.json_ordered as JsonObject }));
  const references = collectRemoteReferences(payloadRows).filter(
    (reference) => reference.role === 'reference',
  );
  return references.flatMap((reference) => {
    const source = payloadRows[reference.row_index];
    if (!reference.table || !reference.id) {
      return [];
    }
    return options.deletes
      .filter(
        (target) =>
          target.table === reference.table &&
          target.id === reference.id &&
          (!reference.version || target.version === reference.version),
      )
      .map((target) => ({
        target_action_id: target.action_id,
        source_key: maintenanceRowKey(source!),
        path: reference.path,
      }));
  });
}

export async function runDatasetMaintenanceVerify(
  options: RunDatasetMaintenanceVerifyOptions,
): Promise<DatasetMaintenanceVerifyReport> {
  const planPath = path.resolve(options.planPath);
  const planDir = path.dirname(planPath);
  const outDir = path.resolve(options.outDir ?? path.join(planDir, 'verify'));
  const reportPath = path.join(outDir, 'readback-verify-report.json');
  const approvalRecordPath = path.join(planDir, 'approval-record.json');
  const plan = parseMaintenancePlan(readJsonFile(planPath, 'Maintenance plan'));
  const supportApprovalRecordPath =
    plan.operation === 'publish-support'
      ? path.resolve(
          options.supportApprovalPath ?? path.join(planDir, 'support-approval-record.json'),
        )
      : null;
  const progressPath = path.join(planDir, 'apply-progress.jsonl');
  const commitReportPath = path.join(planDir, 'commit-report.json');
  const pageSize = normalizeMaintenancePageSize(options.pageSize);
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

  const problems: DatasetMaintenanceVerifyIssue[] = [];
  let supportApprovalRecord: DatasetMaintenanceSupportApprovalRecord | null = null;
  if (plan.operation !== 'publish-support' && options.supportApprovalPath) {
    problems.push({
      code: 'SUPPORT_APPROVAL_UNEXPECTED',
      message: '--support-approval is valid only for publish-support plans.',
    });
  } else if (supportApprovalRecordPath && !existsSync(supportApprovalRecordPath)) {
    problems.push({
      code: 'SUPPORT_APPROVAL_RECORD_MISSING',
      message: 'support-approval-record.json is missing.',
    });
  } else if (supportApprovalRecordPath) {
    try {
      supportApprovalRecord = parseMaintenanceSupportApprovalRecord(
        readJsonFile(supportApprovalRecordPath, 'Support approval record'),
        plan,
      );
    } catch (error) {
      problems.push({
        code: 'SUPPORT_APPROVAL_RECORD_INVALID',
        message: 'support-approval-record.json does not exactly match the immutable plan.',
        details: String(error),
      });
    }
  }
  const current = await fetchMaintenanceAccountRows({
    context,
    userId: plan.account.user_id,
    pageSize,
  });
  const currentByKey = new Map(current.rows.map((row) => [maintenanceRowKey(row), row]));
  const actionChecks: DatasetMaintenanceVerifyReport['action_checks'] = [];
  for (const action of plan.actions) {
    const exact = await fetchMaintenanceExactRows({
      context,
      table: action.table,
      id: action.id,
      version: action.version,
    });
    if (action.action === 'delete') {
      const passed = exact.rows.length === 0;
      if (!passed) {
        problems.push(
          issue('DELETE_TARGET_STILL_VISIBLE', 'Deleted target is still visible.', action),
        );
      }
      actionChecks.push({
        action_id: action.action_id,
        status: passed ? 'passed' : 'failed',
        observed: passed ? 'absent' : 'mismatch',
      });
      continue;
    }
    if (action.action === 'publish') {
      const row = exact.rows.length === 1 ? exact.rows[0] : null;
      const snapshot = row ? snapshotRemoteRow(row) : null;
      const passed = Boolean(
        row &&
        snapshot?.payload_sha256 === action.before?.payload_sha256 &&
        row.user_id === action.expected_user_id &&
        row.state_code === 100 &&
        row.model_id === action.before?.model_id &&
        row.rule_verification === action.before?.rule_verification,
      );
      if (!passed) {
        problems.push(
          issue(
            'PUBLISH_READBACK_MISMATCH',
            'Published row payload, owner, state, model_id, or rule_verification did not match the plan.',
            action,
          ),
        );
      }
      actionChecks.push({
        action_id: action.action_id,
        status: passed ? 'passed' : 'failed',
        observed: passed ? 'published' : 'mismatch',
      });
      continue;
    }
    const payload = desiredPayload(planDir, action);
    const row = exact.rows.length === 1 ? exact.rows[0] : null;
    const snapshot = row ? snapshotRemoteRow(row) : null;
    const passed = Boolean(
      row &&
      payload &&
      snapshot?.payload_sha256 === action.desired_payload?.sha256 &&
      row.user_id === action.expected_user_id &&
      row.state_code === 0 &&
      row.model_id === action.before?.model_id &&
      row.rule_verification === action.before?.rule_verification,
    );
    if (!passed) {
      problems.push(
        issue(
          'SAVE_DRAFT_READBACK_MISMATCH',
          'Saved draft payload, owner, state, model_id, or rule_verification did not match the plan.',
          action,
        ),
      );
    }
    actionChecks.push({
      action_id: action.action_id,
      status: passed ? 'passed' : 'failed',
      observed: passed ? 'desired_payload' : 'mismatch',
    });
  }

  let protectedPassed = 0;
  for (const protectedRow of plan.protected_rows) {
    const row = currentByKey.get(maintenanceRowKey(protectedRow));
    if (row && snapshotRemoteRow(row).row_sha256 === protectedRow.row_sha256) {
      protectedPassed += 1;
    } else {
      problems.push({
        code: 'PROTECTED_ROW_CHANGED',
        message: 'Protected row changed or disappeared after maintenance.',
        table: protectedRow.table,
        id: protectedRow.id,
        version: protectedRow.version,
      });
    }
  }
  const expectedFinalKeys = new Set([
    ...plan.protected_rows.map(maintenanceRowKey),
    ...plan.actions.filter((action) => action.action !== 'delete').map(maintenanceRowKey),
  ]);
  for (const row of current.rows) {
    if (!expectedFinalKeys.has(maintenanceRowKey(row))) {
      problems.push({
        code: 'UNEXPECTED_ACCOUNT_ROW',
        message: 'Unexpected current-account row exists after maintenance.',
        table: row.table,
        id: row.id,
        version: row.version,
      });
    }
  }

  const referenceSha256 = sha256Json(maintenanceProjectedReferenceFingerprint(current.rows));
  if (referenceSha256 !== plan.projected_reference_sha256) {
    problems.push({
      code: 'PROJECTED_REFERENCE_CLOSURE_MISMATCH',
      message: 'Readback reference closure differs from the approved plan.',
      details: { expected: plan.projected_reference_sha256, actual: referenceSha256 },
    });
  }
  const danglingReferences = deletedTargetReferences({
    rows: current.rows,
    deletes: plan.actions.filter((action) => action.action === 'delete'),
  });
  if (danglingReferences.length) {
    problems.push({
      code: 'DELETED_TARGET_REFERENCED',
      message: 'Readback contains references to a deleted target.',
      details: danglingReferences,
    });
  }

  if (!existsSync(approvalRecordPath)) {
    problems.push({
      code: 'APPROVAL_RECORD_MISSING',
      message: 'approval-record.json is missing.',
    });
  } else {
    const approvalRecord = readJsonFile(approvalRecordPath, 'Maintenance approval record');
    if (
      !isJsonObject(approvalRecord) ||
      approvalRecord.schema_version !== 1 ||
      approvalRecord.plan_sha256 !== plan.plan_sha256 ||
      approvalRecord.task_id !== plan.task_id ||
      approvalRecord.operation !== plan.operation ||
      approvalRecord.operation_id !== plan.operation_id ||
      !isJsonObject(approvalRecord.account) ||
      approvalRecord.account.user_id !== plan.account.user_id ||
      approvalRecord.account.email !== plan.account.email ||
      approvalRecord.confirmed_email !== plan.account.email ||
      approvalRecord.approval_kind !== 'owner_apply_confirmation' ||
      approvalRecord.authority !== 'operator_confirmation_only' ||
      !isJsonObject(approvalRecord.row_counts) ||
      sha256Json(approvalRecord.row_counts) !== sha256Json(plan.summary)
    ) {
      problems.push({
        code: 'APPROVAL_RECORD_INVALID',
        message: 'approval-record.json does not match the immutable plan and actor.',
      });
    }
  }

  const progress = readJsonLinesIfPresent(progressPath);
  const actionsById = new Map(plan.actions.map((action) => [action.action_id, action]));
  const supportApprovalsById = new Map(
    (supportApprovalRecord?.actions ?? []).map((action) => [action.action_id, action]),
  );
  const successfulActionIds = new Set<string>();
  let supportApprovalChecksPassed = 0;
  for (const [index, entry] of progress.entries()) {
    const action =
      isJsonObject(entry) && typeof entry.action_id === 'string'
        ? actionsById.get(entry.action_id)
        : null;
    const supportApproval =
      isJsonObject(entry) && isJsonObject(entry.support_approval) ? entry.support_approval : null;
    const auditContext =
      isJsonObject(entry) && isJsonObject(entry.audit_context) ? entry.audit_context : null;
    const entryResult = isJsonObject(entry) ? entry.result : null;
    const plannedSupportApproval = action
      ? (supportApprovalsById.get(action.action_id) ?? null)
      : null;
    let validSupportApproval = action?.action !== 'publish';
    if (
      action?.action === 'publish' &&
      plannedSupportApproval &&
      supportApproval &&
      supportApprovalRecord &&
      auditContext
    ) {
      try {
        const publishAuditId =
          supportApproval.publish_audit_id === null
            ? null
            : normalizeMaintenanceAuditId(
                supportApproval.publish_audit_id,
                'Verification publish audit id',
              );
        validSupportApproval =
          normalizeMaintenanceAuditId(
            supportApproval.approval_audit_id,
            'Verification approval audit id',
          ) === plannedSupportApproval.approval_audit_id &&
          (entryResult === 'success' ? publishAuditId !== null : publishAuditId === null) &&
          supportApproval.reviewer_user_id === supportApprovalRecord?.reviewer.user_id &&
          supportApproval.reviewer_email === supportApprovalRecord.reviewer.email &&
          auditContext.approval_audit_id === plannedSupportApproval.approval_audit_id;
      } catch {
        validSupportApproval = false;
      }
    }
    const valid = Boolean(
      isJsonObject(entry) &&
      entry.schema_version === 1 &&
      action &&
      entry.plan_sha256 === plan.plan_sha256 &&
      entry.operation_id === plan.operation_id &&
      entry.action === action.action &&
      entry.table === action.table &&
      entry.id === action.id &&
      entry.version === action.version &&
      entry.reason_code === action.reason_code &&
      entry.before_sha256 === action.before?.row_sha256 &&
      typeof entry.started_at_utc === 'string' &&
      typeof entry.ended_at_utc === 'string' &&
      isJsonObject(entry.actor) &&
      entry.actor.user_id === plan.account.user_id &&
      entry.actor.email === plan.account.email &&
      isJsonObject(entry.audit_context) &&
      entry.audit_context.plan_sha256 === plan.plan_sha256 &&
      entry.audit_context.operation_id === plan.operation_id &&
      entry.audit_context.action_id === action.action_id &&
      entry.audit_context.reason_code === action.reason_code &&
      entry.audit_context.source === 'tiangong-lca dataset maintenance apply' &&
      isJsonObject(entry.rollback) &&
      sha256Json(entry.rollback) === sha256Json(action.rollback) &&
      validSupportApproval &&
      (entry.result === 'success' || entry.result === 'failed') &&
      (entry.result === 'success'
        ? typeof entry.remote_result_sha256 === 'string' &&
          entry.error === null &&
          (action.action === 'delete'
            ? entry.after_sha256 === null
            : typeof entry.after_sha256 === 'string')
        : entry.remote_result_sha256 === null &&
          entry.after_sha256 === null &&
          typeof entry.error === 'string'),
    );
    if (!valid) {
      problems.push({
        code: 'APPLY_PROGRESS_ENTRY_INVALID',
        message: 'apply-progress.jsonl contains an invalid or foreign entry.',
        details: { line: index + 1, action_id: action?.action_id ?? null },
      });
      continue;
    }
    if (isJsonObject(entry) && entry.result === 'success' && action) {
      successfulActionIds.add(action.action_id);
      if (action.action === 'publish' && validSupportApproval) {
        supportApprovalChecksPassed += 1;
      }
    }
  }
  for (const action of plan.actions) {
    if (!successfulActionIds.has(action.action_id)) {
      problems.push(
        issue('ACTION_SUCCESS_LOG_MISSING', 'No successful apply-progress entry exists.', action),
      );
    }
  }
  if (!existsSync(commitReportPath)) {
    problems.push({ code: 'COMMIT_REPORT_MISSING', message: 'commit-report.json is missing.' });
  } else {
    const commitReport = readJsonFile(commitReportPath, 'Maintenance commit report');
    const commitActions =
      isJsonObject(commitReport) && Array.isArray(commitReport.actions) ? commitReport.actions : [];
    const commitActionsById = new Map(
      commitActions
        .filter(
          (entry): entry is JsonObject =>
            isJsonObject(entry) && typeof entry.action_id === 'string',
        )
        .map((entry) => [entry.action_id as string, entry]),
    );
    const commitActionsMatch =
      commitActions.length === plan.actions.length &&
      commitActionsById.size === plan.actions.length &&
      plan.actions.every((action) => {
        const entry = commitActionsById.get(action.action_id);
        return Boolean(
          entry &&
          entry.action === action.action &&
          entry.table === action.table &&
          entry.id === action.id &&
          entry.version === action.version &&
          entry.status === 'success' &&
          entry.error === null &&
          (action.action !== 'publish' ||
            (isJsonObject(entry.support_approval) &&
              entry.support_approval.approval_audit_id ===
                supportApprovalsById.get(action.action_id)?.approval_audit_id &&
              typeof entry.support_approval.publish_audit_id === 'string')),
        );
      });
    if (
      !isJsonObject(commitReport) ||
      commitReport.schema_version !== 1 ||
      commitReport.plan_sha256 !== plan.plan_sha256 ||
      commitReport.task_id !== plan.task_id ||
      commitReport.operation !== plan.operation ||
      commitReport.operation_id !== plan.operation_id ||
      commitReport.status !== 'completed' ||
      !isJsonObject(commitReport.actor) ||
      commitReport.actor.user_id !== plan.account.user_id ||
      commitReport.actor.email !== plan.account.email ||
      !isJsonObject(commitReport.summary) ||
      commitReport.summary.actions !== plan.actions.length ||
      commitReport.summary.success !== plan.actions.length ||
      commitReport.summary.failed !== 0 ||
      commitReport.summary.pending !== 0 ||
      !commitActionsMatch
    ) {
      problems.push({
        code: 'COMMIT_REPORT_INCOMPLETE',
        message: 'commit-report.json does not prove full successful completion for this plan.',
      });
    }
  }

  const report: DatasetMaintenanceVerifyReport = {
    schema_version: 1,
    generated_at_utc: (options.now ?? new Date()).toISOString(),
    status: problems.length ? 'failed' : 'passed',
    task_id: plan.task_id,
    operation: plan.operation,
    operation_id: plan.operation_id,
    plan_sha256: plan.plan_sha256,
    actor: { user_id: context.account.user_id, email: context.account.email },
    summary: {
      actions: plan.actions.length,
      action_checks_passed: actionChecks.filter((check) => check.status === 'passed').length,
      protected_rows: plan.protected_rows.length,
      protected_checks_passed: protectedPassed,
      progress_successes: successfulActionIds.size,
      support_approval_checks_passed: supportApprovalChecksPassed,
      dangling_deleted_target_references: danglingReferences.length,
      issues: problems.length,
    },
    action_checks: actionChecks,
    issues: problems,
    artifacts: {
      plan: planPath,
      approval_record: approvalRecordPath,
      support_approval_record: supportApprovalRecordPath,
      apply_progress: progressPath,
      commit_report: commitReportPath,
      report: reportPath,
    },
  };
  writeJsonArtifact(reportPath, report);
  return report;
}

export const __testInternals = {
  deletedTargetReferences,
  desiredPayload,
  issue,
};
