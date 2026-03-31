import { parseArgs } from 'node:util';
import { buildDoctorReport, readRuntimeEnv } from './lib/env.js';
import type { DotEnvLoadResult } from './lib/dotenv.js';
import { CliError, toErrorPayload } from './lib/errors.js';
import type { FetchLike } from './lib/http.js';
import { stringifyJson } from './lib/io.js';
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
  runFlowRemediate,
  type FlowRemediationReport,
  type RunFlowRemediateOptions,
} from './lib/flow-remediate.js';
import { runFlowGet, type FlowGetReport, type RunFlowGetOptions } from './lib/flow-get.js';
import { runFlowList, type FlowListReport, type RunFlowListOptions } from './lib/flow-list.js';
import {
  runFlowPublishVersion,
  type FlowPublishVersionReport,
  type RunFlowPublishVersionOptions,
} from './lib/flow-publish-version.js';
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
  runLifecyclemodelBuildResultingProcessImpl?: (
    options: RunLifecyclemodelResultingProcessOptions,
  ) => Promise<LifecyclemodelResultingProcessReport>;
  runLifecyclemodelPublishResultingProcessImpl?: (
    options: RunLifecyclemodelPublishResultingProcessOptions,
  ) => Promise<LifecyclemodelPublishResultingProcessReport>;
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
  runFlowRemediateImpl?: (options: RunFlowRemediateOptions) => Promise<FlowRemediationReport>;
  runFlowGetImpl?: (options: RunFlowGetOptions) => Promise<FlowGetReport>;
  runFlowListImpl?: (options: RunFlowListOptions) => Promise<FlowListReport>;
  runFlowPublishVersionImpl?: (
    options: RunFlowPublishVersionOptions,
  ) => Promise<FlowPublishVersionReport>;
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
  flow       get | list | remediate | publish-version
  lifecyclemodel build-resulting-process | publish-resulting-process
  review     process | flow
  publish    run
  validation run
  admin      embedding-run

Planned Surface (not implemented yet):
  auth       whoami | doctor-auth
  lifecyclemodel auto-build | validate-build | publish-build
  review     lifecyclemodel
  flow       regen-product
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
  tiangong flow get --id <flow-id> --version <version>
  tiangong flow list --id <flow-id> --state-code 100 --limit 20
  tiangong flow remediate --input-file ./invalid-flows.jsonl --out-dir ./flow-remediation
  tiangong flow publish-version --input-file ./ready-flows.jsonl --out-dir ./flow-publish --commit
  tiangong review process --run-root ./artifacts/process_from_flow/<run_id> --run-id <run_id> --out-dir ./review
  tiangong review flow --rows-file ./flows.json --out-dir ./review
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
  --engine <mode>      auto | sdk | tools | all (default: auto)
  --report-file <file> Write the structured validation report to a file
  --json               Print compact JSON
  -h, --help
`.trim();
}

function renderFlowHelp(): string {
  return `Usage:
  tiangong flow <subcommand> [options]

Implemented Subcommands:
  get          Load one flow dataset by identifier through direct Supabase REST
  list         Enumerate flow datasets through direct Supabase REST with deterministic filters
  remediate    Deterministically repair invalid local flow rows and emit artifact-first outputs
  publish-version Publish remediated flow versions through the unified CLI surface

Planned Subcommands:
  regen-product   Regenerate later product-side artifacts from a flow workflow slice

Examples:
  tiangong flow --help
  tiangong flow get --help
  tiangong flow list --help
  tiangong flow remediate --help
  tiangong flow publish-version --help
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

Runtime note:
  The CLI derives a direct Supabase REST read path from TIANGONG_LCA_API_BASE_URL.
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

Runtime note:
  The CLI derives a direct Supabase REST read path from TIANGONG_LCA_API_BASE_URL.
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

Outputs written under --out-dir:
  - flows_tidas_sdk_plus_classification_mcp_success_list.json
  - flows_tidas_sdk_plus_classification_remote_validation_failed.jsonl
  - flows_tidas_sdk_plus_classification_mcp_sync_report.json
`.trim();
}

function renderReviewHelp(): string {
  return `Usage:
  tiangong review <subcommand> [options]

