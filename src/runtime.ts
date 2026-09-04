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
