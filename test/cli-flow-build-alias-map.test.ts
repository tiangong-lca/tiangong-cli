import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeCli } from '../src/cli.js';
import type { DotEnvLoadResult } from '../src/lib/dotenv.js';
import type { FetchLike } from '../src/lib/http.js';
import type { RunFlowBuildAliasMapOptions } from '../src/lib/flow-build-alias-map.js';

const dotEnvStatus: DotEnvLoadResult = {
  loaded: false,
  path: '/tmp/.env',
  count: 0,
};

const makeDeps = () => ({
  env: {
    TIANGONG_LCA_API_BASE_URL: 'https://example.com/functions/v1',
    TIANGONG_LCA_API_KEY: 'secret-token',
    TIANGONG_LCA_REGION: 'us-east-1',
  } as NodeJS.ProcessEnv,
  dotEnvStatus,
  fetchImpl: (async () => ({
    ok: true,
    status: 200,
    headers: {
      get: () => 'application/json',
    },
    text: async () => JSON.stringify({ ok: true }),
  })) as FetchLike,
});

test('executeCli returns help for flow build-alias-map', async () => {
  const flowHelp = await executeCli(['flow', '--help'], makeDeps());
  assert.equal(flowHelp.exitCode, 0);
  assert.match(flowHelp.stdout, /build-alias-map/u);

  const buildAliasHelp = await executeCli(['flow', 'build-alias-map', '--help'], makeDeps());
  assert.equal(buildAliasHelp.exitCode, 0);
  assert.match(
    buildAliasHelp.stdout,
    /tiangong flow build-alias-map --old-flow-file <file> --new-flow-file <file> --out-dir <dir>/u,
  );
  assert.match(buildAliasHelp.stdout, /--seed-alias-map/u);
});

test('executeCli dispatches flow build-alias-map to the implemented CLI module', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-build-alias-map-dispatch-'));
  const oldFlowFileA = path.join(dir, 'old-a.jsonl');
  const oldFlowFileB = path.join(dir, 'old-b.json');
  const newFlowFile = path.join(dir, 'new.jsonl');
  const seedAliasMapFile = path.join(dir, 'seed-alias-map.json');

  writeFileSync(oldFlowFileA, '[]\n', 'utf8');
  writeFileSync(oldFlowFileB, '[]\n', 'utf8');
  writeFileSync(newFlowFile, '[]\n', 'utf8');
  writeFileSync(seedAliasMapFile, '{}\n', 'utf8');

  try {
    let observedOptions: RunFlowBuildAliasMapOptions | undefined;
    const result = await executeCli(
      [
        'flow',
        'build-alias-map',
        '--old-flow-file',
        oldFlowFileA,
        '--old-flow-file',
        oldFlowFileB,
        '--new-flow-file',
        newFlowFile,
        '--seed-alias-map',
        seedAliasMapFile,
        '--out-dir',
        path.join(dir, 'alias-map'),
        '--json',
      ],
      {
        ...makeDeps(),
        runFlowBuildAliasMapImpl: async (options) => {
          observedOptions = options;
          return {
            schema_version: 1,
            generated_at_utc: '2026-03-30T23:15:00.000Z',
            status: 'completed_local_flow_build_alias_map',
            old_flow_files: [oldFlowFileA, oldFlowFileB],
            new_flow_files: [newFlowFile],
            seed_alias_map_file: seedAliasMapFile,
            out_dir: path.join(dir, 'alias-map'),
            summary: {
              old_flow_count: 2,
              new_flow_count: 1,
              alias_entries_versioned: 1,
              alias_entries_uuid_only: 0,
              manual_review_count: 0,
              decision_counts: {
                alias_map_entry: 1,
              },
            },
            files: {
              out_dir: path.join(dir, 'alias-map'),
              alias_plan: path.join(dir, 'alias-map', 'alias-plan.json'),
              alias_plan_jsonl: path.join(dir, 'alias-map', 'alias-plan.jsonl'),
              flow_alias_map: path.join(dir, 'alias-map', 'flow-alias-map.json'),
              manual_review_queue: path.join(dir, 'alias-map', 'manual-review-queue.jsonl'),
              summary: path.join(dir, 'alias-map', 'alias-summary.json'),
            },
          };
        },
      },
    );

    assert.equal(result.exitCode, 0);
    assert.equal(JSON.parse(result.stdout).status, 'completed_local_flow_build_alias_map');
    assert.deepEqual(observedOptions, {
      oldFlowFiles: [oldFlowFileA, oldFlowFileB],
      newFlowFiles: [newFlowFile],
      seedAliasMapFile,
      outDir: path.join(dir, 'alias-map'),
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli returns parsing errors for invalid flow build-alias-map flags', async () => {
  const invalidArgsResult = await executeCli(['flow', 'build-alias-map', '--bad-flag'], makeDeps());

  assert.equal(invalidArgsResult.exitCode, 2);
  assert.match(invalidArgsResult.stderr, /INVALID_ARGS/u);
});
