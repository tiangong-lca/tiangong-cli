import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BatchContractError,
  BatchMutationReplayError,
  BatchMutationRetryError,
  assertBatchContractMatches,
  canonicalBatchJson,
  createBatchContract,
  parseBatchContract,
  runBoundedBatch,
  sha256BatchBytes,
  sha256BatchJson,
  type BatchEvent,
  type BatchResumeState,
} from '../src/batch.js';

const contract = createBatchContract({
  identity: { batch: 'fixture', revision: 1 },
  content: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  policy: { max_parallel: 2, retry: 'read-only' },
});

test('batch contracts bind typed identity plus canonical content and policy digests', () => {
  const reordered = createBatchContract({
    identity: { revision: 1, batch: 'fixture' },
    content: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    policy: { retry: 'read-only', max_parallel: 2 },
  });
  assert.deepEqual(reordered, contract);
  assert.equal(canonicalBatchJson({ b: 2, a: [true, null] }), '{"a":[true,null],"b":2}');
  assert.equal(
    sha256BatchJson({ b: 2, a: [true, null] }),
    sha256BatchJson({ a: [true, null], b: 2 }),
  );
  assert.equal(sha256BatchBytes('abc'), sha256BatchBytes(new TextEncoder().encode('abc')));
  assert.deepEqual(parseBatchContract(contract), contract);
  assert.doesNotThrow(() => assertBatchContractMatches(contract, reordered));

  for (const invalid of [
    null,
    { ...contract, extra: true },
    { ...contract, identity: undefined },
    { ...contract, content_sha256: 'bad' },
    { ...contract, policy_sha256: '0'.repeat(63) },
  ]) {
    assert.throws(() => parseBatchContract(invalid), BatchContractError);
  }
  assert.throws(() => canonicalBatchJson({ value: Number.NaN } as never), BatchContractError);
  assert.throws(
    () => assertBatchContractMatches(contract, { ...contract, policy_sha256: '0'.repeat(64) }),
    BatchContractError,
  );
});

test('bounded workers preserve claim, input, and completion orders while isolating exceptions', async () => {
  const releases = new Map<string, () => void>();
  let active = 0;
  let maximumActive = 0;
  const executionStarted: string[] = [];
  const execution = runBoundedBatch({
    contract,
    items: ['a', 'b', 'c'],
    getItemIdentity: (item) => item,
    mode: 'read',
    maxConcurrency: 2,
    execute: async ({ item }) => {
      executionStarted.push(item);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => releases.set(item, resolve));
      active -= 1;
      if (item === 'a') throw new Error('isolated a');
      return item.toUpperCase();
    },
  });

  await waitFor(() => executionStarted.length === 2);
  assert.deepEqual(executionStarted, ['a', 'b']);
  releases.get('b')?.();
  await waitFor(() => executionStarted.length === 3);
  releases.get('a')?.();
  releases.get('c')?.();
  const result = await execution;

  assert.equal(maximumActive, 2);
  assert.deepEqual(result.claim_order, ['a', 'b', 'c']);
  assert.deepEqual(result.completion_order, ['b', 'a', 'c']);
  assert.deepEqual(
    result.results_input_order.map((entry) => entry.item_id),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    result.results_completion_order.map((entry) => entry.item_id),
    ['b', 'a', 'c'],
  );
  assert.equal(result.results_input_order[0]?.status, 'failed');
  assert.equal(result.results_input_order[1]?.status, 'succeeded');
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.unclaimed_item_ids, []);
});

test('pause is checked before claim and stop prevents later claims after in-flight work settles', async () => {
  const pauseChecks: string[] = [];
  const paused = await runBoundedBatch({
    contract,
    items: ['a', 'b', 'c'],
    getItemIdentity: (item) => item,
    mode: 'read',
    maxConcurrency: 1,
    shouldPauseBeforeClaim: ({ item_id }) => {
      pauseChecks.push(item_id);
      return item_id === 'b';
    },
    execute: ({ item }) => item.toUpperCase(),
  });
  assert.deepEqual(pauseChecks, ['a', 'b']);
  assert.deepEqual(paused.claim_order, ['a']);
  assert.deepEqual(paused.unclaimed_item_ids, ['b', 'c']);
  assert.equal(paused.status, 'paused');

  const stopped = await runBoundedBatch({
    contract,
    items: ['a', 'b', 'c'],
    getItemIdentity: (item) => item,
    mode: 'read',
    maxConcurrency: 1,
    execute: ({ item }) => {
      if (item === 'b') throw new Error('stop here');
      return item.toUpperCase();
    },
    shouldStop: ({ results_input_order }) =>
      results_input_order.some((entry) => entry.status === 'failed'),
  });
  assert.deepEqual(stopped.claim_order, ['a', 'b']);
  assert.deepEqual(stopped.unclaimed_item_ids, ['c']);
  assert.equal(stopped.status, 'stopped');
});

