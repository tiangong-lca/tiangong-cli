import test from 'node:test';
import assert from 'node:assert/strict';
import { CliError } from '../src/lib/errors.js';
import type { FetchLike } from '../src/lib/http.js';
import { __testInternals, runFlowGet } from '../src/lib/flow-get.js';
import {
  buildSupabaseTestEnv,
  isSupabaseAuthTokenUrl,
  makeSupabaseAuthResponse,
} from './helpers/supabase-auth.js';

function jsonFetch(responses: unknown[], observedUrls: string[] = []): FetchLike {
  let index = 0;
  return (async (input) => {
    if (isSupabaseAuthTokenUrl(String(input))) {
      return makeSupabaseAuthResponse();
    }

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

test('runFlowGet resolves the exact requested flow version', async () => {
  const observedUrls: string[] = [];
  const report = await runFlowGet({
    flowId: ' flow-1 ',
    version: '01.00.001',
    userId: ' user-1 ',
    stateCode: 100,
    timeoutMs: 99,
    now: new Date('2026-03-30T00:00:00.000Z'),
    env: buildSupabaseTestEnv({
      TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/functions/v1',
    }),
    fetchImpl: jsonFetch(
      [
        [
          {
            id: 'flow-1',
            version: '01.00.001',
            user_id: 'user-1',
            state_code: 100,
            modified_at: '2026-03-29T00:00:00.000Z',
            json: { flowDataSet: { id: 'flow-1' } },
          },
        ],
      ],
      observedUrls,
    ),
  });

  assert.deepEqual(report, {
    schema_version: 1,
    generated_at_utc: '2026-03-30T00:00:00.000Z',
    status: 'resolved_remote_flow',
    flow_id: 'flow-1',
    requested_version: '01.00.001',
    requested_user_id: 'user-1',
    requested_state_code: 100,
    resolved_version: '01.00.001',
    resolution: 'remote_supabase_exact',
    source_url:
      'https://example.supabase.co/rest/v1/flows?select=id%2Cversion%2Cuser_id%2Cstate_code%2Cmodified_at%2Cjson&id=eq.flow-1&version=eq.01.00.001&user_id=eq.user-1&state_code=eq.100&order=version.desc&limit=2&offset=0',
    modified_at: '2026-03-29T00:00:00.000Z',
    user_id: 'user-1',
    state_code: 100,
    flow: { flowDataSet: { id: 'flow-1' } },
  });
  assert.equal(observedUrls.length, 1);
});

test('runFlowGet can fall back to process.env and global fetch', async () => {
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
            id: '',
            version: '',
            user_id: null,
            state_code: null,
            modified_at: null,
            json: { flowDataSet: { id: 'flow-2', latest: true } },
          },
        ]),
    };
  }) as unknown as typeof fetch;

  try {
    const report = await runFlowGet({
      flowId: 'flow-2',
    });

    assert.equal(report.flow_id, 'flow-2');
    assert.equal(report.requested_version, null);
    assert.equal(report.resolution, 'remote_supabase_latest');
    assert.equal(report.resolved_version, '');
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

test('runFlowGet falls back to the latest reachable version when exact lookup misses', async () => {
  const observedUrls: string[] = [];
  const report = await runFlowGet({
    flowId: 'flow-1',
    version: '01.00.001',
    env: buildSupabaseTestEnv({
      TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/rest/v1',
    }),
    fetchImpl: jsonFetch(
      [
        [],
        [
          {
            id: 'flow-1',
            version: '01.00.003',
            user_id: 'user-1',
            state_code: 100,
            modified_at: null,
            json: '{"flowDataSet":{"id":"flow-1","latest":true}}',
          },
        ],
      ],
      observedUrls,
    ),
  });

  assert.equal(report.resolution, 'remote_supabase_latest_fallback');
  assert.equal(report.resolved_version, '01.00.003');
  assert.deepEqual(report.flow, {
    flowDataSet: {
      id: 'flow-1',
      latest: true,
    },
  });
  assert.equal(observedUrls.length, 2);
  assert.match(observedUrls[0] as string, /version=eq\.01\.00\.001/u);
  assert.match(observedUrls[1] as string, /order=version.desc/u);
});

test('runFlowGet loads the latest row when no version is requested', async () => {
  const report = await runFlowGet({
    flowId: 'flow-1',
    env: buildSupabaseTestEnv({
      TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co',
    }),
    fetchImpl: jsonFetch([
      [
        {
          id: 'flow-1',
          version: '01.00.004',
          user_id: 'user-1',
          state_code: 100,
          modified_at: null,
          json: { flowDataSet: { id: 'flow-1', latest: true } },
        },
      ],
    ]),
  });

  assert.equal(report.requested_version, null);
  assert.equal(report.resolution, 'remote_supabase_latest');
  assert.equal(report.resolved_version, '01.00.004');
});

test('runFlowGet rejects missing flow identifiers', async () => {
  await assert.rejects(
    () =>
      runFlowGet({
        flowId: '   ',
        env: buildSupabaseTestEnv({
          TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co',
        }),
        fetchImpl: jsonFetch([[]]),
      }),
    (error) => error instanceof CliError && error.code === 'FLOW_ID_REQUIRED',
  );
});

test('runFlowGet rejects missing flows after fallback', async () => {
  await assert.rejects(
    () =>
      runFlowGet({
        flowId: 'flow-missing',
        version: '01.00.001',
        env: buildSupabaseTestEnv({
          TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co',
        }),
        fetchImpl: jsonFetch([[], []]),
      }),
    (error) => error instanceof CliError && error.code === 'FLOW_GET_NOT_FOUND',
  );
});

test('runFlowGet rejects missing flows when only the latest lookup is requested', async () => {
  await assert.rejects(
    () =>
      runFlowGet({
        flowId: 'flow-missing',
        env: buildSupabaseTestEnv({
          TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co',
        }),
        fetchImpl: jsonFetch([[]]),
      }),
    (error) => error instanceof CliError && error.code === 'FLOW_GET_NOT_FOUND',
  );
});

test('runFlowGet rejects ambiguous exact matches', async () => {
  await assert.rejects(
    () =>
      runFlowGet({
        flowId: 'flow-1',
        version: '01.00.001',
        env: buildSupabaseTestEnv({
          TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co',
        }),
        fetchImpl: jsonFetch([
          [
            {
              id: 'flow-1',
              version: '01.00.001',
              user_id: 'user-1',
              state_code: 0,
              modified_at: null,
              json: { flowDataSet: { id: 'flow-1' } },
            },
            {
              id: 'flow-1',
              version: '01.00.001',
              user_id: 'user-2',
              state_code: 100,
              modified_at: null,
              json: { flowDataSet: { id: 'flow-1' } },
            },
          ],
        ]),
      }),
    (error) => error instanceof CliError && error.code === 'FLOW_GET_AMBIGUOUS',
  );
});

test('runFlowGet rejects ambiguous latest matches', async () => {
  await assert.rejects(
    () =>
      runFlowGet({
        flowId: 'flow-1',
        env: buildSupabaseTestEnv({
          TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co',
        }),
        fetchImpl: jsonFetch([
          [
            {
              id: 'flow-1',
              version: '01.00.003',
              user_id: 'user-1',
              state_code: 0,
              modified_at: null,
              json: { flowDataSet: { id: 'flow-1' } },
            },
            {
              id: 'flow-1',
              version: '01.00.003',
              user_id: 'user-2',
              state_code: 100,
              modified_at: null,
              json: { flowDataSet: { id: 'flow-1' } },
            },
          ],
        ]),
      }),
    (error) => error instanceof CliError && error.code === 'FLOW_GET_AMBIGUOUS',
  );
});

test('flow-get internals normalize optional tokens', () => {
  assert.equal(__testInternals.normalizeToken(' flow-1 '), 'flow-1');
  assert.equal(__testInternals.normalizeToken('   '), null);
  assert.equal(__testInternals.normalizeToken(undefined), null);
});
