import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { runtimeComponentFixture, hash } from './helpers/runtime-component.js';
import {
  trustRuntimeManifest,
  componentKey,
  copyTrustedRuntimeManifestBytes,
} from '../src/lib/runtime/manifest.js';
import { ensureRuntimeComponents } from '../src/lib/runtime/manager.js';
import { inspectRuntimeHost } from '../src/lib/runtime/host.js';
import {
  RUNTIME_HOST_CONTEXT_PROTOCOL,
  type RuntimeHostContext,
  type RuntimeManifest,
} from '../src/lib/runtime/manifest-types.js';
import {
  receiveRuntimeHostContext,
  runtimeHostContextInternals,
  type RuntimeHostProcess,
} from '../src/lib/runtime/host-context.js';
import {
  HOST_CONTEXT_TIMEOUT_MS,
  hostContextMessage,
  hostControlMessage,
  readHostRequest,
  type HostContextMessage,
  type HostContextSendCallback,
} from '../src/lib/runtime/host-context-protocol.js';

class HostProcess extends EventEmitter implements RuntimeHostProcess {
  pid = 23456;
  ppid = process.pid;
  connected = true;
  sent: HostContextMessage[] = [];
  callbacks: HostContextSendCallback[] = [];
  disconnectCount = 0;
  constructor(
    public execPath: string,
    private directory: string,
  ) {
    super();
  }
  cwd() {
    return this.directory;
  }
  send(message: HostContextMessage, callback: HostContextSendCallback) {
    this.sent.push(message);
    this.callbacks.push(callback);
    return true;
  }
  disconnect() {
    this.disconnectCount++;
    this.connected = false;
    this.emit('disconnect');
  }
}

async function fixture() {
  const f = runtimeComponentFixture();
  const manifest: RuntimeManifest = {
    ...f.manifest,
    launches: [{ ...f.manifest.launches[0]!, context_protocol: RUNTIME_HOST_CONTEXT_PROTOCOL }],
  };
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  const trusted = trustRuntimeManifest(bytes, hash(bytes));
  await ensureRuntimeComponents(trusted, {
    cacheDir: f.cacheDir,
    fetchImpl: async () => new Response(f.archive),
  });
  const executable = path.join(
    f.cacheDir,
    'components',
    componentKey(manifest.components[0]!),
    'root/bin/tool',
  );
  const context: RuntimeHostContext = {
    manifest: trusted,
    cacheDir: f.cacheDir,
    cwd: f.dir,
    entry: 'tool',
    host: inspectRuntimeHost(),
  };
  const peer = () => new HostProcess(executable, f.dir);
  const binding = (child: HostProcess) => readHostRequest(child.sent[0], child.ppid, child.pid);
  return { ...f, bytes, trusted, executable, context, peer, binding };
}

test('receiver accepts one manager-confirmed context and closes IPC before exposing authority', async () => {
  const f = await fixture(),
    child = f.peer();
  try {
    const pending = runtimeHostContextInternals.receiveFromProcess(child);
    let returned = false;
    void pending.then(() => {
      returned = true;
    });
    assert.equal(child.sent.length, 1);
    const binding = f.binding(child);
    child.callbacks[0]!(null);
    child.emit('message', hostContextMessage(f.context, binding));
    assert.equal(child.sent[1]!.kind, 'accept');
    await Promise.resolve();
    assert.equal(returned, false);
    child.callbacks[1]!(null);
    child.emit('message', hostControlMessage('ready', binding));
    const context = await pending;
    assert.equal(child.connected, false);
    assert.equal(child.disconnectCount, 1);
    assert.equal(child.listenerCount('message'), 0);
    assert.ok(Object.isFrozen(context));
    assert.deepEqual(copyTrustedRuntimeManifestBytes(context.manifest), f.bytes);
    assert.equal(context.cwd, fs.realpathSync(f.dir));
    assert.equal(context.cacheDir, fs.realpathSync(f.cacheDir));
    child.callbacks[0]!(new Error('late callback must not replace accepted context'));
    child.connected = true;
    await assert.rejects(
      runtimeHostContextInternals.receiveFromProcess(child),
      /already consumed/u,
    );
    assert.equal(child.sent.length, 2);
  } finally {
    f.close();
  }
});

test('no channel or ordinary process input cannot restore a managed context', async () => {
  for (const key of ['connected', 'send', 'disconnect'] as const) {
    const child = new HostProcess(process.execPath, process.cwd());
    Object.defineProperty(child, key, { value: undefined });
    await assert.rejects(
      runtimeHostContextInternals.receiveFromProcess(child),
      /inherited manager IPC/u,
    );
    assert.equal(child.sent.length, 0);
  }
  const saved = Object.getOwnPropertyDescriptor(process, 'connected');
  Object.defineProperty(process, 'connected', { value: false, configurable: true });
  try {
    await assert.rejects(receiveRuntimeHostContext(), /inherited manager IPC/u);
  } finally {
    if (saved) Object.defineProperty(process, 'connected', saved);
    else Reflect.deleteProperty(process, 'connected');
  }
});

