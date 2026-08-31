import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { CliError } from './errors.js';
import {
  firstNonEmpty,
  isRecord,
  materializeDatasetRows,
  type DatasetRowInput,
  type JsonObject,
} from './dataset-local.js';

export type DatasetCurationQueueEntityType = 'support' | 'flow' | 'process';

export type RunDatasetCurationQueueBuildOptions = {
  processesPath: string;
  flowsPath?: string;
  supportPaths?: string[];
  externalFlowRefPaths?: string[];
  outDir: string;
  excludeProcessIds?: string[];
  processLimit?: number;
};

export type RunDatasetCurationQueueNextOptions = {
  queueDir: string;
  entityType?: DatasetCurationQueueEntityType;
  taskId?: string;
};

export type RunDatasetCurationQueueVerifyOptions = {
  queueDir: string;
  entityType?: DatasetCurationQueueEntityType;
  taskId?: string;
};

export type DatasetCurationQueueTask = {
  schema_version: 1;
  entity_type: DatasetCurationQueueEntityType;
  task_id: string;
  entity_id: string;
  version: string;
  lock_key: string;
  depends_on: string[];
  input_rows_file: string;
  work_dir: string;
  checkpoint_file: string;
  run_plan_file: string;
  closure_file: string;
};

type DatasetCurationQueueBlocker = {
  schema_version: 1;
  code: string;
  severity: 'blocker';
  entity_type: DatasetCurationQueueEntityType;
  entity_id: string | null;
  version: string | null;
  message: string;
  details?: unknown;
};

export type DatasetCurationQueueBuildReport = {
  schema_version: 1;
  generated_at_utc: string;
  status: 'ready' | 'blocked';
  out_dir: string;
  inputs: {
    processes: string;
    flows: string | null;
    support: string[];
    external_flow_refs: string[];
  };
  counts: {
    support_rows: number;
    flow_rows: number;
    process_rows: number;
    external_flow_refs: number;
    tasks: number;
    blockers: number;
  };
  hashes: {
    inputs: Record<string, string>;
    task_order: string;
  };
  files: {
    manifest: string;
    tasks: string;
    locks: string;
    blockers: string;
  };
  tasks: DatasetCurationQueueTask[];
  blockers: DatasetCurationQueueBlocker[];
};

export type DatasetCurationQueueTaskRuntimeStatus =
  'complete' | 'pending' | 'waiting_dependencies' | 'blocked';

export type DatasetCurationQueueTaskState = {
  task_id: string;
  entity_type: DatasetCurationQueueEntityType;
  entity_id: string;
  version: string;
  status: DatasetCurationQueueTaskRuntimeStatus;
  checkpoint_status: string | null;
  checkpoint_file: string;
  depends_on: string[];
  incomplete_dependencies: string[];
  reason: string | null;
};

export type DatasetCurationQueueNextReport = {
  schema_version: 1;
  generated_at_utc: string;
  status: 'ready' | 'complete' | 'blocked';
  queue_dir: string;
  scope: {
    entity_type: DatasetCurationQueueEntityType | null;
    task_id: string | null;
  };
  counts: {
    total: number;
    complete: number;
    pending: number;
    waiting_dependencies: number;
    blocked: number;
    runnable: number;
  };
  next_task:
    | (DatasetCurationQueueTask & {
        action: {
          kind: 'entity_curation_task';
          input_artifact: string;
          output_artifacts: string[];
        };
      })
    | null;
  task_states: DatasetCurationQueueTaskState[];
  blockers: DatasetCurationQueueBlocker[];
};

export type DatasetCurationQueueVerifyReport = {
  schema_version: 1;
  generated_at_utc: string;
  status: 'passed' | 'blocked';
  queue_dir: string;
  scope: {
    entity_type: DatasetCurationQueueEntityType | null;
    task_id: string | null;
  };
  counts: {
    total: number;
    complete: number;
    pending: number;
    waiting_dependencies: number;
    blocked: number;
  };
  task_states: DatasetCurationQueueTaskState[];
  blockers: DatasetCurationQueueBlocker[];
};

type QueueRow = {
  entityType: DatasetCurationQueueEntityType;
  sourcePath: string;
  sourceIndex: number;
  row: JsonObject;
  payload: JsonObject;
  id: string;
  version: string;
};

type FlowRef = {
  id: string;
  version: string | null;
  path: string;
};

type DeferredFlowRef = FlowRef & {
  actionItemCode: string | null;
  reason: string | null;
};

const DEFAULT_VERSION = 'unversioned';

