import {
  OVERVIEW_TABLES,
  latestOverviewRecords,
  recordKey,
  object,
  overviewError,
  token,
  type OverviewRecord,
  type OverviewInstance,
  type OverviewTable,
} from './dataset-overview-records.js';

export type OverviewScope = {
  schema_version: 1;
  topic: string;
  boundary: string;
  terms: string[];
  core: Array<{ table: OverviewTable; id: string; reason: string }>;
};

export function parseOverviewScope(value: unknown): OverviewScope {
  const scope = object(value);
  if (
    scope.schema_version !== 1 ||
    !token(scope.topic) ||
    !token(scope.boundary) ||
    !Array.isArray(scope.terms) ||
    !scope.terms.length ||
    scope.terms.some((term) => typeof term !== 'string' || !term.trim()) ||
    !Array.isArray(scope.core)
  )
    overviewError(
      'Scope requires schema_version=1, topic, boundary, nonempty terms and an explicit core array.',
    );
  const core = scope.core.map((value) => {
    const entry = object(value);
    if (
      !OVERVIEW_TABLES.includes(entry.table as OverviewTable) ||
      typeof entry.id !== 'string' ||
      !entry.id.trim() ||
      !token(entry.reason)
    )
      overviewError('Each core member requires a supported table, id and inclusion reason.');
    return {
      table: entry.table as OverviewTable,
      id: entry.id.trim(),
      reason: token(entry.reason),
    };
  });
  if (new Set(core.map((entry) => `${entry.table}:${entry.id}`)).size !== core.length)
    overviewError('Scope contains duplicate core identities.');
  return {
    schema_version: 1,
    topic: token(scope.topic),
    boundary: token(scope.boundary),
    terms: [...new Set(scope.terms.map((term) => term.trim()))],
    core,
  };
}

export function overviewMetadata(record: OverviewRecord) {
  return {
    key: record.key,
    table: record.table,
    id: record.id,
    version: record.version,
    name: record.name,
    name_parts: record.name_parts,
    name_parts_raw: record.name_parts_raw,
    classifications: record.classifications,
    location: record.location,
    reference_year: record.reference_year,
    valid_until: record.valid_until,
    dataset_type: record.dataset_type,
    modified_at: record.modified_at,
  };
}

export function overviewCatalog(records: OverviewRecord[], scope: OverviewScope) {
  const latest = latestOverviewRecords(records);
  const candidates = latest.flatMap((record) => {
    const matched = scope.terms.filter((term) =>
      record.search_text.includes(term.normalize('NFKC').toLowerCase()),
    );
    return matched.length ? [{ ...overviewMetadata(record), matched_terms: matched }] : [];
  });
  return {
    schema_version: 'tiangong-lca.overview-catalog.v1',
    scope,
    public_objects: latest.length,
    public_revisions: records.length,
    candidates,
  };
}

function counts(records: OverviewRecord[], revisions: OverviewRecord[]) {
  const ids = new Set(records.map((record) => `${record.table}:${record.id}`));
  return OVERVIEW_TABLES.map((table) => ({
    table,
    objects: records.filter((record) => record.table === table).length,
    public_revisions: revisions.filter(
      (record) => record.table === table && ids.has(`${table}:${record.id}`),
    ).length,
  }));
}

function distribution(records: OverviewRecord[], values: (record: OverviewRecord) => string[]) {
  const groups = new Map<string, Set<string>>();
  for (const record of records) {
    const labels = values(record).filter(Boolean);
    for (const label of labels.length ? labels : ['(未填写)']) {
      const keys = groups.get(label) ?? new Set<string>();
      keys.add(record.key);
      groups.set(label, keys);
    }
  }
  return [...groups]
    .map(([label, keys]) => ({ label, count: keys.size, record_keys: [...keys].sort() }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'en'));
}

function statistics(records: OverviewRecord[]) {
  return OVERVIEW_TABLES.map((table) => {
    const selected = records.filter((record) => record.table === table);
    return {
      table,
      denominator: selected.length,
      classification: distribution(selected, (record) => record.classifications),
      location: distribution(selected, (record) => [record.location]),
      reference_year: distribution(selected, (record) => [record.reference_year]),
      dataset_type: distribution(selected, (record) => [record.dataset_type]),
      treatment_label: distribution(selected, (record) => [record.name_parts[1]!]),
    };
  });
}

type ConnectionStatus =
  | 'target_instance_missing'
  | 'target_instance_ambiguous'
  | 'process_reference_unresolved'
  | 'flow_id_missing'
  | 'endpoint_flow_not_observed'
  | 'flow_version_missing'
  | 'flow_reference_unresolved'
  | 'exact_public_references';

