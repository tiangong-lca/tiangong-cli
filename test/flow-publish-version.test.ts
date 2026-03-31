import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError } from '../src/lib/errors.js';
import type { FetchLike } from '../src/lib/http.js';
import { __testInternals, runFlowPublishVersion } from '../src/lib/flow-publish-version.js';

type JsonRecord = Record<string, unknown>;

type FetchSpec = {
  ok?: boolean;
  status?: number;
  contentType?: string;
  body?: unknown;
  rawText?: string;
};

function writeJsonl(filePath: string, rows: unknown[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    `${rows.map((row) => JSON.stringify(row)).join('\n')}${rows.length ? '\n' : ''}`,
    'utf8',
  );
}

function makeFlowRow(options: {
  id: string;
  version?: string;
  userId?: string | null;
  envelope?: 'json_ordered' | 'jsonOrdered' | 'json' | 'root';
}): JsonRecord {
  const payload = {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          'common:UUID': options.id,
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          'common:dataSetVersion': options.version ?? '01.00.001',
        },
      },
    },
  };

  const row: JsonRecord = {
    id: options.id,
    version: options.version ?? '01.00.001',
    state_code: 100,
  };
  if (options.userId !== null) {
    row.user_id = options.userId ?? `${options.id}-owner`;
  }

  const envelope = options.envelope ?? 'json_ordered';
  if (envelope === 'json_ordered') {
    row.json_ordered = payload;
  } else if (envelope === 'jsonOrdered') {
    row.jsonOrdered = payload;
  } else if (envelope === 'json') {
    row.json = payload;
  } else {
    return payload;
  }

  return row;
}

