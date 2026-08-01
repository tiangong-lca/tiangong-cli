import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDataApiProfileHeaders,
  buildDataApiUrl,
  CORE_PUBLIC_RELATIONS,
  DATA_API_CONTRACT,
  DATA_API_PROFILE_ENV,
  DATA_API_RPC_REPLAY_CLASSIFICATION,
  DATA_API_RPC_TARGETS,
  isDataApiAuthRefreshReplaySafe,
  isDataApiUrl,
  resolveDataApiCapability,
  resolveDataApiCapabilityFromUrl,
  resolveDataApiProfile,
} from '../src/lib/supabase-data-api-contract.js';

test('data api manifest freezes the exact database contract and complete CLI inventory', () => {
  assert.equal(DATA_API_CONTRACT.schemaVersion, 'tiangong-lca-cli.data-api-contract.v1');
  assert.equal(
    DATA_API_CONTRACT.databaseContract.artifactCommit,
    '94bfefe159c949da1b1cc1d25718961050baaa1a',
  );
  assert.equal(
    DATA_API_CONTRACT.databaseContract.inventorySha256,
    'd7353b0b3d2dcd3bcc64ffaf41ff2015729142789e0b3a39818acc12ebf35c16',
  );
  assert.equal(DATA_API_CONTRACT.databaseContract.contractReady, false);
  assert.deepEqual(DATA_API_CONTRACT.databaseContract.artifactSource, {
    baseline: 'tiangong-lca/workspace#533',
    databaseBaseSha: '157ef7bb4e844edb26525dfb89f4fde188ee0cef',
    databaseInventorySha: '86203c9190b11f12109a7fdd3f310ff47a47c9e5',
    databaseMergeBaseSha: '907f7b6a47b98c401d98184a8b7452aaaa429bbf',
    databaseSchemaSha: '20f56228c21e8e677154c3e77fbf0e243dde677d',
    previousArtifactSha256: '248d1f86addc332d0f5486b2edb8875e87a95929d06c9f59ef51968f90685c1b',
    workspaceBaselineSha: '520b7af67240beb0f08419ab432a018d93542170',
    workspacePinnedDatabaseSha: '1516ad7bb3f74734095756e741f00f60e93b79b3',
  });
  assert.equal(
    DATA_API_CONTRACT.databaseContract.snapshotRole,
    'immutable-pre-contract-provenance',
  );
  assert.equal(DATA_API_CONTRACT.databaseContract.refreshRequiredAfter, null);
  assert.deepEqual(CORE_PUBLIC_RELATIONS, [
    'contacts',
    'flowproperties',
    'flows',
    'ilcd',
    'lciamethods',
    'lifecyclemodels',
    'processes',
    'sources',
    'unitgroups',
  ]);
  assert.equal(Object.keys(DATA_API_RPC_TARGETS).length, 17);
  assert.equal(Object.keys(DATA_API_RPC_REPLAY_CLASSIFICATION).length, 17);
  assert.deepEqual(
    Object.keys(DATA_API_RPC_REPLAY_CLASSIFICATION).sort(),
    Object.keys(DATA_API_RPC_TARGETS).sort(),
  );
  assert.deepEqual(DATA_API_CONTRACT.views, []);
  assert.equal(DATA_API_CONTRACT.retryPolicy.mutations.startsWith('no automatic'), true);
  assert.equal(DATA_API_CONTRACT.blockers[0].capability, 'rpc:cmd_dataset_alias_plan_guarded');
});

test('auth refresh replay classification is method- and capability-aware', () => {
  const rest = 'https://example.supabase.co/rest/v1';
  assert.equal(isDataApiAuthRefreshReplaySafe({ url: `${rest}/processes`, method: 'HEAD' }), true);
  assert.equal(
    isDataApiAuthRefreshReplaySafe({
      url: `${rest}/rpc/cmd_dataset_derivative_rebuild_read`,
      method: 'POST',
    }),
    true,
  );
  assert.equal(
    isDataApiAuthRefreshReplaySafe({
      url: `${rest}/rpc/cmd_dataset_save_draft`,
      method: 'POST',
    }),
    false,
  );
  assert.equal(
    isDataApiAuthRefreshReplaySafe({ url: `${rest}/rpc/unknown_rpc`, method: 'POST' }),
    false,
  );
  assert.equal(
    isDataApiAuthRefreshReplaySafe({ url: `${rest}/processes`, method: 'PATCH' }),
    false,
  );
});

