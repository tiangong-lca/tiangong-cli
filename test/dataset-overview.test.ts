import assert from 'node:assert/strict';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { executeCli } from '../src/cli.js';
import {
  analyzeOverview,
  overviewCatalog,
  parseOverviewScope,
} from '../src/lib/dataset-overview-analysis.js';
import { captureOverview } from '../src/lib/dataset-overview-capture.js';
import {
  overviewCsv,
  overviewHash,
  readOverviewInventory,
  readOverviewJson,
  writeOverviewArtifacts,
} from '../src/lib/dataset-overview-io.js';
import {
  latestOverviewRecords,
  list,
  normalizeOverviewRecord,
  object,
  OVERVIEW_TABLES,
  parseOverviewRow,
  recordKey,
  text,
  token,
  type OverviewRow,
  type OverviewTable,
} from '../src/lib/dataset-overview-records.js';
import { renderOverviewArtifacts } from '../src/lib/dataset-overview-render.js';
import { runDatasetOverview } from '../src/lib/dataset-overview.js';
import type { FetchLike } from '../src/lib/http.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const version = '00.00.001';
const key = (table: OverviewTable, n: number, v = version) => recordKey(table, id(n), v);
const row = (n: number, json: Record<string, unknown> = {}, v = version): OverviewRow => ({
  id: id(n),
  version: v,
  state_code: 100,
  modified_at: '2026-09-08T00:00:00Z',
  json,
});
const name = (value: string) => ({
  baseName: [
    { '@xml:lang': 'en', '#text': value },
    { '@xml:lang': 'zh', '#text': value },
  ],
  treatmentStandardsRoutes: 'route A',
  mixAndLocationTypes: '',
  functionalUnitFlowProperties: null,
});
const classification = {
  'common:classification': [
    {
      '@name': 'Industry',
      'common:class': [
        { '@level': '1', '@classId': '35', '#text': 'electricity' },
        { '@level': '0', '#text': 'energy' },
      ],
    },
    { '@name': 'Other', 'common:class': { '#text': 'power' } },
  ],
};
const exchange = (internal: number, flow: number, direction: string, v = version) => ({
  '@dataSetInternalID': internal,
  exchangeDirection: direction,
  referenceToFlowDataSet: {
    '@refObjectId': id(flow),
    '@version': v,
    'common:shortDescription': { '#text': 'electricity' },
  },
});
function processRow(n: number, label: string, exchanges: unknown[] = [], v = version): OverviewRow {
  return row(
    n,
    {
      processDataSet: {
        processInformation: {
          dataSetInformation: { name: name(label) },
          quantitativeReference: { referenceToReferenceFlow: 0 },
          time: { 'common:referenceYear': 2024, 'common:dataSetValidUntil': '2028' },
          geography: { locationOfOperationSupplyOrProduction: { '@location': 'CN' } },
        },
        exchanges: { exchange: exchanges },
        modellingAndValidation: {
          LCIMethodAndAllocation: { typeOfDataSet: 'Unit process, single operation' },
        },
      },
    },
    v,
  );
}
const flowRow = (n: number, label: string, v = version) =>
  row(
    n,
    {
      flowDataSet: {
        flowInformation: { dataSetInformation: { name: name(label) } },
        modellingAndValidation: { LCIMethod: { typeOfDataSet: 'Product flow' } },
      },
    },
    v,
  );
const instance = (internal: string, processId: number, connections: unknown = [], v = version) => ({
  '@dataSetInternalID': internal,
  referenceToProcess: { '@refObjectId': id(processId), '@version': v },
  connections: { outputExchange: connections },
});
const connection = (target: string, flow: number) => ({
  '@flowUUID': id(flow),
  '@version': version,
  downstreamProcess: { '@id': target, '@flowUUID': id(flow), '@version': version },
});
const modelRow = (instances: unknown[]) =>
  row(20, {
    lifeCycleModelDataSet: {
      lifeCycleModelInformation: {
        dataSetInformation: { name: name('electricity model') },
        technology: { processes: { processInstance: instances } },
      },
    },
  });
