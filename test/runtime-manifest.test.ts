import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeComponentFixture, hash } from './helpers/runtime-component.js';
import {
  parseRuntimeManifest,
  trustRuntimeManifest,
  loadTrustedRuntimeManifest,
  assertTrustedManifest,
  assertWorkspaceCompatibility,
} from '../src/lib/runtime/manifest.js';
import {
  record,
  exact,
  id,
  version,
  sha,
  integer,
  array,
  relativeFile,
  distributionUrl,
  deepFreeze,
} from '../src/lib/runtime/manifest-values.js';
import type { TrustedRuntimeManifest } from '../src/lib/runtime/manifest-types.js';

type Json = Record<string, unknown>;
const clone = (value: unknown) => JSON.parse(JSON.stringify(value)) as Json;
const component = (value: Json) => (value.components as Json[])[0]!;
function fails(value: unknown) {
  assert.throws(() => parseRuntimeManifest(value), /Runtime manifest/u);
}

test('manifest trust is byte-bound, branded, immutable and read/write feature-specific', () => {
  const f = runtimeComponentFixture();
  try {
    const trusted = loadTrustedRuntimeManifest(f.manifestPath, f.sha256);
    assert.equal(Object.isFrozen(trusted.manifest.components[0]!.files), true);
    assertTrustedManifest(trusted);
    assert.throws(
      () => assertTrustedManifest({ ...trusted } as TrustedRuntimeManifest),
      /independent trusted/u,
    );
    assert.throws(() => trustRuntimeManifest(f.manifestBytes, '0'.repeat(64)), /trust anchor/u);
    const invalid = Buffer.from('not-json');
    assert.throws(() => trustRuntimeManifest(invalid, hash(invalid)), /JSON/u);
    const large = Buffer.alloc(32 * 1024 * 1024 + 1);
    assert.throws(() => trustRuntimeManifest(large, hash(large)), /trust anchor/u);
    assert.throws(() => loadTrustedRuntimeManifest(f.dir, f.sha256), /bounded regular/u);
    assertWorkspaceCompatibility(
      trusted,
      { schema: 'workspace.v1', features: ['ledger'] },
      'write',
    );
    for (const request of [
      { schema: 'unknown', features: [] },
      { schema: 'workspace.v1', features: ['new'] },
    ])
      assert.throws(
        () => assertWorkspaceCompatibility(trusted, request, 'read'),
        /does not support/u,
      );
    assert.throws(
      () =>
        assertWorkspaceCompatibility(
          trusted,
          { schema: 'workspace.v1', features: [] },
          'unknown' as 'read',
        ),
      /does not support/u,
    );
    assert.throws(() => loadTrustedRuntimeManifest(f.manifestPath, hash('{}')), /trust anchor/u);
  } finally {
    f.close();
  }
});

test('strict component manifests reject ambiguity, missing metadata and unsafe compatibility', () => {
  const f = runtimeComponentFixture();
  try {
    for (const value of [
      null,
      [],
      1,
      {},
      { ...f.manifest, extra: true },
      { ...f.manifest, schema: 'unknown' },
      { ...f.manifest, bootstrap_protocol: 'unknown' },
    ])
      fails(value);
    const mutations: Array<(value: Json) => void> = [
      (value) => {
        (value.product as Json).version = 'latest';
      },
      (value) => {
        component(value).extra = true;
      },
      (value) => {
        (component(value).archive as Json).format = 'zip';
      },
      (value) => {
        component(value).files = [];
      },
      (value) => {
        const files = component(value).files as Json[];
        files[0]!.mode = 511;
      },
      (value) => {
        (component(value).files as Json[])[0]!.extra = true;
      },
      (value) => {
        for (const file of component(value).files as Json[]) file.bytes = 512 * 1024 * 1024;
      },
      (value) => {
        const files = component(value).files as Json[];
        files[1]!.path = String(files[0]!.path).toUpperCase();
      },
      (value) => {
        (component(value).files as Json[]).reverse();
      },
      (value) => {
        const files = component(value).files as Json[];
        files[0]!.path = 'bin';
        files[1]!.path = 'bin/tool';
      },
      (value) => {
        component(value).content_sha256 = '0'.repeat(64);
      },
      (value) => {
        component(value).production_lock = 'missing';
      },
      (value) => {
        component(value).licenses = [];
      },
      (value) => {
        component(value).protocols = ['same', 'same'];
      },
      (value) => {
        component(value).asset_fingerprints = Object.fromEntries(
          Array.from({ length: 65 }, (_, i) => ['id' + i, '0'.repeat(64)]),
        );
      },
      (value) => {
        (value.components as Json[]).push(component(value));
      },
      (value) => {
        value.minimum_hosts = {};
      },
      (value) => {
        value.minimum_hosts = { 'darwin-x64': { os_release: '1.0.0', glibc: null } };
      },
      (value) => {
        value.minimum_hosts = { 'linux-x64': { os_release: '1.0.0', glibc: null } };
      },
      (value) => {
        value.minimum_hosts = { 'darwin-arm64': { os_release: '1.0.0', glibc: '2.28' } };
      },
      (value) => {
        value.minimum_hosts = { 'linux-x64': { os_release: '1.0.0', glibc: 'bad' } };
      },
      (value) => {
        value.launches = [];
      },
      (value) => {
        (value.launches as Json[])[0]!.environment = 'all-env';
      },
      (value) => {
        (value.launches as Json[])[0]!.executable = { component: 'missing', path: 'bin/tool' };
      },
      (value) => {
        (value.launches as Json[])[0]!.executable = {
          component: 'base',
          path: 'metadata/license.txt',
        };
      },
      (value) => {
        (value.launches as Json[])[0]!.argv = [{ literal: 'a', extra: 1 }];
      },
      (value) => {
        (value.launches as Json[]).push((value.launches as Json[])[0]!);
      },
      (value) => {
        const workspace = value.workspace as Json;
        (workspace.read as Json[])[0]!.features = [];
      },
      (value) => {
        const workspace = value.workspace as Json;
        (workspace.read as Json[]).push((workspace.read as Json[])[0]!);
      },
      (value) => {
        ((value.workspace as Json).read as Json[])[0]!.features = ['ledger', 'ledger'];
      },
    ];
    for (const mutate of mutations) {
      const value = clone(f.manifest);
      mutate(value);
      fails(value);
    }
    const value = clone(f.manifest);
    (value.launches as Json[])[0]!.argv = [
      { literal: '--json' },
      { component: 'base', path: 'metadata/license.txt' },
    ];
    assert.equal(parseRuntimeManifest(value).launches[0]!.argv.length, 2);
    const linux = clone(f.manifest);
    component(linux).platform = 'linux-x64';
    (linux.launches as Json[])[0]!.platform = 'linux-x64';
    linux.minimum_hosts = { 'linux-x64': { os_release: '4.18.0', glibc: '2.28' } };
    parseRuntimeManifest(linux);
    const mac = clone(f.manifest);
    component(mac).platform = 'darwin-arm64';
    (mac.launches as Json[])[0]!.platform = 'darwin-arm64';
    mac.minimum_hosts = { 'darwin-arm64': { os_release: '24.0.0', glibc: null } };
    parseRuntimeManifest(mac);
  } finally {
    f.close();
  }
});

