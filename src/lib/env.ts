export type EnvSpec = {
  key: string;
  required: boolean;
  description: string;
  defaultValue?: string;
};

export type ResolvedEnv = {
  key: string;
  source: 'env' | 'default' | 'missing';
  value: string | null;
  present: boolean;
};

export const ENV_KEYS = {
  apiBaseUrl: 'TIANGONG_LCA_API_BASE_URL',
  authMode: 'TIANGONG_LCA_AUTH_MODE',
  oauthClientId: 'TIANGONG_LCA_OAUTH_CLIENT_ID',
  oauthRedirectUri: 'TIANGONG_LCA_OAUTH_REDIRECT_URI',
  accessToken: 'TIANGONG_LCA_ACCESS_TOKEN',
  region: 'TIANGONG_LCA_REGION',
  supabasePublishableKey: 'TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY',
  sessionFile: 'TIANGONG_LCA_SESSION_FILE',
  disableSessionCache: 'TIANGONG_LCA_DISABLE_SESSION_CACHE',
  forceReauth: 'TIANGONG_LCA_FORCE_REAUTH',
} as const;

export const ENV_SPECS: EnvSpec[] = [
  {
    key: ENV_KEYS.apiBaseUrl,
    required: true,
    description: 'Main TianGong LCA API / Edge Functions base URL',
  },
  {
    key: ENV_KEYS.region,
    required: false,
    description: 'Target TianGong LCA API region',
    defaultValue: 'us-east-1',
  },
  {
    key: ENV_KEYS.supabasePublishableKey,
    required: true,
    description: 'Supabase publishable key used to bootstrap and refresh user sessions',
  },
  {
    key: ENV_KEYS.sessionFile,
    required: false,
    description: 'Optional local path for the CLI session cache file',
  },
  {
    key: ENV_KEYS.disableSessionCache,
    required: false,
    description: 'Disable the persistent CLI session cache when set to true',
    defaultValue: 'false',
  },
  {
    key: ENV_KEYS.forceReauth,
    required: false,
    description: 'Ignore cached sessions and force a fresh login when set to true',
    defaultValue: 'false',
  },
  {
    key: ENV_KEYS.authMode,
    required: false,
    description: 'Optional explicit auth mode: oauth or access-token',
  },
  {
    key: ENV_KEYS.oauthClientId,
    required: false,
    description: 'Registered public Supabase OAuth client ID',
  },
  {
    key: ENV_KEYS.oauthRedirectUri,
    required: false,
    description: 'Exact registered CLI loopback OAuth redirect URI',
  },
  {
    key: ENV_KEYS.accessToken,
    required: false,
    description: 'Explicit short-lived actor access token for headless execution',
  },
];

export type DoctorCheck = {
  key: string;
  description: string;
  required: boolean;
  source: ResolvedEnv['source'];
  present: boolean;
  valuePreview: string | null;
};

export type DoctorReport = {
  ok: boolean;
  loadedDotEnv: boolean;
  dotEnvPath: string;
  dotEnvKeysLoaded: number;
  checks: DoctorCheck[];
};

export type RuntimeEnv = {
  apiBaseUrl: string | null;
  authMode: string | null;
  oauthClientId: string | null;
  oauthRedirectUri: string | null;
  accessToken: string | null;
  region: string;
  supabasePublishableKey: string | null;
  sessionFile: string | null;
  disableSessionCache: boolean;
  forceReauth: boolean;
};

function parseBooleanEnv(value: string | null): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  switch (value.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true;
    default:
      return false;
  }
}

export function resolveEnv(spec: EnvSpec, env: NodeJS.ProcessEnv): ResolvedEnv {
  const envValue = env[spec.key];
  if (envValue) {
    return {
      key: spec.key,
      source: 'env',
      value: envValue,
      present: true,
    };
  }

  if (spec.defaultValue !== undefined) {
    return {
      key: spec.key,
      source: 'default',
      value: spec.defaultValue,
      present: true,
    };
  }

  return {
    key: spec.key,
    source: 'missing',
    value: null,
    present: false,
  };
}

export function readRuntimeEnv(env: NodeJS.ProcessEnv): RuntimeEnv {
  const apiBaseUrl = resolveEnv(ENV_SPECS[0], env).value;
  const region = resolveEnv(ENV_SPECS[1], env).value as string;
  const supabasePublishableKey = resolveEnv(ENV_SPECS[2], env).value;
  const sessionFile = resolveEnv(ENV_SPECS[3], env).value;
  const disableSessionCache = parseBooleanEnv(resolveEnv(ENV_SPECS[4], env).value);
  const forceReauth = parseBooleanEnv(resolveEnv(ENV_SPECS[5], env).value);
  const authMode = resolveEnv(ENV_SPECS[6], env).value;
  const oauthClientId = resolveEnv(ENV_SPECS[7], env).value;
  const oauthRedirectUri = resolveEnv(ENV_SPECS[8], env).value;
  const accessToken = resolveEnv(ENV_SPECS[9], env).value;

  return {
    apiBaseUrl,
    authMode,
    oauthClientId,
    oauthRedirectUri,
    accessToken,
    region,
    supabasePublishableKey,
    sessionFile,
    disableSessionCache,
    forceReauth,
  };
}

export function maskSecret(value: string | null): string | null {
  if (!value) {
    return value;
  }
  if (value.length <= 8) {
    return value;
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function buildDoctorReport(
  env: NodeJS.ProcessEnv,
  dotEnvStatus: { loaded: boolean; path: string; count: number },
): DoctorReport {
  const checks = ENV_SPECS.map((spec) => {
    const resolved = resolveEnv(spec, env);
    return {
      key: spec.key,
      description: spec.description,
      required: spec.required,
      source: resolved.source,
      present: resolved.present,
      valuePreview: maskSecret(resolved.value),
    };
  });

  return {
    ok:
      checks.every((check) => !check.required || check.present) &&
      [ENV_KEYS.oauthClientId, ENV_KEYS.accessToken].some(
        (key) => checks.find((check) => check.key === key)?.present,
      ),
    loadedDotEnv: dotEnvStatus.loaded,
    dotEnvPath: dotEnvStatus.path,
    dotEnvKeysLoaded: dotEnvStatus.count,
    checks,
  };
}

export const __testInternals = {
  parseBooleanEnv,
};