export async function runDatasetCurationQueueBuild(
  options: RunDatasetCurationQueueBuildOptions,
): Promise<DatasetCurationQueueBuildReport> {
  const outDir = requirePath(options.outDir, '--out-dir');
  const processesPath = requireExistingPath(options.processesPath, '--processes');
  const flowsPath = options.flowsPath ? requireExistingPath(options.flowsPath, '--flows') : null;
  const supportPaths = (options.supportPaths ?? []).map((inputPath) =>
    requireExistingPath(inputPath, '--support'),
  );
  const externalFlowRefPaths = (options.externalFlowRefPaths ?? []).map((inputPath) =>
    requireExistingPath(inputPath, '--external-flow-ref'),
  );
  const processLimit = normalizeProcessLimit(options.processLimit);
  const excludedProcessIds = new Set((options.excludeProcessIds ?? []).map((id) => id.trim()));

  const supportRows = supportPaths.flatMap((inputPath) => readQueueRows(inputPath, 'support'));
  const flowRows = flowsPath ? readQueueRows(flowsPath, 'flow') : [];
  const processRows = readQueueRows(processesPath, 'process')
    .filter((row) => !excludedProcessIds.has(row.id))
    .slice(0, processLimit ?? undefined);
  const externalFlowRefs = externalFlowRefPaths.flatMap((inputPath) =>
    readExternalFlowRefs(inputPath),
  );

  mkdirSync(outDir, { recursive: true });

  const localFlowTasks = new Map<string, string>();
  const flowRowsById = new Map<string, QueueRow>();
  for (const row of flowRows) {
    const taskId = taskIdFor(row.entityType, row.id, row.version);
    localFlowTasks.set(row.id, taskId);
    flowRowsById.set(row.id, row);
  }

  const externalFlowIds = new Set(externalFlowRefs.map((ref) => ref.id));
  const blockers: DatasetCurationQueueBlocker[] = [];
  const supportTasks = supportRows.map((row) => buildTask(outDir, row, []));
  const flowTasks = flowRows.map((row) => buildTask(outDir, row, []));
  const processTasks = processRows.map((row) => {
    const refs = extractProcessFlowRefs(row.payload);
    const deferredRefs = extractDeferredProcessFlowRefs(row.payload);
    const deferredRefKeys = deferredProcessFlowRefKeys(deferredRefs);
    const dependsOn = new Set<string>();
    const missingRefs: FlowRef[] = [];
    for (const ref of refs) {
      const taskId = localFlowTasks.get(ref.id);
      if (taskId) {
        dependsOn.add(taskId);
      } else if (!externalFlowIds.has(ref.id) && !deferredRefKeys.has(flowRefKey(ref))) {
        missingRefs.push(ref);
      }
    }
    if (missingRefs.length > 0) {
      blockers.push({
        schema_version: 1,
        code: 'process_flow_reference_unresolved',
        severity: 'blocker',
        entity_type: 'process',
        entity_id: row.id,
        version: row.version,
        message:
          'Process references flows that are neither present in local flow rows nor declared as external flow refs.',
        details: { missing_flow_refs: missingRefs },
      });
    }
    return buildTask(outDir, row, [...dependsOn].sort());
  });
  const tasks = [...supportTasks, ...flowTasks, ...processTasks];
  const taskRows = [
    ...supportRows.map((row, index) => ({ row, task: supportTasks[index] })),
    ...flowRows.map((row, index) => ({ row, task: flowTasks[index] })),
    ...processRows.map((row, index) => ({ row, task: processTasks[index] })),
  ];

  for (const { row, task } of taskRows) {
    writeEntityArtifacts({
      row,
      task,
      flowRefs: row.entityType === 'process' ? extractProcessFlowRefs(row.payload) : [],
      deferredFlowRefs:
        row.entityType === 'process' ? extractDeferredProcessFlowRefs(row.payload) : [],
      externalFlowIds,
      flowRowsById,
    });
  }

  const outputsDir = path.join(outDir, 'outputs');
  mkdirSync(outputsDir, { recursive: true });
  const manifestPath = path.join(outputsDir, 'curation-queue-manifest.json');
  const tasksPath = path.join(outputsDir, 'curation-queue-tasks.jsonl');
  const locksPath = path.join(outputsDir, 'curation-queue-locks.json');
  const blockersPath = path.join(outputsDir, 'curation-queue-blockers.jsonl');
  const inputHashes = buildInputHashes([
    processesPath,
    ...(flowsPath ? [flowsPath] : []),
    ...supportPaths,
    ...externalFlowRefPaths,
  ]);
  const locks = {
    schema_version: 1,
    generated_at_utc: new Date().toISOString(),
    locks: tasks.map((task) => ({
      lock_key: task.lock_key,
      task_id: task.task_id,
      entity_type: task.entity_type,
      entity_id: task.entity_id,
      version: task.version,
      status: 'available',
    })),
  };
  const report: DatasetCurationQueueBuildReport = {
    schema_version: 1,
    generated_at_utc: new Date().toISOString(),
    status: blockers.length > 0 ? 'blocked' : 'ready',
    out_dir: path.resolve(outDir),
    inputs: {
      processes: path.resolve(processesPath),
      flows: flowsPath ? path.resolve(flowsPath) : null,
      support: supportPaths.map((inputPath) => path.resolve(inputPath)),
      external_flow_refs: externalFlowRefPaths.map((inputPath) => path.resolve(inputPath)),
    },
    counts: {
      support_rows: supportRows.length,
      flow_rows: flowRows.length,
      process_rows: processRows.length,
      external_flow_refs: externalFlowRefs.length,
      tasks: tasks.length,
      blockers: blockers.length,
    },
    hashes: {
      inputs: inputHashes,
      task_order: sha256(tasks.map((task) => task.task_id).join('\n')),
    },
    files: {
      manifest: manifestPath,
      tasks: tasksPath,
      locks: locksPath,
      blockers: blockersPath,
    },
    tasks,
    blockers,
  };

  writeJson(manifestPath, report);
  writeText(tasksPath, jsonLines(tasks));
  writeJson(locksPath, locks);
  writeText(blockersPath, jsonLines(blockers));
  return report;
}

