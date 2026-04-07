import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError } from '../src/lib/errors.js';
import {
  __testInternals as flowFetchRowsInternals,
  runFlowFetchRows,
} from '../src/lib/flow-fetch-rows.js';
import type { FetchLike } from '../src/lib/http.js';
import {
  buildSupabaseTestEnv,
  isSupabaseAuthTokenUrl,
  makeSupabaseAuthResponse,
} from './helpers/supabase-auth.js';

type JsonRecord = Record<string, unknown>;

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(filePath: string): JsonRecord {
  return JSON.parse(readFileSync(filePath, 'utf8')) as JsonRecord;
}

function readJsonLines(filePath: string): JsonRecord[] {
  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JsonRecord);
}

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

test('runFlowFetchRows materializes real DB refs into review-input rows and gap artifacts', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-fetch-rows-'));
  const refsFile = path.join(dir, 'refs.json');
  const outDir = path.join(dir, 'out');
  const observedUrls: string[] = [];

  writeJson(refsFile, [
    {
      id: 'flow-a',
      version: '01.00.001',
      state_code: 100,
      cluster_id: 'cluster-0001',
      source: 'search-flow',
    },
    {
      id: 'flow-a',
      version: '01.00.001',
      state_code: 100,
      cluster_id: 'cluster-0001',
      source: 'search-flow-duplicate',
    },
    {
      id: 'flow-b',
      version: '01.00.001',
      state_code: 100,
      cluster_id: 'cluster-0002',
      source: 'search-flow',
    },
    {
      id: 'flow-c',
      version: '01.00.001',
      state_code: 100,
      cluster_id: 'cluster-0003',
      source: 'search-flow',
    },
    {
      id: 'flow-d',
      version: '01.00.001',
      state_code: 100,
      cluster_id: 'cluster-0004',
      source: 'search-flow',
    },
  ]);

  try {
    const report = await runFlowFetchRows({
      refsFile,
      outDir,
      now: new Date('2026-04-06T12:00:00.000Z'),
      env: buildSupabaseTestEnv({
        TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/functions/v1',
      }),
      fetchImpl: jsonFetch(
        [
          [
            {
              id: 'flow-a',
              version: '01.00.001',
              user_id: 'user-1',
              state_code: 100,
              modified_at: '2026-04-06T00:00:00.000Z',
              json: { flowDataSet: { id: 'flow-a', version: '01.00.001' } },
            },
          ],
          [
            {
              id: 'flow-a',
              version: '01.00.001',
              user_id: 'user-1',
              state_code: 100,
              modified_at: '2026-04-06T00:00:00.000Z',
              json: { flowDataSet: { id: 'flow-a', version: '01.00.001' } },
            },
          ],
          [],
          [
            {
              id: 'flow-b',
              version: '01.00.003',
              user_id: 'user-2',
              state_code: 100,
              modified_at: '2026-04-06T00:01:00.000Z',
              json: '{"flowDataSet":{"id":"flow-b","latest":true}}',
            },
          ],
          [],
          [],
          [
            {
              id: 'flow-d',
              version: '01.00.001',
              user_id: 'user-4',
              state_code: 100,
              modified_at: null,
              json: { flowDataSet: { id: 'flow-d', duplicate: 1 } },
            },
            {
              id: 'flow-d',
              version: '01.00.001',
              user_id: 'user-5',
              state_code: 100,
              modified_at: null,
              json: { flowDataSet: { id: 'flow-d', duplicate: 2 } },
            },
          ],
        ],
        observedUrls,
      ),
    });

    assert.deepEqual(report, {
      schema_version: 1,
      generated_at_utc: '2026-04-06T12:00:00.000Z',
      status: 'completed_flow_row_materialization_with_gaps',
      refs_file: refsFile,
      out_dir: outDir,
      allow_latest_fallback: true,
      requested_ref_count: 5,
      resolved_ref_count: 3,
      review_input_row_count: 2,
      duplicate_review_input_rows_collapsed: 1,
      missing_ref_count: 1,
      ambiguous_ref_count: 1,
      resolution_counts: {
        remote_supabase_exact: 2,
        remote_supabase_latest: 0,
        remote_supabase_latest_fallback: 1,
      },
      files: {
        resolved_flow_rows: path.join(outDir, 'resolved-flow-rows.jsonl'),
        review_input_rows: path.join(outDir, 'review-input-rows.jsonl'),
        fetch_summary: path.join(outDir, 'fetch-summary.json'),
        missing_flow_refs: path.join(outDir, 'missing-flow-refs.jsonl'),
        ambiguous_flow_refs: path.join(outDir, 'ambiguous-flow-refs.jsonl'),
      },
    });
    assert.equal(observedUrls.length, 7);

    const resolvedRows = readJsonLines(report.files.resolved_flow_rows);
    assert.equal(resolvedRows.length, 3);
    assert.equal(resolvedRows[0]?.id, 'flow-a');
    assert.equal(
      ((resolvedRows[2]?._materialization as JsonRecord).resolution as string) ?? '',
      'remote_supabase_latest_fallback',
    );

    const reviewInputRows = readJsonLines(report.files.review_input_rows);
    assert.equal(reviewInputRows.length, 2);
    const flowAReviewRow = reviewInputRows.find((row) => row.id === 'flow-a') as JsonRecord;
    const flowAMaterialization = flowAReviewRow._materialization as JsonRecord;
    assert.equal(flowAMaterialization.materialized_ref_count, 2);
    assert.equal(
      (
        (flowAMaterialization.materialized_from_refs as JsonRecord[])[1]
          ?.requested_ref as JsonRecord
      ).source,
      'search-flow-duplicate',
    );

    const missingRefs = readJsonLines(report.files.missing_flow_refs);
    assert.equal(missingRefs.length, 1);
    assert.equal(
      ((missingRefs[0]?.requested_ref as JsonRecord).cluster_id as string) ?? '',
      'cluster-0003',
    );

    const ambiguousRefs = readJsonLines(report.files.ambiguous_flow_refs);
    assert.equal(ambiguousRefs.length, 1);
    assert.equal(ambiguousRefs[0]?.code, 'FLOW_GET_AMBIGUOUS');

    const summary = readJson(report.files.fetch_summary);
    assert.equal(summary.review_input_row_count, 2);
    assert.equal(summary.ambiguous_ref_count, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runFlowFetchRows can disable latest fallback for versioned refs', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-fetch-rows-no-fallback-'));
  const refsFile = path.join(dir, 'refs.json');
  const outDir = path.join(dir, 'out');
  const observedUrls: string[] = [];

  writeJson(refsFile, [
    {
      id: 'flow-a',
      version: '01.00.001',
    },
  ]);

  try {
    const report = await runFlowFetchRows({
      refsFile,
      outDir,
      allowLatestFallback: false,
      env: buildSupabaseTestEnv({
        TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co',
      }),
      fetchImpl: jsonFetch([[]], observedUrls),
    });

    assert.equal(report.allow_latest_fallback, false);
    assert.equal(report.resolved_ref_count, 0);
    assert.equal(report.missing_ref_count, 1);
    assert.equal(observedUrls.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runFlowFetchRows rejects ref rows without ids', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-fetch-rows-invalid-'));
  const refsFile = path.join(dir, 'refs.json');

  writeJson(refsFile, [{ version: '01.00.001' }]);

  try {
    await assert.rejects(
      () =>
        runFlowFetchRows({
          refsFile,
          outDir: path.join(dir, 'out'),
          env: buildSupabaseTestEnv({
            TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co',
          }),
          fetchImpl: jsonFetch([[]]),
        }),
      (error) => error instanceof CliError && error.code === 'FLOW_FETCH_ROWS_REF_ID_REQUIRED',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('flow fetch row helpers normalize tokens, parse integers, and reject invalid refs', () => {
  assert.equal(flowFetchRowsInternals.normalizeToken(null), null);
  assert.equal(flowFetchRowsInternals.normalizeToken('   '), null);
  assert.equal(
    flowFetchRowsInternals.normalizeOptionalNonNegativeInteger(
      '7',
      'flow ref state_code',
      'FLOW_FETCH_ROWS_INVALID_STATE_CODE',
    ),
    7,
  );

  assert.deepEqual(
    flowFetchRowsInternals.normalizeFlowFetchRef(
      {
        id: ' flow-a ',
        userId: ' user-1 ',
        clusterId: ' cluster-1 ',
        source: ' search-flow ',
        stateCode: '0',
      },
      0,
    ),
    {
      id: 'flow-a',
      version: null,
      userId: 'user-1',
      stateCode: 0,
      clusterId: 'cluster-1',
      source: 'search-flow',
    },
  );

  assert.throws(
    () =>
      flowFetchRowsInternals.normalizeOptionalNonNegativeInteger(
        'oops',
        'flow ref state_code',
        'FLOW_FETCH_ROWS_INVALID_STATE_CODE',
      ),
    (error) => error instanceof CliError && error.code === 'FLOW_FETCH_ROWS_INVALID_STATE_CODE',
  );
  assert.throws(
    () => flowFetchRowsInternals.normalizeFlowFetchRef({ id: '   ' }, 0),
    (error) => error instanceof CliError && error.code === 'FLOW_FETCH_ROWS_REF_ID_REQUIRED',
  );
});

test(
  'runFlowFetchRows can use process.env and global fetch and completes without gaps',
  { concurrency: false },
  async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-fetch-rows-global-'));
    const refsFile = path.join(dir, 'refs.json');
    const outDir = path.join(dir, 'out');
    const observedUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    const originalEnv = {
      TIANGONG_LCA_API_BASE_URL: process.env.TIANGONG_LCA_API_BASE_URL,
      TIANGONG_LCA_API_KEY: process.env.TIANGONG_LCA_API_KEY,
      TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY: process.env.TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY,
    };

    writeJson(refsFile, [
      {
        id: 'flow-global',
        version: '01.00.001',
        state_code: 100,
      },
    ]);

    try {
      Object.assign(
        process.env,
        buildSupabaseTestEnv({
          TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/functions/v1',
        }),
      );

      globalThis.fetch = (async (input) => {
        if (isSupabaseAuthTokenUrl(String(input))) {
          return makeSupabaseAuthResponse();
        }

        observedUrls.push(String(input));
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
                user_id: 'user-global',
                state_code: 100,
                modified_at: null,
                json: { flowDataSet: { id: 'flow-global', version: '01.00.001' } },
              },
            ]),
        };
      }) as typeof fetch;

      const report = await runFlowFetchRows({
        refsFile,
        outDir,
        now: new Date('2026-04-06T14:00:00.000Z'),
      });

      assert.equal(report.status, 'completed_flow_row_materialization');
      assert.equal(report.resolved_ref_count, 1);
      assert.equal(report.missing_ref_count, 0);
      assert.equal(report.ambiguous_ref_count, 0);
      assert.deepEqual(report.resolution_counts, {
        remote_supabase_exact: 1,
        remote_supabase_latest: 0,
        remote_supabase_latest_fallback: 0,
      });
      assert.equal(observedUrls.length, 1);

      const reviewInputRows = readJsonLines(report.files.review_input_rows);
      assert.equal(reviewInputRows.length, 1);
      assert.equal(reviewInputRows[0]?.id, 'flow-global');
      assert.equal(reviewInputRows[0]?.version, '01.00.001');
      assert.equal(
        ((reviewInputRows[0]?._materialization as JsonRecord).flow_key as string) ?? '',
        'flow-global@01.00.001',
      );
    } finally {
      globalThis.fetch = originalFetch;

      Object.entries(originalEnv).forEach(([key, value]) => {
        if (typeof value === 'string') {
          process.env[key] = value;
        } else {
          delete process.env[key];
        }
      });

      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test('runFlowFetchRows validates required flags and rethrows non-ambiguous lookup failures', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-fetch-rows-required-'));
  const refsFile = path.join(dir, 'refs.json');

  writeJson(refsFile, [{ id: 'flow-a', version: '01.00.001' }]);

  try {
    await assert.rejects(
      () =>
        runFlowFetchRows({
          refsFile: '',
          outDir: path.join(dir, 'out'),
        }),
      (error) => error instanceof CliError && error.code === 'FLOW_FETCH_ROWS_REFS_FILE_REQUIRED',
    );
    await assert.rejects(
      () =>
        runFlowFetchRows({
          refsFile,
          outDir: '',
        }),
      (error) => error instanceof CliError && error.code === 'FLOW_FETCH_ROWS_OUT_DIR_REQUIRED',
    );
    await assert.rejects(
      () =>
        runFlowFetchRows({
          refsFile,
          outDir: path.join(dir, 'out'),
          env: buildSupabaseTestEnv({
            TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/functions/v1',
          }),
          fetchImpl: (async (input) => {
            if (isSupabaseAuthTokenUrl(String(input))) {
              return makeSupabaseAuthResponse();
            }

            throw new Error('network boom');
          }) as FetchLike,
        }),
      (error) =>
        error instanceof CliError &&
        error.code === 'REMOTE_REQUEST_FAILED' &&
        /HTTP 0 returned/u.test(error.message),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runFlowFetchRows records a missing ref message when no version is requested', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-fetch-rows-latest-miss-'));
  const refsFile = path.join(dir, 'refs.json');
  const outDir = path.join(dir, 'out');

  writeJson(refsFile, [{ id: 'flow-missing' }]);

  try {
    const report = await runFlowFetchRows({
      refsFile,
      outDir,
      env: buildSupabaseTestEnv({
        TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/functions/v1',
      }),
      fetchImpl: jsonFetch([[]]),
    });

    assert.equal(report.status, 'completed_flow_row_materialization_with_gaps');
    const missingRefs = readJsonLines(report.files.missing_flow_refs);
    assert.equal(missingRefs.length, 1);
    assert.equal(missingRefs[0]?.message, 'Could not resolve flow dataset for flow-missing.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runFlowFetchRows can materialize a ref with an empty resolved version when neither side provides one', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-fetch-rows-empty-version-'));
  const refsFile = path.join(dir, 'refs.json');
  const outDir = path.join(dir, 'out');

  writeJson(refsFile, [{ id: 'flow-no-version' }]);

  try {
    const report = await runFlowFetchRows({
      refsFile,
      outDir,
      env: buildSupabaseTestEnv({
        TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/functions/v1',
      }),
      fetchImpl: jsonFetch([
        [
          {
            id: '',
            version: '',
            user_id: 'user-empty-version',
            state_code: 100,
            modified_at: null,
            json: { flowDataSet: { id: 'flow-no-version' } },
          },
        ],
      ]),
    });

    assert.equal(report.status, 'completed_flow_row_materialization');
    const resolvedRows = readJsonLines(report.files.resolved_flow_rows);
    assert.equal(resolvedRows[0]?.id, 'flow-no-version');
    assert.equal(resolvedRows[0]?.version, '');

    const reviewRows = readJsonLines(report.files.review_input_rows);
    assert.equal(reviewRows[0]?.version, '');
    assert.equal(
      ((reviewRows[0]?._materialization as JsonRecord).flow_key as string) ?? '',
      'flow-no-version@',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
