import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  __testInternals as productionCaseInternals,
  parseProductionCaseArgs,
  runProductionIdentityCase,
  type ProductionIdentityCaseSpawn,
} from '../scripts/run-auth-identity-production-case.js';
import {
  parseAuthIdentityReceipt,
  runAuthIdentityReceipt,
} from '../src/lib/auth-identity-receipt.js';
import type { ResponseLike } from '../src/lib/http.js';
import { buildSupabaseTestEnv } from './helpers/supabase-auth.js';

const PROJECT_REF = 'project-ref';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const TEST_API_KEY_PASSWORD = 'production-case-api-key-password';
const PUBLISHABLE_KEY = 'production-case-publishable-key';

function response(body: unknown): ResponseLike {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(body),
  };
}

async function receiptJson(): Promise<string> {
  const receipt = await runAuthIdentityReceipt({
    env: buildSupabaseTestEnv({
      TIANGONG_LCA_API_BASE_URL: `https://${PROJECT_REF}.supabase.co/functions/v1`,
      TIANGONG_LCA_API_KEY: TEST_API_KEY_PASSWORD,
      TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
      TIANGONG_LCA_DISABLE_SESSION_CACHE: 'true',
      TIANGONG_LCA_FORCE_REAUTH: 'true',
    }),
    fetchImpl: async () => response({ id: USER_ID, email: 'user@example.com' }),
    cliVersion: '0.1.1-test',
    expectedProjectRef: PROJECT_REF,
    expectedUserId: USER_ID,
    now: new Date('2026-08-25T12:34:56.000Z'),
    resolveSessionImpl: async () => ({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: 4_102_444_800,
      userEmail: 'user@example.com',
      projectBaseUrl: `https://${PROJECT_REF}.supabase.co`,
      sessionFile: null,
      authMethod: 'legacy_user_api_key',
      source: 'legacy_signin',
    }),
  });
  return `${JSON.stringify(receipt)}\n`;
}

function envFileText(): string {
  const apiKey = buildSupabaseTestEnv({
    TIANGONG_LCA_API_KEY: TEST_API_KEY_PASSWORD,
  }).TIANGONG_LCA_API_KEY as string;
  return [
    `TIANGONG_LCA_API_BASE_URL=https://${PROJECT_REF}.supabase.co/functions/v1`,
    `TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY=${PUBLISHABLE_KEY}`,
    `TIANGONG_LCA_TEST_API_KEY=${apiKey}`,
    'UNRELATED_PRIVATE_SECRET=must-never-reach-child',
    '',
  ].join('\n');
}

test('production identity case parser requires explicit intent-bound argv', () => {
  const parsed = parseProductionCaseArgs([
    '--',
    '--env-file',
    '/private/foundry/.env',
    '--expected-project-ref',
    PROJECT_REF,
    '--expected-user-id',
    USER_ID,
    '--out-dir',
    '/private/cases/identity',
  ]);
  assert.deepEqual(parsed, {
    envFile: path.resolve('/private/foundry/.env'),
    expectedProjectRef: PROJECT_REF,
    expectedUserId: USER_ID,
    outDir: path.resolve('/private/cases/identity'),
  });

  const invalidArgv = [
    [],
    ['--env-file', '/x', '--expected-project-ref', PROJECT_REF, '--expected-user-id', USER_ID],
    [
      '--env-file',
      '/x',
      '--expected-project-ref',
      PROJECT_REF,
      '--expected-user-id',
      USER_ID,
      '--out-dir',
      '/y',
      '--expected-user-id',
      'duplicate',
    ],
    ['--api-key', 'argv-secret'],
    ['--cli-bin', '/untrusted/cli.js'],
  ];
  for (const argv of invalidArgv) {
    assert.throws(() => parseProductionCaseArgs(argv), /production identity case|Unknown option/u);
  }
});

