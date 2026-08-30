import assert from 'node:assert/strict';
import test from 'node:test';
import { executeCli, type CliDeps } from '../src/cli.js';
import type { RunAuthIdentityReceiptOptions } from '../src/lib/auth-identity-receipt.js';
import type { DotEnvLoadResult } from '../src/lib/dotenv.js';
import { CliError } from '../src/lib/errors.js';
import type { FetchLike } from '../src/lib/http.js';
import { buildSupabaseTestEnv } from './helpers/supabase-auth.js';

const dotEnvStatus: DotEnvLoadResult = {
  loaded: false,
  path: '/not-loaded/.env',
  count: 0,
};

function makeDeps(overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    env: buildSupabaseTestEnv({
      TIANGONG_LCA_API_BASE_URL: 'https://project-ref.supabase.co/functions/v1',
      TIANGONG_LCA_DISABLE_SESSION_CACHE: 'true',
    }),
    dotEnvStatus,
    fetchImpl: (async () => {
      throw new Error('unexpected network');
    }) as FetchLike,
    ...overrides,
  };
}

test('auth identity-receipt is an implemented, discoverable command', async () => {
  const mainHelp = await executeCli([], makeDeps());
  assert.match(mainHelp.stdout, /auth\s+login \| logout \| identity-receipt/u);
  assert.match(mainHelp.stdout, /auth\s+whoami \| doctor-auth/u);

  const namespaceHelp = await executeCli(['auth'], makeDeps());
  assert.equal(namespaceHelp.exitCode, 0);
  assert.match(namespaceHelp.stdout, /tiangong-lca auth <login\|logout\|identity-receipt>/u);

  const commandHelp = await executeCli(['auth', 'identity-receipt', '--help'], makeDeps());
  assert.equal(commandHelp.exitCode, 0);
  assert.match(commandHelp.stdout, /--expected-project-ref/u);
  assert.match(commandHelp.stdout, /--expected-user-id/u);
  assert.match(commandHelp.stdout, /read-only/u);
  assert.equal(commandHelp.stderr, '');

  const explicitNamespaceHelp = await executeCli(['auth', '--help'], makeDeps());
  assert.equal(explicitNamespaceHelp.exitCode, 0);
  for (const argv of [
    ['auth', '--json'],
    ['auth', '--unknown'],
    ['auth', '--help', '--unknown'],
  ]) {
    const invalid = await executeCli(argv, makeDeps());
    assert.equal(invalid.exitCode, 2, argv.join(' '));
    assert.equal(invalid.stdout, '', argv.join(' '));
    assert.match(invalid.stderr, /INVALID_ARGS/u, argv.join(' '));
  }
});

test('auth login and logout are discoverable and dispatch only safe runtime values', async () => {
  const loginCalls: Parameters<NonNullable<CliDeps['loginWithSupabaseOAuthImpl']>>[0][] = [];
  const logoutCalls: Parameters<NonNullable<CliDeps['logoutSupabaseUserSessionImpl']>>[0][] = [];
  const deps = makeDeps({
    env: buildSupabaseTestEnv({
      TIANGONG_LCA_API_BASE_URL: 'https://project-ref.supabase.co/functions/v1',
      TIANGONG_LCA_AUTH_MODE: 'oauth',
      TIANGONG_LCA_OAUTH_CLIENT_ID: '123e4567-e89b-42d3-a456-426614174000',
    }),
    loginWithSupabaseOAuthImpl: async (options) => {
      loginCalls.push(options);
      return {
        schemaVersion: 'tiangong.cli-oauth-login.v1',
        status: 'authenticated',
        authMethod: 'oauth',
        expiresAt: 4_102_444_800,
        grantedScopes: ['email', 'openid', 'profile'],
        sessionCache: 'private-file',
      };
    },
    logoutSupabaseUserSessionImpl: async (options) => {
      logoutCalls.push(options);
      return {
        schemaVersion: 'tiangong.cli-oauth-logout.v1',
        status: 'logged-out',
        removed: true,
      };
    },
  });

  const loginHelp = await executeCli(['auth', 'login', '--help'], deps);
  assert.match(loginHelp.stdout, /S256/u);
  assert.match(loginHelp.stdout, /never[\s\S]*username/u);
  const logoutHelp = await executeCli(['auth', 'logout', '--help'], deps);
  assert.match(logoutHelp.stdout, /Connected applications/u);

  const login = await executeCli(['auth', 'login', '--timeout-ms', '4321', '--json'], deps);
  assert.equal(login.exitCode, 0);
  assert.deepEqual(JSON.parse(login.stdout), {
    schemaVersion: 'tiangong.cli-oauth-login.v1',
    status: 'authenticated',
    authMethod: 'oauth',
    expiresAt: 4_102_444_800,
    grantedScopes: ['email', 'openid', 'profile'],
    sessionCache: 'private-file',
  });
  assert.equal(loginCalls[0]?.loginTimeoutMs, 4321);
  assert.equal(loginCalls[0]?.runtime.authMode, 'oauth');
  assert.equal(loginCalls[0]?.runtime.userApiKey, null);

  const logout = await executeCli(['auth', 'logout'], deps);
  assert.match(logout.stdout, /\n  "removed": true\n/u);
  assert.equal(logoutCalls.length, 1);
  assert.equal(logoutCalls[0]?.runtime.oauthClientId, '123e4567-e89b-42d3-a456-426614174000');
});

