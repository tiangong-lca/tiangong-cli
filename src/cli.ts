import { parseArgs } from 'node:util';
import { buildDoctorReport, readRuntimeEnv } from './lib/env.js';
import type { DotEnvLoadResult } from './lib/dotenv.js';
import { CliError, toErrorPayload } from './lib/errors.js';
import type { FetchLike } from './lib/http.js';
import { stringifyJson } from './lib/io.js';
import {
  runLifecyclemodelAutoBuild,
  type LifecyclemodelAutoBuildReport,
  type RunLifecyclemodelAutoBuildOptions,
} from './lib/lifecyclemodel-auto-build.js';
import {
  runLifecyclemodelBuildResultingProcess,
  type LifecyclemodelResultingProcessReport,
  type RunLifecyclemodelResultingProcessOptions,
} from './lib/lifecyclemodel-resulting-process.js';
import {
  runLifecyclemodelPublishResultingProcess,
  type LifecyclemodelPublishResultingProcessReport,
  type RunLifecyclemodelPublishResultingProcessOptions,
} from './lib/lifecyclemodel-publish-resulting-process.js';
import {
  runLifecyclemodelValidateBuild,
  type LifecyclemodelValidateBuildReport,
  type RunLifecyclemodelValidateBuildOptions,
} from './lib/lifecyclemodel-validate-build.js';
import {
  runLifecyclemodelPublishBuild,
  type LifecyclemodelPublishBuildReport,
  type RunLifecyclemodelPublishBuildOptions,
} from './lib/lifecyclemodel-publish-build.js';
import {
  runLifecyclemodelOrchestrate,
  type LifecyclemodelOrchestrateReport,
  type RunLifecyclemodelOrchestrateOptions,
} from './lib/lifecyclemodel-orchestrate.js';
import {
  runProcessAutoBuild,
  type ProcessAutoBuildReport,
  type RunProcessAutoBuildOptions,
} from './lib/process-auto-build.js';
import {
  runProcessGet,
  type ProcessGetReport,
  type RunProcessGetOptions,
} from './lib/process-get.js';
import {
  runProcessBatchBuild,
  type ProcessBatchBuildReport,
  type RunProcessBatchBuildOptions,
} from './lib/process-batch-build.js';
import {
  runProcessResumeBuild,
  type ProcessResumeBuildReport,
  type RunProcessResumeBuildOptions,
} from './lib/process-resume-build.js';
import {
  runProcessPublishBuild,
  type ProcessPublishBuildReport,
  type RunProcessPublishBuildOptions,
} from './lib/process-publish-build.js';
import { runPublish, type PublishReport, type RunPublishOptions } from './lib/publish.js';
import {
  runProcessReview,
  type ProcessReviewReport,
  type RunProcessReviewOptions,
} from './lib/review-process.js';
import {
  runFlowReview,
  type FlowReviewReport,
  type RunFlowReviewOptions,
} from './lib/review-flow.js';
import {
  runLifecyclemodelReview,
  type LifecyclemodelReviewReport,
  type RunLifecyclemodelReviewOptions,
} from './lib/review-lifecyclemodel.js';
import {
  runFlowRemediate,
  type FlowRemediationReport,
  type RunFlowRemediateOptions,
} from './lib/flow-remediate.js';
import {
  runFlowFetchRows,
  type FlowFetchRowsReport,
  type RunFlowFetchRowsOptions,
} from './lib/flow-fetch-rows.js';
import {
  runFlowMaterializeDecisions,
  type FlowMaterializeDecisionsReport,
  type RunFlowMaterializeDecisionsOptions,
} from './lib/flow-materialize-decisions.js';
import { runFlowGet, type FlowGetReport, type RunFlowGetOptions } from './lib/flow-get.js';
import { runFlowList, type FlowListReport, type RunFlowListOptions } from './lib/flow-list.js';
import {
  runFlowPublishVersion,
  type FlowPublishVersionReport,
  type RunFlowPublishVersionOptions,
} from './lib/flow-publish-version.js';
import {
  runFlowReviewedPublishData,
  type FlowReviewedPublishDataReport,
  type RunFlowReviewedPublishDataOptions,
} from './lib/flow-publish-reviewed-data.js';
import {
  runFlowBuildAliasMap,
  type FlowBuildAliasMapReport,
  type RunFlowBuildAliasMapOptions,
} from './lib/flow-build-alias-map.js';
import {
  runFlowApplyProcessFlowRepairs,
  runFlowPlanProcessFlowRepairs,
  runFlowRegenProduct,
  runFlowScanProcessFlowRefs,
  runFlowValidateProcesses,
  type FlowApplyProcessFlowRepairsReport,
  type FlowPlanProcessFlowRepairsReport,
  type FlowRegenProductReport,
  type FlowScanProcessFlowRefsReport,
  type FlowValidateProcessesReport,
  type RunFlowApplyProcessFlowRepairsOptions,
  type RunFlowPlanProcessFlowRepairsOptions,
  type RunFlowRegenProductOptions,
  type RunFlowScanProcessFlowRefsOptions,
  type RunFlowValidateProcessesOptions,
} from './lib/flow-regen-product.js';
import { executeRemoteCommand, getRemoteCommandHelp } from './lib/remote.js';
import {
  runValidation,
  type RunValidationOptions,
  type ValidationRunReport,
} from './lib/validation.js';

export type CliDeps = {
  env: NodeJS.ProcessEnv;
  dotEnvStatus: DotEnvLoadResult;
  fetchImpl: FetchLike;
  runPublishImpl?: (options: RunPublishOptions) => Promise<PublishReport>;
  runValidationImpl?: (options: RunValidationOptions) => Promise<ValidationRunReport>;
  runLifecyclemodelAutoBuildImpl?: (
    options: RunLifecyclemodelAutoBuildOptions,
  ) => Promise<LifecyclemodelAutoBuildReport>;
  runLifecyclemodelBuildResultingProcessImpl?: (
    options: RunLifecyclemodelResultingProcessOptions,
  ) => Promise<LifecyclemodelResultingProcessReport>;
  runLifecyclemodelPublishResultingProcessImpl?: (
    options: RunLifecyclemodelPublishResultingProcessOptions,
  ) => Promise<LifecyclemodelPublishResultingProcessReport>;
  runLifecyclemodelValidateBuildImpl?: (
    options: RunLifecyclemodelValidateBuildOptions,
  ) => Promise<LifecyclemodelValidateBuildReport>;
  runLifecyclemodelPublishBuildImpl?: (
    options: RunLifecyclemodelPublishBuildOptions,
  ) => Promise<LifecyclemodelPublishBuildReport>;
  runLifecyclemodelOrchestrateImpl?: (
    options: RunLifecyclemodelOrchestrateOptions,
  ) => Promise<LifecyclemodelOrchestrateReport>;
  runProcessGetImpl?: (options: RunProcessGetOptions) => Promise<ProcessGetReport>;
  runProcessAutoBuildImpl?: (
    options: RunProcessAutoBuildOptions,
  ) => Promise<ProcessAutoBuildReport>;
  runProcessBatchBuildImpl?: (
    options: RunProcessBatchBuildOptions,
  ) => Promise<ProcessBatchBuildReport>;
  runProcessResumeBuildImpl?: (
    options: RunProcessResumeBuildOptions,
  ) => Promise<ProcessResumeBuildReport>;
  runProcessPublishBuildImpl?: (
    options: RunProcessPublishBuildOptions,
  ) => Promise<ProcessPublishBuildReport>;
  runProcessReviewImpl?: (options: RunProcessReviewOptions) => Promise<ProcessReviewReport>;
  runFlowReviewImpl?: (options: RunFlowReviewOptions) => Promise<FlowReviewReport>;
  runLifecyclemodelReviewImpl?: (
    options: RunLifecyclemodelReviewOptions,
  ) => Promise<LifecyclemodelReviewReport>;
  runFlowRemediateImpl?: (options: RunFlowRemediateOptions) => Promise<FlowRemediationReport>;
  runFlowFetchRowsImpl?: (options: RunFlowFetchRowsOptions) => Promise<FlowFetchRowsReport>;
  runFlowMaterializeDecisionsImpl?: (
    options: RunFlowMaterializeDecisionsOptions,
  ) => Promise<FlowMaterializeDecisionsReport>;
  runFlowGetImpl?: (options: RunFlowGetOptions) => Promise<FlowGetReport>;
  runFlowListImpl?: (options: RunFlowListOptions) => Promise<FlowListReport>;
  runFlowPublishVersionImpl?: (
    options: RunFlowPublishVersionOptions,
  ) => Promise<FlowPublishVersionReport>;
  runFlowReviewedPublishDataImpl?: (
    options: RunFlowReviewedPublishDataOptions,
  ) => Promise<FlowReviewedPublishDataReport>;
  runFlowBuildAliasMapImpl?: (
    options: RunFlowBuildAliasMapOptions,
  ) => Promise<FlowBuildAliasMapReport>;
  runFlowScanProcessFlowRefsImpl?: (
    options: RunFlowScanProcessFlowRefsOptions,
  ) => Promise<FlowScanProcessFlowRefsReport>;
  runFlowPlanProcessFlowRepairsImpl?: (
    options: RunFlowPlanProcessFlowRepairsOptions,
  ) => Promise<FlowPlanProcessFlowRepairsReport>;
  runFlowApplyProcessFlowRepairsImpl?: (
    options: RunFlowApplyProcessFlowRepairsOptions,
  ) => Promise<FlowApplyProcessFlowRepairsReport>;
  runFlowRegenProductImpl?: (
    options: RunFlowRegenProductOptions,
  ) => Promise<FlowRegenProductReport>;
  runFlowValidateProcessesImpl?: (
    options: RunFlowValidateProcessesOptions,
  ) => Promise<FlowValidateProcessesReport>;
};

export type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type RootFlags = {
  help: boolean;
  version: boolean;
};

function renderMainHelp(dotEnvStatus: DotEnvLoadResult): string {
  return `TianGong LCA CLI

Unified TianGong command entrypoint.

Design principles:
  - direct REST / Edge Function access
  - no MCP inside the CLI
  - TypeScript source on Node 24
  - file-first input and JSON-first output

Usage:
  tiangong <command> [subcommand] [options]

Commands:
Implemented Commands:
  doctor     show environment diagnostics
  search     flow | process | lifecyclemodel
  process    get | auto-build | resume-build | publish-build | batch-build
  flow       get | list | fetch-rows | materialize-decisions | remediate | publish-version | publish-reviewed-data | build-alias-map | scan-process-flow-refs | plan-process-flow-repairs | apply-process-flow-repairs | regen-product | validate-processes
  lifecyclemodel auto-build | validate-build | publish-build | build-resulting-process | publish-resulting-process | orchestrate
  review     process | flow | lifecyclemodel
  publish    run
  validation run
  admin      embedding-run

Planned Surface (not implemented yet):
  auth       whoami | doctor-auth
  job        get | wait | logs

Planned commands currently print an explicit "not implemented yet" message and exit with code 2.

Examples:
  tiangong doctor
  tiangong search flow --input ./request.json
  tiangong search process --input ./request.json --dry-run
  tiangong process get --id <process-id>
  tiangong process auto-build --input ./pff-request.json
  tiangong process resume-build --run-id <id>
  tiangong process publish-build --run-id <id>
  tiangong process batch-build --input ./batch-request.json
  tiangong lifecyclemodel auto-build --input ./lifecyclemodel-auto-build.request.json
  tiangong lifecyclemodel validate-build --run-dir ./artifacts/lifecyclemodel_auto_build/<run_id>
  tiangong lifecyclemodel publish-build --run-dir ./artifacts/lifecyclemodel_auto_build/<run_id>
  tiangong lifecyclemodel orchestrate plan --input ./lifecyclemodel-orchestrate.request.json --out-dir ./artifacts/lifecyclemodel_recursive/run-001
  tiangong flow get --id <flow-id> --version <version>
  tiangong flow list --id <flow-id> --state-code 100 --limit 20
  tiangong flow fetch-rows --refs-file ./flow-refs.json --out-dir ./flow-fetch
  tiangong flow materialize-decisions --decision-file ./approved-decisions.json --flow-rows-file ./review-input-rows.jsonl --out-dir ./flow-decisions
  tiangong flow remediate --input-file ./invalid-flows.jsonl --out-dir ./flow-remediation
  tiangong flow publish-version --input-file ./ready-flows.jsonl --out-dir ./flow-publish --commit
  tiangong flow publish-reviewed-data --flow-rows-file ./reviewed-flows.jsonl --original-flow-rows-file ./original-flows.jsonl --out-dir ./flow-publish-review
  tiangong flow build-alias-map --old-flow-file ./old-flows.jsonl --new-flow-file ./new-flows.jsonl --out-dir ./flow-alias-map
  tiangong flow scan-process-flow-refs --processes-file ./processes.jsonl --scope-flow-file ./flows.jsonl --out-dir ./flow-scan
  tiangong flow plan-process-flow-repairs --processes-file ./processes.jsonl --scope-flow-file ./flows.jsonl --out-dir ./flow-repair-plan
  tiangong flow apply-process-flow-repairs --processes-file ./processes.jsonl --scope-flow-file ./flows.jsonl --out-dir ./flow-repair-apply
  tiangong flow regen-product --processes-file ./processes.jsonl --scope-flow-file ./flows.jsonl --out-dir ./flow-regeneration --apply
  tiangong flow validate-processes --original-processes-file ./before.jsonl --patched-processes-file ./after.jsonl --scope-flow-file ./flows.jsonl --out-dir ./flow-validation
  tiangong review process --run-root ./artifacts/process_from_flow/<run_id> --run-id <run_id> --out-dir ./review
  tiangong review flow --rows-file ./flows.json --out-dir ./review
  tiangong review lifecyclemodel --run-dir ./artifacts/lifecyclemodel_auto_build/<run_id> --out-dir ./lifecyclemodel-review
  tiangong publish run --input ./publish-request.json --dry-run
  tiangong validation run --input-dir ./package --engine auto
  tiangong admin embedding-run --input ./jobs.json

Environment:
  .env loaded: ${dotEnvStatus.loaded ? `yes (${dotEnvStatus.path}, ${dotEnvStatus.count} keys)` : 'no'}
`.trim();
}

