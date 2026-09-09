import assert from 'node:assert/strict';
import test from 'node:test';
import { withAssertedRetryDelays } from './helpers/supabase-auth.js';

test('retry clock preserves callback order and exact requested backoff then restores timers', async (context) => {
  const original = globalThis.setTimeout;
  const calls: number[] = [];
  await withAssertedRetryDelays(context, [1000, 2000, 4000], async () => {
    for (const delay of [1000, 2000, 4000]) {
      await new Promise<void>((resolve) =>
        setTimeout(() => {
          calls.push(delay);
          resolve();
        }, delay),
      );
    }
  });
  assert.deepEqual(calls, [1000, 2000, 4000]);
  assert.equal(globalThis.setTimeout, original);
});

test('retry clock rejects missing waits and restores timers after operation failure', async (context) => {
  const original = globalThis.setTimeout;
  await assert.rejects(
    withAssertedRetryDelays(context, [1000], async () => {}),
    /retry schedule must stay exact/,
  );
  assert.equal(globalThis.setTimeout, original);
  const failure = new Error('original operation failure');
  await assert.rejects(
    withAssertedRetryDelays(context, [], async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(globalThis.setTimeout, original);
});
