import crypto from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inspectMaintenancePublishPayload } from './dataset-maintenance-publish-validation.js';
import { CliError } from './errors.js';

export type JsonObject = Record<string, unknown>;

export const MAINTENANCE_MUTABLE_TABLES = ['contacts', 'sources', 'flows', 'processes'] as const;

export const MAINTENANCE_PUBLISH_TABLES = ['unitgroups', 'flowproperties'] as const;

export const MAINTENANCE_SCAN_TABLES = [
  ...MAINTENANCE_MUTABLE_TABLES,
  'lifecyclemodels',
  ...MAINTENANCE_PUBLISH_TABLES,
] as const;

export type DatasetMaintenanceMutableTable = (typeof MAINTENANCE_MUTABLE_TABLES)[number];
export type DatasetMaintenancePublishTable = (typeof MAINTENANCE_PUBLISH_TABLES)[number];
export type DatasetMaintenanceActionTable =
  | DatasetMaintenanceMutableTable
  | DatasetMaintenancePublishTable;
export type DatasetMaintenanceScanTable = (typeof MAINTENANCE_SCAN_TABLES)[number];
export type DatasetMaintenanceOperation =
  | 'delete'
  | 'retire'
  | 'redo-import'
  | 'repair-references'
  | 'publish-support';
export type DatasetMaintenanceActionKind = 'save_draft' | 'delete' | 'publish';

export type DatasetMaintenanceScopeAction = {
  action_id: string;
  action: DatasetMaintenanceActionKind;
  table: DatasetMaintenanceActionTable;
  id: string;
  version: string;
  expected_user_id: string;
  expected_state_code: 0;
  reason_code: string;
  reason: string;
  evidence: unknown[];
  desired_payload_path?: string;
  expected_before_sha256?: string;
};

export type DatasetMaintenanceScope = {
  schema_version: 1;
  task_id: string;
  operation: DatasetMaintenanceOperation;
  account: {
    user_id: string;
    email?: string;
  };
  source_import_run_id?: string;
  source_lineage?: unknown;
  actions: DatasetMaintenanceScopeAction[];
};

export type DatasetMaintenanceRemoteRow = {
  table: DatasetMaintenanceScanTable;
  id: string;
  version: string;
  user_id: string | null;
  state_code: number | null;
  modified_at: string | null;
  json_ordered: JsonObject | null;
  model_id: string | null;
  rule_verification: boolean | null;
};

export type DatasetMaintenanceRowSnapshot = DatasetMaintenanceRemoteRow & {
  row_sha256: string;
  payload_sha256: string | null;
};

export type DatasetMaintenanceBlocker = {
  code: string;
  message: string;
  action_id?: string;
  table?: DatasetMaintenanceScanTable;
  id?: string;
  version?: string;
  details?: unknown;
};

export type DatasetMaintenanceProtectedRow = {
  table: DatasetMaintenanceScanTable;
  id: string;
  version: string;
  modified_at: string | null;
  row_sha256: string;
  payload_sha256: string | null;
  reason: 'non_action_visible_row' | 'blocked_action_row';
};

export type DatasetMaintenanceReferenceImpact = {
  target_action_id: string;
  target_table: DatasetMaintenanceActionTable;
  target_id: string;
  target_version: string;
  phase: 'current' | 'projected';
  source_table: DatasetMaintenanceScanTable;
  source_id: string;
  source_version: string;
  reference_path: string;
  reference_version: string | null;
};

export type DatasetMaintenancePlanAction = DatasetMaintenanceScopeAction & {
  ordinal: number;
  status: 'ready' | 'blocked';
  before: DatasetMaintenanceRowSnapshot | null;
  desired_payload: {
    path: string;
    sha256: string;
  } | null;
  blockers: DatasetMaintenanceBlocker[];
  rollback: {
    strategy:
      | 'save_before_snapshot'
      | 'restore_deleted_before_snapshot'
      | 'manual_review_published_state';
    before_payload_sha256: string | null;
    before_payload: JsonObject | null;
    model_id: string | null;
    rule_verification: boolean | null;
  };
};

