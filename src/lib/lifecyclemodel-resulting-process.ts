import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJsonArtifact } from './artifacts.js';
import { CliError } from './errors.js';
import { readJsonInput } from './io.js';
import { buildRunId, resolveRunLayout } from './run.js';

type JsonObject = Record<string, unknown>;

const DEFAULT_DATASET_VERSION = '00.00.001';
const EPSILON = 1e-10;

export type ProjectionMode = 'primary-only' | 'all-subproducts';
export type PublishIntent = 'dry_run' | 'prepare_only' | 'publish';

export type LifecyclemodelResultingProcessRequest = {
  source_model: {
    id: string | null;
    version: string | null;
    name: string | null;
    json_ordered_path: string | null;
    json_ordered: JsonObject | null;
  };
  projection: {
    mode: ProjectionMode;
    process_id: string | null;
    process_version: string | null;
    metadata_overrides: JsonObject;
    attach_graph_snapshot: boolean;
    attach_graph_snapshot_uri: string | null;
  };
  process_sources: {
    process_catalog_path: string | null;
    run_dirs: string[];
    process_json_dirs: string[];
    process_json_files: string[];
    allow_remote_lookup: boolean;
  };
  publish: {
    intent: PublishIntent;
    prepare_process_payloads: boolean;
    prepare_relation_payloads: boolean;
  };
};

export type LifecyclemodelResultingProcessReport = {
  generated_at_utc: string;
  request_path: string;
  out_dir: string;
  status: string;
  projected_process_count: number;
  relation_count: number;
  source_model: {
    id: string;
    version: string;
    name: string;
    json_ordered_path: string | null;
    reference_to_resulting_process_id: string | null;
    reference_to_resulting_process_version: string | null;
    reference_process_instance_id: string | null;
  };
  files: {
    normalized_request: string;
    source_model_normalized: string;
    source_model_summary: string;
    projection_report: string;
    process_projection_bundle: string;
  };
};

export type RunLifecyclemodelResultingProcessOptions = {
  inputPath: string;
  outDir?: string | null;
  now?: Date;
};

type ProcessRecord = {
  processUuid: string;
  version: string;
  raw: JsonObject;
  sourceLabel: string;
  sourcePath: string | null;
  referenceExchangeInternalId: string;
  referenceFlowUuid: string;
  referenceDirection: string;
  referenceAmount: number;
  inputAmounts: Record<string, number>;
  outputAmounts: Record<string, number>;
};

type ProcessInstance = {
  instance_id: string;
  process_id: string;
  process_version: string;
  label: string;
  multiplication_factor: number;
  reference_to_process: JsonObject;
  raw: JsonObject;
};

type Edge = {
  edge_id: string;
  from: string;
  to: string;
  exchange_id: string | null;
  flow_uuid: string | null;
};

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ensureList<T = unknown>(value: unknown): T[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? (value as T[]) : ([value] as T[]);
}

function copyJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function firstNonEmpty(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();

  values.forEach((value) => {
    if (!value) {
      return;
    }

    if (seen.has(value)) {
      return;
    }

    seen.add(value);
    unique.push(value);
  });

  return unique;
}

function sha256Text(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

function resolveInputPath(baseDir: string, value: string): string;
function resolveInputPath(baseDir: string, value: unknown): string | null;
function resolveInputPath(baseDir: string, value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.startsWith('file:')) {
    return trimmed;
  }

  if (trimmed.includes('://')) {
    return trimmed;
  }

  return path.resolve(baseDir, trimmed);
}

function resolveLocalPath(value: string, fieldName: string): string {
  if (value.startsWith('file:')) {
    return fileURLToPath(value);
  }

  if (value.includes('://')) {
    throw new CliError(`${fieldName} must resolve to a local filesystem path.`, {
      code: 'LIFECYCLEMODEL_LOCAL_PATH_REQUIRED',
      exitCode: 2,
      details: value,
    });
  }

  return path.resolve(value);
}

function readJsonObject(filePath: string, code: string): JsonObject {
  const value = readJsonInput(filePath);
  if (!isRecord(value)) {
    throw new CliError(`Expected a JSON object file: ${filePath}`, {
      code,
      exitCode: 2,
    });
  }

  return value;
}

function toFiniteNumber(value: unknown, fieldName: string): number {
  if (value === undefined || value === null || value === '') {
    return 0;
  }

  const parsed = typeof value === 'number' ? value : Number(String(value));
  if (!Number.isFinite(parsed)) {
    throw new CliError(`Expected a numeric value for ${fieldName}.`, {
      code: 'LIFECYCLEMODEL_INVALID_NUMBER',
      exitCode: 2,
      details: { fieldName, value },
    });
  }

  return parsed;
}

function normalizeNumericOutput(value: number): number {
  const rounded = Math.abs(value) < EPSILON ? 0 : Number.parseFloat(value.toFixed(12));
  return rounded === 0 ? 0 : rounded;
}

function toBoolean(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
  }

  return Boolean(value);
}

function normalizeStringArray(value: unknown, fieldName: string): string[] {
  const items = ensureList(value);

  return items.map((item, index) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new CliError(`Expected ${fieldName}[${index}] to be a non-empty string.`, {
        code: 'LIFECYCLEMODEL_INVALID_STRING_ARRAY',
        exitCode: 2,
        details: { fieldName, value: item },
      });
    }

    return item.trim();
  });
}

function normalizeProjectionMode(value: unknown): ProjectionMode {
  const mode = firstNonEmpty(value) ?? 'primary-only';
  if (mode === 'primary-only' || mode === 'all-subproducts') {
    return mode;
  }

  throw new CliError('projection.mode must be primary-only or all-subproducts.', {
    code: 'LIFECYCLEMODEL_INVALID_PROJECTION_MODE',
    exitCode: 2,
    details: value,
  });
}

function normalizePublishIntent(value: unknown): PublishIntent {
  const intent = firstNonEmpty(value) ?? 'dry_run';
  if (intent === 'dry_run' || intent === 'prepare_only' || intent === 'publish') {
    return intent;
  }

  throw new CliError('publish.intent must be dry_run, prepare_only, or publish.', {
    code: 'LIFECYCLEMODEL_INVALID_PUBLISH_INTENT',
    exitCode: 2,
    details: value,
  });
}

