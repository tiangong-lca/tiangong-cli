import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CliError } from '../src/lib/errors.js';
import type { FetchLike, ResponseLike } from '../src/lib/http.js';
import { loadDistModule } from './helpers/load-dist-module.js';
import {
  __testInternals,
  createSupabaseDataRuntime,
  resolveSupabaseUserSession,
} from '../src/lib/supabase-session.js';
import type { SupabaseRestRuntime } from '../src/lib/supabase-client.js';
import { fingerprintSecret, fingerprintUserApiKey } from '../src/lib/user-api-key.js';
import { makeSupabaseAuthResponse } from './helpers/supabase-auth.js';

const require = createRequire(import.meta.url);
const mutableFs = require('node:fs') as typeof import('node:fs');
const mutableOs = require('node:os') as typeof import('node:os');

function clearSessionState(): void {
  __testInternals.SESSION_MEMORY_CACHE.clear();
  __testInternals.SESSION_OPERATION_CHAINS.clear();
}

function makeRuntime(overrides: Partial<SupabaseRestRuntime> = {}): SupabaseRestRuntime {
  return {
    apiBaseUrl: 'https://example.supabase.co/functions/v1',
    userApiKey: Buffer.from(
      JSON.stringify({
        email: 'user@example.com',
        password: 'secret-password',
      }),
      'utf8',
    ).toString('base64'),
    publishableKey: 'sb-publishable-key',
    sessionFile: null,
    disableSessionCache: false,
    forceReauth: false,
    ...overrides,
  };
}

function makeJsonResponse(
  body: unknown,
  options: {
    ok?: boolean;
    status?: number;
  } = {},
): ResponseLike {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: {
      get(name: string): string | null {
        return name.toLowerCase() === 'content-type' ? 'application/json' : null;
      },
    },
    async text(): Promise<string> {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

function makeSession(
  overrides: Parameters<typeof makeSupabaseAuthResponse>[0] = {},
): Record<string, unknown> {
  return {
    access_token: overrides.accessToken ?? 'access-token',
    refresh_token: overrides.refreshToken ?? 'refresh-token',
    token_type: 'bearer',
    expires_in: overrides.expiresIn ?? 3_600,
    expires_at: overrides.expiresAt ?? 4_102_444_800,
    user: {
      id: overrides.userId ?? 'user-1',
      aud: 'authenticated',
      role: 'authenticated',
      email: overrides.email ?? 'user@example.com',
    },
  };
}

function makeAuthFetch(plan: {
  passwordResponses?: ResponseLike[];
  refreshResponses?: ResponseLike[];
}): {
  fetchImpl: FetchLike;
  counts: { password: number; refresh: number };
} {
  const passwordResponses = [...(plan.passwordResponses ?? [makeSupabaseAuthResponse()])];
  const refreshResponses = [...(plan.refreshResponses ?? [makeSupabaseAuthResponse()])];
  const counts = { password: 0, refresh: 0 };

  return {
    counts,
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes('/auth/v1/token?grant_type=password')) {
        const response = passwordResponses[Math.min(counts.password, passwordResponses.length - 1)];
        counts.password += 1;
        return response as ResponseLike;
      }

      if (url.includes('/auth/v1/token?grant_type=refresh_token')) {
        const response = refreshResponses[Math.min(counts.refresh, refreshResponses.length - 1)];
        counts.refresh += 1;
        return response as ResponseLike;
      }

      throw new Error(`Unexpected auth fetch URL: ${url}`);
    },
  };
}

