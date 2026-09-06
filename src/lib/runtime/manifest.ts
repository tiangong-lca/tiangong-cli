import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { contentHash, runtimeError } from './files.js';
import {
  array,
  deepFreeze,
  distributionUrl,
  exact,
  id,
  integer,
  invalid,
  platform,
  record,
  relativeFile,
  sha,
  text,
  unique,
  version,
} from './manifest-values.js';
import {
  RUNTIME_ARCHIVE_FORMAT,
  RUNTIME_BOOTSTRAP_PROTOCOL,
  RUNTIME_MANIFEST_SCHEMA,
  RUNTIME_HOST_CONTEXT_PROTOCOL,
} from './manifest-types.js';
import type {
  ComponentFile,
  ComponentPath,
  RuntimeComponent,
  RuntimeLaunch,
  RuntimeManifest,
  TrustedRuntimeManifest,
  WorkspaceCompatibility,
} from './manifest-types.js';
const trusted = new WeakMap<object, Buffer>();

function compatibility(value: unknown): WorkspaceCompatibility[] {
  const result = array(value, 32).map((item) => {
    const entry = record(item, 'workspace compatibility');
    exact(entry, ['schema', 'features'], 'workspace compatibility');
    const features = array(entry.features, 64).map((value) =>
      text(value, 'workspace feature', 128),
    );
    unique(features, 'workspace feature');
    return { schema: text(entry.schema, 'workspace schema', 128), features };
  });
  unique(
    result.map((entry) => entry.schema),
    'workspace schema',
  );
  return result;
}
function component(value: unknown): RuntimeComponent {
  const item = record(value, 'component');
  exact(
    item,
    [
      'id',
      'version',
      'platform',
      'archive',
      'files',
      'content_sha256',
      'production_lock',
      'sbom',
      'licenses',
      'provenance',
      'protocols',
      'asset_fingerprints',
    ],
    'component',
  );
  const archive = record(item.archive, 'archive');
  exact(archive, ['format', 'url', 'bytes', 'sha256'], 'archive');
  if (archive.format !== RUNTIME_ARCHIVE_FORMAT) invalid('archive format');
  let total = 0;
  const files: ComponentFile[] = array(item.files, 50_000, 1).map((value) => {
    const file = record(value, 'component file');
    exact(file, ['path', 'bytes', 'sha256', 'mode'], 'component file');
    if (file.mode !== 420 && file.mode !== 493) invalid('file mode');
    const bytes = integer(file.bytes, 512 * 1024 * 1024);
    total += bytes;
    return { path: relativeFile(file.path), bytes, sha256: sha(file.sha256), mode: file.mode };
  });
  if (total > 2 * 1024 * 1024 * 1024) invalid('unpacked size');
  const paths = files.map((file) => file.path);
  unique(
    paths.map((path) => path.toLowerCase()),
    'case-folded file path',
  );
  if (JSON.stringify(paths) !== JSON.stringify([...paths].sort())) invalid('file order');
  const pathSet = new Set(paths.map((path) => path.toLowerCase()));
  for (const file of paths) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++)
      if (pathSet.has(parts.slice(0, i).join('/').toLowerCase()))
        invalid('file/directory collision');
  }
  const content = sha(item.content_sha256);
  if (content !== contentHash(files)) invalid('component content SHA-256');
  const requiredFile = (value: unknown) => {
    const file = relativeFile(value);
    if (!paths.includes(file)) invalid('metadata file reference');
    return file;
  };
  const licenses = array(item.licenses, 64, 1).map(requiredFile),
    provenance = array(item.provenance, 64, 1).map(requiredFile);
  unique(licenses, 'license');
  unique(provenance, 'provenance');
  const protocols = array(item.protocols, 32, 1).map((value) =>
    text(value, 'component protocol', 128),
  );
  unique(protocols, 'protocol');
  const fingerprints = record(item.asset_fingerprints, 'asset fingerprints');
  if (Object.keys(fingerprints).length > 64) invalid('fingerprint count');
  const asset_fingerprints = Object.fromEntries(
    Object.entries(fingerprints).map(([key, value]) => [id(key), sha(value)]),
  );
  return {
    id: id(item.id),
    version: version(item.version),
    platform: platform(item.platform),
    archive: {
      format: RUNTIME_ARCHIVE_FORMAT,
      url: distributionUrl(archive.url),
      bytes: integer(archive.bytes, 512 * 1024 * 1024, 1),
      sha256: sha(archive.sha256),
    },
    files,
    content_sha256: content,
    production_lock: requiredFile(item.production_lock),
    sbom: requiredFile(item.sbom),
    licenses,
    provenance,
    protocols,
    asset_fingerprints,
  };
}
function componentPath(
  value: unknown,
  components: readonly RuntimeComponent[],
  target: string,
  executable = false,
): ComponentPath {
  const entry = record(value, 'component path');
  exact(entry, ['component', 'path'], 'component path');
  const componentId = id(entry.component),
    file = relativeFile(entry.path);
  const owner = components.find((item) => item.platform === target && item.id === componentId);
  const fact = owner?.files.find((item) => item.path === file);
  if (!fact || (executable && fact.mode !== 493)) invalid('launch file reference');
  return { component: componentId, path: file };
}
export function parseRuntimeManifest(value: unknown): RuntimeManifest {
  const item = record(value, 'manifest');
  exact(
    item,
    [
      'schema',
      'bootstrap_protocol',
      'product',
      'minimum_hosts',
      'workspace',
      'components',
      'launches',
    ],
    'manifest',
  );
  if (
    item.schema !== RUNTIME_MANIFEST_SCHEMA ||
    item.bootstrap_protocol !== RUNTIME_BOOTSTRAP_PROTOCOL
  )
    invalid('manifest protocol version');
  const product = record(item.product, 'product');
  exact(product, ['id', 'version'], 'product');
  const workspace = record(item.workspace, 'workspace');
  exact(workspace, ['read', 'write'], 'workspace');
  const read = compatibility(workspace.read),
    write = compatibility(workspace.write);
  for (const entry of write)
    if (
      !read.some(
        (candidate) =>
          candidate.schema === entry.schema &&
          entry.features.every((feature) => candidate.features.includes(feature)),
      )
    )
      invalid('write compatibility outside read support');
  const components = array(item.components, 128, 1).map(component);
  unique(
    components.map((item) => `${item.platform}:${item.id}`),
    'platform component',
  );
  const minimum = record(item.minimum_hosts, 'minimum hosts');
  const minimum_hosts = Object.fromEntries(
    Object.entries(minimum).map(([key, value]) => {
      const target = platform(key),
        host = record(value, 'minimum host');
      exact(host, ['os_release', 'glibc'], 'minimum host');
      if (
        (target.startsWith('linux-') && typeof host.glibc !== 'string') ||
        (!target.startsWith('linux-') && host.glibc !== null)
      )
        invalid('host ABI');
      const glibc = host.glibc === null ? null : text(host.glibc, 'glibc version', 40);
      if (glibc !== null && !/^[0-9]+\.[0-9]+$/u.test(glibc)) invalid('glibc version');
      return [target, { os_release: version(host.os_release), glibc }];
    }),
  );
  const supported = [...new Set(components.map((item) => item.platform))].sort();
  if (JSON.stringify(Object.keys(minimum_hosts).sort()) !== JSON.stringify(supported))
    invalid('host/component platform coverage');
  const launches: RuntimeLaunch[] = array(item.launches, 64, 1).map((value) => {
    const launch = record(value, 'launch');
    const hasContext = Object.hasOwn(launch, 'context_protocol');
    exact(
      launch,
      [
        'id',
        'platform',
        'executable',
        'environment',
        'argv',
        ...(hasContext ? ['context_protocol'] : []),
      ],
      'launch',
    );
    if (hasContext && launch.context_protocol !== RUNTIME_HOST_CONTEXT_PROTOCOL)
      invalid('host context protocol');
    if (launch.environment !== 'isolated' && launch.environment !== 'cli-auth')
      invalid('launch environment');
    const target = platform(launch.platform);
    const argv = array(launch.argv, 32).map((value) => {
      const arg = record(value, 'launch argument');
      if (Object.hasOwn(arg, 'literal')) {
        exact(arg, ['literal'], 'literal argument');
        return { literal: text(arg.literal, 'literal argument', 4096) };
      }
      return componentPath(arg, components, target);
    });
    return {
      id: id(launch.id),
      platform: target,
      executable: componentPath(launch.executable, components, target, true),
      environment: launch.environment,
      ...(hasContext ? { context_protocol: RUNTIME_HOST_CONTEXT_PROTOCOL } : {}),
      argv,
    };
  });
  unique(
    launches.map((item) => `${item.platform}:${item.id}`),
    'platform launch',
  );
  for (const target of supported)
    if (!launches.some((launch) => launch.platform === target)) invalid('platform launch coverage');
  return deepFreeze({
    schema: RUNTIME_MANIFEST_SCHEMA,
    bootstrap_protocol: RUNTIME_BOOTSTRAP_PROTOCOL,
    product: { id: id(product.id), version: version(product.version) },
    minimum_hosts,
    workspace: { read, write },
    components,
    launches,
  });
}
export function trustRuntimeManifest(
  bytes: Uint8Array,
  expectedSha256: string,
): TrustedRuntimeManifest {
  sha(expectedSha256);
  if (bytes.byteLength > 32 * 1024 * 1024)
    runtimeError(
      'RUNTIME_MANIFEST_INTEGRITY',
      'Runtime manifest bytes do not match the independent trust anchor.',
    );
  const snapshot = Buffer.from(bytes);
  if (createHash('sha256').update(snapshot).digest('hex') !== expectedSha256)
    runtimeError(
      'RUNTIME_MANIFEST_INTEGRITY',
      'Runtime manifest bytes do not match the independent trust anchor.',
    );
  let value: unknown;
  try {
    value = JSON.parse(snapshot.toString('utf8'));
  } catch {
    invalid('JSON');
  }
  const result = Object.freeze({ sha256: expectedSha256, manifest: parseRuntimeManifest(value) });
  trusted.set(result, snapshot);
  return result;
}
export function loadTrustedRuntimeManifest(
  file: string,
  expectedSha256: string,
): TrustedRuntimeManifest {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024)
    runtimeError('RUNTIME_MANIFEST_FILE', 'Runtime manifest must be a bounded regular file.');
  return trustRuntimeManifest(fs.readFileSync(file), expectedSha256);
}
export function assertTrustedManifest(value: TrustedRuntimeManifest): void {
  if (!value || !trusted.has(value))
    runtimeError(
      'RUNTIME_MANIFEST_UNTRUSTED',
      'Supply a manifest verified against an independent trusted digest.',
    );
}
export function copyTrustedRuntimeManifestBytes(value: TrustedRuntimeManifest): Buffer {
  const bytes = trusted.get(value);
  if (!bytes)
    runtimeError(
      'RUNTIME_MANIFEST_UNTRUSTED',
      'Supply a manifest verified against an independent trusted digest.',
    );
  return Buffer.from(bytes);
}
export function componentKey(value: RuntimeComponent): string {
  return contentHash(value);
}
export function assertWorkspaceCompatibility(
  value: TrustedRuntimeManifest,
  request: WorkspaceCompatibility,
  access: 'read' | 'write',
): void {
  assertTrustedManifest(value);
  const support = value.manifest.workspace[access]?.find(
    (entry) => entry.schema === request.schema,
  );
  if (!support || !request.features.every((feature) => support.features.includes(feature)))
    runtimeError(
      'RUNTIME_WORKSPACE_INCOMPATIBLE',
      'The selected runtime does not support the requested workspace access/schema/features.',
    );
}
