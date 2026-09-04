import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  createFoundryCommandSpec,
  executeFoundryCommandSpec,
  type FoundryCommandSpecSpawnResult,
} from '../../command-spec.js';
import {
  ensureRuntimeComponents,
  inspectRuntimeComponents,
  type RuntimeManagerOptions,
} from './manager.js';
import { spawnRuntimeProcess } from './process.js';
import { acquireRuntimeLease, releaseRuntimeLease } from './leases.js';
import { cachePath, defaultRuntimeCache, openRuntimeCache } from './storage.js';
import { assertTrustedManifest, componentKey } from './manifest.js';
import { inspectRuntimeHost } from './host.js';
import { runtimeError } from './files.js';
import type { TrustedRuntimeManifest, ComponentPath } from './manifest-types.js';

const systemKeys = [
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'WINDIR',
  'ComSpec',
  'COMSPEC',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
  'TZ',
] as const;
const authKeys = [
  'TIANGONG_LCA_API_BASE_URL',
  'TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY',
  'TIANGONG_LCA_OAUTH_CLIENT_ID',
  'TIANGONG_LCA_OAUTH_REDIRECT_URI',
  'TIANGONG_LCA_REGION',
  'TIANGONG_LCA_AUTH_MODE',
  'TIANGONG_LCA_SESSION_FILE',
  'TIANGONG_LCA_DISABLE_SESSION_CACHE',
  'TIANGONG_LCA_FORCE_REAUTH',
  'TIANGONG_LCA_ACCESS_TOKEN',
] as const;
export function runtimeChildEnvironment(
  source: NodeJS.ProcessEnv,
  mode: 'isolated' | 'cli-auth',
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [...systemKeys, ...(mode === 'cli-auth' ? authKeys : [])])
    if (source[key] !== undefined) env[key] = source[key];
  return env;
}
export type RuntimeExecutionOptions = RuntimeManagerOptions & {
  entry: string;
  cwd: string;
  argv: readonly string[];
  env?: Record<string, string | undefined>;
};
export async function executeRuntimeLaunch(
  value: TrustedRuntimeManifest,
  options: RuntimeExecutionOptions,
  spawnImpl?: Parameters<typeof executeFoundryCommandSpec>[1]['spawnImpl'],
): Promise<FoundryCommandSpecSpawnResult> {
  assertTrustedManifest(value);
  const host = options.host ?? inspectRuntimeHost();
  const launch = value.manifest.launches.find(
    (item) => item.id === options.entry && item.platform === host.platform,
  );
  if (!launch)
    runtimeError('RUNTIME_LAUNCH_UNKNOWN', 'Selected runtime entry is not declared for this host.');
  if (
    options.argv.length > 512 ||
    options.argv.some(
      (arg) =>
        typeof arg !== 'string' ||
        arg.includes('\0') ||
        arg.length > 32768 ||
        /^--(?:username|password|api-key|access-token|refresh-token|authorization-code|oauth-code)(?:=|$)/iu.test(
          arg,
        ),
    )
  )
    runtimeError(
      'RUNTIME_LAUNCH_ARGUMENT',
      'Runtime argv must be bounded and contain no credential arguments.',
    );
  if (!path.isAbsolute(options.cwd) || !fs.statSync(options.cwd).isDirectory())
    runtimeError(
      'RUNTIME_LAUNCH_CWD',
      'Runtime launch requires an explicit existing work directory.',
    );
  const cwd = fs.realpathSync(options.cwd),
    cache = openRuntimeCache(options.cacheDir ?? defaultRuntimeCache(), false);
  const relative = path.relative(cache, cwd);
  if (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) ||
    /\/(?:\.agents|\.codex)\/skills(?:\/|$)/u.test(cwd.split(path.sep).join('/'))
  )
    runtimeError(
      'RUNTIME_LAUNCH_CWD',
      'A runtime cache or installed skill cannot be used as the work directory.',
    );
  const lease = { id: `execution-${randomUUID()}`, owner: `runtime-execution:${process.pid}` };
  let drain: Promise<FoundryCommandSpecSpawnResult> | undefined;
  try {
    await ensureRuntimeComponents(value, { ...options, cacheDir: cache, host, lease });
    if (options.lease)
      await acquireRuntimeLease(
        cache,
        options.lease.id,
        options.lease.owner,
        value.manifest.components
          .filter((item) => item.platform === host.platform)
          .map(componentKey),
      );
    if (inspectRuntimeComponents(value, { ...options, cacheDir: cache, host }).status !== 'ready')
      runtimeError('RUNTIME_LAUNCH_CHANGED', 'Runtime changed before launch.');
    const artifact = (ref: ComponentPath) => {
      const component = value.manifest.components.find(
        (item) => item.id === ref.component && item.platform === host.platform,
      )!;
      const file = component.files.find((item) => item.path === ref.path)!;
      const filePath = cachePath(cache, `components/${componentKey(component)}/root/${ref.path}`);
      return {
        role: `runtime:${ref.component}:${ref.path}`,
        path: filePath,
        bytes: file.bytes,
        sha256: file.sha256,
      };
    };
    const program = artifact(launch.executable);
    const references = launch.argv
      .filter((arg): arg is ComponentPath => 'component' in arg)
      .map(artifact);
    const argv = launch.argv
      .map((arg) => ('literal' in arg ? arg.literal : artifact(arg).path))
      .concat([...options.argv]);
    const spec = createFoundryCommandSpec({
      executable: program.path,
      argv,
      binding: { artifacts: [program, ...references] },
    });
    const result = await executeFoundryCommandSpec(spec, {
      cwd,
      env: runtimeChildEnvironment(options.env ?? process.env, launch.environment),
      signal: options.signal,
      maxBuffer: 16 * 1024 * 1024,
      resolveArtifactPath: (file) => file,
      spawnImpl: (executable, argv, childOptions) => {
        drain = (spawnImpl ?? spawnRuntimeProcess)(executable, argv, childOptions);
        return drain;
      },
    });
    return result;
  } finally {
    await drain?.catch(() => undefined);
    if (fs.existsSync(cachePath(cache, '.runtime-cache.json')))
      await releaseRuntimeLease(cache, lease.id, lease.owner);
  }
}
