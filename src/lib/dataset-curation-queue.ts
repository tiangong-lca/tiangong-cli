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
    const dependsOn = new Set<string>();
    const missingRefs: FlowRef[] = [];
    for (const ref of refs) {
      const taskId = localFlowTasks.get(ref.id);
      if (taskId) {
        dependsOn.add(taskId);
      } else if (!externalFlowIds.has(ref.id)) {
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
  externalFlowIds: Set<string>;
  flowRowsById: Map<string, QueueRow>;
}): unknown {
  if (options.row.entityType !== 'process') {
    return {
      local_tasks: [],
      external_refs: [],
      unresolved_refs: [],
    };
  }
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
    unresolved_refs: options.flowRefs
      .filter((ref) => !options.flowRowsById.has(ref.id) && !options.externalFlowIds.has(ref.id))
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

function extractProcessFlowRefs(payload: unknown): FlowRef[] {
  const refs = new Map<string, FlowRef>();
  scanForFlowRefs(payload, [], refs);
  return [...refs.values()].sort((a, b) =>
    `${a.id}@${a.version ?? ''}`.localeCompare(`${b.id}@${b.version ?? ''}`),
  );
}

function scanForFlowRefs(value: unknown, pathParts: string[], refs: Map<string, FlowRef>): void {
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
  extractProcessFlowRefs,
};
