import type { RuntimePlatform } from './types.js';

export const RUNTIME_MANIFEST_SCHEMA = 'tiangong-lca.runtime-manifest.v1' as const;
export const RUNTIME_BOOTSTRAP_PROTOCOL = 'tiangong-lca.runtime-bootstrap.v1' as const;
export const RUNTIME_ARCHIVE_FORMAT = 'tar-gzip-ustar-v1' as const;
export const RUNTIME_HOST_CONTEXT_PROTOCOL = 'tiangong-lca.runtime-host.v1' as const;
export type ComponentFile = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
  mode: 420 | 493;
}>;
export type RuntimeComponent = Readonly<{
  id: string;
  version: string;
  platform: RuntimePlatform;
  archive: Readonly<{
    format: typeof RUNTIME_ARCHIVE_FORMAT;
    url: string;
    bytes: number;
    sha256: string;
  }>;
  files: readonly ComponentFile[];
  content_sha256: string;
  production_lock: string;
  sbom: string;
  licenses: readonly string[];
  provenance: readonly string[];
  protocols: readonly string[];
  asset_fingerprints: Readonly<Record<string, string>>;
}>;
export type ComponentPath = Readonly<{ component: string; path: string }>;
export type RuntimeLaunch = Readonly<{
  id: string;
  platform: RuntimePlatform;
  executable: ComponentPath;
  environment: 'isolated' | 'cli-auth';
  context_protocol?: typeof RUNTIME_HOST_CONTEXT_PROTOCOL;
  argv: readonly (ComponentPath | Readonly<{ literal: string }>)[];
}>;
export type WorkspaceCompatibility = Readonly<{ schema: string; features: readonly string[] }>;
export type RuntimeManifest = Readonly<{
  schema: typeof RUNTIME_MANIFEST_SCHEMA;
  bootstrap_protocol: typeof RUNTIME_BOOTSTRAP_PROTOCOL;
  product: Readonly<{ id: string; version: string }>;
  minimum_hosts: Readonly<
    Partial<Record<RuntimePlatform, Readonly<{ os_release: string; glibc: string | null }>>>
  >;
  workspace: Readonly<{
    read: readonly WorkspaceCompatibility[];
    write: readonly WorkspaceCompatibility[];
  }>;
  components: readonly RuntimeComponent[];
  launches: readonly RuntimeLaunch[];
}>;
export type TrustedRuntimeManifest = Readonly<{ sha256: string; manifest: RuntimeManifest }>;
export type RuntimeHost = Readonly<{
  platform: RuntimePlatform;
  osRelease: string;
  glibc: string | null;
}>;
export type RuntimeHostContext = Readonly<{
  manifest: TrustedRuntimeManifest;
  cacheDir: string;
  cwd: string;
  entry: string;
  host: RuntimeHost;
}>;
