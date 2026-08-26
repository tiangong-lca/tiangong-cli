import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  BatchContractError,
  BatchRunLockIdentityConflictError,
  BatchRunLockTimeoutError,
  batchRunLockPath,
  batchRunLockStatePath,
  withBatchRunLock,
  type BatchJsonValue,
  type BatchRunLockOptions,
} from '../src/batch.js';

const identity = { execution_id: 'run-1', revision: 1 };
const NODE_MAX_TIMER_DELAY_MS = 2_147_483_647;

type AssertNever<T extends never> = T;
type UnsafePublicOwnershipOverrides = Extract<
  keyof BatchRunLockOptions<BatchJsonValue>,
  'host' | 'now' | 'pid'
>;
type PublicRunLockOptionsHideOwnershipOverrides = AssertNever<UnsafePublicOwnershipOverrides>;
const publicRunLockOptionsHideOwnershipOverrides: PublicRunLockOptionsHideOwnershipOverrides =
  undefined as never;
void publicRunLockOptionsHideOwnershipOverrides;

test('batch run-lock paths are canonical and run-directory-bound', () => {
  const runPath = path.join(os.tmpdir(), 'batch-run-lock-path');
  assert.equal(batchRunLockStatePath(path.join(runPath, '.')), batchRunLockStatePath(runPath));
  assert.equal(batchRunLockPath(runPath), `${batchRunLockStatePath(runPath)}.lock`);
  for (const invalid of ['', 'bad\npath', 1 as never]) {
    assert.throws(() => batchRunLockStatePath(invalid));
  }
});

test('batch run lock is reentrant for the same run path and identity', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'batch-run-lock-reentrant-'));
  try {
    const result = await withBatchRunLock(
      {
        runPath: root,
        identity,
        reason: 'outer',
      },
      async (outer) => {
        assert.equal(outer.lock_path, batchRunLockPath(root));
        assert.equal(existsSync(outer.lock_path), true);
        const metadataBefore = readFileSync(outer.lock_path, 'utf8');
        assert.deepEqual(JSON.parse(metadataBefore), {
          batch_identity_sha256: outer.identity_sha256,
          batch_run_path: path.resolve(root),
          ownerPid: process.pid,
          ownerHost: os.hostname(),
          reason: `batch-run:${outer.identity_sha256}:outer`,
          updatedAt: JSON.parse(metadataBefore).updatedAt,
        });
        assert.equal(Number.isNaN(Date.parse(JSON.parse(metadataBefore).updatedAt)), false);
        const inner = await withBatchRunLock(
          { runPath: root, identity, reason: 'inner' },
          (receipt) => receipt,
        );
        assert.deepEqual(inner, outer);
        assert.equal(readFileSync(outer.lock_path, 'utf8'), metadataBefore);
        await assert.rejects(
          withBatchRunLock(
            { runPath: root, identity: { execution_id: 'other' }, reason: 'foreign-inner' },
            () => 'forbidden',
          ),
          BatchRunLockIdentityConflictError,
        );
        return 'done';
      },
    );
    assert.equal(result, 'done');
    assert.equal(existsSync(batchRunLockPath(root)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('same-process sibling calls are exclusive rather than implicitly reentrant', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'batch-run-lock-sibling-'));
  let releaseOuter: (() => void) | undefined;
  let outerStarted = false;
  let siblingEntered = false;
  try {
    const outer = withBatchRunLock(
      { runPath: root, identity, reason: 'outer-sibling-proof' },
      async () => {
        outerStarted = true;
        await new Promise<void>((resolve) => {
          releaseOuter = resolve;
        });
      },
    );
    await waitFor(() => outerStarted);
    await assert.rejects(
      withBatchRunLock({ runPath: root, identity, reason: 'sibling', timeoutMs: 0 }, () => {
        siblingEntered = true;
      }),
      BatchRunLockTimeoutError,
    );
    assert.equal(siblingEntered, false);
    assert.equal(existsSync(batchRunLockPath(root)), true);
    await assert.rejects(
      withBatchRunLock({ runPath: root, identity, reason: 'timed-sibling', timeoutMs: 5 }, () => {
        siblingEntered = true;
      }),
      (error: unknown) => {
        assert.ok(error instanceof BatchRunLockTimeoutError);
        assert.ok(error.waitedMs >= 0);
        return true;
      },
    );
    releaseOuter?.();
    await outer;
  } finally {
    releaseOuter?.();
    rmSync(root, { recursive: true, force: true });
  }
});

