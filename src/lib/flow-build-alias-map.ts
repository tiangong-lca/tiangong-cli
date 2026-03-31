import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writeJsonArtifact, writeJsonLinesArtifact } from './artifacts.js';
import { CliError } from './errors.js';
import {
  extractFlowRecord,
  isRecord,
  loadRowsFromFile,
  normalizeText,
  type FlowRecord,
  type JsonRecord,
} from './flow-governance.js';

type FlowIndex = {
  records: FlowRecord[];
  byUuid: Record<string, FlowRecord[]>;
  byUuidVersion: Record<string, FlowRecord>;
  byName: Record<string, FlowRecord[]>;
};

export type FlowBuildAliasMapFiles = {
  out_dir: string;
  alias_plan: string;
  alias_plan_jsonl: string;
  flow_alias_map: string;
  manual_review_queue: string;
  summary: string;
};

export type FlowBuildAliasMapSummary = {
  old_flow_count: number;
  new_flow_count: number;
  alias_entries_versioned: number;
  alias_entries_uuid_only: number;
  manual_review_count: number;
  decision_counts: Record<string, number>;
};

export type FlowAliasPlanAction = {
  old_flow_id: string;
  old_flow_version: string;
  old_flow_name: string;
  old_flow_type: string;
  decision: 'no_alias_needed' | 'alias_map_entry' | 'manual_review';
  reason: string;
  target_flow_id?: string;
  target_flow_version?: string;
  target_flow_name?: string;
  target_flow_type?: string;
  candidate_refs?: Array<Record<string, string>>;
};

export type FlowBuildAliasMapReport = {
  schema_version: 1;
  generated_at_utc: string;
  status: 'completed_local_flow_build_alias_map';
  old_flow_files: string[];
  new_flow_files: string[];
  seed_alias_map_file: string | null;
  out_dir: string;
  summary: FlowBuildAliasMapSummary;
  files: FlowBuildAliasMapFiles;
};

export type RunFlowBuildAliasMapOptions = {
  oldFlowFiles: string[];
  newFlowFiles: string[];
  seedAliasMapFile?: string | null;
  outDir: string;
};

type FlowBuildAliasMapDeps = {
  now?: () => Date;
};

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
      code: 'FLOW_BUILD_ALIAS_MAP_OUT_DIR_REQUIRED',
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

function candidateRef(record: FlowRecord, includeType = false): Record<string, string> {
  return {
    id: record.id,
    version: record.version,
    name: record.name,
    ...(includeType ? { flow_type: record.flowType } : {}),
  };
}

