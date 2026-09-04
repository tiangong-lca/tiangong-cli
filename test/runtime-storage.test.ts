import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  defaultRuntimeCache,
  canonicalCacheRoot,
  cachePath,
  writeAll,
  writeOnce,
  openRuntimeCache,
  ensureRuntimeCache,
  readCacheJson,
} from '../src/lib/runtime/storage.js';
import { runtimeComponentFixture } from './helpers/runtime-component.js';
import {
  acquireRuntimeLease,
  releaseRuntimeLease,
  readRuntimeLease,
  runtimeLeaseKey,
  leasedRuntimeKeys,
} from '../src/lib/runtime/leases.js';
import { contentHash } from '../src/lib/runtime/files.js';
import {
  assertRuntimeHost,
  inspectRuntimeHost,
  runtimeHostInternals,
} from '../src/lib/runtime/host.js';
import { trustRuntimeManifest } from '../src/lib/runtime/manifest.js';

test('cache path and ownership checks preserve unrelated data and reject links', async (t) => {
  const f = runtimeComponentFixture();
  try {
    assert.ok(defaultRuntimeCache({ HOME: f.dir }, 'darwin').includes('Library'));
    assert.ok(defaultRuntimeCache({ USERPROFILE: f.dir }, 'win32').includes('AppData'));
    assert.ok(
      defaultRuntimeCache({ LOCALAPPDATA: f.dir, HOME: 'unused' }, 'win32').startsWith(f.dir),
    );
    assert.ok(
      defaultRuntimeCache({ XDG_CACHE_HOME: f.dir, HOME: 'unused' }, 'linux').startsWith(f.dir),
    );
    assert.ok(defaultRuntimeCache({}, 'linux').includes('runtimes'));
    assert.throws(() => canonicalCacheRoot('relative'), /absolute/u);
    assert.throws(() => canonicalCacheRoot(path.parse(f.dir).root), /home root/u);
    assert.throws(() => canonicalCacheRoot(os.homedir()), /home root/u);
    const file = path.join(f.dir, 'file');
    fs.writeFileSync(file, 'keep');
    assert.throws(() => canonicalCacheRoot(path.join(file, 'child')), /parent must/u);
    const exists = fs.existsSync;
    t.mock.method(fs, 'existsSync', () => false);
    assert.throws(() => canonicalCacheRoot(f.cacheDir), /existing parent/u);
    t.mock.restoreAll();
    assert.equal(exists(file), true);
    for (const value of ['', '/root', '..', 'a//b', 'a\\b', 'a/./b'])
      assert.throws(() => cachePath(f.dir, value), /within the owned root/u);
    assert.throws(() => cachePath(f.dir, 'file/child'), /links or non-directories/u);
    fs.symlinkSync(f.dir, path.join(f.dir, 'link'), 'junction');
    assert.throws(() => cachePath(f.dir, 'link/file'), /links/u);
    const lstat = fs.lstatSync;
    t.mock.method(fs, 'lstatSync', () => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' });
    });
    assert.throws(() => cachePath(f.dir, 'x'), /denied/u);
    t.mock.restoreAll();
    assert.ok(lstat(file).isFile());
    assert.equal(openRuntimeCache(f.cacheDir, false), path.join(fs.realpathSync(f.dir), 'cache'));
    assert.throws(() => openRuntimeCache(f.dir, true), /not a runtime/u);
    assert.throws(() => openRuntimeCache(f.dir, false), /not a runtime/u);
    const roots = await Promise.all([
      ensureRuntimeCache(f.cacheDir),
      ensureRuntimeCache(f.cacheDir),
    ]);
    assert.equal(roots[0], roots[1]);
    assert.equal(openRuntimeCache(f.cacheDir, true), roots[0]);
    fs.writeFileSync(path.join(f.cacheDir, '.runtime-cache.json'), 'invalid');
    assert.throws(() => openRuntimeCache(f.cacheDir, false), /ownership marker/u);
  } finally {
    t.mock.restoreAll();
    f.close();
  }
});

test('immutable records and bounded JSON handle write races without overwriting existing bytes', async (t) => {
  const f = runtimeComponentFixture();
  try {
    const root = await ensureRuntimeCache(f.cacheDir);
    writeOnce(root, 'state/one.json', Buffer.from('{}'));
    writeOnce(root, 'state/one.json', Buffer.from('{}'));
    assert.throws(
      () => writeOnce(root, 'state/one.json', Buffer.from('different')),
      /cannot be replaced/u,
    );
    fs.mkdirSync(path.join(root, 'directory'));
    assert.throws(() => writeOnce(root, 'directory', Buffer.from('x')), /cannot be replaced/u);
    assert.deepEqual(readCacheJson(root, 'state/one.json'), {});
    assert.throws(() => readCacheJson(root, 'state/one.json', 1), /bounded regular/u);
    writeOnce(root, 'state/invalid.json', Buffer.from('not-json'));
    assert.throws(() => readCacheJson(root, 'state/invalid.json'), /complete JSON/u);
    const read = fs.readFileSync;
    t.mock.method(fs, 'readFileSync', () => Buffer.alloc(8));
    assert.throws(() => readCacheJson(root, 'state/one.json', 4), /grew/u);
    t.mock.restoreAll();
    for (const same of [true, false]) {
      t.mock.method(fs, 'linkSync', (_source: fs.PathLike, target: fs.PathLike) => {
        fs.writeFileSync(target, same ? 'same' : 'other');
        throw Object.assign(new Error('race'), { code: 'EEXIST' });
      });
      if (same) writeOnce(root, 'state/same', Buffer.from('same'));
      else
        assert.throws(
          () => writeOnce(root, 'state/other', Buffer.from('same')),
          /Concurrent cache/u,
        );
      t.mock.restoreAll();
    }
    t.mock.method(fs, 'linkSync', () => {
      throw Object.assign(new Error('no link'), { code: 'EPERM' });
    });
    assert.throws(() => writeOnce(root, 'state/denied', Buffer.from('x')), /no link/u);
    t.mock.restoreAll();
    const fd = fs.openSync(path.join(root, 'partial'), 'wx');
    const write = fs.writeSync;
    let calls = 0;
    try {
      t.mock.method(
        fs,
        'writeSync',
        (file: number, bytes: Uint8Array, offset: number, length: number) => {
          calls++;
          return write(file, bytes, offset, Math.min(length, 2));
        },
      );
      writeAll(fd, Buffer.from('abcdef'));
      assert.equal(calls, 3);
      t.mock.restoreAll();
      t.mock.method(fs, 'writeSync', () => 0);
      assert.throws(() => writeAll(fd, Buffer.from('x')), /written completely/u);
    } finally {
      t.mock.restoreAll();
      fs.closeSync(fd);
    }
    assert.equal(read(path.join(root, 'partial'), 'utf8'), 'abcdef');
  } finally {
    t.mock.restoreAll();
    f.close();
  }
});