test('portable paths and immutable origins reject traversal, credentials and unsupported encodings', () => {
  for (const value of [null, [], 1]) assert.throws(() => record(value, 'record'));
  assert.throws(() => exact({ a: 1, b: 2 }, ['a', 'c'], 'keys'));
  assert.throws(() => id('..'));
  assert.throws(() => version('01.0.0'));
  assert.throws(() => sha('bad'));
  for (const value of [-1, 1.2, Number.MAX_SAFE_INTEGER]) assert.throws(() => integer(value, 10));
  assert.throws(() => array([], 2, 1));
  for (const value of [
    '',
    '/x',
    '../x',
    'a/../b',
    'a\\b',
    'C:/x',
    'a//b',
    'a/.',
    'name.',
    'name ',
    'con.txt',
    '.env',
    '.git/x',
    '\0',
    'a'.repeat(101),
    'd/'.repeat(33) + 'x',
  ])
    assert.throws(() => relativeFile(value), /path|USTAR/u);
  assert.equal(relativeFile('目录 with spaces/file.json'), '目录 with spaces/file.json');
  assert.equal(
    relativeFile('a'.repeat(90) + '/' + 'b'.repeat(30)),
    'a'.repeat(90) + '/' + 'b'.repeat(30),
  );
  assert.throws(() => relativeFile('a'.repeat(156) + '/' + 'b'.repeat(90)), /USTAR/u);
  for (const url of [
    'not a url',
    'http://github.com/a/b/releases/download/v1/file',
    'https://u:p@github.com/a/b/releases/download/v1/file',
    'https://github.com:8443/a/b/releases/download/v1/file',
    'https://github.com/a/b/releases/latest/file',
    'https://github.com/a/b/raw/file',
    'https://nodejs.org/dist/latest/node.tar.gz',
    'https://registry.npmjs.org/pkg',
    'https://evil.invalid/file',
    'https://github.com/a/b/releases/download/v1/file?x=1',
    'https://github.com/a/b/releases/download/v1/file#x',
  ])
    assert.throws(() => distributionUrl(url));
  for (const url of [
    'https://github.com/a/b/releases/download/v1/file.tar.gz',
    'https://nodejs.org/dist/v24.19.0/node.tar.gz',
    'https://registry.npmjs.org/pkg/-/pkg-1.2.3.tgz',
  ])
    assert.equal(distributionUrl(url), url);
  assert.equal(
    distributionUrl('https://objects.githubusercontent.com/object?sig=temporary', true),
    'https://objects.githubusercontent.com/object?sig=temporary',
  );
  assert.equal(deepFreeze(null), null);
  const frozen = Object.freeze({ key: 'value' });
  assert.equal(deepFreeze(frozen), frozen);
});

test('every component platform needs a matching launch and versioned Node URL', () => {
  const f = runtimeComponentFixture();
  try {
    const value = clone(f.manifest),
      other = component(value).platform === 'linux-x64' ? 'darwin-arm64' : 'linux-x64';
    (value.components as Json[]).push({ ...component(value), platform: other });
    (value.minimum_hosts as Json)[other] = {
      os_release: '1.0.0',
      glibc: other === 'linux-x64' ? '2.28' : null,
    };
    fails(value);
    assert.throws(
      () => distributionUrl('https://nodejs.org/somewhere/node.gz'),
      /Node release URL/u,
    );
  } finally {
    f.close();
  }
});
