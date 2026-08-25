import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  PACKAGE_NAME,
  REGISTRY_ORIGIN,
  collectDependencyVersions,
  packagePurl,
  parseArgs,
  parseSha512Integrity,
  publicConsumerEnvironment,
  requiresIdentityReceiptHelp,
  validatePackageManagerVersion,
  validateAttestations,
  validatePackageMetadata,
  validateTarballBytes,
  withPrivateTempDirectory,
} = require('../scripts/ci/verify-published-release.cjs');

const VERSION = '0.1.1';
const COMMIT = 'a'.repeat(40);
const TARBALL = Buffer.from('published-cli-tarball', 'utf8');
const SHA512_BYTES = createHash('sha512').update(TARBALL).digest();
const SHA512_HEX = SHA512_BYTES.toString('hex');
const INTEGRITY = `sha512-${SHA512_BYTES.toString('base64')}`;

function options() {
  return { version: VERSION, expectedGitHead: COMMIT };
}

function statement(predicateType, predicate) {
  return Buffer.from(
    JSON.stringify({
      _type: 'https://in-toto.io/Statement/v1',
      subject: [{ name: packagePurl(VERSION), digest: { sha512: SHA512_HEX } }],
      predicateType,
      predicate,
    }),
    'utf8',
  ).toString('base64');
}

function attestation(predicateType, predicate) {
  return {
    predicateType,
    bundle: {
      dsseEnvelope: {
        payload: statement(predicateType, predicate),
        signatures: [{ keyid: 'test', sig: 'test' }],
      },
    },
  };
}

function metadata(overrides = {}) {
  return {
    name: PACKAGE_NAME,
    version: VERSION,
    gitHead: COMMIT,
    dist: {
      integrity: INTEGRITY,
      tarball: `${REGISTRY_ORIGIN}/@tiangong-lca/cli/-/cli-${VERSION}.tgz`,
      attestations: {
        url: `${REGISTRY_ORIGIN}/-/npm/v1/attestations/%40tiangong-lca%2fcli@${VERSION}`,
        provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
      },
    },
    ...overrides,
  };
}

function attestations(overrides = {}) {
  const tagRef = `refs/tags/cli-v${VERSION}`;
  const publishPredicate = {
    name: PACKAGE_NAME,
    version: VERSION,
    registry: REGISTRY_ORIGIN,
  };
  const provenancePredicate = {
    buildDefinition: {
      externalParameters: {
        workflow: {
          ref: tagRef,
          repository: 'https://github.com/tiangong-lca/tiangong-cli',
          path: '.github/workflows/publish.yml',
        },
      },
      resolvedDependencies: [
        {
          uri: `git+https://github.com/tiangong-lca/tiangong-cli@${tagRef}`,
          digest: { gitCommit: COMMIT },
        },
      ],
    },
    runDetails: {
      metadata: {
        invocationId: 'https://github.com/tiangong-lca/tiangong-cli/actions/runs/123/attempts/1',
      },
    },
  };
  return {
    attestations: [
      attestation(
        'https://github.com/npm/attestation/tree/main/specs/publish/v0.1',
        publishPredicate,
      ),
      attestation('https://slsa.dev/provenance/v1', { ...provenancePredicate, ...overrides }),
    ],
  };
}

test('published release verifier requires exact version and Git intent', () => {
  assert.deepEqual(
    parseArgs(['--version', VERSION, '--expected-git-head', COMMIT.toUpperCase()]),
    options(),
  );
  assert.deepEqual(
    parseArgs(['--', '--version', VERSION, '--expected-git-head', COMMIT]),
    options(),
  );
  for (const argv of [
    [],
    ['--version', 'v0.1.1', '--expected-git-head', COMMIT],
    ['--version', VERSION, '--expected-git-head', 'short'],
    ['--version', VERSION, '--version', VERSION, '--expected-git-head', COMMIT],
    ['--unknown', 'value'],
  ]) {
    assert.throws(() => parseArgs(argv));
  }
  assert.equal(requiresIdentityReceiptHelp('0.1.0'), false);
  assert.equal(requiresIdentityReceiptHelp('0.1.1'), true);
  assert.equal(requiresIdentityReceiptHelp('1.0.0'), true);
});

