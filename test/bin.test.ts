import test from 'node:test';
import assert from 'node:assert/strict';

const maybeTest = process.env.TIANGONG_LCA_COVERAGE === '1' ? test.skip : test;

maybeTest('runFromBin executes when imported without direct auto-run', async () => {
  const { runFromBin } = await import('../bin/tiangong.js');
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  let stdout = '';
  let stderr = '';

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;

  try {
    const exitCode = await runFromBin(['doctor', '--json'], {
      TIANGONG_LCA_API_BASE_URL: 'https://example.com/functions/v1',
      TIANGONG_LCA_API_KEY: 'secret-token',
      TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_key',
    });

    assert.equal(exitCode, 0);
    assert.match(stdout, /"ok":true/u);
    assert.equal(stderr, '');
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
});