export async function runDatasetCurationQueueNext(
  options: RunDatasetCurationQueueNextOptions,
): Promise<DatasetCurationQueueNextReport> {
  const queue = readQueueRuntime(options.queueDir);
  const scope = normalizeQueueScope(options);
  const taskStates = buildTaskStates(queue.tasks).filter((state) => taskMatchesScope(state, scope));
  const scopedTasks = queue.tasks.filter((task) => taskMatchesScope(task, scope));
  const stateByTaskId = new Map(taskStates.map((state) => [state.task_id, state]));
  const runnable = scopedTasks.filter(
    (task) => stateByTaskId.get(task.task_id)?.status === 'pending',
  );
  const counts = countTaskStates(taskStates);
  const status =
    queue.blockers.length > 0 ||
    (taskStates.length > 0 && runnable.length === 0 && counts.complete < taskStates.length)
      ? 'blocked'
      : counts.complete === taskStates.length
        ? 'complete'
        : 'ready';
  const nextTask = status === 'ready' && runnable[0] ? withQueueAction(runnable[0]) : null;
  return {
    schema_version: 1,
    generated_at_utc: new Date().toISOString(),
    status,
    queue_dir: queue.queueDir,
    scope,
    counts: {
      ...counts,
      runnable: runnable.length,
    },
    next_task: nextTask,
    task_states: taskStates,
    blockers: queue.blockers,
  };
}

export async function runDatasetCurationQueueVerify(
  options: RunDatasetCurationQueueVerifyOptions,
): Promise<DatasetCurationQueueVerifyReport> {
  const queue = readQueueRuntime(options.queueDir);
  const scope = normalizeQueueScope(options);
  const taskStates = buildTaskStates(queue.tasks).filter((state) => taskMatchesScope(state, scope));
  const counts = countTaskStates(taskStates);
  return {
    schema_version: 1,
    generated_at_utc: new Date().toISOString(),
    status:
      queue.blockers.length === 0 && counts.complete === taskStates.length ? 'passed' : 'blocked',
    queue_dir: queue.queueDir,
    scope,
    counts,
    task_states: taskStates,
    blockers: queue.blockers,
  };
}

function readQueueRuntime(queueDirInput: string): {
  queueDir: string;
  tasks: DatasetCurationQueueTask[];
  blockers: DatasetCurationQueueBlocker[];
} {
  const queueDir = requireExistingPath(queueDirInput, '--queue-dir');
  const outputsDir = path.join(queueDir, 'outputs');
  const tasksPath = path.join(outputsDir, 'curation-queue-tasks.jsonl');
  const blockersPath = path.join(outputsDir, 'curation-queue-blockers.jsonl');
  if (!existsSync(tasksPath)) {
    throw new CliError(`curation queue tasks file does not exist: ${tasksPath}`, {
      code: 'CURATION_QUEUE_TASKS_NOT_FOUND',
      exitCode: 2,
    });
  }
  if (!existsSync(blockersPath)) {
    throw new CliError(`curation queue blockers file does not exist: ${blockersPath}`, {
      code: 'CURATION_QUEUE_BLOCKERS_NOT_FOUND',
      exitCode: 2,
    });
  }
  return {
    queueDir: path.resolve(queueDir),
    tasks: readJsonlFile(tasksPath).map((value, index) => parseQueueTask(value, tasksPath, index)),
    blockers: readJsonlFile(blockersPath).map((value, index) =>
      parseQueueBlocker(value, blockersPath, index),
    ),
  };
}

