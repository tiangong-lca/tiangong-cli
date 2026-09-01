import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { __testInternals, runProcessScopeStatistics } from '../src/lib/process-scope-statistics.js';
import type { FetchLike } from '../src/lib/http.js';
import {
  buildSupabaseTestEnv,
  isSupabaseAuthTokenUrl,
  makeSupabaseAuthResponse,
} from './helpers/supabase-auth.js';

type JsonRecord = Record<string, unknown>;

function jsonResponse(payload: unknown, headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name: string): string | null {
        return (
          headers[name.toLowerCase()] ??
          (name.toLowerCase() === 'content-type' ? 'application/json' : null)
        );
      },
    },
    text: async () => JSON.stringify(payload),
  };
}

function responseLike(options: {
  ok?: boolean;
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: {
      get(name: string): string | null {
        return options.headers?.[name.toLowerCase()] ?? null;
      },
    },
    text: async () => options.body ?? '',
  };
}

function langEntries(en: string, zh: string): JsonRecord[] {
  return [
    { '@xml:lang': 'en', '#text': en },
    { '@xml:lang': 'zh', '#text': zh },
  ];
}

function createProcessPayload(options: {
  primaryDomain: string;
  leafDomain: string;
  route?: string;
  routeZh?: string;
  technology: string;
  technologyZh: string;
  typeOfDataSet: string;
  referenceFlowId: string;
  referenceFlowVersion?: string;
  referenceFlowLabelEn: string;
  referenceFlowLabelZh: string;
  baseNameEn: string;
  baseNameZh: string;
}): JsonRecord {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          name: {
            baseName: langEntries(options.baseNameEn, options.baseNameZh),
            treatmentStandardsRoutes: options.route
              ? langEntries(options.route, options.routeZh ?? options.route)
              : '',
          },
          classificationInformation: {
            'common:classification': {
              'common:class': [
                {
                  '@level': '1',
                  '#text': options.primaryDomain,
                },
                {
                  '@level': '2',
                  '#text': options.leafDomain,
                },
              ],
            },
          },
        },
        technology: {
          technologyDescriptionAndIncludedProcesses: langEntries(
            options.technology,
            options.technologyZh,
          ),
        },
        quantitativeReference: {
          referenceToReferenceFlow: '1',
        },
      },
      modellingAndValidation: {
        LCIMethodAndAllocation: {
          typeOfDataSet: options.typeOfDataSet,
        },
      },
      exchanges: {
        exchange: [
          {
            '@dataSetInternalID': '1',
            exchangeDirection: 'Output',
            meanAmount: '1',
            resultingAmount: '1',
            referenceToFlowDataSet: {
              '@refObjectId': options.referenceFlowId,
              '@version': options.referenceFlowVersion ?? '01.00.000',
              'common:shortDescription': langEntries(
                options.referenceFlowLabelEn,
                options.referenceFlowLabelZh,
              ),
            },
          },
        ],
      },
    },
  };
}

test('process scope helper internals cover sparse classification entries', () => {
  assert.deepEqual(
    __testInternals.extractClassificationEntries({
      classificationInformation: {
        'common:classification': {
          'common:class': [
            null,
            {
              '@level': '1',
              '#text': '',
            },
            {
              '@level': '2',
              '#text': 'Paper sorting',
            },
          ],
        },
      },
    }),
    [
      {
        level: 2,
        text: 'Paper sorting',
      },
    ],
  );
});

