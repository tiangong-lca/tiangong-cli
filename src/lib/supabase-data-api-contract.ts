import { CliError } from './errors.js';
import { DATA_API_RPC_REPLAY_CLASSIFICATION } from './supabase-data-api-replay.js';
export {
  DATA_API_RPC_REPLAY_CLASSIFICATION,
  isDataApiAuthRefreshReplaySafe,
} from './supabase-data-api-replay.js';

export const DATA_API_PROFILE_ENV = 'TIANGONG_LCA_DATA_API_PROFILE';
export const DATA_API_PROFILES = ['legacy-public-v1', 'api-contract-v1'] as const;
export type DataApiProfile = (typeof DATA_API_PROFILES)[number];
export type DataApiRole = 'anon' | 'authenticated' | 'service_role';

export const CORE_PUBLIC_RELATIONS = [
  'contacts',
  'flowproperties',
  'flows',
  'ilcd',
  'lciamethods',
  'lifecyclemodels',
  'processes',
  'sources',
  'unitgroups',
] as const;
export type CorePublicRelation = (typeof CORE_PUBLIC_RELATIONS)[number];

export const DATA_API_RELATION_CONSUMERS = {
  contacts: [
    'src/lib/dataset-save-draft-run.ts',
    'src/lib/dataset-remote-verify.ts',
    'src/lib/dataset-maintenance-remote.ts',
    'src/lib/process-refresh-references.ts',
    'src/lib/dataset-maintenance-clear-account.ts',
  ],
  flowproperties: [
    'src/lib/dataset-save-draft-run.ts',
    'src/lib/dataset-remote-verify.ts',
    'src/lib/dataset-maintenance-remote.ts',
    'src/lib/dataset-maintenance-flow-identity-capture.ts',
    'src/lib/process-refresh-references.ts',
  ],
  flows: [
    'src/lib/flow-read.ts',
    'src/lib/flow-list.ts',
    'src/lib/flow-publish-version.ts',
    'src/lib/dataset-save-draft-run.ts',
    'src/lib/dataset-remote-verify.ts',
    'src/lib/dataset-maintenance-remote.ts',
    'src/lib/dataset-maintenance-flow-identity-capture.ts',
    'src/lib/process-refresh-references.ts',
    'src/lib/dataset-maintenance-clear-account.ts',
  ],
  ilcd: [],
  lciamethods: [
    'src/lib/dataset-remote-verify.ts',
    'src/lib/dataset-maintenance-remote.ts',
    'src/lib/process-refresh-references.ts',
  ],
  lifecyclemodels: [
    'src/lib/lifecyclemodel-bundle-save.ts',
    'src/lib/process-dedup-review.ts',
    'src/lib/dataset-remote-verify.ts',
    'src/lib/dataset-maintenance-remote.ts',
    'src/lib/supabase-json-ordered-write.ts',
    'src/lib/dataset-maintenance-clear-account.ts',
  ],
  processes: [
    'src/lib/process-get.ts',
    'src/lib/process-list.ts',
    'src/lib/process-save-draft.ts',
    'src/lib/process-scope-statistics.ts',
    'src/lib/process-dedup-review.ts',
    'src/lib/process-refresh-references.ts',
    'src/lib/dataset-save-draft-run.ts',
    'src/lib/dataset-remote-verify.ts',
    'src/lib/dataset-maintenance-remote.ts',
    'src/lib/supabase-json-ordered-write.ts',
    'src/lib/supabase-rest.ts',
    'src/lib/dataset-maintenance-clear-account.ts',
  ],
  sources: [
    'src/lib/dataset-save-draft-run.ts',
    'src/lib/dataset-remote-verify.ts',
    'src/lib/dataset-maintenance-remote.ts',
    'src/lib/supabase-json-ordered-write.ts',
    'src/lib/process-refresh-references.ts',
    'src/lib/dataset-maintenance-clear-account.ts',
  ],
  unitgroups: [
    'src/lib/dataset-save-draft-run.ts',
    'src/lib/dataset-remote-verify.ts',
    'src/lib/dataset-maintenance-remote.ts',
    'src/lib/dataset-maintenance-flow-identity-capture.ts',
    'src/lib/process-refresh-references.ts',
  ],
} as const satisfies Record<CorePublicRelation, readonly string[]>;

