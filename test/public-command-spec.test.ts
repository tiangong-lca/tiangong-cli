import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  FOUNDRY_COMMAND_SPEC_SCHEMA,
  FoundryCommandSpecAbortError,
  FoundryCommandSpecTimeoutError,
  assertFoundryCommandSpecArtifactsCurrent,
  assertFoundryCommandSpecBindsArtifact,
  commandSpecOptionValue,
  createFileArtifactFact,
  createFoundryCommandSpec,
  executeFoundryCommandSpec,
  executeFoundryCommandSpecSync,
  parseFoundryCommandSpec,
  renderFoundryCommandDisplay,
  type FoundryCommandSpecAsyncSpawnOptions,
} from '../src/command-spec.js';

const FIXTURE_ARTIFACT_SHA = 'a'.repeat(64);
const FIXTURE_SPEC_SHA = '2a7d41b680bd0667f8d43fb5967d92a49b24a5ec9c3d463ec45eaef0dc2b7406';

test('CommandSpec remains byte-compatible with the Foundry v1 authority domain', () => {
  const spec = createFoundryCommandSpec({
    executable: '/usr/local/bin/tiangong-lca',
    argv: [
      'dataset',
      'save-draft',
      '--input',
      'rows with spaces.jsonl',
      '--out-dir',
      'out;safe',
      '--commit',
      '--json',
    ],
    binding: {
      artifacts: [
        {
          role: 'final_rows',
          path: 'rows with spaces.jsonl',
          bytes: 15,
          sha256: FIXTURE_ARTIFACT_SHA,
        },
      ],
    },
  });

  assert.deepEqual(Object.keys(spec), [
    'schema',
    'executable',
    'argv',
    'display',
    'binding',
    'sha256',
  ]);
  assert.equal(spec.schema, FOUNDRY_COMMAND_SPEC_SCHEMA);
  assert.equal(spec.sha256, FIXTURE_SPEC_SHA);
  assert.equal(
    spec.display,
    "/usr/local/bin/tiangong-lca dataset save-draft --input 'rows with spaces.jsonl' --out-dir 'out;safe' --commit --json",
  );
  assert.equal(commandSpecOptionValue(spec, '--input'), 'rows with spaces.jsonl');
  assert.equal(commandSpecOptionValue(spec, '--missing'), null);
  assert.equal(commandSpecOptionValue(spec, '--json'), null);

  const diagnosticOption = createFoundryCommandSpec({
    executable: 'tool',
    argv: ['--unknown=value', '--custom='],
  });
  assert.equal(commandSpecOptionValue(diagnosticOption, '--custom'), null);

  const displayDrift = parseFoundryCommandSpec({ ...spec, display: 'never execute this text' });
  assert.equal(displayDrift.sha256, FIXTURE_SPEC_SHA);
});

test('CommandSpec rejects non-exact shapes, authority drift, and critical flag ambiguity', () => {
  const base = createFoundryCommandSpec({
    executable: process.execPath,
    argv: ['fixture.js', '--input', 'rows.jsonl', '--commit', '--json'],
  });

  for (const value of [
    null,
    { ...base, extra: true },
    { ...base, schema: 'other' },
    { ...base, executable: '' },
    { ...base, argv: 'not-an-array' },
    { ...base, argv: ['ok', 'bad\nvalue'] },
    { ...base, display: '' },
    { ...base, binding: {} },
    { ...base, binding: { artifacts: [{ role: 'x' }] } },
    {
      ...base,
      binding: {
        artifacts: [
          { role: 'x', path: 'a', bytes: 0, sha256: FIXTURE_ARTIFACT_SHA },
          { role: 'x', path: 'b', bytes: 0, sha256: FIXTURE_ARTIFACT_SHA },
        ],
      },
    },
    { ...base, sha256: 'not-a-sha' },
    { ...base, sha256: '0'.repeat(64) },
  ]) {
    assert.throws(() => parseFoundryCommandSpec(value));
  }

  for (const argv of [
    ['fixture.js', '--input', 'a', '--input', 'b'],
    ['fixture.js', '--input=a', '--input-file=b'],
    ['fixture.js', '--input'],
    ['fixture.js', '--input', '--json'],
    ['fixture.js', '--input='],
    ['fixture.js', '--commit=false'],
  ]) {
    assert.throws(() => createFoundryCommandSpec({ executable: process.execPath, argv }));
  }
});