test('runProcessScopeStatistics fetches visible process rows and writes summary artifacts', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-scope-'));

  const fetchImpl = (async (input) => {
    const url = String(input);
    if (isSupabaseAuthTokenUrl(url)) {
      return makeSupabaseAuthResponse();
    }
    if (url.includes('/rest/v1/processes?')) {
      return jsonResponse(
        [
          {
            id: 'proc-1',
            version: '01.00.000',
            state_code: 100,
            user_id: 'user-1',
            modified_at: '2026-04-17T00:00:00.000Z',
            model_id: 'model-1',
            json: createProcessPayload({
              primaryDomain: 'Waste management',
              leafDomain: 'Paper sorting',
              route: 'Sorting',
              routeZh: '分选',
              technology: 'Sorting line. downstream note',
              technologyZh: '分选线。附加说明',
              typeOfDataSet: 'Unit process, single operation',
              referenceFlowId: 'flow-product-1',
              referenceFlowLabelEn: 'sorted waste paper',
              referenceFlowLabelZh: '分选废纸',
              baseNameEn: 'Waste paper sorting',
              baseNameZh: '废纸分选',
            }),
          },
          {
            id: 'proc-2',
            version: '01.00.000',
            state_code: 100,
            user_id: 'user-2',
            modified_at: '2026-04-17T01:00:00.000Z',
            model_id: 'model-2',
            json: createProcessPayload({
              primaryDomain: 'Waste management',
              leafDomain: 'Transport',
              technology: 'Transport service. additional note',
              technologyZh: '运输服务。附加说明',
              typeOfDataSet: 'Aggregated process',
              referenceFlowId: '',
              referenceFlowLabelEn: 'transport service',
              referenceFlowLabelZh: '运输服务',
              baseNameEn: 'Waste transfer',
              baseNameZh: '废弃物转运',
            }),
          },
        ],
        {
          'content-type': 'application/json',
          'content-range': '0-1/2',
        },
      );
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as FetchLike;

  try {
    const report = await runProcessScopeStatistics({
      outDir: dir,
      scope: 'visible',
      stateCodes: [100],
      env: buildSupabaseTestEnv(),
      fetchImpl,
      now: new Date('2026-04-18T00:00:00.000Z'),
    });

    assert.equal(report.status, 'completed_process_scope_statistics');
    assert.equal(report.total_process_rows, 2);
    assert.equal(report.domain_count_primary, 1);
    assert.equal(report.domain_count_leaf, 2);
    assert.equal(report.craft_count, 2);
    assert.equal(report.unit_process_rows, 1);
    assert.equal(report.product_count, 2);
    assert.equal(existsSync(report.files.process_scope_summary), true);
    assert.equal(existsSync(report.files.report), true);
    assert.equal(existsSync(report.files.report_zh), true);

    const summary = JSON.parse(readFileSync(report.files.process_scope_summary, 'utf8')) as {
      total_process_rows: number;
      rows_by_state_code: Record<string, number>;
      distinct_visible_owner_user_ids: number;
      products_with_flow_id: number;
      products_without_flow_id: number;
      rows_missing_reference_exchange: number;
    };

    assert.equal(summary.total_process_rows, 2);
    assert.deepEqual(summary.rows_by_state_code, { '100': 2 });
    assert.equal(summary.distinct_visible_owner_user_ids, 2);
    assert.equal(summary.products_with_flow_id, 1);
    assert.equal(summary.products_without_flow_id, 1);
    assert.equal(summary.rows_missing_reference_exchange, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessScopeStatistics can reuse a prior snapshot without remote fetches', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-scope-reuse-'));

  const fetchImpl = (async (input) => {
    const url = String(input);
    if (isSupabaseAuthTokenUrl(url)) {
      return makeSupabaseAuthResponse();
    }
    if (url.includes('/rest/v1/processes?')) {
      return jsonResponse(
        [
          {
            id: 'proc-1',
            version: '01.00.000',
            state_code: 100,
            user_id: 'user-1',
            modified_at: '2026-04-17T00:00:00.000Z',
            model_id: 'model-1',
            json: createProcessPayload({
              primaryDomain: 'Waste management',
              leafDomain: 'Paper sorting',
              route: 'Sorting',
              routeZh: '分选',
              technology: 'Sorting line. downstream note',
              technologyZh: '分选线。附加说明',
              typeOfDataSet: 'Unit process, single operation',
              referenceFlowId: 'flow-product-1',
              referenceFlowLabelEn: 'sorted waste paper',
              referenceFlowLabelZh: '分选废纸',
              baseNameEn: 'Waste paper sorting',
              baseNameZh: '废纸分选',
            }),
          },
        ],
        {
          'content-type': 'application/json',
          'content-range': '0-0/1',
        },
      );
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as FetchLike;

  try {
    const first = await runProcessScopeStatistics({
      outDir: dir,
      stateCodes: [100],
      env: buildSupabaseTestEnv(),
      fetchImpl,
      now: new Date('2026-04-18T01:00:00.000Z'),
    });
    assert.equal(first.total_process_rows, 1);

    const reused = await runProcessScopeStatistics({
      outDir: dir,
      stateCodes: [100],
      reuseSnapshot: true,
      fetchImpl: (async () => {
        throw new Error('reuseSnapshot should not fetch');
      }) as FetchLike,
      now: new Date('2026-04-18T02:00:00.000Z'),
    });

    assert.equal(reused.total_process_rows, 1);
    const summary = JSON.parse(readFileSync(reused.files.process_scope_summary, 'utf8')) as {
      total_process_rows: number;
      total_rows_reported_by_remote: number | null;
    };
    assert.equal(summary.total_process_rows, 1);
    assert.equal(summary.total_rows_reported_by_remote, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessScopeStatistics validates outDir and supports current-user scope resolution', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-scope-current-user-'));

  try {
    await assert.rejects(
      () => runProcessScopeStatistics({ outDir: '' }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'PROCESS_SCOPE_OUT_DIR_REQUIRED');
        return true;
      },
    );

    const fetchImpl = (async (input) => {
      const url = String(input);
      if (isSupabaseAuthTokenUrl(url)) {
        return makeSupabaseAuthResponse({ userId: 'user-1' });
      }
      if (url.endsWith('/auth/v1/user')) {
        return jsonResponse({ id: 'user-1' });
      }
      if (url.includes('/rest/v1/processes?') && url.includes('user_id=eq.user-1')) {
        return jsonResponse(
          [
            {
              id: 'proc-1',
              version: '01.00.000',
              state_code: 0,
              user_id: 'user-1',
              modified_at: '2026-04-17T00:00:00.000Z',
              model_id: 'model-1',
              json: createProcessPayload({
                primaryDomain: 'Waste management',
                leafDomain: 'Paper sorting',
                route: 'Sorting',
                routeZh: '分选',
                technology: 'Sorting line. downstream note',
                technologyZh: '分选线。附加说明',
                typeOfDataSet: 'Unit process, single operation',
                referenceFlowId: 'flow-product-1',
                referenceFlowLabelEn: 'sorted waste paper',
                referenceFlowLabelZh: '分选废纸',
                baseNameEn: 'Waste paper sorting',
                baseNameZh: '废纸分选',
              }),
            },
          ],
          {
            'content-type': 'application/json',
            'content-range': '0-0/1',
          },
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    }) as FetchLike;

    const report = await runProcessScopeStatistics({
      outDir: dir,
      scope: 'current-user',
      stateCodes: [0],
      env: buildSupabaseTestEnv(),
      fetchImpl,
      now: new Date('2026-04-18T03:00:00.000Z'),
    });

    assert.equal(report.status, 'completed_process_scope_statistics');
    assert.equal(report.total_process_rows, 1);
    assert.equal(report.files.snapshot_manifest.endsWith('processes.snapshot.manifest.json'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessScopeStatistics counts rows that are missing products and reference exchanges', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-scope-missing-product-'));

  const fetchImpl = (async (input) => {
    const url = String(input);
    if (isSupabaseAuthTokenUrl(url)) {
      return makeSupabaseAuthResponse();
    }
    if (url.includes('/rest/v1/processes?')) {
      return jsonResponse(
        [
          {
            id: 'proc-missing',
            version: '01.00.000',
            state_code: 100,
            user_id: 'user-1',
            modified_at: '2026-04-17T00:00:00.000Z',
            model_id: 'model-1',
            json: {
              processDataSet: {
                processInformation: 'bad-data',
                modellingAndValidation: 'bad-data',
                exchanges: {
                  exchange: [],
                },
              },
            },
          },
        ],
        {
          'content-type': 'application/json',
          'content-range': '0-0/1',
        },
      );
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as FetchLike;

  try {
    const report = await runProcessScopeStatistics({
      outDir: dir,
      scope: 'visible',
      stateCodes: [100],
      env: buildSupabaseTestEnv(),
      fetchImpl,
      now: new Date('2026-04-18T04:00:00.000Z'),
    });

    const summary = JSON.parse(readFileSync(report.files.process_scope_summary, 'utf8')) as {
      products_without_flow_id: number;
      rows_missing_product: number;
      rows_missing_reference_exchange: number;
      product_count: number;
    };
    assert.equal(summary.product_count, 0);
    assert.equal(summary.products_without_flow_id, 0);
    assert.equal(summary.rows_missing_product, 1);
    assert.equal(summary.rows_missing_reference_exchange, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessScopeStatistics falls back to process base names when reference-flow labels are missing', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-scope-base-name-product-'));

  const fetchImpl = (async (input) => {
    const url = String(input);
    if (isSupabaseAuthTokenUrl(url)) {
      return makeSupabaseAuthResponse();
    }
    if (url.includes('/rest/v1/processes?')) {
      return jsonResponse(
        [
          {
            id: 'proc-base-name',
            version: '01.00.000',
            state_code: 100,
            user_id: 'user-1',
            modified_at: '2026-04-17T00:00:00.000Z',
            model_id: 'model-1',
            json: {
              processDataSet: {
                processInformation: {
                  dataSetInformation: {
                    name: {
                      baseName: langEntries('Fallback product', '回退产品'),
                    },
                  },
                  quantitativeReference: {
                    referenceToReferenceFlow: '1',
                  },
                },
                modellingAndValidation: {
                  LCIMethodAndAllocation: {
                    typeOfDataSet: 'Aggregated process',
                  },
                },
                exchanges: {
                  exchange: [],
                },
              },
            },
          },
        ],
        {
          'content-type': 'application/json',
          'content-range': '0-0/1',
        },
      );
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as FetchLike;

  try {
    const report = await runProcessScopeStatistics({
      outDir: dir,
      scope: 'visible',
      stateCodes: [100],
      env: buildSupabaseTestEnv(),
      fetchImpl,
      now: new Date('2026-04-18T05:00:00.000Z'),
    });

    const summary = JSON.parse(readFileSync(report.files.process_scope_summary, 'utf8')) as {
      product_count: number;
      products_without_flow_id: number;
      rows_missing_reference_exchange: number;
    };
    assert.equal(summary.product_count, 1);
    assert.equal(summary.products_without_flow_id, 1);
    assert.equal(summary.rows_missing_reference_exchange, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('process scope helper internals cover option parsing, response parsing, and payload normalization', async () => {
  assert.equal(
    __testInternals.toPositiveInteger(5, '--page-size', 'PROCESS_SCOPE_TEST_INVALID'),
    5,
  );
  assert.throws(
    () => __testInternals.toPositiveInteger(0, '--page-size', 'PROCESS_SCOPE_TEST_INVALID'),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'PROCESS_SCOPE_TEST_INVALID');
      return true;
    },
  );

  assert.deepEqual(__testInternals.normalizeStateCodes(undefined), [0, 100]);
  assert.throws(
    () => __testInternals.normalizeStateCodes([-1]),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'PROCESS_SCOPE_STATE_CODES_INVALID');
      return true;
    },
  );
  const noIteration = [100] as number[];
  noIteration[Symbol.iterator] = () => [][Symbol.iterator]();
  assert.throws(
    () => __testInternals.normalizeStateCodes(noIteration),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'PROCESS_SCOPE_STATE_CODES_REQUIRED');
      return true;
    },
  );

  assert.equal(__testInternals.ensureScope(undefined), 'visible');
  assert.equal(__testInternals.ensureScope('current-user'), 'current-user');
  assert.throws(
    () => __testInternals.ensureScope('drafts'),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'PROCESS_SCOPE_SCOPE_INVALID');
      return true;
    },
  );

  assert.equal(
    await __testInternals.parseJsonResponse(
      responseLike({
        headers: { 'content-type': 'application/json' },
      }),
      'scope empty body',
    ),
    null,
  );
  assert.equal(
    await __testInternals.parseJsonResponse(
      responseLike({
        body: 'plain-text',
        headers: { 'content-type': 'text/plain' },
      }),
      'scope text body',
    ),
    'plain-text',
  );
  await assert.rejects(
    () =>
      __testInternals.parseJsonResponse(
        responseLike({
          body: '{',
          headers: { 'content-type': 'application/json' },
        }),
        'scope invalid json',
      ),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'PROCESS_SCOPE_REMOTE_INVALID_JSON');
      return true;
    },
  );

  await assert.rejects(
    () =>
      __testInternals.fetchJsonWithRetry({
        url: 'https://example.test/scope-http-error',
        init: { method: 'GET' },
        label: 'scope http error',
        fetchImpl: async () =>
          responseLike({
            ok: false,
            status: 500,
            body: JSON.stringify({ error: 'failed' }),
            headers: { 'content-type': 'application/json' },
          }),
        timeoutMs: 10,
        maxRetries: 1,
      }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'PROCESS_SCOPE_REMOTE_REQUEST_FAILED');
      return true;
    },
  );

  const originalSetTimeout = globalThis.setTimeout;
  const retryDelays: number[] = [];
  globalThis.setTimeout = ((
    callback: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ) => {
    retryDelays.push(Number(ms ?? 0));
    callback(...args);
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  try {
    let attempts = 0;
    const retryResult = await __testInternals.fetchJsonWithRetry({
      url: 'https://example.test/scope-retry',
      init: { method: 'GET' },
      label: 'scope retry',
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('temporary failure');
        }
        return responseLike({
          body: JSON.stringify({ ok: true }),
          headers: { 'content-type': 'application/json' },
        });
      },
      timeoutMs: 10,
      maxRetries: 2,
    });
    assert.equal(attempts, 2);
    assert.deepEqual(retryDelays, [1500]);
    assert.deepEqual(retryResult.body, { ok: true });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  await assert.rejects(
    () =>
      __testInternals.fetchJsonWithRetry({
        url: 'https://example.test/scope-transport-failure',
        init: { method: 'GET' },
        label: 'scope transport failure',
        fetchImpl: async () => {
          throw new Error('network unavailable');
        },
        timeoutMs: 10,
        maxRetries: 1,
      }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'PROCESS_SCOPE_REMOTE_REQUEST_FAILED');
      return true;
    },
  );

  await assert.rejects(
    () =>
      __testInternals.resolveCurrentUserId({
        env: buildSupabaseTestEnv(),
        fetchImpl: async (input) => {
          const url = String(input);
          if (url.endsWith('/auth/v1/user')) {
            return jsonResponse({});
          }
          if (isSupabaseAuthTokenUrl(url)) {
            return makeSupabaseAuthResponse({ userId: 'user-1' });
          }
          throw new Error(`Unexpected URL: ${url}`);
        },
        timeoutMs: 10,
        maxRetries: 1,
        now: new Date('2026-04-18T06:00:00.000Z'),
      }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'PROCESS_SCOPE_CURRENT_USER_ID_MISSING');
      return true;
    },
  );

  assert.equal(__testInternals.normalizeSnapshotRow(null), null);
  assert.equal(
    __testInternals.normalizeSnapshotRow({
      id: 'proc-1',
      version: '01.00.000',
      json: null,
    }),
    null,
  );
  assert.deepEqual(__testInternals.normalizePayload({ ok: true }), { ok: true });
  assert.deepEqual(__testInternals.normalizePayload('{"ok":true}'), { ok: true });
  assert.equal(__testInternals.normalizePayload('['), null);
  assert.equal(__testInternals.normalizePayload(''), null);

  assert.deepEqual(
    __testInternals.getLangList({
      'common:langString': {
        '@xml:lang': 'zh',
        '#text': '中文',
      },
    }),
    [{ '@xml:lang': 'zh', '#text': '中文' }],
  );
  assert.deepEqual(
    __testInternals.getLangList({
      'common:langString': [{ '@xml:lang': 'en', '#text': 'English' }, null],
    }),
    [{ '@xml:lang': 'en', '#text': 'English' }],
  );
  assert.deepEqual(__testInternals.getLangList({ '@xml:lang': 'en', '#text': 'English' }), [
    { '@xml:lang': 'en', '#text': 'English' },
  ]);
  assert.deepEqual(__testInternals.getLangList('Fallback'), [
    { '@xml:lang': 'en', '#text': 'Fallback' },
  ]);
  assert.deepEqual(__testInternals.getLangList(123), []);
});

test('process scope helper internals cover sparse fallbacks and zero-row statistics', async () => {
  assert.equal(
    await __testInternals.parseJsonResponse(
      responseLike({
        body: 'plain-text',
      }),
      'scope text without header',
    ),
    'plain-text',
  );

  const noHeaderResult = await __testInternals.fetchJsonWithRetry({
    url: 'https://example.test/scope-no-header',
    init: { method: 'GET' },
    label: 'scope no header',
    fetchImpl: async () =>
      responseLike({
        body: '{"ok":true}',
      }),
    timeoutMs: 10,
    maxRetries: 1,
  });
  assert.equal(noHeaderResult.headers.get('content-type'), '');
  assert.equal(noHeaderResult.headers.get('content-range'), '');
  assert.equal(noHeaderResult.body, '{"ok":true}');

  await assert.rejects(
    () =>
      __testInternals.resolveCurrentUserId({
        env: buildSupabaseTestEnv(),
        fetchImpl: async (input) => {
          const url = String(input);
          if (url.endsWith('/auth/v1/user')) {
            return jsonResponse([]);
          }
          if (isSupabaseAuthTokenUrl(url)) {
            return makeSupabaseAuthResponse({ userId: 'user-1' });
          }
          throw new Error(`Unexpected URL: ${url}`);
        },
        timeoutMs: 10,
        maxRetries: 1,
        now: new Date('2026-04-18T06:30:00.000Z'),
      }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'PROCESS_SCOPE_CURRENT_USER_ID_MISSING');
      return true;
    },
  );

  assert.deepEqual(
    __testInternals.normalizeSnapshotRow({
      id: 'proc-1',
      version: '01.00.000',
      state_code: 'draft',
      user_id: '',
      modified_at: '',
      model_id: '',
      json: {},
    }),
    {
      id: 'proc-1',
      version: '01.00.000',
      state_code: null,
      user_id: null,
      modified_at: null,
      model_id: null,
      json: {},
    },
  );
  assert.equal(__testInternals.normalizePayload('[1]'), null);
  assert.deepEqual(__testInternals.getLangList({ '@xml:lang': 'en' }), [{ '@xml:lang': 'en' }]);
  assert.equal(__testInternals.getLangText([{ '@xml:lang': 'zh', '#text': '' }], 'en'), '');
  assert.deepEqual(
    __testInternals.extractClassificationEntries({
      classificationInformation: {
        'common:classification': {
          'common:class': {
            '#text': 'Fallback domain',
          },
        },
      },
    }),
    [
      {
        level: 0,
        text: 'Fallback domain',
      },
    ],
  );
  assert.deepEqual(
    __testInternals.extractCraftCandidate(
      {
        name: {
          baseName: langEntries('Base fallback', '基础回退'),
        },
      },
      {},
    ),
    {
      source_kind: 'baseName',
      label: 'Base fallback',
      signature: 'base fallback',
    },
  );
  assert.deepEqual(
    __testInternals.extractReferenceProduct(
      {
        processInformation: {
          quantitativeReference: {
            referenceToReferenceFlow: '9',
          },
        },
        exchanges: {
          exchange: [
            {
              '@dataSetInternalID': '9',
              referenceToFlowDataSet: {
                '@refObjectId': 'flow-9',
              },
            },
          ],
        },
      },
      {
        name: {},
      },
    ),
    {
      key: 'flow:flow-9',
      stable_flow_id: 'flow-9',
      stable_flow_version: '',
      label: 'flow-9',
      source_kind: 'reference_flow_id',
      missing_reference_exchange: false,
    },
  );
  assert.deepEqual(
    __testInternals.extractReferenceProduct(
      {
        processInformation: {},
        exchanges: {},
      },
      {
        name: {},
      },
    ),
    {
      key: '',
      stable_flow_id: '',
      stable_flow_version: '',
      label: '',
      source_kind: 'missing',
      missing_reference_exchange: true,
    },
  );

  const sparseStatistics = __testInternals.calculateStatistics(
    [
      {
        id: 'proc-null',
        version: '01.00.000',
        state_code: null,
        user_id: null,
        modified_at: null,
        model_id: null,
        json: {},
      },
      {
        id: 'proc-fallback',
        version: '01.00.001',
        state_code: 0,
        user_id: null,
        modified_at: null,
        model_id: null,
        json: {
          processDataSet: {
            processInformation: {
              dataSetInformation: {
                name: {
                  baseName: langEntries('Fallback base', '基础回退'),
                },
                classificationInformation: {
                  'common:classification': {
                    'common:class': {
                      '@level': '2',
                      '#text': 'Fallback leaf',
                    },
                  },
                },
              },
              technology: {},
            },
            modellingAndValidation: {
              LCIMethodAndAllocation: {
                typeOfDataSet: 'Aggregated process',
              },
            },
            exchanges: {},
          },
        },
      },
    ],
    {
      scope: 'visible',
      stateCodes: [0],
    },
    {
      userId: null,
      maskedUserEmail: null,
      totalRowsReportedByRemote: null,
    },
    '2026-04-18T06:45:00.000Z',
  );
  assert.deepEqual(sparseStatistics.summary.rows_by_state_code, {
    '0': 1,
    null: 1,
  });
  assert.equal(sparseStatistics.summary.distinct_visible_owner_user_ids, 1);
  assert.equal(sparseStatistics.summary.domain_count_primary, 1);
  assert.equal(sparseStatistics.domainPrimarySummary[0]?.domain, 'Fallback leaf');
  assert.equal(sparseStatistics.summary.rows_missing_classification, 1);
  assert.equal(sparseStatistics.summary.rows_missing_craft, 1);
  assert.equal(sparseStatistics.summary.rows_missing_product, 1);
  assert.equal(sparseStatistics.summary.rows_missing_reference_exchange, 2);

  const emptyStatistics = __testInternals.calculateStatistics(
    [],
    {
      scope: 'visible',
      stateCodes: [0],
    },
    {
      userId: null,
      maskedUserEmail: null,
      totalRowsReportedByRemote: 0,
    },
    '2026-04-18T06:50:00.000Z',
  );
  assert.equal(emptyStatistics.summary.unit_process_share, 0);
  assert.equal(__testInternals.escapePipe(undefined), '');
});

test('process scope fetch internals cover null current-user ids and non-array pages', async () => {
  const urls: string[] = [];
  const result = await __testInternals.fetchProcessRows({
    env: buildSupabaseTestEnv(),
    fetchImpl: (async (input) => {
      const url = String(input);
      urls.push(url);
      if (isSupabaseAuthTokenUrl(url)) {
        return makeSupabaseAuthResponse({ userId: 'user-1' });
      }
      if (url.includes('/rest/v1/processes?') && url.includes('user_id=eq.')) {
        return jsonResponse(
          {
            unexpected: true,
          },
          {
            'content-type': 'application/json',
          },
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as FetchLike,
    timeoutMs: 10,
    maxRetries: 1,
    scope: 'current-user',
    stateCodes: [0],
    pageSize: 10,
    userId: null,
  });

  assert.equal(result.rows.length, 0);
  assert.equal(result.total, null);
  assert.equal(
    urls.some((url) => url.includes('user_id=eq.')),
    true,
  );
});

test('runProcessScopeStatistics covers snapshot-manifest and runtime defaults', async () => {
  const reuseDir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-scope-reuse-fallback-'));
  try {
    const snapshotRowsPath = path.join(reuseDir, 'inputs', 'processes.snapshot.rows.jsonl');
    const snapshotManifestPath = path.join(reuseDir, 'inputs', 'processes.snapshot.manifest.json');
    mkdirSync(path.join(reuseDir, 'inputs'), { recursive: true });
    writeFileSync(
      snapshotRowsPath,
      `${JSON.stringify({
        id: 'proc-reused',
        version: '01.00.000',
        state_code: 100,
        user_id: 'user-1',
        modified_at: '2026-04-18T07:00:00.000Z',
        model_id: 'model-1',
        json: createProcessPayload({
          primaryDomain: 'Waste management',
          leafDomain: 'Paper sorting',
          route: 'Sorting',
          routeZh: '分选',
          technology: 'Sorting line',
          technologyZh: '分选线',
          typeOfDataSet: 'Unit process, single operation',
          referenceFlowId: 'flow-1',
          referenceFlowLabelEn: 'sorted paper',
          referenceFlowLabelZh: '分选纸张',
          baseNameEn: 'Waste paper sorting',
          baseNameZh: '废纸分选',
        }),
      })}\n`,
      'utf8',
    );
    writeFileSync(snapshotManifestPath, '[]\n', 'utf8');

    assert.equal(__testInternals.readSnapshotManifest(snapshotManifestPath), null);

    const reused = await runProcessScopeStatistics({
      outDir: reuseDir,
      reuseSnapshot: true,
      now: new Date('2026-04-18T07:05:00.000Z'),
    });

    const reusedSummary = JSON.parse(readFileSync(reused.files.process_scope_summary, 'utf8')) as {
      total_rows_reported_by_remote: number | null;
      user_id: string | null;
      masked_user_email: string | null;
    };
    assert.equal(reusedSummary.total_rows_reported_by_remote, 1);
    assert.equal(reusedSummary.user_id, null);
    assert.equal(reusedSummary.masked_user_email, null);
  } finally {
    rmSync(reuseDir, { recursive: true, force: true });
  }

  const runtimeDir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-scope-runtime-defaults-'));
  const envPatch = buildSupabaseTestEnv();
  const envBackup = new Map(Object.keys(envPatch).map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;

  try {
    Object.assign(process.env, envPatch);
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (isSupabaseAuthTokenUrl(url)) {
        return makeSupabaseAuthResponse({ userId: 'user-1' });
      }
      if (url.endsWith('/auth/v1/user')) {
        return jsonResponse({ id: 'user-1' });
      }
      if (url.includes('/rest/v1/processes?') && url.includes('user_id=eq.user-1')) {
        return jsonResponse([
          {
            id: 'proc-defaults',
            version: '01.00.000',
            state_code: 0,
            user_id: 'user-1',
            modified_at: '2026-04-18T08:00:00.000Z',
            model_id: 'model-1',
            json: createProcessPayload({
              primaryDomain: 'Waste management',
              leafDomain: 'Sorting',
              route: 'Sorting',
              routeZh: '分选',
              technology: 'Sorting line',
              technologyZh: '分选线',
              typeOfDataSet: 'Unit process, single operation',
              referenceFlowId: 'flow-1',
              referenceFlowLabelEn: 'sorted paper',
              referenceFlowLabelZh: '分选纸张',
              baseNameEn: 'Waste paper sorting',
              baseNameZh: '废纸分选',
            }),
          },
        ]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    const report = await runProcessScopeStatistics({
      outDir: runtimeDir,
      scope: 'current-user',
      stateCodes: [0],
      pageSize: 10,
      timeoutMs: 10,
      maxRetries: 1,
    });

    const summary = JSON.parse(readFileSync(report.files.process_scope_summary, 'utf8')) as {
      total_rows_reported_by_remote: number | null;
      user_id: string | null;
      masked_user_email: string | null;
    };
    assert.equal(summary.total_rows_reported_by_remote, 1);
    assert.equal(summary.user_id, 'user-1');
    assert.equal(summary.masked_user_email, 'us****@example.com');
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of envBackup) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    rmSync(runtimeDir, { recursive: true, force: true });
  }
});

test('process scope fetch internals cover current-user pagination and cursor failures', async () => {
  const urls: string[] = [];
  const multiPageFetch = (async (input) => {
    const url = String(input);
    urls.push(url);
    if (isSupabaseAuthTokenUrl(url)) {
      return makeSupabaseAuthResponse({ userId: 'user-1' });
    }
    if (url.includes('/rest/v1/processes?') && url.includes('state_code=eq.0')) {
      const parsed = new URL(url);
      if (parsed.searchParams.get('id') === 'gt.proc-2') {
        return jsonResponse([], {
          'content-type': 'application/json',
        });
      }
      if (parsed.searchParams.get('id') === 'gt.proc-1') {
        return jsonResponse(
          [
            {
              id: 'proc-2',
              version: '01.00.000',
              state_code: 0,
              user_id: 'user-1',
              modified_at: '2026-04-18T01:00:00.000Z',
              model_id: 'model-2',
              json: createProcessPayload({
                primaryDomain: 'Waste management',
                leafDomain: 'Transport',
                technology: 'Transport service',
                technologyZh: '运输服务',
                typeOfDataSet: 'Aggregated process',
                referenceFlowId: 'flow-2',
                referenceFlowLabelEn: 'transport service',
                referenceFlowLabelZh: '运输服务',
                baseNameEn: 'Waste transfer',
                baseNameZh: '废弃物转运',
              }),
            },
          ],
          {
            'content-type': 'application/json',
          },
        );
      }
      return jsonResponse(
        [
          {
            id: 'proc-1',
            version: '01.00.000',
            state_code: 0,
            user_id: 'user-1',
            modified_at: '2026-04-18T00:00:00.000Z',
            model_id: 'model-1',
            json: createProcessPayload({
              primaryDomain: 'Waste management',
              leafDomain: 'Paper sorting',
              route: 'Sorting',
              routeZh: '分选',
              technology: 'Sorting line',
              technologyZh: '分选线',
              typeOfDataSet: 'Unit process, single operation',
              referenceFlowId: 'flow-1',
              referenceFlowLabelEn: 'sorted paper',
              referenceFlowLabelZh: '分选纸张',
              baseNameEn: 'Waste paper sorting',
              baseNameZh: '废纸分选',
            }),
          },
        ],
        {
          'content-type': 'application/json',
          'content-range': '0-0/2',
        },
      );
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as FetchLike;

  const paged = await __testInternals.fetchProcessRows({
    env: buildSupabaseTestEnv(),
    fetchImpl: multiPageFetch,
    timeoutMs: 10,
    maxRetries: 1,
    scope: 'current-user',
    stateCodes: [0],
    pageSize: 1,
    userId: 'user-1',
  });
  assert.equal(paged.rows.length, 2);
  assert.equal(paged.total, 2);
  assert.equal(
    urls.some((url) => url.includes('user_id=eq.user-1')),
    true,
  );
  assert.equal(
    urls.some((url) => url.includes('id=gt.proc-1')),
    true,
  );
});
