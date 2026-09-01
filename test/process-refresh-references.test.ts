import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  __testInternals,
  runProcessRefreshReferences,
} from '../src/lib/process-refresh-references.js';
import type { FetchLike } from '../src/lib/http.js';
import {
  buildSupabaseTestEnv,
  isSupabaseAuthTokenUrl,
  makeSupabaseAuthResponse,
} from './helpers/supabase-auth.js';

function lang(text: string, langCode = 'en') {
  return { '@xml:lang': langCode, '#text': text };
}

function makeJsonResponse(options: {
  ok?: boolean;
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: {
      get(name: string): string | null {
        const key = name.toLowerCase();
        if (options.headers && key in options.headers) {
          return options.headers[key] ?? null;
        }
        return key === 'content-type' ? 'application/json' : null;
      },
    },
    async text(): Promise<string> {
      if (typeof options.body === 'string') {
        return options.body;
      }
      return JSON.stringify(options.body ?? null);
    },
  };
}

function withSupabaseAuthBootstrap(fetchImpl: FetchLike): FetchLike {
  return async (url, init) => {
    if (isSupabaseAuthTokenUrl(String(url))) {
      return makeSupabaseAuthResponse({
        userId: 'user-1',
      });
    }

    return fetchImpl(String(url), init);
  };
}

function buildProcessPayload(flowId: string, flowVersion: string, shortDescription: string) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          'common:UUID': 'proc-draft',
          name: {
            baseName: [lang('Draft process')],
            treatmentStandardsRoutes: [lang('draft route')],
            mixAndLocationTypes: [lang('draft mix')],
            functionalUnitFlowProperties: [lang('draft fu')],
          },
        },
      },
      exchanges: {
        exchange: [
          {
            referenceToFlowDataSet: {
              '@type': 'flow data set',
              '@refObjectId': flowId,
              '@version': flowVersion,
              'common:shortDescription': [lang(shortDescription)],
            },
          },
        ],
      },
      administrativeInformation: {
        publicationAndOwnership: {
          'common:dataSetVersion': '01.00.001',
        },
      },
    },
  };
}

function buildFlowPayload(baseName: string) {
  return {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          name: {
            baseName: [lang(baseName)],
            treatmentStandardsRoutes: [lang('hydration')],
            mixAndLocationTypes: [lang('at plant')],
            flowProperties: [lang('kg')],
          },
        },
      },
    },
  };
}