test('production identity case default runtime snapshot is build-backed and cleaned before env failure', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-auth-runtime-smoke-'));
  const cacheRoot = path.join(
    realpathSync(process.cwd()),
    'node_modules',
    '.cache',
    'tiangong-lca-auth-case',
  );
  const before = existsSync(cacheRoot) ? readdirSync(cacheRoot).sort() : [];
  try {
    await assert.rejects(
      runProductionIdentityCase({
        envFile: path.join(root, 'missing.env'),
        expectedProjectRef: PROJECT_REF,
        expectedUserId: USER_ID,
        outDir: path.join(root, 'case-output'),
      }),
      /could not parse its env file/u,
    );
    const after = existsSync(cacheRoot) ? readdirSync(cacheRoot).sort() : [];
    assert.deepEqual(after, before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('production identity case default built snapshot executes auth help without env or network', () => {
  const runtime = productionCaseInternals.prepareRuntimeSnapshot();
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'tg-auth-runtime-entry-'));
  const snapshotRoot = path.resolve(path.dirname(runtime.entrypoint), '../..');
  try {
    const env: NodeJS.ProcessEnv = {};
    for (const key of [
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
    ]) {
      if (typeof process.env[key] === 'string') env[key] = process.env[key];
    }
    const child = spawnSync(
      process.execPath,
      [runtime.entrypoint, 'auth', 'identity-receipt', '--help'],
      {
        cwd,
        env,
        shell: false,
        encoding: 'utf8',
        maxBuffer: 262_144,
        windowsHide: true,
      },
    );
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.signal, null);
    assert.equal(child.stderr, '');
    assert.match(child.stdout, /tiangong-lca\.auth-identity-receipt\.v1/u);
    assert.match(runtime.entrypointSha256, /^[0-9a-f]{64}$/u);
    assert.match(runtime.sourceTreeSha256, /^[0-9a-f]{64}$/u);
    assert.match(runtime.runtimeTreeSha256, /^[0-9a-f]{64}$/u);
    assert.match(runtime.runnerSha256, /^[0-9a-f]{64}$/u);
    assert.match(runtime.pnpmLockSha256, /^[0-9a-f]{64}$/u);
  } finally {
    runtime.cleanup();
    rmSync(cwd, { recursive: true, force: true });
  }
  assert.equal(existsSync(snapshotRoot), false);
});

