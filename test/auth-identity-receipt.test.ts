import assert from 'node:assert/strict';
import test from 'node:test';
import type { ResponseLike } from '../src/lib/http.js';
import {
  AUTH_IDENTITY_RECEIPT_SCHEMA,
  parseAuthIdentityReceipt,
  runAuthIdentityReceipt,
  type AuthIdentityReceipt,
} from '../src/lib/auth-identity-receipt.js';
import type { ResolvedSupabaseUserSession } from '../src/lib/supabase-session.js';
import { buildSupabaseTestEnv } from './helpers/supabase-auth.js';

const NOW = new Date('2026-08-25T12:34:56.000Z');
const USER_API_KEY_SECRET = 'identity-api-key-password';
const ACCESS_TOKEN_SECRET = 'identity-access-token';
const PUBLISHABLE_KEY_SECRET = 'identity-publishable-key';

function response(status: number, body: unknown, contentType = 'application/json'): ResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string): string | null {
        return name.toLowerCase() === 'content-type' ? contentType : null;
      },
    },
    async text(): Promise<string> {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

function runtimeEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return buildSupabaseTestEnv({
    TIANGONG_LCA_API_BASE_URL: 'https://project-ref.supabase.co/functions/v1',
    TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY_SECRET,
    TIANGONG_LCA_API_KEY: USER_API_KEY_SECRET,
    TIANGONG_LCA_DISABLE_SESSION_CACHE: 'true',
    ...overrides,
  });
}

function resolvedSession(
  overrides: Partial<ResolvedSupabaseUserSession> = {},
): ResolvedSupabaseUserSession {
  return {
    accessToken: ACCESS_TOKEN_SECRET,
    refreshToken: 'identity-refresh-token',
    expiresAt: 4_102_444_800,
    userEmail: 'user@example.com',
    projectBaseUrl: 'https://project-ref.supabase.co',
    sessionFile: null,
    source: 'signin',
    ...overrides,
  };
}

async function successfulReceipt(
  overrides: Partial<Parameters<typeof runAuthIdentityReceipt>[0]> = {},
): Promise<AuthIdentityReceipt> {
  return runAuthIdentityReceipt({
    env: runtimeEnv(),
    fetchImpl: async () =>
      response(200, {
        email: 'user@example.com',
        id: '11111111-1111-4111-8111-111111111111',
        ignored_unbounded_profile: { role: 'never-copied-to-receipt' },
      }),
    cliVersion: '0.1.1-test',
    expectedProjectRef: 'project-ref',
    expectedUserId: '11111111-1111-4111-8111-111111111111',
    timeoutMs: 5_000,
    now: NOW,
    resolveSessionImpl: async () => resolvedSession(),
    ...overrides,
  });
}

test('identity receipt binds a server-verified account/project without exposing credentials', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const receipt = await successfulReceipt({
    fetchImpl: async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return response(200, {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'USER@example.com',
        app_metadata: { provider: 'email' },
      });
    },
  });

  assert.equal(capturedUrl, 'https://project-ref.supabase.co/auth/v1/user');
  assert.equal(capturedInit?.method, 'GET');
  assert.equal(receipt.schema, AUTH_IDENTITY_RECEIPT_SCHEMA);
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.operation, 'current-user-read');
  assert.equal(receipt.remote_write_mode, 'read-only');
  assert.equal(receipt.captured_at_utc, NOW.toISOString());
  assert.deepEqual(receipt.cli, {
    package_name: '@tiangong-lca/cli',
    package_version: '0.1.1-test',
  });
  assert.deepEqual(receipt.project, {
    project_ref: 'project-ref',
    project_base_url: 'https://project-ref.supabase.co',
  });
  assert.equal(receipt.identity.user_id, '11111111-1111-4111-8111-111111111111');
  assert.equal(receipt.identity.display_email, 'us****@example.com');
  assert.deepEqual(receipt.session, {
    source: 'signin',
    cache_mode: 'disabled',
    force_reauth: false,
    expires_at_utc: '2100-01-01T00:00:00.000Z',
  });
  assert.match(receipt.bindings.request_sha256, /^[0-9a-f]{64}$/u);
  assert.match(receipt.bindings.response_sha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(receipt.assertions, {
    expected_project_ref: 'project-ref',
    expected_user_id: '11111111-1111-4111-8111-111111111111',
    project_ref_passed: true,
    user_id_passed: true,
    passed: true,
  });
  assert.match(receipt.receipt_scope_sha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(parseAuthIdentityReceipt(receipt), receipt);

  const serialized = JSON.stringify(receipt);
  assert.doesNotMatch(
    serialized,
    /user_api_key_fingerprint|publishable_key_fingerprint|email_fingerprint|session_file/u,
  );
  for (const secret of [
    USER_API_KEY_SECRET,
    ACCESS_TOKEN_SECRET,
    PUBLISHABLE_KEY_SECRET,
    'identity-refresh-token',
    'never-copied-to-receipt',
  ]) {
    assert.doesNotMatch(serialized, new RegExp(secret, 'u'));
  }
});