function normalizeQueueScope(options: {
  entityType?: DatasetCurationQueueEntityType;
  taskId?: string;
}): { entity_type: DatasetCurationQueueEntityType | null; task_id: string | null } {
  return {
    entity_type: options.entityType ?? null,
    task_id: options.taskId?.trim() || null,
  };
}

function buildTaskStates(tasks: DatasetCurationQueueTask[]): DatasetCurationQueueTaskState[] {
  const completeTaskIds = new Set(
    tasks
      .filter((task) => isCompleteCheckpointStatus(readCheckpointStatus(task.checkpoint_file)))
      .map((task) => task.task_id),
  );
  return tasks.map((task) => {
    const checkpointStatus = readCheckpointStatus(task.checkpoint_file);
    const incompleteDependencies = task.depends_on.filter((taskId) => !completeTaskIds.has(taskId));
    const status = taskRuntimeStatus(checkpointStatus, incompleteDependencies);
    return {
      task_id: task.task_id,
      entity_type: task.entity_type,
      entity_id: task.entity_id,
      version: task.version,
      status,
      checkpoint_status: checkpointStatus,
      checkpoint_file: task.checkpoint_file,
      depends_on: task.depends_on,
      incomplete_dependencies: incompleteDependencies,
      reason:
        status === 'waiting_dependencies'
          ? 'dependency checkpoints are not complete'
          : status === 'blocked'
            ? 'checkpoint status is blocked or failed'
            : null,
    };
  });
}

function taskRuntimeStatus(
  checkpointStatus: string | null,
  incompleteDependencies: string[],
): DatasetCurationQueueTaskRuntimeStatus {
  if (isCompleteCheckpointStatus(checkpointStatus)) {
    return 'complete';
  }
  if (checkpointStatus === 'blocked' || checkpointStatus === 'failed') {
    return 'blocked';
  }
  if (incompleteDependencies.length > 0) {
    return 'waiting_dependencies';
  }
  return 'pending';
}

function isCompleteCheckpointStatus(status: string | null): boolean {
  return (
    status === 'passed' || status === 'complete' || status === 'completed' || status === 'waived'
  );
}

function readCheckpointStatus(checkpointFile: string): string | null {
  const resolvedPath = path.resolve(checkpointFile);
  if (!existsSync(resolvedPath)) {
    return null;
  }
  try {
    const value = JSON.parse(readFileSync(resolvedPath, 'utf8')) as unknown;
    if (!isRecord(value)) {
      return 'blocked';
    }
    const status = firstNonEmpty(value.status, value.state);
    return status ? status.toLowerCase() : 'blocked';
  } catch {
    return 'blocked';
  }
}

function taskMatchesScope(
  task: Pick<DatasetCurationQueueTask, 'entity_type' | 'task_id'>,
  scope: { entity_type: DatasetCurationQueueEntityType | null; task_id: string | null },
): boolean {
  if (scope.entity_type && task.entity_type !== scope.entity_type) {
    return false;
  }
  if (scope.task_id && task.task_id !== scope.task_id) {
    return false;
  }
  return true;
}

function countTaskStates(taskStates: DatasetCurationQueueTaskState[]): {
  total: number;
  complete: number;
  pending: number;
  waiting_dependencies: number;
  blocked: number;
} {
  return {
    total: taskStates.length,
    complete: taskStates.filter((state) => state.status === 'complete').length,
    pending: taskStates.filter((state) => state.status === 'pending').length,
    waiting_dependencies: taskStates.filter((state) => state.status === 'waiting_dependencies')
      .length,
    blocked: taskStates.filter((state) => state.status === 'blocked').length,
  };
}

function withQueueAction(task: DatasetCurationQueueTask): DatasetCurationQueueTask & {
  action: {
    kind: 'entity_curation_task';
    input_artifact: string;
    output_artifacts: string[];
  };
} {
  return {
    ...task,
    action: {
      kind: 'entity_curation_task',
      input_artifact: task.input_rows_file,
      output_artifacts: [task.checkpoint_file],
    },
  };
}

