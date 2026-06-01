import { parseArgs } from 'node:util';
import { buildDoctorReport, readRuntimeEnv } from './lib/env.js';
import type { DotEnvLoadResult } from './lib/dotenv.js';
import { CliError, toErrorPayload } from './lib/errors.js';
import type { FetchLike } from './lib/http.js';
import { stringifyJson } from './lib/io.js';
import { loadCliPackageVersion } from './lib/package-version.js';
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
  runLifecyclemodelSaveDraft,
  type LifecyclemodelSaveDraftReport,
  type RunLifecyclemodelSaveDraftOptions,
} from './lib/lifecyclemodel-save-draft-run.js';
import {
  runLifecyclemodelGraph,
  type LifecyclemodelGraphReport,
  type RunLifecyclemodelGraphOptions,
} from './lib/lifecyclemodel-graph.js';
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
  runProcessList,
  type ProcessListReport,
  type RunProcessListOptions,
} from './lib/process-list.js';
import {
  runProcessBatchBuild,
  type ProcessBatchBuildReport,
  type RunProcessBatchBuildOptions,
} from './lib/process-batch-build.js';
import {
  runProcessScopeStatistics,
  type ProcessScopeStatisticsReport,
  type RunProcessScopeStatisticsOptions,
} from './lib/process-scope-statistics.js';
import {
  runProcessRefreshReferences,
  type ProcessRefreshReferencesReport,
  type RunProcessRefreshReferencesOptions,
} from './lib/process-refresh-references.js';
import {
  runProcessDedupReview,
  type ProcessDedupReviewReport,
  type RunProcessDedupReviewOptions,
} from './lib/process-dedup-review.js';
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
import {
  runProcessSaveDraft,
  type ProcessSaveDraftReport,
  type RunProcessSaveDraftOptions,
} from './lib/process-save-draft-run.js';
import {
  runProcessRequiredFieldsComplete,
  type ProcessRequiredFieldsReport,
  type RunProcessRequiredFieldsCompleteOptions,
} from './lib/process-required-fields.js';
import {
  runProcessVerifyRows,
  type ProcessVerifyRowsReport,
  type RunProcessVerifyRowsOptions,
} from './lib/process-verify-rows.js';
import {
  runFlowBuildPlanMaterialize,
  runFlowBuildPlanValidate,
  runProcessBuildPlanMaterialize,
  runProcessBuildPlanValidate,
  type FlowBuildPlanGateReport,
  type ProcessBuildPlanGateReport,
  type RunFlowBuildPlanMaterializeOptions,
  type RunFlowBuildPlanValidateOptions,
  type RunProcessBuildPlanMaterializeOptions,
  type RunProcessBuildPlanValidateOptions,
} from './lib/process-flow-build-plan.js';
import {
  runFlowIdentityPreflight,
  runProcessIdentityPreflight,
  type FlowIdentityPreflightReport,
  type ProcessIdentityPreflightReport,
  type RunFlowIdentityPreflightOptions,
  type RunProcessIdentityPreflightOptions,
} from './lib/identity-preflight.js';
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
import {
  runDatasetValidate,
  type DatasetValidateReport,
  type RunDatasetValidateOptions,
} from './lib/dataset-validate.js';
import {
  runDatasetReferencesRewrite,
  type DatasetReferencesRewriteReport,
  type RunDatasetReferencesRewriteOptions,
} from './lib/dataset-references-rewrite.js';
import {
  runDatasetRemoteRefresh,
  type DatasetRemoteRefreshReport,
  type RunDatasetRemoteRefreshOptions,
} from './lib/dataset-remote-refresh.js';
import {
  runDatasetRemoteVerify,
  type DatasetRemoteVerificationReport,
  type RunDatasetRemoteVerifyOptions,
} from './lib/dataset-remote-verify.js';
import {
  runDatasetBilingualApply,
  runDatasetBilingualExtract,
  runDatasetBilingualValidate,
  type DatasetBilingualApplyReport,
  type DatasetBilingualExtractReport,
  type DatasetBilingualValidateReport,
  type RunDatasetBilingualApplyOptions,
  type RunDatasetBilingualExtractOptions,
  type RunDatasetBilingualValidateOptions,
} from './lib/dataset-bilingual.js';
import {
  runDatasetEvidenceSearch,
  type EvidenceSearchReport,
  type RunDatasetEvidenceSearchOptions,
} from './lib/dataset-evidence-search.js';
import {
  runDatasetContract,
  type DatasetContractReport,
  type RunDatasetContractOptions,
} from './lib/dataset-contract.js';
import {
  runDatasetImportLcaConvert,
  type DatasetImportLcaReport,
  type RunDatasetImportLcaConvertOptions,
} from './lib/dataset-import-lca.js';
import {
  runDatasetAuthor,
  type DatasetAuthorReport,
  type RunDatasetAuthorOptions,
} from './lib/dataset-author.js';

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
  runLifecyclemodelSaveDraftImpl?: (
    options: RunLifecyclemodelSaveDraftOptions,
  ) => Promise<LifecyclemodelSaveDraftReport>;
  runLifecyclemodelGraphImpl?: (
    options: RunLifecyclemodelGraphOptions,
  ) => Promise<LifecyclemodelGraphReport>;
  runLifecyclemodelOrchestrateImpl?: (
    options: RunLifecyclemodelOrchestrateOptions,
  ) => Promise<LifecyclemodelOrchestrateReport>;
  runProcessGetImpl?: (options: RunProcessGetOptions) => Promise<ProcessGetReport>;
  runProcessListImpl?: (options: RunProcessListOptions) => Promise<ProcessListReport>;
  runProcessAutoBuildImpl?: (
    options: RunProcessAutoBuildOptions,
  ) => Promise<ProcessAutoBuildReport>;
  runProcessBatchBuildImpl?: (
    options: RunProcessBatchBuildOptions,
  ) => Promise<ProcessBatchBuildReport>;
  runProcessScopeStatisticsImpl?: (
    options: RunProcessScopeStatisticsOptions,
  ) => Promise<ProcessScopeStatisticsReport>;
  runProcessRefreshReferencesImpl?: (
    options: RunProcessRefreshReferencesOptions,
  ) => Promise<ProcessRefreshReferencesReport>;
  runProcessDedupReviewImpl?: (
    options: RunProcessDedupReviewOptions,
  ) => Promise<ProcessDedupReviewReport>;
  runProcessResumeBuildImpl?: (
    options: RunProcessResumeBuildOptions,
  ) => Promise<ProcessResumeBuildReport>;
  runProcessPublishBuildImpl?: (
    options: RunProcessPublishBuildOptions,
  ) => Promise<ProcessPublishBuildReport>;
  runProcessSaveDraftImpl?: (
    options: RunProcessSaveDraftOptions,
  ) => Promise<ProcessSaveDraftReport>;
  runProcessRequiredFieldsCompleteImpl?: (
    options: RunProcessRequiredFieldsCompleteOptions,
  ) => Promise<ProcessRequiredFieldsReport>;
  runProcessVerifyRowsImpl?: (
    options: RunProcessVerifyRowsOptions,
  ) => Promise<ProcessVerifyRowsReport>;
  runProcessIdentityPreflightImpl?: (
    options: RunProcessIdentityPreflightOptions,
  ) => Promise<ProcessIdentityPreflightReport>;
  runProcessBuildPlanValidateImpl?: (
    options: RunProcessBuildPlanValidateOptions,
  ) => Promise<ProcessBuildPlanGateReport>;
  runProcessBuildPlanMaterializeImpl?: (
    options: RunProcessBuildPlanMaterializeOptions,
  ) => Promise<ProcessBuildPlanGateReport>;
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
  runFlowIdentityPreflightImpl?: (
    options: RunFlowIdentityPreflightOptions,
  ) => Promise<FlowIdentityPreflightReport>;
  runFlowBuildPlanValidateImpl?: (
    options: RunFlowBuildPlanValidateOptions,
  ) => Promise<FlowBuildPlanGateReport>;
  runFlowBuildPlanMaterializeImpl?: (
    options: RunFlowBuildPlanMaterializeOptions,
  ) => Promise<FlowBuildPlanGateReport>;
  runDatasetValidateImpl?: (options: RunDatasetValidateOptions) => Promise<DatasetValidateReport>;
  runDatasetReferencesRewriteImpl?: (
    options: RunDatasetReferencesRewriteOptions,
  ) => Promise<DatasetReferencesRewriteReport>;
  runDatasetRemoteRefreshImpl?: (
    options: RunDatasetRemoteRefreshOptions,
  ) => Promise<DatasetRemoteRefreshReport>;
  runDatasetRemoteVerifyImpl?: (
    options: RunDatasetRemoteVerifyOptions,
  ) => Promise<DatasetRemoteVerificationReport>;
  runDatasetBilingualExtractImpl?: (
    options: RunDatasetBilingualExtractOptions,
  ) => Promise<DatasetBilingualExtractReport>;
  runDatasetBilingualApplyImpl?: (
    options: RunDatasetBilingualApplyOptions,
  ) => Promise<DatasetBilingualApplyReport>;
  runDatasetBilingualValidateImpl?: (
    options: RunDatasetBilingualValidateOptions,
  ) => Promise<DatasetBilingualValidateReport>;
  runDatasetEvidenceSearchImpl?: (
    options: RunDatasetEvidenceSearchOptions,
  ) => Promise<EvidenceSearchReport>;
  runDatasetContractImpl?: (options: RunDatasetContractOptions) => Promise<DatasetContractReport>;
  runDatasetImportLcaConvertImpl?: (
    options: RunDatasetImportLcaConvertOptions,
  ) => Promise<DatasetImportLcaReport> | DatasetImportLcaReport;
  runDatasetAuthorImpl?: (options: RunDatasetAuthorOptions) => Promise<DatasetAuthorReport>;
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
  tiangong-lca <command> [subcommand] [options]

Commands:
Implemented Commands:
  doctor     show environment diagnostics
  search     flow | process | lifecyclemodel
  process    get | list | identity-preflight | build-plan | scope-statistics | dedup-review | auto-build | resume-build | publish-build | complete-required-fields | save-draft | batch-build | refresh-references | verify-rows
  dataset    contract get | context-pack | import-lca convert | author | validate | verify-remote | bilingual extract/apply/validate | evidence-search plan/run | references rewrite/refresh-remote
  flow       get | list | identity-preflight | build-plan | fetch-rows | materialize-decisions | remediate | publish-version | publish-reviewed-data | build-alias-map | scan-process-flow-refs | plan-process-flow-repairs | apply-process-flow-repairs | regen-product | validate-processes
  lifecyclemodel auto-build | validate-build | publish-build | save-draft | graph | build-resulting-process | publish-resulting-process | orchestrate
  review     process | flow | lifecyclemodel
  publish    run
  validation run
  admin      embedding-run

Planned Surface (not implemented yet):
  auth       whoami | doctor-auth
  job        get | wait | logs

Planned commands currently print an explicit "not implemented yet" message and exit with code 2.

