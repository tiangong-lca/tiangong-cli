import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  PACKAGE_NAME,
  REGISTRY_ORIGIN,
  collectDependencyVersions,
  certificateString,
  provenanceVerificationOptions,
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
      buildType: 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
      internalParameters: {
        github: {
          event_name: 'push',
          repository_id: '1194220834',
          repository_owner_id: '199785309',
        },
      },
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
      builder: { id: 'https://github.com/actions/runner/github-hosted' },
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
      NODE_AUTH_TOKEN: 'must-not-pass',
      NPM_TOKEN: 'must-not-pass',
    },
    '/tmp/public-consumer.npmrc',
    '/tmp/public-consumer-global.npmrc',
  );
  assert.equal(env.PATH, '/bin');
  assert.equal(env.NODE_AUTH_TOKEN, undefined);
  assert.equal(env.NPM_TOKEN, undefined);
  assert.equal(env.NPM_CONFIG_USERCONFIG, '/tmp/public-consumer.npmrc');
  assert.equal(env.NPM_CONFIG_GLOBALCONFIG, '/tmp/public-consumer-global.npmrc');
  assert.equal(env.npm_config_globalconfig, '/tmp/public-consumer-global.npmrc');
  assert.equal(validatePackageManagerVersion('11.24.0'), '11.24.0');
  assert.throws(() => validatePackageManagerVersion('11.23.0'));

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

function releaseEvidence(version, repository, ownerId) {
  const payload = attestations();
  const item = payload.attestations[1];
  const signed = JSON.parse(Buffer.from(item.bundle.dsseEnvelope.payload, 'base64'));
  const ref = `refs/tags/cli-v${version}`;
  signed.subject[0].name = packagePurl(version);
  const build = signed.predicate.buildDefinition;
  build.externalParameters.workflow.repository = `https://github.com/${repository}`;
  build.externalParameters.workflow.ref = ref;
  build.internalParameters.github.repository_owner_id = ownerId;
  build.resolvedDependencies[0].uri = `git+https://github.com/${repository}@${ref}`;
  signed.predicate.runDetails.metadata.invocationId = `https://github.com/${repository}/actions/runs/123/attempts/1`;
  item.bundle.dsseEnvelope.payload = Buffer.from(JSON.stringify(signed)).toString('base64');
  return payload;
}

function changeStatement(payload, update) {
  const item = payload.attestations[1];
  const signed = JSON.parse(Buffer.from(item.bundle.dsseEnvelope.payload, 'base64'));
  update(signed);
  item.bundle.dsseEnvelope.payload = Buffer.from(JSON.stringify(signed)).toString('base64');
  return payload;
}

test('future release evidence has one current repository/owner tuple and no legacy fallback', async () => {
  const future = { version: '0.1.15', expectedGitHead: COMMIT };
  const current = () => releaseEvidence(future.version, 'tiangong-lca/cli', '327771381');
  assert.match(
    (await validateAttestations(current(), future, SHA512_HEX, async () => {})).invocationId,
    /tiangong-lca\/cli\//,
  );
  await assert.rejects(() =>
    validateAttestations(
      releaseEvidence(future.version, 'tiangong-lca/tiangong-cli', '199785309'),
      future,
      SHA512_HEX,
      async () => {},
    ),
  );
  await assert.rejects(() =>
    validateAttestations(
      releaseEvidence(VERSION, 'tiangong-lca/cli', '327771381'),
      options(),
      SHA512_HEX,
      async () => {},
    ),
  );
  for (const modify of [
    (s) => {
      s.predicate.buildDefinition.internalParameters.github.repository_id = '999';
    },
    (s) => {
      s.predicate.buildDefinition.internalParameters.github.repository_owner_id = '199785309';
    },
    (s) => {
      s.predicate.buildDefinition.externalParameters.workflow.ref = 'refs/heads/main';
    },
    (s) => {
      s.predicate.buildDefinition.resolvedDependencies[0].uri =
        'git+https://github.com/tiangong-lca/tiangong-cli@refs/tags/cli-v0.1.15';
    },
    (s) => {
      s.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = 'b'.repeat(40);
    },
    (s) => {
      s.predicate.buildDefinition.resolvedDependencies.push(
        s.predicate.buildDefinition.resolvedDependencies[0],
      );
    },
    (s) => {
      s.predicate.buildDefinition.internalParameters.github.event_name = 'pull_request';
    },
    (s) => {
      s.predicate.runDetails.builder.id = 'https://example.org/runner';
    },
    (s) => {
      s.predicate.runDetails.metadata.invocationId += '/unbound';
    },
    (s) => {
      s.subject.push(s.subject[0]);
    },
  ]) {
    await assert.rejects(() =>
      validateAttestations(changeStatement(current(), modify), future, SHA512_HEX, async () => {}),
    );
  }
  const duplicate = current();
  duplicate.attestations.push(duplicate.attestations[1]);
  await assert.rejects(
    () => validateAttestations(duplicate, future, SHA512_HEX, async () => {}),
    /unambiguous/,
  );
});

test('certificate policy binds numeric identity, exact source and hosted signer without disabling transparency', async () => {
  for (const [version, repository, owner] of [
    ['0.1.14', 'tiangong-lca/tiangong-cli', '199785309'],
    ['0.1.15', 'tiangong-lca/cli', '327771381'],
  ]) {
    const evidence = releaseEvidence(version, repository, owner);
    const policy = await provenanceVerificationOptions(evidence.attestations[1].bundle, {
      version,
      expectedGitHead: COMMIT,
    });
    assert.equal(policy.certificateIssuer, 'https://token.actions.githubusercontent.com');
    assert.equal(policy.ctLogThreshold, 1);
    assert.equal(policy.tlogThreshold, 1);
    assert.ok(
      new RegExp(policy.certificateIdentityURI).test(
        `https://github.com/${repository}/.github/workflows/publish.yml@refs/tags/cli-v${version}`,
      ),
    );
    assert.equal(
      Buffer.from(policy.certificateOIDs['1.3.6.1.4.1.57264.1.15']).toString('hex'),
      '0c0a31313934323230383334',
    );
    assert.equal(policy.certificateOIDs['1.3.6.1.4.1.57264.1.17'], certificateString(owner));
    assert.equal(policy.certificateOIDs['1.3.6.1.4.1.57264.1.13'], certificateString(COMMIT));
    assert.equal(
      policy.certificateOIDs['1.3.6.1.4.1.57264.1.14'],
      certificateString(`refs/tags/cli-v${version}`),
    );
    assert.equal(
      policy.certificateOIDs['1.3.6.1.4.1.57264.1.11'],
      certificateString('github-hosted'),
    );
  }
  assert.throws(() => certificateString('x'.repeat(128)));
  assert.throws(() => certificateString('\n'));
});

test('verification owns input snapshots across asynchronous crypto validation', async () => {
  const payload = attestations();
  const intent = options();
  const result = await validateAttestations(payload, intent, SHA512_HEX, async () => {
    intent.version = '9.9.9';
    changeStatement(payload, (s) => {
      s.predicate.buildDefinition.internalParameters.github.repository_owner_id = '999';
    });
  });
  assert.match(result.invocationId, /tiangong-lca\/tiangong-cli\/actions/);
});