test('CommandSpec binds exact artifact bytes and blocks drift before sync spawn', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'cli-command-spec-'));
  const artifactPath = path.join(root, 'rows.jsonl');
  writeFileSync(artifactPath, '{"id":"before"}\n');
  let spawnCalls = 0;

  try {
    const artifact = createFileArtifactFact({
      role: 'final_rows',
      path: 'artifacts/rows.jsonl',
      filePath: artifactPath,
    });
    const spec = createFoundryCommandSpec({
      executable: process.execPath,
      argv: ['fixture.js', '--input-file=artifacts/rows.jsonl', '--json'],
      binding: { artifacts: [artifact] },
    });

    assert.equal(artifact.bytes, readFileSync(artifactPath).byteLength);
    assert.equal(
      artifact.sha256,
      createHash('sha256').update(readFileSync(artifactPath)).digest('hex'),
    );
    assert.equal(commandSpecOptionValue(spec, '--input-file'), 'artifacts/rows.jsonl');
    assert.doesNotThrow(() => assertFoundryCommandSpecBindsArtifact(spec, artifact));
    assert.throws(() =>
      assertFoundryCommandSpecBindsArtifact(spec, { ...artifact, sha256: '0'.repeat(64) }),
    );
    assert.throws(() => assertFoundryCommandSpecArtifactsCurrent(spec, () => null));
    assert.throws(() => assertFoundryCommandSpecArtifactsCurrent(spec, () => root));

    const result = executeFoundryCommandSpecSync(
      { ...spec, display: 'touch forbidden' },
      {
        resolveArtifactPath: (value) => (value === 'artifacts/rows.jsonl' ? artifactPath : null),
        cwd: root,
        env: { TEST_ONLY: '1' },
        maxBuffer: 1024,
        spawnImpl: (executable, argv, options) => {
          spawnCalls += 1;
          assert.equal(executable, process.execPath);
          assert.deepEqual(argv, ['fixture.js', '--input-file=artifacts/rows.jsonl', '--json']);
          assert.equal(options.shell, false);
          assert.equal(options.windowsHide, true);
          assert.equal(options.encoding, 'utf8');
          assert.equal(options.cwd, root);
          assert.equal(options.env?.TEST_ONLY, '1');
          assert.equal(options.maxBuffer, 1024);
          return { stdout: 'ok', stderr: '', status: 0, signal: null };
        },
      },
    );
    assert.equal(result.stdout, 'ok');
    assert.equal(spawnCalls, 1);

    writeFileSync(artifactPath, '{"id":"after"}\n');
    assert.throws(() =>
      assertFoundryCommandSpecArtifactsCurrent(spec, (value) =>
        value === 'artifacts/rows.jsonl' ? artifactPath : null,
      ),
    );
    assert.throws(() =>
      executeFoundryCommandSpecSync(spec, {
        resolveArtifactPath: () => artifactPath,
        spawnImpl: () => {
          spawnCalls += 1;
          return { stdout: '', stderr: '', status: 0, signal: null };
        },
      }),
    );
    assert.equal(spawnCalls, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CommandSpec sync and async default executors use executable plus argv without a shell', async () => {
  const spec = createFoundryCommandSpec({
    executable: process.execPath,
    argv: ['--eval', "process.stdout.write('safe;argv')"],
  });
  const sync = executeFoundryCommandSpecSync(spec, { resolveArtifactPath: () => null });
  assert.equal(sync.status, 0);
  assert.equal(sync.stdout, 'safe;argv');
  assert.equal(sync.stderr, '');

  const asyncResult = await executeFoundryCommandSpec(spec, {
    resolveArtifactPath: () => null,
    timeoutMs: 5_000,
  });
  assert.equal(asyncResult.status, 0);
  assert.equal(asyncResult.stdout, 'safe;argv');
  assert.equal(asyncResult.stderr, '');

  const overflow = await executeFoundryCommandSpec(
    createFoundryCommandSpec({
      executable: process.execPath,
      argv: ['--eval', "process.stdout.write('12345')"],
    }),
    { resolveArtifactPath: () => null, maxBuffer: 4 },
  );
  assert.ok(overflow.error instanceof RangeError);

  const missing = await executeFoundryCommandSpec(
    createFoundryCommandSpec({
      executable: 'definitely-missing-command-spec-executable',
      argv: [],
    }),
    { resolveArtifactPath: () => null },
  );
  assert.ok(missing.error instanceof Error);
  assert.notEqual(missing.status, 0);
});