Examples:
  tiangong-lca doctor
  tiangong-lca search flow --input ./request.json
  tiangong-lca search process --input ./request.json --dry-run
  tiangong-lca process get --id <process-id>
  tiangong-lca process list --state-code 100 --limit 20
  tiangong-lca process identity-preflight --input ./process-preflight.json --out-dir ./process-preflight
  tiangong-lca process build-plan validate --input ./process-build-plan.json --out-dir ./process-build-plan
  tiangong-lca process scope-statistics --out-dir /abs/path/to/process-scope --state-code 0 --state-code 100
  tiangong-lca process dedup-review --input ./duplicate-groups.json --out-dir /abs/path/to/process-dedup
  tiangong-lca process auto-build --input ./pff-request.json --out-dir /abs/path/to/process-run
  tiangong-lca process resume-build --run-dir /abs/path/to/process-run
  tiangong-lca process publish-build --run-dir /abs/path/to/process-run
  tiangong-lca process complete-required-fields --input ./processes.jsonl --out ./processes.completed.jsonl --default-unit MJ
  tiangong-lca process save-draft --input ./patched-processes.jsonl --out-dir /abs/path/to/process-save-draft --dry-run
  tiangong-lca process batch-build --input ./batch-request.json --out-dir /abs/path/to/process-batch
  tiangong-lca process refresh-references --out-dir /abs/path/to/process-refresh --dry-run
  tiangong-lca process verify-rows --rows-file ./process-list-report.json --out-dir /abs/path/to/process-verify
  tiangong-lca dataset validate --input ./rows.jsonl --type auto --out-dir /abs/path/to/dataset-validate
  tiangong-lca dataset contract get --type process --include schema,methodology,ruleset --out-dir ./contract
  tiangong-lca dataset context-pack --type process --profile ai-import --out-dir ./context-pack
  tiangong-lca dataset import-lca convert --input ./external-package --output-dir ./converted --from-format auto --target tidas
  tiangong-lca dataset author --input ./source.pdf --target-types process,flow --out-dir ./authoring
  tiangong-lca dataset verify-remote --input ./rows.jsonl --out-dir /abs/path/to/dataset-remote-verify
  tiangong-lca dataset bilingual extract --input ./rows/processes.jsonl --type process --out-dir ./translation
  tiangong-lca dataset bilingual apply --input ./rows/processes.jsonl --translations ./translation/trans-reviewed.jsonl --out ./rows/processes.translated.jsonl
  tiangong-lca dataset bilingual validate --input ./rows/processes.translated.jsonl --type process --out-dir ./translation-validate
  tiangong-lca dataset evidence-search plan --query "中国2026年电力结构数据" --out-dir ./evidence-search
  tiangong-lca dataset evidence-search run --input ./evidence-search.request.json --results ./search-results.json --out-dir ./evidence-search
  tiangong-lca dataset references rewrite --input ./rows.jsonl --from flow:<old-id>@<old-version> --to flow:<new-id>@<new-version> --out-dir /abs/path/to/dataset-rewrite
  tiangong-lca lifecyclemodel auto-build --input ./lifecyclemodel-auto-build.request.json --out-dir /abs/path/to/lifecyclemodel-run
  tiangong-lca lifecyclemodel validate-build --run-dir /abs/path/to/lifecyclemodel-run
  tiangong-lca lifecyclemodel publish-build --run-dir /abs/path/to/lifecyclemodel-run
  tiangong-lca lifecyclemodel save-draft --input ./lifecyclemodels.jsonl --out-dir /abs/path/to/lifecyclemodel-save-draft --dry-run
  tiangong-lca lifecyclemodel graph --input ./lifecyclemodels.jsonl --out-dir /abs/path/to/lifecyclemodel-graph --format all
  tiangong-lca lifecyclemodel orchestrate plan --input ./lifecyclemodel-orchestrate.request.json --out-dir /abs/path/to/lifecyclemodel-recursive-run
  tiangong-lca flow get --id <flow-id> --version <version>
  tiangong-lca flow list --id <flow-id> --state-code 100 --limit 20
  tiangong-lca flow identity-preflight --input ./flow-preflight.json --out-dir ./flow-preflight
  tiangong-lca flow build-plan validate --input ./flow-build-plan.json --out-dir ./flow-build-plan
  tiangong-lca flow fetch-rows --refs-file ./flow-refs.json --out-dir ./flow-fetch
  tiangong-lca flow materialize-decisions --decision-file ./approved-decisions.json --flow-rows-file ./review-input-rows.jsonl --out-dir ./flow-decisions
  tiangong-lca flow remediate --input-file ./invalid-flows.jsonl --out-dir ./flow-remediation
  tiangong-lca flow publish-version --input-file ./ready-flows.jsonl --out-dir ./flow-publish --commit
  tiangong-lca flow publish-reviewed-data --flow-rows-file ./reviewed-flows.jsonl --original-flow-rows-file ./original-flows.jsonl --out-dir ./flow-publish-review
  tiangong-lca flow build-alias-map --old-flow-file ./old-flows.jsonl --new-flow-file ./new-flows.jsonl --out-dir ./flow-alias-map
  tiangong-lca flow scan-process-flow-refs --processes-file ./processes.jsonl --scope-flow-file ./flows.jsonl --out-dir ./flow-scan
  tiangong-lca flow plan-process-flow-repairs --processes-file ./processes.jsonl --scope-flow-file ./flows.jsonl --out-dir ./flow-repair-plan
  tiangong-lca flow apply-process-flow-repairs --processes-file ./processes.jsonl --scope-flow-file ./flows.jsonl --out-dir ./flow-repair-apply
  tiangong-lca flow regen-product --processes-file ./processes.jsonl --scope-flow-file ./flows.jsonl --out-dir ./flow-regeneration --apply
  tiangong-lca flow validate-processes --original-processes-file ./before.jsonl --patched-processes-file ./after.jsonl --scope-flow-file ./flows.jsonl --out-dir ./flow-validation
  tiangong-lca review process --rows-file ./processes.jsonl --out-dir ./review
  tiangong-lca review process --run-root /abs/path/to/process-run --run-id <run_id> --out-dir ./review
  tiangong-lca review flow --rows-file ./flows.json --out-dir ./review
  tiangong-lca review lifecyclemodel --run-dir /abs/path/to/lifecyclemodel-run --out-dir ./lifecyclemodel-review
  tiangong-lca publish run --input ./publish-request.json --dry-run
  tiangong-lca validation run --input-dir ./package --engine auto
  tiangong-lca admin embedding-run --input ./jobs.json

Environment:
  .env loaded: ${dotEnvStatus.loaded ? `yes (${dotEnvStatus.path}, ${dotEnvStatus.count} keys)` : 'no'}
`.trim();
}

function renderDoctorHelp(): string {
  return `Usage:
  tiangong-lca doctor [--json]

Options:
  --json    Print structured environment diagnostics
  -h, --help
`.trim();
}

function renderSearchHelp(): string {
  return `Usage:
  tiangong-lca search <flow|process|lifecyclemodel> --input <file> [options]

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
  tiangong-lca admin embedding-run --input <file> [options]

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
  tiangong-lca publish run --input <file> [options]

Options:
  --input <file>       JSON publish request file
  --out-dir <dir>      Override request out_dir
  --commit             Force publish.commit=true
  --dry-run            Force publish.commit=false
  --json               Print compact JSON
  -h, --help

Path rule:
  Relative out_dir values from the request body or --out-dir resolve from the request file directory.

Outputs written under out_dir:
  - normalized-request.json
  - collected-inputs.json
  - relation-manifest.json
  - verification-report.json
  - publish-report.json
`.trim();
}

function renderValidationHelp(): string {
  return `Usage:
  tiangong-lca validation run --input-dir <dir> [options]

Options:
  --input-dir <dir>    TIDAS package directory
  --engine <mode>      auto | sdk (default: auto)
  --report-file <file> Write the structured validation report to a file
  --json               Print compact JSON
  -h, --help
`.trim();
}

function renderDatasetHelp(): string {
  return `Usage:
  tiangong-lca dataset <subcommand> [options]

Implemented Subcommands:
  contract get        Write TIDAS schema / methodology / ruleset contract artifacts
  context-pack        Write an AI-ready TIDAS contract context pack
  import-lca convert  Convert supported external LCA packages through tidas-tools
  author              Extract source evidence and prepare TIDAS context packs for AI authoring
  validate             Validate local flow / process / lifecyclemodel rows with the TIDAS SDK
  verify-remote        Verify dataset roots and TIDAS references against remote published versions
  bilingual extract    Extract bilingual translation units from local rows
  bilingual apply      Apply reviewed bilingual translations back to local rows
  bilingual validate   Validate bilingual rows with deterministic scans and schema/review gates
  evidence-search      Plan or record field-level public evidence retrieval
  references rewrite   Rewrite flow references in local process and lifecyclemodel rows
  references refresh-remote Refresh local TIDAS reference versions to latest reachable remote rows

Examples:
  tiangong-lca dataset contract get --type process --include schema,methodology,ruleset --out-dir ./contract --help
  tiangong-lca dataset context-pack --type process --profile ai-import --out-dir ./context-pack --help
  tiangong-lca dataset import-lca convert --input ./external-package --output-dir ./converted --from-format auto --target tidas --help
  tiangong-lca dataset author --input ./source.pdf --target-types process,flow --out-dir ./authoring --help
  tiangong-lca dataset validate --input ./rows.jsonl --type auto --out-dir ./dataset-validate --help
  tiangong-lca dataset verify-remote --input ./rows.jsonl --out-dir ./dataset-remote-verify --help
  tiangong-lca dataset bilingual extract --input ./rows.jsonl --type process --out-dir ./translation --help
  tiangong-lca dataset bilingual apply --input ./rows.jsonl --translations ./trans-reviewed.jsonl --out ./rows.translated.jsonl --help
  tiangong-lca dataset bilingual validate --input ./rows.translated.jsonl --type process --out-dir ./translation-validate --help
  tiangong-lca dataset evidence-search plan --query "中国2026年电力结构数据" --out-dir ./evidence-search --help
  tiangong-lca dataset evidence-search run --input ./request.json --results ./search-results.json --out-dir ./evidence-search --help
  tiangong-lca dataset references rewrite --input ./rows.jsonl --from flow:<old-id>@<old-version> --to flow:<new-id>@<new-version> --out-dir ./dataset-rewrite --help
  tiangong-lca dataset references refresh-remote --input ./rows.jsonl --out ./rows.refreshed.jsonl --out-dir ./dataset-reference-refresh --help
`.trim();
}

function renderDatasetContractHelp(): string {
  return `Usage:
  tiangong-lca dataset contract get --type <type> --out-dir <dir> [options]

Options:
  --type <type>       TIDAS target type: process, flow, source, contact, unitgroup, flowproperty, lifecyclemodel, lciamethod
  --include <list>    Comma-separated or repeatable list: schema, methodology, ruleset (default: all)
  --profile <name>    default | ai-import (default: default)
  --out-dir <dir>     Artifact directory
  --json              Print compact JSON
  -h, --help

Outputs written under --out-dir:
  - outputs/contract-manifest.json
  - outputs/schema.json when requested and available
  - outputs/methodology.yaml when requested and available
  - outputs/runtime-ruleset.json when requested and available
  - outputs/contract-report.json
`.trim();
}

function renderDatasetContextPackHelp(): string {
  return `Usage:
  tiangong-lca dataset context-pack --type <type> --out-dir <dir> [options]

Options:
  --type <type>       TIDAS target type for AI authoring or repair
  --include <list>    Comma-separated or repeatable list: schema, methodology, ruleset (default: all)
  --profile <name>    default | ai-import (default: ai-import)
  --out-dir <dir>     Artifact directory
  --json              Print compact JSON
  -h, --help

Outputs written under --out-dir:
  - outputs/contract-manifest.json
  - outputs/schema.json
  - outputs/methodology.yaml when available
  - outputs/runtime-ruleset.json when available
  - outputs/ai-context.json
  - outputs/ai-context.md
  - outputs/contract-report.json
`.trim();
}

function renderDatasetImportLcaHelp(): string {
  return `Usage:
  tiangong-lca dataset import-lca convert --input <path> --output-dir <dir> [options]

Options:
  --input <path>          Source file, directory, or package to import
  --output-dir <dir>      Output directory for generated package and reports
  --from-format <format>  auto, ecospold1, ecospold2, openlca-jsonld, openlca-process-xlsx, simapro-csv
  --target <target>       tidas | ilcd | both (default: tidas)
  --report <file>         Conversion report path (default: <output-dir>/conversion-report.json)
  --mapping-dir <dir>     Optional custom mapping/reference data directory
  --language <lang>       Default language for generated text (default: en)
  --validation-jobs <n>   Parallel validation jobs passed to tidas-tools (default: 1)
  --detect-only           Only detect the input format and write the report
  --fail-on-warning       Return non-zero when converter warnings are present
  --python <bin>          Python executable (default: python3)
  --tidas-tools-dir <dir> Explicit tidas-tools checkout path
  --json                  Print compact JSON
  -h, --help

Outputs written under --output-dir:
  - conversion-report.json
  - tidas/ when target includes TIDAS and not detect-only
  - ilcd/ when target includes ILCD and not detect-only
  - mapping.csv when not detect-only
  - outputs/import-lca-report.json
`.trim();
}

function renderDatasetAuthorHelp(): string {
  return `Usage:
  tiangong-lca dataset author --input <file> --target-types <types> --out-dir <dir> [options]

Options:
  --input <file>          PDF, Excel, image, markdown, or source document file
  --target-types <list>   Comma-separated or repeatable TIDAS types, for example process,flow,source
  --out-dir <dir>         Artifact directory
  --prompt <text>         Optional extraction prompt passed to the unstructured parser
  --provider <name>       Optional unstructured parser provider override
  --model <name>          Optional unstructured parser model override
  --timeout-ms <n>        Parser timeout in milliseconds (default: 120000)
  --json                  Print compact JSON
  -h, --help

Outputs written under --out-dir:
  - outputs/source-extract.json
  - context/<type>/outputs/contract-manifest.json
  - context/<type>/outputs/ai-context.json
  - outputs/authoring-report.json

