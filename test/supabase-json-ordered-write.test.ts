import assert from 'node:assert/strict';
import test from 'node:test';
import { CliError } from '../src/lib/errors.js';
import type { FetchLike } from '../src/lib/http.js';
import {
  __testInternals,
  hasSupabaseRestRuntime,
  syncSupabaseJsonOrderedRecord,
} from '../src/lib/supabase-json-ordered-write.js';

function makeResponse(options: {
  ok: boolean;
  status: number;
  contentType?: string;
  body?: string;
}) {
  return {
    ok: options.ok,
    status: options.status,
    headers: {
      get(name: string): string | null {
        return name.toLowerCase() === 'content-type'
          ? (options.contentType ?? 'application/json')
          : null;
      },
    },
    async text(): Promise<string> {
      return options.body ?? '';
    },
  };
}

test('hasSupabaseRestRuntime checks env completeness', () => {
  assert.equal(hasSupabaseRestRuntime(undefined), false);
  assert.equal(hasSupabaseRestRuntime({} as NodeJS.ProcessEnv), false);
  assert.equal(
    hasSupabaseRestRuntime({
      TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co',
      TIANGONG_LCA_API_KEY: 'key',
    } as NodeJS.ProcessEnv),
    true,
  );
});

test('supabase json_ordered write inserts when no exact row exists', async () => {
  const observed: Array<{ method: string; url: string; body?: string }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    observed.push({
      method: String(init?.method ?? 'GET'),
      url: String(url),
      body: typeof init?.body === 'string' ? init.body : undefined,
    });

    if (observed.length === 1) {
      return makeResponse({
        ok: true,
        status: 200,
        body: '[]',
      });
    }

    return makeResponse({
      ok: true,
      status: 201,
      body: '[{"id":"proc-1"}]',
    });
  };

  const result = await syncSupabaseJsonOrderedRecord({
    table: 'processes',
    id: 'proc-1',
    version: '01.00.001',
    payload: { processDataSet: {} },
    writeMode: 'upsert_current_version',
    env: {
      TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co',
      TIANGONG_LCA_API_KEY: 'key',
    } as NodeJS.ProcessEnv,
    fetchImpl,
  });

  assert.deepEqual(result, {
    status: 'success',
    operation: 'insert',
  });
  assert.deepEqual(
    observed.map((item) => item.method),
    ['GET', 'POST'],
  );
  assert.match(
    observed[0]?.url ?? '',
    /\/rest\/v1\/processes\?select=id%2Cversion%2Cstate_code&id=eq\.proc-1&version=eq\.01\.00\.001/u,
  );
  assert.match(observed[1]?.body ?? '', /"json_ordered"/u);
});

test('supabase json_ordered write updates when exact row already exists', async () => {
  const observed: Array<{ method: string; url: string }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    observed.push({
      method: String(init?.method ?? 'GET'),
      url: String(url),
    });

    if (observed.length === 1) {
      return makeResponse({
        ok: true,
        status: 200,
        body: '[{"id":"src-1","version":"01.00.001","state_code":0}]',
      });
    }

    return makeResponse({
      ok: true,
      status: 200,
      body: '[{"id":"src-1"}]',
    });
  };

  const result = await syncSupabaseJsonOrderedRecord({
    table: 'sources',
    id: 'src-1',
    version: '01.00.001',
    payload: { sourceDataSet: {} },
    writeMode: 'upsert_current_version',
    env: {
      TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/rest/v1',
      TIANGONG_LCA_API_KEY: 'key',
    } as NodeJS.ProcessEnv,
    fetchImpl,
  });

  assert.equal(result.operation, 'update_existing');
  assert.deepEqual(
    observed.map((item) => item.method),
    ['GET', 'PATCH'],
  );
  assert.match(observed[1]?.url ?? '', /\/sources\?id=eq\.src-1&version=eq\.01\.00\.001/u);
});