function normalizeMetadataOverrides(value: unknown): JsonObject {
  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    throw new CliError('projection.metadata_overrides must be a JSON object when provided.', {
      code: 'LIFECYCLEMODEL_INVALID_METADATA_OVERRIDES',
      exitCode: 2,
    });
  }

  return copyJson(value);
}

export function normalizeLifecyclemodelResultingProcessRequest(
  input: unknown,
  options: {
    requestPath: string;
  },
): LifecyclemodelResultingProcessRequest {
  if (!isRecord(input)) {
    throw new CliError('Lifecyclemodel resulting-process request must be a JSON object.', {
      code: 'LIFECYCLEMODEL_REQUEST_NOT_OBJECT',
      exitCode: 2,
    });
  }

  const baseDir = path.dirname(path.resolve(options.requestPath));
  const sourceModelRaw = isRecord(input.source_model) ? input.source_model : {};
  const projectionRaw = isRecord(input.projection) ? input.projection : {};
  const processSourcesRaw = isRecord(input.process_sources) ? input.process_sources : {};
  const publishRaw = isRecord(input.publish) ? input.publish : {};

  const normalized: LifecyclemodelResultingProcessRequest = {
    source_model: {
      id: firstNonEmpty(sourceModelRaw.id),
      version: firstNonEmpty(sourceModelRaw.version),
      name: firstNonEmpty(sourceModelRaw.name),
      json_ordered_path: resolveInputPath(baseDir, sourceModelRaw.json_ordered_path),
      json_ordered: isRecord(sourceModelRaw.json_ordered)
        ? copyJson(sourceModelRaw.json_ordered)
        : null,
    },
    projection: {
      mode: normalizeProjectionMode(projectionRaw.mode),
      process_id: firstNonEmpty(projectionRaw.process_id),
      process_version: firstNonEmpty(projectionRaw.process_version),
      metadata_overrides: normalizeMetadataOverrides(projectionRaw.metadata_overrides),
      attach_graph_snapshot: toBoolean(projectionRaw.attach_graph_snapshot, false),
      attach_graph_snapshot_uri: resolveInputPath(baseDir, projectionRaw.attach_graph_snapshot_uri),
    },
    process_sources: {
      process_catalog_path: (() => {
        const resolved = resolveInputPath(baseDir, processSourcesRaw.process_catalog_path);
        return resolved ? resolveLocalPath(resolved, 'process_sources.process_catalog_path') : null;
      })(),
      run_dirs: normalizeStringArray(processSourcesRaw.run_dirs, 'process_sources.run_dirs').map(
        (item) => resolveLocalPath(resolveInputPath(baseDir, item), 'process_sources.run_dirs'),
      ),
      process_json_dirs: normalizeStringArray(
        processSourcesRaw.process_json_dirs,
        'process_sources.process_json_dirs',
      ).map((item) =>
        resolveLocalPath(resolveInputPath(baseDir, item), 'process_sources.process_json_dirs'),
      ),
      process_json_files: normalizeStringArray(
        processSourcesRaw.process_json_files,
        'process_sources.process_json_files',
      ).map((item) =>
        resolveLocalPath(resolveInputPath(baseDir, item), 'process_sources.process_json_files'),
      ),
      allow_remote_lookup: toBoolean(
        processSourcesRaw.allow_remote_lookup ?? processSourcesRaw.allow_mcp_lookup,
        false,
      ),
    },
    publish: {
      intent: normalizePublishIntent(publishRaw.intent),
      prepare_process_payloads: toBoolean(publishRaw.prepare_process_payloads, true),
      prepare_relation_payloads: toBoolean(publishRaw.prepare_relation_payloads, true),
    },
  };

  if (
    !normalized.source_model.id &&
    !normalized.source_model.json_ordered &&
    !normalized.source_model.json_ordered_path
  ) {
    throw new CliError(
      'source_model must include at least one of id, json_ordered, or json_ordered_path.',
      {
        code: 'LIFECYCLEMODEL_SOURCE_MODEL_REQUIRED',
        exitCode: 2,
      },
    );
  }

  if (!normalized.process_sources.process_catalog_path) {
    normalized.process_sources.process_catalog_path = autoDetectProcessCatalogPath(
      normalized.source_model.json_ordered_path,
    );
  }

  if (normalized.process_sources.process_json_dirs.length === 0) {
    normalized.process_sources.process_json_dirs = autoDetectProcessJsonDirs(
      normalized.source_model.json_ordered_path,
    );
  }

  return normalized;
}

function lifecyclemodelRoot(model: JsonObject): JsonObject {
  return isRecord(model.lifeCycleModelDataSet)
    ? (model.lifeCycleModelDataSet as JsonObject)
    : model;
}

function processDatasetRoot(payload: JsonObject): JsonObject {
  if (isRecord(payload.processDataSet)) {
    return payload.processDataSet;
  }

  for (const key of ['json_ordered', 'json'] as const) {
    const nested = payload[key];
    if (isRecord(nested) && isRecord(nested.processDataSet)) {
      return nested.processDataSet;
    }
  }

  throw new CliError('Process payload does not contain processDataSet.', {
    code: 'LIFECYCLEMODEL_PROCESS_DATASET_REQUIRED',
    exitCode: 2,
  });
}

