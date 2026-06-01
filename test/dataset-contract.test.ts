import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { executeCli } from '../src/cli.js';
import { __testInternals, runDatasetContract } from '../src/lib/dataset-contract.js';
import type { DotEnvLoadResult } from '../src/lib/dotenv.js';
import type { FetchLike } from '../src/lib/http.js';

const dotEnvStatus: DotEnvLoadResult = {
  loaded: false,
  path: '/tmp/.env',
  count: 0,
};

const deps = {
  env: {},
  dotEnvStatus,
  fetchImpl: (async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({ ok: true }),
  })) as FetchLike,
};

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

test('runDatasetContract writes process contract artifacts', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-dataset-contract-'));
  try {
    const report = await runDatasetContract({
      type: 'process',
      include: 'schema,methodology,ruleset',
      profile: 'ai-import',
      outDir: dir,
      mode: 'context-pack',
      now: new Date('2026-06-01T00:00:00.000Z'),
    });

    assert.equal(report.status, 'completed');
    assert.equal(report.type, 'process');
    assert.equal(report.profile, 'ai-import');
    assert.equal(existsSync(report.files.manifest), true);
    assert.equal(existsSync(report.files.schema ?? ''), true);
    assert.equal(existsSync(report.files.methodology ?? ''), true);
    assert.equal(existsSync(report.files.ai_context_json ?? ''), true);
    assert.equal(existsSync(report.files.ai_context_markdown ?? ''), true);
    assert.match(readFileSync(report.files.schema ?? '', 'utf8'), /processDataSet/u);
    assert.match(
      readFileSync(report.files.methodology ?? '', 'utf8'),
      /Process Dataset Content Rules/u,
    );
    assert.deepEqual(readJson(report.files.report), report);

    const manifest = readJson(report.files.manifest) as {
      schema?: { sha256?: string };
      methodology?: { sha256?: string };
    };
    assert.match(manifest.schema?.sha256 ?? '', /^[a-f0-9]{64}$/u);
    assert.match(manifest.methodology?.sha256 ?? '', /^[a-f0-9]{64}$/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli exposes dataset contract and context-pack commands', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-context-pack-'));
  try {
    const help = await executeCli(['dataset', 'context-pack', '--help'], deps);
    assert.equal(help.exitCode, 0);
    assert.match(help.stdout, /dataset context-pack/u);

    const result = await executeCli(
      ['dataset', 'context-pack', '--type', 'flow', '--out-dir', dir, '--json'],
      deps,
    );
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout) as {
      type: string;
      files: { schema: string; ai_context_json: string };
    };
    assert.equal(payload.type, 'flow');
    assert.equal(existsSync(payload.files.schema), true);
    assert.equal(existsSync(payload.files.ai_context_json), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dataset contract flag normalization rejects unsupported includes', () => {
  assert.throws(() => __testInternals.normalizeIncludes('schema,unknown'), /--include values/u);
});