function connectionEvidence(
  source: OverviewRecord | undefined,
  target: OverviewRecord | undefined,
  connection: OverviewInstance['connections'][number],
  byKey: Map<string, OverviewRecord>,
): { status: ConnectionStatus; flow_keys: string[] } {
  if (!source || !target) return { status: 'process_reference_unresolved', flow_keys: [] };
  if (!connection.flow_id || !connection.target_flow_id)
    return { status: 'flow_id_missing', flow_keys: [] };
  if (!connection.flow_version || !connection.target_flow_version)
    return { status: 'flow_version_missing', flow_keys: [] };
  const sourceKey = recordKey('flows', connection.flow_id, connection.flow_version);
  const targetKey = recordKey('flows', connection.target_flow_id, connection.target_flow_version);
  const keys = [...new Set([sourceKey, targetKey])];
  if (keys.some((key) => !byKey.has(key)))
    return { status: 'flow_reference_unresolved', flow_keys: [] };
  const hasOutput = source.exchanges.some(
    (exchange) => exchange.direction === 'output' && exchange.flow_key === sourceKey,
  );
  const hasInput = target.exchanges.some(
    (exchange) => exchange.direction === 'input' && exchange.flow_key === targetKey,
  );
  if (!hasOutput || !hasInput) return { status: 'endpoint_flow_not_observed', flow_keys: [] };
  return {
    status: 'exact_public_references',
    flow_keys: keys,
  };
}

