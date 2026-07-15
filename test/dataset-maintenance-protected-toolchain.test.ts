import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseProtectedToolchainEvidence,
  PROTECTED_TOOLCHAIN_EVIDENCE_SCHEMA,
} from '../src/lib/dataset-maintenance-protected-toolchain.js';

const HASH = 'a'.repeat(64);
const COMMIT = 'b'.repeat(40);

function fixture(): Record<string, unknown> {
  return {
    schema_version: PROTECTED_TOOLCHAIN_EVIDENCE_SCHEMA,
    environment: 'production',
    project_ref: 'production-ref',
    verified_at_utc: '2026-07-15T12:00:00.000Z',
    database_engine: {
      repository: 'tiangong-lca/database-engine',
      production_main_commit_sha: COMMIT,
      production_readback_evidence_sha256: HASH,
      status: 'released_and_read_back',
    },
    cli: {
      repository: 'tiangong-lca/tiangong-cli',
      package_name: '@tiangong-lca/cli',
      package_version: '0.0.26',
      release_commit_sha: COMMIT,
      release_evidence_sha256: HASH,
      status: 'published_and_verified',
    },
    workspace: {
      repository: 'tiangong-lca/workspace',
      integration_commit_sha: COMMIT,
      integration_issue_url: 'https://github.com/tiangong-lca/workspace/issues/406',
      status: 'integrated',
    },
  };
}

function parse(value: unknown = fixture()) {
  return parseProtectedToolchainEvidence(value, {
    projectRef: 'production-ref',
    cliVersion: '0.0.26',
  });
}

test('protected toolchain evidence binds released database, CLI, and workspace identities', () => {
  const evidence = parse();
  assert.equal(evidence.project_ref, 'production-ref');
  assert.equal(evidence.cli.package_version, '0.0.26');
  assert.equal(evidence.workspace.status, 'integrated');
});

test('protected toolchain evidence rejects malformed envelopes and foreign runtime bindings', () => {
  assert.throws(() => parse(null), /must contain database, CLI, and workspace/u);

  const cases: Array<[string, (value: Record<string, unknown>) => void]> = [
    ['schema_version', (value) => (value.schema_version = 'old')],
    ['environment', (value) => (value.environment = 'dev')],
    ['production project', (value) => (value.project_ref = 'foreign')],
    ['ISO timestamp', (value) => (value.verified_at_utc = 'not-time')],
    ['canonical UTC ISO timestamp', (value) => (value.verified_at_utc = '2026-07-15T12:00:00Z')],
    [
      'published CLI version',
      (value) => ((value.cli as Record<string, unknown>).package_version = '0.0.25'),
    ],
    [
      'tracked workspace Issue',
      (value) =>
        ((value.workspace as Record<string, unknown>).integration_issue_url =
          'https://example.com/406'),
    ],
    [
      'lowercase 40-hex git SHA',
      (value) => ((value.cli as Record<string, unknown>).release_commit_sha = 'short'),
    ],
    [
      'lowercase SHA-256 digest',
      (value) =>
        ((value.database_engine as Record<string, unknown>).production_readback_evidence_sha256 =
          'bad'),
    ],
    [
      'released_and_read_back',
      (value) => ((value.database_engine as Record<string, unknown>).status = 'pending'),
    ],
    [
      'tiangong-lca/tiangong-cli',
      (value) => ((value.cli as Record<string, unknown>).repository = 'foreign/repo'),
    ],
    [
      '@tiangong-lca/cli',
      (value) => ((value.cli as Record<string, unknown>).package_name = 'foreign'),
    ],
    [
      'published_and_verified',
      (value) => ((value.cli as Record<string, unknown>).status = 'pending'),
    ],
    [
      'tiangong-lca/workspace',
      (value) => ((value.workspace as Record<string, unknown>).repository = 'foreign/repo'),
    ],
    ['integrated', (value) => ((value.workspace as Record<string, unknown>).status = 'pending')],
  ];
  for (const [message, mutate] of cases) {
    const value = fixture();
    mutate(value);
    assert.throws(() => parse(value), new RegExp(message, 'u'));
  }
});

test('protected toolchain token and version validation fail closed', () => {
  const blankProject = fixture();
  blankProject.project_ref = '   ';
  assert.throws(() => parse(blankProject), /project_ref must be a non-empty string/u);

  const malformedVersion = fixture();
  (malformedVersion.cli as Record<string, unknown>).package_version = 'latest';
  assert.throws(() => parse(malformedVersion), /running published CLI version/u);
});
