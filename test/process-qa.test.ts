import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError } from '../src/lib/errors.js';
import type { FetchLike } from '../src/lib/http.js';
import { __testInternals, runProcessQa } from '../src/lib/process-qa.js';

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

test('runProcessQa writes artifact-first local QA outputs without LLM', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-qa-'));
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
    const report = await runProcessQa({
      runRoot,
      outDir,
      logicVersion: 'v2.1',
      now: () => new Date('2026-03-30T00:00:00.000Z'),
    });

    assert.equal(report.status, 'completed_local_process_qa');
    assert.equal(report.run_id, 'run-root');
    assert.equal(report.run_root, runRoot);
    assert.equal(report.rows_file, '');
    assert.equal(report.input_mode, 'run_root');
    assert.equal(report.effective_processes_dir, processDir);
    assert.equal(report.process_count, 1);
    assert.equal(report.logic_version, 'v2.1');
    assert.equal(report.llm.enabled, false);
    assert.equal(report.llm.reason, 'disabled');
    assert.equal(report.totals.raw_input, 5);
    assert.equal(report.totals.product_plus_byproduct_plus_waste, 5);
    assert.equal(report.totals.energy_excluded, 1);
    assert.equal(report.totals.relative_deviation, 0);
    assert.equal(report.ruleset_id, 'process-authoring/strict');
    assert.equal(report.ruleset_version, '1');
    assert.equal(report.ruleset_gate?.status, 'needs_review');
    assert.equal(report.rule_finding_count, 1);
    assert.equal(report.blocker_count, 0);
    assert.equal(report.policy_decision_owner, 'foundry');
    assert.equal(report.qa_mode, 'deterministic_qa_report');
    assert.equal(report.generated_at_utc, '2026-03-30T00:00:00.000Z');
    assert.ok(existsSync(report.files.qa_zh));
    assert.ok(existsSync(report.files.qa_en));
    assert.ok(existsSync(report.files.timing));
    assert.ok(existsSync(report.files.unit_issue_log));
    assert.ok(existsSync(report.files.rule_findings ?? ''));
    assert.ok(existsSync(report.files.ruleset_gate ?? ''));
    assert.ok(existsSync(report.files.qa_input_summary));
    assert.ok(existsSync(report.files.summary));
    assert.ok(existsSync(report.files.report));
    assert.equal(report.files.materialization_summary, null);

    const summary = JSON.parse(readFileSync(report.files.summary, 'utf8')) as JsonRecord;
    assert.equal(summary.process_count, 1);
    assert.equal((summary.llm as JsonRecord).enabled, false);

    const zhReview = readFileSync(report.files.qa_zh, 'utf8');
    assert.match(zhReview, /基础信息核查/u);
    assert.match(zhReview, /LLM 语义审核层/u);

    const unitLog = readFileSync(report.files.unit_issue_log, 'utf8');
    assert.match(unitLog, /flow-electric/u);
    assert.match(unitLog, /kWh/u);

    const findings = readFileSync(report.files.rule_findings ?? '', 'utf8')
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as JsonRecord);
    assert.equal(findings[0]?.methodology_rule_id, 'tidas.process.exchange.amount.required');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessQa materializes rows-file and full process-list reports before reviewing', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-qa-rows-'));
  const rowsFile = path.join(dir, 'process-list-report.json');
  const outDir = path.join(dir, 'review');

  writeJson(rowsFile, {
    rows: [
      {
        id: 'proc-a',
        version: '01.00.001',
        process: createProcessPayload(),
      },
      {
        id: 'proc-a',
        version: '01.00.001',
        process: createProcessPayload(),
      },
    ],
  });

  try {
    const report = await runProcessQa({
      rowsFile,
      outDir,
      now: () => new Date('2026-03-30T00:00:00.000Z'),
    });

    assert.equal(report.input_mode, 'rows_file');
    assert.equal(report.run_root, '');
    assert.equal(report.rows_file, rowsFile);
    assert.equal(report.run_id, 'process-list-report');
    assert.equal(report.process_count, 1);
    assert.ok(report.files.materialization_summary);
    assert.ok(existsSync(report.files.qa_input_summary));
    assert.ok(existsSync(report.files.materialization_summary as string));

    const materialization = JSON.parse(
      readFileSync(report.files.materialization_summary as string, 'utf8'),
    ) as JsonRecord;
    assert.equal(materialization.input_row_count, 2);
    assert.equal(materialization.materialized_process_count, 1);
    assert.equal(materialization.duplicate_input_rows_collapsed, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessQa accepts direct rows arrays and falls back to row identity defaults', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-qa-array-'));
  const rowsFile = path.join(dir, 'rows.json');
  const outDir = path.join(dir, 'review');

  writeJson(rowsFile, [
    {
      id: 'proc-fallback-id',
      process: {
        processDataSet: {
          exchanges: {
            exchange: [],
          },
        },
      },
    },
  ]);

  try {
    const report = await runProcessQa({
      rowsFile,
      outDir,
      now: () => new Date('2026-03-30T00:05:00.000Z'),
    });

    assert.equal(report.input_mode, 'rows_file');
    assert.equal(report.process_count, 1);
    assert.ok(report.files.materialization_summary);

    const materialization = JSON.parse(
      readFileSync(report.files.materialization_summary as string, 'utf8'),
    ) as {
      items: Array<{ process_key: string; file: string }>;
    };
    assert.equal(materialization.items[0]?.process_key, 'proc-fallback-id@01.00.000');
    assert.match(materialization.items[0]?.file ?? '', /row-1__01\.00\.000\.json$/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessQa accepts JSONL rows-file inputs and trims explicit run ids', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-qa-jsonl-'));
  const rowsFile = path.join(dir, 'rows.jsonl');
  const outDir = path.join(dir, 'review');

  writeFileSync(
    rowsFile,
    `${JSON.stringify({
      id: 'proc-jsonl',
      version: '01.00.123',
      process: createProcessPayload(),
    })}\n`,
    'utf8',
  );

  try {
    const report = await runProcessQa({
      rowsFile,
      runId: '  explicit-run-id  ',
      outDir,
      now: () => new Date('2026-03-30T00:06:00.000Z'),
    });

    assert.equal(report.input_mode, 'rows_file');
    assert.equal(report.run_id, 'explicit-run-id');
    assert.equal(report.process_count, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessQa treats process LLM review as a Foundry curation concern', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-qa-llm-'));
  const runRoot = path.join(dir, 'run-root');
  const processDir = path.join(runRoot, 'exports', 'processes');
  const outDir = path.join(dir, 'review');
  const observedBodies: unknown[] = [];

  writeJson(path.join(processDir, 'proc-a.json'), createProcessPayload());

  try {
    const report = await runProcessQa({
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
              evidence: 'missing source-language route qualifiers',
              action: 'add route qualifier',
            },
          ],
        }),
        observedBodies,
      ),
    });

    assert.equal(report.llm.enabled, false);
    assert.equal(report.llm.reason, 'moved_to_foundry_process_curation');
    assert.equal(observedBodies.length, 0);

    const zhReview = readFileSync(report.files.qa_zh, 'utf8');
    assert.match(zhReview, /moved_to_foundry_process_curation/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessQa records non-fatal LLM runtime failures and validates timestamps', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-qa-errors-'));
  const runRoot = path.join(dir, 'run-root');
  const processDir = path.join(runRoot, 'exports', 'processes');
  const outDir = path.join(dir, 'review');

  writeJson(path.join(processDir, 'proc-a.json'), createProcessPayload());

  try {
    const missingEnvReport = await runProcessQa({
      runRoot,
      runId: 'run-missing-env',
      outDir,
      enableLlm: true,
      env: {} as NodeJS.ProcessEnv,
    });

    assert.equal(missingEnvReport.llm.enabled, false);
    assert.equal(missingEnvReport.llm.reason, 'moved_to_foundry_process_curation');

    await assert.rejects(
      runProcessQa({
        runRoot,
        runId: 'run-invalid-ts',
        outDir: path.join(dir, 'review-invalid'),
        startTs: 'not-a-timestamp',
        endTs: '2026-03-30T00:00:00.000Z',
      }),
      (error) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.code, 'PROCESS_QA_INVALID_TIMESTAMP');
        return true;
      },
    );

    await assert.rejects(
      runProcessQa({
        runRoot: path.join(dir, 'missing-run-root'),
        runId: 'run-missing-root',
        outDir,
      }),
      (error) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.code, 'PROCESS_QA_EXPORTS_NOT_FOUND');
        return true;
      },
    );

    await assert.rejects(
      runProcessQa({
        outDir: path.join(dir, 'review-missing-input'),
      }),
      (error) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.code, 'PROCESS_QA_INPUT_MODE_REQUIRED');
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessQa validates malformed rows-file inputs', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-qa-invalid-rows-'));
  const invalidJsonlPath = path.join(dir, 'rows.jsonl');
  const invalidJsonlRowPath = path.join(dir, 'rows-scalar.jsonl');
  const invalidJsonPath = path.join(dir, 'rows.json');
  const invalidShapePath = path.join(dir, 'rows-shape.json');

  writeFileSync(invalidJsonlPath, '{"bad"\n', 'utf8');
  writeFileSync(invalidJsonlRowPath, '7\n', 'utf8');
  writeFileSync(invalidJsonPath, '{bad', 'utf8');
  writeJson(invalidShapePath, { ok: true });

  try {
    await assert.rejects(
      runProcessQa({
        rowsFile: invalidJsonlPath,
        outDir: path.join(dir, 'review-jsonl'),
      }),
      (error) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.code, 'PROCESS_QA_ROWS_INVALID_JSONL');
        return true;
      },
    );

    await assert.rejects(
      runProcessQa({
        rowsFile: invalidJsonlRowPath,
        outDir: path.join(dir, 'review-jsonl-row'),
      }),
      (error) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.code, 'PROCESS_QA_ROWS_INVALID_JSONL_ROW');
        return true;
      },
    );

    await assert.rejects(
      runProcessQa({
        rowsFile: invalidJsonPath,
        outDir: path.join(dir, 'review-json'),
      }),
      (error) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.code, 'PROCESS_QA_ROWS_INVALID_JSON');
        assert.match(error.message, /not valid JSON/u);
        return true;
      },
    );

    await assert.rejects(
      runProcessQa({
        rowsFile: invalidShapePath,
        outDir: path.join(dir, 'review-shape'),
      }),
      (error) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.code, 'PROCESS_QA_ROWS_INVALID_JSON');
        assert.match(error.message, /rows\[\]/u);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcessQa covers exchange-object fallback, empty exchanges, and zero-input totals', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-qa-zero-'));
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
  writeJson(
    path.join(processDir, 'proc-missing-amount.json'),
    createProcessPayload({
      exchanges: [
        {
          '@dataSetInternalID': 'missing-amount-1',
          exchangeDirection: 'Output',
          commonComment: '[tg_io_kind_tag=product] product without amount',
          referenceToFlowDataSet: {
            '@refObjectId': 'flow-product-missing-amount',
          },
        },
        {
          exchangeDirection: 'Input',
          commonComment: '[tg_io_kind_tag=product] raw material without amount',
          referenceToFlowDataSet: {
            '@refObjectId': 'flow-raw-missing-amount',
          },
        },
        {
          commonComment: 'missing amount and direction',
          referenceToFlowDataSet: {
            '@refObjectId': 'flow-missing-direction',
          },
        },
      ],
    }),
  );
  writeJson(
    path.join(processDir, 'proc-imbalance.json'),
    createProcessPayload({
      exchanges: [
        createExchange({
          direction: 'Input',
          amount: 10,
          comment: '[tg_io_kind_tag=product] raw material',
          flowId: 'flow-raw',
        }),
        createExchange({
          direction: 'Output',
          amount: 1,
          comment: '[tg_io_kind_tag=product] product output',
          flowId: 'flow-product',
        }),
      ],
    }),
  );
  writeJson(
    path.join(processDir, 'proc-imbalance-warning.json'),
    createProcessPayload({
      exchanges: [
        createExchange({
          direction: 'Input',
          amount: 10,
          comment: '[tg_io_kind_tag=product] raw material',
          flowId: 'flow-raw-warning',
        }),
        createExchange({
          direction: 'Output',
          amount: 9.4,
          comment: '[tg_io_kind_tag=product] product output',
          flowId: 'flow-product-warning',
        }),
      ],
    }),
  );

  try {
    const report = await runProcessQa({
      runRoot,
      runId: 'run-zero',
      outDir,
    });

    assert.equal(report.process_count, 5);
    assert.equal(report.totals.raw_input, 20);
    assert.equal(Number(report.totals.relative_deviation?.toFixed(2)), 0.33);
    assert.equal(report.totals.product_plus_byproduct_plus_waste, 13.4);
    assert.equal(report.ruleset_gate?.status, 'needs_review');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('process-qa internals cover helper branches and rendering fallbacks', async () => {
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
    [true, ['name zh-ish', 'name en-ish']],
  );
  assert.deepEqual(
    __testInternals.extractBaseNames(
      createProcessPayload({
        names: {
          '#text': 'single name entry',
        },
      }),
    ),
    [true, ['single name entry']],
  );
  assert.deepEqual(
    __testInternals.extractBaseNames({
      processDataSet: {
        processInformation: {
          dataSetInformation: {},
        },
      },
    }),
    [false, []],
  );
  assert.deepEqual(
    __testInternals.extractBaseNames(
      createProcessPayload({
        names: [{ '@xml:lang': 'en' }],
      }),
    ),
    [false, []],
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
    [false, []],
  );
  assert.deepEqual(
    __testInternals.extractBaseNames(
      createProcessPayload({
        names: [1, { '@xml:lang': 'en', '#text': '' }],
      }),
    ),
    [false, []],
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
      commonComment: 'source classification input group',
      'common:other': {
        'tidasimport:sourceTrace': {
          payload: {
            sourceClassification: {
              inputGroup: '4',
            },
          },
        },
      },
    }).classification,
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
      {
        '@dataSetInternalID': 'reference-output-1',
        exchangeDirection: 'Output',
        commonComment: 'declared quantitative reference output',
      },
      'reference-output-1',
    ).classification,
    'product_output',
  );
  assert.equal(
    __testInternals.classifyExchange({
      exchangeDirection: 'Output',
      commonComment: 'source trace output group reference',
      'common:other': {
        'tidasimport:sourceTrace': {
          payload: {
            sourceTrace: {
              sourceClassification: {
                outputGroup: '0',
              },
            },
          },
        },
      },
    }).classification,
    'product_output',
  );
  assert.equal(
    __testInternals.classifyExchange({
      exchangeDirection: 'Input',
      commonComment: 'source trace without classification',
      'common:other': {
        'tidasimport:sourceTrace': {
          payload: {
            sourceTrace: {},
          },
        },
      },
    }).classification,
    'other_input',
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
  assert.equal(minimalBase.source_name_ok, true);
  assert.equal(minimalBase.completeness_score, 1);

  const baseFindings = __testInternals.reviewFindingsForBase('proc.json', minimalBase);
  assert.ok(!baseFindings.some((finding) => finding.code === 'process_missing_source_base_name'));
  assert.ok(baseFindings.some((finding) => finding.code === 'process_missing_functional_unit'));

  const missingSourceNameBase = __testInternals.baseInfoCheck(
    createProcessPayload({
      names: [],
      functionalUnit: '1 kg',
    }),
  );
  assert.equal(missingSourceNameBase.source_name_ok, false);
  assert.ok(
    __testInternals
      .reviewFindingsForBase('proc-no-name.json', missingSourceNameBase)
      .some((finding) => finding.code === 'process_missing_source_base_name'),
  );
  assert.equal(__testInternals.hasNumericAmount({ meanAmount: '0' }), true);
  assert.equal(__testInternals.hasNumericAmount({ resultingAmount: 0 }), true);
  assert.equal(__testInternals.hasNumericAmount({ meanAmount: 'bad' }), false);
  assert.equal(__testInternals.processRulesetGate([]).status, 'passed');
  assert.equal(
    __testInternals.processRulesetGate([
      __testInternals.createProcessQaFinding({
        processFile: 'proc.json',
        severity: 'warning',
        code: 'unknown_warning',
        message: 'review only',
      }),
    ]).status,
    'needs_review',
  );
  const warningFinding = __testInternals.createProcessQaFinding({
    processFile: 'proc-null-rule.json',
    severity: 'warning',
    code: 'unknown_warning',
    message: 'review only',
  });
  assert.equal(warningFinding.methodology_rule_id, null);
  const blockerGate = __testInternals.processRulesetGate([
    __testInternals.createProcessQaFinding({
      processFile: 'proc-blocker.json',
      severity: 'blocker',
      code: 'process_missing_functional_unit',
      message: 'blocker',
    }),
  ]);
  assert.equal(blockerGate.status, 'blocked');
  assert.equal(blockerGate.next_action, 'fix_blockers');

  assert.equal(
    __testInternals.unwrapProcessPayload(
      {
        process: createProcessPayload(),
      },
      '/tmp/proc.json',
    ).processDataSet !== undefined,
    true,
  );
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
    /Expected process QA file/u,
  );
  assert.throws(
    () => __testInternals.unwrapProcessPayload({}, '/tmp/proc.json'),
    /missing processDataSet/u,
  );

  assert.deepEqual(__testInternals.parseLlmJsonOutput('{"findings":[]}'), { findings: [] });
  assert.match(
    __testInternals.buildPrompt([
      {
        process_file: 'proc.json',
        base_names: ['Process'],
        base_checks: {
          source_name_ok: true,
          functional_unit_ok: true,
          system_boundary_ok: true,
          time_ok: true,
          geo_ok: true,
          tech_ok: true,
          admin_ok: true,
        },
        balance: {
          raw_in: 1,
          product: 1,
          byproduct: 0,
          waste: 0,
          energy_excluded: 0,
          relative_deviation: 0,
        },
      },
    ]),
    /输入摘要/u,
  );
  assert.equal(__testInternals.parseLlmJsonOutput('[]'), null);
  assert.equal(__testInternals.parseLlmJsonOutput('not json'), null);

  const llmDisabled = await __testInternals.runOptionalLlmReview([], {
    enableLlm: false,
    llmModel: undefined,
    env: {} as NodeJS.ProcessEnv,
    fetchImpl: createLlmFetch('{}'),
    outDir: path.join(os.tmpdir(), 'tg-cli-process-qa-internals'),
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
    outDir: path.join(os.tmpdir(), 'tg-cli-process-qa-internals-2'),
  });
  assert.equal(llmNonJson.enabled, false);
  assert.equal(llmNonJson.reason, 'moved_to_foundry_process_curation');

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
    outDir: path.join(os.tmpdir(), 'tg-cli-process-qa-internals-3'),
  });
  assert.equal(llmThrownString.enabled, false);
  assert.equal(llmThrownString.reason, 'moved_to_foundry_process_curation');

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
          source_name_ok: false,
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
          source_name_ok: false,
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