test('auth login/logout reject malformed argv before session work', async () => {
  let calls = 0;
  const deps = makeDeps({
    loginWithSupabaseOAuthImpl: async () => {
      calls += 1;
      throw new Error('unreachable');
    },
    logoutSupabaseUserSessionImpl: async () => {
      calls += 1;
      throw new Error('unreachable');
    },
  });
  for (const args of [
    ['auth', 'login', '--timeout-ms', '0'],
    ['auth', 'login', '--timeout-ms', '1.5'],
    ['auth', 'login', '--timeout-ms', '300001'],
    ['auth', 'login', '--timeout-ms', '1', '--timeout-ms', '2'],
    ['auth', 'login', '--unknown'],
    ['auth', 'logout', '--unknown'],
  ]) {
    const result = await executeCli(args, deps);
    assert.equal(result.exitCode, 2, args.join(' '));
    assert.equal(result.stdout, '', args.join(' '));
  }
  assert.equal(calls, 0);
});

test('auth login uses its default timeout and propagates structured session errors', async () => {
  let timeout: number | undefined;
  const result = await executeCli(
    ['auth', 'login'],
    makeDeps({
      env: buildSupabaseTestEnv({
        TIANGONG_LCA_AUTH_MODE: 'oauth',
        TIANGONG_LCA_OAUTH_CLIENT_ID: '123e4567-e89b-42d3-a456-426614174000',
      }),
      loginWithSupabaseOAuthImpl: async (options) => {
        timeout = options.loginTimeoutMs;
        throw new CliError('login required', {
          code: 'SUPABASE_OAUTH_LOGIN_REQUIRED',
          exitCode: 1,
        });
      },
    }),
  );
  assert.equal(timeout, 180_000);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /SUPABASE_OAUTH_LOGIN_REQUIRED/u);
});

test('auth identity-receipt dispatches authoritative argv expectations and renders JSON', async () => {
  const captured: RunAuthIdentityReceiptOptions[] = [];
  const deps = makeDeps({
    runAuthIdentityReceiptImpl: async (options) => {
      captured.push(options);
      return {
        schema: 'tiangong-lca.auth-identity-receipt.v1',
        status: 'passed',
        receipt_scope_sha256: 'a'.repeat(64),
      } as never;
    },
  });
  const result = await executeCli(
    [
      'auth',
      'identity-receipt',
      '--expected-project-ref',
      'project-ref',
      '--expected-user-id',
      '11111111-1111-4111-8111-111111111111',
      '--timeout-ms',
      '1234',
      '--json',
    ],
    deps,
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {
    schema: 'tiangong-lca.auth-identity-receipt.v1',
    status: 'passed',
    receipt_scope_sha256: 'a'.repeat(64),
  });
  assert.equal(captured.length, 1);
  const options = captured[0] as RunAuthIdentityReceiptOptions;
  assert.equal(options.expectedProjectRef, 'project-ref');
  assert.equal(options.expectedUserId, '11111111-1111-4111-8111-111111111111');
  assert.equal(options.timeoutMs, 1234);
  assert.equal(options.env, deps.env);
  assert.equal(options.fetchImpl, deps.fetchImpl);
  assert.match(options.cliVersion, /^\d+\.\d+\.\d+/u);
});

test('auth identity-receipt pretty-prints by default and keeps legacy auth placeholders explicit', async () => {
  const result = await executeCli(
    ['auth', 'identity-receipt'],
    makeDeps({
      runAuthIdentityReceiptImpl: async () => ({ status: 'passed' }) as never,
    }),
  );
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /\n  "status": "passed"\n/u);

  const legacy = await executeCli(['auth', 'whoami'], makeDeps());
  assert.equal(legacy.exitCode, 2);
  assert.match(legacy.stderr, /not implemented yet/u);
});

test('auth identity-receipt rejects malformed argv before network or command execution', async () => {
  let calls = 0;
  const deps = makeDeps({
    runAuthIdentityReceiptImpl: async () => {
      calls += 1;
      return { status: 'passed' } as never;
    },
  });
  const cases = [
    ['--timeout-ms', '0'],
    ['--timeout-ms', 'abc'],
    ['--timeout-ms', '2147483648'],
    ['--expected-project-ref'],
    ['--unknown'],
    ['--expected-project-ref', 'one', '--expected-project-ref', 'two'],
    ['--expected-user-id', 'one', '--expected-user-id', 'two'],
    ['--timeout-ms', '1', '--timeout-ms', '2'],
  ];

  for (const args of cases) {
    const result = await executeCli(['auth', 'identity-receipt', ...args], deps);
    assert.equal(result.exitCode, 2, args.join(' '));
    assert.equal(result.stdout, '', args.join(' '));
    assert.match(result.stderr, /"error"/u, args.join(' '));
  }
  assert.equal(calls, 0);
});

test('auth identity-receipt propagates fail-closed structured errors without stdout receipts', async () => {
  const result = await executeCli(
    ['auth', 'identity-receipt', '--json'],
    makeDeps({
      runAuthIdentityReceiptImpl: async () => {
        throw new CliError('identity mismatch', {
          code: 'AUTH_IDENTITY_USER_MISMATCH',
          exitCode: 1,
        });
      },
    }),
  );
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /AUTH_IDENTITY_USER_MISMATCH/u);
});