test('read retry uses an injected fake clock and awaited capped backoff', async () => {
  let now = 10;
  let calls = 0;
  const sleeps: number[] = [];
  const events: BatchEvent[] = [];
  const result = await runBoundedBatch({
    contract,
    items: ['a'],
    getItemIdentity: (item) => item,
    mode: 'read',
    maxConcurrency: 1,
    clock: { now: () => now },
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      now += milliseconds;
    },
    retry: {
      maxAttempts: 3,
      maxDelayMs: 250,
      shouldRetry: () => true,
      delayMs: ({ attempt }) => (attempt === 1 ? 100 : 1_000),
    },
    eventSink: async (event) => {
      events.push(event);
    },
    execute: () => {
      calls += 1;
      if (calls < 3) throw new Error(`transient-${calls}`);
      return 'ok';
    },
  });

  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [100, 250]);
  assert.equal(result.results_input_order[0]?.status, 'succeeded');
  assert.deepEqual(
    events.filter((event) => event.type === 'retry_scheduled').map((event) => event.delay_ms),
    [100, 250],
  );
  assert.deepEqual(
    events.map((event) => event.sequence),
    events.map((_, index) => index + 1),
  );
  assert.ok(
    events.every(
      (event, index) => index === 0 || event.timestamp_ms >= events[index - 1]!.timestamp_ms,
    ),
  );
});

test('event delivery is serialized and awaited before execution continues', async () => {
  let releaseClaim: (() => void) | undefined;
  let sinkActive = 0;
  let maximumSinkActive = 0;
  let executeCalls = 0;
  const events: BatchEvent[] = [];
  const running = runBoundedBatch({
    contract,
    items: ['a', 'b'],
    getItemIdentity: (item) => item,
    mode: 'read',
    maxConcurrency: 2,
    eventSink: async (event) => {
      sinkActive += 1;
      maximumSinkActive = Math.max(maximumSinkActive, sinkActive);
      events.push(event);
      if (event.type === 'item_claimed' && event.item_id === 'a') {
        await new Promise<void>((resolve) => {
          releaseClaim = resolve;
        });
      }
      sinkActive -= 1;
    },
    execute: ({ item }) => {
      executeCalls += 1;
      return item;
    },
  });

  await waitFor(() => releaseClaim !== undefined);
  assert.equal(executeCalls, 0, 'the claimed event must settle before execute');
  releaseClaim?.();
  await running;
  assert.equal(executeCalls, 2);
  assert.equal(maximumSinkActive, 1);
  assert.deepEqual(
    events.map((event) => event.sequence),
    events.map((_, index) => index + 1),
  );
});

test('mutation transport is attempted once and only explicit readback may recover it', async () => {
  let attempts = 0;
  let recoveries = 0;
  const recovered = await runBoundedBatch({
    contract,
    items: ['a'],
    getItemIdentity: (item) => item,
    mode: 'mutation',
    maxConcurrency: 1,
    execute: () => {
      attempts += 1;
      throw new Error('lost response');
    },
    recoverMutation: ({ error, source }) => {
      recoveries += 1;
      assert.match(String(error), /lost response/u);
      assert.equal(source, 'execution_error');
      return { status: 'recovered', value: 'readback-ok' };
    },
  });
  assert.equal(attempts, 1);
  assert.equal(recoveries, 1);
  assert.equal(recovered.results_input_order[0]?.status, 'recovered');
  assert.equal(recovered.results_input_order[0]?.attempt_consumed, true);

  const unresolved = await runBoundedBatch({
    contract,
    items: ['a', 'b'],
    getItemIdentity: (item) => item,
    mode: 'mutation',
    maxConcurrency: 1,
    execute: () => {
      throw new Error('ambiguous');
    },
    recoverMutation: () => ({ status: 'unresolved' }),
  });
  assert.ok(unresolved.results_input_order.every((entry) => entry.status === 'failed'));
  assert.ok(unresolved.results_input_order.every((entry) => entry.attempts === 1));

  await assert.rejects(
    runBoundedBatch({
      contract,
      items: ['a'],
      getItemIdentity: (item) => item,
      mode: 'mutation',
      maxConcurrency: 1,
      retry: {
        maxAttempts: 2,
        maxDelayMs: 1,
        shouldRetry: () => true,
        delayMs: () => 0,
      },
      execute: () => 'forbidden',
    }),
    BatchMutationRetryError,
  );
});