test('supabase json_ordered write falls back to update after insert conflict', async () => {
  const observed: Array<{ method: string; url: string }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    observed.push({
      method: String(init?.method ?? 'GET'),
      url: String(url),
    });

    if (observed.length === 1) {
      return makeResponse({
        ok: true,
        status: 200,
        body: '[]',
      });
    }

    if (observed.length === 2) {
      return makeResponse({
        ok: false,
        status: 409,
        body: '{"message":"duplicate"}',
      });
    }

    if (observed.length === 3) {
      return makeResponse({
        ok: true,
        status: 200,
        body: '[{"id":"lm-1","version":"01.00.001","state_code":0}]',
      });
    }

    return makeResponse({
      ok: true,
      status: 200,
      body: '[{"id":"lm-1"}]',
    });
  };

  const result = await syncSupabaseJsonOrderedRecord({
    table: 'lifecyclemodels',
    id: 'lm-1',
    version: '01.00.001',
    payload: { lifeCycleModelDataSet: {} },
    writeMode: 'upsert_current_version',
    env: {
      TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/functions/v1',
      TIANGONG_LCA_API_KEY: 'key',
    } as NodeJS.ProcessEnv,
    fetchImpl,
  });

  assert.equal(result.operation, 'update_after_insert_error');
  assert.deepEqual(
    observed.map((item) => item.method),
    ['GET', 'POST', 'GET', 'PATCH'],
  );
});

test('append-only insert skips existing rows and validates helper branches', async () => {
  const fetchImpl: FetchLike = async () =>
    makeResponse({
      ok: true,
      status: 200,
      body: '[{"id":"proc-skip","version":"01.00.001","state_code":0}]',
    });

  const result = await syncSupabaseJsonOrderedRecord({
    table: 'processes',
    id: 'proc-skip',
    version: '01.00.001',
    payload: { processDataSet: {} },
    writeMode: 'append_only_insert',
    env: {
      TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co',
      TIANGONG_LCA_API_KEY: 'key',
    } as NodeJS.ProcessEnv,
    fetchImpl,
  });

  assert.equal(result.operation, 'skipped_existing');
  assert.equal(
    __testInternals.buildSelectUrl(
      'https://example.supabase.co/rest/v1',
      'processes',
      'proc-skip',
      '01.00.001',
    ),
    'https://example.supabase.co/rest/v1/processes?select=id%2Cversion%2Cstate_code&id=eq.proc-skip&version=eq.01.00.001',
  );
  assert.equal(
    __testInternals.buildUpdateUrl(
      'https://example.supabase.co/rest/v1',
      'processes',
      'proc-skip',
      '01.00.001',
    ),
    'https://example.supabase.co/rest/v1/processes?id=eq.proc-skip&version=eq.01.00.001',
  );
  assert.throws(
    () => __testInternals.requireNonEmptyToken('', 'dataset id', 'TOKEN_REQUIRED'),
    /Missing required dataset id/u,
  );
  assert.throws(
    () => __testInternals.parseVisibleRows([{ id: 'ok' }, 'bad'], 'https://example.com/select'),
    /row 1 was not a JSON object/u,
  );
});

test('supabase json_ordered helpers handle empty/text success payloads and invalid visible-row shapes', async () => {
  await __testInternals.insertJsonOrderedRow({
    restBaseUrl: 'https://example.supabase.co/rest/v1',
    table: 'processes',
    apiKey: 'key',
    id: 'proc-text',
    payload: { processDataSet: {} },
    timeoutMs: 10,
    fetchImpl: async () =>
      makeResponse({
        ok: true,
        status: 201,
        contentType: 'text/plain',
        body: 'created',
      }),
  });

  await __testInternals.updateJsonOrderedRow({
    restBaseUrl: 'https://example.supabase.co/rest/v1',
    table: 'processes',
    apiKey: 'key',
    id: 'proc-empty',
    version: '01.00.001',
    payload: { processDataSet: {} },
    timeoutMs: 10,
    fetchImpl: async () =>
      makeResponse({
        ok: true,
        status: 200,
        body: '',
      }),
  });

  assert.throws(
    () => __testInternals.parseVisibleRows('not-an-array', 'https://example.com/select'),
    (error) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, 'SUPABASE_REST_RESPONSE_INVALID');
      return true;
    },
  );
});

