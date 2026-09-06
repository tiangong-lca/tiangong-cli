import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { setTimeout as pause } from 'node:timers/promises';
import { executeCli } from '../src/cli.js';
import { executeRuntimeLaunch } from '../src/lib/runtime/execute.js';
import { trustRuntimeManifest } from '../src/lib/runtime/manifest.js';
import { leasedRuntimeKeys } from '../src/lib/runtime/leases.js';
import { runtimeComponentFixture, hash, tarBytes } from './helpers/runtime-component.js';
import type { ComponentFile, RuntimeManifest } from '../src/lib/runtime/manifest-types.js';

function managedHostFixture() {
  const f = runtimeComponentFixture();
  const contents = { ...f.contents };
  const nodePath = process.platform === 'win32' ? 'bin/node.exe' : 'bin/node';
  delete contents['bin/tool'];
  contents[nodePath] = fs.readFileSync(process.execPath);
  const repo = path.resolve(import.meta.dirname, '..');
  const visited = new Set<string>();
  const copyCompiled = (file: string): void => {
    if (visited.has(file)) return;
    visited.add(file);
    const relative = path.relative(repo, file).split(path.sep).join('/');
    assert.ok(relative.startsWith('dist/'), `compiled-only runtime closure: ${relative}`);
    const bytes = fs.readFileSync(file);
    contents[`cli/${relative}`] = bytes;
    if (!file.endsWith('.js')) return;
    const imports = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.[^'"]+)['"]/gu;
    for (const match of bytes.toString('utf8').matchAll(imports))
      copyCompiled(path.resolve(path.dirname(file), match[1]!));
  };
  copyCompiled(path.join(repo, 'dist/src/runtime.js'));
  contents['cli/package.json'] = fs.readFileSync(path.join(repo, 'package.json'));
  contents['host.mjs'] = Buffer.from(`
import * as runtime from './cli/dist/src/runtime.js';
import fs from 'node:fs';
import path from 'node:path';
process.stdout.write('host-started\\n');
const mode = process.argv[2];
if (mode === 'early-exit') process.exit(0);
if (mode === 'bad-request') {
  process.send({schema:'untrusted'});
  setInterval(()=>{},1000);
} else {
if (mode === 'late-request') {
  process.on('SIGTERM', () => {});
  fs.writeFileSync(path.join(process.cwd(), 'host-starting.json'), '{}');
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (typeof runtime.receiveRuntimeHostContext !== 'function')
  throw new Error('missing trusted runtime host context receiver');
const context = await runtime.receiveRuntimeHostContext();
runtime.assertWorkspaceCompatibility(context.manifest, {schema:'workspace.v1',features:['ledger']}, 'write');
if (mode === 'wait' || mode === 'late-request') {
  process.on('SIGTERM', () => {});
  fs.writeFileSync(path.join(context.cwd, 'host-ready.json'), JSON.stringify({sha256:context.manifest.sha256}));
  setInterval(()=>{},1000);
} else if (mode === 'overflow') {
  process.stdout.write('x'.repeat(17 * 1024 * 1024));
} else {
process.stdout.write(JSON.stringify({
  sha256: context.manifest.sha256,
  original: runtime.copyTrustedRuntimeManifestBytes(context.manifest).toString('base64'),
  product: context.manifest.manifest.product,
  cwd: context.cwd,
  cacheDir: context.cacheDir,
  entry: context.entry,
  connected: process.connected,
  argv: process.argv.slice(2),
  injected: process.env.FOUNDRY_CLI_EXPECTATION ?? null,
  frozen: Object.isFrozen(context) && Object.isFrozen(context.manifest.manifest)
}));
}
}
`);
  const files: ComponentFile[] = Object.keys(contents)
    .sort()
    .map((file) => ({
      path: file,
      bytes: contents[file]!.length,
      sha256: hash(contents[file]!),
      mode: file === nodePath ? 493 : 420,
    }));
  const archive = gzipSync(tarBytes(files, contents));
  const manifest: RuntimeManifest = {
    ...f.manifest,
    components: [
      {
        ...f.manifest.components[0]!,
        files,
        content_sha256: hash(JSON.stringify(files)),
        archive: {
          ...f.manifest.components[0]!.archive,
          bytes: archive.length,
          sha256: hash(archive),
        },
      },
    ],
    launches: [
      {
        ...f.manifest.launches[0]!,
        executable: { component: 'base', path: nodePath },
        context_protocol: 'tiangong-lca.runtime-host.v1',
        argv: [{ component: 'base', path: 'host.mjs' }],
      },
    ],
  };
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  return { ...f, archive, bytes, trusted: trustRuntimeManifest(bytes, hash(bytes)) };
}

test(
  'actual managed Node host receives the complete verified context before application work',
  { timeout: 60000 },
  async () => {
    const f = managedHostFixture();
    try {
      const result = await executeRuntimeLaunch(f.trusted, {
        cacheDir: f.cacheDir,
        cwd: f.dir,
        entry: 'tool',
        argv: ['--manifest-sha256=ordinary-untrusted-text'],
        env: { ...process.env, FOUNDRY_CLI_EXPECTATION: 'not-authority' },
        fetchImpl: async () => new Response(f.archive),
      });

      assert.ok(result.stdout.startsWith('host-started\n'), result.stderr);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');
      const output = JSON.parse(result.stdout.slice('host-started\n'.length));
      assert.deepEqual(output, {
        sha256: f.trusted.sha256,
        original: f.bytes.toString('base64'),
        product: f.trusted.manifest.product,
        cwd: fs.realpathSync(f.dir),
        cacheDir: fs.realpathSync(f.cacheDir),
        entry: 'tool',
        connected: false,
        argv: ['--manifest-sha256=ordinary-untrusted-text'],
        injected: null,
        frozen: true,
      });
      assert.equal(leasedRuntimeKeys(f.cacheDir).size, 0);
    } finally {
      f.close();
    }
  },
);

test(
  'managed host failures, cancellation and output overflow drain before releasing leases',
  { timeout: 60000 },
  async () => {
    const f = managedHostFixture();
    const options = {
      cacheDir: f.cacheDir,
      cwd: f.dir,
      entry: 'tool',
      env: process.env,
      fetchImpl: async () => new Response(f.archive),
    };
    try {
      for (const mode of ['early-exit', 'bad-request', 'overflow']) {
        const result = await executeRuntimeLaunch(f.trusted, { ...options, argv: [mode] });
        assert.ok(result.error, mode);
        assert.match(
          result.error.message,
          mode === 'overflow' ? /output exceeded/u : /host context/u,
        );
        if (mode === 'early-exit') assert.equal(result.status, 0);
        assert.equal(leasedRuntimeKeys(f.cacheDir).size, 0);
      }
      const stop = new AbortController();
      const pending = executeRuntimeLaunch(f.trusted, {
        ...options,
        argv: ['wait'],
        signal: stop.signal,
      });
      let failure: unknown;
      void pending.catch((error: unknown) => {
        failure = error;
      });
      const marker = path.join(f.dir, 'host-ready.json');
      const deadline = Date.now() + 30_000;
      while (!fs.existsSync(marker) && Date.now() < deadline) {
        if (failure !== undefined) break;
        await pause(10);
      }
      const ready = fs.existsSync(marker);
      stop.abort();
      assert.ok(leasedRuntimeKeys(f.cacheDir).size > 0);
      await assert.rejects(pending, /aborted/u);
      assert.equal(failure instanceof Error, true);
      assert.ok(ready, 'the actual child must complete the handshake before cancellation');
      assert.equal(leasedRuntimeKeys(f.cacheDir).size, 0);
      fs.rmSync(marker);
      const earlyStop = new AbortController();
      const early = executeRuntimeLaunch(f.trusted, {
        ...options,
        argv: ['late-request'],
        signal: earlyStop.signal,
      });
      const earlyRejection = assert.rejects(early, /aborted/u);
      const starting = path.join(f.dir, 'host-starting.json');
      const startDeadline = Date.now() + 30_000;
      while (!fs.existsSync(starting) && Date.now() < startDeadline) await pause(10);
      earlyStop.abort();
      await earlyRejection;
      assert.ok(fs.existsSync(starting));
      assert.equal(
        fs.existsSync(marker),
        false,
        'cancellation must not approve a later context request',
      );
      assert.equal(leasedRuntimeKeys(f.cacheDir).size, 0);
      fs.writeFileSync(f.manifestPath, f.bytes);
      const result = await executeCli(
        [
          'runtime',
          'exec',
          '--manifest',
          f.manifestPath,
          '--manifest-sha256',
          f.trusted.sha256,
          '--cache-dir',
          f.cacheDir,
          '--entry',
          'tool',
          '--cwd',
          f.dir,
          '--',
          'early-exit',
        ],
        {
          env: process.env,
          dotEnvStatus: { loaded: false, path: '/unused', count: 0 },
          fetchImpl: options.fetchImpl,
        },
      );
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, 'host-started\n');
      assert.match(result.stderr, /host context/u);
      assert.equal(leasedRuntimeKeys(f.cacheDir).size, 0);
      const { context_protocol: omittedProtocol, ...legacyLaunch } =
        f.trusted.manifest.launches[0]!;
      assert.equal(omittedProtocol, 'tiangong-lca.runtime-host.v1');
      const legacyBytes = Buffer.from(
        JSON.stringify({ ...f.trusted.manifest, launches: [legacyLaunch] }),
      );
      const legacy = trustRuntimeManifest(legacyBytes, hash(legacyBytes));
      const unavailable = await executeRuntimeLaunch(legacy, {
        ...options,
        argv: ['--manifest-sha256=ordinary-text'],
        env: { ...process.env, NODE_CHANNEL_FD: '3', FOUNDRY_CLI_EXPECTATION: f.trusted.sha256 },
      });
      assert.equal(unavailable.status, 1);
      assert.match(unavailable.stderr, /inherited manager IPC channel/u);
      assert.equal(leasedRuntimeKeys(f.cacheDir).size, 0);
    } finally {
      f.close();
    }
  },
);
