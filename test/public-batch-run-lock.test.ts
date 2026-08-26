import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  BatchRunLockIdentityConflictError,
  BatchRunLockTimeoutError,
  batchRunLockPath,
  batchRunLockStatePath,
  withBatchRunLock,
} from '../src/batch.js';

const identity = { execution_id: 'run-1', revision: 1 };

test('batch run-lock paths are canonical and run-directory-bound', () => {
  const runPath = path.join(os.tmpdir(), 'batch-run-lock-path');
  assert.equal(batchRunLockStatePath(path.join(runPath, '.')), batchRunLockStatePath(runPath));
  assert.equal(batchRunLockPath(runPath), `${batchRunLockStatePath(runPath)}.lock`);
});

test('batch run lock is reentrant for the same run path and identity', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'batch-run-lock-reentrant-'));
  try {
    const result = await withBatchRunLock(
      {
        runPath: root,
        identity,
        reason: 'outer',
        pid: 12345,
        host: 'unit-host',
        now: new Date('2026-08-26T00:00:00.000Z'),
      },
      async (outer) => {
        assert.equal(outer.lock_path, batchRunLockPath(root));
        assert.equal(existsSync(outer.lock_path), true);
        const metadataBefore = readFileSync(outer.lock_path, 'utf8');
        assert.equal(JSON.parse(metadataBefore).batch_identity_sha256, outer.identity_sha256);
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
    writeLock(lockPath, 999_999_999);
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

test('batch run lock excludes another process with the same run path and identity', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'batch-run-lock-process-'));
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

  const first = spawnLockChild(childFile, root, identity);
  let second: ChildProcessWithoutNullStreams | undefined;
  try {
    await waitForOutput(first, 'acquired\n');
    second = spawnLockChild(childFile, root, { execution_id: 'different-process-identity' });
    await assertNoOutput(second, 40);
    first.stdin.write('release\n');
    await waitForExit(first);
    await waitForOutput(second, 'acquired\n');
    second.stdin.write('release\n');
    await waitForExit(second);
    assert.equal(existsSync(batchRunLockPath(root)), false);
  } finally {
    first.kill();
    second?.kill();
    rmSync(root, { recursive: true, force: true });
  }
});

function writeLock(lockPath: string, ownerPid: number): void {
  writeFileSync(
    lockPath,
    `${JSON.stringify({ ownerPid, ownerHost: 'test-host', reason: 'holder', updatedAt: 'now' })}\n`,
    'utf8',
  );
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
