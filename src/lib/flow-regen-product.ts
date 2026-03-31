import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { writeJsonArtifact, writeJsonLinesArtifact, writeTextArtifact } from './artifacts.js';
import { CliError } from './errors.js';
import {
  coerceText,
  deepGet,
  extractFlowRecord,
  flowDatasetFromRow,
  isRecord,
  listify,
  loadRowsFromFile,
  normalizeText,
  type FlowRecord,
  type JsonRecord,
} from './flow-governance.js';
import { resolveRepoRootFrom, resolveTidasSdkRoot } from './validation.js';

const EMERGY_TEXT_KEYWORDS = [
  'emergy',
  '能值',
  '太阳能值',
  'solar emergy',
  'solar emjoule',
  'sej',
] as const;

export type AutoPatchPolicy = 'disabled' | 'alias-only' | 'alias-or-unique-name';
export type TidasMode = 'auto' | 'required' | 'skip';
type PathPart = string | number;

type LangEntry = {
  lang: string;
  text: string;
};

type ProcessIdentity = {
  id: string;
  version: string;
  name: string;
};

type FlowIndex = {
  records: FlowRecord[];
  byUuid: Record<string, FlowRecord[]>;
  byUuidVersion: Record<string, FlowRecord>;
  byName: Record<string, FlowRecord[]>;
};

type ScanFinding = {
  process_id: string;
  process_version: string;
  process_name: string;
  exchange_internal_id: string;
  exchange_direction: unknown;
  reference_flow_id: string;
  reference_flow_version: string;
  reference_flow_text: string;
  issue_type: string;
  severity: 'info' | 'warning' | 'error';
  evidence: JsonRecord;
};

type RepairAction = {
  process_id: string;
  process_version: string;
  process_name: string;
  exchange_internal_id: string;
  current_flow_id: string;
  current_flow_version: string;
  exchange_direction: unknown;
  exchange_text: string;
  current_issue_type?: string;
  auto_patch_policy: AutoPatchPolicy;
  decision: 'keep_as_is' | 'auto_patch' | 'manual_review';
  reason: string;
  target_flow_id?: string;
  target_flow_version?: string;
  target_flow_name?: string;
  target_reference?: JsonRecord;
  candidate_count?: number;
  candidate_refs?: Array<Record<string, string>>;
};

export type ProcessPatchValidationIssue = JsonRecord & {
  type: string;
  severity: 'error';
};

export type ProcessPatchValidationResult = {
  process_id: string;
  process_version: string;
  process_name: string;
  ok: boolean;
  issues: ProcessPatchValidationIssue[];
};

export type ProcessPatchValidationSummary = {
  patched_process_count: number;
  passed: number;
  failed: number;
  tidas_validation: boolean;
};

type ProcessPatchValidationReport = {
  summary: ProcessPatchValidationSummary;
  results: ProcessPatchValidationResult[];
};

export type ScanStageFiles = {
  out_dir: string;
  emergy_excluded_processes: string;
  summary: string;
  findings: string;
  findings_jsonl: string;
};

export type RepairStageFiles = {
  out_dir: string;
  plan: string;
  plan_jsonl: string;
  manual_review_queue: string;
  summary: string;
};

export type ApplyStageFiles = RepairStageFiles & {
  patched_processes: string;
  patch_root: string;
};

export type ValidateStageFiles = {
  out_dir: string;
  report: string;
  failures: string;
};

export type FlowProcessRefScanSummary = {
  process_count_before_emergy_exclusion: number;
  process_count: number;
  emergy_excluded_process_count: number;
  exchange_count: number;
  issue_counts: Record<string, number>;
  processes_with_issues: number;
};

export type FlowProcessFlowRepairSummary = {
  auto_patch_policy: AutoPatchPolicy;
  process_count: number;
  repair_item_count: number;
  decision_counts: Record<string, number>;
  patched_process_count: number;
  process_pool_sync?: JsonRecord;
};

type FlowRegenProductFiles = {
  report: string;
  scan: ScanStageFiles;
  repair: RepairStageFiles;
  apply: ApplyStageFiles | null;
  validate: ValidateStageFiles | null;
};

type FlowRegenProductCounts = {
  process_count_before_emergy_exclusion: number;
  process_count: number;
  emergy_excluded_process_count: number;
  exchange_count: number;
  issue_counts: Record<string, number>;
  processes_with_issues: number;
  repair_item_count: number;
  decision_counts: Record<string, number>;
  patched_process_count: number;
  validation_passed_count: number | null;
  validation_failed_count: number | null;
};

export type FlowRegenProductReport = {
  schema_version: 1;
  generated_at_utc: string;
  status: 'completed_local_flow_regen_product';
  mode: 'plan' | 'apply';
  processes_file: string;
  scope_flow_files: string[];
  catalog_flow_files: string[];
  alias_map_file: string | null;
  exclude_emergy: boolean;
  auto_patch_policy: AutoPatchPolicy;
  process_pool_file: string | null;
  tidas_mode: TidasMode;
  out_dir: string;
  counts: FlowRegenProductCounts;
  validation: {
    enabled: boolean;
    tidas_validation: boolean;
    ok: boolean | null;
  };
  files: FlowRegenProductFiles;
};

export type RunFlowRegenProductOptions = {
  processesFile: string;
  scopeFlowFiles: string[];
  catalogFlowFiles?: string[];
  aliasMapFile?: string | null;
  outDir: string;
  excludeEmergy?: boolean;
  autoPatchPolicy?: AutoPatchPolicy;
  apply?: boolean;
  processPoolFile?: string | null;
  tidasMode?: TidasMode;
};

export type RunFlowValidateProcessesOptions = {
  originalProcessesFile: string;
  patchedProcessesFile: string;
  scopeFlowFiles: string[];
  outDir: string;
  tidasMode?: TidasMode;
};

export type RunFlowScanProcessFlowRefsOptions = {
  processesFile: string;
  scopeFlowFiles: string[];
  catalogFlowFiles?: string[];
  aliasMapFile?: string | null;
  excludeEmergy?: boolean;
  outDir: string;
};

export type RunFlowPlanProcessFlowRepairsOptions = {
  processesFile: string;
  scopeFlowFiles: string[];
  aliasMapFile?: string | null;
  scanFindingsFile?: string | null;
  autoPatchPolicy?: AutoPatchPolicy;
  outDir: string;
};

export type RunFlowApplyProcessFlowRepairsOptions = {
  processesFile: string;
  scopeFlowFiles: string[];
  aliasMapFile?: string | null;
  scanFindingsFile?: string | null;
  autoPatchPolicy?: AutoPatchPolicy;
  processPoolFile?: string | null;
  outDir: string;
};

export type FlowValidateProcessesReport = {
  schema_version: 1;
  generated_at_utc: string;
  status: 'completed_local_flow_validate_processes';
  original_processes_file: string;
  patched_processes_file: string;
  scope_flow_files: string[];
  out_dir: string;
  tidas_mode: TidasMode;
  summary: ProcessPatchValidationSummary;
  files: ValidateStageFiles;
  results: ProcessPatchValidationResult[];
};

export type FlowScanProcessFlowRefsReport = {
  schema_version: 1;
  generated_at_utc: string;
  status: 'completed_local_flow_scan_process_flow_refs';
  processes_file: string;
  scope_flow_files: string[];
  catalog_flow_files: string[];
  alias_map_file: string | null;
  exclude_emergy: boolean;
  out_dir: string;
  summary: FlowProcessRefScanSummary;
  files: ScanStageFiles;
};

export type FlowPlanProcessFlowRepairsReport = {
  schema_version: 1;
  generated_at_utc: string;
  status: 'completed_local_flow_plan_process_flow_repairs';
  processes_file: string;
  scope_flow_files: string[];
  alias_map_file: string | null;
  scan_findings_file: string | null;
  auto_patch_policy: AutoPatchPolicy;
  out_dir: string;
  summary: FlowProcessFlowRepairSummary;
  files: RepairStageFiles;
};

export type FlowApplyProcessFlowRepairsReport = {
  schema_version: 1;
  generated_at_utc: string;
  status: 'completed_local_flow_apply_process_flow_repairs';
  processes_file: string;
  scope_flow_files: string[];
  alias_map_file: string | null;
  scan_findings_file: string | null;
  auto_patch_policy: AutoPatchPolicy;
  process_pool_file: string | null;
  out_dir: string;
  summary: FlowProcessFlowRepairSummary;
  files: ApplyStageFiles;
};

type ProcessSdkValidationEntity = {
  validateEnhanced?: () => unknown;
  validate?: () => unknown;
};