function planAlias(
  oldRecord: FlowRecord,
  newIndex: FlowIndex,
  seedAliasMap: JsonRecord,
): FlowAliasPlanAction {
  const base: FlowAliasPlanAction = {
    old_flow_id: oldRecord.id,
    old_flow_version: oldRecord.version,
    old_flow_name: oldRecord.name,
    old_flow_type: oldRecord.flowType,
    decision: 'manual_review',
    reason: 'no_deterministic_match',
  };

  const existingTarget = newIndex.byUuidVersion[`${oldRecord.id}@${oldRecord.version}`];
  if (existingTarget) {
    return {
      ...base,
      decision: 'no_alias_needed',
      reason: 'already_present_in_target',
      target_flow_id: existingTarget.id,
      target_flow_version: existingTarget.version,
    };
  }

  const seededTarget = aliasLookup(seedAliasMap, oldRecord.id, oldRecord.version || null);
  if (seededTarget) {
    const targetRecord =
      newIndex.byUuidVersion[
        `${String(seededTarget.id ?? '')}@${String(seededTarget.version ?? '')}`
      ];
    if (targetRecord) {
      return {
        ...base,
        decision: 'alias_map_entry',
        reason: 'seed_alias_map',
        target_flow_id: targetRecord.id,
        target_flow_version: targetRecord.version,
        target_flow_name: targetRecord.name,
        target_flow_type: targetRecord.flowType,
      };
    }
  }

  const sameUuidCandidates = newIndex.byUuid[oldRecord.id] ?? [];
  if (sameUuidCandidates.length === 1) {
    const candidate = sameUuidCandidates[0];
    return {
      ...base,
      decision: 'alias_map_entry',
      reason: 'same_uuid_single_target_version',
      target_flow_id: candidate.id,
      target_flow_version: candidate.version,
      target_flow_name: candidate.name,
      target_flow_type: candidate.flowType,
    };
  }

  if (sameUuidCandidates.length > 1) {
    return {
      ...base,
      decision: 'manual_review',
      reason: 'same_uuid_multiple_target_versions',
      candidate_refs: sameUuidCandidates.map((candidate) => candidateRef(candidate)),
    };
  }

  const byName = newIndex.byName[normalizeText(oldRecord.name)] ?? [];
  const nameAndTypeCandidates = byName.filter(
    (candidate) => candidate.flowType === oldRecord.flowType,
  );
  if (nameAndTypeCandidates.length === 1) {
    const candidate = nameAndTypeCandidates[0];
    return {
      ...base,
      decision: 'alias_map_entry',
      reason: 'unique_exact_name_and_type_match',
      target_flow_id: candidate.id,
      target_flow_version: candidate.version,
      target_flow_name: candidate.name,
      target_flow_type: candidate.flowType,
    };
  }

  if (nameAndTypeCandidates.length > 1) {
    return {
      ...base,
      decision: 'manual_review',
      reason: 'ambiguous_name_and_type_match',
      candidate_refs: nameAndTypeCandidates.map((candidate) => candidateRef(candidate)),
    };
  }

  if (byName.length > 0) {
    return {
      ...base,
      decision: 'manual_review',
      reason: 'name_match_flow_type_mismatch',
      candidate_refs: byName.map((candidate) => candidateRef(candidate, true)),
    };
  }

  return base;
}

function buildDecisionCounts(actions: FlowAliasPlanAction[]): Record<string, number> {
  const counts: Record<string, number> = {};
  actions.forEach((action) => {
    counts[action.decision] = (counts[action.decision] ?? 0) + 1;
  });
  return counts;
}

function buildOutputFiles(outDir: string): FlowBuildAliasMapFiles {
  return {
    out_dir: outDir,
    alias_plan: path.join(outDir, 'alias-plan.json'),
    alias_plan_jsonl: path.join(outDir, 'alias-plan.jsonl'),
    flow_alias_map: path.join(outDir, 'flow-alias-map.json'),
    manual_review_queue: path.join(outDir, 'manual-review-queue.jsonl'),
    summary: path.join(outDir, 'alias-summary.json'),
  };
}