test('batch run lock rejects unsupported local and cross-process timer delays', async () => {
  const localRoot = mkdtempSync(path.join(os.tmpdir(), 'batch-run-lock-local-timer-limit-'));
  let releaseOuter: (() => void) | undefined;
  let outerStarted = false;
  try {
    const outer = withBatchRunLock(
      { runPath: localRoot, identity, reason: 'timer-limit-owner' },
      async () => {
        outerStarted = true;
        await new Promise<void>((resolve) => {
          releaseOuter = resolve;
        });
      },
    );
    await waitFor(() => outerStarted);
    await assert.rejects(
      withBatchRunLock(
        {
          runPath: localRoot,
          identity,
          reason: 'timer-limit-local-contender',
          timeoutMs: NODE_MAX_TIMER_DELAY_MS + 1,
        },
        () => 'never',
      ),
      BatchContractError,
    );
    releaseOuter?.();
    await outer;
  } finally {
    releaseOuter?.();
    rmSync(localRoot, { recursive: true, force: true });
  }

  const processRoot = mkdtempSync(path.join(os.tmpdir(), 'batch-run-lock-poll-limit-'));
  const lockPath = batchRunLockPath(processRoot);
  let sleepCalls = 0;
  let taskCalls = 0;
  try {
    writeLock(lockPath, process.pid, os.hostname());
    await assert.rejects(
      withBatchRunLock(
        {
          runPath: processRoot,
          identity,
          reason: 'timer-limit-process-contender',
          timeoutMs: 100,
          pollMs: NODE_MAX_TIMER_DELAY_MS + 1,
          sleep: async () => {
            sleepCalls += 1;
            throw new Error('unsupported poll reached sleep');
          },
        },
        () => {
          taskCalls += 1;
          return 'never';
        },
      ),
      BatchContractError,
    );
    assert.equal(sleepCalls, 0);
    assert.equal(taskCalls, 0);
    assert.equal(existsSync(lockPath), true);
  } finally {
    rmSync(processRoot, { recursive: true, force: true });
  }
});