type RpcTarget = {
  targetSchema: 'api' | 'private';
  signature: string;
};

export const DATA_API_RPC_TARGETS = {
  cmd_dataset_alias_execution_admit_guarded: {
    targetSchema: 'api',
    signature: 'public.cmd_dataset_alias_execution_admit_guarded(p_request jsonb)',
  },
  cmd_dataset_alias_execution_gate_guarded: {
    targetSchema: 'api',
    signature:
      'public.cmd_dataset_alias_execution_gate_guarded(p_request_id uuid, p_preflight_token text, p_gate_name text)',
  },
  cmd_dataset_alias_execution_preflight_guarded: {
    targetSchema: 'api',
    signature: 'public.cmd_dataset_alias_execution_preflight_guarded(p_request jsonb)',
  },
  cmd_dataset_alias_execution_read: {
    targetSchema: 'api',
    signature: 'public.cmd_dataset_alias_execution_read(p_request_id uuid)',
  },
  cmd_dataset_alias_plan_guarded: {
    targetSchema: 'private',
    signature: 'public.cmd_dataset_alias_plan_guarded(p_plan jsonb)',
  },
  cmd_dataset_delete: {
    targetSchema: 'api',
    signature: 'public.cmd_dataset_delete(p_table text, p_id uuid, p_version text, p_audit jsonb)',
  },
  cmd_dataset_derivative_rebuild_plan_guarded: {
    targetSchema: 'api',
    signature: 'public.cmd_dataset_derivative_rebuild_plan_guarded(p_plan jsonb)',
  },
  cmd_dataset_derivative_rebuild_read: {
    targetSchema: 'api',
    signature: 'public.cmd_dataset_derivative_rebuild_read(p_request_id uuid)',
  },
  cmd_dataset_derivative_rebuild_snapshot: {
    targetSchema: 'api',
    signature:
      'public.cmd_dataset_derivative_rebuild_snapshot(p_table text, p_id uuid, p_version text)',
  },
  cmd_dataset_flow_identity_capture_attest_guarded: {
    targetSchema: 'api',
    signature: 'public.cmd_dataset_flow_identity_capture_attest_guarded(p_request jsonb)',
  },
  cmd_dataset_flow_identity_process_rewrite_guarded: {
    targetSchema: 'api',
    signature:
      'public.cmd_dataset_flow_identity_process_rewrite_guarded(p_scope_id uuid, p_request jsonb, p_authorization jsonb)',
  },
  cmd_dataset_flow_identity_scope_finalize_guarded: {
    targetSchema: 'api',
    signature:
      'public.cmd_dataset_flow_identity_scope_finalize_guarded(p_scope_id uuid, p_request jsonb, p_authorization jsonb)',
  },
  cmd_dataset_flow_identity_scope_lookup: {
    targetSchema: 'api',
    signature: 'public.cmd_dataset_flow_identity_scope_lookup(p_request jsonb)',
  },
  cmd_dataset_flow_identity_scope_preflight_guarded: {
    targetSchema: 'api',
    signature: 'public.cmd_dataset_flow_identity_scope_preflight_guarded(p_request jsonb)',
  },
  cmd_dataset_flow_identity_scope_read: {
    targetSchema: 'api',
    signature: 'public.cmd_dataset_flow_identity_scope_read(p_scope_id uuid)',
  },
  cmd_dataset_flow_identity_scope_recover_guarded: {
    targetSchema: 'api',
    signature:
      'public.cmd_dataset_flow_identity_scope_recover_guarded(p_scope_id uuid, p_request jsonb)',
  },
  cmd_dataset_save_draft: {
    targetSchema: 'api',
    signature:
      'public.cmd_dataset_save_draft(p_table text, p_id uuid, p_version text, p_json_ordered jsonb, p_model_id uuid, p_rule_verification boolean, p_audit jsonb)',
  },
} as const satisfies Record<string, RpcTarget>;

export type DataApiRpc = keyof typeof DATA_API_RPC_TARGETS;