export type DatasetMaintenancePlan = {
  schema_version: 1;
  generated_at_utc: string;
  task_id: string;
  operation: DatasetMaintenanceOperation;
  operation_id: string;
  account: {
    user_id: string;
    email: string | null;
  };
  source_import_run_id: string | null;
  source_lineage: unknown;
  status: 'ready' | 'blocked';
  scope_sha256: string;
  visible_snapshot_sha256: string;
  projected_reference_sha256: string;
  plan_sha256: string;
  summary: {
    actions: number;
    save_draft: number;
    delete: number;
    publish?: number;
    protected_rows: number;
    blockers: number;
    current_reference_impacts: number;
    projected_reference_impacts: number;
  };
  artifacts: {
    maintenance_scope: string;
    rls_visible_snapshot: string;
    protected_rows: string;
    reference_impact_report: string;
    maintenance_plan: string;
    dry_run_report: string;
    payload_dir: string;
  };
  actions: DatasetMaintenancePlanAction[];
  protected_rows: DatasetMaintenanceProtectedRow[];
  blockers: DatasetMaintenanceBlocker[];
};

export const DATASET_MAINTENANCE_SUPPORT_APPROVAL_SCHEMA =
  'tiangong-lca.dataset-maintenance.support-approval.v1' as const;

export type DatasetMaintenanceSupportApprovalAction = {
  ordinal: number;
  action_id: string;
  action: 'publish';
  table: DatasetMaintenancePublishTable;
  id: string;
  version: string;
  reason_code: string;
  expected_user_id: string;
  expected_state_code: 0;
  expected_modified_at: string;
  expected_before_sha256: string;
  expected_payload_sha256: string;
  plan_sha256: string;
  operation_id: string;
  approval_audit_id: string;
  reviewer_user_id: string;
  idempotent_replay: boolean;
};

export type DatasetMaintenanceSupportApprovalRecord = {
  schema: typeof DATASET_MAINTENANCE_SUPPORT_APPROVAL_SCHEMA;
  schema_version: 1;
  approved_at_utc: string;
  plan_path: string;
  plan_sha256: string;
  task_id: string;
  operation: 'publish-support';
  operation_id: string;
  target_owner: {
    user_id: string;
    email: string | null;
  };
  reviewer: {
    user_id: string;
    email: string;
  };
  authority: {
    source: 'public.command_audit_log';
    rpc: 'cmd_dataset_support_approve_guarded';
    local_artifact_is_authority: false;
  };
  actions: DatasetMaintenanceSupportApprovalAction[];
};

export type DatasetMaintenanceProgressApprovalCorrelation = {
  approval_audit_id: string;
  reviewer_user_id: string;
  reviewer_email: string;
  publish_audit_id: string | null;
};

export type DatasetMaintenanceProgressEntry = {
  schema_version: 1;
  plan_sha256: string;
  operation_id: string;
  action_id: string;
  action: DatasetMaintenanceActionKind;
  table: DatasetMaintenanceActionTable;
  id: string;
  version: string;
  reason_code: string;
  audit_context: {
    plan_sha256: string;
    operation_id: string;
    action_id: string;
    reason_code: string;
    source: 'tiangong-lca dataset maintenance apply';
    approval_audit_id?: string;
  };
  actor: {
    user_id: string;
    email: string;
  };
  started_at_utc: string;
  ended_at_utc: string;
  before_sha256: string;
  after_sha256: string | null;
  remote_result_sha256: string | null;
  result: 'success' | 'failed';
  error: string | null;
  rollback: DatasetMaintenancePlanAction['rollback'];
  support_approval?: DatasetMaintenanceProgressApprovalCorrelation | null;
};

function token(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableJsonValue(value[key])]),
    );
  }
  return value;
}

export function stableJsonText(value: unknown): string {
  return JSON.stringify(stableJsonValue(value));
}