function makeFetchQueue(
  specs: FetchSpec[],
  observed: Array<{
    url: string;
    method: string;
    headers: HeadersInit | undefined;
    body: string | undefined;
  }>,
): FetchLike {
  let index = 0;
  return (async (input, init) => {
    observed.push({
      url: String(input),
      method: String(init?.method ?? ''),
      headers: init?.headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const spec = specs[Math.min(index, specs.length - 1)] as FetchSpec;
    index += 1;
    return {
      ok: spec.ok ?? true,
      status: spec.status ?? 200,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'content-type' ? (spec.contentType ?? 'application/json') : null,
      },
      text: async () =>
        spec.rawText ??
        (typeof spec.body === 'string'
          ? spec.body
          : spec.body === undefined
            ? ''
            : JSON.stringify(spec.body)),
    };
  }) as FetchLike;
}

test('runFlowPublishVersion writes dry-run artifacts for insert, update, and failure planning', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-publish-version-dry-run-'));
  const inputFile = path.join(dir, 'ready-flows.jsonl');
  const outDir = path.join(dir, 'publish-version');
  const observed: Array<{
    url: string;
    method: string;
    headers: HeadersInit | undefined;
    body: string | undefined;
  }> = [];

  writeJsonl(inputFile, [
    makeFlowRow({ id: 'flow-1', userId: 'user-1' }),
    makeFlowRow({ id: 'flow-2', userId: 'user-2', envelope: 'jsonOrdered' }),
    makeFlowRow({ id: 'flow-3', userId: null }),
    makeFlowRow({ id: 'flow-4', userId: 'user-4', envelope: 'json' }),
  ]);

  try {
    const report = await runFlowPublishVersion({
      inputFile,
      outDir,
      env: {
        TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/functions/v1',
        TIANGONG_LCA_API_KEY: 'secret-token',
      } as NodeJS.ProcessEnv,
      fetchImpl: makeFetchQueue(
        [
          { body: [] },
          {
            body: [{ id: 'flow-2', version: '01.00.001', user_id: 'user-2', state_code: 100 }],
          },
          {
            body: [{ id: 'flow-3', version: '01.00.001', user_id: 'other-user', state_code: 30 }],
          },
          {
            contentType: 'application/json',
            rawText: '{invalid-json',
          },
        ],
        observed,
      ),
      now: new Date('2026-03-30T12:00:00.000Z'),
      maxWorkers: 1,
    });

    assert.deepEqual(report, {
      schema_version: 1,
      generated_at_utc: '2026-03-30T12:00:00.000Z',
      status: 'prepared_flow_publish_version',
      mode: 'dry_run',
      input_file: inputFile,
      out_dir: outDir,
      counts: {
        total_rows: 4,
        success_count: 2,
        failure_count: 2,
      },
      operation_counts: {
        would_insert: 1,
        would_update_existing: 1,
      },
      max_workers: 1,
      limit: null,
      target_user_id_override: null,
      files: {
        success_list: path.join(
          outDir,
          'flows_tidas_sdk_plus_classification_mcp_success_list.json',
        ),
        remote_failed: path.join(
          outDir,
          'flows_tidas_sdk_plus_classification_remote_validation_failed.jsonl',
        ),
        report: path.join(outDir, 'flows_tidas_sdk_plus_classification_mcp_sync_report.json'),
      },
    });

    const successList = JSON.parse(readFileSync(report.files.success_list, 'utf8')) as JsonRecord[];
    assert.deepEqual(successList, [
      { id: 'flow-1', version: '01.00.001', operation: 'would_insert' },
      { id: 'flow-2', version: '01.00.001', operation: 'would_update_existing' },
    ]);

    const failures = readFileSync(report.files.remote_failed, 'utf8')
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as JsonRecord);
    assert.equal(failures.length, 2);
    assert.equal(
      ((failures[0].reason as JsonRecord[])[0] as JsonRecord).code,
      'target_user_id_required',
    );
    assert.equal(
      ((failures[1].reason as JsonRecord[])[0] as JsonRecord).code,
      'REMOTE_INVALID_JSON',
    );

    assert.equal(observed.length, 4);
    assert.ok(observed.every((entry) => entry.method === 'GET'));
    assert.ok(observed.every((entry) => entry.body === undefined));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runFlowPublishVersion commit executes update, insert, fallback update, and failure handling', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-publish-version-commit-'));
  const inputFile = path.join(dir, 'ready-flows.jsonl');
  const outDir = path.join(dir, 'publish-version');
  const observed: Array<{
    url: string;
    method: string;
    headers: HeadersInit | undefined;
    body: string | undefined;
  }> = [];

  writeJsonl(inputFile, [
    makeFlowRow({ id: 'flow-1', userId: 'user-1' }),
    makeFlowRow({ id: 'flow-2', userId: 'user-2' }),
    makeFlowRow({ id: 'flow-3', userId: 'user-3' }),
    makeFlowRow({ id: 'flow-4', userId: 'user-4' }),
    makeFlowRow({ id: 'flow-5', userId: 'user-5' }),
  ]);

  try {
    const report = await runFlowPublishVersion({
      inputFile,
      outDir,
      commit: true,
      maxWorkers: 1,
      env: {
        TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/rest/v1',
        TIANGONG_LCA_API_KEY: 'secret-token',
      } as NodeJS.ProcessEnv,
      fetchImpl: makeFetchQueue(
        [
          {
            body: [{ id: 'flow-1', version: '01.00.001', user_id: 'user-1', state_code: 100 }],
          },
          { contentType: 'text/plain', rawText: 'patched' },
          { body: [] },
          { contentType: '', rawText: '' },
          { body: [] },
          { ok: false, status: 409, contentType: 'text/plain', rawText: 'duplicate' },
          {
            body: [{ id: 'flow-3', version: '01.00.001', user_id: 'user-3', state_code: 100 }],
          },
          { body: [] },
          {
            body: [{ id: 'flow-4', version: '01.00.001', user_id: 'other-user', state_code: 40 }],
          },
          { body: [] },
          { ok: false, status: 500, contentType: 'application/json', body: { message: 'boom' } },
          { body: [] },
        ],
        observed,
      ),
      now: new Date('2026-03-30T13:00:00.000Z'),
    });

    assert.equal(report.status, 'completed_flow_publish_version_with_failures');
    assert.equal(report.mode, 'commit');
    assert.deepEqual(report.counts, {
      total_rows: 5,
      success_count: 3,
      failure_count: 2,
    });
    assert.deepEqual(report.operation_counts, {
      update_existing: 1,
      insert: 1,
      update_after_insert_error: 1,
    });

    const successList = JSON.parse(readFileSync(report.files.success_list, 'utf8')) as JsonRecord[];
    assert.deepEqual(successList, [
      { id: 'flow-1', version: '01.00.001', operation: 'update_existing' },
      { id: 'flow-2', version: '01.00.001', operation: 'insert' },
      { id: 'flow-3', version: '01.00.001', operation: 'update_after_insert_error' },
    ]);

    const failures = readFileSync(report.files.remote_failed, 'utf8')
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as JsonRecord);
    assert.equal(failures.length, 2);
    assert.equal(
      ((failures[0].reason as JsonRecord[])[0] as JsonRecord).code,
      'exact_version_visible_not_owned',
    );
    assert.equal(
      ((failures[1].reason as JsonRecord[])[0] as JsonRecord).code,
      'REMOTE_REQUEST_FAILED',
    );

    assert.deepEqual(
      observed.map((entry) => entry.method),
      ['GET', 'PATCH', 'GET', 'POST', 'GET', 'POST', 'GET', 'PATCH', 'GET', 'GET', 'POST', 'GET'],
    );
    assert.match(observed[1]?.url ?? '', /version=eq\.01\.00\.001/u);
    assert.match(observed[3]?.url ?? '', /\/rest\/v1\/flows$/u);
    assert.match(observed[1]?.body ?? '', /json_ordered/u);
    assert.match(observed[3]?.body ?? '', /"id":"flow-2"/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runFlowPublishVersion can fall back to process.env and global fetch and respect limit', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-publish-version-global-'));
  const inputFile = path.join(dir, 'ready-flows.jsonl');
  const outDir = path.join(dir, 'publish-version');
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.TIANGONG_LCA_API_BASE_URL;
  const originalApiKey = process.env.TIANGONG_LCA_API_KEY;

  writeJsonl(inputFile, [
    makeFlowRow({ id: 'flow-1', userId: 'user-1' }),
    makeFlowRow({ id: 'flow-2', userId: 'user-2' }),
  ]);

  process.env.TIANGONG_LCA_API_BASE_URL = 'https://example.supabase.co/functions/v1';
  process.env.TIANGONG_LCA_API_KEY = 'secret-token';
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    headers: {
      get: () => 'application/json',
    },
    text: async () => '[]',
  })) as unknown as typeof fetch;

  try {
    const report = await runFlowPublishVersion({
      inputFile,
      outDir,
      limit: 1,
    });

    assert.equal(report.status, 'prepared_flow_publish_version');
    assert.equal(report.counts.total_rows, 1);
    assert.equal(report.counts.success_count, 1);
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
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runFlowPublishVersion rejects empty inputs', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-publish-version-empty-'));
  const inputFile = path.join(dir, 'ready-flows.jsonl');
  writeJsonl(inputFile, []);

  try {
    await assert.rejects(
      () =>
        runFlowPublishVersion({
          inputFile,
          outDir: path.join(dir, 'publish-version'),
          env: {
            TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co',
            TIANGONG_LCA_API_KEY: 'secret-token',
          } as NodeJS.ProcessEnv,
          fetchImpl: makeFetchQueue([], []),
        }),
      (error) => error instanceof CliError && error.code === 'FLOW_PUBLISH_VERSION_EMPTY_INPUT',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runFlowPublishVersion records rows with missing ids as failures without remote calls', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-publish-version-missing-id-'));
  const inputFile = path.join(dir, 'ready-flows.jsonl');
  const outDir = path.join(dir, 'publish-version');
  const observed: Array<{
    url: string;
    method: string;
    headers: HeadersInit | undefined;
    body: string | undefined;
  }> = [];

  writeJsonl(inputFile, [
    {
      json_ordered: {
        flowDataSet: {
          administrativeInformation: {
            publicationAndOwnership: {
              'common:dataSetVersion': '01.00.001',
            },
          },
        },
      },
    },
  ]);

  try {
    const report = await runFlowPublishVersion({
      inputFile,
      outDir,
      env: {
        TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/rest/v1',
        TIANGONG_LCA_API_KEY: 'secret-token',
      } as NodeJS.ProcessEnv,
      fetchImpl: makeFetchQueue([], observed),
      maxWorkers: 1,
    });

    assert.equal(report.status, 'prepared_flow_publish_version');
    assert.deepEqual(report.counts, {
      total_rows: 1,
      success_count: 0,
      failure_count: 1,
    });
    assert.equal(observed.length, 0);

    const failures = readFileSync(report.files.remote_failed, 'utf8')
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as JsonRecord);
    assert.equal(failures.length, 1);
    assert.equal(
      ((failures[0].reason as JsonRecord[])[0] as JsonRecord).code,
      'FLOW_PUBLISH_VERSION_ID_REQUIRED',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runFlowPublishVersion surfaces update-after-insert-error failures when fallback patch also fails', async () => {
  const dir = mkdtempSync(
    path.join(os.tmpdir(), 'tg-cli-flow-publish-version-update-after-insert-failure-'),
  );
  const inputFile = path.join(dir, 'ready-flows.jsonl');
  const outDir = path.join(dir, 'publish-version');
  const observed: Array<{
    url: string;
    method: string;
    headers: HeadersInit | undefined;
    body: string | undefined;
  }> = [];

  writeJsonl(inputFile, [makeFlowRow({ id: 'flow-1', userId: 'user-1' })]);

  try {
    const report = await runFlowPublishVersion({
      inputFile,
      outDir,
      commit: true,
      maxWorkers: 1,
      env: {
        TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co/rest/v1',
        TIANGONG_LCA_API_KEY: 'secret-token',
      } as NodeJS.ProcessEnv,
      fetchImpl: makeFetchQueue(
        [
          { body: [] },
          { ok: false, status: 409, contentType: 'text/plain', rawText: 'duplicate' },
          {
            body: [{ id: 'flow-1', version: '01.00.001', user_id: 'user-1', state_code: 100 }],
          },
          { ok: false, status: 500, contentType: 'text/plain', rawText: 'patch failed' },
        ],
        observed,
      ),
      now: new Date('2026-03-30T14:00:00.000Z'),
    });

    assert.equal(report.status, 'completed_flow_publish_version_with_failures');
    assert.deepEqual(report.counts, {
      total_rows: 1,
      success_count: 0,
      failure_count: 1,
    });
    assert.deepEqual(
      observed.map((entry) => entry.method),
      ['GET', 'POST', 'GET', 'PATCH'],
    );

    const failures = readFileSync(report.files.remote_failed, 'utf8')
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as JsonRecord);
    assert.equal(failures.length, 1);
    assert.deepEqual(
      (failures[0].reason as JsonRecord[]).map((reason) => (reason as JsonRecord).stage),
      ['insert', 'update_after_insert_error'],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('flow publish-version helper internals cover validation, parsing, concurrency, and error normalization', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-publish-version-internals-'));
  const existingInput = path.join(dir, 'rows.jsonl');
  writeJsonl(existingInput, [makeFlowRow({ id: 'row-1', userId: 'user-1' })]);

  try {
    assert.equal(__testInternals.assert_input_file(existingInput), existingInput);
    assert.throws(
      () => __testInternals.assert_input_file(''),
      (error: unknown) =>
        error instanceof CliError && error.code === 'FLOW_PUBLISH_VERSION_INPUT_REQUIRED',
    );
    assert.throws(
      () => __testInternals.assert_input_file(path.join(dir, 'missing.jsonl')),
      (error: unknown) =>
        error instanceof CliError && error.code === 'FLOW_PUBLISH_VERSION_INPUT_NOT_FOUND',
    );
    assert.equal(__testInternals.assert_out_dir(dir), dir);
    assert.throws(
      () => __testInternals.assert_out_dir(''),
      (error: unknown) =>
        error instanceof CliError && error.code === 'FLOW_PUBLISH_VERSION_OUT_DIR_REQUIRED',
    );

    assert.equal(__testInternals.to_positive_integer(undefined, '--x', 'ERR', 4), 4);
    assert.equal(__testInternals.to_positive_integer(2, '--x', 'ERR', 4), 2);
    assert.throws(
      () => __testInternals.to_positive_integer(0, '--x', 'ERR', 4),
      (error: unknown) => error instanceof CliError && error.code === 'ERR',
    );

    assert.equal(__testInternals.to_non_negative_integer(undefined, '--y', 'ERR2'), null);
    assert.equal(__testInternals.to_non_negative_integer(0, '--y', 'ERR2'), 0);
    assert.throws(
      () => __testInternals.to_non_negative_integer(-1, '--y', 'ERR2'),
      (error: unknown) => error instanceof CliError && error.code === 'ERR2',
    );

    const files = __testInternals.build_output_files(dir);
    assert.equal(
      path.basename(files.successList),
      'flows_tidas_sdk_plus_classification_mcp_success_list.json',
    );

    const jsonOrderedRow = makeFlowRow({ id: 'row-jsonOrdered', envelope: 'jsonOrdered' });
    const jsonRow = makeFlowRow({ id: 'row-json', envelope: 'json' });
    const rootRow = makeFlowRow({ id: 'row-root', envelope: 'root' });
    assert.equal(
      (
        ((__testInternals.flow_payload(jsonOrderedRow) as JsonRecord).flowDataSet ??
          {}) as JsonRecord
      ).administrativeInformation !== undefined,
      true,
    );
    assert.equal(
      (((__testInternals.flow_payload(jsonRow) as JsonRecord).flowDataSet ?? {}) as JsonRecord)
        .administrativeInformation !== undefined,
      true,
    );
    assert.equal(
      (((__testInternals.flow_payload(rootRow) as JsonRecord).flowDataSet ?? {}) as JsonRecord)
        .administrativeInformation !== undefined,
      true,
    );
    assert.throws(
      () => __testInternals.flow_payload({ bad: true }),
      (error: unknown) =>
        error instanceof CliError && error.code === 'FLOW_PUBLISH_VERSION_PAYLOAD_REQUIRED',
    );

    const payload = __testInternals.flow_payload(makeFlowRow({ id: 'row-2' }));
    assert.equal(__testInternals.flow_id({ id: 'direct-id' }, payload as JsonRecord), 'direct-id');
    assert.equal(__testInternals.flow_id({}, payload as JsonRecord), 'row-2');
    assert.equal(__testInternals.flow_version(payload as JsonRecord), '01.00.001');
    assert.throws(
      () => __testInternals.flow_version({ flowDataSet: {} }),
      (error: unknown) =>
        error instanceof CliError && error.code === 'FLOW_PUBLISH_VERSION_MISSING_VERSION',
    );

    assert.equal(
      __testInternals.resolve_target_user_id({ user_id: 'row-user' }, 'override-user'),
      'row-user',
    );
    assert.equal(__testInternals.resolve_target_user_id({}, 'override-user'), 'override-user');
    assert.equal(__testInternals.resolve_target_user_id({}, null), null);

    assert.match(
      __testInternals.build_visible_rows_url(
        'https://example.supabase.co/rest/v1',
        'flow-1',
        '01.00.001',
      ),
      /select=id%2Cversion%2Cuser_id%2Cstate_code/u,
    );
    assert.match(
      __testInternals.build_update_url(
        'https://example.supabase.co/rest/v1',
        'flow-1',
        '01.00.001',
      ),
      /version=eq\.01\.00\.001/u,
    );

    assert.deepEqual(
      __testInternals.parse_visible_rows(
        [{ id: 'flow-1', version: '01.00.001', user_id: 'user-1', state_code: 100 }],
        'https://example.test',
      ),
      [{ id: 'flow-1', version: '01.00.001', user_id: 'user-1', state_code: 100 }],
    );
    assert.deepEqual(
      __testInternals.parse_visible_rows(
        [{ id: 'flow-2', version: '01.00.001', user_id: 'user-2', state_code: 'bad' }],
        'https://example.test',
      ),
      [{ id: 'flow-2', version: '01.00.001', user_id: 'user-2', state_code: null }],
    );
    assert.throws(
      () => __testInternals.parse_visible_rows({}, 'https://example.test'),
      (error: unknown) =>
        error instanceof CliError && error.code === 'SUPABASE_REST_RESPONSE_INVALID',
    );
    assert.throws(
      () => __testInternals.parse_visible_rows([null], 'https://example.test'),
      (error: unknown) =>
        error instanceof CliError && error.code === 'SUPABASE_REST_RESPONSE_INVALID',
    );

    assert.deepEqual(__testInternals.visible_conflict_reasons('stage', [], 'user-1'), []);
    assert.equal(
      __testInternals.visible_conflict_reasons(
        'stage',
        [{ id: '', version: '', user_id: '', state_code: null }],
        null,
      )[0]?.code,
      'target_user_id_required',
    );
    assert.equal(
      __testInternals.visible_conflict_reasons(
        'stage',
        [{ id: '', version: '', user_id: 'other', state_code: 5 }],
        'user-1',
      )[0]?.code,
      'exact_version_visible_not_owned',
    );
    assert.equal(
      __testInternals.visible_conflict_reasons(
        'stage',
        [{ id: '', version: '', user_id: 'other', state_code: null }],
        'user-1',
      )[0]?.visible_state_code,
      '',
    );

    assert.deepEqual(__testInternals.failure_row({ id: 'x' }, []).json_ordered, {});
    assert.equal(
      __testInternals.build_error_reasons(
        'stage',
        new CliError('boom', { code: 'CLI_ERR', exitCode: 1, details: 'detail-text' }),
      )[0]?.code,
      'CLI_ERR',
    );
    assert.equal(
      __testInternals.build_error_reasons(
        'stage',
        new CliError('boom', { code: 'CLI_ERR_EMPTY_DETAIL', exitCode: 1, details: '   ' }),
      )[0]?.message,
      'boom',
    );
    assert.equal(
      __testInternals.build_error_reasons('stage', new Error('plain-error'))[0]?.message,
      'plain-error',
    );
    const unnamedError = new Error('plain-error');
    unnamedError.name = '';
    assert.equal(__testInternals.build_error_reasons('stage', unnamedError)[0]?.code, 'Error');
    assert.equal(
      __testInternals.build_error_reasons('stage', 'string-error')[0]?.code,
      'UnknownError',
    );
    assert.equal(
      await __testInternals.parse_response(
        {
          ok: true,
          status: 200,
          headers: {
            get: () => null,
          },
          text: async () => 'plain-text',
        },
        'https://example.test',
      ),
      'plain-text',
    );

    assert.deepEqual(
      await __testInternals.map_with_concurrency([1, 2, 3], 3, async (value: number) => value * 2),
      [2, 4, 6],
    );
    assert.deepEqual(
      await __testInternals.map_with_concurrency([], 5, async (value: number) => value * 2),
      [],
    );

    assert.equal(__testInternals.status_from_mode('dry_run', 0), 'prepared_flow_publish_version');
    assert.equal(__testInternals.status_from_mode('commit', 0), 'completed_flow_publish_version');
    assert.equal(
      __testInternals.status_from_mode('commit', 1),
      'completed_flow_publish_version_with_failures',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
