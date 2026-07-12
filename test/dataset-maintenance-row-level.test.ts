import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  __testInternals as applyInternals,
  runDatasetMaintenanceApply,
} from '../src/lib/dataset-maintenance-apply.js';
import {
  __testInternals as approveSupportInternals,
  runDatasetMaintenanceApproveSupport,
} from '../src/lib/dataset-maintenance-approve-support.js';
import {
  appendStableJsonLine,
  computePlanSha256,
  isJsonObject,
  maintenanceRowKey,
  normalizeMaintenanceAuditId,
  parseMaintenancePlan,
  parseMaintenanceSupportApprovalRecord,
  parseMaintenanceScope,
  readJsonFile,
  readJsonLinesIfPresent,
  resolveMaintenancePlanArtifactPath,
  safeActionFileName,
  sha256Text,
  snapshotRemoteRow,
  stableJsonText,
  stableJsonValue,
  writeImmutableJson,
  writeImmutableJsonLines,
  type DatasetMaintenancePlan,
  type DatasetMaintenancePlanAction,
  type DatasetMaintenanceProgressEntry,
  type DatasetMaintenanceRemoteRow,
  type DatasetMaintenanceScopeAction,
  type JsonObject,
} from '../src/lib/dataset-maintenance-contract.js';
import {
  __testInternals as planInternals,
  runDatasetMaintenancePlan,
} from '../src/lib/dataset-maintenance-plan.js';
import {
  __testInternals as remoteInternals,
  deleteMaintenanceRow,
  fetchMaintenanceAccountRows,
  fetchMaintenanceExactRows,
  normalizeMaintenancePageSize,
  normalizeMaintenanceTimeout,
  resolveMaintenanceRemoteContext,
  saveDraftMaintenanceRow,
} from '../src/lib/dataset-maintenance-remote.js';
import {
  __testInternals as verifyInternals,
  runDatasetMaintenanceVerify,
} from '../src/lib/dataset-maintenance-verify.js';
import type { FetchLike, ResponseLike } from '../src/lib/http.js';
import {
  buildSupabaseTestEnv,
  isSupabaseAuthTokenUrl,
  makeSupabaseAuthResponse,
} from './helpers/supabase-auth.js';

type StoredRow = Omit<DatasetMaintenanceRemoteRow, 'table'>;

const PASSING_PUBLISH_SCHEMAS = {
  unitgroups: { safeParse: () => ({ success: true as const }) },
  flowproperties: { safeParse: () => ({ success: true as const }) },
};

function jsonResponse(body: unknown, status = 200): ResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string): string | null {
        return name.toLowerCase() === 'content-type' ? 'application/json' : null;
      },
    },
    async text(): Promise<string> {
      return JSON.stringify(body);
    },
  };
}

function processPayload(options: { id: string; version: string; sourceId?: string }): JsonObject {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: { 'common:UUID': options.id },
      },
      ...(options.sourceId
        ? {
            modellingAndValidation: {
              dataSourcesTreatmentAndRepresentativeness: {
                referenceToDataSource: {
                  '@refObjectId': options.sourceId,
                  '@version': '01.00.000',
                  '@type': 'source data set',
                },
              },
            },
          }
        : {}),
      administrativeInformation: {
        publicationAndOwnership: { 'common:dataSetVersion': options.version },
      },
    },
  };
}

function sourcePayload(id: string, version = '01.00.000'): JsonObject {
  return {
    sourceDataSet: {
      sourceInformation: { dataSetInformation: { 'common:UUID': id } },
      administrativeInformation: {
        publicationAndOwnership: { 'common:dataSetVersion': version },
      },
    },
  };
}

function flowPayload(id: string, version = '01.00.000'): JsonObject {
  return {
    flowDataSet: {
      flowInformation: { dataSetInformation: { 'common:UUID': id } },
      administrativeInformation: {
        publicationAndOwnership: { 'common:dataSetVersion': version },
      },
    },
  };
}

function supportReference(type: string): JsonObject {
  return {
    '@refObjectId': '12345678-1234-4123-8123-123456789abc',
    '@type': type,
    '@uri': '../support/12345678-1234-4123-8123-123456789abc.json',
    '@version': '01.00.000',
    'common:shortDescription': { '#text': 'Test support', '@xml:lang': 'en' },
  };
}

function supportDataSetInformation(id: string): JsonObject {
  return {
    'common:UUID': id,
    'common:name': { '#text': 'Test support', '@xml:lang': 'en' },
    classificationInformation: {
      'common:classification': {
        'common:class': { '#text': 'Other', '@classId': '4', '@level': '0' },
      },
    },
  };
}

function supportAdministrativeInformation(id: string, version: string): JsonObject {
  return {
    dataEntryBy: {
      'common:referenceToDataSetFormat': supportReference('source data set'),
      'common:timeStamp': '2026-07-11T00:00:00Z',
    },
    publicationAndOwnership: {
      'common:dataSetVersion': version,
      'common:permanentDataSetURI': `https://example.com/support/${id}`,
      'common:referenceToOwnershipOfDataSet': supportReference('contact data set'),
    },
  };
}

function supportModellingAndValidation(): JsonObject {
  return {
    complianceDeclarations: {
      compliance: {
        'common:approvalOfOverallCompliance': 'Not defined',
        'common:referenceToComplianceSystem': supportReference('source data set'),
      },
    },
  };
}

function unitGroupPayload(id: string, version = '01.00.000'): JsonObject {
  return {
    unitGroupDataSet: {
      '@version': '1.1',
      '@xmlns': 'http://lca.jrc.it/ILCD/UnitGroup',
      '@xmlns:common': 'http://lca.jrc.it/ILCD/Common',
      '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      '@xsi:schemaLocation':
        'http://lca.jrc.it/ILCD/UnitGroup ../../schemas/ILCD_UnitGroupDataSet.xsd',
      unitGroupInformation: {
        dataSetInformation: supportDataSetInformation(id),
        quantitativeReference: { referenceToReferenceUnit: '1' },
      },
      modellingAndValidation: supportModellingAndValidation(),
      administrativeInformation: supportAdministrativeInformation(id, version),
    },
  };
}

function flowPropertyPayload(id: string, version = '01.00.000'): JsonObject {
  return {
    flowPropertyDataSet: {
      '@version': '1.1',
      '@xmlns': 'http://lca.jrc.it/ILCD/FlowProperty',
      '@xmlns:common': 'http://lca.jrc.it/ILCD/Common',
      '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      '@xsi:schemaLocation':
        'http://lca.jrc.it/ILCD/FlowProperty ../../schemas/ILCD_FlowPropertyDataSet.xsd',
      flowPropertiesInformation: {
        dataSetInformation: supportDataSetInformation(id),
        quantitativeReference: {
          referenceToReferenceUnitGroup: supportReference('unit group data set'),
        },
      },
      modellingAndValidation: supportModellingAndValidation(),
      administrativeInformation: supportAdministrativeInformation(id, version),
    },
  };
}

class FakeMaintenanceRemote {
  readonly userId = '11111111-1111-4111-8111-111111111111';
  readonly email = 'owner@example.com';
  readonly reviewerUserId = '77777777-7777-4777-8777-777777777777';
  readonly reviewerEmail = 'reviewer@example.com';
  readonly env: NodeJS.ProcessEnv;
  readonly rows = new Map<string, StoredRow[]>();
  readonly rpcOrder: string[] = [];
  readonly rpcBodies: Record<string, unknown>[] = [];
  readonly publishAuditKeys = new Set<string>();
  readonly approvalAuditIds = new Map<string, string>();
  readonly publishAuditIds = new Map<string, string>();
  activeUserId = this.userId;
  activeEmail = this.email;
  failDeleteOnce = false;
  failPublishResponseAfterCommitOnce = false;
  publishReadbackFailure: 'missing' | 'mismatch' | null = null;
  approvalResponseReviewerOverride: string | null = null;
  approvalResponseReviewerEmailOverride: string | null = null;
  publishResponseReviewerOverride: string | null = null;
  publishResponseReviewerEmailOverride: string | null = null;
  publishResponseReplayOverride: unknown = undefined;
  omitPublishResponseReplay = false;
  proofResponseReviewerOverride: string | null = null;
  proofResponseReviewerEmailOverride: string | null = null;
  proofResponsePublishAuditIdOverride: string | null = null;
  proofVerifiedOverride: boolean | null = null;
  proofTargetFailure: 'missing' | 'mismatch' | null = null;
  proofDataInvalid = false;
  proofReviewerFieldsInvalid = false;
  forcedApprovalAuditId: string | null = null;
  invalidJson = false;

  useOwner(): void {
    this.activeUserId = this.userId;
    this.activeEmail = this.email;
  }

  useReviewer(): void {
    this.activeUserId = this.reviewerUserId;
    this.activeEmail = this.reviewerEmail;
  }

  constructor(label: string) {
    this.env = buildSupabaseTestEnv({
      TIANGONG_LCA_API_BASE_URL: `https://${label}.example.com/functions/v1`,
      TIANGONG_LCA_DISABLE_SESSION_CACHE: '1',
      TIANGONG_LCA_FORCE_REAUTH: '1',
    });
    for (const table of [
      'contacts',
      'sources',
      'flows',
      'processes',
      'lifecyclemodels',
      'unitgroups',
      'flowproperties',
    ]) {
      this.rows.set(table, []);
    }
  }

  add(table: string, id: string, payload: JsonObject, extras: Partial<StoredRow> = {}): void {
    this.rows.get(table)?.push({
      id,
      version: '01.00.000',
      user_id: this.userId,
      state_code: 0,
      modified_at: '2026-07-01T00:00:00.000Z',
      json_ordered: payload,
      model_id: null,
      rule_verification: null,
      ...extras,
    });
  }

  readonly fetch: FetchLike = async (input, init) => {
    const textUrl = String(input);
    if (isSupabaseAuthTokenUrl(textUrl)) {
      return makeSupabaseAuthResponse({ email: this.activeEmail, userId: this.activeUserId });
    }
    if (textUrl.endsWith('/auth/v1/user')) {
      return jsonResponse({ id: this.activeUserId, email: this.activeEmail });
    }
    if (this.invalidJson) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        async text() {
          return '{bad';
        },
      };
    }
    const url = new URL(textUrl);
    const rpc = url.pathname.split('/rpc/')[1];
    if (rpc) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      this.rpcOrder.push(rpc);
      this.rpcBodies.push(body);
      if (rpc === 'cmd_dataset_delete' && this.failDeleteOnce) {
        this.failDeleteOnce = false;
        return jsonResponse({ message: 'injected delete failure' }, 500);
      }
      const table = String(body.p_table);
      const tableRows = this.rows.get(table) ?? [];
      const rowIndex = tableRows.findIndex(
        (row) => row.id === body.p_id && row.version === body.p_version,
      );
      if (rpc === 'cmd_dataset_support_approve_guarded' && rowIndex >= 0) {
        const audit = body.p_audit as Record<string, unknown>;
        const current = tableRows[rowIndex]!;
        const approvalKey = JSON.stringify({
          reviewer_user_id: this.activeUserId,
          reviewer_email: this.activeEmail,
          table,
          id: body.p_id,
          version: body.p_version,
          expected_modified_at: body.p_expected_modified_at,
          expected_json_ordered: body.p_expected_json_ordered,
          plan_sha256: audit.plan_sha256,
          operation_id: audit.operation_id,
          action_id: audit.action_id,
        });
        const prior = this.approvalAuditIds.get(approvalKey);
        const approvalAuditId =
          prior ?? this.forcedApprovalAuditId ?? String(1000 + this.approvalAuditIds.size);
        this.approvalAuditIds.set(approvalKey, approvalAuditId);
        return jsonResponse({
          ok: true,
          data: {
            approval_audit_id: approvalAuditId,
            reviewer_user_id: this.approvalResponseReviewerOverride ?? this.activeUserId,
            reviewer_email: this.approvalResponseReviewerEmailOverride ?? this.activeEmail,
            target_owner_user_id: current.user_id,
            target: current,
          },
          audit_id: approvalAuditId,
          idempotent_replay: Boolean(prior),
        });
      }
      if (rpc === 'qry_dataset_publish_guarded_proof' && rowIndex >= 0) {
        const audit = body.p_audit as Record<string, unknown>;
        const publishKey = JSON.stringify({
          table,
          id: body.p_id,
          version: body.p_version,
          plan_sha256: audit.plan_sha256,
          operation_id: audit.operation_id,
          action_id: audit.action_id,
          approval_audit_id: audit.approval_audit_id,
        });
        const storedPublishAuditId = this.publishAuditIds.get(publishKey);
        const approvalEntry = [...this.approvalAuditIds.entries()].find(
          ([, auditId]) => auditId === String(audit.approval_audit_id),
        );
        const approvalKey = approvalEntry
          ? (JSON.parse(approvalEntry[0]) as Record<string, unknown>)
          : null;
        const proofMatches = Boolean(
          storedPublishAuditId === String(audit.publish_audit_id) &&
          approvalKey &&
          approvalKey.table === table &&
          approvalKey.id === body.p_id &&
          approvalKey.version === body.p_version &&
          approvalKey.plan_sha256 === audit.plan_sha256 &&
          approvalKey.operation_id === audit.operation_id &&
          approvalKey.action_id === audit.action_id &&
          approvalKey.expected_modified_at === body.p_expected_modified_at &&
          JSON.stringify(approvalKey.expected_json_ordered) ===
            JSON.stringify(body.p_expected_json_ordered),
        );
        if (!proofMatches) {
          return jsonResponse({ ok: false, code: 'DATASET_PUBLISH_PROOF_NOT_FOUND' });
        }
        const current = tableRows[rowIndex]!;
        return jsonResponse({
          ok: true,
          data: this.proofDataInvalid
            ? null
            : {
                proof_verified: this.proofVerifiedOverride ?? true,
                publish_audit_id: this.proofResponsePublishAuditIdOverride ?? storedPublishAuditId,
                approval_audit_id: String(audit.approval_audit_id),
                approval_reviewer_user_id: this.proofReviewerFieldsInvalid
                  ? null
                  : (this.proofResponseReviewerOverride ?? approvalKey!.reviewer_user_id),
                approval_reviewer_email: this.proofReviewerFieldsInvalid
                  ? null
                  : (this.proofResponseReviewerEmailOverride ?? approvalKey!.reviewer_email),
                target:
                  this.proofTargetFailure === 'missing'
                    ? null
                    : this.proofTargetFailure === 'mismatch'
                      ? { ...current, state_code: 20 }
                      : current,
              },
        });
      }
      let publishResult: Record<string, unknown> | null = null;
      if (rpc === 'cmd_dataset_delete') {
        if (rowIndex >= 0) {
          tableRows.splice(rowIndex, 1);
        }
      } else if (rpc === 'cmd_dataset_publish_guarded' && rowIndex >= 0) {
        const audit = body.p_audit as Record<string, unknown>;
        const approvalEntry = [...this.approvalAuditIds.entries()].find(
          ([, auditId]) => auditId === String(audit.approval_audit_id),
        );
        const approvalKey = approvalEntry
          ? (JSON.parse(approvalEntry[0]) as Record<string, unknown>)
          : null;
        if (
          !approvalKey ||
          audit.approval_reviewer_user_id !== approvalKey.reviewer_user_id ||
          audit.approval_reviewer_email !== approvalKey.reviewer_email
        ) {
          return jsonResponse({ ok: false, code: 'DATASET_PUBLISH_APPROVAL_REVIEWER_MISMATCH' });
        }
        const auditKey = JSON.stringify({
          table,
          id: body.p_id,
          version: body.p_version,
          plan_sha256: audit.plan_sha256,
          operation_id: audit.operation_id,
          action_id: audit.action_id,
          approval_audit_id: audit.approval_audit_id,
        });
        const current = tableRows[rowIndex]!;
        if (current.state_code === 100) {
          if (!this.publishAuditKeys.has(auditKey)) {
            return jsonResponse({ ok: false, code: 'PUBLISH_REPLAY_UNPROVEN' });
          }
        } else {
          this.publishAuditKeys.add(auditKey);
          if (this.publishReadbackFailure === 'missing') {
            tableRows.splice(rowIndex, 1);
          } else {
            tableRows[rowIndex] = {
              ...current,
              state_code: this.publishReadbackFailure === 'mismatch' ? 20 : 100,
              modified_at: '2026-07-02T00:00:00.000Z',
            };
          }
        }
        const priorPublishAuditId = this.publishAuditIds.get(auditKey);
        const publishAuditId = priorPublishAuditId ?? String(2000 + this.publishAuditIds.size);
        this.publishAuditIds.set(auditKey, publishAuditId);
        if (this.failPublishResponseAfterCommitOnce) {
          this.failPublishResponseAfterCommitOnce = false;
          return jsonResponse({ message: 'response lost after commit' }, 500);
        }
        const approved = [...this.approvalAuditIds.values()].includes(
          String(audit.approval_audit_id),
        );
        publishResult = {
          ok: approved,
          audit_id: publishAuditId,
          approval_audit_id: String(audit.approval_audit_id),
          approval_reviewer_user_id: this.publishResponseReviewerOverride ?? this.reviewerUserId,
          approval_reviewer_email:
            this.publishResponseReviewerEmailOverride ?? approvalKey.reviewer_email,
          ...(!this.omitPublishResponseReplay
            ? {
                idempotent_replay:
                  this.publishResponseReplayOverride === undefined
                    ? Boolean(priorPublishAuditId)
                    : this.publishResponseReplayOverride,
              }
            : {}),
          data: rowIndex >= 0 ? tableRows[rowIndex] : null,
        };
      } else if (rowIndex >= 0) {
        tableRows[rowIndex] = {
          ...tableRows[rowIndex]!,
          json_ordered: body.p_json_ordered as JsonObject,
          model_id: (body.p_model_id as string | null) ?? null,
          rule_verification: (body.p_rule_verification as boolean | null) ?? null,
          modified_at: '2026-07-02T00:00:00.000Z',
        };
      }
      return jsonResponse(
        publishResult ?? {
          ok: true,
          audit: body.p_audit,
          data: rowIndex >= 0 ? tableRows[rowIndex] : null,
        },
      );
    }
    const table = url.pathname.split('/rest/v1/')[1] ?? '';
    let values = [...(this.rows.get(table) ?? [])];
    const id = url.searchParams.get('id')?.replace(/^eq\./u, '');
    const version = url.searchParams.get('version')?.replace(/^eq\./u, '');
    const userId = url.searchParams.get('user_id')?.replace(/^eq\./u, '');
    if (id) values = values.filter((row) => row.id === id);
    if (version) values = values.filter((row) => row.version === version);
    if (userId) values = values.filter((row) => row.user_id === userId);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? values.length);
    return jsonResponse(values.slice(offset, offset + limit));
  };
}

