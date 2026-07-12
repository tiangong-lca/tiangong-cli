import { FlowPropertySchema, UnitGroupSchema } from '@tiangong-lca/tidas-sdk';
import { collectRemoteReferences } from './dataset-remote-verify.js';
import type { DatasetMaintenancePublishTable, JsonObject } from './dataset-maintenance-contract.js';
import type { SafeParseResult, SafeParseSchema } from './tidas-sdk-validation.js';

export type DatasetMaintenancePublishSchemas = Partial<
  Record<DatasetMaintenancePublishTable, SafeParseSchema>
>;

const DEFAULT_PUBLISH_SCHEMAS: Record<DatasetMaintenancePublishTable, SafeParseSchema> = {
  unitgroups: UnitGroupSchema as unknown as SafeParseSchema,
  flowproperties: FlowPropertySchema as unknown as SafeParseSchema,
};

export function maintenancePublishPayloadIdentity(payload: JsonObject): {
  id: string | null;
  version: string | null;
} {
  const root = collectRemoteReferences([{ json_ordered: payload }]).find(
    (reference) => reference.role === 'root',
  );
  return { id: root?.id ?? null, version: root?.version ?? null };
}

export function inspectMaintenancePublishPayload(options: {
  table: DatasetMaintenancePublishTable;
  payload: JsonObject;
  schemas?: DatasetMaintenancePublishSchemas;
}): {
  identity: { id: string | null; version: string | null };
  schemaResult: SafeParseResult;
} {
  const schema = options.schemas?.[options.table] ?? DEFAULT_PUBLISH_SCHEMAS[options.table];
  return {
    identity: maintenancePublishPayloadIdentity(options.payload),
    schemaResult: schema.safeParse(options.payload),
  };
}
