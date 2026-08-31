type JsonObject = Record<string, unknown>;

export type ProcessStageFlowGuardIssue = {
  severity: 'info' | 'warning' | 'blocker';
  code: string;
  message: string;
  evidence: JsonObject;
};

export type FlowReferenceIdentity = {
  id: string;
  version: string;
};

export type StageFlowSelfProviderExemption = {
  inputExchangeInternalId: string;
  referenceFlowId: string;
  referenceFlowVersion: string;
  reasonCode: 'documented_closed_loop_recirculation';
  sourceEvidence: Array<{
    sourceId: string;
    locator: string;
    claim: string;
  }>;
  modelingJustification: string;
  reviewDecisionId: string;
};

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function nonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function deepGet(value: unknown, pathParts: string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function asRecords(value: unknown): JsonObject[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  return isRecord(value) ? [value] : [];
}

export function flowReferenceIdentity(exchange: JsonObject): FlowReferenceIdentity {
  const reference = isRecord(exchange.referenceToFlowDataSet)
    ? exchange.referenceToFlowDataSet
    : {};
  return {
    id: nonEmptyString(reference['@refObjectId']),
    version: nonEmptyString(reference['@version']),
  };
}

export function stageFlowSelfProviderExemptions(
  processPayload: JsonObject,
): StageFlowSelfProviderExemption[] {
  const items = asRecords(
    deepGet(processPayload, [
      'processDataSet',
      'processInformation',
      'dataSetInformation',
      'common:other',
      'tiangongfoundry:stageFlowSelfProviderExemption',
    ]),
  );

  return items.flatMap((item) => {
    if (nonEmptyString(item.schemaVersion) !== '1') {
      return [];
    }
    const sourceEvidence = asRecords(item.sourceEvidence).flatMap((evidence) => {
      const sourceId = nonEmptyString(evidence.sourceId);
      const locator = nonEmptyString(evidence.locator);
      const claim = nonEmptyString(evidence.claim);
      return sourceId && locator && claim ? [{ sourceId, locator, claim }] : [];
    });
    const inputExchangeInternalId = nonEmptyString(item.inputExchangeInternalId);
    const referenceFlowId = nonEmptyString(item.referenceFlowId);
    const referenceFlowVersion = nonEmptyString(item.referenceFlowVersion);
    const modelingJustification = nonEmptyString(item.modelingJustification);
    const reviewDecisionId = nonEmptyString(item.reviewDecisionId);
    const reasonCode = nonEmptyString(item.reasonCode);
    if (
      !inputExchangeInternalId ||
      !referenceFlowId ||
      !referenceFlowVersion ||
      reasonCode !== 'documented_closed_loop_recirculation' ||
      sourceEvidence.length === 0 ||
      !modelingJustification ||
      !reviewDecisionId
    ) {
      return [];
    }
    return [
      {
        inputExchangeInternalId,
        referenceFlowId,
        referenceFlowVersion,
        reasonCode,
        sourceEvidence,
        modelingJustification,
        reviewDecisionId,
      },
    ];
  });
}

export function collectProcessStageFlowGuardIssues(
  processPayload: JsonObject,
): ProcessStageFlowGuardIssue[] {
  const exchanges = asRecords(deepGet(processPayload, ['processDataSet', 'exchanges', 'exchange']));
  const referenceFlowInternalId = nonEmptyString(
    deepGet(processPayload, [
      'processDataSet',
      'processInformation',
      'quantitativeReference',
      'referenceToReferenceFlow',
    ]),
  );
  if (!referenceFlowInternalId) {
    return [];
  }
  const referenceExchange = exchanges.find(
    (exchange) => nonEmptyString(exchange['@dataSetInternalID']) === referenceFlowInternalId,
  );
  if (!referenceExchange || nonEmptyString(referenceExchange.exchangeDirection) !== 'Output') {
    return [];
  }
  const referenceFlow = flowReferenceIdentity(referenceExchange);
  if (!referenceFlow.id) {
    return [];
  }

  const exemptions = stageFlowSelfProviderExemptions(processPayload);
  return exchanges.flatMap((exchange): ProcessStageFlowGuardIssue[] => {
    if (nonEmptyString(exchange.exchangeDirection) !== 'Input') {
      return [];
    }
    const inputFlow = flowReferenceIdentity(exchange);
    if (!inputFlow.id || inputFlow.id !== referenceFlow.id) {
      return [];
    }
    const inputExchangeInternalId = nonEmptyString(exchange['@dataSetInternalID']);
    const evidence = {
      reference_exchange_internal_id: referenceFlowInternalId,
      input_exchange_internal_id: inputExchangeInternalId,
      reference_flow_id: referenceFlow.id,
      reference_flow_version: referenceFlow.version,
      input_flow_version: inputFlow.version,
    };
    if (!referenceFlow.version || !inputFlow.version) {
      return [
        {
          severity: 'warning',
          code: 'process_same_reference_flow_input_identity_incomplete',
          message:
            'An input uses the quantitative-reference flow UUID, but one or both flow versions are missing; complete the identities before deciding whether this is a same-flow self-provider path.',
          evidence,
        },
      ];
    }
    if (inputFlow.version !== referenceFlow.version) {
      return [];
    }
    const exemption = exemptions.find(
      (candidate) =>
        candidate.inputExchangeInternalId === inputExchangeInternalId &&
        candidate.referenceFlowId === referenceFlow.id &&
        candidate.referenceFlowVersion === referenceFlow.version,
    );
    if (exemption) {
      return [
        {
          severity: 'info',
          code: 'process_same_reference_flow_input_exempted',
          message:
            'A structurally exact same-flow input is covered by a scoped, evidence-bearing closed-loop recirculation exemption.',
          evidence: {
            ...evidence,
            exemption_reason_code: exemption.reasonCode,
            exemption_source_evidence: exemption.sourceEvidence,
            exemption_modeling_justification: exemption.modelingJustification,
            exemption_review_decision_id: exemption.reviewDecisionId,
          },
        },
      ];
    }
    return [
      {
        severity: 'blocker',
        code: 'process_same_reference_flow_input',
        message:
          'The process consumes the exact UUID and version of its quantitative-reference output flow, creating an unsupported same-flow self-provider path.',
        evidence: {
          ...evidence,
          required_action:
            'Reference the evidence-backed predecessor flow, create a distinct intermediate flow, collapse the unsupported stage, or add a reviewed structured closed-loop exemption.',
        },
      },
    ];
  });
}
