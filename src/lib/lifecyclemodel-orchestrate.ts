import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readJsonArtifact, writeJsonArtifact } from './artifacts.js';
import { CliError } from './errors.js';
import type { FetchLike } from './http.js';
import { readJsonInput } from './io.js';
import {
  runLifecyclemodelAutoBuild,
  type LifecyclemodelAutoBuildReport,
} from './lifecyclemodel-auto-build.js';
import {
  runLifecyclemodelBuildResultingProcess,
  type LifecyclemodelResultingProcessReport,
} from './lifecyclemodel-resulting-process.js';
import { runProcessAutoBuild, type ProcessAutoBuildReport } from './process-auto-build.js';

type JsonRecord = Record<string, unknown>;

type OrchestrateAction = 'plan' | 'execute' | 'publish';
type NodeKind = 'reference_flow' | 'process' | 'lifecyclemodel' | 'resulting_process' | 'subsystem';
type RequestedAction =
  | 'auto'
  | 'reuse_existing_resulting_process'
  | 'reuse_existing_process'
  | 'reuse_existing_model'
  | 'build_process'
  | 'build_submodel'
  | 'cutoff'
  | 'unresolved';
type Resolution =
  | 'unresolved'
  | 'cutoff'
  | 'reused_existing_resulting_process'
  | 'reused_existing_process'
  | 'reused_existing_model'
  | 'build_via_process_automated_builder'
  | 'build_via_lifecyclemodel_automated_builder';
type InvocationKind = 'process_builder' | 'lifecyclemodel_builder' | 'projector';
type InvocationStatus =
  | 'success'
  | 'failed'
  | 'skipped_due_to_fail_fast'
  | 'skipped_due_to_dependency_failed'
  | 'skipped_due_to_dependency_skipped_due_to_fail_fast'
  | 'skipped_due_to_dependency_skipped_due_to_dependency_failed';

type Candidate = JsonRecord & {
  id: string;
  score: number;
};

type ProcessBuilderConfig = {
  mode: 'workflow' | 'langgraph';
  flow_file: string | null;
  flow_json: unknown;
  run_id: string | null;
  python_bin: string | null;
  publish: boolean;
  commit: boolean;
  forward_args: string[];
};

type SubmodelBuilderConfig = {
  manifest: string | null;
  out_dir: string | null;
  dry_run: boolean;
};

type ProjectorConfig = {
  command: 'prepare' | 'build' | 'project';
  request: string | null;
  model_file: string | null;
  out_dir: string | null;
  projection_role: 'primary' | 'all';
  run_always: boolean;
  publish_processes: boolean;
  publish_relations: boolean;
};

type OrchestrateNode = {
  node_id: string;
  kind: NodeKind;
  label: string;
  entity: JsonRecord;
  requested_action: RequestedAction;
  depends_on: string[];
  parent_node_id: string | null;
  existing_resulting_process_candidates: Candidate[];
  existing_process_candidates: Candidate[];
  existing_lifecyclemodel_candidates: Candidate[];
  process_builder?: ProcessBuilderConfig;
  submodel_builder?: SubmodelBuilderConfig;
  projector?: ProjectorConfig;
  resolution?: Resolution;
  resolution_reason?: string;
  selected_candidate?: Candidate | null;
  boundary_reason?: string | null;
  planned_invocations: string[];
};

type PlanInvocation = {
  invocation_id: string;
  node_id: string;
  kind: InvocationKind;
  config: JsonRecord;
  artifact_dir: string;
  depends_on_invocation_id?: string;
  last_status?: InvocationStatus;
  last_exit_code?: number | null;
  last_result_file?: string | null;
  artifacts?: JsonRecord;
};

type NormalizedPublishConfig = {
  intent: 'dry_run' | 'prepare_only' | 'publish';
  prepare_lifecyclemodel_payload: boolean;
  prepare_resulting_process_payload: boolean;
  prepare_relation_payload: boolean;
};

type ExecutionSummary = {
  executed_at: string;
  successful_invocations: number;
  failed_invocations: number;
  blocked_invocations: number;
  status: 'completed' | 'failed';
};

type AssemblyPlan = {
  skill: 'lifecyclemodel-recursive-orchestrator';
  request_id: string;
  created_at: string;
  request_file: string;
  goal: JsonRecord;
  root: JsonRecord;
  orchestration: JsonRecord;
  candidate_sources: JsonRecord;
  publish: NormalizedPublishConfig;
  notes: string[];
  nodes: OrchestrateNode[];
  edges: Array<{ from: string; to: string; relation: string }>;
  invocations: PlanInvocation[];
  planner_summary: {
    status: 'planned' | 'executed';
    message: string;
  };
  warnings: string[];
  unresolved: Array<{ node_id: string; label: string; reason: string }>;
  boundaries: Array<{ node_id: string; reason: string }>;
  artifacts: {
    root: string;
    request_normalized: string;
    assembly_plan: string;
    graph_manifest: string;
    lineage_manifest: string;
    boundary_report: string;
    invocations_dir: string;
    publish_bundle: string;
    publish_summary: string;
  };
  summary: {
    node_count: number;
    edge_count: number;
    invocation_count: number;
    unresolved_count: number;
  };
  execution_summary?: ExecutionSummary;
};

type InvocationExecutionResult = {
  invocation_id: string;
  node_id: string;
  kind: InvocationKind;
  status: InvocationStatus;
  exit_code: number | null;
  result_file: string;
  planned_artifacts?: JsonRecord;
  artifacts?: JsonRecord;
  error?: string;
  dry_run?: boolean;
};

type GraphManifest = {
  root: JsonRecord;
  nodes: JsonRecord[];
  edges: JsonRecord[];
  boundaries: JsonRecord[];
  unresolved: JsonRecord[];
  stats: JsonRecord;
};

type LineageManifest = {
  root_request: JsonRecord;
  builder_invocations: JsonRecord[];
  node_resolution_log: JsonRecord[];
  published_dependencies: JsonRecord[];
  resulting_process_relations: JsonRecord[];
  unresolved_history: JsonRecord[];
};

export type LifecyclemodelOrchestratePlanReport = {
  schema_version: 1;
  generated_at_utc: string;
  action: 'plan';
  status: 'planned';
  request_id: string;
  out_dir: string;
  counts: {
    nodes: number;
    edges: number;
    invocations: number;
    unresolved: number;
  };
  files: {
    request_normalized: string;
    assembly_plan: string;
    graph_manifest: string;
    lineage_manifest: string;
    boundary_report: string;
  };
  warnings: string[];
};

export type LifecyclemodelOrchestrateExecuteReport = {
  schema_version: 1;
  generated_at_utc: string;
  action: 'execute';
  status: 'completed' | 'failed';
  request_id: string;
  out_dir: string;
  execution: {
    successful_invocations: number;
    failed_invocations: number;
    blocked_invocations: number;
  };
  files: {
    request_normalized: string;
    assembly_plan: string;
    graph_manifest: string;
    lineage_manifest: string;
    boundary_report: string;
    invocations_dir: string;
  };
  warnings: string[];
};

export type LifecyclemodelOrchestratePublishReport = {
  schema_version: 1;
  generated_at_utc: string;
  action: 'publish';
  status: 'prepared_local_publish_bundle';
  request_id: string;
  run_dir: string;
  counts: {
    lifecyclemodels: number;
    projected_processes: number;
    resulting_process_relations: number;
    process_build_runs: number;
  };
  files: {
    assembly_plan: string;
    graph_manifest: string;
    lineage_manifest: string;
    publish_bundle: string;
    publish_summary: string;
  };
};

export type LifecyclemodelOrchestrateReport =
  | LifecyclemodelOrchestratePlanReport
  | LifecyclemodelOrchestrateExecuteReport
  | LifecyclemodelOrchestratePublishReport;

export type RunLifecyclemodelOrchestrateOptions = {
  action: OrchestrateAction;
  inputPath?: string;
  outDir?: string | null;
  runDir?: string;
  allowProcessBuild?: boolean;
  allowSubmodelBuild?: boolean;
  publishLifecyclemodels?: boolean;
  publishResultingProcessRelations?: boolean;
  now?: Date;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function copyJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function ensureList<T = unknown>(value: unknown): T[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? (value as T[]) : ([value] as T[]);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function firstNonEmpty(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = nonEmptyString(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function invariant<T>(value: T | null | undefined, message: string, details?: JsonRecord): T {
  if (value === undefined || value === null) {
    throw new CliError(message, {
      code: 'LIFECYCLEMODEL_ORCHESTRATE_INTERNAL_STATE',
      exitCode: 1,
      details,
    });
  }

  return value;
}

function safeSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return slug || 'item';
}

function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

function requireObject(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) {
    throw new CliError(`${label} must be a JSON object.`, {
      code: 'LIFECYCLEMODEL_ORCHESTRATE_INVALID_REQUEST',
      exitCode: 2,
      details: { label },
    });
  }

  return value;
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  const normalized = nonEmptyString(value);
  if (!normalized || !allowed.includes(normalized as T)) {
    throw new CliError(`${label} must be one of ${allowed.join(', ')}.`, {
      code: 'LIFECYCLEMODEL_ORCHESTRATE_INVALID_REQUEST',
      exitCode: 2,
      details: { label, value, allowed },
    });
  }

  return normalized as T;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new CliError(`${label} must be a boolean.`, {
      code: 'LIFECYCLEMODEL_ORCHESTRATE_INVALID_REQUEST',
      exitCode: 2,
      details: { label, value },
    });
  }

  return value;
}

function requireInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new CliError(`${label} must be a non-negative integer.`, {
      code: 'LIFECYCLEMODEL_ORCHESTRATE_INVALID_REQUEST',
      exitCode: 2,
      details: { label, value },
    });
  }

  return value;
}

