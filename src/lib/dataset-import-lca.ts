import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { writeJsonArtifact } from './artifacts.js';
import { CliError } from './errors.js';

export type DatasetImportLcaTarget = 'tidas' | 'ilcd' | 'both';

export type DatasetImportLcaReport = {
  schema_version: 1;
  status: 'completed' | 'blocked';
  generated_at_utc: string;
  input_path: string;
  output_dir: string;
  from_format: string;
  target: DatasetImportLcaTarget;
  detect_only: boolean;
  command: {
    executable: string;
    args: string[];
    cwd: string;
    exit_code: number | null;
    stdout: string;
    stderr: string;
  };
  conversion_report: unknown | null;
  files: {
    report: string;
    conversion_report: string;
    tidas_dir: string | null;
    ilcd_dir: string | null;
    mapping_csv: string | null;
  };
};

export type RunDatasetImportLcaConvertOptions = {
  inputPath: string;
  outputDir: string;
  fromFormat?: string | undefined;
  target?: string | undefined;
  language?: string | undefined;
  reportPath?: string | undefined;
  mappingDir?: string | undefined;
  failOnWarning?: boolean | undefined;
  validationJobs?: number | undefined;
  detectOnly?: boolean | undefined;
  pythonBin?: string | undefined;
  tidasToolsDir?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  now?: Date | undefined;
  spawnImpl?: typeof spawnSync | undefined;
};

export function runDatasetImportLcaConvert(
  options: RunDatasetImportLcaConvertOptions,
): DatasetImportLcaReport {
  const inputPath = requireInputPath(options.inputPath);
  const outputDir = requireOutputDir(options.outputDir);
  const target = normalizeTarget(options.target);
  const fromFormat = options.fromFormat?.trim() || 'auto';
  const pythonBin = options.pythonBin?.trim() || 'python3';
  const tidasToolsRoot = resolveTidasToolsRoot(options.tidasToolsDir, options.env ?? process.env);
  const reportPath = path.resolve(
    options.reportPath ?? path.join(outputDir, 'conversion-report.json'),
  );
  const commandArgs = [
    '-m',
    'tidas_tools.import_lca.cli',
    '--input',
    inputPath,
    '--output-dir',
    outputDir,
    '--from-format',
    fromFormat,
    '--target',
    target,
    '--report',
    reportPath,
    '--language',
    options.language?.trim() || 'en',
    '--validation-jobs',
    String(options.validationJobs ?? 1),
  ];
  if (options.mappingDir) {
    commandArgs.push('--mapping-dir', path.resolve(options.mappingDir));
  }
  if (options.failOnWarning) {
    commandArgs.push('--fail-on-warning');
  }
  if (options.detectOnly) {
    commandArgs.push('--detect-only');
  }

  const run = (options.spawnImpl ?? spawnSync)(pythonBin, commandArgs, {
    cwd: tidasToolsRoot,
    env: {
      ...(options.env ?? process.env),
      PYTHONPATH: buildPythonPath(tidasToolsRoot, options.env ?? process.env),
    },
    encoding: 'utf8',
  }) as SpawnSyncReturns<string>;
  const conversionReport = readOptionalJson(reportPath);
  const files = {
    report: path.join(outputDir, 'outputs', 'import-lca-report.json'),
    conversion_report: reportPath,
    tidas_dir: options.detectOnly ? null : path.join(outputDir, 'tidas'),
    ilcd_dir:
      !options.detectOnly && (target === 'ilcd' || target === 'both')
        ? path.join(outputDir, 'ilcd')
        : null,
    mapping_csv: options.detectOnly ? null : path.join(outputDir, 'mapping.csv'),
  };
  const report: DatasetImportLcaReport = {
    schema_version: 1,
    status: run.status === 0 ? 'completed' : 'blocked',
    generated_at_utc: (options.now ?? new Date()).toISOString(),
    input_path: inputPath,
    output_dir: outputDir,
    from_format: fromFormat,
    target,
    detect_only: Boolean(options.detectOnly),
    command: {
      executable: pythonBin,
      args: commandArgs,
      cwd: tidasToolsRoot,
      exit_code: run.status,
      stdout: run.stdout ?? '',
      stderr: run.stderr ?? '',
    },
    conversion_report: conversionReport,
    files,
  };

  writeJsonArtifact(files.report, report);
  return report;
}

