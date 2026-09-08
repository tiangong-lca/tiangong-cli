import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDatasetMaintenanceSnapshotCompleteness } from './dataset-maintenance-pagination.js';
import {
  OVERVIEW_TABLES,
  normalizeOverviewRecord,
  object,
  overviewError,
  parseOverviewRow,
  type OverviewRecord,
} from './dataset-overview-records.js';

export function overviewHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function readOverviewJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return overviewError(`Cannot read overview JSON: ${file}`);
  }
}

export function writeOverviewArtifacts(
  outDir: string,
  files: Record<string, string>,
): Record<string, string> {
  if (!outDir.trim()) overviewError('A fresh --out-dir is required.');
  const root = path.resolve(outDir);
  try {
    mkdirSync(path.dirname(root), { recursive: true });
    mkdirSync(root, { mode: 0o700 });
  } catch {
    return overviewError('Cannot reserve a fresh overview output directory.');
  }
  const artifacts: Record<string, string> = {};
  try {
    for (const [name, bytes] of Object.entries(files)) {
      const file = path.join(root, name);
      writeFileSync(file, bytes, { mode: 0o600, flag: 'wx' });
      artifacts[name] = file;
    }
  } catch {
    rmSync(root, { recursive: true, force: true });
    return overviewError('Cannot write the overview artifact set.');
  }
  return artifacts;
}

export function readOverviewInventory(directory: string): {
  records: OverviewRecord[];
  capture: Record<string, unknown>;
  sha256: string;
} {
  const capture = object(readOverviewJson(path.join(directory, 'capture.json')));
  if (
    capture.schema_version !== 'tiangong-lca.overview-capture.v1' ||
    capture.visibility !== 'public_state_100_all_owners' ||
    !isDatasetMaintenanceSnapshotCompleteness(capture.completeness, OVERVIEW_TABLES)
  ) {
    overviewError(
      'Overview requires a complete public capture produced by dataset overview capture.',
    );
  }
  const records = OVERVIEW_TABLES.flatMap((table) => {
    const bytes = readFileSync(path.join(directory, `${table}.jsonl`), 'utf8');
    if (overviewHash(bytes) !== object(capture.sha256)[table])
      overviewError(`Capture hash mismatch: ${table}`);
    const rows = bytes
      .split('\n')
      .filter(Boolean)
      .map((line) => normalizeOverviewRecord(table, parseOverviewRow(JSON.parse(line))));
    if (rows.length !== object(object(capture.completeness).entity_counts)[table])
      overviewError(`Capture count mismatch: ${table}`);
    return rows;
  });
  return { records, capture, sha256: overviewHash(JSON.stringify(capture)) };
}

export function overviewCsv(rows: unknown[][]): string {
  return (
    rows
      .map((row) =>
        row
          .map((value) => {
            const text = String(value);
            const safe = /^[\s]*[=+@-]|^[\t\r]/u.test(text) ? `'${text}` : text;
            return `"${safe.replace(/"/gu, '""')}"`;
          })
          .join(','),
      )
      .join('\r\n') + '\r\n'
  );
}
