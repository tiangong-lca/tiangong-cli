import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_BATCH_CONCURRENCY,
  BatchContractError,
  BatchItemIdentityDriftError,
  BatchItemProjectionDriftError,
  BatchItemResourceDriftError,
  BatchItemResumeContractError,
  BatchMutationReplayError,
  BatchMutationRetryError,
  assertBatchContractMatches,
  assertBatchItemContractMatches,
  canonicalBatchJson,
  createBatchContract,
  createBatchItemContract,
  parseBatchItemContract,
  parseBatchContract,
  runBoundedBatch as runPublicBoundedBatch,
  sha256BatchBytes,
  sha256BatchJson,
  type BatchEvent,
  type BatchJsonValue,
  type BatchResumeState,
  type RunBoundedBatchOptions,
} from '../src/batch.js';

const contract = createBatchContract({
  identity: { batch: 'fixture', revision: 1 },
  content: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  policy: { max_parallel: 2, retry: 'read-only' },
});

function stringItemContract(itemId: string) {
  return createBatchItemContract({ item_id: itemId, content: itemId, policy: null });
}

type TestRunOptions<TInput, TOutput, TIdentity extends BatchJsonValue> = Omit<
  RunBoundedBatchOptions<TInput, TOutput, TIdentity>,
  'projectItemContent' | 'projectItemPolicy'
> &
  Partial<
    Pick<
      RunBoundedBatchOptions<TInput, TOutput, TIdentity>,
      'projectItemContent' | 'projectItemPolicy'
    >
  >;

function runBoundedBatch<TInput, TOutput, TIdentity extends BatchJsonValue>(
  options: TestRunOptions<TInput, TOutput, TIdentity>,
) {
  return runPublicBoundedBatch({
    projectItemContent: (item) => item as unknown as BatchJsonValue,
    projectItemPolicy: () => null,
    ...options,
  });
}