type ProcessSdkModule = {
  createProcess?: (
    data?: unknown,
    validationConfig?: {
      mode?: 'strict' | 'weak' | 'ignore';
      throwOnError?: boolean;
      deepValidation?: boolean;
    },
  ) => ProcessSdkValidationEntity;
  location?: string;
};

type FlowRegenProductDeps = {
  loadSdkModule?: () => ProcessSdkModule;
  now?: () => Date;
};

type ScanStageResult = {
  filteredProcesses: JsonRecord[];
  emergyExcludedProcesses: JsonRecord[];
  findings: ScanFinding[];
  summary: FlowProcessRefScanSummary;
  files: ScanStageFiles;
};

type RepairStageResult = {
  plan: RepairAction[];
  manualQueue: RepairAction[];
  summary: FlowProcessFlowRepairSummary;
  files: RepairStageFiles | ApplyStageFiles;
  patchedRows: JsonRecord[];
};

type ValidateStageResult = {
  summary: ProcessPatchValidationSummary;
  results: ProcessPatchValidationResult[];
  failures: ProcessPatchValidationResult[];
  files: ValidateStageFiles;
};

function resolveCliRepoRoot(): string {
  return resolveRepoRootFrom(path.dirname(fileURLToPath(import.meta.url)));
}

function buildSdkCandidates(): string[] {
  const repoRoot = resolveCliRepoRoot();
  const sdkRoot = resolveTidasSdkRoot(repoRoot);
  return [
    '@tiangong-lca/tidas-sdk/core',
    path.join(sdkRoot, 'sdks', 'typescript', 'dist', 'core', 'index.js'),
  ];
}

function resolveSdkModuleFromCandidates(
  requireFn: NodeJS.Require,
  candidates: string[],
): ProcessSdkModule & { location: string } {
  const details: string[] = [];

  for (const candidate of candidates) {
    try {
      const loaded = requireFn(candidate) as ProcessSdkModule;
      if (typeof loaded.createProcess === 'function') {
        return {
          ...loaded,
          location: candidate,
        };
      }
      details.push(`Candidate missing createProcess export: ${candidate}`);
    } catch (error) {
      details.push(`Failed to load ${candidate}: ${String(error)}`);
    }
  }

  throw new CliError('Unable to resolve the local tidas-sdk process factory.', {
    code: 'FLOW_REGEN_PROCESS_SDK_NOT_FOUND',
    exitCode: 2,
    details,
  });
}

function resolveLocalSdkModule(): ProcessSdkModule & { location: string } {
  return resolveSdkModuleFromCandidates(createRequire(import.meta.url), buildSdkCandidates());
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertInputFile(inputFile: string, requiredCode: string, missingCode: string): string {
  if (!inputFile) {
    throw new CliError('Missing required input file value.', {
      code: requiredCode,
      exitCode: 2,
    });
  }

  const resolved = path.resolve(inputFile);
  if (!existsSync(resolved)) {
    throw new CliError(`Input file not found: ${resolved}`, {
      code: missingCode,
      exitCode: 2,
    });
  }

  return resolved;
}

function assertInputFiles(
  inputFiles: string[],
  requiredCode: string,
  missingCode: string,
): string[] {
  if (!inputFiles.length) {
    throw new CliError('At least one input file is required.', {
      code: requiredCode,
      exitCode: 2,
    });
  }

  return inputFiles.map((inputFile) => assertInputFile(inputFile, requiredCode, missingCode));
}

function assertOutDir(outDir: string): string {
  if (!outDir) {
    throw new CliError('Missing required --out-dir value.', {
      code: 'FLOW_REGEN_OUT_DIR_REQUIRED',
      exitCode: 2,
    });
  }

  return path.resolve(outDir);
}

function readJsonObjectFile(
  filePath: string,
  requiredCode: string,
  missingCode: string,
  invalidCode: string,
): JsonRecord {
  const resolved = assertInputFile(filePath, requiredCode, missingCode);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new CliError(`Expected JSON object file: ${resolved}`, {
      code: invalidCode,
      exitCode: 2,
      details: String(error),
    });
  }

  if (!isRecord(parsed)) {
    throw new CliError(`Expected JSON object file: ${resolved}`, {
      code: invalidCode,
      exitCode: 2,
    });
  }

  return parsed;
}

function processDatasetFromRow(row: JsonRecord): JsonRecord {
  const payload = isRecord(row.json_ordered)
    ? row.json_ordered
    : isRecord(row.json)
      ? row.json
      : row;
  return isRecord(payload.processDataSet) ? payload.processDataSet : payload;
}

function extractProcessIdentity(row: JsonRecord): ProcessIdentity {
  const dataset = processDatasetFromRow(row);
  const info = deepGet(dataset, ['processInformation', 'dataSetInformation'], {}) as JsonRecord;
  const id = coerceText(row.id) || coerceText(info['common:UUID']);
  const version =
    coerceText(row.version) ||
    coerceText(
      deepGet(dataset, [
        'administrativeInformation',
        'publicationAndOwnership',
        'common:dataSetVersion',
      ]),
    ) ||
    '01.00.000';
  const name = coerceText(deepGet(info, ['name', 'baseName']) ?? info.name) || id;

  return { id, version, name };
}

function exchangeRecords(processRow: JsonRecord): JsonRecord[] {
  const dataset = processDatasetFromRow(processRow);
  return listify(deepGet(dataset, ['exchanges', 'exchange'], [])).filter(isRecord);
}

function extractProcessReferenceExchange(processRow: JsonRecord): JsonRecord | null {
  const dataset = processDatasetFromRow(processRow);
  const referenceInternalId = coerceText(
    deepGet(dataset, ['processInformation', 'quantitativeReference', 'referenceToReferenceFlow']),
  );
  const exchanges = exchangeRecords(processRow);

  if (referenceInternalId) {
    const exact = exchanges.find(
      (exchange) => coerceText(exchange['@dataSetInternalID']) === referenceInternalId,
    );
    if (exact) {
      return exact;
    }
  }

  const outputExchange = exchanges.find(
    (exchange) => coerceText(exchange.exchangeDirection).toLowerCase() === 'output',
  );
  if (outputExchange) {
    return outputExchange;
  }

  return exchanges[0] ?? null;
}

function extractReferenceText(ref: unknown): string {
  if (!isRecord(ref)) {
    return coerceText(ref);
  }
  return coerceText(ref['common:shortDescription']);
}

function extractProcessReferenceFlowRef(processRow: JsonRecord): {
  flow_id: string;
  flow_version: string;
  flow_text: string;
  exchange_internal_id: string;
} {
  const exchange = extractProcessReferenceExchange(processRow) ?? {};
  const ref = isRecord(exchange.referenceToFlowDataSet) ? exchange.referenceToFlowDataSet : {};

  return {
    flow_id: coerceText(ref['@refObjectId']),
    flow_version: coerceText(ref['@version']),
    flow_text: extractReferenceText(ref),
    exchange_internal_id: coerceText(exchange['@dataSetInternalID']),
  };
}

function processRowKey(processRow: JsonRecord): string {
  const identity = extractProcessIdentity(processRow);
  if (!identity.id || !identity.version) {
    return '';
  }
  return `${identity.id}@${identity.version}`;
}

function versionKey(version: string): number[] {
  return String(version)
    .split('.')
    .map((part) => {
      const parsed = Number.parseInt(part, 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    });
}

function compareVersionKeys(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }
  return 0;
}

function processRowSortComparator(left: JsonRecord, right: JsonRecord): number {
  const leftIdentity = extractProcessIdentity(left);
  const rightIdentity = extractProcessIdentity(right);

  const idCompare = leftIdentity.id.localeCompare(rightIdentity.id);
  if (idCompare !== 0) {
    return idCompare;
  }

  const versionCompare = compareVersionKeys(
    versionKey(leftIdentity.version),
    versionKey(rightIdentity.version),
  );
  if (versionCompare !== 0) {
    return versionCompare;
  }

  return leftIdentity.name.localeCompare(rightIdentity.name);
}

function buildFlowIndex(rows: JsonRecord[]): FlowIndex {
  const byUuid: Record<string, FlowRecord[]> = {};
  const byUuidVersion: Record<string, FlowRecord> = {};
  const byName: Record<string, FlowRecord[]> = {};
  const records: FlowRecord[] = [];

  for (const row of rows) {
    const record = extractFlowRecord(row);
    records.push(record);
    byUuid[record.id] ??= [];
    byUuid[record.id].push(record);
    byUuidVersion[`${record.id}@${record.version}`] = record;
    const normalizedName = normalizeText(record.name);
    byName[normalizedName] ??= [];
    byName[normalizedName].push(record);
  }

  return {
    records,
    byUuid,
    byUuidVersion,
    byName,
  };
}

