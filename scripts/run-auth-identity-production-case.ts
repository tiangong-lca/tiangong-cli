#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import {
  parseAuthIdentityReceipt,
  type AuthIdentityReceipt,
} from '../src/lib/auth-identity-receipt.js';
import { CliError, toErrorPayload } from '../src/lib/errors.js';

const CASE_SCHEMA = 'tiangong-lca.auth-identity-production-case.v1' as const;
const FAILURE_SCHEMA = 'tiangong-lca.auth-identity-production-case-failure.v1' as const;
const MAX_CHILD_OUTPUT_BYTES = 256 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const REQUIRED_ENV_KEYS = [
  'TIANGONG_LCA_API_BASE_URL',
  'TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY',
  'TIANGONG_LCA_TEST_API_KEY',
] as const;
const SYSTEM_ENV_ALLOWLIST = [
  'PATH',
  'Path',
  'PATHEXT',
  'SYSTEMROOT',
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'TEMP',
  'TMP',
  'TMPDIR',
] as const;

export type ProductionIdentityCaseOptions = {
  envFile: string;
  expectedProjectRef: string;
  expectedUserId: string;
  outDir: string;
};

export type ProductionIdentityRuntimeEvidence = {
  entrypoint: string;
  entrypointSha256: string;
  sourceTreeSha256: string;
  runtimeTreeSha256: string;
  runnerSha256: string;
  pnpmLockSha256: string;
  cleanup: () => void;
};

export type ProductionIdentityCaseSpawn = {
  command: string;
  args: string[];
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    shell: false;
    encoding: 'utf8';
    maxBuffer: number;
    windowsHide: true;
  };
};

type ProductionIdentityCaseSpawnResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

export type ProductionIdentityCaseManifest = {
  schema: typeof CASE_SCHEMA;
  status: 'passed';
  executed_at_utc: string;
  cli: AuthIdentityReceipt['cli'];
  cli_argv: string[];
  cli_argv_sha256: string;
  runtime_entrypoint_sha256: string;
  source_tree_sha256: string;
  runtime_tree_sha256: string;
  runner_sha256: string;
  pnpm_lock_sha256: string;
  project_ref: string;
  user_id: string;
  receipt_scope_sha256: string;
  receipt_file_sha256: string;
};

export type RunProductionIdentityCaseDeps = {
  processEnv?: NodeJS.ProcessEnv;
  now?: () => Date;
  prepareRuntimeSnapshot?: () => ProductionIdentityRuntimeEvidence;
  spawnImpl?: (
    command: string,
    args: string[],
    options: ProductionIdentityCaseSpawn['options'],
  ) => ProductionIdentityCaseSpawnResult;
};

function fail(message: string, code: string, exitCode = 1): never {
  throw new CliError(message, { code, exitCode });
}

function token(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function repositoryRoot(): string {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(scriptDir, '..'), path.resolve(scriptDir, '../..')];
  const root = candidates.find(
    (candidate) =>
      existsSync(path.join(candidate, 'package.json')) &&
      existsSync(path.join(candidate, 'pnpm-lock.yaml')) &&
      existsSync(path.join(candidate, 'src', 'main.ts')),
  );
  if (!root) {
    return fail(
      'The production identity case could not resolve its trusted repository root.',
      'AUTH_IDENTITY_CASE_RUNTIME_INVALID',
      2,
    );
  }
  return realpathSync(root);
}

function readTrustedFile(filePath: string): Buffer {
  let stats;
  try {
    stats = lstatSync(filePath);
  } catch {
    return fail(
      'The production identity case runtime evidence is incomplete.',
      'AUTH_IDENTITY_CASE_RUNTIME_INVALID',
      2,
    );
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    return fail(
      'The production identity case runtime evidence must contain regular files only.',
      'AUTH_IDENTITY_CASE_RUNTIME_INVALID',
      2,
    );
  }
  return readFileSync(filePath);
}

