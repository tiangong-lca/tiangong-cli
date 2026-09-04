import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';
import { runtimeComponentFixture, tarBytes, hash } from './helpers/runtime-component.js';
import { extractRuntimeArchive } from '../src/lib/runtime/archive.js';
import {
  writeRuntimeComponentArchive,
  runtimeTarHeader,
} from '../src/lib/runtime/archive-writer.js';
import { verifyRuntimeComponent } from '../src/lib/runtime/manager.js';
import type { ComponentFile } from '../src/lib/runtime/manifest-types.js';

function checksum(header: Buffer) {
  header.fill(32, 148, 156);
  header.write(
    header
      .reduce((sum, value) => sum + value, 0)
      .toString(8)
      .padStart(6, '0') + '\0 ',
    148,
    8,
    'ascii',
  );
}
test('release archive writer round-trips through the owner extractor and the OS tar reader', async () => {
  const f = runtimeComponentFixture();
  try {
    const root = path.join(f.dir, 'source');
    fs.mkdirSync(root);
    for (const file of f.files) {
      const target = path.join(root, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, f.contents[file.path]!);
    }
    const target = path.join(f.dir, 'generated.tar.gz');
    const fact = await writeRuntimeComponentArchive(root, f.files, target);
    assert.equal(fact.bytes, fs.statSync(target).size);
    assert.equal(fact.sha256, hash(fs.readFileSync(target)));
    const listed = spawnSync('tar', ['-tzf', target], { encoding: 'utf8', shell: false });
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(
      listed.stdout.trim().split(/\r?\n/u),
      f.files.map((file) => file.path),
    );
    const extracted = path.join(f.dir, 'extracted');
    await extractRuntimeArchive(target, extracted, f.manifest.components[0]!);
    verifyRuntimeComponent(
      extracted,
      f.manifest.components[0]!,
      process.platform + '-' + process.arch,
    );
    await assert.rejects(
      writeRuntimeComponentArchive(root, [...f.files].reverse(), path.join(f.dir, 'order')),
      /sorted/u,
    );
    await assert.rejects(
      writeRuntimeComponentArchive(
        root,
        [{ ...f.files[0]!, mode: 511 } as unknown as ComponentFile],
        path.join(f.dir, 'mode'),
      ),
      /0644 or 0755/u,
    );
    await assert.rejects(
      writeRuntimeComponentArchive(
        root,
        [{ ...f.files[0]!, sha256: '0'.repeat(64) }],
        path.join(f.dir, 'changed'),
      ),
      /source changed/u,
    );
    const tooLarge = Array.from({ length: 5 }, (_, index) => ({
      ...f.files[0]!,
      path: 'a' + index,
      bytes: 512 * 1024 * 1024,
    }));
    // Budget checks happen before any archive publication; source presence remains required.
    await assert.rejects(writeRuntimeComponentArchive(root, tooLarge, path.join(f.dir, 'large')));
    const longPath = 'a'.repeat(90) + '/' + 'b'.repeat(30),
      bytes = Buffer.from('long path');
    const longFile = {
      path: longPath,
      bytes: bytes.length,
      sha256: hash(bytes),
      mode: 420 as const,
    };
    assert.equal(runtimeTarHeader(longFile).subarray(345, 435).toString(), 'a'.repeat(90));
    const longArchive = path.join(f.dir, 'long.tar.gz');
    fs.writeFileSync(longArchive, gzipSync(tarBytes([longFile], { [longPath]: bytes })));
    await extractRuntimeArchive(longArchive, path.join(f.dir, 'long-root'), {
      ...f.manifest.components[0]!,
      files: [longFile],
    });
    const empty = { path: 'empty', bytes: 0, sha256: hash(''), mode: 420 as const };
    const emptyArchive = path.join(f.dir, 'empty.tar.gz');
    fs.writeFileSync(emptyArchive, gzipSync(tarBytes([empty], { empty: Buffer.alloc(0) })));
    await extractRuntimeArchive(emptyArchive, path.join(f.dir, 'empty-root'), {
      ...f.manifest.components[0]!,
      files: [empty],
    });
  } finally {
    f.close();
  }
});

