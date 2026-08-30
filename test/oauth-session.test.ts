import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CliError } from '../src/lib/errors.js';
import type { FetchLike, ResponseLike } from '../src/lib/http.js';
import type { SupabaseRestRuntime } from '../src/lib/supabase-client.js';
import {
  __testInternals,
  createSupabaseDataRuntime,
  inspectSupabaseAuthStatus,
  loginWithSupabaseOAuth,
  logoutSupabaseUserSession,
  resolveSupabaseUserSession,
} from '../src/lib/supabase-session.js';
import { loadDistModule } from './helpers/load-dist-module.js';

const CLIENT_ID = '123e4567-e89b-42d3-a456-426614174000';
const USER_ID = '223e4567-e89b-42d3-a456-426614174000';
const NOW = new Date('2026-08-31T00:00:00.000Z');

function runtime(overrides: Partial<SupabaseRestRuntime> = {}): SupabaseRestRuntime {
  return {
    apiBaseUrl: 'https://example.supabase.co/functions/v1',
    authMode: 'oauth',
    userApiKey: null,
    oauthClientId: CLIENT_ID,
    oauthRedirectUri: 'http://127.0.0.1:49191/oauth/callback',
    accessToken: null,
    publishableKey: 'sb-publishable-key',
    sessionFile: null,
    disableSessionCache: false,
    forceReauth: false,
    ...overrides,
  } as SupabaseRestRuntime;
}

function jsonResponse(body: unknown, status = 200): ResponseLike {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string) {
        if (name.toLowerCase() === 'content-type') return 'application/json';
        if (name.toLowerCase() === 'content-length') return String(Buffer.byteLength(text));
        return null;
      },
    },
    async text() {
      return text;
    },
  };
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

function expectCliCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof CliError && error.code === code;
}

