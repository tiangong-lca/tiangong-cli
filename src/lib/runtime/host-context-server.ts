import type { ChildProcess } from 'node:child_process';
import type { RuntimeHostContext } from './manifest-types.js';
import {
  HOST_CONTEXT_TIMEOUT_MS,
  assertHostControl,
  hostContextError,
  hostContextMessage,
  hostControlMessage,
  readHostRequest,
  type HostContextBinding,
  type HostContextMessage,
} from './host-context-protocol.js';

/** One IPC handshake, owned by the same process that holds the execution lease. */
export function serveRuntimeHostContext(
  child: ChildProcess,
  context: RuntimeHostContext,
  onFailure: (error: Error) => void,
): { finish(): Error | undefined } {
  let phase: 'request' | 'accept' | 'ready' | 'complete' | 'failed' = 'request';
  let binding: HostContextBinding | undefined;
  let readySent = false,
    clientClosed = false;
  const cleanup = () => {
    clearTimeout(timer);
    child.off('message', message);
    child.off('disconnect', disconnected);
  };
  const fail = (error: unknown) => {
    if (phase === 'failed' || phase === 'complete') return;
    phase = 'failed';
    cleanup();
    onFailure(error instanceof Error ? error : hostContextError('transport failed'));
  };
  const complete = () => {
    if (readySent && clientClosed) {
      phase = 'complete';
      cleanup();
    }
  };
  const send = (frame: HostContextMessage, ready = false) => {
    if (!child.connected || !child.send) throw hostContextError('channel is unavailable');
    child.send(frame, (error) => {
      if (error) {
        fail(error);
        return;
      }
      if (ready && phase === 'ready') {
        readySent = true;
        complete();
      }
    });
  };
  const message = (value: unknown) => {
    try {
      if (phase === 'request') {
        if (!child.pid) throw hostContextError('child identity is unavailable');
        binding = readHostRequest(value, process.pid, child.pid);
        phase = 'accept';
        send(hostContextMessage(context, binding));
      } else if (phase === 'accept') {
        assertHostControl(value, 'accept', binding!);
        phase = 'ready';
        send(hostControlMessage('ready', binding!), true);
      } else throw hostContextError('message is repeated or out of order');
    } catch (error) {
      fail(error);
    }
  };
  const disconnected = () => {
    if (phase === 'ready') {
      clientClosed = true;
      complete();
    } else fail(hostContextError('channel closed before acceptance'));
  };
  const timer = setTimeout(
    () => fail(hostContextError('handshake timed out')),
    HOST_CONTEXT_TIMEOUT_MS,
  );
  child.on('message', message);
  child.on('disconnect', disconnected);
  return {
    finish() {
      const error =
        phase === 'complete' ? undefined : hostContextError('child closed before acceptance');
      if (error) phase = 'failed';
      cleanup();
      return error;
    },
  };
}
