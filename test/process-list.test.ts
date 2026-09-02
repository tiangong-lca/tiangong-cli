import test from 'node:test';
import assert from 'node:assert/strict';
import { CliError } from '../src/lib/errors.js';
import type { FetchLike } from '../src/lib/http.js';
import { __testInternals, runProcessList } from '../src/lib/process-list.js';
import {
  buildSupabaseTestEnv,
  isSupabaseAuthTokenUrl,
  makeSupabaseAuthResponse,
} from './helpers/supabase-auth.js';

function jsonFetch(responses: Array<unknown | Error>, observedUrls: string[] = []): FetchLike {
  let index = 0;
  return (async (input) => {
    if (isSupabaseAuthTokenUrl(String(input))) {
      return makeSupabaseAuthResponse();
    }

    observedUrls.push(String(input));
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next instanceof Error) {
      throw next;
    }
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

test('runProcessList returns one deterministic page of process rows', async () => {
  const observedUrls: string[] = [];
  const report = await runProcessList({
    ids: [' proc-2 ', 'proc-1', 'proc-2'],
    version: '01.00.001',
    userId: ' user-1 ',
    stateCodes: [100, 0, 100],
    limit: 5,
    offset: 2,
    order: 'version.desc,id.asc',
    now: new Date('2026-03-30T00:00:00.000Z'),
    env: buildSupabaseTestEnv({
      TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/functions/v1',
    }),
    fetchImpl: jsonFetch(
      [
        [
          {
            id: 'proc-1',
            version: '01.00.001',
            user_id: 'user-1',
            state_code: 100,
            modified_at: '2026-03-29T00:00:00.000Z',
            json: '{"processDataSet":{"id":"proc-1"}}',
          },
        ],
      ],
      observedUrls,
    ),
  });

  assert.deepEqual(report, {
    schema_version: 1,
    generated_at_utc: '2026-03-30T00:00:00.000Z',
    status: 'listed_remote_processes',
    filters: {
      ids: ['proc-2', 'proc-1'],
      requested_version: '01.00.001',
      requested_user_id: 'user-1',
      requested_state_codes: [100, 0],
      order: 'version.desc,id.asc',
      all: false,
      limit: 5,
      offset: 2,
      page_size: null,
    },
    count: 1,
    source_urls: [
      'https://example.supabase.co/rest/v1/processes?select=id%2Cversion%2Cuser_id%2Cstate_code%2Cmodified_at%2Cjson&id=in.%28proc-2%2Cproc-1%29&version=eq.01.00.001&user_id=eq.user-1&state_code=in.%28100%2C0%29&order=version.desc%2Cid.asc&limit=5&offset=2',
    ],
    rows: [
      {
        id: 'proc-1',
        version: '01.00.001',
        user_id: 'user-1',
        state_code: 100,
        modified_at: '2026-03-29T00:00:00.000Z',
        process: { processDataSet: { id: 'proc-1' } },
      },
    ],
  });
  assert.deepEqual(observedUrls, report.source_urls);
});

test('runProcessList auto-pages when --all is enabled and retries transient page failures', async () => {
  const observedUrls: string[] = [];
  const report = await runProcessList({
    ids: ['proc-1'],
    all: true,
    pageSize: 2,
    env: buildSupabaseTestEnv({
      TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/rest/v1',
    }),
    fetchImpl: jsonFetch(
      [
        new Error('statement timeout'),
        [
          {
            id: 'proc-1',
            version: '01.00.003',
            user_id: 'user-1',
            state_code: 100,
            modified_at: null,
            json: { processDataSet: { id: 'proc-1', page: 1 } },
          },
          {
            id: 'proc-1',
            version: '01.00.002',
            user_id: 'user-1',
            state_code: 100,
            modified_at: null,
            json: { processDataSet: { id: 'proc-1', page: 1 } },
          },
        ],
        [
          {
            id: 'proc-1',
            version: '01.00.001',
            user_id: 'user-1',
            state_code: 100,
            modified_at: null,
            json: { processDataSet: { id: 'proc-1', page: 2 } },
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
  assert.equal(observedUrls.filter((url) => url.includes('offset=0')).length, 2);
  assert.match(report.source_urls[0] as string, /limit=2/u);
  assert.match(report.source_urls[1] as string, /offset=2/u);
});

test('runProcessList uses the default page size when --all omits pageSize', async () => {
  const report = await runProcessList({
    ids: ['proc-1'],
    all: true,
    env: buildSupabaseTestEnv({
      TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/rest/v1',
    }),
    fetchImpl: jsonFetch([[]]),
  });

  assert.equal(report.filters.page_size, 100);
  assert.equal(report.count, 0);
});

test('runProcessList can fall back to process.env and global fetch', async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.TIANGONG_LCA_API_BASE_URL;
  const originalAuthMode = process.env.TIANGONG_LCA_AUTH_MODE;
  const originalOAuthClientId = process.env.TIANGONG_LCA_OAUTH_CLIENT_ID;
  const originalSessionFile = process.env.TIANGONG_LCA_SESSION_FILE;
  const originalPublishableKey = process.env.TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY;
  const testEnv = buildSupabaseTestEnv({
    TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co',
    TIANGONG_LCA_ACCESS_TOKEN: 'secret-token',
  });

  process.env.TIANGONG_LCA_API_BASE_URL = testEnv.TIANGONG_LCA_API_BASE_URL;
  process.env.TIANGONG_LCA_AUTH_MODE = testEnv.TIANGONG_LCA_AUTH_MODE;
  process.env.TIANGONG_LCA_OAUTH_CLIENT_ID = testEnv.TIANGONG_LCA_OAUTH_CLIENT_ID;
  process.env.TIANGONG_LCA_SESSION_FILE = testEnv.TIANGONG_LCA_SESSION_FILE;
  process.env.TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY = testEnv.TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (isSupabaseAuthTokenUrl(String(input))) {
      return makeSupabaseAuthResponse();
    }

    return {
      ok: true,
      status: 200,
      headers: {
        get: () => 'application/json',
      },
      text: async () =>
        JSON.stringify([
          {
            id: 'proc-1',
            version: '01.00.001',
            user_id: null,
            state_code: null,
            modified_at: null,
            json: { processDataSet: { id: 'proc-1' } },
          },
        ]),
    };
  }) as unknown as typeof fetch;

  try {
    const report = await runProcessList({});
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
    if (originalAuthMode === undefined) {
      delete process.env.TIANGONG_LCA_AUTH_MODE;
    } else {
      process.env.TIANGONG_LCA_AUTH_MODE = originalAuthMode;
    }
    if (originalOAuthClientId === undefined) {
      delete process.env.TIANGONG_LCA_OAUTH_CLIENT_ID;
    } else {
      process.env.TIANGONG_LCA_OAUTH_CLIENT_ID = originalOAuthClientId;
    }
    if (originalSessionFile === undefined) {
      delete process.env.TIANGONG_LCA_SESSION_FILE;
    } else {
      process.env.TIANGONG_LCA_SESSION_FILE = originalSessionFile;
    }
    if (originalPublishableKey === undefined) {
      delete process.env.TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY;
    } else {
      process.env.TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY = originalPublishableKey;
    }
  }
});

test('runProcessList rejects conflicting and invalid pagination controls', async () => {
  const env = buildSupabaseTestEnv({
    TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co',
  });

  await assert.rejects(
    () =>
      runProcessList({
        ids: ['proc-1'],
        all: true,
        limit: 1,
        env,
        fetchImpl: jsonFetch([[]]),
      }),
    (error) => error instanceof CliError && error.code === 'PROCESS_LIST_ALL_LIMIT_CONFLICT',
  );

  await assert.rejects(
    () =>
      runProcessList({
        ids: ['proc-1'],
        all: true,
        offset: 1,
        env,
        fetchImpl: jsonFetch([[]]),
      }),
    (error) => error instanceof CliError && error.code === 'PROCESS_LIST_ALL_OFFSET_CONFLICT',
  );

  await assert.rejects(
    () =>
      runProcessList({
        all: true,
        env,
        fetchImpl: jsonFetch([[]]),
      }),
    (error) => error instanceof CliError && error.code === 'PROCESS_LIST_ALL_FILTER_REQUIRED',
  );

  await assert.rejects(
    () =>
      runProcessList({
        ids: ['proc-1'],
        limit: 0,
        env,
        fetchImpl: jsonFetch([[]]),
      }),
    (error) => error instanceof CliError && error.code === 'PROCESS_LIST_LIMIT_INVALID',
  );

  await assert.rejects(
    () =>
      runProcessList({
        ids: ['proc-1'],
        offset: -1,
        env,
        fetchImpl: jsonFetch([[]]),
      }),
    (error) => error instanceof CliError && error.code === 'PROCESS_LIST_OFFSET_INVALID',
  );

  await assert.rejects(
    () =>
      runProcessList({
        ids: ['proc-1'],
        maxAttempts: 0,
        env,
        fetchImpl: jsonFetch([[]]),
      }),
    (error) => error instanceof CliError && error.code === 'PROCESS_LIST_MAX_ATTEMPTS_INVALID',
  );
});

test('runProcessList rejects malformed remote payloads and honors retry boundaries', async () => {
  const env = buildSupabaseTestEnv({
    TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co',
  });

  await assert.rejects(
    () =>
      runProcessList({
        ids: ['proc-1'],
        stateCodes: [0],
        env,
        fetchImpl: jsonFetch([{}]),
      }),
    (error) => error instanceof CliError && error.code === 'SUPABASE_REST_RESPONSE_INVALID',
  );

  await assert.rejects(
    () =>
      runProcessList({
        ids: ['proc-1'],
        env,
        fetchImpl: jsonFetch([[0]]),
      }),
    (error) => error instanceof CliError && error.code === 'SUPABASE_REST_RESPONSE_INVALID',
  );

  await assert.rejects(
    () =>
      runProcessList({
        ids: ['proc-1'],
        env,
        maxAttempts: 1,
        fetchImpl: jsonFetch([new Error('statement timeout')]),
      }),
    (error) => error instanceof CliError && error.code === 'REMOTE_REQUEST_FAILED',
  );
});

test('process-list helper internals normalize tokens and apply sparse order clauses', () => {
  assert.equal(__testInternals.normalizeToken('   '), null);
  assert.equal(__testInternals.normalizeToken(' version-1 '), 'version-1');

  assert.equal(
    __testInternals.buildProcessListUrl('https://example.supabase.co/rest/v1', {
      ids: [' proc-1 '],
      stateCodes: [0],
      order: 'id.asc',
      limit: 5,
    }),
    'https://example.supabase.co/rest/v1/processes?select=id%2Cversion%2Cuser_id%2Cstate_code%2Cmodified_at%2Cjson&id=eq.proc-1&state_code=eq.0&order=id.asc&limit=5',
  );

  const orderCalls: Array<{ column: string; options: object | undefined }> = [];
  const query = {
    order(column: string, options?: object) {
      orderCalls.push({ column, options });
      return this;
    },
  };
  assert.equal(__testInternals.applyOrder(query, undefined), query);
  assert.equal(__testInternals.applyOrder(query, '   '), query);
  assert.equal(
    __testInternals.applyOrder(query, 'id.asc,,.desc,version.desc.nullslast,state.asc.nullsfirst'),
    query,
  );
  assert.deepEqual(orderCalls, [
    {
      column: 'id',
      options: {
        ascending: true,
        nullsFirst: undefined,
      },
    },
    {
      column: 'version',
      options: {
        ascending: false,
        nullsFirst: false,
      },
    },
    {
      column: 'state',
      options: {
        ascending: true,
        nullsFirst: true,
      },
    },
  ]);

  assert.equal(__testInternals.isRetryableError(new Error('retry')), true);
  assert.equal(
    __testInternals.isRetryableError(
      new CliError('bad args', {
        code: 'INVALID_ARGS',
        exitCode: 2,
      }),
    ),
    false,
  );
  assert.equal(__testInternals.optionalPositiveInteger(undefined), null);
  assert.equal(__testInternals.optionalPositiveInteger(0), null);
  assert.equal(__testInternals.optionalPositiveInteger(5), 5);
  assert.equal(__testInternals.optionalNonNegativeInteger(undefined), null);
  assert.equal(__testInternals.optionalNonNegativeInteger(-1), null);
  assert.equal(__testInternals.optionalNonNegativeInteger(3), 3);
  assert.deepEqual(
    __testInternals.parseProcessRows(
      [
        {
          id: 1,
          version: 2,
          user_id: null,
          state_code: 0,
          modified_at: null,
          json: {},
        },
      ],
      'https://example.com/processes',
    ),
    [
      {
        id: '',
        version: '',
        user_id: null,
        state_code: 0,
        modified_at: null,
        json: {},
      },
    ],
  );
});