function requireInputPath(value: string): string {
  if (!value?.trim()) {
    throw new CliError('Missing required --input value.', {
      code: 'DATASET_IMPORT_LCA_INPUT_REQUIRED',
      exitCode: 2,
    });
  }
  const resolved = path.resolve(value);
  if (!existsSync(resolved)) {
    throw new CliError(`Input path not found: ${resolved}`, {
      code: 'DATASET_IMPORT_LCA_INPUT_NOT_FOUND',
      exitCode: 2,
    });
  }
  return resolved;
}

function requireOutputDir(value: string): string {
  if (!value?.trim()) {
    throw new CliError('Missing required --output-dir value.', {
      code: 'DATASET_IMPORT_LCA_OUTPUT_DIR_REQUIRED',
      exitCode: 2,
    });
  }
  return path.resolve(value);
}

function normalizeTarget(value: string | undefined): DatasetImportLcaTarget {
  const target = value?.trim() || 'tidas';
  if (target === 'tidas' || target === 'ilcd' || target === 'both') {
    return target;
  }
  throw new CliError("--target must be 'tidas', 'ilcd', or 'both'.", {
    code: 'DATASET_IMPORT_LCA_TARGET_INVALID',
    exitCode: 2,
  });
}

function resolveTidasToolsRoot(
  explicitValue: string | undefined,
  env: NodeJS.ProcessEnv,
  defaultCandidate?: string,
): string {
  const cliRepoRoot = resolveCliRepoRoot();
  if (explicitValue?.trim()) {
    const resolved = path.resolve(explicitValue);
    if (existsSync(path.join(resolved, 'src/tidas_tools/import_lca/cli.py'))) {
      return resolved;
    }
    throw new CliError('Could not resolve a tidas-tools checkout for dataset import.', {
      code: 'DATASET_IMPORT_LCA_TIDAS_TOOLS_NOT_FOUND',
      exitCode: 2,
      details: { candidates: [explicitValue] },
    });
  }

  const candidates = [
    env.TIDAS_TOOLS_DIR,
    env.TIDAS_TOOLS_PATH,
    defaultCandidate ?? path.resolve(cliRepoRoot, '../tidas-tools'),
  ].filter((candidate): candidate is string => Boolean(candidate?.trim()));

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (existsSync(path.join(resolved, 'src/tidas_tools/import_lca/cli.py'))) {
      return resolved;
    }
  }

  throw new CliError('Could not resolve a tidas-tools checkout for dataset import.', {
    code: 'DATASET_IMPORT_LCA_TIDAS_TOOLS_NOT_FOUND',
    exitCode: 2,
    details: { candidates },
  });
}

function resolveCliRepoRoot(candidatesOverride?: string[]): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = candidatesOverride ?? [
    path.resolve(moduleDir, '../..'),
    path.resolve(moduleDir, '../../..'),
  ];
  return (
    candidates.find(
      (candidate) =>
        existsSync(path.join(candidate, 'package.json')) &&
        existsSync(path.join(candidate, 'src/cli.ts')),
    ) ?? candidates[0]
  );
}

function buildPythonPath(tidasToolsRoot: string, env: NodeJS.ProcessEnv): string {
  return [path.join(tidasToolsRoot, 'src'), env.PYTHONPATH].filter(Boolean).join(path.delimiter);
}

function readOptionalJson(filePath: string): unknown | null {
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export const __testInternals = {
  normalizeTarget,
  resolveCliRepoRoot,
  resolveTidasToolsRoot,
};
