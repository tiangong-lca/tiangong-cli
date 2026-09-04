export const CLI_RUNTIME_DESCRIPTOR_SCHEMA = 'tiangong-lca.cli-runtime-descriptor.v1' as const;
export const CLI_RUNTIME_EXPECTATION_SCHEMA = 'tiangong-lca.cli-runtime-expectation.v1' as const;
export const RUNTIME_PLATFORMS = Object.freeze([
  'darwin-arm64',
  'linux-x64',
  'linux-arm64',
  'win32-x64',
] as const);
export type RuntimePlatform = (typeof RUNTIME_PLATFORMS)[number];

export type RuntimeFileFact = Readonly<{ path: string; bytes: number; sha256: string }>;
export type CliRuntimeDescriptor = Readonly<{
  schema: typeof CLI_RUNTIME_DESCRIPTOR_SCHEMA;
  scope: 'cli-package';
  package: Readonly<{
    name: '@tiangong-lca/cli';
    version: string;
    root: string;
    manifest_sha256: string;
  }>;
  platform: RuntimePlatform;
  node: Readonly<{ version: string; executable: string; bytes: number; sha256: string }>;
  command: Readonly<{ executable: string; argv: readonly string[] }>;
  assets: Readonly<{ tidas_schema_root: string; sha256: string }>;
  files: readonly RuntimeFileFact[];
  content_sha256: string;
}>;

/** Supplied by an independent trusted release/component manifest, never copied from the observation being checked. */
export type CliRuntimeExpectation = Readonly<{
  schema: typeof CLI_RUNTIME_EXPECTATION_SCHEMA;
  package_version: string;
  platform: RuntimePlatform;
  content_sha256: string;
  node_version: string;
  node_sha256: string;
}>;
