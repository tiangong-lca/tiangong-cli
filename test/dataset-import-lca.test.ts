import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { executeCli } from '../src/cli.js';
import { __testInternals, runDatasetImportLcaConvert } from '../src/lib/dataset-import-lca.js';
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
      target: 'both',
      mappingDir: path.join(dir, 'mapping'),
      failOnWarning: true,
      tidasToolsDir: toolsDir,
      spawnImpl,
      now: new Date('2026-06-01T00:00:00.000Z'),
    });

    assert.equal(report.status, 'completed');
    assert.equal(report.target, 'both');
    assert.notEqual(report.files.ilcd_dir, null);
    assert.ok(report.command.args.includes('--mapping-dir'));
    assert.ok(report.command.args.includes('--fail-on-warning'));
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

  const namespaceHelp = await executeCli(['dataset', 'import-lca'], deps);
  assert.equal(namespaceHelp.exitCode, 0);
  assert.match(namespaceHelp.stdout, /dataset import-lca convert/u);

  const invalidAction = await executeCli(['dataset', 'import-lca', 'detect'], deps);
  assert.equal(invalidAction.exitCode, 2);
  assert.match(invalidAction.stderr, /dataset import-lca action must be 'convert'/u);

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

  const blocked = await executeCli(
    [
      'dataset',
      'import-lca',
      'convert',
      '--input',
      'in.zip',
      '--output-dir',
      'out',
      '--from-format',
      'ecospold2',
      '--target',
      'both',
      '--report',
      'conversion.json',
      '--mapping-dir',
      'mapping',
      '--language',
      'zh',
      '--validation-jobs',
      '2',
      '--detect-only',
      '--fail-on-warning',
      '--python',
      'python-custom',
      '--tidas-tools-dir',
      '/tmp/tidas-tools',
      '--json',
    ],
    {
      ...deps,
      runDatasetImportLcaConvertImpl: (options) => ({
        schema_version: 1,
        status: 'blocked',
        generated_at_utc: '2026-06-01T00:00:00.000Z',
        input_path: `${options.inputPath}:${options.fromFormat}:${options.target}:${options.reportPath}:${options.mappingDir}:${options.language}:${options.validationJobs}:${options.detectOnly}:${options.failOnWarning}:${options.pythonBin}:${options.tidasToolsDir}`,
        output_dir: options.outputDir,
        from_format: options.fromFormat ?? 'auto',
        target: 'both',
        detect_only: true,
        command: {
          executable: 'python-custom',
          args: [],
          cwd: '/tmp/tidas-tools',
          exit_code: 1,
          stdout: '',
          stderr: '',
        },
        conversion_report: null,
        files: {
          report: '/tmp/report.json',
          conversion_report: '/tmp/conversion-report.json',
          tidas_dir: null,
          ilcd_dir: null,
          mapping_csv: null,
        },
      }),
    },
  );
  assert.equal(blocked.exitCode, 1);
  assert.match(
    JSON.parse(blocked.stdout).input_path,
    /ecospold2:both:conversion\.json:mapping:zh:2:true:true:python-custom/u,
  );
});

