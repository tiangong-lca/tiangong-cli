import { createHash } from 'node:crypto';
import path from 'node:path';
import { writeJsonArtifact, writeJsonLinesArtifact } from './artifacts.js';
import { CliError } from './errors.js';
import {
  cloneJson,
  isRecord,
  materializeDatasetRows,
  readDatasetRowsInput,
  trimToken,
  type DatasetKind,
  type JsonObject,
} from './dataset-local.js';
import {
  runDatasetValidate,
  type DatasetValidateReport,
  type RunDatasetValidateOptions,
} from './dataset-validate.js';
import { runFlowQa, type FlowQaReport, type RunFlowQaOptions } from './flow-qa.js';
import { runProcessQa, type ProcessQaReport, type RunProcessQaOptions } from './process-qa.js';

type BilingualDatasetType = 'auto' | DatasetKind;
type BilingualStatus = 'completed' | 'blocked';
type ScanSeverity = 'warning' | 'blocker';

export type BilingualTranslationUnit = {
  schema_version: 1;
  unit_id: string;
  row_index: number;
  dataset_type: DatasetKind | null;
  dataset_id: string | null;
  dataset_version: string | null;
  field_path: string;
  source_lang: string;
  target_lang: string;
  source_text: string;
  current_target_text: string | null;
  context: {
    root_field: string | null;
    sibling_keys: string[];
  };
};

export type DatasetBilingualExtractReport = {
  schema_version: 1;
  generated_at_utc: string;
  input_path: string;
  requested_type: BilingualDatasetType;
  source_lang: string;
  target_lang: string;
  unit_count: number;
  row_count: number;
  files: {
    translation_units: string | null;
    report: string | null;
  };
};

export type TranslationEvidenceEntry = {
  unit_id: string;
  row_index: number;
  dataset_type: DatasetKind | null;
  dataset_id: string | null;
  dataset_version: string | null;
  field_path: string;
  source_lang: string;
  target_lang: string;
  source_text: string;
  translated_text: string;
  basis: string | null;
  review_status: string | null;
  reviewer: string | null;
};

export type DatasetBilingualApplyReport = {
  schema_version: 1;
  generated_at_utc: string;
  input_path: string;
  translations_path: string;
  out_path: string;
  target_lang: string;
  status: BilingualStatus;
  row_count: number;
  translation_count: number;
  applied_count: number;
  skipped_count: number;
  blockers: Array<{ code: string; message: string; unit_id?: string }>;
  files: {
    translated_rows: string;
    translation_evidence: string | null;
    report: string | null;
  };
};

export type BilingualScanFinding = {
  code: string;
  severity: ScanSeverity;
  row_index: number;
  dataset_type: DatasetKind | null;
  dataset_id: string | null;
  dataset_version: string | null;
  field_path: string;
  lang: string | null;
  message: string;
  text_preview: string;
};

export type DatasetBilingualValidateReport = {
  schema_version: 1;
  generated_at_utc: string;
  input_path: string;
  requested_type: BilingualDatasetType;
  status: BilingualStatus;
  row_count: number;
  scan: {
    finding_count: number;
    blocker_count: number;
    warning_count: number;
    findings: BilingualScanFinding[];
  };
  schema_gate: {
    status: DatasetValidateReport['status'];
    valid: number;
    invalid: number;
    report_file: string | null;
  };
  qa_gate: {
    status: 'completed' | 'not_run';
    process_report_file: string | null;
    flow_report_file: string | null;
  };
  files: {
    report: string | null;
    findings: string | null;
  };
};

export type RunDatasetBilingualExtractOptions = {
  inputPath: string;
  type?: string | null;
  outDir?: string | null;
  sourceLang?: string | null;
  targetLang?: string | null;
  rawInput?: unknown;
  now?: Date;
};

export type RunDatasetBilingualApplyOptions = {
  inputPath: string;
  translationsPath: string;
  outPath: string;
  outDir?: string | null;
  targetLang?: string | null;
  rawInput?: unknown;
  rawTranslations?: unknown;
  now?: Date;
};