function resolveInputPath(baseDir: string, raw: unknown): string | null {
  const normalized = nonEmptyString(raw);
  if (!normalized) {
    return null;
  }

  if (normalized.includes('://') || normalized.startsWith('file:')) {
    return normalized;
  }

  return path.resolve(baseDir, normalized);
}

function defaultCandidateSources(): JsonRecord {
  return {
    my_processes: true,
    team_processes: true,
    public_processes: true,
    existing_lifecyclemodels: true,
    existing_resulting_processes: true,
  };
}

function entityFromRoot(root: JsonRecord): JsonRecord {
  const kind = root.kind;
  if (kind === 'reference_flow') {
    return isRecord(root.flow) ? copyJson(root.flow) : {};
  }
  if (kind === 'process') {
    return isRecord(root.process) ? copyJson(root.process) : {};
  }
  if (kind === 'lifecyclemodel') {
    return isRecord(root.lifecyclemodel) ? copyJson(root.lifecyclemodel) : {};
  }
  if (kind === 'resulting_process') {
    return isRecord(root.resulting_process) ? copyJson(root.resulting_process) : {};
  }

  return {};
}

function normalizePublishConfig(publish: JsonRecord): NormalizedPublishConfig {
  return {
    intent: requireEnum(publish.intent, ['dry_run', 'prepare_only', 'publish'], 'publish.intent'),
    prepare_lifecyclemodel_payload: publish.prepare_lifecyclemodel_payload !== false,
    prepare_resulting_process_payload: publish.prepare_resulting_process_payload !== false,
    prepare_relation_payload: publish.prepare_relation_payload !== false,
  };
}

function serializeInvocationConfig(
  value: ProcessBuilderConfig | SubmodelBuilderConfig | ProjectorConfig | undefined,
  message: string,
  details?: JsonRecord,
): JsonRecord {
  return copyJson(invariant(value, message, details)) as JsonRecord;
}

function normalizeInvocationFailure(error: unknown): {
  exit_code: number;
  error: string;
} {
  return {
    exit_code: error instanceof CliError ? error.exitCode : 1,
    error: error instanceof Error ? error.message : String(error),
  };
}

function normalizeCandidate(raw: unknown): Candidate {
  if (typeof raw === 'string') {
    return { id: raw, score: 1 };
  }

  if (!isRecord(raw)) {
    throw new CliError('candidate must be an object or string.', {
      code: 'LIFECYCLEMODEL_ORCHESTRATE_INVALID_REQUEST',
      exitCode: 2,
      details: { value: raw },
    });
  }

  const id = nonEmptyString(raw.id);
  if (!id) {
    throw new CliError('candidate.id is required.', {
      code: 'LIFECYCLEMODEL_ORCHESTRATE_INVALID_REQUEST',
      exitCode: 2,
      details: { candidate: raw },
    });
  }

  const score =
    typeof raw.score === 'number' && Number.isFinite(raw.score) && raw.score >= 0 ? raw.score : 1;
  return {
    ...copyJson(raw),
    id,
    score,
  };
}

function normalizeCandidateList(value: unknown): Candidate[] {
  return ensureList(value)
    .map((entry) => normalizeCandidate(entry))
    .sort((left, right) => right.score - left.score);
}

function normalizeRequestedAction(value: unknown): RequestedAction {
  return requireEnum(
    value ?? 'auto',
    [
      'auto',
      'reuse_existing_resulting_process',
      'reuse_existing_process',
      'reuse_existing_model',
      'build_process',
      'build_submodel',
      'cutoff',
      'unresolved',
    ],
    'requested_action',
  );
}

function normalizeDependsOn(value: unknown): string[] {
  return ensureList(value)
    .map((entry) => nonEmptyString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function normalizeProcessBuilderConfig(
  value: unknown,
  baseDir: string,
): ProcessBuilderConfig | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    mode: requireEnum(value.mode ?? 'workflow', ['workflow', 'langgraph'], 'process_builder.mode'),
    flow_file: resolveInputPath(baseDir, value.flow_file),
    flow_json: value.flow_json,
    run_id: nonEmptyString(value.run_id),
    python_bin: nonEmptyString(value.python_bin),
    publish: Boolean(value.publish),
    commit: Boolean(value.commit),
    forward_args: ensureList(value.forward_args)
      .map((entry) => nonEmptyString(entry))
      .filter((entry): entry is string => Boolean(entry)),
  };
}

function normalizeSubmodelBuilderConfig(
  value: unknown,
  baseDir: string,
): SubmodelBuilderConfig | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    manifest: resolveInputPath(baseDir, value.manifest),
    out_dir: resolveInputPath(baseDir, value.out_dir),
    dry_run: Boolean(value.dry_run),
  };
}

function normalizeProjectorConfig(value: unknown, baseDir: string): ProjectorConfig | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    command: requireEnum(
      value.command ?? 'project',
      ['prepare', 'build', 'project'],
      'projector.command',
    ),
    request: resolveInputPath(baseDir, value.request),
    model_file: resolveInputPath(baseDir, value.model_file),
    out_dir: resolveInputPath(baseDir, value.out_dir),
    projection_role: requireEnum(
      value.projection_role ?? 'primary',
      ['primary', 'all'],
      'projector.projection_role',
    ),
    run_always: Boolean(value.run_always),
    publish_processes: Boolean(value.publish_processes),
    publish_relations: Boolean(value.publish_relations),
  };
}

function normalizeNode(rawNode: JsonRecord, index: number, baseDir: string): OrchestrateNode {
  const nodeId = invariant(
    firstNonEmpty(rawNode.node_id, rawNode.id, `node-${index}`),
    `Node ${index} id normalization failed unexpectedly.`,
  );
  const kind = requireEnum(
    rawNode.kind ?? 'process',
    ['reference_flow', 'process', 'lifecyclemodel', 'resulting_process', 'subsystem'],
    'node.kind',
  );
  let entity = isRecord(rawNode.entity) ? copyJson(rawNode.entity) : {};
  if (Object.keys(entity).length === 0) {
    for (const key of ['flow', 'process', 'lifecyclemodel', 'resulting_process'] as const) {
      if (isRecord(rawNode[key])) {
        entity = copyJson(rawNode[key] as JsonRecord);
        break;
      }
    }
  }

  const label = invariant(
    firstNonEmpty(rawNode.label, entity.name, nodeId),
    `Node ${nodeId} label normalization failed unexpectedly.`,
  );
  const parentNodeId = firstNonEmpty(rawNode.parent_node_id);
  const dependsOn = normalizeDependsOn(rawNode.depends_on);
  if (parentNodeId) {
    dependsOn.push(parentNodeId);
  }

  return {
    node_id: nodeId,
    kind,
    label,
    entity,
    requested_action: normalizeRequestedAction(rawNode.requested_action ?? 'auto'),
    depends_on: [...new Set(dependsOn)].sort(),
    parent_node_id: parentNodeId,
    existing_resulting_process_candidates: normalizeCandidateList(
      rawNode.existing_resulting_process_candidates,
    ),
    existing_process_candidates: normalizeCandidateList(rawNode.existing_process_candidates),
    existing_lifecyclemodel_candidates: normalizeCandidateList(
      rawNode.existing_lifecyclemodel_candidates,
    ),
    process_builder: normalizeProcessBuilderConfig(rawNode.process_builder, baseDir),
    submodel_builder: normalizeSubmodelBuilderConfig(rawNode.submodel_builder, baseDir),
    projector: normalizeProjectorConfig(rawNode.projector, baseDir),
    planned_invocations: [],
  };
}

function deriveRootNode(root: JsonRecord, goal: JsonRecord, baseDir: string): OrchestrateNode {
  const entity = entityFromRoot(root);
  const label = invariant(
    firstNonEmpty(entity.name, goal.name, root.kind, 'root'),
    'Root label normalization failed unexpectedly.',
  );
  const rootNode: JsonRecord = {
    node_id: invariant(
      firstNonEmpty(root.node_id, entity.id, 'root'),
      'Root node_id normalization failed unexpectedly.',
    ),
    kind: root.kind,
    label,
    entity,
    requested_action: root.requested_action ?? 'auto',
    depends_on: root.depends_on ?? [],
    parent_node_id: root.parent_node_id,
    existing_resulting_process_candidates: root.existing_resulting_process_candidates ?? [],
    existing_process_candidates: root.existing_process_candidates ?? [],
    existing_lifecyclemodel_candidates: root.existing_lifecyclemodel_candidates ?? [],
    process_builder: root.process_builder,
    submodel_builder: root.submodel_builder,
    projector: root.projector,
  };
  return normalizeNode(rootNode, 0, baseDir);
}