test('supabase json_ordered write surfaces remote request failures and invalid JSON', async () => {
  await assert.rejects(
    () =>
      syncSupabaseJsonOrderedRecord({
        table: 'processes',
        id: 'proc-http-fail',
        version: '01.00.001',
        payload: { processDataSet: {} },
        writeMode: 'upsert_current_version',
        env: {
          TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co',
          TIANGONG_LCA_API_KEY: 'key',
        } as NodeJS.ProcessEnv,
        fetchImpl: async () => ({
          ok: false,
          status: 503,
          headers: {
            get() {
              return null;
            },
          },
          async text() {
            return 'upstream unavailable';
          },
        }),
      }),
    (error) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, 'REMOTE_REQUEST_FAILED');
      return true;
    },
  );

  await assert.rejects(
    () =>
      syncSupabaseJsonOrderedRecord({
        table: 'processes',
        id: 'proc-invalid-json',
        version: '01.00.001',
        payload: { processDataSet: {} },
        writeMode: 'upsert_current_version',
        env: {
          TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co',
          TIANGONG_LCA_API_KEY: 'key',
        } as NodeJS.ProcessEnv,
        fetchImpl: async () =>
          makeResponse({
            ok: true,
            status: 200,
            body: '{"broken"',
          }),
      }),
    (error) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, 'REMOTE_INVALID_JSON');
      return true;
    },
  );
});

test('supabase json_ordered write rethrows insert conflicts when the row is still invisible', async () => {
  const observed: string[] = [];
  await assert.rejects(
    () =>
      syncSupabaseJsonOrderedRecord({
        table: 'processes',
        id: 'proc-conflict-missing',
        version: '01.00.001',
        payload: { processDataSet: {} },
        writeMode: 'upsert_current_version',
        env: {
          TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co',
          TIANGONG_LCA_API_KEY: 'key',
        } as NodeJS.ProcessEnv,
        fetchImpl: async (_url, init) => {
          observed.push(String(init?.method ?? 'GET'));
          if (observed.length === 2) {
            return makeResponse({
              ok: false,
              status: 409,
              body: '{"message":"duplicate"}',
            });
          }

          return makeResponse({
            ok: true,
            status: 200,
            body: '[]',
          });
        },
      }),
    (error) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, 'REMOTE_REQUEST_FAILED');
      return true;
    },
  );

  assert.deepEqual(observed, ['GET', 'POST', 'GET']);
});

test('append-only insert skips rows that appear after an insert conflict', async () => {
  const observed: string[] = [];
  const result = await syncSupabaseJsonOrderedRecord({
    table: 'processes',
    id: 'proc-conflict-skip',
    version: '01.00.001',
    payload: { processDataSet: {} },
    writeMode: 'append_only_insert',
    env: {
      TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co',
      TIANGONG_LCA_API_KEY: 'key',
    } as NodeJS.ProcessEnv,
    fetchImpl: async (_url, init) => {
      observed.push(String(init?.method ?? 'GET'));
      if (observed.length === 2) {
        return makeResponse({
          ok: false,
          status: 409,
          body: '{"message":"duplicate"}',
        });
      }

      if (observed.length === 3) {
        return makeResponse({
          ok: true,
          status: 200,
          body: '[{"id":"proc-conflict-skip","version":"01.00.001","state_code":0}]',
        });
      }

      return makeResponse({
        ok: true,
        status: 200,
        body: '[]',
      });
    },
  });

  assert.deepEqual(result, {
    status: 'success',
    operation: 'skipped_existing',
  });
  assert.deepEqual(observed, ['GET', 'POST', 'GET']);
});
