import { existsSync } from 'node:fs';
import path from 'node:path';
import { writeJsonArtifact } from './artifacts.js';
import { collectRemoteReferences } from './dataset-remote-verify.js';
import { CliError } from './errors.js';
import type { FetchLike } from './http.js';
import {
  isJsonObject,
  maintenanceRowKey,
  parseMaintenancePlan,
  readJsonFile,
  readJsonLinesIfPresent,
  resolveMaintenancePlanArtifactPath,
  sha256Json,
  snapshotRemoteRow,
  type DatasetMaintenancePlan,
  type DatasetMaintenancePlanAction,
  type DatasetMaintenanceRemoteRow,
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
  target_mode: DatasetMaintenancePlan['target_mode'];
  plan_sha256: string;
  actor: { user_id: string; email: string };
  summary: {
    actions: number;
    action_checks_passed: number;
    protected_rows: number;
    protected_checks_passed: number;
    progress_successes: number;
    atomic_plan_proofs?: number;
    atomic_batches?: number;
    atomic_batch_successes?: number;
    exchange_rewrite_logs?: number;
    dangling_deleted_target_references: number;
    issues: number;
  };
  action_checks: Array<{
    action_id: string;
    status: 'passed' | 'failed';
    observed: 'desired_payload' | 'absent' | 'mismatch';
  }>;
  issues: DatasetMaintenanceVerifyIssue[];
  artifacts: {
    plan: string;
    approval_record: string;
    apply_progress: string;
    commit_report: string;
    alias_plan_progress?: string;
    alias_batch_progress?: string;
    alias_exchange_progress?: string;
    report: string;
  };
};

export type RunDatasetMaintenanceVerifyOptions = {
  planPath: string;
  outDir?: string;
  pageSize?: number;
  timeoutMs?: number;
  env: NodeJS.ProcessEnv;
  fetchImpl: FetchLike;
  now?: Date;
};

