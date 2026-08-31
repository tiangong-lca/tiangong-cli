import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient, type Session } from '@supabase/supabase-js';
import { CliError } from './errors.js';
import type { FetchLike } from './http.js';
import {
  openSystemBrowser,
  receiveOAuthLoopbackCallback,
  SYSTEM_BROWSER_OPTIONS,
  type BrowserSpawn,
} from './oauth-loopback.js';
import {
  buildOAuthAuthorizationUrl,
  createOAuthPkceValues,
  DEFAULT_OAUTH_SCOPES,
  exchangeOAuthAuthorizationCode,
  fetchOAuthUserInfo,
  refreshOAuthTokens,
  type OAuthPkceValues,
} from './oauth-pkce.js';
import { withStateFileLock } from './state-lock.js';
import {
  createSupabaseFetch,
  deriveSupabaseProjectBaseUrl,
  type SupabaseDataRuntime,
  type SupabaseRestRuntime,
} from './supabase-client.js';
import {
  fingerprintSecret,
  fingerprintUserApiKey,
  requireUserApiKeyCredentials,
} from './user-api-key.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const SESSION_REFRESH_WINDOW_SECONDS = 300;

export type CachedSupabaseSessionRecord = {
  schema_version: 2;
  auth_method: 'oauth' | 'legacy_user_api_key';
  supabase_url: string;
  publishable_key_fingerprint: string;
  auth_binding_fingerprint: string;
  user_email: string;
  access_token: string;
  refresh_token: string;
  expires_at: number | null;
  granted_scopes: string[];
  updated_at_utc: string;
};

export type ResolvedSupabaseUserSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
  userEmail: string;
  projectBaseUrl: string;
  sessionFile: string | null;
  authMethod: 'oauth' | 'access_token' | 'legacy_user_api_key';
  source: 'memory' | 'cache' | 'refresh' | 'oauth_login' | 'legacy_signin' | 'access_token';
};

type RuntimeIdentity = {
  projectBaseUrl: string;
  publishableKeyFingerprint: string;
  authMethod: 'oauth' | 'access_token' | 'legacy_user_api_key';
  authBindingFingerprint: string;
  sessionFilePath: string | null;
  memoKey: string;
};

const SESSION_MEMORY_CACHE = new Map<string, CachedSupabaseSessionRecord>();
const ACCESS_TOKEN_MEMORY_CACHE = new Map<string, ResolvedSupabaseUserSession>();
const SESSION_OPERATION_CHAINS = new Map<string, Promise<void>>();

