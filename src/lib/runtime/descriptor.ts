import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentHash, hashRuntimeFile, listRuntimeFiles, runtimeError } from './files.js';
import {
  CLI_RUNTIME_DESCRIPTOR_SCHEMA,
  CLI_RUNTIME_EXPECTATION_SCHEMA,
  RUNTIME_PLATFORMS,
} from './types.js';
import type { CliRuntimeDescriptor, CliRuntimeExpectation, RuntimePlatform } from './types.js';

const supportedNodeVersion = /^24\.(?:19|[2-9][0-9]|[1-9][0-9]{2,})\.(?:0|[1-9][0-9]*)$/u;

export function runtimePlatform(platform: string, arch: string): RuntimePlatform {
  const value = `${platform}-${arch}`;
  if (!RUNTIME_PLATFORMS.includes(value as RuntimePlatform)) {
    runtimeError(
      'RUNTIME_PLATFORM_UNSUPPORTED',
      'Supported platforms are macOS arm64, Linux x64/arm64 and Windows x64.',
    );
  }
  return value as RuntimePlatform;
}

export function runtimePackageRoot(moduleUrl: string): string {
  const modulePath = fileURLToPath(moduleUrl);
  const extension = path.extname(modulePath);
  if (!['.js', '.ts'].includes(extension) || path.basename(modulePath) !== `runtime${extension}`) {
    runtimeError(
      'RUNTIME_LAYOUT_INVALID',
      'The runtime API must use its declared source or emitted entry.',
    );
  }
  const root =
    extension === '.ts' ? path.resolve(modulePath, '../..') : path.resolve(modulePath, '../../..');
  const expected = path.join(
    root,
    ...(extension === '.ts' ? ['src', 'runtime.ts'] : ['dist', 'src', 'runtime.js']),
  );
  if (modulePath !== expected)
    runtimeError('RUNTIME_LAYOUT_INVALID', 'Runtime entry is outside the declared package layout.');
  return fs.realpathSync(root);
}

export function inspectCliRuntime(
  root: string,
  node: { executable: string; version: string; platform: string; arch: string },
): CliRuntimeDescriptor {
  const platform = runtimePlatform(node.platform, node.arch);
  if (!supportedNodeVersion.test(node.version)) {
    runtimeError(
      'RUNTIME_NODE_UNSUPPORTED',
      'CLI runtime requires stable Node 24.19 or later in the Node 24 line.',
    );
  }
  const packageRoot = fs.realpathSync(root);
  const files = listRuntimeFiles(packageRoot);
  const manifestBytes = fs.readFileSync(path.join(packageRoot, 'package.json'));
  const manifestFact = files.find((file) => file.path === 'package.json')!;
  if (createHash('sha256').update(manifestBytes).digest('hex') !== manifestFact.sha256)
    runtimeError('RUNTIME_FILE_CHANGED', 'Package manifest changed before parsing.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    runtimeError('RUNTIME_PACKAGE_INVALID', 'Runtime package manifest is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    runtimeError('RUNTIME_PACKAGE_INVALID', 'Runtime package manifest must be an object.');
  const manifest = parsed as Record<string, unknown>;
  const bin = manifest.bin as Record<string, unknown> | undefined;
  if (
    manifest.name !== '@tiangong-lca/cli' ||
    typeof manifest.version !== 'string' ||
    !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u.test(manifest.version) ||
    !bin ||
    bin['tiangong-lca'] !== './bin/tiangong-lca.js'
  ) {
    runtimeError(
      'RUNTIME_PACKAGE_INVALID',
      'Runtime package name, stable version or launcher contract is invalid.',
    );
  }
  for (const required of ['bin/tiangong-lca.js', 'dist/src/main.js', 'dist/src/runtime.js']) {
    if (!files.some((file) => file.path === required))
      runtimeError('RUNTIME_NOT_BUILT', 'Installed runtime is missing a required emitted entry.');
  }
  const assets = files.filter((file) => file.path.startsWith('assets/tidas-schemas/'));
  if (assets.length === 0)
    runtimeError('RUNTIME_ASSETS_MISSING', 'Installed runtime contains no TIDAS schema assets.');
  const nodePath = fs.realpathSync(node.executable);
  const nodeFact = hashRuntimeFile(nodePath, nodePath);
  const currentManifest = hashRuntimeFile(path.join(packageRoot, 'package.json'), 'package.json');
  if (manifestFact.sha256 !== currentManifest.sha256)
    runtimeError('RUNTIME_FILE_CHANGED', 'Package manifest changed during inspection.');
  return Object.freeze({
    schema: CLI_RUNTIME_DESCRIPTOR_SCHEMA,
    scope: 'cli-package',
    package: Object.freeze({
      name: '@tiangong-lca/cli',
      version: manifest.version,
      root: packageRoot,
      manifest_sha256: manifestFact.sha256,
    }),
    platform,
    node: Object.freeze({
      version: node.version,
      executable: nodePath,
      bytes: nodeFact.bytes,
      sha256: nodeFact.sha256,
    }),
    command: Object.freeze({
      executable: nodePath,
      argv: Object.freeze([path.join(packageRoot, 'bin', 'tiangong-lca.js')]),
    }),
    assets: Object.freeze({
      tidas_schema_root: path.join(packageRoot, 'assets', 'tidas-schemas'),
      sha256: contentHash(assets),
    }),
    files,
    content_sha256: contentHash(files),
  });
}

export function validateRuntimeExpectation(value: unknown): asserts value is CliRuntimeExpectation {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    runtimeError(
      'RUNTIME_EXPECTATION_INVALID',
      'Select exact runtime facts from a trusted release manifest.',
    );
  const expected = value as Record<string, unknown>;
  if (
    Object.keys(expected).sort().join(',') !==
      'content_sha256,node_sha256,node_version,package_version,platform,schema' ||
    expected.schema !== CLI_RUNTIME_EXPECTATION_SCHEMA ||
    typeof expected.package_version !== 'string' ||
    !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u.test(expected.package_version) ||
    !RUNTIME_PLATFORMS.includes(expected.platform as RuntimePlatform) ||
    typeof expected.content_sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(expected.content_sha256) ||
    typeof expected.node_version !== 'string' ||
    !supportedNodeVersion.test(expected.node_version) ||
    typeof expected.node_sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(expected.node_sha256)
  ) {
    runtimeError(
      'RUNTIME_EXPECTATION_INVALID',
      'Select exact runtime facts from a trusted release manifest.',
    );
  }
}

export function assertRuntimeObservationMatches(
  actual: CliRuntimeDescriptor,
  expected: unknown,
): CliRuntimeDescriptor {
  validateRuntimeExpectation(expected);
  if (
    actual.package.version !== expected.package_version ||
    actual.platform !== expected.platform ||
    actual.content_sha256 !== expected.content_sha256 ||
    actual.node.version !== expected.node_version ||
    actual.node.sha256 !== expected.node_sha256
  ) {
    runtimeError(
      'RUNTIME_IDENTITY_MISMATCH',
      'Installed CLI/Node content does not match the selected release.',
    );
  }
  return actual;
}