const POSITIVE_INTEGER_TEXT = /^[1-9]\d*$/u;

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
  const progressPath = path.join(planDir, 'apply-progress.jsonl');
  const commitReportPath = path.join(planDir, 'commit-report.json');
  const aliasPlanProgressPath = path.join(planDir, 'alias-plan-progress.jsonl');
  const aliasBatchProgressPath = path.join(planDir, 'alias-batch-progress.jsonl');
  const aliasExchangeProgressPath = path.join(planDir, 'alias-exchange-progress.jsonl');
  const pageSize = normalizeMaintenancePageSize(options.pageSize);
  const plan = parseMaintenancePlan(readJsonFile(planPath, 'Maintenance plan'));
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

  const progress = readJsonLinesIfPresent(progressPath);
  const actionsById = new Map(plan.actions.map((action) => [action.action_id, action]));

  let aliasBatchSuccesses = 0;
  let aliasExchangeLogs = 0;
  let aliasPlanProofs = 0;
  let aliasPlanProof: {
    plan_request_sha256: string;
    summary_audit_id: string;
    batches: Map<string, { batch_request_sha256: string; summary_audit_id: string }>;
  } | null = null;
  const aliasBatchProofs = new Map<
    string,
    {
      batch_request_sha256: string;
      summary_audit_id: string;
      plan_request_sha256: string;
      plan_summary_audit_id: string;
    }
  >();
  if (plan.operation === 'merge-support-aliases') {
    const orderedBatches = [
      plan.alias_batches!.find((batch) => batch.dimension === 'time')!,
      plan.alias_batches!.find((batch) => batch.dimension === 'length_time')!,
    ];
    let successfulPlanSeen = false;
    for (const [index, entry] of readJsonLinesIfPresent(aliasPlanProgressPath).entries()) {
      const batchProofs = isJsonObject(entry) && Array.isArray(entry.batches) ? entry.batches : [];
      const validSuccessBatches =
        batchProofs.length === 2 &&
        batchProofs.every((proof, batchIndex) => {
          const batch = orderedBatches[batchIndex]!;
          return Boolean(
            isJsonObject(proof) &&
            proof.batch_id === batch.batch_id &&
            proof.dimension === batch.dimension &&
            typeof proof.batch_request_sha256 === 'string' &&
            /^[a-f0-9]{64}$/u.test(proof.batch_request_sha256) &&
            typeof proof.summary_audit_id === 'string' &&
            POSITIVE_INTEGER_TEXT.test(proof.summary_audit_id),
          );
        });
      const batchRequestHashes = batchProofs
        .filter(isJsonObject)
        .map((proof) => proof.batch_request_sha256);
      const batchSummaryAuditIds = batchProofs
        .filter(isJsonObject)
        .map((proof) => proof.summary_audit_id);
      const valid = Boolean(
        isJsonObject(entry) &&
        entry.schema_version === 1 &&
        entry.plan_sha256 === plan.plan_sha256 &&
        entry.operation_id === plan.operation_id &&
        entry.target_mode === 'owner_draft' &&
        isJsonObject(entry.actor) &&
        entry.actor.user_id === plan.account.user_id &&
        entry.actor.email === plan.account.email &&
        typeof entry.started_at_utc === 'string' &&
        typeof entry.ended_at_utc === 'string' &&
        entry.batch_count === 2 &&
        entry.row_count === 52 &&
        entry.exchange_count === 59 &&
        (entry.result === 'success' || entry.result === 'failed') &&
        (entry.result === 'success'
          ? !successfulPlanSeen &&
            typeof entry.plan_request_sha256 === 'string' &&
            /^[a-f0-9]{64}$/u.test(entry.plan_request_sha256) &&
            typeof entry.idempotent_replay === 'boolean' &&
            typeof entry.summary_audit_id === 'string' &&
            POSITIVE_INTEGER_TEXT.test(entry.summary_audit_id) &&
            validSuccessBatches &&
            new Set(batchRequestHashes).size === 2 &&
            new Set(batchSummaryAuditIds).size === 2 &&
            !batchSummaryAuditIds.includes(entry.summary_audit_id) &&
            entry.error === null
          : entry.plan_request_sha256 === null &&
            entry.idempotent_replay === null &&
            entry.summary_audit_id === null &&
            batchProofs.length === 0 &&
            typeof entry.error === 'string'),
      );
      if (!valid) {
        problems.push({
          code: 'ALIAS_PLAN_PROGRESS_INVALID',
          message: 'alias-plan-progress.jsonl contains an invalid or foreign entry.',
          details: { line: index + 1 },
        });
      } else if (isJsonObject(entry) && entry.result === 'success') {
        successfulPlanSeen = true;
        aliasPlanProof = {
          plan_request_sha256: entry.plan_request_sha256 as string,
          summary_audit_id: entry.summary_audit_id as string,
          batches: new Map(
            batchProofs.map((proof) => {
              const value = proof as JsonObject;
              return [
                value.batch_id as string,
                {
                  batch_request_sha256: value.batch_request_sha256 as string,
                  summary_audit_id: value.summary_audit_id as string,
                },
              ] as const;
            }),
          ),
        };
      }
    }
    if (!aliasPlanProof) {
      problems.push({
        code: 'ALIAS_PLAN_SUCCESS_LOG_MISSING',
        message: 'No successful whole-plan progress proof exists.',
      });
    } else {
      aliasPlanProofs = 1;
    }
    for (const batch of plan.alias_batches!) {
      for (const snapshot of [
        batch.target_snapshots.unitgroup!,
        batch.target_snapshots.flowproperty!,
        batch.target_snapshots.source_unitgroup!,
      ]) {
        const exact = await fetchMaintenanceExactRows({
          context,
          table: snapshot.table,
          id: snapshot.id,
          version: snapshot.version,
        });
        const row = exact.rows.length === 1 ? exact.rows[0] : null;
        if (
          !row ||
          row.user_id !== plan.account.user_id ||
          row.state_code !== 0 ||
          snapshotRemoteRow(row).row_sha256 !== snapshot.row_sha256
        ) {
          problems.push({
            code: 'ALIAS_SUPPORT_READBACK_MISMATCH',
            message: 'Alias target/source support snapshot changed after planning.',
            table: snapshot.table,
            id: snapshot.id,
            version: snapshot.version,
            details: { batch_id: batch.batch_id },
          });
        }
      }
    }

    const batchesById = new Map(plan.alias_batches!.map((batch) => [batch.batch_id, batch]));
    const successfulBatches = new Set<string>();
    for (const [index, entry] of readJsonLinesIfPresent(aliasBatchProgressPath).entries()) {
      const batch =
        isJsonObject(entry) && typeof entry.batch_id === 'string'
          ? batchesById.get(entry.batch_id)
          : null;
      const planBatchProof = batch ? aliasPlanProof?.batches.get(batch.batch_id) : null;
      const valid = Boolean(
        isJsonObject(entry) &&
        entry.schema_version === 1 &&
        entry.plan_sha256 === plan.plan_sha256 &&
        entry.operation_id === plan.operation_id &&
        entry.target_mode === 'owner_draft' &&
        batch &&
        entry.dimension === batch.dimension &&
        entry.factor === batch.factor &&
        entry.row_count === batch.summary.rows &&
        entry.exchange_count === batch.summary.exchanges &&
        isJsonObject(entry.actor) &&
        entry.actor.user_id === plan.account.user_id &&
        entry.actor.email === plan.account.email &&
        typeof entry.started_at_utc === 'string' &&
        typeof entry.ended_at_utc === 'string' &&
        entry.result === 'success' &&
        !successfulBatches.has(batch.batch_id) &&
        planBatchProof &&
        typeof entry.batch_request_sha256 === 'string' &&
        /^[a-f0-9]{64}$/u.test(entry.batch_request_sha256) &&
        entry.batch_request_sha256 === planBatchProof.batch_request_sha256 &&
        typeof entry.idempotent_replay === 'boolean' &&
        typeof entry.summary_audit_id === 'string' &&
        POSITIVE_INTEGER_TEXT.test(entry.summary_audit_id) &&
        entry.summary_audit_id === planBatchProof.summary_audit_id &&
        entry.plan_request_sha256 === aliasPlanProof?.plan_request_sha256 &&
        entry.plan_summary_audit_id === aliasPlanProof?.summary_audit_id &&
        entry.error === null,
      );
      if (!valid) {
        problems.push({
          code: 'ALIAS_BATCH_PROGRESS_INVALID',
          message: 'alias-batch-progress.jsonl contains an invalid or foreign entry.',
          details: { line: index + 1 },
        });
      } else if (isJsonObject(entry) && entry.result === 'success' && batch) {
        successfulBatches.add(batch.batch_id);
        aliasBatchProofs.set(batch.batch_id, {
          batch_request_sha256: entry.batch_request_sha256 as string,
          summary_audit_id: entry.summary_audit_id as string,
          plan_request_sha256: entry.plan_request_sha256 as string,
          plan_summary_audit_id: entry.plan_summary_audit_id as string,
        });
      }
    }
    for (const batch of plan.alias_batches!) {
      if (!successfulBatches.has(batch.batch_id)) {
        problems.push({
          code: 'ALIAS_BATCH_SUCCESS_LOG_MISSING',
          message: 'No successful atomic batch progress entry exists.',
          details: { batch_id: batch.batch_id },
        });
      }
    }
    aliasBatchSuccesses = successfulBatches.size;

    const expectedRewrites = new Map(
      plan.alias_batches!.flatMap((batch) =>
        batch.exchange_rewrites.map(
          (rewrite) =>
            [
              `${batch.batch_id}\u0000${rewrite.action_id}\u0000${rewrite.exchange_index}\u0000${rewrite.data_set_internal_id}` as string,
              { batch, rewrite },
            ] as const,
        ),
      ),
    );
    const loggedKeys = new Set<string>();
    for (const [index, entry] of readJsonLinesIfPresent(aliasExchangeProgressPath).entries()) {
      const key =
        isJsonObject(entry) &&
        typeof entry.batch_id === 'string' &&
        typeof entry.action_id === 'string' &&
        typeof entry.exchange_index === 'number' &&
        typeof entry.data_set_internal_id === 'string'
          ? `${entry.batch_id}\u0000${entry.action_id}\u0000${entry.exchange_index}\u0000${entry.data_set_internal_id}`
          : '';
      const expected = expectedRewrites.get(key);
      const batchProof = expected ? aliasBatchProofs.get(expected.batch.batch_id) : null;
      const action = expected ? actionsById.get(expected.rewrite.action_id) : null;
      const rowProofCandidates = expected
        ? progress.filter(
            (candidate) =>
              isJsonObject(candidate) &&
              candidate.schema_version === 1 &&
              candidate.plan_sha256 === plan.plan_sha256 &&
              candidate.operation_id === plan.operation_id &&
              candidate.action_id === expected.rewrite.action_id &&
              candidate.action === 'update_json_ordered' &&
              candidate.table === action?.table &&
              candidate.id === action?.id &&
              candidate.version === action?.version &&
              candidate.batch_id === expected.batch.batch_id &&
              candidate.batch_request_sha256 === batchProof?.batch_request_sha256 &&
              candidate.summary_audit_id === batchProof?.summary_audit_id &&
              typeof candidate.database_audit_id === 'string' &&
              POSITIVE_INTEGER_TEXT.test(candidate.database_audit_id) &&
              candidate.result === 'success',
          )
        : [];
      const rowProof = rowProofCandidates.length === 1 ? rowProofCandidates[0] : null;
      const rowAuditId =
        isJsonObject(rowProof) && typeof rowProof.database_audit_id === 'string'
          ? rowProof.database_audit_id
          : null;
      const valid = Boolean(
        isJsonObject(entry) &&
        expected &&
        batchProof &&
        rowProof &&
        entry.schema_version === 1 &&
        entry.plan_sha256 === plan.plan_sha256 &&
        entry.operation_id === plan.operation_id &&
        entry.target_mode === 'owner_draft' &&
        entry.factor === expected.batch.factor &&
        entry.result === 'success' &&
        typeof entry.batch_request_sha256 === 'string' &&
        /^[a-f0-9]{64}$/u.test(entry.batch_request_sha256) &&
        entry.batch_request_sha256 === batchProof.batch_request_sha256 &&
        typeof entry.database_audit_id === 'string' &&
        POSITIVE_INTEGER_TEXT.test(entry.database_audit_id) &&
        entry.database_audit_id === rowAuditId &&
        entry.summary_audit_id === batchProof.summary_audit_id &&
        entry.plan_request_sha256 === batchProof.plan_request_sha256 &&
        entry.plan_request_sha256 === aliasPlanProof?.plan_request_sha256 &&
        entry.plan_summary_audit_id === batchProof.plan_summary_audit_id &&
        entry.plan_summary_audit_id === aliasPlanProof?.summary_audit_id &&
        isJsonObject(entry.actor) &&
        entry.actor.user_id === plan.account.user_id &&
        entry.actor.email === plan.account.email &&
        typeof entry.logged_at_utc === 'string' &&
        sha256Json({
          action_id: entry.action_id,
          process_id: entry.process_id,
          process_version: entry.process_version,
          exchange_index: entry.exchange_index,
          data_set_internal_id: entry.data_set_internal_id,
          flow_id: entry.flow_id,
          flow_version: entry.flow_version,
          direction: entry.direction,
          before_exchange_sha256: entry.before_exchange_sha256,
          before_mean_amount: entry.before_mean_amount,
          before_resulting_amount: entry.before_resulting_amount,
          after_mean_amount: entry.after_mean_amount,
          after_resulting_amount: entry.after_resulting_amount,
          after_exchange_sha256: entry.after_exchange_sha256,
        }) === sha256Json(expected.rewrite) &&
        !loggedKeys.has(key),
      );
      if (!valid) {
        problems.push({
          code: 'ALIAS_EXCHANGE_PROGRESS_INVALID',
          message:
            'alias-exchange-progress.jsonl contains an invalid, duplicate, or foreign entry.',
          details: { line: index + 1 },
        });
      } else {
        loggedKeys.add(key);
      }
    }
    for (const key of expectedRewrites.keys()) {
      if (!loggedKeys.has(key)) {
        problems.push({
          code: 'ALIAS_EXCHANGE_SUCCESS_LOG_MISSING',
          message: 'An approved exchange rewrite lacks a durable success entry.',
          details: { key },
        });
      }
    }
    aliasExchangeLogs = loggedKeys.size;
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
      approvalRecord.target_mode !== plan.target_mode ||
      !isJsonObject(approvalRecord.account) ||
      approvalRecord.account.user_id !== plan.account.user_id ||
      approvalRecord.account.email !== plan.account.email ||
      approvalRecord.confirmed_email !== plan.account.email ||
      !isJsonObject(approvalRecord.row_counts) ||
      sha256Json(approvalRecord.row_counts) !== sha256Json(plan.summary)
    ) {
      problems.push({
        code: 'APPROVAL_RECORD_INVALID',
        message: 'approval-record.json does not match the immutable plan and actor.',
      });
    }
  }

  const successfulActionIds = new Set<string>();
  for (const [index, entry] of progress.entries()) {
    const action =
      isJsonObject(entry) && typeof entry.action_id === 'string'
        ? actionsById.get(entry.action_id)
        : null;
    const aliasProof = action?.batch_id ? aliasBatchProofs.get(action.batch_id) : null;
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
      (action.action !== 'update_json_ordered' ||
        (aliasProof &&
          entry.target_mode === 'owner_draft' &&
          entry.audit_context.target_mode === 'owner_draft' &&
          entry.batch_id === action.batch_id &&
          typeof entry.batch_request_sha256 === 'string' &&
          /^[a-f0-9]{64}$/u.test(entry.batch_request_sha256) &&
          entry.batch_request_sha256 === aliasProof.batch_request_sha256 &&
          typeof entry.database_audit_id === 'string' &&
          POSITIVE_INTEGER_TEXT.test(entry.database_audit_id) &&
          entry.summary_audit_id === aliasProof.summary_audit_id &&
          entry.plan_request_sha256 === aliasProof.plan_request_sha256 &&
          entry.plan_request_sha256 === aliasPlanProof?.plan_request_sha256 &&
          entry.plan_summary_audit_id === aliasProof.plan_summary_audit_id &&
          entry.plan_summary_audit_id === aliasPlanProof?.summary_audit_id)) &&
      (action.action === 'update_json_ordered' ||
        (!('target_mode' in entry) &&
          !('target_mode' in entry.audit_context) &&
          !('batch_id' in entry) &&
          !('batch_request_sha256' in entry) &&
          !('database_audit_id' in entry) &&
          !('summary_audit_id' in entry) &&
          !('plan_request_sha256' in entry) &&
          !('plan_summary_audit_id' in entry))) &&
      isJsonObject(entry.rollback) &&
      sha256Json(entry.rollback) === sha256Json(action.rollback) &&
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
      if (successfulActionIds.has(action.action_id)) {
        problems.push({
          code: 'APPLY_PROGRESS_SUCCESS_DUPLICATE',
          message: 'apply-progress.jsonl contains more than one success proof for an action.',
          details: { line: index + 1, action_id: action.action_id },
        });
        continue;
      }
      successfulActionIds.add(action.action_id);
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
          entry.error === null,
        );
      });
    const aliasCommitProofMatches =
      plan.operation !== 'merge-support-aliases' ||
      Boolean(
        isJsonObject(commitReport) &&
        isJsonObject(commitReport.alias_plan_proof) &&
        aliasPlanProof &&
        commitReport.alias_plan_proof.plan_request_sha256 === aliasPlanProof.plan_request_sha256 &&
        commitReport.alias_plan_proof.summary_audit_id === aliasPlanProof.summary_audit_id &&
        commitReport.alias_plan_proof.batch_count === 2 &&
        commitReport.alias_plan_proof.row_count === 52 &&
        commitReport.alias_plan_proof.exchange_count === 59 &&
        typeof commitReport.alias_plan_proof.idempotent_replay === 'boolean' &&
        isJsonObject(commitReport.artifacts) &&
        commitReport.artifacts.alias_plan_progress === aliasPlanProgressPath &&
        commitReport.artifacts.alias_batch_progress === aliasBatchProgressPath &&
        commitReport.artifacts.alias_exchange_progress === aliasExchangeProgressPath,
      );
    if (
      !isJsonObject(commitReport) ||
      commitReport.schema_version !== 1 ||
      commitReport.plan_sha256 !== plan.plan_sha256 ||
      commitReport.task_id !== plan.task_id ||
      commitReport.operation !== plan.operation ||
      commitReport.operation_id !== plan.operation_id ||
      commitReport.target_mode !== plan.target_mode ||
      commitReport.status !== 'completed' ||
      !isJsonObject(commitReport.actor) ||
      commitReport.actor.user_id !== plan.account.user_id ||
      commitReport.actor.email !== plan.account.email ||
      !isJsonObject(commitReport.summary) ||
      commitReport.summary.actions !== plan.actions.length ||
      commitReport.summary.success !== plan.actions.length ||
      commitReport.summary.failed !== 0 ||
      commitReport.summary.pending !== 0 ||
      !commitActionsMatch ||
      !aliasCommitProofMatches
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
    target_mode: plan.target_mode,
    plan_sha256: plan.plan_sha256,
    actor: { user_id: context.account.user_id, email: context.account.email },
    summary: {
      actions: plan.actions.length,
      action_checks_passed: actionChecks.filter((check) => check.status === 'passed').length,
      protected_rows: plan.protected_rows.length,
      protected_checks_passed: protectedPassed,
      progress_successes: successfulActionIds.size,
      ...(plan.operation === 'merge-support-aliases'
        ? {
            atomic_plan_proofs: aliasPlanProofs,
            atomic_batches: plan.alias_batches!.length,
            atomic_batch_successes: aliasBatchSuccesses,
            exchange_rewrite_logs: aliasExchangeLogs,
          }
        : {}),
      dangling_deleted_target_references: danglingReferences.length,
      issues: problems.length,
    },
    action_checks: actionChecks,
    issues: problems,
    artifacts: {
      plan: planPath,
      approval_record: approvalRecordPath,
      apply_progress: progressPath,
      commit_report: commitReportPath,
      ...(plan.operation === 'merge-support-aliases'
        ? {
            alias_plan_progress: aliasPlanProgressPath,
            alias_batch_progress: aliasBatchProgressPath,
            alias_exchange_progress: aliasExchangeProgressPath,
          }
        : {}),
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