function collectRuntimeSourceFiles(root: string): string[] {
  const collected: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        return fail(
          'The production identity case source tree must not contain symlinks.',
          'AUTH_IDENTITY_CASE_RUNTIME_INVALID',
          2,
        );
      }
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        collected.push(entryPath);
      }
    }
  };
  visit(path.join(root, 'src'));
  collected.push(
    path.join(root, 'scripts', 'run-auth-identity-production-case.ts'),
    path.join(root, 'package.json'),
    path.join(root, 'pnpm-lock.yaml'),
    path.join(root, 'tsconfig.json'),
    path.join(root, 'tsconfig.build.json'),
  );
  return collected.sort();
}

type BufferedRuntimeFile = { relativePath: string; bytes: Buffer };

function hashBufferedFiles(files: BufferedRuntimeFile[]): string {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.relativePath).update('\0').update(file.bytes).update('\0');
  }
  return hash.digest('hex');
}

function collectGeneratedRuntimeFiles(snapshotRoot: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        files.push(entryPath);
      }
    }
  };
  visit(path.join(snapshotRoot, 'dist', 'src'));
  return files.sort();
}

function prepareRuntimeSnapshot(): ProductionIdentityRuntimeEvidence {
  const root = repositoryRoot();
  const sourceFiles = collectRuntimeSourceFiles(root).map((filePath) => ({
    relativePath: path.relative(root, filePath).replaceAll('\\', '/'),
    bytes: readTrustedFile(filePath),
  }));
  const pnpmLock = sourceFiles.find((file) => file.relativePath === 'pnpm-lock.yaml');
  if (!pnpmLock) {
    return fail(
      'The production identity case runtime evidence is missing pnpm-lock.yaml.',
      'AUTH_IDENTITY_CASE_RUNTIME_INVALID',
      2,
    );
  }
  const generatedFiles = collectGeneratedRuntimeFiles(root).map((filePath) => ({
    relativePath: path.relative(root, filePath).replaceAll('\\', '/'),
    bytes: readTrustedFile(filePath),
  }));
  const generatedEntrypoint = generatedFiles.find(
    (file) => file.relativePath === 'dist/src/main.js',
  );
  if (!generatedEntrypoint) {
    return fail(
      'The production identity case requires a freshly built dist/src/main.js.',
      'AUTH_IDENTITY_CASE_RUNTIME_INVALID',
      2,
    );
  }
  const runnerBytes = readTrustedFile(
    path.join(root, 'dist', 'scripts', 'run-auth-identity-production-case.js'),
  );
  const snapshotParent = path.join(root, 'node_modules', '.cache', 'tiangong-lca-auth-case');
  mkdirSync(snapshotParent, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') {
    chmodSync(snapshotParent, 0o700);
  }
  const snapshotRoot = mkdtempSync(path.join(snapshotParent, 'runtime-'));
  try {
    if (process.platform !== 'win32') {
      chmodSync(snapshotRoot, 0o700);
    }
    const packageJson = sourceFiles.find((file) => file.relativePath === 'package.json');
    if (!packageJson) {
      return fail(
        'The production identity case runtime evidence is missing package.json.',
        'AUTH_IDENTITY_CASE_RUNTIME_INVALID',
        2,
      );
    }
    for (const runtimeFile of [...generatedFiles, packageJson]) {
      const targetPath = path.join(snapshotRoot, runtimeFile.relativePath);
      mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
      writeFileSync(targetPath, runtimeFile.bytes, { flag: 'wx', mode: 0o600 });
      if (process.platform !== 'win32') {
        chmodSync(targetPath, 0o600);
      }
    }
    const entrypoint = path.join(snapshotRoot, 'dist', 'src', 'main.js');
    return {
      entrypoint,
      entrypointSha256: createHash('sha256').update(generatedEntrypoint.bytes).digest('hex'),
      sourceTreeSha256: hashBufferedFiles(sourceFiles),
      runtimeTreeSha256: hashBufferedFiles(generatedFiles),
      runnerSha256: createHash('sha256').update(runnerBytes).digest('hex'),
      pnpmLockSha256: createHash('sha256').update(pnpmLock.bytes).digest('hex'),
      cleanup: () => rmSync(snapshotRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(snapshotRoot, { recursive: true, force: true });
    throw error;
  }
}

function validateRuntimeEvidence(
  evidence: ProductionIdentityRuntimeEvidence,
): ProductionIdentityRuntimeEvidence {
  if (
    !path.isAbsolute(evidence.entrypoint) ||
    !SHA256_PATTERN.test(evidence.entrypointSha256) ||
    !SHA256_PATTERN.test(evidence.sourceTreeSha256) ||
    !SHA256_PATTERN.test(evidence.runtimeTreeSha256) ||
    !SHA256_PATTERN.test(evidence.runnerSha256) ||
    !SHA256_PATTERN.test(evidence.pnpmLockSha256) ||
    typeof evidence.cleanup !== 'function'
  ) {
    return fail(
      'The production identity case runtime evidence is invalid.',
      'AUTH_IDENTITY_CASE_RUNTIME_INVALID',
      2,
    );
  }
  return evidence;
}

function normalizeCaseOptions(
  options: ProductionIdentityCaseOptions,
): ProductionIdentityCaseOptions {
  const envFile = token(options.envFile);
  const expectedProjectRef = token(options.expectedProjectRef);
  const expectedUserId = token(options.expectedUserId);
  const outDir = token(options.outDir);
  if (!envFile || !expectedProjectRef || !expectedUserId || !outDir) {
    return fail(
      'The production identity case requires --env-file, --expected-project-ref, --expected-user-id, and --out-dir.',
      'AUTH_IDENTITY_CASE_ARGS_REQUIRED',
      2,
    );
  }
  if (!UUID_PATTERN.test(expectedUserId)) {
    return fail(
      'The production identity case expected user id must be a canonical lowercase UUID.',
      'AUTH_IDENTITY_CASE_ARGS_INVALID',
      2,
    );
  }
  const normalized = {
    envFile: path.resolve(envFile),
    expectedProjectRef,
    expectedUserId,
    outDir: path.resolve(outDir),
  };
  if (existsSync(normalized.outDir)) {
    return fail(
      'The production identity case output directory must not already exist.',
      'AUTH_IDENTITY_CASE_OUTPUT_EXISTS',
      2,
    );
  }
  return normalized;
}

export function parseProductionCaseArgs(argv: string[]): ProductionIdentityCaseOptions {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: normalizedArgv,
      allowPositionals: false,
      strict: true,
      tokens: true,
      options: {
        'env-file': { type: 'string' },
        'expected-project-ref': { type: 'string' },
        'expected-user-id': { type: 'string' },
        'out-dir': { type: 'string' },
      },
    });
  } catch (error) {
    return fail(
      `Invalid production identity case arguments: ${error instanceof Error ? error.message : 'parse failure'}`,
      'AUTH_IDENTITY_CASE_ARGS_INVALID',
      2,
    );
  }
  for (const name of ['env-file', 'expected-project-ref', 'expected-user-id', 'out-dir'] as const) {
    if (
      parsed.tokens!.filter((entry) => entry.kind === 'option' && entry.name === name).length > 1
    ) {
      return fail(
        `Invalid production identity case arguments: --${name} may be provided only once.`,
        'AUTH_IDENTITY_CASE_ARGS_INVALID',
        2,
      );
    }
  }
  return normalizeCaseOptions({
    envFile: typeof parsed.values['env-file'] === 'string' ? parsed.values['env-file'] : '',
    expectedProjectRef:
      typeof parsed.values['expected-project-ref'] === 'string'
        ? parsed.values['expected-project-ref']
        : '',
    expectedUserId:
      typeof parsed.values['expected-user-id'] === 'string'
        ? parsed.values['expected-user-id']
        : '',
    outDir: typeof parsed.values['out-dir'] === 'string' ? parsed.values['out-dir'] : '',
  });
}

