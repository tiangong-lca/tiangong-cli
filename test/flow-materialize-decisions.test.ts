import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError } from '../src/lib/errors.js';
import { runFlowMaterializeDecisions } from '../src/lib/flow-materialize-decisions.js';

type JsonRecord = Record<string, unknown>;

function lang(text: string, langCode = 'en'): JsonRecord {
  return {
    '@xml:lang': langCode,
    '#text': text,
  };
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(filePath: string): JsonRecord {
  return JSON.parse(readFileSync(filePath, 'utf8')) as JsonRecord;
}

function makeFlowRow(options: {
  id: string;
  version?: string;
  name?: string;
  flowType?: string;
}): JsonRecord {
  const version = options.version ?? '01.00.000';
  const name = options.name ?? options.id;
  const flowType = options.flowType ?? 'Product flow';

  return {
    id: options.id,
    version,
    json_ordered: {
      flowDataSet: {
        flowInformation: {
          dataSetInformation: {
            'common:UUID': options.id,
            name: {
              baseName: [lang(name)],
            },
            'common:shortDescription': [lang(`${name} short`)],
          },
        },
        modellingAndValidation: {
          LCIMethodAndAllocation: {
            typeOfDataSet: flowType,
          },
        },
        administrativeInformation: {
          publicationAndOwnership: {
            'common:dataSetVersion': version,
          },
        },
      },
    },
  };
}

test('runFlowMaterializeDecisions writes canonical, rewrite, seed, and blocked artifacts', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-materialize-decisions-'));
  const decisionFile = path.join(dir, 'decisions.json');
  const flowRowsFile = path.join(dir, 'flow-rows.jsonl');
  const outDir = path.join(dir, 'out');

  writeJson(decisionFile, [
    {
      cluster_id: 'cluster-0001',
      decision: 'merge_keep_one',
      canonical_flow: {
        id: 'flow-a',
        version: '01.00.000',
      },
      flow_refs: [
        { id: 'flow-a', version: '01.00.000' },
        { id: 'flow-b', version: '01.00.000' },
      ],
      reason: 'same_property_semantic_review',
    },
    {
      cluster_id: 'cluster-0002',
      decision: 'keep_distinct',
      flow_refs: ['flow-a@01.00.000', 'flow-c@01.00.000'],
      reason: 'purity_conflict',
    },
    {
      cluster_id: 'cluster-0003',
      decision: 'merge_keep_one',
      canonical_flow: 'flow-c@01.00.000',
      flow_refs: ['flow-c@01.00.000', 'missing-flow@01.00.000'],
      reason: 'missing_db_row',
    },
    {
      cluster_id: 'cluster-0004',
      decision: 'blocked_missing_db_flow',
      flow_refs: ['flow-d@01.00.000', 'flow-e@01.00.000'],
      reason: 'blocked_by_fetch',
    },
  ]);
  writeFileSync(
    flowRowsFile,
    [
      makeFlowRow({ id: 'flow-a', name: 'Flow A' }),
      makeFlowRow({ id: 'flow-b', name: 'Flow B' }),
      makeFlowRow({ id: 'flow-c', name: 'Flow C' }),
    ]
      .map((row) => JSON.stringify(row))
      .join('\n')
      .concat('\n'),
    'utf8',
  );

  try {
    const report = await runFlowMaterializeDecisions({
      decisionFile,
      flowRowsFile,
      outDir,
      now: new Date('2026-04-06T13:00:00.000Z'),
    });

    assert.deepEqual(report, {
      schema_version: 1,
      generated_at_utc: '2026-04-06T13:00:00.000Z',
      status: 'completed_local_flow_decision_materialization_with_blocked_clusters',
      decision_file: decisionFile,
      flow_rows_file: flowRowsFile,
      out_dir: outDir,
      counts: {
        input_decisions: 4,
        materialized_clusters: 1,
        blocked_clusters: 3,
        canonical_map_entries: 2,
        rewrite_actions: 1,
        seed_alias_entries: 1,
        decision_counts: {
          merge_keep_one: 2,
          keep_distinct: 1,
          blocked_missing_db_flow: 1,
        },
        blocked_reason_counts: {
          blocked_missing_db_flow: 1,
          decision_keep_distinct: 1,
          flow_row_missing: 1,
        },
      },
      files: {
        canonical_map: path.join(outDir, 'flow-dedup-canonical-map.json'),
        rewrite_plan: path.join(outDir, 'flow-dedup-rewrite-plan.json'),
        semantic_merge_seed: path.join(outDir, 'manual-semantic-merge-seed.current.json'),
        summary: path.join(outDir, 'decision-summary.json'),
        blocked_clusters: path.join(outDir, 'blocked-clusters.json'),
      },
    });

    const canonicalMap = readJson(report.files.canonical_map);
    assert.equal((canonicalMap.clusters as unknown[]).length, 1);
    assert.deepEqual(canonicalMap.by_flow_key, {
      'flow-a@01.00.000': {
        id: 'flow-a',
        version: '01.00.000',
        cluster_id: 'cluster-0001',
        relation: 'canonical_self',
        reason: 'same_property_semantic_review',
      },
      'flow-b@01.00.000': {
        id: 'flow-a',
        version: '01.00.000',
        cluster_id: 'cluster-0001',
        relation: 'rewrite_to_canonical',
        reason: 'same_property_semantic_review',
      },
    });

    const rewritePlan = readJson(report.files.rewrite_plan);
    assert.deepEqual(rewritePlan.actions, [
      {
        cluster_id: 'cluster-0001',
        action: 'rewrite_to_canonical',
        reason: 'same_property_semantic_review',
        source_flow_id: 'flow-b',
        source_flow_version: '01.00.000',
        source_flow_name: 'Flow B',
        source_flow_type: 'Product flow',
        target_flow_id: 'flow-a',
        target_flow_version: '01.00.000',
        target_flow_name: 'Flow A',
        target_flow_type: 'Product flow',
      },
    ]);

    const seed = readJson(report.files.semantic_merge_seed);
    assert.deepEqual(seed, {
      'flow-b@01.00.000': {
        id: 'flow-a',
        version: '01.00.000',
        reason: 'same_property_semantic_review',
        cluster_id: 'cluster-0001',
      },
    });

    const blockedClusters = readJson(report.files.blocked_clusters);
    assert.equal((blockedClusters.clusters as unknown[]).length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runFlowMaterializeDecisions rejects merge decisions without canonical refs', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-materialize-decisions-invalid-'));
  const decisionFile = path.join(dir, 'decisions.json');
  const flowRowsFile = path.join(dir, 'flow-rows.json');

  writeJson(decisionFile, [
    {
      cluster_id: 'cluster-0001',
      decision: 'merge_keep_one',
      flow_refs: ['flow-a@01.00.000', 'flow-b@01.00.000'],
    },
  ]);
  writeJson(flowRowsFile, [makeFlowRow({ id: 'flow-a' }), makeFlowRow({ id: 'flow-b' })]);

  try {
    await assert.rejects(
      () =>
        runFlowMaterializeDecisions({
          decisionFile,
          flowRowsFile,
          outDir: path.join(dir, 'out'),
        }),
      (error) =>
        error instanceof CliError && error.code === 'FLOW_MATERIALIZE_DECISIONS_CANONICAL_REQUIRED',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
