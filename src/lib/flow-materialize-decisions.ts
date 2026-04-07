import { existsSync } from 'node:fs';
import path from 'node:path';
import { writeJsonArtifact } from './artifacts.js';
import { CliError } from './errors.js';
import {
  extractFlowRecord,
  loadRowsFromFile,
  type FlowRecord,
  type JsonRecord,
} from './flow-governance.js';

type FlowRef = {
  id: string;
  version: string;
};

type SupportedDecision = 'merge_keep_one' | 'keep_distinct' | 'blocked_missing_db_flow';

type NormalizedDecision = {
  clusterId: string;
  decision: SupportedDecision;
  reason: string | null;
  canonicalRef: FlowRef | null;
  memberRefs: FlowRef[];
};

type IndexedFlowRow = {
  key: string;
  row: JsonRecord;
  record: FlowRecord;
};

type CanonicalFlowSummary = {
  id: string;
  version: string;
  name: string;
  flow_type: string;
};

type CanonicalMapCluster = {
  cluster_id: string;
  decision: 'merge_keep_one';
  reason: string | null;
  canonical_flow: CanonicalFlowSummary;
  merged_flows: Array<
    CanonicalFlowSummary & {
      relation: 'canonical_self' | 'rewrite_to_canonical';
    }
  >;
};

type CanonicalMapEntry = {
  id: string;
  version: string;
  cluster_id: string;
  relation: 'canonical_self' | 'rewrite_to_canonical';
  reason: string;
};

type RewritePlanAction = {
  cluster_id: string;
  action: 'rewrite_to_canonical';
  reason: string;
  source_flow_id: string;
  source_flow_version: string;
  source_flow_name: string;
  source_flow_type: string;
  target_flow_id: string;
  target_flow_version: string;
  target_flow_name: string;
  target_flow_type: string;
};

type BlockedCluster = {
  cluster_id: string;
  decision: SupportedDecision;
  blocker_code:
    | 'decision_keep_distinct'
    | 'blocked_missing_db_flow'
    | 'merge_canonical_flow_missing'
    | 'flow_row_missing';
  reason: string | null;
  canonical_flow: FlowRef | null;
  cluster_members: FlowRef[];
  missing_flow_keys: string[];
};

type FlowMaterializeDecisionsFiles = {
  canonical_map: string;
  rewrite_plan: string;
  semantic_merge_seed: string;
  summary: string;
  blocked_clusters: string;
};

type FlowMaterializeDecisionCounts = {
  input_decisions: number;
  materialized_clusters: number;
  blocked_clusters: number;
  canonical_map_entries: number;
  rewrite_actions: number;
  seed_alias_entries: number;
  decision_counts: Record<SupportedDecision, number>;
  blocked_reason_counts: Record<string, number>;
};

export type FlowMaterializeDecisionsReport = {
  schema_version: 1;
  generated_at_utc: string;
  status:
    | 'completed_local_flow_decision_materialization'
    | 'completed_local_flow_decision_materialization_with_blocked_clusters';
  decision_file: string;
  flow_rows_file: string;
  out_dir: string;
  counts: FlowMaterializeDecisionCounts;
  files: FlowMaterializeDecisionsFiles;
};

export type RunFlowMaterializeDecisionsOptions = {
  decisionFile: string;
  flowRowsFile: string;
  outDir: string;
  now?: Date;
};

