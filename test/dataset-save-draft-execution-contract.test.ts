import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runDatasetSaveDraft, __testInternals } from '../src/lib/dataset-save-draft-run.js';
import { sha256Json, stableJsonText } from '../src/lib/dataset-maintenance-contract.js';
import type { FetchLike } from '../src/lib/http.js';
import {
  buildSupabaseTestEnv,
  isSupabaseAuthTokenUrl,
  makeSupabaseAuthResponse,
} from './helpers/supabase-auth.js';

type JsonObject = Record<string, unknown>;

function response(body: unknown): Awaited<ReturnType<FetchLike>> {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    text: async () => JSON.stringify(body),
  };
}

function localized(text: string): { '@xml:lang': 'en'; '#text': string } {
  return { '@xml:lang': 'en', '#text': text };
}

function reference(type: string, id: string, version: string): JsonObject {
  return {
    '@type': type,
    '@refObjectId': id,
    '@version': version,
    '@uri': `../datasets/${id}_${version}.xml`,
    'common:shortDescription': localized(id),
  };
}

function flow(id: string, name: string): JsonObject {
  return {
    flowDataSet: {
      '@xmlns': 'http://lca.jrc.it/ILCD/Flow',
      '@xmlns:common': 'http://lca.jrc.it/ILCD/Common',
      '@xmlns:ecn': 'http://eplca.jrc.ec.europa.eu/ILCD/Extensions/2018/ECNumber',
      '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      '@version': '1.1',
      '@locations': '../ILCDLocations.xml',
      '@xsi:schemaLocation': 'http://lca.jrc.it/ILCD/Flow ../../schemas/ILCD_FlowDataSet.xsd',
      flowInformation: {
        dataSetInformation: {
          'common:UUID': id,
          name: {
            baseName: localized(name),
            treatmentStandardsRoutes: localized('not applicable'),
            mixAndLocationTypes: localized('market'),
          },
          classificationInformation: {
            'common:classification': {
              'common:class': { '@level': '0', '@classId': '001', '#text': 'General' },
            },
          },
        },
        quantitativeReference: { referenceToReferenceFlowProperty: '0' },
      },
      modellingAndValidation: {
        LCIMethod: { typeOfDataSet: 'Product flow' },
        complianceDeclarations: {
          compliance: {
            'common:referenceToComplianceSystem': reference(
              'source data set',
              '22222222-2222-2222-2222-222222222222',
              '00.00.001',
            ),
            'common:approvalOfOverallCompliance': 'Not defined',
          },
        },
      },
      administrativeInformation: {
        dataEntryBy: {
          'common:timeStamp': '2026-07-23T00:00:00.000Z',
          'common:referenceToDataSetFormat': reference(
            'source data set',
            '33333333-3333-3333-3333-333333333333',
            '00.00.001',
          ),
        },
        publicationAndOwnership: {
          'common:dataSetVersion': '00.00.001',
          'common:referenceToOwnershipOfDataSet': reference(
            'contact data set',
            '44444444-4444-4444-4444-444444444444',
            '00.00.001',
          ),
        },
      },
      flowProperties: {
        flowProperty: {
          '@dataSetInternalID': '0',
          referenceToFlowPropertyDataSet: reference(
            'flow property data set',
            '55555555-5555-5555-5555-555555555555',
            '00.00.001',
          ),
          meanValue: '1.0',
        },
      },
    },
  };
}

function jwt(userId = 'user-1', email = 'user@example.com'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' }), 'utf8').toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: userId, email }), 'utf8').toString('base64url');
  return `${header}.${payload}.signature`;
}

function jwtWithPayload(payloadValue: unknown): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' }), 'utf8').toString('base64url');
  const payload = Buffer.from(JSON.stringify(payloadValue), 'utf8').toString('base64url');
  return `${header}.${payload}.signature`;
}

function identity(payload: JsonObject): { id: string; version: string } {
  const root = payload.flowDataSet as JsonObject;
  const information = root.flowInformation as JsonObject;
  const dataSetInformation = information.dataSetInformation as JsonObject;
  const admin = root.administrativeInformation as JsonObject;
  const publication = admin.publicationAndOwnership as JsonObject;
  return {
    id: dataSetInformation['common:UUID'] as string,
    version: publication['common:dataSetVersion'] as string,
  };
}

type Behavior = 'success' | 'mutate_then_throw' | 'throw_without_mutation';