async function approvePublishPlan(options: {
  remote: FakeMaintenanceRemote;
  plan: DatasetMaintenancePlan;
  outDir: string;
  now?: Date;
}): Promise<
  ReturnType<typeof runDatasetMaintenanceApproveSupport> extends Promise<infer T> ? T : never
> {
  options.remote.useReviewer();
  try {
    return await runDatasetMaintenanceApproveSupport({
      planPath: path.join(options.outDir, 'maintenance-plan.json'),
      approvePlan: options.plan.plan_sha256,
      confirm: options.remote.reviewerEmail,
      env: options.remote.env,
      fetchImpl: options.remote.fetch,
      now: options.now,
    });
  } finally {
    options.remote.useOwner();
  }
}

async function buildSinglePublishScenario(options: { root: string; label: string }): Promise<{
  remote: FakeMaintenanceRemote;
  outDir: string;
  plan: DatasetMaintenancePlan;
  now: Date;
}> {
  const remote = new FakeMaintenanceRemote(options.label);
  const id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  remote.add('unitgroups', id, unitGroupPayload(id));
  const scopePath = path.join(options.root, `${options.label}-scope.json`);
  const outDir = path.join(options.root, `${options.label}-maintenance`);
  writeFileSync(
    scopePath,
    JSON.stringify({
      schema_version: 1,
      task_id: options.label,
      operation: 'publish-support',
      account: { user_id: remote.userId, email: remote.email },
      actions: [
        {
          action_id: 'publish-unitgroup',
          action: 'publish',
          table: 'unitgroups',
          id,
          version: '01.00.000',
          expected_user_id: remote.userId,
          expected_state_code: 0,
          reason_code: 'PUBLISH_SUPPORT',
          reason: 'Exercise independent support approval.',
          evidence: [],
        },
      ],
    }),
  );
  const now = new Date('2026-07-11T03:00:00.000Z');
  const plan = await runDatasetMaintenancePlan({
    scopePath,
    operation: 'publish-support',
    outDir,
    env: remote.env,
    fetchImpl: remote.fetch,
    now,
    publishSchemas: PASSING_PUBLISH_SCHEMAS,
  });
  return { remote, outDir, plan, now };
}

function buildScopeFiles(options: {
  root: string;
  remote: FakeMaintenanceRemote;
  includeSave?: boolean;
}): { scopePath: string; desiredPath: string; outDir: string } {
  const desiredPath = path.join(options.root, 'desired-process.json');
  writeFileSync(
    desiredPath,
    JSON.stringify(
      processPayload({ id: '22222222-2222-4222-8222-222222222222', version: '01.00.000' }),
    ),
  );
  const actions: object[] = [
    {
      action_id: 'delete-source',
      action: 'delete',
      table: 'sources',
      id: '33333333-3333-4333-8333-333333333333',
      version: '01.00.000',
      expected_user_id: options.remote.userId,
      expected_state_code: 0,
      reason_code: 'DUPLICATE_SOURCE',
      reason: 'Source is superseded after references are repaired.',
      evidence: ['assessment/source-audit.json'],
    },
  ];
  if (options.includeSave !== false) {
    actions.push({
      action_id: 'repair-process-source',
      action: 'save_draft',
      table: 'processes',
      id: '22222222-2222-4222-8222-222222222222',
      version: '01.00.000',
      expected_user_id: options.remote.userId,
      expected_state_code: 0,
      reason_code: 'REWRITE_SOURCE_REFERENCE',
      reason: 'Remove reference to the superseded source.',
      evidence: ['assessment/source-audit.json'],
      desired_payload_path: path.basename(desiredPath),
    });
  }
  const scopePath = path.join(options.root, 'scope.json');
  writeFileSync(
    scopePath,
    JSON.stringify({
      schema_version: 1,
      task_id: 'bafu-cleanup-test',
      operation: 'repair-references',
      account: { user_id: options.remote.userId, email: options.remote.email },
      actions,
    }),
  );
  return { scopePath, desiredPath, outDir: path.join(options.root, 'maintenance') };
}

function seed(remote: FakeMaintenanceRemote): void {
  remote.add(
    'processes',
    '22222222-2222-4222-8222-222222222222',
    processPayload({
      id: '22222222-2222-4222-8222-222222222222',
      version: '01.00.000',
      sourceId: '33333333-3333-4333-8333-333333333333',
    }),
    { model_id: '44444444-4444-4444-8444-444444444444', rule_verification: true },
  );
  remote.add(
    'sources',
    '33333333-3333-4333-8333-333333333333',
    sourcePayload('33333333-3333-4333-8333-333333333333'),
  );
  remote.add(
    'flows',
    '55555555-5555-4555-8555-555555555555',
    flowPayload('55555555-5555-4555-8555-555555555555'),
  );
}

async function prepareSeededScenario(
  root: string,
  label: string,
): Promise<{
  remote: FakeMaintenanceRemote;
  files: ReturnType<typeof buildScopeFiles>;
  plan: DatasetMaintenancePlan;
  context: Awaited<ReturnType<typeof resolveMaintenanceRemoteContext>>;
}> {
  const scenarioRoot = path.join(root, label);
  mkdirSync(scenarioRoot, { recursive: true });
  const remote = new FakeMaintenanceRemote(label);
  seed(remote);
  const files = buildScopeFiles({ root: scenarioRoot, remote });
  const plan = await runDatasetMaintenancePlan({
    scopePath: files.scopePath,
    operation: 'repair-references',
    outDir: files.outDir,
    env: remote.env,
    fetchImpl: remote.fetch,
    now: new Date('2026-07-11T00:00:00.000Z'),
  });
  const context = await resolveMaintenanceRemoteContext({
    env: remote.env,
    fetchImpl: remote.fetch,
    now: new Date('2026-07-11T00:00:00.000Z'),
  });
  return { remote, files, plan, context };
}

function scopeAction(
  remote: FakeMaintenanceRemote,
  overrides: Record<string, unknown> = {},
): DatasetMaintenanceScopeAction {
  return {
    action_id: 'delete-source',
    action: 'delete',
    table: 'sources',
    id: '33333333-3333-4333-8333-333333333333',
    version: '01.00.000',
    expected_user_id: remote.userId,
    expected_state_code: 0,
    reason_code: 'TEST',
    reason: 'test reason',
    evidence: [],
    ...overrides,
  } as DatasetMaintenanceScopeAction;
}

function scopeValue(
  remote: FakeMaintenanceRemote,
  actions: unknown[] = [scopeAction(remote)],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: 1,
    task_id: 'edge-task',
    operation: 'delete',
    account: { user_id: remote.userId },
    actions,
    ...overrides,
  };
}

function successProgressEntry(
  plan: DatasetMaintenancePlan,
  action: DatasetMaintenancePlanAction,
): DatasetMaintenanceProgressEntry {
  return {
    schema_version: 1,
    plan_sha256: plan.plan_sha256,
    operation_id: plan.operation_id,
    action_id: action.action_id,
    action: action.action,
    table: action.table,
    id: action.id,
    version: action.version,
    reason_code: action.reason_code,
    audit_context: {
      plan_sha256: plan.plan_sha256,
      operation_id: plan.operation_id,
      action_id: action.action_id,
      reason_code: action.reason_code,
      source: 'tiangong-lca dataset maintenance apply',
    },
    actor: { user_id: plan.account.user_id, email: plan.account.email ?? '' },
    started_at_utc: '2026-07-11T00:00:00.000Z',
    ended_at_utc: '2026-07-11T00:00:00.000Z',
    before_sha256: action.before?.row_sha256 ?? '',
    after_sha256: action.desired_payload?.sha256 ?? null,
    remote_result_sha256: 'a'.repeat(64),
    result: 'success',
    error: null,
    rollback: action.rollback,
  };
}

