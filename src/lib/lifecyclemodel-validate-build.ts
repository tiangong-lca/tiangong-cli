import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { readJsonArtifact, writeJsonArtifact } from './artifacts.js';
import { CliError } from './errors.js';
import {
  runValidation,
  type RunValidationOptions,
  type ValidationRunReport,
} from './validation.js';

type JsonObject = Record<string, unknown>;

type ModelBundleEntry = {
  runName: string;
  inputDir: string;
  modelFiles: string[];
};

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function readRequiredJsonObject(
  filePath: string,
  missingCode: string,
  invalidCode: string,
  label: string,
): JsonObject {
  if (!existsSync(filePath)) {
    throw new CliError(`Required lifecyclemodel ${label} artifact not found: ${filePath}`, {
      code: missingCode,
      exitCode: 2,
      details: { filePath, label },
    });
  }

  const value = readJsonArtifact(filePath);
  if (!isRecord(value)) {
    throw new CliError(`Expected lifecyclemodel ${label} artifact JSON object: ${filePath}`, {
      code: invalidCode,
      exitCode: 2,
      details: { filePath, label },
    });
  }

  return value;
}

export type LifecyclemodelValidateBuildLayout = {
  runId: string;
  runRoot: string;
  modelsDir: string;
  reportsDir: string;
  modelReportsDir: string;
  manifestsDir: string;
  runManifestPath: string;
  invocationIndexPath: string;
  autoBuildReportPath: string;
  reportPath: string;
};

export type LifecyclemodelValidateBuildModelReport = {
  run_name: string;
  input_dir: string;
  model_files: string[];
  report_file: string;
  validation: ValidationRunReport;
};

export type LifecyclemodelValidateBuildReport = {
  schema_version: 1;
  generated_at_utc: string;
  status: 'completed_lifecyclemodel_validate_build';
  run_id: string;
  run_root: string;
  ok: boolean;
  engine: string;
  counts: {
    models: number;
    ok: number;
    failed: number;
  };
  files: {
    run_manifest: string;
    invocation_index: string;
    auto_build_report: string | null;
    report: string;
    model_reports_dir: string;
  };
  model_reports: LifecyclemodelValidateBuildModelReport[];
  next_actions: string[];
};

export type RunLifecyclemodelValidateBuildOptions = {
  runDir: string;
  engine?: string;
  now?: Date;
  cwd?: string;
};

export type LifecyclemodelValidateBuildDeps = {
  runValidationImpl?: (options: RunValidationOptions) => Promise<ValidationRunReport>;
};

function buildLayout(runRoot: string): LifecyclemodelValidateBuildLayout {
  const runId = path.basename(runRoot);
  return {
    runId,
    runRoot,
    modelsDir: path.join(runRoot, 'models'),
    reportsDir: path.join(runRoot, 'reports'),
    modelReportsDir: path.join(runRoot, 'reports', 'model-validations'),
    manifestsDir: path.join(runRoot, 'manifests'),
    runManifestPath: path.join(runRoot, 'manifests', 'run-manifest.json'),
    invocationIndexPath: path.join(runRoot, 'manifests', 'invocation-index.json'),
    autoBuildReportPath: path.join(runRoot, 'reports', 'lifecyclemodel-auto-build-report.json'),
    reportPath: path.join(runRoot, 'reports', 'lifecyclemodel-validate-build-report.json'),
  };
}

function resolveLayout(
  options: RunLifecyclemodelValidateBuildOptions,
): LifecyclemodelValidateBuildLayout {
  const runDir = nonEmptyString(options.runDir);
  if (!runDir) {
    throw new CliError('Missing required --run-dir for lifecyclemodel validate-build.', {
      code: 'LIFECYCLEMODEL_VALIDATE_RUN_DIR_REQUIRED',
      exitCode: 2,
    });
  }

  return buildLayout(path.resolve(runDir));
}

