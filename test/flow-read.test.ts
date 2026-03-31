import test from 'node:test';
import assert from 'node:assert/strict';
import { CliError } from '../src/lib/errors.js';
import {
  buildAmbiguousMatchDetails,
  buildFlowListUrl,
  buildHeaders,
  fetchOneFlowRow,
  latestRowsAreAmbiguous,
  listFlowRows,
  normalizeStateCodeList,
  normalizeSupabaseFlowPayload,
  normalizeTokenList,
  parseFlowRows,
} from '../src/lib/flow-read.js';
import type { FetchLike } from '../src/lib/http.js';
import type { SupabaseRestRuntime } from '../src/lib/supabase-rest.js';

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

const runtime: SupabaseRestRuntime = {
  apiBaseUrl: 'https://example.supabase.co/functions/v1',
  apiKey: 'secret-token',
};

test('buildFlowListUrl encodes deterministic flow filters', () => {
  const url = new URL(
    buildFlowListUrl('https://example.supabase.co/rest/v1', {
      ids: [' flow-1 ', 'flow-2', 'flow-1'],
      version: ' 01.00.001 ',
      userId: ' user-1 ',
      stateCodes: [100, 0, 100, -1],
      typeOfDataset: [' Product flow ', 'Waste flow', 'Product flow'],
      order: 'id.asc,version.asc',
      limit: 20,
      offset: 5,
    }),
  );

  assert.equal(url.pathname, '/rest/v1/flows');
  assert.equal(url.searchParams.get('select'), 'id,version,user_id,state_code,modified_at,json');
  assert.equal(url.searchParams.get('id'), 'in.(flow-1,flow-2)');
  assert.equal(url.searchParams.get('version'), 'eq.01.00.001');
  assert.equal(url.searchParams.get('user_id'), 'eq.user-1');
  assert.equal(url.searchParams.get('state_code'), 'in.(100,0)');
  assert.equal(
    url.searchParams.get('json->flowDataSet->modellingAndValidation->LCIMethod->>typeOfDataSet'),
    'in.(Product flow,Waste flow)',
  );
  assert.equal(url.searchParams.get('order'), 'id.asc,version.asc');
  assert.equal(url.searchParams.get('limit'), '20');
  assert.equal(url.searchParams.get('offset'), '5');

  const singleUrl = new URL(
    buildFlowListUrl('https://example.supabase.co/rest/v1', {
      ids: ['flow-3'],
      stateCodes: [100],
      typeOfDataset: ['Product flow'],
    }),
  );
  assert.equal(singleUrl.searchParams.get('id'), 'eq.flow-3');
  assert.equal(singleUrl.searchParams.get('state_code'), 'eq.100');
  assert.equal(
    singleUrl.searchParams.get(
      'json->flowDataSet->modellingAndValidation->LCIMethod->>typeOfDataSet',
    ),
    'eq.Product flow',
  );
});

test('buildHeaders returns Supabase auth headers', () => {
  assert.deepEqual(buildHeaders('secret-token'), {
    Accept: 'application/json',
    Authorization: 'Bearer secret-token',
    apikey: 'secret-token',
  });
});

test('normalizeTokenList and normalizeStateCodeList remove invalid values', () => {
  assert.deepEqual(
    normalizeTokenList([' flow-1 ', '', 'flow-2', 'flow-1', 1 as never] as string[]),
    ['flow-1', 'flow-2'],
  );
  assert.deepEqual(normalizeTokenList(undefined), []);
  assert.deepEqual(normalizeStateCodeList([100, 0, 100, -1, 1.5] as number[]), [100, 0]);
  assert.deepEqual(normalizeStateCodeList(undefined), []);
});

test('parseFlowRows maps Supabase rows and defaults nullable fields', () => {
  assert.deepEqual(
    parseFlowRows(
      [
        {
          id: 'flow-1',
          version: '01.00.001',
          user_id: 'user-1',
          state_code: 100,
          modified_at: '2026-03-30T00:00:00.000Z',
          json: { flowDataSet: { id: 'flow-1' } },
        },
        {
          id: 5,
          version: null,
          user_id: false,
          state_code: 'bad',
          modified_at: 1,
          json: null,
        },
      ],
      'https://example.supabase.co/rest/v1/flows',
    ),
    [
      {
        id: 'flow-1',
        version: '01.00.001',
        user_id: 'user-1',
        state_code: 100,
        modified_at: '2026-03-30T00:00:00.000Z',
        json: { flowDataSet: { id: 'flow-1' } },
      },
      {
        id: '',
        version: '',
        user_id: null,
        state_code: null,
        modified_at: null,
        json: null,
      },
    ],
  );
});