test('row-level maintenance plans update-first closure, resumes failure, and verifies readback', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-maintenance-row-'));
  const remote = new FakeMaintenanceRemote('row-maintenance-main');
  seed(remote);
  const files = buildScopeFiles({ root, remote });
  const now = new Date('2026-07-11T01:02:03.000Z');
  try {
    const plan = await runDatasetMaintenancePlan({
      scopePath: files.scopePath,
      operation: 'repair-references',
      outDir: files.outDir,
      pageSize: 1,
      timeoutMs: 1000,
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.equal(plan.status, 'ready');
    assert.equal(plan.summary.current_reference_impacts, 1);
    assert.equal(plan.summary.projected_reference_impacts, 0);
    assert.equal(plan.summary.protected_rows, 1);
    assert.equal(plan.plan_sha256, computePlanSha256(plan));
    assert.equal(parseMaintenancePlan(plan).plan_sha256, plan.plan_sha256);
    assert.equal(existsSync(path.join(files.outDir, 'maintenance-scope.json')), true);
    assert.equal(existsSync(path.join(files.outDir, 'protected-rows.jsonl')), true);

    remote.failDeleteOnce = true;
    const partial = await runDatasetMaintenanceApply({
      planPath: path.join(files.outDir, 'maintenance-plan.json'),
      commit: true,
      approvePlan: plan.plan_sha256,
      confirm: remote.email,
      timeoutMs: 1000,
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.equal(partial.status, 'completed_with_failures');
    assert.equal(partial.summary.success, 1);
    assert.equal(partial.summary.failed, 1);
    assert.deepEqual(remote.rpcOrder, ['cmd_dataset_save_draft', 'cmd_dataset_delete']);

    const failedVerify = await runDatasetMaintenanceVerify({
      planPath: path.join(files.outDir, 'maintenance-plan.json'),
      outDir: path.join(files.outDir, 'verify-partial'),
      pageSize: 2,
      timeoutMs: 1000,
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.equal(failedVerify.status, 'failed');
    assert.match(failedVerify.issues.map((entry) => entry.code).join(','), /DELETE_TARGET/u);

    const completed = await runDatasetMaintenanceApply({
      planPath: path.join(files.outDir, 'maintenance-plan.json'),
      commit: true,
      approvePlan: plan.plan_sha256,
      confirm: remote.email,
      timeoutMs: 1000,
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.summary.resumed_successes, 1);
    assert.deepEqual(remote.rpcOrder, [
      'cmd_dataset_save_draft',
      'cmd_dataset_delete',
      'cmd_dataset_delete',
    ]);
    const progress = readJsonLinesIfPresent(path.join(files.outDir, 'apply-progress.jsonl'));
    assert.deepEqual(
      progress.map((entry) => (entry as { result: string }).result),
      ['success', 'failed', 'success'],
    );
    const firstProgress = progress[0] as Record<string, unknown>;
    assert.equal(firstProgress.action, 'save_draft');
    assert.equal(firstProgress.reason_code, 'REWRITE_SOURCE_REFERENCE');
    assert.equal(typeof firstProgress.before_sha256, 'string');
    assert.equal(typeof firstProgress.after_sha256, 'string');
    assert.equal(typeof firstProgress.remote_result_sha256, 'string');
    assert.deepEqual(firstProgress.audit_context, {
      plan_sha256: plan.plan_sha256,
      operation_id: plan.operation_id,
      action_id: 'repair-process-source',
      reason_code: 'REWRITE_SOURCE_REFERENCE',
      source: 'tiangong-lca dataset maintenance apply',
    });
    assert.equal(completed.database_audit.rpc_transaction_log, 'public.command_audit_log');
    assert.match(
      readFileSync(path.join(files.outDir, 'approval-record.json'), 'utf8'),
      /plan_sha256/u,
    );

    const verified = await runDatasetMaintenanceVerify({
      planPath: path.join(files.outDir, 'maintenance-plan.json'),
      pageSize: 1,
      timeoutMs: 1000,
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.equal(verified.status, 'passed');
    assert.equal(verified.summary.action_checks_passed, 2);
    assert.equal(verified.summary.protected_checks_passed, 1);
    assert.equal(verified.summary.dangling_deleted_target_references, 0);
    const unexpectedSupportApproval = await runDatasetMaintenanceVerify({
      planPath: path.join(files.outDir, 'maintenance-plan.json'),
      outDir: path.join(files.outDir, 'verify-unexpected-support-approval'),
      supportApprovalPath: path.join(files.outDir, 'unexpected-support-approval.json'),
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.equal(unexpectedSupportApproval.status, 'failed');
    assert.match(
      unexpectedSupportApproval.issues.map((entry) => entry.code).join(','),
      /SUPPORT_APPROVAL_UNEXPECTED/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('support publication plans publish exact FP/UG drafts, resume safely, and verify state', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-maintenance-publish-support-'));
  const remote = new FakeMaintenanceRemote('publish-support');
  const unitGroupId = '66666666-6666-4666-8666-666666666666';
  const flowPropertyId = '77777777-7777-4777-8777-777777777777';
  remote.add('unitgroups', unitGroupId, unitGroupPayload(unitGroupId));
  remote.add('flowproperties', flowPropertyId, flowPropertyPayload(flowPropertyId));
  const scopePath = path.join(root, 'scope.json');
  const outDir = path.join(root, 'maintenance');
  writeFileSync(
    scopePath,
    JSON.stringify({
      schema_version: 1,
      task_id: 'bafu-fpug-publish-test',
      operation: 'publish-support',
      account: { user_id: remote.userId, email: remote.email },
      source_lineage: { workbook_sha256: 'a'.repeat(64), rows: ['1.1', '1.2'] },
      actions: [
        {
          action_id: 'publish-units-time',
          action: 'publish',
          table: 'unitgroups',
          id: unitGroupId,
          version: '01.00.000',
          expected_user_id: remote.userId,
          expected_state_code: 0,
          reason_code: 'FPUG_001_PUBLISH_TARGET',
          reason: 'Publish workbook-authorized latest unit group support.',
          evidence: ['BAFU-AI清洗执行任务.xlsx#FPUG Executable Actions!1.1'],
        },
        {
          action_id: 'publish-time',
          action: 'publish',
          table: 'flowproperties',
          id: flowPropertyId,
          version: '01.00.000',
          expected_user_id: remote.userId,
          expected_state_code: 0,
          reason_code: 'FPUG_002_PUBLISH_TARGET',
          reason: 'Publish workbook-authorized latest flow property support.',
          evidence: ['BAFU-AI清洗执行任务.xlsx#FPUG Executable Actions!1.2'],
        },
      ],
    }),
  );
  const now = new Date('2026-07-11T02:00:00.000Z');
  try {
    const plan = await runDatasetMaintenancePlan({
      scopePath,
      operation: 'publish-support',
      outDir,
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
      publishSchemas: PASSING_PUBLISH_SCHEMAS,
    });
    assert.equal(plan.status, 'ready');
    assert.deepEqual(
      {
        actions: plan.summary.actions,
        save_draft: plan.summary.save_draft,
        delete: plan.summary.delete,
        publish: plan.summary.publish,
        protected_rows: plan.summary.protected_rows,
      },
      { actions: 2, save_draft: 0, delete: 0, publish: 2, protected_rows: 0 },
    );
    assert.deepEqual(
      plan.actions.map((action) => action.rollback.strategy),
      ['manual_review_published_state', 'manual_review_published_state'],
    );
    assert.equal(
      plan.actions.every((action) => action.desired_payload === null),
      true,
    );
    assert.equal(parseMaintenancePlan(plan).operation, 'publish-support');

    const craftedPublishPlan = (
      payload: JsonObject,
      modifiedAt?: string | null,
    ): DatasetMaintenancePlan => {
      const crafted = structuredClone(plan);
      const action = crafted.actions[0]!;
      const before = action.before!;
      const snapshot = snapshotRemoteRow({
        table: before.table,
        id: before.id,
        version: before.version,
        user_id: before.user_id,
        state_code: before.state_code,
        modified_at: modifiedAt === undefined ? before.modified_at : modifiedAt,
        json_ordered: payload,
        model_id: before.model_id,
        rule_verification: before.rule_verification,
      });
      action.before = snapshot;
      action.rollback.before_payload = payload;
      action.rollback.before_payload_sha256 = snapshot.payload_sha256;
      crafted.plan_sha256 = computePlanSha256(crafted);
      return crafted;
    };
    assert.throws(
      () => parseMaintenancePlan(craftedPublishPlan({ unexpected: true })),
      /must pass its TIDAS schema and match the row id\/version/u,
    );
    assert.throws(
      () =>
        parseMaintenancePlan(
          craftedPublishPlan(unitGroupPayload('88888888-8888-4888-8888-888888888888')),
        ),
      /must pass its TIDAS schema and match the row id\/version/u,
    );
    assert.throws(
      () => parseMaintenancePlan(craftedPublishPlan(unitGroupPayload(unitGroupId), null)),
      /requires a frozen modified_at value/u,
    );

    assert.equal(
      approveSupportInternals.canonicalReviewerEmail(' Reviewer@Example.COM '),
      'reviewer@example.com',
    );
    remote.forcedApprovalAuditId = '9999';
    await assert.rejects(
      () => approvePublishPlan({ remote, plan, outDir, now }),
      /audit ids must map one-to-one/u,
    );
    remote.forcedApprovalAuditId = null;
    remote.approvalAuditIds.clear();
    remote.rpcOrder.length = 0;
    remote.rpcBodies.length = 0;
    const supportApproval = await approvePublishPlan({ remote, plan, outDir, now });
    assert.equal(supportApproval.reviewer.user_id, remote.reviewerUserId);
    assert.equal(supportApproval.actions.length, 2);
    assert.equal(supportApproval.authority.local_artifact_is_authority, false);
    assert.throws(
      () => parseMaintenanceSupportApprovalRecord({}, plan),
      /does not match the immutable publish-support plan/u,
    );
    const duplicateApproval = structuredClone(supportApproval);
    duplicateApproval.actions[1]!.action_id = duplicateApproval.actions[0]!.action_id;
    assert.throws(
      () => parseMaintenanceSupportApprovalRecord(duplicateApproval, plan),
      /duplicate or invalid actions/u,
    );
    const mismatchedApproval = structuredClone(supportApproval);
    mismatchedApproval.actions[0]!.expected_payload_sha256 = 'f'.repeat(64);
    assert.throws(
      () => parseMaintenanceSupportApprovalRecord(mismatchedApproval, plan),
      /does not exactly bind action/u,
    );
    const duplicateAuditApproval = structuredClone(supportApproval);
    duplicateAuditApproval.actions[1]!.approval_audit_id =
      duplicateAuditApproval.actions[0]!.approval_audit_id;
    assert.throws(
      () => parseMaintenanceSupportApprovalRecord(duplicateAuditApproval, plan),
      /audit ids must map one-to-one/u,
    );
    const numericApproval = structuredClone(supportApproval);
    (numericApproval.actions[0] as unknown as Record<string, unknown>).approval_audit_id = 123;
    assert.throws(
      () => parseMaintenanceSupportApprovalRecord(numericApproval, plan),
      /positive integer string/u,
    );
    assert.throws(() => normalizeMaintenanceAuditId(456, 'test audit id'));
    assert.throws(() => normalizeMaintenanceAuditId(Number.MAX_SAFE_INTEGER + 1, 'test audit id'));

    const applied = await runDatasetMaintenanceApply({
      planPath: path.join(outDir, 'maintenance-plan.json'),
      commit: true,
      approvePlan: plan.plan_sha256,
      confirm: remote.email,
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.equal(applied.status, 'completed');
    assert.equal(applied.summary.success, 2);
    assert.deepEqual(remote.rpcOrder, [
      'cmd_dataset_support_approve_guarded',
      'cmd_dataset_support_approve_guarded',
      'cmd_dataset_publish_guarded',
      'cmd_dataset_publish_guarded',
    ]);
    assert.equal(remote.rpcBodies[2]?.p_expected_modified_at, '2026-07-01T00:00:00.000Z');
    assert.deepEqual(remote.rpcBodies[2]?.p_expected_json_ordered, unitGroupPayload(unitGroupId));
    assert.deepEqual(remote.rpcBodies[2]?.p_audit, {
      plan_sha256: plan.plan_sha256,
      operation_id: plan.operation_id,
      action_id: 'publish-units-time',
      reason_code: 'FPUG_001_PUBLISH_TARGET',
      source: 'tiangong-lca dataset maintenance apply',
      approval_audit_id: supportApproval.actions[0]?.approval_audit_id,
      approval_reviewer_user_id: supportApproval.reviewer.user_id,
      approval_reviewer_email: supportApproval.reviewer.email,
    });
    assert.deepEqual(
      ['unitgroups', 'flowproperties'].map((table) => remote.rows.get(table)?.[0]?.state_code),
      [100, 100],
    );
    const progress = readJsonLinesIfPresent(path.join(outDir, 'apply-progress.jsonl')) as Array<{
      action: string;
      after_sha256: string | null;
      rollback: { strategy: string };
    }>;
    assert.equal(
      progress.every((entry) => entry.action === 'publish'),
      true,
    );
    assert.equal(
      progress.every((entry) => typeof entry.after_sha256 === 'string'),
      true,
    );
    assert.equal(
      progress.every((entry) => entry.rollback.strategy === 'manual_review_published_state'),
      true,
    );
    assert.equal(
      progress.every(
        (entry) =>
          typeof (entry as { support_approval?: { approval_audit_id?: unknown } }).support_approval
            ?.approval_audit_id === 'string',
      ),
      true,
    );

    const verified = await runDatasetMaintenanceVerify({
      planPath: path.join(outDir, 'maintenance-plan.json'),
      outDir: path.join(outDir, 'verify-passed'),
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.equal(verified.status, 'passed');
    assert.equal(verified.summary.database_publish_proof_checks_passed, 2);
    assert.equal(
      verified.database_publish_proofs.every((entry) => entry.status === 'passed'),
      true,
    );
    assert.deepEqual(
      verified.action_checks.map((check) => check.observed),
      ['published', 'published'],
    );

    const resumed = await runDatasetMaintenanceApply({
      planPath: path.join(outDir, 'maintenance-plan.json'),
      commit: true,
      approvePlan: plan.plan_sha256,
      confirm: remote.email,
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.equal(resumed.status, 'completed');
    assert.equal(resumed.summary.resumed_successes, 2);
    assert.deepEqual(remote.rpcOrder, [
      'cmd_dataset_support_approve_guarded',
      'cmd_dataset_support_approve_guarded',
      'cmd_dataset_publish_guarded',
      'cmd_dataset_publish_guarded',
      'qry_dataset_publish_guarded_proof',
      'qry_dataset_publish_guarded_proof',
    ]);

    remote.rows.get('flowproperties')![0]!.state_code = 20;
    const failed = await runDatasetMaintenanceVerify({
      planPath: path.join(outDir, 'maintenance-plan.json'),
      outDir: path.join(outDir, 'verify-failed'),
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.equal(failed.status, 'failed');
    assert.match(failed.issues.map((entry) => entry.code).join(','), /PUBLISH_READBACK/u);

    const driftContext = await resolveMaintenanceRemoteContext({
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    let driftRows = await fetchMaintenanceAccountRows({
      context: driftContext,
      userId: remote.userId,
    });
    assert.throws(
      () =>
        applyInternals.assertApplyPreconditions({
          plan,
          planDir: outDir,
          currentRows: driftRows.rows,
          progress: applyInternals.parseProgress(
            plan,
            path.join(outDir, 'apply-progress.jsonl'),
            new Map(
              supportApproval.actions.map((action) => [
                action.action_id,
                { action, reviewer: supportApproval.reviewer },
              ]),
            ),
          ),
        }),
      /Previously published row drifted/u,
    );

    remote.rows.get('flowproperties')![0]!.state_code = 100;
    remote.rows.get('flowproperties')![0]!.json_ordered = { unexpected: true };
    driftRows = await fetchMaintenanceAccountRows({
      context: driftContext,
      userId: remote.userId,
    });
    assert.throws(
      () =>
        applyInternals.assertApplyPreconditions({
          plan,
          planDir: outDir,
          currentRows: driftRows.rows,
          progress: applyInternals.parseProgress(plan, path.join(outDir, 'missing-progress.jsonl')),
        }),
      /Unlogged published row differs/u,
    );

    remote.rows.get('flowproperties')!.splice(0, 1);
    const missing = await runDatasetMaintenanceVerify({
      planPath: path.join(outDir, 'maintenance-plan.json'),
      outDir: path.join(outDir, 'verify-missing'),
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.equal(missing.status, 'failed');
    assert.match(missing.issues.map((entry) => entry.code).join(','), /PUBLISH_READBACK/u);

    const invalidApprovalProgress = structuredClone(
      readJsonLinesIfPresent(path.join(outDir, 'apply-progress.jsonl'))[0],
    ) as Record<string, unknown>;
    (invalidApprovalProgress.support_approval as Record<string, unknown>).publish_audit_id =
      'invalid';
    appendStableJsonLine(path.join(outDir, 'apply-progress.jsonl'), invalidApprovalProgress);
    const invalidProgressVerify = await runDatasetMaintenanceVerify({
      planPath: path.join(outDir, 'maintenance-plan.json'),
      outDir: path.join(outDir, 'verify-invalid-approval-progress'),
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.match(
      invalidProgressVerify.issues.map((entry) => entry.code).join(','),
      /APPLY_PROGRESS_ENTRY_INVALID/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('support approval requires an independent reviewer and replays immutable audit bindings', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-maintenance-support-approval-'));
  try {
    const { remote, outDir, plan, now } = await buildSinglePublishScenario({
      root,
      label: 'support-approval-edges',
    });
    const planPath = path.join(outDir, 'maintenance-plan.json');
    const customApprovalPath = path.join(root, 'handoff', 'support-approval.json');

    assert.throws(
      () =>
        approveSupportInternals.assertApprovablePlan(
          { ...plan, operation: 'delete' },
          plan.plan_sha256,
        ),
      /accepts only publish-support/u,
    );
    assert.throws(
      () => approveSupportInternals.assertApprovablePlan(plan, 'wrong'),
      /exactly match/u,
    );
    assert.throws(
      () =>
        approveSupportInternals.assertApprovablePlan(
          { ...plan, status: 'blocked', blockers: [{ code: 'BLOCKED', message: 'blocked' }] },
          plan.plan_sha256,
        ),
      /ready, publish-only/u,
    );
    assert.throws(
      () =>
        approveSupportInternals.assertApprovablePlan(
          {
            ...plan,
            actions: [{ ...plan.actions[0]!, action: 'delete' }],
          },
          plan.plan_sha256,
        ),
      /ready, publish-only/u,
    );
    assert.equal(approveSupportInternals.normalizedTargetRow(plan.actions[0]!, null), null);
    const before = plan.actions[0]!.before!;
    assert.deepEqual(
      approveSupportInternals.normalizedTargetRow(plan.actions[0]!, {
        ...before,
        model_id: 'model',
        rule_verification: true,
      }),
      {
        table: plan.actions[0]!.table,
        id: before.id,
        version: before.version,
        user_id: before.user_id,
        state_code: before.state_code,
        modified_at: before.modified_at,
        json_ordered: before.json_ordered,
        model_id: 'model',
        rule_verification: true,
      },
    );
    assert.equal(typeof approveSupportInternals.clock({} as never), 'string');
    await assert.rejects(
      () =>
        approveSupportInternals.approveAction({
          action: { ...plan.actions[0]!, before: null },
          plan,
          context: {} as never,
        }),
      /missing its frozen snapshot/u,
    );
    await assert.rejects(
      () =>
        runDatasetMaintenanceApproveSupport({
          planPath,
          approvePlan: plan.plan_sha256,
          confirm: remote.email,
          outPath: planPath,
          env: remote.env,
          fetchImpl: remote.fetch,
          now,
        }),
      /cannot overwrite/u,
    );
    await assert.rejects(
      () =>
        runDatasetMaintenanceApproveSupport({
          planPath,
          approvePlan: plan.plan_sha256,
          confirm: 'wrong@example.com',
          outPath: customApprovalPath,
          env: remote.env,
          fetchImpl: remote.fetch,
          now,
        }),
      /authenticated reviewer email/u,
    );
    await assert.rejects(
      () =>
        runDatasetMaintenanceApproveSupport({
          planPath,
          approvePlan: plan.plan_sha256,
          confirm: remote.email,
          outPath: customApprovalPath,
          env: remote.env,
          fetchImpl: remote.fetch,
          now,
        }),
      /cannot approve their own/u,
    );

    remote.useReviewer();
    const reviewerContext = await resolveMaintenanceRemoteContext({
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    await assert.rejects(
      () =>
        approveSupportInternals.approveAction({
          action: plan.actions[0]!,
          plan,
          context: {
            ...reviewerContext,
            fetch_impl: async () =>
              jsonResponse({ ok: true, data: null, audit_id: '1000', idempotent_replay: false }),
          },
        }),
      /audit id/u,
    );
    await assert.rejects(
      () =>
        approveSupportInternals.approveAction({
          action: plan.actions[0]!,
          plan,
          context: {
            ...reviewerContext,
            fetch_impl: async () =>
              jsonResponse({
                ok: true,
                data: {
                  approval_audit_id: '1000',
                  reviewer_user_id: reviewerContext.account.user_id,
                  target_owner_user_id: plan.account.user_id,
                  target: null,
                },
                audit_id: '1000',
                idempotent_replay: false,
              }),
          },
        }),
      /exact reviewer, target, snapshot, and audit binding/u,
    );
    remote.approvalResponseReviewerOverride = remote.userId;
    await assert.rejects(
      () =>
        approveSupportInternals.approveAction({
          action: plan.actions[0]!,
          plan,
          context: reviewerContext,
        }),
      /exact reviewer, target, snapshot, and audit binding/u,
    );
    remote.approvalResponseReviewerOverride = null;
    remote.approvalResponseReviewerEmailOverride = 'forged-reviewer@example.com';
    await assert.rejects(
      () =>
        approveSupportInternals.approveAction({
          action: plan.actions[0]!,
          plan,
          context: reviewerContext,
        }),
      /exact reviewer, target, snapshot, and audit binding/u,
    );
    remote.approvalResponseReviewerEmailOverride = null;
    remote.approvalAuditIds.clear();
    const approved = await runDatasetMaintenanceApproveSupport({
      planPath,
      approvePlan: plan.plan_sha256,
      confirm: remote.reviewerEmail,
      outPath: customApprovalPath,
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    const replayed = await runDatasetMaintenanceApproveSupport({
      planPath,
      approvePlan: plan.plan_sha256,
      confirm: remote.reviewerEmail,
      outPath: customApprovalPath,
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.deepEqual(replayed, approved);

    remote.activeUserId = '99999999-9999-4999-8999-999999999999';
    remote.activeEmail = 'other-reviewer@example.com';
    await assert.rejects(
      () =>
        runDatasetMaintenanceApproveSupport({
          planPath,
          approvePlan: plan.plan_sha256,
          confirm: remote.activeEmail,
          outPath: customApprovalPath,
          env: remote.env,
          fetchImpl: remote.fetch,
          now,
        }),
      /different reviewer/u,
    );

    remote.useReviewer();
    remote.approvalAuditIds.clear();
    remote.forcedApprovalAuditId = '9999';
    await assert.rejects(
      () =>
        runDatasetMaintenanceApproveSupport({
          planPath,
          approvePlan: plan.plan_sha256,
          confirm: remote.reviewerEmail,
          outPath: customApprovalPath,
          env: remote.env,
          fetchImpl: remote.fetch,
          now,
        }),
      /replay does not match/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('publish apply and verify reject missing, malformed, or mismatched approval correlation', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-maintenance-approval-correlation-'));
  try {
    const { remote, outDir, plan, now } = await buildSinglePublishScenario({
      root,
      label: 'approval-correlation',
    });
    const planPath = path.join(outDir, 'maintenance-plan.json');
    await assert.rejects(
      () =>
        runDatasetMaintenanceApply({
          planPath,
          commit: true,
          approvePlan: plan.plan_sha256,
          confirm: remote.email,
          env: remote.env,
          fetchImpl: remote.fetch,
          now,
        }),
      /requires a support approval artifact/u,
    );

    const missingApprovalVerify = await runDatasetMaintenanceVerify({
      planPath,
      outDir: path.join(outDir, 'verify-missing-approval'),
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.match(
      missingApprovalVerify.issues.map((entry) => entry.code).join(','),
      /SUPPORT_APPROVAL_RECORD_MISSING/u,
    );

    const malformedApprovalPath = path.join(root, 'malformed-support-approval.json');
    writeFileSync(malformedApprovalPath, '{}');
    const malformedApprovalVerify = await runDatasetMaintenanceVerify({
      planPath,
      outDir: path.join(outDir, 'verify-malformed-approval'),
      supportApprovalPath: malformedApprovalPath,
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.match(
      malformedApprovalVerify.issues.map((entry) => entry.code).join(','),
      /SUPPORT_APPROVAL_RECORD_INVALID/u,
    );

    const approval = await approvePublishPlan({ remote, plan, outDir, now });
    const loaded = applyInternals.loadSupportApproval({
      plan,
      planDir: outDir,
      supportApprovalPath: path.join(outDir, 'support-approval-record.json'),
    });
    const binding = loaded.byActionId.get(plan.actions[0]!.action_id)!;
    assert.equal(
      applyInternals.progressApprovalMatches({
        value: { audit_context: {}, support_approval: null },
        action: plan.actions[0]!,
        binding: null,
      }),
      false,
    );
    assert.equal(
      applyInternals.progressApprovalMatches({
        value: {
          result: 'success',
          audit_context: { approval_audit_id: binding.action.approval_audit_id },
          support_approval: {
            approval_audit_id: 'invalid',
            reviewer_user_id: approval.reviewer.user_id,
            reviewer_email: approval.reviewer.email,
            publish_audit_id: '2000',
            publish_idempotent_replay: false,
          },
        },
        action: plan.actions[0]!,
        binding,
      }),
      false,
    );

    const context = await resolveMaintenanceRemoteContext({
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    const resetPublishTarget = (): void => {
      const row = remote.rows.get('unitgroups')![0]!;
      row.state_code = 0;
      row.modified_at = '2026-07-01T00:00:00.000Z';
      remote.publishAuditKeys.clear();
      remote.publishAuditIds.clear();
    };
    await assert.rejects(
      () =>
        applyInternals.executeAction({
          action: plan.actions[0]!,
          plan,
          planDir: outDir,
          context,
          supportApproval: {
            action: binding.action,
            reviewer: { ...binding.reviewer, email: 'forged-reviewer@example.com' },
          },
        }),
      /returned an unexpected response/u,
    );
    assert.equal(remote.rows.get('unitgroups')![0]!.state_code, 0);

    remote.publishResponseReviewerOverride = remote.userId;
    await assert.rejects(
      () =>
        applyInternals.executeAction({
          action: plan.actions[0]!,
          plan,
          planDir: outDir,
          context,
          supportApproval: binding,
        }),
      /approval correlation mismatch/u,
    );
    resetPublishTarget();
    remote.publishResponseReviewerOverride = null;
    remote.publishResponseReviewerEmailOverride = 'forged-reviewer@example.com';
    await assert.rejects(
      () =>
        applyInternals.executeAction({
          action: plan.actions[0]!,
          plan,
          planDir: outDir,
          context,
          supportApproval: binding,
        }),
      /approval correlation mismatch/u,
    );
    resetPublishTarget();
    remote.publishResponseReviewerEmailOverride = null;
    remote.omitPublishResponseReplay = true;
    await assert.rejects(
      () =>
        applyInternals.executeAction({
          action: plan.actions[0]!,
          plan,
          planDir: outDir,
          context,
          supportApproval: binding,
        }),
      /did not return an idempotent replay decision/u,
    );
    resetPublishTarget();
    remote.omitPublishResponseReplay = false;
    remote.publishResponseReplayOverride = 'forged';
    await assert.rejects(
      () =>
        applyInternals.executeAction({
          action: plan.actions[0]!,
          plan,
          planDir: outDir,
          context,
          supportApproval: binding,
        }),
      /did not return an idempotent replay decision/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('database proof rejects forged local publish, reviewer, and replay correlation', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-maintenance-database-proof-'));
  try {
    const { remote, outDir, plan, now } = await buildSinglePublishScenario({
      root,
      label: 'database-proof',
    });
    const planPath = path.join(outDir, 'maintenance-plan.json');
    await approvePublishPlan({ remote, plan, outDir, now });
    const applied = await runDatasetMaintenanceApply({
      planPath,
      commit: true,
      approvePlan: plan.plan_sha256,
      confirm: remote.email,
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.equal(applied.status, 'completed');

    const supportPath = path.join(outDir, 'support-approval-record.json');
    const progressPath = path.join(outDir, 'apply-progress.jsonl');
    const commitPath = path.join(outDir, 'commit-report.json');
    const originalSupport = readJsonFile(supportPath, 'support approval') as JsonObject;
    const originalProgress = readJsonLinesIfPresent(progressPath) as JsonObject[];
    const originalCommit = readJsonFile(commitPath, 'commit report') as JsonObject;
    const writeScenario = (options: {
      support?: JsonObject;
      progress?: JsonObject[];
      commit?: JsonObject;
    }): void => {
      writeFileSync(supportPath, `${stableJsonText(options.support ?? originalSupport)}\n`, 'utf8');
      writeFileSync(
        progressPath,
        `${(options.progress ?? originalProgress).map(stableJsonText).join('\n')}\n`,
        'utf8',
      );
      writeFileSync(commitPath, `${stableJsonText(options.commit ?? originalCommit)}\n`, 'utf8');
    };

    writeScenario({ progress: [...originalProgress, structuredClone(originalProgress[0]!)] });
    const duplicateSuccess = await runDatasetMaintenanceVerify({
      planPath,
      outDir: path.join(outDir, 'verify-duplicate-success'),
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.match(
      duplicateSuccess.issues.map((entry) => entry.code).join(','),
      /APPLY_PROGRESS_SUCCESS_DUPLICATE/u,
    );

    const forgedProgress = structuredClone(originalProgress);
    const forgedCommit = structuredClone(originalCommit);
    (forgedProgress[0]!.support_approval as JsonObject).publish_audit_id = '999999';
    ((forgedCommit.actions as JsonObject[])[0]!.support_approval as JsonObject).publish_audit_id =
      '999999';
    writeScenario({ progress: forgedProgress, commit: forgedCommit });
    const forgedPublish = await runDatasetMaintenanceVerify({
      planPath,
      outDir: path.join(outDir, 'verify-forged-publish-audit'),
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.equal(forgedPublish.status, 'failed');
    assert.match(
      forgedPublish.issues.map((entry) => entry.code).join(','),
      /PUBLISH_DATABASE_PROOF_FAILED/u,
    );

    const forgedEmailSupport = structuredClone(originalSupport);
    const forgedEmailProgress = structuredClone(originalProgress);
    const forgedEmailCommit = structuredClone(originalCommit);
    (forgedEmailSupport.reviewer as JsonObject).email = 'forged-reviewer@example.com';
    ((forgedEmailSupport.actions as JsonObject[])[0] as JsonObject).reviewer_email =
      'forged-reviewer@example.com';
    (forgedEmailProgress[0]!.support_approval as JsonObject).reviewer_email =
      'forged-reviewer@example.com';
    (
      (forgedEmailCommit.actions as JsonObject[])[0]!.support_approval as JsonObject
    ).reviewer_email = 'forged-reviewer@example.com';
    writeScenario({
      support: forgedEmailSupport,
      progress: forgedEmailProgress,
      commit: forgedEmailCommit,
    });
    const forgedEmail = await runDatasetMaintenanceVerify({
      planPath,
      outDir: path.join(outDir, 'verify-forged-reviewer-email'),
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.match(
      forgedEmail.issues.map((entry) => entry.code).join(','),
      /PUBLISH_DATABASE_PROOF_MISMATCH/u,
    );

    const forgedReviewerSupport = structuredClone(originalSupport);
    const forgedReviewerProgress = structuredClone(originalProgress);
    const forgedReviewerCommit = structuredClone(originalCommit);
    const forgedReviewerId = '99999999-9999-4999-8999-999999999999';
    (forgedReviewerSupport.reviewer as JsonObject).user_id = forgedReviewerId;
    ((forgedReviewerSupport.actions as JsonObject[])[0] as JsonObject).reviewer_user_id =
      forgedReviewerId;
    (forgedReviewerProgress[0]!.support_approval as JsonObject).reviewer_user_id = forgedReviewerId;
    (
      (forgedReviewerCommit.actions as JsonObject[])[0]!.support_approval as JsonObject
    ).reviewer_user_id = forgedReviewerId;
    writeScenario({
      support: forgedReviewerSupport,
      progress: forgedReviewerProgress,
      commit: forgedReviewerCommit,
    });
    const forgedReviewer = await runDatasetMaintenanceVerify({
      planPath,
      outDir: path.join(outDir, 'verify-forged-reviewer'),
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.match(
      forgedReviewer.issues.map((entry) => entry.code).join(','),
      /PUBLISH_DATABASE_PROOF_MISMATCH/u,
    );

    const missingReplayProgress = structuredClone(originalProgress);
    delete (missingReplayProgress[0]!.support_approval as JsonObject).publish_idempotent_replay;
    writeScenario({ progress: missingReplayProgress });
    const missingReplay = await runDatasetMaintenanceVerify({
      planPath,
      outDir: path.join(outDir, 'verify-missing-replay'),
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.match(
      missingReplay.issues.map((entry) => entry.code).join(','),
      /APPLY_PROGRESS_ENTRY_INVALID/u,
    );

    const wrongReplayCommit = structuredClone(originalCommit);
    const commitCorrelation = (wrongReplayCommit.actions as JsonObject[])[0]!
      .support_approval as JsonObject;
    commitCorrelation.publish_idempotent_replay =
      commitCorrelation.publish_idempotent_replay !== true;
    writeScenario({ commit: wrongReplayCommit });
    const wrongReplay = await runDatasetMaintenanceVerify({
      planPath,
      outDir: path.join(outDir, 'verify-wrong-replay'),
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.match(
      wrongReplay.issues.map((entry) => entry.code).join(','),
      /COMMIT_REPORT_INCOMPLETE/u,
    );

    writeScenario({});
    remote.proofDataInvalid = true;
    const invalidProofData = await runDatasetMaintenanceVerify({
      planPath,
      outDir: path.join(outDir, 'verify-invalid-proof-data'),
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.match(
      invalidProofData.issues.map((entry) => entry.code).join(','),
      /PUBLISH_DATABASE_PROOF_FAILED/u,
    );
    remote.proofDataInvalid = false;

    remote.proofReviewerFieldsInvalid = true;
    const invalidProofReviewer = await runDatasetMaintenanceVerify({
      planPath,
      outDir: path.join(outDir, 'verify-invalid-proof-reviewer'),
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.match(
      invalidProofReviewer.issues.map((entry) => entry.code).join(','),
      /PUBLISH_DATABASE_PROOF_MISMATCH/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('support publication apply rejects missing and mismatched immediate readback', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-maintenance-publish-readback-'));
  try {
    for (const failure of ['missing', 'mismatch'] as const) {
      const scenarioRoot = path.join(root, failure);
      mkdirSync(scenarioRoot, { recursive: true });
      const remote = new FakeMaintenanceRemote(`publish-readback-${failure}`);
      const id = '88888888-8888-4888-8888-888888888888';
      remote.add('unitgroups', id, unitGroupPayload(id));
      const scopePath = path.join(scenarioRoot, 'scope.json');
      const outDir = path.join(scenarioRoot, 'maintenance');
      writeFileSync(
        scopePath,
        JSON.stringify({
          schema_version: 1,
          task_id: `publish-readback-${failure}`,
          operation: 'publish-support',
          account: { user_id: remote.userId, email: remote.email },
          actions: [
            {
              action_id: 'publish-unitgroup',
              action: 'publish',
              table: 'unitgroups',
              id,
              version: '01.00.000',
              expected_user_id: remote.userId,
              expected_state_code: 0,
              reason_code: 'PUBLISH_SUPPORT',
              reason: 'Exercise immediate readback guards.',
              evidence: [],
            },
          ],
        }),
      );
      const now = new Date('2026-07-11T02:30:00.000Z');
      const plan = await runDatasetMaintenancePlan({
        scopePath,
        operation: 'publish-support',
        outDir,
        env: remote.env,
        fetchImpl: remote.fetch,
        now,
        publishSchemas: PASSING_PUBLISH_SCHEMAS,
      });
      const context = await resolveMaintenanceRemoteContext({
        env: remote.env,
        fetchImpl: remote.fetch,
        now,
      });
      await assert.rejects(
        () =>
          applyInternals.executeAction({
            action: plan.actions[0]!,
            plan,
            planDir: outDir,
            context,
          }),
        /lacks an independent support approval/u,
      );
      const supportApproval = await approvePublishPlan({ remote, plan, outDir, now });
      remote.publishReadbackFailure = failure;
      await assert.rejects(
        () =>
          applyInternals.executeAction({
            action: plan.actions[0]!,
            plan,
            planDir: outDir,
            context,
            supportApproval: {
              action: supportApproval.actions[0]!,
              reviewer: supportApproval.reviewer,
            },
          }),
        failure === 'missing' ? /publish readback failed/u : /publish readback mismatch/u,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('support publication safely replays an audit-proven commit after its response is lost', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-maintenance-publish-replay-'));
  const remote = new FakeMaintenanceRemote('publish-replay');
  const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  remote.add('unitgroups', id, unitGroupPayload(id));
  const scopePath = path.join(root, 'scope.json');
  const outDir = path.join(root, 'maintenance');
  writeFileSync(
    scopePath,
    JSON.stringify({
      schema_version: 1,
      task_id: 'publish-replay',
      operation: 'publish-support',
      account: { user_id: remote.userId, email: remote.email },
      actions: [
        {
          action_id: 'publish-unitgroup',
          action: 'publish',
          table: 'unitgroups',
          id,
          version: '01.00.000',
          expected_user_id: remote.userId,
          expected_state_code: 0,
          reason_code: 'PUBLISH_SUPPORT',
          reason: 'Exercise audit-proven idempotent replay.',
          evidence: [],
        },
      ],
    }),
  );
  const now = new Date('2026-07-11T02:45:00.000Z');
  try {
    const plan = await runDatasetMaintenancePlan({
      scopePath,
      operation: 'publish-support',
      outDir,
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
      publishSchemas: PASSING_PUBLISH_SCHEMAS,
    });
    await approvePublishPlan({ remote, plan, outDir, now });
    remote.failPublishResponseAfterCommitOnce = true;
    const uncertain = await runDatasetMaintenanceApply({
      planPath: path.join(outDir, 'maintenance-plan.json'),
      commit: true,
      approvePlan: plan.plan_sha256,
      confirm: remote.email,
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.equal(uncertain.status, 'completed_with_failures');
    assert.equal(uncertain.summary.failed, 1);
    assert.equal(remote.rows.get('unitgroups')?.[0]?.state_code, 100);

    const recovered = await runDatasetMaintenanceApply({
      planPath: path.join(outDir, 'maintenance-plan.json'),
      commit: true,
      approvePlan: plan.plan_sha256,
      confirm: remote.email,
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.equal(recovered.status, 'completed');
    assert.equal(recovered.summary.success, 1);
    assert.deepEqual(remote.rpcOrder, [
      'cmd_dataset_support_approve_guarded',
      'cmd_dataset_publish_guarded',
      'cmd_dataset_publish_guarded',
    ]);
    assert.deepEqual(
      readJsonLinesIfPresent(path.join(outDir, 'apply-progress.jsonl')).map(
        (entry) => (entry as { result: string }).result,
      ),
      ['failed', 'success'],
    );
    const verified = await runDatasetMaintenanceVerify({
      planPath: path.join(outDir, 'maintenance-plan.json'),
      outDir: path.join(outDir, 'verify'),
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    assert.equal(verified.status, 'passed', JSON.stringify(verified.issues));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('support publication planning blocks schema-invalid and misidentified payloads', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-maintenance-publish-validation-'));
  const remote = new FakeMaintenanceRemote('publish-validation');
  const unitGroupId = '99999999-9999-4999-8999-999999999999';
  const flowPropertyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const noModifiedAtId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  remote.add('unitgroups', unitGroupId, {
    unitGroupDataSet: {
      unitGroupInformation: { dataSetInformation: { 'common:UUID': unitGroupId } },
      administrativeInformation: {
        publicationAndOwnership: { 'common:dataSetVersion': '01.00.000' },
      },
    },
  });
  remote.add(
    'flowproperties',
    flowPropertyId,
    flowPropertyPayload('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  );
  remote.add('unitgroups', noModifiedAtId, unitGroupPayload(noModifiedAtId), {
    modified_at: null,
  });

  const writeScope = (options: {
    table: 'unitgroups' | 'flowproperties';
    id: string;
    target: string;
  }): string => {
    const scopePath = path.join(root, `${options.target}.json`);
    writeFileSync(
      scopePath,
      JSON.stringify({
        schema_version: 1,
        task_id: options.target,
        operation: 'publish-support',
        account: { user_id: remote.userId, email: remote.email },
        actions: [
          {
            action_id: options.target,
            action: 'publish',
            table: options.table,
            id: options.id,
            version: '01.00.000',
            expected_user_id: remote.userId,
            expected_state_code: 0,
            reason_code: 'PUBLISH_SUPPORT',
            reason: 'Validate payload before publication.',
            evidence: [],
          },
        ],
      }),
    );
    return scopePath;
  };

  try {
    const schemaBlocked = await runDatasetMaintenancePlan({
      scopePath: writeScope({
        table: 'unitgroups',
        id: unitGroupId,
        target: 'schema-invalid',
      }),
      operation: 'publish-support',
      outDir: path.join(root, 'schema-invalid-plan'),
      env: remote.env,
      fetchImpl: remote.fetch,
    });
    assert.equal(schemaBlocked.status, 'blocked');
    assert.match(
      schemaBlocked.blockers.map((entry) => entry.code).join(','),
      /PUBLISH_PAYLOAD_SCHEMA_INVALID/u,
    );

    const identityBlocked = await runDatasetMaintenancePlan({
      scopePath: writeScope({
        table: 'flowproperties',
        id: flowPropertyId,
        target: 'identity-mismatch',
      }),
      operation: 'publish-support',
      outDir: path.join(root, 'identity-mismatch-plan'),
      env: remote.env,
      fetchImpl: remote.fetch,
      publishSchemas: PASSING_PUBLISH_SCHEMAS,
    });
    assert.equal(identityBlocked.status, 'blocked');
    assert.match(
      identityBlocked.blockers.map((entry) => entry.code).join(','),
      /PUBLISH_PAYLOAD_IDENTITY_MISMATCH/u,
    );
    assert.doesNotMatch(
      identityBlocked.blockers.map((entry) => entry.code).join(','),
      /PUBLISH_PAYLOAD_SCHEMA_INVALID/u,
    );

    const timestampBlocked = await runDatasetMaintenancePlan({
      scopePath: writeScope({
        table: 'unitgroups',
        id: noModifiedAtId,
        target: 'missing-modified-at',
      }),
      operation: 'publish-support',
      outDir: path.join(root, 'missing-modified-at-plan'),
      env: remote.env,
      fetchImpl: remote.fetch,
      publishSchemas: PASSING_PUBLISH_SCHEMAS,
    });
    assert.equal(timestampBlocked.status, 'blocked');
    assert.match(
      timestampBlocked.blockers.map((entry) => entry.code).join(','),
      /PUBLISH_EXPECTED_MODIFIED_AT_MISSING/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('row-level plan blocks a delete with projected inbound references', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-maintenance-blocked-'));
  const remote = new FakeMaintenanceRemote('row-maintenance-blocked');
  seed(remote);
  const files = buildScopeFiles({ root, remote, includeSave: false });
  try {
    const plan = await runDatasetMaintenancePlan({
      scopePath: files.scopePath,
      operation: 'repair-references',
      outDir: files.outDir,
      env: remote.env,
      fetchImpl: remote.fetch,
      now: new Date('2026-07-11T00:00:00.000Z'),
    });
    assert.equal(plan.status, 'blocked');
    assert.equal(plan.summary.projected_reference_impacts, 1);
    assert.match(plan.blockers.map((entry) => entry.code).join(','), /PROJECTED_INBOUND/u);
    await assert.rejects(
      () =>
        runDatasetMaintenanceApply({
          planPath: path.join(files.outDir, 'maintenance-plan.json'),
          commit: true,
          approvePlan: plan.plan_sha256,
          confirm: remote.email,
          env: remote.env,
          fetchImpl: remote.fetch,
        }),
      /Blocked maintenance plan/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('maintenance contracts and remote adapters reject unsafe inputs and invalid responses', async () => {
  const remote = new FakeMaintenanceRemote('row-maintenance-edges');
  seed(remote);
  assert.equal(normalizeMaintenancePageSize(), 1000);
  assert.equal(normalizeMaintenanceTimeout(), 10000);
  assert.throws(() => normalizeMaintenancePageSize(0), /page size/u);
  assert.throws(() => normalizeMaintenancePageSize(5001), /page size/u);
  assert.throws(() => normalizeMaintenanceTimeout(0), /timeout/u);
  assert.equal(safeActionFileName(' / '), sha256Text(' / ').slice(0, 16));
  assert.throws(
    () =>
      parseMaintenanceScope({
        schema_version: 1,
        task_id: 'bad',
        operation: 'delete',
        account: { user_id: remote.userId },
        actions: [
          {
            action_id: 'bad',
            action: 'delete',
            table: 'unitgroups',
            id: 'id',
            version: '01.00.000',
            expected_user_id: remote.userId,
            expected_state_code: 0,
            reason_code: 'bad',
            reason: 'bad',
            evidence: [],
          },
        ],
      }),
    /protected or unsupported/u,
  );
  const publishAction = {
    action_id: 'publish-time',
    action: 'publish',
    table: 'flowproperties',
    id: '77777777-7777-4777-8777-777777777777',
    version: '01.00.000',
    expected_user_id: remote.userId,
    expected_state_code: 0,
    reason_code: 'PUBLISH_SUPPORT',
    reason: 'Publish exact reviewed support.',
    evidence: [],
  };
  assert.equal(
    parseMaintenanceScope({
      schema_version: 1,
      task_id: 'publish-support',
      operation: 'publish-support',
      account: { user_id: remote.userId },
      actions: [publishAction],
    }).actions[0]?.table,
    'flowproperties',
  );
  assert.throws(
    () =>
      parseMaintenanceScope({
        schema_version: 1,
        task_id: 'wrong-operation',
        operation: 'repair-references',
        account: { user_id: remote.userId },
        actions: [publishAction],
      }),
    /cannot contain publish/u,
  );
  assert.throws(
    () =>
      parseMaintenanceScope({
        schema_version: 1,
        task_id: 'wrong-table',
        operation: 'publish-support',
        account: { user_id: remote.userId },
        actions: [{ ...publishAction, table: 'flows' }],
      }),
    /protected or unsupported/u,
  );
  assert.throws(
    () =>
      parseMaintenanceScope({
        schema_version: 1,
        task_id: 'wrong-action',
        operation: 'publish-support',
        account: { user_id: remote.userId },
        actions: [
          {
            ...publishAction,
            action: 'save_draft',
            table: 'flows',
            desired_payload_path: 'payload.json',
          },
        ],
      }),
    /cannot contain save_draft/u,
  );
  assert.throws(
    () =>
      parseMaintenanceScope({
        schema_version: 1,
        task_id: 'publish-payload',
        operation: 'publish-support',
        account: { user_id: remote.userId },
        actions: [{ ...publishAction, desired_payload_path: 'forbidden.json' }],
      }),
    /cannot include desired_payload_path/u,
  );
  assert.throws(
    () =>
      parseMaintenanceScope({
        schema_version: 1,
        task_id: 'unsupported-action',
        operation: 'publish-support',
        account: { user_id: remote.userId },
        actions: [{ ...publishAction, action: 'publish_all' }],
      }),
    /Unsupported maintenance action/u,
  );
  const context = await resolveMaintenanceRemoteContext({
    env: remote.env,
    fetchImpl: remote.fetch,
    timeoutMs: 1000,
  });
  const exact = await fetchMaintenanceExactRows({
    context,
    table: 'sources',
    id: '33333333-3333-4333-8333-333333333333',
    version: '01.00.000',
  });
  assert.equal(exact.rows.length, 1);
  const account = await fetchMaintenanceAccountRows({
    context,
    userId: remote.userId,
    pageSize: 1,
  });
  assert.equal(account.rows.length, 3);
  await saveDraftMaintenanceRow({
    context,
    table: 'processes',
    id: '22222222-2222-4222-8222-222222222222',
    version: '01.00.000',
    payload: processPayload({
      id: '22222222-2222-4222-8222-222222222222',
      version: '01.00.000',
    }),
    modelId: null,
    ruleVerification: false,
    audit: { source: 'test' },
  });
  await deleteMaintenanceRow({
    context,
    table: 'sources',
    id: '33333333-3333-4333-8333-333333333333',
    version: '01.00.000',
    audit: { source: 'test' },
  });

  remote.invalidJson = true;
  await assert.rejects(
    () =>
      fetchMaintenanceExactRows({
        context,
        table: 'flows',
        id: '55555555-5555-4555-8555-555555555555',
        version: '01.00.000',
      }),
    /not valid JSON/u,
  );
  assert.equal(remoteInternals.selectForTable('processes').includes('model_id'), true);
  assert.equal(remoteInternals.selectForTable('flows').includes('model_id'), false);
  assert.equal(remoteInternals.normalizeRemoteRow('flows', null), null);
  assert.equal(remoteInternals.normalizeRemoteRow('flows', { id: '', version: '' }), null);
  assert.deepEqual(
    remoteInternals.normalizeRemoteRow('flows', {
      id: ' id ',
      version: ' 01.00.000 ',
      user_id: 2,
      state_code: '0',
      modified_at: '',
      json_ordered: [],
      model_id: ' ',
      rule_verification: 'no',
    }),
    {
      table: 'flows',
      id: 'id',
      version: '01.00.000',
      user_id: null,
      state_code: 0,
      modified_at: null,
      json_ordered: null,
      model_id: null,
      rule_verification: null,
    },
  );
  assert.equal(
    remoteInternals.normalizeRemoteRow('flows', {
      id: 'id',
      version: '01.00.000',
      state_code: 'bad',
    })?.state_code,
    null,
  );
  assert.throws(() => remoteInternals.normalizeRemoteRows('flows', {}, 'test'), /not an array/u);
  assert.throws(() => remoteInternals.normalizeRemoteRows('flows', [{}], 'test'), /invalid row/u);
  const partialContext = {
    publishable_key: 'key',
    access_token: 'token',
    timeout_ms: 1000,
    fetch_impl: (async () => jsonResponse({}, 500)) as FetchLike,
  };
  await assert.rejects(
    () =>
      remoteInternals.fetchJson({
        context: partialContext,
        url: 'https://example.test/fail',
        label: 'fail',
      }),
    /HTTP 500/u,
  );
  assert.equal(
    await remoteInternals.fetchJson({
      context: {
        ...partialContext,
        fetch_impl: async () => ({
          ...jsonResponse(null),
          async text() {
            return '';
          },
        }),
      },
      url: 'https://example.test/empty',
      label: 'empty',
    }),
    null,
  );

  const fallbackRemote = new FakeMaintenanceRemote('row-maintenance-email-fallback');
  const fallbackContext = await resolveMaintenanceRemoteContext({
    env: fallbackRemote.env,
    fetchImpl: async (input, init) => {
      if (String(input).endsWith('/auth/v1/user')) {
        return jsonResponse({ id: fallbackRemote.userId });
      }
      return fallbackRemote.fetch(input, init);
    },
  });
  assert.equal(fallbackContext.account.email, fallbackRemote.email);
  const invalidUserRemote = new FakeMaintenanceRemote('row-maintenance-invalid-user');
  await assert.rejects(
    () =>
      resolveMaintenanceRemoteContext({
        env: invalidUserRemote.env,
        fetchImpl: async (input, init) =>
          String(input).endsWith('/auth/v1/user')
            ? jsonResponse({ email: invalidUserRemote.email })
            : invalidUserRemote.fetch(input, init),
      }),
    /did not return id and email/u,
  );
  const badRpcContext = {
    ...context,
    fetch_impl: (async (input, init) =>
      String(input).includes('/rpc/')
        ? jsonResponse({ ok: false })
        : remote.fetch(input, init)) as FetchLike,
  };
  await assert.rejects(
    () =>
      deleteMaintenanceRow({
        context: badRpcContext,
        table: 'sources',
        id: 'missing',
        version: '01.00.000',
        audit: {},
      }),
    /unexpected response/u,
  );
});

test('maintenance contract validates every frozen scope guard and immutable artifact edge', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-maintenance-contract-'));
  const remote = new FakeMaintenanceRemote('row-maintenance-contract');
  try {
    assert.equal(isJsonObject({}), true);
    assert.equal(isJsonObject(null), false);
    assert.equal(isJsonObject([]), false);
    assert.deepEqual(stableJsonValue({ z: [2, { b: 1, a: 0 }], a: null }), {
      a: null,
      z: [2, { a: 0, b: 1 }],
    });
    assert.equal(stableJsonText({ b: 1, a: 2 }), '{"a":2,"b":1}');
    assert.equal(
      snapshotRemoteRow({
        table: 'contacts',
        id: 'id',
        version: '01.00.000',
        user_id: null,
        state_code: null,
        modified_at: null,
        json_ordered: null,
        model_id: null,
        rule_verification: null,
      }).payload_sha256,
      null,
    );
    assert.equal(
      maintenanceRowKey({ table: 'flows', id: 'id', version: '01.00.000' }),
      'flows\u0000id\u000001.00.000',
    );

    const invalidScopes: unknown[] = [
      null,
      {},
      scopeValue(remote, [null]),
      scopeValue(remote, [scopeAction(remote, { action: 'publish' })]),
      scopeValue(remote, [scopeAction(remote, { expected_state_code: 100 })]),
      scopeValue(remote, [scopeAction(remote, { expected_user_id: 'other' })]),
      scopeValue(remote, [scopeAction(remote, { evidence: 'no' })]),
      scopeValue(remote, [scopeAction(remote, { action: 'save_draft' })]),
      scopeValue(remote, [scopeAction(remote, { expected_before_sha256: 'bad' })]),
      scopeValue(remote, [scopeAction(remote, { id: ' ' })]),
      scopeValue(remote, [scopeAction(remote)], { operation: 'unsupported' }),
      scopeValue(remote, []),
      scopeValue(remote, [scopeAction(remote), scopeAction(remote)]),
      scopeValue(remote, [
        scopeAction(remote, { action_id: 'one' }),
        scopeAction(remote, { action_id: 'two' }),
      ]),
      scopeValue(remote, [
        scopeAction(remote, { action_id: 'a/b' }),
        scopeAction(remote, {
          action_id: 'a_b',
          id: '66666666-6666-4666-8666-666666666666',
        }),
      ]),
    ];
    for (const invalid of invalidScopes) {
      assert.throws(() => parseMaintenanceScope(invalid));
    }
    assert.throws(
      () => parseMaintenanceScope(scopeValue(remote), 'repair-references'),
      /does not match requested/u,
    );
    const optional = parseMaintenanceScope(
      scopeValue(
        remote,
        [
          scopeAction(remote, {
            action: 'save_draft',
            desired_payload_path: 'payload.json',
            expected_before_sha256: 'a'.repeat(64),
          }),
        ],
        {
          account: { user_id: remote.userId, email: ' OWNER@EXAMPLE.COM ' },
          source_import_run_id: ' run ',
          source_lineage: { manifest: 'redo.json' },
        },
      ),
      'delete',
    );
    assert.equal(optional.account.email, 'OWNER@EXAMPLE.COM');
    assert.equal(optional.source_import_run_id, 'run');
    assert.deepEqual(optional.source_lineage, { manifest: 'redo.json' });

    const jsonPath = path.join(root, 'immutable.json');
    const jsonlPath = path.join(root, 'immutable.jsonl');
    assert.equal(writeImmutableJson(jsonPath, { b: 1, a: 2 }), path.resolve(jsonPath));
    assert.equal(writeImmutableJson(jsonPath, { a: 2, b: 1 }), path.resolve(jsonPath));
    assert.throws(() => writeImmutableJson(jsonPath, { a: 3 }), /immutable/u);
    assert.equal(writeImmutableJsonLines(jsonlPath, []), path.resolve(jsonlPath));
    assert.equal(writeImmutableJsonLines(jsonlPath, []), path.resolve(jsonlPath));
    const appendedPath = path.join(root, 'append.jsonl');
    appendStableJsonLine(appendedPath, { b: 1, a: 2 });
    assert.deepEqual(readJsonLinesIfPresent(appendedPath), [{ a: 2, b: 1 }]);
    assert.deepEqual(readJsonLinesIfPresent(path.join(root, 'missing.jsonl')), []);
    writeFileSync(path.join(root, 'bad.json'), '{bad');
    assert.throws(() => readJsonFile(path.join(root, 'missing.json'), 'Missing'), /not found/u);
    assert.throws(() => readJsonFile(path.join(root, 'bad.json'), 'Bad'), /not valid JSON/u);
    writeFileSync(path.join(root, 'bad.jsonl'), '{}\n{bad\n');
    assert.throws(() => readJsonLinesIfPresent(path.join(root, 'bad.jsonl')), /Invalid/u);
    assert.throws(() => parseMaintenancePlan({}), /valid schema_version/u);
    assert.throws(
      () =>
        parseMaintenancePlan({
          schema_version: 1,
          actions: [],
          protected_rows: [],
          blockers: [],
          account: {},
          artifacts: {},
          plan_sha256: 'bad',
        }),
      /hash does not match/u,
    );
    assert.equal(
      resolveMaintenancePlanArtifactPath(root, 'payloads/action.json', 'Desired payload'),
      path.join(root, 'payloads/action.json'),
    );
    for (const unsafePath of [
      '',
      path.resolve(root, 'absolute.json'),
      '.',
      '..',
      '../escape.json',
    ]) {
      assert.throws(
        () => resolveMaintenancePlanArtifactPath(root, unsafePath, 'Desired payload'),
        /must (?:be a relative path|stay inside)/u,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('maintenance plan parser rejects tampered action, snapshot, summary, and blocker contracts', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-maintenance-plan-contract-'));
  try {
    const scenario = await prepareSeededScenario(root, 'valid-plan');
    const basePlan = structuredClone(scenario.plan);
    const invalidPlan = (
      mutate: (plan: DatasetMaintenancePlan) => void,
      message: RegExp = /invalid|inconsistent|protected or unsupported|does not match|must|unsupported/iu,
    ): void => {
      const plan = structuredClone(basePlan);
      mutate(plan);
      plan.plan_sha256 = computePlanSha256(plan);
      assert.throws(() => parseMaintenancePlan(plan), message);
    };

    const withImportRun = structuredClone(basePlan);
    withImportRun.source_import_run_id = 'bafu-import-run';
    withImportRun.plan_sha256 = computePlanSha256(withImportRun);
    assert.equal(parseMaintenancePlan(withImportRun).source_import_run_id, 'bafu-import-run');

    const legacyV1Plan = structuredClone(basePlan);
    delete legacyV1Plan.summary.publish;
    legacyV1Plan.plan_sha256 = computePlanSha256(legacyV1Plan);
    assert.equal(parseMaintenancePlan(legacyV1Plan).summary.publish, undefined);

    invalidPlan((plan) => Object.assign(plan.actions[0]!, { table: 'unitgroups' }));
    invalidPlan((plan) => Object.assign(plan.actions[0]!, { expected_user_id: 'other-user' }));
    invalidPlan((plan) => Object.assign(plan.actions[0]!, { expected_state_code: 100 }));
    invalidPlan((plan) => Object.assign(plan.actions[0]!, { action: 'publish' }));
    invalidPlan((plan) => Object.assign(plan.actions[0]!, { ordinal: -1 }));
    invalidPlan((plan) => Object.assign(plan.actions[0]!, { status: 'unknown' }));
    invalidPlan((plan) => Object.assign(plan.actions[0]!, { blockers: 'not-an-array' }));
    invalidPlan((plan) => Object.assign(plan.actions[0]!, { rollback: null }));

    invalidPlan((plan) => Object.assign(plan.actions[0]!.before!, { state_code: 100 }));
    invalidPlan((plan) => Object.assign(plan.actions[0]!.before!, { user_id: 'other-user' }));
    invalidPlan((plan) => Object.assign(plan.actions[0]!.before!, { json_ordered: null }));
    invalidPlan((plan) => {
      plan.actions[0]!.before!.row_sha256 = '0'.repeat(64);
    });
    invalidPlan((plan) => Object.assign(plan.actions[0]!.rollback, { strategy: 'unknown' }));
    invalidPlan((plan) =>
      Object.assign(plan.actions[0]!.rollback, { before_payload_sha256: '0'.repeat(64) }),
    );
    invalidPlan((plan) => Object.assign(plan.actions[0]!.rollback, { before_payload: null }));
    invalidPlan((plan) => Object.assign(plan.actions[0]!.rollback, { before_payload: {} }));
    invalidPlan((plan) =>
      Object.assign(plan.actions[0]!.rollback, {
        model_id: '44444444-4444-4444-8444-444444444444',
      }),
    );
    invalidPlan((plan) => Object.assign(plan.actions[0]!.rollback, { rule_verification: true }));
    invalidPlan((plan) => {
      const saveAction = plan.actions.find((action) => action.action === 'save_draft')!;
      saveAction.desired_payload = null;
    });
    invalidPlan((plan) => {
      const deleteAction = plan.actions.find((action) => action.action === 'delete')!;
      deleteAction.desired_payload = { path: 'unexpected.json', sha256: '0'.repeat(64) };
    });

    const summaryMutations: Array<(plan: DatasetMaintenancePlan) => void> = [
      (plan) => {
        plan.summary.actions += 1;
      },
      (plan) => {
        plan.summary.save_draft += 1;
      },
      (plan) => {
        plan.summary.delete += 1;
      },
      (plan) => {
        plan.summary.protected_rows += 1;
      },
      (plan) => {
        plan.summary.blockers += 1;
      },
      (plan) => {
        plan.summary.current_reference_impacts = -1;
      },
      (plan) => {
        plan.summary.current_reference_impacts = 0.5;
      },
      (plan) => {
        plan.summary.projected_reference_impacts = -1;
      },
      (plan) => {
        plan.summary.projected_reference_impacts = 0.5;
      },
    ];
    for (const mutate of summaryMutations) {
      invalidPlan(mutate, /status or blocker contract is inconsistent/u);
    }
    invalidPlan((plan) => {
      plan.status = 'blocked';
    }, /status or blocker contract is inconsistent/u);

    const blocker = {
      code: 'TEST_BLOCKER',
      message: 'test blocker',
      action_id: basePlan.actions[0]!.action_id,
      table: basePlan.actions[0]!.table,
      id: basePlan.actions[0]!.id,
      version: basePlan.actions[0]!.version,
    };
    const validBlockedPlan = structuredClone(basePlan);
    validBlockedPlan.status = 'blocked';
    validBlockedPlan.actions[0]!.status = 'blocked';
    validBlockedPlan.actions[0]!.blockers = [blocker];
    validBlockedPlan.blockers = [blocker];
    validBlockedPlan.summary.blockers = 1;
    validBlockedPlan.plan_sha256 = computePlanSha256(validBlockedPlan);
    assert.equal(parseMaintenancePlan(validBlockedPlan).status, 'blocked');

    const mismatchedBlockers = structuredClone(validBlockedPlan);
    mismatchedBlockers.blockers[0] = {
      ...mismatchedBlockers.blockers[0]!,
      message: 'different global blocker',
    };
    mismatchedBlockers.plan_sha256 = computePlanSha256(mismatchedBlockers);
    assert.throws(
      () => parseMaintenancePlan(mismatchedBlockers),
      /status or blocker contract is inconsistent/u,
    );

    const saveAction = basePlan.actions.find((action) => action.action === 'save_draft')!;
    assert.throws(
      () =>
        applyInternals.loadDesiredPayload(scenario.files.outDir, {
          ...saveAction,
          desired_payload: {
            path: '../escaped-payload.json',
            sha256: saveAction.desired_payload!.sha256,
          },
        }),
      /stay inside/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('maintenance apply guards reject artifact, preflight, approval, and just-in-time drift', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-maintenance-apply-edges-'));
  const remote = new FakeMaintenanceRemote('row-maintenance-apply-edges');
  seed(remote);
  const files = buildScopeFiles({ root, remote });
  const now = new Date('2026-07-11T00:00:00.000Z');
  try {
    const plan = await runDatasetMaintenancePlan({
      scopePath: files.scopePath,
      operation: 'repair-references',
      outDir: files.outDir,
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    const planDir = files.outDir;
    const context = await resolveMaintenanceRemoteContext({
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
    const current = await fetchMaintenanceAccountRows({ context, userId: remote.userId });
    const emptyProgress = applyInternals.parseProgress(plan, path.join(root, 'no-progress.jsonl'));
    const saveAction = plan.actions.find((action) => action.action === 'save_draft')!;
    const deleteAction = plan.actions.find((action) => action.action === 'delete')!;
    assert.throws(
      () =>
        applyInternals.loadSupportApproval({
          plan,
          planDir,
          supportApprovalPath: path.join(root, 'unexpected-support-approval.json'),
        }),
      /valid only for publish-support/u,
    );
    assert.equal(
      applyInternals.progressApprovalMatches({
        value: { audit_context: 'invalid', support_approval: null },
        action: saveAction,
        binding: null,
      }),
      true,
    );

    assert.equal(applyInternals.clock({ now } as never), now.toISOString());
    assert.equal(typeof applyInternals.clock({} as never), 'string');
    assert.equal(applyInternals.errorMessage(new Error('error')), 'error');
    assert.equal(applyInternals.errorMessage('string-error'), 'string-error');
    assert.throws(
      () =>
        applyInternals.loadDesiredPayload(planDir, {
          ...saveAction,
          desired_payload: null,
        }),
      /lacks desired payload/u,
    );
    const wrongPayloadPath = path.join(planDir, 'payloads', 'wrong.json');
    writeFileSync(wrongPayloadPath, '{}');
    assert.throws(
      () =>
        applyInternals.loadDesiredPayload(planDir, {
          ...saveAction,
          desired_payload: { path: 'payloads/wrong.json', sha256: '0'.repeat(64) },
        }),
      /hash mismatch/u,
    );
    const invalidProgressPath = path.join(root, 'invalid-progress.jsonl');
    writeFileSync(invalidProgressPath, '{}\n');
    assert.throws(
      () => applyInternals.parseProgress(plan, invalidProgressPath),
      /invalid or foreign/u,
    );

    assert.throws(
      () =>
        applyInternals.assertApplyPreconditions({
          plan,
          planDir,
          currentRows: [
            ...current.rows,
            {
              ...current.rows[0]!,
              id: '77777777-7777-4777-8777-777777777777',
            },
          ],
          progress: emptyProgress,
        }),
      /Unexpected current-account row/u,
    );
    assert.throws(
      () =>
        applyInternals.assertApplyPreconditions({
          plan,
          planDir,
          currentRows: current.rows.filter((row) => row.table !== 'flows'),
          progress: emptyProgress,
        }),
      /Protected row drifted/u,
    );
    const noBeforePlan = structuredClone(plan);
    noBeforePlan.actions[0]!.before = null;
    assert.throws(
      () =>
        applyInternals.assertApplyPreconditions({
          plan: noBeforePlan,
          planDir,
          currentRows: current.rows.filter((row) => row.table !== 'sources'),
          progress: emptyProgress,
        }),
      /lacks before snapshot/u,
    );
    const deleteSuccessProgress = applyInternals.parseProgress(
      plan,
      path.join(root, 'delete-success.jsonl'),
    );
    deleteSuccessProgress.successes.set(
      deleteAction.action_id,
      successProgressEntry(plan, deleteAction),
    );
    assert.throws(
      () =>
        applyInternals.assertApplyPreconditions({
          plan,
          planDir,
          currentRows: current.rows,
          progress: deleteSuccessProgress,
        }),
      /visible again/u,
    );
    assert.throws(
      () =>
        applyInternals.assertApplyPreconditions({
          plan,
          planDir,
          currentRows: current.rows.filter((row) => row.table !== 'sources'),
          progress: emptyProgress,
        }),
      /missing, non-draft, or not owned/u,
    );
    const saveSuccessProgress = applyInternals.parseProgress(
      plan,
      path.join(root, 'save-success.jsonl'),
    );
    saveSuccessProgress.successes.set(saveAction.action_id, successProgressEntry(plan, saveAction));
    assert.throws(
      () =>
        applyInternals.assertApplyPreconditions({
          plan,
          planDir,
          currentRows: current.rows,
          progress: saveSuccessProgress,
        }),
      /Previously saved row payload drifted/u,
    );
    assert.throws(
      () =>
        applyInternals.assertApplyPreconditions({
          plan,
          planDir,
          currentRows: current.rows.map((row) =>
            row.table === 'sources' ? { ...row, modified_at: 'changed' } : row,
          ),
          progress: emptyProgress,
        }),
      /Pending action row drifted/u,
    );
    const referenceDriftPlan = structuredClone(plan);
    referenceDriftPlan.projected_reference_sha256 = '0'.repeat(64);
    assert.throws(
      () =>
        applyInternals.assertApplyPreconditions({
          plan: referenceDriftPlan,
          planDir,
          currentRows: current.rows,
          progress: emptyProgress,
        }),
      /reference closure drifted/u,
    );
    const approvalPath = path.join(root, 'bad-approval.json');
    writeFileSync(approvalPath, '{}');
    assert.throws(
      () => applyInternals.validateApprovalRecord({ path: approvalPath, plan, context }),
      /does not match/u,
    );
    applyInternals.validateApprovalRecord({
      path: path.join(root, 'missing-approval.json'),
      plan,
      context,
    });

    const processRow = remote.rows.get('processes')!.find((row) => row.id === saveAction.id)!;
    processRow.modified_at = '2026-07-11T00:00:01.000Z';
    await assert.rejects(
      () => applyInternals.executeAction({ action: saveAction, plan, planDir, context }),
      /immediately before write/u,
    );
    assert.equal(remote.rpcOrder.length, 0);
    processRow.modified_at = saveAction.before!.modified_at;

    await assert.rejects(
      () =>
        runDatasetMaintenanceApply({
          planPath: path.join(planDir, 'maintenance-plan.json'),
          commit: false,
          approvePlan: plan.plan_sha256,
          confirm: remote.email,
          env: remote.env,
          fetchImpl: remote.fetch,
        }),
      /requires commit/u,
    );
    await assert.rejects(
      () =>
        runDatasetMaintenanceApply({
          planPath: path.join(planDir, 'maintenance-plan.json'),
          commit: true,
          approvePlan: 'wrong',
          confirm: remote.email,
          env: remote.env,
          fetchImpl: remote.fetch,
        }),
      /exactly match/u,
    );
    await assert.rejects(
      () =>
        runDatasetMaintenanceApply({
          planPath: path.join(planDir, 'maintenance-plan.json'),
          commit: true,
          approvePlan: plan.plan_sha256,
          confirm: 'wrong@example.com',
          env: remote.env,
          fetchImpl: remote.fetch,
        }),
      /confirm must exactly match/u,
    );

    const redoPlan = structuredClone(plan);
    redoPlan.operation = 'redo-import';
    redoPlan.source_import_run_id = null;
    redoPlan.source_lineage = null;
    redoPlan.plan_sha256 = computePlanSha256(redoPlan);
    const redoPath = path.join(root, 'redo-plan.json');
    writeImmutableJson(redoPath, redoPlan);
    await assert.rejects(
      () =>
        runDatasetMaintenanceApply({
          planPath: redoPath,
          commit: true,
          approvePlan: redoPlan.plan_sha256,
          confirm: remote.email,
          env: remote.env,
          fetchImpl: remote.fetch,
        }),
      /requires frozen redo/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('maintenance planning records target visibility, ownership, draft, payload, and identity blockers', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-maintenance-plan-edges-'));
  const now = new Date('2026-07-11T00:00:00.000Z');
  async function planScenario(
    label: string,
    remote: FakeMaintenanceRemote,
    scope: Record<string, unknown>,
    payload?: unknown,
  ): Promise<DatasetMaintenancePlan> {
    const scenario = path.join(root, label);
    mkdirSync(scenario, { recursive: true });
    const scopePath = path.join(scenario, 'scope.json');
    const desiredPath = path.join(scenario, 'desired.json');
    writeFileSync(scopePath, JSON.stringify(scope));
    if (payload !== undefined) writeFileSync(desiredPath, JSON.stringify(payload));
    return runDatasetMaintenancePlan({
      scopePath,
      operation: scope.operation as 'delete' | 'repair-references',
      outDir: path.join(scenario, 'out'),
      env: remote.env,
      fetchImpl: remote.fetch,
      now,
    });
  }
  try {
    const accountRemote = new FakeMaintenanceRemote('plan-account-mismatch');
    await assert.rejects(
      () =>
        planScenario(
          'account',
          accountRemote,
          scopeValue(accountRemote, [scopeAction(accountRemote, { expected_user_id: 'other' })], {
            account: { user_id: 'other' },
          }),
        ),
      /authenticated user does not match/u,
    );
    const emailRemote = new FakeMaintenanceRemote('plan-email-mismatch');
    await assert.rejects(
      () =>
        planScenario(
          'email',
          emailRemote,
          scopeValue(emailRemote, [scopeAction(emailRemote)], {
            account: { user_id: emailRemote.userId, email: 'wrong@example.com' },
          }),
        ),
      /authenticated email does not match/u,
    );

    const missingRemote = new FakeMaintenanceRemote('plan-missing');
    const missing = await planScenario('missing', missingRemote, scopeValue(missingRemote));
    assert.match(missing.blockers.map((entry) => entry.code).join(','), /TARGET_NOT_VISIBLE/u);
    assert.equal(missing.actions[0]?.before, null);

    const duplicateRemote = new FakeMaintenanceRemote('plan-duplicate');
    duplicateRemote.add(
      'sources',
      '33333333-3333-4333-8333-333333333333',
      sourcePayload('33333333-3333-4333-8333-333333333333'),
    );
    duplicateRemote.add(
      'sources',
      '33333333-3333-4333-8333-333333333333',
      sourcePayload('33333333-3333-4333-8333-333333333333'),
    );
    const duplicate = await planScenario('duplicate', duplicateRemote, scopeValue(duplicateRemote));
    assert.match(duplicate.blockers.map((entry) => entry.code).join(','), /TARGET_NOT_UNIQUE/u);

    const protectedRemote = new FakeMaintenanceRemote('plan-protected');
    protectedRemote.add(
      'sources',
      '33333333-3333-4333-8333-333333333333',
      sourcePayload('33333333-3333-4333-8333-333333333333'),
      { user_id: 'other', state_code: 100, json_ordered: null },
    );
    const protectedPlan = await planScenario(
      'protected',
      protectedRemote,
      scopeValue(protectedRemote, [
        scopeAction(protectedRemote, { expected_before_sha256: '0'.repeat(64) }),
      ]),
    );
    const protectedCodes = protectedPlan.blockers.map((entry) => entry.code).join(',');
    assert.match(protectedCodes, /TARGET_OWNER_MISMATCH/u);
    assert.match(protectedCodes, /TARGET_NOT_DRAFT/u);
    assert.match(protectedCodes, /TARGET_PAYLOAD_MISSING/u);
    assert.match(protectedCodes, /EXPECTED_BEFORE_HASH_MISMATCH/u);
    assert.match(protectedCodes, /SNAPSHOT_DRIFT/u);

    const desiredRemote = new FakeMaintenanceRemote('plan-desired');
    desiredRemote.add(
      'processes',
      '22222222-2222-4222-8222-222222222222',
      processPayload({ id: '22222222-2222-4222-8222-222222222222', version: '01.00.000' }),
    );
    const desiredAction = scopeAction(desiredRemote, {
      action_id: 'save',
      action: 'save_draft',
      table: 'processes',
      id: '22222222-2222-4222-8222-222222222222',
      desired_payload_path: 'desired.json',
    });
    await assert.rejects(
      () =>
        planScenario(
          'desired-invalid',
          desiredRemote,
          scopeValue(desiredRemote, [desiredAction]),
          [],
        ),
      /must be a JSON object/u,
    );
    const wrongIdentity = await planScenario(
      'desired-identity',
      desiredRemote,
      scopeValue(desiredRemote, [desiredAction]),
      processPayload({ id: 'wrong-id', version: '01.00.000' }),
    );
    assert.match(
      wrongIdentity.blockers.map((entry) => entry.code).join(','),
      /DESIRED_PAYLOAD_IDENTITY_MISMATCH/u,
    );
    assert.equal(wrongIdentity.protected_rows[0]?.reason, 'blocked_action_row');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('maintenance internals preserve canonical hashes and detect deleted-target references', () => {
  const row: DatasetMaintenanceRemoteRow = {
    table: 'processes',
    id: 'proc',
    version: '01.00.000',
    user_id: 'user',
    state_code: 0,
    modified_at: null,
    json_ordered: processPayload({
      id: 'proc',
      version: '01.00.000',
      sourceId: 'source',
    }),
    model_id: null,
    rule_verification: null,
  };
  const action = {
    action_id: 'delete',
    action: 'delete' as const,
    table: 'sources' as const,
    id: 'source',
    version: '01.00.000',
    expected_user_id: 'user',
    expected_state_code: 0 as const,
    reason_code: 'test',
    reason: 'test',
    evidence: [],
    ordinal: 0,
    status: 'ready' as const,
    before: null,
    desired_payload: null,
    blockers: [],
    rollback: {
      strategy: 'restore_deleted_before_snapshot' as const,
      before_payload_sha256: null,
      before_payload: null,
      model_id: null,
      rule_verification: null,
    },
  };
  assert.equal(snapshotRemoteRow(row).row_sha256.length, 64);
  assert.equal(
    planInternals.referenceImpacts({ rows: [row], deletes: [action], phase: 'current' }).length,
    1,
  );
  assert.equal(
    verifyInternals.deletedTargetReferences({ rows: [row], deletes: [action] }).length,
    1,
  );
  assert.equal(typeof applyInternals.parseProgress, 'function');
});

test('maintenance planning and remote helpers cover sparse references and runtime fallbacks', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-maintenance-plan-fallbacks-'));
  const remote = new FakeMaintenanceRemote('plan-runtime-fallbacks');
  try {
    assert.deepEqual(planInternals.desiredPayloadIdentity({}), { id: null, version: null });

    const unsupportedReferenceRow: DatasetMaintenanceRemoteRow = {
      table: 'processes',
      id: 'unsupported-reference',
      version: '01.00.000',
      user_id: remote.userId,
      state_code: 0,
      modified_at: null,
      json_ordered: {
        processDataSet: {
          customReference: { '@refObjectId': 'source-without-a-table-hint' },
        },
      },
      model_id: null,
      rule_verification: null,
    };
    const deleteAction = scopeAction(remote);
    assert.deepEqual(
      planInternals.referenceImpacts({
        rows: [unsupportedReferenceRow],
        deletes: [deleteAction],
        phase: 'current',
      }),
      [],
    );
    assert.deepEqual(
      verifyInternals.deletedTargetReferences({
        rows: [unsupportedReferenceRow],
        deletes: [
          {
            ...deleteAction,
            ordinal: 0,
            status: 'ready',
            before: null,
            desired_payload: null,
            blockers: [],
            rollback: {
              strategy: 'restore_deleted_before_snapshot',
              before_payload_sha256: null,
              before_payload: null,
              model_id: null,
              rule_verification: null,
            },
          } as DatasetMaintenancePlanAction,
        ],
      }),
      [],
    );

    const referencedRows = ['process-b', 'process-a'].map(
      (id): DatasetMaintenanceRemoteRow => ({
        table: 'processes',
        id,
        version: '01.00.000',
        user_id: remote.userId,
        state_code: 0,
        modified_at: null,
        json_ordered: processPayload({
          id,
          version: '01.00.000',
          sourceId: '33333333-3333-4333-8333-333333333333',
        }),
        model_id: null,
        rule_verification: null,
      }),
    );
    const sortedImpacts = planInternals.referenceImpacts({
      rows: referencedRows,
      deletes: [deleteAction],
      phase: 'current',
    });
    assert.deepEqual(
      sortedImpacts.map((impact) => impact.source_id),
      ['process-a', 'process-b'],
    );

    remote.add(
      'sources',
      '33333333-3333-4333-8333-333333333333',
      sourcePayload('33333333-3333-4333-8333-333333333333'),
    );
    const scopePath = path.join(root, 'scope.json');
    writeFileSync(scopePath, JSON.stringify(scopeValue(remote)));
    const plan = await runDatasetMaintenancePlan({
      scopePath,
      operation: 'delete',
      outDir: path.join(root, 'out'),
      env: remote.env,
      fetchImpl: remote.fetch,
    });
    assert.match(plan.generated_at_utc, /^\d{4}-\d{2}-\d{2}T/u);

    const nonObjectUserRemote = new FakeMaintenanceRemote('non-object-current-user');
    await assert.rejects(
      () =>
        resolveMaintenanceRemoteContext({
          env: nonObjectUserRemote.env,
          fetchImpl: async (input, init) =>
            String(input).endsWith('/auth/v1/user')
              ? jsonResponse([])
              : nonObjectUserRemote.fetch(input, init),
        }),
      /did not return id and email/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('maintenance apply defensively records resume, readback, actor, redo, and pending edges', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-maintenance-apply-defensive-'));
  try {
    const resume = await prepareSeededScenario(root, 'resume-delete');
    const saveAction = resume.plan.actions.find((action) => action.action === 'save_draft')!;
    const deleteAction = resume.plan.actions.find((action) => action.action === 'delete')!;
    const current = await fetchMaintenanceAccountRows({
      context: resume.context,
      userId: resume.remote.userId,
    });
    const resumedProgress = applyInternals.parseProgress(
      resume.plan,
      path.join(root, 'missing-progress.jsonl'),
    );
    resumedProgress.successes.set(
      deleteAction.action_id,
      successProgressEntry(resume.plan, deleteAction),
    );
    applyInternals.assertApplyPreconditions({
      plan: resume.plan,
      planDir: resume.files.outDir,
      currentRows: current.rows.filter((row) => row.table !== 'sources'),
      progress: resumedProgress,
    });

    await assert.rejects(
      () =>
        applyInternals.executeAction({
          action: { ...saveAction, before: null },
          plan: resume.plan,
          planDir: resume.files.outDir,
          context: resume.context,
        }),
      /lacks a before snapshot/u,
    );
    await assert.rejects(
      () =>
        applyInternals.executeAction({
          action: {
            ...saveAction,
            id: 'missing-row',
          },
          plan: resume.plan,
          planDir: resume.files.outDir,
          context: resume.context,
        }),
      /immediately before write/u,
    );

    const fallback = await prepareSeededScenario(root, 'optional-before-metadata');
    const fallbackAction = fallback.plan.actions.find((action) => action.action === 'save_draft')!;
    let beforeReads = 0;
    const actionWithVanishingOptionalMetadata = { ...fallbackAction };
    Object.defineProperty(actionWithVanishingOptionalMetadata, 'before', {
      enumerable: true,
      get() {
        beforeReads += 1;
        return beforeReads <= 2 ? fallbackAction.before : null;
      },
    });
    const fallbackResult = await applyInternals.executeAction({
      action: actionWithVanishingOptionalMetadata,
      plan: fallback.plan,
      planDir: fallback.files.outDir,
      context: fallback.context,
    });
    assert.equal(fallbackResult.afterSha256?.length, 64);
    assert.equal(beforeReads, 4);

    const missingReadback = await prepareSeededScenario(root, 'missing-save-readback');
    const missingReadbackAction = missingReadback.plan.actions.find(
      (action) => action.action === 'save_draft',
    )!;
    const missingReadbackContext = {
      ...missingReadback.context,
      fetch_impl: (async (input, init) => {
        const response = await missingReadback.remote.fetch(input, init);
        if (String(input).includes('/rpc/cmd_dataset_save_draft')) {
          missingReadback.remote.rows.set('processes', []);
        }
        return response;
      }) as FetchLike,
    };
    await assert.rejects(
      () =>
        applyInternals.executeAction({
          action: missingReadbackAction,
          plan: missingReadback.plan,
          planDir: missingReadback.files.outDir,
          context: missingReadbackContext,
        }),
      /save_draft readback failed/u,
    );

    const mismatchReadback = await prepareSeededScenario(root, 'mismatch-save-readback');
    const mismatchAction = mismatchReadback.plan.actions.find(
      (action) => action.action === 'save_draft',
    )!;
    const mismatchContext = {
      ...mismatchReadback.context,
      fetch_impl: (async (input, init) => {
        const response = await mismatchReadback.remote.fetch(input, init);
        if (String(input).includes('/rpc/cmd_dataset_save_draft')) {
          mismatchReadback.remote.rows.get('processes')![0]!.state_code = 100;
        }
        return response;
      }) as FetchLike,
    };
    await assert.rejects(
      () =>
        applyInternals.executeAction({
          action: mismatchAction,
          plan: mismatchReadback.plan,
          planDir: mismatchReadback.files.outDir,
          context: mismatchContext,
        }),
      /save_draft readback mismatch/u,
    );

    const deleteReadback = await prepareSeededScenario(root, 'delete-readback');
    const deleteReadbackAction = deleteReadback.plan.actions.find(
      (action) => action.action === 'delete',
    )!;
    const deleteReadbackContext = {
      ...deleteReadback.context,
      fetch_impl: (async (input, init) =>
        String(input).includes('/rpc/cmd_dataset_delete')
          ? jsonResponse({ ok: true })
          : deleteReadback.remote.fetch(input, init)) as FetchLike,
    };
    await assert.rejects(
      () =>
        applyInternals.executeAction({
          action: deleteReadbackAction,
          plan: deleteReadback.plan,
          planDir: deleteReadback.files.outDir,
          context: deleteReadbackContext,
        }),
      /delete readback failed/u,
    );

    const actorMismatch = await prepareSeededScenario(root, 'actor-mismatch');
    await assert.rejects(
      () =>
        runDatasetMaintenanceApply({
          planPath: path.join(actorMismatch.files.outDir, 'maintenance-plan.json'),
          commit: true,
          approvePlan: actorMismatch.plan.plan_sha256,
          confirm: actorMismatch.remote.email,
          env: actorMismatch.remote.env,
          fetchImpl: async (input, init) =>
            String(input).endsWith('/auth/v1/user')
              ? jsonResponse({ id: actorMismatch.remote.userId, email: 'other@example.com' })
              : actorMismatch.remote.fetch(input, init),
        }),
      /does not match the maintenance plan/u,
    );

    const pending = await prepareSeededScenario(root, 'pending-after-failure');
    const pendingReport = await runDatasetMaintenanceApply({
      planPath: path.join(pending.files.outDir, 'maintenance-plan.json'),
      commit: true,
      approvePlan: pending.plan.plan_sha256,
      confirm: pending.remote.email,
      env: pending.remote.env,
      fetchImpl: async (input, init) =>
        String(input).includes('/rpc/cmd_dataset_save_draft')
          ? jsonResponse({ message: 'save failed' }, 500)
          : pending.remote.fetch(input, init),
    });
    assert.deepEqual(
      pendingReport.actions.map((action) => action.status),
      ['pending', 'failed'],
    );

    const redoRoot = path.join(root, 'redo-delete');
    mkdirSync(redoRoot, { recursive: true });
    const redoRemote = new FakeMaintenanceRemote('redo-delete');
    for (const id of [
      '33333333-3333-4333-8333-333333333333',
      '66666666-6666-4666-8666-666666666666',
    ]) {
      redoRemote.add('sources', id, sourcePayload(id));
    }
    const redoScopePath = path.join(redoRoot, 'scope.json');
    writeFileSync(
      redoScopePath,
      JSON.stringify(
        scopeValue(redoRemote, [
          scopeAction(redoRemote),
          scopeAction(redoRemote, {
            action_id: 'delete-source-2',
            id: '66666666-6666-4666-8666-666666666666',
          }),
        ]),
      ),
    );
    const deletePlan = await runDatasetMaintenancePlan({
      scopePath: redoScopePath,
      operation: 'delete',
      outDir: path.join(redoRoot, 'planned'),
      env: redoRemote.env,
      fetchImpl: redoRemote.fetch,
      now: new Date('2026-07-11T00:00:00.000Z'),
    });
    const redoPlan = structuredClone(deletePlan);
    redoPlan.operation = 'redo-import';
    redoPlan.source_import_run_id = null;
    redoPlan.source_lineage = { manifest: 'bafu-redo-source-manifest.json' };
    redoPlan.plan_sha256 = computePlanSha256(redoPlan);
    const redoPlanPath = path.join(redoRoot, 'apply', 'maintenance-plan.json');
    writeImmutableJson(redoPlanPath, redoPlan);
    const redoReport = await runDatasetMaintenanceApply({
      planPath: redoPlanPath,
      commit: true,
      approvePlan: redoPlan.plan_sha256,
      confirm: redoRemote.email,
      env: redoRemote.env,
      fetchImpl: redoRemote.fetch,
    });
    assert.equal(redoReport.status, 'completed');
    assert.match(
      readFileSync(path.join(path.dirname(redoPlanPath), 'approval-record.json'), 'utf8'),
      /"redo_rows_ready":true/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('maintenance verify reports every incomplete readback proof without mutating rows', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tg-maintenance-verify-defensive-'));
  try {
    const scenario = await prepareSeededScenario(root, 'pre-apply');
    const planPath = path.join(scenario.files.outDir, 'maintenance-plan.json');
    const report = await runDatasetMaintenanceVerify({
      planPath,
      outDir: path.join(root, 'verify-before-apply'),
      env: scenario.remote.env,
      fetchImpl: scenario.remote.fetch,
    });
    const codes = report.issues.map((entry) => entry.code).join(',');
    assert.match(codes, /DELETE_TARGET_STILL_VISIBLE/u);
    assert.match(codes, /SAVE_DRAFT_READBACK_MISMATCH/u);
    assert.match(codes, /PROJECTED_REFERENCE_CLOSURE_MISMATCH/u);
    assert.match(codes, /DELETED_TARGET_REFERENCED/u);
    assert.match(codes, /ACTION_SUCCESS_LOG_MISSING/u);
    assert.match(codes, /COMMIT_REPORT_MISSING/u);

    writeFileSync(path.join(scenario.files.outDir, 'approval-record.json'), '{}');
    const malformedRollbackEntry = {
      ...successProgressEntry(scenario.plan, scenario.plan.actions[0]!),
      rollback: null,
    };
    writeFileSync(
      path.join(scenario.files.outDir, 'apply-progress.jsonl'),
      [
        'null',
        '{"action_id":"foreign-action"}',
        '{"action_id":"delete-source"}',
        JSON.stringify(malformedRollbackEntry),
        '',
      ].join('\n'),
    );
    writeFileSync(path.join(scenario.files.outDir, 'commit-report.json'), '{}');
    const invalidProofReport = await runDatasetMaintenanceVerify({
      planPath,
      outDir: path.join(root, 'verify-invalid-proof-chain'),
      env: scenario.remote.env,
      fetchImpl: scenario.remote.fetch,
      now: new Date('2026-07-11T00:00:00.000Z'),
    });
    const invalidProofCodes = invalidProofReport.issues.map((entry) => entry.code).join(',');
    assert.match(invalidProofCodes, /APPROVAL_RECORD_INVALID/u);
    assert.match(invalidProofCodes, /APPLY_PROGRESS_ENTRY_INVALID/u);
    assert.match(invalidProofCodes, /COMMIT_REPORT_INCOMPLETE/u);

    scenario.remote.rows.set('flows', []);
    scenario.remote.rows.set('processes', []);
    const protectedReport = await runDatasetMaintenanceVerify({
      planPath,
      outDir: path.join(root, 'verify-protected-change'),
      env: scenario.remote.env,
      fetchImpl: scenario.remote.fetch,
      now: new Date('2026-07-11T00:00:00.000Z'),
    });
    assert.match(
      protectedReport.issues.map((entry) => entry.code).join(','),
      /PROTECTED_ROW_CHANGED/u,
    );

    await assert.rejects(
      () =>
        runDatasetMaintenanceVerify({
          planPath,
          env: scenario.remote.env,
          fetchImpl: async (input, init) =>
            String(input).endsWith('/auth/v1/user')
              ? jsonResponse({ id: scenario.remote.userId, email: 'other@example.com' })
              : scenario.remote.fetch(input, init),
        }),
      /does not match the maintenance plan/u,
    );

    assert.deepEqual(verifyInternals.issue('CODE', 'message'), {
      code: 'CODE',
      message: 'message',
    });
    assert.deepEqual(verifyInternals.issue('CODE', 'message', undefined, { detail: true }), {
      code: 'CODE',
      message: 'message',
      details: { detail: true },
    });
    const proofAction = {
      table: 'unitgroups',
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      version: '01.00.000',
    } as DatasetMaintenancePlanAction;
    assert.equal(verifyInternals.normalizeProofTarget(proofAction, null), null);
    assert.deepEqual(
      verifyInternals.normalizeProofTarget(proofAction, {
        id: proofAction.id,
        version: proofAction.version,
        user_id: scenario.remote.userId,
        state_code: 100,
        modified_at: '2026-07-12T00:00:00.000Z',
        json_ordered: { unitGroupDataSet: {} },
        model_id: 'model-1',
        rule_verification: true,
      }),
      {
        table: proofAction.table,
        id: proofAction.id,
        version: proofAction.version,
        user_id: scenario.remote.userId,
        state_code: 100,
        modified_at: '2026-07-12T00:00:00.000Z',
        json_ordered: { unitGroupDataSet: {} },
        model_id: 'model-1',
        rule_verification: true,
      },
    );
    const saveAction = scenario.plan.actions.find((action) => action.action === 'save_draft')!;
    assert.equal(
      verifyInternals.desiredPayload(scenario.files.outDir, {
        ...saveAction,
        desired_payload: null,
      }),
      null,
    );
    const invalidPayloadPath = path.join(scenario.files.outDir, 'payloads', 'invalid.json');
    writeFileSync(invalidPayloadPath, '[]');
    assert.equal(
      verifyInternals.desiredPayload(scenario.files.outDir, {
        ...saveAction,
        desired_payload: {
          path: 'payloads/invalid.json',
          sha256: '0'.repeat(64),
        },
      }),
      null,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