function ensureRunRootExists(layout: LifecyclemodelValidateBuildLayout): void {
  if (!existsSync(layout.runRoot)) {
    throw new CliError(`lifecyclemodel validate-build run root not found: ${layout.runRoot}`, {
      code: 'LIFECYCLEMODEL_VALIDATE_RUN_NOT_FOUND',
      exitCode: 2,
    });
  }
}

function readRequiredRunManifest(layout: LifecyclemodelValidateBuildLayout): JsonObject {
  const manifest = readRequiredJsonObject(
    layout.runManifestPath,
    'LIFECYCLEMODEL_VALIDATE_RUN_MANIFEST_MISSING',
    'LIFECYCLEMODEL_VALIDATE_RUN_MANIFEST_INVALID',
    'run-manifest',
  );

  const manifestRunId = nonEmptyString(manifest.runId);
  if (manifestRunId && manifestRunId !== layout.runId) {
    throw new CliError(
      `lifecyclemodel validate-build run manifest runId mismatch: ${layout.runManifestPath}`,
      {
        code: 'LIFECYCLEMODEL_VALIDATE_RUN_MANIFEST_MISMATCH',
        exitCode: 2,
        details: {
          expected: layout.runId,
          actual: manifestRunId,
        },
      },
    );
  }

  return manifest;
}

function readInvocationIndex(layout: LifecyclemodelValidateBuildLayout): JsonObject {
  if (!existsSync(layout.invocationIndexPath)) {
    return {
      schema_version: 1,
      invocations: [],
    };
  }

  const value = readJsonArtifact(layout.invocationIndexPath);
  if (!isRecord(value)) {
    throw new CliError(
      `Expected lifecyclemodel validate invocation index JSON object: ${layout.invocationIndexPath}`,
      {
        code: 'LIFECYCLEMODEL_VALIDATE_INVOCATION_INDEX_INVALID',
        exitCode: 2,
      },
    );
  }

  if (value.invocations === undefined) {
    return {
      schema_version: 1,
      invocations: [],
    };
  }

  if (!Array.isArray(value.invocations)) {
    throw new CliError(
      `Expected lifecyclemodel validate invocation index to contain an invocations array: ${layout.invocationIndexPath}`,
      {
        code: 'LIFECYCLEMODEL_VALIDATE_INVOCATION_INDEX_INVALID',
        exitCode: 2,
      },
    );
  }

  return value;
}

function discoverModelEntries(layout: LifecyclemodelValidateBuildLayout): ModelBundleEntry[] {
  const runNames = existsSync(layout.modelsDir) ? readdirSync(layout.modelsDir).sort() : [];
  const entries = runNames.flatMap((runName) => {
    const inputDir = path.join(layout.modelsDir, runName, 'tidas_bundle');
    const lifecyclemodelsDir = path.join(inputDir, 'lifecyclemodels');
    if (!existsSync(lifecyclemodelsDir)) {
      return [];
    }

    const modelFiles = readdirSync(lifecyclemodelsDir)
      .filter((entry) => entry.endsWith('.json'))
      .sort()
      .map((entry) => path.join(lifecyclemodelsDir, entry));

    if (modelFiles.length === 0) {
      throw new CliError(
        `lifecyclemodel validate-build found a bundle without lifecyclemodel JSON files: ${lifecyclemodelsDir}`,
        {
          code: 'LIFECYCLEMODEL_VALIDATE_MODELS_EMPTY',
          exitCode: 2,
        },
      );
    }

    return [{ runName, inputDir, modelFiles }];
  });

  if (entries.length === 0) {
    throw new CliError(
      `lifecyclemodel validate-build run does not contain any model bundles: ${layout.modelsDir}`,
      {
        code: 'LIFECYCLEMODEL_VALIDATE_MODELS_NOT_FOUND',
        exitCode: 2,
      },
    );
  }

  return entries;
}