test('path resolution helpers cover xdg, home, platform fallbacks, and explicit overrides', () => {
  clearSessionState();

  assert.equal(
    __testInternals.resolveDefaultSessionFilePath({
      platform: 'linux',
      homeDir: '/Users/demo',
      xdgStateHome: '/tmp/xdg',
      localAppData: null,
    }),
    path.join('/tmp/xdg', 'tiangong-lca-cli', 'session.json'),
  );
  assert.equal(
    __testInternals.resolveDefaultSessionFilePath({
      platform: 'linux',
      homeDir: '/Users/demo',
      xdgStateHome: null,
      localAppData: null,
    }),
    path.join('/Users/demo', '.local', 'state', 'tiangong-lca-cli', 'session.json'),
  );
  assert.equal(
    __testInternals.resolveDefaultSessionFilePath({
      platform: 'darwin',
      homeDir: '',
      xdgStateHome: null,
      localAppData: null,
    }),
    path.join(os.homedir(), 'Library', 'Application Support', 'tiangong-lca-cli', 'session.json'),
  );
  assert.equal(
    __testInternals.resolveDefaultSessionFilePath({
      platform: 'win32',
      homeDir: '',
      xdgStateHome: null,
      localAppData: 'C:\\Users\\demo\\AppData\\Local',
    }),
    path.join('C:\\Users\\demo\\AppData\\Local', 'tiangong-lca-cli', 'session.json'),
  );
  assert.equal(
    __testInternals.resolveDefaultSessionFilePath({
      platform: 'linux',
      homeDir: '',
      xdgStateHome: null,
      localAppData: null,
    }),
    path.resolve('.tiangong-lca-session.json'),
  );

  const runtimeWithOverride = makeRuntime({
    sessionFile: './tmp/custom-session.json',
  });
  assert.equal(
    __testInternals.resolveSessionFilePath(runtimeWithOverride),
    path.resolve('./tmp/custom-session.json'),
  );
  assert.equal(
    __testInternals.resolveSessionFilePath(
      makeRuntime({
        disableSessionCache: true,
      }),
    ),
    null,
  );
});

test('resolveSessionFilePath falls back to cwd session file on Windows when env paths are unavailable', () => {
  clearSessionState();

  if (process.platform !== 'win32') {
    return;
  }

  const originalHomedir = mutableOs.homedir;
  const originalLocalAppData = process.env.LOCALAPPDATA;
  const originalXdgStateHome = process.env.XDG_STATE_HOME;

  try {
    mutableOs.homedir = (() => '') as typeof mutableOs.homedir;
    syncBuiltinESMExports();
    delete process.env.LOCALAPPDATA;
    delete process.env.XDG_STATE_HOME;

    assert.equal(
      __testInternals.resolveSessionFilePath(makeRuntime()),
      path.resolve('.tiangong-lca-session.json'),
    );
  } finally {
    mutableOs.homedir = originalHomedir;
    syncBuiltinESMExports();

    if (originalLocalAppData === undefined) {
      delete process.env.LOCALAPPDATA;
    } else {
      process.env.LOCALAPPDATA = originalLocalAppData;
    }

    if (originalXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = originalXdgStateHome;
    }
  }
});