Implemented Subcommands:
  process      Review one local process build run and emit artifact-first findings
  flow         Review local flow governance snapshots and emit artifact-first findings

Planned Subcommands:
  lifecyclemodel Review lifecycle model build artifacts through the unified CLI

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
  --enable-llm              Enable optional semantic review via the CLI LLM client
  --llm-model <name>        Override TIANGONG_LCA_LLM_MODEL for this command
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
  --enable-llm              Enable optional semantic review via the CLI LLM client
  --llm-model <name>        Override TIANGONG_LCA_LLM_MODEL for this command
  --llm-max-flows <n>       Cap how many flow summaries are sent to the LLM (default: 120)
  --llm-batch-size <n>      Cap how many flow summaries each LLM batch sends (default: 20)
  --similarity-threshold <n> Similarity threshold for duplicate-candidate warnings (default: 0.92)
  --methodology-id <name>   Label written into methodology-backed rule findings (default: built_in)
  --json                    Print compact JSON
  -h, --help
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
  build-resulting-process   Deterministically aggregate a lifecycle model into a resulting process bundle
  publish-resulting-process Prepare publish-bundle.json and publish-intent.json from a prior resulting-process run

Planned Subcommands:
  auto-build                Assemble lifecycle models from discovered candidate processes
  validate-build            Re-run local validation on a lifecycle model build run
  publish-build             Publish a lifecycle model build run through the unified publish layer

Examples:
  tiangong lifecyclemodel --help
  tiangong lifecyclemodel build-resulting-process --help
  tiangong lifecyclemodel auto-build --help
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

Runtime note:
  The CLI derives a direct Supabase REST read path from TIANGONG_LCA_API_BASE_URL.
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
  get          Load one process dataset by identifier through direct Supabase REST
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

const lifecyclemodelPlannedHelp = {
  'auto-build': `Usage:
  tiangong lifecyclemodel auto-build --input <file> [options]

Planned contract:
  - read one lifecycle model build manifest from --input
  - discover candidate processes through CLI query surfaces
  - assemble native json_ordered lifecycle model artifacts locally

Status:
  Planned command. Execution is not implemented yet.
`.trim(),
  'validate-build': `Usage:
  tiangong lifecyclemodel validate-build --run-dir <dir> [options]

Planned contract:
  - load one lifecycle model build run directory
  - re-run local validation through the unified validation module
  - write a structured validation report into the run artifacts

Status:
  Planned command. Execution is not implemented yet.
`.trim(),
  'publish-build': `Usage:
  tiangong lifecyclemodel publish-build --run-dir <dir> [options]

Planned contract:
  - load one lifecycle model build run directory
  - publish lifecycle model artifacts through the unified publish module
  - preserve dry-run and commit semantics from tiangong publish run

Status:
  Planned command. Execution is not implemented yet.
`.trim(),
} as const;

const reviewPlannedHelp = {
  lifecyclemodel: `Usage:
  tiangong review lifecyclemodel --input <file> [options]

Planned contract:
  - load one lifecycle model build run or normalized review request
  - emit artifact-first lifecycle model review findings and handoff metadata
  - keep semantic review behind the CLI LLM abstraction instead of skill-local logic

Status:
  Planned command. Execution is not implemented yet.
`.trim(),
} as const;

const flowPlannedHelp = {
  'regen-product': `Usage:
  tiangong flow regen-product --input <file> [options]

Planned contract:
  - regenerate later product-side artifacts from a flow-centered workflow slice
  - keep artifact boundaries explicit and file-first

Status:
  Planned command. Execution is not implemented yet.
`.trim(),
} as const;

type LifecyclemodelPlannedSubcommand = keyof typeof lifecyclemodelPlannedHelp;
type ReviewPlannedSubcommand = keyof typeof reviewPlannedHelp;
type FlowPlannedSubcommand = keyof typeof flowPlannedHelp;

function isLifecyclemodelPlannedSubcommand(
  value: string | null,
): value is LifecyclemodelPlannedSubcommand {
  return Boolean(value && value in lifecyclemodelPlannedHelp);
}

function isReviewPlannedSubcommand(value: string | null): value is ReviewPlannedSubcommand {
  return Boolean(value && value in reviewPlannedHelp);
}

