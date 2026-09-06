import assert from 'node:assert/strict';
import test from 'node:test';
import { ChildProcess } from 'node:child_process';
import { runtimeComponentFixture, hash } from './helpers/runtime-component.js';
import {
  trustRuntimeManifest,
  copyTrustedRuntimeManifestBytes,
  parseRuntimeManifest,
} from '../src/lib/runtime/manifest.js';
import { inspectRuntimeHost } from '../src/lib/runtime/host.js';
import {
  RUNTIME_HOST_CONTEXT_PROTOCOL,
  type RuntimeHostContext,
} from '../src/lib/runtime/manifest-types.js';
import {
  HOST_CONTEXT_TIMEOUT_MS,
  assertHostControl,
  hostControlMessage,
  hostContextMessage,
  readHostContextMessage,
  readHostRequest,
  type HostContextMessage,
  type HostContextSendCallback,
} from '../src/lib/runtime/host-context-protocol.js';
import { serveRuntimeHostContext } from '../src/lib/runtime/host-context-server.js';
import { spawnRuntimeProcess } from '../src/lib/runtime/process.js';
import { runtimeChildEnvironment } from '../src/lib/runtime/execute.js';

function fixture() {
  const f = runtimeComponentFixture();
  const bytes = Buffer.from(JSON.stringify(f.manifest, null, 2) + '\n');
  const context: RuntimeHostContext = {
    manifest: trustRuntimeManifest(bytes, hash(bytes)),
    cacheDir: f.cacheDir,
    cwd: f.dir,
    entry: 'tool',
    host: inspectRuntimeHost(),
  };
  const binding = { nonce: 'a'.repeat(64), parent_pid: process.pid, child_pid: 12345 };
  return { ...f, bytes, context, binding };
}

test('wire context preserves original bytes and rejects malformed, mismatched and self-restored authority', () => {
  const f = fixture();
  try {
    const request = hostControlMessage('request', f.binding);
    assert.deepEqual(readHostRequest(request, process.pid, 12345), f.binding);
    const frame = hostContextMessage(f.context, f.binding);
    const result = readHostContextMessage(frame, f.binding);
    assert.deepEqual(copyTrustedRuntimeManifestBytes(result.manifest), f.bytes);
    assert.equal(result.manifest.sha256, f.context.manifest.sha256);
    for (const value of [null, [], false, {}, { ...request, extra: true }])
      assert.throws(() => readHostRequest(value, process.pid, 12345), /Runtime host context/u);
    for (const [key, value] of [
      ['schema', 'unknown'],
      ['kind', 'accept'],
      ['nonce', null],
      ['nonce', 'x'.repeat(64)],
      ['parent_pid', 1],
      ['child_pid', 1],
    ])
      assert.throws(
        () => readHostRequest({ ...request, [key as string]: value }, process.pid, 12345),
        /bound/u,
      );
    for (const key of ['schema', 'kind', 'nonce', 'parent_pid', 'child_pid'])
      assert.throws(
        () => assertHostControl({ ...request, [key]: 'wrong' }, 'request', f.binding),
        /handshake/u,
      );
    assertHostControl(request, 'request', f.binding);
    for (const value of [null, {}, { ...frame, env: {} }, { ...frame, nonce: 'b'.repeat(64) }])
      assert.throws(() => readHostContextMessage(value, f.binding));
    for (const value of [null, '', 'x'.repeat(4 * Math.ceil((32 * 1024 * 1024) / 3) + 1)])
      assert.throws(
        () => readHostContextMessage({ ...frame, manifest_base64: value }, f.binding),
        /wire bound/u,
      );
    assert.throws(
      () => readHostContextMessage({ ...frame, manifest_sha256: null }, f.binding),
      /wire bound/u,
    );
    assert.throws(
      () => readHostContextMessage({ ...frame, manifest_base64: '!!' }, f.binding),
      /canonical/u,
    );
    assert.throws(
      () => readHostContextMessage({ ...frame, manifest_sha256: '0'.repeat(64) }, f.binding),
      /trust anchor/u,
    );
    for (const key of ['cache_dir', 'cwd', 'entry'])
      for (const value of [null, '', 'x'.repeat(32769), 'bad\npath', 'bad\x7fpath'])
        assert.throws(
          () => readHostContextMessage({ ...frame, [key]: value }, f.binding),
          /selection fields/u,
        );
    assert.throws(
      () => hostContextMessage({ ...f.context, manifest: { ...f.context.manifest } }, f.binding),
      /independent trusted/u,
    );
  } finally {
    f.close();
  }
});