export function sha256Text(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function sha256Json(value: unknown): string {
  return sha256Text(stableJsonText(value));
}

export function normalizeMaintenanceAuditId(value: unknown, label: string): string {
  if (typeof value === 'string' && /^[1-9][0-9]{0,17}$/u.test(value)) {
    return value;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  throw new CliError(`${label} must be a positive integer string.`, {
    code: 'DATASET_MAINTENANCE_AUDIT_ID_INVALID',
    exitCode: 1,
    details: value,
  });
}

export function snapshotRemoteRow(row: DatasetMaintenanceRemoteRow): DatasetMaintenanceRowSnapshot {
  return {
    ...row,
    row_sha256: sha256Json(row),
    payload_sha256: row.json_ordered ? sha256Json(row.json_ordered) : null,
  };
}

export function maintenanceRowKey(row: {
  table: DatasetMaintenanceScanTable;
  id: string;
  version: string;
}): string {
  return `${row.table}\u0000${row.id}\u0000${row.version}`;
}

function requireToken(value: unknown, label: string): string {
  const normalized = token(value);
  if (!normalized) {
    throw new CliError(`Maintenance scope ${label} must be a non-empty string.`, {
      code: 'DATASET_MAINTENANCE_SCOPE_INVALID',
      exitCode: 2,
      details: { field: label },
    });
  }
  return normalized;
}

function parseAction(
  value: unknown,
  index: number,
  accountUserId: string,
  operation: DatasetMaintenanceOperation,
): DatasetMaintenanceScopeAction {
  if (!isJsonObject(value)) {
    throw new CliError(`Maintenance scope action ${index} must be an object.`, {
      code: 'DATASET_MAINTENANCE_SCOPE_INVALID',
      exitCode: 2,
    });
  }
  const action = requireToken(value.action, `actions[${index}].action`);
  const table = requireToken(value.table, `actions[${index}].table`);
  if (!['save_draft', 'delete', 'publish'].includes(action)) {
    throw new CliError(`Unsupported maintenance action: ${action}`, {
      code: 'DATASET_MAINTENANCE_ACTION_UNSUPPORTED',
      exitCode: 2,
    });
  }
  const publishAction = action === 'publish';
  const allowedTable = publishAction
    ? (MAINTENANCE_PUBLISH_TABLES as readonly string[]).includes(table)
    : (MAINTENANCE_MUTABLE_TABLES as readonly string[]).includes(table);
  if (!allowedTable) {
    throw new CliError(
      `Maintenance cannot mutate protected or unsupported dataset table: ${table}`,
      {
        code: 'DATASET_MAINTENANCE_TABLE_PROTECTED',
        exitCode: 2,
      },
    );
  }
  if (
    (operation === 'publish-support' && !publishAction) ||
    (operation !== 'publish-support' && publishAction)
  ) {
    throw new CliError(`Maintenance operation ${operation} cannot contain ${action} actions.`, {
      code: 'DATASET_MAINTENANCE_OPERATION_ACTION_MISMATCH',
      exitCode: 2,
    });
  }
  if (value.expected_state_code !== 0) {
    throw new CliError(`Maintenance action ${index} must require expected_state_code=0.`, {
      code: 'DATASET_MAINTENANCE_NON_DRAFT_FORBIDDEN',
      exitCode: 2,
    });
  }
  const expectedUserId = requireToken(value.expected_user_id, `actions[${index}].expected_user_id`);
  if (expectedUserId !== accountUserId) {
    throw new CliError(`Maintenance action ${index} owner does not match scope account.`, {
      code: 'DATASET_MAINTENANCE_SCOPE_OWNER_MISMATCH',
      exitCode: 2,
    });
  }
  if (!Array.isArray(value.evidence)) {
    throw new CliError(`Maintenance action ${index} evidence must be an array.`, {
      code: 'DATASET_MAINTENANCE_SCOPE_INVALID',
      exitCode: 2,
    });
  }
  const desiredPayloadPath = token(value.desired_payload_path);
  if (action === 'save_draft' && !desiredPayloadPath) {
    throw new CliError(`Maintenance save_draft action ${index} requires desired_payload_path.`, {
      code: 'DATASET_MAINTENANCE_DESIRED_PAYLOAD_REQUIRED',
      exitCode: 2,
    });
  }
  if (action !== 'save_draft' && desiredPayloadPath) {
    throw new CliError(
      `Maintenance ${action} action ${index} cannot include desired_payload_path.`,
      {
        code: 'DATASET_MAINTENANCE_DESIRED_PAYLOAD_FORBIDDEN',
        exitCode: 2,
      },
    );
  }
  const expectedBeforeSha256 = token(value.expected_before_sha256);
  if (expectedBeforeSha256 && !/^[a-f0-9]{64}$/u.test(expectedBeforeSha256)) {
    throw new CliError(`Maintenance action ${index} expected_before_sha256 is invalid.`, {
      code: 'DATASET_MAINTENANCE_SCOPE_INVALID',
      exitCode: 2,
    });
  }

  return {
    action_id: requireToken(value.action_id, `actions[${index}].action_id`),
    action: action as DatasetMaintenanceActionKind,
    table: table as DatasetMaintenanceActionTable,
    id: requireToken(value.id, `actions[${index}].id`),
    version: requireToken(value.version, `actions[${index}].version`),
    expected_user_id: expectedUserId,
    expected_state_code: 0,
    reason_code: requireToken(value.reason_code, `actions[${index}].reason_code`),
    reason: requireToken(value.reason, `actions[${index}].reason`),
    evidence: value.evidence,
    ...(desiredPayloadPath ? { desired_payload_path: desiredPayloadPath } : {}),
    ...(expectedBeforeSha256 ? { expected_before_sha256: expectedBeforeSha256 } : {}),
  };
}

export function parseMaintenanceScope(
  value: unknown,
  expectedOperation?: DatasetMaintenanceOperation,
): DatasetMaintenanceScope {
  if (!isJsonObject(value) || value.schema_version !== 1 || !isJsonObject(value.account)) {
    throw new CliError('Maintenance scope must use schema_version=1 and include account.', {
      code: 'DATASET_MAINTENANCE_SCOPE_INVALID',
      exitCode: 2,
    });
  }
  const operation = requireToken(value.operation, 'operation');
  if (
    !['delete', 'retire', 'redo-import', 'repair-references', 'publish-support'].includes(operation)
  ) {
    throw new CliError(`Unsupported maintenance operation: ${operation}`, {
      code: 'DATASET_MAINTENANCE_OPERATION_UNSUPPORTED',
      exitCode: 2,
    });
  }
  if (expectedOperation && operation !== expectedOperation) {
    throw new CliError(
      `Scope operation ${operation} does not match requested operation ${expectedOperation}.`,
      {
        code: 'DATASET_MAINTENANCE_OPERATION_MISMATCH',
        exitCode: 2,
      },
    );
  }
  const userId = requireToken(value.account.user_id, 'account.user_id');
  if (!Array.isArray(value.actions) || value.actions.length === 0) {
    throw new CliError('Maintenance scope actions must be a non-empty array.', {
      code: 'DATASET_MAINTENANCE_SCOPE_INVALID',
      exitCode: 2,
    });
  }
  const actions = value.actions.map((entry, index) =>
    parseAction(entry, index, userId, operation as DatasetMaintenanceOperation),
  );
  const actionIds = new Set<string>();
  const rowKeys = new Set<string>();
  const payloadNames = new Set<string>();
  for (const action of actions) {
    if (actionIds.has(action.action_id)) {
      throw new CliError(`Duplicate maintenance action_id: ${action.action_id}`, {
        code: 'DATASET_MAINTENANCE_ACTION_ID_DUPLICATE',
        exitCode: 2,
      });
    }
    actionIds.add(action.action_id);
    const rowKey = maintenanceRowKey(action);
    if (rowKeys.has(rowKey)) {
      throw new CliError(`Multiple maintenance actions target the same row: ${action.id}`, {
        code: 'DATASET_MAINTENANCE_TARGET_DUPLICATE',
        exitCode: 2,
      });
    }
    rowKeys.add(rowKey);
    const payloadName = safeActionFileName(action.action_id);
    if (payloadNames.has(payloadName)) {
      throw new CliError(`Maintenance action ids collide as payload filenames: ${payloadName}`, {
        code: 'DATASET_MAINTENANCE_ACTION_FILENAME_COLLISION',
        exitCode: 2,
      });
    }
    payloadNames.add(payloadName);
  }
  const email = token(value.account.email);
  const sourceImportRunId = token(value.source_import_run_id);
  return {
    schema_version: 1,
    task_id: requireToken(value.task_id, 'task_id'),
    operation: operation as DatasetMaintenanceOperation,
    account: {
      user_id: userId,
      ...(email ? { email } : {}),
    },
    ...(sourceImportRunId ? { source_import_run_id: sourceImportRunId } : {}),
    ...('source_lineage' in value ? { source_lineage: value.source_lineage } : {}),
    actions,
  };
}

export function readJsonFile(filePath: string, label: string): unknown {
  const resolved = path.resolve(filePath);
  if (!existsSync(resolved)) {
    throw new CliError(`${label} not found: ${resolved}`, {
      code: 'DATASET_MAINTENANCE_ARTIFACT_NOT_FOUND',
      exitCode: 2,
    });
  }
  try {
    return JSON.parse(readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new CliError(`${label} is not valid JSON: ${resolved}`, {
      code: 'DATASET_MAINTENANCE_ARTIFACT_INVALID',
      exitCode: 2,
      details: String(error),
    });
  }
}

function writeImmutableText(filePath: string, text: string): string {
  const resolved = path.resolve(filePath);
  if (existsSync(resolved)) {
    if (readFileSync(resolved, 'utf8') === text) {
      return resolved;
    }
    throw new CliError(`Refusing to overwrite immutable maintenance artifact: ${resolved}`, {
      code: 'DATASET_MAINTENANCE_ARTIFACT_IMMUTABLE',
      exitCode: 1,
    });
  }
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeFileSync(resolved, text, { encoding: 'utf8', flag: 'wx' });
  return resolved;
}

export function writeImmutableJson(filePath: string, value: unknown): string {
  return writeImmutableText(filePath, `${stableJsonText(value)}\n`);
}

export function writeImmutableJsonLines(filePath: string, values: unknown[]): string {
  const text = values.length ? `${values.map(stableJsonText).join('\n')}\n` : '';
  return writeImmutableText(filePath, text);
}

export function appendStableJsonLine(filePath: string, value: unknown): string {
  const resolved = path.resolve(filePath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  appendFileSync(resolved, `${stableJsonText(value)}\n`, 'utf8');
  return resolved;
}

export function readJsonLinesIfPresent(filePath: string): unknown[] {
  const resolved = path.resolve(filePath);
  if (!existsSync(resolved)) {
    return [];
  }
  return readFileSync(resolved, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new CliError(`Invalid maintenance JSONL at ${resolved}:${index + 1}`, {
          code: 'DATASET_MAINTENANCE_ARTIFACT_INVALID',
          exitCode: 1,
          details: String(error),
        });
      }
    });
}

export function safeActionFileName(actionId: string): string {
  const safe = actionId.replace(/[^a-zA-Z0-9._-]+/gu, '_').replace(/^_+|_+$/gu, '');
  return safe || sha256Text(actionId).slice(0, 16);
}

export function resolveMaintenancePlanArtifactPath(
  planDir: string,
  relativePath: string,
  label: string,
): string {
  const root = path.resolve(planDir);
  if (!relativePath.trim() || path.isAbsolute(relativePath)) {
    throw new CliError(`${label} must be a relative path inside the maintenance plan directory.`, {
      code: 'DATASET_MAINTENANCE_PLAN_ARTIFACT_PATH_INVALID',
      exitCode: 2,
      details: relativePath,
    });
  }
  const resolved = path.resolve(root, relativePath);
  const withinRoot = path.relative(root, resolved);
  if (!withinRoot || withinRoot === '..' || withinRoot.startsWith(`..${path.sep}`)) {
    throw new CliError(`${label} must stay inside the maintenance plan directory.`, {
      code: 'DATASET_MAINTENANCE_PLAN_ARTIFACT_PATH_INVALID',
      exitCode: 2,
      details: relativePath,
    });
  }
  return resolved;
}

export function computePlanSha256(plan: DatasetMaintenancePlan): string {
  const body = { ...plan, plan_sha256: '' };
  return sha256Json(body);
}

export function parseMaintenancePlan(value: unknown): DatasetMaintenancePlan {
  if (
    !isJsonObject(value) ||
    value.schema_version !== 1 ||
    !Array.isArray(value.actions) ||
    !Array.isArray(value.protected_rows) ||
    !Array.isArray(value.blockers) ||
    !isJsonObject(value.account) ||
    !isJsonObject(value.artifacts)
  ) {
    throw new CliError('Maintenance plan is not a valid schema_version=1 plan.', {
      code: 'DATASET_MAINTENANCE_PLAN_INVALID',
      exitCode: 2,
    });
  }
  const plan = value as DatasetMaintenancePlan;
  const expected = computePlanSha256(plan);
  if (plan.plan_sha256 !== expected) {
    throw new CliError('Maintenance plan hash does not match its canonical contents.', {
      code: 'DATASET_MAINTENANCE_PLAN_HASH_MISMATCH',
      exitCode: 2,
      details: { expected, received: plan.plan_sha256 },
    });
  }

  const normalizedScope = parseMaintenanceScope(
    {
      schema_version: 1,
      task_id: plan.task_id,
      operation: plan.operation,
      account: plan.account,
      ...(plan.source_import_run_id ? { source_import_run_id: plan.source_import_run_id } : {}),
      source_lineage: plan.source_lineage,
      actions: plan.actions,
    },
    plan.operation,
  );
  const actionIds = new Set<string>();
  const ordinals = new Set<number>();
  for (const [index, action] of plan.actions.entries()) {
    const normalizedAction = normalizedScope.actions[index];
    if (
      !normalizedAction ||
      action.action_id !== normalizedAction.action_id ||
      !Number.isInteger(action.ordinal) ||
      action.ordinal < 0 ||
      ordinals.has(action.ordinal) ||
      !['ready', 'blocked'].includes(action.status) ||
      !Array.isArray(action.blockers) ||
      !isJsonObject(action.rollback)
    ) {
      throw new CliError('Maintenance plan contains an invalid action contract.', {
        code: 'DATASET_MAINTENANCE_PLAN_INVALID',
        exitCode: 2,
        details: { index, action_id: action.action_id },
      });
    }
    actionIds.add(action.action_id);
    ordinals.add(action.ordinal);
    if (action.status === 'ready') {
      const before = action.before;
      if (
        !isJsonObject(before) ||
        before.table !== action.table ||
        before.id !== action.id ||
        before.version !== action.version ||
        before.user_id !== action.expected_user_id ||
        before.state_code !== 0 ||
        !isJsonObject(before.json_ordered) ||
        typeof before.row_sha256 !== 'string' ||
        typeof before.payload_sha256 !== 'string' ||
        action.blockers.length > 0
      ) {
        throw new CliError('Ready maintenance plan action has an invalid before snapshot.', {
          code: 'DATASET_MAINTENANCE_PLAN_INVALID',
          exitCode: 2,
          details: { action_id: action.action_id },
        });
      }
      if (action.action === 'publish') {
        if (typeof before.modified_at !== 'string' || before.modified_at.length === 0) {
          throw new CliError('Ready publish action requires a frozen modified_at value.', {
            code: 'DATASET_MAINTENANCE_PLAN_INVALID',
            exitCode: 2,
            details: { action_id: action.action_id },
          });
        }
        const inspection = inspectMaintenancePublishPayload({
          table: action.table as DatasetMaintenancePublishTable,
          payload: before.json_ordered,
        });
        if (
          inspection.identity.id !== action.id ||
          inspection.identity.version !== action.version ||
          !inspection.schemaResult.success
        ) {
          throw new CliError(
            'Ready publish action payload must pass its TIDAS schema and match the row id/version.',
            {
              code: 'DATASET_MAINTENANCE_PLAN_INVALID',
              exitCode: 2,
              details: {
                action_id: action.action_id,
                identity: inspection.identity,
                schema_valid: inspection.schemaResult.success,
              },
            },
          );
        }
      }
      const remoteRow: DatasetMaintenanceRemoteRow = {
        table: before.table,
        id: before.id,
        version: before.version,
        user_id: before.user_id,
        state_code: before.state_code,
        modified_at: before.modified_at,
        json_ordered: before.json_ordered,
        model_id: before.model_id,
        rule_verification: before.rule_verification,
      };
      const expectedSnapshot = snapshotRemoteRow(remoteRow);
      if (
        before.row_sha256 !== expectedSnapshot.row_sha256 ||
        before.payload_sha256 !== expectedSnapshot.payload_sha256
      ) {
        throw new CliError('Ready maintenance plan action before snapshot hash is invalid.', {
          code: 'DATASET_MAINTENANCE_PLAN_INVALID',
          exitCode: 2,
          details: { action_id: action.action_id },
        });
      }
      const expectedRollbackStrategy =
        action.action === 'save_draft'
          ? 'save_before_snapshot'
          : action.action === 'delete'
            ? 'restore_deleted_before_snapshot'
            : 'manual_review_published_state';
      if (
        action.rollback.strategy !== expectedRollbackStrategy ||
        action.rollback.before_payload_sha256 !== before.payload_sha256 ||
        !isJsonObject(action.rollback.before_payload) ||
        sha256Json(action.rollback.before_payload) !== before.payload_sha256 ||
        action.rollback.model_id !== before.model_id ||
        action.rollback.rule_verification !== before.rule_verification
      ) {
        throw new CliError('Ready maintenance plan action rollback snapshot is invalid.', {
          code: 'DATASET_MAINTENANCE_PLAN_INVALID',
          exitCode: 2,
          details: { action_id: action.action_id },
        });
      }
    }
    if (
      (action.action === 'save_draft' &&
        (!isJsonObject(action.desired_payload) ||
          typeof action.desired_payload.path !== 'string' ||
          !/^[a-f0-9]{64}$/u.test(String(action.desired_payload.sha256)))) ||
      (action.action !== 'save_draft' && action.desired_payload !== null)
    ) {
      throw new CliError('Maintenance plan action desired payload contract is invalid.', {
        code: 'DATASET_MAINTENANCE_PLAN_INVALID',
        exitCode: 2,
        details: { action_id: action.action_id },
      });
    }
  }
  const flattenedBlockers = plan.actions.flatMap((action) => action.blockers);
  const summaryMatches =
    isJsonObject(plan.summary) &&
    plan.summary.actions === plan.actions.length &&
    plan.summary.save_draft ===
      plan.actions.filter((action) => action.action === 'save_draft').length &&
    plan.summary.delete === plan.actions.filter((action) => action.action === 'delete').length &&
    (plan.summary.publish ?? 0) ===
      plan.actions.filter((action) => action.action === 'publish').length &&
    plan.summary.protected_rows === plan.protected_rows.length &&
    plan.summary.blockers === plan.blockers.length &&
    Number.isInteger(plan.summary.current_reference_impacts) &&
    plan.summary.current_reference_impacts >= 0 &&
    Number.isInteger(plan.summary.projected_reference_impacts) &&
    plan.summary.projected_reference_impacts >= 0;
  const ready =
    plan.status === 'ready' &&
    plan.blockers.length === 0 &&
    flattenedBlockers.length === 0 &&
    plan.actions.every((action) => action.status === 'ready');
  const blocked =
    plan.status === 'blocked' &&
    plan.blockers.length > 0 &&
    flattenedBlockers.length > 0 &&
    plan.actions.some((action) => action.status === 'blocked');
  if (
    actionIds.size !== plan.actions.length ||
    !summaryMatches ||
    (!ready && !blocked) ||
    sha256Json(plan.blockers) !== sha256Json(flattenedBlockers)
  ) {
    throw new CliError('Maintenance plan status or blocker contract is inconsistent.', {
      code: 'DATASET_MAINTENANCE_PLAN_INVALID',
      exitCode: 2,
    });
  }
  return plan;
}

export function parseMaintenanceSupportApprovalRecord(
  value: unknown,
  plan: DatasetMaintenancePlan,
): DatasetMaintenanceSupportApprovalRecord {
  if (
    !isJsonObject(value) ||
    value.schema !== DATASET_MAINTENANCE_SUPPORT_APPROVAL_SCHEMA ||
    value.schema_version !== 1 ||
    value.operation !== 'publish-support' ||
    plan.operation !== 'publish-support' ||
    value.plan_sha256 !== plan.plan_sha256 ||
    value.task_id !== plan.task_id ||
    value.operation_id !== plan.operation_id ||
    typeof value.approved_at_utc !== 'string' ||
    !value.approved_at_utc.trim() ||
    typeof value.plan_path !== 'string' ||
    !value.plan_path.trim() ||
    !isJsonObject(value.target_owner) ||
    value.target_owner.user_id !== plan.account.user_id ||
    value.target_owner.email !== plan.account.email ||
    !isJsonObject(value.reviewer) ||
    typeof value.reviewer.user_id !== 'string' ||
    !value.reviewer.user_id.trim() ||
    typeof value.reviewer.email !== 'string' ||
    !value.reviewer.email.trim() ||
    value.reviewer.user_id === plan.account.user_id ||
    !isJsonObject(value.authority) ||
    value.authority.source !== 'public.command_audit_log' ||
    value.authority.rpc !== 'cmd_dataset_support_approve_guarded' ||
    value.authority.local_artifact_is_authority !== false ||
    !Array.isArray(value.actions) ||
    value.actions.length !== plan.actions.length
  ) {
    throw new CliError(
      'Support approval record does not match the immutable publish-support plan.',
      {
        code: 'DATASET_MAINTENANCE_SUPPORT_APPROVAL_INVALID',
        exitCode: 1,
      },
    );
  }

  const rawActions = value.actions;
  const actionsById = new Map<string, JsonObject>();
  for (const rawAction of rawActions) {
    if (
      !isJsonObject(rawAction) ||
      typeof rawAction.action_id !== 'string' ||
      actionsById.has(rawAction.action_id)
    ) {
      throw new CliError('Support approval record has duplicate or invalid actions.', {
        code: 'DATASET_MAINTENANCE_SUPPORT_APPROVAL_INVALID',
        exitCode: 1,
      });
    }
    actionsById.set(rawAction.action_id, rawAction);
  }

  const normalizedActions: DatasetMaintenanceSupportApprovalAction[] = [];
  for (const action of plan.actions) {
    const rawAction = actionsById.get(action.action_id);
    if (
      action.action !== 'publish' ||
      !action.before ||
      typeof action.before.modified_at !== 'string' ||
      typeof action.before.payload_sha256 !== 'string' ||
      !rawAction ||
      rawAction.ordinal !== action.ordinal ||
      rawAction.action !== action.action ||
      rawAction.table !== action.table ||
      rawAction.id !== action.id ||
      rawAction.version !== action.version ||
      rawAction.reason_code !== action.reason_code ||
      rawAction.expected_user_id !== action.expected_user_id ||
      rawAction.expected_state_code !== 0 ||
      rawAction.expected_modified_at !== action.before.modified_at ||
      rawAction.expected_before_sha256 !== action.before.row_sha256 ||
      rawAction.expected_payload_sha256 !== action.before.payload_sha256 ||
      rawAction.plan_sha256 !== plan.plan_sha256 ||
      rawAction.operation_id !== plan.operation_id ||
      rawAction.reviewer_user_id !== value.reviewer.user_id ||
      typeof rawAction.idempotent_replay !== 'boolean'
    ) {
      throw new CliError(`Support approval does not exactly bind action ${action.action_id}.`, {
        code: 'DATASET_MAINTENANCE_SUPPORT_APPROVAL_ACTION_MISMATCH',
        exitCode: 1,
        details: { action_id: action.action_id },
      });
    }
    normalizedActions.push({
      ordinal: action.ordinal,
      action_id: action.action_id,
      action: 'publish',
      table: action.table as DatasetMaintenancePublishTable,
      id: action.id,
      version: action.version,
      reason_code: action.reason_code,
      expected_user_id: action.expected_user_id,
      expected_state_code: 0,
      expected_modified_at: action.before.modified_at,
      expected_before_sha256: action.before.row_sha256,
      expected_payload_sha256: action.before.payload_sha256,
      plan_sha256: plan.plan_sha256,
      operation_id: plan.operation_id,
      approval_audit_id: normalizeMaintenanceAuditId(
        rawAction.approval_audit_id,
        `Support approval audit id for ${action.action_id}`,
      ),
      reviewer_user_id: value.reviewer.user_id,
      idempotent_replay: rawAction.idempotent_replay,
    });
  }

  return {
    schema: DATASET_MAINTENANCE_SUPPORT_APPROVAL_SCHEMA,
    schema_version: 1,
    approved_at_utc: value.approved_at_utc,
    plan_path: value.plan_path,
    plan_sha256: plan.plan_sha256,
    task_id: plan.task_id,
    operation: 'publish-support',
    operation_id: plan.operation_id,
    target_owner: {
      user_id: plan.account.user_id,
      email: plan.account.email,
    },
    reviewer: {
      user_id: value.reviewer.user_id,
      email: value.reviewer.email,
    },
    authority: {
      source: 'public.command_audit_log',
      rpc: 'cmd_dataset_support_approve_guarded',
      local_artifact_is_authority: false,
    },
    actions: normalizedActions,
  };
}