test('registry metadata binds canonical integrity, provenance, and public URLs', () => {
  const result = validatePackageMetadata(metadata(), options());
  assert.equal(result.registryGitHead, COMMIT);
  assert.equal(result.integrity.hex, SHA512_HEX);
  assert.equal(validateTarballBytes(TARBALL, result.integrity), SHA512_HEX);

  const withoutGitHead = metadata();
  delete withoutGitHead.gitHead;
  assert.equal(validatePackageMetadata(withoutGitHead, options()).registryGitHead, null);
  assert.throws(() => validatePackageMetadata(metadata({ gitHead: 'b'.repeat(40) }), options()));
  assert.throws(() =>
    validatePackageMetadata(
      metadata({
        dist: {
          ...metadata().dist,
          tarball: `https://example.com/cli-${VERSION}.tgz`,
        },
      }),
      options(),
    ),
  );
  assert.throws(() => validateTarballBytes(Buffer.from('tampered'), result.integrity));
  assert.throws(() => parseSha512Integrity('sha256-deadbeef'));
});

test('npm and SLSA attestations bind verified bundles, tarball, tag, workflow, commit, and run', async () => {
  const verifiedBundles = [];
  const result = await validateAttestations(attestations(), options(), SHA512_HEX, async (bundle) =>
    verifiedBundles.push(bundle),
  );
  assert.equal(verifiedBundles.length, 1);
  assert.equal(
    result.invocationId,
    'https://github.com/tiangong-lca/tiangong-cli/actions/runs/123/attempts/1',
  );

  const wrongCommit = attestations({
    buildDefinition: {
      ...attestations().attestations[1].predicate,
      resolvedDependencies: [],
    },
  });
  await assert.rejects(() =>
    validateAttestations(wrongCommit, options(), SHA512_HEX, async () => {}),
  );
  await assert.rejects(() =>
    validateAttestations({ attestations: [] }, options(), SHA512_HEX, async () => {}),
  );
  await assert.rejects(() =>
    validateAttestations(attestations(), options(), '0'.repeat(128), async () => {}),
  );
});

test('forged DSSE signatures are rejected by the real Sigstore verifier', async () => {
  await assert.rejects(
    () => validateAttestations(attestations(), options(), SHA512_HEX),
    /sigstore|signature|bundle|verification/iu,
  );
});

test('public consumer environment is credential-free and dependency scanning is recursive', () => {
  const env = publicConsumerEnvironment(
    {
      PATH: '/bin',
      TIANGONG_LCA_TEST_API_KEY: 'must-not-pass',
      NODE_AUTH_TOKEN: 'must-not-pass',
      NPM_TOKEN: 'must-not-pass',
    },
    '/tmp/public-consumer.npmrc',
    '/tmp/public-consumer-global.npmrc',
  );
  assert.equal(env.PATH, '/bin');
  assert.equal(env.TIANGONG_LCA_TEST_API_KEY, undefined);
  assert.equal(env.NODE_AUTH_TOKEN, undefined);
  assert.equal(env.NPM_TOKEN, undefined);
  assert.equal(env.NPM_CONFIG_USERCONFIG, '/tmp/public-consumer.npmrc');
  assert.equal(env.NPM_CONFIG_GLOBALCONFIG, '/tmp/public-consumer-global.npmrc');
  assert.equal(env.npm_config_globalconfig, '/tmp/public-consumer-global.npmrc');
  assert.equal(validatePackageManagerVersion('11.23.0'), '11.23.0');
  assert.throws(() => validatePackageManagerVersion('11.22.0'));

  assert.deepEqual(
    [
      ...collectDependencyVersions(
        [{ dependencies: { nested: { name: 'typescript', version: '7.0.2' } } }],
        'typescript',
      ),
    ],
    ['7.0.2'],
  );
  assert.deepEqual(
    [
      ...collectDependencyVersions(
        [{ optionalDependencies: { typescript: { version: '7.0.2' } } }],
        'typescript',
      ),
    ],
    ['7.0.2'],
  );
});

test('temporary consumer cleanup runs even when private-directory setup fails', () => {
  const removed = [];
  assert.throws(() =>
    withPrivateTempDirectory(() => assert.fail('consumer callback must not run'), {
      mkdtemp: () => '/tmp/tiangong-cli-consumer-test',
      chmod: () => {
        throw new Error('chmod failed');
      },
      remove: (target, options) => removed.push({ target, options }),
    }),
  );
  assert.deepEqual(removed, [
    {
      target: '/tmp/tiangong-cli-consumer-test',
      options: { recursive: true, force: true },
    },
  ]);
});