test('manifest host protocol is opt-in and admits only its exact version', () => {
  const f = fixture();
  try {
    const make = (value: unknown) => ({
      ...f.manifest,
      launches: [{ ...f.manifest.launches[0], context_protocol: value }],
    });
    const selected = parseRuntimeManifest(make(RUNTIME_HOST_CONTEXT_PROTOCOL));
    assert.equal(selected.launches[0]!.context_protocol, RUNTIME_HOST_CONTEXT_PROTOCOL);
    assert.equal(
      Object.hasOwn(parseRuntimeManifest(f.manifest).launches[0]!, 'context_protocol'),
      false,
    );
    for (const value of [undefined, null, false, '', 'tiangong-lca.runtime-host.v2'])
      assert.throws(() => parseRuntimeManifest(make(value)), /host context protocol/u);
  } finally {
    f.close();
  }
});

function fakeChild() {
  const child = new ChildProcess();
  const sent: HostContextMessage[] = [],
    callbacks: HostContextSendCallback[] = [];
  Object.assign(child, { connected: true, pid: 12345 });
  Object.defineProperty(child, 'send', {
    configurable: true,
    value: (message: HostContextMessage, callback: HostContextSendCallback) => {
      sent.push(message);
      callbacks.push(callback);
      return true;
    },
  });
  Object.defineProperty(child, 'disconnect', {
    configurable: true,
    value: () => {
      Object.defineProperty(child, 'connected', { value: false });
      child.emit('disconnect');
    },
  });
  return { child, sent, callbacks };
}

test('manager sends one bound snapshot and confirms acceptance before closing the channel', () => {
  const f = fixture(),
    peer = fakeChild(),
    errors: Error[] = [];
  const session = serveRuntimeHostContext(peer.child, f.context, (error) => errors.push(error));
  try {
    peer.child.emit('message', hostControlMessage('request', f.binding));
    assert.deepEqual(peer.sent[0], hostContextMessage(f.context, f.binding));
    peer.callbacks[0]!(null);
    peer.child.emit('message', hostControlMessage('accept', f.binding));
    assert.equal(peer.child.connected, true);
    assert.equal(peer.sent[1]!.kind, 'ready');
    peer.callbacks[1]!(null);
    assert.equal(peer.child.connected, true);
    peer.child.disconnect();
    assert.equal(peer.child.connected, false);
    assert.equal(peer.child.listenerCount('message'), 0);
    assert.deepEqual(errors, []);
    assert.equal(session.finish(), undefined);
    peer.callbacks[0]!(new Error('late callback'));
    assert.deepEqual(errors, []);
  } finally {
    session.finish();
    f.close();
  }
});