test('session record helpers parse, persist, fingerprint, and clean up memoized state', async () => {
  clearSessionState();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-session-record-'));
  const sessionFile = path.join(dir, 'session.json');
  const runtime = makeRuntime({
    sessionFile,
  });
  const identity = __testInternals.buildRuntimeIdentity(runtime);
  const now = new Date('2026-04-06T00:00:00.000Z');
  const session = makeSession({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: 4_102_444_800,
  }) as never;

  try {
    assert.equal(
      __testInternals.computeExpiresAt(
        {
          access_token: 'token',
          refresh_token: 'refresh',
          expires_at: 1_700_000_000,
          expires_in: 600,
          token_type: 'bearer',
          user: { id: 'user-1', aud: 'authenticated' },
        } as never,
        now,
      ),
      1_700_000_000,
    );
    assert.equal(
      __testInternals.computeExpiresAt(
        {
          access_token: 'token',
          refresh_token: 'refresh',
          expires_in: 600,
          token_type: 'bearer',
          user: { id: 'user-1', aud: 'authenticated' },
        } as never,
        now,
      ),
      1_775_434_200,
    );
    assert.equal(
      __testInternals.computeExpiresAt(
        {
          access_token: 'token',
          refresh_token: 'refresh',
          token_type: 'bearer',
          user: { id: 'user-1', aud: 'authenticated' },
        } as never,
        now,
      ),
      null,
    );

    const record = __testInternals.buildCachedSessionRecord({
      runtime: identity,
      session,
      userEmail: 'user@example.com',
      now,
    });
    assert.equal(record.supabase_url, 'https://example.supabase.co');
    assert.equal(record.publishable_key_fingerprint, fingerprintSecret(runtime.publishableKey));
    assert.equal(record.user_api_key_fingerprint, fingerprintUserApiKey(runtime.userApiKey));
    assert.equal(__testInternals.isSessionFresh(record, now), true);
    assert.equal(
      __testInternals.isSessionFresh(
        {
          ...record,
          expires_at: 1_775_433_700,
        },
        now,
      ),
      false,
    );
    assert.equal(__testInternals.recordMatchesRuntime(record, identity), true);
    assert.equal(
      __testInternals.recordMatchesRuntime(
        {
          ...record,
          user_api_key_fingerprint: 'sha256:other',
        },
        identity,
      ),
      false,
    );

    __testInternals.writeCachedSessionRecord(sessionFile, record);
    chmodSync(sessionFile, 0o600);
    assert.deepEqual(__testInternals.readCachedSessionRecord(sessionFile), record);
    assert.deepEqual(
      __testInternals.parseCachedSessionRecord(JSON.parse(readFileSync(sessionFile, 'utf8'))),
      record,
    );
    assert.deepEqual(
      __testInternals.parseCachedSessionRecord({
        ...record,
        expires_at: null,
      }),
      {
        ...record,
        expires_at: null,
      },
    );
    writeFileSync(sessionFile, '\n', 'utf8');
    assert.equal(__testInternals.readCachedSessionRecord(sessionFile), null);
    writeFileSync(sessionFile, '{"broken"', 'utf8');
    assert.equal(__testInternals.readCachedSessionRecord(sessionFile), null);
    assert.equal(__testInternals.parseCachedSessionRecord(null), null);
    assert.equal(__testInternals.parseCachedSessionRecord({ schema_version: 2 }), null);
    assert.equal(
      __testInternals.parseCachedSessionRecord({
        schema_version: 1,
        supabase_url: 'https://example.supabase.co',
        publishable_key_fingerprint: 'sha256:publishable',
        user_api_key_fingerprint: 'sha256:user',
        user_email: 'user@example.com',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_at: 'bad-expiry',
        updated_at_utc: '2026-04-06T00:00:00.000Z',
      }),
      null,
    );
    assert.throws(
      () =>
        __testInternals.buildCachedSessionRecord({
          runtime: identity,
          session: {
            access_token: '',
            refresh_token: '',
          } as never,
          userEmail: 'user@example.com',
          now,
        }),
      /Supabase auth did not return a usable session/u,
    );

    __testInternals.memoizeRecord(identity, record);
    assert.deepEqual(__testInternals.getMemoizedRecord(identity), record);
    __testInternals.dropMemoizedRecord(identity);
    assert.equal(__testInternals.getMemoizedRecord(identity), null);
  } finally {
    clearSessionState();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeCachedSessionRecord removes temp files when the final rename fails', () => {
  clearSessionState();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-session-write-fail-'));
  const sessionFile = path.join(dir, 'session.json');
  const runtime = makeRuntime({ sessionFile });
  const identity = __testInternals.buildRuntimeIdentity(runtime);
  const record = __testInternals.buildCachedSessionRecord({
    runtime: identity,
    session: makeSession() as never,
    userEmail: 'user@example.com',
    now: new Date('2026-04-06T00:00:00.000Z'),
  });
  const originalRenameSync = mutableFs.renameSync;

  try {
    mutableFs.renameSync = (() => {
      throw new Error('rename failed');
    }) as typeof mutableFs.renameSync;
    syncBuiltinESMExports();

    assert.throws(
      () => __testInternals.writeCachedSessionRecord(sessionFile, record),
      /rename failed/u,
    );
    assert.equal(existsSync(sessionFile), false);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    mutableFs.renameSync = originalRenameSync;
    syncBuiltinESMExports();
    clearSessionState();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('withSessionOperationLock serializes same-key tasks and releases the queue', async () => {
  clearSessionState();
  const steps: string[] = [];
  let releaseFirst: () => void = () => {};
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = () => resolve();
  });

  const first = __testInternals.withSessionOperationLock('demo-key', async () => {
    steps.push('first:start');
    await firstGate;
    steps.push('first:end');
  });
  const second = __testInternals.withSessionOperationLock('demo-key', async () => {
    steps.push('second:start');
    steps.push('second:end');
  });

  await Promise.resolve();
  steps.push('between');
  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(steps, ['between', 'first:start', 'first:end', 'second:start', 'second:end']);
  assert.equal(__testInternals.SESSION_OPERATION_CHAINS.size, 0);
});

test('resolveSupabaseUserSession signs in once, then serves cache and memory hits', async () => {
  clearSessionState();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-session-resolve-'));
  const sessionFile = path.join(dir, 'session.json');
  const runtime = makeRuntime({ sessionFile });
  const { fetchImpl, counts } = makeAuthFetch({});

  try {
    const signedIn = await resolveSupabaseUserSession({
      runtime,
      fetchImpl,
      timeoutMs: 25,
      now: new Date('2026-04-06T00:00:00.000Z'),
    });
    assert.equal(signedIn.source, 'signin');
    assert.equal(counts.password, 1);
    assert.equal(existsSync(sessionFile), true);

    const identity = __testInternals.buildRuntimeIdentity(runtime);
    __testInternals.dropMemoizedRecord(identity);

    const cached = await resolveSupabaseUserSession({
      runtime,
      fetchImpl,
      timeoutMs: 25,
      now: new Date('2026-04-06T00:00:01.000Z'),
    });
    assert.equal(cached.source, 'cache');
    assert.equal(counts.password, 1);

    const memoized = await resolveSupabaseUserSession({
      runtime,
      fetchImpl,
      timeoutMs: 25,
      now: new Date('2026-04-06T00:00:02.000Z'),
    });
    assert.equal(memoized.source, 'memory');
    assert.equal(counts.password, 1);
  } finally {
    clearSessionState();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveSupabaseUserSession refreshes stale sessions and falls back to sign-in when refresh fails', async () => {
  clearSessionState();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-session-refresh-'));
  const sessionFile = path.join(dir, 'session.json');
  const runtime = makeRuntime({ sessionFile });
  const identity = __testInternals.buildRuntimeIdentity(runtime);
  const staleRecord = __testInternals.buildCachedSessionRecord({
    runtime: identity,
    session: makeSession({
      accessToken: 'stale-access-token',
      refreshToken: 'stale-refresh-token',
      expiresAt: 1_775_519_000,
    }) as never,
    userEmail: 'user@example.com',
    now: new Date('2026-04-05T23:00:00.000Z'),
  });
  __testInternals.writeCachedSessionRecord(sessionFile, staleRecord);

  try {
    const refreshedPlan = makeAuthFetch({
      refreshResponses: [makeSupabaseAuthResponse({ accessToken: 'refreshed-access-token' })],
    });
    const refreshed = await resolveSupabaseUserSession({
      runtime,
      fetchImpl: refreshedPlan.fetchImpl,
      timeoutMs: 25,
      now: new Date('2026-04-06T00:00:00.000Z'),
      forceRefresh: true,
    });
    assert.equal(refreshed.source, 'refresh');
    assert.equal(refreshed.accessToken, 'refreshed-access-token');
    assert.equal(refreshedPlan.counts.refresh, 1);

    __testInternals.writeCachedSessionRecord(sessionFile, staleRecord);
    __testInternals.dropMemoizedRecord(identity);
    const fallbackPlan = makeAuthFetch({
      refreshResponses: [
        makeJsonResponse(
          { error: 'invalid_grant', error_description: 'refresh token not found' },
          { ok: false, status: 400 },
        ),
      ],
      passwordResponses: [makeSupabaseAuthResponse({ accessToken: 'relogged-access-token' })],
    });
    const relogged = await resolveSupabaseUserSession({
      runtime,
      fetchImpl: fallbackPlan.fetchImpl,
      timeoutMs: 25,
      now: new Date('2026-04-06T00:00:00.000Z'),
      forceRefresh: true,
    });
    assert.equal(relogged.source, 'signin');
    assert.equal(relogged.accessToken, 'relogged-access-token');
    assert.equal(fallbackPlan.counts.refresh, 1);
    assert.equal(fallbackPlan.counts.password, 1);
  } finally {
    clearSessionState();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveSupabaseUserSession supports memory-only mode, force reauth, and invalid API-key failures', async () => {
  clearSessionState();
  const runtime = makeRuntime({
    disableSessionCache: true,
  });
  const authPlan = makeAuthFetch({
    passwordResponses: [makeSupabaseAuthResponse({ accessToken: 'memory-only-token' })],
  });

  const first = await resolveSupabaseUserSession({
    runtime,
    fetchImpl: authPlan.fetchImpl,
    timeoutMs: 25,
    now: new Date('2026-04-06T00:00:00.000Z'),
  });
  assert.equal(first.source, 'signin');
  assert.equal(first.sessionFile, null);

  const second = await resolveSupabaseUserSession({
    runtime,
    fetchImpl: authPlan.fetchImpl,
    timeoutMs: 25,
    now: new Date('2026-04-06T00:00:01.000Z'),
  });
  assert.equal(second.source, 'memory');

  clearSessionState();
  const forceReauthRuntime = makeRuntime({
    disableSessionCache: true,
    forceReauth: true,
  });
  const forceReauthPlan = makeAuthFetch({
    passwordResponses: [
      makeSupabaseAuthResponse({ accessToken: 'force-reauth-token-1' }),
      makeSupabaseAuthResponse({ accessToken: 'force-reauth-token-2' }),
    ],
  });
  await resolveSupabaseUserSession({
    runtime: forceReauthRuntime,
    fetchImpl: forceReauthPlan.fetchImpl,
    timeoutMs: 25,
    now: new Date('2026-04-06T00:00:00.000Z'),
  });
  await resolveSupabaseUserSession({
    runtime: forceReauthRuntime,
    fetchImpl: forceReauthPlan.fetchImpl,
    timeoutMs: 25,
    now: new Date('2026-04-06T00:00:01.000Z'),
  });
  assert.equal(forceReauthPlan.counts.password, 2);

  await assert.rejects(
    () =>
      resolveSupabaseUserSession({
        runtime: makeRuntime({
          disableSessionCache: true,
          forceReauth: true,
          userApiKey: 'not-a-real-api-key',
        }),
        fetchImpl: authPlan.fetchImpl,
        timeoutMs: 25,
      }),
    (error) => error instanceof CliError && error.code === 'USER_API_KEY_INVALID',
  );

  const defaultTimeoutPlan = makeAuthFetch({
    passwordResponses: [makeSupabaseAuthResponse({ accessToken: 'default-timeout-token' })],
  });
  const defaultTimeoutSession = await resolveSupabaseUserSession({
    runtime: makeRuntime({
      disableSessionCache: true,
      forceReauth: true,
    }),
    fetchImpl: defaultTimeoutPlan.fetchImpl,
  });
  assert.equal(defaultTimeoutSession.accessToken, 'default-timeout-token');
});

test('internal session helpers cover refresh null paths, direct resolve branches, and runtime wrappers', async () => {
  clearSessionState();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-session-internals-'));
  const sessionFile = path.join(dir, 'session.json');
  const runtime = makeRuntime({ sessionFile });
  const identity = __testInternals.buildRuntimeIdentity(runtime);
  const freshRecord = __testInternals.buildCachedSessionRecord({
    runtime: identity,
    session: makeSession({ accessToken: 'fresh-token' }) as never,
    userEmail: 'user@example.com',
    now: new Date('2026-04-06T00:00:00.000Z'),
  });
  __testInternals.memoizeRecord(identity, freshRecord);

  try {
    const fromMemory = await __testInternals.resolveAndPersistSession({
      runtime,
      runtimeIdentity: identity,
      fetchImpl: async () => {
        throw new Error('should not sign in');
      },
      timeoutMs: 25,
      now: new Date('2026-04-06T00:00:00.000Z'),
      forceRefresh: false,
    });
    assert.equal(fromMemory.source, 'memory');

    __testInternals.dropMemoizedRecord(identity);
    __testInternals.writeCachedSessionRecord(sessionFile, freshRecord);
    const fromCache = await __testInternals.resolveAndPersistSession({
      runtime,
      runtimeIdentity: identity,
      fetchImpl: async () => {
        throw new Error('should not sign in');
      },
      timeoutMs: 25,
      now: new Date('2026-04-06T00:00:01.000Z'),
      forceRefresh: false,
    });
    assert.equal(fromCache.source, 'cache');

    assert.equal(
      await __testInternals.refreshWithRefreshToken({
        runtime,
        runtimeIdentity: identity,
        refreshToken: '',
        userEmail: 'user@example.com',
        fetchImpl: async () => {
          throw new Error('unreachable');
        },
        timeoutMs: 25,
        now: new Date('2026-04-06T00:00:00.000Z'),
      }),
      null,
    );
    assert.equal(
      await __testInternals.refreshWithRefreshToken({
        runtime,
        runtimeIdentity: identity,
        refreshToken: 'refresh-token',
        userEmail: 'user@example.com',
        fetchImpl: async () =>
          makeJsonResponse(
            { error: 'invalid_grant', error_description: 'network failure' },
            { ok: false, status: 400 },
          ),
        timeoutMs: 25,
        now: new Date('2026-04-06T00:00:00.000Z'),
      }),
      null,
    );
    assert.equal(
      await __testInternals.refreshWithRefreshToken({
        runtime,
        runtimeIdentity: {
          ...identity,
          projectBaseUrl: 'not a valid supabase url',
        },
        refreshToken: 'refresh-token',
        userEmail: 'user@example.com',
        fetchImpl: async () => {
          throw new Error('should not call fetch');
        },
        timeoutMs: 25,
        now: new Date('2026-04-06T00:00:00.000Z'),
      }),
      null,
    );
    const refreshFallbackEmailRecord = await __testInternals.refreshWithRefreshToken({
      runtime,
      runtimeIdentity: identity,
      refreshToken: 'refresh-token',
      userEmail: 'fallback@example.com',
      fetchImpl: makeAuthFetch({
        refreshResponses: [makeSupabaseAuthResponse({ email: '' })],
      }).fetchImpl,
      timeoutMs: 25,
      now: new Date('2026-04-06T00:00:00.000Z'),
    });
    assert.equal(refreshFallbackEmailRecord?.user_email, 'fallback@example.com');

    const signInPlan = makeAuthFetch({
      passwordResponses: [makeSupabaseAuthResponse({ accessToken: 'wrapper-signin-token' })],
      refreshResponses: [makeSupabaseAuthResponse({ accessToken: 'wrapper-refresh-token' })],
    });
    const dataRuntime = createSupabaseDataRuntime({
      runtime: makeRuntime({
        disableSessionCache: true,
      }),
      fetchImpl: signInPlan.fetchImpl,
      timeoutMs: 25,
      now: new Date('2026-04-06T00:00:00.000Z'),
    });
    assert.equal(await dataRuntime.getAccessToken(), 'wrapper-signin-token');
    assert.equal(await dataRuntime.refreshAccessToken?.(), 'wrapper-refresh-token');

    await assert.rejects(
      () =>
        __testInternals.signInWithUserApiKey({
          runtime,
          runtimeIdentity: identity,
          fetchImpl: async () => makeJsonResponse({}, { ok: true, status: 200 }),
          timeoutMs: 25,
          now: new Date('2026-04-06T00:00:00.000Z'),
        }),
      /Failed to sign in with TIANGONG_LCA_API_KEY/u,
    );
    await assert.rejects(
      () =>
        __testInternals.signInWithUserApiKey({
          runtime,
          runtimeIdentity: identity,
          fetchImpl: async () =>
            makeJsonResponse(
              {
                error: 'invalid_credentials',
                error_description: 'bad password',
              },
              { ok: false, status: 400 },
            ),
          timeoutMs: 25,
          now: new Date('2026-04-06T00:00:00.000Z'),
        }),
      (error) =>
        error instanceof CliError &&
        error.code === 'SUPABASE_AUTH_SIGN_IN_FAILED' &&
        String(error.details).includes('bad password'),
    );

    const fallbackEmailRecord = await __testInternals.signInWithUserApiKey({
      runtime,
      runtimeIdentity: identity,
      fetchImpl: makeAuthFetch({
        passwordResponses: [makeSupabaseAuthResponse({ email: '' })],
      }).fetchImpl,
      timeoutMs: 25,
      now: new Date('2026-04-06T00:00:00.000Z'),
    });
    assert.equal(fallbackEmailRecord.user_email, 'user@example.com');

    const authClient = __testInternals.createSupabaseAuthClient(
      identity,
      runtime.publishableKey,
      signInPlan.fetchImpl,
      25,
    );
    assert.ok(authClient);
  } finally {
    clearSessionState();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('signInWithUserApiKey falls back to the default missing-session detail when auth returns null error and null session', () => {
  const output = execFileSync(
    process.execPath,
    [
      '--experimental-test-module-mocks',
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      `
      import { mock } from 'node:test';

      mock.module('@supabase/supabase-js', {
        namedExports: {
          createClient() {
            return {
              auth: {
                async signInWithPassword() {
                  return { data: { session: null, user: null }, error: null };
                },
              },
            };
          },
        },
      });

      const mod = await import('./src/lib/supabase-session.ts?mock-signin-fallback-detail');
      const runtime = {
        apiBaseUrl: 'https://example.supabase.co/functions/v1',
        userApiKey: Buffer.from(
          JSON.stringify({
            email: 'user@example.com',
            password: 'secret-password',
          }),
          'utf8',
        ).toString('base64'),
        publishableKey: 'sb-publishable-key',
        sessionFile: null,
        disableSessionCache: true,
        forceReauth: false,
      };
      const identity = mod.__testInternals.buildRuntimeIdentity(runtime);

      try {
        await mod.__testInternals.signInWithUserApiKey({
          runtime,
          runtimeIdentity: identity,
          fetchImpl: async () => {
            throw new Error('unused');
          },
          timeoutMs: 25,
          now: new Date('2026-04-06T00:00:00.000Z'),
        });
      } catch (error) {
        console.log(JSON.stringify({
          code: error?.code,
          details: error?.details,
        }));
      }
    `,
    ],
    {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_NO_WARNINGS: '1',
      },
    },
  ).trim();

  assert.deepEqual(JSON.parse(output), {
    code: 'SUPABASE_AUTH_SIGN_IN_FAILED',
    details: 'Supabase auth session missing from sign-in response.',
  });
});

test('state-lock helpers behave the same from the built dist module', async () => {
  const module =
    await loadDistModule<typeof import('../src/lib/state-lock.js')>('src/lib/state-lock.js');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-state-lock-dist-'));
  const statePath = path.join(dir, 'state.json');
  const lockPath = module.lockPathForState(statePath);

  try {
    assert.equal(lockPath, `${statePath}.lock`);
    assert.equal(module.readStateLockMetadata(lockPath), null);
    writeFileSync(lockPath, '{"ownerPid":123}\n', 'utf8');
    assert.deepEqual(module.readStateLockMetadata(lockPath), {
      ownerPid: 123,
    });
    assert.equal(module.isProcessAlive(process.pid), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