function readJsonlFile(inputPath: string): unknown[] {
  const text = readFileSync(inputPath, 'utf8').trim();
  if (!text) {
    return [];
  }
  return text.split(/\r?\n/u).map((line, index) => {
    try {
      return JSON.parse(line) as unknown;
    } catch (error) {
      throw new CliError(`Invalid JSONL in ${inputPath} at line ${index + 1}: ${String(error)}`, {
        code: 'CURATION_QUEUE_JSONL_INVALID',
        exitCode: 2,
      });
    }
  });
}

function parseQueueTask(
  value: unknown,
  inputPath: string,
  index: number,
): DatasetCurationQueueTask {
  if (!isRecord(value)) {
    throw new CliError(`Invalid queue task in ${inputPath} at line ${index + 1}.`, {
      code: 'CURATION_QUEUE_TASK_INVALID',
      exitCode: 2,
    });
  }
  const entityType = value.entity_type;
  if (entityType !== 'support' && entityType !== 'flow' && entityType !== 'process') {
    throw new CliError(`Invalid queue task entity_type in ${inputPath} at line ${index + 1}.`, {
      code: 'CURATION_QUEUE_TASK_INVALID',
      exitCode: 2,
    });
  }
  return {
    schema_version: 1,
    entity_type: entityType,
    task_id: requireString(value.task_id, inputPath, index, 'task_id'),
    entity_id: requireString(value.entity_id, inputPath, index, 'entity_id'),
    version: requireString(value.version, inputPath, index, 'version'),
    lock_key: requireString(value.lock_key, inputPath, index, 'lock_key'),
    depends_on: Array.isArray(value.depends_on)
      ? value.depends_on.filter((item): item is string => typeof item === 'string')
      : [],
    input_rows_file: requireString(value.input_rows_file, inputPath, index, 'input_rows_file'),
    work_dir: requireString(value.work_dir, inputPath, index, 'work_dir'),
    checkpoint_file: requireString(value.checkpoint_file, inputPath, index, 'checkpoint_file'),
    run_plan_file: requireString(value.run_plan_file, inputPath, index, 'run_plan_file'),
    closure_file: requireString(value.closure_file, inputPath, index, 'closure_file'),
  };
}

function parseQueueBlocker(
  value: unknown,
  inputPath: string,
  index: number,
): DatasetCurationQueueBlocker {
  if (!isRecord(value)) {
    throw new CliError(`Invalid queue blocker in ${inputPath} at line ${index + 1}.`, {
      code: 'CURATION_QUEUE_BLOCKER_INVALID',
      exitCode: 2,
    });
  }
  const entityType = value.entity_type;
  if (entityType !== 'support' && entityType !== 'flow' && entityType !== 'process') {
    throw new CliError(`Invalid queue blocker entity_type in ${inputPath} at line ${index + 1}.`, {
      code: 'CURATION_QUEUE_BLOCKER_INVALID',
      exitCode: 2,
    });
  }
  return {
    schema_version: 1,
    code: requireString(value.code, inputPath, index, 'code'),
    severity: 'blocker',
    entity_type: entityType,
    entity_id: typeof value.entity_id === 'string' ? value.entity_id : null,
    version: typeof value.version === 'string' ? value.version : null,
    message: requireString(value.message, inputPath, index, 'message'),
    details: value.details,
  };
}

function requireString(value: unknown, inputPath: string, index: number, field: string): string {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  throw new CliError(`Invalid or missing ${field} in ${inputPath} at line ${index + 1}.`, {
    code: 'CURATION_QUEUE_TASK_INVALID',
    exitCode: 2,
  });
}

function readQueueRows(inputPath: string, entityType: DatasetCurationQueueEntityType): QueueRow[] {
  const rows = materializeDatasetRows(inputPath);
  return rows.map((row) => queueRowFromDatasetRow(inputPath, entityType, row));
}

function queueRowFromDatasetRow(
  inputPath: string,
  entityType: DatasetCurationQueueEntityType,
  row: DatasetRowInput,
): QueueRow {
  const tidasIdentity = genericTidasDatasetIdentity(row.payload);
  const id = firstNonEmpty(row.id, row.row.id, row.row.dataset_id, row.row.uuid, tidasIdentity.id);
  if (!id) {
    throw new CliError(
      `${entityType} row is missing a stable id in ${inputPath} at index ${row.index}.`,
      {
        code: 'CURATION_QUEUE_ROW_ID_MISSING',
        exitCode: 2,
      },
    );
  }
  return {
    entityType,
    sourcePath: inputPath,
    sourceIndex: row.index,
    row: row.row,
    payload: row.payload,
    id,
    version: firstNonEmpty(row.version, row.row.version, tidasIdentity.version) ?? DEFAULT_VERSION,
  };
}

