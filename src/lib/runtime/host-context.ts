import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { componentKey } from './manifest.js';
import { inspectRuntimeHost } from './host.js';
import { inspectRuntimeComponents } from './manager.js';
import { openRuntimeCache, cachePath } from './storage.js';
import {
  runtimeWorkDirectory,
  assertRuntimeWorkDirectoryOutsideInstall,
} from './work-directory.js';
import { RUNTIME_HOST_CONTEXT_PROTOCOL, type RuntimeHostContext } from './manifest-types.js';
import {
  HOST_CONTEXT_TIMEOUT_MS,
  assertHostControl,
  hostContextError,
  hostControlMessage,
  readHostContextMessage,
  type HostContextMessage,
  type HostContextSendCallback,
} from './host-context-protocol.js';

type Listener = (value?: unknown) => void;
export type RuntimeHostProcess = {
  pid: number;
  ppid: number;
  execPath: string;
  cwd(): string;
  connected?: boolean;
  send?: (message: HostContextMessage, callback: HostContextSendCallback) => unknown;
  disconnect?: () => void;
  on(event: 'message' | 'disconnect', listener: Listener): unknown;
  off(event: 'message' | 'disconnect', listener: Listener): unknown;
};
const claimed = new WeakSet<RuntimeHostProcess>();

function validateSelection(
  input: ReturnType<typeof readHostContextMessage>,
  child: RuntimeHostProcess,
): RuntimeHostContext {
  if (!path.isAbsolute(input.cacheDir) || !path.isAbsolute(input.cwd))
    throw hostContextError('requires absolute cache and work directories');
  const cacheDir = openRuntimeCache(input.cacheDir, false);
  const cwd = runtimeWorkDirectory(input.cwd);
  if (cwd !== fs.realpathSync(child.cwd())) throw hostContextError('work directory changed');
  assertRuntimeWorkDirectoryOutsideInstall(cwd, cacheDir);
  const host = inspectRuntimeHost();
  const launch = input.manifest.manifest.launches.find(
    (item) => item.platform === host.platform && item.id === input.entry,
  );
  if (launch?.context_protocol !== RUNTIME_HOST_CONTEXT_PROTOCOL)
    throw hostContextError('launch did not select this protocol');
  if (inspectRuntimeComponents(input.manifest, { cacheDir, host }).status !== 'ready')
    throw hostContextError('selected components changed');
  const component = input.manifest.manifest.components.find(
    (item) => item.platform === host.platform && item.id === launch.executable.component,
  )!;
  const executable = cachePath(
    cacheDir,
    `components/${componentKey(component)}/root/${launch.executable.path}`,
  );
  const expected = fs.statSync(executable, { bigint: true }),
    actual = fs.statSync(child.execPath, { bigint: true });
  if (expected.dev !== actual.dev || expected.ino !== actual.ino)
    throw hostContextError('executable is not the declared managed Node');
  return Object.freeze({ ...input, cacheDir, cwd, host });
}

function receiveFromProcess(child: RuntimeHostProcess): Promise<RuntimeHostContext> {
  return new Promise((resolve, reject) => {
    if (!child.connected || !child.send || !child.disconnect) {
      reject(hostContextError('requires an inherited manager IPC channel'));
      return;
    }
    if (claimed.has(child)) {
      reject(hostContextError('handshake was already consumed'));
      return;
    }
    claimed.add(child);
    const binding = Object.freeze({
      nonce: randomBytes(32).toString('hex'),
      parent_pid: child.ppid,
      child_pid: child.pid,
    });
    let context: RuntimeHostContext | undefined;
    let ready = false,
      settled = false,
      closing = false;
    const disconnect = () => {
      if (closing || !child.connected) return;
      closing = true;
      child.disconnect!();
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off('message', message);
      child.off('disconnect', disconnected);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : hostContextError('transport failed'));
      try {
        disconnect();
      } catch {
        /* Preserve the original failure; the owning manager drains the child. */
      }
    };
    const send = (value: HostContextMessage) =>
      child.send!(value, (error) => {
        if (error) fail(error);
      });
    const message = (value: unknown) => {
      try {
        if (!context) {
          context = validateSelection(readHostContextMessage(value, binding), child);
          send(hostControlMessage('accept', binding));
        } else if (!ready) {
          assertHostControl(value, 'ready', binding);
          ready = true;
          disconnect();
        } else throw hostContextError('message is repeated or out of order');
      } catch (error) {
        fail(error);
      }
    };
    const disconnected = () => {
      if (!ready) {
        fail(hostContextError('manager closed before confirming acceptance'));
        return;
      }
      settled = true;
      cleanup();
      resolve(context!);
    };
    const timer = setTimeout(
      () => fail(hostContextError('handshake timed out')),
      HOST_CONTEXT_TIMEOUT_MS,
    );
    child.on('message', message);
    child.on('disconnect', disconnected);
    try {
      send(hostControlMessage('request', binding));
    } catch (error) {
      fail(error);
    }
  });
}

/** Receive only the owning manager's one-use IPC handoff, before loading task input. */
export function receiveRuntimeHostContext(): Promise<RuntimeHostContext> {
  return receiveFromProcess(process);
}
export const runtimeHostContextInternals = { receiveFromProcess, validateSelection };