Environment:
  TIANGONG_LCA_UNSTRUCTURED_API_BASE_URL and TIANGONG_LCA_UNSTRUCTURED_API_KEY
`.trim();
}

function renderDatasetRemoteVerifyHelp(): string {
  return `Usage:
  tiangong-lca dataset verify-remote --input <file> --out-dir <dir> [options]

Options:
  --input <file>         Local rows as JSON or JSONL; objects with rows[] are also accepted
  --out-dir <dir>        Artifact directory for the remote verification report
  --root-policy <mode>   existing | candidate (default: existing)
  --json                 Print compact JSON
  -h, --help

Environment:
  TIANGONG_LCA_API_BASE_URL, TIANGONG_LCA_API_KEY, and TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY

Outputs written under --out-dir:
  - outputs/remote-verification-report.json
  - outputs/remote-verification.jsonl
  - outputs/blockers.jsonl
`.trim();
}

function renderDatasetValidateHelp(): string {
  return `Usage:
  tiangong-lca dataset validate --input <file> [options]

Options:
  --input <file>   Local rows as JSON or JSONL; objects with rows[] are also accepted
  --type <type>    auto | flow | process | lifecyclemodel (default: auto)
  --out-dir <dir>  Optional artifact directory for validation report and row splits
  --json           Print compact JSON
  -h, --help

Outputs written under --out-dir:
  - outputs/validation-report.json
  - outputs/valid-rows.jsonl
  - outputs/invalid-rows.jsonl
`.trim();
}

function renderDatasetBilingualHelp(): string {
  return `Usage:
  tiangong-lca dataset bilingual <extract|apply|validate> [options]

Subcommands:
  extract    Extract trans-units.jsonl from process/flow/lifecyclemodel rows
  apply      Apply reviewed translations to rows and write translation-evidence.json
  validate   Run placeholder/mixed-language scans plus schema and process/flow review gates

Examples:
  tiangong-lca dataset bilingual extract --input ./rows/processes.jsonl --type process --out-dir ./translation
  tiangong-lca dataset bilingual apply --input ./rows/processes.jsonl --translations ./translation/trans-reviewed.jsonl --out ./rows/processes.translated.jsonl
  tiangong-lca dataset bilingual validate --input ./rows/processes.translated.jsonl --type process --out-dir ./translation-validate
`.trim();
}

function renderDatasetBilingualExtractHelp(): string {
  return `Usage:
  tiangong-lca dataset bilingual extract --input <file> [options]

Options:
  --input <file>        Local rows as JSON or JSONL
  --type <type>         auto | flow | process | lifecyclemodel (default: auto)
  --source-lang <lang>  Source language code (default: en)
  --target-lang <lang>  Target language code (default: zh)
  --out-dir <dir>       Artifact directory for trans-units.jsonl and extract-report.json
  --json                Print compact JSON
  -h, --help

Outputs written under --out-dir:
  - outputs/trans-units.jsonl
  - outputs/extract-report.json
`.trim();
}

function renderDatasetBilingualApplyHelp(): string {
  return `Usage:
  tiangong-lca dataset bilingual apply --input <file> --translations <file> --out <file> [options]

Options:
  --input <file>         Local rows as JSON or JSONL
  --translations <file>  Reviewed translation JSONL from extract units
  --out <file>           Output JSONL with translations applied
  --target-lang <lang>   Target language code (default: zh)
  --out-dir <dir>        Optional artifact directory; defaults to the output file directory
  --json                 Print compact JSON
  -h, --help

Translation row fields:
  unit_id, row_index, field_path, source_lang, target_lang, source_text, translated_text,
  basis, review_status, reviewer

Outputs:
  - translated rows at --out
  - outputs/translation-evidence.json
  - outputs/bilingual-apply-report.json
`.trim();
}

function renderDatasetBilingualValidateHelp(): string {
  return `Usage:
  tiangong-lca dataset bilingual validate --input <file> [options]

Options:
  --input <file>   Local rows as JSON or JSONL
  --type <type>    auto | flow | process | lifecyclemodel (default: auto)
  --out-dir <dir>  Artifact directory for scan, schema, and review outputs
  --json           Print compact JSON
  -h, --help

Outputs written under --out-dir:
  - outputs/bilingual-validate-report.json
  - outputs/bilingual-findings.jsonl
  - schema/outputs/validation-report.json
  - review/process/... and/or review/flow/... when applicable
`.trim();
}

function renderDatasetEvidenceSearchHelp(): string {
  return `Usage:
  tiangong-lca dataset evidence-search <plan|run> [options]

Plan:
  tiangong-lca dataset evidence-search plan --query <text> --out-dir <dir>

Run:
  tiangong-lca dataset evidence-search run --input <request.json> --results <search-results.json> --out-dir <dir>
  tiangong-lca dataset evidence-search run --query <text> --provider-url <url> --out-dir <dir>

Options:
  --query <text>             Evidence question when no --input is supplied
  --input <file>             JSON request with question, field, budget, preferred_domains, and required_evidence
  --results <file>           Normalized external search results JSON/JSONL captured from web/search tools
  --provider-url <url>       Optional generic JSON search provider endpoint
  --provider-key <key>       Optional bearer token for --provider-url
  --profile <profile>        shallow | balanced | deep (default: balanced)
  --max-queries <n>          Override query budget
  --max-results-per-query <n> Override per-query result budget
  --timeout-ms <n>           Provider request timeout in milliseconds
  --out-dir <dir>            Artifact directory
  --json                     Print compact JSON
  -h, --help

Outputs written under --out-dir:
  - outputs/evidence-search-plan.json
  - outputs/evidence-search-results.jsonl
  - outputs/evidence-search-report.json
  - outputs/evidence-search-declaration.json when evidence is absent or only partial
`.trim();
}

function renderDatasetReferencesHelp(): string {
  return `Usage:
  tiangong-lca dataset references <rewrite|refresh-remote> [options]

Rewrite:
  tiangong-lca dataset references rewrite --input <file> --from flow:<id>[@<version>] --to flow:<id>[@<version>] [options]

Refresh remote versions:
  tiangong-lca dataset references refresh-remote --input <file> --out <file> --out-dir <dir> [options]

Options:
  --input <file>   Local rows as JSON or JSONL; process and lifecyclemodel rows are supported
  --from <ref>     Source flow reference, for example flow:<old-id>@01.00.000
  --to <ref>       Target flow reference, for example flow:<new-id>@01.01.000
  --out <file>           Output JSONL path for refresh-remote patched rows
  --root-policy <mode>   existing | candidate for refresh-remote root rows (default: existing)
  --type <type>          Repeatable row type filter: process | lifecyclemodel (default: both)
  --types <csv>          Comma-separated alias for one or more row types
  --scope <label>        Optional artifact label for the already-frozen input scope
  --out-dir <dir>        Artifact directory for rewrite plan and patched rows
  --commit               Execute state-aware save-draft writes for patched rows
  --dry-run              Keep the command local-only (default)
  --json                 Print compact JSON
  -h, --help

Environment:
  none for local dry-run
  TIANGONG_LCA_API_BASE_URL, TIANGONG_LCA_API_KEY, and TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY
  when --commit executes remote writes

Outputs written under --out-dir:
  - outputs/patched-rows.jsonl
  - outputs/rewrite-plan.json
  - outputs/summary.json
  - outputs/remote-refresh-report.json
  - outputs/remote-refresh-patches.jsonl
  - pre-refresh-verify/outputs/remote-verification-report.json
  - post-refresh-verify/outputs/remote-verification-report.json
`.trim();
}

function renderFlowHelp(): string {
  return `Usage:
  tiangong-lca flow <subcommand> [options]

Implemented Subcommands:
  get          Load one flow dataset by identifier through direct Supabase access
  list         Enumerate flow datasets through direct Supabase access with deterministic filters
  identity-preflight Compare one target flow against local candidates before generation
  build-plan  Validate or materialize a flow build plan into gate artifacts
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
  tiangong-lca flow --help
  tiangong-lca flow get --help
  tiangong-lca flow list --help
  tiangong-lca flow identity-preflight --help
  tiangong-lca flow build-plan validate --help
  tiangong-lca flow fetch-rows --help
  tiangong-lca flow materialize-decisions --help
  tiangong-lca flow remediate --help
  tiangong-lca flow publish-version --help
  tiangong-lca flow publish-reviewed-data --help
  tiangong-lca flow build-alias-map --help
  tiangong-lca flow scan-process-flow-refs --help
  tiangong-lca flow plan-process-flow-repairs --help
  tiangong-lca flow apply-process-flow-repairs --help
  tiangong-lca flow regen-product --help
  tiangong-lca flow validate-processes --help
`.trim();
}

function renderFlowBuildPlanHelp(): string {
  return `Usage:
  tiangong-lca flow build-plan <validate|materialize> --input <file> [options]

Options:
  --input <file>     JSON flow build plan; materialize writes a canonical flowDataSet
  --out-dir <dir>    Optional artifact directory for gate outputs
  --report-only      Print blocker reports with exit code 0
  --json             Print compact JSON
  -h, --help

Outputs written under --out-dir:
  - outputs/build-plan-gate-report.json
  - outputs/materialized-flow.json
`.trim();
}

function renderFlowIdentityPreflightHelp(): string {
  return `Usage:
  tiangong-lca flow identity-preflight --input <file> [options]

Options:
  --input <file>   JSON preflight request with target flow and optional candidates
  --candidate-input <path>
                   Optional JSON/JSONL file or directory of candidate flow rows; repeatable
  --remote-candidates
                   Also fetch candidate rows from flow_hybrid_search
  --remote-query <text>
                   Override the remote search query; defaults to target identity text
  --remote-limit <n>
                   Limit remote candidate rows after fetch
  --out-dir <dir>  Optional artifact directory for identity decision outputs
  --json           Print compact JSON
  -h, --help

Input contract:
  {
    "target": { "...": "flow target or canonical flowDataSet" },
    "candidates": [{ "...": "existing flow row or canonical flowDataSet" }]
  }

Outputs written under --out-dir:
  - outputs/identity-decision.json
  - outputs/identity-candidates.jsonl
  - outputs/identity-candidate-sources.json
`.trim();
}

function renderFlowGetHelp(): string {
  return `Usage:
  tiangong-lca flow get --id <flow-id> [options]

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
  tiangong-lca flow list [options]

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
  tiangong-lca flow remediate --input-file <file> --out-dir <dir> [options]

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
  tiangong-lca flow fetch-rows --refs-file <file> --out-dir <dir> [options]

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
  tiangong-lca flow materialize-decisions --decision-file <file> --flow-rows-file <file> --out-dir <dir> [options]

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
  tiangong-lca flow publish-version --input-file <file> --out-dir <dir> [options]

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
  - flow-publish-version-gate-report.json
  - flows_tidas_sdk_plus_classification_mcp_sync_report.json
`.trim();
}

function renderFlowPublishReviewedDataHelp(): string {
  return `Usage:
  tiangong-lca flow publish-reviewed-data --out-dir <dir> [--flow-rows-file <file>] [--process-rows-file <file>] [options]

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
  - flow-publish-version-gate-report.json
  - flows_tidas_sdk_plus_classification_mcp_sync_report.json
`.trim();
}

function renderFlowBuildAliasMapHelp(): string {
  return `Usage:
  tiangong-lca flow build-alias-map --old-flow-file <file> --new-flow-file <file> --out-dir <dir> [options]

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
  tiangong-lca flow scan-process-flow-refs --processes-file <file> --scope-flow-file <file> --out-dir <dir> [options]

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
  tiangong-lca flow plan-process-flow-repairs --processes-file <file> --scope-flow-file <file> --out-dir <dir> [options]

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
  tiangong-lca flow apply-process-flow-repairs --processes-file <file> --scope-flow-file <file> --out-dir <dir> [options]

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
  tiangong-lca flow regen-product --processes-file <file> --scope-flow-file <file> --out-dir <dir> [options]

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
  tiangong-lca flow validate-processes --original-processes-file <file> --patched-processes-file <file> --scope-flow-file <file> --out-dir <dir> [options]

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
  tiangong-lca review <subcommand> [options]

Implemented Subcommands:
  process      Review process build runs or rows-file snapshots and emit artifact-first findings
  flow         Review local flow governance snapshots and emit artifact-first findings
  lifecyclemodel Review one local lifecyclemodel build run and emit artifact-first findings

Examples:
  tiangong-lca review --help
  tiangong-lca review process --help
  tiangong-lca review flow --help
  tiangong-lca review lifecyclemodel --help
`.trim();
}

function renderReviewProcessHelp(): string {
  return `Usage:
  tiangong-lca review process (--rows-file <file> | --run-root <dir>) --out-dir <dir> [options]

