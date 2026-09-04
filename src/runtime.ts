import {
  inspectCliRuntime,
  runtimePackageRoot,
  assertRuntimeObservationMatches,
  validateRuntimeExpectation,
} from './lib/runtime/descriptor.js';
import type { CliRuntimeDescriptor } from './lib/runtime/types.js';
export {
  CLI_RUNTIME_DESCRIPTOR_SCHEMA,
  CLI_RUNTIME_EXPECTATION_SCHEMA,
  RUNTIME_PLATFORMS,
} from './lib/runtime/types.js';
export type {
  CliRuntimeDescriptor,
  CliRuntimeExpectation,
  RuntimeFileFact,
  RuntimePlatform,
} from './lib/runtime/types.js';

/** Observe this installed package without reading user configuration or accessing the network. */
export function describeCliRuntime(): CliRuntimeDescriptor {
  return inspectCliRuntime(runtimePackageRoot(import.meta.url), {
    executable: process.execPath,
    version: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  });
}

/** The caller supplies independently trusted expected release facts. This grants no account permission. */
export function assertCliRuntimeMatches(expected: unknown): CliRuntimeDescriptor {
  validateRuntimeExpectation(expected);
  return assertRuntimeObservationMatches(describeCliRuntime(), expected);
}

export {
  parseRuntimeManifest,
  trustRuntimeManifest,
  loadTrustedRuntimeManifest,
  assertWorkspaceCompatibility,
} from './lib/runtime/manifest.js';
export {
  RUNTIME_MANIFEST_SCHEMA,
  RUNTIME_BOOTSTRAP_PROTOCOL,
  RUNTIME_ARCHIVE_FORMAT,
} from './lib/runtime/manifest-types.js';
export type {
  RuntimeManifest,
  RuntimeComponent,
  RuntimeLaunch,
  ComponentFile,
  TrustedRuntimeManifest,
  RuntimeHost,
  WorkspaceCompatibility,
} from './lib/runtime/manifest-types.js';
export {
  ensureRuntimeComponents,
  inspectRuntimeComponents,
  pruneRuntimeComponents,
} from './lib/runtime/manager.js';
export type {
  RuntimeManagerOptions,
  RuntimeManagerReport,
  RuntimeComponentStatus,
} from './lib/runtime/manager.js';

export { executeRuntimeLaunch } from './lib/runtime/execute.js';
export type { RuntimeExecutionOptions } from './lib/runtime/execute.js';
export { writeRuntimeComponentArchive } from './lib/runtime/archive-writer.js';
