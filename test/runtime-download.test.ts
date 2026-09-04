import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runtimeComponentFixture } from './helpers/runtime-component.js';
import { downloadRuntimeArchive } from '../src/lib/runtime/download.js';

test('download never deletes an existing destination after an exclusive-create failure', async () => {
  const f = runtimeComponentFixture();
  const target = path.join(f.dir, 'existing');
  fs.writeFileSync(target, 'preserve');
  try {
    await assert.rejects(
      downloadRuntimeArchive(f.manifest.components[0]!.archive, target, {
        fetchImpl: async () => new Response(f.archive),
      }),
    );
    assert.equal(fs.readFileSync(target, 'utf8'), 'preserve');
  } finally {
    f.close();
  }
});

test('public downloads use bounded streams, approved redirects and classified read retry only', async (t) => {
  const f = runtimeComponentFixture(),
    archive = f.manifest.components[0]!.archive;
  try {
    const calls: string[] = [];
    let count = 0;
    await downloadRuntimeArchive(archive, path.join(f.dir, 'redirect'), {
      fetchImpl: async (url, init) => {
        calls.push(url);
        assert.equal(init?.redirect, 'manual');
        assert.deepEqual(init?.headers, {
          Accept: 'application/octet-stream',
          'Accept-Encoding': 'identity',
        });
        return ++count === 1
          ? new Response(null, {
              status: 302,
              headers: {
                location:
                  'https://release-assets.githubusercontent.com/public/artifact?signature=not-logged',
              },
            })
          : new Response(f.archive, { headers: { 'content-length': String(archive.bytes) } });
      },
    });
    assert.equal(calls.length, 2);
    for (const first of ['fetch', 'status', 'stream'] as const) {
      let count = 0;
      const sleeps: number[] = [];
      await downloadRuntimeArchive(archive, path.join(f.dir, first), {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        fetchImpl: async () => {
          if (++count === 1) {
            if (first === 'fetch') throw new Error('offline');
            if (first === 'status') return new Response(null, { status: 503 });
            return new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(new Error('interrupted'));
                },
              }),
            );
          }
          return new Response(f.archive);
        },
      });
      assert.equal(count, 2);
      assert.deepEqual(sleeps, [100]);
    }
    t.mock.method(globalThis, 'fetch', async () => new Response(f.archive));
    await downloadRuntimeArchive(archive, path.join(f.dir, 'native-default'));
    t.mock.restoreAll();
    let attempts = 0;
    await assert.rejects(
      downloadRuntimeArchive(archive, path.join(f.dir, 'unavailable'), {
        fetchImpl: async () => {
          attempts++;
          return new Response(null, { status: 429 });
        },
      }),
      /temporarily unavailable/u,
    );
    assert.equal(attempts, 2);
  } finally {
    t.mock.restoreAll();
    f.close();
  }
});

test('invalid responses, sizes, digests and cancellation preserve destination ownership', async () => {
  const f = runtimeComponentFixture(),
    archive = f.manifest.components[0]!.archive;
  const scenarios: Array<{ response: () => Response; pattern: RegExp }> = [
    { response: () => new Response('missing', { status: 404 }), pattern: /complete artifact/u },
    { response: () => new Response(null, { status: 302 }), pattern: /redirect contract/u },
    {
      response: () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://untrusted.invalid/file' },
        }),
      pattern: /distribution origin/u,
    },
    {
      response: () => new Response(f.archive, { headers: { 'content-length': 'bad' } }),
      pattern: /Content-Length/u,
    },
    {
      response: () => new Response(f.archive, { headers: { 'content-length': '1' } }),
      pattern: /Content-Length/u,
    },
    { response: () => new Response(null), pattern: /bounded byte stream/u },
    {
      response: () => new Response(Buffer.concat([f.archive, Buffer.from('extra')])),
      pattern: /declared byte count/u,
    },
    { response: () => new Response(f.archive.subarray(1)), pattern: /bytes or digest/u },
    { response: () => new Response(Buffer.alloc(archive.bytes)), pattern: /bytes or digest/u },
  ];
  try {
    for (const [index, scenario] of scenarios.entries()) {
      const target = path.join(f.dir, `bad-${index}`);
      await assert.rejects(
        downloadRuntimeArchive(archive, target, { fetchImpl: async () => scenario.response() }),
        scenario.pattern,
      );
      assert.equal(fs.existsSync(target), false);
    }
    await assert.rejects(
      downloadRuntimeArchive(archive, path.join(f.dir, 'redirect-loop'), {
        fetchImpl: async () =>
          new Response(null, { status: 307, headers: { location: archive.url } }),
      }),
      /redirect contract/u,
    );
    for (const timeoutMs of [0, 120001, 1.5])
      await assert.rejects(
        downloadRuntimeArchive(archive, path.join(f.dir, 'timeout'), { timeoutMs }),
        /between 1/u,
      );
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(
      downloadRuntimeArchive(archive, path.join(f.dir, 'cancelled'), { signal: cancelled.signal }),
    );
    const duringFetch = new AbortController();
    let fetches = 0;
    await assert.rejects(
      downloadRuntimeArchive(archive, path.join(f.dir, 'cancel-fetch'), {
        signal: duringFetch.signal,
        fetchImpl: async () => {
          fetches++;
          duringFetch.abort();
          throw new Error('stop');
        },
      }),
      /stop/u,
    );
    assert.equal(fetches, 1);
    const duringRead = new AbortController();
    await assert.rejects(
      downloadRuntimeArchive(archive, path.join(f.dir, 'cancel-read'), {
        signal: duringRead.signal,
        fetchImpl: async () =>
          new Response(
            new ReadableStream({
              pull(controller) {
                duringRead.abort();
                controller.error(new Error('stop read'));
              },
            }),
          ),
      }),
    );
  } finally {
    f.close();
  }
});

test('download cancellation drains body-bearing redirects and transient responses without retrying a stop', async () => {
  const f = runtimeComponentFixture(),
    archive = f.manifest.components[0]!.archive;
  try {
    for (const kind of ['redirect', 'transient'] as const) {
      let count = 0;
      await downloadRuntimeArchive(archive, path.join(f.dir, kind + '-body'), {
        signal: new AbortController().signal,
        sleep: async () => undefined,
        fetchImpl: async () =>
          ++count === 1
            ? new Response('body', {
                status: kind === 'redirect' ? 302 : 408,
                headers:
                  kind === 'redirect'
                    ? { location: 'https://objects.githubusercontent.com/archive' }
                    : {},
              })
            : new Response(f.archive),
      });
      assert.equal(count, 2);
    }
    const reading = new AbortController();
    await assert.rejects(
      downloadRuntimeArchive(archive, path.join(f.dir, 'stop-reading'), {
        signal: reading.signal,
        fetchImpl: async () =>
          new Response(
            new ReadableStream({
              pull(controller) {
                setImmediate(() => {
                  reading.abort();
                  controller.error(new Error('read stopped'));
                });
              },
            }),
          ),
      }),
    );
    const transient = new AbortController();
    let count = 0;
    await assert.rejects(
      downloadRuntimeArchive(archive, path.join(f.dir, 'stop-transient'), {
        signal: transient.signal,
        fetchImpl: async () => {
          count++;
          return new Response(
            new ReadableStream({
              cancel() {
                transient.abort();
              },
            }),
            { status: 503 },
          );
        },
      }),
    );
    assert.equal(count, 1);
  } finally {
    f.close();
  }
});