function fixtureRows() {
  const old = processRow(1, 'electricity generation', [exchange(0, 10, 'Output')]);
  const current = processRow(
    1,
    'electricity generation',
    [exchange(0, 10, 'Output'), exchange(1, 11, 'Input')],
    '00.00.002',
  );
  object(object(current.json.processDataSet).processInformation).dataSetInformation = {
    name: name('electricity generation'),
    classificationInformation: classification,
  };
  return {
    processes: [
      old,
      current,
      processRow(2, 'steel rolling', [
        exchange(0, 12, 'Output'),
        exchange(1, 10, 'Input'),
        exchange(2, 10, 'Input'),
      ]),
      processRow(3, 'coal extraction', [exchange(0, 11, 'Output')]),
    ],
    flows: [
      flowRow(10, 'electricity'),
      flowRow(10, 'electricity updated', '00.00.002'),
      flowRow(11, 'coal'),
      flowRow(12, 'steel'),
    ],
    lifecyclemodels: [
      modelRow([
        instance('generator', 1, connection('rolling', 10)),
        instance('rolling', 2),
        instance('second-generator', 1),
      ]),
    ],
  };
}
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'topic-overview-'));
  const rows = fixtureRows();
  const calls: URL[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input);
    calls.push(url);
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('Accept-Profile'), 'public');
    assert.equal(new Headers(init?.headers).get('Prefer'), 'count=exact');
    assert.equal(url.searchParams.get('state_code'), 'eq.100');
    assert.equal(url.searchParams.has('user_id'), false);
    assert.equal(url.searchParams.get('order'), 'id.asc,version.asc');
    const table = url.pathname.split('/').at(-1) as OverviewTable;
    const offset = Number(url.searchParams.get('offset'));
    const page = rows[table].slice(offset, offset + 1); // server cap below request, including same UUID revisions
    return new Response(JSON.stringify(page), {
      headers: {
        'content-range': page.length ? `${offset}-${offset}/${rows[table].length}` : '*/0',
      },
    });
  };
  const options = {
    outDir: path.join(root, 'capture'),
    env: {},
    fetchImpl,
    dataRuntime: {
      apiBaseUrl: 'https://exampleprojectref.supabase.co/functions/v1',
      publishableKey: 'fixture-public-key',
      getAccessToken: async () => 'header-only-token',
    },
    now: () => new Date('2026-09-08T00:00:00Z'),
  };
  return { root, rows, calls, options };
}
const scope = (
  core = [{ table: 'processes', id: id(1), reason: 'reference product and generation name' }],
) =>
  parseOverviewScope({
    schema_version: 1,
    topic: '电力行业',
    boundary: 'Generation; electricity consumers are related data.',
    terms: ['electricity', '发电'],
    core,
  });
const normalize = (rows: ReturnType<typeof fixtureRows>) =>
  OVERVIEW_TABLES.flatMap((table) => rows[table].map((r) => normalizeOverviewRecord(table, r)));