function genericTidasDatasetIdentity(payload: JsonObject): {
  id: string | null;
  version: string | null;
} {
  const root = genericTidasDatasetRoot(payload);
  const information = Object.values(root).find(
    (value) => isRecord(value) && isRecord(value.dataSetInformation),
  );
  const dataSetInformation =
    isRecord(information) && isRecord(information.dataSetInformation)
      ? information.dataSetInformation
      : {};
  const administrativeInformation = isRecord(root.administrativeInformation)
    ? root.administrativeInformation
    : {};
  const publicationAndOwnership = isRecord(administrativeInformation.publicationAndOwnership)
    ? administrativeInformation.publicationAndOwnership
    : {};

  return {
    id: firstNonEmpty(dataSetInformation['common:UUID']),
    version: firstNonEmpty(publicationAndOwnership['common:dataSetVersion']),
  };
}

function genericTidasDatasetRoot(payload: JsonObject): JsonObject {
  const datasetRoots: JsonObject[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (key.endsWith('DataSet') && isRecord(value)) {
      datasetRoots.push(value);
    }
  }
  return datasetRoots.length === 1 ? datasetRoots[0] : payload;
}

function buildTask(outDir: string, row: QueueRow, dependsOn: string[]): DatasetCurationQueueTask {
  const taskId = taskIdFor(row.entityType, row.id, row.version);
  const workDir = path.join(
    outDir,
    'entities',
    entityDirPlural(row.entityType),
    entityDirName(row.id, row.version),
  );
  return {
    schema_version: 1,
    entity_type: row.entityType,
    task_id: taskId,
    entity_id: row.id,
    version: row.version,
    lock_key: taskId,
    depends_on: dependsOn,
    input_rows_file: path.join(workDir, 'input.jsonl'),
    work_dir: workDir,
    checkpoint_file: path.join(workDir, 'checkpoint.json'),
    run_plan_file: path.join(workDir, 'entity-run-plan.json'),
    closure_file: path.join(workDir, 'closure.json'),
  };
}

function writeEntityArtifacts(options: {
  row: QueueRow;
  task: DatasetCurationQueueTask;
  flowRefs: FlowRef[];
  deferredFlowRefs: DeferredFlowRef[];
  externalFlowIds: Set<string>;
  flowRowsById: Map<string, QueueRow>;
}): void {
  mkdirSync(path.join(options.task.work_dir, 'checkpoints'), { recursive: true });
  writeText(options.task.input_rows_file, jsonLines([options.row.row]));
  writeJson(options.task.closure_file, {
    schema_version: 1,
    entity_type: options.row.entityType,
    entity_id: options.row.id,
    version: options.row.version,
    source: {
      file: path.resolve(options.row.sourcePath),
      index: options.row.sourceIndex,
    },
    dependencies: buildDependencyClosure(options),
  });
  writeJson(options.task.run_plan_file, buildRunPlan(options.task));
}

function buildDependencyClosure(options: {
  row: QueueRow;
  task: DatasetCurationQueueTask;
  flowRefs: FlowRef[];
  deferredFlowRefs: DeferredFlowRef[];
  externalFlowIds: Set<string>;
  flowRowsById: Map<string, QueueRow>;
}): unknown {
  if (options.row.entityType !== 'process') {
    return {
      local_tasks: [],
      external_refs: [],
      deferred_refs: [],
      unresolved_refs: [],
    };
  }
  const deferredRefKeys = deferredProcessFlowRefKeys(options.deferredFlowRefs);
  return {
    local_tasks: options.flowRefs
      .map((ref) => ({ ref, row: options.flowRowsById.get(ref.id) }))
      .filter((item): item is { ref: FlowRef; row: QueueRow } => Boolean(item.row))
      .map(({ ref, row }) => ({
        entity_type: 'flow',
        entity_id: ref.id,
        version: row.version,
        task_id: taskIdFor('flow', ref.id, row.version),
        ref_path: ref.path,
      })),
    external_refs: options.flowRefs
      .filter((ref) => !options.flowRowsById.has(ref.id) && options.externalFlowIds.has(ref.id))
      .map((ref) => ({
        entity_type: 'flow',
        entity_id: ref.id,
        version: ref.version,
        ref_path: ref.path,
      })),
    deferred_refs: options.flowRefs
      .filter(
        (ref) =>
          !options.flowRowsById.has(ref.id) &&
          !options.externalFlowIds.has(ref.id) &&
          deferredRefKeys.has(flowRefKey(ref)),
      )
      .map((ref) => {
        const deferredRef = deferredRefKeys.get(flowRefKey(ref))!;
        return {
          entity_type: 'flow',
          entity_id: ref.id,
          version: ref.version,
          ref_path: ref.path,
          action_item_code: deferredRef.actionItemCode,
          reason: deferredRef.reason ?? null,
        };
      }),
    unresolved_refs: options.flowRefs
      .filter(
        (ref) =>
          !options.flowRowsById.has(ref.id) &&
          !options.externalFlowIds.has(ref.id) &&
          !deferredRefKeys.has(flowRefKey(ref)),
      )
      .map((ref) => ({
        entity_type: 'flow',
        entity_id: ref.id,
        version: ref.version,
        ref_path: ref.path,
      })),
  };
}