export type RunDatasetBilingualValidateOptions = {
  inputPath: string;
  type?: string | null;
  outDir?: string | null;
  rawInput?: unknown;
  now?: Date;
  datasetValidateImpl?: (options: RunDatasetValidateOptions) => Promise<DatasetValidateReport>;
  processQaImpl?: (options: RunProcessQaOptions) => Promise<ProcessQaReport>;
  flowQaImpl?: (options: RunFlowQaOptions) => Promise<FlowQaReport>;
  schemas?: RunDatasetValidateOptions['schemas'];
};

type LangRecord = JsonObject & {
  '#text'?: unknown;
  '@xml:lang'?: unknown;
};

type TranslationInput = {
  unit_id: string | null;
  row_index: number | null;
  field_path: string | null;
  source_lang: string | null;
  target_lang: string | null;
  source_text: string | null;
  translated_text: string | null;
  basis: string | null;
  review_status: string | null;
  reviewer: string | null;
};

type ApplyTranslationResult =
  | { applied: true; evidence: TranslationEvidenceEntry }
  | { applied: false; blocker: string };

type PathVisit = {
  rowIndex: number;
  row: JsonObject;
  kind: DatasetKind | null;
  id: string | null;
  version: string | null;
};

const DEFAULT_SOURCE_LANG = 'en';
const DEFAULT_TARGET_LANG = 'zh';
const PLACEHOLDER_RE = /\b(?:TODO|TBD|FIXME|REPLACE_ME)\b|待补充|占位/u;
const CJK_RE = /[\u3400-\u9fff]/u;
const LATIN_WORD_RE = /[A-Za-z]{3,}/gu;
const CJK_PLURAL_SUFFIX_RE = /[\u3400-\u9fff]+s\b/u;

function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

function normalizeType(value: string | null | undefined): BilingualDatasetType {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'auto') {
    return 'auto';
  }
  if (normalized === 'flow' || normalized === 'flows') {
    return 'flow';
  }
  if (normalized === 'process' || normalized === 'processes') {
    return 'process';
  }
  if (
    normalized === 'lifecyclemodel' ||
    normalized === 'lifecyclemodels' ||
    normalized === 'model' ||
    normalized === 'models'
  ) {
    return 'lifecyclemodel';
  }
  throw new CliError('Expected --type to be auto, flow, process, or lifecyclemodel.', {
    code: 'DATASET_BILINGUAL_TYPE_INVALID',
    exitCode: 2,
    details: value,
  });
}

function normalizeLang(value: string | null | undefined, fallback: string): string {
  const normalized = value?.trim().toLowerCase();
  return normalized || fallback;
}