function renderDoctorHelp(): string {
  return `Usage:
  tiangong doctor [--json]

Options:
  --json    Print structured environment diagnostics
  -h, --help
`.trim();
}

function renderSearchHelp(): string {
  return `Usage:
  tiangong search <flow|process|lifecyclemodel> --input <file> [options]

Options:
  --input <file>   JSON request file
  --json           Print compact JSON
  --dry-run        Print the planned HTTP request without sending it
  --api-key <key>  Override TIANGONG_LCA_API_KEY
  --base-url <url> Override TIANGONG_LCA_API_BASE_URL
  --region <name>  Override TIANGONG_LCA_REGION
  --timeout-ms <n> Request timeout in milliseconds
  -h, --help

Required env:
  TIANGONG_LCA_API_BASE_URL
  TIANGONG_LCA_API_KEY
  TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY
  TIANGONG_LCA_REGION (optional)

Runtime note:
  The CLI decodes TIANGONG_LCA_API_KEY as a user API key bootstrap, exchanges it for a user session,
  and sends the resolved access token to Edge Functions.
`.trim();
}

function renderAdminHelp(): string {
  return `Usage:
  tiangong admin embedding-run --input <file> [options]

Options:
  --input <file>   JSON request file
  --json           Print compact JSON
  --dry-run        Print the planned HTTP request without sending it
  --api-key <key>  Override TIANGONG_LCA_API_KEY
  --base-url <url> Override TIANGONG_LCA_API_BASE_URL
  --timeout-ms <n> Request timeout in milliseconds
  -h, --help

Required env:
  TIANGONG_LCA_API_BASE_URL
  TIANGONG_LCA_API_KEY
  TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY

Runtime note:
  The CLI decodes TIANGONG_LCA_API_KEY as a user API key bootstrap, exchanges it for a user session,
  and sends the resolved access token to Edge Functions.
`.trim();
}

function renderPublishHelp(): string {
  return `Usage:
  tiangong publish run --input <file> [options]

Options:
  --input <file>       JSON publish request file
  --out-dir <dir>      Override request out_dir
  --commit             Force publish.commit=true
  --dry-run            Force publish.commit=false
  --json               Print compact JSON
  -h, --help
`.trim();
}

function renderValidationHelp(): string {
  return `Usage:
  tiangong validation run --input-dir <dir> [options]

Options:
  --input-dir <dir>    TIDAS package directory
  --engine <mode>      auto | sdk (default: auto)
  --report-file <file> Write the structured validation report to a file
  --json               Print compact JSON
  -h, --help
`.trim();
}

function renderFlowHelp(): string {
  return `Usage:
  tiangong flow <subcommand> [options]

Implemented Subcommands:
  get          Load one flow dataset by identifier through direct Supabase access
  list         Enumerate flow datasets through direct Supabase access with deterministic filters
  fetch-rows   Materialize real DB flow refs into local review-input rows and fetch artifacts
  materialize-decisions Materialize approved merge decisions into canonical-map, rewrite-plan, and seed artifacts
  remediate    Deterministically repair invalid local flow rows and emit artifact-first outputs
  publish-version Publish remediated flow versions through the unified CLI surface
  publish-reviewed-data Prepare reviewed flow rows, skip unchanged snapshots, and optionally publish the resulting versions
  build-alias-map Build a deterministic flow alias map from old/new local flow snapshots
  scan-process-flow-refs Classify process exchange references against the current flow scope
  plan-process-flow-repairs Plan deterministic repairs for local process-flow references
  apply-process-flow-repairs Apply deterministic process-flow reference repairs and emit patch artifacts
  regen-product Regenerate local process-side artifacts after flow governance changes
  validate-processes Validate locally patched process rows against allowed flow-reference-only changes

Examples:
  tiangong flow --help
  tiangong flow get --help
  tiangong flow list --help
  tiangong flow fetch-rows --help
  tiangong flow materialize-decisions --help
  tiangong flow remediate --help
  tiangong flow publish-version --help
  tiangong flow publish-reviewed-data --help
  tiangong flow build-alias-map --help
  tiangong flow scan-process-flow-refs --help
  tiangong flow plan-process-flow-repairs --help
  tiangong flow apply-process-flow-repairs --help
  tiangong flow regen-product --help
  tiangong flow validate-processes --help
`.trim();
}

function renderFlowGetHelp(): string {
  return `Usage:
  tiangong flow get --id <flow-id> [options]

Options:
  --id <flow-id>        Flow UUID
  --version <version>   Optional requested dataset version; if absent or missing, the latest reachable row is returned
  --user-id <user-id>   Optional owner filter for private rows
  --state-code <code>   Optional visibility filter such as 0 or 100
  --json                Print compact JSON
  -h, --help

Required env:
  TIANGONG_LCA_API_BASE_URL
  TIANGONG_LCA_API_KEY
  TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY

Runtime note:
  The CLI derives a native @supabase/supabase-js client and deterministic read target from TIANGONG_LCA_API_BASE_URL,
  and authenticates that client with the resolved user access token.
`.trim();
}

function renderFlowListHelp(): string {
  return `Usage:
  tiangong flow list [options]

Options:
  --id <flow-id>                  Repeatable exact flow UUID filter
  --version <version>             Optional dataset version filter
  --user-id <user-id>             Optional owner filter for private rows
  --state-code <code>             Repeatable visibility filter such as 0 or 100
  --type-of-dataset <name>        Repeatable flow type filter, for example "Product flow" or "Waste flow"
  --order <expr>                  Deterministic PostgREST order expression (default: id.asc,version.asc)
  --limit <n>                     Page size for one request (default: 100)
  --offset <n>                    Row offset for one request (default: 0)
  --all                           Fetch all matching rows via offset pagination
  --page-size <n>                 Page size when --all is used (default: 100)
  --json                          Print compact JSON
  -h, --help

Required env:
  TIANGONG_LCA_API_BASE_URL
  TIANGONG_LCA_API_KEY
  TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY

Runtime note:
  The CLI derives a native @supabase/supabase-js client and deterministic read target from TIANGONG_LCA_API_BASE_URL,
  and authenticates that client with the resolved user access token.
`.trim();
}

function renderFlowRemediateHelp(): string {
  return `Usage:
  tiangong flow remediate --input-file <file> --out-dir <dir> [options]

Options:
  --input-file <file>  Invalid flow rows as JSON or JSONL
  --out-dir <dir>      Output directory for remediation artifacts
  --json               Print compact JSON
  -h, --help

Outputs written under --out-dir:
  - flows_tidas_sdk_plus_classification_remediated_all.jsonl
  - flows_tidas_sdk_plus_classification_remediated_ready_for_mcp.jsonl
  - flows_tidas_sdk_plus_classification_residual_manual_queue.jsonl
  - flows_tidas_sdk_plus_classification_remediation_audit.jsonl
  - flows_tidas_sdk_plus_classification_remediation_report.json
  - flows_tidas_sdk_plus_classification_residual_manual_queue_prompt.md
`.trim();
}

function renderFlowFetchRowsHelp(): string {
  return `Usage:
  tiangong flow fetch-rows --refs-file <file> --out-dir <dir> [options]

Options:
  --refs-file <file>         Flow refs as JSON or JSONL
  --out-dir <dir>            Output directory for fetch artifacts
  --no-latest-fallback       Do not fall back to the latest visible version when --version misses
  --fail-on-missing          Return exit code 1 when any ref is missing or ambiguous
  --json                     Print compact JSON
  -h, --help

Required env:
  TIANGONG_LCA_API_BASE_URL
  TIANGONG_LCA_API_KEY
  TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY

Outputs written under --out-dir:
  - resolved-flow-rows.jsonl
  - review-input-rows.jsonl
  - fetch-summary.json
  - missing-flow-refs.jsonl
  - ambiguous-flow-refs.jsonl
`.trim();
}

function renderFlowMaterializeDecisionsHelp(): string {
  return `Usage:
  tiangong flow materialize-decisions --decision-file <file> --flow-rows-file <file> --out-dir <dir> [options]

Options:
  --decision-file <file>     Approved cluster decisions as JSON or JSONL
  --flow-rows-file <file>    Real DB flow rows as JSON or JSONL
  --out-dir <dir>            Output directory for decision materialization artifacts
  --json                     Print compact JSON
  -h, --help

Outputs written under --out-dir:
  - flow-dedup-canonical-map.json
  - flow-dedup-rewrite-plan.json
  - manual-semantic-merge-seed.current.json
  - decision-summary.json
  - blocked-clusters.json
`.trim();
}

function renderFlowPublishVersionHelp(): string {
  return `Usage:
  tiangong flow publish-version --input-file <file> --out-dir <dir> [options]

Options:
  --input-file <file>       Ready-for-publish flow rows as JSON or JSONL
  --out-dir <dir>           Output directory for publish-version artifacts
  --commit                  Execute remote writes
  --dry-run                 Plan the publish-version operations without remote writes
  --max-workers <n>         Parallel worker count (default: 4)
  --limit <n>               Optional row limit; 0 means all rows
  --target-user-id <id>     Override the target owner when input rows omit user_id
  --json                    Print compact JSON
  -h, --help

Environment:
  TIANGONG_LCA_API_BASE_URL
  TIANGONG_LCA_API_KEY
  TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY

Outputs written under --out-dir:
  - flows_tidas_sdk_plus_classification_mcp_success_list.json
  - flows_tidas_sdk_plus_classification_remote_validation_failed.jsonl
  - flows_tidas_sdk_plus_classification_mcp_sync_report.json
`.trim();
}

function renderFlowPublishReviewedDataHelp(): string {
  return `Usage:
  tiangong flow publish-reviewed-data --out-dir <dir> [--flow-rows-file <file>] [--process-rows-file <file>] [options]

Options:
  --flow-rows-file <file>           Reviewed flow rows as JSON or JSONL
  --original-flow-rows-file <file>  Optional original flow snapshot used to skip unchanged reviewed rows
  --process-rows-file <file>        Optional reviewed process rows as JSON or JSONL
  --flow-publish-policy <mode>      skip | append_only_bump | upsert_current_version (default: append_only_bump)
  --process-publish-policy <mode>   skip | append_only_bump | upsert_current_version (default: append_only_bump)
  --no-rewrite-process-flow-refs    Keep process flow references unchanged during local preparation
  --commit                          Execute remote writes for prepared flow and process rows
  --dry-run                         Keep the command local-only and write prepared artifacts without remote writes
  --max-workers <n>                 Parallel worker count for the flow commit step (default: 4)
  --target-user-id <id>             Override the target owner when prepared flow rows omit user_id
  --json                            Print compact JSON
  -h, --help

Environment:
  none for local dry-run
  TIANGONG_LCA_API_BASE_URL, TIANGONG_LCA_API_KEY, and TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY
  when --commit publishes prepared rows

Outputs written under --out-dir:
  - prepared-flow-rows.json
  - prepared-process-rows.json
  - flow-version-map.json
  - skipped-unchanged-flow-rows.json
  - process-flow-ref-rewrite-evidence.jsonl
  - publish-report.json
  - flows_tidas_sdk_plus_classification_mcp_success_list.json
  - flows_tidas_sdk_plus_classification_remote_validation_failed.jsonl
  - flows_tidas_sdk_plus_classification_mcp_sync_report.json
`.trim();
}

function renderFlowBuildAliasMapHelp(): string {
  return `Usage:
  tiangong flow build-alias-map --old-flow-file <file> --new-flow-file <file> --out-dir <dir> [options]

Options:
  --old-flow-file <file>          Repeatable pre-governance flow snapshot as JSON or JSONL
  --new-flow-file <file>          Repeatable post-governance flow snapshot as JSON or JSONL
  --seed-alias-map <file>         Optional existing alias map JSON object used as deterministic seed input
  --out-dir <dir>                 Output directory for alias-plan artifacts
  --json                          Print compact JSON
  -h, --help

Outputs written under --out-dir:
  - alias-plan.json
  - alias-plan.jsonl
  - flow-alias-map.json
  - manual-review-queue.jsonl
  - alias-summary.json
`.trim();
}

function renderFlowScanProcessFlowRefsHelp(): string {
  return `Usage:
  tiangong flow scan-process-flow-refs --processes-file <file> --scope-flow-file <file> --out-dir <dir> [options]

Options:
  --processes-file <file>         Process rows as JSON or JSONL
  --scope-flow-file <file>        Repeatable target flow scope file as JSON or JSONL
  --catalog-flow-file <file>      Repeatable catalog flow file; defaults to the scope files
  --alias-map <file>              Optional flow alias map JSON object
  --exclude-emergy                Exclude emergy-named processes before reference scanning
  --out-dir <dir>                 Output directory for scan artifacts
  --json                          Print compact JSON
  -h, --help

Outputs written under --out-dir:
  - emergy-excluded-processes.json
  - scan-summary.json
  - scan-findings.json
  - scan-findings.jsonl
`.trim();
}