test('per-item resume contracts isolate content or policy drift before claim', async () => {
  const currentItems = [
    { id: 'a', content: 'current-a', policy: 'policy-a' },
    { id: 'b', content: 'current-b', policy: 'policy-b' },
  ];
  const resumed = await runBoundedBatch({
    contract,
    items: currentItems,
    getItemIdentity: (item) => item.id,
    projectItemContent: (item) => ({ content: item.content }),
    projectItemPolicy: (item) => ({ policy: item.policy }),
    mode: 'mutation',
    maxConcurrency: 1,
    resume: {
      contract,
      items: [
        {
          ...createBatchItemContract({
            item_id: 'a',
            content: { content: 'stale-a' },
            policy: { policy: 'policy-a' },
          }),
          state: 'completed',
          outcome: 'succeeded',
          value: 'old-a',
          attempts: 1,
        },
        {
          ...createBatchItemContract({
            item_id: 'b',
            content: { content: 'current-b' },
            policy: { policy: 'policy-b' },
          }),
          state: 'completed',
          outcome: 'succeeded',
          value: 'old-b',
          attempts: 1,
        },
      ],
    },
    execute: () => {
      throw new Error('completed resume items must never execute');
    },
  });

  assert.deepEqual(resumed.claim_order, []);
  assert.deepEqual(
    resumed.results_input_order.map((item) => item.status),
    ['failed', 'succeeded'],
  );
  assert.ok(failedError(resumed.results_input_order[0]) instanceof BatchItemResumeContractError);
  assert.equal(resumed.results_input_order[1]?.resumed, true);
  assert.deepEqual(resumed.results_input_order[1]?.item_contract, {
    item_id: 'b',
    content_sha256: sha256BatchJson({ content: 'current-b' }),
    policy_sha256: sha256BatchJson({ policy: 'policy-b' }),
  });

  let recoveries = 0;
  const attemptedDrift = await runBoundedBatch({
    contract,
    items: currentItems,
    getItemIdentity: (item) => item.id,
    projectItemContent: (item) => ({ content: item.content }),
    projectItemPolicy: (item) => ({ policy: item.policy }),
    mode: 'mutation',
    maxConcurrency: 1,
    resume: {
      contract,
      items: [
        {
          ...createBatchItemContract({
            item_id: 'a',
            content: { content: 'current-a' },
            policy: { policy: 'stale-policy-a' },
          }),
          state: 'attempted',
          attempts: 2,
        },
      ],
    },
    execute: ({ item }) => item.id,
    recoverMutation: () => {
      recoveries += 1;
      return { status: 'unresolved' };
    },
  });
  assert.deepEqual(attemptedDrift.claim_order, ['b']);
  assert.deepEqual(
    attemptedDrift.results_input_order.map((item) => item.status),
    ['failed', 'succeeded'],
  );
  assert.equal(recoveries, 0, 'a drifted attempt cannot enter recovery under a new item triple');

  const mutableResume = {
    ...createBatchItemContract({
      item_id: 'a',
      content: { content: 'stale-a' },
      policy: { policy: 'policy-a' },
    }),
    state: 'completed' as const,
    outcome: 'succeeded' as const,
    value: 'old-a',
    attempts: 1,
  };
  const snapshotProof = await runBoundedBatch({
    contract,
    items: [currentItems[0]!],
    getItemIdentity: (item) => item.id,
    projectItemContent: (item) => ({ content: item.content }),
    projectItemPolicy: (item) => ({ policy: item.policy }),
    mode: 'read',
    maxConcurrency: 1,
    resume: { contract, items: [mutableResume] },
    eventSink: (event) => {
      if (event.type === 'batch_started') {
        mutableResume.content_sha256 = sha256BatchJson({ content: 'current-a' });
      }
    },
    execute: () => {
      throw new Error('post-validation resume mutation must not become eligible');
    },
  });
  assert.ok(
    failedError(snapshotProof.results_input_order[0]) instanceof BatchItemResumeContractError,
  );

  const driftingItem = { id: 'a', content: 'before-claim', policy: 'policy-a' };
  const projectionDrift = await runBoundedBatch({
    contract,
    items: [driftingItem],
    getItemIdentity: (item) => item.id,
    projectItemContent: (item) => ({ content: item.content }),
    projectItemPolicy: (item) => ({ policy: item.policy }),
    mode: 'read',
    maxConcurrency: 1,
    resume: {
      contract,
      items: [
        {
          ...createBatchItemContract({
            item_id: 'a',
            content: { content: 'before-claim' },
            policy: { policy: 'policy-a' },
          }),
          state: 'completed',
          outcome: 'succeeded',
          value: 'old-a',
          attempts: 1,
        },
      ],
    },
    eventSink: (event) => {
      if (event.type === 'batch_started') driftingItem.content = 'after-preflight';
    },
    execute: () => {
      throw new Error('completed resume projection drift must not execute');
    },
  });
  assert.ok(
    failedError(projectionDrift.results_input_order[0]) instanceof BatchItemProjectionDriftError,
  );
  assert.equal(projectionDrift.results_input_order[0]?.attempts, 1);
  assert.equal(projectionDrift.results_input_order[0]?.attempt_consumed, true);
});

test('batch rejects concurrency above the public resource ceiling before projection or claim', async () => {
  let projections = 0;
  await assert.rejects(
    runBoundedBatch({
      contract,
      items: ['a'],
      getItemIdentity: (item) => item,
      projectItemContent: (item) => {
        projections += 1;
        return item;
      },
      projectItemPolicy: () => null,
      mode: 'read',
      maxConcurrency: MAX_BATCH_CONCURRENCY + 1,
      execute: ({ item }) => item,
    }),
    BatchContractError,
  );
  assert.equal(projections, 0);
});