function buildRunPlan(task: DatasetCurationQueueTask): unknown {
  const stagesByType: Record<DatasetCurationQueueEntityType, string[]> = {
    support: ['identity', 'schema', 'qa_or_profile', 'checkpoint'],
    flow: ['identity', 'name_plan', 'schema', 'qa', 'checkpoint'],
    process: [
      'dependency_closure',
      'reference_refresh',
      'required_fields',
      'schema',
      'qa',
      'curation',
      'remote_dry_run',
      'readback',
    ],
  };
  return {
    schema_version: 1,
    task_id: task.task_id,
    entity_type: task.entity_type,
    entity_id: task.entity_id,
    version: task.version,
    input_rows_file: task.input_rows_file,
    checkpoint_file: task.checkpoint_file,
    stages: stagesByType[task.entity_type].map((stage) => ({
      id: stage,
      status: 'pending',
      checkpoint_file: path.join(task.work_dir, 'checkpoints', `${stage}.json`),
    })),
    ai_authoring_policy: {
      output_only: 'structured_patch_or_build_plan',
      deterministic_apply_required: true,
      remote_write_allowed: false,
    },
  };
}

function extractDeferredProcessFlowRefs(payload: unknown): DeferredFlowRef[] {
  const refs = new Map<string, DeferredFlowRef>();
  scanForDeferredProcessFlowRefs(payload, refs);
  return [...refs.values()].sort((a, b) =>
    `${a.id}@${a.version ?? ''}@${a.path}`.localeCompare(`${b.id}@${b.version ?? ''}@${b.path}`),
  );
}

function scanForDeferredProcessFlowRefs(value: unknown, refs: Map<string, DeferredFlowRef>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => scanForDeferredProcessFlowRefs(item, refs));
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  const traces = asList(value['tiangongfoundry:unresolvedTrace']);
  for (const trace of traces) {
    if (!isRecord(trace)) {
      continue;
    }
    const actionItemCode = firstNonEmpty(trace.action_item_code, trace.actionItemCode);
    if (actionItemCode !== 'elementary_flow_identity_manual_review') {
      continue;
    }
    const id = firstNonEmpty(trace.reference_id, trace.referenceId, trace.ref_object_id);
    const pathValue = firstNonEmpty(trace.blocked_path, trace.blockedPath, trace.path);
    if (!id || !pathValue) {
      continue;
    }
    const version = firstNonEmpty(trace.reference_version, trace.referenceVersion, trace.version);
    const ref = {
      id,
      version,
      path: normalizeReferencePath(pathValue),
      actionItemCode,
      reason: firstNonEmpty(trace.reason),
    };
    refs.set(flowRefKey(ref), ref);
  }

  for (const nested of Object.values(value)) {
    scanForDeferredProcessFlowRefs(nested, refs);
  }
}

function deferredProcessFlowRefKeys(refs: DeferredFlowRef[]): Map<string, DeferredFlowRef> {
  const keys = new Map<string, DeferredFlowRef>();
  for (const ref of refs) {
    keys.set(flowRefKey(ref), ref);
  }
  return keys;
}

function flowRefKey(ref: FlowRef): string {
  return `${ref.id}@${ref.version ?? ''}@${normalizeReferencePath(ref.path)}`;
}

function normalizeReferencePath(value: string): string {
  return value
    .replace(/^\/+/u, '')
    .replace(/\/+/gu, '.')
    .replace(/^\.+|\.+$/gu, '');
}

function isFoundryTracePathParts(pathParts: string[]): boolean {
  return (
    pathParts.includes('common:other') &&
    pathParts.some(
      (part) => part.startsWith('tiangongfoundry:') && part.toLowerCase().includes('trace'),
    )
  );
}