function trimToken(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nowSeconds(now: Date): number {
  return Math.floor(now.getTime() / 1000);
}

type SessionTokenFields = Pick<
  Session,
  'access_token' | 'refresh_token' | 'expires_at' | 'expires_in'
>;

function computeExpiresAt(session: SessionTokenFields, now: Date): number | null {
  if (typeof session.expires_at === 'number' && Number.isFinite(session.expires_at)) {
    return Math.floor(session.expires_at);
  }

  if (typeof session.expires_in === 'number' && Number.isFinite(session.expires_in)) {
    return nowSeconds(now) + Math.max(Math.floor(session.expires_in), 0);
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCachedSessionRecord(value: unknown): CachedSupabaseSessionRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.schema_version !== 1 && value.schema_version !== 2) {
    return null;
  }

  const supabaseUrl = trimToken(value.supabase_url);
  const publishableKeyFingerprint = trimToken(value.publishable_key_fingerprint);
  const authMethod =
    value.schema_version === 1
      ? 'legacy_user_api_key'
      : value.auth_method === 'oauth' || value.auth_method === 'legacy_user_api_key'
        ? value.auth_method
        : null;
  const authBindingFingerprint =
    value.schema_version === 1
      ? trimToken(value.user_api_key_fingerprint)
      : trimToken(value.auth_binding_fingerprint);
  const userEmail = trimToken(value.user_email);
  const accessToken = trimToken(value.access_token);
  const refreshToken = trimToken(value.refresh_token);
  const updatedAtUtc = trimToken(value.updated_at_utc);
  const expiresAt =
    typeof value.expires_at === 'number' && Number.isFinite(value.expires_at)
      ? Math.floor(value.expires_at)
      : value.expires_at === null
        ? null
        : NaN;
  const grantedScopes =
    value.schema_version === 1
      ? []
      : Array.isArray(value.granted_scopes) &&
          value.granted_scopes.every((scope) => typeof scope === 'string' && scope.trim())
        ? [...new Set(value.granted_scopes.map((scope) => scope.trim()))].sort((left, right) =>
            left.localeCompare(right),
          )
        : null;

  if (
    !supabaseUrl ||
    !publishableKeyFingerprint ||
    !authMethod ||
    !authBindingFingerprint ||
    !userEmail ||
    !accessToken ||
    !refreshToken ||
    !updatedAtUtc ||
    Number.isNaN(expiresAt) ||
    grantedScopes === null
  ) {
    return null;
  }

  return {
    schema_version: 2,
    auth_method: authMethod,
    supabase_url: supabaseUrl,
    publishable_key_fingerprint: publishableKeyFingerprint,
    auth_binding_fingerprint: authBindingFingerprint,
    user_email: userEmail,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    granted_scopes: grantedScopes,
    updated_at_utc: updatedAtUtc,
  };
}

function resolveDefaultSessionFilePath(options: {
  platform: NodeJS.Platform;
  homeDir: string;
  xdgStateHome: string | null;
  localAppData: string | null;
}): string {
  if (options.xdgStateHome) {
    return path.join(options.xdgStateHome, 'tiangong-lca-cli', 'session.json');
  }

  if (options.homeDir) {
    return path.join(options.homeDir, '.local', 'state', 'tiangong-lca-cli', 'session.json');
  }

  if (options.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'tiangong-lca-cli',
      'session.json',
    );
  }

  if (options.platform === 'win32' && options.localAppData) {
    return path.join(options.localAppData, 'tiangong-lca-cli', 'session.json');
  }

  return path.resolve('.tiangong-lca-session.json');
}

function resolveSessionFilePath(runtime: SupabaseRestRuntime): string | null {
  if (runtime.authMode === 'access_token' || runtime.disableSessionCache) {
    return null;
  }

  if (runtime.sessionFile) {
    return path.resolve(runtime.sessionFile);
  }

  return resolveDefaultSessionFilePath({
    platform: process.platform,
    homeDir: trimToken(os.homedir()),
    xdgStateHome: trimToken(process.env.XDG_STATE_HOME) || null,
    localAppData: trimToken(process.env.LOCALAPPDATA) || null,
  });
}

function buildRuntimeIdentity(runtime: SupabaseRestRuntime): RuntimeIdentity {
  const projectBaseUrl = deriveSupabaseProjectBaseUrl(runtime.apiBaseUrl);
  const publishableKeyFingerprint = fingerprintSecret(runtime.publishableKey);
  const authBindingFingerprint =
    runtime.authMode === 'oauth'
      ? fingerprintSecret(`oauth-client:${runtime.oauthClientId as string}`)
      : runtime.authMode === 'access_token'
        ? fingerprintSecret(runtime.accessToken as string)
        : fingerprintUserApiKey(runtime.userApiKey as string);
  const sessionFilePath = resolveSessionFilePath(runtime);

  return {
    projectBaseUrl,
    publishableKeyFingerprint,
    authMethod: runtime.authMode,
    authBindingFingerprint,
    sessionFilePath,
    memoKey: [
      projectBaseUrl,
      publishableKeyFingerprint,
      runtime.authMode,
      authBindingFingerprint,
      sessionFilePath ?? 'memory-only',
    ].join('|'),
  };
}

function recordMatchesRuntime(
  record: CachedSupabaseSessionRecord,
  runtime: RuntimeIdentity,
): boolean {
  return (
    record.supabase_url === runtime.projectBaseUrl &&
    record.publishable_key_fingerprint === runtime.publishableKeyFingerprint &&
    record.auth_method === runtime.authMethod &&
    record.auth_binding_fingerprint === runtime.authBindingFingerprint
  );
}

function isSessionFresh(record: CachedSupabaseSessionRecord, now: Date): boolean {
  return (
    typeof record.expires_at === 'number' &&
    Number.isFinite(record.expires_at) &&
    record.expires_at > nowSeconds(now) + SESSION_REFRESH_WINDOW_SECONDS
  );
}

