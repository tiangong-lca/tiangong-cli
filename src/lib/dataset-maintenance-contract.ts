import crypto from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inspectMaintenanceSupportPayload } from './dataset-maintenance-support-validation.js';
import {
  isDatasetMaintenanceSnapshotCompleteness,
  type DatasetMaintenanceSnapshotCompleteness,
} from './dataset-maintenance-pagination.js';
import { CliError } from './errors.js';

export type JsonObject = Record<string, unknown>;

export const MAINTENANCE_MUTABLE_TABLES = ['contacts', 'sources', 'flows', 'processes'] as const;

export const MAINTENANCE_SUPPORT_TABLES = ['unitgroups', 'flowproperties'] as const;

export const MAINTENANCE_SCAN_TABLES = [
  ...MAINTENANCE_MUTABLE_TABLES,
  'lifecyclemodels',
  ...MAINTENANCE_SUPPORT_TABLES,
] as const;

export type DatasetMaintenanceMutableTable = (typeof MAINTENANCE_MUTABLE_TABLES)[number];
export type DatasetMaintenanceSupportTable = (typeof MAINTENANCE_SUPPORT_TABLES)[number];
export type DatasetMaintenanceActionTable = DatasetMaintenanceMutableTable | 'flowproperties';
export type DatasetMaintenanceScanTable = (typeof MAINTENANCE_SCAN_TABLES)[number];
export type DatasetMaintenanceOperation =
  | 'delete'
  | 'retire'
  | 'redo-import'
  | 'repair-references'
  | 'merge-support-aliases'
  | 'rebuild-derivatives';
export type DatasetMaintenanceActionKind =
  'save_draft' | 'delete' | 'update_json_ordered' | 'rebuild_derivatives';
export type DatasetMaintenanceTargetMode = 'owner_draft';

export const DERIVATIVE_REBUILD_COMPONENTS = ['extracted_md', 'embedding_ft'] as const;
export type DatasetMaintenanceDerivativeComponent = (typeof DERIVATIVE_REBUILD_COMPONENTS)[number];

export type DatasetMaintenanceDerivativeSnapshot = {
  schema_version: 'dataset-derivative-snapshot.v1';
  table: 'processes';
  id: string;
  version: string;
  user_id: string;
  state_code: 0;
  modified_at: string;
  json_sha256: string;
  json_ordered_sha256: string;
  extracted_md_sha256: string | null;
  embedding_ft_sha256: string | null;
  embedding_ft_at: string | null;
  snapshot_sha256: string;
};

export type DatasetMaintenanceAliasDimension = 'time' | 'length_time';

export type DatasetMaintenanceEntityRef = {
  id: string;
  version: string;
};

export type DatasetMaintenanceAliasBatch = {
  batch_id: string;
  dimension: DatasetMaintenanceAliasDimension;
  factor: string;
  source: {
    unitgroup: DatasetMaintenanceEntityRef;
    flowproperty: DatasetMaintenanceEntityRef;
  };
  target: {
    unitgroup: DatasetMaintenanceEntityRef;
    flowproperty: DatasetMaintenanceEntityRef;
  };
};

export type DatasetMaintenanceExchangeInstance = {
  exchange_index: number;
  data_set_internal_id: string;
  flow_id: string;
  flow_version: string;
  direction: 'Input' | 'Output';
  before_exchange_sha256: string;
  before_mean_amount: string;
  before_resulting_amount: string;
};

export type DatasetMaintenanceAliasMutation =
  | { kind: 'flowproperty_unitgroup_reference' }
  | {
      kind: 'flow_flowproperty_reference';
      flow_property_internal_id: string;
      source_flowproperty_id: string;
      source_flowproperty_version: string;
    }
  | {
      kind: 'process_exchange_amounts';
      exchanges: Array<{
        index: number;
        internal_id: string;
        flow_id: string;
        flow_version: string;
        direction: 'Input' | 'Output';
        before_exchange_sha256: string;
      }>;
    };

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
  batch_id?: string;
  exchange_instances?: DatasetMaintenanceExchangeInstance[];
  desired_payload_path?: string;
  expected_before_sha256?: string;
  components?: DatasetMaintenanceDerivativeComponent[];
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
  target_mode?: DatasetMaintenanceTargetMode;
  alias_batches?: DatasetMaintenanceAliasBatch[];
  actions: DatasetMaintenanceScopeAction[];
};