function resolveNameField(namePayload: unknown): string | null {
  if (typeof namePayload === 'string') {
    return namePayload.trim() || null;
  }

  if (Array.isArray(namePayload)) {
    for (const item of namePayload) {
      const resolved = resolveNameField(item);
      if (resolved) {
        return resolved;
      }
    }
    return null;
  }

  if (!isRecord(namePayload)) {
    return null;
  }

  const direct = firstNonEmpty(namePayload['@index'], namePayload['#text'], namePayload.text);
  if (direct) {
    return direct;
  }

  for (const key of ['baseName', 'shortName', 'name'] as const) {
    const nested = namePayload[key];
    if (isRecord(nested)) {
      const nestedText = firstNonEmpty(nested['@index'], nested['#text'], nested.text);
      if (nestedText) {
        return nestedText;
      }
    }

    const resolved = firstNonEmpty(nested);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function normalizedNameInfo(namePayload: unknown, fallbackText: string): JsonObject {
  if (isRecord(namePayload) && Object.keys(namePayload).length > 0) {
    return copyJson(namePayload);
  }

  return {
    baseName: [
      {
        '@xml:lang': 'en',
        '#text': resolveNameField(namePayload) ?? fallbackText,
      },
    ],
  };
}

function multilangFromText(enText: string, zhText: string): JsonObject[] {
  return [
    {
      '@xml:lang': 'en',
      '#text': enText,
    },
    {
      '@xml:lang': 'zh',
      '#text': zhText,
    },
  ];
}

function modelDatasetVersion(model: JsonObject): string | null {
  const root = lifecyclemodelRoot(model);
  const administrative = isRecord(root.administrativeInformation)
    ? root.administrativeInformation
    : {};
  const publication = isRecord(administrative.publicationAndOwnership)
    ? administrative.publicationAndOwnership
    : isRecord(administrative['common:publicationAndOwnership'])
      ? (administrative['common:publicationAndOwnership'] as JsonObject)
      : {};

  return firstNonEmpty(publication['common:dataSetVersion']);
}

function modelIdentifier(
  model: JsonObject,
  sourceModel: LifecyclemodelResultingProcessRequest['source_model'],
): {
  id: string;
  version: string;
  name: string;
} {
  const root = lifecyclemodelRoot(model);
  const info = isRecord(root.lifeCycleModelInformation) ? root.lifeCycleModelInformation : {};
  const dataInfo = isRecord(info.dataSetInformation) ? info.dataSetInformation : {};
  const modelId =
    firstNonEmpty(
      sourceModel.id,
      dataInfo['common:UUID'],
      root['@id'],
      root.id,
      dataInfo.identifierOfSubDataSet,
    ) ?? `lm-${sha256Text(JSON.stringify(model)).slice(0, 12)}`;
  const version =
    firstNonEmpty(
      sourceModel.version,
      modelDatasetVersion(model),
      root['@version'],
      root.version,
      dataInfo['@version'],
    ) ?? DEFAULT_DATASET_VERSION;
  const name =
    firstNonEmpty(sourceModel.name, resolveNameField(dataInfo.name), root.name) ?? modelId;

  return {
    id: modelId,
    version,
    name,
  };
}

function extractProcessInstances(model: JsonObject): ProcessInstance[] {
  const root = lifecyclemodelRoot(model);
  const info = isRecord(root.lifeCycleModelInformation) ? root.lifeCycleModelInformation : {};
  const technology = isRecord(info.technology)
    ? info.technology
    : isRecord(root.technology)
      ? root.technology
      : {};
  const processes = isRecord(technology.processes) ? technology.processes : {};
  const instances = ensureList<JsonObject>(processes.processInstance);

  return instances.filter(isRecord).map((item, index) => {
    const ref = isRecord(item.referenceToProcess) ? item.referenceToProcess : {};
    return {
      instance_id:
        firstNonEmpty(item['@dataSetInternalID'], item['@id'], item.id) ?? `pi-${index + 1}`,
      process_id: firstNonEmpty(ref['@refObjectId'], ref.id, ref.processId) ?? `proc-${index + 1}`,
      process_version: firstNonEmpty(ref['@version'], ref.version) ?? DEFAULT_DATASET_VERSION,
      label:
        firstNonEmpty(
          resolveNameField(ref['common:shortDescription']),
          resolveNameField(ref.shortDescription),
          resolveNameField(ref.name),
          ref['@refObjectId'],
        ) ?? `process-${index + 1}`,
      multiplication_factor: normalizeNumericOutput(
        toFiniteNumber(item['@multiplicationFactor'], 'processInstance.@multiplicationFactor'),
      ),
      reference_to_process: copyJson(ref),
      raw: copyJson(item),
    };
  });
}

function extractEdges(model: JsonObject): Edge[] {
  const edges: Edge[] = [];

  extractProcessInstances(model).forEach((instance) => {
    const connections = isRecord(instance.raw.connections) ? instance.raw.connections : {};
    const outputs = ensureList<JsonObject>(connections.outputExchange);

    outputs.filter(isRecord).forEach((exchange, edgeIndex) => {
      const downstreamItems = ensureList<JsonObject>(exchange.downstreamProcess).filter(isRecord);
      downstreamItems.forEach((downstream, downstreamIndex) => {
        const downstreamId = firstNonEmpty(
          downstream['@refObjectId'],
          downstream['@id'],
          downstream.id,
          exchange.downstreamProcessId,
        );
        if (!downstreamId) {
          return;
        }

        edges.push({
          edge_id:
            firstNonEmpty(exchange['@id'], exchange.id) ??
            `${instance.instance_id}-edge-${edgeIndex + 1}-${downstreamIndex + 1}`,
          from: instance.instance_id,
          to: downstreamId,
          exchange_id: firstNonEmpty(exchange['@id'], exchange.id),
          flow_uuid: firstNonEmpty(
            exchange['@flowUUID'],
            downstream['@flowUUID'],
            exchange.flowUUID,
          ),
        });
      });
    });
  });

  return edges;
}

function processReferencePairs(model: JsonObject): Array<{ process_id: string; version: string }> {
  const seen = new Set<string>();
  const pairs: Array<{ process_id: string; version: string }> = [];

  extractProcessInstances(model).forEach((instance) => {
    const key = `${instance.process_id}@${instance.process_version}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    pairs.push({
      process_id: instance.process_id,
      version: instance.process_version,
    });
  });

  return pairs;
}

function parseProcessRecord(
  payload: JsonObject,
  options: {
    sourceLabel: string;
    sourcePath: string | null;
  },
): ProcessRecord {
  const dataset = processDatasetRoot(payload);
  const info = isRecord(dataset.processInformation) ? dataset.processInformation : {};
  const dataInfo = isRecord(info.dataSetInformation) ? info.dataSetInformation : {};
  const administrative = isRecord(dataset.administrativeInformation)
    ? dataset.administrativeInformation
    : {};
  const publication = isRecord(administrative.publicationAndOwnership)
    ? administrative.publicationAndOwnership
    : {};
  const processUuid = firstNonEmpty(dataInfo['common:UUID']);
  if (!processUuid) {
    throw new CliError(`processDataSet missing common:UUID from ${options.sourceLabel}`, {
      code: 'LIFECYCLEMODEL_PROCESS_UUID_REQUIRED',
      exitCode: 2,
    });
  }

  const version = firstNonEmpty(publication['common:dataSetVersion']) ?? DEFAULT_DATASET_VERSION;
  const quantitativeReference = isRecord(info.quantitativeReference)
    ? info.quantitativeReference
    : {};
  const referenceInternalId = firstNonEmpty(quantitativeReference.referenceToReferenceFlow);
  const exchangesWrapper = isRecord(dataset.exchanges) ? dataset.exchanges : {};
  const exchanges = ensureList<JsonObject>(exchangesWrapper.exchange).filter(isRecord);
  const referenceExchange = exchanges.find(
    (item) => String(item['@dataSetInternalID'] ?? '') === String(referenceInternalId ?? ''),
  );

  if (!referenceExchange) {
    throw new CliError(
      `reference exchange ${referenceInternalId ?? '(missing)'} not found for process ${processUuid}`,
      {
        code: 'LIFECYCLEMODEL_REFERENCE_EXCHANGE_NOT_FOUND',
        exitCode: 2,
      },
    );
  }

  const inputAmounts: Record<string, number> = {};
  const outputAmounts: Record<string, number> = {};

  exchanges.forEach((exchange) => {
    const flowRef = isRecord(exchange.referenceToFlowDataSet)
      ? exchange.referenceToFlowDataSet
      : {};
    const flowUuid = firstNonEmpty(flowRef['@refObjectId']);
    const direction = firstNonEmpty(exchange.exchangeDirection) ?? '';
    if (!flowUuid) {
      return;
    }

    const amount = normalizeNumericOutput(
      toFiniteNumber(exchange.meanAmount ?? exchange.resultingAmount, 'exchange amount'),
    );

    if (direction === 'Input') {
      inputAmounts[flowUuid] = normalizeNumericOutput((inputAmounts[flowUuid] ?? 0) + amount);
    } else if (direction === 'Output') {
      outputAmounts[flowUuid] = normalizeNumericOutput((outputAmounts[flowUuid] ?? 0) + amount);
    }
  });

  const referenceFlow = isRecord(referenceExchange.referenceToFlowDataSet)
    ? referenceExchange.referenceToFlowDataSet
    : {};

  return {
    processUuid,
    version,
    raw: {
      processDataSet: dataset,
    },
    sourceLabel: options.sourceLabel,
    sourcePath: options.sourcePath,
    referenceExchangeInternalId: String(referenceInternalId ?? ''),
    referenceFlowUuid: firstNonEmpty(referenceFlow['@refObjectId']) ?? '',
    referenceDirection: firstNonEmpty(referenceExchange.exchangeDirection) ?? '',
    referenceAmount: normalizeNumericOutput(
      toFiniteNumber(
        referenceExchange.meanAmount ?? referenceExchange.resultingAmount,
        'reference amount',
      ),
    ),
    inputAmounts,
    outputAmounts,
  };
}

function autoDetectProcessCatalogPath(modelPath: string | null): string | null {
  if (!modelPath) {
    return null;
  }

  const resolved = PathSafe.resolve(modelPath);
  if (!resolved) {
    return null;
  }

  if (path.basename(path.dirname(resolved)) !== 'lifecyclemodels') {
    return null;
  }

  const tidasBundleDir = path.dirname(path.dirname(resolved));
  if (path.basename(tidasBundleDir) !== 'tidas_bundle') {
    return null;
  }

  const candidate = path.join(path.dirname(tidasBundleDir), 'process-catalog.json');
  return existsSync(candidate) ? candidate : null;
}

function autoDetectProcessJsonDirs(modelPath: string | null): string[] {
  if (!modelPath) {
    return [];
  }

  const resolved = PathSafe.resolve(modelPath);
  if (!resolved) {
    return [];
  }

  const candidates = [path.join(path.dirname(resolved), 'processes')];

  if (path.basename(path.dirname(resolved)) === 'lifecyclemodels') {
    candidates.push(path.join(path.dirname(path.dirname(resolved)), 'processes'));
  }

  const stem = path.basename(resolved, path.extname(resolved));
  if (stem.endsWith('-model')) {
    const prefix = stem.slice(0, -'-model'.length).trim();
    if (prefix) {
      candidates.push(path.join(path.dirname(resolved), `${prefix}-processes`));
    }
  }
  if (stem.endsWith('_model')) {
    const prefix = stem.slice(0, -'_model'.length).trim();
    if (prefix) {
      candidates.push(path.join(path.dirname(resolved), `${prefix}_processes`));
    }
  }

  return uniqueStrings(candidates.filter((candidate) => existsSync(candidate)));
}

const PathSafe = {
  resolve(value: string): string | null {
    try {
      return resolveLocalPath(value, 'path');
    } catch {
      return null;
    }
  },
};

function processSourceDirs(request: LifecyclemodelResultingProcessRequest): string[] {
  const dirs = [...request.process_sources.process_json_dirs];

  request.process_sources.run_dirs.forEach((runDir) => {
    const candidate = path.join(runDir, 'exports', 'processes');
    if (existsSync(candidate)) {
      dirs.push(candidate);
    }
  });

  if (request.process_sources.process_catalog_path) {
    try {
      const payload = JSON.parse(
        readFileSync(request.process_sources.process_catalog_path, 'utf8'),
      ) as unknown;
      ensureList<JsonObject>(payload)
        .filter(isRecord)
        .forEach((item) => {
          const sourceLabel = firstNonEmpty(item.source_label);
          if (!sourceLabel) {
            return;
          }
          const candidate = path.join(sourceLabel, 'exports', 'processes');
          if (existsSync(candidate)) {
            dirs.push(candidate);
          }
        });
    } catch {
      // Keep local process resolution best-effort for catalog expansion.
    }
  }

  return uniqueStrings(dirs);
}

function locateLocalProcessFile(
  processId: string,
  version: string,
  options: {
    processDirs: string[];
    processFiles: string[];
  },
): string | null {
  const targetFileName = `${processId}_${version}.json`;

  for (const directory of options.processDirs) {
    const candidate = path.join(directory, targetFileName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  for (const filePath of options.processFiles) {
    if (existsSync(filePath) && path.basename(filePath) === targetFileName) {
      return filePath;
    }
  }

  return null;
}

function resolveProcessRecords(
  request: LifecyclemodelResultingProcessRequest,
  options: {
    sourceModelJson: JsonObject;
  },
): {
  records: Record<string, ProcessRecord>;
  resolutionSummary: JsonObject;
} {
  const requiredPairs = processReferencePairs(options.sourceModelJson);
  const processFiles = request.process_sources.process_json_files;
  const processDirs = processSourceDirs(request);
  const records: Record<string, ProcessRecord> = {};
  const resolutionItems: JsonObject[] = [];
  const unresolved: Array<{ process_id: string; version: string }> = [];

  requiredPairs.forEach(({ process_id, version }) => {
    const localPath = locateLocalProcessFile(process_id, version, {
      processDirs,
      processFiles,
    });

    if (localPath) {
      const record = parseProcessRecord(
        readJsonObject(localPath, 'LIFECYCLEMODEL_PROCESS_FILE_NOT_OBJECT'),
        {
          sourceLabel: path.dirname(localPath),
          sourcePath: localPath,
        },
      );
      records[`${process_id}@${version}`] = record;
      resolutionItems.push({
        process_id,
        version,
        resolution: 'local_file',
        source_path: localPath,
      });
      return;
    }

    unresolved.push({ process_id, version });
  });

  if (unresolved.length > 0) {
    if (request.process_sources.allow_remote_lookup) {
      throw new CliError(
        'Remote process lookup is not implemented in the CLI yet. Provide local process_sources.run_dirs, process_json_dirs, or process_json_files.',
        {
          code: 'LIFECYCLEMODEL_REMOTE_LOOKUP_NOT_IMPLEMENTED',
          exitCode: 2,
          details: unresolved,
        },
      );
    }

    const missing = unresolved.map((item) => `${item.process_id}@${item.version}`).join(', ');
    throw new CliError(
      `Could not resolve referenced process datasets for lifecycle model: ${missing}.`,
      {
        code: 'LIFECYCLEMODEL_PROCESS_RESOLUTION_FAILED',
        exitCode: 2,
      },
    );
  }

  return {
    records,
    resolutionSummary: {
      required_process_count: requiredPairs.length,
      resolved_process_count: Object.keys(records).length,
      local_process_dir_count: processDirs.length,
      explicit_process_file_count: processFiles.length,
      remote_resolution_count: 0,
      items: resolutionItems,
    },
  };
}

function loadSourceModel(request: LifecyclemodelResultingProcessRequest): {
  sourceModelJson: JsonObject;
  modelPath: string | null;
} {
  if (request.source_model.json_ordered) {
    return {
      sourceModelJson: copyJson(request.source_model.json_ordered),
      modelPath: null,
    };
  }

  if (!request.source_model.json_ordered_path) {
    throw new CliError('source_model must include json_ordered or json_ordered_path.', {
      code: 'LIFECYCLEMODEL_SOURCE_MODEL_PATH_REQUIRED',
      exitCode: 2,
    });
  }

  const localPath = resolveLocalPath(
    request.source_model.json_ordered_path,
    'source_model.json_ordered_path',
  );

  return {
    sourceModelJson: readJsonObject(localPath, 'LIFECYCLEMODEL_SOURCE_MODEL_NOT_OBJECT'),
    modelPath: localPath,
  };
}

function referenceToResultingProcess(model: JsonObject): {
  id: string | null;
  version: string | null;
} {
  const root = lifecyclemodelRoot(model);
  const info = isRecord(root.lifeCycleModelInformation) ? root.lifeCycleModelInformation : {};
  const dataInfo = isRecord(info.dataSetInformation) ? info.dataSetInformation : {};
  const ref = isRecord(dataInfo.referenceToResultingProcess)
    ? dataInfo.referenceToResultingProcess
    : {};

  return {
    id: firstNonEmpty(ref['@refObjectId'], ref.id),
    version: firstNonEmpty(ref['@version'], ref.version),
  };
}

function referenceProcessInstanceId(model: JsonObject): string | null {
  const root = lifecyclemodelRoot(model);
  const info = isRecord(root.lifeCycleModelInformation) ? root.lifeCycleModelInformation : {};
  const quantitative = isRecord(info.quantitativeReference) ? info.quantitativeReference : {};
  const ref = quantitative.referenceToReferenceProcess;
  return isRecord(ref) ? firstNonEmpty(ref['@refObjectId'], ref.id) : firstNonEmpty(ref);
}

function chooseReferenceInstance(
  processInstances: ProcessInstance[],
  requestedInstanceId: string | null,
): ProcessInstance {
  const directMatch = requestedInstanceId
    ? processInstances.find((item) => item.instance_id === requestedInstanceId)
    : null;
  if (directMatch) {
    return directMatch;
  }

  const scaled = processInstances.find((item) => item.multiplication_factor > 0);
  if (scaled) {
    return scaled;
  }

  const fallback = processInstances[0];
  if (!fallback) {
    throw new CliError('Lifecycle model does not contain any process instances.', {
      code: 'LIFECYCLEMODEL_PROCESS_INSTANCES_REQUIRED',
      exitCode: 2,
    });
  }

  return fallback;
}

function cloneExchangeWithAmount(
  exchange: JsonObject,
  amount: number,
  internalId: string,
  options: {
    quantitativeReference: boolean;
  },
): JsonObject {
  const cloned = copyJson(exchange);
  cloned['@dataSetInternalID'] = internalId;
  const normalizedAmount = normalizeNumericOutput(amount);
  cloned.meanAmount = normalizedAmount;
  if ('resultingAmount' in cloned) {
    cloned.resultingAmount = normalizedAmount;
  }
  cloned.quantitativeReference = options.quantitativeReference;
  return cloned;
}

function buildResultingProcessPayload(options: {
  sourceModelId: string;
  sourceModelVersion: string;
  sourceModelName: string;
  sourceModelNameInfo: JsonObject;
  processId: string;
  processVersion: string;
  role: 'primary';
  projectionSignature: string;
  processInstances: ProcessInstance[];
  edges: Edge[];
  processRecords: Record<string, ProcessRecord>;
  referenceProcessInstanceId: string | null;
  metadataOverrides: JsonObject;
  attachGraphSnapshotUri: string | null;
}): JsonObject {
  const chosenInstance = chooseReferenceInstance(
    options.processInstances,
    options.referenceProcessInstanceId,
  );
  const chosenKey = `${chosenInstance.process_id}@${chosenInstance.process_version}`;
  const finalRecord = options.processRecords[chosenKey];
  const finalProcess = copyJson(finalRecord.raw);
  const finalDataset = processDatasetRoot(finalProcess);
  const totals = new Map<string, { amount: number; exchange: JsonObject }>();

  options.processInstances.forEach((instance) => {
    if (instance.multiplication_factor === 0) {
      return;
    }

    const record = options.processRecords[`${instance.process_id}@${instance.process_version}`];
    const recordDataset = processDatasetRoot(record.raw);
    const exchangesWrapper = isRecord(recordDataset.exchanges)
      ? (recordDataset.exchanges as JsonObject)
      : {};
    const exchanges = ensureList<JsonObject>(exchangesWrapper.exchange).filter(isRecord);

    exchanges.forEach((exchange) => {
      const flowRef = isRecord(exchange.referenceToFlowDataSet)
        ? exchange.referenceToFlowDataSet
        : {};
      const flowUuid = firstNonEmpty(flowRef['@refObjectId']);
      const direction = firstNonEmpty(exchange.exchangeDirection);

      if (!flowUuid || (direction !== 'Input' && direction !== 'Output')) {
        return;
      }

      const key = `${flowUuid}\u0000${direction}`;
      const scaledAmount =
        toFiniteNumber(exchange.meanAmount ?? exchange.resultingAmount, 'exchange amount') *
        instance.multiplication_factor;
      const existing = totals.get(key);
      if (existing) {
        existing.amount = normalizeNumericOutput(existing.amount + scaledAmount);
        return;
      }

      totals.set(key, {
        amount: normalizeNumericOutput(scaledAmount),
        exchange: copyJson(exchange),
      });
    });
  });

  const instanceById = new Map(options.processInstances.map((item) => [item.instance_id, item]));
  options.edges.forEach((edge) => {
    if (!edge.flow_uuid) {
      return;
    }

    const downstreamInstance = instanceById.get(edge.to);
    if (!downstreamInstance) {
      return;
    }

    const downstreamRecord =
      options.processRecords[
        `${downstreamInstance.process_id}@${downstreamInstance.process_version}`
      ];
    if (!downstreamRecord) {
      return;
    }

    const internalAmount =
      (downstreamRecord.inputAmounts[edge.flow_uuid] ?? 0) *
      downstreamInstance.multiplication_factor;

    ['Output', 'Input'].forEach((direction) => {
      const key = `${edge.flow_uuid}\u0000${direction}`;
      const existing = totals.get(key);
      if (!existing) {
        return;
      }

      existing.amount = normalizeNumericOutput(existing.amount - internalAmount);
    });
  });

  const exchangeItems: JsonObject[] = [];
  let nextInternalId = 1;
  let referenceExchangeInternalId = '';
  const sortedEntries = [...totals.entries()].sort((left, right) =>
    left[0].localeCompare(right[0]),
  );

  sortedEntries.forEach(([key, payload]) => {
    if (payload.amount <= 0) {
      return;
    }

    const [flowUuid, direction] = key.split('\u0000');
    const quantitativeReference =
      flowUuid === finalRecord.referenceFlowUuid &&
      direction === (finalRecord.referenceDirection || 'Output') &&
      !referenceExchangeInternalId;

    const internalId = String(nextInternalId);
    nextInternalId += 1;
    if (quantitativeReference) {
      referenceExchangeInternalId = internalId;
    }

    exchangeItems.push(
      cloneExchangeWithAmount(payload.exchange, payload.amount, internalId, {
        quantitativeReference,
      }),
    );
  });

  if (!referenceExchangeInternalId) {
    throw new CliError(
      `Could not build resulting process reference exchange for lifecycle model ${options.sourceModelId}.`,
      {
        code: 'LIFECYCLEMODEL_REFERENCE_OUTPUT_REQUIRED',
        exitCode: 2,
      },
    );
  }

  const processInformation = isRecord(finalDataset.processInformation)
    ? (finalDataset.processInformation as JsonObject)
    : {};
  finalDataset.processInformation = processInformation;
  const dataInfo = isRecord(processInformation.dataSetInformation)
    ? (processInformation.dataSetInformation as JsonObject)
    : {};
  processInformation.dataSetInformation = dataInfo;
  dataInfo['common:UUID'] = options.processId;
  dataInfo.name = copyJson(options.sourceModelNameInfo);
  const generalComment = ensureList<JsonObject>(dataInfo['common:generalComment']).filter(isRecord);
  generalComment.push(
    ...multilangFromText(
      `Local ${options.role} resulting process generated from lifecycle model ${options.sourceModelId}; exchanges are aggregated from included processes with internal linked flows cancelled.`,
      `本地为生命周期模型 ${options.sourceModelId} 生成的 ${options.role} resulting process；其 exchanges 由包含过程聚合并抵消内部连接 flow 后得到。`,
    ),
  );
  dataInfo['common:generalComment'] = generalComment;

  const quantitativeReference = isRecord(processInformation.quantitativeReference)
    ? (processInformation.quantitativeReference as JsonObject)
    : {};
  processInformation.quantitativeReference = quantitativeReference;
  quantitativeReference.referenceToReferenceFlow = referenceExchangeInternalId;

  const technology = isRecord(processInformation.technology)
    ? (processInformation.technology as JsonObject)
    : {};
  processInformation.technology = technology;
  const includedRefs = options.processInstances.map((item) => copyJson(item.reference_to_process));
  if (includedRefs.length > 0) {
    technology.referenceToIncludedProcesses =
      includedRefs.length === 1 ? includedRefs[0] : includedRefs;
  }

  finalDataset.exchanges = {
    exchange: exchangeItems.length === 1 ? exchangeItems[0] : exchangeItems,
  };

  const administrative = isRecord(finalDataset.administrativeInformation)
    ? (finalDataset.administrativeInformation as JsonObject)
    : {};
  finalDataset.administrativeInformation = administrative;
  const publication = isRecord(administrative.publicationAndOwnership)
    ? (administrative.publicationAndOwnership as JsonObject)
    : {};
  administrative.publicationAndOwnership = publication;
  publication['common:dataSetVersion'] = options.processVersion;
  publication['common:permanentDataSetURI'] =
    `https://local.tiangong.invalid/processes/${options.processId}?version=${options.processVersion}`;

  const modellingAndValidation = isRecord(finalDataset.modellingAndValidation)
    ? (finalDataset.modellingAndValidation as JsonObject)
    : {};
  finalDataset.modellingAndValidation = modellingAndValidation;
  const lciMethod = isRecord(modellingAndValidation.LCIMethodAndAllocation)
    ? (modellingAndValidation.LCIMethodAndAllocation as JsonObject)
    : {};
  modellingAndValidation.LCIMethodAndAllocation = lciMethod;
  const typeOfDataSet =
    firstNonEmpty(options.metadataOverrides.type_of_data_set) ?? 'partly terminated system';
  lciMethod.typeOfDataSet = typeOfDataSet;

  dataInfo.generatedFromLifecycleModel = {
    id: options.sourceModelId,
    version: options.sourceModelVersion,
    role: options.role,
  };

  const metadata: JsonObject = {
    generated_from_lifecyclemodel_id: options.sourceModelId,
    generated_from_lifecyclemodel_version: options.sourceModelVersion,
    projection_role: options.role,
    projection_signature: options.projectionSignature,
    type_of_data_set: typeOfDataSet,
    ...copyJson(options.metadataOverrides),
  };
  if (options.attachGraphSnapshotUri) {
    metadata.graph_snapshot_uri = options.attachGraphSnapshotUri;
  }

  finalProcess.projectionMetadata = metadata;
  finalProcess.topologySummary = {
    process_instance_count: options.processInstances.length,
    edge_count: options.edges.length,
  };

  return finalProcess;
}

function buildProjectionBundle(options: {
  request: LifecyclemodelResultingProcessRequest;
  sourceModelJson: JsonObject;
  modelPath: string | null;
}): {
  bundle: JsonObject;
  report: JsonObject;
  sourceModelSummary: {
    id: string;
    version: string;
    name: string;
    json_ordered_path: string | null;
    reference_to_resulting_process_id: string | null;
    reference_to_resulting_process_version: string | null;
    reference_process_instance_id: string | null;
    resolved_process_summary: JsonObject;
  };
} {
  const root = lifecyclemodelRoot(options.sourceModelJson);
  const modelInfo = isRecord(root.lifeCycleModelInformation) ? root.lifeCycleModelInformation : {};
  const modelDataInfo = isRecord(modelInfo.dataSetInformation) ? modelInfo.dataSetInformation : {};
  const modelIdentity = modelIdentifier(options.sourceModelJson, options.request.source_model);
  const sourceModelNameInfo = normalizedNameInfo(modelDataInfo.name, modelIdentity.name);
  const processInstances = extractProcessInstances(options.sourceModelJson);
  const edges = extractEdges(options.sourceModelJson);
  const processResolution = resolveProcessRecords(options.request, {
    sourceModelJson: options.sourceModelJson,
  });
  const referenceProcess = referenceToResultingProcess(options.sourceModelJson);
  const referenceProcessInstance = referenceProcessInstanceId(options.sourceModelJson);
  const signatureSeed = {
    source_model_id: modelIdentity.id,
    source_model_version: modelIdentity.version,
    projection_mode: options.request.projection.mode,
    process_instances: processInstances.map((item) => ({
      instance_id: item.instance_id,
      process_id: item.process_id,
      process_version: item.process_version,
    })),
    edges,
  };
  const projectionSignature = `sha256:${sha256Text(JSON.stringify(signatureSeed))}`;
  const primaryProcessId =
    options.request.projection.process_id ??
    referenceProcess.id ??
    `${modelIdentity.id}-resulting-process`;
  const primaryProcessVersion =
    options.request.projection.process_version ?? referenceProcess.version ?? modelIdentity.version;
  const notes = [
    'This command materializes a deterministic resulting processDataSet by aggregating included process exchanges and cancelling internal linked flows.',
    'Remote writes remain gated behind an explicit publish layer.',
  ];

  const primaryPayload = buildResultingProcessPayload({
    sourceModelId: modelIdentity.id,
    sourceModelVersion: modelIdentity.version,
    sourceModelName: modelIdentity.name,
    sourceModelNameInfo,
    processId: primaryProcessId,
    processVersion: primaryProcessVersion,
    role: 'primary',
    projectionSignature,
    processInstances,
    edges,
    processRecords: processResolution.records,
    referenceProcessInstanceId: referenceProcessInstance,
    metadataOverrides: options.request.projection.metadata_overrides,
    attachGraphSnapshotUri: options.request.projection.attach_graph_snapshot_uri,
  });

  if (options.request.projection.mode === 'all-subproducts') {
    const jsonTg = isRecord(root.json_tg) ? root.json_tg : {};
    const submodels = ensureList<JsonObject>(jsonTg.submodels).filter(isRecord);
    notes.push(
      submodels.length > 0
        ? 'Subproduct projection was requested, but this lifecycle model only carries submodel metadata and no submodel-specific topology slices; only the primary aggregated resulting process was emitted.'
        : 'Subproduct projection was requested, but the lifecycle model does not expose submodel topology metadata; only the primary aggregated resulting process was emitted.',
    );
  }

  const sourceModelSummary = {
    id: modelIdentity.id,
    version: modelIdentity.version,
    name: modelIdentity.name,
    json_ordered_path: options.modelPath,
    reference_to_resulting_process_id: referenceProcess.id,
    reference_to_resulting_process_version: referenceProcess.version,
    reference_process_instance_id: referenceProcessInstance,
    resolved_process_summary: processResolution.resolutionSummary,
  };

  const report = {
    generated_at: nowIso(),
    status:
      options.request.publish.intent === 'publish'
        ? 'projected_local_bundle'
        : 'prepared_local_bundle',
    source_model: sourceModelSummary,
    projection_mode: options.request.projection.mode,
    node_count: processInstances.length,
    edge_count: edges.length,
    reference_process_instance_id: referenceProcessInstance,
    process_instance_preview: processInstances.slice(0, 10).map((item) => ({
      instance_id: item.instance_id,
      process_id: item.process_id,
      label: item.label,
    })),
    edge_preview: edges.slice(0, 10),
    projection_signature: projectionSignature,
    attach_graph_snapshot_uri: options.request.projection.attach_graph_snapshot_uri,
    resolved_process_summary: processResolution.resolutionSummary,
    projected_process_count: 1,
    notes,
  };

  const bundle = {
    source_model: sourceModelSummary,
    projected_processes: [
      {
        role: 'primary',
        id: primaryProcessId,
        version: primaryProcessVersion,
        name: modelIdentity.name,
        json_ordered: primaryPayload,
        metadata: primaryPayload.projectionMetadata,
      },
    ],
    relations: [
      {
        lifecyclemodel_id: modelIdentity.id,
        lifecyclemodel_version: modelIdentity.version,
        resulting_process_id: primaryProcessId,
        resulting_process_version: primaryProcessVersion,
        projection_role: 'primary',
        projection_signature: projectionSignature,
        is_primary: true,
      },
    ],
    report,
    projection: {
      mode: options.request.projection.mode,
      metadata_overrides: options.request.projection.metadata_overrides,
      attach_graph_snapshot_uri: options.request.projection.attach_graph_snapshot_uri,
    },
  };

  return {
    bundle,
    report,
    sourceModelSummary,
  };
}

function defaultOutDir(requestPath: string, subject: string, now: Date = new Date()): string {
  const requestDir = path.dirname(path.resolve(requestPath));
  const runId = buildRunId({
    namespace: 'lifecyclemodel_resulting_process',
    subject,
    operation: 'build',
    now,
  });

  return resolveRunLayout(
    path.join(requestDir, 'artifacts'),
    'lifecyclemodel_resulting_process',
    runId,
  ).runRoot;
}

export async function runLifecyclemodelBuildResultingProcess(
  options: RunLifecyclemodelResultingProcessOptions,
): Promise<LifecyclemodelResultingProcessReport> {
  const requestPath = path.resolve(options.inputPath);
  const input = readJsonInput(requestPath);
  const normalizedRequest = normalizeLifecyclemodelResultingProcessRequest(input, {
    requestPath,
  });
  const sourceModel = loadSourceModel(normalizedRequest);
  const modelIdentity = modelIdentifier(
    sourceModel.sourceModelJson,
    normalizedRequest.source_model,
  );
  const outDir = options.outDir
    ? path.resolve(options.outDir)
    : defaultOutDir(requestPath, modelIdentity.id, options.now);
  const projection = buildProjectionBundle({
    request: normalizedRequest,
    sourceModelJson: sourceModel.sourceModelJson,
    modelPath: sourceModel.modelPath,
  });

  const files = {
    normalized_request: writeJsonArtifact(
      path.join(outDir, 'request.normalized.json'),
      normalizedRequest,
    ),
    source_model_normalized: writeJsonArtifact(
      path.join(outDir, 'source-model.normalized.json'),
      sourceModel.sourceModelJson,
    ),
    source_model_summary: writeJsonArtifact(
      path.join(outDir, 'source-model.summary.json'),
      projection.sourceModelSummary,
    ),
    projection_report: writeJsonArtifact(
      path.join(outDir, 'projection-report.json'),
      projection.report,
    ),
    process_projection_bundle: writeJsonArtifact(
      path.join(outDir, 'process-projection-bundle.json'),
      projection.bundle,
    ),
  };

  return {
    generated_at_utc: nowIso(options.now),
    request_path: requestPath,
    out_dir: outDir,
    status: String(projection.report.status),
    projected_process_count: 1,
    relation_count: 1,
    source_model: {
      id: projection.sourceModelSummary.id,
      version: projection.sourceModelSummary.version,
      name: projection.sourceModelSummary.name,
      json_ordered_path: projection.sourceModelSummary.json_ordered_path,
      reference_to_resulting_process_id:
        projection.sourceModelSummary.reference_to_resulting_process_id,
      reference_to_resulting_process_version:
        projection.sourceModelSummary.reference_to_resulting_process_version,
      reference_process_instance_id: projection.sourceModelSummary.reference_process_instance_id,
    },
    files,
  };
}

// Exposed for deterministic unit coverage of internal lifecyclemodel fallback logic.
export const __testInternals = {
  uniqueStrings,
  toFiniteNumber,
  normalizeNumericOutput,
  toBoolean,
  resolveNameField,
  normalizedNameInfo,
  modelIdentifier,
  extractProcessInstances,
  extractEdges,
  processReferencePairs,
  parseProcessRecord,
  autoDetectProcessCatalogPath,
  autoDetectProcessJsonDirs,
  processSourceDirs,
  locateLocalProcessFile,
  loadSourceModel,
  referenceToResultingProcess,
  referenceProcessInstanceId,
  chooseReferenceInstance,
  cloneExchangeWithAmount,
  buildResultingProcessPayload,
  buildProjectionBundle,
  defaultOutDir,
};
