import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError } from '../src/lib/errors.js';
import type { FetchLike } from '../src/lib/http.js';
import { __testInternals, runProcessReview } from '../src/lib/review-process.js';

type JsonRecord = Record<string, unknown>;

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createExchange(options: {
  direction: 'Input' | 'Output' | 'Unknown';
  amount?: number | string;
  comment?: string;
  flowId?: string;
  shortDescription?: unknown;
}): JsonRecord {
  return {
    exchangeDirection: options.direction,
    meanAmount: options.amount ?? 0,
    commonComment: options.comment ?? '',
    referenceToFlowDataSet: {
      '@refObjectId': options.flowId ?? 'flow-001',
      'common:shortDescription': options.shortDescription ?? '',
    },
  };
}

function createProcessPayload(options?: {
  names?: unknown;
  functionalUnit?: unknown;
  geography?: unknown;
  time?: unknown;
  typeOfDataSet?: unknown;
  administrativeInformation?: unknown;
  exchanges?: unknown;
}): JsonRecord {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          name: {
            baseName: options?.names ?? [
              { '@xml:lang': 'zh', '#text': '中文名称' },
              { '@xml:lang': 'en', '#text': 'English name' },
            ],
          },
        },
        quantitativeReference: {
          functionalUnitOrOther: options?.functionalUnit ?? '1 kg product',
        },
        geography: {
          mixAndLocationTypes: options?.geography ?? 'CN',
        },
        time: options?.time ?? '2025',
      },
      modellingAndValidation: {
        LCIMethodAndAllocation: {
          typeOfDataSet: options?.typeOfDataSet ?? 'Unit process, single operation',
        },
      },
      administrativeInformation: options?.administrativeInformation ?? {
        publicationAndOwnership: {
          'common:dataSetVersion': '01.00.000',
        },
      },
      exchanges: {
        exchange: options?.exchanges ?? [
          createExchange({
            direction: 'Input',
            amount: 10,
            comment: '[tg_io_kind_tag=product] [tg_io_uom_tag=kg] water',
            flowId: 'flow-raw',
          }),
          createExchange({
            direction: 'Input',
            amount: 2,
            comment: '[tg_io_kind_tag=energy] [tg_io_uom_tag=kwh] electricity',
            flowId: 'flow-energy',
          }),
          createExchange({
            direction: 'Output',
            amount: 7,
            comment: '[tg_io_kind_tag=product] main product',
            flowId: 'flow-product',
          }),
          createExchange({
            direction: 'Output',
            amount: 1,
            comment: 'by-product stream',
            flowId: 'flow-byproduct',
          }),
          createExchange({
            direction: 'Output',
            amount: 1.5,
            comment: 'waste sludge',
            flowId: 'flow-waste',
          }),
        ],
      },
    },
  };
}

function createLlmFetch(outputText: string, observedBodies: unknown[] = []): FetchLike {
  return (async (_input, init) => {
    observedBodies.push(init?.body ? JSON.parse(String(init.body)) : null);
    return {
      ok: true,
      status: 200,
      headers: {
        get: () => 'application/json',
      },
      text: async () =>
        JSON.stringify({
          output_text: outputText,
          usage: {
            input_tokens: 12,
            output_tokens: 8,
            total_tokens: 20,
          },
        }),
    };
  }) as FetchLike;
}