test('public capture keeps every version across capped pages and offline topic outputs agree', async () => {
  const f = fixture();
  try {
    const captured = await captureOverview(f.options);
    assert.equal(captured.completeness.row_count, 9);
    assert.equal(captured.transactional_snapshot, false);
    assert.equal(captured.completeness.entity_counts.processes, 4);
    assert.equal(f.calls.filter((url) => url.pathname.endsWith('/processes')).length, 4);
    assert.equal(JSON.stringify(captured).includes('header-only-token'), false);
    const inventory = readOverviewInventory(f.options.outDir);
    assert.equal(inventory.records.length, 9);
    const candidates = overviewCatalog(inventory.records, scope());
    assert.equal(candidates.public_objects, 7);
    assert.equal(
      candidates.candidates.some((record) => record.id === id(2)),
      false,
      'an electricity input alone is not topic metadata',
    );
    assert.equal(
      candidates.candidates.find((record) => record.id === id(10))?.version,
      '00.00.002',
    );
    const report = analyzeOverview(inventory.records, scope());
    assert.deepEqual(report.core_counts[0], {
      table: 'processes',
      objects: 1,
      public_revisions: 2,
    });
    assert.equal(report.related_counts[0]!.objects, 2);
    assert.deepEqual(report.products.confirmed_flow_ids, [id(10)]);
    assert.deepEqual(
      report.statistics[0]!.classification.map((group) => group.count),
      [1, 1],
    );
    const power = report.flow_usage.find((group) => group.flow_id === id(10))!;
    assert.equal(
      power.flow_version,
      version,
      'Flow references never fall forward to the newer public revision',
    );
    assert.equal(power.process_count, 2);
    assert.equal(power.input_process_count, 1);
    assert.equal(power.output_process_count, 1);
    assert.equal(power.exchange_occurrences, 3);
    assert.equal(report.model_instances.length, 3);
    assert.equal(report.model_connections[0]!.status, 'exact_public_references');
    assert.equal(
      report.records.find((record) => record.key === key('processes', 1))?.role,
      'reference_context',
    );
    assert.equal(
      report.records.find((record) => record.key === key('processes', 1, '00.00.002'))?.role,
      'core',
    );
    const scopeFile = path.join(f.root, 'scope.json');
    writeFileSync(scopeFile, JSON.stringify(scope()));
    const noNetwork: FetchLike = async () => {
      throw new Error('offline commands must not access network');
    };
    for (const action of ['catalog', 'analyze']) {
      const output = path.join(f.root, action);
      const result = await runDatasetOverview(
        [action, '--inventory', f.options.outDir, '--scope', scopeFile, '--out-dir', output],
        { env: {}, fetchImpl: noNetwork },
      );
      assert.ok(object(result).artifacts);
    }
    const json = object(readOverviewJson(path.join(f.root, 'analyze', 'overview.json')));
    assert.deepEqual(json.core_counts, report.core_counts);
    const html = readFileSync(path.join(f.root, 'analyze', 'overview.html'), 'utf8');
    const embedded = html.match(
      /<script id="overview-data" type="application\/json">([\s\S]+?)<\/script>/u,
    )![1]!;
    assert.deepEqual(JSON.parse(embedded), json);
    assert.match(
      readFileSync(path.join(f.root, 'analyze', 'statistics.csv'), 'utf8'),
      /processes:00000000/u,
    );
    assert.match(
      readFileSync(path.join(f.root, 'analyze', 'overview.md'), 'utf8'),
      /\| processes \| 1 \| 2 \|/u,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('steel, Flow-only, Model-only, empty and missing-reference scopes preserve distinct populations', () => {
  const rows = fixtureRows();
  const broken = processRow(4, 'electricity unknown', [
    exchange(0, 10, 'Input', '00.00.099'),
    exchange(1, 99, 'sideways'),
  ]);
  rows.processes.push(broken, processRow(5, 'without exchanges'));
  const all = normalize(rows);
  const steel = analyzeOverview(
    all,
    scope([{ table: 'processes', id: id(2), reason: 'steel product' }]),
  );
  assert.deepEqual(steel.products.confirmed_flow_ids, [id(12)]);
  assert.equal(steel.core_counts[0]!.objects, 1);
  assert.equal(steel.related_counts[0]!.objects, 1);
  const flow = analyzeOverview(
    all,
    scope([{ table: 'flows', id: id(10), reason: 'electricity product' }]),
  );
  assert.equal(flow.core_counts[1]!.objects, 1);
  assert.equal(flow.flow_usage.length, 2);
  assert.equal(flow.unresolved_flow_usages.length, 1);
  const model = analyzeOverview(
    all,
    scope([{ table: 'lifecyclemodels', id: id(20), reason: 'generation model' }]),
  );
  assert.equal(model.core_counts[0]!.objects, 0);
  assert.equal(model.core_counts[2]!.objects, 1);
  assert.equal(model.records.filter((record) => record.role === 'reference_context').length, 3);
  const missing = analyzeOverview(
    all,
    scope([
      { table: 'processes', id: id(4), reason: 'named generation' },
      { table: 'processes', id: id(5), reason: 'named generation' },
    ]),
  );
  assert.deepEqual(missing.products.confirmed_flow_ids, []);
  assert.equal(missing.products.processes_with_unresolved_reference.length, 2);
  assert.equal(missing.products.processes_without_reference_exchange.length, 1);
  assert.equal(missing.core_unresolved_exchanges.length, 2);
  assert.equal(missing.core_unknown_direction_exchanges.length, 1);
  assert.ok(missing.flow_usage.every((group) => !group.resolved));
  assert.equal(
    missing.records.some((record) => record.key === key('flows', 10, '00.00.002')),
    false,
  );
  assert.equal(analyzeOverview(all, scope([])).records.length, 0);
  assert.throws(() =>
    analyzeOverview(all, scope([{ table: 'processes', id: id(999), reason: 'unknown' }])),
  );
  assert.throws(() => latestOverviewRecords([...all, all[0]!]));
  assert.equal(latestOverviewRecords([all[1]!, all[0]!]).length, 1);
});

test('explicit model connection observations preserve unresolved, ambiguous and cyclic structures', () => {
  const cases = [
    ['target_instance_missing', []],
    ['target_instance_ambiguous', [instance('target', 2), instance('target', 2)]],
    ['process_reference_unresolved', [instance('target', 99)]],
    ['flow_id_missing', [instance('target', 2)]],
    ['endpoint_flow_not_observed', [instance('target', 3)]],
    ['flow_reference_unresolved', [instance('target', 2)]],
    ['flow_version_missing', [instance('target', 2)]],
    ['exact_public_references', [instance('target', 2)]],
  ] as const;
  for (const [expected, targets] of cases) {
    const rows = fixtureRows();
    const output =
      expected === 'flow_id_missing'
        ? { downstreamProcess: { '@id': 'target' } }
        : connection('target', 10);
    rows.lifecyclemodels = [modelRow([instance('source', 1, output), ...targets])];
    if (expected === 'flow_reference_unresolved')
      rows.flows = rows.flows.filter((flow) => flow.id !== id(10));
    if (expected === 'flow_version_missing') object(output)['@version'] = '';
    assert.equal(analyzeOverview(normalize(rows), scope()).model_connections[0]!.status, expected);
  }
  const cyclic = fixtureRows();
  cyclic.lifecyclemodels = [
    modelRow([
      instance('one', 1, [connection('two', 10), connection('one', 10)]),
      instance('two', 2, connection('one', 12)),
      instance('missing-version', 1, [], ''),
    ]),
  ];
  const report = analyzeOverview(normalize(cyclic), scope());
  assert.equal(report.model_connections.length, 3);
  assert.equal(report.model_instances.at(-1)!.resolved, false);
  assert.equal(report.traversal.truncated, false);
});

test('normalization preserves multilingual four-part names, missing fields and descriptive discovery', () => {
  assert.deepEqual(object(null), {});
  assert.deepEqual(object([]), {});
  assert.deepEqual(list(null), []);
  assert.deepEqual(list(undefined), []);
  assert.deepEqual(list('x'), ['x']);
  assert.equal(token(false), '');
  assert.equal(token(0), '0');
  assert.equal(text({ '#text': 'en', '@xml:lang': 'en' }), 'en');
  assert.equal(text([{ '#text': 'en' }, { '#text': '中文', '@xml:lang': 'zh' }]), '中文');
  const empty = normalizeOverviewRecord('processes', row(9));
  assert.equal(empty.name, '');
  assert.deepEqual(empty.name_parts, ['', '', '', '']);
  const raw = flowRow(10, '<script>electricity</script>');
  const info = object(object(raw.json.flowDataSet).flowInformation);
  info.geography = { locationOfSupply: 'CN' };
  info.technology = {
    technologyDescriptionAndIncludedProcesses: { '#text': 'generator technology' },
  };
  object(info.dataSetInformation).classificationInformation = {
    'common:elementaryFlowCategorization': {
      'common:category': [
        { '@level': 1, '#text': 'air' },
        { '@level': 0, '#text': 'emissions' },
      ],
    },
    'common:classification': [{}, { 'common:class': [{ '@classId': 'x', '@level': 0 }] }],
  };
  const normalized = normalizeOverviewRecord('flows', raw);
  assert.equal(normalized.location, 'CN');
  assert.equal(normalized.name_parts[2], '');
  assert.equal(normalized.name_parts_raw[3], '');
  assert.deepEqual(normalized.classifications, ['x', 'emissions > air']);
  assert.match(normalized.search_text, /generator technology/u);
  object(info.dataSetInformation).name = {
    baseName: { '#text': 'Flow' },
    flowProperties: { '#text': '1 kWh' },
  };
  assert.equal(normalizeOverviewRecord('flows', raw).name_parts[3], '1 kWh');
  const model = normalizeOverviewRecord(
    'lifecyclemodels',
    modelRow([
      {},
      { referenceToProcess: {}, connections: { outputExchange: { downstreamProcess: {} } } },
    ]),
  );
  assert.equal(model.instances[0]!.process_id, '');
  assert.equal(model.instances[1]!.connections[0]!.target_id, '');
  const noDirection = processRow(1, 'blank', [{}]);
  assert.equal(
    normalizeOverviewRecord('processes', noDirection).exchanges[0]!.direction,
    'unknown',
  );
  const report = analyzeOverview(
    [empty, normalized],
    scope([
      { table: 'processes', id: id(9), reason: 'explicit' },
      { table: 'flows', id: id(10), reason: 'explicit' },
    ]),
  );
  report.scope.topic = '</script><script>alert(1)</script>|`\n&"\u2028\u2029';
  const files = renderOverviewArtifacts(report);
  assert.equal(files['overview.html']!.includes('<script>alert(1)</script>'), false);
  assert.match(files['overview.html']!, /\\u003c/u);
  assert.match(files['overview.md']!, /&#124;&#96;/u);
  assert.match(
    overviewCsv([['=1+1', '+test', '-test', '@formula', '\tcell', 'x,"y"']]),
    /"'=1\+1"/u,
  );
  assert.match(overviewCsv([['x,"y"']]), /"x,""y"""/u);
});

test('row and scope validation reject private rows and ambiguous membership contracts', () => {
  for (const value of [
    null,
    [],
    {},
    { ...row(1), id: '' },
    { ...row(1), version: '1' },
    { ...row(1), state_code: 0 },
    { ...row(1), json: null },
    { ...row(1), json: [] },
    { ...row(1), json: 'bad' },
  ])
    assert.throws(() => parseOverviewRow(value));
  assert.equal(parseOverviewRow({ ...row(1), modified_at: null }).modified_at, '');
  const valid = scope();
  for (const value of [
    null,
    { ...valid, schema_version: 2 },
    { ...valid, topic: '' },
    { ...valid, boundary: '' },
    { ...valid, terms: null },
    { ...valid, terms: [] },
    { ...valid, terms: [0] },
    { ...valid, terms: [''] },
    { ...valid, core: null },
    { ...valid, core: [{ table: 'other', id: id(1), reason: 'x' }] },
    { ...valid, core: [{ table: 'flows', id: 1, reason: 'x' }] },
    { ...valid, core: [{ table: 'flows', id: '', reason: 'x' }] },
    { ...valid, core: [{ table: 'flows', id: id(1), reason: '' }] },
    { ...valid, core: [...valid.core, ...valid.core] },
  ])
    assert.throws(() => parseOverviewScope(value));
  assert.deepEqual(parseOverviewScope({ ...valid, terms: ['steel', 'steel'] }).terms, ['steel']);
});

test('capture bounds, public fence, incomplete pages and transport failures never publish a completion marker', async () => {
  const f = fixture();
  try {
    for (const override of [
      { outDir: '' },
      { pageSize: 0 },
      { maxRows: 0 },
      { maxBytes: 0 },
      { maxRows: 1 },
    ]) {
      await assert.rejects(captureOverview({ ...f.options, ...override }));
      assert.equal(existsSync(f.options.outDir), false);
    }
    const responses = [
      () => new Response('denied', { status: 403 }),
      () => new Response('[]'),
      () =>
        new Response(JSON.stringify([{ ...row(1), state_code: 0 }]), {
          headers: { 'content-range': '0-0/1' },
        }),
      () => new Response('{}', { headers: { 'content-range': '0-0/1' } }),
      () => new Response('invalid', { headers: { 'content-range': '0-0/1' } }),
      () => new Response(null, { headers: { 'content-range': '*/0' } }),
      () => new Response('[]', { headers: { 'content-range': '*/0', 'content-length': '9999' } }),
      () => new Response('x'.repeat(9999), { headers: { 'content-range': '*/0' } }),
    ];
    for (const response of responses) {
      await assert.rejects(
        captureOverview({ ...f.options, maxBytes: 1000, fetchImpl: async () => response() }),
      );
      assert.equal(existsSync(f.options.outDir), false);
    }
    await assert.rejects(
      captureOverview({
        ...f.options,
        fetchImpl: async () => {
          throw new Error('secret transport detail');
        },
      }),
      (error: Error) => !error.message.includes('secret'),
    );
    const empty = await captureOverview({
      ...f.options,
      now: undefined,
      fetchImpl: async () => new Response('[]', { headers: { 'content-range': '*/0' } }),
    });
    assert.equal(empty.completeness.row_count, 0);
    assert.equal(readOverviewInventory(f.options.outDir).records.length, 0);
    await assert.rejects(
      captureOverview({
        ...f.options,
        dataRuntime: undefined,
        env: {
          TIANGONG_LCA_AUTH_MODE: 'oauth',
          TIANGONG_LCA_API_BASE_URL: 'https://exampleprojectref.supabase.co/functions/v1',
          TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY: 'fixture-public-key',
          TIANGONG_LCA_OAUTH_CLIENT_ID: id(999),
          TIANGONG_LCA_SESSION_FILE: path.join(f.root, 'absent-session.json'),
        },
      }),
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('offline inventory validates provenance metadata, hashes and counts without changing inputs', async () => {
  const f = fixture();
  try {
    await captureOverview(f.options);
    const captureFile = path.join(f.options.outDir, 'capture.json');
    const capture = object(readOverviewJson(captureFile));
    for (const bad of [
      { ...capture, schema_version: 'other' },
      { ...capture, visibility: 'owner' },
      { ...capture, completeness: {} },
    ]) {
      writeFileSync(captureFile, JSON.stringify(bad));
      assert.throws(() => readOverviewInventory(f.options.outDir));
    }
    writeFileSync(captureFile, JSON.stringify(capture));
    const processFile = path.join(f.options.outDir, 'processes.jsonl');
    writeFileSync(processFile, '');
    assert.throws(() => readOverviewInventory(f.options.outDir), /hash mismatch/u);
    object(capture.sha256).processes = overviewHash('');
    writeFileSync(captureFile, JSON.stringify(capture));
    assert.throws(() => readOverviewInventory(f.options.outDir), /count mismatch/u);
    writeFileSync(captureFile, 'bad JSON');
    assert.throws(() => readOverviewJson(captureFile));
    assert.throws(() => writeOverviewArtifacts('', {}));
    assert.throws(() => writeOverviewArtifacts(f.options.outDir, {}));
    const fs = createRequire(import.meta.url)('node:fs') as typeof import('node:fs');
    const original = fs.writeFileSync;
    try {
      fs.writeFileSync = (() => {
        throw new Error('disk full');
      }) as typeof writeFileSync;
      syncBuiltinESMExports();
      assert.throws(() =>
        writeOverviewArtifacts(path.join(f.root, 'failed-output'), { 'a.json': '{}' }),
      );
      assert.equal(existsSync(path.join(f.root, 'failed-output')), false);
    } finally {
      fs.writeFileSync = original;
      syncBuiltinESMExports();
    }
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('command capability, help and option admission are offline and never admit state/owner overrides', async () => {
  const fetchImpl: FetchLike = async () => {
    throw new Error('unexpected network');
  };
  const deps = { env: {}, fetchImpl, dotEnvStatus: { loaded: false, path: '', count: 0 } };
  for (const args of [[], ['-h'], ['--help'], ['capture', '--help']])
    assert.ok(object(await runDatasetOverview(args, deps)).help);
  const described = object(await runDatasetOverview(['describe', '--json'], deps));
  assert.equal(described.schema_version, 'tiangong-lca.overview-capabilities.v1');
  for (const args of [
    ['nope'],
    ['capture', '--state-code', '0'],
    ['capture', '--user-id', id(1)],
    ['describe', '--out-dir', 'bad'],
    ['analyze'],
    ['analyze', '--inventory', 'x'],
    ['analyze', '--inventory', 'x', '--scope', 'y'],
    ['catalog', '--inventory', ' ', '--scope', 'x', '--out-dir', 'y'],
  ])
    await assert.rejects(runDatasetOverview(args, deps));
  for (const args of [
    ['capture'],
    ['capture', '--out-dir', 'out', '--page-size', '5', '--max-rows', '20', '--max-bytes', '1000'],
  ]) {
    let called = false;
    await runDatasetOverview(args, {
      ...deps,
      captureImpl: async (options) => {
        called = true;
        assert.equal(options.pageSize, args.length > 1 ? 5 : undefined);
        return { captured: true } as unknown as Awaited<ReturnType<typeof captureOverview>>;
      },
    });
    assert.equal(called, true);
  }
  await assert.rejects(runDatasetOverview(['capture'], deps));
  const result = await executeCli(['dataset', 'overview', 'describe'], deps);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /overview-capabilities.v1/u);
  const injected = await executeCli(['dataset', 'overview', 'describe'], {
    ...deps,
    runDatasetOverviewImpl: async () => ({ injected: true }),
  });
  assert.match(injected.stdout, /injected/u);
});

test('ambiguous reference exchanges remain observations and never inflate confirmed products', () => {
  const rows = fixtureRows();
  rows.processes = [
    processRow(1, 'electricity', [exchange(0, 10, 'Output'), exchange(0, 11, 'Output')]),
  ];
  const report = analyzeOverview(normalize(rows), scope());
  assert.deepEqual(report.products.confirmed_flow_ids, []);
  assert.equal(report.products.reference_exchanges.length, 2);
  assert.ok(
    report.products.reference_exchanges.every(
      (reference) => reference.reference_ambiguous && !reference.resolved,
    ),
  );
  assert.deepEqual(report.products.processes_with_unresolved_reference, [key('processes', 1)]);
  assert.deepEqual(report.products.processes_with_ambiguous_reference, [key('processes', 1)]);
  const artifacts = renderOverviewArtifacts(report);
  const usageLines = artifacts['flow-usage.csv']!.trim().split('\r\n');
  assert.match(
    usageLines[0]!,
    /"reference_exchange_ambiguous","confirmed_core_reference_product"/u,
  );
  assert.equal(usageLines.length, 3);
  assert.ok(usageLines.slice(1).every((line) => line.includes('"true","true","false"')));
  assert.match(artifacts['overview.md']!, /其中 1 个存在参考交换标识歧义/u);
  rows.processes = [processRow(1, 'electricity', [exchange(0, 10, 'Output')])];
  object(object(rows.processes[0]!.json.processDataSet).processInformation).quantitativeReference =
    { referenceToReferenceFlow: [0, 9] };
  const partial = analyzeOverview(normalize(rows), scope());
  assert.deepEqual(partial.products.confirmed_flow_ids, [id(10)]);
  assert.deepEqual(partial.products.missing_reference_exchanges, [
    { process_key: key('processes', 1), internal_id: '9' },
  ]);
  assert.equal(partial.products.processes_with_unresolved_reference.length, 1);
});

test('Flow-only unresolved usages retain exact evidence without claiming a resolved association', () => {
  const rows = fixtureRows();
  rows.processes = [processRow(2, 'steel', [exchange(1, 10, 'Input', '')])];
  rows.lifecyclemodels = [];
  const report = analyzeOverview(
    normalize(rows),
    scope([{ table: 'flows', id: id(10), reason: 'electricity product' }]),
  );
  assert.equal(report.flow_usage.length, 1);
  assert.equal(report.flow_usage[0]!.resolved, false);
  assert.equal(report.unresolved_flow_usages.length, 1);
  assert.equal(report.unresolved_flow_usages[0]!.flow_version, '');
  assert.equal(report.related_counts[0]!.objects, 0);
  assert.equal(report.records.find((record) => record.id === id(2))!.role, 'reference_context');
});

test('model endpoints honor independently declared Flow UUIDs and versions', () => {
  const rows = fixtureRows();
  rows.processes = [
    processRow(1, 'electricity', [exchange(0, 10, 'Output')]),
    processRow(2, 'steel', [exchange(0, 12, 'Input')]),
  ];
  const declared = {
    ...connection('target', 10),
    downstreamProcess: { '@id': 'target', '@flowUUID': id(12), '@version': version },
  };
  rows.lifecyclemodels = [modelRow([instance('source', 1, declared), instance('target', 2)])];
  const exact = analyzeOverview(normalize(rows), scope()).model_connections[0]!;
  assert.equal(exact.status, 'exact_public_references');
  assert.deepEqual(exact.flow_keys, [key('flows', 10), key('flows', 12)]);
  declared['@version'] = '00.00.002';
  assert.equal(
    analyzeOverview(normalize(rows), scope()).model_connections[0]!.status,
    'endpoint_flow_not_observed',
  );
  declared.downstreamProcess['@version'] = '';
  assert.equal(
    analyzeOverview(normalize(rows), scope()).model_connections[0]!.status,
    'flow_version_missing',
  );
  declared.downstreamProcess['@flowUUID'] = '';
  assert.equal(
    analyzeOverview(normalize(rows), scope()).model_connections[0]!.status,
    'flow_id_missing',
  );
});