function extractProcessFlowRefs(payload: unknown): FlowRef[] {
  const refs = new Map<string, FlowRef>();
  scanForFlowRefs(payload, [], refs);
  return [...refs.values()].sort((a, b) =>
    `${a.id}@${a.version ?? ''}`.localeCompare(`${b.id}@${b.version ?? ''}`),
  );
}

function scanForFlowRefs(value: unknown, pathParts: string[], refs: Map<string, FlowRef>): void {
  if (isFoundryTracePathParts(pathParts)) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForFlowRefs(item, [...pathParts, String(index)], refs));
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  const keyPath = pathParts.join('.');
  const keyHint = keyPath.toLowerCase();
  const looksLikeFlowRef =
    keyHint.includes('referencetoflowdataset') ||
    keyHint.includes('reference_to_flow_dataset') ||
    keyHint.includes('flowdataset') ||
    keyHint.includes('flow_dataset');
  if (looksLikeFlowRef) {
    const id = firstNonEmpty(
      value['@refObjectId'],
      value.refObjectId,
      value.ref_object_id,
      value.id,
      value.uuid,
      value['common:UUID'],
    );
    if (id) {
      const version = firstNonEmpty(
        value['@version'],
        value.version,
        value.dataSetVersion,
        value['common:dataSetVersion'],
      );
      refs.set(`${id}@${version ?? ''}@${keyPath}`, {
        id,
        version,
        path: keyPath,
      });
    }
  }

  for (const [key, nested] of Object.entries(value)) {
    scanForFlowRefs(nested, [...pathParts, key], refs);
  }
}

function readExternalFlowRefs(inputPath: string): FlowRef[] {
  const rows = materializeDatasetRows(inputPath);
  return rows.map((row) => {
    const id = firstNonEmpty(row.id, row.row.id, row.row.dataset_id, row.row.uuid);
    if (!id) {
      throw new CliError(`External flow ref is missing id in ${inputPath} at index ${row.index}.`, {
        code: 'CURATION_QUEUE_EXTERNAL_FLOW_REF_ID_MISSING',
        exitCode: 2,
      });
    }
    return {
      id,
      version: firstNonEmpty(row.version, row.row.version) ?? null,
      path: `${inputPath}#${row.index}`,
    };
  });
}

function asList(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function normalizeProcessLimit(value: number | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new CliError('--process-limit must be a positive integer.', {
      code: 'CURATION_QUEUE_PROCESS_LIMIT_INVALID',
      exitCode: 2,
    });
  }
  return value;
}

function requirePath(value: string | undefined, flag: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new CliError(`${flag} is required.`, {
      code: 'CURATION_QUEUE_REQUIRED_FLAG_MISSING',
      exitCode: 2,
    });
  }
  return trimmed;
}

function requireExistingPath(value: string | undefined, flag: string): string {
  const inputPath = requirePath(value, flag);
  if (!existsSync(inputPath)) {
    throw new CliError(`${flag} file does not exist: ${inputPath}`, {
      code: 'CURATION_QUEUE_INPUT_NOT_FOUND',
      exitCode: 2,
    });
  }
  return inputPath;
}

function entityDirPlural(entityType: DatasetCurationQueueEntityType): string {
  return entityType === 'process' ? 'processes' : entityType === 'flow' ? 'flows' : 'supports';
}

function entityDirName(id: string, version: string): string {
  return `${sanitizePathToken(id)}__${sanitizePathToken(version)}`;
}

function taskIdFor(
  entityType: DatasetCurationQueueEntityType,
  id: string,
  version: string,
): string {
  return `${entityType}:${id}@${version}`;
}

function sanitizePathToken(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/gu, '_').replace(/^_+|_+$/gu, '') || 'unknown';
}

function buildInputHashes(inputPaths: string[]): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const inputPath of inputPaths) {
    hashes[path.resolve(inputPath)] = sha256(readFileSync(inputPath));
  }
  return hashes;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath: string, value: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, value, 'utf8');
}

function jsonLines(rows: unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : '');
}

export const __testInternals = {
  buildTaskStates,
  countTaskStates,
  entityDirName,
  entityDirPlural,
  extractDeferredProcessFlowRefs,
  extractProcessFlowRefs,
  jsonLines,
  normalizeReferencePath,
  normalizeProcessLimit,
  normalizeQueueScope,
  parseQueueBlocker,
  parseQueueTask,
  readCheckpointStatus,
  readJsonlFile,
  readQueueRuntime,
  requireExistingPath,
  requirePath,
  sanitizePathToken,
  taskIdFor,
  taskMatchesScope,
  taskRuntimeStatus,
  withQueueAction,
};