test('runProcessReview writes artifact-first local review outputs without LLM', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-review-process-'));
  const runRoot = path.join(dir, 'run-root');
  const processDir = path.join(runRoot, 'exports', 'processes');
  const outDir = path.join(dir, 'review');

  writeJson(
    path.join(processDir, 'proc-a.json'),
    createProcessPayload({
      exchanges: [
        createExchange({
          direction: 'Input',
          amount: 5,
          comment: '[tg_io_kind_tag=product] [tg_io_uom_tag=kg] raw material',
          flowId: 'flow-raw',
        }),
        createExchange({
          direction: 'Input',
          amount: 1,
          comment: '[tg_io_kind_tag=energy] [tg_io_uom_tag=kg] electricity',
          flowId: 'flow-electric',
        }),
        createExchange({
          direction: 'Output',
          amount: 4,
          comment: '[tg_io_kind_tag=product] product output',
          flowId: 'flow-product',
        }),
        createExchange({
          direction: 'Output',
          amount: 1,
          comment: 'waste residue',
          flowId: 'flow-waste',
        }),
      ],
    }),
  );

  try {
    const report = await runProcessReview({
      runRoot,
      runId: 'run-001',
      outDir,
      logicVersion: 'v2.1',
      now: () => new Date('2026-03-30T00:00:00.000Z'),
    });

    assert.equal(report.status, 'completed_local_process_review');
    assert.equal(report.process_count, 1);
    assert.equal(report.logic_version, 'v2.1');
    assert.equal(report.llm.enabled, false);
    assert.equal(report.llm.reason, 'disabled');
    assert.equal(report.totals.raw_input, 5);
    assert.equal(report.totals.product_plus_byproduct_plus_waste, 5);
    assert.equal(report.totals.energy_excluded, 1);
    assert.equal(report.totals.relative_deviation, 0);
    assert.equal(report.generated_at_utc, '2026-03-30T00:00:00.000Z');
    assert.ok(existsSync(report.files.review_zh));
    assert.ok(existsSync(report.files.review_en));
    assert.ok(existsSync(report.files.timing));
    assert.ok(existsSync(report.files.unit_issue_log));
    assert.ok(existsSync(report.files.summary));
    assert.ok(existsSync(report.files.report));

    const summary = JSON.parse(readFileSync(report.files.summary, 'utf8')) as JsonRecord;
    assert.equal(summary.process_count, 1);
    assert.equal((summary.llm as JsonRecord).enabled, false);

    const zhReview = readFileSync(report.files.review_zh, 'utf8');
    assert.match(zhReview, /基础信息核查/u);
    assert.match(zhReview, /LLM 语义审核层/u);

    const unitLog = readFileSync(report.files.unit_issue_log, 'utf8');
    assert.match(unitLog, /flow-electric/u);
    assert.match(unitLog, /kWh/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessReview can invoke the CLI LLM client and persist semantic review traces', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-review-process-llm-'));
  const runRoot = path.join(dir, 'run-root');
  const processDir = path.join(runRoot, 'exports', 'processes');
  const outDir = path.join(dir, 'review');
  const observedBodies: unknown[] = [];

  writeJson(path.join(processDir, 'proc-a.json'), createProcessPayload());

  try {
    const report = await runProcessReview({
      runRoot,
      runId: 'run-llm',
      outDir,
      enableLlm: true,
      llmMaxProcesses: 2,
      env: {
        TIANGONG_LCA_REVIEW_LLM_BASE_URL: 'https://llm.example/v1',
        TIANGONG_LCA_REVIEW_LLM_API_KEY: 'llm-key',
        TIANGONG_LCA_REVIEW_LLM_MODEL: 'gpt-5.4',
      } as NodeJS.ProcessEnv,
      fetchImpl: createLlmFetch(
        JSON.stringify({
          findings: [
            {
              process_file: 'proc-a.json',
              severity: 'medium',
              fixability: 'review-needed',
              evidence: 'missing bilingual route qualifiers',
              action: 'add route qualifier',
            },
          ],
        }),
        observedBodies,
      ),
    });

    assert.equal(report.llm.enabled, true);
    assert.equal(report.llm.ok, true);
    assert.deepEqual((report.llm.result.findings as JsonRecord[])[0], {
      process_file: 'proc-a.json',
      severity: 'medium',
      fixability: 'review-needed',
      evidence: 'missing bilingual route qualifiers',
      action: 'add route qualifier',
    });
    assert.equal(observedBodies.length, 1);
    assert.equal((observedBodies[0] as JsonRecord).model, 'gpt-5.4');
    assert.ok(existsSync(path.join(outDir, 'llm-trace.jsonl')));
    assert.ok(existsSync(path.join(outDir, '.llm-cache')));

    const zhReview = readFileSync(report.files.review_zh, 'utf8');
    assert.match(zhReview, /missing bilingual route qualifiers/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessReview records non-fatal LLM runtime failures and validates timestamps', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-review-process-errors-'));
  const runRoot = path.join(dir, 'run-root');
  const processDir = path.join(runRoot, 'exports', 'processes');
  const outDir = path.join(dir, 'review');

  writeJson(path.join(processDir, 'proc-a.json'), createProcessPayload());

  try {
    const missingEnvReport = await runProcessReview({
      runRoot,
      runId: 'run-missing-env',
      outDir,
      enableLlm: true,
      env: {} as NodeJS.ProcessEnv,
    });

    assert.equal(missingEnvReport.llm.enabled, true);
    assert.equal(missingEnvReport.llm.ok, false);
    assert.match(missingEnvReport.llm.reason, /Missing LLM base URL/u);

    await assert.rejects(
      runProcessReview({
        runRoot,
        runId: 'run-invalid-ts',
        outDir: path.join(dir, 'review-invalid'),
        startTs: 'not-a-timestamp',
        endTs: '2026-03-30T00:00:00.000Z',
      }),
      (error) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.code, 'PROCESS_REVIEW_INVALID_TIMESTAMP');
        return true;
      },
    );

    await assert.rejects(
      runProcessReview({
        runRoot: path.join(dir, 'missing-run-root'),
        runId: 'run-missing-root',
        outDir,
      }),
      (error) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.code, 'PROCESS_REVIEW_EXPORTS_NOT_FOUND');
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessReview covers exchange-object fallback, empty exchanges, and zero-input totals', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-review-process-zero-'));
  const runRoot = path.join(dir, 'run-root');
  const processDir = path.join(runRoot, 'exports', 'processes');
  const outDir = path.join(dir, 'review');

  writeJson(
    path.join(processDir, 'proc-object.json'),
    createProcessPayload({
      exchanges: {
        exchangeDirection: 'Output',
        resultingAmount: 3,
        commonComment: '[tg_io_kind_tag=product] output only',
        referenceToFlowDataSet: {
          '@refObjectId': 'flow-product-only',
        },
      },
    }),
  );
  writeJson(
    path.join(processDir, 'proc-empty.json'),
    createProcessPayload({
      exchanges: 'not-an-exchange-object',
    }),
  );

  try {
    const report = await runProcessReview({
      runRoot,
      runId: 'run-zero',
      outDir,
    });

    assert.equal(report.process_count, 2);
    assert.equal(report.totals.raw_input, 0);
    assert.equal(report.totals.relative_deviation, null);
    assert.equal(report.totals.product_plus_byproduct_plus_waste, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('review-process internals cover helper branches and rendering fallbacks', async () => {
  assert.equal(__testInternals.requiredNonEmpty(' value ', '--x', 'ERR'), 'value');
  assert.throws(() => __testInternals.requiredNonEmpty('', '--x', 'ERR'), /Missing required/u);

  assert.equal(__testInternals.textFromValue([{ '#text': 'a' }, { '#text': 'b' }]), 'a b');
  assert.equal(__testInternals.textFromValue({ '#text': 'single' }), 'single');
  assert.equal(__testInternals.textFromValue([{}]), '');
  assert.equal(__testInternals.textFromValue({}), '');
  assert.equal(__testInternals.textFromValue(undefined), '');

  assert.equal(__testInternals.toNumber('12.5'), 12.5);
  assert.equal(__testInternals.toNumber('bad'), 0);
  assert.equal(__testInternals.toNumber(Number.NaN), 0);
  assert.equal(__testInternals.toNumber(undefined), 0);

  assert.equal(__testInternals.deepGet({ a: { b: { c: 1 } } }, ['a', 'b', 'c']), 1);
  assert.equal(__testInternals.deepGet({ a: 1 }, ['a', 'b']), undefined);
  assert.equal(__testInternals.deepGet({ a: { b: null } }, ['a', 'b']), undefined);

  assert.equal(__testInternals.hasNonEmpty('x'), true);
  assert.equal(__testInternals.hasNonEmpty(['', { '#text': 'x' }]), true);
  assert.equal(__testInternals.hasNonEmpty({ value: '' }), false);
  assert.equal(__testInternals.hasNonEmpty({ value: 'x' }), true);
  assert.equal(__testInternals.hasNonEmpty(null), false);
  assert.equal(__testInternals.hasNonEmpty(0), true);

  assert.deepEqual(
    __testInternals.extractBaseNames(
      createProcessPayload({
        names: [{ '#text': 'name zh-ish' }, { '#text': 'name en-ish' }],
      }),
    ),
    [true, true, ['name zh-ish', 'name en-ish']],
  );
  assert.deepEqual(
    __testInternals.extractBaseNames(
      createProcessPayload({
        names: {
          '#text': 'single name entry',
        },
      }),
    ),
    [false, false, ['single name entry']],
  );
  assert.deepEqual(
    __testInternals.extractBaseNames({
      processDataSet: {
        processInformation: {
          dataSetInformation: {},
        },
      },
    }),
    [false, false, []],
  );
  assert.deepEqual(
    __testInternals.extractBaseNames(
      createProcessPayload({
        names: [{ '@xml:lang': 'en' }],
      }),
    ),
    [false, false, []],
  );
  assert.deepEqual(
    __testInternals.extractBaseNames({
      processDataSet: {
        processInformation: {
          dataSetInformation: {
            name: {},
          },
        },
      },
    }),
    [false, false, []],
  );
  assert.deepEqual(
    __testInternals.extractBaseNames(
      createProcessPayload({
        names: [1, { '@xml:lang': 'en', '#text': '' }],
      }),
    ),
    [false, false, []],
  );

  assert.equal(
    __testInternals.classifyExchange(
      createExchange({
        direction: 'Input',
        comment: '[tg_io_kind_tag=energy] [tg_io_uom_tag=mj] fuel',
      }),
    ).classification,
    'energy_input',
  );
  assert.equal(
    __testInternals.classifyExchange(
      createExchange({
        direction: 'Input',
        comment: '[tg_io_kind_tag=waste] waste input',
      }),
    ).classification,
    'other_input',
  );
  assert.equal(
    __testInternals.classifyExchange(
      createExchange({
        direction: 'Input',
        comment: '[tg_io_kind_tag=resource] input material',
      }),
    ).classification,
    'raw_material_input',
  );
  assert.equal(
    __testInternals.classifyExchange({
      exchangeDirection: 'Input',
      commonComment: 'misc auxiliary input',
      referenceToFlowDataSet: 'not-an-object',
    }).classification,
    'other_input',
  );
  assert.equal(
    __testInternals.classifyExchange({
      commonComment: 'direction missing',
    }).classification,
    'other',
  );
  assert.equal(
    __testInternals.classifyExchange(
      createExchange({
        direction: 'Output',
        comment: '[tg_io_kind_tag=waste] waste output',
      }),
    ).classification,
    'waste_output',
  );
  assert.equal(
    __testInternals.classifyExchange(
      createExchange({
        direction: 'Output',
        comment: '[tg_io_kind_tag=product] main product',
      }),
    ).classification,
    'product_output',
  );
  assert.equal(
    __testInternals.classifyExchange(
      createExchange({
        direction: 'Input',
        comment: 'seed input without kind tag',
      }),
    ).classification,
    'raw_material_input',
  );
  assert.equal(
    __testInternals.classifyExchange(
      createExchange({
        direction: 'Output',
        comment: 'co-product output',
      }),
    ).classification,
    'byproduct_output',
  );
  assert.equal(
    __testInternals.classifyExchange(
      createExchange({
        direction: 'Output',
        comment: 'unclassified output',
      }),
    ).classification,
    'other_output',
  );
  assert.equal(
    __testInternals.classifyExchange(
      createExchange({
        direction: 'Unknown',
        comment: 'unknown direction',
      }),
    ).classification,
    'other',
  );

  assert.deepEqual(
    __testInternals.unitIssueCheck(
      createExchange({
        direction: 'Input',
        comment: '',
        flowId: 'flow-e',
      }),
      ['kg'],
      'electricity input',
    )[0],
    {
      flow_uuid: 'flow-e',
      current_unit: 'kg',
      suggested_unit: 'kWh',
      basis: 'flow 描述为电力/电能，但 uom 标签非能量单位',
      confidence: '高',
    },
  );
  assert.deepEqual(
    __testInternals.unitIssueCheck(
      createExchange({
        direction: 'Input',
        comment: '',
        flowId: 'flow-water',
      }),
      ['mj'],
      'process water input',
    )[0],
    {
      flow_uuid: 'flow-water',
      current_unit: 'mj',
      suggested_unit: 'm3 或 kg',
      basis: 'flow 描述为水，但 uom 标签为能量单位',
      confidence: '高',
    },
  );
  assert.deepEqual(
    __testInternals.unitIssueCheck(
      createExchange({
        direction: 'Output',
        comment: '',
        flowId: 'flow-co2',
      }),
      ['gj'],
      'carbon dioxide emission',
    )[0],
    {
      flow_uuid: 'flow-co2',
      current_unit: 'gj',
      suggested_unit: 'kg',
      basis: '排放流通常质量单位计，当前为能量单位',
      confidence: '中',
    },
  );
  assert.equal(__testInternals.unitIssueCheck({}, ['kg'], 'electricity').length, 0);
  assert.equal(
    __testInternals.unitIssueCheck(
      {
        referenceToFlowDataSet: {},
      },
      ['kg'],
      'electricity',
    ).length,
    0,
  );
  assert.equal(
    __testInternals.unitIssueCheck(
      createExchange({
        direction: 'Input',
        comment: '',
        flowId: 'flow-none',
      }),
      [],
      'plain text',
    ).length,
    0,
  );

  const minimalBase = __testInternals.baseInfoCheck(
    createProcessPayload({
      names: [{ '@xml:lang': 'zh', '#text': '仅中文' }],
      functionalUnit: '',
      geography: '',
      time: '',
      typeOfDataSet: '',
      administrativeInformation: {},
    }),
  );
  assert.equal(minimalBase.name_zh_en_ok, false);
  assert.equal(minimalBase.completeness_score, 0);

  assert.equal(
    __testInternals.unwrapProcessPayload(
      {
        json_ordered: createProcessPayload(),
      },
      '/tmp/proc.json',
    ).processDataSet !== undefined,
    true,
  );
  assert.equal(
    __testInternals.unwrapProcessPayload(
      {
        jsonOrdered: createProcessPayload(),
      },
      '/tmp/proc.json',
    ).processDataSet !== undefined,
    true,
  );
  assert.equal(
    __testInternals.unwrapProcessPayload(
      {
        json: createProcessPayload(),
      },
      '/tmp/proc.json',
    ).processDataSet !== undefined,
    true,
  );
  assert.throws(
    () => __testInternals.unwrapProcessPayload([], '/tmp/proc.json'),
    /Expected process review file/u,
  );
  assert.throws(
    () => __testInternals.unwrapProcessPayload({}, '/tmp/proc.json'),
    /missing processDataSet/u,
  );

  assert.deepEqual(__testInternals.parseLlmJsonOutput('{"findings":[]}'), { findings: [] });
  assert.equal(__testInternals.parseLlmJsonOutput('[]'), null);
  assert.equal(__testInternals.parseLlmJsonOutput('not json'), null);

  const llmDisabled = await __testInternals.runOptionalLlmReview([], {
    enableLlm: false,
    llmModel: undefined,
    env: {} as NodeJS.ProcessEnv,
    fetchImpl: createLlmFetch('{}'),
    outDir: path.join(os.tmpdir(), 'tg-cli-review-process-internals'),
  });
  assert.deepEqual(llmDisabled, {
    enabled: false,
    reason: 'disabled',
  });

  const llmNonJson = await __testInternals.runOptionalLlmReview([], {
    enableLlm: true,
    llmModel: 'override-model',
    env: {
      TIANGONG_LCA_REVIEW_LLM_BASE_URL: 'https://llm.example/v1',
      TIANGONG_LCA_REVIEW_LLM_API_KEY: 'llm-key',
      TIANGONG_LCA_REVIEW_LLM_MODEL: 'gpt-5.4',
    } as NodeJS.ProcessEnv,
    fetchImpl: createLlmFetch('not json'),
    outDir: path.join(os.tmpdir(), 'tg-cli-review-process-internals-2'),
  });
  assert.equal(llmNonJson.enabled, true);
  assert.equal(llmNonJson.ok, false);
  assert.equal(llmNonJson.reason, 'llm_non_json_output');
  assert.equal(llmNonJson.raw, 'not json');

  const llmThrownString = await __testInternals.runOptionalLlmReview([], {
    enableLlm: true,
    llmModel: undefined,
    env: {
      TIANGONG_LCA_REVIEW_LLM_BASE_URL: 'https://llm.example/v1',
      TIANGONG_LCA_REVIEW_LLM_API_KEY: 'llm-key',
      TIANGONG_LCA_REVIEW_LLM_MODEL: 'gpt-5.4',
    } as NodeJS.ProcessEnv,
    fetchImpl: (async () => {
      throw 'boom';
    }) as FetchLike,
    outDir: path.join(os.tmpdir(), 'tg-cli-review-process-internals-3'),
  });
  assert.equal(llmThrownString.enabled, true);
  assert.equal(llmThrownString.ok, false);
  assert.equal(llmThrownString.reason, 'boom');

  const timing = __testInternals.renderTiming({
    runId: 'run-1',
    startTs: '2026-03-30T00:00:00.000Z',
    endTs: '2026-03-30T00:05:00.000Z',
    processCount: 2,
  });
  assert.match(timing, /5\.00 min/u);

  const unitIssueLog = __testInternals.renderUnitIssues('run-1', [
    {
      flow_uuid: 'flow-1',
      current_unit: 'kg',
      suggested_unit: 'kWh',
      basis: 'basis',
      confidence: '高',
    },
    {
      flow_uuid: 'flow-1',
      current_unit: 'kg',
      suggested_unit: 'kWh',
      basis: 'basis',
      confidence: '高',
    },
  ]);
  assert.equal(unitIssueLog.match(/flow-1/gu)?.length, 1);
  assert.match(__testInternals.renderUnitIssues('run-2', []), /未发现基于直接证据/u);

  const zhReviewEmptyFindings = __testInternals.renderZhReview({
    runId: 'run-1',
    logicVersion: 'v2.1',
    baseRows: [],
    rows: [],
    totals: {
      raw_input: 0,
      product_plus_byproduct_plus_waste: 0,
      delta: 0,
      relative_deviation: null,
      energy_excluded: 0,
    },
    llmResult: {
      enabled: true,
      ok: true,
      result: {
        findings: [],
      },
    },
    evidenceStrong: ['strong'],
    evidenceWeak: ['weak'],
  });
  assert.doesNotMatch(zhReviewEmptyFindings, /\|process file\|severity/u);

  const zhReviewFallbackFindings = __testInternals.renderZhReview({
    runId: 'run-1',
    logicVersion: 'v2.1',
    baseRows: [
      [
        'proc-a.json',
        {
          name_zh_en_ok: false,
          functional_unit_ok: false,
          system_boundary_ok: false,
          time_ok: false,
          geo_ok: false,
          tech_ok: false,
          admin_ok: false,
          completeness_score: 0,
          base_names: [],
        },
      ],
    ],
    rows: [],
    totals: {
      raw_input: 0,
      product_plus_byproduct_plus_waste: 0,
      delta: 0,
      relative_deviation: null,
      energy_excluded: 0,
    },
    llmResult: {
      enabled: true,
      ok: true,
      result: {
        findings: [
          1,
          {
            process_file: 'proc-a.json',
            severity: 'low',
            fixability: 'easy',
            evidence: { field: 'name' },
            suggestion: 'fill name',
          },
        ],
      },
    },
    evidenceStrong: ['strong'],
    evidenceWeak: ['weak'],
  });
  assert.match(zhReviewFallbackFindings, /fill name/u);
  assert.match(zhReviewFallbackFindings, /"field":"name"/u);
  assert.match(zhReviewFallbackFindings, /\|proc-a\.json\|❌\|❌\|❌\|❌\|❌\|❌\|❌\|0\|/u);

  const zhReviewNonArrayFindings = __testInternals.renderZhReview({
    runId: 'run-1',
    logicVersion: 'v2.1',
    baseRows: [],
    rows: [],
    totals: {
      raw_input: 0,
      product_plus_byproduct_plus_waste: 0,
      delta: 0,
      relative_deviation: null,
      energy_excluded: 0,
    },
    llmResult: {
      enabled: true,
      ok: true,
      result: {
        findings: {},
      },
    },
    evidenceStrong: ['strong'],
    evidenceWeak: ['weak'],
  });
  assert.doesNotMatch(zhReviewNonArrayFindings, /\|process file\|severity/u);

  const zhReviewMissingFindingFields = __testInternals.renderZhReview({
    runId: 'run-1',
    logicVersion: 'v2.1',
    baseRows: [],
    rows: [],
    totals: {
      raw_input: 0,
      product_plus_byproduct_plus_waste: 0,
      delta: 0,
      relative_deviation: null,
      energy_excluded: 0,
    },
    llmResult: {
      enabled: true,
      ok: true,
      result: {
        findings: [{}],
      },
    },
    evidenceStrong: ['strong'],
    evidenceWeak: ['weak'],
  });
  assert.match(zhReviewMissingFindingFields, /review-needed/u);

  const enReview = __testInternals.renderEnReview({
    runId: 'run-1',
    logicVersion: 'v2.1',
    baseRows: [
      [
        'proc-a.json',
        {
          name_zh_en_ok: false,
          functional_unit_ok: false,
          system_boundary_ok: false,
          time_ok: false,
          geo_ok: false,
          tech_ok: false,
          admin_ok: false,
          completeness_score: 0,
          base_names: [],
        },
      ],
    ],
    rows: [],
    totals: {
      raw_input: 0,
      product_plus_byproduct_plus_waste: 0,
      delta: 0,
      relative_deviation: null,
      energy_excluded: 0,
    },
    evidenceStrong: ['strong'],
    evidenceWeak: ['weak'],
  });
  assert.match(enReview, /Evidence-sufficient conclusions/u);
  assert.match(enReview, /\|proc-a\.json\|❌\|❌\|❌\|❌\|❌\|❌\|❌\|0\|/u);
});