Options:
  --rows-file <file>        Process rows JSON/JSONL file; full process list reports with rows[] are also accepted
  --run-root <dir>          Process build run root containing exports/processes
  --run-id <id>             Optional review run identifier; defaults to the rows-file name or run-root basename
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
  tiangong-lca review flow (--rows-file <file> | --flows-dir <dir> | --run-root <dir>) --out-dir <dir> [options]

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
  tiangong-lca review lifecyclemodel --run-dir <dir> --out-dir <dir> [options]

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
  tiangong-lca lifecyclemodel build-resulting-process --input <file> [options]

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
  tiangong-lca lifecyclemodel publish-resulting-process --run-dir <dir> [options]

Options:
  --run-dir <dir>         Existing lifecyclemodel resulting-process run directory
  --publish-processes     Include projected processes in publish-bundle.json
  --publish-relations     Include lifecyclemodel/resulting-process relations in publish-bundle.json
  --json                  Print compact JSON
  -h, --help
`.trim();
}

function renderLifecyclemodelSaveDraftHelp(): string {
  return `Usage:
  tiangong-lca lifecyclemodel save-draft --input <file> [options]

Options:
  --input <file>     Lifecyclemodel rows JSON/JSONL file or publish-request.json
  --out-dir <dir>    Run root written relative to cwd when a relative path is passed
  --commit           Execute remote save-draft writes
  --dry-run          Keep the command local-only (default)
  --json             Print compact JSON
  -h, --help

Environment:
  none for local dry-run
  TIANGONG_LCA_API_BASE_URL, TIANGONG_LCA_API_KEY, and TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY
  when --commit executes remote writes

Local gate:
  canonical lifecyclemodel payloads are validated against LifeCycleModelSchema before any remote write;
  schema-invalid rows stay in failures.jsonl instead of being committed

Outputs written under --out-dir:
  - inputs/normalized-input.json
  - outputs/save-draft-bundle/selected-lifecyclemodels.jsonl
  - outputs/save-draft-bundle/progress.jsonl
  - outputs/save-draft-bundle/failures.jsonl
  - outputs/save-draft-bundle/summary.json
`.trim();
}

function renderLifecyclemodelGraphHelp(): string {
  return `Usage:
  tiangong-lca lifecyclemodel graph --input <file> [options]

Options:
  --input <file>          Lifecyclemodel rows JSON/JSONL file
  --out-dir <dir>         Artifact directory for graph files and findings
  --format <format>       json | dot | svg | all (default: all)
  --check-connections     Fail when process-instance links are missing or unresolved
  --json                  Print compact JSON
  -h, --help

