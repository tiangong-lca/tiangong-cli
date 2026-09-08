import { parseArgs } from 'node:util';
import { captureOverview, type OverviewCaptureOptions } from './dataset-overview-capture.js';
import {
  analyzeOverview,
  overviewCatalog,
  parseOverviewScope,
} from './dataset-overview-analysis.js';
import {
  overviewCsv,
  readOverviewInventory,
  readOverviewJson,
  writeOverviewArtifacts,
} from './dataset-overview-io.js';
import { overviewError } from './dataset-overview-records.js';
import { renderOverviewArtifacts } from './dataset-overview-render.js';

const HELP = `Usage: tiangong-lca dataset overview <describe|capture|catalog|analyze> [options]
  describe  Print the versioned capability and scope contract (offline)
  capture   --out-dir <fresh-dir> [--page-size <1..5000>] [--max-rows <1..1000000>] [--max-bytes <1..1073741824>]
            Read all owners' public state_code=100 Process, Flow and Model rows.
  catalog   --inventory <capture-dir> --scope <scope.json> --out-dir <fresh-dir>
            Discover latest-public candidates by descriptive metadata, without assigning core membership.
  analyze   --inventory <capture-dir> --scope <scope.json> --out-dir <fresh-dir>
            Use explicit core membership; export current statistics, relations, Markdown, HTML and CSV.
  --json    Emit JSON (all results are structured JSON); --help / -h print this help.
No owner/state overrides, remote writes, report input, governance or future outlook.`;

export async function runDatasetOverview(
  args: string[],
  options: Pick<OverviewCaptureOptions, 'env' | 'fetchImpl'> & {
    captureImpl?: typeof captureOverview;
  },
): Promise<unknown> {
  const action = args[0];
  if (!action || action === '--help' || action === '-h') return { help: HELP };
  if (!['describe', 'capture', 'catalog', 'analyze'].includes(action))
    overviewError('Unknown dataset overview action.');
  const { values } = parseArgs({
    args: args.slice(1),
    strict: true,
    allowPositionals: false,
    options: {
      'out-dir': { type: 'string' },
      inventory: { type: 'string' },
      scope: { type: 'string' },
      'page-size': { type: 'string' },
      'max-rows': { type: 'string' },
      'max-bytes': { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) return { help: HELP };
  const allowed =
    action === 'capture'
      ? ['out-dir', 'page-size', 'max-rows', 'max-bytes']
      : action === 'describe'
        ? []
        : ['out-dir', 'inventory', 'scope'];
  if (Object.keys(values).some((key) => !['help', 'json', ...allowed].includes(key)))
    overviewError('Option is not supported for this overview action.');
  if (action === 'describe')
    return {
      schema_version: 'tiangong-lca.overview-capabilities.v1',
      actions: ['capture', 'catalog', 'analyze'],
      capture_schema: 'tiangong-lca.overview-capture.v1',
      analysis_schema: 'tiangong-lca.topic-overview.v1',
      visibility: 'public_state_100_all_owners',
      remote_write_mode: 'read-only',
      scope_example: {
        schema_version: 1,
        topic: '电力行业',
        boundary: '发电与输配电数据；仅使用电力的其他行业过程归为关联数据。',
        terms: ['电力', 'electricity', 'power generation'],
        core: [
          { table: 'processes', id: '<public UUID>', reason: '<metadata-backed inclusion reason>' },
        ],
      },
    };
  if (action === 'capture')
    return (options.captureImpl ?? captureOverview)({
      env: options.env,
      fetchImpl: options.fetchImpl,
      outDir: values['out-dir'] ?? '',
      pageSize: values['page-size'] === undefined ? undefined : Number(values['page-size']),
      maxRows: values['max-rows'] === undefined ? undefined : Number(values['max-rows']),
      maxBytes: values['max-bytes'] === undefined ? undefined : Number(values['max-bytes']),
    });
  if (!values.inventory?.trim() || !values.scope?.trim() || !values['out-dir']?.trim())
    overviewError('Catalog and analyze require --inventory, --scope and a fresh --out-dir.');
  const inventory = readOverviewInventory(values.inventory);
  const scope = parseOverviewScope(readOverviewJson(values.scope));
  if (action === 'catalog') {
    const catalog = {
      ...overviewCatalog(inventory.records, scope),
      capture_sha256: inventory.sha256,
    };
    const artifacts = writeOverviewArtifacts(values['out-dir'], {
      'candidates.csv': overviewCsv([
        [
          'key',
          'name',
          'classifications',
          'dataset_type',
          'location',
          'reference_year',
          'matched_terms',
        ],
        ...catalog.candidates.map((record) => [
          record.key,
          record.name,
          record.classifications.join(' | '),
          record.dataset_type,
          record.location,
          record.reference_year,
          record.matched_terms.join(' | '),
        ]),
      ]),
      'catalog.json': JSON.stringify(catalog, null, 2) + '\n',
    });
    return {
      schema_version: catalog.schema_version,
      public_objects: catalog.public_objects,
      candidates: catalog.candidates.length,
      capture_sha256: inventory.sha256,
      artifacts,
    };
  }
  const report = {
    ...analyzeOverview(inventory.records, scope),
    capture: inventory.capture,
    capture_sha256: inventory.sha256,
  };
  const artifacts = writeOverviewArtifacts(values['out-dir'], renderOverviewArtifacts(report));
  return {
    schema_version: report.schema_version,
    topic: scope.topic,
    core_counts: report.core_counts,
    artifacts,
  };
}
