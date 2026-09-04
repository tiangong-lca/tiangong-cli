import fs from 'node:fs';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { cachePath } from './storage.js';
import { hashRuntimeFile, runtimeError } from './files.js';
import { array, integer, relativeFile, sha, unique } from './manifest-values.js';
import type { ComponentFile } from './manifest-types.js';

export function runtimeTarHeader(file: ComponentFile): Buffer {
  const parts = file.path.split('/');
  let name = file.path,
    prefix = '';
  if (Buffer.byteLength(name) > 100) {
    for (let split = parts.length - 1; split > 0; split--) {
      const head = parts.slice(0, split).join('/'),
        tail = parts.slice(split).join('/');
      if (Buffer.byteLength(head) <= 155 && Buffer.byteLength(tail) <= 100) {
        prefix = head;
        name = tail;
        break;
      }
    }
  }
  const header = Buffer.alloc(512);
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
  const checksum = header.reduce((sum, value) => sum + value, 0);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return header;
}
/** Release-side writer. The producer supplies an explicit, already materialized production file inventory. */
export async function writeRuntimeComponentArchive(
  root: string,
  files: readonly ComponentFile[],
  target: string,
): Promise<{ bytes: number; sha256: string }> {
  array(files, 50_000, 1);
  unique(
    files.map((file) => relativeFile(file.path).toLowerCase()),
    'archive file',
  );
  if (
    JSON.stringify(files.map((file) => file.path)) !==
    JSON.stringify(files.map((file) => file.path).sort())
  )
    runtimeError(
      'RUNTIME_ARCHIVE_ORDER',
      'Component archive files must be sorted by portable path.',
    );
  let total = 0;
  for (const file of files) {
    integer(file.bytes, 512 * 1024 * 1024);
    sha(file.sha256);
    if (file.mode !== 420 && file.mode !== 493)
      runtimeError('RUNTIME_ARCHIVE_MODE', 'Component file modes must be 0644 or 0755.');
    total += file.bytes;
    if (total > 2 * 1024 * 1024 * 1024)
      runtimeError('RUNTIME_ARCHIVE_SIZE', 'Component files exceed the unpacked size limit.');
  }
  for (const file of files) {
    const actual = hashRuntimeFile(cachePath(root, file.path), file.path);
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256)
      runtimeError('RUNTIME_ARCHIVE_SOURCE_CHANGED', 'Component source changed before packaging.');
  }
  async function* records() {
    for (const file of files) {
      yield runtimeTarHeader(file);
      const hash = createHash('sha256');
      let bytes = 0;
      for await (const chunk of fs.createReadStream(cachePath(root, file.path))) {
        const buffer = chunk as Buffer;
        bytes += buffer.length;
        if (bytes > file.bytes)
          runtimeError('RUNTIME_ARCHIVE_SOURCE_CHANGED', 'Component source grew while packaging.');
        hash.update(buffer);
        yield buffer;
      }
      if (bytes !== file.bytes || hash.digest('hex') !== file.sha256)
        runtimeError(
          'RUNTIME_ARCHIVE_SOURCE_CHANGED',
          'Component source bytes changed while packaging.',
        );
      const padding = (512 - (file.bytes % 512)) % 512;
      if (padding) yield Buffer.alloc(padding);
    }
    yield Buffer.alloc(1024);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  await pipeline(
    records(),
    createGzip({ level: 9 }),
    fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }),
  );
  const fact = hashRuntimeFile(target, 'archive');
  return { bytes: fact.bytes, sha256: fact.sha256 };
}
