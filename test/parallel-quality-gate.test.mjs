import assert from 'node:assert/strict';
import test from 'node:test';
import gate from '../scripts/ci/run-parallel-quality-gate.cjs';

const scripts = {
  'prepush:gate':
    'pnpm lint && pnpm peers:check && pnpm test:package && pnpm test:coverage && pnpm test:coverage:assert-full',
};

test('parallel gate overlaps branches while preserving package, coverage and assertion order', async () => {
  const calls = [];
  let releaseLint;
  const lint = new Promise((resolve) => {
    releaseLint = resolve;
  });
  const status = await gate.runParallelGate(scripts, async (name) => {
    calls.push(name);
    if (name === 'lint') await lint;
    if (name === 'test:coverage:assert-full') releaseLint();
    return 0;
  });
  assert.equal(status, 0);
  assert.deepEqual(calls, [
    'lint',
    'test:package',
    'test:coverage',
    'test:coverage:assert-full',
    'peers:check',
  ]);
});

test('parallel gate retains a static failure and waits for the complete other branch', async () => {
  const calls = [];
  assert.equal(
    await gate.runParallelGate(scripts, async (name) => {
      calls.push(name);
      return name === 'lint' ? 7 : 0;
    }),
    7,
  );
  assert.deepEqual(calls, ['lint', 'test:package', 'test:coverage', 'test:coverage:assert-full']);
});

test('parallel gate does not run downstream proof after a package failure or spawn failure', async () => {
  for (const failure of [
    () => 9,
    () => {
      throw new Error('spawn failed');
    },
  ]) {
    const calls = [];
    const status = await gate.runParallelGate(scripts, async (name) => {
      calls.push(name);
      return name === 'test:package' ? failure() : 0;
    });
    assert.notEqual(status, 0);
    assert.deepEqual(calls, ['lint', 'test:package', 'peers:check']);
  }
});

test('parallel gate rejects canonical command drift before executing any branch', async () => {
  await assert.rejects(
    gate.runParallelGate(
      { 'prepush:gate': scripts['prepush:gate'] + ' && pnpm new-required-check' },
      () => {
        assert.fail('No command may execute after canonical gate drift');
      },
    ),
    /must be re-reviewed/,
  );
});