function aliasLookup(
  aliasMap: JsonRecord,
  flowUuid: string,
  flowVersion: string | null,
): JsonRecord | null {
  const versionedKey = flowVersion ? `${flowUuid}@${flowVersion}` : null;
  for (const key of [versionedKey, flowUuid]) {
    if (!key) {
      continue;
    }
    const candidate = aliasMap[key];
    if (isRecord(candidate)) {
      return candidate;
    }
  }
  return null;
}

function buildLocalDatasetUri(datasetKind: string, uuidValue: string, version: string): string {
  if (!uuidValue) {
    return '';
  }

  const folderMap: Record<string, string> = {
    flow: 'flows',
    'flow data set': 'flows',
  };
  const folder = folderMap[datasetKind.trim().toLowerCase()] ?? 'datasets';
  const versionText = version.trim() || '01.00.000';
  return `../${folder}/${uuidValue}_${versionText}.xml`;
}

function preserveShortDescriptionShape(existing: unknown, target: JsonRecord): unknown {
  if (Array.isArray(existing)) {
    if (existing.length > 0 && isRecord(existing[0])) {
      const patched = cloneJson(existing[0]);
      patched['@xml:lang'] =
        coerceText(target['@xml:lang']) || coerceText(patched['@xml:lang']) || 'en';
      patched['#text'] = coerceText(target['#text']);
      return [patched];
    }
    return [cloneJson(target)];
  }

  if (isRecord(existing)) {
    const patched = cloneJson(existing);
    patched['@xml:lang'] =
      coerceText(target['@xml:lang']) || coerceText(patched['@xml:lang']) || 'en';
    patched['#text'] = coerceText(target['#text']);
    return patched;
  }

  return cloneJson(target);
}

function flowReferenceFromRecord(record: FlowRecord): JsonRecord {
  const targetShortDescription =
    record.shortDescription ??
    ({
      '@xml:lang': 'en',
      '#text': record.name,
    } satisfies JsonRecord);

  return {
    '@type': 'flow data set',
    '@refObjectId': record.id,
    '@version': record.version,
    '@uri': buildLocalDatasetUri('flow data set', record.id, record.version),
    'common:shortDescription': cloneJson(targetShortDescription),
  };
}

function patchedFlowReference(currentRef: unknown, record: FlowRecord): JsonRecord {
  const current = isRecord(currentRef) ? cloneJson(currentRef) : {};
  const target = flowReferenceFromRecord(record);

  current['@type'] = coerceText(current['@type']) || coerceText(target['@type']);
  current['@refObjectId'] = target['@refObjectId'];
  current['@version'] = target['@version'];
  current['@uri'] = target['@uri'];
  current['common:shortDescription'] = preserveShortDescriptionShape(
    current['common:shortDescription'],
    target['common:shortDescription'] as JsonRecord,
  );

  return current;
}

function langEntries(value: unknown): LangEntry[] {
  const entries: LangEntry[] = [];

  if (Array.isArray(value)) {
    value.forEach((item) => {
      entries.push(...langEntries(item));
    });
    return entries;
  }

  if (!isRecord(value)) {
    return entries;
  }

  if ('#text' in value || '@xml:lang' in value) {
    const text = coerceText(value['#text']);
    if (text) {
      entries.push({
        lang: coerceText(value['@xml:lang']) || 'en',
        text,
      });
    }
    return entries;
  }

  Object.values(value).forEach((nested) => {
    entries.push(...langEntries(nested));
  });

  return entries;
}

function textHasEmergyKeyword(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }
  return EMERGY_TEXT_KEYWORDS.some((keyword) => normalized.includes(normalizeText(keyword)));
}