test('leases are owner-bound, content-bound and conservative in the face of corrupt state', async (t) => {
  const f = runtimeComponentFixture();
  try {
    const root = await ensureRuntimeCache(f.cacheDir),
      key = '1'.repeat(64);
    assert.equal(leasedRuntimeKeys(root).size, 0);
    await acquireRuntimeLease(root, 'one', 'urn:owner', [key]);
    assert.equal(readRuntimeLease(root, runtimeLeaseKey('one')).owner, 'urn:owner');
    await assert.rejects(
      acquireRuntimeLease(root, 'one', 'urn:changed', [key]),
      /pins another owner/u,
    );
    const file = path.join(root, 'leases', runtimeLeaseKey('one') + '.json');
    const original = fs.readFileSync(file);
    for (const change of [{ schema: 'unknown' }, { id: 'another' }]) {
      fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(original.toString()), ...change }));
      assert.throws(() => readRuntimeLease(root, runtimeLeaseKey('one')), /lease/u);
    }
    fs.writeFileSync(file, original);
    assert.equal(await releaseRuntimeLease(root, 'missing', 'owner'), false);
    fs.writeFileSync(path.join(root, 'leases', 'unknown'), 'preserve');
    assert.throws(() => leasedRuntimeKeys(root), /Unknown lease/u);
    fs.unlinkSync(path.join(root, 'leases', 'unknown'));
    t.mock.method(fs, 'readdirSync', () => Array.from({ length: 10001 }, () => 'x'));
    assert.throws(() => leasedRuntimeKeys(root), /inventory exceeds/u);
    t.mock.restoreAll();
    assert.equal(await releaseRuntimeLease(root, 'one', 'urn:owner'), true);
    assert.equal(leasedRuntimeKeys(root).size, 0);
  } finally {
    t.mock.restoreAll();
    f.close();
  }
});

test('host readiness compares actual OS and glibc separately from architecture and workspace permissions', () => {
  const f = runtimeComponentFixture();
  try {
    assert.ok(inspectRuntimeHost().platform);
    const manifest = JSON.parse(f.manifestBytes.toString());
    manifest.components[0].platform = 'linux-x64';
    manifest.launches[0].platform = 'linux-x64';
    manifest.minimum_hosts = { 'linux-x64': { os_release: '4.18.0', glibc: '2.28' } };
    const bytes = Buffer.from(JSON.stringify(manifest)),
      trusted = trustRuntimeManifest(bytes, contentHash(manifest));
    assertRuntimeHost(trusted, {
      platform: 'linux-x64',
      osRelease: '6.8.0-generic',
      glibc: '2.39',
    });
    for (const host of [
      { platform: 'darwin-arm64' as const, osRelease: '24.0.0', glibc: null },
      { platform: 'linux-x64' as const, osRelease: '4.17.0', glibc: '2.39' },
      { platform: 'linux-x64' as const, osRelease: '6.8.0', glibc: null },
      { platform: 'linux-x64' as const, osRelease: '6.8.0', glibc: '2.27' },
    ])
      assert.throws(() => assertRuntimeHost(trusted, host), /does not support/u);
    assert.ok(runtimeHostInternals.compareVersions('bad', '1.0.0') < 0);
    assert.equal(runtimeHostInternals.compareVersions('2.28', '2.28'), 0);
  } finally {
    f.close();
  }
});

test('native host collection projects Linux ABI only and omits diagnostic secrets', (t) => {
  const beforePlatform = Object.getOwnPropertyDescriptor(process, 'platform')!,
    beforeArch = Object.getOwnPropertyDescriptor(process, 'arch')!;
  try {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    Object.defineProperty(process, 'arch', { value: 'x64' });
    for (const report of [
      {
        header: { glibcVersionRuntime: '2.39' },
        environmentVariables: { SECRET: 'must-not-copy' },
      },
      { header: {} },
      {},
    ]) {
      t.mock.method(process.report, 'getReport', () => report);
      const host = inspectRuntimeHost();
      assert.equal(host.platform, 'linux-x64');
      assert.deepEqual(Object.keys(host), ['platform', 'osRelease', 'glibc']);
      assert.equal(
        host.glibc,
        'header' in report && report.header && 'glibcVersionRuntime' in report.header
          ? '2.39'
          : null,
      );
      t.mock.restoreAll();
    }
  } finally {
    t.mock.restoreAll();
    Object.defineProperty(process, 'platform', beforePlatform);
    Object.defineProperty(process, 'arch', beforeArch);
  }
});