test('profile parsing defaults to an explicit version and rejects unknown values', () => {
  assert.equal(resolveDataApiProfile({}), 'legacy-public-v1');
  assert.equal(
    resolveDataApiProfile({ [DATA_API_PROFILE_ENV]: ' api-contract-v1 ' }),
    'api-contract-v1',
  );
  assert.throws(
    () => resolveDataApiProfile({ [DATA_API_PROFILE_ENV]: 'public' }),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'DATA_API_PROFILE_INVALID',
  );
});

test('core relations stay explicitly public for both versioned profiles', () => {
  for (const profile of ['legacy-public-v1', 'api-contract-v1'] as const) {
    const capability = resolveDataApiCapability({
      kind: 'relation',
      name: 'processes',
      profile,
    });
    assert.equal(capability.schema, 'public');
    assert.equal(capability.profile, profile);
    assert.equal(capability.signature, null);
  }
  assert.throws(
    () => resolveDataApiCapability({ kind: 'relation', name: 'process_build_runs' }),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'DATA_API_CAPABILITY_UNMANIFESTED',
  );
});

test('rpc resolution supports old public and new api without inventing private replacements', () => {
  const legacy = resolveDataApiCapability({
    kind: 'rpc',
    name: 'cmd_dataset_delete',
    profile: 'legacy-public-v1',
  });
  assert.equal(legacy.schema, 'public');
  assert.match(legacy.signature ?? '', /p_audit jsonb/u);

  const current = resolveDataApiCapability({
    kind: 'rpc',
    name: 'cmd_dataset_delete',
    profile: 'api-contract-v1',
  });
  assert.equal(current.schema, 'api');

  assert.throws(
    () =>
      resolveDataApiCapability({
        kind: 'rpc',
        name: 'cmd_dataset_alias_plan_guarded',
        profile: 'api-contract-v1',
      }),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'DATA_API_CAPABILITY_BLOCKED',
  );
  assert.throws(
    () => resolveDataApiCapability({ kind: 'rpc', name: 'guessed_future_rpc' }),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'DATA_API_CAPABILITY_UNMANIFESTED',
  );
});

test('CLI role matrix fails closed for anon and service credentials', () => {
  assert.equal(
    resolveDataApiCapability({ kind: 'relation', name: 'flows', role: 'authenticated' }).role,
    'authenticated',
  );
  for (const role of ['anon', 'service_role'] as const) {
    assert.throws(
      () => resolveDataApiCapability({ kind: 'relation', name: 'flows', role }),
      (error: unknown) =>
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'DATA_API_ROLE_FORBIDDEN',
    );
  }
});

test('profile headers are explicit and method-aware', () => {
  const relation = resolveDataApiCapability({ kind: 'relation', name: 'flows' });
  assert.deepEqual(applyDataApiProfileHeaders({ Prefer: 'count=exact' }, relation), {
    'accept-profile': 'public',
    prefer: 'count=exact',
  });
  assert.equal(applyDataApiProfileHeaders(undefined, relation, 'HEAD')['accept-profile'], 'public');

  const rpc = resolveDataApiCapability({
    kind: 'rpc',
    name: 'cmd_dataset_delete',
    profile: 'api-contract-v1',
  });
  assert.equal(applyDataApiProfileHeaders(undefined, rpc, 'POST')['content-profile'], 'api');
  assert.equal(applyDataApiProfileHeaders(undefined, rpc, 'PATCH')['content-profile'], 'api');
});

test('URL resolution binds relations and RPCs to the manifest', () => {
  assert.equal(isDataApiUrl('https://example.supabase.co/rest/v1/processes'), true);
  assert.equal(isDataApiUrl('https://example.supabase.co/auth/v1/user'), false);
  const relation = resolveDataApiCapabilityFromUrl({
    url: 'https://example.supabase.co/rest/v1/processes?id=eq.1',
  });
  assert.equal(relation.name, 'processes');
  assert.equal(
    buildDataApiUrl('https://example.supabase.co/rest/v1/', relation),
    'https://example.supabase.co/rest/v1/processes',
  );

  const rpc = resolveDataApiCapabilityFromUrl({
    url: 'https://example.supabase.co/rest/v1/rpc/cmd_dataset_delete',
    method: 'POST',
    profile: 'api-contract-v1',
  });
  assert.equal(rpc.schema, 'api');
  assert.equal(
    buildDataApiUrl('https://example.supabase.co/rest/v1', rpc),
    'https://example.supabase.co/rest/v1/rpc/cmd_dataset_delete',
  );

  assert.throws(
    () => resolveDataApiCapabilityFromUrl({ url: 'https://example.supabase.co/auth/v1/user' }),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'DATA_API_URL_INVALID',
  );
  assert.throws(
    () => resolveDataApiCapabilityFromUrl({ url: 'https://example.supabase.co/rest/v1/' }),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'DATA_API_URL_INVALID',
  );
});