function executionFetch(options: {
  state: Map<string, JsonObject>;
  writes: string[];
  behavior?: Map<string, Behavior>;
  userId?: string;
  email?: string;
  missingSources?: boolean;
  rowIdentityOverride?: { id?: string; version?: string };
}): FetchLike {
  const userId = options.userId ?? 'user-1';
  const email = options.email ?? 'user@example.com';
  return async (input, init) => {
    const url = String(input);
    if (isSupabaseAuthTokenUrl(url)) {
      return makeSupabaseAuthResponse({ accessToken: jwt(userId, email), userId, email });
    }
    const parsed = new URL(url);
    const table = parsed.pathname.split('/').at(-1);
    if (parsed.pathname.includes('/functions/v1/app_dataset_')) {
      const body = JSON.parse(String(init?.body)) as {
        id: string;
        version?: string;
        jsonOrdered: JsonObject;
      };
      options.writes.push(body.id);
      const operation = parsed.pathname.endsWith('app_dataset_create') ? 'insert' : 'save_draft';
      const behavior = options.behavior?.get(body.id) ?? 'success';
      if (behavior !== 'throw_without_mutation') {
        options.state.set(body.id, body.jsonOrdered);
      }
      if (behavior !== 'success') {
        throw new Error(`simulated ${operation} response loss`);
      }
      return response({ ok: true, operation });
    }
    if (table === 'flows') {
      const id = parsed.searchParams.get('id')?.replace(/^eq\./u, '') ?? '';
      const payload = options.state.get(id);
      return response(
        payload
          ? [
              {
                ...identity(payload),
                ...options.rowIdentityOverride,
                user_id: userId,
                state_code: 0,
                json_ordered: payload,
              },
            ]
          : [],
      );
    }
    if (table === 'flowproperties') {
      return response([{ id: '55555555-5555-5555-5555-555555555555', version: '00.00.001' }]);
    }
    if (table === 'contacts') {
      return response([{ id: '44444444-4444-4444-4444-444444444444', version: '00.00.001' }]);
    }
    if (table === 'sources') {
      if (options.missingSources) {
        return response([]);
      }
      const id = parsed.searchParams.get('id')?.replace(/^eq\./u, '') ?? '';
      return response([{ id, version: '00.00.001' }]);
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
}

function contract(options: {
  desired: JsonObject[];
  before?: Array<JsonObject | null>;
  dependencies?: string[][];
}): JsonObject {
  return {
    schema_version: 'dataset-save-draft-execution-contract.v1',
    execution_id: 'generic-owner-draft-batch-1',
    project_ref: 'example',
    target_mode: 'owner_draft',
    owner: { user_id: 'user-1', email: 'user@example.com', state_code: 0 },
    actions: options.desired.map((payload, index) => {
      const rowIdentity = identity(payload);
      const before = options.before?.[index] ?? null;
      return {
        action_id: `action-${index + 1}`,
        desired_sha256: sha256Json(payload),
        expected_operation: before ? 'save_draft' : 'insert',
        table: 'flows',
        ...rowIdentity,
        before_sha256: before ? sha256Json(before) : null,
        dependency_action_ids: options.dependencies?.[index] ?? [],
      };
    }),
  };
}

function writeContract(dir: string, value: JsonObject): string {
  const filePath = path.join(dir, 'execution-contract.json');
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return filePath;
}

function executionEnv(dir: string, apiKey: string): NodeJS.ProcessEnv {
  return buildSupabaseTestEnv({
    TIANGONG_LCA_API_KEY: apiKey,
    XDG_STATE_HOME: path.join(dir, 'state'),
  });
}

function ledgerEvent(options: {
  contractSha256: string;
  action: JsonObject;
  sequence: number;
  eventType: 'attempt_emitted' | 'outcome';
  outcome: 'executed' | 'unknown' | null;
  previousEventSha256?: string | null;
}): JsonObject {
  const core = {
    schema_version: 'dataset-save-draft-execution-event.v1',
    sequence: options.sequence,
    contract_sha256: options.contractSha256,
    action_id: options.action.action_id,
    desired_sha256: options.action.desired_sha256,
    action_binding_sha256: __testInternals.executionActionBindingSha256(options.action as never),
    event_type: options.eventType,
    operation: options.action.expected_operation,
    outcome: options.outcome,
    recovered: false,
    recorded_at_utc: '2026-07-23T04:00:00.000Z',
    previous_event_sha256: options.previousEventSha256 ?? null,
  };
  return { ...core, event_sha256: sha256Json(core) };
}

function writeLedgerEvents(filePath: string, events: JsonObject[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${events.map((event) => stableJsonText(event)).join('\n')}\n`, 'utf8');
}

test('execution contract runs ordered insert/update once and skips terminal rows across out dirs', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-execution-contract-success-'));
  const created = flow('11111111-1111-1111-1111-111111111111', 'Created');
  const before = flow('66666666-6666-6666-6666-666666666666', 'Before');
  const desired = flow('66666666-6666-6666-6666-666666666666', 'Desired');
  const state = new Map<string, JsonObject>([[identity(before).id, before]]);
  const writes: string[] = [];
  const fetchImpl = executionFetch({ state, writes });
  const contractPath = writeContract(
    dir,
    contract({
      desired: [created, desired],
      before: [null, before],
      dependencies: [[], ['action-1']],
    }),
  );
  try {
    const first = await runDatasetSaveDraft({
      inputPath: path.join(dir, 'rows.json'),
      rawInput: { rows: [created, desired] },
      type: 'flow',
      outDir: path.join(dir, 'out-1'),
      commit: true,
      executionContractPath: contractPath,
      env: executionEnv(dir, 'success-1'),
      fetchImpl,
      now: new Date('2026-07-23T03:45:00.000Z'),
    });
    assert.equal(first.status, 'completed');
    assert.deepEqual(writes, [identity(created).id, identity(desired).id]);
    assert.deepEqual(
      first.rows.map((row) => [row.status, row.operation]),
      [
        ['executed', 'insert'],
        ['executed', 'save_draft'],
      ],
    );
    assert.equal(first.counts.attempts_consumed, 2);
    const ledgerRoot = first.files.execution_ledger as string;
    const parsedContract = __testInternals.parseExecutionContract(
      contract({
        desired: [created, desired],
        before: [null, before],
        dependencies: [[], ['action-1']],
      }),
    );
    const events = parsedContract.actions.flatMap((action) =>
      readFileSync(__testInternals.executionLedgerPath(ledgerRoot, action), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    );
    assert.deepEqual(
      events.map((event) => [event.event_type, event.outcome]),
      [
        ['attempt_emitted', null],
        ['outcome', 'executed'],
        ['attempt_emitted', null],
        ['outcome', 'executed'],
      ],
    );

    const second = await runDatasetSaveDraft({
      inputPath: path.join(dir, 'rows.json'),
      rawInput: { rows: [created, desired] },
      type: 'flow',
      outDir: path.join(dir, 'out-2'),
      commit: true,
      executionContractPath: contractPath,
      env: executionEnv(dir, 'success-2'),
      fetchImpl,
      now: new Date('2026-07-23T03:46:00.000Z'),
    });
    assert.equal(second.status, 'completed');
    assert.deepEqual(writes, [identity(created).id, identity(desired).id]);
    assert.equal(
      parsedContract.actions.reduce(
        (count, action) =>
          count +
          readFileSync(__testInternals.executionLedgerPath(ledgerRoot, action), 'utf8')
            .trim()
            .split('\n').length,
        0,
      ),
      4,
    );

    const copiedDir = path.join(dir, 'copied-contract');
    mkdirSync(copiedDir);
    const copiedContractPath = writeContract(copiedDir, parsedContract as unknown as JsonObject);
    await runDatasetSaveDraft({
      inputPath: path.join(dir, 'rows.json'),
      rawInput: { rows: [created, desired] },
      type: 'flow',
      outDir: path.join(dir, 'out-3'),
      commit: true,
      executionContractPath: copiedContractPath,
      env: executionEnv(dir, 'success-3'),
      fetchImpl,
    });
    assert.deepEqual(writes, [identity(created).id, identity(desired).id]);

    state.set(identity(created).id, flow(identity(created).id, 'Later drift'));
    const driftedTerminal = await runDatasetSaveDraft({
      inputPath: path.join(dir, 'rows.json'),
      rawInput: { rows: [created, desired] },
      type: 'flow',
      outDir: path.join(dir, 'out-4'),
      commit: true,
      executionContractPath: contractPath,
      env: executionEnv(dir, 'success-4'),
      fetchImpl,
    });
    assert.equal(driftedTerminal.status, 'completed_with_unknowns');
    assert.equal(driftedTerminal.rows[0]?.status, 'unknown');
    assert.match(driftedTerminal.rows[0]?.error?.message ?? '', /no longer has exact desired/u);
    assert.equal(driftedTerminal.rows[1]?.status, 'executed');
    assert.deepEqual(writes, [identity(created).id, identity(desired).id]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('execution contract recovers lost success, terminalizes unknown, blocks dependents, and continues independent rows', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-execution-contract-recovery-'));
  const lostSuccess = flow('11111111-1111-1111-1111-111111111111', 'Lost success');
  const unknown = flow('66666666-6666-6666-6666-666666666666', 'Unknown');
  const dependent = flow('77777777-7777-7777-7777-777777777777', 'Dependent');
  const independent = flow('88888888-8888-8888-8888-888888888888', 'Independent');
  const state = new Map<string, JsonObject>();
  const writes: string[] = [];
  const behavior = new Map<string, Behavior>([
    [identity(lostSuccess).id, 'mutate_then_throw'],
    [identity(unknown).id, 'throw_without_mutation'],
  ]);
  const fetchImpl = executionFetch({ state, writes, behavior });
  const contractPath = writeContract(
    dir,
    contract({
      desired: [lostSuccess, unknown, dependent, independent],
      dependencies: [[], [], ['action-2'], []],
    }),
  );
  try {
    const report = await runDatasetSaveDraft({
      inputPath: path.join(dir, 'rows.json'),
      rawInput: { rows: [lostSuccess, unknown, dependent, independent] },
      type: 'flow',
      outDir: path.join(dir, 'out'),
      commit: true,
      executionContractPath: contractPath,
      env: executionEnv(dir, 'recovery-1'),
      fetchImpl,
      now: new Date('2026-07-23T03:47:00.000Z'),
    });
    assert.equal(report.status, 'completed_with_unknowns');
    assert.deepEqual(
      report.rows.map((row) => [row.status, row.operation]),
      [
        ['executed', 'recovered_exact_readback'],
        ['unknown', 'insert'],
        ['blocked', 'blocked_dependency'],
        ['executed', 'insert'],
      ],
    );
    assert.deepEqual(writes, [
      identity(lostSuccess).id,
      identity(unknown).id,
      identity(independent).id,
    ]);
    assert.equal(report.counts.attempts_consumed, 3);

    behavior.clear();
    await runDatasetSaveDraft({
      inputPath: path.join(dir, 'rows.json'),
      rawInput: { rows: [lostSuccess, unknown, dependent, independent] },
      type: 'flow',
      outDir: path.join(dir, 'out-restart'),
      commit: true,
      executionContractPath: contractPath,
      env: executionEnv(dir, 'recovery-2'),
      fetchImpl,
      now: new Date('2026-07-23T03:48:00.000Z'),
    });
    assert.deepEqual(writes, [
      identity(lostSuccess).id,
      identity(unknown).id,
      identity(independent).id,
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('execution contract rejects local drift and owner/project mismatch before emission', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-execution-contract-drift-'));
  const before = flow('11111111-1111-1111-1111-111111111111', 'Before');
  const desired = flow('11111111-1111-1111-1111-111111111111', 'Desired');
  const state = new Map<string, JsonObject>([
    [identity(before).id, flow(identity(before).id, 'Drifted')],
  ]);
  const writes: string[] = [];
  const contractPath = writeContract(dir, contract({ desired: [desired], before: [before] }));
  try {
    const drift = await runDatasetSaveDraft({
      inputPath: path.join(dir, 'rows.json'),
      rawInput: { rows: [desired] },
      type: 'flow',
      outDir: path.join(dir, 'out'),
      commit: true,
      executionContractPath: contractPath,
      env: executionEnv(dir, 'drift-1'),
      fetchImpl: executionFetch({ state, writes }),
      now: new Date('2026-07-23T03:49:00.000Z'),
    });
    assert.equal(drift.status, 'completed_with_failures');
    assert.equal(drift.rows[0]?.attempt_consumed, false);
    assert.deepEqual(writes, []);

    state.set(identity(before).id, before);
    const wrongIdentity = await runDatasetSaveDraft({
      inputPath: path.join(dir, 'rows.json'),
      rawInput: { rows: [desired] },
      type: 'flow',
      outDir: path.join(dir, 'wrong-readback-identity'),
      commit: true,
      executionContractPath: contractPath,
      env: executionEnv(dir, 'drift-identity'),
      fetchImpl: executionFetch({
        state,
        writes,
        rowIdentityOverride: { id: 'wrong-id' },
      }),
    });
    assert.equal(wrongIdentity.status, 'completed_with_failures');
    assert.equal(wrongIdentity.rows[0]?.attempt_consumed, false);
    assert.deepEqual(writes, []);

    const wrongVersion = await runDatasetSaveDraft({
      inputPath: path.join(dir, 'rows.json'),
      rawInput: { rows: [desired] },
      type: 'flow',
      outDir: path.join(dir, 'wrong-readback-version'),
      commit: true,
      executionContractPath: contractPath,
      env: executionEnv(dir, 'drift-version'),
      fetchImpl: executionFetch({
        state,
        writes,
        rowIdentityOverride: { version: '99.99.999' },
      }),
    });
    assert.equal(wrongVersion.status, 'completed_with_failures');
    assert.equal(wrongVersion.rows[0]?.attempt_consumed, false);
    assert.deepEqual(writes, []);

    await assert.rejects(
      () =>
        runDatasetSaveDraft({
          inputPath: path.join(dir, 'rows.json'),
          rawInput: { rows: [desired] },
          type: 'flow',
          outDir: path.join(dir, 'wrong-owner'),
          commit: true,
          executionContractPath: contractPath,
          env: executionEnv(dir, 'drift-2'),
          fetchImpl: executionFetch({ state, writes, userId: 'other-user' }),
        }),
      /Owner session or project does not match/u,
    );
    assert.deepEqual(writes, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('execution contract recovers an orphan attempt and terminalizes a readback failure without replay', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-execution-contract-orphan-'));
  const desired = flow('11111111-1111-1111-1111-111111111111', 'Desired');
  const state = new Map<string, JsonObject>([[identity(desired).id, desired]]);
  const writes: string[] = [];
  const contractValue = contract({ desired: [desired] });
  const contractPath = writeContract(dir, contractValue);
  const parsedContract = __testInternals.parseExecutionContract(contractValue);
  const action = parsedContract.actions[0]!;
  const env = executionEnv(dir, 'orphan-1');
  const ledgerRoot = __testInternals.executionLedgerRoot(env, parsedContract);
  const attempt = ledgerEvent({
    contractSha256: sha256Json(parsedContract),
    action: action as unknown as JsonObject,
    sequence: 1,
    eventType: 'attempt_emitted',
    outcome: null,
  });
  writeLedgerEvents(__testInternals.executionLedgerPath(ledgerRoot, action), [attempt]);
  try {
    const recovered = await runDatasetSaveDraft({
      inputPath: path.join(dir, 'rows.json'),
      rawInput: { rows: [desired] },
      type: 'flow',
      outDir: path.join(dir, 'recovered'),
      commit: true,
      executionContractPath: contractPath,
      env,
      fetchImpl: executionFetch({ state, writes }),
    });
    assert.equal(recovered.status, 'completed');
    assert.equal(recovered.rows[0]?.operation, 'recovered_exact_readback');
    assert.deepEqual(writes, []);

    const readbackDir = path.join(dir, 'readback-failure');
    mkdirSync(readbackDir);
    const readbackDesired = flow('66666666-6666-6666-6666-666666666666', 'Readback failure');
    const readbackState = new Map<string, JsonObject>();
    const readbackWrites: string[] = [];
    const readbackContractPath = writeContract(
      readbackDir,
      contract({ desired: [readbackDesired] }),
    );
    const baseFetch = executionFetch({ state: readbackState, writes: readbackWrites });
    let dispatched = false;
    const fetchImpl: FetchLike = async (input, init) => {
      const url = String(input);
      if (url.includes('/functions/v1/app_dataset_')) {
        const result = await baseFetch(input, init);
        dispatched = true;
        return result;
      }
      if (dispatched && new URL(url).pathname.endsWith('/flows')) {
        throw new Error('simulated readback loss');
      }
      return baseFetch(input, init);
    };
    const unknown = await runDatasetSaveDraft({
      inputPath: path.join(readbackDir, 'rows.json'),
      rawInput: { rows: [readbackDesired] },
      type: 'flow',
      outDir: path.join(readbackDir, 'out'),
      commit: true,
      executionContractPath: readbackContractPath,
      env: executionEnv(dir, 'readback-1'),
      fetchImpl,
    });
    assert.equal(unknown.status, 'completed_with_unknowns');
    assert.equal(unknown.rows[0]?.status, 'unknown');
    assert.deepEqual(readbackWrites, [identity(readbackDesired).id]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('execution contract keeps preparation, reference, and dry-run failures at zero attempts', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-execution-contract-preflight-'));
  const invalid = structuredClone(flow('11111111-1111-1111-1111-111111111111', 'Invalid'));
  delete (invalid.flowDataSet as JsonObject).modellingAndValidation;
  const valid = flow('66666666-6666-6666-6666-666666666666', 'Unresolved source');
  const writes: string[] = [];
  try {
    __testInternals.prepareRows('invalid.json', { rows: [invalid] }, 'flow');
    const invalidContractPath = writeContract(dir, contract({ desired: [invalid] }));
    const invalidReport = await runDatasetSaveDraft({
      inputPath: path.join(dir, 'invalid.json'),
      rawInput: { rows: [invalid] },
      type: 'flow',
      outDir: path.join(dir, 'invalid-out'),
      commit: true,
      executionContractPath: invalidContractPath,
      env: executionEnv(dir, 'invalid-1'),
      fetchImpl: executionFetch({ state: new Map(), writes }),
    });
    assert.equal(invalidReport.status, 'completed_with_failures');
    assert.equal(invalidReport.rows[0]?.attempt_consumed, false);

    const unresolvedDir = path.join(dir, 'unresolved');
    mkdirSync(unresolvedDir);
    const unresolvedContractPath = writeContract(unresolvedDir, contract({ desired: [valid] }));
    const unresolvedReport = await runDatasetSaveDraft({
      inputPath: path.join(unresolvedDir, 'rows.json'),
      rawInput: { rows: [valid] },
      type: 'flow',
      outDir: path.join(unresolvedDir, 'out'),
      commit: true,
      executionContractPath: unresolvedContractPath,
      env: executionEnv(dir, 'unresolved-1'),
      fetchImpl: executionFetch({ state: new Map(), writes, missingSources: true }),
    });
    assert.equal(unresolvedReport.status, 'completed_with_failures');
    assert.match(unresolvedReport.rows[0]?.error?.message ?? '', /unresolved remote references/u);
    assert.equal(unresolvedReport.rows[0]?.attempt_consumed, false);
    assert.deepEqual(writes, []);

    await assert.rejects(
      () =>
        runDatasetSaveDraft({
          inputPath: path.join(unresolvedDir, 'rows.json'),
          rawInput: { rows: [valid] },
          type: 'flow',
          outDir: path.join(unresolvedDir, 'dry-run'),
          executionContractPath: unresolvedContractPath,
        }),
      /requires --commit/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('execution contract aborts before dispatch when its durable attempt marker cannot be created', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-execution-contract-ledger-failure-'));
  const desired = flow('11111111-1111-1111-1111-111111111111', 'No marker');
  const contractPath = writeContract(dir, contract({ desired: [desired] }));
  const stateRootFile = path.join(dir, 'state-root-is-a-file');
  writeFileSync(stateRootFile, 'not a directory\n', 'utf8');
  const writes: string[] = [];
  const env = buildSupabaseTestEnv({
    TIANGONG_LCA_API_KEY: 'marker-failure',
    TIANGONG_LCA_DISABLE_SESSION_CACHE: '1',
    XDG_STATE_HOME: stateRootFile,
  });
  try {
    await assert.rejects(
      () =>
        runDatasetSaveDraft({
          inputPath: path.join(dir, 'rows.json'),
          rawInput: { rows: [desired] },
          type: 'flow',
          outDir: path.join(dir, 'out'),
          commit: true,
          executionContractPath: contractPath,
          env,
          fetchImpl: executionFetch({ state: new Map(), writes }),
        }),
      /blocked before request dispatch/u,
    );
    assert.deepEqual(writes, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('execution contract parsers reject malformed contracts, JWTs, rows, and ledger events', () => {
  const valid = contract({
    desired: [flow('11111111-1111-1111-1111-111111111111', 'One')],
  });
  assert.equal(__testInternals.parseExecutionContract(valid).actions.length, 1);
  assert.throws(() => __testInternals.parseExecutionContract(null), /JSON object/u);
  assert.throws(() => __testInternals.parseExecutionContract({}), /header is invalid/u);
  assert.throws(
    () => __testInternals.parseExecutionContract({ ...valid, execution_id: ' ' }),
    /execution_id must be a non-empty string/u,
  );
  assert.throws(
    () => __testInternals.parseExecutionContract({ ...valid, actions: [null] }),
    /actions\[0\] is invalid/u,
  );
  assert.throws(
    () =>
      __testInternals.parseExecutionContract({
        ...valid,
        actions: [{ ...(valid.actions as JsonObject[])[0], desired_sha256: 'bad' }],
      }),
    /lowercase SHA-256/u,
  );
  const validAction = (valid.actions as JsonObject[])[0]!;
  assert.throws(
    () =>
      __testInternals.parseExecutionContract({
        ...valid,
        actions: [{ ...validAction, table: 'unknown' }],
      }),
    /table is unsupported/u,
  );
  assert.throws(
    () =>
      __testInternals.parseExecutionContract({
        ...valid,
        actions: [{ ...validAction, expected_operation: 'delete' }],
      }),
    /expected_operation is invalid/u,
  );
  assert.throws(
    () =>
      __testInternals.parseExecutionContract({
        ...valid,
        actions: [{ ...validAction, before_sha256: '0'.repeat(64) }],
      }),
    /contradicts expected_operation/u,
  );
  assert.throws(
    () =>
      __testInternals.parseExecutionContract({
        ...valid,
        actions: [
          validAction,
          { ...validAction, action_id: 'action-2', dependency_action_ids: ['missing'] },
        ],
      }),
    /unique earlier actions/u,
  );
  assert.throws(
    () =>
      __testInternals.parseExecutionContract({
        ...valid,
        actions: [validAction, validAction],
      }),
    /Duplicate action_id/u,
  );
  const parsed = __testInternals.parseExecutionContract(valid);
  const parsedAction = parsed.actions[0]!;
  const exactReadback = {
    id: parsedAction.id,
    version: parsedAction.version,
    user_id: parsed.owner.user_id,
    state_code: 0,
    json_ordered: flow('11111111-1111-1111-1111-111111111111', 'One'),
  };
  assert.equal(
    __testInternals.exactDesiredReadback({
      rows: [exactReadback],
      action: parsedAction,
      contract: parsed,
    }),
    true,
  );
  assert.equal(
    __testInternals.exactDesiredReadback({
      rows: [{ ...exactReadback, id: 'wrong-id' }],
      action: parsedAction,
      contract: parsed,
    }),
    false,
  );
  assert.equal(
    __testInternals.exactDesiredReadback({
      rows: [{ ...exactReadback, version: '99.99.999' }],
      action: parsedAction,
      contract: parsed,
    }),
    false,
  );
  const prepared = __testInternals.prepareRows(
    'rows.json',
    { rows: [flow('11111111-1111-1111-1111-111111111111', 'One')] },
    'flow',
  );
  assert.throws(() => __testInternals.bindExecutionContractRows(parsed, []), /action count/u);
  assert.throws(
    () =>
      __testInternals.bindExecutionContractRows(parsed, [
        ...__testInternals.prepareRows(
          'rows.json',
          { rows: [flow('11111111-1111-1111-1111-111111111111', 'Different')] },
          'flow',
        ),
      ]),
    /does not bind row/u,
  );
  assert.doesNotThrow(() => __testInternals.bindExecutionContractRows(parsed, prepared));
  const wrapperIdentityContract = __testInternals.parseExecutionContract({
    ...valid,
    actions: [{ ...(valid.actions as JsonObject[])[0], id: 'wrapper-id' }],
  });
  const wrapperIdentityRows = __testInternals.prepareRows(
    'rows.json',
    { rows: [{ id: 'wrapper-id', json_ordered: prepared[0]?.payload }] },
    'flow',
  );
  assert.throws(
    () => __testInternals.bindExecutionContractRows(wrapperIdentityContract, wrapperIdentityRows),
    /does not bind row/u,
  );
  assert.throws(
    () =>
      __testInternals.bindExecutionContractRows(
        parsed,
        __testInternals.prepareRows('rows.json', { rows: [{ unsupported: true }] }, 'auto'),
      ),
    /does not bind row/u,
  );
  assert.throws(() => __testInternals.decodeExecutionActor('plain'), /not a JWT/u);
  assert.throws(() => __testInternals.decodeExecutionActor('x.bad!.x'), /payload is invalid/u);
  assert.throws(() => __testInternals.decodeExecutionActor(jwtWithPayload([])), /not an object/u);
  assert.deepEqual(__testInternals.decodeExecutionActor(jwt()), {
    user_id: 'user-1',
    email: 'user@example.com',
  });
  assert.deepEqual(
    __testInternals.parseExecutionRows(
      [{ id: 'a', version: 'v', user_id: 'u', state_code: 0, json_ordered: { a: 1 } }],
      'https://example.test',
    )[0]?.json_ordered,
    { a: 1 },
  );
  assert.equal(
    __testInternals.parseExecutionRows(
      [{ id: 'a', version: 'v', user_id: 'u', state_code: 0 }],
      'https://example.test',
    )[0]?.json_ordered,
    null,
  );
  assert.throws(() => __testInternals.parseLedgerEvent(null, 0), /not an object/u);
  assert.throws(() => __testInternals.parseLedgerEvent({}, 0), /invalid shape/u);
  const invalidOutcome = ledgerEvent({
    contractSha256: '0'.repeat(64),
    action: validAction,
    sequence: 1,
    eventType: 'attempt_emitted',
    outcome: 'executed',
  });
  assert.throws(() => __testInternals.parseLedgerEvent(invalidOutcome, 0), /invalid outcome/u);
  assert.equal(
    __testInternals.projectRefFromApiBaseUrl('https://sample.supabase.co/functions/v1'),
    'sample',
  );
});

test('execution ledger rejects binding, repeated-attempt, and outcome-order corruption', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-execution-ledger-corruption-'));
  const contractValue = contract({
    desired: [flow('11111111-1111-1111-1111-111111111111', 'One')],
  });
  const parsed = __testInternals.parseExecutionContract(contractValue);
  const action = parsed.actions[0]!;
  const actionObject = action as unknown as JsonObject;
  const contractSha256 = sha256Json(parsed);
  try {
    const bindingRoot = path.join(dir, 'binding');
    const wrongBinding = ledgerEvent({
      contractSha256,
      action: { ...actionObject, action_id: 'wrong-action' },
      sequence: 1,
      eventType: 'attempt_emitted',
      outcome: null,
    });
    writeLedgerEvents(__testInternals.executionLedgerPath(bindingRoot, action), [wrongBinding]);
    assert.throws(
      () => __testInternals.loadExecutionLedger(bindingRoot, parsed),
      /failed its hash or action binding/u,
    );

    const targetBindingRoot = path.join(dir, 'target-binding');
    const wrongTargetBinding = ledgerEvent({
      contractSha256,
      action: { ...actionObject, id: 'different-target' },
      sequence: 1,
      eventType: 'attempt_emitted',
      outcome: null,
    });
    writeLedgerEvents(__testInternals.executionLedgerPath(targetBindingRoot, action), [
      wrongTargetBinding,
    ]);
    assert.throws(
      () => __testInternals.loadExecutionLedger(targetBindingRoot, parsed),
      /failed its hash or action binding/u,
    );

    const repeatedRoot = path.join(dir, 'repeated');
    const attempt = ledgerEvent({
      contractSha256,
      action: actionObject,
      sequence: 1,
      eventType: 'attempt_emitted',
      outcome: null,
    });
    const repeatedAttempt = ledgerEvent({
      contractSha256,
      action: actionObject,
      sequence: 2,
      eventType: 'attempt_emitted',
      outcome: null,
      previousEventSha256: attempt.event_sha256 as string,
    });
    writeLedgerEvents(__testInternals.executionLedgerPath(repeatedRoot, action), [
      attempt,
      repeatedAttempt,
    ]);
    assert.throws(
      () => __testInternals.loadExecutionLedger(repeatedRoot, parsed),
      /repeats attempt/u,
    );

    const orderingRoot = path.join(dir, 'ordering');
    const orphanOutcome = ledgerEvent({
      contractSha256,
      action: actionObject,
      sequence: 1,
      eventType: 'outcome',
      outcome: 'unknown',
    });
    writeLedgerEvents(__testInternals.executionLedgerPath(orderingRoot, action), [orphanOutcome]);
    assert.throws(
      () => __testInternals.loadExecutionLedger(orderingRoot, parsed),
      /outcome ordering is invalid/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