Outputs written under --out-dir:
  - outputs/graph-report.json
  - outputs/findings.jsonl
  - graphs/*.json
  - graphs/*.dot
  - graphs/*.svg
`.trim();
}

function renderLifecyclemodelHelp(): string {
  return `Usage:
  tiangong-lca lifecyclemodel <subcommand> [options]

Implemented Subcommands:
  auto-build                Build native lifecyclemodel json_ordered artifacts from local process run exports
  validate-build            Re-run local validation on one lifecyclemodel build run
  publish-build             Prepare lifecyclemodel publish handoff artifacts from one local build run
  save-draft                Save canonical lifecyclemodel datasets through the bundle save path
  graph                     Derive lifecyclemodel graph artifacts and connection findings
  build-resulting-process   Deterministically aggregate a lifecycle model into a resulting process bundle
  publish-resulting-process Prepare publish-bundle.json and publish-intent.json from a prior resulting-process run
  orchestrate               Plan, execute, or publish a recursive lifecyclemodel assembly run

Examples:
  tiangong-lca lifecyclemodel --help
  tiangong-lca lifecyclemodel auto-build --help
  tiangong-lca lifecyclemodel validate-build --help
  tiangong-lca lifecyclemodel publish-build --help
  tiangong-lca lifecyclemodel save-draft --help
  tiangong-lca lifecyclemodel graph --help
  tiangong-lca lifecyclemodel build-resulting-process --help
  tiangong-lca lifecyclemodel orchestrate --help
`.trim();
}

function renderLifecyclemodelOrchestrateHelp(): string {
  return `Usage:
  tiangong-lca lifecyclemodel orchestrate <plan|execute|publish> [options]

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
  tiangong-lca lifecyclemodel auto-build --input <file> [options]

Options:
  --input <file>     JSON request file
  --out-dir <dir>    Explicit run root; otherwise request.out_dir is required
  --json             Print compact JSON
  -h, --help

Minimal request contract:
  {
    "local_runs": ["/abs/path/to/process-build-run"]
  }

This first CLI slice is local-only and read-only:
  - applies no implicit repo-local ./artifacts fallback; callers must provide a run root
  - loads local process build run directories
  - infers the process graph from shared flow UUIDs
  - emits native lifecyclemodel json_ordered artifacts
  - leaves follow-up validation and publish handoff to the companion validate-build and publish-build commands
`.trim();
}

function renderLifecyclemodelValidateBuildHelp(): string {
  return `Usage:
  tiangong-lca lifecyclemodel validate-build --run-dir <dir> [options]

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
  tiangong-lca lifecyclemodel publish-build --run-dir <dir> [options]

Options:
  --run-dir <dir>    Existing lifecyclemodel auto-build run directory
  --json             Print compact JSON
  -h, --help

This command:
  - collects native lifecyclemodel json_ordered payloads from one local build run
  - writes publish-bundle.json, publish-request.json, and publish-intent.json
  - keeps actual dry-run / commit execution in tiangong-lca publish run
  - routes lifecyclemodel commit through save_lifecycle_model_bundle internally
`.trim();
}

function renderProcessAutoBuildHelp(): string {
  return `Usage:
  tiangong-lca process auto-build --input <file> [options]

Options:
  --input <file>     JSON request file
  --out-dir <dir>    Explicit run root; otherwise request.workspace_run_root is required
  --json             Print compact JSON
  -h, --help

This command applies no implicit repo-local ./artifacts fallback.
`.trim();
}

function renderProcessGetHelp(): string {
  return `Usage:
  tiangong-lca process get --id <process-id> [options]

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

function renderProcessListHelp(): string {
  return `Usage:
  tiangong-lca process list [options]

Options:
  --id <process-id>               Repeatable exact process UUID filter
  --version <version>             Optional dataset version filter
  --user-id <user-id>             Optional owner filter for private rows
  --state-code <code>             Repeatable visibility filter such as 0 or 100
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

function renderProcessScopeStatisticsHelp(): string {
  return `Usage:
  tiangong-lca process scope-statistics --out-dir <dir> [options]

Options:
  --out-dir <dir>          Artifact root to write inputs/outputs/reports
  --scope <name>           visible | current-user (default: visible)
  --state-code <code>      Repeatable non-negative integer state code filter
  --state-codes <csv>      Comma-separated alias for one or more state codes
  --page-size <n>          Remote page size (default: 200)
  --reuse-snapshot         Reuse inputs/processes.snapshot.rows.jsonl instead of refetching
  --json                   Print compact JSON
  -h, --help

Outputs written under --out-dir:
  - inputs/processes.snapshot.manifest.json
  - inputs/processes.snapshot.rows.jsonl
  - outputs/process-scope-summary.json
  - outputs/domain-summary.json
  - outputs/craft-summary.json
  - outputs/product-summary.json
  - outputs/type-of-dataset-summary.json
  - reports/process-scope-statistics.md
  - reports/process-scope-statistics.zh-CN.md
`.trim();
}

function renderProcessIdentityPreflightHelp(): string {
  return `Usage:
  tiangong-lca process identity-preflight --input <file> [options]

Options:
  --input <file>   JSON preflight request with target process and optional candidates
  --candidate-input <path>
                   Optional JSON/JSONL file or directory of candidate process rows; repeatable
  --remote-candidates
                   Also fetch candidate rows from process_hybrid_search
  --remote-query <text>
                   Override the remote search query; defaults to target identity text
  --remote-limit <n>
                   Limit remote candidate rows after fetch
  --out-dir <dir>  Optional artifact directory for identity decision outputs
  --json           Print compact JSON
  -h, --help

Input contract:
  {
    "target": { "...": "process target or canonical processDataSet" },
    "candidates": [{ "...": "existing process row or canonical processDataSet" }]
  }

Outputs written under --out-dir:
  - outputs/identity-decision.json
  - outputs/identity-candidates.jsonl
  - outputs/identity-candidate-sources.json
`.trim();
}

function renderProcessDedupReviewHelp(): string {
  return `Usage:
  tiangong-lca process dedup-review --input <file> --out-dir <dir> [options]

Options:
  --input <file>           Grouped duplicate-candidate JSON input
  --out-dir <dir>          Artifact root to write inputs/outputs
  --skip-remote            Skip optional TianGong remote enrichment and reference scans
  --json                   Print compact JSON
  -h, --help

Input contract:
  {
    "source_label": "duplicate-processes-export",
    "groups": [
      {
        "group_id": 1,
        "processes": [
          {
            "process_id": "proc-1",
            "version": "01.00.000",
            "name_en": "Example",
            "name_zh": "示例",
            "sheet_exchange_rows": [
              {
                "flow_id": "flow-1",
                "direction": "Input",
                "mean_amount": "1",
                "resulting_amount": "1"
              }
            ]
          }
        ]
      }
    ]
  }

Outputs written under --out-dir:
  - inputs/dedup-input.manifest.json
  - inputs/processes.remote-metadata.json (when remote enrichment succeeds)
  - outputs/duplicate-groups.json
  - outputs/delete-plan.json
  - outputs/current-user-reference-scan.json (when reference scan succeeds)
`.trim();
}

function renderProcessResumeBuildHelp(): string {
  return `Usage:
  tiangong-lca process resume-build --run-dir <dir> [options]

Options:
  --run-dir <dir>    Existing process build run directory
  --run-id <id>      Optional run id consistency check
  --json             Print compact JSON
  -h, --help
`.trim();
}

function renderProcessPublishBuildHelp(): string {
  return `Usage:
  tiangong-lca process publish-build --run-dir <dir> [options]

Options:
  --run-dir <dir>    Existing process build run directory
  --run-id <id>      Optional run id consistency check
  --json             Print compact JSON
  -h, --help
`.trim();
}

function renderProcessSaveDraftHelp(): string {
  return `Usage:
  tiangong-lca process save-draft --input <file> [options]

Options:
  --input <file>     Process rows JSON/JSONL file or publish-request.json
  --out-dir <dir>    Run root written relative to cwd when a relative path is passed
  --commit           Execute remote save-draft writes
  --dry-run          Keep the command local-only (default)
  --json             Print compact JSON
  -h, --help

Environment:
  none for local dry-run
  TIANGONG_LCA_API_BASE_URL, TIANGONG_LCA_API_KEY, and TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY
  when --commit executes remote writes

Local gate:
  canonical process payloads are validated against ProcessSchema before any remote write;
  schema-invalid rows stay in failures.jsonl instead of being committed

Outputs written under --out-dir:
  - inputs/normalized-input.json
  - outputs/save-draft-rpc/selected-processes.jsonl
  - outputs/save-draft-rpc/progress.jsonl
  - outputs/save-draft-rpc/failures.jsonl
  - outputs/save-draft-rpc/summary.json
`.trim();
}

function renderProcessRequiredFieldsHelp(): string {
  return `Usage:
  tiangong-lca process complete-required-fields --input <file> --out <file> [options]

Options:
  --input <file>        Process rows JSON/JSONL file
  --out <file>          Output JSONL with required fields completed
  --out-dir <dir>       Optional artifact directory for report and evidence
  --flows <file>        Optional flow rows JSON/JSONL used to infer reference-flow units
  --default-unit <unit> Unit suffix to use when it cannot be inferred (default: unit)
  --json                Print compact JSON
  -h, --help

Annual supply / production volume policy:
  1. keep an existing valid annualized annualSupplyOrProductionVolume, for example "3.6 MJ/year";
  2. use an explicit value from row-level authoring evidence or evidenceManifest field bindings;
  3. otherwise complete from the quantitative reference flow meanAmount/resultingAmount and unit.

Outputs:
  - completed rows at --out
  - outputs/process-required-fields-report.json
  - outputs/process-required-fields-evidence.jsonl
`.trim();
}

function renderProcessRefreshReferencesHelp(): string {
  return `Usage:
  tiangong-lca process refresh-references --out-dir <dir> [options]

Options:
  --out-dir <dir>      Artifact root for manifest, progress, blockers, and reports
  --apply              Commit state-aware draft writes after local validation passes
  --dry-run            Refresh references locally only (default)
  --reuse-manifest     Reuse inputs/processes.manifest.json instead of refetching the owner snapshot
  --limit <n>          Process at most n manifest rows
  --page-size <n>      Snapshot page size (default: 500)
  --concurrency <n>    Parallel row workers (default: 1, max: 8)
  --json               Print compact JSON
  -h, --help

Required env:
  TIANGONG_LCA_API_BASE_URL
  TIANGONG_LCA_API_KEY
  TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY

Guardrails:
  - refresh only the current authenticated user's process snapshot
  - skip rows with state_code >= 20 instead of forcing an unsupported write path
  - block remote writes when ProcessSchema validation fails or references stay unresolved
  - never requires raw SUPABASE_EMAIL / SUPABASE_PASSWORD in the skill layer

Outputs written under --out-dir:
  - inputs/processes.manifest.json
  - outputs/progress.jsonl
  - outputs/errors.jsonl
  - outputs/validation-blockers.jsonl
  - outputs/summary.json
  - reports/process-refresh-references.md
`.trim();
}

function renderProcessVerifyRowsHelp(): string {
  return `Usage:
  tiangong-lca process verify-rows --rows-file <file> --out-dir <dir> [options]

Options:
  --rows-file <file>   Raw process rows JSON/JSONL file; full process list reports with rows[] are also accepted
  --out-dir <dir>      Output directory for summary and verification JSONL artifacts
  --json               Print compact JSON
  -h, --help

Outputs written under --out-dir:
  - outputs/summary.json
  - outputs/verification.jsonl
`.trim();
}

function renderProcessBatchBuildHelp(): string {
  return `Usage:
  tiangong-lca process batch-build --input <file> [options]

Options:
  --input <file>     JSON batch manifest file
  --out-dir <dir>    Explicit batch root; otherwise request.out_dir is required
  --json             Print compact JSON
  -h, --help

This command applies no implicit repo-local ./artifacts fallback.
`.trim();
}

function renderProcessHelp(): string {
  return `Usage:
  tiangong-lca process <subcommand> [options]

Implemented Subcommands:
  get          Load one process dataset by identifier through direct Supabase access
  list         List visible process rows through direct Supabase access
  identity-preflight Compare one target process against local candidates before generation
  build-plan  Validate or materialize a process build plan into gate artifacts
  scope-statistics Count repeatable coverage statistics from visible or owner-filtered process snapshots
  dedup-review Review grouped duplicate process candidates and emit keep/delete evidence
  auto-build   Prepare a local process-from-flow run scaffold and artifact workspace
  resume-build Prepare a local resume handoff from one existing process build run
  publish-build Prepare publish handoff artifacts from one existing process build run
  complete-required-fields Complete deterministic required authoring fields in process rows
  save-draft   Save canonical process datasets through the state-aware draft-maintenance path
  batch-build  Run multiple process auto-build requests through one batch-oriented CLI surface
  refresh-references Refresh current-user process references to the latest reachable dataset versions
  verify-rows  Re-validate fetched process rows and required naming fields locally

Examples:
  tiangong-lca process --help
  tiangong-lca process get --id <process-id>
  tiangong-lca process list --state-code 100 --limit 20 --help
  tiangong-lca process identity-preflight --input ./process-preflight.json --help
  tiangong-lca process build-plan validate --input ./process-build-plan.json --help
  tiangong-lca process scope-statistics --out-dir ./process-scope --state-code 0 --state-code 100 --help
  tiangong-lca process dedup-review --input ./duplicate-groups.json --out-dir ./process-dedup --help
  tiangong-lca process auto-build --help
  tiangong-lca process resume-build --run-dir /abs/path/to/process-run --help
  tiangong-lca process publish-build --run-dir /abs/path/to/process-run --help
  tiangong-lca process complete-required-fields --input ./processes.jsonl --out ./processes.completed.jsonl --help
  tiangong-lca process save-draft --input ./patched-processes.jsonl --help
  tiangong-lca process batch-build --input ./batch-request.json --help
  tiangong-lca process refresh-references --out-dir ./process-refresh --help
  tiangong-lca process verify-rows --rows-file ./process-list-report.json --out-dir ./process-verify --help
`.trim();
}

function renderProcessBuildPlanHelp(): string {
  return `Usage:
  tiangong-lca process build-plan <validate|materialize> --input <file> [options]

Options:
  --input <file>     JSON process build plan; materialize writes a canonical processDataSet
  --out-dir <dir>    Optional artifact directory for gate outputs
  --report-only      Print blocker reports with exit code 0
  --json             Print compact JSON
  -h, --help

Outputs written under --out-dir:
  - outputs/build-plan-gate-report.json
  - outputs/materialized-process.json
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

function parseDatasetValidateFlags(args: string[]): {
  help: boolean;
  json: boolean;
  inputPath: string;
  type: string | undefined;
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
        type: { type: 'string' },
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
    type: typeof values.type === 'string' ? values.type : undefined,
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : null,
  };
}

function parseDatasetContractFlags(args: string[]): {
  help: boolean;
  json: boolean;
  type: string | undefined;
  include: string[];
  profile: string | undefined;
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
        type: { type: 'string' },
        include: { type: 'string', multiple: true },
        profile: { type: 'string' },
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
    type: typeof values.type === 'string' ? values.type : undefined,
    include: Array.isArray(values.include)
      ? values.include.filter((value): value is string => typeof value === 'string')
      : [],
    profile: typeof values.profile === 'string' ? values.profile : undefined,
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : null,
  };
}

function parseDatasetImportLcaConvertFlags(args: string[]): {
  help: boolean;
  json: boolean;
  inputPath: string;
  outputDir: string;
  fromFormat: string | undefined;
  target: string | undefined;
  reportPath: string | undefined;
  mappingDir: string | undefined;
  language: string | undefined;
  validationJobs: number | undefined;
  detectOnly: boolean;
  failOnWarning: boolean;
  pythonBin: string | undefined;
  tidasToolsDir: string | undefined;
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
        'output-dir': { type: 'string' },
        'from-format': { type: 'string' },
        target: { type: 'string' },
        report: { type: 'string' },
        'mapping-dir': { type: 'string' },
        language: { type: 'string' },
        'validation-jobs': { type: 'string' },
        'detect-only': { type: 'boolean' },
        'fail-on-warning': { type: 'boolean' },
        python: { type: 'string' },
        'tidas-tools-dir': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  const validationJobs =
    typeof values['validation-jobs'] === 'string' ? Number(values['validation-jobs']) : undefined;
  if (validationJobs !== undefined && (!Number.isInteger(validationJobs) || validationJobs < 0)) {
    throw new CliError('--validation-jobs must be a non-negative integer.', {
      code: 'DATASET_IMPORT_LCA_VALIDATION_JOBS_INVALID',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    inputPath: typeof values.input === 'string' ? values.input : '',
    outputDir: typeof values['output-dir'] === 'string' ? values['output-dir'] : '',
    fromFormat: typeof values['from-format'] === 'string' ? values['from-format'] : undefined,
    target: typeof values.target === 'string' ? values.target : undefined,
    reportPath: typeof values.report === 'string' ? values.report : undefined,
    mappingDir: typeof values['mapping-dir'] === 'string' ? values['mapping-dir'] : undefined,
    language: typeof values.language === 'string' ? values.language : undefined,
    validationJobs,
    detectOnly: Boolean(values['detect-only']),
    failOnWarning: Boolean(values['fail-on-warning']),
    pythonBin: typeof values.python === 'string' ? values.python : undefined,
    tidasToolsDir:
      typeof values['tidas-tools-dir'] === 'string' ? values['tidas-tools-dir'] : undefined,
  };
}

function parseDatasetAuthorFlags(args: string[]): {
  help: boolean;
  json: boolean;
  inputPath: string;
  targetTypes: string[];
  outDir: string | null;
  prompt: string | undefined;
  provider: string | undefined;
  model: string | undefined;
  timeoutMs: number | undefined;
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
        'target-types': { type: 'string', multiple: true },
        'out-dir': { type: 'string' },
        prompt: { type: 'string' },
        provider: { type: 'string' },
        model: { type: 'string' },
        'timeout-ms': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  const timeoutMs =
    typeof values['timeout-ms'] === 'string' ? Number(values['timeout-ms']) : undefined;
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs <= 0)) {
    throw new CliError('--timeout-ms must be a positive integer.', {
      code: 'DATASET_AUTHOR_TIMEOUT_INVALID',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    inputPath: typeof values.input === 'string' ? values.input : '',
    targetTypes: Array.isArray(values['target-types'])
      ? values['target-types'].filter((value): value is string => typeof value === 'string')
      : [],
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : null,
    prompt: typeof values.prompt === 'string' ? values.prompt : undefined,
    provider: typeof values.provider === 'string' ? values.provider : undefined,
    model: typeof values.model === 'string' ? values.model : undefined,
    timeoutMs,
  };
}

function parseDatasetRemoteVerifyFlags(args: string[]): {
  help: boolean;
  json: boolean;
  inputPath: string;
  outDir: string;
  rootPolicy: 'existing' | 'candidate';
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
        'root-policy': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  const rawRootPolicy =
    typeof values['root-policy'] === 'string' ? values['root-policy'] : 'existing';
  if (!['existing', 'candidate'].includes(rawRootPolicy)) {
    throw new CliError("--root-policy must be 'existing' or 'candidate'.", {
      code: 'DATASET_REMOTE_VERIFY_ROOT_POLICY_INVALID',
      exitCode: 2,
    });
  }
  const rootPolicy = rawRootPolicy as 'existing' | 'candidate';

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    inputPath: typeof values.input === 'string' ? values.input : '',
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : '',
    rootPolicy,
  };
}

function parseDatasetBilingualExtractFlags(args: string[]): {
  help: boolean;
  json: boolean;
  inputPath: string;
  type: string | undefined;
  sourceLang: string | null;
  targetLang: string | null;
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
        type: { type: 'string' },
        'source-lang': { type: 'string' },
        'target-lang': { type: 'string' },
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
    type: typeof values.type === 'string' ? values.type : undefined,
    sourceLang: typeof values['source-lang'] === 'string' ? values['source-lang'] : null,
    targetLang: typeof values['target-lang'] === 'string' ? values['target-lang'] : null,
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : null,
  };
}

function parseDatasetBilingualApplyFlags(args: string[]): {
  help: boolean;
  json: boolean;
  inputPath: string;
  translationsPath: string;
  outPath: string;
  targetLang: string | null;
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
        translations: { type: 'string' },
        out: { type: 'string' },
        'target-lang': { type: 'string' },
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
    translationsPath: typeof values.translations === 'string' ? values.translations : '',
    outPath: typeof values.out === 'string' ? values.out : '',
    targetLang: typeof values['target-lang'] === 'string' ? values['target-lang'] : null,
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : null,
  };
}

function parseDatasetBilingualValidateFlags(args: string[]): {
  help: boolean;
  json: boolean;
  inputPath: string;
  type: string | undefined;
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
        type: { type: 'string' },
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
    type: typeof values.type === 'string' ? values.type : undefined,
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : null,
  };
}

function parseDatasetEvidenceSearchFlags(args: string[]): {
  help: boolean;
  json: boolean;
  query: string | null;
  inputPath: string | null;
  resultsPath: string | null;
  providerUrl: string | null;
  providerKey: string | null;
  profile: string | null;
  outDir: string | null;
  maxQueries: number | null;
  maxResultsPerQuery: number | null;
  timeoutMs: number | null;
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
        query: { type: 'string' },
        input: { type: 'string' },
        results: { type: 'string' },
        'provider-url': { type: 'string' },
        'provider-key': { type: 'string' },
        profile: { type: 'string' },
        'out-dir': { type: 'string' },
        'max-queries': { type: 'string' },
        'max-results-per-query': { type: 'string' },
        'timeout-ms': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  const readNumber = (value: unknown): number | null => {
    if (typeof value !== 'string') {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  };

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    query: typeof values.query === 'string' ? values.query : null,
    inputPath: typeof values.input === 'string' ? values.input : null,
    resultsPath: typeof values.results === 'string' ? values.results : null,
    providerUrl: typeof values['provider-url'] === 'string' ? values['provider-url'] : null,
    providerKey: typeof values['provider-key'] === 'string' ? values['provider-key'] : null,
    profile: typeof values.profile === 'string' ? values.profile : null,
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : null,
    maxQueries: readNumber(values['max-queries']),
    maxResultsPerQuery: readNumber(values['max-results-per-query']),
    timeoutMs: readNumber(values['timeout-ms']),
  };
}

function parseDatasetReferencesRewriteFlags(args: string[]): {
  help: boolean;
  json: boolean;
  inputPath: string;
  from: string;
  to: string;
  types: string[];
  scope: string | null;
  outDir: string;
  commit: boolean;
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
        from: { type: 'string' },
        to: { type: 'string' },
        type: { type: 'string', multiple: true },
        types: { type: 'string', multiple: true },
        scope: { type: 'string' },
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
      code: 'DATASET_REFERENCES_REWRITE_MODE_CONFLICT',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    inputPath: typeof values.input === 'string' ? values.input : '',
    from: typeof values.from === 'string' ? values.from : '',
    to: typeof values.to === 'string' ? values.to : '',
    types: [
      ...(Array.isArray(values.type)
        ? values.type.filter((value): value is string => typeof value === 'string')
        : []),
      ...(Array.isArray(values.types)
        ? values.types.filter((value): value is string => typeof value === 'string')
        : []),
    ],
    scope: typeof values.scope === 'string' ? values.scope : null,
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : '',
    commit: Boolean(values.commit),
  };
}

function parseDatasetReferencesRefreshRemoteFlags(args: string[]): {
  help: boolean;
  json: boolean;
  inputPath: string;
  outPath: string;
  outDir: string;
  rootPolicy: 'existing' | 'candidate';
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
        out: { type: 'string' },
        'out-dir': { type: 'string' },
        'root-policy': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  const rawRootPolicy =
    typeof values['root-policy'] === 'string' ? values['root-policy'] : 'existing';
  if (!['existing', 'candidate'].includes(rawRootPolicy)) {
    throw new CliError("--root-policy must be 'existing' or 'candidate'.", {
      code: 'DATASET_REMOTE_REFRESH_ROOT_POLICY_INVALID',
      exitCode: 2,
    });
  }
  const rootPolicy = rawRootPolicy as 'existing' | 'candidate';

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    inputPath: typeof values.input === 'string' ? values.input : '',
    outPath: typeof values.out === 'string' ? values.out : '',
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : '',
    rootPolicy,
  };
}

function parseIdentityPreflightFlags(args: string[]): {
  help: boolean;
  json: boolean;
  inputPath: string;
  outDir: string | null;
  candidateInputPaths: string[];
  remoteCandidateSearch: boolean;
  remoteQuery: string | null;
  remoteLimit: number | null;
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
        'candidate-input': { type: 'string', multiple: true },
        'remote-candidates': { type: 'boolean' },
        'remote-query': { type: 'string' },
        'remote-limit': { type: 'string' },
        'out-dir': { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  const candidateInputValue = values['candidate-input'];
  const parseRemoteLimit = (value: unknown): number | null => {
    if (typeof value !== 'string') {
      return null;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new CliError('Expected --remote-limit to be a positive integer.', {
        code: 'INVALID_IDENTITY_PREFLIGHT_REMOTE_LIMIT',
        exitCode: 2,
      });
    }
    return parsed;
  };
  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    inputPath: typeof values.input === 'string' ? values.input : '',
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : null,
    candidateInputPaths: Array.isArray(candidateInputValue)
      ? candidateInputValue.filter((entry): entry is string => typeof entry === 'string')
      : [],
    remoteCandidateSearch: Boolean(values['remote-candidates']),
    remoteQuery: typeof values['remote-query'] === 'string' ? values['remote-query'] : null,
    remoteLimit: parseRemoteLimit(values['remote-limit']),
  };
}

function parseBuildPlanFlags(args: string[]): {
  help: boolean;
  json: boolean;
  inputPath: string;
  outDir: string | null;
  reportOnly: boolean;
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
        'report-only': { type: 'boolean' },
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
    reportOnly: Boolean(values['report-only']),
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
  rowsFile: string | undefined;
  runRoot: string | undefined;
  runId: string | undefined;
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
        'rows-file': { type: 'string' },
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
    rowsFile: typeof values['rows-file'] === 'string' ? values['rows-file'] : undefined,
    runRoot: typeof values['run-root'] === 'string' ? values['run-root'] : undefined,
    runId: typeof values['run-id'] === 'string' ? values['run-id'] : undefined,
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

function parseLifecyclemodelSaveDraftFlags(args: string[]): {
  help: boolean;
  json: boolean;
  inputPath: string;
  outDir: string | null;
  commit: boolean;
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
      code: 'INVALID_LIFECYCLEMODEL_SAVE_DRAFT_MODE',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    inputPath: typeof values.input === 'string' ? values.input : '',
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : null,
    commit: Boolean(values.commit),
  };
}

function parseLifecyclemodelGraphFlags(args: string[]): {
  help: boolean;
  json: boolean;
  inputPath: string;
  outDir: string;
  format: string | undefined;
  checkConnections: boolean;
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
        format: { type: 'string' },
        'check-connections': { type: 'boolean' },
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
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : '',
    format: typeof values.format === 'string' ? values.format : undefined,
    checkConnections: Boolean(values['check-connections']),
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

function parseProcessListFlags(args: string[]): {
  help: boolean;
  json: boolean;
  ids: string[];
  version: string | null;
  userId: string | null;
  stateCodes: number[];
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
          code: 'INVALID_PROCESS_LIST_STATE_CODE',
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
      code: 'PROCESS_LIST_PAGE_SIZE_REQUIRES_ALL',
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
    limit: parseOptionalPositiveIntegerFlag(values.limit, '--limit', 'INVALID_PROCESS_LIST_LIMIT'),
    offset: parseOptionalNonNegativeIntegerFlag(
      values.offset,
      '--offset',
      'INVALID_PROCESS_LIST_OFFSET',
    ),
    all: Boolean(values.all),
    pageSize: parseOptionalPositiveIntegerFlag(
      values['page-size'],
      '--page-size',
      'INVALID_PROCESS_LIST_PAGE_SIZE',
    ),
    order: typeof values.order === 'string' ? values.order : null,
  };
}

function parseProcessScopeStatisticsFlags(args: string[]): {
  help: boolean;
  json: boolean;
  outDir: string;
  scope: 'visible' | 'current-user' | undefined;
  stateCodes: number[];
  pageSize: number | null;
  reuseSnapshot: boolean;
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
        'out-dir': { type: 'string' },
        scope: { type: 'string' },
        'state-code': { type: 'string', multiple: true },
        'state-codes': { type: 'string' },
        'page-size': { type: 'string' },
        'reuse-snapshot': { type: 'boolean' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  const parseStateCode = (value: string): number => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new CliError('Expected --state-code to be a non-negative integer.', {
        code: 'INVALID_PROCESS_SCOPE_STATE_CODE',
        exitCode: 2,
      });
    }
    return parsed;
  };

  const stateCodes = [
    ...(Array.isArray(values['state-code'])
      ? values['state-code'].map((value) => parseStateCode(String(value)))
      : []),
    ...(typeof values['state-codes'] === 'string' ? values['state-codes'].split(',') : [])
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => parseStateCode(value)),
  ];

  let pageSize: number | null = null;
  if (typeof values['page-size'] === 'string') {
    const parsed = Number.parseInt(values['page-size'], 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new CliError('Expected --page-size to be a positive integer.', {
        code: 'INVALID_PROCESS_SCOPE_PAGE_SIZE',
        exitCode: 2,
      });
    }
    pageSize = parsed;
  }

  let scope: 'visible' | 'current-user' | undefined;
  if (typeof values.scope === 'string') {
    if (values.scope !== 'visible' && values.scope !== 'current-user') {
      throw new CliError("Expected --scope to be either 'visible' or 'current-user'.", {
        code: 'INVALID_PROCESS_SCOPE_SCOPE',
        exitCode: 2,
      });
    }
    scope = values.scope;
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : '',
    scope,
    stateCodes,
    pageSize,
    reuseSnapshot: Boolean(values['reuse-snapshot']),
  };
}

function parseProcessDedupReviewFlags(args: string[]): {
  help: boolean;
  json: boolean;
  inputPath: string;
  outDir: string;
  skipRemote: boolean;
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
        'skip-remote': { type: 'boolean' },
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
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : '',
    skipRemote: Boolean(values['skip-remote']),
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

function parseProcessSaveDraftFlags(args: string[]): {
  help: boolean;
  json: boolean;
  inputPath: string;
  outDir: string | null;
  commit: boolean;
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
      code: 'INVALID_PROCESS_SAVE_DRAFT_MODE',
      exitCode: 2,
    });
  }

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    inputPath: typeof values.input === 'string' ? values.input : '',
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : null,
    commit: Boolean(values.commit),
  };
}

function parseProcessRequiredFieldsFlags(args: string[]): {
  help: boolean;
  json: boolean;
  inputPath: string;
  outPath: string;
  outDir: string | null;
  flowInputPath: string | null;
  defaultUnit: string | null;
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
        out: { type: 'string' },
        'out-dir': { type: 'string' },
        flows: { type: 'string' },
        'default-unit': { type: 'string' },
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
    outPath: typeof values.out === 'string' ? values.out : '',
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : null,
    flowInputPath: typeof values.flows === 'string' ? values.flows : null,
    defaultUnit: typeof values['default-unit'] === 'string' ? values['default-unit'] : null,
  };
}

function parseProcessRefreshReferencesFlags(args: string[]): {
  help: boolean;
  json: boolean;
  outDir: string;
  apply: boolean;
  reuseManifest: boolean;
  limit: number | null;
  pageSize: number | null;
  concurrency: number | null;
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
        'out-dir': { type: 'string' },
        apply: { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        'reuse-manifest': { type: 'boolean' },
        limit: { type: 'string' },
        'page-size': { type: 'string' },
        concurrency: { type: 'string' },
      },
    }));
  } catch (error) {
    throw new CliError(String(error), {
      code: 'INVALID_ARGS',
      exitCode: 2,
    });
  }

  if (values.apply && values['dry-run']) {
    throw new CliError('Cannot pass both --apply and --dry-run.', {
      code: 'PROCESS_REFRESH_MODE_CONFLICT',
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

  return {
    help: Boolean(values.help),
    json: Boolean(values.json),
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : '',
    apply: Boolean(values.apply),
    reuseManifest: Boolean(values['reuse-manifest']),
    limit: parseOptionalPositiveIntegerFlag(
      values.limit,
      '--limit',
      'INVALID_PROCESS_REFRESH_LIMIT',
    ),
    pageSize: parseOptionalPositiveIntegerFlag(
      values['page-size'],
      '--page-size',
      'INVALID_PROCESS_REFRESH_PAGE_SIZE',
    ),
    concurrency: parseOptionalPositiveIntegerFlag(
      values.concurrency,
      '--concurrency',
      'INVALID_PROCESS_REFRESH_CONCURRENCY',
    ),
  };
}

function parseProcessVerifyRowsFlags(args: string[]): {
  help: boolean;
  json: boolean;
  rowsFile: string;
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
        'rows-file': { type: 'string' },
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
    rowsFile: typeof values['rows-file'] === 'string' ? values['rows-file'] : '',
    outDir: typeof values['out-dir'] === 'string' ? values['out-dir'] : '',
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
    const lifecyclemodelSaveDraftImpl =
      deps.runLifecyclemodelSaveDraftImpl ?? runLifecyclemodelSaveDraft;
    const lifecyclemodelGraphImpl = deps.runLifecyclemodelGraphImpl ?? runLifecyclemodelGraph;
    const lifecyclemodelOrchestrateImpl =
      deps.runLifecyclemodelOrchestrateImpl ?? runLifecyclemodelOrchestrate;
    const processGetImpl = deps.runProcessGetImpl ?? runProcessGet;
    const processListImpl = deps.runProcessListImpl ?? runProcessList;
    const processAutoBuildImpl = deps.runProcessAutoBuildImpl ?? runProcessAutoBuild;
    const processBatchBuildImpl = deps.runProcessBatchBuildImpl ?? runProcessBatchBuild;
    const processScopeStatisticsImpl =
      deps.runProcessScopeStatisticsImpl ?? runProcessScopeStatistics;
    const processRefreshReferencesImpl =
      deps.runProcessRefreshReferencesImpl ?? runProcessRefreshReferences;
    const processDedupReviewImpl = deps.runProcessDedupReviewImpl ?? runProcessDedupReview;
    const processResumeBuildImpl = deps.runProcessResumeBuildImpl ?? runProcessResumeBuild;
    const processPublishBuildImpl = deps.runProcessPublishBuildImpl ?? runProcessPublishBuild;
    const processSaveDraftImpl = deps.runProcessSaveDraftImpl ?? runProcessSaveDraft;
    const processRequiredFieldsCompleteImpl =
      deps.runProcessRequiredFieldsCompleteImpl ?? runProcessRequiredFieldsComplete;
    const processVerifyRowsImpl = deps.runProcessVerifyRowsImpl ?? runProcessVerifyRows;
    const processIdentityPreflightImpl =
      deps.runProcessIdentityPreflightImpl ?? runProcessIdentityPreflight;
    const processBuildPlanValidateImpl =
      deps.runProcessBuildPlanValidateImpl ?? runProcessBuildPlanValidate;
    const processBuildPlanMaterializeImpl =
      deps.runProcessBuildPlanMaterializeImpl ?? runProcessBuildPlanMaterialize;
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
    const flowIdentityPreflightImpl = deps.runFlowIdentityPreflightImpl ?? runFlowIdentityPreflight;
    const flowBuildPlanValidateImpl = deps.runFlowBuildPlanValidateImpl ?? runFlowBuildPlanValidate;
    const flowBuildPlanMaterializeImpl =
      deps.runFlowBuildPlanMaterializeImpl ?? runFlowBuildPlanMaterialize;
    const datasetValidateImpl = deps.runDatasetValidateImpl ?? runDatasetValidate;
    const datasetReferencesRewriteImpl =
      deps.runDatasetReferencesRewriteImpl ?? runDatasetReferencesRewrite;
    const datasetRemoteRefreshImpl = deps.runDatasetRemoteRefreshImpl ?? runDatasetRemoteRefresh;
    const datasetRemoteVerifyImpl = deps.runDatasetRemoteVerifyImpl ?? runDatasetRemoteVerify;
    const datasetBilingualExtractImpl =
      deps.runDatasetBilingualExtractImpl ?? runDatasetBilingualExtract;
    const datasetBilingualApplyImpl = deps.runDatasetBilingualApplyImpl ?? runDatasetBilingualApply;
    const datasetBilingualValidateImpl =
      deps.runDatasetBilingualValidateImpl ?? runDatasetBilingualValidate;
    const datasetEvidenceSearchImpl = deps.runDatasetEvidenceSearchImpl ?? runDatasetEvidenceSearch;
    const datasetContractImpl = deps.runDatasetContractImpl ?? runDatasetContract;
    const datasetImportLcaConvertImpl =
      deps.runDatasetImportLcaConvertImpl ?? runDatasetImportLcaConvert;
    const datasetAuthorImpl = deps.runDatasetAuthorImpl ?? runDatasetAuthor;

    if (flags.version) {
      return { exitCode: 0, stdout: `${loadCliPackageVersion(import.meta.url)}\n`, stderr: '' };
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

    if (command === 'dataset' && !subcommand) {
      return { exitCode: 0, stdout: `${renderDatasetHelp()}\n`, stderr: '' };
    }

    if (command === 'dataset' && subcommand === 'contract') {
      const action = commandArgs[0] ?? '';
      if (!action || action === '--help' || action === '-h') {
        return { exitCode: 0, stdout: `${renderDatasetContractHelp()}\n`, stderr: '' };
      }
      if (action !== 'get') {
        throw new CliError("dataset contract action must be 'get'.", {
          code: 'DATASET_CONTRACT_ACTION_INVALID',
          exitCode: 2,
        });
      }
      const datasetFlags = parseDatasetContractFlags(commandArgs.slice(1));
      if (datasetFlags.help) {
        return { exitCode: 0, stdout: `${renderDatasetContractHelp()}\n`, stderr: '' };
      }
      const report = await datasetContractImpl({
        type: datasetFlags.type,
        include: datasetFlags.include,
        profile: datasetFlags.profile,
        outDir: datasetFlags.outDir,
        mode: 'contract',
      });
      return {
        exitCode: 0,
        stdout: stringifyJson(report, datasetFlags.json),
        stderr: '',
      };
    }

    if (command === 'dataset' && subcommand === 'context-pack') {
      const datasetFlags = parseDatasetContractFlags(commandArgs);
      if (datasetFlags.help) {
        return { exitCode: 0, stdout: `${renderDatasetContextPackHelp()}\n`, stderr: '' };
      }
      const report = await datasetContractImpl({
        type: datasetFlags.type,
        include: datasetFlags.include,
        profile: datasetFlags.profile,
        outDir: datasetFlags.outDir,
        mode: 'context-pack',
      });
      return {
        exitCode: 0,
        stdout: stringifyJson(report, datasetFlags.json),
        stderr: '',
      };
    }

    if (command === 'dataset' && subcommand === 'import-lca') {
      const action = commandArgs[0] ?? '';
      if (!action || action === '--help' || action === '-h') {
        return { exitCode: 0, stdout: `${renderDatasetImportLcaHelp()}\n`, stderr: '' };
      }
      if (action !== 'convert') {
        throw new CliError("dataset import-lca action must be 'convert'.", {
          code: 'DATASET_IMPORT_LCA_ACTION_INVALID',
          exitCode: 2,
        });
      }
      const datasetFlags = parseDatasetImportLcaConvertFlags(commandArgs.slice(1));
      if (datasetFlags.help) {
        return { exitCode: 0, stdout: `${renderDatasetImportLcaHelp()}\n`, stderr: '' };
      }
      const report = await datasetImportLcaConvertImpl({
        inputPath: datasetFlags.inputPath,
        outputDir: datasetFlags.outputDir,
        fromFormat: datasetFlags.fromFormat,
        target: datasetFlags.target,
        reportPath: datasetFlags.reportPath,
        mappingDir: datasetFlags.mappingDir,
        language: datasetFlags.language,
        validationJobs: datasetFlags.validationJobs,
        detectOnly: datasetFlags.detectOnly,
        failOnWarning: datasetFlags.failOnWarning,
        pythonBin: datasetFlags.pythonBin,
        tidasToolsDir: datasetFlags.tidasToolsDir,
        env: deps.env,
      });
      return {
        exitCode: report.status === 'completed' ? 0 : 1,
        stdout: stringifyJson(report, datasetFlags.json),
        stderr: '',
      };
    }

    if (command === 'dataset' && subcommand === 'author') {
      const datasetFlags = parseDatasetAuthorFlags(commandArgs);
      if (datasetFlags.help) {
        return { exitCode: 0, stdout: `${renderDatasetAuthorHelp()}\n`, stderr: '' };
      }
      const report = await datasetAuthorImpl({
        inputPath: datasetFlags.inputPath,
        targetTypes: datasetFlags.targetTypes,
        outDir: datasetFlags.outDir,
        prompt: datasetFlags.prompt,
        provider: datasetFlags.provider,
        model: datasetFlags.model,
        timeoutMs: datasetFlags.timeoutMs,
        env: deps.env,
        fetchImpl: deps.fetchImpl,
      });
      return {
        exitCode: 0,
        stdout: stringifyJson(report, datasetFlags.json),
        stderr: '',
      };
    }

    if (command === 'dataset' && subcommand === 'validate') {
      const datasetFlags = parseDatasetValidateFlags(commandArgs);
      if (datasetFlags.help) {
        return { exitCode: 0, stdout: `${renderDatasetValidateHelp()}\n`, stderr: '' };
      }

      const report = await datasetValidateImpl({
        inputPath: datasetFlags.inputPath,
        type: datasetFlags.type,
        outDir: datasetFlags.outDir,
      });

      return {
        exitCode: report.counts.invalid > 0 ? 1 : 0,
        stdout: stringifyJson(report, datasetFlags.json),
        stderr: '',
      };
    }

    if (command === 'dataset' && subcommand === 'verify-remote') {
      const datasetFlags = parseDatasetRemoteVerifyFlags(commandArgs);
      if (datasetFlags.help) {
        return { exitCode: 0, stdout: `${renderDatasetRemoteVerifyHelp()}\n`, stderr: '' };
      }

      const report = await datasetRemoteVerifyImpl({
        inputPath: datasetFlags.inputPath,
        outDir: datasetFlags.outDir,
        rootPolicy: datasetFlags.rootPolicy,
        env: deps.env,
        fetchImpl: deps.fetchImpl,
      });

      return {
        exitCode: report.status === 'blocked_remote_verification' ? 1 : 0,
        stdout: stringifyJson(report, datasetFlags.json),
        stderr: '',
      };
    }

    if (command === 'dataset' && subcommand === 'bilingual') {
      const action = commandArgs[0] ?? '';
      if (!action || action === '--help' || action === '-h') {
        return { exitCode: 0, stdout: `${renderDatasetBilingualHelp()}\n`, stderr: '' };
      }

      if (action === 'extract') {
        const datasetFlags = parseDatasetBilingualExtractFlags(commandArgs.slice(1));
        if (datasetFlags.help) {
          return { exitCode: 0, stdout: `${renderDatasetBilingualExtractHelp()}\n`, stderr: '' };
        }
        const report = await datasetBilingualExtractImpl({
          inputPath: datasetFlags.inputPath,
          type: datasetFlags.type,
          sourceLang: datasetFlags.sourceLang,
          targetLang: datasetFlags.targetLang,
          outDir: datasetFlags.outDir,
        });
        return {
          exitCode: 0,
          stdout: stringifyJson(report, datasetFlags.json),
          stderr: '',
        };
      }

      if (action === 'apply') {
        const datasetFlags = parseDatasetBilingualApplyFlags(commandArgs.slice(1));
        if (datasetFlags.help) {
          return { exitCode: 0, stdout: `${renderDatasetBilingualApplyHelp()}\n`, stderr: '' };
        }
        const report = await datasetBilingualApplyImpl({
          inputPath: datasetFlags.inputPath,
          translationsPath: datasetFlags.translationsPath,
          outPath: datasetFlags.outPath,
          targetLang: datasetFlags.targetLang,
          outDir: datasetFlags.outDir,
        });
        return {
          exitCode: report.status === 'blocked' ? 1 : 0,
          stdout: stringifyJson(report, datasetFlags.json),
          stderr: '',
        };
      }

      if (action === 'validate') {
        const datasetFlags = parseDatasetBilingualValidateFlags(commandArgs.slice(1));
        if (datasetFlags.help) {
          return { exitCode: 0, stdout: `${renderDatasetBilingualValidateHelp()}\n`, stderr: '' };
        }
        const report = await datasetBilingualValidateImpl({
          inputPath: datasetFlags.inputPath,
          type: datasetFlags.type,
          outDir: datasetFlags.outDir,
        });
        return {
          exitCode: report.status === 'blocked' ? 1 : 0,
          stdout: stringifyJson(report, datasetFlags.json),
          stderr: '',
        };
      }

      throw new CliError("dataset bilingual action must be 'extract', 'apply', or 'validate'.", {
        code: 'INVALID_ARGS',
        exitCode: 2,
      });
    }

    if (command === 'dataset' && subcommand === 'evidence-search') {
      const action = commandArgs[0] ?? '';
      if (!action || action === '--help' || action === '-h') {
        return { exitCode: 0, stdout: `${renderDatasetEvidenceSearchHelp()}\n`, stderr: '' };
      }
      if (action !== 'plan' && action !== 'run') {
        throw new CliError("dataset evidence-search action must be 'plan' or 'run'.", {
          code: 'INVALID_ARGS',
          exitCode: 2,
        });
      }

      const datasetFlags = parseDatasetEvidenceSearchFlags(commandArgs.slice(1));
      if (datasetFlags.help) {
        return { exitCode: 0, stdout: `${renderDatasetEvidenceSearchHelp()}\n`, stderr: '' };
      }
      const report = await datasetEvidenceSearchImpl({
        mode: action,
        query: datasetFlags.query,
        inputPath: datasetFlags.inputPath,
        resultsPath: datasetFlags.resultsPath,
        providerUrl: datasetFlags.providerUrl,
        providerKey: datasetFlags.providerKey,
        profile: datasetFlags.profile,
        outDir: datasetFlags.outDir,
        maxQueries: datasetFlags.maxQueries,
        maxResultsPerQuery: datasetFlags.maxResultsPerQuery,
        timeoutMs: datasetFlags.timeoutMs,
        fetchImpl: deps.fetchImpl,
      });
      return {
        exitCode: report.status === 'completed_no_sufficient_evidence' ? 1 : 0,
        stdout: stringifyJson(report, datasetFlags.json),
        stderr: '',
      };
    }

    if (command === 'dataset' && subcommand === 'references') {
      const action = commandArgs[0] ?? '';
      if (!action || action === '--help' || action === '-h') {
        return { exitCode: 0, stdout: `${renderDatasetReferencesHelp()}\n`, stderr: '' };
      }
      if (!['rewrite', 'refresh-remote'].includes(action)) {
        throw new CliError("dataset references action must be 'rewrite' or 'refresh-remote'.", {
          code: 'INVALID_ARGS',
          exitCode: 2,
        });
      }

      if (action === 'refresh-remote') {
        const datasetFlags = parseDatasetReferencesRefreshRemoteFlags(commandArgs.slice(1));
        if (datasetFlags.help) {
          return { exitCode: 0, stdout: `${renderDatasetReferencesHelp()}\n`, stderr: '' };
        }
        const report = await datasetRemoteRefreshImpl({
          inputPath: datasetFlags.inputPath,
          outPath: datasetFlags.outPath,
          outDir: datasetFlags.outDir,
          rootPolicy: datasetFlags.rootPolicy,
          env: deps.env,
          fetchImpl: deps.fetchImpl,
        });
        return {
          exitCode: report.status === 'completed_with_blockers' ? 1 : 0,
          stdout: stringifyJson(report, datasetFlags.json),
          stderr: '',
        };
      }

      const datasetFlags = parseDatasetReferencesRewriteFlags(commandArgs.slice(1));
      if (datasetFlags.help) {
        return { exitCode: 0, stdout: `${renderDatasetReferencesHelp()}\n`, stderr: '' };
      }

      const report = await datasetReferencesRewriteImpl({
        inputPath: datasetFlags.inputPath,
        from: datasetFlags.from,
        to: datasetFlags.to,
        types: datasetFlags.types,
        scope: datasetFlags.scope,
        outDir: datasetFlags.outDir,
        commit: datasetFlags.commit,
        env: deps.env,
        fetchImpl: deps.fetchImpl,
      });

      return {
        exitCode: report.status === 'completed_with_failures' ? 1 : 0,
        stdout: stringifyJson(report, datasetFlags.json),
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

    if (command === 'lifecyclemodel' && subcommand === 'save-draft') {
      const lifecyclemodelFlags = parseLifecyclemodelSaveDraftFlags(commandArgs);
      if (lifecyclemodelFlags.help) {
        return {
          exitCode: 0,
          stdout: `${renderLifecyclemodelSaveDraftHelp()}\n`,
          stderr: '',
        };
      }

      const report = await lifecyclemodelSaveDraftImpl({
        inputPath: lifecyclemodelFlags.inputPath,
        outDir: lifecyclemodelFlags.outDir,
        commit: lifecyclemodelFlags.commit,
        env: deps.env,
        fetchImpl: deps.fetchImpl,
      });

      return {
        exitCode: report.status === 'completed_with_failures' ? 1 : 0,
        stdout: stringifyJson(report, lifecyclemodelFlags.json),
        stderr: '',
      };
    }

    if (command === 'lifecyclemodel' && subcommand === 'graph') {
      const lifecyclemodelFlags = parseLifecyclemodelGraphFlags(commandArgs);
      if (lifecyclemodelFlags.help) {
        return {
          exitCode: 0,
          stdout: `${renderLifecyclemodelGraphHelp()}\n`,
          stderr: '',
        };
      }

      const report = await lifecyclemodelGraphImpl({
        inputPath: lifecyclemodelFlags.inputPath,
        outDir: lifecyclemodelFlags.outDir,
        format: lifecyclemodelFlags.format,
        checkConnections: lifecyclemodelFlags.checkConnections,
      });

      return {
        exitCode: report.status === 'completed_with_findings' ? 1 : 0,
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

    if (command === 'process' && subcommand === 'list') {
      const processFlags = parseProcessListFlags(commandArgs);
      if (processFlags.help) {
        return {
          exitCode: 0,
          stdout: `${renderProcessListHelp()}\n`,
          stderr: '',
        };
      }

      const report = await processListImpl({
        ids: processFlags.ids,
        version: processFlags.version,
        userId: processFlags.userId,
        stateCodes: processFlags.stateCodes,
        limit: processFlags.limit,
        offset: processFlags.offset,
        all: processFlags.all,
        pageSize: processFlags.pageSize,
        order: processFlags.order,
        env: deps.env,
        fetchImpl: deps.fetchImpl,
      });

      return {
        exitCode: 0,
        stdout: stringifyJson(report, processFlags.json),
        stderr: '',
      };
    }

    if (command === 'process' && subcommand === 'identity-preflight') {
      const processFlags = parseIdentityPreflightFlags(commandArgs);
      if (processFlags.help) {
        return {
          exitCode: 0,
          stdout: `${renderProcessIdentityPreflightHelp()}\n`,
          stderr: '',
        };
      }

      const report = await processIdentityPreflightImpl({
        inputPath: processFlags.inputPath,
        outDir: processFlags.outDir,
        candidateInputPaths: processFlags.candidateInputPaths,
        remoteCandidateSearch: processFlags.remoteCandidateSearch,
        remoteQuery: processFlags.remoteQuery,
        remoteLimit: processFlags.remoteLimit,
        env: deps.env,
        fetchImpl: deps.fetchImpl,
      });

      return {
        exitCode: report.status === 'passed' ? 0 : 1,
        stdout: stringifyJson(report, processFlags.json),
        stderr: '',
      };
    }

    if (command === 'process' && subcommand === 'build-plan') {
      const action = commandArgs[0] ?? '';
      if (!action || action === '--help' || action === '-h') {
        return {
          exitCode: 0,
          stdout: `${renderProcessBuildPlanHelp()}\n`,
          stderr: '',
        };
      }
      if (action !== 'validate' && action !== 'materialize') {
        throw new CliError("process build-plan action must be 'validate' or 'materialize'.", {
          code: 'INVALID_ARGS',
          exitCode: 2,
        });
      }
      const processFlags = parseBuildPlanFlags(commandArgs.slice(1));
      if (processFlags.help) {
        return {
          exitCode: 0,
          stdout: `${renderProcessBuildPlanHelp()}\n`,
          stderr: '',
        };
      }

      const report =
        action === 'validate'
          ? await processBuildPlanValidateImpl({
              inputPath: processFlags.inputPath,
              outDir: processFlags.outDir,
              reportOnly: processFlags.reportOnly,
            })
          : await processBuildPlanMaterializeImpl({
              inputPath: processFlags.inputPath,
              outDir: processFlags.outDir,
              reportOnly: processFlags.reportOnly,
            });

      return {
        exitCode: report.status === 'blocked' && !processFlags.reportOnly ? 1 : 0,
        stdout: stringifyJson(report, processFlags.json),
        stderr: '',
      };
    }

    if (command === 'process' && subcommand === 'scope-statistics') {
      const processFlags = parseProcessScopeStatisticsFlags(commandArgs);
      if (processFlags.help) {
        return {
          exitCode: 0,
          stdout: `${renderProcessScopeStatisticsHelp()}\n`,
          stderr: '',
        };
      }

      const report = await processScopeStatisticsImpl({
        outDir: processFlags.outDir,
        scope: processFlags.scope,
        stateCodes: processFlags.stateCodes,
        pageSize: processFlags.pageSize,
        reuseSnapshot: processFlags.reuseSnapshot,
        env: deps.env,
        fetchImpl: deps.fetchImpl,
      });

      return {
        exitCode: 0,
        stdout: stringifyJson(report, processFlags.json),
        stderr: '',
      };
    }

    if (command === 'process' && subcommand === 'dedup-review') {
      const processFlags = parseProcessDedupReviewFlags(commandArgs);
      if (processFlags.help) {
        return {
          exitCode: 0,
          stdout: `${renderProcessDedupReviewHelp()}\n`,
          stderr: '',
        };
      }

      const report = await processDedupReviewImpl({
        inputPath: processFlags.inputPath,
        outDir: processFlags.outDir,
        skipRemote: processFlags.skipRemote,
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

    if (command === 'process' && subcommand === 'complete-required-fields') {
      const processFlags = parseProcessRequiredFieldsFlags(commandArgs);
      if (processFlags.help) {
        return {
          exitCode: 0,
          stdout: `${renderProcessRequiredFieldsHelp()}\n`,
          stderr: '',
        };
      }

      const report = await processRequiredFieldsCompleteImpl({
        inputPath: processFlags.inputPath,
        outPath: processFlags.outPath,
        outDir: processFlags.outDir,
        flowInputPath: processFlags.flowInputPath,
        defaultUnit: processFlags.defaultUnit,
      });

      return {
        exitCode: report.status === 'completed_with_blockers' ? 1 : 0,
        stdout: stringifyJson(report, processFlags.json),
        stderr: '',
      };
    }

    if (command === 'process' && subcommand === 'save-draft') {
      const processFlags = parseProcessSaveDraftFlags(commandArgs);
      if (processFlags.help) {
        return {
          exitCode: 0,
          stdout: `${renderProcessSaveDraftHelp()}\n`,
          stderr: '',
        };
      }

      const report = await processSaveDraftImpl({
        inputPath: processFlags.inputPath,
        outDir: processFlags.outDir,
        commit: processFlags.commit,
        env: deps.env,
        fetchImpl: deps.fetchImpl,
      });

      return {
        exitCode: report.status === 'completed_with_failures' ? 1 : 0,
        stdout: stringifyJson(report, processFlags.json),
        stderr: '',
      };
    }

    if (command === 'process' && subcommand === 'refresh-references') {
      const processFlags = parseProcessRefreshReferencesFlags(commandArgs);
      if (processFlags.help) {
        return {
          exitCode: 0,
          stdout: `${renderProcessRefreshReferencesHelp()}\n`,
          stderr: '',
        };
      }

      const report = await processRefreshReferencesImpl({
        outDir: processFlags.outDir,
        apply: processFlags.apply,
        reuseManifest: processFlags.reuseManifest,
        limit: processFlags.limit,
        pageSize: processFlags.pageSize,
        concurrency: processFlags.concurrency,
        env: deps.env,
        fetchImpl: deps.fetchImpl,
      });

      return {
        exitCode: report.status === 'completed_process_reference_refresh_with_errors' ? 1 : 0,
        stdout: stringifyJson(report, processFlags.json),
        stderr: '',
      };
    }

    if (command === 'process' && subcommand === 'verify-rows') {
      const processFlags = parseProcessVerifyRowsFlags(commandArgs);
      if (processFlags.help) {
        return {
          exitCode: 0,
          stdout: `${renderProcessVerifyRowsHelp()}\n`,
          stderr: '',
        };
      }

      const report = await processVerifyRowsImpl({
        rowsFile: processFlags.rowsFile,
        outDir: processFlags.outDir,
      });

      return {
        exitCode: report.invalid_count > 0 ? 1 : 0,
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

    if (command === 'flow' && subcommand === 'identity-preflight') {
      const flowFlags = parseIdentityPreflightFlags(commandArgs);
      if (flowFlags.help) {
        return { exitCode: 0, stdout: `${renderFlowIdentityPreflightHelp()}\n`, stderr: '' };
      }

      const report = await flowIdentityPreflightImpl({
        inputPath: flowFlags.inputPath,
        outDir: flowFlags.outDir,
        candidateInputPaths: flowFlags.candidateInputPaths,
        remoteCandidateSearch: flowFlags.remoteCandidateSearch,
        remoteQuery: flowFlags.remoteQuery,
        remoteLimit: flowFlags.remoteLimit,
        env: deps.env,
        fetchImpl: deps.fetchImpl,
      });

      return {
        exitCode: report.status === 'passed' ? 0 : 1,
        stdout: stringifyJson(report, flowFlags.json),
        stderr: '',
      };
    }

    if (command === 'flow' && subcommand === 'build-plan') {
      const action = commandArgs[0] ?? '';
      if (!action || action === '--help' || action === '-h') {
        return { exitCode: 0, stdout: `${renderFlowBuildPlanHelp()}\n`, stderr: '' };
      }
      if (action !== 'validate' && action !== 'materialize') {
        throw new CliError("flow build-plan action must be 'validate' or 'materialize'.", {
          code: 'INVALID_ARGS',
          exitCode: 2,
        });
      }
      const flowFlags = parseBuildPlanFlags(commandArgs.slice(1));
      if (flowFlags.help) {
        return { exitCode: 0, stdout: `${renderFlowBuildPlanHelp()}\n`, stderr: '' };
      }

      const report =
        action === 'validate'
          ? await flowBuildPlanValidateImpl({
              inputPath: flowFlags.inputPath,
              outDir: flowFlags.outDir,
              reportOnly: flowFlags.reportOnly,
            })
          : await flowBuildPlanMaterializeImpl({
              inputPath: flowFlags.inputPath,
              outDir: flowFlags.outDir,
              reportOnly: flowFlags.reportOnly,
            });

      return {
        exitCode: report.status === 'blocked' && !flowFlags.reportOnly ? 1 : 0,
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
        rowsFile: reviewFlags.rowsFile,
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