test('CommandSpec async execution supports injected spawn, timeout, and external abort', async () => {
  const spec = createFoundryCommandSpec({ executable: process.execPath, argv: ['fixture.js'] });
  const injected = await executeFoundryCommandSpec(spec, {
    resolveArtifactPath: () => null,
    cwd: '/tmp',
    env: { TEST_ONLY: 'yes' },
    maxBuffer: 8,
    spawnImpl: async (_executable, _argv, options) => {
      assert.equal(options.cwd, '/tmp');
      assert.equal(options.env?.TEST_ONLY, 'yes');
      assert.equal(options.maxBuffer, 8);
      return { stdout: 'injected', stderr: '', status: 0, signal: null };
    },
  });
  assert.equal(injected.stdout, 'injected');

  let timeoutSignal: AbortSignal | undefined;
  let now = 1_000;
  await assert.rejects(
    executeFoundryCommandSpec(spec, {
      resolveArtifactPath: () => null,
      timeoutMs: 250,
      clock: { now: () => now },
      sleep: async (milliseconds) => {
        assert.equal(milliseconds, 250);
        now += milliseconds;
      },
      spawnImpl: (_executable, _argv, options) => {
        timeoutSignal = options.signal;
        return new Promise(() => undefined);
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof FoundryCommandSpecTimeoutError);
      assert.equal(error.timeoutMs, 250);
      assert.equal(error.startedAtMs, 1_000);
      assert.equal(error.deadlineMs, 1_250);
      return true;
    },
  );
  assert.equal(timeoutSignal?.aborted, true);

  const controller = new AbortController();
  let spawnOptions: FoundryCommandSpecAsyncSpawnOptions | undefined;
  const aborted = executeFoundryCommandSpec(spec, {
    resolveArtifactPath: () => null,
    signal: controller.signal,
    spawnImpl: (_executable, _argv, options) => {
      spawnOptions = options;
      return new Promise(() => undefined);
    },
  });
  controller.abort(new Error('caller stopped'));
  await assert.rejects(aborted, FoundryCommandSpecAbortError);
  assert.equal(spawnOptions?.shell, false);
  assert.equal(spawnOptions?.signal.aborted, true);
});

test('CommandSpec async execution validates limits, clock, and pre-aborted signals before spawn', async () => {
  const spec = createFoundryCommandSpec({ executable: process.execPath, argv: ['fixture.js'] });
  for (const options of [
    { timeoutMs: 0 },
    { timeoutMs: 1.5 },
    { maxBuffer: 0 },
    { maxBuffer: Number.NaN },
  ]) {
    await assert.rejects(
      executeFoundryCommandSpec(spec, { resolveArtifactPath: () => null, ...options }),
    );
  }
  await assert.rejects(
    executeFoundryCommandSpec(spec, {
      resolveArtifactPath: () => null,
      clock: { now: () => Number.NaN },
      spawnImpl: async () => ({ stdout: '', stderr: '', status: 0, signal: null }),
    }),
    /clock/iu,
  );

  const controller = new AbortController();
  controller.abort('already stopped');
  let spawnCalls = 0;
  await assert.rejects(
    executeFoundryCommandSpec(spec, {
      resolveArtifactPath: () => null,
      signal: controller.signal,
      spawnImpl: async () => {
        spawnCalls += 1;
        return { stdout: '', stderr: '', status: 0, signal: null };
      },
    }),
    FoundryCommandSpecAbortError,
  );
  assert.equal(spawnCalls, 0);
});

test('CommandSpec async execution removes external abort listeners after a synchronous spawn failure', async () => {
  const spec = createFoundryCommandSpec({ executable: process.execPath, argv: ['fixture.js'] });
  let listenerAdds = 0;
  let listenerRemovals = 0;
  const signal = {
    aborted: false,
    reason: undefined,
    addEventListener: () => {
      listenerAdds += 1;
    },
    removeEventListener: () => {
      listenerRemovals += 1;
    },
  } as unknown as AbortSignal;
  await assert.rejects(
    executeFoundryCommandSpec(spec, {
      resolveArtifactPath: () => null,
      signal,
      spawnImpl: () => {
        throw new Error('synchronous spawn failure');
      },
    }),
    /synchronous spawn failure/u,
  );
  assert.equal(listenerAdds, 1);
  assert.equal(listenerRemovals, 1);
});

test('CommandSpec success and timeout races do not leak unhandled sleep or spawn rejections', async () => {
  const unhandled: unknown[] = [];
  const observeUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', observeUnhandled);
  try {
    const successful = createFoundryCommandSpec({
      executable: process.execPath,
      argv: ['--eval', "process.stdout.write('done')"],
    });
    const result = await executeFoundryCommandSpec(successful, {
      resolveArtifactPath: () => null,
      timeoutMs: 5_000,
    });
    assert.equal(result.stdout, 'done');

    await assert.rejects(
      executeFoundryCommandSpec(
        createFoundryCommandSpec({ executable: process.execPath, argv: ['fixture.js'] }),
        {
          resolveArtifactPath: () => null,
          timeoutMs: 1,
          sleep: async () => undefined,
          spawnImpl: () => new Promise(() => undefined),
        },
      ),
      FoundryCommandSpecTimeoutError,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', observeUnhandled);
  }
});

test('CommandSpec display quoting is diagnostic only', () => {
  assert.equal(
    renderFoundryCommandDisplay('tool', ['plain', "has ' quote", '']),
    "tool plain 'has '\\'' quote' ''",
  );
  assert.throws(() =>
    createFileArtifactFact({ role: 'missing', path: 'missing', filePath: 'definitely-missing' }),
  );
  const root = mkdtempSync(path.join(tmpdir(), 'cli-command-spec-directory-'));
  try {
    assert.throws(() =>
      createFileArtifactFact({ role: 'directory', path: 'directory', filePath: root }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
