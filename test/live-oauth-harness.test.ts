import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertLoginOrigin,
  createPrivateCase,
  loadPrivateCredentials,
  safeCaseReport,
} from '../scripts/live/case-safety.js';

test('credentials are private, unique, and never echoed in validation failures', () => {
  const root = mkdtempSync(join(tmpdir(), 'oauth-credentials-'));
  const file = join(root, 'credentials.env');
  try {
    writeFileSync(
      file,
      'TIANGONG_LCA_USERNAME=private@example.test\nTIANGONG_LCA_PASSWORD="private value"\nUNRELATED=ignored\n',
      { mode: 0o600 },
    );
    assert.deepEqual(loadPrivateCredentials(file), {
      username: 'private@example.test',
      password: 'private value',
    });
    writeFileSync(
      file,
      'TIANGONG_LCA_USERNAME=private@example.test\nTIANGONG_LCA_PASSWORD=secret-one\nTIANGONG_LCA_PASSWORD=secret-two\n',
    );
    assert.throws(() => loadPrivateCredentials(file), { message: 'LIVE_CREDENTIAL_KEYS_INVALID' });
    symlinkSync(file, join(root, 'link'));
    assert.throws(() => loadPrivateCredentials(join(root, 'link')), {
      message: 'LIVE_CREDENTIAL_FILE_UNSAFE',
    });
    if (process.platform !== 'win32') {
      chmodSync(file, 0o644);
      assert.throws(() => loadPrivateCredentials(file), { message: 'LIVE_CREDENTIAL_FILE_UNSAFE' });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('credentials can only be entered on the exact official login origin', () => {
  assert.doesNotThrow(() =>
    assertLoginOrigin('https://lca.tiangong.earth/user/login?redirect=private-state'),
  );
  for (const url of [
    'http://lca.tiangong.earth/user/login',
    'https://lca.tiangong.earth.evil.test/',
    'https://user:pass@lca.tiangong.earth/',
    'file:///tmp/page',
    'bad-url',
  ]) {
    assert.throws(() => assertLoginOrigin(url), { message: 'LIVE_LOGIN_ORIGIN_REJECTED' });
  }
});

test('case state cannot reuse an existing directory or live inside a checkout', () => {
  const root = mkdtempSync(join(tmpdir(), 'oauth-case-'));
  try {
    const result = createPrivateCase(join(root, 'new-case'));
    assert.equal(
      readFileSync(result.contextFile, 'utf8').includes('tiangong.cli-live-case.v1'),
      true,
    );
    assert.throws(() => createPrivateCase(join(root, 'new-case')), {
      message: 'LIVE_CASE_PATH_UNSAFE',
    });
    mkdirSync(join(root, '.git'));
    assert.throws(() => createPrivateCase(join(root, 'another-case')), {
      message: 'LIVE_CASE_IN_CHECKOUT',
    });
    assert.throws(() => createPrivateCase('relative-case'), { message: 'LIVE_CASE_PATH_UNSAFE' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('public report projects only known non-sensitive result fields', () => {
  const result = safeCaseReport({
    caseId: 'rc01-test',
    stage: 'source-identity',
    status: 'failed',
  });
  assert.deepEqual(Object.keys(result).sort(), ['caseId', 'schema', 'stage', 'status']);
  assert.equal(JSON.stringify(result).includes('session'), false);
});
