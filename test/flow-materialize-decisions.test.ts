import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError } from '../src/lib/errors.js';
import {
  __testInternals as flowMaterializeDecisionInternals,
  runFlowMaterializeDecisions,
} from '../src/lib/flow-materialize-decisions.js';

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

test('flow materialize decision helpers validate refs, dedupe keys, and reject duplicate flow rows', () => {
  assert.deepEqual(
    flowMaterializeDecisionInternals.parseFlowRefString(
      'flow-a@01.00.000',
      'FLOW_MATERIALIZE_DECISIONS_INVALID_MEMBER_REF',
    ),
    {
      id: 'flow-a',
      version: '01.00.000',
    },
  );
  assert.equal(
    flowMaterializeDecisionInternals.parseFlowRefLike(
      null,
      'FLOW_MATERIALIZE_DECISIONS_INVALID_MEMBER_REF',
    ),
    null,
  );
  assert.deepEqual(
    flowMaterializeDecisionInternals.parseFlowRefLike(
      {
        id: ' flow-b ',
        version: ' 01.00.001 ',
      },
      'FLOW_MATERIALIZE_DECISIONS_INVALID_MEMBER_REF',
    ),
    {
      id: 'flow-b',
      version: '01.00.001',
    },
  );
  assert.deepEqual(
    flowMaterializeDecisionInternals.uniqueFlowRefs([
      { id: 'flow-a', version: '01.00.000' },
      { id: 'flow-a', version: '01.00.000' },
      { id: 'flow-b', version: '01.00.000' },
    ]),
    [
      { id: 'flow-a', version: '01.00.000' },
      { id: 'flow-b', version: '01.00.000' },
    ],
  );
  const outRoot = path.join(path.sep, 'tmp', 'out');
  assert.deepEqual(flowMaterializeDecisionInternals.buildOutputFiles(outRoot), {
    canonical_map: path.join(outRoot, 'flow-dedup-canonical-map.json'),
    rewrite_plan: path.join(outRoot, 'flow-dedup-rewrite-plan.json'),
    semantic_merge_seed: path.join(outRoot, 'manual-semantic-merge-seed.current.json'),
    summary: path.join(outRoot, 'decision-summary.json'),
    blocked_clusters: path.join(outRoot, 'blocked-clusters.json'),
  });

  assert.throws(
    () =>
      flowMaterializeDecisionInternals.parseFlowRefString(
        'flow-a',
        'FLOW_MATERIALIZE_DECISIONS_INVALID_MEMBER_REF',
      ),
    (error) =>
      error instanceof CliError && error.code === 'FLOW_MATERIALIZE_DECISIONS_INVALID_MEMBER_REF',
  );
  assert.throws(
    () =>
      flowMaterializeDecisionInternals.parseFlowRefLike(
        { id: 'flow-a' },
        'FLOW_MATERIALIZE_DECISIONS_INVALID_MEMBER_REF',
      ),
    (error) =>
      error instanceof CliError && error.code === 'FLOW_MATERIALIZE_DECISIONS_INVALID_MEMBER_REF',
  );
  assert.throws(
    () =>
      flowMaterializeDecisionInternals.parseFlowRefLike(
        17,
        'FLOW_MATERIALIZE_DECISIONS_INVALID_MEMBER_REF',
      ),
    (error) =>
      error instanceof CliError && error.code === 'FLOW_MATERIALIZE_DECISIONS_INVALID_MEMBER_REF',
  );
  assert.throws(
    () =>
      flowMaterializeDecisionInternals.buildFlowIndex([
        makeFlowRow({ id: 'flow-a' }),
        makeFlowRow({ id: 'flow-a' }),
      ]),
    (error) =>
      error instanceof CliError && error.code === 'FLOW_MATERIALIZE_DECISIONS_DUPLICATE_FLOW_ROW',
  );
});

