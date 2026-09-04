import { runtimeError } from './files.js';
import { RUNTIME_PLATFORMS, type RuntimePlatform } from './types.js';

export function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(label);
  return value as Record<string, unknown>;
}
export function invalid(label: string): never {
  return runtimeError('RUNTIME_MANIFEST_INVALID', `Runtime manifest has invalid ${label}.`);
}
export function exact(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    invalid(label);
}
export function text(value: unknown, label: string, max = 256): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > max ||
    value.split('').some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    invalid(label);
  return value;
}
export function id(value: unknown): string {
  const result = text(value, 'identifier', 64);
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(result) || result === '.' || result === '..')
    invalid('identifier');
  return result;
}
export function version(value: unknown): string {
  const result = text(value, 'version', 40);
  if (!/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u.test(result))
    invalid('exact stable version');
  return result;
}
export function sha(value: unknown): string {
  const result = text(value, 'SHA-256', 64);
  if (!/^[0-9a-f]{64}$/u.test(result)) invalid('SHA-256');
  return result;
}
export function integer(value: unknown, max: number, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > max)
    invalid('bounded integer');
  return value;
}
export function array(value: unknown, max: number, minimum = 0): unknown[] {
  if (!Array.isArray(value) || value.length > max || value.length < minimum)
    invalid('bounded array');
  return value;
}
export function platform(value: unknown): RuntimePlatform {
  if (!RUNTIME_PLATFORMS.includes(value as RuntimePlatform)) invalid('platform');
  return value as RuntimePlatform;
}
export function relativeFile(value: unknown): string {
  const result = text(value, 'portable file path', 255);
  if (
    Buffer.byteLength(result) > 255 ||
    result.includes('\\') ||
    result.includes(':') ||
    result.startsWith('/') ||
    result
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          /^(?:\.env(?:\..*)?|\.git|\.npmrc|\.ssh)$/iu.test(part) ||
          /[. ]$/u.test(part) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
      )
  )
    invalid('portable file path');
  const segments = result.split('/');
  if (
    segments.length > 32 ||
    Buffer.byteLength(segments.at(-1)!) > 100 ||
    (Buffer.byteLength(result) > 100 &&
      !segments
        .slice(0, -1)
        .some(
          (_, i) =>
            Buffer.byteLength(segments.slice(0, i + 1).join('/')) <= 155 &&
            Buffer.byteLength(segments.slice(i + 1).join('/')) <= 100,
        ))
  )
    invalid('USTAR path');
  return result;
}
export function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) invalid(`duplicate ${label}`);
}
export function distributionUrl(value: unknown, redirected = false): string {
  const input = text(value, 'distribution URL', 4096);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    invalid('distribution URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port)
    invalid('distribution URL');
  const primary = ['github.com', 'nodejs.org', 'registry.npmjs.org'];
  const redirects = ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'];
  if (!primary.includes(url.hostname) && !(redirected && redirects.includes(url.hostname)))
    invalid('distribution origin');
  if (!redirected) {
    if (url.search || /\/(?:latest|heads)(?:\/|$)/u.test(url.pathname))
      invalid('immutable distribution URL');
    if (
      url.hostname === 'github.com' &&
      !/^\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/[^/]+$/u.test(url.pathname)
    )
      invalid('release asset URL');
    if (
      url.hostname === 'nodejs.org' &&
      !/^\/dist\/v[0-9]+\.[0-9]+\.[0-9]+\/[^/]+$/u.test(url.pathname)
    )
      invalid('Node release URL');
    if (
      url.hostname === 'registry.npmjs.org' &&
      !/\/-\/[^/]+-[0-9]+\.[0-9]+\.[0-9]+\.tgz$/u.test(url.pathname)
    )
      invalid('registry tarball URL');
  }
  return url.href;
}
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