export type DatasetMaintenanceRemoteRow = {
  table: DatasetMaintenanceScanTable;
  id: string;
  version: string;
  user_id: string | null;
  state_code: number | null;
  modified_at: string | null;
  json?: JsonObject | null;
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
  alias_mutation?: DatasetMaintenanceAliasMutation;
  derivative_before?: DatasetMaintenanceDerivativeSnapshot;
  rollback: {
    strategy:
      | 'save_before_snapshot'
      | 'restore_deleted_before_snapshot'
      | 'restore_atomic_alias_before_snapshot'
      | 'none_derivative_only';
    before_payload_sha256: string | null;
    before_payload: JsonObject | null;
    model_id: string | null;
    rule_verification: boolean | null;
  };
};

export type DatasetMaintenanceAliasExchangeRewrite = DatasetMaintenanceExchangeInstance & {
  action_id: string;
  process_id: string;
  process_version: string;
  after_mean_amount: string;
  after_resulting_amount: string;
  after_exchange_sha256: string;
};

export type DatasetMaintenanceAliasBatchPlan = DatasetMaintenanceAliasBatch & {
  action_ids: string[];
  target_snapshots: {
    unitgroup: DatasetMaintenanceRowSnapshot | null;
    flowproperty: DatasetMaintenanceRowSnapshot | null;
    source_unitgroup: DatasetMaintenanceRowSnapshot | null;
  };
  conversion_evidence: {
    source_unitgroup_payload_sha256: string | null;
    source_reference_unit: JsonObject | null;
    target_conversion_unit: JsonObject | null;
  };
  exchange_rewrites: DatasetMaintenanceAliasExchangeRewrite[];
  summary: {
    rows: number;
    flowproperties: number;
    flows: number;
    processes: number;
    exchanges: number;
    amount_fields: number;
    unrelated_exchanges: number;
  };
  postconditions: {
    source_unitgroup_incoming_refs: number;
    source_flowproperty_flow_refs: number;
    target_flow_refs: number;
    target_exchange_refs: number;
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
  target_mode: DatasetMaintenanceTargetMode | null;
  status: 'ready' | 'blocked';
  scope_sha256: string;
  visible_snapshot_sha256: string;
  snapshot_completeness?: DatasetMaintenanceSnapshotCompleteness<DatasetMaintenanceScanTable>;
  projected_reference_sha256: string;
  plan_sha256: string;
  summary: {
    actions: number;
    save_draft: number;
    delete: number;
    update_json_ordered?: number;
    rebuild_derivatives?: number;
    atomic_batches?: number;
    scaled_exchanges?: number;
    scaled_amount_fields?: number;
    unrelated_exchanges_preserved?: number;
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
    exchange_rewrite_plan?: string;
    derivative_baseline?: string;
  };
  actions: DatasetMaintenancePlanAction[];
  alias_batches?: DatasetMaintenanceAliasBatchPlan[];
  protected_rows: DatasetMaintenanceProtectedRow[];
  blockers: DatasetMaintenanceBlocker[];
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
    target_mode?: DatasetMaintenanceTargetMode;
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
  batch_id?: string;
  target_mode?: DatasetMaintenanceTargetMode;
  batch_request_sha256?: string;
  database_audit_id?: string;
  summary_audit_id?: string;
  plan_request_sha256?: string;
  plan_summary_audit_id?: string;
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

function parseEntityRef(value: unknown, label: string): DatasetMaintenanceEntityRef {
  if (!isJsonObject(value)) {
    throw new CliError(`Maintenance scope ${label} must be an object.`, {
      code: 'DATASET_MAINTENANCE_SCOPE_INVALID',
      exitCode: 2,
    });
  }
  return {
    id: requireToken(value.id, `${label}.id`),
    version: requireToken(value.version, `${label}.version`),
  };
}

function parseAliasBatch(value: unknown, index: number): DatasetMaintenanceAliasBatch {
  const label = `alias_batches[${index}]`;
  if (!isJsonObject(value) || !isJsonObject(value.source) || !isJsonObject(value.target)) {
    throw new CliError(`Maintenance scope ${label} must include source and target objects.`, {
      code: 'DATASET_MAINTENANCE_SCOPE_INVALID',
      exitCode: 2,
    });
  }
  const dimension = requireToken(value.dimension, `${label}.dimension`);
  const factors: Record<DatasetMaintenanceAliasDimension, string> = {
    time: '0.00011415525114155251',
    length_time: '1000',
  };
  if (!(dimension in factors)) {
    throw new CliError(`Unsupported alias-rewrite dimension: ${dimension}`, {
      code: 'DATASET_MAINTENANCE_ALIAS_DIMENSION_INVALID',
      exitCode: 2,
    });
  }
  const factor = requireToken(value.factor, `${label}.factor`);
  if (factor !== factors[dimension as DatasetMaintenanceAliasDimension]) {
    throw new CliError(`Alias-rewrite factor does not match dimension ${dimension}.`, {
      code: 'DATASET_MAINTENANCE_ALIAS_FACTOR_INVALID',
      exitCode: 2,
    });
  }
  return {
    batch_id: requireToken(value.batch_id, `${label}.batch_id`),
    dimension: dimension as DatasetMaintenanceAliasDimension,
    factor,
    source: {
      unitgroup: parseEntityRef(value.source.unitgroup, `${label}.source.unitgroup`),
      flowproperty: parseEntityRef(value.source.flowproperty, `${label}.source.flowproperty`),
    },
    target: {
      unitgroup: parseEntityRef(value.target.unitgroup, `${label}.target.unitgroup`),
      flowproperty: parseEntityRef(value.target.flowproperty, `${label}.target.flowproperty`),
    },
  };
}

function parseExchangeInstance(
  value: unknown,
  actionIndex: number,
  exchangeIndex: number,
): DatasetMaintenanceExchangeInstance {
  const label = `actions[${actionIndex}].exchange_instances[${exchangeIndex}]`;
  if (
    !isJsonObject(value) ||
    typeof value.exchange_index !== 'number' ||
    !Number.isInteger(value.exchange_index) ||
    value.exchange_index < 0
  ) {
    throw new CliError(
      `Maintenance scope ${label}.exchange_index must be a non-negative integer.`,
      {
        code: 'DATASET_MAINTENANCE_SCOPE_INVALID',
        exitCode: 2,
      },
    );
  }
  const beforeExchangeSha256 = requireToken(
    value.before_exchange_sha256,
    `${label}.before_exchange_sha256`,
  );
  if (!/^[a-f0-9]{64}$/u.test(beforeExchangeSha256)) {
    throw new CliError(`Maintenance scope ${label}.before_exchange_sha256 is invalid.`, {
      code: 'DATASET_MAINTENANCE_SCOPE_INVALID',
      exitCode: 2,
    });
  }
  const direction = requireToken(value.direction, `${label}.direction`);
  if (!['Input', 'Output'].includes(direction)) {
    throw new CliError(`Maintenance scope ${label}.direction must be Input or Output.`, {
      code: 'DATASET_MAINTENANCE_SCOPE_INVALID',
      exitCode: 2,
    });
  }
  return {
    exchange_index: value.exchange_index as number,
    data_set_internal_id: requireToken(value.data_set_internal_id, `${label}.data_set_internal_id`),
    flow_id: requireToken(value.flow_id, `${label}.flow_id`),
    flow_version: requireToken(value.flow_version, `${label}.flow_version`),
    direction: direction as 'Input' | 'Output',
    before_exchange_sha256: beforeExchangeSha256,
    before_mean_amount: requireToken(value.before_mean_amount, `${label}.before_mean_amount`),
    before_resulting_amount: requireToken(
      value.before_resulting_amount,
      `${label}.before_resulting_amount`,
    ),
  };
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
  if (!['save_draft', 'delete', 'update_json_ordered', 'rebuild_derivatives'].includes(action)) {
    throw new CliError(`Unsupported maintenance action: ${action}`, {
      code: 'DATASET_MAINTENANCE_ACTION_UNSUPPORTED',
      exitCode: 2,
    });
  }
  const aliasAction = action === 'update_json_ordered';
  const derivativeAction = action === 'rebuild_derivatives';
  const allowedTable = derivativeAction
    ? table === 'processes'
    : aliasAction
      ? ['flowproperties', 'flows', 'processes'].includes(table)
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
    (operation === 'merge-support-aliases' && !aliasAction) ||
    (operation === 'rebuild-derivatives' && !derivativeAction) ||
    (!['merge-support-aliases', 'rebuild-derivatives'].includes(operation) &&
      (aliasAction || derivativeAction))
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
  const batchId = token(value.batch_id);
  if (aliasAction !== Boolean(batchId)) {
    throw new CliError(
      aliasAction
        ? `Maintenance alias action ${index} requires batch_id.`
        : `Maintenance non-alias action ${index} cannot include batch_id.`,
      {
        code: 'DATASET_MAINTENANCE_ALIAS_BATCH_BINDING_INVALID',
        exitCode: 2,
      },
    );
  }
  const exchangeInstances = Array.isArray(value.exchange_instances)
    ? value.exchange_instances.map((entry, exchangeIndex) =>
        parseExchangeInstance(entry, index, exchangeIndex),
      )
    : [];
  if (
    aliasAction &&
    ((table === 'processes' && exchangeInstances.length === 0) ||
      (table !== 'processes' && exchangeInstances.length > 0))
  ) {
    throw new CliError(
      `Alias action ${index} exchange_instances must be non-empty only for processes.`,
      {
        code: 'DATASET_MAINTENANCE_ALIAS_EXCHANGE_SCOPE_INVALID',
        exitCode: 2,
      },
    );
  }
  if (!aliasAction && 'exchange_instances' in value) {
    throw new CliError(`Maintenance non-alias action ${index} cannot include exchange_instances.`, {
      code: 'DATASET_MAINTENANCE_ALIAS_EXCHANGE_SCOPE_INVALID',
      exitCode: 2,
    });
  }
  const components = Array.isArray(value.components)
    ? value.components.map((component, componentIndex) =>
        requireToken(component, `actions[${index}].components[${componentIndex}]`),
      )
    : [];
  if (
    derivativeAction &&
    (components.length !== DERIVATIVE_REBUILD_COMPONENTS.length ||
      components.some(
        (component, componentIndex) => component !== DERIVATIVE_REBUILD_COMPONENTS[componentIndex],
      ))
  ) {
    throw new CliError(
      `Derivative rebuild action ${index} requires components in exact order: ${DERIVATIVE_REBUILD_COMPONENTS.join(', ')}.`,
      {
        code: 'DATASET_MAINTENANCE_DERIVATIVE_COMPONENTS_INVALID',
        exitCode: 2,
      },
    );
  }
  if (!derivativeAction && 'components' in value) {
    throw new CliError(`Maintenance non-derivative action ${index} cannot include components.`, {
      code: 'DATASET_MAINTENANCE_DERIVATIVE_COMPONENTS_INVALID',
      exitCode: 2,
    });
  }
  const exchangeKeys = new Set(
    exchangeInstances.map(
      (entry) => `${entry.exchange_index}\u0000${entry.data_set_internal_id}\u0000${entry.flow_id}`,
    ),
  );
  if (exchangeKeys.size !== exchangeInstances.length) {
    throw new CliError(`Alias action ${index} contains duplicate exchange instances.`, {
      code: 'DATASET_MAINTENANCE_ALIAS_EXCHANGE_SCOPE_INVALID',
      exitCode: 2,
    });
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
    ...(batchId ? { batch_id: batchId } : {}),
    ...(exchangeInstances.length ? { exchange_instances: exchangeInstances } : {}),
    ...(desiredPayloadPath ? { desired_payload_path: desiredPayloadPath } : {}),
    ...(expectedBeforeSha256 ? { expected_before_sha256: expectedBeforeSha256 } : {}),
    ...(derivativeAction ? { components: [...DERIVATIVE_REBUILD_COMPONENTS] } : {}),
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
    ![
      'delete',
      'retire',
      'redo-import',
      'repair-references',
      'merge-support-aliases',
      'rebuild-derivatives',
    ].includes(operation)
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
  const targetMode = token(value.target_mode);
  if (
    (['merge-support-aliases', 'rebuild-derivatives'].includes(operation) &&
      targetMode !== 'owner_draft') ||
    (!['merge-support-aliases', 'rebuild-derivatives'].includes(operation) && targetMode !== null)
  ) {
    throw new CliError(
      'merge-support-aliases and rebuild-derivatives require target_mode=owner_draft; other operations forbid target_mode.',
      {
        code: 'DATASET_MAINTENANCE_TARGET_MODE_INVALID',
        exitCode: 2,
        details: { operation, target_mode: targetMode },
      },
    );
  }
  const aliasBatches = Array.isArray(value.alias_batches)
    ? value.alias_batches.map(parseAliasBatch)
    : [];
  if (
    (operation === 'merge-support-aliases' && aliasBatches.length !== 2) ||
    (operation !== 'merge-support-aliases' && aliasBatches.length !== 0)
  ) {
    throw new CliError(
      'merge-support-aliases requires exactly two alias_batches; other operations forbid them.',
      {
        code: 'DATASET_MAINTENANCE_ALIAS_BATCH_SCOPE_INVALID',
        exitCode: 2,
      },
    );
  }
  if (operation === 'rebuild-derivatives' && actions.length !== 1) {
    throw new CliError('rebuild-derivatives requires exactly one action.', {
      code: 'DATASET_MAINTENANCE_DERIVATIVE_ACTION_COUNT_INVALID',
      exitCode: 2,
    });
  }
  if (aliasBatches.length) {
    const batchIds = new Set(aliasBatches.map((batch) => batch.batch_id));
    const dimensions = new Set(aliasBatches.map((batch) => batch.dimension));
    if (
      batchIds.size !== 2 ||
      dimensions.size !== 2 ||
      !dimensions.has('time') ||
      !dimensions.has('length_time') ||
      actions.some((action) => !action.batch_id || !batchIds.has(action.batch_id))
    ) {
      throw new CliError(
        'Alias batches and action batch_id bindings are incomplete or duplicate.',
        {
          code: 'DATASET_MAINTENANCE_ALIAS_BATCH_SCOPE_INVALID',
          exitCode: 2,
        },
      );
    }
  }
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
    ...(targetMode === 'owner_draft' ? { target_mode: targetMode } : {}),
    ...(aliasBatches.length ? { alias_batches: aliasBatches } : {}),
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

function validDerivativeSnapshot(
  value: unknown,
  action: DatasetMaintenancePlanAction,
): value is DatasetMaintenanceDerivativeSnapshot {
  if (!isJsonObject(value)) return false;
  const requiredHashes = [value.json_sha256, value.json_ordered_sha256, value.snapshot_sha256];
  const nullableHashes = [value.extracted_md_sha256, value.embedding_ft_sha256];
  return Boolean(
    value.schema_version === 'dataset-derivative-snapshot.v1' &&
    value.table === 'processes' &&
    value.id === action.id &&
    value.version === action.version &&
    value.user_id === action.expected_user_id &&
    value.state_code === 0 &&
    value.modified_at === action.before?.modified_at &&
    typeof value.modified_at === 'string' &&
    Number.isFinite(Date.parse(value.modified_at)) &&
    requiredHashes.every((hash) => typeof hash === 'string' && /^[a-f0-9]{64}$/u.test(hash)) &&
    nullableHashes.every(
      (hash) => hash === null || (typeof hash === 'string' && /^[a-f0-9]{64}$/u.test(hash)),
    ) &&
    value.json_sha256 === value.json_ordered_sha256 &&
    (value.embedding_ft_at === null ||
      (typeof value.embedding_ft_at === 'string' &&
        Number.isFinite(Date.parse(value.embedding_ft_at)))),
  );
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
  if (
    plan.snapshot_completeness !== undefined &&
    !isDatasetMaintenanceSnapshotCompleteness(plan.snapshot_completeness, MAINTENANCE_SCAN_TABLES)
  ) {
    throw new CliError('Maintenance plan snapshot completeness proof is invalid.', {
      code: 'DATASET_MAINTENANCE_PLAN_INVALID',
      exitCode: 2,
    });
  }
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
      ...(plan.target_mode ? { target_mode: plan.target_mode } : {}),
      ...(plan.alias_batches
        ? {
            alias_batches: plan.alias_batches.map((batch) => ({
              batch_id: batch.batch_id,
              dimension: batch.dimension,
              factor: batch.factor,
              source: batch.source,
              target: batch.target,
            })),
          }
        : {}),
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
      if (action.action === 'update_json_ordered' && !before.modified_at) {
        throw new CliError('Ready alias action requires a frozen modified_at value.', {
          code: 'DATASET_MAINTENANCE_PLAN_INVALID',
          exitCode: 2,
          details: { action_id: action.action_id },
        });
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
            : action.action === 'update_json_ordered'
              ? 'restore_atomic_alias_before_snapshot'
              : 'none_derivative_only';
      const derivativeRollback = action.action === 'rebuild_derivatives';
      const rollbackMatches = derivativeRollback
        ? action.rollback.strategy === expectedRollbackStrategy &&
          action.rollback.before_payload_sha256 === null &&
          action.rollback.before_payload === null &&
          action.rollback.model_id === null &&
          action.rollback.rule_verification === null
        : action.rollback.strategy === expectedRollbackStrategy &&
          action.rollback.before_payload_sha256 === before.payload_sha256 &&
          isJsonObject(action.rollback.before_payload) &&
          sha256Json(action.rollback.before_payload) === before.payload_sha256 &&
          action.rollback.model_id === before.model_id &&
          action.rollback.rule_verification === before.rule_verification;
      if (!rollbackMatches) {
        throw new CliError('Ready maintenance plan action rollback snapshot is invalid.', {
          code: 'DATASET_MAINTENANCE_PLAN_INVALID',
          exitCode: 2,
          details: { action_id: action.action_id },
        });
      }
    }
    if (
      (['save_draft', 'update_json_ordered'].includes(action.action) &&
        action.status === 'ready' &&
        (!isJsonObject(action.desired_payload) ||
          typeof action.desired_payload.path !== 'string' ||
          !/^[a-f0-9]{64}$/u.test(String(action.desired_payload.sha256)))) ||
      (!['save_draft', 'update_json_ordered'].includes(action.action) &&
        action.desired_payload !== null)
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
    (plan.summary.update_json_ordered ?? 0) ===
      plan.actions.filter((action) => action.action === 'update_json_ordered').length &&
    (plan.summary.rebuild_derivatives ?? 0) ===
      plan.actions.filter((action) => action.action === 'rebuild_derivatives').length &&
    (plan.summary.atomic_batches ?? 0) === (plan.alias_batches?.length ?? 0) &&
    (plan.summary.scaled_exchanges ?? 0) ===
      (plan.alias_batches?.reduce((sum, batch) => sum + batch.summary.exchanges, 0) ?? 0) &&
    (plan.summary.scaled_amount_fields ?? 0) ===
      (plan.alias_batches?.reduce((sum, batch) => sum + batch.summary.amount_fields, 0) ?? 0) &&
    (plan.summary.unrelated_exchanges_preserved ?? 0) ===
      (plan.alias_batches?.reduce((sum, batch) => sum + batch.summary.unrelated_exchanges, 0) ??
        0) &&
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
  if (plan.operation === 'merge-support-aliases') {
    const batches = plan.alias_batches!;
    const batchActionIds = new Set(batches.flatMap((batch) => batch.action_ids));
    const expectedProfiles = {
      time: {
        factor: '0.00011415525114155251',
        rows: 25,
        flowproperties: 1,
        flows: 10,
        processes: 14,
        exchanges: 20,
      },
      length_time: {
        factor: '1000',
        rows: 27,
        flowproperties: 1,
        flows: 13,
        processes: 13,
        exchanges: 39,
      },
    } as const;
    const validAliasPlan =
      plan.target_mode === 'owner_draft' &&
      batches.length === 2 &&
      plan.artifacts.exchange_rewrite_plan === 'exchange-rewrite-plan.jsonl' &&
      batchActionIds.size === plan.actions.length &&
      batches.reduce((sum, batch) => sum + batch.action_ids.length, 0) === plan.actions.length &&
      batches.reduce((sum, batch) => sum + batch.summary.unrelated_exchanges, 0) === 309 &&
      plan.actions.every(
        (action) =>
          action.action === 'update_json_ordered' &&
          action.batch_id &&
          isJsonObject(action.alias_mutation) &&
          batches.some(
            (batch) =>
              batch.batch_id === action.batch_id && batch.action_ids.includes(action.action_id),
          ),
      ) &&
      batches.every((batch) => {
        const profile = expectedProfiles[batch.dimension];
        const actions = plan.actions.filter((action) => action.batch_id === batch.batch_id);
        const counts = {
          flowproperties: actions.filter((action) => action.table === 'flowproperties').length,
          flows: actions.filter((action) => action.table === 'flows').length,
          processes: actions.filter((action) => action.table === 'processes').length,
        };
        const targetSnapshots = [
          batch.target_snapshots.unitgroup,
          batch.target_snapshots.flowproperty,
        ];
        const sourceSnapshot = batch.target_snapshots.source_unitgroup;
        const supportPayloadsValid = (
          [
            {
              snapshot: batch.target_snapshots.unitgroup,
              table: 'unitgroups' as const,
              id: batch.target.unitgroup.id,
              version: batch.target.unitgroup.version,
            },
            {
              snapshot: batch.target_snapshots.flowproperty,
              table: 'flowproperties' as const,
              id: batch.target.flowproperty.id,
              version: batch.target.flowproperty.version,
            },
            {
              snapshot: sourceSnapshot,
              table: 'unitgroups' as const,
              id: batch.source.unitgroup.id,
              version: batch.source.unitgroup.version,
            },
          ] as const
        ).every((entry) => {
          if (!entry.snapshot?.json_ordered) return plan.status === 'blocked';
          const inspection = inspectMaintenanceSupportPayload({
            table: entry.table,
            payload: entry.snapshot.json_ordered,
          });
          return (
            inspection.identity.id === entry.id && inspection.identity.version === entry.version
          );
        });
        const snapshotsValid = (snapshots: DatasetMaintenanceRowSnapshot[]): boolean =>
          snapshots.every((snapshot) => {
            const remoteRow: DatasetMaintenanceRemoteRow = {
              table: snapshot.table,
              id: snapshot.id,
              version: snapshot.version,
              user_id: snapshot.user_id,
              state_code: snapshot.state_code,
              modified_at: snapshot.modified_at,
              json_ordered: snapshot.json_ordered,
              model_id: snapshot.model_id,
              rule_verification: snapshot.rule_verification,
            };
            const expectedSnapshot = snapshotRemoteRow(remoteRow);
            return (
              snapshot.row_sha256 === expectedSnapshot.row_sha256 &&
              snapshot.payload_sha256 === expectedSnapshot.payload_sha256
            );
          });
        const snapshotIdentityMatches = Boolean(
          batch.target_snapshots.unitgroup?.table === 'unitgroups' &&
          batch.target_snapshots.unitgroup.id === batch.target.unitgroup.id &&
          batch.target_snapshots.unitgroup.version === batch.target.unitgroup.version &&
          batch.target_snapshots.flowproperty?.table === 'flowproperties' &&
          batch.target_snapshots.flowproperty.id === batch.target.flowproperty.id &&
          batch.target_snapshots.flowproperty.version === batch.target.flowproperty.version &&
          sourceSnapshot?.table === 'unitgroups' &&
          sourceSnapshot.id === batch.source.unitgroup.id &&
          sourceSnapshot.version === batch.source.unitgroup.version,
        );
        const mutationsValid = actions.every((action) => {
          const mutation = action.alias_mutation!;
          if (action.table === 'flowproperties') {
            return (
              mutation.kind === 'flowproperty_unitgroup_reference' &&
              action.id === batch.source.flowproperty.id &&
              action.version === batch.source.flowproperty.version
            );
          }
          if (action.table === 'flows') {
            return (
              mutation.kind === 'flow_flowproperty_reference' &&
              mutation.flow_property_internal_id === '1' &&
              mutation.source_flowproperty_id === batch.source.flowproperty.id &&
              mutation.source_flowproperty_version === batch.source.flowproperty.version
            );
          }
          return (
            mutation.kind === 'process_exchange_amounts' &&
            sha256Json(mutation.exchanges) ===
              sha256Json(
                action.exchange_instances!.map((instance) => ({
                  index: instance.exchange_index,
                  internal_id: instance.data_set_internal_id,
                  flow_id: instance.flow_id,
                  flow_version: instance.flow_version,
                  direction: instance.direction,
                  before_exchange_sha256: instance.before_exchange_sha256,
                })),
              )
          );
        });
        const exchangeRewritesValid = batch.exchange_rewrites.every((rewrite) => {
          const action = actions.find((entry) => entry.action_id === rewrite.action_id);
          const instance = action?.exchange_instances?.find(
            (entry) =>
              entry.exchange_index === rewrite.exchange_index &&
              entry.data_set_internal_id === rewrite.data_set_internal_id &&
              entry.flow_id === rewrite.flow_id &&
              entry.flow_version === rewrite.flow_version,
          );
          return Boolean(
            action?.table === 'processes' &&
            instance &&
            rewrite.process_id === action.id &&
            rewrite.process_version === action.version &&
            rewrite.direction === instance.direction &&
            rewrite.before_exchange_sha256 === instance.before_exchange_sha256 &&
            /^[a-f0-9]{64}$/u.test(rewrite.after_exchange_sha256),
          );
        });
        return (
          profile !== undefined &&
          batch.factor === profile.factor &&
          batch.summary.rows === profile.rows &&
          counts.flowproperties === profile.flowproperties &&
          counts.flows === profile.flows &&
          counts.processes === profile.processes &&
          batch.summary.flowproperties === counts.flowproperties &&
          batch.summary.flows === counts.flows &&
          batch.summary.processes === counts.processes &&
          batch.summary.exchanges === profile.exchanges &&
          batch.postconditions.source_unitgroup_incoming_refs === 0 &&
          batch.postconditions.source_flowproperty_flow_refs === 0 &&
          batch.postconditions.target_flow_refs === (batch.dimension === 'time' ? 106 : 32) &&
          batch.postconditions.target_exchange_refs === (batch.dimension === 'time' ? 441 : 3216) &&
          batch.summary.rows === batch.action_ids.length &&
          batch.summary.amount_fields === batch.summary.exchanges * 2 &&
          batch.exchange_rewrites.length === batch.summary.exchanges &&
          snapshotIdentityMatches &&
          supportPayloadsValid &&
          mutationsValid &&
          exchangeRewritesValid &&
          (plan.status === 'blocked' ||
            (targetSnapshots.every(
              (snapshot) =>
                snapshot?.state_code === 0 &&
                snapshot.user_id === plan.account.user_id &&
                Boolean(snapshot.modified_at),
            ) &&
              sourceSnapshot?.state_code === 0 &&
              Boolean(sourceSnapshot.modified_at) &&
              sourceSnapshot.user_id === plan.account.user_id &&
              snapshotsValid([
                ...(targetSnapshots.filter(Boolean) as DatasetMaintenanceRowSnapshot[]),
                sourceSnapshot,
              ]) &&
              batch.conversion_evidence.source_unitgroup_payload_sha256 ===
                sourceSnapshot.payload_sha256 &&
              isJsonObject(batch.conversion_evidence.source_reference_unit) &&
              isJsonObject(batch.conversion_evidence.target_conversion_unit)))
        );
      });
    if (!validAliasPlan) {
      throw new CliError('Maintenance alias plan contract is inconsistent.', {
        code: 'DATASET_MAINTENANCE_PLAN_INVALID',
        exitCode: 2,
      });
    }
  }
  if (plan.operation === 'rebuild-derivatives') {
    const action = plan.actions[0];
    const validDerivativePlan = Boolean(
      plan.target_mode === 'owner_draft' &&
      plan.actions.length === 1 &&
      !plan.alias_batches &&
      plan.artifacts.derivative_baseline === 'derivative-baseline.json' &&
      action?.action === 'rebuild_derivatives' &&
      action.table === 'processes' &&
      sha256Json(action.components) === sha256Json(DERIVATIVE_REBUILD_COMPONENTS) &&
      action.desired_payload === null &&
      action.rollback.strategy === 'none_derivative_only' &&
      (action.status === 'blocked' || validDerivativeSnapshot(action.derivative_before, action)),
    );
    if (!validDerivativePlan) {
      throw new CliError('Maintenance derivative rebuild plan contract is inconsistent.', {
        code: 'DATASET_MAINTENANCE_PLAN_INVALID',
        exitCode: 2,
      });
    }
  } else if (
    plan.actions.some((action) => action.derivative_before !== undefined) ||
    plan.artifacts.derivative_baseline !== undefined
  ) {
    throw new CliError('Non-derivative maintenance plan contains derivative-only fields.', {
      code: 'DATASET_MAINTENANCE_PLAN_INVALID',
      exitCode: 2,
    });
  }
  return plan;
}