function buildInvocationIndex(
  layout: LifecyclemodelValidateBuildLayout,
  invocationIndex: JsonObject,
  options: RunLifecyclemodelValidateBuildOptions,
  now: Date,
): JsonObject {
  const priorInvocations = Array.isArray(invocationIndex.invocations)
    ? [...invocationIndex.invocations]
    : [];
  const command = ['lifecyclemodel', 'validate-build', '--run-dir', options.runDir];
  if (options.engine) {
    command.push('--engine', options.engine);
  }

  return {
    ...invocationIndex,
    schema_version:
      typeof invocationIndex.schema_version === 'number' ? invocationIndex.schema_version : 1,
    invocations: [
      ...priorInvocations,
      {
        command,
        cwd: options.cwd ?? process.cwd(),
        created_at: now.toISOString(),
        run_id: layout.runId,
        run_root: layout.runRoot,
        report_path: layout.reportPath,
        model_reports_dir: layout.modelReportsDir,
      },
    ],
  };
}

function buildNextActions(layout: LifecyclemodelValidateBuildLayout): string[] {
  return [
    `inspect: ${layout.reportPath}`,
    `inspect: ${layout.modelReportsDir}`,
    `run: tiangong lifecyclemodel publish-build --run-dir ${layout.runRoot}`,
  ];
}

function resolveValidationImpl(
  deps: LifecyclemodelValidateBuildDeps,
): (options: RunValidationOptions) => Promise<ValidationRunReport> {
  return deps.runValidationImpl ?? runValidation;
}

function resolveReportEngine(
  modelReports: LifecyclemodelValidateBuildModelReport[],
  requestedEngine?: string,
): string {
  return modelReports[0]?.validation.mode ?? requestedEngine ?? 'auto';
}

export async function runLifecyclemodelValidateBuild(
  options: RunLifecyclemodelValidateBuildOptions,
  deps: LifecyclemodelValidateBuildDeps = {},
): Promise<LifecyclemodelValidateBuildReport> {
  const now = options.now ?? new Date();
  const layout = resolveLayout(options);
  ensureRunRootExists(layout);
  readRequiredRunManifest(layout);
  const invocationIndex = readInvocationIndex(layout);
  const validationImpl = resolveValidationImpl(deps);
  const modelEntries = discoverModelEntries(layout);

  const modelReports: LifecyclemodelValidateBuildModelReport[] = [];
  for (const entry of modelEntries) {
    const reportFile = path.join(layout.modelReportsDir, `${entry.runName}.json`);
    const validation = await validationImpl({
      inputDir: entry.inputDir,
      engine: options.engine,
      reportFile,
    });
    modelReports.push({
      run_name: entry.runName,
      input_dir: entry.inputDir,
      model_files: entry.modelFiles,
      report_file: reportFile,
      validation,
    });
  }

  const okCount = modelReports.filter((entry) => entry.validation.ok).length;
  const report: LifecyclemodelValidateBuildReport = {
    schema_version: 1,
    generated_at_utc: now.toISOString(),
    status: 'completed_lifecyclemodel_validate_build',
    run_id: layout.runId,
    run_root: layout.runRoot,
    ok: okCount === modelReports.length,
    engine: resolveReportEngine(modelReports, options.engine),
    counts: {
      models: modelReports.length,
      ok: okCount,
      failed: modelReports.length - okCount,
    },
    files: {
      run_manifest: layout.runManifestPath,
      invocation_index: layout.invocationIndexPath,
      auto_build_report: existsSync(layout.autoBuildReportPath) ? layout.autoBuildReportPath : null,
      report: layout.reportPath,
      model_reports_dir: layout.modelReportsDir,
    },
    model_reports: modelReports,
    next_actions: buildNextActions(layout),
  };

  writeJsonArtifact(
    layout.invocationIndexPath,
    buildInvocationIndex(layout, invocationIndex, options, now),
  );
  writeJsonArtifact(layout.reportPath, report);
  return report;
}

export const __testInternals = {
  buildLayout,
  resolveLayout,
  readInvocationIndex,
  discoverModelEntries,
  buildInvocationIndex,
  buildNextActions,
  resolveValidationImpl,
  resolveReportEngine,
};