test('identity receipt canonicalization is deterministic and binds bounded request/response facts', async () => {
  const first = await successfulReceipt();
  const second = await successfulReceipt({
    fetchImpl: async () =>
      response(200, {
        ignored: ['different', 'unbounded', 'profile'],
        email: 'USER@EXAMPLE.COM',
        id: '11111111-1111-4111-8111-111111111111',
      }),
  });

  assert.deepEqual(second, first);

  const changedToken = await successfulReceipt({
    resolveSessionImpl: async () => resolvedSession({ accessToken: 'different-access-token' }),
  });
  assert.deepEqual(changedToken, first);
});

test('identity receipt records cache modes without exposing a session path', async () => {
  const custom = await successfulReceipt({
    env: runtimeEnv({
      TIANGONG_LCA_DISABLE_SESSION_CACHE: 'false',
      TIANGONG_LCA_SESSION_FILE: '/private/account/session.json',
    }),
    resolveSessionImpl: async () =>
      resolvedSession({
        source: 'cache',
        sessionFile: '/private/account/session.json',
      }),
  });
  assert.equal(custom.session.cache_mode, 'custom-file');
  assert.doesNotMatch(JSON.stringify(custom), /private\/account/u);

  const platformDefault = await successfulReceipt({
    env: runtimeEnv({
      TIANGONG_LCA_DISABLE_SESSION_CACHE: 'false',
      TIANGONG_LCA_SESSION_FILE: '',
      TIANGONG_LCA_FORCE_REAUTH: 'true',
    }),
    resolveSessionImpl: async () =>
      resolvedSession({
        source: 'refresh',
        sessionFile: '/platform/default/session.json',
        expiresAt: null,
      }),
  });
  assert.equal(platformDefault.session.cache_mode, 'platform-default');
  assert.equal(platformDefault.session.force_reauth, true);
  assert.equal(platformDefault.session.expires_at_utc, null);
});

