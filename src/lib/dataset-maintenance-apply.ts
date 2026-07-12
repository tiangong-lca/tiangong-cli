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
  type DatasetMaintenanceAliasBatchPlan,
  type DatasetMaintenancePlanAction,
  type DatasetMaintenanceProgressEntry,
  type DatasetMaintenanceMutableTable,
  type DatasetMaintenanceRemoteRow,
  type JsonObject,
} from './dataset-maintenance-contract.js';
import { maintenanceProjectedReferenceFingerprint } from './dataset-maintenance-plan.js';
import {
  applyMaintenanceAliasPlan,
  deleteMaintenanceRow,
  fetchMaintenanceAccountRows,
  fetchMaintenanceExactRows,
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
  target_mode: DatasetMaintenancePlan['target_mode'];
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
    alias_plan_progress?: string;
    alias_batch_progress?: string;
    alias_exchange_progress?: string;
  };
  database_audit: {
    rpc_transaction_log: 'public.command_audit_log';
    source: 'tiangong-lca dataset maintenance apply';
    correlation_fields: string[];
  };
  alias_plan_proof?: {
    plan_request_sha256: string;
    summary_audit_id: string;
    batch_count: 2;
    row_count: 52;
    exchange_count: 59;
    idempotent_replay: boolean;
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

type AliasBatchProgressEntry = {
  schema_version: 1;
  plan_sha256: string;
  operation_id: string;
  batch_id: string;
  target_mode: 'owner_draft';
  dimension: DatasetMaintenanceAliasBatchPlan['dimension'];
  factor: string;
  actor: { user_id: string; email: string };
  started_at_utc: string;
  ended_at_utc: string;
  batch_request_sha256: string;
  idempotent_replay: boolean;
  row_count: number;
  exchange_count: number;
  summary_audit_id: string;
  plan_request_sha256: string;
  plan_summary_audit_id: string;
  result: 'success';
  error: null;
};

type AliasPlanBatchProof = {
  batch_id: string;
  dimension: DatasetMaintenanceAliasBatchPlan['dimension'];
  batch_request_sha256: string;
  summary_audit_id: string;
};

type AliasPlanProgressEntry = {
  schema_version: 1;
  plan_sha256: string;
  operation_id: string;
  target_mode: 'owner_draft';
  actor: { user_id: string; email: string };
  started_at_utc: string;
  ended_at_utc: string;
  plan_request_sha256: string | null;
  idempotent_replay: boolean | null;
  batch_count: 2;
  row_count: 52;
  exchange_count: 59;
  summary_audit_id: string | null;
  batches: AliasPlanBatchProof[];
  result: 'success' | 'failed';
  error: string | null;
};

type AliasPlanProgressState = {
  entries: AliasPlanProgressEntry[];
  success: AliasPlanProgressEntry | null;
  latestFailure: AliasPlanProgressEntry | null;
};

type AliasBatchProgressState = {
  entries: AliasBatchProgressEntry[];
  successes: Map<string, AliasBatchProgressEntry>;
};

type AliasRpcAuditProof = {
  action_id: string;
  table: DatasetMaintenancePlanAction['table'];
  id: string;
  version: string;
  audit_id: string;
};

type AliasRpcResult = {
  target_visibility: 'owner_draft';
  batch_request_sha256: string;
  idempotent_replay: boolean;
  exchange_count: number;
  summary_audit_id: string;
  audits: Map<string, AliasRpcAuditProof>;
  raw: JsonObject;
};

type AliasPlanRpcResult = {
  target_visibility: 'owner_draft';
  plan_request_sha256: string;
  idempotent_replay: boolean;
  batch_count: 2;
  row_count: 52;
  exchange_count: 59;
  summary_audit_id: string;
  batches: Map<DatasetMaintenanceAliasBatchPlan['dimension'], AliasRpcResult>;
  raw: JsonObject;
};

const POSITIVE_INTEGER_TEXT = /^[1-9]\d*$/u;

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
      (action.action === 'update_json_ordered' &&
        (value.target_mode !== 'owner_draft' ||
          value.audit_context.target_mode !== 'owner_draft' ||
          value.batch_id !== action.batch_id ||
          typeof value.batch_request_sha256 !== 'string' ||
          !/^[a-f0-9]{64}$/u.test(value.batch_request_sha256) ||
          typeof value.database_audit_id !== 'string' ||
          !POSITIVE_INTEGER_TEXT.test(value.database_audit_id) ||
          typeof value.summary_audit_id !== 'string' ||
          !POSITIVE_INTEGER_TEXT.test(value.summary_audit_id) ||
          typeof value.plan_request_sha256 !== 'string' ||
          !/^[a-f0-9]{64}$/u.test(value.plan_request_sha256) ||
          typeof value.plan_summary_audit_id !== 'string' ||
          !POSITIVE_INTEGER_TEXT.test(value.plan_summary_audit_id))) ||
      (action.action !== 'update_json_ordered' &&
        ('target_mode' in value ||
          'target_mode' in value.audit_context ||
          'batch_id' in value ||
          'batch_request_sha256' in value ||
          'database_audit_id' in value ||
          'summary_audit_id' in value ||
          'plan_request_sha256' in value ||
          'plan_summary_audit_id' in value)) ||
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

function parseAliasBatchProgress(
  plan: DatasetMaintenancePlan,
  progressPath: string,
): AliasBatchProgressState {
  const batches = new Map(plan.alias_batches!.map((batch) => [batch.batch_id, batch]));
  const entries = readJsonLinesIfPresent(progressPath).map((value) => {
    const batch =
      isJsonObject(value) && typeof value.batch_id === 'string'
        ? batches.get(value.batch_id)
        : null;
    if (
      !isJsonObject(value) ||
      value.schema_version !== 1 ||
      value.plan_sha256 !== plan.plan_sha256 ||
      value.operation_id !== plan.operation_id ||
      !batch ||
      value.target_mode !== 'owner_draft' ||
      value.dimension !== batch.dimension ||
      value.factor !== batch.factor ||
      !isJsonObject(value.actor) ||
      value.actor.user_id !== plan.account.user_id ||
      value.actor.email !== plan.account.email ||
      typeof value.started_at_utc !== 'string' ||
      typeof value.ended_at_utc !== 'string' ||
      value.row_count !== batch.summary.rows ||
      value.exchange_count !== batch.summary.exchanges ||
      value.result !== 'success' ||
      typeof value.batch_request_sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(value.batch_request_sha256) ||
      typeof value.idempotent_replay !== 'boolean' ||
      typeof value.summary_audit_id !== 'string' ||
      !POSITIVE_INTEGER_TEXT.test(value.summary_audit_id) ||
      typeof value.plan_request_sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(value.plan_request_sha256) ||
      typeof value.plan_summary_audit_id !== 'string' ||
      !POSITIVE_INTEGER_TEXT.test(value.plan_summary_audit_id) ||
      value.error !== null
    ) {
      throw new CliError('Alias batch progress contains an invalid or foreign entry.', {
        code: 'DATASET_MAINTENANCE_ALIAS_PROGRESS_INVALID',
        exitCode: 1,
        details: value,
      });
    }
    return value as AliasBatchProgressEntry;
  });
  const successes = new Map<string, AliasBatchProgressEntry>();
  for (const entry of entries) {
    if (successes.has(entry.batch_id)) {
      throw new CliError('Alias batch progress contains duplicate success proof.', {
        code: 'DATASET_MAINTENANCE_ALIAS_PROGRESS_INVALID',
        exitCode: 1,
        details: { batch_id: entry.batch_id },
      });
    }
    successes.set(entry.batch_id, entry);
  }
  return { entries, successes };
}

function parseAliasPlanProgress(
  plan: DatasetMaintenancePlan,
  progressPath: string,
): AliasPlanProgressState {
  const expectedBatches = orderedAliasBatches(plan);
  const entries = readJsonLinesIfPresent(progressPath).map((value) => {
    const batchProofs = isJsonObject(value) && Array.isArray(value.batches) ? value.batches : [];
    const validBatchProofs =
      batchProofs.length === expectedBatches.length &&
      batchProofs.every((proof, index) => {
        const batch = expectedBatches[index]!;
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
    if (
      !isJsonObject(value) ||
      value.schema_version !== 1 ||
      value.plan_sha256 !== plan.plan_sha256 ||
      value.operation_id !== plan.operation_id ||
      value.target_mode !== 'owner_draft' ||
      !isJsonObject(value.actor) ||
      value.actor.user_id !== plan.account.user_id ||
      value.actor.email !== plan.account.email ||
      typeof value.started_at_utc !== 'string' ||
      typeof value.ended_at_utc !== 'string' ||
      value.batch_count !== 2 ||
      value.row_count !== 52 ||
      value.exchange_count !== 59 ||
      !['success', 'failed'].includes(String(value.result)) ||
      (value.result === 'success' &&
        (typeof value.plan_request_sha256 !== 'string' ||
          !/^[a-f0-9]{64}$/u.test(value.plan_request_sha256) ||
          typeof value.idempotent_replay !== 'boolean' ||
          typeof value.summary_audit_id !== 'string' ||
          !POSITIVE_INTEGER_TEXT.test(value.summary_audit_id) ||
          !validBatchProofs ||
          new Set(batchRequestHashes).size !== 2 ||
          new Set(batchSummaryAuditIds).size !== 2 ||
          batchSummaryAuditIds.includes(value.summary_audit_id) ||
          value.error !== null)) ||
      (value.result === 'failed' &&
        (value.plan_request_sha256 !== null ||
          value.idempotent_replay !== null ||
          value.summary_audit_id !== null ||
          batchProofs.length !== 0 ||
          typeof value.error !== 'string'))
    ) {
      throw new CliError('Alias plan progress contains an invalid or foreign entry.', {
        code: 'DATASET_MAINTENANCE_ALIAS_PLAN_PROGRESS_INVALID',
        exitCode: 1,
        details: value,
      });
    }
    return value as AliasPlanProgressEntry;
  });
  let success: AliasPlanProgressEntry | null = null;
  let latestFailure: AliasPlanProgressEntry | null = null;
  for (const entry of entries) {
    if (entry.result === 'success') {
      if (success) {
        throw new CliError('Alias plan progress contains duplicate success proof.', {
          code: 'DATASET_MAINTENANCE_ALIAS_PLAN_PROGRESS_INVALID',
          exitCode: 1,
        });
      }
      success = entry;
      latestFailure = null;
    } else if (!success) {
      latestFailure = entry;
    }
  }
  return { entries, success, latestFailure };
}

function finalProjectedRows(options: {
  rows: DatasetMaintenanceRemoteRow[];
  plan: DatasetMaintenancePlan;
  planDir: string;
}): DatasetMaintenanceRemoteRow[] {
  const projected = new Map(options.rows.map((row) => [maintenanceRowKey(row), { ...row }]));
  for (const action of options.plan.actions.filter((entry) =>
    ['save_draft', 'update_json_ordered'].includes(entry.action),
  )) {
    const row = projected.get(maintenanceRowKey(action));
    if (row) {
      projected.set(maintenanceRowKey(action), {
        ...row,
        json_ordered: loadDesiredPayload(options.planDir, action),
      });
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
  aliasPlanProgress?: AliasPlanProgressState;
}): void {
  const current = new Map(options.currentRows.map((row) => [maintenanceRowKey(row), row]));
  const aliasBatchStates = new Map<string, 'before' | 'desired'>();
  for (const batch of options.plan.alias_batches ?? []) {
    const states = batch.action_ids.map((actionId) => {
      const action = options.plan.actions.find((entry) => entry.action_id === actionId)!;
      const row = current.get(maintenanceRowKey(action));
      const snapshot = row ? snapshotRemoteRow(row) : null;
      if (
        row?.state_code === 0 &&
        row.user_id === action.expected_user_id &&
        snapshot?.row_sha256 === action.before?.row_sha256
      ) {
        return 'before' as const;
      }
      if (
        row?.state_code === 0 &&
        row.user_id === action.expected_user_id &&
        snapshot?.payload_sha256 === action.desired_payload?.sha256 &&
        row.model_id === action.before?.model_id &&
        row.rule_verification === action.before?.rule_verification
      ) {
        return 'desired' as const;
      }
      return 'invalid' as const;
    });
    const unique = new Set(states);
    if (unique.size !== 1 || unique.has('invalid')) {
      throw new CliError(`Atomic alias batch row state drifted: ${batch.batch_id}`, {
        code: 'DATASET_MAINTENANCE_ALIAS_BATCH_DRIFT',
        exitCode: 1,
        details: { batch_id: batch.batch_id, states },
      });
    }
    aliasBatchStates.set(batch.batch_id, states[0] as 'before' | 'desired');
  }
  if (aliasBatchStates.size) {
    const planStates = new Set(aliasBatchStates.values());
    if (
      planStates.size !== 1 ||
      (Boolean(options.aliasPlanProgress?.success) && !planStates.has('desired'))
    ) {
      throw new CliError('Atomic alias plan rows are split across dimension states.', {
        code: 'DATASET_MAINTENANCE_ALIAS_PLAN_DRIFT',
        exitCode: 1,
        details: { batches: Object.fromEntries(aliasBatchStates) },
      });
    }
  }
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
    if (action.action === 'update_json_ordered') {
      aliasBatchStates.get(action.batch_id!)!;
      continue;
    }
    if (alreadySucceeded) {
      const expectedPayloadSha256 = sha256Json(loadDesiredPayload(options.planDir, action));
      if (
        currentRow.state_code !== 0 ||
        currentSnapshot.payload_sha256 !== expectedPayloadSha256 ||
        currentRow.model_id !== action.before.model_id ||
        currentRow.rule_verification !== action.before.rule_verification
      ) {
        throw new CliError(`Previously saved row payload drifted: ${action.action_id}`, {
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
    record.target_mode !== options.plan.target_mode ||
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

async function assertAliasSupportSnapshots(options: {
  plan: DatasetMaintenancePlan;
  context: DatasetMaintenanceRemoteContext;
}): Promise<void> {
  if (options.plan.target_mode !== 'owner_draft') {
    throw new CliError('Alias apply requires target_mode=owner_draft.', {
      code: 'DATASET_MAINTENANCE_TARGET_MODE_INVALID',
      exitCode: 2,
    });
  }
  for (const batch of options.plan.alias_batches!) {
    const snapshots = [
      batch.target_snapshots.unitgroup!,
      batch.target_snapshots.flowproperty!,
      batch.target_snapshots.source_unitgroup!,
    ];
    for (const snapshot of snapshots) {
      const exact = await fetchMaintenanceExactRows({
        context: options.context,
        table: snapshot.table,
        id: snapshot.id,
        version: snapshot.version,
      });
      const current =
        exact.rows.length === 1 && exact.rows[0] ? snapshotRemoteRow(exact.rows[0]) : null;
      if (
        !current ||
        current.user_id !== options.plan.account.user_id ||
        current.state_code !== 0 ||
        current.row_sha256 !== snapshot.row_sha256
      ) {
        throw new CliError(`Alias support row drifted for batch ${batch.batch_id}.`, {
          code: 'DATASET_MAINTENANCE_ALIAS_SUPPORT_DRIFT',
          exitCode: 1,
          details: { table: snapshot.table, id: snapshot.id, version: snapshot.version },
        });
      }
    }
  }
}

function buildAliasBatchRequest(options: {
  plan: DatasetMaintenancePlan;
  batch: DatasetMaintenanceAliasBatchPlan;
  planDir: string;
}): JsonObject {
  if (options.plan.target_mode !== 'owner_draft') {
    throw new CliError('Alias batch request requires target_mode=owner_draft.', {
      code: 'DATASET_MAINTENANCE_TARGET_MODE_INVALID',
      exitCode: 2,
    });
  }
  const targetSnapshot = (
    snapshot: NonNullable<DatasetMaintenanceAliasBatchPlan['target_snapshots']['unitgroup']>,
  ): JsonObject => {
    return {
      id: snapshot.id,
      version: snapshot.version,
      expected_modified_at: snapshot.modified_at!,
      expected_json_ordered: snapshot.json_ordered!,
    };
  };
  const actions = options.batch.action_ids.map((actionId) => {
    const action = options.plan.actions.find((entry) => entry.action_id === actionId)!;
    return {
      action_id: action.action_id,
      action: 'update_json_ordered',
      table: action.table,
      id: action.id,
      version: action.version,
      expected_state_code: 0,
      expected_modified_at: action.before!.modified_at!,
      expected_json_ordered: action.before!.json_ordered!,
      desired_json_ordered: loadDesiredPayload(options.planDir, action),
      mutation: action.alias_mutation!,
    };
  });
  return {
    schema_version: 'dataset-alias-batch.v1',
    target_visibility: 'owner_draft',
    plan_sha256: options.plan.plan_sha256,
    operation_id: options.plan.operation_id,
    batch_id: options.batch.batch_id,
    dimension: options.batch.dimension,
    factor: options.batch.factor,
    target: {
      flowproperty: targetSnapshot(options.batch.target_snapshots.flowproperty!),
      unitgroup: targetSnapshot(options.batch.target_snapshots.unitgroup!),
      source_unitgroup: targetSnapshot(options.batch.target_snapshots.source_unitgroup!),
    },
    actions,
  };
}

function orderedAliasBatches(plan: DatasetMaintenancePlan): DatasetMaintenanceAliasBatchPlan[] {
  const time = plan.alias_batches!.find((batch) => batch.dimension === 'time');
  const lengthTime = plan.alias_batches!.find((batch) => batch.dimension === 'length_time');
  return [time, lengthTime].filter(
    (batch): batch is DatasetMaintenanceAliasBatchPlan => batch !== undefined,
  );
}

function buildAliasPlanRequest(options: {
  plan: DatasetMaintenancePlan;
  planDir: string;
}): JsonObject {
  if (options.plan.target_mode !== 'owner_draft') {
    throw new CliError('Alias plan request requires target_mode=owner_draft.', {
      code: 'DATASET_MAINTENANCE_TARGET_MODE_INVALID',
      exitCode: 2,
    });
  }
  const batches = orderedAliasBatches(options.plan);
  if (
    batches.length !== 2 ||
    batches[0]?.dimension !== 'time' ||
    batches[1]?.dimension !== 'length_time'
  ) {
    throw new CliError('Alias plan request requires time followed by length_time exactly once.', {
      code: 'DATASET_MAINTENANCE_ALIAS_PLAN_INVALID',
      exitCode: 2,
    });
  }
  return {
    schema_version: 'dataset-alias-plan.v1',
    plan_sha256: options.plan.plan_sha256,
    operation_id: options.plan.operation_id,
    target_visibility: 'owner_draft',
    batches: batches.map((batch) =>
      buildAliasBatchRequest({ plan: options.plan, batch, planDir: options.planDir }),
    ),
  };
}

function validateAliasRpcResult(
  value: JsonObject,
  batch: DatasetMaintenanceAliasBatchPlan,
  plan: DatasetMaintenancePlan,
): AliasRpcResult {
  const audit = Array.isArray(value.audit) ? value.audit : [];
  const proofs = audit.filter(isJsonObject).map((entry) => ({
    action_id: entry.action_id,
    table: entry.table,
    id: entry.id,
    version: entry.version,
    audit_id: entry.audit_id,
  }));
  const proofByAction = new Map(
    proofs
      .filter(
        (entry): entry is AliasRpcAuditProof =>
          typeof entry.action_id === 'string' &&
          typeof entry.table === 'string' &&
          typeof entry.id === 'string' &&
          typeof entry.version === 'string' &&
          typeof entry.audit_id === 'string' &&
          POSITIVE_INTEGER_TEXT.test(entry.audit_id),
      )
      .map((entry) => [entry.action_id, entry]),
  );
  const actionsById = new Map(plan.actions.map((action) => [action.action_id, action]));
  const validProofs =
    proofByAction.size === batch.action_ids.length &&
    batch.action_ids.every((actionId) => {
      const action = actionsById.get(actionId);
      const proof = proofByAction.get(actionId);
      return Boolean(
        action &&
        proof &&
        proof.table === action.table &&
        proof.id === action.id &&
        proof.version === action.version,
      );
    });
  if (
    plan.target_mode !== 'owner_draft' ||
    value.ok !== true ||
    value.command !== 'cmd_dataset_alias_batch_guarded' ||
    value.target_visibility !== 'owner_draft' ||
    value.dimension !== batch.dimension ||
    value.batch_id !== batch.batch_id ||
    value.row_count !== batch.summary.rows ||
    value.exchange_count !== batch.summary.exchanges ||
    typeof value.summary_audit_id !== 'string' ||
    !POSITIVE_INTEGER_TEXT.test(value.summary_audit_id) ||
    typeof value.batch_request_sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.batch_request_sha256) ||
    typeof value.idempotent_replay !== 'boolean' ||
    audit.length !== batch.action_ids.length ||
    !validProofs
  ) {
    throw new CliError(`Alias batch RPC returned invalid proof for ${batch.batch_id}.`, {
      code: 'DATASET_MAINTENANCE_ALIAS_RPC_PROOF_INVALID',
      exitCode: 1,
      details: value,
    });
  }
  return {
    target_visibility: 'owner_draft',
    batch_request_sha256: value.batch_request_sha256,
    idempotent_replay: value.idempotent_replay,
    exchange_count: value.exchange_count,
    summary_audit_id: value.summary_audit_id,
    audits: proofByAction,
    raw: value,
  };
}

function validateAliasPlanRpcResult(
  value: JsonObject,
  plan: DatasetMaintenancePlan,
): AliasPlanRpcResult {
  const batches = orderedAliasBatches(plan);
  const rawBatchResults = Array.isArray(value.batches) ? value.batches : [];
  const parsedBatchResults = rawBatchResults.map((entry, index) =>
    isJsonObject(entry) && batches[index]
      ? validateAliasRpcResult(entry, batches[index], plan)
      : null,
  );
  const validBatchResults = parsedBatchResults.every(
    (entry): entry is AliasRpcResult => entry !== null,
  );
  const batchSummaryAuditIds = validBatchResults
    ? parsedBatchResults.map((entry) => entry.summary_audit_id)
    : [];
  const rowAuditIds = validBatchResults
    ? parsedBatchResults.flatMap((entry) =>
        [...entry.audits.values()].map((proof) => proof.audit_id),
      )
    : [];
  if (
    plan.target_mode !== 'owner_draft' ||
    value.ok !== true ||
    value.command !== 'cmd_dataset_alias_plan_guarded' ||
    value.schema_version !== 'dataset-alias-plan.v1' ||
    value.plan_sha256 !== plan.plan_sha256 ||
    value.operation_id !== plan.operation_id ||
    value.target_visibility !== 'owner_draft' ||
    typeof value.plan_request_sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.plan_request_sha256) ||
    value.batch_count !== 2 ||
    value.row_count !== 52 ||
    value.exchange_count !== 59 ||
    typeof value.summary_audit_id !== 'string' ||
    !POSITIVE_INTEGER_TEXT.test(value.summary_audit_id) ||
    typeof value.idempotent_replay !== 'boolean' ||
    rawBatchResults.length !== 2 ||
    !validBatchResults ||
    parsedBatchResults.some(
      (entry, index) =>
        entry.idempotent_replay !== value.idempotent_replay ||
        entry.exchange_count !== batches[index]!.summary.exchanges,
    ) ||
    new Set(batchSummaryAuditIds).size !== 2 ||
    new Set(rowAuditIds).size !== 52 ||
    batchSummaryAuditIds.includes(value.summary_audit_id) ||
    rowAuditIds.includes(value.summary_audit_id) ||
    rowAuditIds.some((auditId) => batchSummaryAuditIds.includes(auditId))
  ) {
    throw new CliError('Alias plan RPC returned invalid whole-plan proof.', {
      code: 'DATASET_MAINTENANCE_ALIAS_PLAN_RPC_PROOF_INVALID',
      exitCode: 1,
      details: value,
    });
  }
  return {
    target_visibility: 'owner_draft',
    plan_request_sha256: value.plan_request_sha256,
    idempotent_replay: value.idempotent_replay,
    batch_count: 2,
    row_count: 52,
    exchange_count: 59,
    summary_audit_id: value.summary_audit_id,
    batches: new Map(
      batches.map((batch, index) => [batch.dimension, parsedBatchResults[index]!] as const),
    ),
    raw: value,
  };
}

async function executeAliasPlan(options: {
  plan: DatasetMaintenancePlan;
  planDir: string;
  context: DatasetMaintenanceRemoteContext;
}): Promise<{
  rpc: AliasPlanRpcResult;
  after_by_action: Map<string, string>;
}> {
  const request = buildAliasPlanRequest(options);
  const remoteResult = await applyMaintenanceAliasPlan({
    context: options.context,
    plan: request,
  });
  const rpc = validateAliasPlanRpcResult(remoteResult, options.plan);
  const afterByAction = new Map<string, string>();
  for (const action of options.plan.actions) {
    const exact = await fetchMaintenanceExactRows({
      context: options.context,
      table: action.table,
      id: action.id,
      version: action.version,
    });
    const row = exact.rows.length === 1 ? exact.rows[0] : null;
    const snapshot = row ? snapshotRemoteRow(row) : null;
    if (
      !row ||
      row.user_id !== action.expected_user_id ||
      row.state_code !== 0 ||
      snapshot?.payload_sha256 !== action.desired_payload?.sha256 ||
      row.model_id !== action.before?.model_id ||
      row.rule_verification !== action.before?.rule_verification
    ) {
      throw new CliError(`Alias plan readback failed for action ${action.action_id}.`, {
        code: 'DATASET_MAINTENANCE_ALIAS_READBACK_FAILED',
        exitCode: 1,
      });
    }
    afterByAction.set(action.action_id, snapshot!.row_sha256);
  }
  await assertAliasSupportSnapshots({ plan: options.plan, context: options.context });
  return { rpc, after_by_action: afterByAction };
}

function aliasExchangeProgressKey(value: {
  batch_id: string;
  action_id: string;
  exchange_index: number;
  data_set_internal_id: string;
}): string {
  return `${value.batch_id}\u0000${value.action_id}\u0000${value.exchange_index}\u0000${value.data_set_internal_id}`;
}

function aliasBatchDerivedLogsComplete(options: {
  plan: DatasetMaintenancePlan;
  batch: DatasetMaintenanceAliasBatchPlan;
  planSuccess: AliasPlanProgressEntry;
  batchSuccess: AliasBatchProgressEntry;
  progress: ProgressState;
  exchangeProgressPath: string;
}): boolean {
  const planBatchProof = options.planSuccess.batches.find(
    (proof) => proof.batch_id === options.batch.batch_id,
  );
  if (
    !planBatchProof ||
    planBatchProof.dimension !== options.batch.dimension ||
    planBatchProof.batch_request_sha256 !== options.batchSuccess.batch_request_sha256 ||
    planBatchProof.summary_audit_id !== options.batchSuccess.summary_audit_id ||
    options.batchSuccess.plan_request_sha256 !== options.planSuccess.plan_request_sha256 ||
    options.batchSuccess.plan_summary_audit_id !== options.planSuccess.summary_audit_id ||
    !options.batch.action_ids.every(
      (actionId) =>
        options.progress.successes.get(actionId)?.batch_request_sha256 ===
          options.batchSuccess.batch_request_sha256 &&
        options.progress.successes.get(actionId)?.summary_audit_id ===
          options.batchSuccess.summary_audit_id &&
        options.progress.successes.get(actionId)?.plan_request_sha256 ===
          options.planSuccess.plan_request_sha256 &&
        options.progress.successes.get(actionId)?.plan_summary_audit_id ===
          options.planSuccess.summary_audit_id,
    )
  ) {
    return false;
  }
  const expected = new Map(
    options.batch.exchange_rewrites.map((rewrite) => [
      aliasExchangeProgressKey({ batch_id: options.batch.batch_id, ...rewrite }),
      rewrite,
    ]),
  );
  const exchangeKeys = new Set<string>();
  for (const value of readJsonLinesIfPresent(options.exchangeProgressPath)) {
    if (!isJsonObject(value) || value.batch_id !== options.batch.batch_id) continue;
    const key =
      typeof value.action_id === 'string' &&
      typeof value.exchange_index === 'number' &&
      typeof value.data_set_internal_id === 'string'
        ? aliasExchangeProgressKey({
            batch_id: options.batch.batch_id,
            action_id: value.action_id,
            exchange_index: value.exchange_index,
            data_set_internal_id: value.data_set_internal_id,
          })
        : '';
    const rewrite = expected.get(key);
    const rowProof = rewrite ? options.progress.successes.get(rewrite.action_id) : null;
    if (
      !rewrite ||
      !rowProof ||
      value.schema_version !== 1 ||
      value.plan_sha256 !== options.plan.plan_sha256 ||
      value.operation_id !== options.plan.operation_id ||
      value.target_mode !== 'owner_draft' ||
      value.batch_request_sha256 !== options.batchSuccess.batch_request_sha256 ||
      value.batch_request_sha256 !== rowProof.batch_request_sha256 ||
      value.summary_audit_id !== options.batchSuccess.summary_audit_id ||
      value.summary_audit_id !== rowProof.summary_audit_id ||
      value.plan_request_sha256 !== options.planSuccess.plan_request_sha256 ||
      value.plan_request_sha256 !== rowProof.plan_request_sha256 ||
      value.plan_summary_audit_id !== options.planSuccess.summary_audit_id ||
      value.plan_summary_audit_id !== rowProof.plan_summary_audit_id ||
      value.factor !== options.batch.factor ||
      value.result !== 'success' ||
      !isJsonObject(value.actor) ||
      value.actor.user_id !== options.plan.account.user_id ||
      value.actor.email !== options.plan.account.email ||
      typeof value.logged_at_utc !== 'string' ||
      typeof value.database_audit_id !== 'string' ||
      !POSITIVE_INTEGER_TEXT.test(value.database_audit_id) ||
      value.database_audit_id !== rowProof.database_audit_id ||
      typeof value.summary_audit_id !== 'string' ||
      !POSITIVE_INTEGER_TEXT.test(value.summary_audit_id) ||
      sha256Json({
        action_id: value.action_id,
        process_id: value.process_id,
        process_version: value.process_version,
        exchange_index: value.exchange_index,
        data_set_internal_id: value.data_set_internal_id,
        flow_id: value.flow_id,
        flow_version: value.flow_version,
        direction: value.direction,
        before_exchange_sha256: value.before_exchange_sha256,
        before_mean_amount: value.before_mean_amount,
        before_resulting_amount: value.before_resulting_amount,
        after_mean_amount: value.after_mean_amount,
        after_resulting_amount: value.after_resulting_amount,
        after_exchange_sha256: value.after_exchange_sha256,
      }) !== sha256Json(rewrite) ||
      exchangeKeys.has(key)
    ) {
      return false;
    }
    exchangeKeys.add(key);
  }
  return options.batch.exchange_rewrites.every((rewrite) =>
    exchangeKeys.has(aliasExchangeProgressKey({ batch_id: options.batch.batch_id, ...rewrite })),
  );
}

function aliasPlanDerivedLogsComplete(options: {
  plan: DatasetMaintenancePlan;
  planSuccess: AliasPlanProgressEntry;
  batchProgress: AliasBatchProgressState;
  progress: ProgressState;
  exchangeProgressPath: string;
}): boolean {
  return orderedAliasBatches(options.plan).every((batch) => {
    const batchSuccess = options.batchProgress.successes.get(batch.batch_id);
    return Boolean(
      batchSuccess &&
      aliasBatchDerivedLogsComplete({
        plan: options.plan,
        batch,
        planSuccess: options.planSuccess,
        batchSuccess,
        progress: options.progress,
        exchangeProgressPath: options.exchangeProgressPath,
      }),
    );
  });
}

function appendAliasSuccessLogs(options: {
  plan: DatasetMaintenancePlan;
  batch: DatasetMaintenanceAliasBatchPlan;
  execution: Awaited<ReturnType<typeof executeAliasPlan>>;
  progress: ProgressState;
  progressPath: string;
  exchangeProgressPath: string;
  context: DatasetMaintenanceRemoteContext;
  startedAt: string;
  endedAt: string;
}): void {
  const batchRpc = options.execution.rpc.batches.get(options.batch.dimension)!;
  for (const actionId of options.batch.action_ids) {
    const action = options.plan.actions.find((entry) => entry.action_id === actionId)!;
    const proof = batchRpc.audits.get(actionId)!;
    const existingSuccess = options.progress.successes.get(actionId);
    if (existingSuccess) {
      if (
        existingSuccess.target_mode !== 'owner_draft' ||
        existingSuccess.batch_id !== options.batch.batch_id ||
        existingSuccess.batch_request_sha256 !== batchRpc.batch_request_sha256 ||
        existingSuccess.database_audit_id !== proof.audit_id ||
        existingSuccess.summary_audit_id !== batchRpc.summary_audit_id ||
        existingSuccess.plan_request_sha256 !== options.execution.rpc.plan_request_sha256 ||
        existingSuccess.plan_summary_audit_id !== options.execution.rpc.summary_audit_id ||
        existingSuccess.after_sha256 !== options.execution.after_by_action.get(actionId)
      ) {
        throw new CliError('Existing alias row progress does not match replay audit proof.', {
          code: 'DATASET_MAINTENANCE_ALIAS_PROGRESS_INVALID',
          exitCode: 1,
          details: { action_id: actionId },
        });
      }
      continue;
    }
    const entry: DatasetMaintenanceProgressEntry = {
      schema_version: 1,
      plan_sha256: options.plan.plan_sha256,
      operation_id: options.plan.operation_id,
      action_id: action.action_id,
      action: action.action,
      table: action.table,
      id: action.id,
      version: action.version,
      reason_code: action.reason_code,
      audit_context: {
        plan_sha256: options.plan.plan_sha256,
        operation_id: options.plan.operation_id,
        action_id: action.action_id,
        reason_code: action.reason_code,
        source: 'tiangong-lca dataset maintenance apply',
        target_mode: 'owner_draft',
      },
      actor: { user_id: options.context.account.user_id, email: options.context.account.email },
      started_at_utc: options.startedAt,
      ended_at_utc: options.endedAt,
      before_sha256: action.before!.row_sha256,
      after_sha256: options.execution.after_by_action.get(actionId)!,
      remote_result_sha256: sha256Json({
        plan_response: options.execution.rpc.raw,
        batch_response: batchRpc.raw,
        audit: proof,
      }),
      result: 'success',
      error: null,
      rollback: action.rollback,
      batch_id: options.batch.batch_id,
      target_mode: 'owner_draft',
      batch_request_sha256: batchRpc.batch_request_sha256,
      database_audit_id: proof.audit_id,
      summary_audit_id: batchRpc.summary_audit_id,
      plan_request_sha256: options.execution.rpc.plan_request_sha256,
      plan_summary_audit_id: options.execution.rpc.summary_audit_id,
    };
    appendStableJsonLine(options.progressPath, entry);
    options.progress.entries.push(entry);
    options.progress.successes.set(actionId, entry);
    options.progress.latestFailures.delete(actionId);
  }

  const existing = readJsonLinesIfPresent(options.exchangeProgressPath);
  const existingKeys = new Set<string>();
  const expectedRewrites = new Map(
    options.plan.alias_batches!.flatMap((batch) =>
      batch.exchange_rewrites.map(
        (rewrite) =>
          [
            aliasExchangeProgressKey({ batch_id: batch.batch_id, ...rewrite }),
            { batch, rewrite },
          ] as const,
      ),
    ),
  );
  for (const value of existing) {
    const key =
      isJsonObject(value) &&
      typeof value.batch_id === 'string' &&
      typeof value.action_id === 'string' &&
      typeof value.exchange_index === 'number' &&
      typeof value.data_set_internal_id === 'string'
        ? aliasExchangeProgressKey({
            batch_id: value.batch_id,
            action_id: value.action_id,
            exchange_index: value.exchange_index,
            data_set_internal_id: value.data_set_internal_id,
          })
        : '';
    const expected = expectedRewrites.get(key);
    const rowProof = expected ? options.progress.successes.get(expected.rewrite.action_id) : null;
    if (
      !isJsonObject(value) ||
      !expected ||
      !rowProof ||
      value.schema_version !== 1 ||
      value.plan_sha256 !== options.plan.plan_sha256 ||
      value.operation_id !== options.plan.operation_id ||
      value.target_mode !== 'owner_draft' ||
      value.factor !== expected.batch.factor ||
      value.result !== 'success' ||
      !isJsonObject(value.actor) ||
      value.actor.user_id !== options.plan.account.user_id ||
      value.actor.email !== options.plan.account.email ||
      typeof value.logged_at_utc !== 'string' ||
      typeof value.batch_request_sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(value.batch_request_sha256) ||
      value.batch_request_sha256 !== rowProof.batch_request_sha256 ||
      typeof value.database_audit_id !== 'string' ||
      POSITIVE_INTEGER_TEXT.test(value.database_audit_id) === false ||
      value.database_audit_id !== rowProof.database_audit_id ||
      typeof value.summary_audit_id !== 'string' ||
      POSITIVE_INTEGER_TEXT.test(value.summary_audit_id) === false ||
      value.summary_audit_id !== rowProof.summary_audit_id ||
      typeof value.plan_request_sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(value.plan_request_sha256) ||
      value.plan_request_sha256 !== rowProof.plan_request_sha256 ||
      typeof value.plan_summary_audit_id !== 'string' ||
      !POSITIVE_INTEGER_TEXT.test(value.plan_summary_audit_id) ||
      value.plan_summary_audit_id !== rowProof.plan_summary_audit_id ||
      sha256Json({
        action_id: value.action_id,
        process_id: value.process_id,
        process_version: value.process_version,
        exchange_index: value.exchange_index,
        data_set_internal_id: value.data_set_internal_id,
        flow_id: value.flow_id,
        flow_version: value.flow_version,
        direction: value.direction,
        before_exchange_sha256: value.before_exchange_sha256,
        before_mean_amount: value.before_mean_amount,
        before_resulting_amount: value.before_resulting_amount,
        after_mean_amount: value.after_mean_amount,
        after_resulting_amount: value.after_resulting_amount,
        after_exchange_sha256: value.after_exchange_sha256,
      }) !== sha256Json(expected.rewrite) ||
      existingKeys.has(key)
    ) {
      throw new CliError('Alias exchange progress contains an invalid or foreign entry.', {
        code: 'DATASET_MAINTENANCE_ALIAS_EXCHANGE_PROGRESS_INVALID',
        exitCode: 1,
        details: value,
      });
    }
    existingKeys.add(key);
  }
  for (const rewrite of options.batch.exchange_rewrites) {
    const key = aliasExchangeProgressKey({ batch_id: options.batch.batch_id, ...rewrite });
    if (existingKeys.has(key)) continue;
    const proof = batchRpc.audits.get(rewrite.action_id)!;
    appendStableJsonLine(options.exchangeProgressPath, {
      schema_version: 1,
      plan_sha256: options.plan.plan_sha256,
      operation_id: options.plan.operation_id,
      batch_id: options.batch.batch_id,
      target_mode: 'owner_draft',
      batch_request_sha256: batchRpc.batch_request_sha256,
      factor: options.batch.factor,
      actor: { user_id: options.context.account.user_id, email: options.context.account.email },
      logged_at_utc: options.endedAt,
      database_audit_id: proof.audit_id,
      summary_audit_id: batchRpc.summary_audit_id,
      plan_request_sha256: options.execution.rpc.plan_request_sha256,
      plan_summary_audit_id: options.execution.rpc.summary_audit_id,
      result: 'success',
      ...rewrite,
    });
    existingKeys.add(key);
  }
}

function appendAliasProofProgress(options: {
  plan: DatasetMaintenancePlan;
  execution: Awaited<ReturnType<typeof executeAliasPlan>>;
  planProgress: AliasPlanProgressState;
  batchProgress: AliasBatchProgressState;
  planProgressPath: string;
  batchProgressPath: string;
  context: DatasetMaintenanceRemoteContext;
  startedAt: string;
  endedAt: string;
}): AliasPlanProgressEntry {
  const batchProofs: AliasPlanBatchProof[] = [];
  for (const batch of orderedAliasBatches(options.plan)) {
    const rpc = options.execution.rpc.batches.get(batch.dimension)!;
    const existing = options.batchProgress.successes.get(batch.batch_id);
    if (
      existing &&
      (existing.batch_request_sha256 !== rpc.batch_request_sha256 ||
        existing.summary_audit_id !== rpc.summary_audit_id ||
        existing.plan_request_sha256 !== options.execution.rpc.plan_request_sha256 ||
        existing.plan_summary_audit_id !== options.execution.rpc.summary_audit_id)
    ) {
      throw new CliError('Existing alias batch proof does not match whole-plan replay.', {
        code: 'DATASET_MAINTENANCE_ALIAS_PROGRESS_INVALID',
        exitCode: 1,
        details: { batch_id: batch.batch_id },
      });
    }
    const proof: AliasPlanBatchProof = {
      batch_id: batch.batch_id,
      dimension: batch.dimension,
      batch_request_sha256: rpc.batch_request_sha256,
      summary_audit_id: rpc.summary_audit_id,
    };
    batchProofs.push(proof);
    if (!existing) {
      const entry: AliasBatchProgressEntry = {
        schema_version: 1,
        plan_sha256: options.plan.plan_sha256,
        operation_id: options.plan.operation_id,
        batch_id: batch.batch_id,
        target_mode: 'owner_draft',
        dimension: batch.dimension,
        factor: batch.factor,
        actor: {
          user_id: options.context.account.user_id,
          email: options.context.account.email,
        },
        started_at_utc: options.startedAt,
        ended_at_utc: options.endedAt,
        batch_request_sha256: rpc.batch_request_sha256,
        idempotent_replay: rpc.idempotent_replay,
        row_count: batch.summary.rows,
        exchange_count: rpc.exchange_count,
        summary_audit_id: rpc.summary_audit_id,
        plan_request_sha256: options.execution.rpc.plan_request_sha256,
        plan_summary_audit_id: options.execution.rpc.summary_audit_id,
        result: 'success',
        error: null,
      };
      appendStableJsonLine(options.batchProgressPath, entry);
      options.batchProgress.entries.push(entry);
      options.batchProgress.successes.set(batch.batch_id, entry);
    }
  }
  const entry: AliasPlanProgressEntry = {
    schema_version: 1,
    plan_sha256: options.plan.plan_sha256,
    operation_id: options.plan.operation_id,
    target_mode: 'owner_draft',
    actor: { user_id: options.context.account.user_id, email: options.context.account.email },
    started_at_utc: options.startedAt,
    ended_at_utc: options.endedAt,
    plan_request_sha256: options.execution.rpc.plan_request_sha256,
    idempotent_replay: options.execution.rpc.idempotent_replay,
    batch_count: 2,
    row_count: 52,
    exchange_count: 59,
    summary_audit_id: options.execution.rpc.summary_audit_id,
    batches: batchProofs,
    result: 'success',
    error: null,
  };
  if (options.planProgress.success) {
    if (
      options.planProgress.success.plan_request_sha256 !== entry.plan_request_sha256 ||
      options.planProgress.success.summary_audit_id !== entry.summary_audit_id ||
      sha256Json(options.planProgress.success.batches) !== sha256Json(entry.batches)
    ) {
      throw new CliError('Existing alias plan proof does not match whole-plan replay.', {
        code: 'DATASET_MAINTENANCE_ALIAS_PLAN_PROGRESS_INVALID',
        exitCode: 1,
      });
    }
    return options.planProgress.success;
  }
  appendStableJsonLine(options.planProgressPath, entry);
  options.planProgress.entries.push(entry);
  options.planProgress.success = entry;
  options.planProgress.latestFailure = null;
  return entry;
}

function appendAliasPlanFailure(options: {
  plan: DatasetMaintenancePlan;
  planProgress: AliasPlanProgressState;
  progressPath: string;
  context: DatasetMaintenanceRemoteContext;
  startedAt: string;
  endedAt: string;
  error: unknown;
}): AliasPlanProgressEntry {
  const entry: AliasPlanProgressEntry = {
    schema_version: 1,
    plan_sha256: options.plan.plan_sha256,
    operation_id: options.plan.operation_id,
    target_mode: 'owner_draft',
    actor: { user_id: options.context.account.user_id, email: options.context.account.email },
    started_at_utc: options.startedAt,
    ended_at_utc: options.endedAt,
    plan_request_sha256: null,
    idempotent_replay: null,
    batch_count: 2,
    row_count: 52,
    exchange_count: 59,
    summary_audit_id: null,
    batches: [],
    result: 'failed',
    error: errorMessage(options.error),
  };
  appendStableJsonLine(options.progressPath, entry);
  options.planProgress.entries.push(entry);
  if (!options.planProgress.success) {
    options.planProgress.latestFailure = entry;
  }
  return entry;
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
  if (!pendingRow || pendingRow.user_id !== options.action.expected_user_id || !exactDraft) {
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
  if (options.action.action === 'update_json_ordered') {
    throw new CliError('Atomic alias actions must execute through the whole-plan RPC.', {
      code: 'DATASET_MAINTENANCE_ALIAS_SEQUENTIAL_WRITE_FORBIDDEN',
      exitCode: 1,
    });
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
  const aliasPlanProgressPath = path.join(planDir, 'alias-plan-progress.jsonl');
  const aliasBatchProgressPath = path.join(planDir, 'alias-batch-progress.jsonl');
  const aliasExchangeProgressPath = path.join(planDir, 'alias-exchange-progress.jsonl');
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
      let resumedSuccesses = progress.successes.size;
      const aliasPlanProgress: AliasPlanProgressState =
        plan.operation === 'merge-support-aliases'
          ? parseAliasPlanProgress(plan, aliasPlanProgressPath)
          : { entries: [], success: null, latestFailure: null };
      const aliasBatchProgress: AliasBatchProgressState =
        plan.operation === 'merge-support-aliases'
          ? parseAliasBatchProgress(plan, aliasBatchProgressPath)
          : { entries: [], successes: new Map() };
      const current = await fetchMaintenanceAccountRows({
        context,
        userId: plan.account.user_id,
      });
      assertApplyPreconditions({
        plan,
        planDir,
        currentRows: current.rows,
        progress,
        aliasPlanProgress,
      });
      if (plan.operation === 'merge-support-aliases') {
        await assertAliasSupportSnapshots({ plan, context });
      }

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
          target_mode: plan.target_mode,
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

      if (plan.operation === 'merge-support-aliases') {
        const alreadyComplete = Boolean(
          aliasPlanProgress.success &&
          aliasPlanDerivedLogsComplete({
            plan,
            planSuccess: aliasPlanProgress.success,
            batchProgress: aliasBatchProgress,
            progress,
            exchangeProgressPath: aliasExchangeProgressPath,
          }),
        );
        resumedSuccesses = alreadyComplete ? plan.actions.length : 0;
        let planSuccess = alreadyComplete ? aliasPlanProgress.success : null;
        let planFailure: AliasPlanProgressEntry | null = null;
        if (!alreadyComplete) {
          const startedAt = clock(options);
          try {
            const execution = await executeAliasPlan({ plan, planDir, context });
            const endedAt = clock(options);
            for (const batch of orderedAliasBatches(plan)) {
              appendAliasSuccessLogs({
                plan,
                batch,
                execution,
                progress,
                progressPath,
                exchangeProgressPath: aliasExchangeProgressPath,
                context,
                startedAt,
                endedAt,
              });
            }
            planSuccess = appendAliasProofProgress({
              plan,
              execution,
              planProgress: aliasPlanProgress,
              batchProgress: aliasBatchProgress,
              planProgressPath: aliasPlanProgressPath,
              batchProgressPath: aliasBatchProgressPath,
              context,
              startedAt,
              endedAt,
            });
          } catch (error) {
            planFailure = appendAliasPlanFailure({
              plan,
              planProgress: aliasPlanProgress,
              progressPath: aliasPlanProgressPath,
              context,
              startedAt,
              endedAt: clock(options),
              error,
            });
          }
        }
        const fullyProven = Boolean(
          planSuccess &&
          aliasPlanDerivedLogsComplete({
            plan,
            planSuccess,
            batchProgress: aliasBatchProgress,
            progress,
            exchangeProgressPath: aliasExchangeProgressPath,
          }),
        );
        const failureError = planFailure?.error ?? 'Whole-plan proof is incomplete.';
        const actions = plan.actions.map((action) => {
          return {
            action_id: action.action_id,
            action: action.action,
            table: action.table,
            id: action.id,
            version: action.version,
            status: fullyProven ? ('success' as const) : ('failed' as const),
            error: fullyProven ? null : failureError,
          };
        });
        const successCount = fullyProven ? actions.length : 0;
        const failureCount = fullyProven ? 0 : actions.length;
        const attemptPath = nextAttemptPath(planDir);
        const report: DatasetMaintenanceApplyReport = {
          schema_version: 1,
          generated_at_utc: clock(options),
          status: successCount === actions.length ? 'completed' : 'completed_with_failures',
          task_id: plan.task_id,
          operation: plan.operation,
          operation_id: plan.operation_id,
          target_mode: plan.target_mode,
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
            alias_plan_progress: aliasPlanProgressPath,
            alias_batch_progress: aliasBatchProgressPath,
            alias_exchange_progress: aliasExchangeProgressPath,
          },
          database_audit: {
            rpc_transaction_log: 'public.command_audit_log',
            source: 'tiangong-lca dataset maintenance apply',
            correlation_fields: [
              'plan_sha256',
              'operation_id',
              'target_visibility',
              'plan_request_sha256',
              'batch_id',
              'action_id',
              'batch_request_sha256',
            ],
          },
          ...(fullyProven && planSuccess
            ? {
                alias_plan_proof: {
                  plan_request_sha256: planSuccess.plan_request_sha256!,
                  summary_audit_id: planSuccess.summary_audit_id!,
                  batch_count: 2 as const,
                  row_count: 52 as const,
                  exchange_count: 59 as const,
                  idempotent_replay: planSuccess.idempotent_replay!,
                },
              }
            : {}),
        };
        writeImmutableJson(attemptPath, report);
        writeJsonArtifact(report.artifacts.commit_report, report);
        return report;
      }

      const ordered = [...plan.actions].sort((left, right) => {
        const rank = {
          save_draft: 0,
          update_json_ordered: 0,
          delete: 1,
        } as const;
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
        target_mode: plan.target_mode,
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
  aliasBatchDerivedLogsComplete,
  aliasPlanDerivedLogsComplete,
  aliasExchangeProgressKey,
  appendAliasSuccessLogs,
  assertApplyPreconditions,
  assertAliasSupportSnapshots,
  buildAliasBatchRequest,
  buildAliasPlanRequest,
  clock,
  errorMessage,
  executeAliasPlan,
  executeAction,
  finalProjectedRows,
  loadDesiredPayload,
  nextAttemptPath,
  parseAliasBatchProgress,
  parseAliasPlanProgress,
  parseProgress,
  validateAliasRpcResult,
  validateAliasPlanRpcResult,
  validateApprovalRecord,
};