export const DATA_API_CONTRACT = {
  schemaVersion: 'tiangong-lca-cli.data-api-contract.v1',
  databaseContract: {
    repository: 'tiangong-lca/database-engine',
    artifactCommit: '94bfefe159c949da1b1cc1d25718961050baaa1a',
    artifactSource: {
      baseline: 'tiangong-lca/workspace#533',
      databaseBaseSha: '157ef7bb4e844edb26525dfb89f4fde188ee0cef',
      databaseInventorySha: '86203c9190b11f12109a7fdd3f310ff47a47c9e5',
      databaseMergeBaseSha: '907f7b6a47b98c401d98184a8b7452aaaa429bbf',
      databaseSchemaSha: '20f56228c21e8e677154c3e77fbf0e243dde677d',
      previousArtifactSha256: '248d1f86addc332d0f5486b2edb8875e87a95929d06c9f59ef51968f90685c1b',
      workspaceBaselineSha: '520b7af67240beb0f08419ab432a018d93542170',
      workspacePinnedDatabaseSha: '1516ad7bb3f74734095756e741f00f60e93b79b3',
    },
    inventoryPath: 'supabase/tests/contracts/public_object_inventory.json',
    inventorySchemaVersion: 'database.public-object-inventory-closure.v1',
    inventorySha256: 'd7353b0b3d2dcd3bcc64ffaf41ff2015729142789e0b3a39818acc12ebf35c16',
    previousInventorySha256: '248d1f86addc332d0f5486b2edb8875e87a95929d06c9f59ef51968f90685c1b',
    objectCount: 393,
    dependencyEdgeCount: 1119,
    contractReady: false,
    snapshotRole: 'immutable-pre-contract-provenance',
    provenanceIssue: 'tiangong-lca/database-engine#353',
    refreshRequiredAfter: null,
  },
  profiles: {
    'legacy-public-v1': {
      phase: 'expand',
      description: 'Explicit compatibility profile for the current public Data API contract.',
    },
    'api-contract-v1': {
      phase: 'contract-preview',
      description:
        'Versioned api profile. It fails closed for capabilities whose public replacement is not frozen.',
    },
  },
  corePublicRelations: CORE_PUBLIC_RELATIONS,
  relationConsumers: DATA_API_RELATION_CONSUMERS,
  views: [],
  rpcs: DATA_API_RPC_TARGETS,
  rpcReplayClassification: DATA_API_RPC_REPLAY_CLASSIFICATION,
  cliRolePolicy: {
    anon: 'deny',
    authenticated: 'allow',
    service_role: 'deny',
  },
  retryPolicy: {
    reads:
      'GET/HEAD and manifest-classified read RPCs permit one auth-refresh replay only after 401/403',
    mutations:
      'no automatic transport retry; recovery must use the capability idempotency/read path',
  },
  blockers: [
    {
      capability: 'rpc:cmd_dataset_alias_plan_guarded',
      targetSchema: 'private',
      reason:
        'database-engine inventory moves the existing signature to private; database-engine#358 has not frozen an authenticated api replacement',
    },
  ],
} as const;

export type ResolvedDataApiCapability = {
  kind: 'relation' | 'rpc';
  name: string;
  schema: 'public' | 'api';
  profile: DataApiProfile;
  role: DataApiRole;
  signature: string | null;
};

function isCorePublicRelation(value: string): value is CorePublicRelation {
  return (CORE_PUBLIC_RELATIONS as readonly string[]).includes(value);
}

function isDataApiRpc(value: string): value is DataApiRpc {
  return Object.hasOwn(DATA_API_RPC_TARGETS, value);
}

export function resolveDataApiProfile(env: NodeJS.ProcessEnv = process.env): DataApiProfile {
  const value = env[DATA_API_PROFILE_ENV]?.trim() || 'legacy-public-v1';
  if ((DATA_API_PROFILES as readonly string[]).includes(value)) {
    return value as DataApiProfile;
  }
  throw new CliError(`Unsupported ${DATA_API_PROFILE_ENV}: ${value}`, {
    code: 'DATA_API_PROFILE_INVALID',
    exitCode: 2,
    details: { supported: DATA_API_PROFILES },
  });
}

function assertCliRole(role: DataApiRole): void {
  if (role !== 'authenticated') {
    throw new CliError(`The CLI Data API adapter does not accept the ${role} role.`, {
      code: 'DATA_API_ROLE_FORBIDDEN',
      exitCode: 2,
      details: { role, allowed_roles: ['authenticated'] },
    });
  }
}