function uniqueNonEmptyTexts(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach((value) => {
    const text = String(value || '').trim();
    if (!text) {
      return;
    }
    const normalized = normalizeText(text);
    if (seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(text);
  });

  return result;
}

function flowEmergyScopeDecision(row: JsonRecord): JsonRecord {
  const record = extractFlowRecord(row);
  const dataset = flowDatasetFromRow(row);
  const nameNode = deepGet(dataset, ['flowInformation', 'dataSetInformation', 'name'], {});
  const nameCandidates = langEntries(nameNode).map((entry) => entry.text);
  const signals: string[] = [];

  uniqueNonEmptyTexts(nameCandidates).forEach((text) => {
    if (textHasEmergyKeyword(text)) {
      signals.push(`emergy_name:${text}`);
    }
  });

  return {
    entity_type: 'flow',
    flow_id: record.id,
    version: record.version,
    name: record.name,
    flow_type: record.flowType,
    excluded: signals.length > 0,
    reason: signals.length > 0 ? 'emergy_named_flow' : '',
    signals,
  };
}

function processEmergyScopeDecision(
  processRow: JsonRecord,
  flowIndex: FlowIndex | null,
): JsonRecord {
  const identity = extractProcessIdentity(processRow);
  const dataset = processDatasetFromRow(processRow);
  const referenceInfo = extractProcessReferenceFlowRef(processRow);
  const signals: string[] = [];
  let matchedRecord: FlowRecord | null =
    flowIndex?.byUuidVersion[`${referenceInfo.flow_id}@${referenceInfo.flow_version}`] ?? null;

  if (!matchedRecord && flowIndex?.byUuid[referenceInfo.flow_id]?.length) {
    matchedRecord = flowIndex.byUuid[referenceInfo.flow_id][0] ?? null;
  }

  if (matchedRecord) {
    const flowDecision = flowEmergyScopeDecision(matchedRecord.row);
    const flowSignals = (flowDecision.signals as unknown[]).filter(
      (value): value is string => typeof value === 'string',
    );
    signals.push(...flowSignals);
  }

  if (!signals.length) {
    const functionalUnitTexts = langEntries(
      deepGet(dataset, ['processInformation', 'quantitativeReference', 'functionalUnitOrOther']),
    ).map((entry) => entry.text);
    uniqueNonEmptyTexts([referenceInfo.flow_text, ...functionalUnitTexts]).forEach((text) => {
      if (textHasEmergyKeyword(text)) {
        signals.push(`process_ref_text:${text}`);
      }
    });
  }

  return {
    entity_type: 'process',
    process_id: identity.id,
    process_version: identity.version,
    process_name: identity.name,
    reference_flow_id: referenceInfo.flow_id,
    reference_flow_version: referenceInfo.flow_version,
    reference_exchange_internal_id: referenceInfo.exchange_internal_id,
    excluded: signals.length > 0,
    reason: signals.length > 0 ? 'reference_flow_name_mentions_emergy' : '',
    signals,
  };
}

function filterEmergyNamedProcesses(
  rows: JsonRecord[],
  flowIndex: FlowIndex | null,
): {
  keptRows: JsonRecord[];
  excludedRows: JsonRecord[];
} {
  const keptRows: JsonRecord[] = [];
  const excludedRows: JsonRecord[] = [];

  rows.forEach((row) => {
    const decision = processEmergyScopeDecision(row, flowIndex);
    if (decision.excluded === true) {
      excludedRows.push(decision);
      return;
    }
    keptRows.push(row);
  });

  return {
    keptRows,
    excludedRows,
  };
}

function classifyExchangeRef(
  processRow: JsonRecord,
  exchange: JsonRecord,
  scopeIndex: FlowIndex,
  catalogIndex: FlowIndex,
  aliasMap: JsonRecord,
): ScanFinding {
  const identity = extractProcessIdentity(processRow);
  const ref = isRecord(exchange.referenceToFlowDataSet) ? exchange.referenceToFlowDataSet : {};
  const flowUuid = coerceText(ref['@refObjectId']);
  const flowVersion = coerceText(ref['@version']);
  const finding: ScanFinding = {
    process_id: identity.id,
    process_version: identity.version,
    process_name: identity.name,
    exchange_internal_id: coerceText(exchange['@dataSetInternalID']),
    exchange_direction: exchange.exchangeDirection,
    reference_flow_id: flowUuid,
    reference_flow_version: flowVersion,
    reference_flow_text: extractReferenceText(ref),
    issue_type: 'exists_in_target',
    severity: 'info',
    evidence: {},
  };

  if (!flowUuid) {
    finding.issue_type = 'no_reference';
    finding.severity = 'error';
    return finding;
  }

  const aliasTarget = aliasLookup(aliasMap, flowUuid, flowVersion || null);
  if (aliasTarget) {
    finding.issue_type = 'alias_target_available';
    finding.severity = 'warning';
    finding.evidence = {
      alias_target: aliasTarget,
    };
  }

  if (!flowVersion) {
    if (scopeIndex.byUuid[flowUuid]?.length) {
      finding.issue_type = 'version_missing';
      finding.severity = 'warning';
      return finding;
    }
    if (catalogIndex.byUuid[flowUuid]?.length) {
      finding.issue_type = 'exists_outside_target';
      finding.severity = 'warning';
      return finding;
    }
    finding.issue_type = 'missing_uuid';
    finding.severity = 'error';
    return finding;
  }

  const scopeMatch = scopeIndex.byUuidVersion[`${flowUuid}@${flowVersion}`];
  if (scopeMatch) {
    finding.evidence = {
      scope_group: '',
      flow_name: scopeMatch.name,
    };
    return finding;
  }

  if (scopeIndex.byUuid[flowUuid]?.length) {
    finding.issue_type = 'broken_version';
    finding.severity = 'error';
    finding.evidence = {
      available_versions_in_target: scopeIndex.byUuid[flowUuid]
        .map((record) => record.version)
        .sort(),
    };
    return finding;
  }

  if (
    catalogIndex.byUuidVersion[`${flowUuid}@${flowVersion}`] ||
    catalogIndex.byUuid[flowUuid]?.length
  ) {
    finding.issue_type = 'exists_outside_target';
    finding.severity = 'warning';
    return finding;
  }

  finding.issue_type = 'missing_uuid';
  finding.severity = 'error';
  return finding;
}

function buildFindingMap(findings: ScanFinding[]): Record<string, ScanFinding> {
  const result: Record<string, ScanFinding> = {};
  findings.forEach((finding) => {
    result[`${finding.process_id}@${finding.process_version}::${finding.exchange_internal_id}`] =
      finding;
  });
  return result;
}

function planExchangeRepair(
  exchange: JsonRecord,
  scopeIndex: FlowIndex,
  aliasMap: JsonRecord,
  finding: ScanFinding | null,
  autoPatchPolicy: AutoPatchPolicy,
): RepairAction {
  const ref = isRecord(exchange.referenceToFlowDataSet) ? exchange.referenceToFlowDataSet : {};
  const flowUuid = coerceText(ref['@refObjectId']);
  const flowVersion = coerceText(ref['@version']);
  const exchangeText =
    extractReferenceText(ref) || coerceText(exchange.exchangeName) || coerceText(exchange.name);

  const base: RepairAction = {
    exchange_internal_id: coerceText(exchange['@dataSetInternalID']),
    current_flow_id: flowUuid,
    current_flow_version: flowVersion,
    exchange_direction: exchange.exchangeDirection,
    exchange_text: exchangeText,
    current_issue_type: finding?.issue_type,
    auto_patch_policy: autoPatchPolicy,
    decision: 'manual_review',
    reason: 'no_deterministic_match',
    process_id: '',
    process_version: '',
    process_name: '',
  };

  if (flowUuid && flowVersion) {
    const currentRecord = scopeIndex.byUuidVersion[`${flowUuid}@${flowVersion}`];
    if (currentRecord) {
      return {
        ...base,
        decision: 'keep_as_is',
        reason: 'already_in_target',
        target_flow_id: currentRecord.id,
        target_flow_version: currentRecord.version,
      };
    }
  }

  const aliasTarget = aliasLookup(aliasMap, flowUuid, flowVersion || null);
  if (aliasTarget) {
    const targetRecord =
      scopeIndex.byUuidVersion[`${coerceText(aliasTarget.id)}@${coerceText(aliasTarget.version)}`];
    if (targetRecord && autoPatchPolicy !== 'disabled') {
      return {
        ...base,
        decision: 'auto_patch',
        reason: 'direct_alias_map',
        target_flow_id: targetRecord.id,
        target_flow_version: targetRecord.version,
        target_flow_name: targetRecord.name,
        target_reference: patchedFlowReference(ref, targetRecord),
      };
    }
    if (targetRecord) {
      return {
        ...base,
        decision: 'manual_review',
        reason: 'alias_target_found_but_policy_disallows_auto_patch',
        candidate_count: 1,
        candidate_refs: [
          {
            id: targetRecord.id,
            version: targetRecord.version,
            name: targetRecord.name,
          },
        ],
      };
    }
  }

  const candidates = scopeIndex.byName[normalizeText(exchangeText)] ?? [];
  if (candidates.length === 1) {
    const candidate = candidates[0];
    if (autoPatchPolicy === 'alias-or-unique-name') {
      return {
        ...base,
        decision: 'auto_patch',
        reason: 'unique_exact_name_match',
        target_flow_id: candidate.id,
        target_flow_version: candidate.version,
        target_flow_name: candidate.name,
        target_reference: patchedFlowReference(ref, candidate),
      };
    }
    return {
      ...base,
      decision: 'manual_review',
      reason: 'unique_exact_name_match_blocked_by_policy',
      candidate_count: 1,
      candidate_refs: [
        {
          id: candidate.id,
          version: candidate.version,
          name: candidate.name,
        },
      ],
    };
  }

  if (candidates.length > 1) {
    return {
      ...base,
      decision: 'manual_review',
      reason: 'ambiguous_exact_name_match',
      candidate_count: candidates.length,
      candidate_refs: candidates.map((candidate) => ({
        id: candidate.id,
        version: candidate.version,
        name: candidate.name,
      })),
    };
  }

  return base;
}

function buildUnifiedJsonDiff(before: unknown, after: unknown): string {
  const beforeLines = JSON.stringify(before, null, 2).split('\n');
  const afterLines = JSON.stringify(after, null, 2).split('\n');

  if (isDeepStrictEqual(beforeLines, afterLines)) {
    return '--- before.json\n+++ after.json\n';
  }

  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let beforeSuffix = beforeLines.length - 1;
  let afterSuffix = afterLines.length - 1;
  while (
    beforeSuffix >= prefix &&
    afterSuffix >= prefix &&
    beforeLines[beforeSuffix] === afterLines[afterSuffix]
  ) {
    beforeSuffix -= 1;
    afterSuffix -= 1;
  }

  const beforeChanged = beforeLines.slice(prefix, beforeSuffix + 1);
  const afterChanged = afterLines.slice(prefix, afterSuffix + 1);
  const hunkHeader = `@@ -${prefix + 1},${beforeChanged.length} +${prefix + 1},${afterChanged.length} @@`;

  return [
    '--- before.json',
    '+++ after.json',
    hunkHeader,
    ...beforeChanged.map((line) => `-${line}`),
    ...afterChanged.map((line) => `+${line}`),
    '',
  ].join('\n');
}

function deepDiffPaths(before: unknown, after: unknown, prefix: PathPart[] = []): PathPart[][] {
  if (typeof before !== typeof after || Array.isArray(before) !== Array.isArray(after)) {
    return [prefix];
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const paths: PathPart[][] = [];
    const maxLength = Math.max(before.length, after.length);
    for (let index = 0; index < maxLength; index += 1) {
      if (index >= before.length || index >= after.length) {
        paths.push([...prefix, index]);
        continue;
      }
      paths.push(...deepDiffPaths(before[index], after[index], [...prefix, index]));
    }
    return paths;
  }

  if (isRecord(before) && isRecord(after)) {
    const paths: PathPart[][] = [];
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    [...keys].sort().forEach((key) => {
      if (!(key in before) || !(key in after)) {
        paths.push([...prefix, key]);
        return;
      }
      paths.push(...deepDiffPaths(before[key], after[key], [...prefix, key]));
    });
    return paths;
  }

  return isDeepStrictEqual(before, after) ? [] : [prefix];
}

function pathContainsReferenceToFlow(pathParts: PathPart[]): boolean {
  return pathParts.includes('referenceToFlowDataSet');
}

function safeProcessKey(processId: string, version: string): string {
  const versionSlug = version.replace(/[^0-9A-Za-z._-]+/gu, '_') || 'unknown';
  return `${processId}__${versionSlug}`;
}

function writeRowsFile(filePath: string, rows: JsonRecord[]): string {
  if (filePath.toLowerCase().endsWith('.jsonl')) {
    return writeJsonLinesArtifact(filePath, rows);
  }
  return writeJsonArtifact(filePath, rows);
}

function mergeRowsByIdentity(
  existingRows: JsonRecord[],
  incomingRows: JsonRecord[],
): {
  mergedRows: JsonRecord[];
  counts: {
    inserted: number;
    updated: number;
    unchanged: number;
    skipped_invalid: number;
  };
} {
  const mergedRows = existingRows.map((row) => cloneJson(row));
  const keyToIndex: Record<string, number> = {};

  mergedRows.forEach((row, index) => {
    const identity = extractProcessIdentity(row);
    if (identity.id && identity.version) {
      keyToIndex[`${identity.id}@${identity.version}`] = index;
    }
  });

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let skippedInvalid = 0;

  incomingRows.forEach((row) => {
    const identity = extractProcessIdentity(row);
    if (!identity.id || !identity.version) {
      skippedInvalid += 1;
      return;
    }

    const key = `${identity.id}@${identity.version}`;
    if (!(key in keyToIndex)) {
      keyToIndex[key] = mergedRows.length;
      mergedRows.push(cloneJson(row));
      inserted += 1;
      return;
    }

    const existingIndex = keyToIndex[key];
    if (isDeepStrictEqual(mergedRows[existingIndex], row)) {
      unchanged += 1;
      return;
    }

    mergedRows[existingIndex] = cloneJson(row);
    updated += 1;
  });

  return {
    mergedRows,
    counts: {
      inserted,
      updated,
      unchanged,
      skipped_invalid: skippedInvalid,
    },
  };
}

function syncProcessPoolFile(poolFile: string, incomingRows: JsonRecord[]): JsonRecord {
  const poolPath = path.resolve(poolFile);
  const existingRows = existsSync(poolPath) ? loadRowsFromFile(poolPath) : [];
  const { mergedRows, counts } = mergeRowsByIdentity(existingRows, incomingRows);
  mergedRows.sort(processRowSortComparator);
  writeRowsFile(poolPath, mergedRows);

  return {
    pool_file: poolPath,
    pool_pre_count: existingRows.length,
    incoming_count: incomingRows.length,
    pool_post_count: mergedRows.length,
    ...counts,
  };
}

function resolveProcessValidator(
  tidasMode: TidasMode,
  deps: FlowRegenProductDeps,
): {
  createProcess: ProcessSdkModule['createProcess'] | null;
  tidasValidation: boolean;
} {
  if (tidasMode === 'skip') {
    return {
      createProcess: null,
      tidasValidation: false,
    };
  }

  try {
    const module = (deps.loadSdkModule ?? resolveLocalSdkModule)();
    if (typeof module.createProcess === 'function') {
      return {
        createProcess: module.createProcess,
        tidasValidation: true,
      };
    }

    if (tidasMode === 'required') {
      throw new CliError('Resolved tidas-sdk core module does not expose createProcess.', {
        code: 'FLOW_REGEN_PROCESS_SDK_INVALID',
        exitCode: 2,
        details: module.location ?? null,
      });
    }
  } catch (error) {
    if (tidasMode === 'required') {
      throw error;
    }
  }

  return {
    createProcess: null,
    tidasValidation: false,
  };
}

function formatValidationDetails(validation: unknown): string {
  if (validation === null || validation === undefined) {
    return 'Validator returned no result.';
  }

  if (validation instanceof Error) {
    return validation.message;
  }

  if (typeof validation === 'string') {
    return validation;
  }

  try {
    return JSON.stringify(validation);
  } catch {
    return String(validation);
  }
}

function evaluateProcessSdkValidation(
  payload: JsonRecord,
  createProcess: NonNullable<ProcessSdkModule['createProcess']>,
): string | null {
  try {
    const entity = createProcess(payload, {
      mode: 'strict',
      throwOnError: false,
      deepValidation: true,
    });
    const validation =
      typeof entity?.validateEnhanced === 'function'
        ? entity.validateEnhanced()
        : typeof entity?.validate === 'function'
          ? entity.validate()
          : null;

    if (isRecord(validation) && validation.success === true) {
      return null;
    }

    return formatValidationDetails(validation);
  } catch (error) {
    return formatValidationDetails(error);
  }
}

function validateProcessPatch(
  originalRow: JsonRecord | null,
  patchedRow: JsonRecord,
  scopeIndex: FlowIndex,
  createProcess: NonNullable<ProcessSdkModule['createProcess']> | null,
): ProcessPatchValidationResult {
  const identity = extractProcessIdentity(patchedRow);
  const issues: ProcessPatchValidationIssue[] = [];

  if (!originalRow) {
    issues.push({
      type: 'missing_original_row',
      severity: 'error',
    });
    return {
      process_id: identity.id,
      process_version: identity.version,
      process_name: identity.name,
      ok: false,
      issues,
    };
  }

  const illegalPaths = deepDiffPaths(originalRow, patchedRow).filter(
    (pathParts) => !pathContainsReferenceToFlow(pathParts),
  );
  if (illegalPaths.length > 0) {
    issues.push({
      type: 'non_reference_changes_detected',
      severity: 'error',
      paths: illegalPaths.map((pathParts) => pathParts.map((part) => String(part)).join('.')),
    });
  }

  const originalQuantitativeReference = coerceText(
    deepGet(processDatasetFromRow(originalRow), [
      'processInformation',
      'quantitativeReference',
      'referenceToReferenceFlow',
    ]),
  );
  const patchedQuantitativeReference = coerceText(
    deepGet(processDatasetFromRow(patchedRow), [
      'processInformation',
      'quantitativeReference',
      'referenceToReferenceFlow',
    ]),
  );
  if (originalQuantitativeReference !== patchedQuantitativeReference) {
    issues.push({
      type: 'quantitative_reference_changed',
      severity: 'error',
      before: originalQuantitativeReference,
      after: patchedQuantitativeReference,
    });
  }

  const originalExchangeCount = exchangeRecords(originalRow).length;
  const patchedExchangeCount = exchangeRecords(patchedRow).length;
  if (originalExchangeCount !== patchedExchangeCount) {
    issues.push({
      type: 'exchange_count_changed',
      severity: 'error',
      before: originalExchangeCount,
      after: patchedExchangeCount,
    });
  }

  exchangeRecords(patchedRow).forEach((exchange) => {
    const ref = isRecord(exchange.referenceToFlowDataSet) ? exchange.referenceToFlowDataSet : {};
    const flowId = coerceText(ref['@refObjectId']);
    const flowVersion = coerceText(ref['@version']);

    if (!flowId || !flowVersion) {
      issues.push({
        type: 'missing_flow_reference_after_patch',
        severity: 'error',
        exchange_internal_id: coerceText(exchange['@dataSetInternalID']),
        flow_id: flowId,
        flow_version: flowVersion,
      });
      return;
    }

    if (!scopeIndex.byUuidVersion[`${flowId}@${flowVersion}`]) {
      issues.push({
        type: 'patched_reference_not_in_scope_catalog',
        severity: 'error',
        exchange_internal_id: coerceText(exchange['@dataSetInternalID']),
        flow_id: flowId,
        flow_version: flowVersion,
      });
    }
  });

  if (createProcess) {
    const details = evaluateProcessSdkValidation(processDatasetFromRow(patchedRow), createProcess);
    if (details !== null) {
      issues.push({
        type: 'tidas_validation_failed',
        severity: 'error',
        details,
      });
    }
  }

  return {
    process_id: identity.id,
    process_version: identity.version,
    process_name: identity.name,
    ok: issues.length === 0,
    issues,
  };
}

function buildScanStageFiles(outDir: string): ScanStageFiles {
  return {
    out_dir: outDir,
    emergy_excluded_processes: path.join(outDir, 'emergy-excluded-processes.json'),
    summary: path.join(outDir, 'scan-summary.json'),
    findings: path.join(outDir, 'scan-findings.json'),
    findings_jsonl: path.join(outDir, 'scan-findings.jsonl'),
  };
}

function buildRepairStageFiles(outDir: string): RepairStageFiles {
  return {
    out_dir: outDir,
    plan: path.join(outDir, 'repair-plan.json'),
    plan_jsonl: path.join(outDir, 'repair-plan.jsonl'),
    manual_review_queue: path.join(outDir, 'manual-review-queue.jsonl'),
    summary: path.join(outDir, 'repair-summary.json'),
  };
}

function buildApplyStageFiles(outDir: string): ApplyStageFiles {
  return {
    ...buildRepairStageFiles(outDir),
    patched_processes: path.join(outDir, 'patched-processes.json'),
    patch_root: path.join(outDir, 'process-patches'),
  };
}

function buildValidateStageFiles(outDir: string): ValidateStageFiles {
  return {
    out_dir: outDir,
    report: path.join(outDir, 'validation-report.json'),
    failures: path.join(outDir, 'validation-failures.jsonl'),
  };
}

function loadOptionalScanFindings(
  scanFindingsFile: string | null,
  requiredCode: string,
  missingCode: string,
): {
  resolvedFile: string | null;
  scanFindings: ScanFinding[];
} {
  if (!scanFindingsFile) {
    return {
      resolvedFile: null,
      scanFindings: [],
    };
  }

  const resolvedFile = assertInputFile(scanFindingsFile, requiredCode, missingCode);

  return {
    resolvedFile,
    scanFindings: loadRowsFromFile(resolvedFile) as ScanFinding[],
  };
}

function runScanStage(
  processes: JsonRecord[],
  scopeIndex: FlowIndex,
  catalogIndex: FlowIndex,
  aliasMap: JsonRecord,
  outDir: string,
  excludeEmergy: boolean,
): ScanStageResult {
  const files = buildScanStageFiles(outDir);
  const { keptRows, excludedRows } = excludeEmergy
    ? filterEmergyNamedProcesses(processes, catalogIndex)
    : { keptRows: processes, excludedRows: [] };
  const findings: ScanFinding[] = [];
  const issueProcessKeys = new Set<string>();
  const issueCounts: Record<string, number> = {};
  let exchangeCount = 0;

  keptRows.forEach((processRow) => {
    const identity = extractProcessIdentity(processRow);
    const exchanges = exchangeRecords(processRow);
    exchangeCount += exchanges.length;

    exchanges.forEach((exchange) => {
      const finding = classifyExchangeRef(processRow, exchange, scopeIndex, catalogIndex, aliasMap);
      findings.push(finding);
      issueCounts[finding.issue_type] = (issueCounts[finding.issue_type] ?? 0) + 1;
      if (finding.issue_type !== 'exists_in_target') {
        issueProcessKeys.add(`${identity.id}@${identity.version}`);
      }
    });
  });

  const summary = {
    process_count_before_emergy_exclusion: processes.length,
    process_count: keptRows.length,
    emergy_excluded_process_count: excludedRows.length,
    exchange_count: exchangeCount,
    issue_counts: issueCounts,
    processes_with_issues: issueProcessKeys.size,
  };

  writeJsonArtifact(files.emergy_excluded_processes, excludedRows);
  writeJsonArtifact(files.summary, summary);
  writeJsonArtifact(files.findings, findings);
  writeJsonLinesArtifact(files.findings_jsonl, findings);

  return {
    filteredProcesses: keptRows,
    emergyExcludedProcesses: excludedRows,
    findings,
    summary,
    files,
  };
}

function runRepairStage(options: {
  processes: JsonRecord[];
  scopeIndex: FlowIndex;
  aliasMap: JsonRecord;
  scanFindings: ScanFinding[];
  autoPatchPolicy: AutoPatchPolicy;
  outDir: string;
  apply: boolean;
  processPoolFile: string | null;
}): RepairStageResult {
  const files = options.apply
    ? buildApplyStageFiles(options.outDir)
    : buildRepairStageFiles(options.outDir);
  const findingMap = buildFindingMap(options.scanFindings);
  const repairPlan: RepairAction[] = [];
  const manualQueue: RepairAction[] = [];
  const patchedRows: JsonRecord[] = [];
  const decisionCounts: Record<string, number> = {};

  options.processes.forEach((processRow) => {
    const identity = extractProcessIdentity(processRow);
    const processKey = `${identity.id}@${identity.version}`;
    const workingRow = options.apply ? cloneJson(processRow) : processRow;
    const processPlan: RepairAction[] = [];
    let changed = false;

    exchangeRecords(workingRow).forEach((exchange) => {
      const action = planExchangeRepair(
        exchange,
        options.scopeIndex,
        options.aliasMap,
        findingMap[`${processKey}::${coerceText(exchange['@dataSetInternalID'])}`] ?? null,
        options.autoPatchPolicy,
      );
      action.process_id = identity.id;
      action.process_version = identity.version;
      action.process_name = identity.name;
      processPlan.push(action);
      repairPlan.push(action);
      decisionCounts[action.decision] = (decisionCounts[action.decision] ?? 0) + 1;

      if (action.decision === 'manual_review') {
        manualQueue.push(action);
      }

      if (options.apply && action.decision === 'auto_patch' && isRecord(action.target_reference)) {
        exchange.referenceToFlowDataSet = cloneJson(action.target_reference);
        changed = true;
      }
    });

    if (options.apply && changed) {
      patchedRows.push(workingRow);
      const patchRoot = (files as ApplyStageFiles).patch_root;
      const processDir = path.join(patchRoot, safeProcessKey(identity.id, identity.version));
      writeJsonArtifact(path.join(processDir, 'before.json'), processRow);
      writeJsonArtifact(path.join(processDir, 'after.json'), workingRow);
      writeJsonArtifact(
        path.join(processDir, 'evidence.json'),
        processPlan.filter((item) => item.decision === 'auto_patch'),
      );
      writeTextArtifact(
        path.join(processDir, 'diff.patch'),
        buildUnifiedJsonDiff(processRow, workingRow),
      );
    }
  });

  const summary: RepairStageResult['summary'] = {
    auto_patch_policy: options.autoPatchPolicy,
    process_count: options.processes.length,
    repair_item_count: repairPlan.length,
    decision_counts: decisionCounts,
    patched_process_count: options.apply ? patchedRows.length : 0,
  };

  if (options.apply && options.processPoolFile) {
    summary.process_pool_sync = syncProcessPoolFile(options.processPoolFile, patchedRows);
  }

  writeJsonArtifact(files.plan, repairPlan);
  writeJsonLinesArtifact(files.plan_jsonl, repairPlan);
  writeJsonLinesArtifact(files.manual_review_queue, manualQueue);
  writeJsonArtifact(files.summary, summary);

  if (options.apply) {
    writeJsonArtifact((files as ApplyStageFiles).patched_processes, patchedRows);
  }

  return {
    plan: repairPlan,
    manualQueue,
    summary,
    files,
    patchedRows,
  };
}

function runValidateStage(options: {
  originalRows: JsonRecord[];
  patchedRows: JsonRecord[];
  scopeIndex: FlowIndex;
  outDir: string;
  tidasMode: TidasMode;
  deps: FlowRegenProductDeps;
}): ValidateStageResult {
  const files = buildValidateStageFiles(options.outDir);
  const validator = resolveProcessValidator(options.tidasMode, options.deps);
  const originalMap: Record<string, JsonRecord> = {};
  options.originalRows.forEach((row) => {
    const key = processRowKey(row);
    if (key) {
      originalMap[key] = row;
    }
  });

  const results = options.patchedRows.map((patchedRow) => {
    const key = processRowKey(patchedRow);
    return validateProcessPatch(
      key ? (originalMap[key] ?? null) : null,
      patchedRow,
      options.scopeIndex,
      validator.createProcess ?? null,
    );
  });
  const failures = results.filter((result) => !result.ok);
  const summary: ProcessPatchValidationSummary = {
    patched_process_count: options.patchedRows.length,
    passed: results.length - failures.length,
    failed: failures.length,
    tidas_validation: validator.tidasValidation,
  };
  const report: ProcessPatchValidationReport = {
    summary,
    results,
  };

  writeJsonArtifact(files.report, report);
  writeJsonLinesArtifact(files.failures, failures);

  return {
    summary,
    results,
    failures,
    files,
  };
}

export async function runFlowScanProcessFlowRefs(
  options: RunFlowScanProcessFlowRefsOptions,
  deps: FlowRegenProductDeps = {},
): Promise<FlowScanProcessFlowRefsReport> {
  const processesFile = assertInputFile(
    options.processesFile,
    'FLOW_SCAN_PROCESS_FLOW_REFS_PROCESSES_FILE_REQUIRED',
    'FLOW_SCAN_PROCESS_FLOW_REFS_PROCESSES_FILE_NOT_FOUND',
  );
  const scopeFlowFiles = assertInputFiles(
    options.scopeFlowFiles ?? [],
    'FLOW_SCAN_PROCESS_FLOW_REFS_SCOPE_FLOW_FILES_REQUIRED',
    'FLOW_SCAN_PROCESS_FLOW_REFS_SCOPE_FLOW_FILE_NOT_FOUND',
  );
  const catalogFlowFiles =
    options.catalogFlowFiles && options.catalogFlowFiles.length > 0
      ? assertInputFiles(
          options.catalogFlowFiles,
          'FLOW_SCAN_PROCESS_FLOW_REFS_CATALOG_FLOW_FILES_REQUIRED',
          'FLOW_SCAN_PROCESS_FLOW_REFS_CATALOG_FLOW_FILE_NOT_FOUND',
        )
      : scopeFlowFiles;
  const aliasMapFile = options.aliasMapFile
    ? assertInputFile(
        options.aliasMapFile,
        'FLOW_SCAN_PROCESS_FLOW_REFS_ALIAS_MAP_REQUIRED',
        'FLOW_SCAN_PROCESS_FLOW_REFS_ALIAS_MAP_NOT_FOUND',
      )
    : null;
  const outDir = assertOutDir(options.outDir);
  const now = deps.now ?? (() => new Date());

  const processes = loadRowsFromFile(processesFile);
  const scopeRows = scopeFlowFiles.flatMap((filePath) => loadRowsFromFile(filePath));
  const catalogRows = catalogFlowFiles.flatMap((filePath) => loadRowsFromFile(filePath));
  const aliasMap = aliasMapFile
    ? readJsonObjectFile(
        aliasMapFile,
        'FLOW_SCAN_PROCESS_FLOW_REFS_ALIAS_MAP_REQUIRED',
        'FLOW_SCAN_PROCESS_FLOW_REFS_ALIAS_MAP_NOT_FOUND',
        'FLOW_SCAN_PROCESS_FLOW_REFS_ALIAS_MAP_INVALID',
      )
    : {};
  const scopeIndex = buildFlowIndex(scopeRows);
  const catalogIndex = buildFlowIndex(catalogRows);
  const scanStage = runScanStage(
    processes,
    scopeIndex,
    catalogIndex,
    aliasMap,
    outDir,
    options.excludeEmergy === true,
  );

  return {
    schema_version: 1,
    generated_at_utc: now().toISOString(),
    status: 'completed_local_flow_scan_process_flow_refs',
    processes_file: processesFile,
    scope_flow_files: scopeFlowFiles,
    catalog_flow_files: catalogFlowFiles,
    alias_map_file: aliasMapFile,
    exclude_emergy: options.excludeEmergy === true,
    out_dir: outDir,
    summary: scanStage.summary,
    files: scanStage.files,
  };
}

export async function runFlowPlanProcessFlowRepairs(
  options: RunFlowPlanProcessFlowRepairsOptions,
  deps: FlowRegenProductDeps = {},
): Promise<FlowPlanProcessFlowRepairsReport> {
  const processesFile = assertInputFile(
    options.processesFile,
    'FLOW_PLAN_PROCESS_FLOW_REPAIRS_PROCESSES_FILE_REQUIRED',
    'FLOW_PLAN_PROCESS_FLOW_REPAIRS_PROCESSES_FILE_NOT_FOUND',
  );
  const scopeFlowFiles = assertInputFiles(
    options.scopeFlowFiles ?? [],
    'FLOW_PLAN_PROCESS_FLOW_REPAIRS_SCOPE_FLOW_FILES_REQUIRED',
    'FLOW_PLAN_PROCESS_FLOW_REPAIRS_SCOPE_FLOW_FILE_NOT_FOUND',
  );
  const aliasMapFile = options.aliasMapFile
    ? assertInputFile(
        options.aliasMapFile,
        'FLOW_PLAN_PROCESS_FLOW_REPAIRS_ALIAS_MAP_REQUIRED',
        'FLOW_PLAN_PROCESS_FLOW_REPAIRS_ALIAS_MAP_NOT_FOUND',
      )
    : null;
  const { resolvedFile: scanFindingsFile, scanFindings } = loadOptionalScanFindings(
    options.scanFindingsFile ?? null,
    'FLOW_PLAN_PROCESS_FLOW_REPAIRS_SCAN_FINDINGS_REQUIRED',
    'FLOW_PLAN_PROCESS_FLOW_REPAIRS_SCAN_FINDINGS_NOT_FOUND',
  );
  const outDir = assertOutDir(options.outDir);
  const autoPatchPolicy = options.autoPatchPolicy ?? 'alias-only';
  const now = deps.now ?? (() => new Date());

  const processes = loadRowsFromFile(processesFile);
  const scopeRows = scopeFlowFiles.flatMap((filePath) => loadRowsFromFile(filePath));
  const aliasMap = aliasMapFile
    ? readJsonObjectFile(
        aliasMapFile,
        'FLOW_PLAN_PROCESS_FLOW_REPAIRS_ALIAS_MAP_REQUIRED',
        'FLOW_PLAN_PROCESS_FLOW_REPAIRS_ALIAS_MAP_NOT_FOUND',
        'FLOW_PLAN_PROCESS_FLOW_REPAIRS_ALIAS_MAP_INVALID',
      )
    : {};
  const scopeIndex = buildFlowIndex(scopeRows);
  const repairStage = runRepairStage({
    processes,
    scopeIndex,
    aliasMap,
    scanFindings,
    autoPatchPolicy,
    outDir,
    apply: false,
    processPoolFile: null,
  });

  return {
    schema_version: 1,
    generated_at_utc: now().toISOString(),
    status: 'completed_local_flow_plan_process_flow_repairs',
    processes_file: processesFile,
    scope_flow_files: scopeFlowFiles,
    alias_map_file: aliasMapFile,
    scan_findings_file: scanFindingsFile,
    auto_patch_policy: autoPatchPolicy,
    out_dir: outDir,
    summary: repairStage.summary,
    files: repairStage.files as RepairStageFiles,
  };
}

export async function runFlowApplyProcessFlowRepairs(
  options: RunFlowApplyProcessFlowRepairsOptions,
  deps: FlowRegenProductDeps = {},
): Promise<FlowApplyProcessFlowRepairsReport> {
  const processesFile = assertInputFile(
    options.processesFile,
    'FLOW_APPLY_PROCESS_FLOW_REPAIRS_PROCESSES_FILE_REQUIRED',
    'FLOW_APPLY_PROCESS_FLOW_REPAIRS_PROCESSES_FILE_NOT_FOUND',
  );
  const scopeFlowFiles = assertInputFiles(
    options.scopeFlowFiles ?? [],
    'FLOW_APPLY_PROCESS_FLOW_REPAIRS_SCOPE_FLOW_FILES_REQUIRED',
    'FLOW_APPLY_PROCESS_FLOW_REPAIRS_SCOPE_FLOW_FILE_NOT_FOUND',
  );
  const aliasMapFile = options.aliasMapFile
    ? assertInputFile(
        options.aliasMapFile,
        'FLOW_APPLY_PROCESS_FLOW_REPAIRS_ALIAS_MAP_REQUIRED',
        'FLOW_APPLY_PROCESS_FLOW_REPAIRS_ALIAS_MAP_NOT_FOUND',
      )
    : null;
  const { resolvedFile: scanFindingsFile, scanFindings } = loadOptionalScanFindings(
    options.scanFindingsFile ?? null,
    'FLOW_APPLY_PROCESS_FLOW_REPAIRS_SCAN_FINDINGS_REQUIRED',
    'FLOW_APPLY_PROCESS_FLOW_REPAIRS_SCAN_FINDINGS_NOT_FOUND',
  );
  const outDir = assertOutDir(options.outDir);
  const autoPatchPolicy = options.autoPatchPolicy ?? 'alias-only';
  const processPoolFile = options.processPoolFile ? path.resolve(options.processPoolFile) : null;
  const now = deps.now ?? (() => new Date());

  const processes = loadRowsFromFile(processesFile);
  const scopeRows = scopeFlowFiles.flatMap((filePath) => loadRowsFromFile(filePath));
  const aliasMap = aliasMapFile
    ? readJsonObjectFile(
        aliasMapFile,
        'FLOW_APPLY_PROCESS_FLOW_REPAIRS_ALIAS_MAP_REQUIRED',
        'FLOW_APPLY_PROCESS_FLOW_REPAIRS_ALIAS_MAP_NOT_FOUND',
        'FLOW_APPLY_PROCESS_FLOW_REPAIRS_ALIAS_MAP_INVALID',
      )
    : {};
  const scopeIndex = buildFlowIndex(scopeRows);
  const repairStage = runRepairStage({
    processes,
    scopeIndex,
    aliasMap,
    scanFindings,
    autoPatchPolicy,
    outDir,
    apply: true,
    processPoolFile,
  });

  return {
    schema_version: 1,
    generated_at_utc: now().toISOString(),
    status: 'completed_local_flow_apply_process_flow_repairs',
    processes_file: processesFile,
    scope_flow_files: scopeFlowFiles,
    alias_map_file: aliasMapFile,
    scan_findings_file: scanFindingsFile,
    auto_patch_policy: autoPatchPolicy,
    process_pool_file: processPoolFile,
    out_dir: outDir,
    summary: repairStage.summary,
    files: repairStage.files as ApplyStageFiles,
  };
}

function buildReportFiles(outDir: string, apply: boolean): FlowRegenProductFiles {
  return {
    report: path.join(outDir, 'flow-regen-product-report.json'),
    scan: buildScanStageFiles(path.join(outDir, 'scan')),
    repair: buildRepairStageFiles(path.join(outDir, 'repair')),
    apply: apply ? buildApplyStageFiles(path.join(outDir, 'repair-apply')) : null,
    validate: apply ? buildValidateStageFiles(path.join(outDir, 'validate')) : null,
  };
}

export async function runFlowRegenProduct(
  options: RunFlowRegenProductOptions,
  deps: FlowRegenProductDeps = {},
): Promise<FlowRegenProductReport> {
  const processesFile = assertInputFile(
    options.processesFile,
    'FLOW_REGEN_PROCESSES_FILE_REQUIRED',
    'FLOW_REGEN_PROCESSES_FILE_NOT_FOUND',
  );
  const scopeFlowFiles = assertInputFiles(
    options.scopeFlowFiles ?? [],
    'FLOW_REGEN_SCOPE_FLOW_FILES_REQUIRED',
    'FLOW_REGEN_SCOPE_FLOW_FILE_NOT_FOUND',
  );
  const catalogFlowFiles =
    options.catalogFlowFiles && options.catalogFlowFiles.length > 0
      ? assertInputFiles(
          options.catalogFlowFiles,
          'FLOW_REGEN_CATALOG_FLOW_FILE_REQUIRED',
          'FLOW_REGEN_CATALOG_FLOW_FILE_NOT_FOUND',
        )
      : scopeFlowFiles;
  const aliasMapFile = options.aliasMapFile
    ? assertInputFile(
        options.aliasMapFile,
        'FLOW_REGEN_ALIAS_MAP_REQUIRED',
        'FLOW_REGEN_ALIAS_MAP_NOT_FOUND',
      )
    : null;
  const outDir = assertOutDir(options.outDir);
  const processPoolFile = options.processPoolFile ? path.resolve(options.processPoolFile) : null;
  const apply = options.apply === true;
  const autoPatchPolicy = options.autoPatchPolicy ?? 'alias-only';
  const tidasMode = options.tidasMode ?? 'auto';
  const files = buildReportFiles(outDir, apply);
  const now = deps.now ?? (() => new Date());

  const processes = loadRowsFromFile(processesFile);
  const scopeRows = scopeFlowFiles.flatMap((filePath) => loadRowsFromFile(filePath));
  const catalogRows = catalogFlowFiles.flatMap((filePath) => loadRowsFromFile(filePath));
  const aliasMap = aliasMapFile
    ? readJsonObjectFile(
        aliasMapFile,
        'FLOW_REGEN_ALIAS_MAP_REQUIRED',
        'FLOW_REGEN_ALIAS_MAP_NOT_FOUND',
        'FLOW_REGEN_ALIAS_MAP_INVALID',
      )
    : {};
  const scopeIndex = buildFlowIndex(scopeRows);
  const catalogIndex = buildFlowIndex(catalogRows);

  const scanStage = runScanStage(
    processes,
    scopeIndex,
    catalogIndex,
    aliasMap,
    files.scan.out_dir,
    options.excludeEmergy === true,
  );
  const repairStage = runRepairStage({
    processes: scanStage.filteredProcesses,
    scopeIndex,
    aliasMap,
    scanFindings: scanStage.findings,
    autoPatchPolicy,
    outDir: files.repair.out_dir,
    apply: false,
    processPoolFile: null,
  });
  const applyStage = apply
    ? runRepairStage({
        processes: scanStage.filteredProcesses,
        scopeIndex,
        aliasMap,
        scanFindings: scanStage.findings,
        autoPatchPolicy,
        outDir: files.apply!.out_dir,
        apply: true,
        processPoolFile,
      })
    : null;
  const validateStage =
    apply && applyStage
      ? runValidateStage({
          originalRows: scanStage.filteredProcesses,
          patchedRows: applyStage.patchedRows,
          scopeIndex,
          outDir: files.validate!.out_dir,
          tidasMode,
          deps,
        })
      : null;

  const report: FlowRegenProductReport = {
    schema_version: 1,
    generated_at_utc: now().toISOString(),
    status: 'completed_local_flow_regen_product',
    mode: apply ? 'apply' : 'plan',
    processes_file: processesFile,
    scope_flow_files: scopeFlowFiles,
    catalog_flow_files: catalogFlowFiles,
    alias_map_file: aliasMapFile,
    exclude_emergy: options.excludeEmergy === true,
    auto_patch_policy: autoPatchPolicy,
    process_pool_file: processPoolFile,
    tidas_mode: tidasMode,
    out_dir: outDir,
    counts: {
      process_count_before_emergy_exclusion:
        scanStage.summary.process_count_before_emergy_exclusion,
      process_count: scanStage.summary.process_count,
      emergy_excluded_process_count: scanStage.summary.emergy_excluded_process_count,
      exchange_count: scanStage.summary.exchange_count,
      issue_counts: scanStage.summary.issue_counts,
      processes_with_issues: scanStage.summary.processes_with_issues,
      repair_item_count: repairStage.summary.repair_item_count,
      decision_counts: repairStage.summary.decision_counts,
      patched_process_count: applyStage?.summary.patched_process_count ?? 0,
      validation_passed_count: validateStage?.summary.passed ?? null,
      validation_failed_count: validateStage?.summary.failed ?? null,
    },
    validation: {
      enabled: apply,
      tidas_validation: validateStage?.summary.tidas_validation ?? false,
      ok: validateStage ? validateStage.summary.failed === 0 : null,
    },
    files,
  };

  writeJsonArtifact(files.report, report);
  return report;
}

export async function runFlowValidateProcesses(
  options: RunFlowValidateProcessesOptions,
  deps: FlowRegenProductDeps = {},
): Promise<FlowValidateProcessesReport> {
  const originalProcessesFile = assertInputFile(
    options.originalProcessesFile,
    'FLOW_VALIDATE_PROCESSES_ORIGINAL_FILE_REQUIRED',
    'FLOW_VALIDATE_PROCESSES_ORIGINAL_FILE_NOT_FOUND',
  );
  const patchedProcessesFile = assertInputFile(
    options.patchedProcessesFile,
    'FLOW_VALIDATE_PROCESSES_PATCHED_FILE_REQUIRED',
    'FLOW_VALIDATE_PROCESSES_PATCHED_FILE_NOT_FOUND',
  );
  const scopeFlowFiles = assertInputFiles(
    options.scopeFlowFiles ?? [],
    'FLOW_VALIDATE_PROCESSES_SCOPE_FLOW_FILES_REQUIRED',
    'FLOW_VALIDATE_PROCESSES_SCOPE_FLOW_FILE_NOT_FOUND',
  );
  const outDir = assertOutDir(options.outDir);
  const tidasMode = options.tidasMode ?? 'auto';
  const now = deps.now ?? (() => new Date());

  const originalRows = loadRowsFromFile(originalProcessesFile);
  const patchedRows = loadRowsFromFile(patchedProcessesFile);
  const scopeRows = scopeFlowFiles.flatMap((filePath) => loadRowsFromFile(filePath));
  const scopeIndex = buildFlowIndex(scopeRows);
  const validateStage = runValidateStage({
    originalRows,
    patchedRows,
    scopeIndex,
    outDir,
    tidasMode,
    deps,
  });

  return {
    schema_version: 1,
    generated_at_utc: now().toISOString(),
    status: 'completed_local_flow_validate_processes',
    original_processes_file: originalProcessesFile,
    patched_processes_file: patchedProcessesFile,
    scope_flow_files: scopeFlowFiles,
    out_dir: outDir,
    tidas_mode: tidasMode,
    summary: validateStage.summary,
    files: validateStage.files,
    results: validateStage.results,
  };
}

export const __testInternals = {
  resolveCliRepoRoot,
  assertInputFile,
  assertInputFiles,
  assertOutDir,
  readJsonObjectFile,
  resolveLocalSdkModule,
  processDatasetFromRow,
  extractProcessIdentity,
  exchangeRecords,
  extractProcessReferenceExchange,
  extractReferenceText,
  extractProcessReferenceFlowRef,
  processRowKey,
  versionKey,
  compareVersionKeys,
  processRowSortComparator,
  buildFlowIndex,
  aliasLookup,
  buildLocalDatasetUri,
  preserveShortDescriptionShape,
  flowReferenceFromRecord,
  patchedFlowReference,
  langEntries,
  textHasEmergyKeyword,
  uniqueNonEmptyTexts,
  flowEmergyScopeDecision,
  processEmergyScopeDecision,
  filterEmergyNamedProcesses,
  classifyExchangeRef,
  buildFindingMap,
  planExchangeRepair,
  buildUnifiedJsonDiff,
  deepDiffPaths,
  pathContainsReferenceToFlow,
  safeProcessKey,
  writeRowsFile,
  mergeRowsByIdentity,
  syncProcessPoolFile,
  buildSdkCandidates,
  resolveSdkModuleFromCandidates,
  resolveProcessValidator,
  formatValidationDetails,
  evaluateProcessSdkValidation,
  validateProcessPatch,
  buildScanStageFiles,
  buildRepairStageFiles,
  buildApplyStageFiles,
  buildValidateStageFiles,
  runScanStage,
  runRepairStage,
  runValidateStage,
  buildReportFiles,
};