export function analyzeOverview(records: OverviewRecord[], scope: OverviewScope) {
  const latest = latestOverviewRecords(records);
  const byKey = new Map(records.map((record) => [record.key, record]));
  const latestById = new Map(latest.map((record) => [`${record.table}:${record.id}`, record]));
  const core = scope.core.map((entry) => {
    const record = latestById.get(`${entry.table}:${entry.id}`);
    if (!record)
      overviewError(`Core member is absent from the public capture: ${entry.table}:${entry.id}`);
    return record;
  });
  const coreKeys = new Set(core.map((record) => record.key));
  const coreProcessIds = new Set(
    core.filter((record) => record.table === 'processes').map((record) => record.id),
  );
  const coreFlowIds = new Set(
    core.filter((record) => record.table === 'flows').map((record) => record.id),
  );
  const processes = latest.filter((record) => record.table === 'processes');
  const touchedFlows = new Set(
    core.flatMap((record) => record.exchanges.map((exchange) => exchange.flow_key)),
  );
  const relatedKeys = new Set<string>();
  const contextKeys = new Set<string>();
  const uses = processes.flatMap((record) =>
    record.exchanges.map((exchange) => ({ process_key: record.key, ...exchange })),
  );
  const scopedUses = uses.filter(
    (use) =>
      coreFlowIds.has(use.flow_id) ||
      (touchedFlows.has(use.flow_key) &&
        (byKey.has(use.flow_key) || coreKeys.has(use.process_key))),
  );
  const groupedUses = new Map<string, typeof scopedUses>();
  for (const use of scopedUses) {
    const group = groupedUses.get(use.flow_key) ?? [];
    group.push(use);
    groupedUses.set(use.flow_key, group);
    if (byKey.has(use.flow_key)) {
      relatedKeys.add(use.process_key);
      contextKeys.add(use.flow_key);
    } else {
      contextKeys.add(use.process_key);
    }
  }
  const flowUsage = [...groupedUses]
    .map(([key, exchanges]) => {
      const flow = byKey.get(key);
      const first = exchanges[0]!;
      return {
        flow_key: key,
        flow_id: first.flow_id,
        flow_version: first.flow_version,
        name: flow?.name ?? '',
        resolved: !!flow,
        process_count: new Set(exchanges.map((exchange) => exchange.process_key)).size,
        input_process_count: new Set(
          exchanges
            .filter((exchange) => exchange.direction === 'input')
            .map((exchange) => exchange.process_key),
        ).size,
        output_process_count: new Set(
          exchanges
            .filter((exchange) => exchange.direction === 'output')
            .map((exchange) => exchange.process_key),
        ).size,
        exchange_occurrences: exchanges.length,
        exchanges,
      };
    })
    .sort((a, b) => a.flow_key.localeCompare(b.flow_key, 'en'));
  const models = latest.filter(
    (record) =>
      record.table === 'lifecyclemodels' &&
      (coreKeys.has(record.key) ||
        record.instances.some((instance) => coreProcessIds.has(instance.process_id))),
  );
  const modelInstances = models.flatMap((model) => {
    relatedKeys.add(model.key);
    return model.instances.map((instance) => {
      const resolved = byKey.has(instance.process_key);
      if (resolved) contextKeys.add(instance.process_key);
      return { model_key: model.key, ...instance, resolved };
    });
  });
  const modelConnections = models.flatMap((model) =>
    model.instances.flatMap((instance) =>
      instance.connections.map((connection) => {
        const targets = model.instances.filter(
          (candidate) => candidate.internal_id && candidate.internal_id === connection.target_id,
        );
        const target = targets.length === 1 ? targets[0] : undefined;
        const evidence: { status: ConnectionStatus; flow_keys: string[] } =
          targets.length !== 1
            ? {
                status: targets.length ? 'target_instance_ambiguous' : 'target_instance_missing',
                flow_keys: [],
              }
            : connectionEvidence(
                byKey.get(instance.process_key),
                byKey.get(target!.process_key),
                connection,
                byKey,
              );
        evidence.flow_keys.forEach((key) => contextKeys.add(key));
        return {
          model_key: model.key,
          evidence: connection.evidence,
          source_instance: instance.evidence,
          source_internal_id: instance.internal_id,
          source_process_key: instance.process_key,
          target_instance: target?.evidence ?? '',
          target_internal_id: connection.target_id,
          target_process_key: target?.process_key ?? '',
          flow_id: connection.flow_id,
          flow_version: connection.flow_version,
          target_flow_id: connection.target_flow_id,
          target_flow_version: connection.target_flow_version,
          ...evidence,
        };
      }),
    ),
  );
  const coreProcesses = core.filter((record) => record.table === 'processes');
  const referenceProducts = coreProcesses.flatMap((record) =>
    record.exchanges
      .filter((exchange) => exchange.reference)
      .map((exchange) => ({
        process_key: record.key,
        ...exchange,
        resolved: !exchange.reference_ambiguous && byKey.has(exchange.flow_key),
      })),
  );
  const related = latest.filter(
    (record) => relatedKeys.has(record.key) && !coreKeys.has(record.key),
  );
  const displayed = new Set([...coreKeys, ...relatedKeys, ...contextKeys]);
  const missingReferenceExchanges = coreProcesses.flatMap((record) =>
    record.reference_exchange_ids
      .filter((id) => !record.exchanges.some((exchange) => exchange.internal_id === id))
      .map((id) => ({ process_key: record.key, internal_id: id })),
  );
  const selectedRecords = records
    .filter((record) => displayed.has(record.key))
    .map((record) => ({
      ...overviewMetadata(record),
      role: coreKeys.has(record.key)
        ? 'core'
        : relatedKeys.has(record.key)
          ? 'related'
          : 'reference_context',
    }))
    .sort((a, b) => a.key.localeCompare(b.key, 'en'));
  return {
    schema_version: 'tiangong-lca.topic-overview.v1',
    scope,
    policy: {
      visibility: 'public_state_100_all_owners',
      object_version: 'latest_public_DD.DD.DDD',
      reference_version: 'exact_only_no_fallback',
      relation_depth: 'one_hop_shared_flow_plus_explicit_model_structure',
      shared_flow:
        'Possible supply/use association through an exact public Flow reference; not a selected provider, allocation or market share.',
      model_connection:
        'Declared model links with endpoint-reference observations; no solving, allocation or quantitative flow inference.',
      classification:
        'Distinct objects per recorded path; multiple paths overlap and do not sum to a partition.',
      treatment_label: 'Recorded name-part labels, not semantic counts of technologies.',
      time: 'Dataset reference years, not an industry production time series.',
    },
    public_counts: counts(latest, records),
    core_counts: counts(core, records),
    related_counts: counts(related, records),
    statistics: statistics(core),
    related_statistics: statistics(related),
    products: {
      confirmed_flow_ids: [
        ...new Set(
          referenceProducts.filter((product) => product.resolved).map((product) => product.flow_id),
        ),
      ].sort(),
      reference_exchanges: referenceProducts,
      missing_reference_exchanges: missingReferenceExchanges,
      processes_with_ambiguous_reference: [
        ...new Set(
          referenceProducts
            .filter((reference) => reference.reference_ambiguous)
            .map((reference) => reference.process_key),
        ),
      ].sort(),
      processes_without_reference_exchange: coreProcesses
        .filter((record) => !record.exchanges.some((exchange) => exchange.reference))
        .map((record) => record.key),
      processes_with_unresolved_reference: [
        ...new Set([
          ...referenceProducts
            .filter((product) => !product.resolved)
            .map((product) => product.process_key),
          ...missingReferenceExchanges.map((reference) => reference.process_key),
        ]),
      ].sort(),
    },
    core_unresolved_exchanges: coreProcesses.flatMap((record) =>
      record.exchanges
        .filter((exchange) => !byKey.has(exchange.flow_key))
        .map((exchange) => ({ process_key: record.key, ...exchange })),
    ),
    core_unknown_direction_exchanges: coreProcesses.flatMap((record) =>
      record.exchanges
        .filter((exchange) => exchange.direction === 'unknown')
        .map((exchange) => exchange.evidence),
    ),
    records: selectedRecords,
    unresolved_flow_usages: scopedUses.filter((exchange) => !byKey.has(exchange.flow_key)),
    flow_usage: flowUsage,
    model_instances: modelInstances,
    model_connections: modelConnections,
    traversal: {
      relation_hops: 1,
      truncated: false,
      note: 'Core statistics use only explicit UUID membership. Older exact model/reference revisions are context and do not inflate core counts.',
    },
  };
}

export type TopicOverview = ReturnType<typeof analyzeOverview>;
