import { CliError } from './errors.js';

export const OVERVIEW_TABLES = ['processes', 'flows', 'lifecyclemodels'] as const;
export type OverviewTable = (typeof OVERVIEW_TABLES)[number];
export type OverviewRow = {
  id: string;
  version: string;
  state_code: 100;
  modified_at: string;
  json: Record<string, unknown>;
};

export function overviewError(message: string): never {
  throw new CliError(message, { code: 'DATASET_OVERVIEW_INVALID', exitCode: 2 });
}

export function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function list(value: unknown): unknown[] {
  return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
}

export function token(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

export function text(value: unknown): string {
  const items = list(value);
  const preferred = items.find((item) => object(item)['@xml:lang'] === 'zh');
  return (
    token(object(preferred)['#text']) ||
    items
      .map((item) => token(object(item)['#text']) || token(item))
      .filter(Boolean)
      .join(' / ')
  );
}

export function recordKey(table: OverviewTable, id: string, version: string): string {
  return `${table}:${id}@${version}`;
}

export function parseOverviewRow(value: unknown): OverviewRow {
  const row = object(value);
  if (
    !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/u.test(token(row.id)) ||
    !/^\d{2}\.\d{2}\.\d{3}$/u.test(token(row.version)) ||
    row.state_code !== 100 ||
    !row.json ||
    row.json !== object(row.json)
  )
    overviewError(
      'Expected public state_code=100 rows with UUID, canonical dataset version and JSON payload.',
    );
  return {
    id: token(row.id),
    version: token(row.version),
    state_code: 100,
    modified_at: token(row.modified_at),
    json: object(row.json),
  };
}

export type OverviewExchange = {
  evidence: string;
  internal_id: string;
  direction: 'input' | 'output' | 'unknown';
  flow_id: string;
  flow_version: string;
  flow_key: string;
  reference: boolean;
  reference_ambiguous: boolean;
};

export type OverviewInstance = {
  evidence: string;
  internal_id: string;
  process_id: string;
  process_version: string;
  process_key: string;
  connections: Array<{
    target_id: string;
    flow_id: string;
    flow_version: string;
    target_flow_id: string;
    target_flow_version: string;
    evidence: string;
  }>;
};

export type OverviewRecord = {
  key: string;
  table: OverviewTable;
  id: string;
  version: string;
  modified_at: string;
  name: string;
  name_parts: string[];
  name_parts_raw: unknown[];
  classifications: string[];
  location: string;
  reference_year: string;
  valid_until: string;
  dataset_type: string;
  search_text: string;
  reference_exchange_ids: string[];
  exchanges: OverviewExchange[];
  instances: OverviewInstance[];
};

const ROOTS = {
  processes: ['processDataSet', 'processInformation'],
  flows: ['flowDataSet', 'flowInformation'],
  lifecyclemodels: ['lifeCycleModelDataSet', 'lifeCycleModelInformation'],
} as const;
const NAME_PARTS = ['baseName', 'treatmentStandardsRoutes', 'mixAndLocationTypes'];

export function normalizeOverviewRecord(table: OverviewTable, row: OverviewRow): OverviewRecord {
  const [rootName, infoName] = ROOTS[table];
  // The Data API stores canonical TIDAS roots. Unknown payload shapes stay visibly empty.
  const root = object(row.json[rootName]);
  const info = object(root[infoName]);
  const data = object(info.dataSetInformation);
  const name = object(data.name);
  const rawParts = [
    ...NAME_PARTS,
    table === 'flows' ? 'flowProperties' : 'functionalUnitFlowProperties',
  ].map((part) => name[part] ?? '');
  const parts = rawParts.map(text);
  const classificationInfo = object(data.classificationInformation);
  const classes = [
    ...list(classificationInfo['common:classification']),
    ...list(classificationInfo['common:elementaryFlowCategorization']),
  ];
  const classifications = classes
    .map((value) => {
      const classification = object(value);
      const path = list(classification['common:class'] ?? classification['common:category'])
        .map(object)
        .sort((a, b) => Number(a['@level']) - Number(b['@level']))
        .map((entry) => [token(entry['@classId']), text(entry)].filter(Boolean).join(' '))
        .filter(Boolean)
        .join(' > ');
      return [token(classification['@name']), path].filter(Boolean).join(': ');
    })
    .filter(Boolean);
  const geography = object(info.geography);
  const time = object(info.time);
  const modelling = object(root.modellingAndValidation);
  const method = object(modelling.LCIMethodAndAllocation ?? modelling.LCIMethod);
  const key = recordKey(table, row.id, row.version);
  const referenceIds = new Set(
    list(object(info.quantitativeReference).referenceToReferenceFlow).map(token).filter(Boolean),
  );
  const rawExchanges = list(object(root.exchanges).exchange);
  const internalIdCounts = new Map<string, number>();
  for (const value of rawExchanges) {
    const internalId = token(object(value)['@dataSetInternalID']);
    internalIdCounts.set(internalId, (internalIdCounts.get(internalId) ?? 0) + 1);
  }
  const exchanges = rawExchanges.map((value, index): OverviewExchange => {
    const exchange = object(value);
    const ref = object(exchange.referenceToFlowDataSet);
    const direction = token(exchange.exchangeDirection).toLowerCase();
    const flowId = token(ref['@refObjectId']);
    const version = token(ref['@version']);
    return {
      evidence: `${key}#exchanges/${index}`,
      internal_id: token(exchange['@dataSetInternalID']),
      direction: direction === 'input' || direction === 'output' ? direction : 'unknown',
      flow_id: flowId,
      flow_version: version,
      flow_key: recordKey('flows', flowId, version),
      reference: referenceIds.has(token(exchange['@dataSetInternalID'])),
      reference_ambiguous:
        referenceIds.has(token(exchange['@dataSetInternalID'])) &&
        internalIdCounts.get(token(exchange['@dataSetInternalID']))! > 1,
    };
  });
  const instances = list(object(object(info.technology).processes).processInstance).map(
    (value, index): OverviewInstance => {
      const instance = object(value);
      const ref = object(instance.referenceToProcess);
      const id = token(ref['@refObjectId']);
      const version = token(ref['@version']);
      const evidence = `${key}#instances/${index}`;
      const connections = list(object(instance.connections).outputExchange).flatMap(
        (value, outputIndex) => {
          const output = object(value);
          return list(output.downstreamProcess).map((downstream, targetIndex) => ({
            target_id: token(object(downstream)['@id']),
            flow_id: token(output['@flowUUID']),
            flow_version: token(output['@version']),
            target_flow_id: token(object(downstream)['@flowUUID']),
            target_flow_version: token(object(downstream)['@version']),
            evidence: `${evidence}/outputs/${outputIndex}/targets/${targetIndex}`,
          }));
        },
      );
      return {
        evidence,
        internal_id: token(instance['@dataSetInternalID']),
        process_id: id,
        process_version: version,
        process_key: recordKey('processes', id, version),
        connections,
      };
    },
  );
  return {
    key,
    table,
    id: row.id,
    version: row.version,
    modified_at: row.modified_at,
    name: parts.filter(Boolean).join('; '),
    name_parts: parts,
    name_parts_raw: rawParts,
    classifications,
    location:
      token(object(geography.locationOfOperationSupplyOrProduction)['@location']) ||
      token(geography.locationOfSupply),
    reference_year: token(time['common:referenceYear']),
    valid_until: token(time['common:dataSetValidUntil']),
    dataset_type: token(method.typeOfDataSet),
    // Only descriptive metadata participates in discovery; exchange names never make a consumer core.
    search_text: JSON.stringify([
      name,
      data['common:synonyms'],
      classifications,
      info.technology && object(info.technology).technologyDescriptionAndIncludedProcesses,
      info.technology && object(info.technology).technologicalApplicability,
      token(method.typeOfDataSet),
    ])
      .normalize('NFKC')
      .toLowerCase(),
    reference_exchange_ids: [...referenceIds],
    exchanges,
    instances,
  };
}

export function latestOverviewRecords(records: OverviewRecord[]): OverviewRecord[] {
  const byId = new Map<string, OverviewRecord>();
  const identities = new Set<string>();
  for (const record of records) {
    if (identities.has(record.key)) overviewError(`Duplicate captured revision: ${record.key}`);
    identities.add(record.key);
    const key = `${record.table}:${record.id}`;
    const previous = byId.get(key);
    // Canonical DD.DD.DDD versions sort numerically and lexically in the same order.
    if (!previous || record.version > previous.version) byId.set(key, record);
  }
  return [...byId.values()].sort((a, b) => a.key.localeCompare(b.key, 'en'));
}