test('parseFlowRows rejects non-array payloads and non-object rows', () => {
  assert.throws(
    () => parseFlowRows({ bad: true }, 'https://example.supabase.co/rest/v1/flows'),
    (error) => error instanceof CliError && error.code === 'SUPABASE_REST_RESPONSE_INVALID',
  );

  assert.throws(
    () => parseFlowRows([1], 'https://example.supabase.co/rest/v1/flows'),
    (error) => error instanceof CliError && error.code === 'SUPABASE_REST_RESPONSE_INVALID',
  );
});

test('normalizeSupabaseFlowPayload handles object and JSON string payloads', () => {
  assert.deepEqual(normalizeSupabaseFlowPayload({ flowDataSet: { id: 'flow-1' } }, 'flow-1'), {
    flowDataSet: { id: 'flow-1' },
  });
  assert.deepEqual(normalizeSupabaseFlowPayload('{"flowDataSet":{"id":"flow-2"}}', 'flow-2'), {
    flowDataSet: { id: 'flow-2' },
  });
});

test('normalizeSupabaseFlowPayload rejects invalid payload shapes', () => {
  assert.throws(
    () => normalizeSupabaseFlowPayload('{bad-json', 'flow-1'),
    (error) => error instanceof CliError && error.code === 'SUPABASE_REST_PAYLOAD_INVALID_JSON',
  );
  assert.throws(
    () => normalizeSupabaseFlowPayload('[1,2,3]', 'flow-1'),
    (error) => error instanceof CliError && error.code === 'SUPABASE_REST_PAYLOAD_INVALID',
  );
  assert.throws(
    () => normalizeSupabaseFlowPayload(null, 'flow-1'),
    (error) => error instanceof CliError && error.code === 'SUPABASE_REST_PAYLOAD_MISSING',
  );
});

test('latestRowsAreAmbiguous and buildAmbiguousMatchDetails summarize competing rows', () => {
  const rows = [
    {
      id: 'flow-1',
      version: '01.00.002',
      user_id: 'user-1',
      state_code: 100,
      modified_at: null,
      json: {},
    },
    {
      id: 'flow-1',
      version: '01.00.002',
      user_id: 'user-2',
      state_code: 0,
      modified_at: null,
      json: {},
    },
  ];

  assert.equal(latestRowsAreAmbiguous(rows), true);
  assert.equal(
    latestRowsAreAmbiguous([
      rows[0] as (typeof rows)[number],
      {
        ...rows[1],
        version: '01.00.001',
      },
    ]),
    false,
  );
  assert.deepEqual(buildAmbiguousMatchDetails(rows), [
    {
      id: 'flow-1',
      version: '01.00.002',
      user_id: 'user-1',
      state_code: 100,
    },
    {
      id: 'flow-1',
      version: '01.00.002',
      user_id: 'user-2',
      state_code: 0,
    },
  ]);
});

test('listFlowRows performs a deterministic REST read', async () => {
  const observedUrls: string[] = [];
  const result = await listFlowRows({
    runtime,
    filters: {
      ids: ['flow-1'],
      limit: 1,
      offset: 0,
      order: 'id.asc,version.asc',
    },
    timeoutMs: 99,
    fetchImpl: jsonFetch(
      [
        [
          {
            id: 'flow-1',
            version: '01.00.001',
            user_id: 'user-1',
            state_code: 100,
            modified_at: null,
            json: { flowDataSet: { id: 'flow-1' } },
          },
        ],
      ],
      observedUrls,
    ),
  });

  assert.equal(result.rows.length, 1);
  assert.equal(
    result.sourceUrl,
    'https://example.supabase.co/rest/v1/flows?select=id%2Cversion%2Cuser_id%2Cstate_code%2Cmodified_at%2Cjson&id=eq.flow-1&order=id.asc%2Cversion.asc&limit=1&offset=0',
  );
  assert.deepEqual(observedUrls, [result.sourceUrl]);
});

test('fetchOneFlowRow can return null when exact lookup misses without fallback', async () => {
  const observedUrls: string[] = [];
  const result = await fetchOneFlowRow({
    runtime,
    id: 'flow-1',
    version: '01.00.001',
    timeoutMs: 99,
    fetchImpl: jsonFetch([[]], observedUrls),
    fallbackToLatest: false,
  });

  assert.equal(result, null);
  assert.equal(observedUrls.length, 1);
  assert.match(observedUrls[0] as string, /version=eq\.01\.00\.001/u);
});