test('manager rejects malformed or repeated control, unavailable channels and failed sends', () => {
  const f = fixture();
  try {
    for (const setup of [
      (p: ReturnType<typeof fakeChild>) => p.child.emit('message', null),
      (p: ReturnType<typeof fakeChild>) => {
        Object.defineProperty(p.child, 'pid', { value: undefined });
        p.child.emit('message', hostControlMessage('request', f.binding));
      },
      (p: ReturnType<typeof fakeChild>) => {
        Object.defineProperty(p.child, 'connected', { value: false });
        p.child.emit('message', hostControlMessage('request', f.binding));
      },
      (p: ReturnType<typeof fakeChild>) => {
        Object.defineProperty(p.child, 'send', { value: undefined });
        p.child.emit('message', hostControlMessage('request', f.binding));
      },
      (p: ReturnType<typeof fakeChild>) => {
        Object.defineProperty(p.child, 'send', {
          value: () => {
            throw 'transport';
          },
        });
        p.child.emit('message', hostControlMessage('request', f.binding));
      },
      (p: ReturnType<typeof fakeChild>) => {
        p.child.emit('message', hostControlMessage('request', f.binding));
        p.callbacks[0]!(new Error('send failed'));
      },
      (p: ReturnType<typeof fakeChild>) => {
        p.child.emit('message', hostControlMessage('request', f.binding));
        p.child.emit('message', hostControlMessage('request', f.binding));
      },
      (p: ReturnType<typeof fakeChild>) => {
        p.child.emit('message', hostControlMessage('request', f.binding));
        p.child.emit('message', hostControlMessage('accept', f.binding));
        p.child.emit('message', hostControlMessage('accept', f.binding));
        p.callbacks[1]!(null);
      },
      (p: ReturnType<typeof fakeChild>) => p.child.disconnect(),
    ]) {
      const peer = fakeChild(),
        errors: Error[] = [];
      const session = serveRuntimeHostContext(peer.child, f.context, (error) => errors.push(error));
      setup(peer);
      assert.equal(errors.length, 1);
      assert.ok(session.finish());
      assert.equal(peer.child.listenerCount('message'), 0);
    }
  } finally {
    f.close();
  }
});

test('manager handshake timeout is bounded and cleanup retains failure evidence', (t) => {
  const f = fixture(),
    peer = fakeChild(),
    errors: Error[] = [];
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const session = serveRuntimeHostContext(peer.child, f.context, (error) => errors.push(error));
    t.mock.timers.tick(HOST_CONTEXT_TIMEOUT_MS);
    assert.match(errors[0]!.message, /timed out/u);
    assert.ok(session.finish());
    t.mock.timers.tick(HOST_CONTEXT_TIMEOUT_MS);
    assert.equal(errors.length, 1);
  } finally {
    t.mock.timers.reset();
    f.close();
  }
});

test('client closure and final send completion may arrive in either order', () => {
  const f = fixture(),
    peer = fakeChild(),
    errors: Error[] = [];
  const session = serveRuntimeHostContext(peer.child, f.context, (error) => errors.push(error));
  try {
    peer.child.emit('message', hostControlMessage('request', f.binding));
    peer.child.emit('message', hostControlMessage('accept', f.binding));
    peer.child.disconnect();
    assert.deepEqual(errors, []);
    peer.callbacks[1]!(null);
    assert.equal(session.finish(), undefined);
    assert.deepEqual(errors, []);
  } finally {
    session.finish();
    f.close();
  }
});

test('ending a handshake prevents late send callbacks from restarting it', () => {
  const f = fixture(),
    peer = fakeChild(),
    errors: Error[] = [];
  const session = serveRuntimeHostContext(peer.child, f.context, (error) => errors.push(error));
  try {
    peer.child.emit('message', hostControlMessage('request', f.binding));
    peer.child.emit('message', hostControlMessage('accept', f.binding));
    assert.ok(session.finish());
    peer.callbacks[1]!(null);
    peer.callbacks[0]!(new Error('late failed send'));
    peer.child.disconnect();
    assert.ok(session.finish());
    assert.deepEqual(errors, []);
  } finally {
    session.finish();
    f.close();
  }
});

test('a pre-cancelled managed spawn does not begin a context handshake after OS spawn', async () => {
  const f = fixture(),
    stop = new AbortController();
  stop.abort();
  try {
    const result = await spawnRuntimeProcess(
      process.execPath,
      ['-e', 'setInterval(()=>{},1000)'],
      {
        cwd: f.dir,
        env: runtimeChildEnvironment(process.env, 'isolated'),
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        signal: stop.signal,
      },
      f.context,
    );
    assert.match(result.error?.message ?? '', /interrupted/u);
  } finally {
    f.close();
  }
});
