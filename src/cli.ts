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
  runProcessResumeBuild,
  type ProcessResumeBuildReport,
  type RunProcessResumeBuildOptions,
} from './lib/process-resume-build.js';
import { runPublish, type PublishReport, type RunPublishOptions } from './lib/publish.js';
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
  runProcessAutoBuildImpl?: (
    options: RunProcessAutoBuildOptions,
  ) => Promise<ProcessAutoBuildReport>;
  runProcessResumeBuildImpl?: (
    options: RunProcessResumeBuildOptions,
  ) => Promise<ProcessResumeBuildReport>;
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
  process    auto-build | resume-build
  lifecyclemodel build-resulting-process | publish-resulting-process
  publish    run
  validation run
  admin      embedding-run

Planned Surface (not implemented yet):
  auth       whoami | doctor-auth
  lifecyclemodel auto-build | validate-build | publish-build
  review     flow | process
  flow       get | list | remediate | publish-version | regen-product
  process    get | auto-build | resume-build | publish-build | batch-build
  job        get | wait | logs

Planned commands currently print an explicit "not implemented yet" message and exit with code 2.

Examples:
  tiangong doctor
  tiangong search flow --input ./request.json
  tiangong search process --input ./request.json --dry-run
  tiangong process auto-build --input ./pff-request.json
  tiangong process resume-build --run-id <id>
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

function renderLifecyclemodelBuildResultingProcessHelp(): string {
  return `Usage:
  tiangong lifecyclemodel build-resulting-process --input <file> [options]

Options:
  --input <file>     JSON request file
  --out-dir <dir>    Override the default artifact output directory
  --json             Print compact JSON
  -h, --help
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

function renderProcessHelp(): string {
  return `Usage:
  tiangong process <subcommand> [options]

Implemented Subcommands:
  auto-build   Prepare a local process-from-flow run scaffold and artifact workspace
  resume-build Prepare a local resume handoff from one existing process build run

Planned Subcommands:
  get          Load one process dataset or process build run summary
  publish-build Publish a process build run through the unified publish layer
  batch-build  Run multiple process build requests through one batch-oriented CLI surface

Examples:
  tiangong process --help
  tiangong process auto-build --help
  tiangong process resume-build --run-id <id> --help
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

const processPlannedHelp = {
  get: `Usage:
  tiangong process get --id <process-id> [options]

Planned contract:
  - load one process dataset or process build run summary by identifier
  - keep read-only access distinct from build/publish workflows

Status:
  Planned command. Execution is not implemented yet.
`.trim(),
  'publish-build': `Usage:
  tiangong process publish-build --run-id <id> [options]

Planned contract:
  - load one completed process build run
  - generate publish handoff artifacts and later commit through the unified publish layer

Status:
  Planned command. Execution is not implemented yet.
`.trim(),
  'batch-build': `Usage:
  tiangong process batch-build --input <file> [options]

Planned contract:
  - process multiple process auto-build requests from one batch manifest
  - preserve isolated run directories and state locks per request

Status:
  Planned command. Execution is not implemented yet.
`.trim(),
} as const;

type LifecyclemodelPlannedSubcommand = keyof typeof lifecyclemodelPlannedHelp;
type ProcessPlannedSubcommand = keyof typeof processPlannedHelp;

function isLifecyclemodelPlannedSubcommand(
  value: string | null,
): value is LifecyclemodelPlannedSubcommand {
  return Boolean(value && value in lifecyclemodelPlannedHelp);
}

function isProcessPlannedSubcommand(value: string | null): value is ProcessPlannedSubcommand {
  return Boolean(value && value in processPlannedHelp);
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
    const processAutoBuildImpl = deps.runProcessAutoBuildImpl ?? runProcessAutoBuild;
    const processResumeBuildImpl = deps.runProcessResumeBuildImpl ?? runProcessResumeBuild;

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

    if (command === 'process' && isProcessPlannedSubcommand(subcommand)) {
      if (commandArgs.includes('--help') || commandArgs.includes('-h')) {
        return {
          exitCode: 0,
          stdout: `${processPlannedHelp[subcommand]}\n`,
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
