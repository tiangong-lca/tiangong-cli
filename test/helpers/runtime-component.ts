import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { RuntimeManifest, ComponentFile } from '../../src/lib/runtime/manifest-types.js';
import {
  RUNTIME_MANIFEST_SCHEMA,
  RUNTIME_BOOTSTRAP_PROTOCOL,
  RUNTIME_ARCHIVE_FORMAT,
} from '../../src/lib/runtime/manifest-types.js';
import { runtimePlatform } from '../../src/lib/runtime/descriptor.js';

export const hash = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');
export function tarBytes(
  files: readonly ComponentFile[],
  contents: Readonly<Record<string, Buffer>>,
): Buffer {
  const chunks: Buffer[] = [];
  for (const file of files) {
    const header = Buffer.alloc(512);
    const parts = file.path.split('/');
    let name = file.path,
      prefix = '';
    if (Buffer.byteLength(name) > 100) {
      for (let split = parts.length - 1; split > 0; split--) {
        const a = parts.slice(0, split).join('/'),
          b = parts.slice(split).join('/');
        if (Buffer.byteLength(a) <= 155 && Buffer.byteLength(b) <= 100) {
          prefix = a;
          name = b;
          break;
        }
      }
    }
    header.write(name, 0, 100, 'utf8');
    header.write(prefix, 345, 155, 'utf8');
    for (const [offset, length, value] of [
      [100, 8, file.mode],
      [108, 8, 0],
      [116, 8, 0],
      [124, 12, file.bytes],
      [136, 12, 0],
    ] as const)
      header.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length, 'ascii');
    header.fill(32, 148, 156);
    header[156] = 48;
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    const sum = header.reduce((total, value) => total + value, 0);
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    chunks.push(header, contents[file.path]!, Buffer.alloc((512 - (file.bytes % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}
export function runtimeComponentFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-manager-'));
  const contents: Record<string, Buffer> = {
    'bin/tool': Buffer.from('a runtime tool\n'),
    'metadata/license.txt': Buffer.from('fixture license\n'),
    'metadata/production-lock.json': Buffer.from('{}\n'),
    'metadata/provenance.json': Buffer.from('{}\n'),
    'metadata/sbom.json': Buffer.from('{}\n'),
  };
  const files: ComponentFile[] = Object.keys(contents)
    .sort()
    .map((path) => ({
      path,
      bytes: contents[path]!.length,
      sha256: hash(contents[path]!),
      mode: path === 'bin/tool' ? 493 : 420,
    }));
  const archive = gzipSync(tarBytes(files, contents));
  const platform = runtimePlatform(process.platform, process.arch);
  const manifest: RuntimeManifest = {
    schema: RUNTIME_MANIFEST_SCHEMA,
    bootstrap_protocol: RUNTIME_BOOTSTRAP_PROTOCOL,
    product: { id: 'test-runtime', version: '1.0.0' },
    minimum_hosts: {
      [platform]: { os_release: '0.0.0', glibc: platform.startsWith('linux') ? '0.0' : null },
    },
    workspace: {
      read: [{ schema: 'workspace.v1', features: ['ledger'] }],
      write: [{ schema: 'workspace.v1', features: ['ledger'] }],
    },
    components: [
      {
        id: 'base',
        version: '1.0.0',
        platform,
        archive: {
          format: RUNTIME_ARCHIVE_FORMAT,
          url: 'https://github.com/tiangong-lca/runtime-fixture/releases/download/v1.0.0/base.tar.gz',
          bytes: archive.length,
          sha256: hash(archive),
        },
        files,
        content_sha256: hash(JSON.stringify(files)),
        production_lock: 'metadata/production-lock.json',
        sbom: 'metadata/sbom.json',
        licenses: ['metadata/license.txt'],
        provenance: ['metadata/provenance.json'],
        protocols: ['fixture.v1'],
        asset_fingerprints: { fixture: '1'.repeat(64) },
      },
    ],
    launches: [
      {
        id: 'tool',
        platform,
        executable: { component: 'base', path: 'bin/tool' },
        environment: 'isolated',
        argv: [],
      },
    ],
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const manifestPath = path.join(dir, 'manifest.json');
  fs.writeFileSync(manifestPath, manifestBytes);
  return {
    dir,
    contents,
    files,
    archive,
    manifest,
    manifestBytes,
    manifestPath,
    sha256: hash(manifestBytes),
    cacheDir: path.join(dir, 'cache'),
    close: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