function renderFlowPlanProcessFlowRepairsHelp(): string {
  return `Usage:
  tiangong flow plan-process-flow-repairs --processes-file <file> --scope-flow-file <file> --out-dir <dir> [options]

Options:
  --processes-file <file>         Process rows as JSON or JSONL
  --scope-flow-file <file>        Repeatable target flow scope file as JSON or JSONL
  --alias-map <file>              Optional flow alias map JSON object
  --scan-findings <file>          Optional scan-findings JSON or JSONL from a prior scan step
  --auto-patch-policy <mode>      disabled | alias-only | alias-or-unique-name (default: alias-only)
  --out-dir <dir>                 Output directory for repair plan artifacts
  --json                          Print compact JSON
  -h, --help

Outputs written under --out-dir:
  - repair-plan.json
  - repair-plan.jsonl
  - manual-review-queue.jsonl
  - repair-summary.json
`.trim();
}

function renderFlowApplyProcessFlowRepairsHelp(): string {
  return `Usage:
  tiangong flow apply-process-flow-repairs --processes-file <file> --scope-flow-file <file> --out-dir <dir> [options]

Options:
  --processes-file <file>         Process rows as JSON or JSONL
  --scope-flow-file <file>        Repeatable target flow scope file as JSON or JSONL
  --alias-map <file>              Optional flow alias map JSON object
  --scan-findings <file>          Optional scan-findings JSON or JSONL from a prior scan step
  --auto-patch-policy <mode>      disabled | alias-only | alias-or-unique-name (default: alias-only)
  --process-pool-file <file>      Optional process pool file to sync after patch application
  --out-dir <dir>                 Output directory for repair apply artifacts
  --json                          Print compact JSON
  -h, --help

Outputs written under --out-dir:
  - repair-plan.json
  - repair-plan.jsonl
  - manual-review-queue.jsonl
  - repair-summary.json
  - patched-processes.json
  - process-patches/
`.trim();
}

function renderFlowRegenProductHelp(): string {
  return `Usage:
  tiangong flow regen-product --processes-file <file> --scope-flow-file <file> --out-dir <dir> [options]

Options:
  --processes-file <file>         Process rows as JSON or JSONL
  --scope-flow-file <file>        Repeatable target flow scope file as JSON or JSONL
  --catalog-flow-file <file>      Repeatable catalog flow file; defaults to the scope files
  --alias-map <file>              Optional flow alias map JSON object
  --exclude-emergy                Exclude emergy-named processes before scan and repair
  --auto-patch-policy <mode>      disabled | alias-only | alias-or-unique-name (default: alias-only)
  --apply                         Apply deterministic patches and run local validation
  --process-pool-file <file>      Optional process pool file to sync after --apply
  --tidas-mode <mode>             auto | required | skip (default: auto)
  --out-dir <dir>                 Run root for scan / repair / validate artifacts
  --json                          Print compact JSON
  -h, --help

Outputs written under --out-dir:
  - flow-regen-product-report.json
  - scan/
  - repair/
  - repair-apply/ (only with --apply)
  - validate/ (only with --apply)
`.trim();
}

function renderFlowValidateProcessesHelp(): string {
  return `Usage:
  tiangong flow validate-processes --original-processes-file <file> --patched-processes-file <file> --scope-flow-file <file> --out-dir <dir> [options]

Options:
  --original-processes-file <file>  Original process rows before repair as JSON or JSONL
  --patched-processes-file <file>   Patched process rows after repair as JSON or JSONL
  --scope-flow-file <file>          Repeatable target flow scope file as JSON or JSONL
  --out-dir <dir>                   Output directory for validation-report.json and validation-failures.jsonl
  --tidas-mode <mode>               auto | required | skip (default: auto)
  --json                            Print compact JSON
  -h, --help

Outputs written under --out-dir:
  - validation-report.json
  - validation-failures.jsonl
`.trim();
}

function renderReviewHelp(): string {
  return `Usage:
  tiangong review <subcommand> [options]

Implemented Subcommands:
  process      Review one local process build run and emit artifact-first findings
  flow         Review local flow governance snapshots and emit artifact-first findings
  lifecyclemodel Review one local lifecyclemodel build run and emit artifact-first findings

Examples:
  tiangong review --help
  tiangong review process --help
  tiangong review flow --help
  tiangong review lifecyclemodel --help
`.trim();
}

function renderReviewProcessHelp(): string {
  return `Usage:
  tiangong review process --run-root <dir> --run-id <id> --out-dir <dir> [options]

Options:
  --run-root <dir>          Process build run root containing exports/processes
  --run-id <id>             Process build run identifier
  --out-dir <dir>           Review artifact output directory
  --start-ts <iso>          Optional run start timestamp
  --end-ts <iso>            Optional run end timestamp
  --logic-version <name>    Review logic version label (default: v2.1)
  --enable-llm              Enable optional review-only semantic review via the CLI LLM client
  --llm-model <name>        Override TIANGONG_LCA_REVIEW_LLM_MODEL for this review command
  --llm-max-processes <n>   Cap how many process summaries are sent to the LLM (default: 8)
  --json                    Print compact JSON
  -h, --help
`.trim();
}

function renderReviewFlowHelp(): string {
  return `Usage:
  tiangong review flow (--rows-file <file> | --flows-dir <dir> | --run-root <dir>) --out-dir <dir> [options]

Options:
  --rows-file <file>        Flow rows JSON / JSONL file; the CLI materializes review-input/flows automatically
  --flows-dir <dir>         Directory containing per-flow JSON files
  --run-root <dir>          Existing run root containing cache/flows or exports/flows
  --run-id <id>             Optional run identifier override
  --out-dir <dir>           Review artifact output directory
  --start-ts <iso>          Optional run start timestamp
  --end-ts <iso>            Optional run end timestamp
  --logic-version <name>    Review logic version label (default: flow-v1.0-cli)
  --enable-llm              Enable optional review-only semantic review via the CLI LLM client
  --llm-model <name>        Override TIANGONG_LCA_REVIEW_LLM_MODEL for this review command
  --llm-max-flows <n>       Cap how many flow summaries are sent to the LLM (default: 120)
  --llm-batch-size <n>      Cap how many flow summaries each LLM batch sends (default: 20)
  --similarity-threshold <n> Similarity threshold for duplicate-candidate warnings (default: 0.92)
  --methodology-id <name>   Label written into methodology-backed rule findings (default: built_in)
  --json                    Print compact JSON
  -h, --help
`.trim();
}

function renderReviewLifecyclemodelHelp(): string {
  return `Usage:
  tiangong review lifecyclemodel --run-dir <dir> --out-dir <dir> [options]

Options:
  --run-dir <dir>          Existing lifecyclemodel auto-build run directory
  --out-dir <dir>          Review artifact output directory
  --start-ts <iso>         Optional run start timestamp
  --end-ts <iso>           Optional run end timestamp
  --logic-version <name>   Review logic version label (default: lifecyclemodel-review-v1.0)
  --json                   Print compact JSON
  -h, --help

This command:
  - reads one existing lifecyclemodel build run under models/*/tidas_bundle/lifecyclemodels
  - aggregates validate-build findings when reports/lifecyclemodel-validate-build-report.json is present
  - emits artifact-first model summaries, findings, markdown review notes, and a structured report
`.trim();
}

function renderLifecyclemodelBuildResultingProcessHelp(): string {
  return `Usage:
  tiangong lifecyclemodel build-resulting-process --input <file> [options]

Options:
  --input <file>     JSON request file
  --out-dir <dir>    Override the default artifact output directory
  --json             Print compact JSON
  -h, --help

Remote lookup env (only when process_sources.allow_remote_lookup=true):
  TIANGONG_LCA_API_BASE_URL
  TIANGONG_LCA_API_KEY
  TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY
`.trim();
}

function renderLifecyclemodelPublishResultingProcessHelp(): string {
  return `Usage:
  tiangong lifecyclemodel publish-resulting-process --run-dir <dir> [options]

Options:
  --run-dir <dir>         Existing lifecyclemodel resulting-process run directory
  --publish-processes     Include projected processes in publish-bundle.json
  --publish-relations     Include lifecyclemodel/resulting-process relations in publish-bundle.json
  --json                  Print compact JSON
  -h, --help
`.trim();
}

function renderLifecyclemodelHelp(): string {
  return `Usage:
  tiangong lifecyclemodel <subcommand> [options]

Implemented Subcommands:
  auto-build                Build native lifecyclemodel json_ordered artifacts from local process run exports
  validate-build            Re-run local validation on one lifecyclemodel build run
  publish-build             Prepare lifecyclemodel publish handoff artifacts from one local build run
  build-resulting-process   Deterministically aggregate a lifecycle model into a resulting process bundle
  publish-resulting-process Prepare publish-bundle.json and publish-intent.json from a prior resulting-process run
  orchestrate               Plan, execute, or publish a recursive lifecyclemodel assembly run

Examples:
  tiangong lifecyclemodel --help
  tiangong lifecyclemodel auto-build --help
  tiangong lifecyclemodel validate-build --help
  tiangong lifecyclemodel publish-build --help
  tiangong lifecyclemodel build-resulting-process --help
  tiangong lifecyclemodel orchestrate --help
`.trim();
}

function renderLifecyclemodelOrchestrateHelp(): string {
  return `Usage:
  tiangong lifecyclemodel orchestrate <plan|execute|publish> [options]

Plan / execute options:
  --input <file>                           JSON request file
  --request <file>                         Alias for --input
  --out-dir <dir>                          Output run directory
  --allow-process-build                    Override orchestration.allow_process_build=true during execute
  --allow-submodel-build                   Override orchestration.allow_submodel_build=true during execute
  --json                                   Print compact JSON
  -h, --help

Publish options:
  --run-dir <dir>                          Existing orchestrator run directory
  --publish-lifecyclemodels                Include built lifecyclemodels in publish-bundle.json
  --publish-resulting-process-relations    Include projected processes and resulting-process relations in publish-bundle.json
  --json                                   Print compact JSON
  -h, --help

This command:
  - normalizes a recursive request into assembly-plan.json, graph-manifest.json, lineage-manifest.json, and boundary-report.json
  - executes only native CLI-backed builders; no Python fallback path remains
  - prepares a local publish-bundle.json from prior invocation artifacts
`.trim();
}

function renderLifecyclemodelAutoBuildHelp(): string {
  return `Usage:
  tiangong lifecyclemodel auto-build --input <file> [options]

Options:
  --input <file>     JSON request file
  --out-dir <dir>    Override the default lifecyclemodel build run root
  --json             Print compact JSON
  -h, --help

Minimal request contract:
  {
    "local_runs": ["/abs/path/to/process-build-run"]
  }

This first CLI slice is local-only and read-only:
  - loads local process build run directories
  - infers the process graph from shared flow UUIDs
  - emits native lifecyclemodel json_ordered artifacts
  - leaves follow-up validation and publish handoff to the companion validate-build and publish-build commands
`.trim();
}

function renderLifecyclemodelValidateBuildHelp(): string {
  return `Usage:
  tiangong lifecyclemodel validate-build --run-dir <dir> [options]

Options:
  --run-dir <dir>    Existing lifecyclemodel auto-build run directory
  --engine <mode>    auto | sdk (default: auto)
  --json             Print compact JSON
  -h, --help

This command:
  - scans models/*/tidas_bundle from one lifecyclemodel auto-build run
  - re-runs local validation through the unified validation module
  - writes per-model validation reports plus one aggregate report
`.trim();
}

function renderLifecyclemodelPublishBuildHelp(): string {
  return `Usage:
  tiangong lifecyclemodel publish-build --run-dir <dir> [options]

Options:
  --run-dir <dir>    Existing lifecyclemodel auto-build run directory
  --json             Print compact JSON
  -h, --help

This command:
  - collects native lifecyclemodel json_ordered payloads from one local build run
  - writes publish-bundle.json, publish-request.json, and publish-intent.json
  - keeps actual dry-run / commit execution in tiangong publish run
`.trim();
}

function renderProcessAutoBuildHelp(): string {
  return `Usage:
  tiangong process auto-build --input <file> [options]

Options:
  --input <file>     JSON request file
  --out-dir <dir>    Override the default run root directory
  --json             Print compact JSON
  -h, --help
`.trim();
}

function renderProcessGetHelp(): string {
  return `Usage:
  tiangong process get --id <process-id> [options]

Options:
  --id <process-id>    Process UUID
  --version <version>  Optional requested dataset version; if absent or missing, the latest reachable row is returned
  --json               Print compact JSON
  -h, --help

Required env:
  TIANGONG_LCA_API_BASE_URL
  TIANGONG_LCA_API_KEY
  TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY

Runtime note:
  The CLI derives a native @supabase/supabase-js client and deterministic read target from TIANGONG_LCA_API_BASE_URL,
  and authenticates that client with the resolved user access token.
`.trim();
}

function renderProcessResumeBuildHelp(): string {
  return `Usage:
  tiangong process resume-build [--run-id <id>] [--run-dir <dir>] [options]

Options:
  --run-id <id>      Existing process build run id
  --run-dir <dir>    Existing process build run directory
  --json             Print compact JSON
  -h, --help
`.trim();
}

function renderProcessPublishBuildHelp(): string {
  return `Usage:
  tiangong process publish-build [--run-id <id>] [--run-dir <dir>] [options]

Options:
  --run-id <id>      Existing process build run id
  --run-dir <dir>    Existing process build run directory
  --json             Print compact JSON
  -h, --help
`.trim();
}