function buildCachedSessionRecord(options: {
  runtime: RuntimeIdentity;
  session: SessionTokenFields;
  userEmail: string;
  grantedScopes?: string[];
  now: Date;
}): CachedSupabaseSessionRecord {
  const accessToken = trimToken(options.session.access_token);
  const refreshToken = trimToken(options.session.refresh_token);
  if (!accessToken || !refreshToken) {
    throw new CliError('Supabase auth did not return a usable session.', {
      code: 'SUPABASE_AUTH_SESSION_INVALID',
      exitCode: 1,
    });
  }

  return {
    schema_version: 2,
    auth_method: options.runtime.authMethod === 'oauth' ? 'oauth' : 'legacy_user_api_key',
    supabase_url: options.runtime.projectBaseUrl,
    publishable_key_fingerprint: options.runtime.publishableKeyFingerprint,
    auth_binding_fingerprint: options.runtime.authBindingFingerprint,
    user_email: options.userEmail,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: computeExpiresAt(options.session, options.now),
    granted_scopes: [...new Set(options.grantedScopes ?? [])].sort(),
    updated_at_utc: options.now.toISOString(),
  };
}

function toResolvedSession(
  record: CachedSupabaseSessionRecord,
  runtime: RuntimeIdentity,
  source: ResolvedSupabaseUserSession['source'],
): ResolvedSupabaseUserSession {
  return {
    accessToken: record.access_token,
    refreshToken: record.refresh_token,
    expiresAt: record.expires_at,
    userEmail: record.user_email,
    projectBaseUrl: runtime.projectBaseUrl,
    sessionFile: runtime.sessionFilePath,
    authMethod: runtime.authMethod,
    source,
  };
}

