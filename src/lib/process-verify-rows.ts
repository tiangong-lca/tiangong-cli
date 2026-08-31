import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writeJsonArtifact, writeJsonLinesArtifact } from './artifacts.js';
import { CliError } from './errors.js';
import {
  validateProcessPayload,
  type ProcessPayloadValidationResult,
} from './process-payload-validation.js';

type JsonObject = Record<string, unknown>;

type NameFieldKey =
  'baseName' | 'treatmentStandardsRoutes' | 'mixAndLocationTypes' | 'functionalUnitFlowProperties';

export type ProcessVerifyNameFieldSummary = {
  present: boolean;
  en: string;
  zh: string;
  any: string;
};

export type ProcessVerifyRowRecord = {
  row_index: number;
  id: string | null;
  version: string | null;
  status: 'ok' | 'invalid';
  validation: ProcessPayloadValidationResult;
  name_summary: {
    missing_required_fields: Array<'baseName' | 'treatmentStandardsRoutes' | 'mixAndLocationTypes'>;
    fields: Record<NameFieldKey, ProcessVerifyNameFieldSummary>;
  };
};

export type ProcessVerifyRowsReport = {
  schema_version: 1;
  generated_at_utc: string;
  status: 'completed_process_row_verification' | 'completed_with_invalid_process_rows';
  rows_file: string;
  out_dir: string;
  row_count: number;
  invalid_count: number;
  schema_invalid_count: number;
  missing_required_name_field_count: number;
  invalid_rows: Array<{
    id: string | null;
    version: string | null;
    row_index: number;
    missing_required_fields: Array<'baseName' | 'treatmentStandardsRoutes' | 'mixAndLocationTypes'>;
    schema_issue_count: number;
  }>;
  files: {
    summary_json: string;
    verification_jsonl: string;
  };
};

export type RunProcessVerifyRowsOptions = {
  rowsFile: string;
  outDir: string;
  now?: Date;
  validateProcessPayloadImpl?: (payload: JsonObject) => ProcessPayloadValidationResult;
};

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requiredNonEmpty(value: string, label: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new CliError(`Missing required ${label}.`, {
      code,
      exitCode: 2,
    });
  }
  return normalized;
}

function readRowsFile(filePath: string): unknown[] {
  if (!existsSync(filePath)) {
    throw new CliError(`Rows file not found: ${filePath}`, {
      code: 'PROCESS_VERIFY_ROWS_FILE_NOT_FOUND',
      exitCode: 2,
    });
  }

  const text = readFileSync(filePath, 'utf8');
  if (filePath.toLowerCase().endsWith('.jsonl')) {
    return text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        try {
          return JSON.parse(line) as unknown;
        } catch (error) {
          throw new CliError(`Rows file contains invalid JSONL at line ${index + 1}: ${filePath}`, {
            code: 'PROCESS_VERIFY_ROWS_FILE_INVALID_JSONL',
            exitCode: 2,
            details: String(error),
          });
        }
      });
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (isRecord(parsed) && Array.isArray(parsed.rows)) {
      return parsed.rows;
    }
    return [parsed];
  } catch (error) {
    throw new CliError(`Rows file is not valid JSON: ${filePath}`, {
      code: 'PROCESS_VERIFY_ROWS_FILE_INVALID_JSON',
      exitCode: 2,
      details: String(error),
    });
  }
}

function getPayload(row: unknown): JsonObject {
  if (isRecord(row) && isRecord(row.process)) {
    return row.process;
  }
  if (isRecord(row) && isRecord(row.json_ordered)) {
    return row.json_ordered;
  }
  if (isRecord(row) && isRecord(row.json)) {
    return row.json;
  }
  if (isRecord(row)) {
    return row;
  }

  return {};
}

