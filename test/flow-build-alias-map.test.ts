import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { __testInternals, runFlowBuildAliasMap } from '../src/lib/flow-build-alias-map.js';
import { CliError } from '../src/lib/errors.js';

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

function writeJsonl(filePath: string, rows: unknown[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    `${rows.map((row) => JSON.stringify(row)).join('\n')}${rows.length ? '\n' : ''}`,
    'utf8',
  );
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
}

function readJsonl(filePath: string): unknown[] {
  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
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

test('runFlowBuildAliasMap writes alias artifacts from deterministic and manual decisions', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-build-alias-map-'));
  const oldFlowFile = path.join(dir, 'old-flows.json');
  const newFlowFile = path.join(dir, 'new-flows.jsonl');
  const seedAliasMapFile = path.join(dir, 'seed-alias-map.json');
  const outDir = path.join(dir, 'alias-map');

  writeJson(oldFlowFile, [
    makeFlowRow({ id: 'present-flow', name: 'Present Flow' }),
    makeFlowRow({ id: 'seed-old', name: 'Seeded Legacy Flow' }),
    makeFlowRow({ id: 'sameuuid-flow', name: 'Same UUID Flow' }),
    makeFlowRow({ id: 'old-name-type', name: 'Name Type Flow' }),
    makeFlowRow({ id: 'old-shared', version: '01.00.000', name: 'Shared Flow' }),
    makeFlowRow({ id: 'old-shared', version: '02.00.000', name: 'Shared Flow' }),
    makeFlowRow({ id: 'multi-uuid', name: 'Multi UUID Flow' }),
    makeFlowRow({ id: 'ambig-old', name: 'Ambiguous Flow' }),
    makeFlowRow({ id: 'mismatch-old', name: 'Type Mismatch Flow' }),
    makeFlowRow({ id: 'no-match', name: 'No Match Flow' }),
  ]);
  writeJsonl(newFlowFile, [
    makeFlowRow({ id: 'present-flow', name: 'Present Flow' }),
    makeFlowRow({ id: 'seed-target', name: 'Seed Target Flow' }),
    makeFlowRow({ id: 'sameuuid-flow', version: '02.00.000', name: 'Same UUID Flow' }),
    makeFlowRow({ id: 'new-name-type', name: 'Name Type Flow' }),
    makeFlowRow({ id: 'new-shared-target', name: 'Shared Flow' }),
    makeFlowRow({ id: 'multi-uuid', version: '02.00.000', name: 'Multi UUID Flow' }),
    makeFlowRow({ id: 'multi-uuid', version: '03.00.000', name: 'Multi UUID Flow' }),
    makeFlowRow({ id: 'ambig-target-1', name: 'Ambiguous Flow' }),
    makeFlowRow({ id: 'ambig-target-2', name: 'Ambiguous Flow' }),
    makeFlowRow({
      id: 'type-mismatch-target',
      name: 'Type Mismatch Flow',
      flowType: 'Waste flow',
    }),
  ]);
  writeJson(seedAliasMapFile, {
    'seed-old@01.00.000': {
      id: 'seed-target',
      version: '01.00.000',
    },
  });

  try {
    const report = await runFlowBuildAliasMap(
      {
        oldFlowFiles: [oldFlowFile],
        newFlowFiles: [newFlowFile],
        seedAliasMapFile,
        outDir,
      },
      {
        now: () => new Date('2026-03-30T23:00:00.000Z'),
      },
    );

    assert.equal(report.status, 'completed_local_flow_build_alias_map');
    assert.equal(report.generated_at_utc, '2026-03-30T23:00:00.000Z');
    assert.deepEqual(report.old_flow_files, [oldFlowFile]);
    assert.deepEqual(report.new_flow_files, [newFlowFile]);
    assert.equal(report.seed_alias_map_file, seedAliasMapFile);
    assert.deepEqual(report.summary, {
      old_flow_count: 10,
      new_flow_count: 10,
      alias_entries_versioned: 5,
      alias_entries_uuid_only: 4,
      manual_review_count: 4,
      decision_counts: {
        no_alias_needed: 1,
        alias_map_entry: 5,
        manual_review: 4,
      },
    });
    assert.equal(existsSync(report.files.alias_plan), true);
    assert.equal(existsSync(report.files.alias_plan_jsonl), true);
    assert.equal(existsSync(report.files.flow_alias_map), true);
    assert.equal(existsSync(report.files.manual_review_queue), true);
    assert.equal(existsSync(report.files.summary), true);
    assert.deepEqual(readJson(report.files.summary), report.summary);
    assert.deepEqual(readJson(report.files.flow_alias_map), {
      'seed-old@01.00.000': {
        id: 'seed-target',
        version: '01.00.000',
        reason: 'seed_alias_map',
      },
      'seed-old': {
        id: 'seed-target',
        version: '01.00.000',
        reason: 'all_versions_share_same_target',
      },
      'sameuuid-flow@01.00.000': {
        id: 'sameuuid-flow',
        version: '02.00.000',
        reason: 'same_uuid_single_target_version',
      },
      'sameuuid-flow': {
        id: 'sameuuid-flow',
        version: '02.00.000',
        reason: 'all_versions_share_same_target',
      },
      'old-name-type@01.00.000': {
        id: 'new-name-type',
        version: '01.00.000',
        reason: 'unique_exact_name_and_type_match',
      },
      'old-name-type': {
        id: 'new-name-type',
        version: '01.00.000',
        reason: 'all_versions_share_same_target',
      },
      'old-shared@01.00.000': {
        id: 'new-shared-target',
        version: '01.00.000',
        reason: 'unique_exact_name_and_type_match',
      },
      'old-shared@02.00.000': {
        id: 'new-shared-target',
        version: '01.00.000',
        reason: 'unique_exact_name_and_type_match',
      },
      'old-shared': {
        id: 'new-shared-target',
        version: '01.00.000',
        reason: 'all_versions_share_same_target',
      },
    });
    assert.equal((readJson(report.files.alias_plan) as unknown[]).length, 10);
    assert.equal(readJsonl(report.files.manual_review_queue).length, 4);
    assert.deepEqual(
      readJsonl(report.files.manual_review_queue)
        .map((item) => String((item as JsonRecord).reason))
        .sort(),
      [
        'ambiguous_name_and_type_match',
        'name_match_flow_type_mismatch',
        'no_deterministic_match',
        'same_uuid_multiple_target_versions',
      ],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runFlowBuildAliasMap supports omitted seed alias maps and emits uuid-only aliases only for stable targets', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-build-alias-map-no-seed-'));
  const oldFlowFile = path.join(dir, 'old-flows.jsonl');
  const newFlowFile = path.join(dir, 'new-flows.json');
  const outDir = path.join(dir, 'alias-map');

  writeJsonl(oldFlowFile, [
    makeFlowRow({ id: 'legacy-stable', version: '01.00.000', name: 'Stable Flow' }),
    makeFlowRow({ id: 'legacy-stable', version: '02.00.000', name: 'Stable Flow' }),
    makeFlowRow({ id: 'legacy-divergent', version: '01.00.000', name: 'Divergent Flow A' }),
    makeFlowRow({ id: 'legacy-divergent', version: '02.00.000', name: 'Divergent Flow B' }),
  ]);
  writeJson(newFlowFile, [
    makeFlowRow({ id: 'stable-target', name: 'Stable Flow' }),
    makeFlowRow({ id: 'divergent-target-a', name: 'Divergent Flow A' }),
    makeFlowRow({ id: 'divergent-target-b', name: 'Divergent Flow B' }),
  ]);

  try {
    const report = await runFlowBuildAliasMap({
      oldFlowFiles: [oldFlowFile],
      newFlowFiles: [newFlowFile],
      outDir,
    });

    assert.equal(report.seed_alias_map_file, null);
    assert.deepEqual(readJson(report.files.flow_alias_map), {
      'legacy-stable@01.00.000': {
        id: 'stable-target',
        version: '01.00.000',
        reason: 'unique_exact_name_and_type_match',
      },
      'legacy-stable@02.00.000': {
        id: 'stable-target',
        version: '01.00.000',
        reason: 'unique_exact_name_and_type_match',
      },
      'legacy-stable': {
        id: 'stable-target',
        version: '01.00.000',
        reason: 'all_versions_share_same_target',
      },
      'legacy-divergent@01.00.000': {
        id: 'divergent-target-a',
        version: '01.00.000',
        reason: 'unique_exact_name_and_type_match',
      },
      'legacy-divergent@02.00.000': {
        id: 'divergent-target-b',
        version: '01.00.000',
        reason: 'unique_exact_name_and_type_match',
      },
    });
    assert.deepEqual(report.summary, {
      old_flow_count: 4,
      new_flow_count: 3,
      alias_entries_versioned: 4,
      alias_entries_uuid_only: 1,
      manual_review_count: 0,
      decision_counts: {
        alias_map_entry: 4,
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('flow build alias helper guards reject missing paths and invalid JSON object inputs', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-build-alias-map-errors-'));
  const invalidJsonFile = path.join(dir, 'invalid.json');
  const invalidObjectFile = path.join(dir, 'array.json');

  writeFileSync(invalidJsonFile, '{not-json', 'utf8');
  writeJson(invalidObjectFile, []);

  try {
    assert.throws(
      () => __testInternals.assertInputFile('', 'FLOW_REQUIRED', 'FLOW_MISSING'),
      (error: unknown) =>
        error instanceof CliError && error.code === 'FLOW_REQUIRED' && error.exitCode === 2,
    );
    assert.throws(
      () =>
        __testInternals.assertInputFile(
          path.join(dir, 'missing.json'),
          'FLOW_REQUIRED',
          'FLOW_MISSING',
        ),
      (error: unknown) =>
        error instanceof CliError && error.code === 'FLOW_MISSING' && error.exitCode === 2,
    );
    assert.throws(
      () => __testInternals.assertInputFiles([], 'FLOW_FILES_REQUIRED', 'FLOW_FILE_MISSING'),
      (error: unknown) =>
        error instanceof CliError && error.code === 'FLOW_FILES_REQUIRED' && error.exitCode === 2,
    );
    assert.throws(
      () => __testInternals.assertOutDir(''),
      (error: unknown) =>
        error instanceof CliError &&
        error.code === 'FLOW_BUILD_ALIAS_MAP_OUT_DIR_REQUIRED' &&
        error.exitCode === 2,
    );
    assert.throws(
      () =>
        __testInternals.readJsonObjectFile(
          invalidJsonFile,
          'FLOW_REQUIRED',
          'FLOW_MISSING',
          'FLOW_INVALID',
        ),
      (error: unknown) =>
        error instanceof CliError &&
        error.code === 'FLOW_INVALID' &&
        error.exitCode === 2 &&
        String(error.details).length > 0,
    );
    assert.throws(
      () =>
        __testInternals.readJsonObjectFile(
          invalidObjectFile,
          'FLOW_REQUIRED',
          'FLOW_MISSING',
          'FLOW_INVALID',
        ),
      (error: unknown) =>
        error instanceof CliError && error.code === 'FLOW_INVALID' && error.exitCode === 2,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runFlowBuildAliasMap applies runtime defaults for omitted old/new file arrays before validation', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-build-alias-map-runtime-defaults-'));
  const oldFlowFile = path.join(dir, 'old-flows.jsonl');
  const newFlowFile = path.join(dir, 'new-flows.jsonl');

  writeJsonl(oldFlowFile, []);
  writeJsonl(newFlowFile, []);

  try {
    await assert.rejects(
      () =>
        runFlowBuildAliasMap({
          oldFlowFiles: undefined as unknown as string[],
          newFlowFiles: [newFlowFile],
          outDir: path.join(dir, 'alias-map-old'),
        }),
      (error: unknown) =>
        error instanceof CliError &&
        error.code === 'FLOW_BUILD_ALIAS_MAP_OLD_FLOW_FILES_REQUIRED' &&
        error.exitCode === 2,
    );
    await assert.rejects(
      () =>
        runFlowBuildAliasMap({
          oldFlowFiles: [oldFlowFile],
          newFlowFiles: undefined as unknown as string[],
          outDir: path.join(dir, 'alias-map-new'),
        }),
      (error: unknown) =>
        error instanceof CliError &&
        error.code === 'FLOW_BUILD_ALIAS_MAP_NEW_FLOW_FILES_REQUIRED' &&
        error.exitCode === 2,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('flow build alias helpers expose deterministic lookup, indexing, and planning behavior', () => {
  const record = makeFlowRow({
    id: 'helper-flow',
    version: '02.00.000',
    name: 'Helper Flow',
    flowType: 'Waste flow',
  });
  const index = __testInternals.buildFlowIndex([record]);
  const oldRecord = index.records[0];

  assert.equal(index.byUuid['helper-flow'].length, 1);
  assert.equal(index.byUuidVersion['helper-flow@02.00.000']?.name, 'Helper Flow');
  assert.equal(index.byName['helper flow']?.length, 1);
  assert.deepEqual(__testInternals.candidateRef(oldRecord), {
    id: 'helper-flow',
    version: '02.00.000',
    name: 'Helper Flow',
  });
  assert.deepEqual(__testInternals.candidateRef(oldRecord, true), {
    id: 'helper-flow',
    version: '02.00.000',
    name: 'Helper Flow',
    flow_type: 'Waste flow',
  });
  assert.deepEqual(
    __testInternals.aliasLookup(
      {
        'helper-flow@02.00.000': { id: 'target-a', version: '03.00.000' },
        'helper-flow': { id: 'target-b', version: '04.00.000' },
      },
      'helper-flow',
      '02.00.000',
    ),
    { id: 'target-a', version: '03.00.000' },
  );
  assert.deepEqual(
    __testInternals.aliasLookup(
      {
        'helper-flow': { id: 'target-b', version: '04.00.000' },
      },
      'helper-flow',
      null,
    ),
    { id: 'target-b', version: '04.00.000' },
  );
  assert.equal(__testInternals.aliasLookup({}, 'missing-flow', null), null);
  assert.deepEqual(
    __testInternals.buildDecisionCounts([
      {
        old_flow_id: 'a',
        old_flow_version: '01.00.000',
        old_flow_name: 'A',
        old_flow_type: 'Product flow',
        decision: 'manual_review',
        reason: 'manual',
      },
      {
        old_flow_id: 'b',
        old_flow_version: '01.00.000',
        old_flow_name: 'B',
        old_flow_type: 'Product flow',
        decision: 'manual_review',
        reason: 'manual',
      },
      {
        old_flow_id: 'c',
        old_flow_version: '01.00.000',
        old_flow_name: 'C',
        old_flow_type: 'Product flow',
        decision: 'alias_map_entry',
        reason: 'alias',
        target_flow_id: 'target-c',
        target_flow_version: '01.00.000',
      },
    ]),
    {
      manual_review: 2,
      alias_map_entry: 1,
    },
  );
  assert.deepEqual(__testInternals.buildOutputFiles('/tmp/helper-out'), {
    out_dir: '/tmp/helper-out',
    alias_plan: '/tmp/helper-out/alias-plan.json',
    alias_plan_jsonl: '/tmp/helper-out/alias-plan.jsonl',
    flow_alias_map: '/tmp/helper-out/flow-alias-map.json',
    manual_review_queue: '/tmp/helper-out/manual-review-queue.jsonl',
    summary: '/tmp/helper-out/alias-summary.json',
  });

  const seededPlan = __testInternals.planAlias(
    oldRecord,
    __testInternals.buildFlowIndex([
      makeFlowRow({
        id: 'target-seeded',
        version: '03.00.000',
        name: 'Seeded Flow',
        flowType: 'Waste flow',
      }),
    ]),
    {
      'helper-flow@02.00.000': {
        id: 'target-seeded',
        version: '03.00.000',
      },
    },
  );
  assert.equal(seededPlan.decision, 'alias_map_entry');
  assert.equal(seededPlan.reason, 'seed_alias_map');

  const fallbackPlan = __testInternals.planAlias(oldRecord, __testInternals.buildFlowIndex([]), {
    'helper-flow@02.00.000': {
      id: 'missing-target',
      version: '09.00.000',
    },
  });
  assert.equal(fallbackPlan.decision, 'manual_review');
  assert.equal(fallbackPlan.reason, 'no_deterministic_match');

  const legacyRecordWithoutVersion = {
    id: 'legacy-helper',
    version: '',
    name: 'Legacy Helper',
    flowType: 'Waste flow',
    shortDescription: null,
    row: {},
  };
  const incompleteSeedPlan = __testInternals.planAlias(
    legacyRecordWithoutVersion,
    __testInternals.buildFlowIndex([]),
    {
      'legacy-helper': {},
    },
  );
  assert.equal(incompleteSeedPlan.decision, 'manual_review');
  assert.equal(incompleteSeedPlan.reason, 'no_deterministic_match');
});
