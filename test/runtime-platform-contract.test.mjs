import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { assertRuntimePlatform, parseArgs } = require('../scripts/ci/assert-runtime-platform.cjs');

test('runtime platform assertion requires exact explicit intent', () => {
  assert.deepEqual(parseArgs(['--platform', 'linux', '--arch', 'arm64']), {
    platform: 'linux',
    arch: 'arm64',
  });
  assert.throws(() => parseArgs([]));
  assert.throws(() => parseArgs(['--platform', 'linux', '--arch', 'x64', '--arch', 'arm64']));
  assert.throws(() => parseArgs(['--platform', 'plan9', '--arch', 'x64']));
});

test('runtime platform assertion fails closed on platform or architecture drift', () => {
  assert.deepEqual(
    assertRuntimePlatform(
      { platform: process.platform, arch: process.arch },
      { platform: process.platform, arch: process.arch },
    ),
    { platform: process.platform, arch: process.arch },
  );
  assert.throws(() =>
    assertRuntimePlatform(
      { platform: process.platform, arch: process.arch === 'arm64' ? 'x64' : 'arm64' },
      { platform: process.platform, arch: process.arch },
    ),
  );
  assert.throws(() =>
    assertRuntimePlatform(
      { platform: process.platform === 'win32' ? 'linux' : 'win32', arch: process.arch },
      { platform: process.platform, arch: process.arch },
    ),
  );
});