function normalizeToken(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function assertInputFile(inputFile: string, requiredCode: string, missingCode: string): string {
  const normalized = normalizeToken(inputFile);
  if (!normalized) {
    throw new CliError('Missing required input file value.', {
      code: requiredCode,
      exitCode: 2,
    });
  }

  const resolved = path.resolve(normalized);
  if (!existsSync(resolved)) {
    throw new CliError(`Input file not found: ${resolved}`, {
      code: missingCode,
      exitCode: 2,
    });
  }

  return resolved;
}

function assertOutDir(outDir: string): string {
  const normalized = normalizeToken(outDir);
  if (!normalized) {
    throw new CliError('Missing required --out-dir value.', {
      code: 'FLOW_MATERIALIZE_DECISIONS_OUT_DIR_REQUIRED',
      exitCode: 2,
    });
  }

  return path.resolve(normalized);
}

function parseFlowRefString(value: string, code: string): FlowRef {
  const trimmed = value.trim();
  const [id, version, rest] = trimmed.split('@');
  if (!id || !version || rest !== undefined) {
    throw new CliError(`Expected flow ref to use id@version format, received: ${value}`, {
      code,
      exitCode: 2,
    });
  }

  return {
    id,
    version,
  };
}

function parseFlowRefLike(value: unknown, code: string): FlowRef | null {
  if (typeof value === 'string') {
    return parseFlowRefString(value, code);
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as JsonRecord;
    const id = normalizeToken(record.id);
    const version = normalizeToken(record.version);
    if (!id || !version) {
      throw new CliError('Expected flow ref objects to contain id and version.', {
        code,
        exitCode: 2,
        details: value,
      });
    }
    return {
      id,
      version,
    };
  }

  if (value === undefined || value === null) {
    return null;
  }

  throw new CliError(
    'Expected flow ref values to be id@version strings or { id, version } objects.',
    {
      code,
      exitCode: 2,
      details: value,
    },
  );
}

function parseFlowRefArray(row: JsonRecord, keys: string[], code: string): FlowRef[] {
  const refs: FlowRef[] = [];
  keys.forEach((key) => {
    const value = row[key];
    if (!Array.isArray(value)) {
      return;
    }
    value.forEach((item) => {
      const ref = parseFlowRefLike(item, code);
      if (ref) {
        refs.push(ref);
      }
    });
  });
  return refs;
}

function uniqueFlowRefs(refs: FlowRef[]): FlowRef[] {
  const seen = new Set<string>();
  const unique: FlowRef[] = [];
  refs.forEach((ref) => {
    const key = `${ref.id}@${ref.version}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    unique.push(ref);
  });
  return unique;
}

function parseDecisionRow(row: JsonRecord, index: number): NormalizedDecision {
  const clusterId = normalizeToken(row.cluster_id ?? row.clusterId);
  if (!clusterId) {
    throw new CliError(`Decision row ${index + 1} is missing cluster_id.`, {
      code: 'FLOW_MATERIALIZE_DECISIONS_CLUSTER_ID_REQUIRED',
      exitCode: 2,
      details: row,
    });
  }

  const rawDecision = normalizeToken(row.decision ?? row.approved_decision ?? row.outcome);
  if (
    rawDecision !== 'merge_keep_one' &&
    rawDecision !== 'keep_distinct' &&
    rawDecision !== 'blocked_missing_db_flow'
  ) {
    throw new CliError(
      `Decision row ${clusterId} must use one of merge_keep_one, keep_distinct, or blocked_missing_db_flow.`,
      {
        code: 'FLOW_MATERIALIZE_DECISIONS_INVALID_DECISION',
        exitCode: 2,
        details: row,
      },
    );
  }

  const canonicalRef = parseFlowRefLike(
    row.canonical_flow ??
      row.canonical_ref ??
      row.keep ??
      row.keep_ref ??
      row.keep_flow ??
      row.canonical_flow_key,
    'FLOW_MATERIALIZE_DECISIONS_INVALID_CANONICAL_REF',
  );
  const memberRefs = uniqueFlowRefs([
    ...parseFlowRefArray(
      row,
      [
        'flow_refs',
        'cluster_members',
        'members',
        'flows',
        'flow_keys',
        'member_keys',
        'drop_refs',
        'drops',
        'rewrite_sources',
      ],
      'FLOW_MATERIALIZE_DECISIONS_INVALID_MEMBER_REF',
    ),
    ...(canonicalRef ? [canonicalRef] : []),
  ]);

  if (rawDecision === 'merge_keep_one' && !canonicalRef) {
    throw new CliError(`Decision row ${clusterId} is missing canonical flow information.`, {
      code: 'FLOW_MATERIALIZE_DECISIONS_CANONICAL_REQUIRED',
      exitCode: 2,
      details: row,
    });
  }

  if (rawDecision === 'merge_keep_one' && memberRefs.length < 2) {
    throw new CliError(
      `Decision row ${clusterId} needs at least two cluster members for merge_keep_one.`,
      {
        code: 'FLOW_MATERIALIZE_DECISIONS_MEMBERS_REQUIRED',
        exitCode: 2,
        details: row,
      },
    );
  }

  return {
    clusterId,
    decision: rawDecision,
    reason: normalizeToken(row.reason ?? row.notes ?? row.message),
    canonicalRef,
    memberRefs,
  };
}

function buildFlowIndex(rows: JsonRecord[]): Map<string, IndexedFlowRow> {
  const index = new Map<string, IndexedFlowRow>();
  rows.forEach((row, rowIndex) => {
    const record = extractFlowRecord(row);
    const key = `${record.id}@${record.version}`;
    if (index.has(key)) {
      throw new CliError(`Duplicate flow row detected for ${key}.`, {
        code: 'FLOW_MATERIALIZE_DECISIONS_DUPLICATE_FLOW_ROW',
        exitCode: 2,
        details: {
          flow_key: key,
          first_index: [...index.keys()].indexOf(key),
          duplicate_index: rowIndex,
        },
      });
    }
    index.set(key, {
      key,
      row,
      record,
    });
  });
  return index;
}

function summarizeFlow(record: FlowRecord): CanonicalFlowSummary {
  return {
    id: record.id,
    version: record.version,
    name: record.name,
    flow_type: record.flowType,
  };
}

function buildOutputFiles(outDir: string): FlowMaterializeDecisionsFiles {
  return {
    canonical_map: path.join(outDir, 'flow-dedup-canonical-map.json'),
    rewrite_plan: path.join(outDir, 'flow-dedup-rewrite-plan.json'),
    semantic_merge_seed: path.join(outDir, 'manual-semantic-merge-seed.current.json'),
    summary: path.join(outDir, 'decision-summary.json'),
    blocked_clusters: path.join(outDir, 'blocked-clusters.json'),
  };
}

function incrementCount(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function sortedObject<T>(entries: Array<[string, T]>): Record<string, T> {
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

export async function runFlowMaterializeDecisions(
  options: RunFlowMaterializeDecisionsOptions,
): Promise<FlowMaterializeDecisionsReport> {
  const decisionFile = assertInputFile(
    options.decisionFile,
    'FLOW_MATERIALIZE_DECISIONS_DECISION_FILE_REQUIRED',
    'FLOW_MATERIALIZE_DECISIONS_DECISION_FILE_NOT_FOUND',
  );
  const flowRowsFile = assertInputFile(
    options.flowRowsFile,
    'FLOW_MATERIALIZE_DECISIONS_FLOW_ROWS_FILE_REQUIRED',
    'FLOW_MATERIALIZE_DECISIONS_FLOW_ROWS_FILE_NOT_FOUND',
  );
  const outDir = assertOutDir(options.outDir);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const files = buildOutputFiles(outDir);

  const decisions = loadRowsFromFile(decisionFile).map((row, index) =>
    parseDecisionRow(row, index),
  );
  const flowIndex = buildFlowIndex(loadRowsFromFile(flowRowsFile));

  const canonicalClusters: CanonicalMapCluster[] = [];
  const canonicalMapEntries: Array<[string, CanonicalMapEntry]> = [];
  const rewriteActions: RewritePlanAction[] = [];
  const seedAliasEntries: Array<[string, CanonicalMapEntry]> = [];
  const blockedClusters: BlockedCluster[] = [];
  const decisionCounts: FlowMaterializeDecisionCounts['decision_counts'] = {
    merge_keep_one: 0,
    keep_distinct: 0,
    blocked_missing_db_flow: 0,
  };
  const blockedReasonCounts: Record<string, number> = {};

  decisions.forEach((decision) => {
    decisionCounts[decision.decision] += 1;

    if (decision.decision === 'keep_distinct') {
      blockedClusters.push({
        cluster_id: decision.clusterId,
        decision: decision.decision,
        blocker_code: 'decision_keep_distinct',
        reason: decision.reason,
        canonical_flow: decision.canonicalRef,
        cluster_members: decision.memberRefs,
        missing_flow_keys: [],
      });
      incrementCount(blockedReasonCounts, 'decision_keep_distinct');
      return;
    }

    if (decision.decision === 'blocked_missing_db_flow') {
      blockedClusters.push({
        cluster_id: decision.clusterId,
        decision: decision.decision,
        blocker_code: 'blocked_missing_db_flow',
        reason: decision.reason,
        canonical_flow: decision.canonicalRef,
        cluster_members: decision.memberRefs,
        missing_flow_keys: [],
      });
      incrementCount(blockedReasonCounts, 'blocked_missing_db_flow');
      return;
    }

    const canonicalRef = decision.canonicalRef as FlowRef;
    const canonicalKey = `${canonicalRef.id}@${canonicalRef.version}`;
    const missingFlowKeys = decision.memberRefs
      .map((ref) => `${ref.id}@${ref.version}`)
      .filter((key) => !flowIndex.has(key));

    if (!flowIndex.has(canonicalKey)) {
      blockedClusters.push({
        cluster_id: decision.clusterId,
        decision: decision.decision,
        blocker_code: 'merge_canonical_flow_missing',
        reason: decision.reason,
        canonical_flow: canonicalRef,
        cluster_members: decision.memberRefs,
        missing_flow_keys: [...new Set([canonicalKey, ...missingFlowKeys])],
      });
      incrementCount(blockedReasonCounts, 'merge_canonical_flow_missing');
      return;
    }

    if (missingFlowKeys.length > 0) {
      blockedClusters.push({
        cluster_id: decision.clusterId,
        decision: decision.decision,
        blocker_code: 'flow_row_missing',
        reason: decision.reason,
        canonical_flow: canonicalRef,
        cluster_members: decision.memberRefs,
        missing_flow_keys: [...new Set(missingFlowKeys)].sort(),
      });
      incrementCount(blockedReasonCounts, 'flow_row_missing');
      return;
    }

    const canonicalFlow = flowIndex.get(canonicalKey) as IndexedFlowRow;
    const mergeReason = decision.reason ?? 'approved_merge_keep_one';
    const mergedFlows = decision.memberRefs
      .map((ref) => flowIndex.get(`${ref.id}@${ref.version}`) as IndexedFlowRow)
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((entry) => ({
        ...summarizeFlow(entry.record),
        relation:
          entry.key === canonicalKey
            ? ('canonical_self' as const)
            : ('rewrite_to_canonical' as const),
      }));

    canonicalClusters.push({
      cluster_id: decision.clusterId,
      decision: 'merge_keep_one',
      reason: decision.reason,
      canonical_flow: summarizeFlow(canonicalFlow.record),
      merged_flows: mergedFlows,
    });

    mergedFlows.forEach((flow) => {
      canonicalMapEntries.push([
        `${flow.id}@${flow.version}`,
        {
          id: canonicalFlow.record.id,
          version: canonicalFlow.record.version,
          cluster_id: decision.clusterId,
          relation: flow.relation,
          reason: mergeReason,
        },
      ]);

      if (flow.relation === 'rewrite_to_canonical') {
        rewriteActions.push({
          cluster_id: decision.clusterId,
          action: 'rewrite_to_canonical',
          reason: mergeReason,
          source_flow_id: flow.id,
          source_flow_version: flow.version,
          source_flow_name: flow.name,
          source_flow_type: flow.flow_type,
          target_flow_id: canonicalFlow.record.id,
          target_flow_version: canonicalFlow.record.version,
          target_flow_name: canonicalFlow.record.name,
          target_flow_type: canonicalFlow.record.flowType,
        });
        seedAliasEntries.push([
          `${flow.id}@${flow.version}`,
          {
            id: canonicalFlow.record.id,
            version: canonicalFlow.record.version,
            cluster_id: decision.clusterId,
            relation: 'rewrite_to_canonical',
            reason: mergeReason,
          },
        ]);
      }
    });
  });

  const canonicalMapByFlowKey = sortedObject(canonicalMapEntries);
  const semanticMergeSeed = sortedObject(
    seedAliasEntries.map(([key, value]) => [
      key,
      {
        id: value.id,
        version: value.version,
        reason: value.reason,
        cluster_id: value.cluster_id,
      },
    ]),
  );
  const report: FlowMaterializeDecisionsReport = {
    schema_version: 1,
    generated_at_utc: generatedAt,
    status:
      blockedClusters.length > 0
        ? 'completed_local_flow_decision_materialization_with_blocked_clusters'
        : 'completed_local_flow_decision_materialization',
    decision_file: decisionFile,
    flow_rows_file: flowRowsFile,
    out_dir: outDir,
    counts: {
      input_decisions: decisions.length,
      materialized_clusters: canonicalClusters.length,
      blocked_clusters: blockedClusters.length,
      canonical_map_entries: Object.keys(canonicalMapByFlowKey).length,
      rewrite_actions: rewriteActions.length,
      seed_alias_entries: Object.keys(semanticMergeSeed).length,
      decision_counts: decisionCounts,
      blocked_reason_counts: blockedReasonCounts,
    },
    files,
  };

  writeJsonArtifact(files.canonical_map, {
    schema_version: 1,
    generated_at_utc: generatedAt,
    clusters: canonicalClusters.sort((left, right) =>
      left.cluster_id.localeCompare(right.cluster_id),
    ),
    by_flow_key: canonicalMapByFlowKey,
  });
  writeJsonArtifact(files.rewrite_plan, {
    schema_version: 1,
    generated_at_utc: generatedAt,
    actions: rewriteActions.sort((left, right) => {
      const clusterOrder = left.cluster_id.localeCompare(right.cluster_id);
      if (clusterOrder !== 0) {
        return clusterOrder;
      }
      const leftKey = `${left.source_flow_id}@${left.source_flow_version}`;
      const rightKey = `${right.source_flow_id}@${right.source_flow_version}`;
      return leftKey.localeCompare(rightKey);
    }),
  });
  writeJsonArtifact(files.semantic_merge_seed, semanticMergeSeed);
  writeJsonArtifact(files.blocked_clusters, {
    schema_version: 1,
    generated_at_utc: generatedAt,
    clusters: blockedClusters.sort((left, right) =>
      left.cluster_id.localeCompare(right.cluster_id),
    ),
  });
  writeJsonArtifact(files.summary, report);

  return report;
}

export const __testInternals = {
  parseDecisionRow,
  parseFlowRefLike,
  parseFlowRefString,
  uniqueFlowRefs,
  buildFlowIndex,
  buildOutputFiles,
};