function renderProcessBatchBuildHelp(): string {
  return `Usage:
  tiangong process batch-build --input <file> [options]

Options:
  --input <file>     JSON batch manifest file
  --out-dir <dir>    Override the batch artifact output directory
  --json             Print compact JSON
  -h, --help
`.trim();
}

function renderProcessHelp(): string {
  return `Usage:
  tiangong process <subcommand> [options]

Implemented Subcommands:
  get          Load one process dataset by identifier through direct Supabase access
  auto-build   Prepare a local process-from-flow run scaffold and artifact workspace
  resume-build Prepare a local resume handoff from one existing process build run
  publish-build Prepare publish handoff artifacts from one existing process build run
  batch-build  Run multiple process auto-build requests through one batch-oriented CLI surface

Examples:
  tiangong process --help
  tiangong process get --id <process-id>
  tiangong process auto-build --help
  tiangong process resume-build --run-id <id> --help
  tiangong process publish-build --run-id <id> --help
  tiangong process batch-build --input ./batch-request.json --help
`.trim();
}

function renderDoctorText(report: ReturnType<typeof buildDoctorReport>): string {
  const lines = [
    'TianGong CLI doctor',
    `  .env loaded: ${report.loadedDotEnv ? `yes (${report.dotEnvKeysLoaded} keys)` : 'no'}`,
    `  .env path:   ${report.dotEnvPath}`,
    '',
  ];
  for (const check of report.checks) {
    const status = check.present ? 'OK ' : 'MISS';
    lines.push(
      `  [${status}] ${check.key} (${check.source})${check.required ? ' [required]' : ''}`,
    );
  }
  if (!report.ok) {
    lines.push('', 'Missing required environment keys:');
    for (const check of report.checks) {
      if (check.required && !check.present) {
        lines.push(`  - ${check.key}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

type CommandDispatch = {
  flags: RootFlags;
  command: string | null;
  subcommand: string | null;
  commandArgs: string[];
};

function parseCommandLine(args: string[]): CommandDispatch {
  const flags: RootFlags = {
    help: false,
    version: false,
  };

  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg === '--') {
      index += 1;
      break;
    }
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
      index += 1;
      continue;
    }
    if (arg === '--version' || arg === '-v') {
      flags.version = true;
      index += 1;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new CliError(`Unknown root option: ${arg}`, {
        code: 'UNKNOWN_ROOT_OPTION',
        exitCode: 2,
      });
    }
    break;
  }

  const command = args[index] ?? null;
  if (!command) {
    return {
      flags,
      command: null,
      subcommand: null,
      commandArgs: [],
    };
  }

  const maybeSubcommand = args[index + 1];
  const subcommand = maybeSubcommand && !maybeSubcommand.startsWith('-') ? maybeSubcommand : null;
  const commandArgs = args.slice(index + 1 + (subcommand ? 1 : 0));

  return {
    flags,
    command,
    subcommand,
    commandArgs,
  };
}

function parseDoctorFlags(args: string[]): {
  help: boolean;
  json: boolean;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
  };
}

function parseRemoteFlags(args: string[]): {
  help: boolean;
  json: boolean;
  dryRun: boolean;
  inputPath: string;
  apiKey: string | null;
  apiBaseUrl: string | null;
  region: string | null;
  timeoutMs: number;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        input: { type: 'string' },
        'api-key': { type: 'string' },
        'base-url': { type: 'string' },
        region: { type: 'string' },
        'timeout-ms': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  const timeoutText = typeof values['timeout-ms'] === 'string' ? values['timeout-ms'] : undefined;
  const timeoutMs = timeoutText ? Number.parseInt(timeoutText, 10) : 60_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new CliError('Expected --timeout-ms to be a positive integer.', {
      code: 'INVALID_TIMEOUT',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    dryRun: Boolean(values['dry-run']),
    inputPath: typeof values.input === 'string' ? values.input : '',
    apiKey: typeof values['api-key'] === 'string' ? values['api-key'] : null,
    apiBaseUrl: typeof values['base-url'] === 'string' ? values['base-url'] : null,
    region: typeof values.region === 'string' ? values.region : null,
    timeoutMs,
  };
}

function parsePublishFlags(args: string[]): {
  help: boolean;
  json: boolean;
  inputPath: string;
  outDir: string | null;
  commitOverride: boolean | null;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        input: { type: 'string' },
        'out-dir': { type: 'string' },
        commit: { type: 'boolean' },
        'dry-run': { type: 'boolean' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  if (values.commit && values['dry-run']) {
    throw new CliError('Cannot pass both --commit and --dry-run.', {
      code: 'INVALID_PUBLISH_MODE',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    inputPath: typeof values.input === 'string' ? values.input : '',
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : null,
    commitOverride: values.commit ? true : values['dry-run'] ? false : null,
  };
}

function parseValidationFlags(args: string[]): {
  help: boolean;
  json: boolean;
  inputDir: string;
  engine: string | undefined;
  reportFile: string | null;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        'input-dir': { type: 'string' },
        engine: { type: 'string' },
        'report-file': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    inputDir: typeof values['input-dir'] === 'string' ? values['input-dir'] : '',
    engine: typeof values.engine === 'string' ? values.engine : undefined,
    reportFile: typeof values['report-file'] === 'string' ? values['report-file'] : null,
  };
}

function parseFlowRemediateFlags(args: string[]): {
  help: boolean;
  json: boolean;
  inputFile: string;
  outDir: string;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        'input-file': { type: 'string' },
        'out-dir': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    inputFile: typeof values['input-file'] === 'string' ? values['input-file'] : '',
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : '',
  };
}

function parseFlowPublishVersionFlags(args: string[]): {
  help: boolean;
  json: boolean;
  inputFile: string;
  outDir: string;
  commit: boolean;
  maxWorkers: number | undefined;
  limit: number | undefined;
  targetUserId: string | null;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        commit: { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        'input-file': { type: 'string' },
        'out-dir': { type: 'string' },
        'max-workers': { type: 'string' },
        limit: { type: 'string' },
        'target-user-id': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  if (values.commit && values['dry-run']) {
    throw new CliError('Cannot pass both --commit and --dry-run.', {
      code: 'FLOW_PUBLISH_VERSION_MODE_CONFLICT',
      exitCode: 2,
    });
  }

  const parsePositiveIntegerFlag = (
    value: unknown,
    label: string,
    code: string,
  ): number | undefined => {
    if (typeof value !== 'string') {
      return undefined;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new CliError(`Expected ${label} to be a positive integer.`, {
        code,
        exitCode: 2,
      });
    }
    return parsed;
  };

  const parseNonNegativeIntegerFlag = (
    value: unknown,
    label: string,
    code: string,
  ): number | undefined => {
    if (typeof value !== 'string') {
      return undefined;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new CliError(`Expected ${label} to be a non-negative integer.`, {
        code,
        exitCode: 2,
      });
    }
    return parsed;
  };

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    inputFile: typeof values['input-file'] === 'string' ? values['input-file'] : '',
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : '',
    commit: Boolean(values.commit),
    maxWorkers: parsePositiveIntegerFlag(
      values['max-workers'],
      '--max-workers',
      'INVALID_FLOW_PUBLISH_VERSION_MAX_WORKERS',
    ),
    limit: parseNonNegativeIntegerFlag(
      values.limit,
      '--limit',
      'INVALID_FLOW_PUBLISH_VERSION_LIMIT',
    ),
    targetUserId: typeof values['target-user-id'] === 'string' ? values['target-user-id'] : null,
  };
}

function parseFlowPublishReviewedDataFlags(args: string[]): {
  help: boolean;
  json: boolean;
  flowRowsFile: string;
  originalFlowRowsFile: string | null;
  processRowsFile: string | null;
  flowPublishPolicy: 'skip' | 'append_only_bump' | 'upsert_current_version';
  processPublishPolicy: 'skip' | 'append_only_bump' | 'upsert_current_version';
  rewriteProcessFlowRefs: boolean;
  outDir: string;
  commit: boolean;
  maxWorkers: number | undefined;
  targetUserId: string | null;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        'flow-rows-file': { type: 'string' },
        'original-flow-rows-file': { type: 'string' },
        'process-rows-file': { type: 'string' },
        'flow-publish-policy': { type: 'string' },
        'process-publish-policy': { type: 'string' },
        'no-rewrite-process-flow-refs': { type: 'boolean' },
        'out-dir': { type: 'string' },
        commit: { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        'max-workers': { type: 'string' },
        'target-user-id': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  if (values.commit && values['dry-run']) {
    throw new CliError('Cannot pass both --commit and --dry-run.', {
      code: 'FLOW_PUBLISH_REVIEWED_MODE_CONFLICT',
      exitCode: 2,
    });
  }

  const processPublishPolicy =
    typeof values['process-publish-policy'] === 'string'
      ? values['process-publish-policy']
      : 'append_only_bump';
  if (
    processPublishPolicy !== 'skip' &&
    processPublishPolicy !== 'append_only_bump' &&
    processPublishPolicy !== 'upsert_current_version'
  ) {
    throw new CliError(
      'Expected --process-publish-policy to be one of: skip, append_only_bump, upsert_current_version.',
      {
        code: 'FLOW_PUBLISH_REVIEWED_PROCESS_POLICY_INVALID',
        exitCode: 2,
      },
    );
  }

  const flowPublishPolicy =
    typeof values['flow-publish-policy'] === 'string'
      ? values['flow-publish-policy']
      : 'append_only_bump';
  if (
    flowPublishPolicy !== 'skip' &&
    flowPublishPolicy !== 'append_only_bump' &&
    flowPublishPolicy !== 'upsert_current_version'
  ) {
    throw new CliError(
      'Expected --flow-publish-policy to be one of: skip, append_only_bump, upsert_current_version.',
      {
        code: 'FLOW_PUBLISH_REVIEWED_FLOW_POLICY_INVALID',
        exitCode: 2,
      },
    );
  }

  const parsePositiveIntegerFlag = (
    value: unknown,
    label: string,
    code: string,
  ): number | undefined => {
    if (typeof value !== 'string') {
      return undefined;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new CliError(`Expected ${label} to be a positive integer.`, {
        code,
        exitCode: 2,
      });
    }
    return parsed;
  };

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    flowRowsFile: typeof values['flow-rows-file'] === 'string' ? values['flow-rows-file'] : '',
    originalFlowRowsFile:
      typeof values['original-flow-rows-file'] === 'string'
        ? values['original-flow-rows-file']
        : null,
    processRowsFile:
      typeof values['process-rows-file'] === 'string' ? values['process-rows-file'] : null,
    flowPublishPolicy,
    processPublishPolicy,
    rewriteProcessFlowRefs: !values['no-rewrite-process-flow-refs'],
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : '',
    commit: Boolean(values.commit),
    maxWorkers: parsePositiveIntegerFlag(
      values['max-workers'],
      '--max-workers',
      'INVALID_FLOW_PUBLISH_REVIEWED_MAX_WORKERS',
    ),
    targetUserId: typeof values['target-user-id'] === 'string' ? values['target-user-id'] : null,
  };
}

function parseFlowBuildAliasMapFlags(args: string[]): {
  help: boolean;
  json: boolean;
  oldFlowFiles: string[];
  newFlowFiles: string[];
  seedAliasMapFile: string | null;
  outDir: string;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        'old-flow-file': { type: 'string', multiple: true },
        'new-flow-file': { type: 'string', multiple: true },
        'seed-alias-map': { type: 'string' },
        'out-dir': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    oldFlowFiles: Array.isArray(values['old-flow-file'])
      ? values['old-flow-file'].filter((value): value is string => typeof value === 'string')
      : [],
    newFlowFiles: Array.isArray(values['new-flow-file'])
      ? values['new-flow-file'].filter((value): value is string => typeof value === 'string')
      : [],
    seedAliasMapFile:
      typeof values['seed-alias-map'] === 'string' ? values['seed-alias-map'] : null,
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : '',
  };
}

function parseFlowScanProcessFlowRefsFlags(args: string[]): {
  help: boolean;
  json: boolean;
  processesFile: string;
  scopeFlowFiles: string[];
  catalogFlowFiles: string[];
  aliasMapFile: string | null;
  excludeEmergy: boolean;
  outDir: string;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        'processes-file': { type: 'string' },
        'scope-flow-file': { type: 'string', multiple: true },
        'catalog-flow-file': { type: 'string', multiple: true },
        'alias-map': { type: 'string' },
        'exclude-emergy': { type: 'boolean' },
        'out-dir': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    processesFile: typeof values['processes-file'] === 'string' ? values['processes-file'] : '',
    scopeFlowFiles: Array.isArray(values['scope-flow-file'])
      ? values['scope-flow-file'].filter((value): value is string => typeof value === 'string')
      : [],
    catalogFlowFiles: Array.isArray(values['catalog-flow-file'])
      ? values['catalog-flow-file'].filter((value): value is string => typeof value === 'string')
      : [],
    aliasMapFile: typeof values['alias-map'] === 'string' ? values['alias-map'] : null,
    excludeEmergy: Boolean(values['exclude-emergy']),
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : '',
  };
}

function parseFlowPlanProcessFlowRepairsFlags(args: string[]): {
  help: boolean;
  json: boolean;
  processesFile: string;
  scopeFlowFiles: string[];
  aliasMapFile: string | null;
  scanFindingsFile: string | null;
  autoPatchPolicy: 'disabled' | 'alias-only' | 'alias-or-unique-name';
  outDir: string;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        'processes-file': { type: 'string' },
        'scope-flow-file': { type: 'string', multiple: true },
        'alias-map': { type: 'string' },
        'scan-findings': { type: 'string' },
        'auto-patch-policy': { type: 'string' },
        'out-dir': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  const autoPatchPolicy =
    typeof values['auto-patch-policy'] === 'string' ? values['auto-patch-policy'] : 'alias-only';
  if (
    autoPatchPolicy !== 'disabled' &&
    autoPatchPolicy !== 'alias-only' &&
    autoPatchPolicy !== 'alias-or-unique-name'
  ) {
    throw new CliError(
      'Expected --auto-patch-policy to be one of disabled, alias-only, or alias-or-unique-name.',
      {
        code: 'INVALID_FLOW_PLAN_PROCESS_FLOW_REPAIRS_AUTO_PATCH_POLICY',
        exitCode: 2,
      },
    );
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    processesFile: typeof values['processes-file'] === 'string' ? values['processes-file'] : '',
    scopeFlowFiles: Array.isArray(values['scope-flow-file'])
      ? values['scope-flow-file'].filter((value): value is string => typeof value === 'string')
      : [],
    aliasMapFile: typeof values['alias-map'] === 'string' ? values['alias-map'] : null,
    scanFindingsFile: typeof values['scan-findings'] === 'string' ? values['scan-findings'] : null,
    autoPatchPolicy,
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : '',
  };
}

function parseFlowApplyProcessFlowRepairsFlags(args: string[]): {
  help: boolean;
  json: boolean;
  processesFile: string;
  scopeFlowFiles: string[];
  aliasMapFile: string | null;
  scanFindingsFile: string | null;
  autoPatchPolicy: 'disabled' | 'alias-only' | 'alias-or-unique-name';
  processPoolFile: string | null;
  outDir: string;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        'processes-file': { type: 'string' },
        'scope-flow-file': { type: 'string', multiple: true },
        'alias-map': { type: 'string' },
        'scan-findings': { type: 'string' },
        'auto-patch-policy': { type: 'string' },
        'process-pool-file': { type: 'string' },
        'out-dir': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  const autoPatchPolicy =
    typeof values['auto-patch-policy'] === 'string' ? values['auto-patch-policy'] : 'alias-only';
  if (
    autoPatchPolicy !== 'disabled' &&
    autoPatchPolicy !== 'alias-only' &&
    autoPatchPolicy !== 'alias-or-unique-name'
  ) {
    throw new CliError(
      'Expected --auto-patch-policy to be one of disabled, alias-only, or alias-or-unique-name.',
      {
        code: 'INVALID_FLOW_APPLY_PROCESS_FLOW_REPAIRS_AUTO_PATCH_POLICY',
        exitCode: 2,
      },
    );
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    processesFile: typeof values['processes-file'] === 'string' ? values['processes-file'] : '',
    scopeFlowFiles: Array.isArray(values['scope-flow-file'])
      ? values['scope-flow-file'].filter((value): value is string => typeof value === 'string')
      : [],
    aliasMapFile: typeof values['alias-map'] === 'string' ? values['alias-map'] : null,
    scanFindingsFile: typeof values['scan-findings'] === 'string' ? values['scan-findings'] : null,
    autoPatchPolicy,
    processPoolFile:
      typeof values['process-pool-file'] === 'string' ? values['process-pool-file'] : null,
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : '',
  };
}

function parseFlowRegenProductFlags(args: string[]): {
  help: boolean;
  json: boolean;
  processesFile: string;
  scopeFlowFiles: string[];
  catalogFlowFiles: string[];
  aliasMapFile: string | null;
  excludeEmergy: boolean;
  autoPatchPolicy: 'disabled' | 'alias-only' | 'alias-or-unique-name';
  apply: boolean;
  processPoolFile: string | null;
  tidasMode: 'auto' | 'required' | 'skip';
  outDir: string;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        'processes-file': { type: 'string' },
        'scope-flow-file': { type: 'string', multiple: true },
        'catalog-flow-file': { type: 'string', multiple: true },
        'alias-map': { type: 'string' },
        'exclude-emergy': { type: 'boolean' },
        'auto-patch-policy': { type: 'string' },
        apply: { type: 'boolean' },
        'process-pool-file': { type: 'string' },
        'tidas-mode': { type: 'string' },
        'out-dir': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  const autoPatchPolicy =
    typeof values['auto-patch-policy'] === 'string' ? values['auto-patch-policy'] : 'alias-only';
  if (
    autoPatchPolicy !== 'disabled' &&
    autoPatchPolicy !== 'alias-only' &&
    autoPatchPolicy !== 'alias-or-unique-name'
  ) {
    throw new CliError(
      'Expected --auto-patch-policy to be one of disabled, alias-only, or alias-or-unique-name.',
      {
        code: 'INVALID_FLOW_REGEN_AUTO_PATCH_POLICY',
        exitCode: 2,
      },
    );
  }

  const tidasMode = typeof values['tidas-mode'] === 'string' ? values['tidas-mode'] : 'auto';
  if (tidasMode !== 'auto' && tidasMode !== 'required' && tidasMode !== 'skip') {
    throw new CliError('Expected --tidas-mode to be one of auto, required, or skip.', {
      code: 'INVALID_FLOW_REGEN_TIDAS_MODE',
      exitCode: 2,
    });
  }

  if (typeof values['process-pool-file'] === 'string' && !values.apply) {
    throw new CliError('Use --process-pool-file only with --apply.', {
      code: 'FLOW_REGEN_PROCESS_POOL_REQUIRES_APPLY',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    processesFile: typeof values['processes-file'] === 'string' ? values['processes-file'] : '',
    scopeFlowFiles: Array.isArray(values['scope-flow-file'])
      ? values['scope-flow-file'].filter((value): value is string => typeof value === 'string')
      : [],
    catalogFlowFiles: Array.isArray(values['catalog-flow-file'])
      ? values['catalog-flow-file'].filter((value): value is string => typeof value === 'string')
      : [],
    aliasMapFile: typeof values['alias-map'] === 'string' ? values['alias-map'] : null,
    excludeEmergy: Boolean(values['exclude-emergy']),
    autoPatchPolicy,
    apply: Boolean(values.apply),
    processPoolFile:
      typeof values['process-pool-file'] === 'string' ? values['process-pool-file'] : null,
    tidasMode,
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : '',
  };
}

function parseFlowValidateProcessesFlags(args: string[]): {
  help: boolean;
  json: boolean;
  originalProcessesFile: string;
  patchedProcessesFile: string;
  scopeFlowFiles: string[];
  tidasMode: 'auto' | 'required' | 'skip';
  outDir: string;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        'original-processes-file': { type: 'string' },
        'patched-processes-file': { type: 'string' },
        'scope-flow-file': { type: 'string', multiple: true },
        'tidas-mode': { type: 'string' },
        'out-dir': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  const tidasMode = typeof values['tidas-mode'] === 'string' ? values['tidas-mode'] : 'auto';
  if (tidasMode !== 'auto' && tidasMode !== 'required' && tidasMode !== 'skip') {
    throw new CliError('Expected --tidas-mode to be one of auto, required, or skip.', {
      code: 'INVALID_FLOW_VALIDATE_TIDAS_MODE',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    originalProcessesFile:
      typeof values['original-processes-file'] === 'string'
        ? values['original-processes-file']
        : '',
    patchedProcessesFile:
      typeof values['patched-processes-file'] === 'string' ? values['patched-processes-file'] : '',
    scopeFlowFiles: Array.isArray(values['scope-flow-file'])
      ? values['scope-flow-file'].filter((value): value is string => typeof value === 'string')
      : [],
    tidasMode,
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : '',
  };
}

function parseFlowGetFlags(args: string[]): {
  help: boolean;
  json: boolean;
  flowId: string;
  version: string | null;
  userId: string | null;
  stateCode: number | null;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        id: { type: 'string' },
        version: { type: 'string' },
        'user-id': { type: 'string' },
        'state-code': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  const parseOptionalNonNegativeIntegerFlag = (
    value: unknown,
    label: string,
    code: string,
  ): number | null => {
    if (typeof value !== 'string') {
      return null;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new CliError(`Expected ${label} to be a non-negative integer.`, {
        code,
        exitCode: 2,
      });
    }
    return parsed;
  };

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    flowId: typeof values.id === 'string' ? values.id : '',
    version: typeof values.version === 'string' ? values.version : null,
    userId: typeof values['user-id'] === 'string' ? values['user-id'] : null,
    stateCode: parseOptionalNonNegativeIntegerFlag(
      values['state-code'],
      '--state-code',
      'INVALID_FLOW_GET_STATE_CODE',
    ),
  };
}

function parseFlowFetchRowsFlags(args: string[]): {
  help: boolean;
  json: boolean;
  refsFile: string;
  outDir: string;
  allowLatestFallback: boolean;
  failOnMissing: boolean;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        'refs-file': { type: 'string' },
        'out-dir': { type: 'string' },
        'no-latest-fallback': { type: 'boolean' },
        'fail-on-missing': { type: 'boolean' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    refsFile: typeof values['refs-file'] === 'string' ? values['refs-file'] : '',
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : '',
    allowLatestFallback: values['no-latest-fallback'] !== true,
    failOnMissing: values['fail-on-missing'] === true,
  };
}

function parseFlowMaterializeDecisionsFlags(args: string[]): {
  help: boolean;
  json: boolean;
  decisionFile: string;
  flowRowsFile: string;
  outDir: string;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        'decision-file': { type: 'string' },
        'flow-rows-file': { type: 'string' },
        'out-dir': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    decisionFile: typeof values['decision-file'] === 'string' ? values['decision-file'] : '',
    flowRowsFile: typeof values['flow-rows-file'] === 'string' ? values['flow-rows-file'] : '',
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : '',
  };
}

function parseFlowListFlags(args: string[]): {
  help: boolean;
  json: boolean;
  ids: string[];
  version: string | null;
  userId: string | null;
  stateCodes: number[];
  typeOfDataset: string[];
  limit: number | null;
  offset: number | null;
  all: boolean;
  pageSize: number | null;
  order: string | null;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        id: { type: 'string', multiple: true },
        version: { type: 'string' },
        'user-id': { type: 'string' },
        'state-code': { type: 'string', multiple: true },
        type: { type: 'string', multiple: true },
        'type-of-dataset': { type: 'string', multiple: true },
        limit: { type: 'string' },
        offset: { type: 'string' },
        all: { type: 'boolean' },
        'page-size': { type: 'string' },
        order: { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  const parseOptionalPositiveIntegerFlag = (
    value: unknown,
    label: string,
    code: string,
  ): number | null => {
    if (typeof value !== 'string') {
      return null;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new CliError(`Expected ${label} to be a positive integer.`, {
        code,
        exitCode: 2,
      });
    }
    return parsed;
  };

  const parseOptionalNonNegativeIntegerFlag = (
    value: unknown,
    label: string,
    code: string,
  ): number | null => {
    if (typeof value !== 'string') {
      return null;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new CliError(`Expected ${label} to be a non-negative integer.`, {
        code,
        exitCode: 2,
      });
    }
    return parsed;
  };

  const parseStateCodeValues = (value: unknown): number[] => {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((entry) => {
      const parsed = Number.parseInt(String(entry), 10);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new CliError('Expected --state-code to be a non-negative integer.', {
          code: 'INVALID_FLOW_LIST_STATE_CODE',
          exitCode: 2,
        });
      }
      return parsed;
    });
  };
  const toStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

  if (values['page-size'] !== undefined && !values.all) {
    throw new CliError('Use --page-size only with --all.', {
      code: 'FLOW_LIST_PAGE_SIZE_REQUIRES_ALL',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    ids: toStringArray(values.id),
    version: typeof values.version === 'string' ? values.version : null,
    userId: typeof values['user-id'] === 'string' ? values['user-id'] : null,
    stateCodes: parseStateCodeValues(values['state-code']),
    typeOfDataset: [...toStringArray(values['type-of-dataset']), ...toStringArray(values.type)],
    limit: parseOptionalPositiveIntegerFlag(values.limit, '--limit', 'INVALID_FLOW_LIST_LIMIT'),
    offset: parseOptionalNonNegativeIntegerFlag(
      values.offset,
      '--offset',
      'INVALID_FLOW_LIST_OFFSET',
    ),
    all: Boolean(values.all),
    pageSize: parseOptionalPositiveIntegerFlag(
      values['page-size'],
      '--page-size',
      'INVALID_FLOW_LIST_PAGE_SIZE',
    ),
    order: typeof values.order === 'string' ? values.order : null,
  };
}

function parseReviewProcessFlags(args: string[]): {
  help: boolean;
  json: boolean;
  runRoot: string;
  runId: string;
  outDir: string;
  startTs: string | undefined;
  endTs: string | undefined;
  logicVersion: string | undefined;
  enableLlm: boolean;
  llmModel: string | undefined;
  llmMaxProcesses: number | undefined;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        'run-root': { type: 'string' },
        'run-id': { type: 'string' },
        'out-dir': { type: 'string' },
        'start-ts': { type: 'string' },
        'end-ts': { type: 'string' },
        'logic-version': { type: 'string' },
        'enable-llm': { type: 'boolean' },
        'llm-model': { type: 'string' },
        'llm-max-processes': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  const llmMaxProcessesValue =
    typeof values['llm-max-processes'] === 'string'
      ? Number.parseInt(values['llm-max-processes'], 10)
      : undefined;

  if (
    values['llm-max-processes'] !== undefined &&
    (!Number.isInteger(llmMaxProcessesValue) || (llmMaxProcessesValue as number) <= 0)
  ) {
    throw new CliError('Expected --llm-max-processes to be a positive integer.', {
      code: 'INVALID_LLM_MAX_PROCESSES',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    runRoot: typeof values['run-root'] === 'string' ? values['run-root'] : '',
    runId: typeof values['run-id'] === 'string' ? values['run-id'] : '',
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : '',
    startTs: typeof values['start-ts'] === 'string' ? values['start-ts'] : undefined,
    endTs: typeof values['end-ts'] === 'string' ? values['end-ts'] : undefined,
    logicVersion: typeof values['logic-version'] === 'string' ? values['logic-version'] : undefined,
    enableLlm: Boolean(values['enable-llm']),
    llmModel: typeof values['llm-model'] === 'string' ? values['llm-model'] : undefined,
    llmMaxProcesses: llmMaxProcessesValue,
  };
}

function parseReviewFlowFlags(args: string[]): {
  help: boolean;
  json: boolean;
  rowsFile: string | undefined;
  flowsDir: string | undefined;
  runRoot: string | undefined;
  runId: string | undefined;
  outDir: string;
  startTs: string | undefined;
  endTs: string | undefined;
  logicVersion: string | undefined;
  enableLlm: boolean;
  llmModel: string | undefined;
  llmMaxFlows: number | undefined;
  llmBatchSize: number | undefined;
  similarityThreshold: number | undefined;
  methodologyId: string | undefined;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        'rows-file': { type: 'string' },
        'flows-dir': { type: 'string' },
        'run-root': { type: 'string' },
        'run-id': { type: 'string' },
        'out-dir': { type: 'string' },
        'start-ts': { type: 'string' },
        'end-ts': { type: 'string' },
        'logic-version': { type: 'string' },
        'enable-llm': { type: 'boolean' },
        'llm-model': { type: 'string' },
        'llm-max-flows': { type: 'string' },
        'llm-batch-size': { type: 'string' },
        'similarity-threshold': { type: 'string' },
        'methodology-id': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  const parsePositiveIntegerFlag = (
    value: unknown,
    label: string,
    code: string,
  ): number | undefined => {
    if (typeof value !== 'string') {
      return undefined;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new CliError(`Expected ${label} to be a positive integer.`, {
        code,
        exitCode: 2,
      });
    }
    return parsed;
  };

  const similarityThreshold =
    typeof values['similarity-threshold'] === 'string'
      ? Number.parseFloat(values['similarity-threshold'])
      : undefined;
  if (
    values['similarity-threshold'] !== undefined &&
    (!Number.isFinite(similarityThreshold) || (similarityThreshold as number) <= 0)
  ) {
    throw new CliError('Expected --similarity-threshold to be a positive number.', {
      code: 'INVALID_SIMILARITY_THRESHOLD',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    rowsFile: typeof values['rows-file'] === 'string' ? values['rows-file'] : undefined,
    flowsDir: typeof values['flows-dir'] === 'string' ? values['flows-dir'] : undefined,
    runRoot: typeof values['run-root'] === 'string' ? values['run-root'] : undefined,
    runId: typeof values['run-id'] === 'string' ? values['run-id'] : undefined,
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : '',
    startTs: typeof values['start-ts'] === 'string' ? values['start-ts'] : undefined,
    endTs: typeof values['end-ts'] === 'string' ? values['end-ts'] : undefined,
    logicVersion: typeof values['logic-version'] === 'string' ? values['logic-version'] : undefined,
    enableLlm: Boolean(values['enable-llm']),
    llmModel: typeof values['llm-model'] === 'string' ? values['llm-model'] : undefined,
    llmMaxFlows: parsePositiveIntegerFlag(
      values['llm-max-flows'],
      '--llm-max-flows',
      'INVALID_LLM_MAX_FLOWS',
    ),
    llmBatchSize: parsePositiveIntegerFlag(
      values['llm-batch-size'],
      '--llm-batch-size',
      'INVALID_LLM_BATCH_SIZE',
    ),
    similarityThreshold,
    methodologyId:
      typeof values['methodology-id'] === 'string' ? values['methodology-id'] : undefined,
  };
}

function parseReviewLifecyclemodelFlags(args: string[]): {
  help: boolean;
  json: boolean;
  runDir: string;
  outDir: string;
  startTs: string | undefined;
  endTs: string | undefined;
  logicVersion: string | undefined;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        'run-dir': { type: 'string' },
        'out-dir': { type: 'string' },
        'start-ts': { type: 'string' },
        'end-ts': { type: 'string' },
        'logic-version': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    runDir: typeof values['run-dir'] === 'string' ? values['run-dir'] : '',
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : '',
    startTs: typeof values['start-ts'] === 'string' ? values['start-ts'] : undefined,
    endTs: typeof values['end-ts'] === 'string' ? values['end-ts'] : undefined,
    logicVersion: typeof values['logic-version'] === 'string' ? values['logic-version'] : undefined,
  };
}

function parseLifecyclemodelPublishFlags(args: string[]): {
  help: boolean;
  json: boolean;
  runDir: string;
  publishProcesses: boolean;
  publishRelations: boolean;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        'run-dir': { type: 'string' },
        'publish-processes': { type: 'boolean' },
        'publish-relations': { type: 'boolean' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    runDir: typeof values['run-dir'] === 'string' ? values['run-dir'] : '',
    publishProcesses: Boolean(values['publish-processes']),
    publishRelations: Boolean(values['publish-relations']),
  };
}

function parseLifecyclemodelValidateBuildFlags(args: string[]): {
  help: boolean;
  json: boolean;
  runDir: string;
  engine: string | undefined;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        'run-dir': { type: 'string' },
        engine: { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    runDir: typeof values['run-dir'] === 'string' ? values['run-dir'] : '',
    engine: typeof values.engine === 'string' ? values.engine : undefined,
  };
}

function parseLifecyclemodelPublishBuildFlags(args: string[]): {
  help: boolean;
  json: boolean;
  runDir: string;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        'run-dir': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    runDir: typeof values['run-dir'] === 'string' ? values['run-dir'] : '',
  };
}

function parseLifecyclemodelBuildFlags(args: string[]): {
  help: boolean;
  json: boolean;
  inputPath: string;
  outDir: string | null;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        input: { type: 'string' },
        'out-dir': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    inputPath: typeof values.input === 'string' ? values.input : '',
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : null,
  };
}

function parseLifecyclemodelOrchestrateFlags(args: string[]): {
  help: boolean;
  json: boolean;
  action: string;
  inputPath: string;
  outDir: string | null;
  runDir: string;
  allowProcessBuild: boolean;
  allowSubmodelBuild: boolean;
  publishLifecyclemodels: boolean;
  publishResultingProcessRelations: boolean;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        input: { type: 'string' },
        request: { type: 'string' },
        'out-dir': { type: 'string' },
        'run-dir': { type: 'string' },
        'allow-process-build': { type: 'boolean' },
        'allow-submodel-build': { type: 'boolean' },
        'publish-lifecyclemodels': { type: 'boolean' },
        'publish-resulting-process-relations': { type: 'boolean' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  const inputAlias = typeof values.request === 'string' ? values.request : '';
  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    action: positionals[0] ?? '',
    inputPath: typeof values.input === 'string' ? values.input : inputAlias,
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : null,
    runDir: typeof values['run-dir'] === 'string' ? values['run-dir'] : '',
    allowProcessBuild: Boolean(values['allow-process-build']),
    allowSubmodelBuild: Boolean(values['allow-submodel-build']),
    publishLifecyclemodels: Boolean(values['publish-lifecyclemodels']),
    publishResultingProcessRelations: Boolean(values['publish-resulting-process-relations']),
  };
}

function parseProcessAutoBuildFlags(args: string[]): {
  help: boolean;
  json: boolean;
  inputPath: string;
  outDir: string | null;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        input: { type: 'string' },
        'out-dir': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    inputPath: typeof values.input === 'string' ? values.input : '',
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : null,
  };
}

function parseProcessGetFlags(args: string[]): {
  help: boolean;
  json: boolean;
  processId: string;
  version: string | null;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        id: { type: 'string' },
        version: { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    processId: typeof values.id === 'string' ? values.id : '',
    version: typeof values.version === 'string' ? values.version : null,
  };
}

function parseProcessResumeBuildFlags(args: string[]): {
  help: boolean;
  json: boolean;
  runId: string;
  runDir: string | null;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        'run-id': { type: 'string' },
        'run-dir': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    runId: typeof values['run-id'] === 'string' ? values['run-id'] : '',
    runDir: typeof values['run-dir'] === 'string' ? values['run-dir'] : null,
  };
}

function parseProcessPublishBuildFlags(args: string[]): {
  help: boolean;
  json: boolean;
  runId: string;
  runDir: string | null;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        'run-id': { type: 'string' },
        'run-dir': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    runId: typeof values['run-id'] === 'string' ? values['run-id'] : '',
    runDir: typeof values['run-dir'] === 'string' ? values['run-dir'] : null,
  };
}

function parseProcessBatchBuildFlags(args: string[]): {
  help: boolean;
  json: boolean;
  inputPath: string;
  outDir: string | null;
} {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        input: { type: 'string' },
        'out-dir': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    inputPath: typeof values.input === 'string' ? values.input : '',
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : null,
  };
}

function plannedCommand(command: string, subcommand?: string): CliResult {
  const suffix = subcommand ? ` ${subcommand}` : '';
  return {
    exitCode: 2,
    stdout: '',
    stderr: `Command '${command}${suffix}' is part of the planned unified surface but is not implemented yet.\n`,
  };
}

function applyRemoteOverrides(
  env: NodeJS.ProcessEnv,
  overrides: Pick<ReturnType<typeof parseRemoteFlags>, 'apiBaseUrl' | 'apiKey' | 'region'>,
) {
  const runtimeEnv = readRuntimeEnv(env);

  return {
    ...env,
    TIANGONG_LCA_API_BASE_URL: overrides.apiBaseUrl ?? runtimeEnv.apiBaseUrl ?? undefined,
    TIANGONG_LCA_API_KEY: overrides.apiKey ?? runtimeEnv.apiKey ?? undefined,
    TIANGONG_LCA_REGION: overrides.region ?? runtimeEnv.region,
  } satisfies NodeJS.ProcessEnv;
}

export async function executeCli(argv: string[], deps: CliDeps): Promise<CliResult> {
  try {
    const { flags, command, subcommand, commandArgs } = parseCommandLine(argv);
    const publishImpl = deps.runPublishImpl ?? runPublish;
    const validationImpl = deps.runValidationImpl ?? runValidation;
    const lifecyclemodelAutoBuildImpl =
      deps.runLifecyclemodelAutoBuildImpl ?? runLifecyclemodelAutoBuild;
    const lifecyclemodelBuildImpl =
      deps.runLifecyclemodelBuildResultingProcessImpl ?? runLifecyclemodelBuildResultingProcess;
    const lifecyclemodelPublishImpl =
      deps.runLifecyclemodelPublishResultingProcessImpl ?? runLifecyclemodelPublishResultingProcess;
    const lifecyclemodelValidateImpl =
      deps.runLifecyclemodelValidateBuildImpl ?? runLifecyclemodelValidateBuild;
    const lifecyclemodelPublishBuildImpl =
      deps.runLifecyclemodelPublishBuildImpl ?? runLifecyclemodelPublishBuild;
    const lifecyclemodelOrchestrateImpl =
      deps.runLifecyclemodelOrchestrateImpl ?? runLifecyclemodelOrchestrate;
    const processGetImpl = deps.runProcessGetImpl ?? runProcessGet;
    const processAutoBuildImpl = deps.runProcessAutoBuildImpl ?? runProcessAutoBuild;
    const processBatchBuildImpl = deps.runProcessBatchBuildImpl ?? runProcessBatchBuild;
    const processResumeBuildImpl = deps.runProcessResumeBuildImpl ?? runProcessResumeBuild;
    const processPublishBuildImpl = deps.runProcessPublishBuildImpl ?? runProcessPublishBuild;
    const processReviewImpl = deps.runProcessReviewImpl ?? runProcessReview;
    const flowReviewImpl = deps.runFlowReviewImpl ?? runFlowReview;
    const lifecyclemodelReviewImpl = deps.runLifecyclemodelReviewImpl ?? runLifecyclemodelReview;
    const flowRemediateImpl = deps.runFlowRemediateImpl ?? runFlowRemediate;
    const flowFetchRowsImpl = deps.runFlowFetchRowsImpl ?? runFlowFetchRows;
    const flowMaterializeDecisionsImpl =
      deps.runFlowMaterializeDecisionsImpl ?? runFlowMaterializeDecisions;
    const flowGetImpl = deps.runFlowGetImpl ?? runFlowGet;
    const flowListImpl = deps.runFlowListImpl ?? runFlowList;
    const flowPublishVersionImpl = deps.runFlowPublishVersionImpl ?? runFlowPublishVersion;
    const flowReviewedPublishDataImpl =
      deps.runFlowReviewedPublishDataImpl ?? runFlowReviewedPublishData;
    const flowBuildAliasMapImpl = deps.runFlowBuildAliasMapImpl ?? runFlowBuildAliasMap;
    const flowScanProcessFlowRefsImpl =
      deps.runFlowScanProcessFlowRefsImpl ?? runFlowScanProcessFlowRefs;
    const flowPlanProcessFlowRepairsImpl =
      deps.runFlowPlanProcessFlowRepairsImpl ?? runFlowPlanProcessFlowRepairs;
    const flowApplyProcessFlowRepairsImpl =
      deps.runFlowApplyProcessFlowRepairsImpl ?? runFlowApplyProcessFlowRepairs;
    const flowRegenProductImpl = deps.runFlowRegenProductImpl ?? runFlowRegenProduct;
    const flowValidateProcessesImpl = deps.runFlowValidateProcessesImpl ?? runFlowValidateProcesses;

    if (flags.version) {
      return { exitCode: 0, stdout: '0.0.1\n', stderr: '' };
    }

    if (!command || command === 'help' || flags.help) {
      return { exitCode: 0, stdout: `${renderMainHelp(deps.dotEnvStatus)}\n`, stderr: '' };
    }

    if (command === 'doctor') {
      const doctorFlags = parseDoctorFlags(commandArgs);
      if (doctorFlags.help) {
        return { exitCode: 0, stdout: `${renderDoctorHelp()}\n`, stderr: '' };
      }
      const report = buildDoctorReport(deps.env, deps.dotEnvStatus);
      return {
        exitCode: report.ok ? 0 : 1,
        stdout: doctorFlags.json ? `${JSON.stringify(report)}\n` : renderDoctorText(report),
        stderr: '',
      };
    }

    if (command === 'search' && !subcommand && commandArgs.includes('--help')) {
      return { exitCode: 0, stdout: `${renderSearchHelp()}\n`, stderr: '' };
    }

    if (command === 'search' && subcommand) {
      const remoteFlags = parseRemoteFlags(commandArgs);
      const commandKey = `search:${subcommand}` as const;
      if (remoteFlags.help) {
        return { exitCode: 0, stdout: `${getRemoteCommandHelp(commandKey)}\n`, stderr: '' };
      }
      const env = applyRemoteOverrides(deps.env, remoteFlags);

      return {
        exitCode: 0,
        stdout: await executeRemoteCommand({
          commandKey,
          inputPath: remoteFlags.inputPath,
          env,
          timeoutMs: remoteFlags.timeoutMs,
          dryRun: remoteFlags.dryRun,
          compactJson: remoteFlags.json,
          fetchImpl: deps.fetchImpl,
        }),
        stderr: '',
      };
    }

    if (command === 'lifecyclemodel' && !subcommand) {
      return { exitCode: 0, stdout: `${renderLifecyclemodelHelp()}\n`, stderr: '' };
    }

    if (command === 'lifecyclemodel' && subcommand === 'auto-build') {
      const lifecyclemodelFlags = parseLifecyclemodelBuildFlags(commandArgs);
      if (lifecyclemodelFlags.help) {
        return {
          exitCode: 0,
          stdout: `${renderLifecyclemodelAutoBuildHelp()}\n`,
          stderr: '',
        };
      }

      const report = await lifecyclemodelAutoBuildImpl({
        inputPath: lifecyclemodelFlags.inputPath,
        outDir: lifecyclemodelFlags.outDir,
        cwd: process.cwd(),
      });

      return {
        exitCode: 0,
        stdout: stringifyJson(report, lifecyclemodelFlags.json),
        stderr: '',
      };
    }

    if (command === 'lifecyclemodel' && subcommand === 'build-resulting-process') {
      const lifecyclemodelFlags = parseLifecyclemodelBuildFlags(commandArgs);
      if (lifecyclemodelFlags.help) {
        return {
          exitCode: 0,
          stdout: `${renderLifecyclemodelBuildResultingProcessHelp()}\n`,
          stderr: '',
        };
      }

      const report = await lifecyclemodelBuildImpl({
        inputPath: lifecyclemodelFlags.inputPath,
        outDir: lifecyclemodelFlags.outDir,
        env: deps.env,
        fetchImpl: deps.fetchImpl,
      });

      return {
        exitCode: 0,
        stdout: stringifyJson(report, lifecyclemodelFlags.json),
        stderr: '',
      };
    }

    if (command === 'lifecyclemodel' && subcommand === 'publish-resulting-process') {
      const lifecyclemodelFlags = parseLifecyclemodelPublishFlags(commandArgs);
      if (lifecyclemodelFlags.help) {
        return {
          exitCode: 0,
          stdout: `${renderLifecyclemodelPublishResultingProcessHelp()}\n`,
          stderr: '',
        };
      }

      const report = await lifecyclemodelPublishImpl({
        runDir: lifecyclemodelFlags.runDir,
        publishProcesses: lifecyclemodelFlags.publishProcesses,
        publishRelations: lifecyclemodelFlags.publishRelations,
      });

      return {
        exitCode: 0,
        stdout: stringifyJson(report, lifecyclemodelFlags.json),
        stderr: '',
      };
    }

    if (command === 'lifecyclemodel' && subcommand === 'validate-build') {
      const lifecyclemodelFlags = parseLifecyclemodelValidateBuildFlags(commandArgs);
      if (lifecyclemodelFlags.help) {
        return {
          exitCode: 0,
          stdout: `${renderLifecyclemodelValidateBuildHelp()}\n`,
          stderr: '',
        };
      }

      const report = await lifecyclemodelValidateImpl({
        runDir: lifecyclemodelFlags.runDir,
        engine: lifecyclemodelFlags.engine,
        cwd: process.cwd(),
      });

      return {
        exitCode: report.ok ? 0 : 1,
        stdout: stringifyJson(report, lifecyclemodelFlags.json),
        stderr: '',
      };
    }

    if (command === 'lifecyclemodel' && subcommand === 'publish-build') {
      const lifecyclemodelFlags = parseLifecyclemodelPublishBuildFlags(commandArgs);
      if (lifecyclemodelFlags.help) {
        return {
          exitCode: 0,
          stdout: `${renderLifecyclemodelPublishBuildHelp()}\n`,
          stderr: '',
        };
      }

      const report = await lifecyclemodelPublishBuildImpl({
        runDir: lifecyclemodelFlags.runDir,
        cwd: process.cwd(),
      });

      return {
        exitCode: 0,
        stdout: stringifyJson(report, lifecyclemodelFlags.json),
        stderr: '',
      };
    }

    if (command === 'lifecyclemodel' && subcommand === 'orchestrate') {
      const lifecyclemodelFlags = parseLifecyclemodelOrchestrateFlags(commandArgs);
      if (lifecyclemodelFlags.help || !lifecyclemodelFlags.action) {
        return {
          exitCode: 0,
          stdout: `${renderLifecyclemodelOrchestrateHelp()}\n`,
          stderr: '',
        };
      }
      if (
        lifecyclemodelFlags.action !== 'plan' &&
        lifecyclemodelFlags.action !== 'execute' &&
        lifecyclemodelFlags.action !== 'publish'
      ) {
        throw new CliError(
          "lifecyclemodel orchestrate action must be 'plan', 'execute', or 'publish'.",
          {
            code: 'INVALID_ARGS',
            exitCode: 2,
          },
        );
      }

      const report = await lifecyclemodelOrchestrateImpl({
        action: lifecyclemodelFlags.action,
        inputPath: lifecyclemodelFlags.inputPath,
        outDir: lifecyclemodelFlags.outDir,
        runDir: lifecyclemodelFlags.runDir,
        allowProcessBuild: lifecyclemodelFlags.allowProcessBuild,
        allowSubmodelBuild: lifecyclemodelFlags.allowSubmodelBuild,
        publishLifecyclemodels: lifecyclemodelFlags.publishLifecyclemodels,
        publishResultingProcessRelations: lifecyclemodelFlags.publishResultingProcessRelations,
        env: deps.env,
        fetchImpl: deps.fetchImpl,
      });

      return {
        exitCode: report.action === 'execute' && report.status !== 'completed' ? 1 : 0,
        stdout: stringifyJson(report, lifecyclemodelFlags.json),
        stderr: '',
      };
    }

    if (command === 'process' && !subcommand) {
      return { exitCode: 0, stdout: `${renderProcessHelp()}\n`, stderr: '' };
    }

    if (command === 'process' && subcommand === 'get') {
      const processFlags = parseProcessGetFlags(commandArgs);
      if (processFlags.help) {
        return {
          exitCode: 0,
          stdout: `${renderProcessGetHelp()}\n`,
          stderr: '',
        };
      }

      const report = await processGetImpl({
        processId: processFlags.processId,
        version: processFlags.version,
        env: deps.env,
        fetchImpl: deps.fetchImpl,
      });

      return {
        exitCode: 0,
        stdout: stringifyJson(report, processFlags.json),
        stderr: '',
      };
    }

    if (command === 'process' && subcommand === 'auto-build') {
      const processFlags = parseProcessAutoBuildFlags(commandArgs);
      if (processFlags.help) {
        return {
          exitCode: 0,
          stdout: `${renderProcessAutoBuildHelp()}\n`,
          stderr: '',
        };
      }

      const report = await processAutoBuildImpl({
        inputPath: processFlags.inputPath,
        outDir: processFlags.outDir,
      });

      return {
        exitCode: 0,
        stdout: stringifyJson(report, processFlags.json),
        stderr: '',
      };
    }

    if (command === 'process' && subcommand === 'resume-build') {
      const processFlags = parseProcessResumeBuildFlags(commandArgs);
      if (processFlags.help) {
        return {
          exitCode: 0,
          stdout: `${renderProcessResumeBuildHelp()}\n`,
          stderr: '',
        };
      }

      const report = await processResumeBuildImpl({
        runId: processFlags.runId || undefined,
        runDir: processFlags.runDir,
      });

      return {
        exitCode: 0,
        stdout: stringifyJson(report, processFlags.json),
        stderr: '',
      };
    }

    if (command === 'process' && subcommand === 'publish-build') {
      const processFlags = parseProcessPublishBuildFlags(commandArgs);
      if (processFlags.help) {
        return {
          exitCode: 0,
          stdout: `${renderProcessPublishBuildHelp()}\n`,
          stderr: '',
        };
      }

      const report = await processPublishBuildImpl({
        runId: processFlags.runId || undefined,
        runDir: processFlags.runDir,
      });

      return {
        exitCode: 0,
        stdout: stringifyJson(report, processFlags.json),
        stderr: '',
      };
    }

    if (command === 'process' && subcommand === 'batch-build') {
      const processFlags = parseProcessBatchBuildFlags(commandArgs);
      if (processFlags.help) {
        return {
          exitCode: 0,
          stdout: `${renderProcessBatchBuildHelp()}\n`,
          stderr: '',
        };
      }

      const report = await processBatchBuildImpl({
        inputPath: processFlags.inputPath,
        outDir: processFlags.outDir,
      });

      return {
        exitCode: report.status === 'completed_with_failures' ? 1 : 0,
        stdout: stringifyJson(report, processFlags.json),
        stderr: '',
      };
    }

    if (command === 'flow' && !subcommand) {
      return { exitCode: 0, stdout: `${renderFlowHelp()}\n`, stderr: '' };
    }

    if (command === 'flow' && subcommand === 'get') {
      const flowFlags = parseFlowGetFlags(commandArgs);
      if (flowFlags.help) {
        return { exitCode: 0, stdout: `${renderFlowGetHelp()}\n`, stderr: '' };
      }

      const report = await flowGetImpl({
        flowId: flowFlags.flowId,
        version: flowFlags.version,
        userId: flowFlags.userId,
        stateCode: flowFlags.stateCode,
        env: deps.env,
        fetchImpl: deps.fetchImpl,
      });

      return {
        exitCode: 0,
        stdout: stringifyJson(report, flowFlags.json),
        stderr: '',
      };
    }

    if (command === 'flow' && subcommand === 'list') {
      const flowFlags = parseFlowListFlags(commandArgs);
      if (flowFlags.help) {
        return { exitCode: 0, stdout: `${renderFlowListHelp()}\n`, stderr: '' };
      }

      const report = await flowListImpl({
        ids: flowFlags.ids,
        version: flowFlags.version,
        userId: flowFlags.userId,
        stateCodes: flowFlags.stateCodes,
        typeOfDataset: flowFlags.typeOfDataset,
        limit: flowFlags.limit,
        offset: flowFlags.offset,
        all: flowFlags.all,
        pageSize: flowFlags.pageSize,
        order: flowFlags.order,
        env: deps.env,
        fetchImpl: deps.fetchImpl,
      });

      return {
        exitCode: 0,
        stdout: stringifyJson(report, flowFlags.json),
        stderr: '',
      };
    }

    if (command === 'flow' && subcommand === 'remediate') {
      const flowFlags = parseFlowRemediateFlags(commandArgs);
      if (flowFlags.help) {
        return { exitCode: 0, stdout: `${renderFlowRemediateHelp()}\n`, stderr: '' };
      }

      const report = await flowRemediateImpl({
        inputFile: flowFlags.inputFile,
        outDir: flowFlags.outDir,
      });

      return {
        exitCode: 0,
        stdout: stringifyJson(report, flowFlags.json),
        stderr: '',
      };
    }

    if (command === 'flow' && subcommand === 'fetch-rows') {
      const flowFlags = parseFlowFetchRowsFlags(commandArgs);
      if (flowFlags.help) {
        return { exitCode: 0, stdout: `${renderFlowFetchRowsHelp()}\n`, stderr: '' };
      }

      const report = await flowFetchRowsImpl({
        refsFile: flowFlags.refsFile,
        outDir: flowFlags.outDir,
        allowLatestFallback: flowFlags.allowLatestFallback,
        env: deps.env,
        fetchImpl: deps.fetchImpl,
      });

      return {
        exitCode:
          flowFlags.failOnMissing &&
          report.status === 'completed_flow_row_materialization_with_gaps'
            ? 1
            : 0,
        stdout: stringifyJson(report, flowFlags.json),
        stderr: '',
      };
    }

    if (command === 'flow' && subcommand === 'materialize-decisions') {
      const flowFlags = parseFlowMaterializeDecisionsFlags(commandArgs);
      if (flowFlags.help) {
        return {
          exitCode: 0,
          stdout: `${renderFlowMaterializeDecisionsHelp()}\n`,
          stderr: '',
        };
      }

      const report = await flowMaterializeDecisionsImpl({
        decisionFile: flowFlags.decisionFile,
        flowRowsFile: flowFlags.flowRowsFile,
        outDir: flowFlags.outDir,
      });

      return {
        exitCode: 0,
        stdout: stringifyJson(report, flowFlags.json),
        stderr: '',
      };
    }

    if (command === 'flow' && subcommand === 'publish-version') {
      const flowFlags = parseFlowPublishVersionFlags(commandArgs);
      if (flowFlags.help) {
        return { exitCode: 0, stdout: `${renderFlowPublishVersionHelp()}\n`, stderr: '' };
      }

      const report = await flowPublishVersionImpl({
        inputFile: flowFlags.inputFile,
        outDir: flowFlags.outDir,
        commit: flowFlags.commit,
        maxWorkers: flowFlags.maxWorkers,
        limit: flowFlags.limit,
        targetUserId: flowFlags.targetUserId,
        env: deps.env,
        fetchImpl: deps.fetchImpl,
      });

      return {
        exitCode: report.status === 'completed_flow_publish_version_with_failures' ? 1 : 0,
        stdout: stringifyJson(report, flowFlags.json),
        stderr: '',
      };
    }

    if (command === 'flow' && subcommand === 'publish-reviewed-data') {
      const flowFlags = parseFlowPublishReviewedDataFlags(commandArgs);
      if (flowFlags.help) {
        return { exitCode: 0, stdout: `${renderFlowPublishReviewedDataHelp()}\n`, stderr: '' };
      }

      const report = await flowReviewedPublishDataImpl({
        flowRowsFile: flowFlags.flowRowsFile,
        originalFlowRowsFile: flowFlags.originalFlowRowsFile,
        processRowsFile: flowFlags.processRowsFile,
        outDir: flowFlags.outDir,
        flowPublishPolicy: flowFlags.flowPublishPolicy,
        processPublishPolicy: flowFlags.processPublishPolicy,
        rewriteProcessFlowRefs: flowFlags.rewriteProcessFlowRefs,
        commit: flowFlags.commit,
        maxWorkers: flowFlags.maxWorkers,
        targetUserId: flowFlags.targetUserId,
        env: deps.env,
        fetchImpl: deps.fetchImpl,
      });

      return {
        exitCode: report.status === 'completed_flow_publish_reviewed_data_with_failures' ? 1 : 0,
        stdout: stringifyJson(report, flowFlags.json),
        stderr: '',
      };
    }

    if (command === 'flow' && subcommand === 'build-alias-map') {
      const flowFlags = parseFlowBuildAliasMapFlags(commandArgs);
      if (flowFlags.help) {
        return { exitCode: 0, stdout: `${renderFlowBuildAliasMapHelp()}\n`, stderr: '' };
      }

      const report = await flowBuildAliasMapImpl({
        oldFlowFiles: flowFlags.oldFlowFiles,
        newFlowFiles: flowFlags.newFlowFiles,
        seedAliasMapFile: flowFlags.seedAliasMapFile,
        outDir: flowFlags.outDir,
      });

      return {
        exitCode: 0,
        stdout: stringifyJson(report, flowFlags.json),
        stderr: '',
      };
    }

    if (command === 'flow' && subcommand === 'scan-process-flow-refs') {
      const flowFlags = parseFlowScanProcessFlowRefsFlags(commandArgs);
      if (flowFlags.help) {
        return { exitCode: 0, stdout: `${renderFlowScanProcessFlowRefsHelp()}\n`, stderr: '' };
      }

      const report = await flowScanProcessFlowRefsImpl({
        processesFile: flowFlags.processesFile,
        scopeFlowFiles: flowFlags.scopeFlowFiles,
        catalogFlowFiles: flowFlags.catalogFlowFiles,
        aliasMapFile: flowFlags.aliasMapFile,
        excludeEmergy: flowFlags.excludeEmergy,
        outDir: flowFlags.outDir,
      });

      return {
        exitCode: 0,
        stdout: stringifyJson(report, flowFlags.json),
        stderr: '',
      };
    }

    if (command === 'flow' && subcommand === 'plan-process-flow-repairs') {
      const flowFlags = parseFlowPlanProcessFlowRepairsFlags(commandArgs);
      if (flowFlags.help) {
        return {
          exitCode: 0,
          stdout: `${renderFlowPlanProcessFlowRepairsHelp()}\n`,
          stderr: '',
        };
      }

      const report = await flowPlanProcessFlowRepairsImpl({
        processesFile: flowFlags.processesFile,
        scopeFlowFiles: flowFlags.scopeFlowFiles,
        aliasMapFile: flowFlags.aliasMapFile,
        scanFindingsFile: flowFlags.scanFindingsFile,
        autoPatchPolicy: flowFlags.autoPatchPolicy,
        outDir: flowFlags.outDir,
      });

      return {
        exitCode: 0,
        stdout: stringifyJson(report, flowFlags.json),
        stderr: '',
      };
    }

    if (command === 'flow' && subcommand === 'apply-process-flow-repairs') {
      const flowFlags = parseFlowApplyProcessFlowRepairsFlags(commandArgs);
      if (flowFlags.help) {
        return {
          exitCode: 0,
          stdout: `${renderFlowApplyProcessFlowRepairsHelp()}\n`,
          stderr: '',
        };
      }

      const report = await flowApplyProcessFlowRepairsImpl({
        processesFile: flowFlags.processesFile,
        scopeFlowFiles: flowFlags.scopeFlowFiles,
        aliasMapFile: flowFlags.aliasMapFile,
        scanFindingsFile: flowFlags.scanFindingsFile,
        autoPatchPolicy: flowFlags.autoPatchPolicy,
        processPoolFile: flowFlags.processPoolFile,
        outDir: flowFlags.outDir,
      });

      return {
        exitCode: 0,
        stdout: stringifyJson(report, flowFlags.json),
        stderr: '',
      };
    }

    if (command === 'flow' && subcommand === 'regen-product') {
      const flowFlags = parseFlowRegenProductFlags(commandArgs);
      if (flowFlags.help) {
        return { exitCode: 0, stdout: `${renderFlowRegenProductHelp()}\n`, stderr: '' };
      }

      const report = await flowRegenProductImpl({
        processesFile: flowFlags.processesFile,
        scopeFlowFiles: flowFlags.scopeFlowFiles,
        catalogFlowFiles: flowFlags.catalogFlowFiles,
        aliasMapFile: flowFlags.aliasMapFile,
        excludeEmergy: flowFlags.excludeEmergy,
        autoPatchPolicy: flowFlags.autoPatchPolicy,
        apply: flowFlags.apply,
        processPoolFile: flowFlags.processPoolFile,
        tidasMode: flowFlags.tidasMode,
        outDir: flowFlags.outDir,
      });

      return {
        exitCode: report.validation.ok === false ? 1 : 0,
        stdout: stringifyJson(report, flowFlags.json),
        stderr: '',
      };
    }

    if (command === 'flow' && subcommand === 'validate-processes') {
      const flowFlags = parseFlowValidateProcessesFlags(commandArgs);
      if (flowFlags.help) {
        return { exitCode: 0, stdout: `${renderFlowValidateProcessesHelp()}\n`, stderr: '' };
      }

      const report = await flowValidateProcessesImpl({
        originalProcessesFile: flowFlags.originalProcessesFile,
        patchedProcessesFile: flowFlags.patchedProcessesFile,
        scopeFlowFiles: flowFlags.scopeFlowFiles,
        tidasMode: flowFlags.tidasMode,
        outDir: flowFlags.outDir,
      });

      return {
        exitCode: report.summary.failed > 0 ? 1 : 0,
        stdout: stringifyJson(report, flowFlags.json),
        stderr: '',
      };
    }

    if (command === 'admin' && !subcommand && commandArgs.includes('--help')) {
      return { exitCode: 0, stdout: `${renderAdminHelp()}\n`, stderr: '' };
    }

    if (command === 'admin' && subcommand === 'embedding-run') {
      const remoteFlags = parseRemoteFlags(commandArgs);
      if (remoteFlags.help) {
        return {
          exitCode: 0,
          stdout: `${getRemoteCommandHelp('admin:embedding-run')}\n`,
          stderr: '',
        };
      }
      const env = applyRemoteOverrides(deps.env, remoteFlags);

      return {
        exitCode: 0,
        stdout: await executeRemoteCommand({
          commandKey: 'admin:embedding-run',
          inputPath: remoteFlags.inputPath,
          env,
          timeoutMs: remoteFlags.timeoutMs,
          dryRun: remoteFlags.dryRun,
          compactJson: remoteFlags.json,
          fetchImpl: deps.fetchImpl,
        }),
        stderr: '',
      };
    }

    if (command === 'publish' && !subcommand && commandArgs.includes('--help')) {
      return { exitCode: 0, stdout: `${renderPublishHelp()}\n`, stderr: '' };
    }

    if (command === 'publish' && subcommand === 'run') {
      const publishFlags = parsePublishFlags(commandArgs);
      if (publishFlags.help) {
        return { exitCode: 0, stdout: `${renderPublishHelp()}\n`, stderr: '' };
      }

      const report = await publishImpl({
        inputPath: publishFlags.inputPath,
        outDir: publishFlags.outDir,
        commit: publishFlags.commitOverride,
        env: deps.env,
        fetchImpl: deps.fetchImpl,
      });

      return {
        exitCode: report.status === 'completed_with_failures' ? 1 : 0,
        stdout: stringifyJson(report, publishFlags.json),
        stderr: '',
      };
    }

    if (command === 'validation' && !subcommand && commandArgs.includes('--help')) {
      return { exitCode: 0, stdout: `${renderValidationHelp()}\n`, stderr: '' };
    }

    if (command === 'validation' && subcommand === 'run') {
      const validationFlags = parseValidationFlags(commandArgs);
      if (validationFlags.help) {
        return { exitCode: 0, stdout: `${renderValidationHelp()}\n`, stderr: '' };
      }

      const report = await validationImpl({
        inputDir: validationFlags.inputDir,
        engine: validationFlags.engine,
        reportFile: validationFlags.reportFile,
      });

      return {
        exitCode: report.ok ? 0 : 1,
        stdout: stringifyJson(report, validationFlags.json),
        stderr: '',
      };
    }

    if (command === 'review' && !subcommand) {
      return { exitCode: 0, stdout: `${renderReviewHelp()}\n`, stderr: '' };
    }

    if (command === 'review' && subcommand === 'process') {
      const reviewFlags = parseReviewProcessFlags(commandArgs);
      if (reviewFlags.help) {
        return { exitCode: 0, stdout: `${renderReviewProcessHelp()}\n`, stderr: '' };
      }

      const report = await processReviewImpl({
        runRoot: reviewFlags.runRoot,
        runId: reviewFlags.runId,
        outDir: reviewFlags.outDir,
        startTs: reviewFlags.startTs,
        endTs: reviewFlags.endTs,
        logicVersion: reviewFlags.logicVersion,
        enableLlm: reviewFlags.enableLlm,
        llmModel: reviewFlags.llmModel,
        llmMaxProcesses: reviewFlags.llmMaxProcesses,
        env: deps.env,
        fetchImpl: deps.fetchImpl,
      });

      return {
        exitCode: 0,
        stdout: stringifyJson(report, reviewFlags.json),
        stderr: '',
      };
    }

    if (command === 'review' && subcommand === 'flow') {
      const reviewFlags = parseReviewFlowFlags(commandArgs);
      if (reviewFlags.help) {
        return { exitCode: 0, stdout: `${renderReviewFlowHelp()}\n`, stderr: '' };
      }

      const report = await flowReviewImpl({
        rowsFile: reviewFlags.rowsFile,
        flowsDir: reviewFlags.flowsDir,
        runRoot: reviewFlags.runRoot,
        runId: reviewFlags.runId,
        outDir: reviewFlags.outDir,
        startTs: reviewFlags.startTs,
        endTs: reviewFlags.endTs,
        logicVersion: reviewFlags.logicVersion,
        enableLlm: reviewFlags.enableLlm,
        llmModel: reviewFlags.llmModel,
        llmMaxFlows: reviewFlags.llmMaxFlows,
        llmBatchSize: reviewFlags.llmBatchSize,
        similarityThreshold: reviewFlags.similarityThreshold,
        methodologyId: reviewFlags.methodologyId,
        env: deps.env,
        fetchImpl: deps.fetchImpl,
      });

      return {
        exitCode: 0,
        stdout: stringifyJson(report, reviewFlags.json),
        stderr: '',
      };
    }

    if (command === 'review' && subcommand === 'lifecyclemodel') {
      const reviewFlags = parseReviewLifecyclemodelFlags(commandArgs);
      if (reviewFlags.help) {
        return { exitCode: 0, stdout: `${renderReviewLifecyclemodelHelp()}\n`, stderr: '' };
      }

      const report = await lifecyclemodelReviewImpl({
        runDir: reviewFlags.runDir,
        outDir: reviewFlags.outDir,
        startTs: reviewFlags.startTs,
        endTs: reviewFlags.endTs,
        logicVersion: reviewFlags.logicVersion,
      });

      return {
        exitCode: 0,
        stdout: stringifyJson(report, reviewFlags.json),
        stderr: '',
      };
    }

    return plannedCommand(command, subcommand ?? undefined);
  } catch (error) {
    const payload = toErrorPayload(error);
    const exitCode = error instanceof CliError ? error.exitCode : 1;
    return {
      exitCode,
      stdout: '',
      stderr: `${JSON.stringify(payload)}\n`,
    };
  }
}
