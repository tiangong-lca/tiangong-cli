import os from 'node:os';
import { runtimePlatform } from './descriptor.js';
import { assertTrustedManifest } from './manifest.js';
import { runtimeError } from './files.js';
import type { RuntimeHost, TrustedRuntimeManifest } from './manifest-types.js';

function compareVersions(left: string, right: string): number {
  const a = left.split(/[.-]/u).slice(0, 3).map(Number),
    b = right.split('.').map(Number);
  if (a.some((value) => !Number.isSafeInteger(value) || value < 0)) return -1;
  for (let i = 0; i < 3; i++) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}
export function inspectRuntimeHost(): RuntimeHost {
  const platform = runtimePlatform(process.platform, process.arch);
  let glibc: string | null = null;
  if (process.platform === 'linux') {
    // Project only the ABI header; never serialize a diagnostic report or its environment.
    const report = process.report.getReport() as { header?: { glibcVersionRuntime?: unknown } };
    if (typeof report.header?.glibcVersionRuntime === 'string')
      glibc = report.header.glibcVersionRuntime;
  }
  return Object.freeze({ platform, osRelease: os.release(), glibc });
}
export function assertRuntimeHost(value: TrustedRuntimeManifest, host: RuntimeHost): void {
  assertTrustedManifest(value);
  const minimum = value.manifest.minimum_hosts[host.platform];
  if (
    !minimum ||
    compareVersions(host.osRelease, minimum.os_release) < 0 ||
    (host.platform.startsWith('linux-') &&
      (!host.glibc || !minimum.glibc || compareVersions(host.glibc, minimum.glibc) < 0))
  )
    runtimeError(
      'RUNTIME_HOST_UNSUPPORTED',
      'The selected release does not support this host OS/architecture/ABI.',
    );
}
export const runtimeHostInternals = { compareVersions };