test('all item projections validate before any unsafe work starts', async () => {
  let executeCalls = 0;
  let eventCalls = 0;
  await assert.rejects(
    runBoundedBatch({
      contract,
      items: ['a', 'b'],
      getItemIdentity: (item) => item,
      projectItemContent: (item) => {
        if (item === 'b') throw new Error('second projection failed');
        return item;
      },
      projectItemPolicy: () => null,
      mode: 'mutation',
      maxConcurrency: 2,
      eventSink: () => {
        eventCalls += 1;
      },
      execute: ({ item }) => {
        executeCalls += 1;
        return item;
      },
    }),
    /second projection failed/u,
  );
  assert.equal(executeCalls, 0);
  assert.equal(eventCalls, 0, 'projection preflight must finish before batch_started');
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
  assert.equal(Object.isFrozen(contract), true);
  assert.equal(Object.isFrozen(contract.identity), true);

  const itemContract = stringItemContract('a');
  assert.deepEqual(parseBatchItemContract(itemContract), itemContract);
  assert.deepEqual(assertBatchItemContractMatches(itemContract, { ...itemContract }), itemContract);
  assert.throws(
    () =>
      assertBatchItemContractMatches(itemContract, {
        ...itemContract,
        content_sha256: '0'.repeat(64),
      }),
    BatchItemResumeContractError,
  );
  assert.throws(
    () => parseBatchItemContract({ ...itemContract, policy_sha256: 'bad' }),
    BatchContractError,
  );
  assert.throws(
    () => createBatchItemContract({ item_id: '', content: null, policy: null }),
    BatchContractError,
  );

  const nullPrototype = Object.assign(Object.create(null) as Record<string, string>, { id: 'x' });
  assert.equal(canonicalBatchJson(nullPrototype), '{"id":"x"}');
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;

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
  assert.throws(() => canonicalBatchJson(undefined as never), BatchContractError);
  assert.throws(() => canonicalBatchJson(new Date() as never), BatchContractError);
  assert.throws(() => canonicalBatchJson(cyclic as never), BatchContractError);
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

test('exclusive resource keys serialize matching items while preserving cross-key concurrency', async () => {
  const starts: string[] = [];
  const releases = new Map<string, () => void>();
  const events: BatchEvent[] = [];
  const running = runBoundedBatch({
    contract,
    items: ['a-1', 'a-2', 'b-1'],
    getItemIdentity: (item) => item,
    projectItemContent: (item) => item,
    projectItemPolicy: () => null,
    getExclusiveKey: (context) => context.item.split('-')[0]!,
    mode: 'read',
    maxConcurrency: 3,
    eventSink: (event) => {
      events.push(event);
    },
    execute: async ({ item }) => {
      starts.push(item);
      await new Promise<void>((resolve) => releases.set(item, resolve));
      return item;
    },
  });

  await waitFor(() => starts.length === 2);
  assert.deepEqual(starts, ['a-1', 'b-1']);
  releases.get('b-1')?.();
  await waitFor(() =>
    events.some((event) => event.type === 'item_completed' && event.item_id === 'b-1'),
  );
  releases.get('a-1')?.();
  await waitFor(() => starts.includes('a-2'));
  await waitFor(() =>
    events.some((event) => event.type === 'item_completed' && event.item_id === 'a-1'),
  );
  releases.get('a-2')?.();
  const result = await running;

  assert.deepEqual(result.claim_order, ['a-1', 'a-2', 'b-1']);
  assert.deepEqual(result.completion_order, ['b-1', 'a-1', 'a-2']);
  const eventSequence = (type: BatchEvent['type'], itemId: string) =>
    events.find((event) => event.type === type && event.item_id === itemId)?.sequence ?? 0;
  assert.ok(eventSequence('item_claimed', 'a-2') < eventSequence('item_resource_queued', 'a-2'));
  assert.ok(
    eventSequence('item_resource_released', 'a-1') < eventSequence('item_resource_acquired', 'a-2'),
  );
  assert.equal(
    events.find((event) => event.type === 'item_resource_acquired' && event.item_id === 'a-2')
      ?.exclusive_key,
    'a',
  );
});

test('resource-blocked items do not consume bounded worker capacity', async () => {
  const starts: string[] = [];
  const gates = new Map<string, { promise: Promise<void>; release: () => void }>();
  for (const item of ['a-1', 'a-2', 'b-1']) {
    let release: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    gates.set(item, { promise, release });
  }
  const events: BatchEvent[] = [];
  const running = runBoundedBatch({
    contract,
    items: ['a-1', 'a-2', 'b-1'],
    getItemIdentity: (item) => item,
    getExclusiveKey: ({ item }) => item.split('-')[0]!,
    mode: 'read',
    maxConcurrency: 2,
    eventSink: (event) => {
      events.push(event);
    },
    execute: async ({ item }) => {
      starts.push(item);
      await gates.get(item)!.promise;
      return item;
    },
  });

  try {
    await waitFor(() => starts.length === 2);
    assert.deepEqual(starts, ['a-1', 'b-1']);
    assert.equal(starts.includes('a-2'), false);

    gates.get('b-1')!.release();
    await waitFor(() =>
      events.some((event) => event.type === 'item_completed' && event.item_id === 'b-1'),
    );
    assert.equal(starts.includes('a-2'), false, 'a-2 must still wait for resource a');

    gates.get('a-1')!.release();
    await waitFor(() => starts.includes('a-2'));
    gates.get('a-2')!.release();
    const result = await running;

    assert.deepEqual(result.claim_order, ['a-1', 'a-2', 'b-1']);
    const sequence = (type: BatchEvent['type'], itemId: string) =>
      events.find((event) => event.type === type && event.item_id === itemId)?.sequence ?? 0;
    assert.ok(
      sequence('item_resource_released', 'a-1') < sequence('item_resource_acquired', 'a-2'),
    );
  } finally {
    for (const gate of gates.values()) gate.release();
    await running.catch(() => undefined);
  }
});

test('exclusive resource key projection validates before work and rejects claim-time drift', async () => {
  let executeCalls = 0;
  await assert.rejects(
    runBoundedBatch({
      contract,
      items: ['a', 'b'],
      getItemIdentity: (item) => item,
      projectItemContent: (item) => item,
      projectItemPolicy: () => null,
      getExclusiveKey: ({ item }) => {
        if (item === 'b') throw new Error('resource projection failed');
        return item;
      },
      mode: 'mutation',
      maxConcurrency: 2,
      execute: ({ item }) => {
        executeCalls += 1;
        return item;
      },
    }),
    /resource projection failed/u,
  );
  assert.equal(executeCalls, 0);

  const item = { id: 'a', resource: 'before' };
  const drift = await runBoundedBatch({
    contract,
    items: [item],
    getItemIdentity: (value) => value.id,
    projectItemContent: (value) => value.id,
    projectItemPolicy: () => null,
    getExclusiveKey: ({ item: value }) => value.resource,
    mode: 'mutation',
    maxConcurrency: 1,
    eventSink: (event) => {
      if (event.type === 'batch_started') item.resource = 'after';
    },
    execute: () => {
      executeCalls += 1;
      return 'forbidden';
    },
  });
  assert.ok(failedError(drift.results_input_order[0]) instanceof BatchItemResourceDriftError);
  assert.equal(executeCalls, 0);
  assert.deepEqual(drift.claim_order, []);

  const resumedItem = { id: 'resume-a', resource: 'before' };
  const resumedDrift = await runBoundedBatch({
    contract,
    items: [resumedItem],
    getItemIdentity: (value) => value.id,
    projectItemContent: (value) => value.id,
    projectItemPolicy: () => null,
    getExclusiveKey: ({ item: value }) => value.resource,
    mode: 'read',
    maxConcurrency: 1,
    resume: {
      contract,
      items: [
        {
          ...createBatchItemContract({ item_id: 'resume-a', content: 'resume-a', policy: null }),
          state: 'completed',
          outcome: 'succeeded',
          value: 'old',
          attempts: 1,
        },
      ],
    },
    eventSink: (event) => {
      if (event.type === 'batch_started') resumedItem.resource = 'after';
    },
    execute: () => {
      executeCalls += 1;
      return 'forbidden';
    },
  });
  assert.ok(
    failedError(resumedDrift.results_input_order[0]) instanceof BatchItemResourceDriftError,
  );
  assert.equal(resumedDrift.results_input_order[0]?.attempts, 1);

  for (const exclusiveKey of [null, undefined]) {
    const unkeyed = await runBoundedBatch({
      contract,
      items: ['unkeyed'],
      getItemIdentity: (value) => value,
      projectItemContent: (value) => value,
      projectItemPolicy: () => null,
      getExclusiveKey: () => exclusiveKey,
      mode: 'read',
      maxConcurrency: 1,
      execute: ({ exclusive_key: observed }) => observed,
    });
    assert.equal(unkeyed.results_input_order[0]?.exclusive_key, null);
  }
  for (const invalidKey of ['', 'bad\nkey', 1 as never]) {
    await assert.rejects(
      runBoundedBatch({
        contract,
        items: ['invalid-key'],
        getItemIdentity: (value) => value,
        projectItemContent: (value) => value,
        projectItemPolicy: () => null,
        getExclusiveKey: () => invalidKey,
        mode: 'read',
        maxConcurrency: 1,
        execute: () => 'forbidden',
      }),
      BatchContractError,
    );
  }
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

  const resumedStop = await runBoundedBatch({
    contract,
    items: ['a', 'b'],
    getItemIdentity: (item) => item,
    mode: 'read',
    maxConcurrency: 1,
    resume: {
      contract,
      items: [
        {
          ...stringItemContract('a'),
          state: 'completed',
          outcome: 'succeeded',
          value: 'A',
          attempts: 1,
        },
      ],
    },
    shouldStop: () => true,
    execute: () => {
      throw new Error('resumed stop must prevent fresh claims');
    },
  });
  assert.equal(resumedStop.status, 'stopped');
  assert.deepEqual(resumedStop.claim_order, []);
  assert.deepEqual(resumedStop.unclaimed_item_ids, ['b']);

  const projectionCalls = new Map<string, number>();
  const resumedFailureStop = await runBoundedBatch({
    contract,
    items: ['a', 'b', 'c'],
    getItemIdentity: (item) => item,
    projectItemContent: (item) => {
      const call = (projectionCalls.get(item) ?? 0) + 1;
      projectionCalls.set(item, call);
      return item === 'a' && call > 1 ? 'a-drifted' : item;
    },
    projectItemPolicy: () => null,
    mode: 'read',
    maxConcurrency: 1,
    resume: {
      contract,
      items: [
        {
          ...stringItemContract('a'),
          state: 'completed',
          outcome: 'succeeded',
          value: 'A',
          attempts: 1,
        },
        {
          ...stringItemContract('b'),
          state: 'completed',
          outcome: 'succeeded',
          value: 'B',
          attempts: 1,
        },
      ],
    },
    shouldStop: ({ last_result }) => last_result.status === 'failed',
    execute: () => {
      throw new Error('a resumed projection failure must stop fresh claims');
    },
  });
  assert.equal(resumedFailureStop.status, 'stopped');
  assert.deepEqual(resumedFailureStop.claim_order, []);
  assert.deepEqual(resumedFailureStop.unclaimed_item_ids, ['c']);
  assert.equal(resumedFailureStop.results_input_order[0]?.status, 'failed');
  assert.equal(resumedFailureStop.results_input_order[1]?.status, 'succeeded');

  const inFlightStop = await runBoundedBatch({
    contract,
    items: ['a', 'b'],
    getItemIdentity: (item) => item,
    mode: 'read',
    maxConcurrency: 2,
    execute: ({ item }) => item,
    shouldStop: () => true,
  });
  assert.deepEqual(inFlightStop.claim_order, ['a', 'b']);
  assert.equal(inFlightStop.status, 'stopped');
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

test('claim-time projection drift fails the item before execution', async () => {
  const item = { id: 'a', content: 'before', policy: 'p1' };
  let executeCalls = 0;
  const result = await runBoundedBatch({
    contract,
    items: [item],
    getItemIdentity: (value) => value.id,
    projectItemContent: (value) => ({ content: value.content }),
    projectItemPolicy: (value) => ({ policy: value.policy }),
    mode: 'read',
    maxConcurrency: 1,
    eventSink: (event) => {
      if (event.type === 'batch_started') {
        item.content = 'after';
        item.policy = 'p2';
      }
    },
    execute: () => {
      executeCalls += 1;
      return 'ok';
    },
  });
  assert.equal(executeCalls, 0);
  assert.deepEqual(result.claim_order, []);
  assert.ok(failedError(result.results_input_order[0]) instanceof BatchItemProjectionDriftError);
  assert.deepEqual(result.results_input_order[0]?.item_contract, {
    item_id: 'a',
    content_sha256: sha256BatchJson({ content: 'before' }),
    policy_sha256: sha256BatchJson({ policy: 'p1' }),
  });
});

test('identity is reprojected before resumed acceptance and every fresh claim', async () => {
  const items = [
    { id: 'resumed', content: 'resumed-content' },
    { id: 'fresh', content: 'fresh-content' },
  ];
  const identityCalls = new Map<string, number>();
  const events: BatchEvent[] = [];
  let executeCalls = 0;
  const result = await runBoundedBatch({
    contract,
    items,
    getItemIdentity: (item, index) => {
      identityCalls.set(index.toString(), (identityCalls.get(index.toString()) ?? 0) + 1);
      return item.id;
    },
    projectItemContent: (item) => item.content,
    projectItemPolicy: () => null,
    mode: 'read',
    maxConcurrency: 1,
    resume: {
      contract,
      items: [
        {
          ...createBatchItemContract({
            item_id: 'resumed',
            content: 'resumed-content',
            policy: null,
          }),
          state: 'completed',
          outcome: 'succeeded',
          value: 'old-result',
          attempts: 1,
        },
      ],
    },
    eventSink: (event) => {
      events.push(event);
      if (event.type === 'batch_started') {
        items[0]!.id = 'resumed-drifted';
        items[1]!.id = 'fresh-drifted';
      }
    },
    execute: () => {
      executeCalls += 1;
      return 'forbidden';
    },
  });

  assert.equal(executeCalls, 0);
  assert.deepEqual(identityCalls, new Map([['0', 2], ['1', 2]]));
  assert.deepEqual(result.claim_order, []);
  assert.deepEqual(
    result.results_input_order.map((entry) => entry.status),
    ['failed', 'failed'],
  );
  for (const entry of result.results_input_order) {
    const error = failedError(entry);
    assert.ok(error instanceof BatchItemIdentityDriftError);
  }
  assert.deepEqual(
    events
      .filter((event) => String(event.type) === 'item_identity_drift')
      .map((event) => event.item_id),
    ['resumed', 'fresh'],
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

  const noRecovery = await runBoundedBatch({
    contract,
    items: ['a'],
    getItemIdentity: (item) => item,
    mode: 'mutation',
    maxConcurrency: 1,
    execute: () => {
      throw new Error('consumed once');
    },
  });
  assert.equal(noRecovery.results_input_order[0]?.status, 'failed');
  assert.equal(noRecovery.results_input_order[0]?.attempts, 1);

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
      {
        ...stringItemContract('a'),
        state: 'completed',
        outcome: 'succeeded',
        value: 'A',
        attempts: 1,
      },
      { ...stringItemContract('b'), state: 'attempted', attempts: 1 },
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
    resume: {
      contract,
      items: [{ ...stringItemContract('b'), state: 'attempted', attempts: 2 }],
    },
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
    runBoundedBatch({ ...base, maxConcurrency: 1, mode: 'other' as never }),
    BatchContractError,
  );
  await assert.rejects(
    runBoundedBatch({ ...base, maxConcurrency: 1, items: ['a', 'a'] }),
    BatchContractError,
  );
  for (const identity of ['', 'bad\nidentity', 1 as never]) {
    await assert.rejects(
      runBoundedBatch({
        ...base,
        maxConcurrency: 1,
        getItemIdentity: () => identity,
      }),
      BatchContractError,
    );
  }
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
        items: [
          { ...stringItemContract('a'), state: 'attempted', attempts: 1 },
          { ...stringItemContract('a'), state: 'attempted', attempts: 1 },
        ],
      },
    }),
    BatchContractError,
  );
  await assert.rejects(
    runBoundedBatch({
      ...base,
      maxConcurrency: 1,
      resume: {
        contract,
        items: [
          {
            ...stringItemContract('a'),
            state: 'completed',
            outcome: 'failed',
            value: 'A',
            attempts: 1,
          } as never,
        ],
      },
    }),
    BatchContractError,
  );
  await assert.rejects(
    runBoundedBatch({
      ...base,
      maxConcurrency: 1,
      resume: {
        contract,
        items: [{ ...stringItemContract('missing'), state: 'attempted', attempts: 1 }],
      },
    }),
    BatchContractError,
  );
  await assert.rejects(
    runBoundedBatch({
      ...base,
      maxConcurrency: 1,
      resume: {
        contract,
        items: [
          {
            ...stringItemContract('a'),
            content_sha256: 'bad',
            state: 'attempted',
            attempts: 1,
          } as never,
        ],
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

test('read retry isolates classifier, backoff sleep, and resumed-read failures', async () => {
  const classifierFailure = await runBoundedBatch({
    contract,
    items: ['a'],
    getItemIdentity: (item) => item,
    mode: 'read',
    maxConcurrency: 1,
    retry: {
      maxAttempts: 2,
      maxDelayMs: 1,
      shouldRetry: () => {
        throw new Error('classifier failed');
      },
      delayMs: () => 0,
    },
    execute: () => {
      throw new Error('read failed');
    },
  });
  assert.match(String(failedError(classifierFailure.results_input_order[0])), /classifier failed/u);

  const classifiedTerminal = await runBoundedBatch({
    contract,
    items: ['a'],
    getItemIdentity: (item) => item,
    mode: 'read',
    maxConcurrency: 1,
    retry: {
      maxAttempts: 2,
      maxDelayMs: 1,
      shouldRetry: () => false,
      delayMs: () => 0,
    },
    execute: () => {
      throw new Error('not retryable');
    },
  });
  assert.match(String(failedError(classifiedTerminal.results_input_order[0])), /not retryable/u);

  const sleepFailure = await runBoundedBatch({
    contract,
    items: ['a'],
    getItemIdentity: (item) => item,
    mode: 'read',
    maxConcurrency: 1,
    retry: {
      maxAttempts: 2,
      maxDelayMs: 1,
      shouldRetry: () => true,
      delayMs: () => 1,
    },
    sleep: async () => {
      throw new Error('sleep failed');
    },
    execute: () => {
      throw new Error('retryable');
    },
  });
  assert.match(String(failedError(sleepFailure.results_input_order[0])), /sleep failed/u);

  let defaultSleepCalls = 0;
  const defaultSleep = await runBoundedBatch({
    contract,
    items: ['a'],
    getItemIdentity: (item) => item,
    mode: 'read',
    maxConcurrency: 1,
    retry: {
      maxAttempts: 2,
      maxDelayMs: 1,
      shouldRetry: () => true,
      delayMs: () => 0,
    },
    execute: () => {
      defaultSleepCalls += 1;
      if (defaultSleepCalls === 1) throw new Error('once');
      return 'A';
    },
  });
  assert.equal(defaultSleep.results_input_order[0]?.status, 'succeeded');

  const resumedRead = await runBoundedBatch({
    contract,
    items: ['a'],
    getItemIdentity: (item) => item,
    mode: 'read',
    maxConcurrency: 1,
    resume: {
      contract,
      items: [{ ...stringItemContract('a'), state: 'attempted', attempts: 2 }],
    },
    execute: () => {
      throw new Error('resumed read failed');
    },
  });
  assert.equal(resumedRead.results_input_order[0]?.attempts, 3);
  assert.equal(resumedRead.results_input_order[0]?.resumed, true);
});

test('mutation recovery isolates thrown, invalid, and explicit unresolved readback results', async () => {
  const runRecovery = (recoverMutation: () => never) =>
    runBoundedBatch({
      contract,
      items: ['a'],
      getItemIdentity: (item) => item,
      mode: 'mutation' as const,
      maxConcurrency: 1,
      execute: () => {
        throw new Error('ambiguous');
      },
      recoverMutation,
    });

  const thrown = await runRecovery(() => {
    throw new Error('readback failed');
  });
  assert.match(String(failedError(thrown.results_input_order[0])), /readback failed/u);

  const invalid = await runRecovery(() => ({ status: 'invalid' }) as never);
  assert.match(String(failedError(invalid.results_input_order[0])), /unsupported status/u);

  const explicit = await runBoundedBatch({
    contract,
    items: ['a'],
    getItemIdentity: (item) => item,
    mode: 'mutation',
    maxConcurrency: 1,
    execute: () => {
      throw new Error('ambiguous');
    },
    recoverMutation: () => ({ status: 'unresolved', error: new Error('desired absent') }),
  });
  assert.match(String(failedError(explicit.results_input_order[0])), /desired absent/u);
});

test('batch timestamps stay monotonic and sink or clock failures fail closed', async () => {
  const times = [10, 5, 4, 20, 19, 18, 17];
  const monotonic = await runBoundedBatch({
    contract,
    items: ['a'],
    getItemIdentity: (item) => item,
    mode: 'read',
    maxConcurrency: 1,
    clock: { now: () => times.shift() ?? 0 },
    execute: ({ item }) => item,
  });
  assert.ok(
    monotonic.events.every(
      (event, index) =>
        index === 0 || event.timestamp_ms >= monotonic.events[index - 1]!.timestamp_ms,
    ),
  );

  await assert.rejects(
    runBoundedBatch({
      contract,
      items: [],
      getItemIdentity: (item: string) => item,
      mode: 'read',
      maxConcurrency: 1,
      clock: { now: () => Number.NaN },
      execute: ({ item }) => item,
    }),
    BatchContractError,
  );
  await assert.rejects(
    runBoundedBatch({
      contract,
      items: ['a'],
      getItemIdentity: (item) => item,
      mode: 'read',
      maxConcurrency: 1,
      eventSink: () => {
        throw new Error('event sink failed');
      },
      execute: ({ item }) => item,
    }),
    /event sink failed/u,
  );
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempts = 0; attempts < 100; attempts += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for deterministic test state.');
}

function failedError(value: unknown): unknown {
  assert.ok(
    value &&
      typeof value === 'object' &&
      'status' in value &&
      value.status === 'failed' &&
      'error' in value,
  );
  return value.error;
}