function isFlowPlannedSubcommand(value: string | null): value is FlowPlannedSubcommand {
  return Boolean(value && value in flowPlannedHelp);
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

function resolveRemoteRuntime(
  env: NodeJS.ProcessEnv,
  overrides: Pick<ReturnType<typeof parseRemoteFlags>, 'apiBaseUrl' | 'apiKey' | 'region'>,
) {
  const runtimeEnv = readRuntimeEnv(env);

  return {
    apiBaseUrl: overrides.apiBaseUrl ?? runtimeEnv.apiBaseUrl,
    apiKey: overrides.apiKey ?? runtimeEnv.apiKey,
    region: overrides.region ?? runtimeEnv.region,
  };
}

export async function executeCli(argv: string[], deps: CliDeps): Promise<CliResult> {
  try {
    const { flags, command, subcommand, commandArgs } = parseCommandLine(argv);
    const publishImpl = deps.runPublishImpl ?? runPublish;
    const validationImpl = deps.runValidationImpl ?? runValidation;
    const lifecyclemodelBuildImpl =
      deps.runLifecyclemodelBuildResultingProcessImpl ?? runLifecyclemodelBuildResultingProcess;
    const lifecyclemodelPublishImpl =
      deps.runLifecyclemodelPublishResultingProcessImpl ?? runLifecyclemodelPublishResultingProcess;
    const processGetImpl = deps.runProcessGetImpl ?? runProcessGet;
    const processAutoBuildImpl = deps.runProcessAutoBuildImpl ?? runProcessAutoBuild;
    const processBatchBuildImpl = deps.runProcessBatchBuildImpl ?? runProcessBatchBuild;
    const processResumeBuildImpl = deps.runProcessResumeBuildImpl ?? runProcessResumeBuild;
    const processPublishBuildImpl = deps.runProcessPublishBuildImpl ?? runProcessPublishBuild;
    const processReviewImpl = deps.runProcessReviewImpl ?? runProcessReview;
    const flowReviewImpl = deps.runFlowReviewImpl ?? runFlowReview;
    const flowRemediateImpl = deps.runFlowRemediateImpl ?? runFlowRemediate;
    const flowGetImpl = deps.runFlowGetImpl ?? runFlowGet;
    const flowListImpl = deps.runFlowListImpl ?? runFlowList;
    const flowPublishVersionImpl = deps.runFlowPublishVersionImpl ?? runFlowPublishVersion;

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
      const runtime = resolveRemoteRuntime(deps.env, remoteFlags);

      return {
        exitCode: 0,
        stdout: await executeRemoteCommand({
          commandKey,
          inputPath: remoteFlags.inputPath,
          apiBaseUrl: runtime.apiBaseUrl,
          apiKey: runtime.apiKey,
          region: runtime.region,
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

    if (command === 'lifecyclemodel' && isLifecyclemodelPlannedSubcommand(subcommand)) {
      if (commandArgs.includes('--help') || commandArgs.includes('-h')) {
        return {
          exitCode: 0,
          stdout: `${lifecyclemodelPlannedHelp[subcommand]}\n`,
          stderr: '',
        };
      }
      return plannedCommand(command, subcommand);
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

    if (command === 'flow' && isFlowPlannedSubcommand(subcommand)) {
      if (commandArgs.includes('--help') || commandArgs.includes('-h')) {
        return {
          exitCode: 0,
          stdout: `${flowPlannedHelp[subcommand]}\n`,
          stderr: '',
        };
      }
      return plannedCommand(command, subcommand);
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
      const runtime = resolveRemoteRuntime(deps.env, remoteFlags);

      return {
        exitCode: 0,
        stdout: await executeRemoteCommand({
          commandKey: 'admin:embedding-run',
          inputPath: remoteFlags.inputPath,
          apiBaseUrl: runtime.apiBaseUrl,
          apiKey: runtime.apiKey,
          region: runtime.region,
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

    if (command === 'review' && isReviewPlannedSubcommand(subcommand)) {
      if (commandArgs.includes('--help') || commandArgs.includes('-h')) {
        return {
          exitCode: 0,
          stdout: `${reviewPlannedHelp[subcommand]}\n`,
          stderr: '',
        };
      }
      return plannedCommand(command, subcommand);
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
