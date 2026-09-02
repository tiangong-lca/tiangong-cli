import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { __testInternals, runProcessDedupReview } from '../src/lib/process-dedup-review.js';
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

function langEntries(en: string, zh: string): JsonRecord[] {
  return [
    { '@xml:lang': 'en', '#text': en },
    { '@xml:lang': 'zh', '#text': zh },
  ];
}

function flatExchange(options: {
  flowId: string;
  direction: 'Input' | 'Output';
  meanAmount: string;
  resultingAmount: string;
  shortDescriptionEn?: string;
  shortDescriptionZh?: string;
  exchangeInternalId?: string;
}): JsonRecord {
  return {
    exchange_internal_id: options.exchangeInternalId ?? `${options.flowId}-${options.direction}`,
    flow_id: options.flowId,
    direction: options.direction,
    mean_amount: options.meanAmount,
    resulting_amount: options.resultingAmount,
    flow_short_description_en: options.shortDescriptionEn ?? '',
    flow_short_description_zh: options.shortDescriptionZh ?? '',
  };
}

function remoteExchange(options: {
  flowId: string;
  direction: 'Input' | 'Output';
  meanAmount: string;
  resultingAmount: string;
  shortDescriptionEn?: string;
  shortDescriptionZh?: string;
  exchangeInternalId?: string;
}): JsonRecord {
  return {
    '@dataSetInternalID': options.exchangeInternalId ?? `${options.flowId}-${options.direction}`,
    exchangeDirection: options.direction,
    meanAmount: options.meanAmount,
    resultingAmount: options.resultingAmount,
    referenceToFlowDataSet: {
      '@refObjectId': options.flowId,
      '@version': '01.00.000',
      'common:shortDescription': langEntries(
        options.shortDescriptionEn ?? '',
        options.shortDescriptionZh ?? '',
      ),
    },
  };
}

function createRemoteProcessJson(
  nameEn: string,
  nameZh: string,
  exchanges: JsonRecord[],
): JsonRecord {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          name: {
            baseName: langEntries(nameEn, nameZh),
          },
        },
      },
      exchanges: {
        exchange: exchanges,
      },
    },
  };
}

const DUPLICATE_EXCHANGES = [
  flatExchange({
    flowId: 'flow-waste-paper',
    direction: 'Input',
    meanAmount: '1.0',
    resultingAmount: '1',
    shortDescriptionEn: 'waste paper',
    shortDescriptionZh: '废纸',
  }),
  flatExchange({
    flowId: 'flow-product',
    direction: 'Output',
    meanAmount: '1',
    resultingAmount: '1',
    shortDescriptionEn: 'waste paper',
    shortDescriptionZh: '废纸',
  }),
];

