import test from 'node:test';
import assert from 'node:assert/strict';
import { CliError } from '../src/lib/errors.js';
import type { FetchLike } from '../src/lib/http.js';
import { __testInternals, runFlowList } from '../src/lib/flow-list.js';

function jsonFetch(responses: unknown[], observedUrls: string[] = []): FetchLike {
  let index = 0;
  return (async (input) => {
    observedUrls.push(String(input));
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return {
      ok: true,
      status: 200,
      headers: {
        get: () => 'application/json',
      },
      text: async () => JSON.stringify(next),
    };
  }) as FetchLike;
}

test('runFlowList returns one deterministic page of flow rows', async () => {
  const observedUrls: string[] = [];
  const report = await runFlowList({
    ids: [' flow-2 ', 'flow-1', 'flow-2'],
    version: '01.00.001',
    userId: ' user-1 ',
    stateCodes: [100, 0, 100],
    typeOfDataset: [' Product flow ', 'Waste flow', 'Product flow'],
    limit: 5,
    offset: 2,
    order: 'version.desc,id.asc',
    now: new Date('2026-03-30T00:00:00.000Z'),
    env: {
      TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/functions/v1',
      TIANGONG_LCA_API_KEY: 'secret-token',
    } as NodeJS.ProcessEnv,
    fetchImpl: jsonFetch(
      [
        [
          {
            id: 'flow-1',
            version: '01.00.001',
            user_id: 'user-1',
            state_code: 100,
            modified_at: '2026-03-29T00:00:00.000Z',
            json: '{"flowDataSet":{"id":"flow-1"}}',
          },
        ],
      ],
      observedUrls,
    ),
  });

  assert.deepEqual(report, {
    schema_version: 1,
    generated_at_utc: '2026-03-30T00:00:00.000Z',
    status: 'listed_remote_flows',
    filters: {
      ids: ['flow-2', 'flow-1'],
      requested_version: '01.00.001',
      requested_user_id: 'user-1',
      requested_state_codes: [100, 0],
      requested_type_of_dataset: ['Product flow', 'Waste flow'],
      order: 'version.desc,id.asc',
      all: false,
      limit: 5,
      offset: 2,
      page_size: null,
    },
    count: 1,
    source_urls: [
      'https://example.supabase.co/rest/v1/flows?select=id%2Cversion%2Cuser_id%2Cstate_code%2Cmodified_at%2Cjson&id=in.%28flow-2%2Cflow-1%29&version=eq.01.00.001&user_id=eq.user-1&state_code=in.%28100%2C0%29&json-%3EflowDataSet-%3EmodellingAndValidation-%3ELCIMethod-%3E%3EtypeOfDataSet=in.%28Product+flow%2CWaste+flow%29&order=version.desc%2Cid.asc&limit=5&offset=2',
    ],
    rows: [
      {
        id: 'flow-1',
        version: '01.00.001',
        user_id: 'user-1',
        state_code: 100,
        modified_at: '2026-03-29T00:00:00.000Z',
        flow: { flowDataSet: { id: 'flow-1' } },
      },
    ],
  });
  assert.deepEqual(observedUrls, report.source_urls);
});

test('runFlowList auto-pages when --all is enabled', async () => {
  const observedUrls: string[] = [];
  const report = await runFlowList({
    ids: ['flow-1'],
    all: true,
    pageSize: 2,
    env: {
      TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/rest/v1',
      TIANGONG_LCA_API_KEY: 'secret-token',
    } as NodeJS.ProcessEnv,
    fetchImpl: jsonFetch(
      [
        [
          {
            id: 'flow-1',
            version: '01.00.003',
            user_id: 'user-1',
            state_code: 100,
            modified_at: null,
            json: { flowDataSet: { id: 'flow-1', page: 1 } },
          },
          {
            id: 'flow-1',
            version: '01.00.002',
            user_id: 'user-1',
            state_code: 100,
            modified_at: null,
            json: { flowDataSet: { id: 'flow-1', page: 1 } },
          },
        ],
        [
          {
            id: 'flow-1',
            version: '01.00.001',
            user_id: 'user-1',
            state_code: 100,
            modified_at: null,
            json: { flowDataSet: { id: 'flow-1', page: 2 } },
          },
        ],
      ],
      observedUrls,
    ),
  });

  assert.equal(report.filters.all, true);
  assert.equal(report.filters.limit, null);
  assert.equal(report.filters.page_size, 2);
  assert.equal(report.count, 3);
  assert.equal(report.rows.length, 3);
  assert.equal(report.source_urls.length, 2);
  assert.match(report.source_urls[0] as string, /limit=2/u);
  assert.match(report.source_urls[1] as string, /offset=2/u);
  assert.deepEqual(observedUrls, report.source_urls);
});