function firstNonEmpty(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = trimText(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function getIdentity(row: unknown, payload: JsonObject, index: number) {
  const root = isRecord(payload.processDataSet) ? payload.processDataSet : payload;
  const processInformation = isRecord(root.processInformation) ? root.processInformation : {};
  const dataSetInformation = isRecord(processInformation.dataSetInformation)
    ? processInformation.dataSetInformation
    : {};
  const administrativeInformation = isRecord(root.administrativeInformation)
    ? root.administrativeInformation
    : {};
  const publicationAndOwnership = isRecord(administrativeInformation.publicationAndOwnership)
    ? administrativeInformation.publicationAndOwnership
    : {};

  return {
    row_index: index,
    id: firstNonEmpty(
      isRecord(row) ? row.id : null,
      isRecord(row) ? row.process_id : null,
      dataSetInformation['common:UUID'],
      payload.id,
      payload['@id'],
    ),
    version: firstNonEmpty(
      isRecord(row) ? row.version : null,
      publicationAndOwnership['common:dataSetVersion'],
      payload.version,
      payload['@version'],
    ),
  };
}

function getLangList(value: unknown): JsonObject[] {
  if (value === null || value === undefined || value === '') {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is JsonObject => isRecord(entry));
  }
  if (isRecord(value)) {
    const langString = value['common:langString'];
    if (Array.isArray(langString)) {
      return langString.filter((entry): entry is JsonObject => isRecord(entry));
    }
    if (isRecord(langString)) {
      return [langString];
    }
    if (value['#text'] !== undefined || value['@xml:lang'] !== undefined) {
      return [value];
    }
  }
  if (typeof value === 'string') {
    return [{ '@xml:lang': 'en', '#text': value }];
  }
  return [];
}

function getLangText(value: unknown, lang: string | null): string {
  const entries = getLangList(value);
  if (lang) {
    for (const entry of entries) {
      if (
        trimText(entry['@xml:lang']).toLowerCase() === lang.toLowerCase() &&
        trimText(entry['#text'])
      ) {
        return trimText(entry['#text']);
      }
    }
  }
  for (const entry of entries) {
    if (trimText(entry['#text'])) {
      return trimText(entry['#text']);
    }
  }
  return '';
}

function hasOwn(objectValue: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(objectValue, key);
}

function summarizeNameFields(payload: JsonObject): {
  missing_required_fields: Array<'baseName' | 'treatmentStandardsRoutes' | 'mixAndLocationTypes'>;
  fields: Record<NameFieldKey, ProcessVerifyNameFieldSummary>;
} {
  const root = isRecord(payload.processDataSet) ? payload.processDataSet : payload;
  const processInformation = isRecord(root.processInformation) ? root.processInformation : {};
  const dataSetInformation = isRecord(processInformation.dataSetInformation)
    ? processInformation.dataSetInformation
    : {};
  const name = isRecord(dataSetInformation.name) ? dataSetInformation.name : {};

  const fieldNames: NameFieldKey[] = [
    'baseName',
    'treatmentStandardsRoutes',
    'mixAndLocationTypes',
    'functionalUnitFlowProperties',
  ];

  const fields = {} as Record<NameFieldKey, ProcessVerifyNameFieldSummary>;
  for (const fieldName of fieldNames) {
    fields[fieldName] = {
      present: hasOwn(name, fieldName),
      en: getLangText(name[fieldName], 'en'),
      zh: getLangText(name[fieldName], 'zh'),
      any: getLangText(name[fieldName], null),
    };
  }

  const missingRequired = ['baseName', 'treatmentStandardsRoutes', 'mixAndLocationTypes'].filter(
    (fieldName) => !fields[fieldName as NameFieldKey].present,
  ) as Array<'baseName' | 'treatmentStandardsRoutes' | 'mixAndLocationTypes'>;

  return {
    missing_required_fields: missingRequired,
    fields,
  };
}

function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

export async function runProcessVerifyRows(
  options: RunProcessVerifyRowsOptions,
): Promise<ProcessVerifyRowsReport> {
  const rowsFile = path.resolve(
    requiredNonEmpty(options.rowsFile, '--rows-file', 'PROCESS_VERIFY_ROWS_FILE_REQUIRED'),
  );
  const outDir = path.resolve(
    requiredNonEmpty(options.outDir, '--out-dir', 'PROCESS_VERIFY_OUT_DIR_REQUIRED'),
  );
  const validate = options.validateProcessPayloadImpl ?? validateProcessPayload;
  const rows = readRowsFile(rowsFile);
  const generatedAtUtc = nowIso(options.now);

  const records: ProcessVerifyRowRecord[] = rows.map((row, index) => {
    const payload = getPayload(row);
    const identity = getIdentity(row, payload, index);
    const validation = validate(payload);
    const nameSummary = summarizeNameFields(payload);
    return {
      ...identity,
      status: validation.ok && nameSummary.missing_required_fields.length === 0 ? 'ok' : 'invalid',
      validation,
      name_summary: nameSummary,
    };
  });

  const invalidRows = records
    .filter((record) => record.status === 'invalid')
    .map((record) => ({
      id: record.id,
      version: record.version,
      row_index: record.row_index,
      missing_required_fields: record.name_summary.missing_required_fields,
      schema_issue_count: record.validation.issue_count,
    }));
  const invalidCount = invalidRows.length;
  const summaryPath = path.join(outDir, 'outputs', 'summary.json');
  const verificationPath = path.join(outDir, 'outputs', 'verification.jsonl');

  writeJsonArtifact(summaryPath, {
    generated_at_utc: generatedAtUtc,
    rows_file: rowsFile,
    row_count: records.length,
    invalid_count: invalidCount,
    schema_invalid_count: records.filter((record) => !record.validation.ok).length,
    missing_required_name_field_count: records.filter(
      (record) => record.name_summary.missing_required_fields.length > 0,
    ).length,
    invalid_rows: invalidRows,
  });
  writeJsonLinesArtifact(verificationPath, records);

  return {
    schema_version: 1,
    generated_at_utc: generatedAtUtc,
    status:
      invalidCount > 0
        ? 'completed_with_invalid_process_rows'
        : 'completed_process_row_verification',
    rows_file: rowsFile,
    out_dir: outDir,
    row_count: records.length,
    invalid_count: invalidCount,
    schema_invalid_count: records.filter((record) => !record.validation.ok).length,
    missing_required_name_field_count: records.filter(
      (record) => record.name_summary.missing_required_fields.length > 0,
    ).length,
    invalid_rows: invalidRows,
    files: {
      summary_json: summaryPath,
      verification_jsonl: verificationPath,
    },
  };
}

export const __testInternals = {
  getIdentity,
  getLangList,
  getLangText,
  getPayload,
  readRowsFile,
  summarizeNameFields,
};