function projectRefFromApiBaseUrl(apiBaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(apiBaseUrl);
  } catch {
    return fail(
      'The production-case API base URL is not a canonical Supabase URL.',
      'AUTH_IDENTITY_CASE_PROJECT_INVALID',
      2,
    );
  }
  const suffix = '.supabase.co';
  const projectRef = url.hostname.toLowerCase().endsWith(suffix)
    ? url.hostname.toLowerCase().slice(0, -suffix.length)
    : '';
  const pathname = url.pathname.replace(/\/+$/u, '');
  if (
    url.protocol !== 'https:' ||
    !projectRef ||
    projectRef.includes('.') ||
    !['', '/functions/v1', '/rest/v1'].includes(pathname) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    return fail(
      'The production-case API base URL is not a canonical Supabase URL.',
      'AUTH_IDENTITY_CASE_PROJECT_INVALID',
      2,
    );
  }
  return projectRef;
}

function readCaseEnv(envFile: string): Record<(typeof REQUIRED_ENV_KEYS)[number], string> {
  let parsed: NodeJS.ProcessEnv;
  try {
    parsed = parseEnv(readFileSync(envFile, 'utf8'));
  } catch {
    return fail(
      'The production identity case could not parse its env file.',
      'AUTH_IDENTITY_CASE_ENV_INVALID',
      2,
    );
  }
  const selected = Object.fromEntries(
    REQUIRED_ENV_KEYS.map((key) => [key, token(parsed[key])]),
  ) as Record<(typeof REQUIRED_ENV_KEYS)[number], string | null>;
  const missing = REQUIRED_ENV_KEYS.filter((key) => !selected[key]);
  if (missing.length > 0) {
    return fail(
      `Missing required production-case env: ${missing.join(', ')}.`,
      'AUTH_IDENTITY_CASE_ENV_REQUIRED',
      2,
    );
  }
  return selected as Record<(typeof REQUIRED_ENV_KEYS)[number], string>;
}