test('runFlowList uses the default page size when --all omits pageSize', async () => {
  const report = await runFlowList({
    ids: ['flow-1'],
    all: true,
    env: {
      TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/rest/v1',
      TIANGONG_LCA_API_KEY: 'secret-token',
    } as NodeJS.ProcessEnv,
    fetchImpl: jsonFetch([[]]),
  });

  assert.equal(report.filters.all, true);
  assert.equal(report.filters.page_size, 100);
  assert.equal(report.count, 0);
});

test('runFlowList can fall back to process.env and global fetch', async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.TIANGONG_LCA_API_BASE_URL;
  const originalApiKey = process.env.TIANGONG_LCA_API_KEY;

  process.env.TIANGONG_LCA_API_BASE_URL = 'https://example.supabase.co';
  process.env.TIANGONG_LCA_API_KEY = 'secret-token';
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    headers: {
      get: () => 'application/json',
    },
    text: async () =>
      JSON.stringify([
        {
          id: 'flow-1',
          version: '01.00.001',
          user_id: null,
          state_code: null,
          modified_at: null,
          json: { flowDataSet: { id: 'flow-1' } },
        },
      ]),
  })) as unknown as typeof fetch;

  try {
    const report = await runFlowList({});
    assert.equal(report.count, 1);
    assert.equal(report.filters.limit, 100);
    assert.equal(report.filters.offset, 0);
    assert.equal(report.filters.order, 'id.asc,version.asc');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) {
      delete process.env.TIANGONG_LCA_API_BASE_URL;
    } else {
      process.env.TIANGONG_LCA_API_BASE_URL = originalBaseUrl;
    }
    if (originalApiKey === undefined) {
      delete process.env.TIANGONG_LCA_API_KEY;
    } else {
      process.env.TIANGONG_LCA_API_KEY = originalApiKey;
    }
  }
});

test('runFlowList rejects conflicting and invalid pagination controls', async () => {
  const env = {
    TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co',
    TIANGONG_LCA_API_KEY: 'secret-token',
  } as NodeJS.ProcessEnv;

  await assert.rejects(
    () =>
      runFlowList({
        ids: ['flow-1'],
        all: true,
        limit: 1,
        env,
        fetchImpl: jsonFetch([[]]),
      }),
    (error) => error instanceof CliError && error.code === 'FLOW_LIST_ALL_LIMIT_CONFLICT',
  );

  await assert.rejects(
    () =>
      runFlowList({
        ids: ['flow-1'],
        all: true,
        offset: 1,
        env,
        fetchImpl: jsonFetch([[]]),
      }),
    (error) => error instanceof CliError && error.code === 'FLOW_LIST_ALL_OFFSET_CONFLICT',
  );

  await assert.rejects(
    () =>
      runFlowList({
        all: true,
        env,
        fetchImpl: jsonFetch([[]]),
      }),
    (error) => error instanceof CliError && error.code === 'FLOW_LIST_ALL_FILTER_REQUIRED',
  );

  await assert.rejects(
    () =>
      runFlowList({
        ids: ['flow-1'],
        all: true,
        pageSize: 0,
        env,
        fetchImpl: jsonFetch([[]]),
      }),
    (error) => error instanceof CliError && error.code === 'FLOW_LIST_PAGE_SIZE_INVALID',
  );

  await assert.rejects(
    () =>
      runFlowList({
        limit: 0,
        env,
        fetchImpl: jsonFetch([[]]),
      }),
    (error) => error instanceof CliError && error.code === 'FLOW_LIST_LIMIT_INVALID',
  );

  await assert.rejects(
    () =>
      runFlowList({
        offset: -1,
        env,
        fetchImpl: jsonFetch([[]]),
      }),
    (error) => error instanceof CliError && error.code === 'FLOW_LIST_OFFSET_INVALID',
  );
});

test('flow-list internals validate integer helpers', () => {
  assert.equal(__testInternals.normalizeToken(' flow-1 '), 'flow-1');
  assert.equal(__testInternals.normalizeToken('   '), null);
  assert.equal(__testInternals.normalizeToken(undefined), null);
  assert.equal(
    __testInternals.nowIso(new Date('2026-03-30T00:00:00.000Z')),
    '2026-03-30T00:00:00.000Z',
  );
  assert.equal(__testInternals.toPositiveInteger(2, '--limit', 'ERR'), 2);
  assert.equal(__testInternals.toNonNegativeInteger(0, '--offset', 'ERR'), 0);
  assert.throws(
    () => __testInternals.toPositiveInteger(0, '--limit', 'ERR'),
    (error) => error instanceof CliError && error.code === 'ERR',
  );
  assert.throws(
    () => __testInternals.toNonNegativeInteger(-1, '--offset', 'ERR'),
    (error) => error instanceof CliError && error.code === 'ERR',
  );
});
