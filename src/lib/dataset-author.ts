import { existsSync } from 'node:fs';
import path from 'node:path';
import { writeJsonArtifact } from './artifacts.js';
import { runDatasetContract, type DatasetContractReport } from './dataset-contract.js';
import { CliError } from './errors.js';
import {
  parseUnstructuredDocument,
  readUnstructuredRuntimeEnv,
  type ParseUnstructuredDocumentOptions,
} from './unstructured.js';
import type { FetchLike } from './http.js';

export type DatasetAuthorReport = {
  schema_version: 1;
  status: 'evidence_ready';
  generated_at_utc: string;
  input_path: string;
  target_types: string[];
  files: {
    source_extract: string;
    authoring_report: string;
  };
  context_packs: Array<{
    type: string;
    report: DatasetContractReport;
  }>;
  next_actions: string[];
};

export type RunDatasetAuthorOptions = {
  inputPath: string;
  targetTypes: string | string[] | undefined;
  outDir: string | null | undefined;
  prompt?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  timeoutMs?: number | undefined;
  env: NodeJS.ProcessEnv;
  fetchImpl: FetchLike;
  now?: Date | undefined;
  parseImpl?: typeof parseUnstructuredDocument | undefined;
  contractImpl?: typeof runDatasetContract | undefined;
};

export async function runDatasetAuthor(
  options: RunDatasetAuthorOptions,
): Promise<DatasetAuthorReport> {
  const inputPath = requireInputPath(options.inputPath);
  const outDir = requireOutDir(options.outDir);
  const targetTypes = normalizeTargetTypes(options.targetTypes);
  const outputsDir = path.join(outDir, 'outputs');
  const sourceExtractFile = path.join(outputsDir, 'source-extract.json');
  const authoringReportFile = path.join(outputsDir, 'authoring-report.json');
  const parseImpl = options.parseImpl ?? parseUnstructuredDocument;
  const contractImpl = options.contractImpl ?? runDatasetContract;

  const sourceExtract = await parseImpl({
    env: readUnstructuredRuntimeEnv(options.env),
    filePath: inputPath,
    prompt: options.prompt,
    provider: options.provider,
    model: options.model,
    timeoutMs: options.timeoutMs ?? 120000,
    fetchImpl: options.fetchImpl,
  } satisfies ParseUnstructuredDocumentOptions);
  writeJsonArtifact(sourceExtractFile, sourceExtract);

  const contextPacks = [];
  for (const type of targetTypes) {
    const report = await contractImpl({
      type,
      include: ['schema', 'methodology', 'ruleset'],
      profile: 'ai-import',
      outDir: path.join(outDir, 'context', type),
      mode: 'context-pack',
      now: options.now,
    });
    contextPacks.push({ type, report });
  }

  const report: DatasetAuthorReport = {
    schema_version: 1,
    status: 'evidence_ready',
    generated_at_utc: (options.now ?? new Date()).toISOString(),
    input_path: inputPath,
    target_types: targetTypes,
    files: {
      source_extract: sourceExtractFile,
      authoring_report: authoringReportFile,
    },
    context_packs: contextPacks,
    next_actions: [
      'Use outputs/source-extract.json and the context pack manifests to generate candidate TIDAS rows.',
      'Run tiangong-lca dataset validate for each generated row file before mutation planning.',
      'Place invalid rows in a repair queue and keep source evidence linked to field-level assumptions.',
    ],
  };
  writeJsonArtifact(authoringReportFile, report);

  return report;
}

function requireInputPath(value: string): string {
  if (!value?.trim()) {
    throw new CliError('Missing required --input value.', {
      code: 'DATASET_AUTHOR_INPUT_REQUIRED',
      exitCode: 2,
    });
  }
  const resolved = path.resolve(value);
  if (!existsSync(resolved)) {
    throw new CliError(`Input file not found: ${resolved}`, {
      code: 'DATASET_AUTHOR_INPUT_NOT_FOUND',
      exitCode: 2,
    });
  }
  return resolved;
}

function requireOutDir(value: string | null | undefined): string {
  if (!value?.trim()) {
    throw new CliError('Missing required --out-dir value.', {
      code: 'DATASET_AUTHOR_OUT_DIR_REQUIRED',
      exitCode: 2,
    });
  }
  return path.resolve(value);
}

function normalizeTargetTypes(value: string | string[] | undefined): string[] {
  const rawValues = Array.isArray(value) ? value : value ? [value] : [];
  const values = rawValues.flatMap((item) =>
    item
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  );
  if (!values.length) {
    throw new CliError('Missing required --target-types value.', {
      code: 'DATASET_AUTHOR_TARGET_TYPES_REQUIRED',
      exitCode: 2,
    });
  }
  return [...new Set(values)];
}

export const __testInternals = {
  normalizeTargetTypes,
};
