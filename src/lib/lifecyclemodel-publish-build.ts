import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { readJsonArtifact, writeJsonArtifact } from './artifacts.js';
import { CliError } from './errors.js';
import { normalizePublishRequest } from './publish.js';

type JsonObject = Record<string, unknown>;

type LifecyclemodelPublishValidationSummary = {
  available: boolean;
  ok: boolean | null;
  report: string | null;
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

function copyJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

export type LifecyclemodelPublishBuildLayout = {
  runId: string;
  runRoot: string;
  modelsDir: string;
  reportsDir: string;
  manifestsDir: string;
  publishStageDir: string;
  runManifestPath: string;
  invocationIndexPath: string;
  validationReportPath: string;
  publishBundlePath: string;
  publishRequestPath: string;
  publishIntentPath: string;
  reportPath: string;
};

export type LifecyclemodelPublishBuildReport = {
  schema_version: 1;
  generated_at_utc: string;
  status: 'prepared_local_lifecyclemodel_publish_bundle';
  run_id: string;
  run_root: string;
  counts: {
    lifecyclemodels: number;
  };
  publish_defaults: {
    commit: boolean;
    publish_lifecyclemodels: boolean;
    publish_processes: boolean;
    publish_sources: boolean;
    publish_relations: boolean;
    publish_process_build_runs: boolean;
    relation_mode: 'local_manifest_only';
  };
  validation: LifecyclemodelPublishValidationSummary;
  files: {
    run_manifest: string;
    invocation_index: string;
    publish_bundle: string;
    publish_request: string;
    publish_intent: string;
    report: string;
  };
  next_actions: string[];
};

export type RunLifecyclemodelPublishBuildOptions = {
  runDir: string;
  now?: Date;
  cwd?: string;
};

function buildLayout(runRoot: string): LifecyclemodelPublishBuildLayout {
  const runId = path.basename(runRoot);
  return {
    runId,
    runRoot,
    modelsDir: path.join(runRoot, 'models'),
    reportsDir: path.join(runRoot, 'reports'),
    manifestsDir: path.join(runRoot, 'manifests'),
    publishStageDir: path.join(runRoot, 'stage_outputs', '10_publish'),
    runManifestPath: path.join(runRoot, 'manifests', 'run-manifest.json'),
    invocationIndexPath: path.join(runRoot, 'manifests', 'invocation-index.json'),
    validationReportPath: path.join(
      runRoot,
      'reports',
      'lifecyclemodel-validate-build-report.json',
    ),
    publishBundlePath: path.join(runRoot, 'stage_outputs', '10_publish', 'publish-bundle.json'),
    publishRequestPath: path.join(runRoot, 'stage_outputs', '10_publish', 'publish-request.json'),
    publishIntentPath: path.join(runRoot, 'stage_outputs', '10_publish', 'publish-intent.json'),
    reportPath: path.join(runRoot, 'reports', 'lifecyclemodel-publish-build-report.json'),
  };
}

function resolveLayout(
  options: RunLifecyclemodelPublishBuildOptions,
): LifecyclemodelPublishBuildLayout {
  const runDir = nonEmptyString(options.runDir);
  if (!runDir) {
    throw new CliError('Missing required --run-dir for lifecyclemodel publish-build.', {
      code: 'LIFECYCLEMODEL_PUBLISH_RUN_DIR_REQUIRED',
      exitCode: 2,
    });
  }

  return buildLayout(path.resolve(runDir));
}

function ensureRunRootExists(layout: LifecyclemodelPublishBuildLayout): void {
  if (!existsSync(layout.runRoot)) {
    throw new CliError(`lifecyclemodel publish-build run root not found: ${layout.runRoot}`, {
      code: 'LIFECYCLEMODEL_PUBLISH_RUN_NOT_FOUND',
      exitCode: 2,
    });
  }
}

function readRequiredRunManifest(layout: LifecyclemodelPublishBuildLayout): JsonObject {
  const manifest = readRequiredJsonObject(
    layout.runManifestPath,
    'LIFECYCLEMODEL_PUBLISH_RUN_MANIFEST_MISSING',
    'LIFECYCLEMODEL_PUBLISH_RUN_MANIFEST_INVALID',
    'run-manifest',
  );

  const manifestRunId = nonEmptyString(manifest.runId);
  if (manifestRunId && manifestRunId !== layout.runId) {
    throw new CliError(
      `lifecyclemodel publish-build run manifest runId mismatch: ${layout.runManifestPath}`,
      {
        code: 'LIFECYCLEMODEL_PUBLISH_RUN_MANIFEST_MISMATCH',
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

function readInvocationIndex(layout: LifecyclemodelPublishBuildLayout): JsonObject {
  if (!existsSync(layout.invocationIndexPath)) {
    return {
      schema_version: 1,
      invocations: [],
    };
  }

  const value = readJsonArtifact(layout.invocationIndexPath);
  if (!isRecord(value)) {
    throw new CliError(
      `Expected lifecyclemodel publish invocation index JSON object: ${layout.invocationIndexPath}`,
      {
        code: 'LIFECYCLEMODEL_PUBLISH_INVOCATION_INDEX_INVALID',
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
      `Expected lifecyclemodel publish invocation index to contain an invocations array: ${layout.invocationIndexPath}`,
      {
        code: 'LIFECYCLEMODEL_PUBLISH_INVOCATION_INDEX_INVALID',
        exitCode: 2,
      },
    );
  }

  return value;
}

function collectLifecyclemodelPayloads(layout: LifecyclemodelPublishBuildLayout): JsonObject[] {
  const runNames = existsSync(layout.modelsDir) ? readdirSync(layout.modelsDir).sort() : [];
  const payloads = runNames.flatMap((runName) => {
    const lifecyclemodelsDir = path.join(
      layout.modelsDir,
      runName,
      'tidas_bundle',
      'lifecyclemodels',
    );
    if (!existsSync(lifecyclemodelsDir)) {
      return [];
    }

    return readdirSync(lifecyclemodelsDir)
      .filter((entry) => entry.endsWith('.json'))
      .sort()
      .map((entry) => {
        const filePath = path.join(lifecyclemodelsDir, entry);
        const value = readJsonArtifact(filePath);
        if (!isRecord(value)) {
          throw new CliError(`Expected lifecyclemodel publish payload JSON object: ${filePath}`, {
            code: 'LIFECYCLEMODEL_PUBLISH_MODEL_INVALID',
            exitCode: 2,
          });
        }
        return value;
      });
  });

  if (payloads.length === 0) {
    throw new CliError(
      `lifecyclemodel publish-build run does not contain any lifecyclemodel payloads: ${layout.modelsDir}`,
      {
        code: 'LIFECYCLEMODEL_PUBLISH_MODELS_NOT_FOUND',
        exitCode: 2,
      },
    );
  }

  return payloads;
}

function readValidationSummary(
  layout: LifecyclemodelPublishBuildLayout,
): LifecyclemodelPublishValidationSummary {
  if (!existsSync(layout.validationReportPath)) {
    return {
      available: false,
      ok: null,
      report: null,
    };
  }

  const value = readJsonArtifact(layout.validationReportPath);
  if (!isRecord(value)) {
    throw new CliError(
      `Expected lifecyclemodel validate-build report JSON object: ${layout.validationReportPath}`,
      {
        code: 'LIFECYCLEMODEL_PUBLISH_VALIDATION_REPORT_INVALID',
        exitCode: 2,
      },
    );
  }

  return {
    available: true,
    ok: typeof value.ok === 'boolean' ? value.ok : false,
    report: layout.validationReportPath,
  };
}

function buildPublishRequest(): JsonObject {
  return {
    inputs: {
      bundle_paths: ['./publish-bundle.json'],
    },
    publish: {
      commit: false,
      publish_lifecyclemodels: true,
      publish_processes: false,
      publish_sources: false,
      publish_relations: false,
      publish_process_build_runs: false,
      relation_mode: 'local_manifest_only',
    },
    out_dir: './publish-run',
  };
}

function buildPublishIntent(
  layout: LifecyclemodelPublishBuildLayout,
  lifecyclemodelCount: number,
): JsonObject {
  return {
    ok: true,
    command: 'publish run',
    input_path: layout.publishRequestPath,
    run_id: layout.runId,
    run_root: layout.runRoot,
    status: 'prepared_local_lifecyclemodel_publish_bundle',
    lifecyclemodel_count: lifecyclemodelCount,
  };
}

function buildInvocationIndex(
  layout: LifecyclemodelPublishBuildLayout,
  invocationIndex: JsonObject,
  options: RunLifecyclemodelPublishBuildOptions,
  now: Date,
): JsonObject {
  const priorInvocations = Array.isArray(invocationIndex.invocations)
    ? [...invocationIndex.invocations]
    : [];

  return {
    ...invocationIndex,
    schema_version:
      typeof invocationIndex.schema_version === 'number' ? invocationIndex.schema_version : 1,
    invocations: [
      ...priorInvocations,
      {
        command: ['lifecyclemodel', 'publish-build', '--run-dir', options.runDir],
        cwd: options.cwd ?? process.cwd(),
        created_at: now.toISOString(),
        run_id: layout.runId,
        run_root: layout.runRoot,
        report_path: layout.reportPath,
        publish_request_path: layout.publishRequestPath,
      },
    ],
  };
}

function buildNextActions(layout: LifecyclemodelPublishBuildLayout): string[] {
  return [
    `inspect: ${layout.publishBundlePath}`,
    `inspect: ${layout.publishRequestPath}`,
    `run: tiangong publish run --input ${layout.publishRequestPath}`,
  ];
}

export async function runLifecyclemodelPublishBuild(
  options: RunLifecyclemodelPublishBuildOptions,
): Promise<LifecyclemodelPublishBuildReport> {
  const now = options.now ?? new Date();
  const layout = resolveLayout(options);
  ensureRunRootExists(layout);
  const runManifest = readRequiredRunManifest(layout);
  const invocationIndex = readInvocationIndex(layout);
  const lifecyclemodels = collectLifecyclemodelPayloads(layout);
  const validation = readValidationSummary(layout);
  const publishRequest = buildPublishRequest();
  const normalizedPublishRequest = normalizePublishRequest(publishRequest, {
    requestPath: layout.publishRequestPath,
    now,
  });
  const publishBundle = {
    generated_at_utc: now.toISOString(),
    run_id: layout.runId,
    run_root: layout.runRoot,
    status: 'prepared_local_lifecyclemodel_publish_bundle' as const,
    source_run: {
      run_manifest: copyJson(runManifest),
    },
    validation: copyJson(validation),
    lifecyclemodels: copyJson(lifecyclemodels),
    relations: [],
  };
  const publishIntent = buildPublishIntent(layout, lifecyclemodels.length);
  const report: LifecyclemodelPublishBuildReport = {
    schema_version: 1,
    generated_at_utc: now.toISOString(),
    status: 'prepared_local_lifecyclemodel_publish_bundle',
    run_id: layout.runId,
    run_root: layout.runRoot,
    counts: {
      lifecyclemodels: lifecyclemodels.length,
    },
    publish_defaults: {
      commit: normalizedPublishRequest.publish.commit,
      publish_lifecyclemodels: normalizedPublishRequest.publish.publish_lifecyclemodels,
      publish_processes: normalizedPublishRequest.publish.publish_processes,
      publish_sources: normalizedPublishRequest.publish.publish_sources,
      publish_relations: normalizedPublishRequest.publish.publish_relations,
      publish_process_build_runs: normalizedPublishRequest.publish.publish_process_build_runs,
      relation_mode: normalizedPublishRequest.publish.relation_mode,
    },
    validation,
    files: {
      run_manifest: layout.runManifestPath,
      invocation_index: layout.invocationIndexPath,
      publish_bundle: layout.publishBundlePath,
      publish_request: layout.publishRequestPath,
      publish_intent: layout.publishIntentPath,
      report: layout.reportPath,
    },
    next_actions: buildNextActions(layout),
  };

  writeJsonArtifact(
    layout.invocationIndexPath,
    buildInvocationIndex(layout, invocationIndex, options, now),
  );
  writeJsonArtifact(layout.publishBundlePath, publishBundle);
  writeJsonArtifact(layout.publishRequestPath, publishRequest);
  writeJsonArtifact(layout.publishIntentPath, publishIntent);
  writeJsonArtifact(layout.reportPath, report);

  return report;
}

export const __testInternals = {
  buildLayout,
  resolveLayout,
  readInvocationIndex,
  collectLifecyclemodelPayloads,
  readValidationSummary,
  buildPublishRequest,
  buildPublishIntent,
  buildInvocationIndex,
  buildNextActions,
};