function buildChildEnv(
  processEnv: NodeJS.ProcessEnv,
  caseEnv: ReturnType<typeof readCaseEnv>,
): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {};
  for (const key of SYSTEM_ENV_ALLOWLIST) {
    if (typeof processEnv[key] === 'string') {
      childEnv[key] = processEnv[key];
    }
  }
  childEnv.TIANGONG_LCA_API_BASE_URL = caseEnv.TIANGONG_LCA_API_BASE_URL;
  childEnv.TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY = caseEnv.TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY;
  childEnv.TIANGONG_LCA_API_KEY = caseEnv.TIANGONG_LCA_TEST_API_KEY;
  childEnv.TIANGONG_LCA_DISABLE_SESSION_CACHE = 'true';
  childEnv.TIANGONG_LCA_FORCE_REAUTH = 'true';
  return childEnv;
}

function writePrivateFile(filePath: string, text: string): void {
  writeFileSync(filePath, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  if (process.platform !== 'win32') {
    chmodSync(filePath, 0o600);
  }
}

function safeChildErrorCode(stderr: string): string {
  if (Buffer.byteLength(stderr, 'utf8') > MAX_CHILD_OUTPUT_BYTES) {
    return 'AUTH_IDENTITY_CASE_CHILD_OUTPUT_TOO_LARGE';
  }
  try {
    const payload = JSON.parse(stderr) as { error?: { code?: unknown } };
    const code = token(payload.error?.code);
    return code && /^[A-Z0-9_]+$/u.test(code) ? code : 'AUTH_IDENTITY_CASE_CHILD_FAILED';
  } catch {
    return 'AUTH_IDENTITY_CASE_CHILD_FAILED';
  }
}

function writeFailure(
  outDir: string,
  options: { stage: string; exitCode: number | null; errorCode: string },
): void {
  writePrivateFile(
    path.join(outDir, 'case-failure.json'),
    `${JSON.stringify(
      {
        schema: FAILURE_SCHEMA,
        status: 'failed',
        stage: options.stage,
        child_exit_code: options.exitCode,
        error_code: options.errorCode,
      },
      null,
      2,
    )}\n`,
  );
}

function parseSingleReceiptLine(stdout: string): AuthIdentityReceipt {
  if (Buffer.byteLength(stdout, 'utf8') > MAX_CHILD_OUTPUT_BYTES) {
    return fail(
      'The production identity case CLI output exceeded its bounded limit.',
      'AUTH_IDENTITY_CASE_STDOUT_INVALID',
    );
  }
  const lines = stdout.split(/\r?\n/u);
  if (lines.at(-1) === '') {
    lines.pop();
  }
  if (lines.length !== 1 || !lines[0]) {
    return fail(
      'The production identity case CLI must emit exactly one compact JSON line.',
      'AUTH_IDENTITY_CASE_STDOUT_INVALID',
    );
  }
  try {
    return parseAuthIdentityReceipt(JSON.parse(lines[0]));
  } catch {
    return fail(
      'The production identity case CLI did not emit a valid identity receipt.',
      'AUTH_IDENTITY_CASE_RECEIPT_INVALID',
    );
  }
}

export async function runProductionIdentityCase(
  rawOptions: ProductionIdentityCaseOptions,
  deps: RunProductionIdentityCaseDeps = {},
): Promise<ProductionIdentityCaseManifest> {
  const options = normalizeCaseOptions(rawOptions);
  const runtimeEvidence = validateRuntimeEvidence(
    (deps.prepareRuntimeSnapshot ?? prepareRuntimeSnapshot)(),
  );
  try {
    const caseEnv = readCaseEnv(options.envFile);
    const observedProjectRef = projectRefFromApiBaseUrl(caseEnv.TIANGONG_LCA_API_BASE_URL);
    if (observedProjectRef !== options.expectedProjectRef) {
      return fail(
        'The production-case API project does not match --expected-project-ref.',
        'AUTH_IDENTITY_CASE_PROJECT_MISMATCH',
        2,
      );
    }

    try {
      mkdirSync(options.outDir, { recursive: false, mode: 0o700 });
    } catch {
      return fail(
        'The production identity case could not create its output directory exclusively.',
        'AUTH_IDENTITY_CASE_OUTPUT_CREATE_FAILED',
        2,
      );
    }
    if (process.platform !== 'win32') {
      chmodSync(options.outDir, 0o700);
    }
    if (existsSync(path.join(options.outDir, '.env'))) {
      return fail(
        'The production identity case working directory must not contain .env.',
        'AUTH_IDENTITY_CASE_CWD_UNSAFE',
        2,
      );
    }

    const cliArgv = [
      'auth',
      'identity-receipt',
      '--expected-project-ref',
      options.expectedProjectRef,
      '--expected-user-id',
      options.expectedUserId,
      '--json',
    ];
    const args = [runtimeEvidence.entrypoint, ...cliArgv];
    const spawnOptions: ProductionIdentityCaseSpawn['options'] = {
      cwd: options.outDir,
      env: buildChildEnv(deps.processEnv ?? process.env, caseEnv),
      shell: false,
      encoding: 'utf8',
      maxBuffer: MAX_CHILD_OUTPUT_BYTES,
      windowsHide: true,
    };
    let child: ProductionIdentityCaseSpawnResult;
    try {
      child = (
        deps.spawnImpl ??
        ((command, childArgs, childOptions) => spawnSync(command, childArgs, childOptions))
      )(process.execPath, args, spawnOptions);
    } catch {
      writeFailure(options.outDir, {
        stage: 'spawn',
        exitCode: null,
        errorCode: 'AUTH_IDENTITY_CASE_CHILD_SPAWN_FAILED',
      });
      return fail(
        'The production identity case CLI could not be started.',
        'AUTH_IDENTITY_CASE_CHILD_SPAWN_FAILED',
      );
    }

    if (child.status !== 0 || child.signal !== null || child.stderr !== '') {
      const errorCode = safeChildErrorCode(child.stderr);
      writeFailure(options.outDir, {
        stage: 'cli',
        exitCode: child.status,
        errorCode,
      });
      return fail('The production identity case CLI failed.', 'AUTH_IDENTITY_CASE_CHILD_FAILED');
    }

    let receipt: AuthIdentityReceipt;
    try {
      receipt = parseSingleReceiptLine(child.stdout);
    } catch (error) {
      writeFailure(options.outDir, {
        stage: 'receipt',
        exitCode: child.status,
        errorCode: error instanceof CliError ? error.code : 'AUTH_IDENTITY_CASE_RECEIPT_INVALID',
      });
      throw error;
    }
    if (
      receipt.project.project_ref !== options.expectedProjectRef ||
      receipt.identity.user_id !== options.expectedUserId ||
      receipt.assertions.mode !== 'intent-bound' ||
      receipt.assertions.requested_count !== 2 ||
      receipt.assertions.expected_project_ref !== options.expectedProjectRef ||
      receipt.assertions.expected_user_id !== options.expectedUserId ||
      receipt.assertions.passed !== true
    ) {
      writeFailure(options.outDir, {
        stage: 'intent-binding',
        exitCode: child.status,
        errorCode: 'AUTH_IDENTITY_CASE_INTENT_MISMATCH',
      });
      return fail(
        'The production identity receipt did not match the exact argv intent.',
        'AUTH_IDENTITY_CASE_INTENT_MISMATCH',
      );
    }

    const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
    const receiptFileSha256 = sha256Text(receiptText);
    const manifest: ProductionIdentityCaseManifest = {
      schema: CASE_SCHEMA,
      status: 'passed',
      executed_at_utc: (deps.now ?? (() => new Date()))().toISOString(),
      cli: receipt.cli,
      cli_argv: cliArgv,
      cli_argv_sha256: sha256Text(JSON.stringify(cliArgv)),
      runtime_entrypoint_sha256: runtimeEvidence.entrypointSha256,
      source_tree_sha256: runtimeEvidence.sourceTreeSha256,
      runtime_tree_sha256: runtimeEvidence.runtimeTreeSha256,
      runner_sha256: runtimeEvidence.runnerSha256,
      pnpm_lock_sha256: runtimeEvidence.pnpmLockSha256,
      project_ref: receipt.project.project_ref,
      user_id: receipt.identity.user_id,
      receipt_scope_sha256: receipt.receipt_scope_sha256,
      receipt_file_sha256: receiptFileSha256,
    };
    writePrivateFile(path.join(options.outDir, 'identity-receipt.json'), receiptText);
    writePrivateFile(
      path.join(options.outDir, 'case-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    return manifest;
  } finally {
    runtimeEvidence.cleanup();
  }
}

function renderHelp(): string {
  return `Usage:
  pnpm case:auth-identity:production -- --env-file <foundry-ignored-.env> --expected-project-ref <project-ref> --expected-user-id <uuid> --out-dir <new-private-directory>

The runner reads only TIANGONG_LCA_API_BASE_URL, TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY,
and TIANGONG_LCA_TEST_API_KEY from the env file. The pnpm script first performs a clean build;
the plain-Node runner then hashes and privately snapshots those exact runtime bytes before reading the key.
`.trim();
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${renderHelp()}\n`);
    return 0;
  }
  try {
    const options = parseProductionCaseArgs(argv);
    const manifest = await runProductionIdentityCase(options);
    process.stdout.write(
      `${JSON.stringify({
        status: manifest.status,
        out_dir: options.outDir,
        receipt_scope_sha256: manifest.receipt_scope_sha256,
      })}\n`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(`${JSON.stringify(toErrorPayload(error))}\n`);
    return error instanceof CliError ? error.exitCode : 1;
  }
}

export function isDirectEntry(importMetaUrl: string, argv1: string | undefined): boolean {
  return Boolean(argv1) && importMetaUrl === pathToFileURL(path.resolve(argv1 as string)).href;
}

export const __testInternals = { prepareRuntimeSnapshot };

if (isDirectEntry(import.meta.url, process.argv[1])) {
  process.exitCode = await main();
}
