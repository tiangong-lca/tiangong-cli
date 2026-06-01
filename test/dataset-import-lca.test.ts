import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { executeCli } from '../src/cli.js';
import { runDatasetImportLcaConvert } from '../src/lib/dataset-import-lca.js';
import type { spawnSync, SpawnSyncReturns } from 'node:child_process';
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

test('runDatasetImportLcaConvert wraps tidas-tools and writes a report', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-import-lca-'));
  const inputPath = path.join(dir, 'package.zip');
  const outDir = path.join(dir, 'out');
  const toolsDir = path.join(dir, 'tidas-tools');
  const cliPath = path.join(toolsDir, 'src/tidas_tools/import_lca/cli.py');
  writeFileSync(inputPath, 'fixture', 'utf8');
  mkdirSync(path.dirname(cliPath), { recursive: true });
  writeFileSync(cliPath, '', { encoding: 'utf8', flag: 'w' });
  const spawnImpl = ((_bin: string, args: readonly string[] = []): SpawnSyncReturns<string> => {
    const reportIndex = args.indexOf('--report');
    const reportPath = String(args[reportIndex + 1]);
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(
      reportPath,
      JSON.stringify({
        detected_format: 'ecospold2',
        validation: { tidas: { ok: true } },
      }),
      'utf8',
    );
    return {
      status: 0,
      signal: null,
      output: [],
      pid: 1,
      stdout: 'converted',
      stderr: '',
    };
  }) as typeof spawnSync;

  try {
    const report = runDatasetImportLcaConvert({
      inputPath,
      outputDir: outDir,
      fromFormat: 'auto',
      target: 'tidas',
      tidasToolsDir: toolsDir,
      spawnImpl,
      now: new Date('2026-06-01T00:00:00.000Z'),
    });

    assert.equal(report.status, 'completed');
    assert.equal(report.target, 'tidas');
    assert.equal(report.conversion_report && typeof report.conversion_report, 'object');
    assert.equal(existsSync(report.files.report), true);
    assert.deepEqual(readJson(report.files.report), report);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli exposes dataset import-lca convert command', async () => {
  const result = await executeCli(['dataset', 'import-lca', 'convert', '--help'], deps);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /dataset import-lca convert/u);

  const converted = await executeCli(
    ['dataset', 'import-lca', 'convert', '--input', 'in.zip', '--output-dir', 'out', '--json'],
    {
      ...deps,
      runDatasetImportLcaConvertImpl: (options) => ({
        schema_version: 1,
        status: 'completed',
        generated_at_utc: '2026-06-01T00:00:00.000Z',
        input_path: options.inputPath,
        output_dir: options.outputDir,
        from_format: options.fromFormat ?? 'auto',
        target: 'tidas',
        detect_only: false,
        command: {
          executable: 'python3',
          args: [],
          cwd: '/tmp/tidas-tools',
          exit_code: 0,
          stdout: '',
          stderr: '',
        },
        conversion_report: null,
        files: {
          report: '/tmp/report.json',
          conversion_report: '/tmp/conversion-report.json',
          tidas_dir: '/tmp/tidas',
          ilcd_dir: null,
          mapping_csv: '/tmp/mapping.csv',
        },
      }),
    },
  );
  assert.equal(converted.exitCode, 0);
  assert.equal(JSON.parse(converted.stdout).input_path, 'in.zip');
});