function buildEdges(
  requestEdges: unknown[],
  nodes: OrchestrateNode[],
): Array<{ from: string; to: string; relation: string }> {
  const edges: Array<{ from: string; to: string; relation: string }> = [];
  const seen = new Set<string>();

  ensureList(requestEdges).forEach((raw) => {
    if (!isRecord(raw)) {
      return;
    }

    const from = nonEmptyString(raw.from);
    const to = nonEmptyString(raw.to);
    const relation = invariant(
      firstNonEmpty(raw.relation, 'depends_on'),
      'Edge relation normalization failed unexpectedly.',
    );
    if (!from || !to) {
      return;
    }

    const key = `${from}::${to}::${relation}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    edges.push({ from, to, relation });
  });

  nodes.forEach((node) => {
    node.depends_on.forEach((dependency) => {
      const key = `${node.node_id}::${dependency}::depends_on`;
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      edges.push({
        from: node.node_id,
        to: dependency,
        relation: 'depends_on',
      });
    });
  });

  return edges;
}

function topoSortNodes(nodes: OrchestrateNode[]): {
  ordered: OrchestrateNode[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const order = new Map(nodes.map((node, index) => [node.node_id, index]));
  const nodeMap = new Map(nodes.map((node) => [node.node_id, node]));
  const indegree = new Map(nodes.map((node) => [node.node_id, 0]));
  const adjacency = new Map(nodes.map((node) => [node.node_id, [] as string[]]));

  nodes.forEach((node) => {
    node.depends_on.forEach((dependency) => {
      if (!nodeMap.has(dependency)) {
        warnings.push(
          `Node ${node.node_id} depends on unknown node ${dependency}; keeping it as metadata only.`,
        );
        return;
      }

      indegree.set(
        node.node_id,
        invariant(indegree.get(node.node_id), `Missing indegree entry for ${node.node_id}.`, {
          node_id: node.node_id,
          dependency,
        }) + 1,
      );
      invariant(adjacency.get(dependency), `Missing adjacency list for ${dependency}.`, {
        node_id: node.node_id,
        dependency,
      }).push(node.node_id);
    });
  });

  const queue = nodes
    .filter(
      (node) =>
        invariant(indegree.get(node.node_id), `Missing indegree entry for ${node.node_id}.`) === 0,
    )
    .sort(
      (left, right) =>
        invariant(order.get(left.node_id), `Missing order index for ${left.node_id}.`) -
        invariant(order.get(right.node_id), `Missing order index for ${right.node_id}.`),
    )
    .map((node) => node.node_id);
  const ordered: OrchestrateNode[] = [];

  while (queue.length > 0) {
    const nodeId = invariant(queue.shift(), 'Queue unexpectedly emptied during topological sort.');
    ordered.push(invariant(nodeMap.get(nodeId), `Missing node definition for ${nodeId}.`));
    const downstream = invariant(
      adjacency.get(nodeId),
      `Missing adjacency list for ${nodeId}.`,
    ).sort(
      (left, right) =>
        invariant(order.get(left), `Missing order index for ${left}.`) -
        invariant(order.get(right), `Missing order index for ${right}.`),
    );
    downstream.forEach((item) => {
      const nextIndegree = invariant(indegree.get(item), `Missing indegree entry for ${item}.`) - 1;
      indegree.set(item, nextIndegree);
      if (nextIndegree === 0) {
        queue.push(item);
      }
    });
  }

  if (ordered.length !== nodes.length) {
    warnings.push('Dependency cycle detected; preserving original order for cyclic remainder.');
    const seen = new Set(ordered.map((node) => node.node_id));
    nodes.forEach((node) => {
      if (!seen.has(node.node_id)) {
        ordered.push(node);
      }
    });
  }

  return { ordered, warnings };
}

function unresolvedResolution(reason: string): {
  resolution: Resolution;
  selected_candidate: Candidate | null;
  reason: string;
  boundary_reason: string;
} {
  return {
    resolution: 'unresolved',
    selected_candidate: null,
    reason,
    boundary_reason: 'unresolved',
  };
}

function selectResolution(
  node: OrchestrateNode,
  orchestration: JsonRecord,
): {
  resolution: Resolution;
  selected_candidate: Candidate | null;
  reason: string;
  boundary_reason: string | null;
} {
  const requestedAction = node.requested_action;
  const resultingCandidate = node.existing_resulting_process_candidates[0] ?? null;
  const processCandidate = node.existing_process_candidates[0] ?? null;
  const modelCandidate = node.existing_lifecyclemodel_candidates[0] ?? null;
  const allowProcessBuild = Boolean(orchestration.allow_process_build);
  const allowSubmodelBuild = Boolean(orchestration.allow_submodel_build);
  const reuseResultingProcessFirst = orchestration.reuse_resulting_process_first !== false;

  if (requestedAction === 'cutoff') {
    return {
      resolution: 'cutoff',
      selected_candidate: null,
      reason: 'Explicit cutoff requested.',
      boundary_reason: 'explicit_cutoff',
    };
  }
  if (requestedAction === 'unresolved') {
    return unresolvedResolution('Explicit unresolved marker provided.');
  }
  if (requestedAction === 'reuse_existing_resulting_process') {
    if (!resultingCandidate) {
      return unresolvedResolution(
        'requested reuse_existing_resulting_process but no candidate was provided',
      );
    }

    return {
      resolution: 'reused_existing_resulting_process',
      selected_candidate: resultingCandidate,
      reason: 'Requested resulting-process reuse.',
      boundary_reason: 'collapsed_at_resulting_process',
    };
  }
  if (requestedAction === 'reuse_existing_process') {
    if (!processCandidate) {
      return unresolvedResolution('requested reuse_existing_process but no candidate was provided');
    }

    return {
      resolution: 'reused_existing_process',
      selected_candidate: processCandidate,
      reason: 'Requested process reuse.',
      boundary_reason: 'collapsed_at_existing_process',
    };
  }
  if (requestedAction === 'reuse_existing_model') {
    if (!modelCandidate) {
      return unresolvedResolution(
        'requested reuse_existing_model but no lifecyclemodel candidate was provided',
      );
    }

    return {
      resolution: 'reused_existing_model',
      selected_candidate: modelCandidate,
      reason: 'Requested lifecyclemodel reuse.',
      boundary_reason: 'collapsed_at_existing_model',
    };
  }
  if (requestedAction === 'build_process') {
    if (!node.process_builder) {
      return unresolvedResolution('requested build_process but process_builder config is missing');
    }
    if (!allowProcessBuild) {
      return unresolvedResolution(
        'requested build_process but orchestration.allow_process_build=false',
      );
    }

    return {
      resolution: 'build_via_process_automated_builder',
      selected_candidate: null,
      reason: 'Requested process build.',
      boundary_reason: null,
    };
  }
  if (requestedAction === 'build_submodel') {
    if (!node.submodel_builder) {
      return unresolvedResolution(
        'requested build_submodel but submodel_builder config is missing',
      );
    }
    if (!allowSubmodelBuild) {
      return unresolvedResolution(
        'requested build_submodel but orchestration.allow_submodel_build=false',
      );
    }

    return {
      resolution: 'build_via_lifecyclemodel_automated_builder',
      selected_candidate: null,
      reason: 'Requested submodel build.',
      boundary_reason: null,
    };
  }

  if (reuseResultingProcessFirst && resultingCandidate) {
    return {
      resolution: 'reused_existing_resulting_process',
      selected_candidate: resultingCandidate,
      reason: 'Auto-selected highest scoring resulting process candidate.',
      boundary_reason: 'collapsed_at_resulting_process',
    };
  }
  if (processCandidate) {
    return {
      resolution: 'reused_existing_process',
      selected_candidate: processCandidate,
      reason: 'Auto-selected highest scoring existing process candidate.',
      boundary_reason: 'collapsed_at_existing_process',
    };
  }
  if ((node.kind === 'lifecyclemodel' || node.kind === 'subsystem') && modelCandidate) {
    return {
      resolution: 'reused_existing_model',
      selected_candidate: modelCandidate,
      reason: 'Auto-selected highest scoring lifecyclemodel candidate.',
      boundary_reason: 'collapsed_at_existing_model',
    };
  }
  if (
    (node.kind === 'lifecyclemodel' || node.kind === 'subsystem') &&
    node.submodel_builder &&
    allowSubmodelBuild
  ) {
    return {
      resolution: 'build_via_lifecyclemodel_automated_builder',
      selected_candidate: null,
      reason: 'No reusable model/process matched; scheduling lifecyclemodel builder.',
      boundary_reason: null,
    };
  }
  if (node.process_builder && allowProcessBuild) {
    return {
      resolution: 'build_via_process_automated_builder',
      selected_candidate: null,
      reason: 'No reusable process matched; scheduling process builder.',
      boundary_reason: null,
    };
  }
  if (modelCandidate) {
    return {
      resolution: 'reused_existing_model',
      selected_candidate: modelCandidate,
      reason: 'Fallback to lifecyclemodel candidate after no process candidate matched.',
      boundary_reason: 'collapsed_at_existing_model',
    };
  }

  return unresolvedResolution('No reusable candidate or build config satisfied the node policy');
}

function shouldRunProjector(node: OrchestrateNode, resolution: Resolution): boolean {
  if (!node.projector) {
    return false;
  }
  if (node.projector.run_always) {
    return true;
  }
  return (
    resolution === 'build_via_lifecyclemodel_automated_builder' ||
    resolution === 'reused_existing_model'
  );
}

function validateRequestShape(request: JsonRecord): void {
  const goal = requireObject(request.goal, 'goal');
  if (!nonEmptyString(goal.name)) {
    throw new CliError('goal.name is required.', {
      code: 'LIFECYCLEMODEL_ORCHESTRATE_INVALID_REQUEST',
      exitCode: 2,
    });
  }

  const root = requireObject(request.root, 'root');
  const rootKind = requireEnum(
    root.kind,
    ['reference_flow', 'process', 'lifecyclemodel', 'resulting_process'],
    'root.kind',
  );
  const requiredRootField =
    rootKind === 'reference_flow'
      ? 'flow'
      : rootKind === 'process'
        ? 'process'
        : rootKind === 'lifecyclemodel'
          ? 'lifecyclemodel'
          : 'resulting_process';
  const requiredRootEntity = requireObject(root[requiredRootField], `root.${requiredRootField}`);
  if (!nonEmptyString(requiredRootEntity.id)) {
    throw new CliError(`root.${requiredRootField}.id is required.`, {
      code: 'LIFECYCLEMODEL_ORCHESTRATE_INVALID_REQUEST',
      exitCode: 2,
    });
  }

  const orchestration = requireObject(request.orchestration, 'orchestration');
  requireEnum(orchestration.mode, ['collapsed', 'expanded', 'hybrid'], 'orchestration.mode');
  requireInteger(orchestration.max_depth, 'orchestration.max_depth');
  requireBoolean(
    orchestration.reuse_resulting_process_first,
    'orchestration.reuse_resulting_process_first',
  );
  requireBoolean(orchestration.allow_process_build, 'orchestration.allow_process_build');
  requireBoolean(orchestration.allow_submodel_build, 'orchestration.allow_submodel_build');
  requireBoolean(orchestration.pin_child_versions, 'orchestration.pin_child_versions');
  requireBoolean(orchestration.stop_at_elementary_flow, 'orchestration.stop_at_elementary_flow');

  const publish = requireObject(request.publish, 'publish');
  requireEnum(publish.intent, ['dry_run', 'prepare_only', 'publish'], 'publish.intent');

  if (request.nodes !== undefined && !Array.isArray(request.nodes)) {
    throw new CliError('nodes must be an array when provided.', {
      code: 'LIFECYCLEMODEL_ORCHESTRATE_INVALID_REQUEST',
      exitCode: 2,
    });
  }
  if (request.edges !== undefined && !Array.isArray(request.edges)) {
    throw new CliError('edges must be an array when provided.', {
      code: 'LIFECYCLEMODEL_ORCHESTRATE_INVALID_REQUEST',
      exitCode: 2,
    });
  }
}

function buildPlan(
  request: JsonRecord,
  requestPath: string,
  outDir: string,
  now: Date,
): AssemblyPlan {
  validateRequestShape(request);
  const requestDir = path.dirname(requestPath);
  const goal = copyJson(requireObject(request.goal, 'goal'));
  const root = copyJson(requireObject(request.root, 'root'));
  const orchestration = copyJson(requireObject(request.orchestration, 'orchestration'));
  const publish = copyJson(requireObject(request.publish, 'publish'));
  const candidateSources = {
    ...defaultCandidateSources(),
    ...(isRecord(request.candidate_sources) ? copyJson(request.candidate_sources) : {}),
  };

  const rootNode = deriveRootNode(root, goal, requestDir);
  const requestedNodes = ensureList(request.nodes).filter((entry): entry is JsonRecord =>
    isRecord(entry),
  );
  const rawNodes: JsonRecord[] = [];
  if (
    !requestedNodes.some((entry) => firstNonEmpty(entry.node_id, entry.id) === rootNode.node_id)
  ) {
    rawNodes.push({
      node_id: rootNode.node_id,
      kind: rootNode.kind,
      label: rootNode.label,
      entity: rootNode.entity,
      requested_action: rootNode.requested_action,
      depends_on: rootNode.depends_on,
      parent_node_id: rootNode.parent_node_id,
      existing_resulting_process_candidates: rootNode.existing_resulting_process_candidates,
      existing_process_candidates: rootNode.existing_process_candidates,
      existing_lifecyclemodel_candidates: rootNode.existing_lifecyclemodel_candidates,
      process_builder: rootNode.process_builder,
      submodel_builder: rootNode.submodel_builder,
      projector: rootNode.projector,
    });
  }
  rawNodes.push(...requestedNodes.map((entry) => copyJson(entry)));

  const nodes: OrchestrateNode[] = [];
  const seenNodeIds = new Set<string>();
  rawNodes.forEach((rawNode, index) => {
    const normalizedNode = normalizeNode(rawNode, index + 1, requestDir);
    if (seenNodeIds.has(normalizedNode.node_id)) {
      if (normalizedNode.node_id === 'root') {
        return;
      }

      throw new CliError(`Duplicate node_id: ${normalizedNode.node_id}`, {
        code: 'LIFECYCLEMODEL_ORCHESTRATE_INVALID_REQUEST',
        exitCode: 2,
      });
    }

    seenNodeIds.add(normalizedNode.node_id);
    nodes.push(normalizedNode);
  });

  const { ordered, warnings } = topoSortNodes(nodes);
  const edges = buildEdges(ensureList(request.edges), ordered);
  const invocations: PlanInvocation[] = [];
  const unresolved: Array<{ node_id: string; label: string; reason: string }> = [];
  const boundaries: Array<{ node_id: string; reason: string }> = [];

  ordered.forEach((node) => {
    const resolution = selectResolution(node, orchestration);
    node.resolution = resolution.resolution;
    node.resolution_reason = resolution.reason;
    node.selected_candidate = resolution.selected_candidate;
    node.boundary_reason = resolution.boundary_reason;
    node.planned_invocations = [];

    if (resolution.boundary_reason) {
      boundaries.push({
        node_id: node.node_id,
        reason: resolution.boundary_reason,
      });
    }
    if (resolution.resolution === 'unresolved') {
      unresolved.push({
        node_id: node.node_id,
        label: node.label,
        reason: resolution.reason,
      });
      return;
    }

    if (resolution.resolution === 'build_via_process_automated_builder') {
      const invocationId = `${node.node_id}:process-builder`;
      const artifactDir = path.resolve(
        requestDir,
        path.join(
          'artifacts',
          'process_from_flow',
          safeSlug(`${rootNode.node_id}-${node.node_id}`),
        ),
      );
      invocations.push({
        invocation_id: invocationId,
        node_id: node.node_id,
        kind: 'process_builder',
        config: serializeInvocationConfig(
          node.process_builder,
          `Node ${node.node_id} resolved to process_builder without process_builder config.`,
          { node_id: node.node_id, resolution: resolution.resolution },
        ),
        artifact_dir: artifactDir,
      });
      node.planned_invocations.push(invocationId);
    }

    if (resolution.resolution === 'build_via_lifecyclemodel_automated_builder') {
      const invocationId = `${node.node_id}:lifecyclemodel-builder`;
      const artifactDir = path.resolve(
        node.submodel_builder?.out_dir ??
          path.join(outDir, 'downstream', safeSlug(node.node_id), 'lifecyclemodel-builder'),
      );
      invocations.push({
        invocation_id: invocationId,
        node_id: node.node_id,
        kind: 'lifecyclemodel_builder',
        config: serializeInvocationConfig(
          node.submodel_builder,
          `Node ${node.node_id} resolved to lifecyclemodel_builder without submodel_builder config.`,
          { node_id: node.node_id, resolution: resolution.resolution },
        ),
        artifact_dir: artifactDir,
      });
      node.planned_invocations.push(invocationId);
    }

    if (node.resolution && shouldRunProjector(node, node.resolution)) {
      const invocationId = `${node.node_id}:projector`;
      const dependsOnInvocationId =
        node.resolution === 'build_via_lifecyclemodel_automated_builder'
          ? `${node.node_id}:lifecyclemodel-builder`
          : undefined;
      const artifactDir = path.resolve(
        node.projector?.out_dir ??
          path.join(outDir, 'downstream', safeSlug(node.node_id), 'projector'),
      );
      invocations.push({
        invocation_id: invocationId,
        node_id: node.node_id,
        kind: 'projector',
        config: serializeInvocationConfig(
          node.projector,
          `Node ${node.node_id} scheduled projector without projector config.`,
          { node_id: node.node_id, resolution: resolution.resolution },
        ),
        artifact_dir: artifactDir,
        depends_on_invocation_id: dependsOnInvocationId,
      });
      node.planned_invocations.push(invocationId);
    }
  });

  return {
    skill: 'lifecyclemodel-recursive-orchestrator',
    request_id:
      nonEmptyString(request.request_id) ??
      `run-${nowIso(now).replace(/[-:.]/gu, '').replace(/Z$/u, 'Z')}`,
    created_at: nowIso(now),
    request_file: requestPath,
    goal,
    root,
    orchestration,
    candidate_sources: candidateSources,
    publish: normalizePublishConfig(publish),
    notes: ensureList(request.notes)
      .map((entry) => nonEmptyString(entry))
      .filter((entry): entry is string => Boolean(entry)),
    nodes: ordered,
    edges,
    invocations,
    planner_summary: {
      status: 'planned',
      message: 'Request validated, nodes normalized, and downstream invocations scheduled.',
    },
    warnings,
    unresolved,
    boundaries,
    artifacts: {
      root: outDir,
      request_normalized: path.join(outDir, 'request.normalized.json'),
      assembly_plan: path.join(outDir, 'assembly-plan.json'),
      graph_manifest: path.join(outDir, 'graph-manifest.json'),
      lineage_manifest: path.join(outDir, 'lineage-manifest.json'),
      boundary_report: path.join(outDir, 'boundary-report.json'),
      invocations_dir: path.join(outDir, 'invocations'),
      publish_bundle: path.join(outDir, 'publish-bundle.json'),
      publish_summary: path.join(outDir, 'publish-summary.json'),
    },
    summary: {
      node_count: ordered.length,
      edge_count: edges.length,
      invocation_count: invocations.length,
      unresolved_count: unresolved.length,
    },
  };
}

function executionStatusByNode(
  plan: AssemblyPlan,
  executionResults: InvocationExecutionResult[],
): Record<string, string> {
  const byNode = new Map<string, InvocationExecutionResult[]>();
  executionResults.forEach((result) => {
    const list = byNode.get(result.node_id) ?? [];
    list.push(result);
    byNode.set(result.node_id, list);
  });

  const statuses: Record<string, string> = {};
  plan.nodes.forEach((node) => {
    const nodeResults = byNode.get(node.node_id) ?? [];
    if (node.resolution === 'unresolved') {
      statuses[node.node_id] = 'unresolved';
      return;
    }
    if (node.resolution === 'cutoff') {
      statuses[node.node_id] = 'cutoff';
      return;
    }
    if (node.resolution?.startsWith('reused_')) {
      statuses[node.node_id] = 'reused';
      return;
    }
    if (nodeResults.length === 0) {
      statuses[node.node_id] = 'planned';
      return;
    }
    if (nodeResults.some((result) => result.status === 'failed')) {
      statuses[node.node_id] = 'failed';
      return;
    }
    if (nodeResults.some((result) => result.status.startsWith('skipped'))) {
      statuses[node.node_id] = 'blocked';
      return;
    }
    if (nodeResults.every((result) => result.status === 'success')) {
      statuses[node.node_id] = 'completed';
      return;
    }

    statuses[node.node_id] = 'incomplete';
  });

  return statuses;
}

function collectResultingProcessRelations(
  executionResults: InvocationExecutionResult[],
): JsonRecord[] {
  const relations: JsonRecord[] = [];

  executionResults.forEach((result) => {
    const bundlePath = nonEmptyString(result.artifacts?.projection_bundle);
    if (!bundlePath || !existsSync(bundlePath)) {
      return;
    }

    const bundle = readJsonArtifact(bundlePath);
    if (!isRecord(bundle)) {
      return;
    }

    ensureList(bundle.relations).forEach((relation) => {
      if (!isRecord(relation)) {
        return;
      }

      relations.push({
        ...copyJson(relation),
        node_id: result.node_id,
      });
    });
  });

  return relations;
}

function buildGraphManifest(
  plan: AssemblyPlan,
  executionResults: InvocationExecutionResult[],
): GraphManifest {
  const nodeStatuses = executionStatusByNode(plan, executionResults);
  return {
    root: {
      request_id: plan.request_id,
      goal: copyJson(plan.goal),
      mode: plan.orchestration.mode,
      max_depth: plan.orchestration.max_depth,
    },
    nodes: plan.nodes.map((node) => ({
      node_id: node.node_id,
      label: node.label,
      kind: node.kind,
      resolution: node.resolution,
      execution_status: invariant(
        nodeStatuses[node.node_id],
        `Missing execution status for node ${node.node_id}.`,
        { node_id: node.node_id },
      ),
      selected_candidate: copyJson(node.selected_candidate ?? null),
      depends_on: copyJson(node.depends_on),
      boundary_reason: node.boundary_reason ?? null,
    })),
    edges: copyJson(plan.edges),
    boundaries: copyJson(plan.boundaries),
    unresolved: copyJson(plan.unresolved),
    stats: {
      node_count: plan.nodes.length,
      edge_count: plan.edges.length,
      invocation_count: plan.invocations.length,
      unresolved_count: plan.unresolved.length,
      completed_invocation_count: executionResults.filter((result) => result.status === 'success')
        .length,
    },
  };
}

function buildLineageManifest(
  plan: AssemblyPlan,
  executionResults: InvocationExecutionResult[],
): LineageManifest {
  const executionByInvocation = new Map(
    executionResults.map((result) => [result.invocation_id, result]),
  );
  const nodeStatuses = executionStatusByNode(plan, executionResults);

  const publishedDependencies = plan.nodes
    .filter((node) => isRecord(node.selected_candidate))
    .map((node) => ({
      node_id: node.node_id,
      dependency_type: node.resolution,
      candidate_id: node.selected_candidate?.id ?? null,
      candidate_version: nonEmptyString(node.selected_candidate?.version) ?? null,
    }));

  return {
    root_request: {
      request_id: plan.request_id,
      goal: copyJson(plan.goal),
      root: copyJson(plan.root),
      orchestration: copyJson(plan.orchestration),
      publish: copyJson(plan.publish),
    },
    builder_invocations: plan.invocations.map((invocation) => {
      const result = executionByInvocation.get(invocation.invocation_id);
      return {
        invocation_id: invocation.invocation_id,
        node_id: invocation.node_id,
        kind: invocation.kind,
        artifact_dir: invocation.artifact_dir,
        status: result?.status ?? 'planned',
        exit_code: result?.exit_code ?? null,
        result_file: result?.result_file ?? null,
      };
    }),
    node_resolution_log: plan.nodes.map((node) => ({
      node_id: node.node_id,
      label: node.label,
      resolution: node.resolution,
      reason: node.resolution_reason,
      selected_candidate: copyJson(node.selected_candidate ?? null),
      execution_status: invariant(
        nodeStatuses[node.node_id],
        `Missing execution status for node ${node.node_id}.`,
        { node_id: node.node_id },
      ),
    })),
    published_dependencies: publishedDependencies,
    resulting_process_relations: collectResultingProcessRelations(executionResults),
    unresolved_history: copyJson(plan.unresolved),
  };
}

function buildBoundaryReport(
  plan: AssemblyPlan,
  executionResults: InvocationExecutionResult[],
): JsonRecord {
  return {
    request_id: plan.request_id,
    generated_at: nowIso(),
    boundaries: copyJson(plan.boundaries),
    unresolved: copyJson(plan.unresolved),
    execution_summary: {
      successful_invocations: executionResults.filter((result) => result.status === 'success')
        .length,
      failed_invocations: executionResults.filter((result) => result.status === 'failed').length,
      blocked_invocations: executionResults.filter((result) => result.status.startsWith('skipped'))
        .length,
    },
  };
}

function writePlanArtifacts(
  normalizedRequest: JsonRecord,
  plan: AssemblyPlan,
  graphManifest: GraphManifest,
  lineageManifest: LineageManifest,
  boundaryReport: JsonRecord,
): void {
  writeJsonArtifact(plan.artifacts.request_normalized, normalizedRequest);
  writeJsonArtifact(plan.artifacts.assembly_plan, plan);
  writeJsonArtifact(plan.artifacts.graph_manifest, graphManifest);
  writeJsonArtifact(plan.artifacts.lineage_manifest, lineageManifest);
  writeJsonArtifact(plan.artifacts.boundary_report, boundaryReport);
}

function requireFile(filePath: string, label: string): void {
  if (!existsSync(filePath)) {
    throw new CliError(`Missing ${label}: ${filePath}`, {
      code: 'LIFECYCLEMODEL_ORCHESTRATE_MISSING_FILE',
      exitCode: 2,
      details: { filePath, label },
    });
  }
}

function writeRequestFile(filePath: string, payload: unknown): string {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return filePath;
}

function parseInlineJson(value: unknown, label: string): JsonRecord {
  if (isRecord(value)) {
    return copyJson(value);
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!isRecord(parsed)) {
        throw new Error('parsed value is not an object');
      }
      return parsed;
    } catch (error) {
      throw new CliError(`Invalid ${label} JSON string.`, {
        code: 'LIFECYCLEMODEL_ORCHESTRATE_INVALID_REQUEST',
        exitCode: 2,
        details: { value, message: String(error) },
      });
    }
  }

  throw new CliError(`${label} must be a JSON object or JSON string.`, {
    code: 'LIFECYCLEMODEL_ORCHESTRATE_INVALID_REQUEST',
    exitCode: 2,
    details: { value },
  });
}

function buildProcessBuilderArtifacts(report: ProcessAutoBuildReport): JsonRecord {
  return {
    run_id: report.run_id,
    run_root: report.run_root,
    state_file: report.files.state,
    exports_dir: path.join(report.run_root, 'exports', 'processes'),
    report: report.files.report,
  };
}

function buildLifecyclemodelBuilderArtifacts(report: LifecyclemodelAutoBuildReport): JsonRecord {
  return {
    run_root: report.run_root,
    run_id: report.run_id,
    run_plan: report.files.run_plan,
    resolved_manifest: report.files.resolved_manifest,
    produced_model_files: report.local_build_reports.map((entry) => entry.model_file),
    process_catalog_files: report.local_build_reports.map((entry) => entry.process_catalog_file),
    source_run_dirs: report.local_build_reports.map((entry) => entry.run_dir),
    report_files: report.local_build_reports.map((entry) => entry.summary_file),
    report: report.files.report,
  };
}

function buildProjectorArtifacts(report: LifecyclemodelResultingProcessReport): JsonRecord {
  return {
    out_dir: report.out_dir,
    projection_bundle: report.files.process_projection_bundle,
    projection_report: report.files.projection_report,
    request_normalized: report.files.normalized_request,
  };
}

async function executeProcessBuilderInvocation(
  invocation: PlanInvocation,
  plan: AssemblyPlan,
  resultFile: string,
  now: Date,
): Promise<InvocationExecutionResult> {
  const config = invocation.config;
  if (nonEmptyString(config.python_bin)) {
    throw new CliError(
      `Invocation ${invocation.invocation_id} still requests process_builder.python_bin, which is removed from the CLI-only path.`,
      {
        code: 'LIFECYCLEMODEL_ORCHESTRATE_LEGACY_CONFIG',
        exitCode: 2,
      },
    );
  }
  if (config.mode === 'langgraph') {
    throw new CliError(
      `Invocation ${invocation.invocation_id} still requests process_builder.mode=langgraph, which is removed from the CLI-only path.`,
      {
        code: 'LIFECYCLEMODEL_ORCHESTRATE_LEGACY_CONFIG',
        exitCode: 2,
      },
    );
  }

  const requestsDir = path.join(plan.artifacts.invocations_dir, 'requests');
  const slug = safeSlug(invocation.invocation_id);
  let flowFile = nonEmptyString(config.flow_file);
  if (!flowFile) {
    const flowPayload = parseInlineJson(config.flow_json, `${invocation.invocation_id} flow_json`);
    flowFile = writeRequestFile(path.join(requestsDir, `${slug}.flow.json`), flowPayload);
  }

  const request = {
    flow_file: flowFile,
    operation: 'produce',
  };
  const requestFile = writeRequestFile(
    path.join(requestsDir, `${slug}.process-auto-build.request.json`),
    request,
  );
  const runId =
    nonEmptyString(config.run_id) ?? `${safeSlug(plan.request_id)}-${safeSlug(invocation.node_id)}`;
  const report = await runProcessAutoBuild({
    inputPath: requestFile,
    inputValue: request,
    outDir: invocation.artifact_dir,
    now,
    requestIdOverride: `${plan.request_id}:${invocation.node_id}`,
    runIdOverride: runId,
  });

  const result: InvocationExecutionResult = {
    invocation_id: invocation.invocation_id,
    node_id: invocation.node_id,
    kind: invocation.kind,
    status: 'success',
    exit_code: 0,
    result_file: resultFile,
    planned_artifacts: {
      run_id: runId,
      run_root: report.run_root,
    },
    artifacts: buildProcessBuilderArtifacts(report),
  };
  writeJsonArtifact(resultFile, result);
  return result;
}

async function executeLifecyclemodelBuilderInvocation(
  invocation: PlanInvocation,
  resultFile: string,
  now: Date,
): Promise<InvocationExecutionResult> {
  const config = invocation.config;
  const manifest = nonEmptyString(config.manifest);
  if (!manifest) {
    throw new CliError(
      `Invocation ${invocation.invocation_id} is missing submodel_builder.manifest.`,
      {
        code: 'LIFECYCLEMODEL_ORCHESTRATE_INVALID_REQUEST',
        exitCode: 2,
      },
    );
  }
  requireFile(manifest, 'lifecyclemodel builder manifest');

  if (config.dry_run === true) {
    const result: InvocationExecutionResult = {
      invocation_id: invocation.invocation_id,
      node_id: invocation.node_id,
      kind: invocation.kind,
      status: 'success',
      exit_code: 0,
      result_file: resultFile,
      dry_run: true,
      planned_artifacts: {
        out_dir: invocation.artifact_dir,
        manifest,
      },
      artifacts: {
        out_dir: invocation.artifact_dir,
        run_plan: null,
        resolved_manifest: null,
        produced_model_files: [],
        process_catalog_files: [],
        report_files: [],
      },
    };
    writeJsonArtifact(resultFile, result);
    return result;
  }

  const report = await runLifecyclemodelAutoBuild({
    inputPath: manifest,
    outDir: invocation.artifact_dir,
    now,
  });
  const result: InvocationExecutionResult = {
    invocation_id: invocation.invocation_id,
    node_id: invocation.node_id,
    kind: invocation.kind,
    status: 'success',
    exit_code: 0,
    result_file: resultFile,
    planned_artifacts: {
      out_dir: invocation.artifact_dir,
      manifest,
    },
    artifacts: buildLifecyclemodelBuilderArtifacts(report),
  };
  writeJsonArtifact(resultFile, result);
  return result;
}

function inferProjectorModelFile(
  invocation: PlanInvocation,
  executionMap: Map<string, InvocationExecutionResult>,
): string | null {
  const explicit = nonEmptyString(invocation.config.model_file);
  if (explicit) {
    return explicit;
  }

  const dependencyId = nonEmptyString(invocation.depends_on_invocation_id);
  if (!dependencyId) {
    return null;
  }
  const dependency = executionMap.get(dependencyId);
  const modelFiles = ensureList(dependency?.artifacts?.produced_model_files)
    .map((entry) => nonEmptyString(entry))
    .filter((entry): entry is string => Boolean(entry));
  return modelFiles[0] ?? null;
}

function collectProjectorDependencyArtifacts(
  invocation: PlanInvocation,
  executionMap: Map<string, InvocationExecutionResult>,
): {
  processCatalogPath: string | null;
  sourceRunDirs: string[];
} {
  const dependencyId = nonEmptyString(invocation.depends_on_invocation_id);
  const dependency = executionMap.get(dependencyId ?? '');
  return {
    processCatalogPath:
      ensureList(dependency?.artifacts?.process_catalog_files)
        .map((entry) => nonEmptyString(entry))
        .filter((entry): entry is string => Boolean(entry))[0] ?? null,
    sourceRunDirs: ensureList(dependency?.artifacts?.source_run_dirs)
      .map((entry) => nonEmptyString(entry))
      .filter((entry): entry is string => Boolean(entry)),
  };
}

function buildProjectorRequest(
  invocation: PlanInvocation,
  modelFile: string,
  plan: AssemblyPlan,
  processCatalogPath: string | null,
  sourceRunDirs: string[],
): JsonRecord {
  return {
    source_model: {
      json_ordered_path: modelFile,
    },
    projection: {
      mode: invocation.config.projection_role === 'all' ? 'all-subproducts' : 'primary-only',
      metadata_overrides: {
        projection_source: 'lifecyclemodel_orchestrate',
      },
      attach_graph_snapshot: false,
    },
    process_sources: {
      ...(processCatalogPath ? { process_catalog_path: processCatalogPath } : {}),
      ...(sourceRunDirs.length > 0 ? { run_dirs: sourceRunDirs } : {}),
      allow_remote_lookup: false,
    },
    publish: {
      intent: plan.publish.intent,
      prepare_process_payloads: plan.publish.prepare_resulting_process_payload !== false,
      prepare_relation_payloads: plan.publish.prepare_relation_payload !== false,
    },
  };
}

async function executeProjectorInvocation(
  invocation: PlanInvocation,
  plan: AssemblyPlan,
  executionMap: Map<string, InvocationExecutionResult>,
  resultFile: string,
  now: Date,
  env: NodeJS.ProcessEnv,
  fetchImpl: FetchLike | undefined,
): Promise<InvocationExecutionResult> {
  const requestPath = nonEmptyString(invocation.config.request);
  let projectorRequestPath = requestPath;
  if (!projectorRequestPath) {
    const modelFile = inferProjectorModelFile(invocation, executionMap);
    if (!modelFile) {
      throw new CliError(
        `Invocation ${invocation.invocation_id} requires projector.request or a prior lifecyclemodel build result.`,
        {
          code: 'LIFECYCLEMODEL_ORCHESTRATE_PROJECTOR_REQUEST_REQUIRED',
          exitCode: 2,
        },
      );
    }
    const { processCatalogPath, sourceRunDirs } = collectProjectorDependencyArtifacts(
      invocation,
      executionMap,
    );
    projectorRequestPath = writeRequestFile(
      path.join(
        plan.artifacts.invocations_dir,
        'requests',
        `${safeSlug(invocation.invocation_id)}.projector.request.json`,
      ),
      buildProjectorRequest(invocation, modelFile, plan, processCatalogPath, sourceRunDirs),
    );
  } else {
    requireFile(projectorRequestPath, 'projector request');
  }

  const report = await runLifecyclemodelBuildResultingProcess({
    inputPath: projectorRequestPath,
    outDir: invocation.artifact_dir,
    now,
    env,
    fetchImpl,
  });
  const result: InvocationExecutionResult = {
    invocation_id: invocation.invocation_id,
    node_id: invocation.node_id,
    kind: invocation.kind,
    status: 'success',
    exit_code: 0,
    result_file: resultFile,
    planned_artifacts: {
      out_dir: invocation.artifact_dir,
      request: projectorRequestPath,
    },
    artifacts: buildProjectorArtifacts(report),
  };
  writeJsonArtifact(resultFile, result);
  return result;
}

function recordInvocationResult(
  invocation: PlanInvocation,
  result: InvocationExecutionResult,
  results: InvocationExecutionResult[],
  executionMap: Map<string, InvocationExecutionResult>,
): void {
  invocation.last_status = result.status;
  invocation.last_exit_code = result.exit_code;
  invocation.last_result_file = result.result_file;
  invocation.artifacts = result.artifacts;
  results.push(result);
  executionMap.set(invocation.invocation_id, result);
}

async function executePlan(
  plan: AssemblyPlan,
  now: Date,
  env: NodeJS.ProcessEnv,
  fetchImpl: FetchLike | undefined,
): Promise<{ results: InvocationExecutionResult[]; executionSummary: ExecutionSummary }> {
  mkdirSync(plan.artifacts.invocations_dir, { recursive: true });
  const results: InvocationExecutionResult[] = [];
  const executionMap = new Map<string, InvocationExecutionResult>();
  const failFast = plan.orchestration.fail_fast !== false;
  let stopRemaining = false;

  for (const invocation of plan.invocations) {
    const resultFile = path.join(
      plan.artifacts.invocations_dir,
      `${safeSlug(invocation.invocation_id)}.json`,
    );
    if (stopRemaining) {
      const skipped: InvocationExecutionResult = {
        invocation_id: invocation.invocation_id,
        node_id: invocation.node_id,
        kind: invocation.kind,
        status: 'skipped_due_to_fail_fast',
        exit_code: null,
        result_file: resultFile,
      };
      writeJsonArtifact(resultFile, skipped);
      recordInvocationResult(invocation, skipped, results, executionMap);
      continue;
    }

    const dependencyId = nonEmptyString(invocation.depends_on_invocation_id);
    if (dependencyId) {
      const dependency = executionMap.get(dependencyId);
      if (dependency && dependency.status !== 'success') {
        const blocked: InvocationExecutionResult = {
          invocation_id: invocation.invocation_id,
          node_id: invocation.node_id,
          kind: invocation.kind,
          status: `skipped_due_to_dependency_${dependency.status}` as InvocationStatus,
          exit_code: null,
          result_file: resultFile,
        };
        writeJsonArtifact(resultFile, blocked);
        recordInvocationResult(invocation, blocked, results, executionMap);
        continue;
      }
    }

    try {
      let result: InvocationExecutionResult;
      if (invocation.kind === 'process_builder') {
        result = await executeProcessBuilderInvocation(invocation, plan, resultFile, now);
      } else if (invocation.kind === 'lifecyclemodel_builder') {
        result = await executeLifecyclemodelBuilderInvocation(invocation, resultFile, now);
      } else {
        result = await executeProjectorInvocation(
          invocation,
          plan,
          executionMap,
          resultFile,
          now,
          env,
          fetchImpl,
        );
      }

      recordInvocationResult(invocation, result, results, executionMap);
    } catch (error) {
      const failure = normalizeInvocationFailure(error);
      const failed: InvocationExecutionResult = {
        invocation_id: invocation.invocation_id,
        node_id: invocation.node_id,
        kind: invocation.kind,
        status: 'failed',
        exit_code: failure.exit_code,
        result_file: resultFile,
        error: failure.error,
      };
      writeJsonArtifact(resultFile, failed);
      recordInvocationResult(invocation, failed, results, executionMap);
      if (failFast) {
        stopRemaining = true;
      }
    }
  }

  const executionSummary: ExecutionSummary = {
    executed_at: nowIso(now),
    successful_invocations: results.filter((result) => result.status === 'success').length,
    failed_invocations: results.filter((result) => result.status === 'failed').length,
    blocked_invocations: results.filter((result) => result.status.startsWith('skipped')).length,
    status: results.some((result) => result.status === 'failed') ? 'failed' : 'completed',
  };
  plan.execution_summary = executionSummary;
  plan.planner_summary = {
    status: 'executed',
    message: 'Scheduled downstream builders were executed and invocation artifacts were recorded.',
  };

  return { results, executionSummary };
}

function loadInvocationResults(invocationsDir: string): InvocationExecutionResult[] {
  if (!existsSync(invocationsDir)) {
    return [];
  }

  return readdirSync(invocationsDir)
    .filter((entry) => entry.endsWith('.json'))
    .sort()
    .map((entry) => readJsonArtifact(path.join(invocationsDir, entry)))
    .filter((entry): entry is InvocationExecutionResult => isRecord(entry))
    .map((entry) => entry as InvocationExecutionResult);
}

function collectPublishBundle(
  runDir: string,
  plan: AssemblyPlan,
  graphManifest: GraphManifest,
  lineageManifest: LineageManifest,
  executionResults: InvocationExecutionResult[],
  publishLifecyclemodels: boolean,
  publishResultingProcessRelations: boolean,
): JsonRecord {
  const lifecyclemodels: JsonRecord[] = [];
  const projectedProcesses: JsonRecord[] = [];
  const relations: JsonRecord[] = [];
  const processBuildRuns: JsonRecord[] = [];

  executionResults.forEach((result) => {
    if (result.kind === 'lifecyclemodel_builder' && publishLifecyclemodels) {
      ensureList(result.artifacts?.produced_model_files).forEach((filePath) => {
        const resolved = nonEmptyString(filePath);
        if (!resolved || !existsSync(resolved)) {
          return;
        }
        lifecyclemodels.push({
          node_id: result.node_id,
          file: resolved,
          json_ordered: readJsonArtifact(resolved),
        });
      });
    }

    if (result.kind === 'projector' && publishResultingProcessRelations) {
      const bundlePath = nonEmptyString(result.artifacts?.projection_bundle);
      if (bundlePath && existsSync(bundlePath)) {
        const bundle = readJsonArtifact(bundlePath);
        if (isRecord(bundle)) {
          ensureList(bundle.projected_processes).forEach((payload) => {
            if (!isRecord(payload)) {
              return;
            }
            projectedProcesses.push({
              ...copyJson(payload),
              node_id: result.node_id,
            });
          });
          ensureList(bundle.relations).forEach((payload) => {
            if (!isRecord(payload)) {
              return;
            }
            relations.push({
              ...copyJson(payload),
              node_id: result.node_id,
            });
          });
        }
      }
    }

    if (result.kind === 'process_builder') {
      processBuildRuns.push({
        node_id: result.node_id,
        run_id: nonEmptyString(result.artifacts?.run_id),
        run_root: nonEmptyString(result.artifacts?.run_root),
        exports_dir: nonEmptyString(result.artifacts?.exports_dir),
      });
    }
  });

  return {
    generated_at: nowIso(),
    run_dir: runDir,
    request_id: plan.request_id,
    status: 'prepared_local_publish_bundle',
    include_lifecyclemodels: publishLifecyclemodels,
    include_resulting_process_relations: publishResultingProcessRelations,
    graph_manifest: copyJson(graphManifest),
    lineage_manifest: copyJson(lineageManifest),
    lifecyclemodels,
    projected_processes: projectedProcesses,
    resulting_process_relations: relations,
    process_build_runs: processBuildRuns,
  };
}

function normalizeRequestForArtifacts(plan: AssemblyPlan): JsonRecord {
  return {
    request_id: plan.request_id,
    goal: copyJson(plan.goal),
    root: copyJson(plan.root),
    orchestration: copyJson(plan.orchestration),
    candidate_sources: copyJson(plan.candidate_sources),
    publish: copyJson(plan.publish),
    nodes: copyJson(plan.nodes),
    edges: copyJson(plan.edges),
    notes: copyJson(plan.notes),
  };
}

function requireActionInputPath(options: RunLifecyclemodelOrchestrateOptions): string {
  const inputPath = nonEmptyString(options.inputPath);
  if (!inputPath) {
    throw new CliError('Missing required --input for lifecyclemodel orchestrate plan/execute.', {
      code: 'LIFECYCLEMODEL_ORCHESTRATE_INPUT_REQUIRED',
      exitCode: 2,
    });
  }
  return path.resolve(inputPath);
}

function requireActionOutDir(options: RunLifecyclemodelOrchestrateOptions): string {
  const outDir = nonEmptyString(options.outDir);
  if (!outDir) {
    throw new CliError('Missing required --out-dir for lifecyclemodel orchestrate plan/execute.', {
      code: 'LIFECYCLEMODEL_ORCHESTRATE_OUT_DIR_REQUIRED',
      exitCode: 2,
    });
  }
  return path.resolve(outDir);
}

function requirePublishRunDir(options: RunLifecyclemodelOrchestrateOptions): string {
  const runDir = nonEmptyString(options.runDir);
  if (!runDir) {
    throw new CliError('Missing required --run-dir for lifecyclemodel orchestrate publish.', {
      code: 'LIFECYCLEMODEL_ORCHESTRATE_RUN_DIR_REQUIRED',
      exitCode: 2,
    });
  }
  return path.resolve(runDir);
}

export async function runLifecyclemodelOrchestrate(
  options: RunLifecyclemodelOrchestrateOptions,
): Promise<LifecyclemodelOrchestrateReport> {
  const now = options.now ?? new Date();
  if (options.action === 'publish') {
    const runDir = requirePublishRunDir(options);
    const assemblyPlanPath = path.join(runDir, 'assembly-plan.json');
    const graphManifestPath = path.join(runDir, 'graph-manifest.json');
    const lineageManifestPath = path.join(runDir, 'lineage-manifest.json');
    requireFile(assemblyPlanPath, 'assembly plan');
    requireFile(graphManifestPath, 'graph manifest');
    requireFile(lineageManifestPath, 'lineage manifest');
    const plan = readJsonArtifact(assemblyPlanPath) as AssemblyPlan;
    const graphManifest = readJsonArtifact(graphManifestPath) as GraphManifest;
    const lineageManifest = readJsonArtifact(lineageManifestPath) as LineageManifest;
    const publishLifecyclemodels =
      options.publishLifecyclemodels || plan.publish.prepare_lifecyclemodel_payload !== false;
    const publishResultingProcessRelations =
      options.publishResultingProcessRelations ||
      plan.publish.prepare_resulting_process_payload !== false ||
      plan.publish.prepare_relation_payload !== false;
    const executionResults = loadInvocationResults(path.join(runDir, 'invocations'));
    const publishBundle = collectPublishBundle(
      runDir,
      plan,
      graphManifest,
      lineageManifest,
      executionResults,
      publishLifecyclemodels,
      publishResultingProcessRelations,
    );
    const publishBundlePath = writeJsonArtifact(
      path.join(runDir, 'publish-bundle.json'),
      publishBundle,
    );
    const publishSummaryPath = writeJsonArtifact(path.join(runDir, 'publish-summary.json'), {
      schema_version: 1,
      generated_at_utc: nowIso(now),
      action: 'publish',
      status: 'prepared_local_publish_bundle',
      request_id: plan.request_id,
      run_dir: runDir,
      lifecyclemodel_count: ensureList(publishBundle.lifecyclemodels).length,
      projected_process_count: ensureList(publishBundle.projected_processes).length,
      relation_count: ensureList(publishBundle.resulting_process_relations).length,
      process_build_run_count: ensureList(publishBundle.process_build_runs).length,
    });

    return {
      schema_version: 1,
      generated_at_utc: nowIso(now),
      action: 'publish',
      status: 'prepared_local_publish_bundle',
      request_id: plan.request_id,
      run_dir: runDir,
      counts: {
        lifecyclemodels: ensureList(publishBundle.lifecyclemodels).length,
        projected_processes: ensureList(publishBundle.projected_processes).length,
        resulting_process_relations: ensureList(publishBundle.resulting_process_relations).length,
        process_build_runs: ensureList(publishBundle.process_build_runs).length,
      },
      files: {
        assembly_plan: assemblyPlanPath,
        graph_manifest: graphManifestPath,
        lineage_manifest: lineageManifestPath,
        publish_bundle: publishBundlePath,
        publish_summary: publishSummaryPath,
      },
    };
  }

  const inputPath = requireActionInputPath(options);
  const outDir = requireActionOutDir(options);
  const request = readJsonInput(inputPath);
  const requestObject = requireObject(request, 'request');
  if (options.allowProcessBuild === true) {
    (requestObject.orchestration as JsonRecord).allow_process_build = true;
  }
  if (options.allowSubmodelBuild === true) {
    (requestObject.orchestration as JsonRecord).allow_submodel_build = true;
  }
  const plan = buildPlan(requestObject, inputPath, outDir, now);
  const normalizedRequest = normalizeRequestForArtifacts(plan);
  const initialGraphManifest = buildGraphManifest(plan, []);
  const initialLineageManifest = buildLineageManifest(plan, []);
  const initialBoundaryReport = buildBoundaryReport(plan, []);
  writePlanArtifacts(
    normalizedRequest,
    plan,
    initialGraphManifest,
    initialLineageManifest,
    initialBoundaryReport,
  );

  if (options.action === 'plan') {
    return {
      schema_version: 1,
      generated_at_utc: nowIso(now),
      action: 'plan',
      status: 'planned',
      request_id: plan.request_id,
      out_dir: outDir,
      counts: {
        nodes: plan.summary.node_count,
        edges: plan.summary.edge_count,
        invocations: plan.summary.invocation_count,
        unresolved: plan.summary.unresolved_count,
      },
      files: {
        request_normalized: plan.artifacts.request_normalized,
        assembly_plan: plan.artifacts.assembly_plan,
        graph_manifest: plan.artifacts.graph_manifest,
        lineage_manifest: plan.artifacts.lineage_manifest,
        boundary_report: plan.artifacts.boundary_report,
      },
      warnings: copyJson(plan.warnings),
    };
  }

  const { results: executionResults, executionSummary } = await executePlan(
    plan,
    now,
    options.env ?? process.env,
    options.fetchImpl,
  );
  const graphManifest = buildGraphManifest(plan, executionResults);
  const lineageManifest = buildLineageManifest(plan, executionResults);
  const boundaryReport = buildBoundaryReport(plan, executionResults);
  writePlanArtifacts(normalizedRequest, plan, graphManifest, lineageManifest, boundaryReport);

  return {
    schema_version: 1,
    generated_at_utc: nowIso(now),
    action: 'execute',
    status: executionSummary.status,
    request_id: plan.request_id,
    out_dir: outDir,
    execution: {
      successful_invocations: executionSummary.successful_invocations,
      failed_invocations: executionSummary.failed_invocations,
      blocked_invocations: executionSummary.blocked_invocations,
    },
    files: {
      request_normalized: plan.artifacts.request_normalized,
      assembly_plan: plan.artifacts.assembly_plan,
      graph_manifest: plan.artifacts.graph_manifest,
      lineage_manifest: plan.artifacts.lineage_manifest,
      boundary_report: plan.artifacts.boundary_report,
      invocations_dir: plan.artifacts.invocations_dir,
    },
    warnings: copyJson(plan.warnings),
  };
}

export const __testInternals = {
  invariant,
  safeSlug,
  requireObject,
  requireEnum,
  requireBoolean,
  requireInteger,
  resolveInputPath,
  defaultCandidateSources,
  entityFromRoot,
  normalizeCandidate,
  normalizeCandidateList,
  normalizeRequestedAction,
  normalizeDependsOn,
  normalizePublishConfig,
  serializeInvocationConfig,
  normalizeInvocationFailure,
  normalizeProcessBuilderConfig,
  normalizeSubmodelBuilderConfig,
  normalizeProjectorConfig,
  normalizeNode,
  deriveRootNode,
  buildEdges,
  topoSortNodes,
  selectResolution,
  shouldRunProjector,
  validateRequestShape,
  buildPlan,
  executionStatusByNode,
  buildGraphManifest,
  buildLineageManifest,
  buildBoundaryReport,
  requireFile,
  parseInlineJson,
  inferProjectorModelFile,
  collectProjectorDependencyArtifacts,
  executeProcessBuilderInvocation,
  executeLifecyclemodelBuilderInvocation,
  executeProjectorInvocation,
  executePlan,
  collectPublishBundle,
  normalizeRequestForArtifacts,
  loadInvocationResults,
  buildProjectorRequest,
};