export async function runFlowBuildAliasMap(
  options: RunFlowBuildAliasMapOptions,
  deps: FlowBuildAliasMapDeps = {},
): Promise<FlowBuildAliasMapReport> {
  const oldFlowFiles = assertInputFiles(
    options.oldFlowFiles ?? [],
    'FLOW_BUILD_ALIAS_MAP_OLD_FLOW_FILES_REQUIRED',
    'FLOW_BUILD_ALIAS_MAP_OLD_FLOW_FILE_NOT_FOUND',
  );
  const newFlowFiles = assertInputFiles(
    options.newFlowFiles ?? [],
    'FLOW_BUILD_ALIAS_MAP_NEW_FLOW_FILES_REQUIRED',
    'FLOW_BUILD_ALIAS_MAP_NEW_FLOW_FILE_NOT_FOUND',
  );
  const seedAliasMapFile = options.seedAliasMapFile
    ? assertInputFile(
        options.seedAliasMapFile,
        'FLOW_BUILD_ALIAS_MAP_SEED_ALIAS_MAP_REQUIRED',
        'FLOW_BUILD_ALIAS_MAP_SEED_ALIAS_MAP_NOT_FOUND',
      )
    : null;
  const outDir = assertOutDir(options.outDir);
  const now = deps.now ?? (() => new Date());
  const files = buildOutputFiles(outDir);

  const oldRows = oldFlowFiles.flatMap((filePath) => loadRowsFromFile(filePath));
  const newRows = newFlowFiles.flatMap((filePath) => loadRowsFromFile(filePath));
  const oldIndex = buildFlowIndex(oldRows);
  const newIndex = buildFlowIndex(newRows);
  const seedAliasMap = seedAliasMapFile
    ? readJsonObjectFile(
        seedAliasMapFile,
        'FLOW_BUILD_ALIAS_MAP_SEED_ALIAS_MAP_REQUIRED',
        'FLOW_BUILD_ALIAS_MAP_SEED_ALIAS_MAP_NOT_FOUND',
        'FLOW_BUILD_ALIAS_MAP_SEED_ALIAS_MAP_INVALID',
      )
    : {};

  const aliasPlan: FlowAliasPlanAction[] = [];
  const manualQueue: FlowAliasPlanAction[] = [];
  const versionAliasMap: Record<string, JsonRecord> = {};
  const uuidTargets: Record<string, Set<string>> = {};

  oldIndex.records.forEach((oldRecord) => {
    const action = planAlias(oldRecord, newIndex, seedAliasMap);
    aliasPlan.push(action);

    if (
      action.decision === 'alias_map_entry' &&
      action.target_flow_id &&
      action.target_flow_version
    ) {
      const target = {
        id: action.target_flow_id,
        version: action.target_flow_version,
        reason: action.reason,
      } satisfies JsonRecord;
      versionAliasMap[`${oldRecord.id}@${oldRecord.version}`] = target;
      uuidTargets[oldRecord.id] ??= new Set<string>();
      uuidTargets[oldRecord.id].add(`${action.target_flow_id}@${action.target_flow_version}`);
      return;
    }

    if (action.decision === 'manual_review') {
      manualQueue.push(action);
    }
  });

  const flowAliasMap: Record<string, JsonRecord> = {
    ...versionAliasMap,
  };
  Object.entries(uuidTargets).forEach(([oldUuid, targets]) => {
    if (targets.size !== 1) {
      return;
    }
    const [targetId, targetVersion] = [...targets][0].split('@', 2);
    flowAliasMap[oldUuid] = {
      id: targetId,
      version: targetVersion,
      reason: 'all_versions_share_same_target',
    };
  });

  const summary: FlowBuildAliasMapSummary = {
    old_flow_count: oldIndex.records.length,
    new_flow_count: newIndex.records.length,
    alias_entries_versioned: Object.keys(versionAliasMap).length,
    alias_entries_uuid_only: Object.keys(flowAliasMap).length - Object.keys(versionAliasMap).length,
    manual_review_count: manualQueue.length,
    decision_counts: buildDecisionCounts(aliasPlan),
  };

  writeJsonArtifact(files.alias_plan, aliasPlan);
  writeJsonLinesArtifact(files.alias_plan_jsonl, aliasPlan);
  writeJsonArtifact(files.flow_alias_map, flowAliasMap);
  writeJsonLinesArtifact(files.manual_review_queue, manualQueue);
  writeJsonArtifact(files.summary, summary);

  return {
    schema_version: 1,
    generated_at_utc: now().toISOString(),
    status: 'completed_local_flow_build_alias_map',
    old_flow_files: oldFlowFiles,
    new_flow_files: newFlowFiles,
    seed_alias_map_file: seedAliasMapFile,
    out_dir: outDir,
    summary,
    files,
  };
}

export const __testInternals = {
  assertInputFile,
  assertInputFiles,
  assertOutDir,
  readJsonObjectFile,
  buildFlowIndex,
  aliasLookup,
  candidateRef,
  planAlias,
  buildDecisionCounts,
  buildOutputFiles,
};