function readCachedSessionRecord(
  sessionFilePath: string,
  platform: NodeJS.Platform = process.platform,
): CachedSupabaseSessionRecord | null {
  try {
    const stat = statSync(sessionFilePath);
    if (!stat.isFile() || (platform !== 'win32' && (stat.mode & 0o077) !== 0)) {
      return null;
    }
    const text = readFileSync(sessionFilePath, 'utf8').trim();
    if (!text) {
      return null;
    }

    return parseCachedSessionRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

function writeCachedSessionRecord(
  sessionFilePath: string,
  record: CachedSupabaseSessionRecord,
  platform: NodeJS.Platform = process.platform,
): void {
  mkdirSync(path.dirname(sessionFilePath), {
    recursive: true,
    mode: 0o700,
  });
  if (platform !== 'win32') {
    chmodSync(path.dirname(sessionFilePath), 0o700);
  }

  const tempPath = `${sessionFilePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tempPath, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    renameSync(tempPath, sessionFilePath);
    chmodSync(sessionFilePath, 0o600);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function getMemoizedRecord(runtime: RuntimeIdentity): CachedSupabaseSessionRecord | null {
  return SESSION_MEMORY_CACHE.get(runtime.memoKey) ?? null;
}

function memoizeRecord(runtime: RuntimeIdentity, record: CachedSupabaseSessionRecord): void {
  SESSION_MEMORY_CACHE.set(runtime.memoKey, record);
}

function dropMemoizedRecord(runtime: RuntimeIdentity): void {
  SESSION_MEMORY_CACHE.delete(runtime.memoKey);
}

async function withSessionOperationLock<T>(memoKey: string, task: () => Promise<T>): Promise<T> {
  const previous = SESSION_OPERATION_CHAINS.get(memoKey) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.catch(() => undefined).then(() => gate);
  SESSION_OPERATION_CHAINS.set(memoKey, chain);

  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (SESSION_OPERATION_CHAINS.get(memoKey) === chain) {
      SESSION_OPERATION_CHAINS.delete(memoKey);
    }
  }
}

function createSupabaseAuthClient(
  runtime: RuntimeIdentity,
  publishableKey: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
) {
  return createClient(runtime.projectBaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: createSupabaseFetch(fetchImpl, timeoutMs),
    },
  });
}

async function signInWithUserApiKey(options: {
  runtime: SupabaseRestRuntime;
  runtimeIdentity: RuntimeIdentity;
  fetchImpl: FetchLike;
  timeoutMs: number;
  now: Date;
}): Promise<CachedSupabaseSessionRecord> {
  const credentials = requireUserApiKeyCredentials(options.runtime.userApiKey as string);
  const authClient = createSupabaseAuthClient(
    options.runtimeIdentity,
    options.runtime.publishableKey,
    options.fetchImpl,
    options.timeoutMs,
  );
  const { data, error } = await authClient.auth.signInWithPassword({
    email: credentials.email,
    password: credentials.password,
  });

  if (error || !data.session) {
    throw new CliError('Failed to sign in with TIANGONG_LCA_API_KEY.', {
      code: 'SUPABASE_AUTH_SIGN_IN_FAILED',
      exitCode: 1,
      details: error?.message ?? 'Supabase auth session missing from sign-in response.',
    });
  }

  return buildCachedSessionRecord({
    runtime: options.runtimeIdentity,
    session: data.session,
    userEmail: trimToken(data.user?.email) || credentials.email,
    grantedScopes: [],
    now: options.now,
  });
}

async function refreshWithRefreshToken(options: {
  runtime: SupabaseRestRuntime;
  runtimeIdentity: RuntimeIdentity;
  refreshToken: string;
  userEmail: string;
  fetchImpl: FetchLike;
  timeoutMs: number;
  now: Date;
}): Promise<CachedSupabaseSessionRecord | null> {
  const normalizedRefreshToken = trimToken(options.refreshToken);
  if (!normalizedRefreshToken) {
    return null;
  }

  try {
    if (options.runtime.authMode === 'oauth') {
      const tokens = await refreshOAuthTokens({
        projectBaseUrl: options.runtimeIdentity.projectBaseUrl,
        clientId: options.runtime.oauthClientId as string,
        refreshToken: normalizedRefreshToken,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      });
      const userInfo = await fetchOAuthUserInfo({
        projectBaseUrl: options.runtimeIdentity.projectBaseUrl,
        accessToken: tokens.accessToken,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      });
      return buildCachedSessionRecord({
        runtime: options.runtimeIdentity,
        session: {
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          expires_at: undefined,
          expires_in: tokens.expiresIn,
        },
        userEmail: userInfo.email,
        grantedScopes: tokens.scope,
        now: options.now,
      });
    }

    if (options.runtime.authMode !== 'legacy_user_api_key') {
      return null;
    }

    const authClient = createSupabaseAuthClient(
      options.runtimeIdentity,
      options.runtime.publishableKey,
      options.fetchImpl,
      options.timeoutMs,
    );
    const { data, error } = await authClient.auth.refreshSession({
      refresh_token: normalizedRefreshToken,
    });

    if (error || !data.session) {
      return null;
    }

    return buildCachedSessionRecord({
      runtime: options.runtimeIdentity,
      session: data.session,
      userEmail: trimToken(data.user?.email) || options.userEmail,
      grantedScopes: [],
      now: options.now,
    });
  } catch {
    return null;
  }
}

async function resolveExplicitAccessToken(options: {
  runtime: SupabaseRestRuntime;
  runtimeIdentity: RuntimeIdentity;
  fetchImpl: FetchLike;
  timeoutMs: number;
}): Promise<ResolvedSupabaseUserSession> {
  const cached = ACCESS_TOKEN_MEMORY_CACHE.get(options.runtimeIdentity.memoKey);
  if (cached) {
    return cached;
  }
  const accessToken = trimToken(options.runtime.accessToken);
  const authClient = createSupabaseAuthClient(
    options.runtimeIdentity,
    options.runtime.publishableKey,
    options.fetchImpl,
    options.timeoutMs,
  );
  const { data, error } = await authClient.auth.getUser(accessToken);
  const userEmail = trimToken(data.user?.email);
  if (error || !data.user?.id || data.user.role !== 'authenticated' || !userEmail) {
    throw new CliError('TIANGONG_LCA_ACCESS_TOKEN did not resolve to an authenticated user.', {
      code: 'SUPABASE_ACCESS_TOKEN_INVALID',
      exitCode: 1,
      details: error?.message ?? 'Authenticated user identity missing from access token.',
    });
  }

  const resolved: ResolvedSupabaseUserSession = {
    accessToken,
    refreshToken: '',
    expiresAt: null,
    userEmail,
    projectBaseUrl: options.runtimeIdentity.projectBaseUrl,
    sessionFile: null,
    authMethod: 'access_token',
    source: 'access_token',
  };
  ACCESS_TOKEN_MEMORY_CACHE.set(options.runtimeIdentity.memoKey, resolved);
  return resolved;
}

async function resolveAndPersistSession(options: {
  runtime: SupabaseRestRuntime;
  runtimeIdentity: RuntimeIdentity;
  fetchImpl: FetchLike;
  timeoutMs: number;
  now: Date;
  forceRefresh: boolean;
}): Promise<ResolvedSupabaseUserSession> {
  const { runtime, runtimeIdentity } = options;
  if (runtime.authMode === 'access_token') {
    return resolveExplicitAccessToken({
      runtime,
      runtimeIdentity,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    });
  }
  const memoized = getMemoizedRecord(runtimeIdentity);
  if (
    !options.forceRefresh &&
    !runtime.forceReauth &&
    memoized &&
    recordMatchesRuntime(memoized, runtimeIdentity) &&
    isSessionFresh(memoized, options.now)
  ) {
    return toResolvedSession(memoized, runtimeIdentity, 'memory');
  }

  const cachedFromDisk =
    runtimeIdentity.sessionFilePath !== null
      ? readCachedSessionRecord(runtimeIdentity.sessionFilePath)
      : null;
  if (
    !options.forceRefresh &&
    !runtime.forceReauth &&
    cachedFromDisk &&
    recordMatchesRuntime(cachedFromDisk, runtimeIdentity) &&
    isSessionFresh(cachedFromDisk, options.now)
  ) {
    memoizeRecord(runtimeIdentity, cachedFromDisk);
    return toResolvedSession(cachedFromDisk, runtimeIdentity, 'cache');
  }

  if (!runtime.forceReauth) {
    const refreshCandidate =
      cachedFromDisk &&
      recordMatchesRuntime(cachedFromDisk, runtimeIdentity) &&
      trimToken(cachedFromDisk.refresh_token)
        ? cachedFromDisk
        : memoized &&
            recordMatchesRuntime(memoized, runtimeIdentity) &&
            trimToken(memoized.refresh_token)
          ? memoized
          : null;

    if (refreshCandidate) {
      const refreshed = await refreshWithRefreshToken({
        runtime,
        runtimeIdentity,
        refreshToken: refreshCandidate.refresh_token,
        userEmail: refreshCandidate.user_email,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
        now: options.now,
      });

      if (refreshed) {
        if (runtimeIdentity.sessionFilePath) {
          writeCachedSessionRecord(runtimeIdentity.sessionFilePath, refreshed);
        }
        memoizeRecord(runtimeIdentity, refreshed);
        return toResolvedSession(refreshed, runtimeIdentity, 'refresh');
      }
    }
  }

  if (runtime.authMode === 'oauth') {
    dropMemoizedRecord(runtimeIdentity);
    throw new CliError(
      'No usable OAuth session is available. Run `tiangong-lca auth login` in a trusted terminal.',
      {
        code: 'SUPABASE_OAUTH_LOGIN_REQUIRED',
        exitCode: 1,
      },
    );
  }

  const signedIn = await signInWithUserApiKey({
    runtime,
    runtimeIdentity,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    now: options.now,
  });

  if (runtimeIdentity.sessionFilePath) {
    writeCachedSessionRecord(runtimeIdentity.sessionFilePath, signedIn);
  }
  memoizeRecord(runtimeIdentity, signedIn);
  return toResolvedSession(signedIn, runtimeIdentity, 'legacy_signin');
}

export async function resolveSupabaseUserSession(options: {
  runtime: SupabaseRestRuntime;
  fetchImpl: FetchLike;
  timeoutMs?: number;
  now?: Date;
  forceRefresh?: boolean;
}): Promise<ResolvedSupabaseUserSession> {
  const runtimeIdentity = buildRuntimeIdentity(options.runtime);
  const now = options.now ?? new Date();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const forceRefresh = Boolean(options.forceRefresh);

  if (options.runtime.authMode === 'access_token') {
    return resolveExplicitAccessToken({
      runtime: options.runtime,
      runtimeIdentity,
      fetchImpl: options.fetchImpl,
      timeoutMs,
    });
  }

  if (!forceRefresh && !options.runtime.forceReauth) {
    const memoized = getMemoizedRecord(runtimeIdentity);
    if (
      memoized &&
      recordMatchesRuntime(memoized, runtimeIdentity) &&
      isSessionFresh(memoized, now)
    ) {
      return toResolvedSession(memoized, runtimeIdentity, 'memory');
    }

    if (runtimeIdentity.sessionFilePath) {
      const cached = readCachedSessionRecord(runtimeIdentity.sessionFilePath);
      if (cached && recordMatchesRuntime(cached, runtimeIdentity) && isSessionFresh(cached, now)) {
        memoizeRecord(runtimeIdentity, cached);
        return toResolvedSession(cached, runtimeIdentity, 'cache');
      }
    }
  }

  return withSessionOperationLock(runtimeIdentity.memoKey, async () => {
    if (runtimeIdentity.sessionFilePath) {
      return withStateFileLock(
        runtimeIdentity.sessionFilePath,
        {
          reason: forceRefresh ? 'refresh_supabase_user_session' : 'resolve_supabase_user_session',
        },
        () =>
          resolveAndPersistSession({
            runtime: options.runtime,
            runtimeIdentity,
            fetchImpl: options.fetchImpl,
            timeoutMs,
            now,
            forceRefresh,
          }),
      );
    }

    return resolveAndPersistSession({
      runtime: options.runtime,
      runtimeIdentity,
      fetchImpl: options.fetchImpl,
      timeoutMs,
      now,
      forceRefresh,
    });
  });
}

export type OAuthLoginReceipt = {
  schemaVersion: 'tiangong.cli-oauth-login.v1';
  status: 'authenticated';
  authMethod: 'oauth';
  expiresAt: number;
  grantedScopes: string[];
  sessionCache: 'private-file';
};

export type OAuthLogoutReceipt = {
  schemaVersion: 'tiangong.cli-oauth-logout.v1';
  status: 'logged-out';
  removed: boolean;
};

export type AuthStatusReceipt = {
  schemaVersion: 'tiangong.cli-auth-status.v1';
  status: 'ready' | 'login-required';
  authMethod: ResolvedSupabaseUserSession['authMethod'];
  sessionState: 'fresh' | 'refresh-required' | 'memory-only' | 'transition-only' | 'missing';
  sessionCache: 'private-file' | 'disabled' | 'memory-only';
  expiresAt: number | null;
  grantedScopes: string[];
  onlineVerified: false;
};

export function inspectSupabaseAuthStatus(options: {
  runtime: SupabaseRestRuntime;
  now?: Date;
}): AuthStatusReceipt {
  const runtimeIdentity = buildRuntimeIdentity(options.runtime);
  const now = options.now ?? new Date();

  if (options.runtime.authMode === 'access_token') {
    return {
      schemaVersion: 'tiangong.cli-auth-status.v1',
      status: 'ready',
      authMethod: 'access_token',
      sessionState: 'memory-only',
      sessionCache: 'memory-only',
      expiresAt: null,
      grantedScopes: [],
      onlineVerified: false,
    };
  }

  if (options.runtime.authMode === 'legacy_user_api_key') {
    return {
      schemaVersion: 'tiangong.cli-auth-status.v1',
      status: 'ready',
      authMethod: 'legacy_user_api_key',
      sessionState: 'transition-only',
      sessionCache: runtimeIdentity.sessionFilePath ? 'private-file' : 'disabled',
      expiresAt: null,
      grantedScopes: [],
      onlineVerified: false,
    };
  }

  const memoized = getMemoizedRecord(runtimeIdentity);
  const cached =
    memoized && recordMatchesRuntime(memoized, runtimeIdentity)
      ? memoized
      : runtimeIdentity.sessionFilePath
        ? readCachedSessionRecord(runtimeIdentity.sessionFilePath)
        : null;
  const matching = cached && recordMatchesRuntime(cached, runtimeIdentity) ? cached : null;
  if (!matching || !trimToken(matching.refresh_token)) {
    return {
      schemaVersion: 'tiangong.cli-auth-status.v1',
      status: 'login-required',
      authMethod: 'oauth',
      sessionState: 'missing',
      sessionCache: runtimeIdentity.sessionFilePath ? 'private-file' : 'disabled',
      expiresAt: null,
      grantedScopes: [],
      onlineVerified: false,
    };
  }

  return {
    schemaVersion: 'tiangong.cli-auth-status.v1',
    status: 'ready',
    authMethod: 'oauth',
    sessionState: isSessionFresh(matching, now) ? 'fresh' : 'refresh-required',
    sessionCache: 'private-file',
    expiresAt: matching.expires_at,
    grantedScopes: matching.granted_scopes,
    onlineVerified: false,
  };
}

export async function loginWithSupabaseOAuth(options: {
  runtime: SupabaseRestRuntime;
  fetchImpl: FetchLike;
  requestTimeoutMs?: number;
  loginTimeoutMs?: number;
  now?: Date;
  createPkceValuesImpl?: () => OAuthPkceValues;
  receiveCallbackImpl?: typeof receiveOAuthLoopbackCallback;
  openBrowserImpl?: (authorizationUrl: string) => Promise<void>;
  browserOptions?: { platform: NodeJS.Platform; spawnImpl: BrowserSpawn };
  exchangeCodeImpl?: typeof exchangeOAuthAuthorizationCode;
  fetchUserInfoImpl?: typeof fetchOAuthUserInfo;
}): Promise<OAuthLoginReceipt> {
  if (
    options.runtime.authMode !== 'oauth' ||
    !options.runtime.oauthClientId ||
    !options.runtime.oauthRedirectUri
  ) {
    throw new CliError('OAuth login requires TIANGONG_LCA_AUTH_MODE=oauth and a client ID.', {
      code: 'SUPABASE_OAUTH_RUNTIME_REQUIRED',
      exitCode: 2,
    });
  }

  const runtimeIdentity = buildRuntimeIdentity(options.runtime);
  if (!runtimeIdentity.sessionFilePath) {
    throw new CliError('OAuth login requires the private session cache to be enabled.', {
      code: 'SUPABASE_OAUTH_SESSION_CACHE_REQUIRED',
      exitCode: 2,
    });
  }

  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const loginTimeoutMs = options.loginTimeoutMs ?? 180_000;
  const now = options.now ?? new Date();
  const createPkceValuesImpl = options.createPkceValuesImpl ?? createOAuthPkceValues;
  const receiveCallbackImpl = options.receiveCallbackImpl ?? receiveOAuthLoopbackCallback;
  const browserOptions = options.browserOptions ?? SYSTEM_BROWSER_OPTIONS;
  const openBrowserImpl =
    options.openBrowserImpl ??
    ((authorizationUrl) => openSystemBrowser(authorizationUrl, browserOptions));
  const exchangeCodeImpl = options.exchangeCodeImpl ?? exchangeOAuthAuthorizationCode;
  const fetchUserInfoImpl = options.fetchUserInfoImpl ?? fetchOAuthUserInfo;

  return withSessionOperationLock(runtimeIdentity.memoKey, () =>
    withStateFileLock(
      runtimeIdentity.sessionFilePath as string,
      { reason: 'supabase_oauth_pkce_login' },
      async () => {
        const pkce = createPkceValuesImpl();
        const authorizationUrl = buildOAuthAuthorizationUrl({
          projectBaseUrl: runtimeIdentity.projectBaseUrl,
          clientId: options.runtime.oauthClientId as string,
          redirectUri: options.runtime.oauthRedirectUri as string,
          codeChallenge: pkce.codeChallenge,
          state: pkce.state,
        });
        const authorizationCode = await receiveCallbackImpl({
          redirectUri: options.runtime.oauthRedirectUri as string,
          expectedState: pkce.state,
          timeoutMs: loginTimeoutMs,
          onListening: () => openBrowserImpl(authorizationUrl),
        });
        const tokens = await exchangeCodeImpl({
          projectBaseUrl: runtimeIdentity.projectBaseUrl,
          clientId: options.runtime.oauthClientId as string,
          redirectUri: options.runtime.oauthRedirectUri as string,
          authorizationCode,
          codeVerifier: pkce.codeVerifier,
          fetchImpl: options.fetchImpl,
          timeoutMs: requestTimeoutMs,
        });
        const userInfo = await fetchUserInfoImpl({
          projectBaseUrl: runtimeIdentity.projectBaseUrl,
          accessToken: tokens.accessToken,
          fetchImpl: options.fetchImpl,
          timeoutMs: requestTimeoutMs,
        });
        const grantedScopes = tokens.scope.length > 0 ? tokens.scope : [...DEFAULT_OAUTH_SCOPES];
        const record = buildCachedSessionRecord({
          runtime: runtimeIdentity,
          session: {
            access_token: tokens.accessToken,
            refresh_token: tokens.refreshToken,
            expires_at: undefined,
            expires_in: tokens.expiresIn,
          },
          userEmail: userInfo.email,
          grantedScopes,
          now,
        });
        writeCachedSessionRecord(runtimeIdentity.sessionFilePath as string, record);
        memoizeRecord(runtimeIdentity, record);
        return {
          schemaVersion: 'tiangong.cli-oauth-login.v1',
          status: 'authenticated',
          authMethod: 'oauth',
          expiresAt: record.expires_at as number,
          grantedScopes: record.granted_scopes,
          sessionCache: 'private-file',
        };
      },
    ),
  );
}

export async function logoutSupabaseUserSession(options: {
  runtime: SupabaseRestRuntime;
}): Promise<OAuthLogoutReceipt> {
  const runtimeIdentity = buildRuntimeIdentity(options.runtime);
  return withSessionOperationLock(runtimeIdentity.memoKey, async () => {
    let removed = false;
    const removeCurrent = () => {
      const cached = runtimeIdentity.sessionFilePath
        ? readCachedSessionRecord(runtimeIdentity.sessionFilePath)
        : null;
      if (
        runtimeIdentity.sessionFilePath &&
        cached &&
        recordMatchesRuntime(cached, runtimeIdentity)
      ) {
        rmSync(runtimeIdentity.sessionFilePath, { force: true });
        removed = true;
      }
      dropMemoizedRecord(runtimeIdentity);
      ACCESS_TOKEN_MEMORY_CACHE.delete(runtimeIdentity.memoKey);
    };

    if (runtimeIdentity.sessionFilePath) {
      await withStateFileLock(
        runtimeIdentity.sessionFilePath,
        { reason: 'supabase_oauth_local_logout' },
        removeCurrent,
      );
    } else {
      removeCurrent();
    }

    return {
      schemaVersion: 'tiangong.cli-oauth-logout.v1',
      status: 'logged-out',
      removed,
    };
  });
}

export function createSupabaseDataRuntime(options: {
  runtime: SupabaseRestRuntime;
  fetchImpl: FetchLike;
  timeoutMs?: number;
  now?: Date;
}): SupabaseDataRuntime {
  const runtime: SupabaseDataRuntime = {
    apiBaseUrl: options.runtime.apiBaseUrl,
    publishableKey: options.runtime.publishableKey,
    getAccessToken: async () =>
      (
        await resolveSupabaseUserSession({
          runtime: options.runtime,
          fetchImpl: options.fetchImpl,
          timeoutMs: options.timeoutMs,
          now: options.now,
        })
      ).accessToken,
  };
  if (options.runtime.authMode !== 'access_token') {
    runtime.refreshAccessToken = async () =>
      (
        await resolveSupabaseUserSession({
          runtime: options.runtime,
          fetchImpl: options.fetchImpl,
          timeoutMs: options.timeoutMs,
          now: options.now,
          forceRefresh: true,
        })
      ).accessToken;
  }
  return runtime;
}

export const __testInternals = {
  SESSION_MEMORY_CACHE,
  ACCESS_TOKEN_MEMORY_CACHE,
  SESSION_OPERATION_CHAINS,
  buildCachedSessionRecord,
  buildRuntimeIdentity,
  computeExpiresAt,
  createSupabaseAuthClient,
  dropMemoizedRecord,
  getMemoizedRecord,
  isSessionFresh,
  memoizeRecord,
  parseCachedSessionRecord,
  readCachedSessionRecord,
  recordMatchesRuntime,
  refreshWithRefreshToken,
  resolveDefaultSessionFilePath,
  resolveAndPersistSession,
  resolveSessionFilePath,
  signInWithUserApiKey,
  withSessionOperationLock,
  writeCachedSessionRecord,
};