test('runFlowMaterializeDecisions validates required inputs and malformed decisions', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-materialize-decisions-validate-'));
  const decisionFile = path.join(dir, 'decisions.json');
  const flowRowsFile = path.join(dir, 'flow-rows.json');

  writeJson(decisionFile, []);
  writeJson(flowRowsFile, [makeFlowRow({ id: 'flow-a' })]);

  try {
    await assert.rejects(
      () =>
        runFlowMaterializeDecisions({
          decisionFile: '',
          flowRowsFile,
          outDir: path.join(dir, 'out'),
        }),
      (error) =>
        error instanceof CliError &&
        error.code === 'FLOW_MATERIALIZE_DECISIONS_DECISION_FILE_REQUIRED',
    );
    await assert.rejects(
      () =>
        runFlowMaterializeDecisions({
          decisionFile,
          flowRowsFile: path.join(dir, 'missing-flow-rows.json'),
          outDir: path.join(dir, 'out'),
        }),
      (error) =>
        error instanceof CliError &&
        error.code === 'FLOW_MATERIALIZE_DECISIONS_FLOW_ROWS_FILE_NOT_FOUND',
    );
    await assert.rejects(
      () =>
        runFlowMaterializeDecisions({
          decisionFile,
          flowRowsFile,
          outDir: '   ',
        }),
      (error) =>
        error instanceof CliError && error.code === 'FLOW_MATERIALIZE_DECISIONS_OUT_DIR_REQUIRED',
    );

    writeJson(decisionFile, [
      {
        decision: 'merge_keep_one',
        flow_refs: ['flow-a@01.00.000', 'flow-b@01.00.000'],
      },
    ]);
    await assert.rejects(
      () =>
        runFlowMaterializeDecisions({
          decisionFile,
          flowRowsFile,
          outDir: path.join(dir, 'out-missing-cluster'),
        }),
      (error) =>
        error instanceof CliError &&
        error.code === 'FLOW_MATERIALIZE_DECISIONS_CLUSTER_ID_REQUIRED',
    );

    writeJson(decisionFile, [
      {
        cluster_id: 'cluster-invalid-decision',
        decision: 'merge_all',
        flow_refs: ['flow-a@01.00.000', 'flow-b@01.00.000'],
      },
    ]);
    await assert.rejects(
      () =>
        runFlowMaterializeDecisions({
          decisionFile,
          flowRowsFile,
          outDir: path.join(dir, 'out-invalid-decision'),
        }),
      (error) =>
        error instanceof CliError && error.code === 'FLOW_MATERIALIZE_DECISIONS_INVALID_DECISION',
    );

    writeJson(decisionFile, [
      {
        cluster_id: 'cluster-invalid-member',
        decision: 'keep_distinct',
        flow_refs: [17],
      },
    ]);
    await assert.rejects(
      () =>
        runFlowMaterializeDecisions({
          decisionFile,
          flowRowsFile,
          outDir: path.join(dir, 'out-invalid-member'),
        }),
      (error) =>
        error instanceof CliError && error.code === 'FLOW_MATERIALIZE_DECISIONS_INVALID_MEMBER_REF',
    );

    writeJson(decisionFile, [
      {
        cluster_id: 'cluster-invalid-canonical',
        decision: 'merge_keep_one',
        canonical_flow: {
          id: 'flow-a',
        },
        flow_refs: ['flow-a@01.00.000', 'flow-b@01.00.000'],
      },
    ]);
    await assert.rejects(
      () =>
        runFlowMaterializeDecisions({
          decisionFile,
          flowRowsFile,
          outDir: path.join(dir, 'out-invalid-canonical'),
        }),
      (error) =>
        error instanceof CliError &&
        error.code === 'FLOW_MATERIALIZE_DECISIONS_INVALID_CANONICAL_REF',
    );

    writeJson(decisionFile, [
      {
        cluster_id: 'cluster-too-small',
        decision: 'merge_keep_one',
        canonical_flow: 'flow-a@01.00.000',
        flow_refs: ['flow-a@01.00.000'],
      },
    ]);
    await assert.rejects(
      () =>
        runFlowMaterializeDecisions({
          decisionFile,
          flowRowsFile,
          outDir: path.join(dir, 'out-too-small'),
        }),
      (error) =>
        error instanceof CliError && error.code === 'FLOW_MATERIALIZE_DECISIONS_MEMBERS_REQUIRED',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runFlowMaterializeDecisions sorts merge outputs and uses fallback merge reason when no blockers remain', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-materialize-decisions-sorted-'));
  const decisionFile = path.join(dir, 'decisions.json');
  const flowRowsFile = path.join(dir, 'flow-rows.jsonl');
  const outDir = path.join(dir, 'out');

  writeJson(decisionFile, [
    {
      cluster_id: 'cluster-0002',
      decision: 'merge_keep_one',
      canonical_flow_key: 'flow-z@01.00.000',
      flow_keys: ['flow-z@01.00.000', 'flow-y@01.00.000', 'flow-x@01.00.000'],
    },
    {
      cluster_id: 'cluster-0001',
      approved_decision: 'merge_keep_one',
      keep_flow: {
        id: 'flow-a',
        version: '01.00.000',
      },
      drops: ['flow-c@01.00.000', 'flow-b@01.00.000'],
      message: 'sorted-first',
    },
  ]);
  writeFileSync(
    flowRowsFile,
    [
      makeFlowRow({ id: 'flow-a', name: 'Flow A' }),
      makeFlowRow({ id: 'flow-b', name: 'Flow B' }),
      makeFlowRow({ id: 'flow-c', name: 'Flow C' }),
      makeFlowRow({ id: 'flow-x', name: 'Flow X' }),
      makeFlowRow({ id: 'flow-y', name: 'Flow Y' }),
      makeFlowRow({ id: 'flow-z', name: 'Flow Z' }),
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
      now: new Date('2026-04-07T00:00:00.000Z'),
    });

    assert.equal(report.status, 'completed_local_flow_decision_materialization');
    assert.equal(report.counts.materialized_clusters, 2);
    assert.equal(report.counts.blocked_clusters, 0);
    assert.equal(report.counts.rewrite_actions, 4);

    const canonicalMap = readJson(report.files.canonical_map);
    assert.deepEqual(
      (canonicalMap.clusters as JsonRecord[]).map((row) => row.cluster_id),
      ['cluster-0001', 'cluster-0002'],
    );
    assert.equal(
      ((canonicalMap.by_flow_key as JsonRecord)['flow-x@01.00.000'] as JsonRecord).reason,
      'approved_merge_keep_one',
    );

    const rewritePlan = readJson(report.files.rewrite_plan);
    assert.deepEqual(
      (rewritePlan.actions as JsonRecord[]).map(
        (row) => `${row.cluster_id as string}:${row.source_flow_id as string}`,
      ),
      ['cluster-0001:flow-b', 'cluster-0001:flow-c', 'cluster-0002:flow-x', 'cluster-0002:flow-y'],
    );

    const seed = readJson(report.files.semantic_merge_seed);
    assert.equal(
      ((seed['flow-y@01.00.000'] as JsonRecord).reason as string) ?? '',
      'approved_merge_keep_one',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runFlowMaterializeDecisions blocks merge decisions whose canonical flow row is missing', async () => {
  const dir = mkdtempSync(
    path.join(os.tmpdir(), 'tg-cli-flow-materialize-decisions-canonical-missing-'),
  );
  const decisionFile = path.join(dir, 'decisions.json');
  const flowRowsFile = path.join(dir, 'flow-rows.json');
  const outDir = path.join(dir, 'out');

  writeJson(decisionFile, [
    {
      cluster_id: 'cluster-canonical-missing',
      outcome: 'merge_keep_one',
      keep_ref: 'missing-flow@01.00.000',
      cluster_members: ['missing-flow@01.00.000', 'flow-a@01.00.000'],
      notes: 'canonical row was removed',
    },
  ]);
  writeJson(flowRowsFile, [makeFlowRow({ id: 'flow-a' })]);

  try {
    const report = await runFlowMaterializeDecisions({
      decisionFile,
      flowRowsFile,
      outDir,
      now: new Date('2026-04-07T00:10:00.000Z'),
    });

    assert.equal(
      report.status,
      'completed_local_flow_decision_materialization_with_blocked_clusters',
    );
    assert.deepEqual(report.counts.blocked_reason_counts, {
      merge_canonical_flow_missing: 1,
    });

    const blocked = readJson(report.files.blocked_clusters);
    assert.deepEqual(blocked.clusters, [
      {
        cluster_id: 'cluster-canonical-missing',
        decision: 'merge_keep_one',
        blocker_code: 'merge_canonical_flow_missing',
        reason: 'canonical row was removed',
        canonical_flow: {
          id: 'missing-flow',
          version: '01.00.000',
        },
        cluster_members: [
          {
            id: 'missing-flow',
            version: '01.00.000',
          },
          {
            id: 'flow-a',
            version: '01.00.000',
          },
        ],
        missing_flow_keys: ['missing-flow@01.00.000'],
      },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
