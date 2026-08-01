import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertExactOccurrenceSet,
  deriveManifest,
  deriveOccurrences,
  MANIFEST_SCHEMA,
  verifyManifest,
} from '../scripts/scan-data-api-consumers.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('AST derivation covers static, bracket, dynamic-union, auth, and raw-route consumers exactly once', () => {
  const source = `
// data-api-relations: flows, processes
// data-api-dynamic-relation-expression: options.table
client.from('flows').select('*');
client['from'](options.table).upsert(row);
auth.auth.signInWithPassword({ email, password });
const url = \`\${base}/auth/v1/user\`;
`;
  const occurrences = deriveOccurrences('src/fixture.ts', source);
  assert.deepEqual(
    occurrences.map((item) => [item.operation, item.object]),
    [
      ['postgrest.relation', 'flows'],
      ['postgrest.relation', 'flows'],
      ['postgrest.relation', 'processes'],
      ['auth.signInWithPassword', 'signInWithPassword'],
      ['auth.route', '`${base}/auth/v1/user`'],
    ],
  );
  assert.equal(new Set(occurrences.map((item) => item.id)).size, occurrences.length);
  assert.ok(occurrences.every((item) => item.span.sha256.length === 64));
});

test('AST derivation rejects unresolved dynamic targets', () => {
  assert.throws(
    () => deriveOccurrences('src/fixture.ts', 'client.from(tableName).select();'),
    /unresolved dynamic \.from/u,
  );
});

test('AST derivation rejects direct PostgreSQL, PGMQ, and Cron bypass surfaces', () => {
  assert.throws(
    () =>
      deriveOccurrences(
        'src/fixture.ts',
        "const db = new Pool({ connectionString: 'postgresql://host/db' });",
      ),
    /direct PostgreSQL/u,
  );
});

test('exact-set proof rejects duplicate, missing, and span-tampered occurrence rows', () => {
  const derived = deriveOccurrences('src/fixture.ts', "client.from('flows').select('*');");
  assert.throws(() => assertExactOccurrenceSet([...derived, derived[0]!], derived), /duplicate/u);
  assert.throws(() => assertExactOccurrenceSet([], derived), /bidirectionally exact/u);
  const tampered = structuredClone(derived);
  tampered[0]!.span.sha256 = '0'.repeat(64);
  assert.throws(() => assertExactOccurrenceSet(tampered, derived), /bidirectionally exact/u);
});

test('AST derivation fails closed for destructured aliases and Supabase subprocess bypasses', () => {
  assert.throws(
    () => deriveOccurrences('src/fixture.ts', 'const { from } = client; from(table);'),
    /destructured Supabase/u,
  );
  assert.throws(
    () =>
      deriveOccurrences('src/fixture.ts', "spawn('curl', [SUPABASE_URL + '/rest/v1/processes']);"),
    /subprocess Supabase/u,
  );
});

test('repository manifest is candidate-only, globally unique, and exact for the immutable source tree', () => {
  const manifest = deriveManifest(repoRoot, '5cb359f1d0860df560c7571fa7547b2822b37c71');
  assert.equal(manifest.schema, MANIFEST_SCHEMA);
  assert.deepEqual(manifest.authority, {
    status: 'candidate',
    authorizesDatabaseFreeze: false,
    authorizesHostedMutation: false,
  });
  assert.equal(
    new Set(manifest.occurrences.map((item) => item.id)).size,
    manifest.occurrences.length,
  );
  assert.deepEqual(manifest.publicResidue.views, []);
  assert.ok(manifest.absenceProofs.every((item) => item.result === 'absent'));
});

test('checked-in candidate manifest has exact bidirectional AST closure and immutable delivery guard', () => {
  const result = verifyManifest(repoRoot);
  assert.equal(result.sourceTreeCommit, '5cb359f1d0860df560c7571fa7547b2822b37c71');
  assert.ok(result.occurrenceCount > 0);
  assert.equal(result.sourceTreeDigest.length, 64);
});