test('runDatasetImportLcaConvert records missing conversion report as null', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-import-lca-no-report-'));
  const inputPath = path.join(dir, 'package.zip');
  const outDir = path.join(dir, 'out');
  const toolsDir = path.join(dir, 'tidas-tools');
  const cliPath = path.join(toolsDir, 'src/tidas_tools/import_lca/cli.py');
  writeFileSync(inputPath, 'fixture', 'utf8');
  mkdirSync(path.dirname(cliPath), { recursive: true });
  writeFileSync(cliPath, '', 'utf8');

  try {
    const report = runDatasetImportLcaConvert({
      inputPath,
      outputDir: outDir,
      target: 'both',
      detectOnly: true,
      tidasToolsDir: toolsDir,
      spawnImpl: (() => ({
        status: 0,
        signal: null,
        output: [],
        pid: 1,
        stdout: '',
        stderr: '',
      })) as unknown as typeof spawnSync,
    });

    assert.equal(report.conversion_report, null);
    assert.equal(report.files.tidas_dir, null);
    assert.equal(report.files.ilcd_dir, null);
    assert.equal(report.files.mapping_csv, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runDatasetImportLcaConvert records blocked commands and default spawn output', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-import-lca-blocked-'));
  const inputPath = path.join(dir, 'package.zip');
  const outDir = path.join(dir, 'out');
  const toolsDir = path.join(dir, 'tidas-tools');
  const cliPath = path.join(toolsDir, 'src/tidas_tools/import_lca/cli.py');
  writeFileSync(inputPath, 'fixture', 'utf8');
  mkdirSync(path.dirname(cliPath), { recursive: true });
  writeFileSync(cliPath, '', 'utf8');

  try {
    const blocked = runDatasetImportLcaConvert({
      inputPath,
      outputDir: outDir,
      target: 'ilcd',
      language: 'zh',
      pythonBin: 'python-custom',
      tidasToolsDir: toolsDir,
      spawnImpl: (() => ({
        status: 1,
        signal: null,
        output: [],
        pid: 1,
      })) as unknown as typeof spawnSync,
    });
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.command.executable, 'python-custom');
    assert.equal(blocked.command.stdout, '');
    assert.equal(blocked.command.stderr, '');
    assert.equal(blocked.files.tidas_dir, path.join(outDir, 'tidas'));
    assert.equal(blocked.files.ilcd_dir, path.join(outDir, 'ilcd'));

    const completed = runDatasetImportLcaConvert({
      inputPath,
      outputDir: path.join(dir, 'true-out'),
      pythonBin: '/usr/bin/true',
      tidasToolsDir: toolsDir,
    });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.command.executable, '/usr/bin/true');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dataset import-lca internals reject missing tidas-tools checkout', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-import-lca-missing-tools-'));
  try {
    assert.throws(
      () => __testInternals.resolveTidasToolsRoot(path.join(dir, 'missing'), {}),
      /Could not resolve a tidas-tools checkout/u,
    );
    assert.throws(
      () => __testInternals.resolveTidasToolsRoot(undefined, {}, path.join(dir, 'also-missing')),
      /Could not resolve a tidas-tools checkout/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dataset import-lca validates required inputs and target values', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-import-lca-validation-'));
  const inputPath = path.join(dir, 'package.zip');
  const toolsDir = path.join(dir, 'tidas-tools');
  const cliPath = path.join(toolsDir, 'src/tidas_tools/import_lca/cli.py');
  writeFileSync(inputPath, 'fixture', 'utf8');
  mkdirSync(path.dirname(cliPath), { recursive: true });
  writeFileSync(cliPath, '', 'utf8');

  try {
    assert.throws(
      () =>
        runDatasetImportLcaConvert({
          inputPath: '',
          outputDir: path.join(dir, 'out'),
          tidasToolsDir: toolsDir,
        }),
      /Missing required --input/u,
    );
    assert.throws(
      () =>
        runDatasetImportLcaConvert({
          inputPath: path.join(dir, 'missing.zip'),
          outputDir: path.join(dir, 'out'),
          tidasToolsDir: toolsDir,
        }),
      /Input path not found/u,
    );
    assert.throws(
      () =>
        runDatasetImportLcaConvert({
          inputPath,
          outputDir: '',
          tidasToolsDir: toolsDir,
        }),
      /Missing required --output-dir/u,
    );
    assert.throws(
      () =>
        runDatasetImportLcaConvert({
          inputPath,
          outputDir: path.join(dir, 'out'),
          target: 'invalid',
          tidasToolsDir: toolsDir,
        }),
      /--target must be/u,
    );
    assert.equal(
      __testInternals.resolveTidasToolsRoot(undefined, { TIDAS_TOOLS_DIR: toolsDir }),
      toolsDir,
    );
    assert.equal(__testInternals.normalizeTarget(undefined), 'tidas');

    const repoRoot = path.join(dir, 'cli-root');
    mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
    writeFileSync(path.join(repoRoot, 'package.json'), '{}', 'utf8');
    writeFileSync(path.join(repoRoot, 'src/cli.ts'), '', 'utf8');
    assert.equal(
      __testInternals.resolveCliRepoRoot([path.join(dir, 'missing-root'), repoRoot]),
      repoRoot,
    );
    assert.equal(
      __testInternals.resolveCliRepoRoot([path.join(dir, 'missing-root')]),
      path.join(dir, 'missing-root'),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dataset import-lca CLI validates parser-only errors', async () => {
  const invalidUnknown = await executeCli(['dataset', 'import-lca', 'convert', '--unknown'], deps);
  assert.equal(invalidUnknown.exitCode, 2);
  assert.match(invalidUnknown.stderr, /INVALID_ARGS/u);

  const invalidJobs = await executeCli(
    ['dataset', 'import-lca', 'convert', '--validation-jobs=-1'],
    deps,
  );
  assert.equal(invalidJobs.exitCode, 2);
  assert.match(invalidJobs.stderr, /validation-jobs/u);
});