test('receiver rejects changed context, wrong execution, missing opt-in and changed components', async () => {
  const f = await fixture();
  try {
    const missingProtocol: RuntimeManifest = {
      ...f.trusted.manifest,
      launches: f.manifest.launches,
    };
    const bytes = Buffer.from(JSON.stringify(missingProtocol));
    const withoutProtocol = trustRuntimeManifest(bytes, hash(bytes));
    const subdirectory = path.join(f.dir, 'other');
    fs.mkdirSync(subdirectory);
    const inCache = path.join(f.cacheDir, 'project');
    fs.mkdirSync(inCache);
    const inSkill = path.join(f.dir, '.agents', 'skills', 'fixture');
    fs.mkdirSync(inSkill, { recursive: true });
    const file = path.join(f.dir, 'file');
    fs.writeFileSync(file, 'not a directory');
    const contexts = [
      { ...f.context, cacheDir: '.' },
      { ...f.context, cwd: '.' },
      { ...f.context, cwd: subdirectory },
      { ...f.context, cwd: file },
      { ...f.context, entry: 'unknown' },
      { ...f.context, manifest: withoutProtocol },
    ];
    for (const context of contexts) {
      const child = f.peer(),
        pending = runtimeHostContextInternals.receiveFromProcess(child);
      const rejection = assert.rejects(pending);
      child.emit('message', hostContextMessage(context, f.binding(child)));
      await rejection;
      assert.equal(child.sent.length, 1);
      assert.equal(child.disconnectCount, 1);
    }
    for (const cwd of [f.cacheDir, inCache, inSkill]) {
      const child = new HostProcess(f.executable, cwd);
      const pending = runtimeHostContextInternals.receiveFromProcess(child),
        rejection = assert.rejects(pending, /cache or installed skill/u);
      child.emit('message', hostContextMessage({ ...f.context, cwd }, f.binding(child)));
      await rejection;
    }
    const wrongExecutable = new HostProcess(process.execPath, f.dir);
    const pending = runtimeHostContextInternals.receiveFromProcess(wrongExecutable),
      rejection = assert.rejects(pending, /declared managed Node/u);
    wrongExecutable.emit('message', hostContextMessage(f.context, f.binding(wrongExecutable)));
    await rejection;
    fs.writeFileSync(f.executable, 'changed');
    const changed = f.peer(),
      rejected = runtimeHostContextInternals.receiveFromProcess(changed);
    const changedRejection = assert.rejects(rejected, /selected components changed/u);
    changed.emit('message', hostContextMessage(f.context, f.binding(changed)));
    await changedRejection;
  } finally {
    f.close();
  }
});

test('receiver requires the matching final confirmation and rejects repeated messages', async () => {
  const f = await fixture();
  try {
    for (const kind of [
      'early-close',
      'close-after-context',
      'wrong-ready',
      'duplicate-context',
      'duplicate-ready',
    ]) {
      const child = f.peer(),
        pending = runtimeHostContextInternals.receiveFromProcess(child);
      const rejection = assert.rejects(pending);
      const binding = f.binding(child),
        frame = hostContextMessage(f.context, binding);
      if (kind === 'early-close') child.disconnect();
      else {
        child.emit('message', frame);
        if (kind === 'close-after-context') child.disconnect();
        if (kind === 'wrong-ready')
          child.emit('message', { ...hostControlMessage('ready', binding), nonce: 'wrong' });
        if (kind === 'duplicate-context') child.emit('message', frame);
        if (kind === 'duplicate-ready') {
          Object.defineProperty(child, 'disconnect', {
            value: () => {
              child.disconnectCount++;
            },
          });
          child.emit('message', hostControlMessage('ready', binding));
          child.emit('message', hostControlMessage('ready', binding));
        }
      }
      await rejection;
      assert.equal(child.listenerCount('message'), 0);
      assert.equal(child.disconnectCount, 1);
    }
  } finally {
    f.close();
  }
});

test('receiver preserves send and disconnect failures without retrying the handshake', async () => {
  const f = await fixture();
  try {
    for (const phase of [
      'request-callback',
      'accept-callback',
      'request-throw',
      'request-unknown',
      'disconnect-throw',
      'failure-disconnect-throw',
    ]) {
      const child = f.peer();
      if (phase === 'request-throw')
        Object.defineProperty(child, 'send', {
          value: () => {
            throw new Error('request failed');
          },
        });
      if (phase === 'request-unknown')
        Object.defineProperty(child, 'send', {
          value: () => {
            throw 'unknown transport failure';
          },
        });
      if (phase.endsWith('disconnect-throw'))
        Object.defineProperty(child, 'disconnect', {
          value: () => {
            child.disconnectCount++;
            throw new Error('disconnect failed');
          },
        });
      const pending = runtimeHostContextInternals.receiveFromProcess(child),
        rejection = assert.rejects(pending);
      if (phase === 'request-callback' || phase === 'failure-disconnect-throw')
        child.callbacks[0]!(new Error('request failed'));
      if (phase === 'accept-callback' || phase === 'disconnect-throw') {
        const binding = f.binding(child);
        child.emit('message', hostContextMessage(f.context, binding));
        if (phase === 'accept-callback') child.callbacks[1]!(new Error('accept failed'));
        else child.emit('message', hostControlMessage('ready', binding));
      }
      await rejection;
      assert.equal(child.disconnectCount, 1);
      assert.equal(child.listenerCount('message'), 0);
      child.callbacks[0]?.(new Error('late failure'));
      assert.equal(child.disconnectCount, 1);
    }
  } finally {
    f.close();
  }
});

test('receiver deadline rejects a stalled parent and clears its IPC listeners', async (t) => {
  const f = await fixture(),
    child = f.peer();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const pending = runtimeHostContextInternals.receiveFromProcess(child);
    const rejection = assert.rejects(pending, /timed out/u);
    t.mock.timers.tick(HOST_CONTEXT_TIMEOUT_MS);
    await rejection;
    assert.equal(child.disconnectCount, 1);
    assert.equal(child.listenerCount('message'), 0);
  } finally {
    t.mock.timers.reset();
    f.close();
  }
});