test('identity receipt fails closed on expected project or user mismatch before returning a receipt', async () => {
  await assert.rejects(
    successfulReceipt({ expectedProjectRef: 'foreign-project' }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'AUTH_IDENTITY_PROJECT_MISMATCH',
  );
  await assert.rejects(
    successfulReceipt({ expectedUserId: '22222222-2222-4222-8222-222222222222' }),
    (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === 'AUTH_IDENTITY_USER_MISMATCH',
  );
});

test('identity receipt rejects stale or foreign cached identity bindings', async () => {
  await assert.rejects(
    successfulReceipt({
      resolveSessionImpl: async () => resolvedSession({ userEmail: 'foreign@example.com' }),
    }),
    (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === 'AUTH_IDENTITY_SESSION_MISMATCH',
  );
});

test('identity receipt rejects nonzero, malformed, ok:false, oversized, and incomplete responses', async () => {
  const cases: Array<[string, ResponseLike, string]> = [
    ['nonzero', response(503, { secret: USER_API_KEY_SECRET }), 'AUTH_IDENTITY_REMOTE_REQUEST_FAILED'],
    ['invalid-json', response(200, '{broken'), 'AUTH_IDENTITY_REMOTE_INVALID_JSON'],
    ['ok-false', response(200, { ok: false, token: ACCESS_TOKEN_SECRET }), 'AUTH_IDENTITY_REMOTE_REJECTED'],
    ['array', response(200, []), 'AUTH_IDENTITY_RESPONSE_INVALID'],
    ['missing-id', response(200, { email: 'user@example.com' }), 'AUTH_IDENTITY_RESPONSE_INVALID'],
    ['missing-email', response(200, { id: 'user-id' }), 'AUTH_IDENTITY_RESPONSE_INVALID'],
    [
      'oversized',
      response(200, JSON.stringify({ id: 'user-id', email: 'user@example.com', pad: 'x'.repeat(70_000) })),
      'AUTH_IDENTITY_RESPONSE_TOO_LARGE',
    ],
  ];

  for (const [name, currentUserResponse, code] of cases) {
    await assert.rejects(
      successfulReceipt({ fetchImpl: async () => currentUserResponse }),
      (error: unknown) => {
        assert.ok(error instanceof Error, name);
        assert.equal('code' in error ? error.code : null, code, name);
        assert.doesNotMatch(JSON.stringify(error), new RegExp(USER_API_KEY_SECRET, 'u'), name);
        assert.doesNotMatch(JSON.stringify(error), new RegExp(ACCESS_TOKEN_SECRET, 'u'), name);
        return true;
      },
    );
  }
});

test('identity receipt sanitizes transport and session-resolution failures', async () => {
  await assert.rejects(
    successfulReceipt({
      fetchImpl: async () => {
        throw new Error(`transport included ${USER_API_KEY_SECRET} and ${ACCESS_TOKEN_SECRET}`);
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal('code' in error ? error.code : null, 'AUTH_IDENTITY_REMOTE_REQUEST_FAILED');
      assert.doesNotMatch(JSON.stringify(error), new RegExp(USER_API_KEY_SECRET, 'u'));
      assert.doesNotMatch(JSON.stringify(error), new RegExp(ACCESS_TOKEN_SECRET, 'u'));
      return true;
    },
  );

  await assert.rejects(
    successfulReceipt({
      resolveSessionImpl: async () => {
        const error = new Error(`session included ${USER_API_KEY_SECRET}`) as Error & {
          code: string;
        };
        error.code = 'SIMULATED_SESSION_FAILURE';
        throw error;
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal('code' in error ? error.code : null, 'AUTH_IDENTITY_SESSION_FAILED');
      assert.match(JSON.stringify(error), /SIMULATED_SESSION_FAILURE/u);
      assert.doesNotMatch(JSON.stringify(error), new RegExp(USER_API_KEY_SECRET, 'u'));
      return true;
    },
  );
});

test('identity receipt validates runtime options and current-user email consistency', async () => {
  await assert.rejects(
    successfulReceipt({ timeoutMs: 0 }),
    (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === 'AUTH_IDENTITY_TIMEOUT_INVALID',
  );
  await assert.rejects(
    successfulReceipt({ expectedProjectRef: '   ' }),
    (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === 'AUTH_IDENTITY_EXPECTATION_INVALID',
  );
  await assert.rejects(
    successfulReceipt({ expectedUserId: '   ' }),
    (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === 'AUTH_IDENTITY_EXPECTATION_INVALID',
  );
  await assert.rejects(
    successfulReceipt({
      fetchImpl: async () => response(200, { id: 'user-id', email: 'other@example.com' }),
      expectedUserId: undefined,
    }),
    (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === 'AUTH_IDENTITY_SESSION_MISMATCH',
  );
});

test('identity receipt parser rejects schema drift and canonical hash tampering', async () => {
  const receipt = await successfulReceipt();
  const invalidValues: unknown[] = [
    null,
    { ...receipt, schema: 'old' },
    { ...receipt, status: 'failed' },
    { ...receipt, operation: 'write' },
    { ...receipt, remote_write_mode: 'read-write' },
    { ...receipt, captured_at_utc: 'not-a-timestamp' },
    { ...receipt, cli: { ...receipt.cli, package_name: '' } },
    { ...receipt, project: { ...receipt.project, project_ref: '' } },
    { ...receipt, identity: { ...receipt.identity, user_id: '' } },
    { ...receipt, session: { ...receipt.session, source: 'unknown' } },
    { ...receipt, bindings: { ...receipt.bindings, request_sha256: 'bad' } },
    { ...receipt, assertions: { ...receipt.assertions, passed: false } },
    { ...receipt, receipt_scope_sha256: '0'.repeat(64) },
  ];

  for (const value of invalidValues) {
    assert.throws(
      () => parseAuthIdentityReceipt(value),
      (error: unknown) =>
        error instanceof Error && 'code' in error && error.code === 'AUTH_IDENTITY_RECEIPT_INVALID',
    );
  }
});