test('resume requires the exact identity/content/policy triple and never replays consumed mutation attempts', async () => {
  const completedResume: BatchResumeState<string, { batch: string; revision: number }> = {
    contract,
    items: [
      { item_id: 'a', state: 'completed', outcome: 'succeeded', value: 'A', attempts: 1 },
      { item_id: 'b', state: 'attempted', attempts: 1 },
    ],
  };
  let executes = 0;
  const resumed = await runBoundedBatch({
    contract,
    items: ['a', 'b', 'c'],
    getItemIdentity: (item) => item,
    mode: 'mutation',
    maxConcurrency: 1,
    resume: completedResume,
    execute: ({ item }) => {
      executes += 1;
      return item.toUpperCase();
    },
    recoverMutation: ({ item_id, source }) => {
      assert.equal(item_id, 'b');
      assert.equal(source, 'resume_incomplete');
      return { status: 'recovered', value: 'B' };
    },
  });
  assert.equal(executes, 1, 'only fresh c may execute');
  assert.deepEqual(
    resumed.results_input_order.map((entry) => entry.item_id),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    resumed.results_input_order.map((entry) => entry.resumed),
    [true, true, false],
  );
  assert.equal(resumed.results_input_order[1]?.status, 'recovered');

  const noRecovery = await runBoundedBatch({
    contract,
    items: ['b'],
    getItemIdentity: (item) => item,
    mode: 'mutation',
    maxConcurrency: 1,
    resume: { contract, items: [{ item_id: 'b', state: 'attempted', attempts: 2 }] },
    execute: () => {
      throw new Error('must not execute');
    },
  });
  const failure = noRecovery.results_input_order[0];
  assert.equal(failure?.status, 'failed');
  assert.ok(failure?.status === 'failed' && failure.error instanceof BatchMutationReplayError);
  assert.equal(failure?.attempts, 2);

  for (const drift of [
    { ...contract, identity: { batch: 'other', revision: 1 } },
    { ...contract, content_sha256: '0'.repeat(64) },
    { ...contract, policy_sha256: '0'.repeat(64) },
  ]) {
    await assert.rejects(
      runBoundedBatch({
        contract,
        items: ['a'],
        getItemIdentity: (item) => item,
        mode: 'read',
        maxConcurrency: 1,
        resume: { contract: drift, items: [] },
        execute: () => 'A',
      }),
      BatchContractError,
    );
  }
});

test('batch validates concurrency, retry policy, identities, resume entries, and delays before unsafe work', async () => {
  const base = {
    contract,
    items: ['a'],
    getItemIdentity: (item: string) => item,
    mode: 'read' as const,
    execute: (context: { item: string }) => context.item,
  };
  await assert.rejects(runBoundedBatch({ ...base, maxConcurrency: 0 }), BatchContractError);
  await assert.rejects(
    runBoundedBatch({ ...base, maxConcurrency: 1, items: ['a', 'a'] }),
    BatchContractError,
  );
  await assert.rejects(
    runBoundedBatch({
      ...base,
      maxConcurrency: 1,
      retry: { maxAttempts: 0, maxDelayMs: -1, shouldRetry: () => true, delayMs: () => 0 },
    }),
    BatchContractError,
  );
  await assert.rejects(
    runBoundedBatch({
      ...base,
      maxConcurrency: 1,
      resume: {
        contract,
        items: [{ item_id: 'missing', state: 'attempted', attempts: 1 }],
      },
    }),
    BatchContractError,
  );

  const invalidDelay = await runBoundedBatch({
    ...base,
    maxConcurrency: 1,
    retry: {
      maxAttempts: 2,
      maxDelayMs: 10,
      shouldRetry: () => true,
      delayMs: () => Number.NaN,
    },
    execute: () => {
      throw new Error('retry me');
    },
  });
  assert.equal(invalidDelay.results_input_order[0]?.status, 'failed');
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempts = 0; attempts < 100; attempts += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for deterministic test state.');
}
