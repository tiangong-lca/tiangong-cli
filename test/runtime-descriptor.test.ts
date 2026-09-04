import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import {
  describeCliRuntime,
  assertCliRuntimeMatches,
  CLI_RUNTIME_EXPECTATION_SCHEMA,
  type CliRuntimeExpectation,
} from '../src/runtime.js';
import {
  inspectCliRuntime,
  runtimePackageRoot,
  runtimePlatform,
  validateRuntimeExpectation,
  assertRuntimeObservationMatches,
} from '../src/lib/runtime/descriptor.js';
import {
  hashRuntimeFile,
  listRuntimeFiles,
  assertInventoryBudget,
} from '../src/lib/runtime/files.js';

type NodeIdentity = Parameters<typeof inspectCliRuntime>[1];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-runtime-fixture-'));
  const manifest = {
    name: '@tiangong-lca/cli',
    version: '1.2.3',
    bin: { 'tiangong-lca': './bin/tiangong-lca.js' },
  };
  const write = (file: string, content: string) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    return target;
  };
  write('package.json', JSON.stringify(manifest));
  write('bin/tiangong-lca.js', 'export const launcher = true;\n');
  write('dist/src/main.js', 'export const main = true;\n');
  write('dist/src/runtime.js', 'export const runtime = true;\n');
  write('dist/src/lib/nested.js', 'export const nested = true;\n');
  write('assets/tidas-schemas/flow.json', '{}\n');
  const executable = write('node', 'fixture-node-bytes');
  const node: NodeIdentity = { executable, version: '24.19.0', platform: 'darwin', arch: 'arm64' };
  return {
    root,
    manifest,
    write,
    node,
    close: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
function expectation(descriptor: ReturnType<typeof describeCliRuntime>): CliRuntimeExpectation {
  return {
    schema: CLI_RUNTIME_EXPECTATION_SCHEMA,
    package_version: descriptor.package.version,
    platform: descriptor.platform,
    content_sha256: descriptor.content_sha256,
    node_version: descriptor.node.version,
    node_sha256: descriptor.node.sha256,
  };
}

test('descriptor binds the complete package runtime and detects helper, asset and executable changes', () => {
  const f = fixture();
  try {
    const before = inspectCliRuntime(f.root, f.node);
    assert.deepEqual(
      before.files.map((file) => file.path),
      [
        'assets/tidas-schemas/flow.json',
        'bin/tiangong-lca.js',
        'dist/src/lib/nested.js',
        'dist/src/main.js',
        'dist/src/runtime.js',
        'package.json',
      ],
    );
    assert.equal(before.command.executable, fs.realpathSync(f.node.executable));
    assert.equal(
      before.command.argv[0],
      path.join(fs.realpathSync(f.root), 'bin', 'tiangong-lca.js'),
    );
    assert.equal(before.scope, 'cli-package');
    assert.ok(Object.isFrozen(before.files[0]));
    assert.ok(Object.isFrozen(before.command.argv));
    assert.deepEqual(assertRuntimeObservationMatches(before, expectation(before)), before);
    for (const file of [
      'dist/src/lib/nested.js',
      'assets/tidas-schemas/flow.json',
      'node',
      'package.json',
    ]) {
      const original = fs.readFileSync(path.join(f.root, file));
      fs.appendFileSync(path.join(f.root, file), '\n');
      assert.throws(
        () =>
          assertRuntimeObservationMatches(inspectCliRuntime(f.root, f.node), expectation(before)),
        /does not match/u,
      );
      fs.writeFileSync(path.join(f.root, file), original);
    }
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-runtime-copy-'));
    try {
      fs.cpSync(f.root, clone, { recursive: true });
      const copy = inspectCliRuntime(clone, { ...f.node, executable: path.join(clone, 'node') });
      assert.equal(copy.content_sha256, before.content_sha256);
      assert.equal(copy.assets.sha256, before.assets.sha256);
      assert.notEqual(copy.package.root, before.package.root);
    } finally {
      fs.rmSync(clone, { recursive: true, force: true });
    }
  } finally {
    f.close();
  }
});

test('runtime root, stable package and supported platform/version contracts fail closed', () => {
  const f = fixture();
  try {
    for (const file of ['src/runtime.ts', 'dist/src/runtime.js'])
      assert.equal(
        runtimePackageRoot(pathToFileURL(path.join(f.root, file)).href),
        fs.realpathSync(f.root),
      );
    for (const file of ['src/runtime.mjs', 'src/other.ts', 'src/runtime.js'])
      assert.throws(
        () => runtimePackageRoot(pathToFileURL(path.join(f.root, file)).href),
        /runtime API|declared package layout/u,
      );
    for (const [platform, arch] of [
      ['darwin', 'arm64'],
      ['linux', 'x64'],
      ['linux', 'arm64'],
      ['win32', 'x64'],
    ])
      assert.equal(runtimePlatform(platform!, arch!), `${platform}-${arch}`);
    for (const [platform, arch] of [
      ['darwin', 'x64'],
      ['win32', 'arm64'],
      ['freebsd', 'x64'],
    ])
      assert.throws(() => runtimePlatform(platform!, arch!), /Supported platforms/u);
    for (const version of ['24.18.0', '25.0.0', '24.19.0-beta'])
      assert.throws(() => inspectCliRuntime(f.root, { ...f.node, version }), /stable Node/u);
    for (const value of [
      null,
      [],
      'name',
      {},
      { ...f.manifest, name: 'other' },
      { ...f.manifest, version: 1 },
      { ...f.manifest, version: '1.x' },
      { ...f.manifest, bin: null },
      { ...f.manifest, bin: { 'tiangong-lca': '../bad.js' } },
    ]) {
      f.write('package.json', JSON.stringify(value));
      assert.throws(() => inspectCliRuntime(f.root, f.node), /manifest must be|launcher contract/u);
    }
    f.write('package.json', 'not-json');
    assert.throws(() => inspectCliRuntime(f.root, f.node), /not valid JSON/u);
    f.write('package.json', JSON.stringify(f.manifest));
    fs.unlinkSync(path.join(f.root, 'dist/src/main.js'));
    assert.throws(() => inspectCliRuntime(f.root, f.node), /missing a required/u);
    f.write('dist/src/main.js', 'main');
    fs.unlinkSync(path.join(f.root, 'assets/tidas-schemas/flow.json'));
    assert.throws(() => inspectCliRuntime(f.root, f.node), /no TIDAS schema/u);
  } finally {
    f.close();
  }
});

test('expected identity must be independently selected exact facts, without aliases or wildcards', () => {
  const descriptor = describeCliRuntime();
  const expected = expectation(descriptor);
  assert.deepEqual(assertCliRuntimeMatches(expected), descriptor);
  const invalid: unknown[] = [
    null,
    'identity',
    {},
    { ...expected, extra: true },
    { ...expected, schema: 'v2' },
    { ...expected, package_version: 12 },
    { ...expected, package_version: '1.x' },
    { ...expected, platform: 'darwin-x64' },
    { ...expected, content_sha256: 1 },
    { ...expected, content_sha256: 'X'.repeat(64) },
    { ...expected, node_version: 24 },
    { ...expected, node_version: 'latest' },
    { ...expected, node_version: '24.18.0' },
    { ...expected, node_sha256: null },
    { ...expected, node_sha256: 'bad' },
  ];
  for (const value of invalid)
    assert.throws(
      () => validateRuntimeExpectation(value as CliRuntimeExpectation),
      /trusted release manifest/u,
    );
  assert.throws(
    () => assertCliRuntimeMatches({ ...expected, schema: 'unknown' }),
    /trusted release manifest/u,
  );
  for (const fields of [
    { package_version: '99.0.0' },
    { platform: 'linux-arm64' as const },
    { content_sha256: '0'.repeat(64) },
    { node_version: '24.20.0' },
    { node_sha256: '0'.repeat(64) },
  ]) {
    const actual = inspectCliRuntimeFixture();
    assert.throws(
      () => assertRuntimeObservationMatches(actual, { ...expectation(actual), ...fields }),
      /does not match/u,
    );
  }
});
function inspectCliRuntimeFixture() {
  const f = fixture();
  try {
    return inspectCliRuntime(f.root, f.node);
  } finally {
    f.close();
  }
}

test('package manifest content is checked before parse and after inventory', (t) => {
  const f = fixture();
  const read = fs.readFileSync;
  try {
    t.mock.method(fs, 'readFileSync', () =>
      Buffer.from(JSON.stringify({ ...f.manifest, version: '2.0.0' })),
    );
    assert.throws(() => inspectCliRuntime(f.root, f.node), /before parsing/u);
    t.mock.restoreAll();
    t.mock.method(fs, 'readFileSync', () => {
      const bytes = read(path.join(f.root, 'package.json'));
      fs.appendFileSync(path.join(f.root, 'package.json'), ' ');
      return bytes;
    });
    assert.throws(() => inspectCliRuntime(f.root, f.node), /manifest changed during/u);
  } finally {
    t.mock.restoreAll();
    f.close();
  }
});

test('runtime file and inventory bounds reject links, non-files and unsupported sizes', (t) => {
  const f = fixture();
  const stat = fs.lstatSync;
  try {
    assert.throws(() => hashRuntimeFile(f.root, 'directory'), /bounded regular/u);
    fs.symlinkSync(path.join(f.root, 'assets'), path.join(f.root, 'link'), 'junction');
    assert.throws(() => hashRuntimeFile(path.join(f.root, 'link'), 'link'), /bounded regular/u);
    t.mock.method(fs, 'lstatSync', () =>
      Object.assign(stat(f.node.executable, { bigint: true }), { size: 513n * 1024n * 1024n }),
    );
    assert.throws(() => hashRuntimeFile(f.node.executable, 'huge'), /bounded regular/u);
    t.mock.restoreAll();
    fs.renameSync(path.join(f.root, 'bin'), path.join(f.root, 'original-bin'));
    fs.symlinkSync(path.join(f.root, 'original-bin'), path.join(f.root, 'bin'), 'junction');
    assert.throws(() => listRuntimeFiles(f.root), /directories cannot/u);
    fs.unlinkSync(path.join(f.root, 'bin'));
    f.write('bin', 'file');
    assert.throws(() => listRuntimeFiles(f.root), /directories cannot/u);
    assert.doesNotThrow(() => assertInventoryBudget(50_000, 2 * 1024 * 1024 * 1024));
    assert.throws(() => assertInventoryBudget(50_001, 0), /bounded file/u);
    assert.throws(() => assertInventoryBudget(1, 2 * 1024 * 1024 * 1024 + 1), /bounded file/u);
  } finally {
    t.mock.restoreAll();
    f.close();
  }
});

test('file inspection rejects identity, size and modification races and always closes its descriptor', (t) => {
  const f = fixture();
  const fstat = fs.fstatSync,
    lstat = fs.lstatSync;
  try {
    for (const key of ['dev', 'ino', 'size'] as const) {
      t.mock.method(fs, 'fstatSync', (fd: number) => {
        const value = fstat(fd, { bigint: true });
        return Object.assign(value, { [key]: value[key] + 1n });
      });
      assert.throws(() => hashRuntimeFile(f.node.executable, 'node'), /before it could/u);
      t.mock.restoreAll();
    }
    t.mock.method(fs, 'lstatSync', () =>
      Object.assign(lstat(f.node.executable, { bigint: true }), { size: 0n }),
    );
    t.mock.method(fs, 'fstatSync', (fd: number) =>
      Object.assign(fstat(fd, { bigint: true }), { size: 0n }),
    );
    assert.throws(() => hashRuntimeFile(f.node.executable, 'node'), /grew during/u);
    t.mock.restoreAll();
    t.mock.method(fs, 'readSync', () => 0);
    assert.throws(() => hashRuntimeFile(f.node.executable, 'node'), /changed during/u);
    t.mock.restoreAll();
    for (const key of ['size', 'mtimeNs'] as const) {
      let count = 0;
      t.mock.method(fs, 'fstatSync', (fd: number) => {
        const value = fstat(fd, { bigint: true });
        return ++count === 2 ? Object.assign(value, { [key]: value[key] + 1n }) : value;
      });
      assert.throws(() => hashRuntimeFile(f.node.executable, 'node'), /changed during/u);
      t.mock.restoreAll();
    }
    for (const key of ['dev', 'ino', 'isFile', 'isSymbolicLink'] as const) {
      let count = 0;
      t.mock.method(fs, 'lstatSync', () => {
        const value = lstat(f.node.executable, { bigint: true });
        return ++count === 2
          ? Object.assign(value, {
              [key]:
                key === 'isFile'
                  ? () => false
                  : key === 'isSymbolicLink'
                    ? () => true
                    : value[key] + 1n,
            })
          : value;
      });
      assert.throws(() => hashRuntimeFile(f.node.executable, 'node'), /changed during/u);
      t.mock.restoreAll();
    }
    assert.ok(hashRuntimeFile(f.node.executable, 'node').bytes > 0);
  } finally {
    t.mock.restoreAll();
    f.close();
  }
});

test('the emitted subtree cannot hide a symlink or non-directory in its dist container', () => {
  const f = fixture();
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-runtime-external-'));
  try {
    fs.renameSync(path.join(f.root, 'dist'), path.join(external, 'dist'));
    fs.symlinkSync(path.join(external, 'dist'), path.join(f.root, 'dist'), 'junction');
    assert.throws(() => listRuntimeFiles(f.root), /directories cannot/u);
    fs.unlinkSync(path.join(f.root, 'dist'));
    f.write('dist', 'not a runtime directory');
    assert.throws(() => listRuntimeFiles(f.root), /directories cannot/u);
  } finally {
    f.close();
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test('file identity checks preserve inode precision above Number.MAX_SAFE_INTEGER', (t) => {
  const f = fixture();
  const lstat = fs.lstatSync;
  const fstat = fs.fstatSync;
  const selected = 9_007_199_254_740_992n;
  const opened = selected + 1n;
  assert.equal(Number(selected), Number(opened));
  try {
    t.mock.method(fs, 'lstatSync', (file: fs.PathLike, options?: { bigint?: boolean }) =>
      options?.bigint
        ? Object.assign(lstat(file, { bigint: true }), { ino: selected })
        : Object.assign(lstat(file), { ino: Number(selected) }),
    );
    t.mock.method(fs, 'fstatSync', (fd: number, options?: { bigint?: boolean }) =>
      options?.bigint
        ? Object.assign(fstat(fd, { bigint: true }), { ino: opened })
        : Object.assign(fstat(fd), { ino: Number(opened) }),
    );
    assert.throws(() => hashRuntimeFile(f.node.executable, 'node'), /before it could/u);
  } finally {
    t.mock.restoreAll();
    f.close();
  }
});