test('production identity case runs with a narrow child env and persists only validated evidence', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-auth-production-case-'));
  const envFile = path.join(root, 'foundry.env');
  const outDir = path.join(root, 'case-output');
  const cliBin = path.join(root, 'trusted-cli', 'tiangong-lca.js');
  writeFileSync(envFile, envFileText(), 'utf8');
  const receiptStdout = await receiptJson();
  const spawns: ProductionIdentityCaseSpawn[] = [];
  let runtimeCleanups = 0;

  try {
    const manifest = await runProductionIdentityCase(
      {
        envFile,
        expectedProjectRef: PROJECT_REF,
        expectedUserId: USER_ID,
        outDir,
      },
      {
        processEnv: {
          PATH: '/safe/bin',
          UNRELATED_AMBIENT_SECRET: 'must-never-reach-child',
        },
        now: () => new Date('2026-08-25T12:35:00.000Z'),
        prepareRuntimeSnapshot: () => ({
          entrypoint: path.resolve(cliBin),
          entrypointSha256: 'b'.repeat(64),
          sourceTreeSha256: 'c'.repeat(64),
          runtimeTreeSha256: 'd'.repeat(64),
          runnerSha256: 'e'.repeat(64),
          pnpmLockSha256: 'f'.repeat(64),
          cleanup: () => {
            runtimeCleanups += 1;
          },
        }),
        spawnImpl: (command, args, options) => {
          spawns.push({ command, args, options });
          return {
            status: 0,
            signal: null,
            stdout: receiptStdout,
            stderr: '',
            pid: 123,
            output: [null, receiptStdout, ''],
          };
        },
      },
    );

    assert.equal(spawns.length, 1);
    const spawn = spawns[0] as ProductionIdentityCaseSpawn;
    assert.equal(spawn.command, process.execPath);
    assert.deepEqual(spawn.args, [
      path.resolve(cliBin),
      'auth',
      'identity-receipt',
      '--expected-project-ref',
      PROJECT_REF,
      '--expected-user-id',
      USER_ID,
      '--json',
    ]);
    assert.equal(spawn.options.shell, false);
    assert.equal(spawn.options.cwd, path.resolve(outDir));
    assert.equal(spawn.options.env.TIANGONG_LCA_DISABLE_SESSION_CACHE, 'true');
    assert.equal(spawn.options.env.TIANGONG_LCA_FORCE_REAUTH, 'true');
    assert.equal(
      spawn.options.env.TIANGONG_LCA_API_BASE_URL,
      `https://${PROJECT_REF}.supabase.co/functions/v1`,
    );
    assert.ok(spawn.options.env.TIANGONG_LCA_API_KEY);
    assert.equal(spawn.options.env.TIANGONG_LCA_TEST_API_KEY, undefined);
    assert.equal(spawn.options.env.UNRELATED_PRIVATE_SECRET, undefined);
    assert.equal(spawn.options.env.UNRELATED_AMBIENT_SECRET, undefined);
    assert.equal(spawn.options.env.TIANGONG_LCA_SESSION_FILE, undefined);

    assert.equal(manifest.status, 'passed');
    assert.equal(manifest.runtime_entrypoint_sha256, 'b'.repeat(64));
    assert.equal(manifest.source_tree_sha256, 'c'.repeat(64));
    assert.equal(manifest.runtime_tree_sha256, 'd'.repeat(64));
    assert.equal(manifest.runner_sha256, 'e'.repeat(64));
    assert.equal(manifest.pnpm_lock_sha256, 'f'.repeat(64));
    assert.equal(runtimeCleanups, 1);
    assert.equal(
      manifest.receipt_scope_sha256,
      parseAuthIdentityReceipt(JSON.parse(receiptStdout)).receipt_scope_sha256,
    );
    assert.deepEqual(manifest.cli_argv, spawn.args.slice(1));
    const storedReceiptText = readFileSync(path.join(outDir, 'identity-receipt.json'), 'utf8');
    assert.deepEqual(
      parseAuthIdentityReceipt(JSON.parse(storedReceiptText)),
      JSON.parse(receiptStdout),
    );
    const storedManifest = JSON.parse(
      readFileSync(path.join(outDir, 'case-manifest.json'), 'utf8'),
    ) as typeof manifest;
    assert.deepEqual(storedManifest, manifest);
    if (process.platform !== 'win32') {
      assert.equal(statSync(outDir).mode & 0o777, 0o700);
      assert.equal(statSync(path.join(outDir, 'identity-receipt.json')).mode & 0o777, 0o600);
      assert.equal(statSync(path.join(outDir, 'case-manifest.json')).mode & 0o777, 0o600);
    }
    const serialized = `${storedReceiptText}${JSON.stringify(storedManifest)}`;
    assert.doesNotMatch(serialized, /must-never-reach-child/u);
    assert.doesNotMatch(serialized, new RegExp(TEST_API_KEY_PASSWORD, 'u'));
    assert.doesNotMatch(serialized, /access-token|refresh-token/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('production identity case rejects missing env and sanitizes child failures', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-auth-production-fail-'));
  const missingEnvFile = path.join(root, 'missing.env');
  const failingEnvFile = path.join(root, 'failing.env');
  const missingOut = path.join(root, 'missing-output');
  const failingOut = path.join(root, 'failing-output');
  writeFileSync(missingEnvFile, 'TIANGONG_LCA_TEST_API_KEY=only-one-value\n', 'utf8');
  writeFileSync(failingEnvFile, envFileText(), 'utf8');
  let spawns = 0;
  try {
    await assert.rejects(
      runProductionIdentityCase(
        {
          envFile: missingEnvFile,
          expectedProjectRef: PROJECT_REF,
          expectedUserId: USER_ID,
          outDir: missingOut,
        },
        {
          prepareRuntimeSnapshot: () => ({
            entrypoint: '/trusted/dist/src/main.js',
            entrypointSha256: 'b'.repeat(64),
            sourceTreeSha256: 'c'.repeat(64),
            runtimeTreeSha256: 'd'.repeat(64),
            runnerSha256: 'e'.repeat(64),
            pnpmLockSha256: 'f'.repeat(64),
            cleanup: () => undefined,
          }),
          spawnImpl: () => {
            spawns += 1;
            throw new Error('must not spawn');
          },
        },
      ),
      /required production-case env/u,
    );
    assert.equal(spawns, 0);

    await assert.rejects(
      runProductionIdentityCase(
        {
          envFile: failingEnvFile,
          expectedProjectRef: PROJECT_REF,
          expectedUserId: USER_ID,
          outDir: failingOut,
        },
        {
          prepareRuntimeSnapshot: () => ({
            entrypoint: '/trusted/dist/src/main.js',
            entrypointSha256: 'b'.repeat(64),
            sourceTreeSha256: 'c'.repeat(64),
            runtimeTreeSha256: 'd'.repeat(64),
            runnerSha256: 'e'.repeat(64),
            pnpmLockSha256: 'f'.repeat(64),
            cleanup: () => undefined,
          }),
          spawnImpl: () => {
            spawns += 1;
            return {
              status: 1,
              signal: null,
              stdout: '',
              stderr: JSON.stringify({
                error: {
                  code: 'AUTH_IDENTITY_SESSION_FAILED',
                  message: `secret ${TEST_API_KEY_PASSWORD}`,
                },
              }),
              pid: 123,
              output: [null, '', ''],
            };
          },
        },
      ),
      /production identity case CLI failed/u,
    );
    assert.equal(spawns, 1);
    const failure = readFileSync(path.join(failingOut, 'case-failure.json'), 'utf8');
    assert.match(failure, /AUTH_IDENTITY_SESSION_FAILED/u);
    assert.doesNotMatch(failure, new RegExp(TEST_API_KEY_PASSWORD, 'u'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('production identity case rejects ambiguous stdout and existing output directories', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-auth-production-output-'));
  const envFile = path.join(root, 'foundry.env');
  const outDir = path.join(root, 'output');
  writeFileSync(envFile, envFileText(), 'utf8');
  const stdout = await receiptJson();
  try {
    await assert.rejects(
      runProductionIdentityCase(
        {
          envFile,
          expectedProjectRef: PROJECT_REF,
          expectedUserId: USER_ID,
          outDir,
        },
        {
          prepareRuntimeSnapshot: () => ({
            entrypoint: '/trusted/dist/src/main.js',
            entrypointSha256: 'b'.repeat(64),
            sourceTreeSha256: 'c'.repeat(64),
            runtimeTreeSha256: 'd'.repeat(64),
            runnerSha256: 'e'.repeat(64),
            pnpmLockSha256: 'f'.repeat(64),
            cleanup: () => undefined,
          }),
          spawnImpl: () => ({
            status: 0,
            signal: null,
            stdout: `${stdout}{"extra":true}\n`,
            stderr: '',
            pid: 123,
            output: [null, stdout, ''],
          }),
        },
      ),
      /exactly one compact JSON line/u,
    );
    assert.throws(
      () =>
        parseProductionCaseArgs([
          '--env-file',
          envFile,
          '--expected-project-ref',
          PROJECT_REF,
          '--expected-user-id',
          USER_ID,
          '--out-dir',
          outDir,
        ]),
      /output directory must not already exist/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('production identity case publishes no passed artifacts when runtime cleanup fails', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-auth-production-cleanup-'));
  const envFile = path.join(root, 'foundry.env');
  const outDir = path.join(root, 'output');
  writeFileSync(envFile, envFileText(), 'utf8');
  const stdout = await receiptJson();
  try {
    await assert.rejects(
      runProductionIdentityCase(
        {
          envFile,
          expectedProjectRef: PROJECT_REF,
          expectedUserId: USER_ID,
          outDir,
        },
        {
          prepareRuntimeSnapshot: () => ({
            entrypoint: '/trusted/dist/src/main.js',
            entrypointSha256: 'b'.repeat(64),
            sourceTreeSha256: 'c'.repeat(64),
            runtimeTreeSha256: 'd'.repeat(64),
            runnerSha256: 'e'.repeat(64),
            pnpmLockSha256: 'f'.repeat(64),
            cleanup: () => {
              throw new Error('simulated cleanup failure');
            },
          }),
          spawnImpl: () => ({
            status: 0,
            signal: null,
            stdout,
            stderr: '',
          }),
        },
      ),
      /clean up its private runtime snapshot/u,
    );
    assert.equal(existsSync(path.join(outDir, 'identity-receipt.json')), false);
    assert.equal(existsSync(path.join(outDir, 'case-manifest.json')), false);
    const failure = readFileSync(path.join(outDir, 'case-failure.json'), 'utf8');
    assert.match(failure, /AUTH_IDENTITY_CASE_RUNTIME_CLEANUP_FAILED/u);
    assert.doesNotMatch(failure, /simulated cleanup failure/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