export function resolveDataApiCapability(options: {
  kind: 'relation' | 'rpc';
  name: string;
  env?: NodeJS.ProcessEnv;
  profile?: DataApiProfile;
  role?: DataApiRole;
}): ResolvedDataApiCapability {
  const profile = options.profile ?? resolveDataApiProfile(options.env);
  const role = options.role ?? 'authenticated';
  assertCliRole(role);

  if (options.kind === 'relation') {
    if (!isCorePublicRelation(options.name)) {
      throw new CliError(`Unmanifested Data API relation: ${options.name}`, {
        code: 'DATA_API_CAPABILITY_UNMANIFESTED',
        exitCode: 2,
        details: { kind: options.kind, name: options.name },
      });
    }
    return {
      kind: 'relation',
      name: options.name,
      schema: 'public',
      profile,
      role,
      signature: null,
    };
  }

  if (!isDataApiRpc(options.name)) {
    throw new CliError(`Unmanifested Data API RPC: ${options.name}`, {
      code: 'DATA_API_CAPABILITY_UNMANIFESTED',
      exitCode: 2,
      details: { kind: options.kind, name: options.name },
    });
  }
  const target = DATA_API_RPC_TARGETS[options.name];
  if (profile === 'api-contract-v1' && target.targetSchema !== 'api') {
    throw new CliError(
      `RPC ${options.name} has no frozen authenticated api capability in the pinned database contract.`,
      {
        code: 'DATA_API_CAPABILITY_BLOCKED',
        exitCode: 2,
        details: {
          rpc: options.name,
          current_signature: target.signature,
          target_schema: target.targetSchema,
          dependency: 'tiangong-lca/database-engine#358',
        },
      },
    );
  }
  return {
    kind: 'rpc',
    name: options.name,
    schema: profile === 'api-contract-v1' ? 'api' : 'public',
    profile,
    role,
    signature: target.signature,
  };
}

export function applyDataApiProfileHeaders(
  headers: HeadersInit | undefined,
  capability: ResolvedDataApiCapability,
  method = 'GET',
): Record<string, string> {
  const resolved = new Headers(headers);
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === 'GET' || normalizedMethod === 'HEAD') {
    resolved.set('Accept-Profile', capability.schema);
  } else {
    resolved.set('Content-Profile', capability.schema);
  }
  return Object.fromEntries(resolved.entries());
}

export function resolveDataApiCapabilityFromUrl(options: {
  url: string;
  method?: string;
  env?: NodeJS.ProcessEnv;
  profile?: DataApiProfile;
}): ResolvedDataApiCapability {
  const parsed = new URL(options.url);
  const marker = '/rest/v1/';
  const markerIndex = parsed.pathname.indexOf(marker);
  if (markerIndex < 0) {
    throw new CliError(`URL is not a Supabase Data API route: ${options.url}`, {
      code: 'DATA_API_URL_INVALID',
      exitCode: 2,
    });
  }
  const segments = parsed.pathname
    .slice(markerIndex + marker.length)
    .split('/')
    .filter(Boolean);
  if (segments[0] === 'rpc' && segments[1]) {
    return resolveDataApiCapability({
      kind: 'rpc',
      name: segments[1],
      env: options.env,
      profile: options.profile,
    });
  }
  if (segments[0]) {
    return resolveDataApiCapability({
      kind: 'relation',
      name: segments[0],
      env: options.env,
      profile: options.profile,
    });
  }
  throw new CliError(`Data API URL has no relation or RPC name: ${options.url}`, {
    code: 'DATA_API_URL_INVALID',
    exitCode: 2,
  });
}

export function isDataApiUrl(url: string): boolean {
  return new URL(url).pathname.includes('/rest/v1/');
}

export function buildDataApiUrl(
  restBaseUrl: string,
  capability: Pick<ResolvedDataApiCapability, 'kind' | 'name'>,
): string {
  const base = restBaseUrl.replace(/\/+$/u, '');
  return capability.kind === 'rpc'
    ? `${base}/rpc/${capability.name}`
    : `${base}/${capability.name}`;
}