test('auth status inspects only bound local metadata and never exposes credential state', async () => {
  __testInternals.SESSION_MEMORY_CACHE.clear();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-oauth-status-'));
  const sessionFile = path.join(dir, 'session.json');
  const oauthRuntime = runtime({ sessionFile });
  try {
    assert.deepEqual(inspectSupabaseAuthStatus({ runtime: oauthRuntime, now: NOW }), {
      schemaVersion: 'tiangong.cli-auth-status.v1',
      status: 'login-required',
      authMethod: 'oauth',
      sessionState: 'missing',
      sessionCache: 'private-file',
      expiresAt: null,
      grantedScopes: [],
      onlineVerified: false,
    });

    const identity = __testInternals.buildRuntimeIdentity(oauthRuntime);
    const fresh = __testInternals.buildCachedSessionRecord({
      runtime: identity,
      session: {
        access_token: 'status-access-secret',
        refresh_token: 'status-refresh-secret',
        expires_at: Math.floor(NOW.getTime() / 1_000) + 3_600,
        expires_in: 3_600,
      },
      userEmail: 'status-user@example.com',
      grantedScopes: ['profile', 'email'],
      now: NOW,
    });
    __testInternals.writeCachedSessionRecord(sessionFile, fresh);
    const ready = inspectSupabaseAuthStatus({ runtime: oauthRuntime, now: NOW });
    assert.deepEqual(ready, {
      schemaVersion: 'tiangong.cli-auth-status.v1',
      status: 'ready',
      authMethod: 'oauth',
      sessionState: 'fresh',
      sessionCache: 'private-file',
      expiresAt: Math.floor(NOW.getTime() / 1_000) + 3_600,
      grantedScopes: ['email', 'profile'],
      onlineVerified: false,
    });
    assert.doesNotMatch(
      JSON.stringify(ready),
      /status-access|status-refresh|status-user|session\.json/u,
    );

    __testInternals.memoizeRecord(identity, fresh);
    assert.equal(
      inspectSupabaseAuthStatus({ runtime: oauthRuntime, now: NOW }).sessionState,
      'fresh',
    );
    __testInternals.dropMemoizedRecord(identity);

    __testInternals.memoizeRecord(identity, { ...fresh, refresh_token: '' });
    assert.equal(
      inspectSupabaseAuthStatus({ runtime: oauthRuntime, now: NOW }).status,
      'login-required',
    );
    __testInternals.dropMemoizedRecord(identity);

    const stale = { ...fresh, expires_at: 1 };
    __testInternals.writeCachedSessionRecord(sessionFile, stale);
    assert.equal(
      inspectSupabaseAuthStatus({ runtime: oauthRuntime, now: NOW }).sessionState,
      'refresh-required',
    );

    const foreignRuntime = runtime({
      sessionFile,
      oauthClientId: '323e4567-e89b-42d3-a456-426614174000',
    });
    const foreignIdentity = __testInternals.buildRuntimeIdentity(foreignRuntime);
    const foreign = __testInternals.buildCachedSessionRecord({
      runtime: foreignIdentity,
      session: {
        access_token: 'foreign-access',
        refresh_token: 'foreign-refresh',
        expires_at: Math.floor(NOW.getTime() / 1_000) + 3_600,
        expires_in: 3_600,
      },
      userEmail: 'foreign@example.com',
      now: NOW,
    });
    __testInternals.writeCachedSessionRecord(sessionFile, foreign);
    assert.equal(
      inspectSupabaseAuthStatus({ runtime: oauthRuntime, now: NOW }).status,
      'login-required',
    );

    const disabledStatus = inspectSupabaseAuthStatus({
      runtime: runtime({ disableSessionCache: true }),
      now: NOW,
    });
    assert.equal(disabledStatus.status, 'login-required');
    assert.equal(disabledStatus.sessionCache, 'disabled');

    assert.equal(
      inspectSupabaseAuthStatus({
        runtime: runtime({
          authMode: 'access_token',
          oauthClientId: null,
          oauthRedirectUri: null,
          accessToken: 'headless-secret',
        }),
      }).sessionState,
      'memory-only',
    );
    const legacyRuntime = runtime({
      authMode: 'legacy_user_api_key',
      oauthClientId: null,
      oauthRedirectUri: null,
      userApiKey: 'legacy-secret',
    });
    assert.equal(
      inspectSupabaseAuthStatus({ runtime: legacyRuntime }).sessionCache,
      'private-file',
    );
    const legacyStatus = inspectSupabaseAuthStatus({
      runtime: runtime({
        authMode: 'legacy_user_api_key',
        oauthClientId: null,
        oauthRedirectUri: null,
        userApiKey: 'legacy-secret',
        disableSessionCache: true,
      }),
    });
    assert.equal(legacyStatus.sessionState, 'transition-only');
    assert.equal(legacyStatus.sessionCache, 'disabled');

    const dist = await loadDistModule<typeof import('../src/lib/supabase-session.js')>(
      'src/lib/supabase-session.js',
    );
    assert.equal(
      dist.inspectSupabaseAuthStatus({ runtime: legacyRuntime }).sessionCache,
      'private-file',
    );
    assert.equal(
      dist.inspectSupabaseAuthStatus({
        runtime: { ...legacyRuntime, disableSessionCache: true },
      }).sessionCache,
      'disabled',
    );
  } finally {
    __testInternals.SESSION_MEMORY_CACHE.clear();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('OAuth login runs real PKCE/loopback/token flow and persists a private rotating session', async () => {
  __testInternals.SESSION_MEMORY_CACHE.clear();
  __testInternals.ACCESS_TOKEN_MEMORY_CACHE.clear();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-oauth-session-'));
  const sessionFile = path.join(dir, 'state', 'session.json');
  const port = await freePort();
  const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
  const oauthRuntime = runtime({ sessionFile, oauthRedirectUri: redirectUri });
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith('/auth/v1/oauth/token')) {
      return jsonResponse({
        access_token:
          requests.filter((request) => request.url.endsWith('/oauth/token')).length === 1
            ? 'oauth-access-one'
            : 'oauth-access-two',
        refresh_token:
          requests.filter((request) => request.url.endsWith('/oauth/token')).length === 1
            ? 'oauth-refresh-one'
            : 'oauth-refresh-two',
        token_type: 'bearer',
        expires_in: 3600,
        scope: '',
      });
    }
    if (url.endsWith('/auth/v1/oauth/userinfo')) {
      return jsonResponse({ sub: USER_ID, email: 'oauth@example.com' });
    }
    throw new Error(`Unexpected OAuth request: ${url}`);
  };

  try {
    const receipt = await loginWithSupabaseOAuth({
      runtime: oauthRuntime,
      fetchImpl,
      requestTimeoutMs: 1000,
      loginTimeoutMs: 1000,
      now: NOW,
      openBrowserImpl: async (authorizationUrl) => {
        const authorize = new URL(authorizationUrl);
        assert.equal(authorize.searchParams.get('client_id'), CLIENT_ID);
        assert.equal(authorize.searchParams.get('redirect_uri'), redirectUri);
        assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
        const state = authorize.searchParams.get('state');
        assert.ok(state);
        const response = await fetch(`${redirectUri}?state=${state}&code=authorization-code`);
        assert.equal(response.status, 200);
      },
    });

    assert.deepEqual(receipt, {
      schemaVersion: 'tiangong.cli-oauth-login.v1',
      status: 'authenticated',
      authMethod: 'oauth',
      expiresAt: 1_788_138_000,
      grantedScopes: ['email', 'openid', 'profile'],
      sessionCache: 'private-file',
    });
    assert.equal(JSON.stringify(receipt).includes('oauth-access'), false);
    assert.equal(JSON.stringify(receipt).includes('oauth@example.com'), false);
    const stored = JSON.parse(readFileSync(sessionFile, 'utf8'));
    assert.equal(stored.schema_version, 2);
    assert.equal(stored.auth_method, 'oauth');
    assert.equal(stored.access_token, 'oauth-access-one');
    assert.equal(stored.refresh_token, 'oauth-refresh-one');
    assert.equal('user_api_key_fingerprint' in stored, false);
    if (process.platform !== 'win32') {
      assert.equal(statSync(sessionFile).mode & 0o777, 0o600);
      assert.equal(statSync(path.dirname(sessionFile)).mode & 0o777, 0o700);
    }

    const memory = await resolveSupabaseUserSession({
      runtime: oauthRuntime,
      fetchImpl,
      now: new Date('2026-08-31T00:00:01.000Z'),
    });
    assert.equal(memory.source, 'memory');
    assert.equal(memory.authMethod, 'oauth');
    assert.equal(memory.accessToken, 'oauth-access-one');

    const identity = __testInternals.buildRuntimeIdentity(oauthRuntime);
    __testInternals.dropMemoizedRecord(identity);
    const cache = await resolveSupabaseUserSession({
      runtime: oauthRuntime,
      fetchImpl,
      now: new Date('2026-08-31T00:00:02.000Z'),
    });
    assert.equal(cache.source, 'cache');

    const refreshed = await resolveSupabaseUserSession({
      runtime: oauthRuntime,
      fetchImpl,
      now: new Date('2026-08-31T00:00:03.000Z'),
      forceRefresh: true,
    });
    assert.equal(refreshed.source, 'refresh');
    assert.equal(refreshed.accessToken, 'oauth-access-two');
    assert.equal(refreshed.refreshToken, 'oauth-refresh-two');
    assert.equal(JSON.parse(readFileSync(sessionFile, 'utf8')).refresh_token, 'oauth-refresh-two');

    const logout = await logoutSupabaseUserSession({ runtime: oauthRuntime });
    assert.deepEqual(logout, {
      schemaVersion: 'tiangong.cli-oauth-logout.v1',
      status: 'logged-out',
      removed: true,
    });
    assert.equal(existsSync(sessionFile), false);
    assert.equal((await logoutSupabaseUserSession({ runtime: oauthRuntime })).removed, false);
  } finally {
    __testInternals.SESSION_MEMORY_CACHE.clear();
    __testInternals.ACCESS_TOKEN_MEMORY_CACHE.clear();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('OAuth login supports injected protocol adapters and records returned scopes', async () => {
  __testInternals.SESSION_MEMORY_CACHE.clear();
  __testInternals.ACCESS_TOKEN_MEMORY_CACHE.clear();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-oauth-injected-'));
  const sessionFile = path.join(dir, 'session.json');
  const oauthRuntime = runtime({ sessionFile });
  const calls: string[] = [];
  try {
    const receipt = await loginWithSupabaseOAuth({
      runtime: oauthRuntime,
      fetchImpl: async () => jsonResponse({}),
      createPkceValuesImpl: () => ({
        codeVerifier: 'v'.repeat(64),
        codeChallenge: 'c'.repeat(43),
        state: 's'.repeat(43),
      }),
      receiveCallbackImpl: async (options) => {
        calls.push('callback');
        await options.onListening();
        return 'code';
      },
      browserOptions: {
        platform: 'linux',
        spawnImpl: (_command, _args, _options) => {
          const listeners: Record<string, (...args: never[]) => void> = {};
          const child = {
            once(event: string, listener: (...args: never[]) => void) {
              listeners[event] = listener;
              if (event === 'spawn') queueMicrotask(() => listeners.spawn?.());
              return child;
            },
            unref() {
              calls.push('browser');
            },
          };
          return child as never;
        },
      },
      exchangeCodeImpl: async (options) => {
        calls.push(`exchange:${options.authorizationCode}:${options.codeVerifier.length}`);
        return {
          accessToken: 'access',
          refreshToken: 'refresh',
          expiresIn: 900,
          scope: ['email'],
        };
      },
      fetchUserInfoImpl: async () => {
        calls.push('userinfo');
        return { userId: USER_ID, email: 'user@example.com' };
      },
    });
    assert.deepEqual(calls, ['callback', 'browser', 'exchange:code:64', 'userinfo']);
    assert.deepEqual(receipt.grantedScopes, ['email']);
  } finally {
    __testInternals.SESSION_MEMORY_CACHE.clear();
    __testInternals.ACCESS_TOKEN_MEMORY_CACHE.clear();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('OAuth mode never falls back to password sign-in when login or refresh is unavailable', async () => {
  __testInternals.SESSION_MEMORY_CACHE.clear();
  __testInternals.ACCESS_TOKEN_MEMORY_CACHE.clear();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-oauth-required-'));
  const sessionFile = path.join(dir, 'session.json');
  try {
    const oauthRuntime = runtime({ sessionFile });
    await assert.rejects(
      () =>
        resolveSupabaseUserSession({
          runtime: oauthRuntime,
          fetchImpl: async () => {
            throw new Error('must not call password auth');
          },
        }),
      expectCliCode('SUPABASE_OAUTH_LOGIN_REQUIRED'),
    );

    const identity = __testInternals.buildRuntimeIdentity(oauthRuntime);
    const stale = __testInternals.buildCachedSessionRecord({
      runtime: identity,
      session: {
        access_token: 'stale-access',
        refresh_token: 'stale-refresh',
        expires_at: 1,
        expires_in: 1,
      },
      userEmail: 'user@example.com',
      grantedScopes: ['email'],
      now: NOW,
    });
    __testInternals.writeCachedSessionRecord(sessionFile, stale);
    await assert.rejects(
      () =>
        resolveSupabaseUserSession({
          runtime: oauthRuntime,
          fetchImpl: async (url) =>
            url.endsWith('/oauth/token')
              ? jsonResponse({ error: 'invalid_grant' }, 400)
              : jsonResponse({}),
          forceRefresh: true,
        }),
      expectCliCode('SUPABASE_OAUTH_LOGIN_REQUIRED'),
    );

    await assert.rejects(
      () =>
        loginWithSupabaseOAuth({
          runtime: runtime({ authMode: 'legacy_user_api_key' }),
          fetchImpl: async () => jsonResponse({}),
        }),
      expectCliCode('SUPABASE_OAUTH_RUNTIME_REQUIRED'),
    );
    await assert.rejects(
      () =>
        loginWithSupabaseOAuth({
          runtime: runtime({ disableSessionCache: true }),
          fetchImpl: async () => jsonResponse({}),
        }),
      expectCliCode('SUPABASE_OAUTH_SESSION_CACHE_REQUIRED'),
    );
  } finally {
    __testInternals.SESSION_MEMORY_CACHE.clear();
    __testInternals.ACCESS_TOKEN_MEMORY_CACHE.clear();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('explicit headless access tokens are verified online and never cached or refreshed', async () => {
  __testInternals.SESSION_MEMORY_CACHE.clear();
  __testInternals.ACCESS_TOKEN_MEMORY_CACHE.clear();
  const accessRuntime = runtime({
    authMode: 'access_token',
    oauthClientId: null,
    oauthRedirectUri: null,
    accessToken: 'explicit-access-token',
    sessionFile: '/tmp/must-not-be-used.json',
  });
  let userCalls = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    assert.equal(url, 'https://example.supabase.co/auth/v1/user');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer explicit-access-token');
    userCalls += 1;
    return jsonResponse({
      id: USER_ID,
      email: 'headless@example.com',
      role: 'authenticated',
      aud: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
    });
  };
  const session = await resolveSupabaseUserSession({ runtime: accessRuntime, fetchImpl });
  assert.deepEqual(session, {
    accessToken: 'explicit-access-token',
    refreshToken: '',
    expiresAt: null,
    userEmail: 'headless@example.com',
    projectBaseUrl: 'https://example.supabase.co',
    sessionFile: null,
    authMethod: 'access_token',
    source: 'access_token',
  });
  const dataRuntime = createSupabaseDataRuntime({ runtime: accessRuntime, fetchImpl });
  assert.equal(await dataRuntime.getAccessToken(), 'explicit-access-token');
  assert.equal(dataRuntime.refreshAccessToken, undefined);
  assert.equal(userCalls, 1);
  assert.equal((await logoutSupabaseUserSession({ runtime: accessRuntime })).removed, false);
  const identity = __testInternals.buildRuntimeIdentity(accessRuntime);
  assert.equal(
    await __testInternals.refreshWithRefreshToken({
      runtime: accessRuntime,
      runtimeIdentity: identity,
      refreshToken: 'unused',
      userEmail: 'headless@example.com',
      fetchImpl,
      timeoutMs: 100,
      now: NOW,
    }),
    null,
  );
  assert.equal(
    (
      await __testInternals.resolveAndPersistSession({
        runtime: accessRuntime,
        runtimeIdentity: identity,
        fetchImpl,
        timeoutMs: 100,
        now: NOW,
        forceRefresh: false,
      })
    ).source,
    'access_token',
  );

  __testInternals.ACCESS_TOKEN_MEMORY_CACHE.clear();
  await assert.rejects(
    () =>
      resolveSupabaseUserSession({
        runtime: accessRuntime,
        fetchImpl: async () => jsonResponse({ id: USER_ID, email: '', role: 'anon' }),
      }),
    expectCliCode('SUPABASE_ACCESS_TOKEN_INVALID'),
  );
  __testInternals.ACCESS_TOKEN_MEMORY_CACHE.clear();
  await assert.rejects(
    () =>
      resolveSupabaseUserSession({
        runtime: accessRuntime,
        fetchImpl: async () => jsonResponse({ message: 'invalid token' }, 401),
      }),
    expectCliCode('SUPABASE_ACCESS_TOKEN_INVALID'),
  );
});

test('logout preserves foreign client sessions and broad-permission cache files are ignored', async () => {
  __testInternals.SESSION_MEMORY_CACHE.clear();
  __testInternals.ACCESS_TOKEN_MEMORY_CACHE.clear();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-oauth-foreign-'));
  const sessionFile = path.join(dir, 'session.json');
  const current = runtime({ sessionFile });
  const foreign = runtime({
    sessionFile,
    oauthClientId: '323e4567-e89b-42d3-a456-426614174000',
  });
  try {
    const foreignIdentity = __testInternals.buildRuntimeIdentity(foreign);
    const record = __testInternals.buildCachedSessionRecord({
      runtime: foreignIdentity,
      session: {
        access_token: 'access',
        refresh_token: 'refresh',
        expires_at: 4_102_444_800,
        expires_in: 3600,
      },
      userEmail: 'user@example.com',
      now: NOW,
    });
    __testInternals.writeCachedSessionRecord(sessionFile, record);
    assert.equal((await logoutSupabaseUserSession({ runtime: current })).removed, false);
    assert.equal(existsSync(sessionFile), true);
    if (process.platform !== 'win32') {
      chmodSync(sessionFile, 0o644);
      assert.equal(__testInternals.readCachedSessionRecord(sessionFile), null);
    }
  } finally {
    __testInternals.SESSION_MEMORY_CACHE.clear();
    __testInternals.ACCESS_TOKEN_MEMORY_CACHE.clear();
    rmSync(dir, { recursive: true, force: true });
  }
});