test('runProcessDedupReview analyzes grouped duplicate candidates locally', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-dedup-local-'));
  const inputPath = path.join(dir, 'dedup-input.json');
  const outDir = path.join(dir, 'artifacts');

  writeJson(inputPath, {
    source_label: 'manual-dedup-export',
    groups: [
      {
        group_id: 1,
        processes: [
          {
            process_id: 'proc-keep',
            version: '01.00.000',
            name_en: 'Waste paper collection',
            name_zh: '废纸收集',
            sheet_exchange_rows: DUPLICATE_EXCHANGES,
          },
          {
            process_id: 'proc-delete',
            version: '01.00.000',
            name_en: 'Wastepaper processing',
            name_zh: '废纸加工',
            sheet_exchange_rows: [...DUPLICATE_EXCHANGES].reverse(),
          },
        ],
      },
    ],
  });

  try {
    const report = await runProcessDedupReview({
      inputPath,
      outDir,
      skipRemote: true,
      now: new Date('2026-04-18T00:00:00.000Z'),
    });

    assert.equal(report.status, 'completed_process_dedup_review');
    assert.equal(report.group_count, 1);
    assert.equal(report.exact_duplicate_group_count, 1);
    assert.equal(report.ruleset_id, 'process-dedup/default');
    assert.equal(report.gate?.status, 'blocked');
    assert.equal(
      report.gate?.blockers[0]?.methodology_rule_id,
      'tidas.process.identity.duplicate-fingerprint.block',
    );
    assert.equal(report.remote_status.enabled, false);
    assert.equal(report.remote_status.reference_scan, 'skipped_by_flag');

    const duplicateGroups = JSON.parse(readFileSync(report.files.duplicate_groups, 'utf8')) as {
      groups: Array<{
        exact_duplicate: boolean;
        methodology_rule_id?: string | null;
        processes: Array<{ process_id: string; analysis_exchanges: unknown[] }>;
      }>;
    };
    const deletePlan = JSON.parse(readFileSync(report.files.delete_plan, 'utf8')) as {
      groups: Array<{
        keep: { process_id: string };
        delete: Array<{ process_id: string }>;
        confidence: string;
        notes: string[];
      }>;
    };

    assert.equal(duplicateGroups.groups[0]?.exact_duplicate, true);
    assert.equal(
      duplicateGroups.groups[0]?.methodology_rule_id,
      'tidas.process.identity.duplicate-fingerprint.block',
    );
    assert.equal(duplicateGroups.groups[0]?.processes[0]?.analysis_exchanges.length, 2);
    assert.equal(deletePlan.groups[0]?.keep.process_id, 'proc-keep');
    assert.deepEqual(
      deletePlan.groups[0]?.delete.map((entry) => entry.process_id),
      ['proc-delete'],
    );
    assert.equal(deletePlan.groups[0]?.confidence, 'high');
    assert.match(deletePlan.groups[0]?.notes.join('\n') ?? '', /normalized exchange signature/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('process dedup helper scoring covers transport and same-flow pass-through naming branches', () => {
  assert.equal(
    __testInternals.buildDedupGate([
      {
        group_id: 'safe',
        group_pattern: 'unknown',
        exact_duplicate: false,
        processes: [],
      },
    ]).status,
    'passed',
  );

  assert.deepEqual(
    __testInternals.scoreProcessName(
      {
        name_en: 'Transport logistics collection',
        name_zh: '运输物流收集',
      },
      'transport_pass_through',
    ),
    {
      score: 40,
      reasons: [
        'name matches explicit transport-service input',
        'name is broader than the observed transport-service input',
        'collection is semantically consistent with a gather/sort process',
      ],
    },
  );

  assert.deepEqual(
    __testInternals.scoreProcessName(
      {
        name_en: 'Waste reception processing',
        name_zh: '废弃物接收加工',
      },
      'same_flow_pass_through',
    ),
    {
      score: 0,
      reasons: [
        'same-flow pass-through does not support a processing label',
        'reception matches same-flow intake/output handling',
      ],
    },
  );
});

test('runProcessDedupReview sorts group ids, skips non-exact groups, and records slash-based naming reasons', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-dedup-sort-order-'));
  const inputPath = path.join(dir, 'dedup-input.json');
  const outDir = path.join(dir, 'artifacts');

  writeJson(inputPath, {
    source_label: 'manual-dedup-export',
    groups: [
      {
        group_id: '10',
        processes: [
          {
            process_id: 'proc-keep',
            version: '01.00.000',
            name_en: 'Waste paper/cardboard collection',
            name_zh: '废纸/纸板收集',
            sheet_exchange_rows: DUPLICATE_EXCHANGES,
          },
          {
            process_id: 'proc-delete',
            version: '01.00.000',
            name_en: 'Waste paper/cardboard processing',
            name_zh: '废纸/纸板处理',
            sheet_exchange_rows: [...DUPLICATE_EXCHANGES].reverse(),
          },
        ],
      },
      {
        group_id: '2',
        processes: [
          {
            process_id: 'proc-non-exact-a',
            version: '01.00.000',
            name_en: 'Sorting A',
            name_zh: '分选A',
            sheet_exchange_rows: DUPLICATE_EXCHANGES,
          },
          {
            process_id: 'proc-non-exact-b',
            version: '01.00.000',
            name_en: 'Sorting B',
            name_zh: '分选B',
            sheet_exchange_rows: [
              ...DUPLICATE_EXCHANGES.slice(0, 1),
              flatExchange({
                flowId: 'flow-product',
                direction: 'Output',
                meanAmount: '2',
                resultingAmount: '2',
                shortDescriptionEn: 'waste paper',
                shortDescriptionZh: '废纸',
              }),
            ],
          },
        ],
      },
    ],
  });

  try {
    const report = await runProcessDedupReview({
      inputPath,
      outDir,
      skipRemote: true,
      now: new Date('2026-04-18T00:30:00.000Z'),
    });

    const duplicateGroups = JSON.parse(readFileSync(report.files.duplicate_groups, 'utf8')) as {
      groups: Array<{
        group_id: string;
        exact_duplicate: boolean;
        processes: Array<{ name_score_reasons: string[] }>;
      }>;
    };
    const deletePlan = JSON.parse(readFileSync(report.files.delete_plan, 'utf8')) as {
      groups: Array<{ group_id: string }>;
    };

    assert.deepEqual(
      duplicateGroups.groups.map((group) => group.group_id),
      [2, 10],
    );
    assert.equal(duplicateGroups.groups[0]?.exact_duplicate, false);
    assert.equal(deletePlan.groups.length, 1);
    assert.equal(deletePlan.groups[0]?.group_id, 10);
    assert.match(
      duplicateGroups.groups[1]?.processes[0]?.name_score_reasons.join('\n') ?? '',
      /broader material scope explicit/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessDedupReview enriches duplicate candidates with remote metadata and reference scans', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-dedup-remote-'));
  const inputPath = path.join(dir, 'dedup-input.json');
  const outDir = path.join(dir, 'artifacts');

  writeJson(inputPath, {
    source_label: 'remote-dedup-export',
    groups: {
      '1': {
        processes: [
          {
            process_id: 'proc-keep',
            version: '01.00.000',
            sheet_exchange_rows: DUPLICATE_EXCHANGES,
          },
          {
            process_id: 'proc-delete',
            version: '01.00.000',
            sheet_exchange_rows: [...DUPLICATE_EXCHANGES].reverse(),
          },
        ],
      },
    },
  });

  const remoteProcessRows = [
    {
      id: 'proc-delete',
      version: '01.00.000',
      state_code: 0,
      created_at: '2026-04-10T00:00:00.000Z',
      modified_at: '2026-04-16T00:00:00.000Z',
      user_id: 'user-1',
      team_id: 'team-1',
      model_id: 'model-delete',
      json: createRemoteProcessJson('Wastepaper processing', '废纸加工', [
        remoteExchange({
          flowId: 'flow-product',
          direction: 'Output',
          meanAmount: '1',
          resultingAmount: '1',
          shortDescriptionEn: 'waste paper',
          shortDescriptionZh: '废纸',
        }),
        remoteExchange({
          flowId: 'flow-waste-paper',
          direction: 'Input',
          meanAmount: '1.0',
          resultingAmount: '1',
          shortDescriptionEn: 'waste paper',
          shortDescriptionZh: '废纸',
        }),
      ]),
    },
    {
      id: 'proc-keep',
      version: '01.00.000',
      state_code: 0,
      created_at: '2026-04-09T00:00:00.000Z',
      modified_at: '2026-04-15T00:00:00.000Z',
      user_id: 'user-1',
      team_id: 'team-1',
      model_id: 'model-keep',
      json: createRemoteProcessJson('Waste paper collection', '废纸收集', [
        remoteExchange({
          flowId: 'flow-waste-paper',
          direction: 'Input',
          meanAmount: '1.0',
          resultingAmount: '1',
          shortDescriptionEn: 'waste paper',
          shortDescriptionZh: '废纸',
        }),
        remoteExchange({
          flowId: 'flow-product',
          direction: 'Output',
          meanAmount: '1',
          resultingAmount: '1',
          shortDescriptionEn: 'waste paper',
          shortDescriptionZh: '废纸',
        }),
      ]),
    },
  ];

  const fetchImpl = (async (input) => {
    const url = String(input);
    if (isSupabaseAuthTokenUrl(url)) {
      return makeSupabaseAuthResponse({ userId: 'user-1' });
    }
    if (url.endsWith('/auth/v1/user')) {
      return jsonResponse({ id: 'user-1' });
    }
    if (
      url.includes('/rest/v1/processes?') &&
      url.includes('id=in.') &&
      !url.includes('user_id=eq.')
    ) {
      return jsonResponse(remoteProcessRows);
    }
    if (url.includes('/rest/v1/processes?') && url.includes('user_id=eq.user-1')) {
      return jsonResponse(
        [
          {
            id: 'proc-ref-1',
            version: '01.00.000',
            state_code: 0,
            user_id: 'user-1',
            model_id: 'ref-model',
            json: {
              downstream: {
                '@refObjectId': 'proc-keep',
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
    if (url.includes('/rest/v1/lifecyclemodels?') && url.includes('user_id=eq.user-1')) {
      return jsonResponse(
        [
          {
            id: 'lm-ref-1',
            version: '01.00.000',
            state_code: 0,
            user_id: 'user-1',
            json: {
              processLink: {
                '@refObjectId': 'proc-keep',
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
    const report = await runProcessDedupReview({
      inputPath,
      outDir,
      env: buildSupabaseTestEnv(),
      fetchImpl,
      now: new Date('2026-04-18T01:00:00.000Z'),
    });

    assert.equal(report.remote_status.enabled, true);
    assert.equal(report.remote_status.loaded, 2);
    assert.equal(report.remote_status.reference_scan, 'current_user_completed');
    assert.equal(report.files.remote_metadata !== null, true);
    assert.equal(report.files.current_user_reference_scan !== null, true);

    const deletePlan = JSON.parse(readFileSync(report.files.delete_plan, 'utf8')) as {
      groups: Array<{
        keep: { process_id: string };
        current_user_reference_hits: {
          keep_process_refs: number;
          keep_lifecyclemodel_refs: number;
          delete_refs: Record<string, { process_refs: number; lifecyclemodel_refs: number }>;
        };
      }>;
    };

    assert.equal(deletePlan.groups[0]?.keep.process_id, 'proc-keep');
    assert.equal(deletePlan.groups[0]?.current_user_reference_hits.keep_process_refs, 1);
    assert.equal(deletePlan.groups[0]?.current_user_reference_hits.keep_lifecyclemodel_refs, 1);
    assert.deepEqual(deletePlan.groups[0]?.current_user_reference_hits.delete_refs, {
      'proc-delete': {
        process_refs: 0,
        lifecyclemodel_refs: 0,
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessDedupReview skips the current-user reference scan when the user id is unavailable', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-dedup-no-user-id-'));
  const inputPath = path.join(dir, 'dedup-input.json');
  const outDir = path.join(dir, 'artifacts');

  writeJson(inputPath, {
    source_label: 'remote-dedup-export',
    groups: [
      {
        group_id: 1,
        processes: [
          {
            process_id: 'proc-keep',
            version: '01.00.000',
            sheet_exchange_rows: DUPLICATE_EXCHANGES,
          },
          {
            process_id: 'proc-delete',
            version: '01.00.000',
            sheet_exchange_rows: [...DUPLICATE_EXCHANGES].reverse(),
          },
        ],
      },
    ],
  });

  const fetchImpl = (async (input) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return jsonResponse({});
    }
    if (isSupabaseAuthTokenUrl(url)) {
      return makeSupabaseAuthResponse({ userId: 'session-user' });
    }
    if (url.includes('/rest/v1/processes?') && url.includes('id=in.')) {
      return jsonResponse([
        {
          id: 'proc-keep',
          version: '01.00.000',
          state_code: 0,
          json: createRemoteProcessJson('Waste paper collection', '废纸收集', [
            remoteExchange({
              flowId: 'flow-waste-paper',
              direction: 'Input',
              meanAmount: '1',
              resultingAmount: '1',
            }),
          ]),
        },
        {
          id: 'proc-delete',
          version: '01.00.000',
          state_code: 0,
          json: createRemoteProcessJson('Wastepaper processing', '废纸加工', [
            remoteExchange({
              flowId: 'flow-waste-paper',
              direction: 'Input',
              meanAmount: '1',
              resultingAmount: '1',
            }),
          ]),
        },
      ]);
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as FetchLike;

  try {
    const report = await runProcessDedupReview({
      inputPath,
      outDir,
      env: buildSupabaseTestEnv(),
      fetchImpl,
      now: new Date('2026-04-18T02:00:00.000Z'),
    });

    assert.equal(report.remote_status.enabled, true);
    assert.equal(report.remote_status.loaded, 2);
    assert.equal(report.remote_status.reference_scan, 'skipped_missing_user_id');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessDedupReview records remote metadata load failures without aborting local analysis', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-dedup-remote-error-'));
  const inputPath = path.join(dir, 'dedup-input.json');
  const outDir = path.join(dir, 'artifacts');

  writeJson(inputPath, {
    source_label: 'remote-dedup-export',
    groups: [
      {
        group_id: 1,
        processes: [
          {
            process_id: 'proc-keep',
            version: '01.00.000',
            sheet_exchange_rows: DUPLICATE_EXCHANGES,
          },
          {
            process_id: 'proc-delete',
            version: '01.00.000',
            sheet_exchange_rows: [...DUPLICATE_EXCHANGES].reverse(),
          },
        ],
      },
    ],
  });

  const fetchImpl = (async (input) => {
    const url = String(input);
    if (isSupabaseAuthTokenUrl(url)) {
      return makeSupabaseAuthResponse({ userId: 'user-1' });
    }
    if (url.endsWith('/auth/v1/user')) {
      return jsonResponse({ id: 'user-1' });
    }
    if (url.includes('/rest/v1/processes?') && url.includes('id=in.')) {
      throw new Error('remote metadata fetch failed');
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as FetchLike;

  try {
    const report = await runProcessDedupReview({
      inputPath,
      outDir,
      env: buildSupabaseTestEnv(),
      fetchImpl,
      maxRetries: 1,
      now: new Date('2026-04-18T03:00:00.000Z'),
    });

    assert.equal(report.status, 'completed_process_dedup_review');
    assert.equal(report.remote_status.enabled, false);
    assert.match(report.remote_status.error ?? '', /remote metadata fetch failed/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessDedupReview marks delete candidates that still have current-user downstream references', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-dedup-delete-refs-'));
  const inputPath = path.join(dir, 'dedup-input.json');
  const outDir = path.join(dir, 'artifacts');

  writeJson(inputPath, {
    source_label: 'remote-dedup-export',
    groups: [
      {
        group_id: 1,
        processes: [
          {
            process_id: 'proc-keep',
            version: '01.00.000',
            sheet_exchange_rows: DUPLICATE_EXCHANGES,
          },
          {
            process_id: 'proc-delete',
            version: '01.00.000',
            sheet_exchange_rows: [...DUPLICATE_EXCHANGES].reverse(),
          },
        ],
      },
    ],
  });

  const fetchImpl = (async (input) => {
    const url = String(input);
    if (isSupabaseAuthTokenUrl(url)) {
      return makeSupabaseAuthResponse({ userId: 'user-1' });
    }
    if (url.endsWith('/auth/v1/user')) {
      return jsonResponse({ id: 'user-1' });
    }
    if (
      url.includes('/rest/v1/processes?') &&
      url.includes('id=in.') &&
      !url.includes('user_id=eq.')
    ) {
      return jsonResponse([
        {
          id: 'proc-keep',
          version: '01.00.000',
          state_code: 0,
          json: createRemoteProcessJson('Waste paper collection', '废纸收集', []),
        },
        {
          id: 'proc-delete',
          version: '01.00.000',
          state_code: 0,
          json: createRemoteProcessJson('Wastepaper processing', '废纸加工', []),
        },
      ]);
    }
    if (url.includes('/rest/v1/processes?') && url.includes('user_id=eq.user-1')) {
      return jsonResponse(
        [
          {
            id: 'proc-ref-delete',
            version: '01.00.000',
            state_code: 0,
            user_id: 'user-1',
            model_id: 'ref-model',
            json: {
              downstream: {
                '@refObjectId': 'proc-delete',
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
    if (url.includes('/rest/v1/lifecyclemodels?') && url.includes('user_id=eq.user-1')) {
      return jsonResponse([], {
        'content-type': 'application/json',
        'content-range': '0-0/0',
      });
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as FetchLike;

  try {
    const report = await runProcessDedupReview({
      inputPath,
      outDir,
      env: buildSupabaseTestEnv(),
      fetchImpl,
      now: new Date('2026-04-18T04:00:00.000Z'),
    });

    const deletePlan = JSON.parse(readFileSync(report.files.delete_plan, 'utf8')) as {
      groups: Array<{ notes: string[] }>;
    };
    assert.match(
      deletePlan.groups[0]?.notes.join('\n') ?? '',
      /delete requires reference cleanup/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessDedupReview records current-user reference scan failures separately from metadata loading', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-dedup-scan-error-'));
  const inputPath = path.join(dir, 'dedup-input.json');
  const outDir = path.join(dir, 'artifacts');

  writeJson(inputPath, {
    source_label: 'remote-dedup-export',
    groups: [
      {
        group_id: 1,
        processes: [
          {
            process_id: 'proc-keep',
            version: '01.00.000',
            sheet_exchange_rows: DUPLICATE_EXCHANGES,
          },
          {
            process_id: 'proc-delete',
            version: '01.00.000',
            sheet_exchange_rows: [...DUPLICATE_EXCHANGES].reverse(),
          },
        ],
      },
    ],
  });

  const fetchImpl = (async (input) => {
    const url = String(input);
    if (isSupabaseAuthTokenUrl(url)) {
      return makeSupabaseAuthResponse({ userId: 'user-1' });
    }
    if (url.endsWith('/auth/v1/user')) {
      return jsonResponse({ id: 'user-1' });
    }
    if (
      url.includes('/rest/v1/processes?') &&
      url.includes('id=in.') &&
      !url.includes('user_id=eq.')
    ) {
      return jsonResponse([
        {
          id: 'proc-keep',
          version: '01.00.000',
          state_code: 0,
          json: createRemoteProcessJson('Waste paper collection', '废纸收集', []),
        },
        {
          id: 'proc-delete',
          version: '01.00.000',
          state_code: 0,
          json: createRemoteProcessJson('Wastepaper processing', '废纸加工', []),
        },
      ]);
    }
    if (url.includes('/rest/v1/processes?') && url.includes('user_id=eq.user-1')) {
      throw new Error('reference scan failed');
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as FetchLike;

  try {
    const report = await runProcessDedupReview({
      inputPath,
      outDir,
      env: buildSupabaseTestEnv(),
      fetchImpl,
      maxRetries: 1,
      now: new Date('2026-04-18T05:00:00.000Z'),
    });

    assert.equal(report.remote_status.enabled, true);
    assert.equal(report.remote_status.reference_scan, 'failed');
    assert.match(report.remote_status.error ?? '', /reference scan failed/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('process dedup helper normalization and validation cover edge cases', async () => {
  assert.deepEqual(__testInternals.normalizeExchangeRows(null), []);
  assert.deepEqual(__testInternals.normalizeExchangeRows([null, {}]), []);
  assert.equal(__testInternals.normalizeExchangeRows(DUPLICATE_EXCHANGES[0]).length, 1);

  assert.equal(__testInternals.normalizeAmount(''), '');
  assert.equal(__testInternals.normalizeAmount('001.2300'), '1.23');
  assert.equal(__testInternals.normalizeAmount('-0'), '0');
  assert.equal(__testInternals.normalizeAmount('1e3'), '1000');
  assert.equal(__testInternals.normalizeAmount('not-a-number'), 'not-a-number');

  assert.deepEqual(__testInternals.getLangList(null), []);
  assert.deepEqual(
    __testInternals.getLangList({
      'common:langString': {
        '@xml:lang': 'zh',
        '#text': '中文名',
      },
    }),
    [{ '@xml:lang': 'zh', '#text': '中文名' }],
  );
  assert.deepEqual(
    __testInternals.getLangList({
      'common:langString': [{ '@xml:lang': 'en', '#text': 'English name' }, null],
    }),
    [{ '@xml:lang': 'en', '#text': 'English name' }],
  );
  assert.deepEqual(__testInternals.getLangList({ '@xml:lang': 'en', '#text': 'Inline name' }), [
    { '@xml:lang': 'en', '#text': 'Inline name' },
  ]);
  assert.deepEqual(__testInternals.getLangList({ '#text': 'Text only' }), [
    { '#text': 'Text only' },
  ]);
  assert.deepEqual(__testInternals.getLangList({ '@xml:lang': 'en' }), [{ '@xml:lang': 'en' }]);
  assert.deepEqual(__testInternals.getLangList('Plain name'), [
    { '@xml:lang': 'en', '#text': 'Plain name' },
  ]);
  assert.deepEqual(__testInternals.getLangList(123), []);
  assert.equal(
    __testInternals.getLangText([{ '@xml:lang': 'en', '#text': 'Fallback name' }], 'zh'),
    'Fallback name',
  );

  const namedGroup = __testInternals.normalizeInputDocument(
    {
      groups: [
        {
          group_id: 'named-group',
          processes: [{ process_id: 'proc-named' }],
        },
      ],
    },
    '/tmp/named-group.json',
  );
  assert.equal(namedGroup.groups[0]?.group_id, 'named-group');

  const normalized = __testInternals.normalizeInputDocument(
    {
      groups: {
        alpha: {
          processes: [
            {
              id: 'proc-analysis',
              exchange_count: 2,
              analysis_exchanges: [null, DUPLICATE_EXCHANGES[0]],
            },
            {
              process_id: 'proc-remote',
              exchange_count: 'nope',
              remote_exchanges: [DUPLICATE_EXCHANGES[1]],
            },
            {
              process_id: 'proc-direct',
              exchange_count: '3',
              exchanges: [DUPLICATE_EXCHANGES[0]],
            },
          ],
        },
      },
    },
    '/tmp/fallback-source.json',
  );
  assert.equal(normalized.sourceLabel, 'fallback-source.json');
  assert.equal(normalized.groups[0]?.group_id, 'alpha');
  assert.equal(normalized.groups[0]?.processes[0]?.exchange_count, 2);
  assert.equal(normalized.groups[0]?.processes[1]?.exchange_count, null);
  assert.equal(normalized.groups[0]?.processes[2]?.exchange_count, 3);
  assert.equal(normalized.groups[0]?.processes[0]?.sheet_exchange_rows.length, 1);
  assert.equal(normalized.groups[0]?.processes[1]?.sheet_exchange_rows[0]?.flow_id, 'flow-product');

  assert.throws(
    () => __testInternals.normalizeInputDocument(null, '/tmp/input.json'),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'PROCESS_DEDUP_INPUT_INVALID');
      return true;
    },
  );
  assert.throws(
    () => __testInternals.normalizeInputDocument({ groups: [null] }, '/tmp/input.json'),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'PROCESS_DEDUP_INPUT_INVALID_GROUP');
      return true;
    },
  );
  assert.throws(
    () =>
      __testInternals.normalizeInputDocument(
        { groups: [{ processes: [null] }] },
        '/tmp/input.json',
      ),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'PROCESS_DEDUP_INPUT_INVALID_PROCESS');
      return true;
    },
  );
  assert.throws(
    () =>
      __testInternals.normalizeInputDocument({ groups: [{ processes: [{}] }] }, '/tmp/input.json'),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'PROCESS_DEDUP_PROCESS_ID_REQUIRED');
      return true;
    },
  );
  assert.throws(
    () =>
      __testInternals.normalizeInputDocument({ groups: [{ processes: [] }] }, '/tmp/input.json'),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'PROCESS_DEDUP_GROUP_PROCESSES_REQUIRED');
      return true;
    },
  );
  assert.throws(
    () => __testInternals.normalizeInputDocument({ groups: [] }, '/tmp/input.json'),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'PROCESS_DEDUP_GROUPS_REQUIRED');
      return true;
    },
  );

  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-dedup-validate-'));
  const inputPath = path.join(dir, 'dedup-input.json');
  writeJson(inputPath, {
    groups: [
      {
        group_id: 1,
        processes: [{ process_id: 'proc-1', sheet_exchange_rows: DUPLICATE_EXCHANGES }],
      },
    ],
  });

  try {
    await assert.rejects(
      () => runProcessDedupReview({ inputPath: '', outDir: dir }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'PROCESS_DEDUP_INPUT_REQUIRED');
        return true;
      },
    );
    await assert.rejects(
      () => runProcessDedupReview({ inputPath, outDir: '' }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'PROCESS_DEDUP_OUT_DIR_REQUIRED');
        return true;
      },
    );
    await assert.rejects(
      () => runProcessDedupReview({ inputPath, outDir: dir, timeoutMs: 0 }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'PROCESS_DEDUP_TIMEOUT_INVALID');
        return true;
      },
    );
    await assert.rejects(
      () => runProcessDedupReview({ inputPath, outDir: dir, maxRetries: 0 }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'PROCESS_DEDUP_MAX_RETRIES_INVALID');
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('process dedup remote helper internals cover retries, metadata fallbacks, and cyclic reference scans', async () => {
  assert.equal(
    await __testInternals.parseJsonResponse(
      responseLike({
        headers: { 'content-type': 'application/json' },
      }),
      'dedup empty body',
    ),
    null,
  );
  assert.equal(
    await __testInternals.parseJsonResponse(
      responseLike({
        body: '',
      }),
      'dedup missing content type',
    ),
    null,
  );
  assert.equal(
    await __testInternals.parseJsonResponse(
      responseLike({
        body: 'plain-text',
        headers: { 'content-type': 'text/plain' },
      }),
      'dedup text body',
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
        'dedup invalid json',
      ),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'PROCESS_DEDUP_REMOTE_INVALID_JSON');
      return true;
    },
  );

  await assert.rejects(
    () =>
      __testInternals.fetchJsonWithRetry({
        url: 'https://example.test/dedup-error',
        init: { method: 'GET' },
        label: 'dedup http error',
        fetchImpl: async () =>
          responseLike({
            ok: false,
            status: 503,
            body: JSON.stringify({ error: 'unavailable' }),
            headers: { 'content-type': 'application/json' },
          }),
        timeoutMs: 10,
        maxRetries: 1,
      }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'PROCESS_DEDUP_REMOTE_REQUEST_FAILED');
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
    const retried = await __testInternals.fetchJsonWithRetry({
      url: 'https://example.test/dedup-retry',
      init: { method: 'GET' },
      label: 'dedup retry',
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('temporary network issue');
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
    assert.deepEqual(retried.body, { ok: true });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  const currentUserId = await __testInternals.fetchCurrentUserId({
    projectBaseUrl: 'https://example.supabase.co',
    publishableKey: 'pk',
    accessToken: 'token',
    fetchImpl: async () =>
      responseLike({
        body: JSON.stringify('not-an-object'),
        headers: { 'content-type': 'application/json' },
      }),
    timeoutMs: 10,
    maxRetries: 1,
  });
  assert.equal(currentUserId, null);

  const successWithoutHeader = await __testInternals.fetchJsonWithRetry({
    url: 'https://example.test/dedup-no-header',
    init: { method: 'GET' },
    label: 'dedup missing content header',
    fetchImpl: async () =>
      responseLike({
        body: JSON.stringify({ ok: true }),
        headers: {
          'content-range': '0-0/1',
        },
      }),
    timeoutMs: 10,
    maxRetries: 1,
  });
  assert.equal(successWithoutHeader.headers.get('content-type'), '');

  const resolvedAuth = await __testInternals.resolveRemoteAuthContext({
    env: buildSupabaseTestEnv(),
    fetchImpl: async (url) => {
      if (String(url).endsWith('/auth/v1/user')) {
        return responseLike({
          body: '{',
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Unexpected URL: ${String(url)}`);
    },
    timeoutMs: 10,
    maxRetries: 1,
    now: new Date('2026-04-18T06:00:00.000Z'),
  });
  assert.equal(resolvedAuth.userId, null);

  assert.deepEqual(
    await __testInternals.fetchRemoteMetadata({
      processIds: [],
      auth: resolvedAuth,
      fetchImpl: async () => {
        throw new Error('fetchRemoteMetadata should not fetch with empty ids');
      },
      timeoutMs: 10,
      maxRetries: 1,
    }),
    {},
  );

  const remoteMetadata = await __testInternals.fetchRemoteMetadata({
    processIds: ['proc-1'],
    auth: {
      ...resolvedAuth,
      userId: 'user-1',
    },
    fetchImpl: async () =>
      jsonResponse([
        null,
        {
          id: '',
          version: '01.00.000',
          json: createRemoteProcessJson('skip', '跳过', []),
        },
        {
          id: 'proc-1',
          version: '01.00.000',
          state_code: 'draft',
          json: null,
        },
      ]),
    timeoutMs: 10,
    maxRetries: 1,
  });
  assert.deepEqual(Object.keys(remoteMetadata), ['proc-1']);
  assert.equal(remoteMetadata['proc-1']?.remote_name_en, '');
  assert.deepEqual(remoteMetadata['proc-1']?.remote_exchanges, []);
  assert.equal(remoteMetadata['proc-1']?.state_code, null);

  const remoteMetadataFromObjectBody = await __testInternals.fetchRemoteMetadata({
    processIds: ['proc-2'],
    auth: {
      ...resolvedAuth,
      userId: 'user-1',
    },
    fetchImpl: async () => jsonResponse({ rows: [] }),
    timeoutMs: 10,
    maxRetries: 1,
  });
  assert.deepEqual(remoteMetadataFromObjectBody, {});

  const remoteMetadataWithoutProcessDataSet = await __testInternals.fetchRemoteMetadata({
    processIds: ['proc-3'],
    auth: {
      ...resolvedAuth,
      userId: 'user-1',
    },
    fetchImpl: async () =>
      jsonResponse([
        {
          id: 'proc-3',
          version: '01.00.000',
          json: {
            processDataSet: {},
          },
        },
      ]),
    timeoutMs: 10,
    maxRetries: 1,
  });
  assert.deepEqual(remoteMetadataWithoutProcessDataSet['proc-3']?.remote_exchanges, []);

  const remoteMetadataWithNonRecordProcessDataSet = await __testInternals.fetchRemoteMetadata({
    processIds: ['proc-4'],
    auth: {
      ...resolvedAuth,
      userId: 'user-1',
    },
    fetchImpl: async () =>
      jsonResponse([
        {
          id: 'proc-4',
          version: '01.00.000',
          json: {
            processDataSet: [],
          },
        },
      ]),
    timeoutMs: 10,
    maxRetries: 1,
  });
  assert.deepEqual(remoteMetadataWithNonRecordProcessDataSet['proc-4']?.remote_exchanges, []);

  const preferHeaders: string[] = [];
  const currentUserRows = await __testInternals.fetchCurrentUserRows({
    auth: {
      ...resolvedAuth,
      userId: 'user-1',
    },
    tableName: 'processes',
    userId: 'user-1',
    select: 'id',
    fetchImpl: async (input, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      preferHeaders.push(headers?.Prefer ?? headers?.prefer ?? '');
      const offset = new URL(String(input)).searchParams.get('offset');
      if (offset === '0') {
        return jsonResponse([{ id: 'row-1' }], {
          'content-type': 'application/json',
          'content-range': '0-0/501',
        });
      }
      return jsonResponse([], {
        'content-type': 'application/json',
      });
    },
    timeoutMs: 10,
    maxRetries: 1,
  });
  assert.equal(currentUserRows.length, 1);
  assert.deepEqual(preferHeaders, ['count=exact', 'count=planned']);

  const nonArrayCurrentUserRows = await __testInternals.fetchCurrentUserRows({
    auth: {
      ...resolvedAuth,
      userId: 'user-1',
    },
    tableName: 'processes',
    userId: 'user-1',
    select: 'id',
    fetchImpl: async () => jsonResponse({ ok: true }),
    timeoutMs: 10,
    maxRetries: 1,
  });
  assert.deepEqual(nonArrayCurrentUserRows, []);

  const cyclicArray: unknown[] = [];
  const cyclicObject: Record<string, unknown> = { self: null };
  cyclicArray.push(cyclicArray, { '@refObjectId': 'proc-keep' }, null);
  cyclicObject.self = cyclicObject;
  assert.deepEqual(
    __testInternals.collectReferenceHits(
      {
        array: cyclicArray,
        object: cyclicObject,
        nested: { '@refObjectId': 'proc-keep' },
      },
      new Set(['proc-keep']),
    ),
    ['proc-keep', 'proc-keep'],
  );

  const referenceHits = await __testInternals.fetchCurrentUserReferenceHits({
    auth: {
      ...resolvedAuth,
      userId: 'user-1',
    },
    userId: 'user-1',
    targetProcessIds: ['proc-keep'],
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes('/rest/v1/processes?')) {
        return jsonResponse(
          [
            null,
            {
              id: 'proc-keep',
              version: '01.00.000',
              state_code: 'draft',
              model_id: 'self-model',
              json: { nested: { '@refObjectId': 'proc-keep' } },
            },
            {
              id: 'proc-ref-1',
              version: '01.00.000',
              state_code: 'draft',
              model_id: 'ref-model',
              json: { nested: [{ '@refObjectId': 'proc-keep' }] },
            },
          ],
          {
            'content-type': 'application/json',
            'content-range': '0-2/3',
          },
        );
      }
      if (url.includes('/rest/v1/lifecyclemodels?')) {
        return jsonResponse(
          [
            null,
            {
              id: 'lm-ref-1',
              version: '01.00.000',
              state_code: 'draft',
              json: { processLink: { '@refObjectId': 'proc-keep' } },
            },
          ],
          {
            'content-type': 'application/json',
            'content-range': '0-1/2',
          },
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
    timeoutMs: 10,
    maxRetries: 1,
  });
  assert.deepEqual(referenceHits.processes['proc-keep'], [
    {
      id: 'proc-ref-1',
      version: '01.00.000',
      state_code: null,
      model_id: 'ref-model',
    },
  ]);
  assert.deepEqual(referenceHits.lifecyclemodels['proc-keep'], [
    {
      id: 'lm-ref-1',
      version: '01.00.000',
      state_code: null,
    },
  ]);

  assert.equal(
    __testInternals.detectGroupPattern([{ analysis_exchanges: [] }] as never),
    'unknown',
  );
  assert.equal(
    __testInternals.detectGroupPattern([
      {
        analysis_exchanges: [
          {
            flow_id: 'flow-transport',
            direction: 'Input',
            mean_amount: '1',
            resulting_amount: '1',
            flow_short_description_en: 'transport; service',
            flow_short_description_zh: '运输;服务',
          },
          {
            flow_id: 'flow-transport',
            direction: 'Output',
            mean_amount: '1',
            resulting_amount: '1',
            flow_short_description_en: 'transport; service',
            flow_short_description_zh: '运输;服务',
          },
        ],
      },
    ] as never),
    'transport_pass_through',
  );
  assert.equal(
    __testInternals.detectGroupPattern([
      {
        analysis_exchanges: [
          {
            flow_id: 'flow-same',
            direction: 'Input',
            mean_amount: '1',
            resulting_amount: '1',
            flow_short_description_en: 'waste paper',
            flow_short_description_zh: '废纸',
          },
          {
            flow_id: 'flow-same',
            direction: 'Output',
            mean_amount: '1',
            resulting_amount: '1',
            flow_short_description_en: 'waste paper',
            flow_short_description_zh: '废纸',
          },
        ],
      },
    ] as never),
    'same_flow_pass_through',
  );
  assert.deepEqual(
    __testInternals.scoreProcessName(
      {
        name_en: 'Service route',
        name_zh: '运输物流服务',
      },
      'transport_pass_through',
    ),
    {
      score: 20,
      reasons: [
        'name matches explicit transport-service input',
        'name is broader than the observed transport-service input',
      ],
    },
  );
  assert.deepEqual(
    __testInternals.scoreProcessName(
      {
        name_en: 'Handling service',
        name_zh: '接收加工',
      },
      'same_flow_pass_through',
    ),
    {
      score: 0,
      reasons: [
        'same-flow pass-through does not support a processing label',
        'reception matches same-flow intake/output handling',
      ],
    },
  );
});

test('process dedup runtime fallbacks and non-Error failures are covered', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-dedup-runtime-'));
  const inputPath = path.join(dir, 'dedup-input.json');
  writeJson(inputPath, {
    groups: [
      {
        group_id: 1,
        processes: [
          { process_id: 'proc-keep', sheet_exchange_rows: DUPLICATE_EXCHANGES },
          { process_id: 'proc-delete', sheet_exchange_rows: [...DUPLICATE_EXCHANGES].reverse() },
        ],
      },
    ],
  });

  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const envKeys = Object.keys(buildSupabaseTestEnv());
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

  try {
    Object.assign(process.env, buildSupabaseTestEnv());
    globalThis.setTimeout = ((
      callback: (...args: unknown[]) => void,
      _ms?: number,
      ...args: unknown[]
    ) => {
      callback(...args);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    globalThis.fetch = withSupabaseAuthBootstrap(async (url) => {
      const rawUrl = String(url);
      if (rawUrl.endsWith('/auth/v1/user')) {
        return jsonResponse({ id: 'user-1' });
      }
      if (rawUrl.includes('/rest/v1/processes?') && rawUrl.includes('id=in.')) {
        return jsonResponse([]);
      }
      if (rawUrl.includes('/rest/v1/processes?') && rawUrl.includes('user_id=eq.user-1')) {
        throw 'scan failed as string';
      }
      if (rawUrl.includes('/rest/v1/lifecyclemodels?')) {
        return jsonResponse([], {
          'content-type': 'application/json',
          'content-range': '0-0/0',
        });
      }
      throw new Error(`Unexpected URL: ${rawUrl}`);
    }) as typeof fetch;

    const fallbackReport = await runProcessDedupReview({
      inputPath,
      outDir: path.join(dir, 'global-fetch'),
    });
    assert.equal(fallbackReport.remote_status.enabled, true);
    assert.equal(fallbackReport.remote_status.reference_scan, 'failed');
    assert.match(fallbackReport.remote_status.error ?? '', /failed after 4 attempt\(s\)/u);

    const stringErrorReport = await runProcessDedupReview({
      inputPath,
      outDir: path.join(dir, 'outer-string-error'),
      env: buildSupabaseTestEnv(),
      fetchImpl: withSupabaseAuthBootstrap(async (url) => {
        const rawUrl = String(url);
        if (rawUrl.endsWith('/auth/v1/user')) {
          return jsonResponse({ id: 'user-1' });
        }
        if (rawUrl.includes('/rest/v1/processes?') && rawUrl.includes('id=in.')) {
          throw 'metadata failed as string';
        }
        throw new Error(`Unexpected URL: ${rawUrl}`);
      }),
      now: new Date('2026-04-18T07:00:00.000Z'),
      maxRetries: 1,
    });
    assert.match(stringErrorReport.remote_status.error ?? '', /failed after 1 attempt\(s\)/u);
    assert.equal(__testInternals.errorMessage(new Error('boom')), 'boom');
    assert.equal(__testInternals.errorMessage('plain-text-error'), 'plain-text-error');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