test('runProcessRefreshReferences dry-run refreshes reachable refs and skips public rows', async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-refresh-'));
  try {
    const fetchImpl = withSupabaseAuthBootstrap(async (url) => {
      const parsed = new URL(String(url));

      if (parsed.pathname === '/auth/v1/user') {
        return makeJsonResponse({
          body: { id: 'user-1' },
        });
      }

      if (parsed.pathname === '/rest/v1/processes') {
        const select = parsed.searchParams.get('select');
        if (select === 'id,version,modified_at,state_code,model_id') {
          return makeJsonResponse({
            body: [
              {
                id: 'proc-draft',
                version: '01.00.001',
                modified_at: '2026-04-18T00:00:00.000Z',
                state_code: 0,
                model_id: 'model-1',
              },
              {
                id: 'proc-public',
                version: '01.00.001',
                modified_at: '2026-04-17T00:00:00.000Z',
                state_code: 100,
                model_id: null,
              },
            ],
            headers: {
              'content-type': 'application/json',
              'content-range': '0-1/2',
            },
          });
        }

        if (
          select === 'id,version,json,modified_at,state_code,model_id,user_id' &&
          parsed.searchParams.get('id') === 'eq.proc-draft'
        ) {
          return makeJsonResponse({
            body: [
              {
                id: 'proc-draft',
                version: '01.00.001',
                modified_at: '2026-04-18T00:00:00.000Z',
                state_code: 0,
                model_id: 'model-1',
                user_id: 'user-1',
                json: buildProcessPayload('flow-1', '01.00.000', 'Old flow short'),
              },
            ],
          });
        }
      }

      if (parsed.pathname === '/rest/v1/flows') {
        return makeJsonResponse({
          body: [
            {
              id: 'flow-1',
              version: '01.00.000',
              json: buildFlowPayload('Old flow'),
            },
            {
              id: 'flow-1',
              version: '01.00.002',
              json: buildFlowPayload('Updated flow'),
            },
          ],
        });
      }

      throw new Error(`Unexpected URL: ${String(url)}`);
    });

    const report = await runProcessRefreshReferences({
      outDir: tempDir,
      env: buildSupabaseTestEnv({
        TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/functions/v1',
      }),
      fetchImpl,
      validateProcessPayloadImpl: () => ({
        ok: true,
        validator: 'test-validator',
        issue_count: 0,
        issues: [],
      }),
    });

    assert.equal(report.status, 'completed_process_reference_refresh');
    assert.equal(report.mode, 'dry_run');
    assert.equal(report.masked_user_email, 'us****@example.com');
    assert.deepEqual(report.counts, {
      manifest: 2,
      selected: 2,
      already_completed: 0,
      pending: 2,
      saved: 0,
      dry_run: 1,
      skipped: 1,
      validation_blocked: 0,
      errors: 0,
    });

    const progressRows = readFileSync(report.files.progress_jsonl, 'utf8')
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as { status: string; touched_refs?: Array<{ to_version: string }> },
      );
    assert.equal(progressRows.length, 2);
    const dryRunRow = progressRows.find((row) => row.status === 'dry_run');
    assert.ok(dryRunRow);
    assert.equal(dryRunRow?.touched_refs?.[0]?.to_version, '01.00.002');
    const skippedRow = progressRows.find((row) => row.status === 'skipped');
    assert.ok(skippedRow);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runProcessRefreshReferences blocks unresolved refs before invoking writes', async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-refresh-blocked-'));
  let writes = 0;

  try {
    const fetchImpl = withSupabaseAuthBootstrap(async (url) => {
      const parsed = new URL(String(url));

      if (parsed.pathname === '/auth/v1/user') {
        return makeJsonResponse({
          body: { id: 'user-1' },
        });
      }

      if (parsed.pathname === '/rest/v1/processes') {
        const select = parsed.searchParams.get('select');
        if (select === 'id,version,modified_at,state_code,model_id') {
          return makeJsonResponse({
            body: [
              {
                id: 'proc-draft',
                version: '01.00.001',
                modified_at: '2026-04-18T00:00:00.000Z',
                state_code: 0,
                model_id: 'model-1',
              },
            ],
            headers: {
              'content-type': 'application/json',
              'content-range': '0-0/1',
            },
          });
        }

        if (
          select === 'id,version,json,modified_at,state_code,model_id,user_id' &&
          parsed.searchParams.get('id') === 'eq.proc-draft'
        ) {
          return makeJsonResponse({
            body: [
              {
                id: 'proc-draft',
                version: '01.00.001',
                modified_at: '2026-04-18T00:00:00.000Z',
                state_code: 0,
                model_id: 'model-1',
                user_id: 'user-1',
                json: buildProcessPayload('flow-missing', '01.00.000', 'Missing flow'),
              },
            ],
          });
        }
      }

      if (parsed.pathname === '/rest/v1/flows') {
        return makeJsonResponse({
          body: [],
        });
      }

      throw new Error(`Unexpected URL: ${String(url)}`);
    });

    const report = await runProcessRefreshReferences({
      outDir: tempDir,
      apply: true,
      env: buildSupabaseTestEnv({
        TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/functions/v1',
      }),
      fetchImpl,
      validateProcessPayloadImpl: () => ({
        ok: true,
        validator: 'test-validator',
        issue_count: 0,
        issues: [],
      }),
      syncStateAwareProcessRecordImpl: async () => {
        writes += 1;
        return {
          status: 'success',
          operation: 'save_draft',
          write_path: 'cmd_dataset_save_draft',
          rpc_result: { ok: true },
          visible_row: {
            id: 'proc-draft',
            version: '01.00.001',
            user_id: 'user-1',
            state_code: 0,
          },
        };
      },
    });

    assert.equal(report.status, 'completed_process_reference_refresh');
    assert.equal(report.mode, 'apply');
    assert.equal(report.counts.saved, 0);
    assert.equal(report.counts.validation_blocked, 1);
    assert.equal(report.counts.errors, 0);
    assert.equal(writes, 0);

    const blockers = readFileSync(report.files.validation_blockers_jsonl, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { status: string; unresolved_count: number });
    assert.equal(blockers.length, 1);
    assert.equal(blockers[0]?.status, 'validation_blocked');
    assert.equal(blockers[0]?.unresolved_count, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runProcessRefreshReferences apply saves refreshed rows and counts saved results', async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-refresh-apply-'));
  let savedPayload: Record<string, unknown> | null = null;

  try {
    const fetchImpl = withSupabaseAuthBootstrap(async (url) => {
      const parsed = new URL(String(url));

      if (parsed.pathname === '/auth/v1/user') {
        return makeJsonResponse({
          body: { id: 'user-1' },
        });
      }

      if (parsed.pathname === '/rest/v1/processes') {
        const select = parsed.searchParams.get('select');
        if (select === 'id,version,modified_at,state_code,model_id') {
          return makeJsonResponse({
            body: [
              {
                id: 'proc-draft',
                version: '01.00.001',
                modified_at: '2026-04-18T00:00:00.000Z',
                state_code: 0,
                model_id: 'model-1',
              },
            ],
            headers: {
              'content-type': 'application/json',
              'content-range': '0-0/1',
            },
          });
        }

        if (
          select === 'id,version,json,modified_at,state_code,model_id,user_id' &&
          parsed.searchParams.get('id') === 'eq.proc-draft'
        ) {
          return makeJsonResponse({
            body: [
              {
                id: 'proc-draft',
                version: '01.00.001',
                modified_at: '2026-04-18T00:00:00.000Z',
                state_code: 0,
                model_id: 'model-1',
                user_id: 'user-1',
                json: buildProcessPayload('flow-1', '01.00.000', 'Old flow short'),
              },
            ],
          });
        }
      }

      if (parsed.pathname === '/rest/v1/flows') {
        return makeJsonResponse({
          body: [
            {
              id: 'flow-1',
              version: '',
              json: buildFlowPayload('Ignored invalid row'),
            },
            {
              id: 'flow-1',
              version: '01.00.002',
              json: buildFlowPayload('Updated flow'),
            },
          ],
        });
      }

      throw new Error(`Unexpected URL: ${String(url)}`);
    });

    const report = await runProcessRefreshReferences({
      outDir: tempDir,
      apply: true,
      env: buildSupabaseTestEnv({
        TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/functions/v1',
      }),
      fetchImpl,
      validateProcessPayloadImpl: () => ({
        ok: true,
        validator: 'test-validator',
        issue_count: 0,
        issues: [],
      }),
      syncStateAwareProcessRecordImpl: async (options) => {
        savedPayload = options.payload as Record<string, unknown>;
        return {
          status: 'success',
          operation: 'save_draft',
          write_path: 'cmd_dataset_save_draft',
          rpc_result: { ok: true },
          visible_row: {
            id: 'proc-draft',
            version: '01.00.001',
            user_id: 'user-1',
            state_code: 0,
          },
        };
      },
    });

    assert.equal(report.status, 'completed_process_reference_refresh');
    assert.equal(report.mode, 'apply');
    assert.equal(report.counts.saved, 1);
    assert.ok(savedPayload);
    assert.match(JSON.stringify(savedPayload), /01\.00\.002/u);

    const progressRows = readFileSync(report.files.progress_jsonl, 'utf8')
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as { status: string; write_path?: string; write_operation?: string },
      );
    assert.equal(progressRows[0]?.status, 'saved');
    assert.equal(progressRows[0]?.write_path, 'cmd_dataset_save_draft');
    assert.equal(progressRows[0]?.write_operation, 'save_draft');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runProcessRefreshReferences records schema-validation blockers and reference lookup failures', async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-refresh-blocker-notes-'));

  try {
    const schemaBlockedFetch = withSupabaseAuthBootstrap(async (url) => {
      const parsed = new URL(String(url));

      if (parsed.pathname === '/auth/v1/user') {
        return makeJsonResponse({
          body: { id: 'user-1' },
        });
      }

      if (parsed.pathname === '/rest/v1/processes') {
        const select = parsed.searchParams.get('select');
        if (select === 'id,version,modified_at,state_code,model_id') {
          return makeJsonResponse({
            body: [
              {
                id: 'proc-draft',
                version: '01.00.001',
                modified_at: '2026-04-18T00:00:00.000Z',
                state_code: 0,
                model_id: 'model-1',
              },
            ],
            headers: {
              'content-type': 'application/json',
              'content-range': '0-0/1',
            },
          });
        }

        if (
          select === 'id,version,json,modified_at,state_code,model_id,user_id' &&
          parsed.searchParams.get('id') === 'eq.proc-draft'
        ) {
          return makeJsonResponse({
            body: [
              {
                id: 'proc-draft',
                version: '01.00.001',
                modified_at: '2026-04-18T00:00:00.000Z',
                state_code: 0,
                model_id: 'model-1',
                user_id: 'user-1',
                json: buildProcessPayload('flow-1', '01.00.000', 'Old flow short'),
              },
            ],
          });
        }
      }

      if (parsed.pathname === '/rest/v1/flows') {
        return makeJsonResponse({
          body: [
            {
              id: 'flow-1',
              version: '01.00.002',
              json: buildFlowPayload('Updated flow'),
            },
          ],
        });
      }

      throw new Error(`Unexpected URL: ${String(url)}`);
    });

    const schemaBlockedReport = await runProcessRefreshReferences({
      outDir: tempDir,
      env: buildSupabaseTestEnv({
        TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/functions/v1',
      }),
      fetchImpl: schemaBlockedFetch,
      validateProcessPayloadImpl: () => ({
        ok: false,
        validator: 'test-validator',
        issue_count: 2,
        issues: [
          {
            path: 'processDataSet',
            message: 'Broken payload',
            code: 'custom',
          },
        ],
      }),
    });

    const schemaBlockedRows = readFileSync(
      schemaBlockedReport.files.validation_blockers_jsonl,
      'utf8',
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { note: string });
    assert.match(schemaBlockedRows[0]?.note ?? '', /schema_issue_count=2/u);

    const lookupFailureFetch = withSupabaseAuthBootstrap(async (url) => {
      const parsed = new URL(String(url));

      if (parsed.pathname === '/auth/v1/user') {
        return makeJsonResponse({
          body: { id: 'user-1' },
        });
      }

      if (parsed.pathname === '/rest/v1/processes') {
        const select = parsed.searchParams.get('select');
        if (select === 'id,version,modified_at,state_code,model_id') {
          return makeJsonResponse({
            body: [
              {
                id: 'proc-draft',
                version: '01.00.001',
                modified_at: '2026-04-18T00:00:00.000Z',
                state_code: 0,
                model_id: 'model-1',
              },
            ],
            headers: {
              'content-type': 'application/json',
              'content-range': '0-0/1',
            },
          });
        }

        if (
          select === 'id,version,json,modified_at,state_code,model_id,user_id' &&
          parsed.searchParams.get('id') === 'eq.proc-draft'
        ) {
          return makeJsonResponse({
            body: [
              {
                id: 'proc-draft',
                version: '01.00.001',
                modified_at: '2026-04-18T00:00:00.000Z',
                state_code: 0,
                model_id: 'model-1',
                user_id: 'user-1',
                json: buildProcessPayload('flow-1', '01.00.000', 'Old flow short'),
              },
            ],
          });
        }
      }

      if (parsed.pathname === '/rest/v1/flows') {
        throw new Error('flow lookup failed');
      }

      throw new Error(`Unexpected URL: ${String(url)}`);
    });

    const lookupFailureReport = await runProcessRefreshReferences({
      outDir: path.join(tempDir, 'lookup-failure'),
      env: buildSupabaseTestEnv({
        TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/functions/v1',
      }),
      fetchImpl: lookupFailureFetch,
      maxRetries: 1,
      validateProcessPayloadImpl: () => ({
        ok: true,
        validator: 'test-validator',
        issue_count: 0,
        issues: [],
      }),
    });

    const lookupFailureRows = readFileSync(
      lookupFailureReport.files.validation_blockers_jsonl,
      'utf8',
    )
      .trim()
      .split('\n')
      .map(
        (line) => JSON.parse(line) as { note: string; unresolved_refs: Array<{ reason: string }> },
      );
    assert.match(lookupFailureRows[0]?.note ?? '', /unresolved_refs=1/u);
    assert.match(
      lookupFailureRows[0]?.unresolved_refs?.[0]?.reason ?? '',
      /reference refresh flows lookup failed after 1 attempt\(s\)\./u,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('process refresh helper internals cover dataset parsing, manifests, report headers, and retries', async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-refresh-helpers-'));

  try {
    assert.equal(__testInternals.parseContentRangeTotal(null), null);
    assert.equal(__testInternals.parseContentRangeTotal('items 0-0/*'), null);
    assert.equal(__testInternals.parseContentRangeTotal('items 0-4/5'), 5);

    assert.equal(__testInternals.compareVersions('01.00.010', '01.00.002') > 0, true);
    assert.equal(__testInternals.compareVersions('01.0', '01.00.000') < 0, true);

    assert.deepEqual(__testInternals.getLangList('Flow name'), [
      { '@xml:lang': 'en', '#text': 'Flow name' },
    ]);
    assert.deepEqual(
      __testInternals.getLangList({
        'common:langString': {
          '@xml:lang': 'zh',
          '#text': '流程名称',
        },
      }),
      [{ '@xml:lang': 'zh', '#text': '流程名称' }],
    );
    assert.deepEqual(__testInternals.getLangList([{ '@xml:lang': 'en', '#text': 'ok' }, 'skip']), [
      { '@xml:lang': 'en', '#text': 'ok' },
    ]);
    assert.equal(
      __testInternals.getLangText(
        [
          { '@xml:lang': 'en', '#text': 'English' },
          { '@xml:lang': 'zh', '#text': '中文' },
        ],
        'zh',
      ),
      '中文',
    );
    assert.equal(__testInternals.getLangText([{ '#text': 'Fallback' }], 'zh'), 'Fallback');

    assert.deepEqual(
      __testInternals.normalizeDatasetPayload('{"flowDataSet":{"ok":true}}', 'flow-1'),
      { flowDataSet: { ok: true } },
    );
    assert.throws(
      () => __testInternals.normalizeDatasetPayload('[1,2,3]', 'flow-2'),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'PROCESS_REFRESH_REMOTE_PAYLOAD_INVALID');
        return true;
      },
    );
    assert.throws(
      () => __testInternals.normalizeDatasetPayload('{', 'flow-3'),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          'PROCESS_REFRESH_REMOTE_PAYLOAD_INVALID_JSON',
        );
        return true;
      },
    );
    assert.throws(
      () => __testInternals.normalizeDatasetPayload(null, 'flow-4'),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'PROCESS_REFRESH_REMOTE_PAYLOAD_MISSING');
        return true;
      },
    );

    assert.deepEqual(
      __testInternals.getShortDescription(buildFlowPayload('Flow name'), 'flow data set')[0],
      {
        '@xml:lang': 'en',
        '#text': 'Flow name; hydration; at plant; kg',
      },
    );
    assert.deepEqual(
      __testInternals.getShortDescription(
        buildProcessPayload('flow-1', '01.00.000', 'Short description'),
        'process data set',
      )[0],
      {
        '@xml:lang': 'en',
        '#text': 'Draft process; draft route; draft mix; draft fu',
      },
    );
    assert.deepEqual(
      __testInternals.getShortDescription(
        {
          contactDataSet: {
            contactInformation: {
              dataSetInformation: {
                'common:shortName': [lang('Contact short'), lang('联系人简称', 'zh')],
              },
            },
          },
        },
        'contact data set',
      )[0],
      lang('Contact short'),
    );
    assert.deepEqual(
      __testInternals.getShortDescription(
        {
          sourceDataSet: {
            sourceInformation: {
              dataSetInformation: {
                'common:shortName': [lang('Source short')],
              },
            },
          },
        },
        'source data set',
      )[0],
      lang('Source short'),
    );
    assert.deepEqual(
      __testInternals.getShortDescription(
        {
          flowPropertyDataSet: {
            flowPropertyInformation: {
              dataSetInformation: {
                'common:shortName': [lang('Mass')],
              },
            },
          },
        },
        'flow property data set',
      )[0],
      lang('Mass'),
    );
    assert.deepEqual(
      __testInternals.getShortDescription(
        {
          unitGroupDataSet: {
            unitGroupInformation: {
              dataSetInformation: {
                'common:shortName': [lang('kilogram')],
              },
            },
          },
        },
        'unit group data set',
      )[0],
      lang('kilogram'),
    );
    assert.deepEqual(
      __testInternals.getShortDescription(
        {
          lciaMethodDataSet: {
            LCIAMethodInformation: {
              dataSetInformation: {
                'common:shortName': [lang('LCIA short')],
              },
            },
          },
        },
        'LCIA method data set',
      )[0],
      lang('LCIA short'),
    );
    assert.deepEqual(__testInternals.getShortDescription({}, 'unknown type'), []);

    assert.equal(
      await __testInternals.parseJsonResponse(
        makeJsonResponse({
          body: 'plain response',
          headers: { 'content-type': 'text/plain' },
        }),
        'plain-response',
      ),
      'plain response',
    );
    assert.equal(
      await __testInternals.parseJsonResponse(
        makeJsonResponse({
          body: '   ',
          headers: { 'content-type': 'application/json' },
        }),
        'blank-response',
      ),
      null,
    );
    await assert.rejects(
      () =>
        __testInternals.parseJsonResponse(
          makeJsonResponse({
            body: '{',
            headers: { 'content-type': 'application/json' },
          }),
          'invalid-json-response',
        ),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'PROCESS_REFRESH_REMOTE_INVALID_JSON');
        return true;
      },
    );

    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => {
      callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    try {
      let retryAttempts = 0;
      const retryResult = await __testInternals.fetchJsonWithRetry({
        url: 'https://example.test/retry',
        init: { method: 'GET' },
        label: 'retry lookup',
        fetchImpl: async () => {
          retryAttempts += 1;
          if (retryAttempts === 1) {
            throw new Error('transient network error');
          }
          return makeJsonResponse({
            body: { ok: true },
            headers: {
              'content-type': 'application/json',
              'content-range': '0-0/1',
            },
          });
        },
        timeoutMs: 10,
        maxRetries: 2,
      });
      assert.equal(retryAttempts, 2);
      assert.equal(retryResult.status, 200);
      assert.deepEqual(retryResult.body, { ok: true });
      assert.equal(retryResult.headers.get('content-range'), '0-0/1');

      await assert.rejects(
        () =>
          __testInternals.fetchJsonWithRetry({
            url: 'https://example.test/http-error',
            init: { method: 'GET' },
            label: 'http-error lookup',
            fetchImpl: async () =>
              makeJsonResponse({
                ok: false,
                status: 500,
                body: { error: 'failed' },
              }),
            timeoutMs: 10,
            maxRetries: 1,
          }),
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, 'PROCESS_REFRESH_REMOTE_REQUEST_FAILED');
          return true;
        },
      );

      await assert.rejects(
        () =>
          __testInternals.fetchJsonWithRetry({
            url: 'https://example.test/network-error',
            init: { method: 'GET' },
            label: 'network-error lookup',
            fetchImpl: async () => {
              throw new Error('network down');
            },
            timeoutMs: 10,
            maxRetries: 1,
          }),
        (error: unknown) => {
          const cliError = error as { code?: string; details?: unknown };
          assert.equal(cliError.code, 'PROCESS_REFRESH_REMOTE_REQUEST_FAILED');
          assert.match(String(cliError.details), /network down/u);
          return true;
        },
      );
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }

    const refCache = new Map([
      [
        'flows:cached-flow',
        {
          row: null,
          count: 0,
        },
      ],
    ]);
    await __testInternals.fetchLatestRefs({
      projectBaseUrl: 'https://example.test',
      publishableKey: 'publishable',
      accessToken: 'token',
      refs: [
        {
          node: {
            '@type': 'flow data set',
            '@refObjectId': 'cached-flow',
            '@version': '01.00.000',
          },
          path: 'cached',
        },
        {
          node: {
            '@type': 'flow data set',
            '@refObjectId': 'flow-1',
            '@version': '01.00.000',
          },
          path: 'fresh',
        },
        {
          node: {
            '@type': 'unsupported data set',
            '@refObjectId': 'skip-me',
            '@version': '01.00.000',
          },
          path: 'unsupported',
        },
      ],
      cache: refCache,
      fetchImpl: async () =>
        makeJsonResponse({
          body: [
            null,
            {
              id: 'flow-1',
              version: '',
              json: buildFlowPayload('Ignored invalid row'),
            },
            {
              id: 'flow-1',
              version: '01.00.002',
              json: buildFlowPayload('Latest flow'),
              modified_at: '2026-04-18T00:00:00.000Z',
              state_code: 0,
              user_id: 'user-1',
              team_id: 'team-1',
            },
          ],
        }),
      timeoutMs: 10,
      maxRetries: 1,
    });
    assert.equal(refCache.has('flows:cached-flow'), true);
    const fetchedFlow = refCache.get('flows:flow-1') as
      { row: { version: string } | null } | undefined;
    assert.equal(fetchedFlow?.row?.version, '01.00.002');

    const missingManifestPath = path.join(tempDir, 'missing.manifest.json');
    assert.equal(__testInternals.readManifest(missingManifestPath), null);

    const invalidManifestPath = path.join(tempDir, 'invalid.manifest.json');
    writeFileSync(invalidManifestPath, '{"rows":[]}', 'utf8');
    assert.throws(
      () => __testInternals.readManifest(invalidManifestPath),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'PROCESS_REFRESH_MANIFEST_INVALID');
        return true;
      },
    );

    const manifestPath = path.join(tempDir, 'manifest.json');
    writeFileSync(
      manifestPath,
      `${JSON.stringify(
        {
          rows: [
            {
              id: 'proc-1',
              version: '01.00.001',
              modified_at: '2026-04-18T00:00:00.000Z',
              state_code: 0,
              model_id: 'model-1',
            },
            {
              id: '',
              version: '01.00.001',
            },
          ],
          user_id: 'user-1',
          masked_user_email: 'us****@example.com',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    const manifest = __testInternals.readManifest(manifestPath);
    assert.ok(manifest);
    assert.equal(manifest?.rows.length, 1);
    assert.equal(manifest?.count, 1);
    assert.equal(manifest?.page_size, 500);

    const progressPath = path.join(tempDir, 'progress.jsonl');
    writeFileSync(
      progressPath,
      [
        JSON.stringify({ key: 'proc-1:01.00.001', status: 'dry_run' }),
        '{"broken":',
        JSON.stringify({ key: 'proc-2:01.00.001', status: 'validation_blocked' }),
        JSON.stringify({ key: 'proc-3:01.00.001', status: 'saved' }),
      ].join('\n'),
      'utf8',
    );
    assert.deepEqual(Array.from(__testInternals.readCompleted(progressPath, false)).sort(), [
      'proc-1:01.00.001',
      'proc-2:01.00.001',
    ]);
    assert.deepEqual(Array.from(__testInternals.readCompleted(progressPath, true)), [
      'proc-2:01.00.001',
      'proc-3:01.00.001',
    ]);

    const cyclicPayload = {
      nested: [
        {
          referenceToFlowDataSet: {
            '@type': 'Flow data set',
            '@refObjectId': 'flow-1',
            '@version': '01.00.000',
            'common:shortDescription': [lang('Old flow short')],
          },
        },
        {
          referenceToSourceDataSet: {
            '@type': 'Source data set',
            '@refObjectId': 'source-1',
            '@version': '01.00.000',
          },
        },
      ],
    } as {
      nested: Array<Record<string, unknown>>;
      self?: unknown;
    };
    cyclicPayload.self = cyclicPayload;

    const refs = __testInternals.collectRefs(cyclicPayload);
    assert.equal(refs.length, 2);
    assert.equal(refs[0]?.path.includes('referenceToFlowDataSet'), true);
    assert.equal(__testInternals.normalizeReferenceType(' Source data set '), 'source data set');
    assert.equal(__testInternals.tableForReferenceType('Contact data set'), 'contacts');
    assert.equal(__testInternals.tableForReferenceType('unknown'), null);

    const update = __testInternals.updateProcessJson(
      cyclicPayload,
      refs,
      new Map([
        [
          'flows:flow-1',
          {
            row: {
              id: 'flow-1',
              version: '01.00.002',
              json: buildFlowPayload('Updated flow'),
              modified_at: null,
              state_code: 0,
              user_id: null,
              team_id: null,
            },
            count: 2,
          },
        ],
        [
          'sources:source-1',
          {
            row: null,
            count: 0,
            error: 'not accessible',
          },
        ],
      ]),
    );
    assert.equal(update.version_updates, 1);
    assert.equal(update.description_updates, 1);
    assert.equal(update.touched_refs.length, 1);
    assert.equal(update.unresolved_refs[0]?.reason, 'not accessible');

    const reportPath = path.join(tempDir, 'report.md');
    __testInternals.appendReportHeader(reportPath, {
      mode: 'dry_run',
      generatedAtUtc: '2026-04-18T00:00:00.000Z',
      manifestCount: 2,
    });
    const initialReport = readFileSync(reportPath, 'utf8');
    __testInternals.appendReportHeader(reportPath, {
      mode: 'apply',
      generatedAtUtc: '2026-04-18T01:00:00.000Z',
      manifestCount: 3,
    });
    assert.equal(readFileSync(reportPath, 'utf8'), initialReport);
    assert.match(initialReport, /TianGong Process Reference Refresh/u);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runProcessRefreshReferences validates direct options and reports completed_with_errors', async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-refresh-errors-'));

  try {
    await assert.rejects(
      () => runProcessRefreshReferences({ outDir: '' }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'PROCESS_REFRESH_OUT_DIR_REQUIRED');
        return true;
      },
    );
    await assert.rejects(
      () => runProcessRefreshReferences({ outDir: tempDir, limit: 0 }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'PROCESS_REFRESH_LIMIT_INVALID');
        return true;
      },
    );
    await assert.rejects(
      () => runProcessRefreshReferences({ outDir: tempDir, pageSize: 0 }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'PROCESS_REFRESH_PAGE_SIZE_INVALID');
        return true;
      },
    );
    await assert.rejects(
      () => runProcessRefreshReferences({ outDir: tempDir, concurrency: 0 }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'PROCESS_REFRESH_CONCURRENCY_INVALID');
        return true;
      },
    );
    await assert.rejects(
      () => runProcessRefreshReferences({ outDir: tempDir, timeoutMs: 0 }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'PROCESS_REFRESH_TIMEOUT_INVALID');
        return true;
      },
    );
    await assert.rejects(
      () => runProcessRefreshReferences({ outDir: tempDir, maxRetries: 0 }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'PROCESS_REFRESH_MAX_RETRIES_INVALID');
        return true;
      },
    );

    const fetchImpl = withSupabaseAuthBootstrap(async (url) => {
      const parsed = new URL(String(url));

      if (parsed.pathname === '/auth/v1/user') {
        return makeJsonResponse({
          body: { id: 'user-1' },
        });
      }

      if (parsed.pathname === '/rest/v1/processes') {
        const select = parsed.searchParams.get('select');
        if (select === 'id,version,modified_at,state_code,model_id') {
          return makeJsonResponse({
            body: [
              {
                id: 'proc-error',
                version: '01.00.001',
                modified_at: '2026-04-18T00:00:00.000Z',
                state_code: 0,
                model_id: 'model-1',
              },
            ],
            headers: {
              'content-type': 'application/json',
              'content-range': '0-0/1',
            },
          });
        }

        if (
          select === 'id,version,json,modified_at,state_code,model_id,user_id' &&
          parsed.searchParams.get('id') === 'eq.proc-error'
        ) {
          return makeJsonResponse({
            body: [],
          });
        }
      }

      throw new Error(`Unexpected URL: ${String(url)}`);
    });

    const report = await runProcessRefreshReferences({
      outDir: tempDir,
      env: buildSupabaseTestEnv({
        TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/functions/v1',
      }),
      fetchImpl,
      validateProcessPayloadImpl: () => ({
        ok: true,
        validator: 'test-validator',
        issue_count: 0,
        issues: [],
      }),
    });

    assert.equal(report.status, 'completed_process_reference_refresh_with_errors');
    assert.equal(report.counts.errors, 1);
    const errorRows = readFileSync(report.files.errors_jsonl, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { status: string; error: string });
    assert.equal(errorRows[0]?.status, 'error');
    assert.match(errorRows[0]?.error ?? '', /Process not found/u);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('process refresh helper internals cover null name generators, manifest validation, and progress row filtering', () => {
  assert.equal(__testInternals.genFlowName(null, 'en'), '');
  assert.deepEqual(__testInternals.genFlowNameJson(null), []);
  assert.deepEqual(__testInternals.genFlowNameJson({}), []);
  assert.equal(__testInternals.genProcessName(null, 'en'), '');
  assert.deepEqual(__testInternals.genProcessNameJson(null), []);
  assert.deepEqual(__testInternals.genProcessNameJson({}), []);

  assert.deepEqual(__testInternals.getLangList(null), []);
  assert.deepEqual(
    __testInternals.getLangList({
      'common:langString': [{ '@xml:lang': 'en', '#text': 'Flow name' }, null],
    }),
    [{ '@xml:lang': 'en', '#text': 'Flow name' }],
  );
  assert.deepEqual(
    __testInternals.getLangList({
      'common:langString': {
        '@xml:lang': 'zh',
        '#text': '流程名',
      },
    }),
    [{ '@xml:lang': 'zh', '#text': '流程名' }],
  );
  assert.deepEqual(__testInternals.getLangList({ '#text': 'Fallback short name' }), [
    { '#text': 'Fallback short name' },
  ]);

  assert.equal(__testInternals.normalizeManifestRow(null), null);
  assert.deepEqual(__testInternals.getShortDescription({ flowDataSet: {} }, 'flow data set'), []);
  assert.deepEqual(
    __testInternals.getShortDescription({ processDataSet: {} }, 'process data set'),
    [],
  );
  assert.deepEqual(
    __testInternals.getShortDescription({ contactDataSet: {} }, 'contact data set'),
    [],
  );
  assert.deepEqual(
    __testInternals.getShortDescription({ sourceDataSet: {} }, 'source data set'),
    [],
  );
  assert.deepEqual(
    __testInternals.getShortDescription({ flowPropertyDataSet: {} }, 'flow property data set'),
    [],
  );
  assert.deepEqual(__testInternals.getShortDescription({}, 'flow property data set'), []);
  assert.deepEqual(
    __testInternals.getShortDescription({ unitGroupDataSet: {} }, 'unit group data set'),
    [],
  );
  assert.deepEqual(
    __testInternals.getShortDescription({ lciaMethodDataSet: {} }, 'LCIA method data set'),
    [],
  );

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-refresh-helper-'));
  try {
    const missingRowsPath = path.join(tempDir, 'missing-rows.manifest.json');
    writeFileSync(missingRowsPath, '{}\n', 'utf8');
    assert.throws(
      () => __testInternals.readManifest(missingRowsPath),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'PROCESS_REFRESH_MANIFEST_INVALID');
        return true;
      },
    );

    const explicitManifestPath = path.join(tempDir, 'explicit.manifest.json');
    writeFileSync(
      explicitManifestPath,
      `${JSON.stringify(
        {
          rows: [
            null,
            {
              id: 'proc-1',
              version: '01.00.001',
              modified_at: '2026-04-18T00:00:00.000Z',
              state_code: 0,
              model_id: 'model-1',
            },
          ],
          user_id: 'user-1',
          masked_user_email: 'us****@example.com',
          page_size: 12,
          count: 34,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    const explicitManifest = __testInternals.readManifest(explicitManifestPath);
    assert.ok(explicitManifest);
    assert.equal(explicitManifest?.rows.length, 1);
    assert.equal(explicitManifest?.page_size, 12);
    assert.equal(explicitManifest?.count, 34);

    const progressPath = path.join(tempDir, 'helper-progress.jsonl');
    writeFileSync(
      progressPath,
      [
        JSON.stringify('skip-me'),
        JSON.stringify({ key: 'proc-1:01.00.001', status: 'dry_run' }),
        JSON.stringify({ key: 'proc-2:01.00.001', status: 'saved' }),
      ].join('\n'),
      'utf8',
    );
    assert.deepEqual(Array.from(__testInternals.readCompleted(progressPath, false)), [
      'proc-1:01.00.001',
    ]);
    assert.deepEqual(Array.from(__testInternals.readCompleted(progressPath, true)), [
      'proc-2:01.00.001',
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('process refresh helper internals cover fallback branches and no-header responses', async () => {
  assert.equal(__testInternals.compareVersions('01.00.001', '01') > 0, true);
  assert.deepEqual(__testInternals.getLangList({ unexpected: true }), []);
  assert.equal(__testInternals.getLangText([{ '@xml:lang': 'zh', '#text': '' }], 'en'), '');
  assert.deepEqual(
    __testInternals.genFlowNameJson({
      baseName: ['raw'],
    }),
    [],
  );
  assert.deepEqual(
    __testInternals.genFlowNameJson({
      baseName: {
        '@xml:lang': 'en',
        '#text': 'Flow name',
      },
      treatmentStandardsRoutes: {
        '@xml:lang': 'en',
        '#text': 'hydration',
      },
      mixAndLocationTypes: {
        '@xml:lang': 'en',
        '#text': 'at plant',
      },
      flowProperties: {
        '@xml:lang': 'en',
        '#text': 'kg',
      },
    }),
    [
      {
        '@xml:lang': 'en',
        '#text': 'Flow name; hydration; at plant; kg',
      },
    ],
  );
  assert.deepEqual(
    __testInternals.genProcessNameJson({
      baseName: ['raw'],
    }),
    [],
  );
  assert.deepEqual(__testInternals.getShortDescription({ flowDataSet: '' }, 'flow data set'), []);
  assert.deepEqual(
    __testInternals.getShortDescription({ processDataSet: '' }, 'process data set'),
    [],
  );
  assert.deepEqual(
    __testInternals.getShortDescription({ contactDataSet: '' }, 'contact data set'),
    [],
  );
  assert.deepEqual(
    __testInternals.getShortDescription({ sourceDataSet: '' }, 'source data set'),
    [],
  );
  assert.deepEqual(
    __testInternals.getShortDescription({ flowPropertyDataSet: '' }, 'flow property data set'),
    [],
  );
  assert.deepEqual(
    __testInternals.getShortDescription({ unitGroupDataSet: '' }, 'unit group data set'),
    [],
  );
  assert.deepEqual(
    __testInternals.getShortDescription({ lciaMethodDataSet: '' }, 'LCIA method data set'),
    [],
  );

  const noHeaderResult = await __testInternals.fetchJsonWithRetry({
    url: 'https://example.test/refresh-no-header',
    init: { method: 'GET' },
    label: 'refresh no header',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: {
        get(): string | null {
          return null;
        },
      },
      async text(): Promise<string> {
        return 'plain-text';
      },
    }),
    timeoutMs: 10,
    maxRetries: 1,
  });
  assert.equal(noHeaderResult.headers.get('content-type'), '');
  assert.equal(noHeaderResult.headers.get('content-range'), '');
  assert.equal(noHeaderResult.body, 'plain-text');

  assert.deepEqual(
    __testInternals.normalizeManifestRow({
      id: 'proc-1',
      version: '01.00.001',
      modified_at: '',
      state_code: 'draft',
      model_id: '',
    }),
    {
      id: 'proc-1',
      version: '01.00.001',
      modified_at: null,
      state_code: null,
      model_id: null,
    },
  );

  const latestCache = new Map([
    [
      'flows:flow-1',
      {
        row: {
          id: 'flow-1',
          version: '01.00.002',
          json: {},
          modified_at: null,
          state_code: null,
          user_id: null,
          team_id: null,
        },
        count: 1,
      },
    ],
  ]);
  const update = __testInternals.updateProcessJson(
    {},
    [
      {
        node: {
          '@type': 'unsupported data set',
          '@refObjectId': 'skip-me',
          '@version': '01.00.000',
        },
        path: 'unsupported',
      },
      {
        node: {
          '@type': 'flow data set',
          '@refObjectId': 'flow-1',
          '@version': '01.00.002',
        },
        path: 'unchanged',
      },
    ],
    latestCache,
  );
  assert.equal(update.version_updates, 0);
  assert.equal(update.description_updates, 0);
  assert.equal(update.touched_refs.length, 0);
  assert.equal(update.unresolved_refs[0]?.reason, 'no accessible version');

  const refCache = new Map();
  await __testInternals.fetchLatestRefs({
    projectBaseUrl: 'https://example.test',
    publishableKey: 'publishable',
    accessToken: 'token',
    refs: [
      {
        node: {
          '@type': 'flow data set',
          '@refObjectId': 'flow-2',
          '@version': '01.00.000',
        },
        path: 'flow',
      },
    ],
    cache: refCache,
    fetchImpl: async () =>
      makeJsonResponse({
        body: {
          unexpected: true,
        },
      }),
    timeoutMs: 10,
    maxRetries: 1,
  });
  assert.deepEqual(refCache.get('flows:flow-2'), {
    row: null,
    count: 0,
  });
});

test('runProcessRefreshReferences covers missing current user ids, duplicate manifests, and empty snapshot pages', async () => {
  const missingUserDir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-refresh-no-user-'));
  try {
    await assert.rejects(
      () =>
        runProcessRefreshReferences({
          outDir: missingUserDir,
          env: buildSupabaseTestEnv({
            TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/functions/v1',
          }),
          fetchImpl: async (url) => {
            const parsed = new URL(String(url));
            if (parsed.pathname === '/auth/v1/user') {
              return makeJsonResponse({
                body: {},
              });
            }
            throw new Error(`Unexpected URL: ${String(url)}`);
          },
          maxRetries: 1,
        }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'PROCESS_REFRESH_CURRENT_USER_ID_MISSING');
        return true;
      },
    );
  } finally {
    rmSync(missingUserDir, { recursive: true, force: true });
  }

  const dedupeDir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-refresh-dedupe-'));
  try {
    const dedupeFetch = withSupabaseAuthBootstrap(async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === '/auth/v1/user') {
        return makeJsonResponse({
          body: { id: 'user-1' },
        });
      }
      if (parsed.pathname === '/rest/v1/processes') {
        const select = parsed.searchParams.get('select');
        if (select === 'id,version,modified_at,state_code,model_id') {
          return makeJsonResponse({
            body: [
              {
                id: 'proc-draft',
                version: '01.00.001',
                modified_at: '2026-04-18T00:00:00.000Z',
                state_code: 0,
                model_id: 'model-1',
              },
              {
                id: 'proc-draft',
                version: '01.00.001',
                modified_at: '2026-04-18T00:00:00.000Z',
                state_code: 0,
                model_id: 'model-1',
              },
            ],
            headers: {
              'content-type': 'application/json',
              'content-range': '0-1/2',
            },
          });
        }
        if (
          select === 'id,version,json,modified_at,state_code,model_id,user_id' &&
          parsed.searchParams.get('id') === 'eq.proc-draft'
        ) {
          return makeJsonResponse({
            body: [
              {
                id: 'proc-draft',
                version: '01.00.001',
                modified_at: '2026-04-18T00:00:00.000Z',
                state_code: 0,
                model_id: 'model-1',
                user_id: 'user-1',
                json: buildProcessPayload('flow-1', '01.00.000', 'Old flow short'),
              },
            ],
          });
        }
      }
      if (parsed.pathname === '/rest/v1/flows') {
        return makeJsonResponse({
          body: [
            {
              id: 'flow-1',
              version: '01.00.002',
              json: buildFlowPayload('Updated flow'),
            },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${String(url)}`);
    });

    const dedupeReport = await runProcessRefreshReferences({
      outDir: dedupeDir,
      env: buildSupabaseTestEnv({
        TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/functions/v1',
      }),
      fetchImpl: dedupeFetch,
      validateProcessPayloadImpl: () => ({
        ok: true,
        validator: 'test-validator',
        issue_count: 0,
        issues: [],
      }),
    });

    assert.equal(dedupeReport.counts.manifest, 1);
    assert.equal(dedupeReport.counts.selected, 1);
    assert.equal(dedupeReport.counts.pending, 1);
  } finally {
    rmSync(dedupeDir, { recursive: true, force: true });
  }

  const emptySnapshotDir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-refresh-empty-'));
  try {
    const emptySnapshotReport = await runProcessRefreshReferences({
      outDir: emptySnapshotDir,
      env: buildSupabaseTestEnv({
        TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/functions/v1',
      }),
      fetchImpl: withSupabaseAuthBootstrap(async (url) => {
        const parsed = new URL(String(url));
        if (parsed.pathname === '/auth/v1/user') {
          return makeJsonResponse({
            body: { id: 'user-1' },
          });
        }
        if (parsed.pathname === '/rest/v1/processes') {
          return makeJsonResponse({
            body: [{ id: '', version: '01.00.001' }],
            headers: {
              'content-type': 'application/json',
              'content-range': '0-0/1',
            },
          });
        }
        throw new Error(`Unexpected URL: ${String(url)}`);
      }),
      validateProcessPayloadImpl: () => ({
        ok: true,
        validator: 'test-validator',
        issue_count: 0,
        issues: [],
      }),
    });

    assert.equal(emptySnapshotReport.status, 'completed_process_reference_refresh');
    assert.deepEqual(emptySnapshotReport.counts, {
      manifest: 0,
      selected: 0,
      already_completed: 0,
      pending: 0,
      saved: 0,
      dry_run: 0,
      skipped: 0,
      validation_blocked: 0,
      errors: 0,
    });
  } finally {
    rmSync(emptySnapshotDir, { recursive: true, force: true });
  }
});

test('runProcessRefreshReferences covers runtime defaults, reused manifests, and fallback detail fields', async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-refresh-runtime-defaults-'));
  const manifestPath = path.join(tempDir, 'inputs', 'processes.manifest.json');
  const envPatch = buildSupabaseTestEnv({
    TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/functions/v1',
  });
  const envBackup = new Map(Object.keys(envPatch).map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;

  try {
    mkdirSync(path.join(tempDir, 'inputs'), { recursive: true });
    writeFileSync(
      manifestPath,
      `${JSON.stringify(
        {
          rows: [
            {
              id: 'proc-default',
              version: '01.00.001',
              modified_at: '2026-04-18T00:00:00.000Z',
              state_code: 0,
              model_id: null,
            },
          ],
          user_id: 'user-1',
          masked_user_email: 'us****@example.com',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    Object.assign(process.env, envPatch);
    globalThis.fetch = (async (input) => {
      const url = String(input);
      const parsed = new URL(url);

      if (isSupabaseAuthTokenUrl(url)) {
        return makeSupabaseAuthResponse({
          userId: 'user-1',
        });
      }

      if (parsed.pathname === '/auth/v1/user') {
        return makeJsonResponse({
          body: { id: 'user-1' },
        });
      }

      if (
        parsed.pathname === '/rest/v1/processes' &&
        parsed.searchParams.get('select') ===
          'id,version,json,modified_at,state_code,model_id,user_id' &&
        parsed.searchParams.get('id') === 'eq.proc-default'
      ) {
        return makeJsonResponse({
          body: [
            {
              json: buildProcessPayload('flow-1', '01.00.002', 'Old flow short'),
            },
          ],
        });
      }

      if (parsed.pathname === '/rest/v1/flows') {
        return makeJsonResponse({
          body: [
            {
              id: 'flow-1',
              version: '01.00.002',
              json: buildFlowPayload('Updated flow'),
            },
          ],
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    const report = await runProcessRefreshReferences({
      outDir: tempDir,
      reuseManifest: true,
      timeoutMs: 10,
      maxRetries: 1,
      validateProcessPayloadImpl: () => ({
        ok: true,
        validator: 'test-validator',
        issue_count: 0,
        issues: [],
      }),
    });

    assert.equal(report.status, 'completed_process_reference_refresh');
    assert.equal(report.counts.manifest, 1);
    assert.equal(report.counts.pending, 1);
    assert.equal(report.counts.dry_run, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of envBackup) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runProcessRefreshReferences covers non-array auth, snapshot, and detail responses plus string failures', async () => {
  const missingUserDir = mkdtempSync(
    path.join(os.tmpdir(), 'tg-cli-process-refresh-no-user-array-'),
  );
  try {
    await assert.rejects(
      () =>
        runProcessRefreshReferences({
          outDir: missingUserDir,
          env: buildSupabaseTestEnv({
            TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/functions/v1',
          }),
          fetchImpl: async (url) => {
            const parsed = new URL(String(url));
            if (parsed.pathname === '/auth/v1/user') {
              return makeJsonResponse({
                body: [],
              });
            }
            throw new Error(`Unexpected URL: ${String(url)}`);
          },
          maxRetries: 1,
        }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'PROCESS_REFRESH_CURRENT_USER_ID_MISSING');
        return true;
      },
    );
  } finally {
    rmSync(missingUserDir, { recursive: true, force: true });
  }

  const emptySnapshotDir = mkdtempSync(
    path.join(os.tmpdir(), 'tg-cli-process-refresh-empty-object-snapshot-'),
  );
  try {
    const report = await runProcessRefreshReferences({
      outDir: emptySnapshotDir,
      env: buildSupabaseTestEnv({
        TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/functions/v1',
      }),
      fetchImpl: withSupabaseAuthBootstrap(async (url) => {
        const parsed = new URL(String(url));
        if (parsed.pathname === '/auth/v1/user') {
          return makeJsonResponse({
            body: { id: 'user-1' },
          });
        }
        if (parsed.pathname === '/rest/v1/processes') {
          return makeJsonResponse({
            body: {
              unexpected: true,
            },
            headers: {
              'content-type': 'application/json',
            },
          });
        }
        throw new Error(`Unexpected URL: ${String(url)}`);
      }),
      validateProcessPayloadImpl: () => ({
        ok: true,
        validator: 'test-validator',
        issue_count: 0,
        issues: [],
      }),
    });

    assert.equal(report.counts.manifest, 0);
    assert.equal(report.counts.pending, 0);
  } finally {
    rmSync(emptySnapshotDir, { recursive: true, force: true });
  }

  const detailObjectDir = mkdtempSync(
    path.join(os.tmpdir(), 'tg-cli-process-refresh-detail-object-'),
  );
  try {
    const report = await runProcessRefreshReferences({
      outDir: detailObjectDir,
      env: buildSupabaseTestEnv({
        TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/functions/v1',
      }),
      fetchImpl: withSupabaseAuthBootstrap(async (url) => {
        const parsed = new URL(String(url));
        if (parsed.pathname === '/auth/v1/user') {
          return makeJsonResponse({
            body: { id: 'user-1' },
          });
        }
        if (parsed.pathname === '/rest/v1/processes') {
          const select = parsed.searchParams.get('select');
          if (select === 'id,version,modified_at,state_code,model_id') {
            return makeJsonResponse({
              body: [
                {
                  id: 'proc-error',
                  version: '01.00.001',
                  modified_at: '2026-04-18T00:00:00.000Z',
                  state_code: 0,
                  model_id: 'model-1',
                },
              ],
              headers: {
                'content-type': 'application/json',
                'content-range': '0-0/1',
              },
            });
          }
          if (
            select === 'id,version,json,modified_at,state_code,model_id,user_id' &&
            parsed.searchParams.get('id') === 'eq.proc-error'
          ) {
            return makeJsonResponse({
              body: {
                unexpected: true,
              },
            });
          }
        }
        throw new Error(`Unexpected URL: ${String(url)}`);
      }),
      validateProcessPayloadImpl: () => ({
        ok: true,
        validator: 'test-validator',
        issue_count: 0,
        issues: [],
      }),
    });

    assert.equal(report.status, 'completed_process_reference_refresh_with_errors');
    assert.equal(report.counts.errors, 1);
  } finally {
    rmSync(detailObjectDir, { recursive: true, force: true });
  }

  const stringFailureDir = mkdtempSync(
    path.join(os.tmpdir(), 'tg-cli-process-refresh-string-failure-'),
  );
  try {
    const report = await runProcessRefreshReferences({
      outDir: stringFailureDir,
      env: buildSupabaseTestEnv({
        TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/functions/v1',
      }),
      fetchImpl: withSupabaseAuthBootstrap(async (url) => {
        const parsed = new URL(String(url));
        if (parsed.pathname === '/auth/v1/user') {
          return makeJsonResponse({
            body: { id: 'user-1' },
          });
        }
        if (parsed.pathname === '/rest/v1/processes') {
          const select = parsed.searchParams.get('select');
          if (select === 'id,version,modified_at,state_code,model_id') {
            return makeJsonResponse({
              body: [
                {
                  id: 'proc-string',
                  version: '01.00.001',
                  modified_at: '2026-04-18T00:00:00.000Z',
                  state_code: 0,
                  model_id: 'model-1',
                },
              ],
              headers: {
                'content-type': 'application/json',
                'content-range': '0-0/1',
              },
            });
          }
          if (
            select === 'id,version,json,modified_at,state_code,model_id,user_id' &&
            parsed.searchParams.get('id') === 'eq.proc-string'
          ) {
            return makeJsonResponse({
              body: [
                {
                  id: 'proc-string',
                  version: '01.00.001',
                  modified_at: '2026-04-18T00:00:00.000Z',
                  state_code: 0,
                  model_id: 'model-1',
                  user_id: 'user-1',
                  json: buildProcessPayload('flow-1', '01.00.000', 'Old flow short'),
                },
              ],
            });
          }
        }
        if (parsed.pathname === '/rest/v1/flows') {
          return makeJsonResponse({
            body: [
              {
                id: 'flow-1',
                version: '01.00.002',
                json: buildFlowPayload('Updated flow'),
              },
            ],
          });
        }
        throw new Error(`Unexpected URL: ${String(url)}`);
      }),
      validateProcessPayloadImpl: () => {
        throw 'string failure';
      },
    });

    assert.equal(report.counts.errors, 1);
    const errorRows = readFileSync(report.files.errors_jsonl, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { error: string });
    assert.equal(errorRows[0]?.error, 'string failure');
  } finally {
    rmSync(stringFailureDir, { recursive: true, force: true });
  }
});