function pointerEscape(segment: string): string {
  return segment.replace(/~/gu, '~0').replace(/\//gu, '~1');
}

function pointerUnescape(segment: string): string {
  return segment.replace(/~1/gu, '/').replace(/~0/gu, '~');
}

function pointerFromSegments(segments: string[]): string {
  return `/${segments.map(pointerEscape).join('/')}`;
}

function segmentsFromPointer(pointer: string): string[] {
  if (!pointer.startsWith('/')) {
    throw new CliError(`Expected JSON pointer field_path, got: ${pointer}`, {
      code: 'DATASET_BILINGUAL_FIELD_PATH_INVALID',
      exitCode: 2,
    });
  }
  return pointer.slice(1).split('/').map(pointerUnescape);
}

function textPreview(value: string): string {
  return value.length > 180 ? `${value.slice(0, 177)}...` : value;
}

function langOf(value: unknown): string | null {
  return trimToken(isRecord(value) ? value['@xml:lang'] : null)?.toLowerCase() ?? null;
}

function textOf(value: unknown): string | null {
  return trimToken(isRecord(value) ? value['#text'] : null);
}

function isLangRecord(value: unknown): value is LangRecord {
  return isRecord(value) && (typeof value['@xml:lang'] === 'string' || '#text' in value);
}

function isLangRecordArray(value: unknown): value is LangRecord[] {
  return Array.isArray(value) && value.some((item) => isLangRecord(item));
}

function hashUnit(parts: unknown[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(String(part ?? ''));
    hash.update('\n');
  }
  return hash.digest('hex').slice(0, 24);
}

function filterRowsByType(
  rows: ReturnType<typeof materializeDatasetRows>,
  requestedType: BilingualDatasetType,
): ReturnType<typeof materializeDatasetRows> {
  if (requestedType === 'auto') {
    return rows;
  }
  return rows.filter((row) => row.kind === requestedType);
}

function rootFieldFromPath(pathSegments: string[]): string | null {
  return pathSegments.find((segment) => !/^\d+$/u.test(segment)) ?? null;
}

function siblingKeys(parent: unknown): string[] {
  if (!isRecord(parent)) {
    return [];
  }
  return Object.keys(parent).sort().slice(0, 20);
}

function collectTranslationUnitsFromNode(
  node: unknown,
  pathSegments: string[],
  parent: unknown,
  visit: PathVisit,
  sourceLang: string,
  targetLang: string,
  units: BilingualTranslationUnit[],
): void {
  if (isLangRecordArray(node)) {
    const source = node.find((item) => langOf(item) === sourceLang);
    const target = node.find((item) => langOf(item) === targetLang);
    const sourceText = textOf(source);
    if (sourceText) {
      const fieldPath = pointerFromSegments(pathSegments);
      units.push({
        schema_version: 1,
        unit_id: hashUnit([
          visit.rowIndex,
          visit.id,
          visit.version,
          fieldPath,
          sourceLang,
          targetLang,
          sourceText,
        ]),
        row_index: visit.rowIndex,
        dataset_type: visit.kind,
        dataset_id: visit.id,
        dataset_version: visit.version,
        field_path: fieldPath,
        source_lang: sourceLang,
        target_lang: targetLang,
        source_text: sourceText,
        current_target_text: textOf(target),
        context: {
          root_field: rootFieldFromPath(pathSegments),
          sibling_keys: siblingKeys(parent),
        },
      });
    }
    return;
  }

  if (Array.isArray(node)) {
    node.forEach((item, index) =>
      collectTranslationUnitsFromNode(
        item,
        [...pathSegments, String(index)],
        node,
        visit,
        sourceLang,
        targetLang,
        units,
      ),
    );
    return;
  }

  if (isRecord(node)) {
    for (const [key, value] of Object.entries(node)) {
      collectTranslationUnitsFromNode(
        value,
        [...pathSegments, key],
        node,
        visit,
        sourceLang,
        targetLang,
        units,
      );
    }
  }
}

function collectTranslationUnits(
  rows: ReturnType<typeof materializeDatasetRows>,
  sourceLang: string,
  targetLang: string,
): BilingualTranslationUnit[] {
  const units: BilingualTranslationUnit[] = [];
  for (const row of rows) {
    collectTranslationUnitsFromNode(
      row.row,
      [],
      null,
      {
        rowIndex: row.index,
        row: row.row,
        kind: row.kind,
        id: row.id,
        version: row.version,
      },
      sourceLang,
      targetLang,
      units,
    );
  }
  return units;
}

function outFiles(outDir: string | null | undefined): DatasetBilingualExtractReport['files'] {
  if (!outDir) {
    return {
      translation_units: null,
      report: null,
    };
  }
  const resolved = path.resolve(outDir);
  return {
    translation_units: path.join(resolved, 'outputs', 'trans-units.jsonl'),
    report: path.join(resolved, 'outputs', 'extract-report.json'),
  };
}

function readTranslationInputs(inputPath: string, rawInput?: unknown): TranslationInput[] {
  return readDatasetRowsInput(inputPath, rawInput).map((row) => {
    const translatedText =
      trimToken(row.translated_text) ??
      trimToken(row.translatedText) ??
      trimToken(row.translation) ??
      trimToken(row.target_text) ??
      trimToken(row.targetText);
    return {
      unit_id: trimToken(row.unit_id) ?? trimToken(row.unitId),
      row_index:
        typeof row.row_index === 'number'
          ? row.row_index
          : typeof row.rowIndex === 'number'
            ? row.rowIndex
            : null,
      field_path: trimToken(row.field_path) ?? trimToken(row.fieldPath),
      source_lang: trimToken(row.source_lang) ?? trimToken(row.sourceLang),
      target_lang: trimToken(row.target_lang) ?? trimToken(row.targetLang),
      source_text: trimToken(row.source_text) ?? trimToken(row.sourceText),
      translated_text: translatedText,
      basis: trimToken(row.basis) ?? trimToken(row.rationale),
      review_status: trimToken(row.review_status) ?? trimToken(row.reviewStatus),
      reviewer: trimToken(row.reviewer),
    };
  });
}

function resolvePointer(root: unknown, pointer: string): unknown {
  let current = root;
  for (const segment of segmentsFromPointer(pointer)) {
    if (Array.isArray(current)) {
      current = current[Number(segment)];
    } else if (isRecord(current)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function cloneSourceLangRecord(container: LangRecord[], sourceLang: string): LangRecord {
  const source = container.find((item) => langOf(item) === sourceLang);
  const cloned = isRecord(source) ? cloneJson(source) : {};
  cloned['@xml:lang'] = '';
  cloned['#text'] = '';
  return cloned;
}

function applyTranslationToRows(options: {
  rows: JsonObject[];
  translation: TranslationInput;
  targetLang: string;
}): ApplyTranslationResult {
  const translation = options.translation;
  if (translation.row_index === null || translation.row_index < 0) {
    return { applied: false, blocker: 'Translation is missing row_index.' };
  }
  if (!translation.field_path) {
    return { applied: false, blocker: 'Translation is missing field_path.' };
  }
  if (!translation.translated_text) {
    return { applied: false, blocker: 'Translation is missing translated_text.' };
  }

  const row = options.rows[translation.row_index];
  if (!row) {
    return { applied: false, blocker: `No input row exists at index ${translation.row_index}.` };
  }

  const container = resolvePointer(row, translation.field_path);
  if (!Array.isArray(container)) {
    return { applied: false, blocker: `field_path does not point to a language array.` };
  }

  let target = container.find((item) => isRecord(item) && langOf(item) === options.targetLang);
  if (!target) {
    target = cloneSourceLangRecord(container as LangRecord[], translation.source_lang ?? 'en');
    container.push(target);
  }
  target['@xml:lang'] = options.targetLang;
  target['#text'] = translation.translated_text;

  const materializedRows = materializeDatasetRows('memory', { rows: [row] });
  const materialized = materializedRows[0];
  return {
    applied: true,
    evidence: {
      unit_id:
        translation.unit_id ??
        hashUnit([
          translation.row_index,
          translation.field_path,
          translation.source_lang,
          options.targetLang,
          translation.source_text,
        ]),
      row_index: translation.row_index,
      dataset_type: materialized?.kind ?? null,
      dataset_id: materialized?.id ?? null,
      dataset_version: materialized?.version ?? null,
      field_path: translation.field_path,
      source_lang: translation.source_lang ?? 'en',
      target_lang: options.targetLang,
      source_text: translation.source_text ?? '',
      translated_text: translation.translated_text,
      basis: translation.basis,
      review_status: translation.review_status,
      reviewer: translation.reviewer,
    },
  };
}

function writeRowsJsonl(filePath: string, rows: JsonObject[]): string {
  return writeJsonLinesArtifact(filePath, rows);
}

function scanText(node: unknown, pathSegments: string[], visit: PathVisit): BilingualScanFinding[] {
  const findings: BilingualScanFinding[] = [];

  if (isLangRecord(node)) {
    const lang = langOf(node);
    const text = textOf(node);
    if (!text) {
      return findings;
    }
    const fieldPath = pointerFromSegments(pathSegments);
    const base = {
      row_index: visit.rowIndex,
      dataset_type: visit.kind,
      dataset_id: visit.id,
      dataset_version: visit.version,
      field_path: fieldPath,
      lang,
      text_preview: textPreview(text),
    };
    if (PLACEHOLDER_RE.test(text)) {
      findings.push({
        ...base,
        code: 'placeholder_text',
        severity: 'blocker',
        message: 'Text contains placeholder markers.',
      });
    }
    if (lang === 'en' && CJK_RE.test(text)) {
      findings.push({
        ...base,
        code: 'english_contains_cjk',
        severity: 'blocker',
        message: 'English text contains CJK characters.',
      });
    }
    if (lang === 'zh' && CJK_PLURAL_SUFFIX_RE.test(text)) {
      findings.push({
        ...base,
        code: 'mechanical_plural_suffix',
        severity: 'blocker',
        message: 'Chinese text contains mechanical mixed-language plural suffixes.',
      });
    }
    if (lang === 'zh') {
      const latinWords = text.match(LATIN_WORD_RE) ?? [];
      if (latinWords.length >= 8) {
        findings.push({
          ...base,
          code: 'zh_latin_word_density',
          severity: 'warning',
          message:
            'Chinese text contains many Latin words; review for machine-translation residue.',
        });
      }
    }
    return findings;
  }

  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      findings.push(...scanText(item, [...pathSegments, String(index)], visit));
    });
    return findings;
  }

  if (isRecord(node)) {
    for (const [key, value] of Object.entries(node)) {
      findings.push(...scanText(value, [...pathSegments, key], visit));
    }
  }

  return findings;
}

function scanRows(rows: ReturnType<typeof materializeDatasetRows>): BilingualScanFinding[] {
  return rows.flatMap((row) =>
    scanText(row.row, [], {
      rowIndex: row.index,
      row: row.row,
      kind: row.kind,
      id: row.id,
      version: row.version,
    }),
  );
}

function validateFiles(outDir: string | null | undefined): DatasetBilingualValidateReport['files'] {
  if (!outDir) {
    return {
      report: null,
      findings: null,
    };
  }
  const resolved = path.resolve(outDir);
  return {
    report: path.join(resolved, 'outputs', 'bilingual-validate-report.json'),
    findings: path.join(resolved, 'outputs', 'bilingual-findings.jsonl'),
  };
}

export async function runDatasetBilingualExtract(
  options: RunDatasetBilingualExtractOptions,
): Promise<DatasetBilingualExtractReport> {
  const requestedType = normalizeType(options.type);
  const sourceLang = normalizeLang(options.sourceLang, DEFAULT_SOURCE_LANG);
  const targetLang = normalizeLang(options.targetLang, DEFAULT_TARGET_LANG);
  const rows = filterRowsByType(
    materializeDatasetRows(options.inputPath, options.rawInput),
    requestedType,
  );
  const units = collectTranslationUnits(rows, sourceLang, targetLang);
  const files = outFiles(options.outDir);
  const report: DatasetBilingualExtractReport = {
    schema_version: 1,
    generated_at_utc: nowIso(options.now),
    input_path: options.inputPath,
    requested_type: requestedType,
    source_lang: sourceLang,
    target_lang: targetLang,
    unit_count: units.length,
    row_count: rows.length,
    files,
  };

  if (files.translation_units) {
    writeJsonLinesArtifact(files.translation_units, units);
  }
  if (files.report) {
    writeJsonArtifact(files.report, report);
  }
  return report;
}

export async function runDatasetBilingualApply(
  options: RunDatasetBilingualApplyOptions,
): Promise<DatasetBilingualApplyReport> {
  const targetLang = normalizeLang(options.targetLang, DEFAULT_TARGET_LANG);
  if (!options.outPath) {
    throw new CliError('Missing required --out value.', {
      code: 'DATASET_BILINGUAL_OUT_REQUIRED',
      exitCode: 2,
    });
  }
  if (!options.translationsPath) {
    throw new CliError('Missing required --translations value.', {
      code: 'DATASET_BILINGUAL_TRANSLATIONS_REQUIRED',
      exitCode: 2,
    });
  }

  const rows = readDatasetRowsInput(options.inputPath, options.rawInput).map((row) =>
    cloneJson(row),
  );
  const translations = readTranslationInputs(options.translationsPath, options.rawTranslations);
  const blockers: DatasetBilingualApplyReport['blockers'] = [];
  const evidence: TranslationEvidenceEntry[] = [];
  let appliedCount = 0;
  let skippedCount = 0;

  for (const translation of translations) {
    const result = applyTranslationToRows({ rows, translation, targetLang });
    if (result.applied) {
      appliedCount += 1;
      evidence.push(result.evidence);
    } else {
      skippedCount += 1;
      blockers.push({
        code: 'translation_not_applied',
        message: result.blocker,
        unit_id: translation.unit_id ?? undefined,
      });
    }
  }

  const resolvedOut = path.resolve(options.outPath);
  const resolvedOutDir = options.outDir ? path.resolve(options.outDir) : path.dirname(resolvedOut);
  const evidenceFile = path.join(resolvedOutDir, 'outputs', 'translation-evidence.json');
  const reportFile = path.join(resolvedOutDir, 'outputs', 'bilingual-apply-report.json');
  writeRowsJsonl(resolvedOut, rows);
  writeJsonArtifact(evidenceFile, {
    schema_version: 1,
    generated_at_utc: nowIso(options.now),
    entries: evidence,
  });

  const report: DatasetBilingualApplyReport = {
    schema_version: 1,
    generated_at_utc: nowIso(options.now),
    input_path: options.inputPath,
    translations_path: options.translationsPath,
    out_path: resolvedOut,
    target_lang: targetLang,
    status: blockers.length > 0 ? 'blocked' : 'completed',
    row_count: rows.length,
    translation_count: translations.length,
    applied_count: appliedCount,
    skipped_count: skippedCount,
    blockers,
    files: {
      translated_rows: resolvedOut,
      translation_evidence: evidenceFile,
      report: reportFile,
    },
  };
  writeJsonArtifact(reportFile, report);
  return report;
}

export async function runDatasetBilingualValidate(
  options: RunDatasetBilingualValidateOptions,
): Promise<DatasetBilingualValidateReport> {
  const requestedType = normalizeType(options.type);
  const rows = filterRowsByType(
    materializeDatasetRows(options.inputPath, options.rawInput),
    requestedType,
  );
  const findings = scanRows(rows);
  const files = validateFiles(options.outDir);
  const datasetValidateImpl = options.datasetValidateImpl ?? runDatasetValidate;
  const schemaGateOutDir = options.outDir
    ? path.join(path.resolve(options.outDir), 'schema')
    : null;
  const schemaReport = await datasetValidateImpl({
    inputPath: options.inputPath,
    type: requestedType,
    outDir: schemaGateOutDir,
    rawInput: { rows: rows.map((row) => row.row) },
    now: options.now,
    schemas: options.schemas,
  });

  let processReport: ProcessQaReport | null = null;
  let flowReport: FlowQaReport | null = null;
  if (options.outDir && (requestedType === 'process' || requestedType === 'auto')) {
    const processRows = rows.filter((row) => row.kind === 'process').map((row) => row.row);
    if (processRows.length > 0) {
      const processRowsFile = path.join(path.resolve(options.outDir), 'qa-input-processes.jsonl');
      writeJsonLinesArtifact(processRowsFile, processRows);
      processReport = await (options.processQaImpl ?? runProcessQa)({
        rowsFile: processRowsFile,
        outDir: path.join(path.resolve(options.outDir), 'qa', 'process'),
        now: () => options.now ?? new Date(),
      });
    }
  }
  if (options.outDir && (requestedType === 'flow' || requestedType === 'auto')) {
    const flowRows = rows.filter((row) => row.kind === 'flow').map((row) => row.row);
    if (flowRows.length > 0) {
      const flowRowsFile = path.join(path.resolve(options.outDir), 'qa-input-flows.jsonl');
      writeJsonLinesArtifact(flowRowsFile, flowRows);
      flowReport = await (options.flowQaImpl ?? runFlowQa)({
        rowsFile: flowRowsFile,
        outDir: path.join(path.resolve(options.outDir), 'qa', 'flow'),
        now: () => options.now ?? new Date(),
      });
    }
  }

  const blockerCount = findings.filter((finding) => finding.severity === 'blocker').length;
  const warningCount = findings.filter((finding) => finding.severity === 'warning').length;
  const report: DatasetBilingualValidateReport = {
    schema_version: 1,
    generated_at_utc: nowIso(options.now),
    input_path: options.inputPath,
    requested_type: requestedType,
    status: blockerCount > 0 || schemaReport.counts.invalid > 0 ? 'blocked' : 'completed',
    row_count: rows.length,
    scan: {
      finding_count: findings.length,
      blocker_count: blockerCount,
      warning_count: warningCount,
      findings,
    },
    schema_gate: {
      status: schemaReport.status,
      valid: schemaReport.counts.valid,
      invalid: schemaReport.counts.invalid,
      report_file: schemaReport.files.report,
    },
    qa_gate: {
      status: processReport || flowReport ? 'completed' : 'not_run',
      process_report_file: processReport?.files.report ?? null,
      flow_report_file: flowReport?.files.report ?? null,
    },
    files,
  };

  if (files.findings) {
    writeJsonLinesArtifact(files.findings, findings);
  }
  if (files.report) {
    writeJsonArtifact(files.report, report);
  }
  return report;
}

export const __testInternals = {
  collectTranslationUnits,
  normalizeType,
  pointerFromSegments,
  segmentsFromPointer,
  scanRows,
};