test('batch run lock rejects non-integer and negative public timer values before side effects', async () => {
  let taskCalls = 0;
  for (const [field, value] of [
    ['timeoutMs', Number.NaN],
    ['timeoutMs', 1.5],
    ['timeoutMs', -1],
    ['pollMs', Number.NaN],
    ['pollMs', 1.5],
    ['pollMs', -1],
  ] as const) {
    const root = mkdtempSync(path.join(os.tmpdir(), 'batch-run-lock-invalid-timer-'));
    try {
      await assert.rejects(
        withBatchRunLock(
          {
            runPath: root,
            identity,
            reason: `invalid-${field}`,
            [field]: value,
          },
          () => {
            taskCalls += 1;
            return 'never';
          },
        ),
        BatchContractError,
      );
      assert.equal(existsSync(batchRunLockPath(root)), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  assert.equal(taskCalls, 0);
});

test('same-process lock handoff keeps the physical lock through the queued sibling', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'batch-run-lock-handoff-'));
  const childFile = writeLockChildFile(root);
  let releaseOuter: (() => void) | undefined;
  let releaseSibling: (() => void) | undefined;
  let outerStarted = false;
  let siblingEntered = false;
  let contender: ChildProcessWithoutNullStreams | undefined;
  try {
    const outer = withBatchRunLock(
      { runPath: root, identity, reason: 'handoff-outer' },
      async () => {
        outerStarted = true;
        await new Promise<void>((resolve) => {
          releaseOuter = resolve;
        });
      },
    );
    await waitFor(() => outerStarted);
    const sibling = withBatchRunLock(
      { runPath: root, identity, reason: 'handoff-sibling' },
      async () => {
        siblingEntered = true;
        await new Promise<void>((resolve) => {
          releaseSibling = resolve;
        });
      },
    );
    releaseOuter?.();
    await outer;
    await waitFor(() => siblingEntered);
    assert.equal(existsSync(batchRunLockPath(root)), true);

    contender = spawnLockChild(childFile, root, identity);
    const contenderAcquired = waitForOutput(contender, 'acquired\n');
    await assertNoOutput(contender, 40);
    releaseSibling?.();
    await sibling;
    await contenderAcquired;
    contender.stdin.end('release\n');
    await waitForExit(contender);
  } finally {
    releaseOuter?.();
    releaseSibling?.();
    contender?.kill();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a detached nested helper retains the physical lock for its own active scope', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'batch-run-lock-detached-nested-'));
  const childFile = writeLockChildFile(root);
  let releaseInner: (() => void) | undefined;
  let innerEntered = false;
  let outerSettled = false;
  let detachedInner: Promise<void> | undefined;
  let outer: Promise<void> | undefined;
  let contender: ChildProcessWithoutNullStreams | undefined;
  try {
    outer = withBatchRunLock({ runPath: root, identity, reason: 'detached-outer' }, async () => {
      detachedInner = withBatchRunLock(
        { runPath: root, identity, reason: 'detached-inner' },
        async () => {
          innerEntered = true;
          await new Promise<void>((resolve) => {
            releaseInner = resolve;
          });
        },
      );
      await waitFor(() => innerEntered);
    });
    void outer.then(
      () => {
        outerSettled = true;
      },
      () => {
        outerSettled = true;
      },
    );
    await waitFor(() => innerEntered);
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(outerSettled, false);
    assert.equal(existsSync(batchRunLockPath(root)), true);
    contender = spawnLockChild(childFile, root, identity);
    const contenderAcquired = waitForOutput(contender, 'acquired\n');
    await assertNoOutput(contender, 40);
    releaseInner?.();
    await detachedInner;
    await outer;
    await contenderAcquired;
    contender.stdin.end('release\n');
    await waitForExit(contender);
  } finally {
    releaseInner?.();
    await detachedInner?.catch(() => undefined);
    await outer?.catch(() => undefined);
    contender?.kill();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a completed async scope cannot reenter a later physical owner', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'batch-run-lock-stale-context-'));
  let startStaleAttempt: (() => void) | undefined;
  let releaseSibling: (() => void) | undefined;
  let siblingEntered = false;
  let staleEntered = false;
  let staleAttempt: Promise<void> | undefined;
  const staleAttemptGate = new Promise<void>((resolve) => {
    startStaleAttempt = resolve;
  });
  try {
    await withBatchRunLock({ runPath: root, identity, reason: 'stale-context-outer' }, () => {
      staleAttempt = (async () => {
        await staleAttemptGate;
        await assert.rejects(
          withBatchRunLock(
            { runPath: root, identity, reason: 'stale-context-attempt', timeoutMs: 0 },
            () => {
              staleEntered = true;
            },
          ),
          BatchRunLockTimeoutError,
        );
      })();
    });

    const sibling = withBatchRunLock(
      { runPath: root, identity, reason: 'stale-context-sibling' },
      async () => {
        siblingEntered = true;
        await new Promise<void>((resolve) => {
          releaseSibling = resolve;
        });
      },
    );
    await waitFor(() => siblingEntered);
    startStaleAttempt?.();
    await staleAttempt;
    assert.equal(staleEntered, false);
    releaseSibling?.();
    await sibling;
  } finally {
    startStaleAttempt?.();
    releaseSibling?.();
    await staleAttempt?.catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
});

test('batch run lock preserves a live lock on timeout and recovers a stale lock', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'batch-run-lock-owner-'));
  const lockPath = batchRunLockPath(root);
  try {
    writeLock(lockPath, process.pid);
    await assert.rejects(
      withBatchRunLock(
        { runPath: root, identity, reason: 'contender', timeoutMs: 0 },
        () => 'never',
      ),
      (error: unknown) => {
        assert.ok(error instanceof BatchRunLockTimeoutError);
        assert.equal(error.lockPath, lockPath);
        assert.equal(error.identitySha256.length, 64);
        return true;
      },
    );
    assert.equal(existsSync(lockPath), true, 'a live lock must never be deleted by a contender');

    unlinkSync(lockPath);
    writeLock(lockPath, process.pid, os.hostname());
    const waited = await withBatchRunLock(
      {
        runPath: root,
        identity,
        reason: 'live-release',
        timeoutMs: 50,
        pollMs: 10,
        sleep: async () => unlinkSync(lockPath),
      },
      () => 'waited',
    );
    assert.equal(waited, 'waited');

    writeLock(lockPath, 999_999_999, os.hostname());
    const recovered = await withBatchRunLock(
      { runPath: root, identity, reason: 'stale-recovery', timeoutMs: 50, pollMs: 10 },
      () => 'recovered',
    );
    assert.equal(recovered, 'recovered');
    assert.equal(existsSync(lockPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('batch run lock validates public tokens, preserves empty live locks, and cleans after task errors', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'batch-run-lock-errors-'));
  const lockPath = batchRunLockPath(root);
  try {
    await assert.rejects(withBatchRunLock({ runPath: root, identity, reason: '' }, () => 'never'));
    await assert.rejects(
      withBatchRunLock({ runPath: root, identity, reason: 'task-error' }, () => {
        throw new Error('task failed');
      }),
      /task failed/u,
    );
    assert.equal(existsSync(lockPath), false);

    writeFileSync(lockPath, '\n', 'utf8');
    await assert.rejects(
      withBatchRunLock(
        { runPath: root, identity, reason: 'empty-owner', timeoutMs: 0 },
        () => 'never',
      ),
      (error: unknown) => {
        assert.ok(error instanceof BatchRunLockTimeoutError);
        assert.equal(error.owner, null);
        return true;
      },
    );
    assert.equal(existsSync(lockPath), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('batch run lock never stale-recovers a foreign-host owner', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'batch-run-lock-foreign-host-'));
  const lockPath = batchRunLockPath(root);
  try {
    writeLock(lockPath, 999_999_999, 'foreign-host.example');
    await assert.rejects(
      withBatchRunLock(
        { runPath: root, identity, reason: 'foreign-host-contender', timeoutMs: 0 },
        () => 'never',
      ),
      BatchRunLockTimeoutError,
    );
    assert.equal(existsSync(lockPath), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('batch run lock ignores spoofed ownership metadata and preserves a foreign-host lock', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'batch-run-lock-spoofed-owner-'));
  const lockPath = batchRunLockPath(root);
  try {
    writeLock(lockPath, 999_999_999, 'foreign-host.example');
    const spoofedOptions = {
      runPath: root,
      identity,
      reason: 'spoofed-foreign-host-contender',
      timeoutMs: 0,
      host: 'foreign-host.example',
      pid: 999_999_999,
      now: new Date('2000-01-01T00:00:00.000Z'),
    } as unknown as BatchRunLockOptions<typeof identity>;

    await assert.rejects(
      withBatchRunLock(spoofedOptions, () => 'never'),
      BatchRunLockTimeoutError,
    );
    assert.equal(existsSync(lockPath), true, 'caller input must not spoof stale ownership');
    assert.deepEqual(JSON.parse(readFileSync(lockPath, 'utf8')), {
      ownerPid: 999_999_999,
      ownerHost: 'foreign-host.example',
      reason: 'holder',
      updatedAt: 'now',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('batch run lock excludes another process for the run path across identities', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'batch-run-lock-process-'));
  const childFile = writeLockChildFile(root);

  try {
    for (const contenderIdentity of [identity, { execution_id: 'different-process-identity' }]) {
      const first = spawnLockChild(childFile, root, identity);
      let second: ChildProcessWithoutNullStreams | undefined;
      try {
        await waitForOutput(first, 'acquired\n');
        second = spawnLockChild(childFile, root, contenderIdentity);
        const secondAcquired = waitForOutput(second, 'acquired\n');
        await assertNoOutput(second, 40);
        first.stdin.end('release\n');
        await waitForExit(first);
        await secondAcquired;
        second.stdin.end('release\n');
        await waitForExit(second);
        assert.equal(existsSync(batchRunLockPath(root)), false);
      } finally {
        first.kill();
        second?.kill();
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function writeLock(lockPath: string, ownerPid: number, ownerHost = 'test-host'): void {
  writeFileSync(
    lockPath,
    `${JSON.stringify({ ownerPid, ownerHost, reason: 'holder', updatedAt: 'now' })}\n`,
    'utf8',
  );
}

function writeLockChildFile(root: string): string {
  const childFile = path.join(root, 'lock-child.mts');
  const batchModule = pathToFileURL(path.resolve('src/batch.ts')).href;
  writeFileSync(
    childFile,
    [
      `import { withBatchRunLock } from ${JSON.stringify(batchModule)};`,
      `const runPath = process.argv[2];`,
      `const identity = JSON.parse(process.argv[3]);`,
      `await withBatchRunLock({ runPath, identity, reason: 'child', timeoutMs: 2000, pollMs: 10 }, async () => {`,
      `  process.stdout.write('acquired\\n');`,
      `  await new Promise((resolve) => process.stdin.once('data', resolve));`,
      `});`,
      '',
    ].join('\n'),
    'utf8',
  );
  return childFile;
}

function spawnLockChild(
  childFile: string,
  runPath: string,
  childIdentity: object,
): ChildProcessWithoutNullStreams {
  return spawn(
    process.execPath,
    ['--import', 'tsx', childFile, runPath, JSON.stringify(childIdentity)],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
}

async function waitForOutput(
  child: ChildProcessWithoutNullStreams,
  expected: string,
): Promise<void> {
  let output = '';
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${expected}`)), 5_000);
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.includes(expected)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (!output.includes(expected)) reject(new Error(`Child exited ${code}: ${output}`));
    });
  });
}

async function assertNoOutput(
  child: ChildProcessWithoutNullStreams,
  milliseconds: number,
): Promise<void> {
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
  assert.equal(output, '');
}

async function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) {
    assert.equal(child.exitCode, 0, readChildError(child));
    return;
  }
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Lock child exited ${code}: ${readChildError(child)}`));
    });
  });
}

function readChildError(child: ChildProcessWithoutNullStreams): string {
  return child.stderr.read()?.toString('utf8') ?? '';
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for run-lock test state.');
}
