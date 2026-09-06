import { copyTrustedRuntimeManifestBytes, trustRuntimeManifest } from './manifest.js';
import { RUNTIME_HOST_CONTEXT_PROTOCOL } from './manifest-types.js';
import type { RuntimeHostContext, TrustedRuntimeManifest } from './manifest-types.js';

export const HOST_CONTEXT_TIMEOUT_MS = 30_000;
export type HostContextBinding = Readonly<{ nonce: string; parent_pid: number; child_pid: number }>;
export type HostContextMessage = Readonly<Record<string, string | number>>;
export type HostContextSendCallback = (error: Error | null) => void;
const bindingKeys = ['schema', 'kind', 'nonce', 'parent_pid', 'child_pid'];
const contextKeys = ['manifest_base64', 'manifest_sha256', 'cache_dir', 'cwd', 'entry'];

export function hostContextError(reason: string): Error {
  return Object.assign(new Error(`Runtime host context ${reason}.`), {
    code: 'RUNTIME_HOST_CONTEXT',
  });
}

function messageRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw hostContextError('message must be an object');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key)))
    throw hostContextError('message has unexpected fields');
  return record;
}

export function hostControlMessage(kind: string, binding: HostContextBinding): HostContextMessage {
  return { schema: RUNTIME_HOST_CONTEXT_PROTOCOL, kind, ...binding };
}

export function readHostRequest(
  value: unknown,
  parentPid: number,
  childPid: number,
): HostContextBinding {
  const message = messageRecord(value, bindingKeys);
  if (
    message.schema !== RUNTIME_HOST_CONTEXT_PROTOCOL ||
    message.kind !== 'request' ||
    typeof message.nonce !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(message.nonce) ||
    message.parent_pid !== parentPid ||
    message.child_pid !== childPid
  )
    throw hostContextError('request is not bound to this child');
  return Object.freeze({ nonce: message.nonce, parent_pid: parentPid, child_pid: childPid });
}

export function assertHostControl(value: unknown, kind: string, binding: HostContextBinding): void {
  assertBinding(messageRecord(value, bindingKeys), kind, binding);
}

function assertBinding(
  message: Record<string, unknown>,
  kind: string,
  binding: HostContextBinding,
): void {
  if (
    message.schema !== RUNTIME_HOST_CONTEXT_PROTOCOL ||
    message.kind !== kind ||
    message.nonce !== binding.nonce ||
    message.parent_pid !== binding.parent_pid ||
    message.child_pid !== binding.child_pid
  )
    throw hostContextError('message belongs to another handshake');
}

export function hostContextMessage(
  context: RuntimeHostContext,
  binding: HostContextBinding,
): HostContextMessage {
  return {
    ...hostControlMessage('context', binding),
    manifest_base64: copyTrustedRuntimeManifestBytes(context.manifest).toString('base64'),
    manifest_sha256: context.manifest.sha256,
    cache_dir: context.cacheDir,
    cwd: context.cwd,
    entry: context.entry,
  };
}

export function readHostContextMessage(
  value: unknown,
  binding: HostContextBinding,
): {
  manifest: TrustedRuntimeManifest;
  cacheDir: string;
  cwd: string;
  entry: string;
} {
  const message = messageRecord(value, [...bindingKeys, ...contextKeys]);
  assertBinding(message, 'context', binding);
  if (
    typeof message.manifest_base64 !== 'string' ||
    message.manifest_base64.length === 0 ||
    message.manifest_base64.length > 4 * Math.ceil((32 * 1024 * 1024) / 3) ||
    typeof message.manifest_sha256 !== 'string'
  )
    throw hostContextError('manifest exceeds its wire bound');
  const bytes = Buffer.from(message.manifest_base64, 'base64');
  if (bytes.toString('base64') !== message.manifest_base64)
    throw hostContextError('manifest encoding is not canonical');
  const stringField = (key: 'cache_dir' | 'cwd' | 'entry') => {
    const value = message[key];
    if (
      typeof value !== 'string' ||
      !value ||
      value.length > 32768 ||
      value
        .split('')
        .some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    )
      throw hostContextError('selection fields are invalid');
    return value;
  };
  return {
    manifest: trustRuntimeManifest(bytes, message.manifest_sha256),
    cacheDir: stringField('cache_dir'),
    cwd: stringField('cwd'),
    entry: stringField('entry'),
  };
}