test('unsafe archive headers, paths, file bytes and trailing content fail before acceptance', async () => {
  const f = runtimeComponentFixture();
  const plain = gunzipSync(f.archive);
  const mutations: Array<{ change: (bytes: Buffer) => void; pattern: RegExp }> = [
    {
      change: (b) => {
        b[0] = 255;
        checksum(b.subarray(0, 512));
      },
      pattern: /UTF-8/u,
    },
    {
      change: (b) => {
        b[12] = 0;
        b[13] = 97;
        checksum(b.subarray(0, 512));
      },
      pattern: /padding/u,
    },
    {
      change: (b) => {
        b[148] = 57;
      },
      pattern: /octal/u,
    },
    {
      change: (b) => {
        b[0] = b[0]! ^ 1;
      },
      pattern: /regular-file/u,
    },
    {
      change: (b) => {
        b.write('wrong', 257);
        checksum(b.subarray(0, 512));
      },
      pattern: /regular-file/u,
    },
    {
      change: (b) => {
        b[156] = 50;
        checksum(b.subarray(0, 512));
      },
      pattern: /regular-file/u,
    },
    {
      change: (b) => {
        b.write('../escape\0', 0);
        checksum(b.subarray(0, 512));
      },
      pattern: /padding|differs/u,
    },
    {
      change: (b) => {
        b.write('0000777\0', 100);
        checksum(b.subarray(0, 512));
      },
      pattern: /differs/u,
    },
    {
      change: (b) => {
        b.write('00000000001\0', 124);
        checksum(b.subarray(0, 512));
      },
      pattern: /differs/u,
    },
    {
      change: (b) => {
        b.write('link\0', 157);
        checksum(b.subarray(0, 512));
      },
      pattern: /differs/u,
    },
    {
      change: (b) => {
        b[512] = 33;
      },
      pattern: /SHA-256/u,
    },
    {
      change: (b) => {
        b[512 + f.files[0]!.bytes] = 33;
      },
      pattern: /padding/u,
    },
    {
      change: (b) => {
        b[b.length - 1] = 33;
      },
      pattern: /trailing/u,
    },
  ];
  try {
    for (const [index, mutation] of mutations.entries()) {
      const bytes = Buffer.from(plain);
      mutation.change(bytes);
      const archive = path.join(f.dir, `bad-${index}.tar.gz`);
      fs.writeFileSync(archive, gzipSync(bytes));
      await assert.rejects(
        extractRuntimeArchive(archive, path.join(f.dir, `bad-${index}`), f.manifest.components[0]!),
        mutation.pattern,
      );
    }
    for (const [name, bytes] of [
      ['short', plain.subarray(1)],
      ['long', Buffer.concat([plain, Buffer.alloc(512)])],
    ] as const) {
      const archive = path.join(f.dir, name + '.gz');
      fs.writeFileSync(archive, gzipSync(bytes));
      await assert.rejects(
        extractRuntimeArchive(archive, path.join(f.dir, name), f.manifest.components[0]!),
        /size/u,
      );
    }
    const cancelled = new AbortController();
    cancelled.abort();
    const archive = path.join(f.dir, 'cancel.gz');
    fs.writeFileSync(archive, f.archive);
    await assert.rejects(
      extractRuntimeArchive(
        archive,
        path.join(f.dir, 'cancel'),
        f.manifest.components[0]!,
        cancelled.signal,
      ),
    );
  } finally {
    f.close();
  }
});

test('packaging detects changing source bytes and extraction detects a truncated staging file', async (t) => {
  const f = runtimeComponentFixture(),
    root = path.join(f.dir, 'source');
  fs.mkdirSync(root);
  try {
    for (const file of f.files) {
      const target = path.join(root, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, f.contents[file.path]!);
    }
    const writer = fs.createWriteStream,
      source = path.join(root, f.files[0]!.path),
      original = fs.readFileSync(source);
    for (const grow of [true, false]) {
      t.mock.method(
        fs,
        'createWriteStream',
        (file: fs.PathLike, options?: Parameters<typeof fs.createWriteStream>[1]) => {
          fs.writeFileSync(
            source,
            grow
              ? Buffer.concat([original, Buffer.from('more')])
              : Buffer.alloc(original.length, 88),
          );
          return writer(file, options);
        },
      );
      await assert.rejects(
        writeRuntimeComponentArchive(
          root,
          f.files,
          path.join(f.dir, 'changed-' + String(grow) + '.gz'),
        ),
        /grew|bytes changed/u,
      );
      t.mock.restoreAll();
      fs.writeFileSync(source, original);
    }
    const archive = path.join(f.dir, 'truncated.gz');
    fs.writeFileSync(archive, f.archive);
    const open = fs.openSync;
    t.mock.method(fs, 'openSync', (file: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
      if (String(file).endsWith('.tar') && flags === 'r') fs.truncateSync(file, 16);
      return open(file, flags, mode);
    });
    await assert.rejects(
      extractRuntimeArchive(archive, path.join(f.dir, 'truncate'), f.manifest.components[0]!),
      /ended before/u,
    );
    t.mock.restoreAll();
    const file = { path: 'a'.repeat(100), bytes: 0, sha256: hash(''), mode: 420 as const };
    const fullName = path.join(f.dir, 'full-name.gz');
    fs.writeFileSync(fullName, gzipSync(tarBytes([file], { [file.path]: Buffer.alloc(0) })));
    await extractRuntimeArchive(fullName, path.join(f.dir, 'full-name'), {
      ...f.manifest.components[0]!,
      files: [file],
    });
  } finally {
    t.mock.restoreAll();
    f.close();
  }
});

test('active cancellation signals remain bound through extraction of declared files', async () => {
  const f = runtimeComponentFixture();
  try {
    const archive = path.join(f.dir, 'active.gz');
    fs.writeFileSync(archive, f.archive);
    await extractRuntimeArchive(
      archive,
      path.join(f.dir, 'active-root'),
      f.manifest.components[0]!,
      new AbortController().signal,
    );
  } finally {
    f.close();
  }
});
