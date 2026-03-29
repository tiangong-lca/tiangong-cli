import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeCli } from '../src/cli.js';
import type { DotEnvLoadResult } from '../src/lib/dotenv.js';
import type { FetchLike } from '../src/lib/http.js';
import type { RunFlowRemediateOptions } from '../src/lib/flow-remediate.js';
import type { RunFlowReviewOptions } from '../src/lib/review-flow.js';

const dotEnvStatus: DotEnvLoadResult = {
  loaded: false,
  path: '/tmp/.env',
  count: 0,
};

const makeDeps = (overrides?: Partial<NodeJS.ProcessEnv>) => ({
  env: {
    TIANGONG_LCA_API_BASE_URL: 'https://example.com/functions/v1',
    TIANGONG_LCA_API_KEY: 'secret-token',
    TIANGONG_LCA_REGION: 'us-east-1',
    ...overrides,
  } as NodeJS.ProcessEnv,
  dotEnvStatus,
  fetchImpl: (async () => ({
    ok: true,
    status: 200,
    headers: {
      get: () => 'application/json',
    },
    text: async () => JSON.stringify({ ok: true }),
  })) as FetchLike,
});

test('executeCli prints main help when no command is given', async () => {
  const result = await executeCli([], makeDeps());
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Unified TianGong command entrypoint/u);
  assert.match(result.stdout, /Implemented Commands:/u);
  assert.match(result.stdout, /Planned Surface \(not implemented yet\):/u);
  assert.match(result.stdout, /process\s+get \| auto-build/u);
  assert.match(result.stdout, /process\s+auto-build/u);
  assert.match(result.stdout, /lifecyclemodel build-resulting-process/u);
  assert.match(result.stdout, /publish-resulting-process/u);
  assert.match(result.stdout, /review\s+process/u);
  assert.match(result.stdout, /exit with code 2/u);
  assert.equal(result.stderr, '');
});

test('executeCli main help reports loaded dotenv metadata when available', async () => {
  const result = await executeCli([], {
    ...makeDeps(),
    dotEnvStatus: {
      loaded: true,
      path: '/tmp/.env',
      count: 2,
    },
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /\.env loaded: yes \(/u);
});

test('executeCli prints version', async () => {
  const result = await executeCli(['--version'], makeDeps());
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, '0.0.1\n');
});

test('executeCli returns doctor text and success status', async () => {
  const result = await executeCli(['doctor'], makeDeps());
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /TianGong CLI doctor/u);
  assert.match(result.stdout, /\[OK /u);
});

test('executeCli doctor text reports loaded dotenv metadata and missing keys', async () => {
  const result = await executeCli(['doctor'], {
    env: {
      TIANGONG_LCA_REGION: 'cn-east-1',
    } as NodeJS.ProcessEnv,
    dotEnvStatus: {
      loaded: true,
      path: '/tmp/.env',
      count: 1,
    },
    fetchImpl: makeDeps().fetchImpl,
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.stdout, /\.env loaded: yes \(1 keys\)/u);
  assert.match(result.stdout, /Missing required environment keys:/u);
});

test('executeCli returns doctor help without falling back to main help', async () => {
  const result = await executeCli(['doctor', '--help'], makeDeps());
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /tiangong doctor \[--json\]/u);
  assert.doesNotMatch(result.stdout, /Unified TianGong command entrypoint/u);
});

test('executeCli returns doctor json and failure status when required env is missing', async () => {
  const result = await executeCli(
    ['doctor', '--json'],
    makeDeps({
      TIANGONG_LCA_API_BASE_URL: '',
      TIANGONG_LCA_API_KEY: '',
    }),
  );
  assert.equal(result.exitCode, 1);
  const payload = JSON.parse(result.stdout) as { ok: boolean };
  assert.equal(payload.ok, false);
});

test('executeCli returns remote help for search flow', async () => {
  const result = await executeCli(['search', 'flow', '--help'], makeDeps());
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /tiangong search flow/u);
});

test('executeCli returns remote help for admin embedding-run', async () => {
  const result = await executeCli(['admin', 'embedding-run', '--help'], makeDeps());
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /tiangong admin embedding-run/u);
});

test('executeCli returns help for publish and validation namespaces', async () => {
  const publishHelp = await executeCli(['publish', '--help'], makeDeps());
  assert.equal(publishHelp.exitCode, 0);
  assert.match(publishHelp.stdout, /tiangong publish run/u);

  const validationHelp = await executeCli(['validation', '--help'], makeDeps());
  assert.equal(validationHelp.exitCode, 0);
  assert.match(validationHelp.stdout, /tiangong validation run/u);

  const reviewHelp = await executeCli(['review', '--help'], makeDeps());
  assert.equal(reviewHelp.exitCode, 0);
  assert.match(reviewHelp.stdout, /tiangong review <subcommand>/u);

  const flowHelp = await executeCli(['flow', '--help'], makeDeps());
  assert.equal(flowHelp.exitCode, 0);
  assert.match(flowHelp.stdout, /tiangong flow <subcommand>/u);
  assert.match(flowHelp.stdout, /remediate/u);
});

test('executeCli returns help for publish and validation subcommands', async () => {
  const publishHelp = await executeCli(['publish', 'run', '--help'], makeDeps());
  assert.equal(publishHelp.exitCode, 0);
  assert.match(publishHelp.stdout, /--out-dir/u);

  const validationHelp = await executeCli(['validation', 'run', '--help'], makeDeps());
  assert.equal(validationHelp.exitCode, 0);
  assert.match(validationHelp.stdout, /--report-file/u);

  const reviewHelp = await executeCli(['review', 'process', '--help'], makeDeps());
  assert.equal(reviewHelp.exitCode, 0);
  assert.match(
    reviewHelp.stdout,
    /tiangong review process --run-root <dir> --run-id <id> --out-dir <dir>/u,
  );
  assert.match(reviewHelp.stdout, /--enable-llm/u);

  const reviewFlowHelp = await executeCli(['review', 'flow', '--help'], makeDeps());
  assert.equal(reviewFlowHelp.exitCode, 0);
  assert.ok(
    reviewFlowHelp.stdout.includes(
      'tiangong review flow (--rows-file <file> | --flows-dir <dir> | --run-root <dir>) --out-dir <dir>',
    ),
  );
  assert.match(reviewFlowHelp.stdout, /--similarity-threshold/u);

  const flowRemediateHelp = await executeCli(['flow', 'remediate', '--help'], makeDeps());
  assert.equal(flowRemediateHelp.exitCode, 0);
  assert.match(
    flowRemediateHelp.stdout,
    /tiangong flow remediate --input-file <file> --out-dir <dir>/u,
  );
  assert.match(flowRemediateHelp.stdout, /ready_for_mcp/u);
});

test('executeCli returns group help for search and admin namespaces', async () => {
  const searchHelp = await executeCli(['search', '--help'], makeDeps());
  assert.equal(searchHelp.exitCode, 0);
  assert.match(searchHelp.stdout, /tiangong search <flow\|process\|lifecyclemodel>/u);

  const adminHelp = await executeCli(['admin', '--help'], makeDeps());
  assert.equal(adminHelp.exitCode, 0);
  assert.match(adminHelp.stdout, /tiangong admin embedding-run/u);
});

test('executeCli returns help for the lifecyclemodel namespace and implemented subcommands', async () => {
  const lifecyclemodelHelp = await executeCli(['lifecyclemodel'], makeDeps());
  assert.equal(lifecyclemodelHelp.exitCode, 0);
  assert.match(lifecyclemodelHelp.stdout, /tiangong lifecyclemodel <subcommand>/u);
  assert.match(lifecyclemodelHelp.stdout, /build-resulting-process/u);
  assert.match(lifecyclemodelHelp.stdout, /publish-resulting-process/u);

  const buildHelp = await executeCli(
    ['lifecyclemodel', 'build-resulting-process', '--help'],
    makeDeps(),
  );
  assert.equal(buildHelp.exitCode, 0);
  assert.match(buildHelp.stdout, /tiangong lifecyclemodel build-resulting-process --input <file>/u);
  assert.match(buildHelp.stdout, /TIANGONG_LCA_API_BASE_URL/u);
  assert.match(buildHelp.stdout, /TIANGONG_LCA_API_KEY/u);
  assert.doesNotMatch(buildHelp.stdout, /Planned command/u);

  const publishHelp = await executeCli(
    ['lifecyclemodel', 'publish-resulting-process', '--help'],
    makeDeps(),
  );
  assert.equal(publishHelp.exitCode, 0);
  assert.match(
    publishHelp.stdout,
    /tiangong lifecyclemodel publish-resulting-process --run-dir <dir>/u,
  );
  assert.match(publishHelp.stdout, /--publish-processes/u);
  assert.doesNotMatch(publishHelp.stdout, /Planned command/u);
});

test('executeCli returns help for the process namespace and implemented subcommands', async () => {
  const processHelp = await executeCli(['process'], makeDeps());
  assert.equal(processHelp.exitCode, 0);
  assert.match(processHelp.stdout, /tiangong process <subcommand>/u);
  assert.match(processHelp.stdout, /get/u);
  assert.match(processHelp.stdout, /auto-build/u);
  assert.match(processHelp.stdout, /resume-build/u);
  assert.match(processHelp.stdout, /publish-build/u);
  assert.match(processHelp.stdout, /batch-build/u);

  const getHelp = await executeCli(['process', 'get', '--help'], makeDeps());
  assert.equal(getHelp.exitCode, 0);
  assert.match(getHelp.stdout, /tiangong process get --id <process-id>/u);
  assert.match(getHelp.stdout, /TIANGONG_LCA_API_BASE_URL/u);
  assert.match(getHelp.stdout, /TIANGONG_LCA_API_KEY/u);
  assert.doesNotMatch(getHelp.stdout, /Planned command/u);

  const autoBuildHelp = await executeCli(['process', 'auto-build', '--help'], makeDeps());
  assert.equal(autoBuildHelp.exitCode, 0);
  assert.match(autoBuildHelp.stdout, /tiangong process auto-build --input <file>/u);
  assert.match(autoBuildHelp.stdout, /--out-dir/u);
  assert.doesNotMatch(autoBuildHelp.stdout, /Planned command/u);

  const resumeBuildHelp = await executeCli(['process', 'resume-build', '--help'], makeDeps());
  assert.equal(resumeBuildHelp.exitCode, 0);
  assert.match(
    resumeBuildHelp.stdout,
    /tiangong process resume-build \[--run-id <id>\] \[--run-dir <dir>\]/u,
  );
  assert.match(resumeBuildHelp.stdout, /--run-dir/u);
  assert.doesNotMatch(resumeBuildHelp.stdout, /Planned command/u);

  const publishBuildHelp = await executeCli(['process', 'publish-build', '--help'], makeDeps());
  assert.equal(publishBuildHelp.exitCode, 0);
  assert.match(
    publishBuildHelp.stdout,
    /tiangong process publish-build \[--run-id <id>\] \[--run-dir <dir>\]/u,
  );
  assert.match(publishBuildHelp.stdout, /--run-dir/u);
  assert.doesNotMatch(publishBuildHelp.stdout, /Planned command/u);

  const batchBuildHelp = await executeCli(['process', 'batch-build', '--help'], makeDeps());
  assert.equal(batchBuildHelp.exitCode, 0);
  assert.match(batchBuildHelp.stdout, /tiangong process batch-build --input <file>/u);
  assert.match(batchBuildHelp.stdout, /--out-dir/u);
  assert.doesNotMatch(batchBuildHelp.stdout, /Planned command/u);
});

test('executeCli executes lifecyclemodel build-resulting-process with injected implementation', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-lifecyclemodel-cli-'));
  const inputPath = path.join(dir, 'request.json');
  writeFileSync(inputPath, '{"source_model":{"json_ordered_path":"./model.json"}}', 'utf8');
  const deps = makeDeps({
    TIANGONG_LCA_API_BASE_URL: 'https://supabase.example/functions/v1',
    TIANGONG_LCA_API_KEY: 'supabase-api-key',
  });

  try {
    const result = await executeCli(
      [
        'lifecyclemodel',
        'build-resulting-process',
        '--json',
        '--input',
        inputPath,
        '--out-dir',
        './out',
      ],
      {
        ...deps,
        runLifecyclemodelBuildResultingProcessImpl: async (options) => {
          assert.equal(options.inputPath, inputPath);
          assert.equal(options.outDir, './out');
          assert.equal(options.env, deps.env);
          assert.equal(options.fetchImpl, deps.fetchImpl);
          return {
            generated_at_utc: '2026-03-29T00:00:00.000Z',
            request_path: inputPath,
            out_dir: path.join(dir, 'out'),
            status: 'prepared_local_bundle',
            projected_process_count: 1,
            relation_count: 1,
            source_model: {
              id: 'lm-demo',
              version: '00.00.001',
              name: 'Demo model',
              json_ordered_path: path.join(dir, 'model.json'),
              reference_to_resulting_process_id: 'proc-demo',
              reference_to_resulting_process_version: '00.00.001',
              reference_process_instance_id: '1',
            },
            files: {
              normalized_request: path.join(dir, 'out', 'request.normalized.json'),
              source_model_normalized: path.join(dir, 'out', 'source-model.normalized.json'),
              source_model_summary: path.join(dir, 'out', 'source-model.summary.json'),
              projection_report: path.join(dir, 'out', 'projection-report.json'),
              process_projection_bundle: path.join(dir, 'out', 'process-projection-bundle.json'),
            },
          };
        },
      },
    );

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /"status":"prepared_local_bundle"/u);
    assert.match(result.stdout, /"process_projection_bundle"/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli executes process get with injected implementation', async () => {
  const deps = makeDeps({
    TIANGONG_LCA_API_BASE_URL: 'https://supabase.example/functions/v1',
    TIANGONG_LCA_API_KEY: 'supabase-api-key',
  });

  const result = await executeCli(['process', 'get', '--id', 'proc-1', '--version', '00.00.001'], {
    ...deps,
    runProcessGetImpl: async (options) => {
      assert.equal(options.processId, 'proc-1');
      assert.equal(options.version, '00.00.001');
      assert.equal(options.env, deps.env);
      assert.equal(options.fetchImpl, deps.fetchImpl);
      return {
        schema_version: 1,
        generated_at_utc: '2026-03-30T00:00:00.000Z',
        status: 'resolved_remote_process',
        process_id: 'proc-1',
        requested_version: '00.00.001',
        resolved_version: '00.00.001',
        resolution: 'remote_supabase_exact',
        source_url: 'https://supabase.example/rest/v1/processes?id=eq.proc-1',
        modified_at: null,
        state_code: 100,
        process: { processDataSet: { id: 'proc-1' } },
      };
    },
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /"status": "resolved_remote_process"/u);
  assert.equal(result.stderr, '');
});

test('executeCli executes lifecyclemodel publish-resulting-process with injected implementation', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-lifecyclemodel-publish-cli-'));

  try {
    const result = await executeCli(
      [
        'lifecyclemodel',
        'publish-resulting-process',
        '--json',
        '--run-dir',
        dir,
        '--publish-processes',
      ],
      {
        ...makeDeps(),
        runLifecyclemodelPublishResultingProcessImpl: async (options) => {
          assert.equal(options.runDir, dir);
          assert.equal(options.publishProcesses, true);
          assert.equal(options.publishRelations, false);
          return {
            generated_at_utc: '2026-03-29T00:00:00.000Z',
            run_dir: dir,
            status: 'prepared_local_publish_bundle',
            publish_processes: true,
            publish_relations: false,
            counts: {
              projected_processes: 1,
              relations: 0,
            },
            source_model: {
              id: 'lm-demo',
            },
            files: {
              projection_bundle: path.join(dir, 'process-projection-bundle.json'),
              projection_report: path.join(dir, 'projection-report.json'),
              publish_bundle: path.join(dir, 'publish-bundle.json'),
              publish_intent: path.join(dir, 'publish-intent.json'),
            },
          };
        },
      },
    );

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /"status":"prepared_local_publish_bundle"/u);
    assert.match(result.stdout, /"publish_bundle"/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli executes process auto-build with injected implementation', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-auto-build-cli-'));
  const inputPath = path.join(dir, 'request.json');
  writeFileSync(inputPath, '{"flow_file":"./flow.json"}', 'utf8');

  try {
    const result = await executeCli(
      ['process', 'auto-build', '--json', '--input', inputPath, '--out-dir', './run-root'],
      {
        ...makeDeps(),
        runProcessAutoBuildImpl: async (options) => {
          assert.equal(options.inputPath, inputPath);
          assert.equal(options.outDir, './run-root');
          return {
            schema_version: 1,
            generated_at_utc: '2026-03-29T00:00:00.000Z',
            status: 'prepared_local_process_auto_build_run',
            request_path: inputPath,
            request_id: 'pff-demo',
            run_id: 'pfw_demo_unknown_produce_20260329T000000Z',
            run_root: path.join(dir, 'run-root'),
            operation: 'produce',
            flow: {
              source_path: path.join(dir, 'flow.json'),
              artifact_path: path.join(dir, 'run-root', 'input', 'flow.json'),
              wrapper: 'flowDataSet',
              uuid: 'flow-uuid',
              version: '00.00.001',
              base_name: 'Demo flow',
            },
            source_input_count: 0,
            stage_count: 10,
            files: {
              request_snapshot: path.join(dir, 'run-root', 'request', 'pff-request.json'),
              normalized_request: path.join(dir, 'run-root', 'request', 'request.normalized.json'),
              source_policy: path.join(dir, 'run-root', 'request', 'source-policy.json'),
              flow_summary: path.join(dir, 'run-root', 'manifests', 'flow-summary.json'),
              input_manifest: path.join(dir, 'run-root', 'input', 'input_manifest.json'),
              assembly_plan: path.join(dir, 'run-root', 'manifests', 'assembly-plan.json'),
              lineage_manifest: path.join(dir, 'run-root', 'manifests', 'lineage-manifest.json'),
              invocation_index: path.join(dir, 'run-root', 'manifests', 'invocation-index.json'),
              run_manifest: path.join(dir, 'run-root', 'manifests', 'run-manifest.json'),
              state: path.join(dir, 'run-root', 'cache', 'process_from_flow_state.json'),
              handoff_summary: path.join(dir, 'run-root', 'cache', 'agent_handoff_summary.json'),
              report: path.join(dir, 'run-root', 'reports', 'process-auto-build-report.json'),
            },
            next_actions: ['inspect: state'],
          };
        },
      },
    );

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /"status":"prepared_local_process_auto_build_run"/u);
    assert.match(result.stdout, /"request_snapshot"/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli executes process resume-build with injected implementation', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-resume-build-cli-'));
  const runDir = path.join(dir, 'artifacts', 'process_from_flow', 'run-1');

  try {
    const result = await executeCli(
      ['process', 'resume-build', '--json', '--run-id', 'run-1', '--run-dir', runDir],
      {
        ...makeDeps(),
        runProcessResumeBuildImpl: async (options) => {
          assert.equal(options.runId, 'run-1');
          assert.equal(options.runDir, runDir);
          return {
            schema_version: 1,
            generated_at_utc: '2026-03-29T00:00:00.000Z',
            status: 'prepared_local_process_resume_run',
            run_id: 'run-1',
            run_root: runDir,
            request_id: 'req-1',
            resumed_from: '04_exchange_values',
            checkpoint: 'matches',
            attempt: 2,
            state_summary: {
              build_status: 'resume_prepared',
              next_stage: '04_exchange_values',
              stop_after: null,
              process_count: 1,
              matched_exchange_count: 1,
              process_dataset_count: 1,
              source_dataset_count: 1,
            },
            files: {
              state: path.join(runDir, 'cache', 'process_from_flow_state.json'),
              handoff_summary: path.join(runDir, 'cache', 'agent_handoff_summary.json'),
              run_manifest: path.join(runDir, 'manifests', 'run-manifest.json'),
              invocation_index: path.join(runDir, 'manifests', 'invocation-index.json'),
              resume_metadata: path.join(runDir, 'manifests', 'resume-metadata.json'),
              resume_history: path.join(runDir, 'manifests', 'resume-history.jsonl'),
              report: path.join(runDir, 'reports', 'process-resume-build-report.json'),
            },
            next_actions: ['inspect: state'],
          };
        },
      },
    );

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /"status":"prepared_local_process_resume_run"/u);
    assert.match(result.stdout, /"resume_metadata"/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli executes process resume-build with run-dir only', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-resume-build-cli-rundir-'));
  const runDir = path.join(dir, 'artifacts', 'process_from_flow', 'run-2');

  try {
    const result = await executeCli(['process', 'resume-build', '--run-dir', runDir], {
      ...makeDeps(),
      runProcessResumeBuildImpl: async (options) => {
        assert.equal(options.runId, undefined);
        assert.equal(options.runDir, runDir);
        return {
          schema_version: 1,
          generated_at_utc: '2026-03-29T00:10:00.000Z',
          status: 'prepared_local_process_resume_run',
          run_id: 'run-2',
          run_root: runDir,
          request_id: null,
          resumed_from: 'resume_prepared',
          checkpoint: null,
          attempt: 1,
          state_summary: {
            build_status: 'resume_prepared',
            next_stage: null,
            stop_after: null,
            process_count: 0,
            matched_exchange_count: 0,
            process_dataset_count: 0,
            source_dataset_count: 0,
          },
          files: {
            state: path.join(runDir, 'cache', 'process_from_flow_state.json'),
            handoff_summary: path.join(runDir, 'cache', 'agent_handoff_summary.json'),
            run_manifest: path.join(runDir, 'manifests', 'run-manifest.json'),
            invocation_index: path.join(runDir, 'manifests', 'invocation-index.json'),
            resume_metadata: path.join(runDir, 'manifests', 'resume-metadata.json'),
            resume_history: path.join(runDir, 'manifests', 'resume-history.jsonl'),
            report: path.join(runDir, 'reports', 'process-resume-build-report.json'),
          },
          next_actions: ['inspect: state'],
        };
      },
    });

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /prepared_local_process_resume_run/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli executes process publish-build with injected implementation', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-publish-build-cli-'));
  const runDir = path.join(dir, 'artifacts', 'process_from_flow', 'run-3');

  try {
    const result = await executeCli(
      ['process', 'publish-build', '--json', '--run-id', 'run-3', '--run-dir', runDir],
      {
        ...makeDeps(),
        runProcessPublishBuildImpl: async (options) => {
          assert.equal(options.runId, 'run-3');
          assert.equal(options.runDir, runDir);
          return {
            schema_version: 1,
            generated_at_utc: '2026-03-29T00:20:00.000Z',
            status: 'prepared_local_process_publish_bundle',
            run_id: 'run-3',
            run_root: runDir,
            request_id: 'req-3',
            state_summary: {
              build_status: 'resume_prepared',
              next_stage: '10_publish',
              stop_after: null,
            },
            dataset_origins: {
              processes: 'exports',
              sources: 'state',
            },
            counts: {
              processes: 2,
              sources: 1,
              relations: 0,
            },
            publish_defaults: {
              commit: false,
              publish_lifecyclemodels: false,
              publish_processes: true,
              publish_sources: true,
              publish_relations: true,
              publish_process_build_runs: false,
              relation_mode: 'local_manifest_only',
            },
            files: {
              state: path.join(runDir, 'cache', 'process_from_flow_state.json'),
              handoff_summary: path.join(runDir, 'cache', 'agent_handoff_summary.json'),
              run_manifest: path.join(runDir, 'manifests', 'run-manifest.json'),
              invocation_index: path.join(runDir, 'manifests', 'invocation-index.json'),
              publish_bundle: path.join(
                runDir,
                'stage_outputs',
                '10_publish',
                'publish-bundle.json',
              ),
              publish_request: path.join(
                runDir,
                'stage_outputs',
                '10_publish',
                'publish-request.json',
              ),
              publish_intent: path.join(
                runDir,
                'stage_outputs',
                '10_publish',
                'publish-intent.json',
              ),
              report: path.join(runDir, 'reports', 'process-publish-build-report.json'),
            },
            next_actions: ['inspect: publish request'],
          };
        },
      },
    );

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /"status":"prepared_local_process_publish_bundle"/u);
    assert.match(result.stdout, /"publish_request"/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli executes process publish-build with run-dir only', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-publish-build-cli-rundir-'));
  const runDir = path.join(dir, 'artifacts', 'process_from_flow', 'run-4');

  try {
    const result = await executeCli(['process', 'publish-build', '--run-dir', runDir], {
      ...makeDeps(),
      runProcessPublishBuildImpl: async (options) => {
        assert.equal(options.runId, undefined);
        assert.equal(options.runDir, runDir);
        return {
          schema_version: 1,
          generated_at_utc: '2026-03-29T00:21:00.000Z',
          status: 'prepared_local_process_publish_bundle',
          run_id: 'run-4',
          run_root: runDir,
          request_id: null,
          state_summary: {
            build_status: 'resume_prepared',
            next_stage: null,
            stop_after: null,
          },
          dataset_origins: {
            processes: 'state',
            sources: 'state',
          },
          counts: {
            processes: 1,
            sources: 0,
            relations: 0,
          },
          publish_defaults: {
            commit: false,
            publish_lifecyclemodels: false,
            publish_processes: true,
            publish_sources: true,
            publish_relations: true,
            publish_process_build_runs: false,
            relation_mode: 'local_manifest_only',
          },
          files: {
            state: path.join(runDir, 'cache', 'process_from_flow_state.json'),
            handoff_summary: path.join(runDir, 'cache', 'agent_handoff_summary.json'),
            run_manifest: path.join(runDir, 'manifests', 'run-manifest.json'),
            invocation_index: path.join(runDir, 'manifests', 'invocation-index.json'),
            publish_bundle: path.join(runDir, 'stage_outputs', '10_publish', 'publish-bundle.json'),
            publish_request: path.join(
              runDir,
              'stage_outputs',
              '10_publish',
              'publish-request.json',
            ),
            publish_intent: path.join(runDir, 'stage_outputs', '10_publish', 'publish-intent.json'),
            report: path.join(runDir, 'reports', 'process-publish-build-report.json'),
          },
          next_actions: ['inspect: publish request'],
        };
      },
    });

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /prepared_local_process_publish_bundle/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli executes process batch-build with injected implementation', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-batch-build-cli-'));
  const inputPath = path.join(dir, 'batch-request.json');
  writeFileSync(inputPath, '{"items":["./request-a.json"]}', 'utf8');

  try {
    const result = await executeCli(
      ['process', 'batch-build', '--json', '--input', inputPath, '--out-dir', './batch-root'],
      {
        ...makeDeps(),
        runProcessBatchBuildImpl: async (options) => {
          assert.equal(options.inputPath, inputPath);
          assert.equal(options.outDir, './batch-root');
          return {
            schema_version: 1,
            generated_at_utc: '2026-03-29T00:22:00.000Z',
            status: 'completed',
            manifest_path: inputPath,
            batch_id: 'batch-1',
            batch_root: path.join(dir, 'batch-root'),
            continue_on_error: true,
            counts: {
              total: 1,
              prepared: 1,
              failed: 0,
              skipped: 0,
            },
            files: {
              request_snapshot: path.join(dir, 'batch-root', 'request', 'batch-request.json'),
              normalized_request: path.join(
                dir,
                'batch-root',
                'request',
                'request.normalized.json',
              ),
              invocation_index: path.join(dir, 'batch-root', 'manifests', 'invocation-index.json'),
              run_manifest: path.join(dir, 'batch-root', 'manifests', 'run-manifest.json'),
              report: path.join(dir, 'batch-root', 'reports', 'process-batch-build-report.json'),
            },
            items: [
              {
                item_id: 'request_a',
                index: 0,
                input_path: path.join(dir, 'request-a.json'),
                out_dir: path.join(dir, 'batch-root', 'runs', '001_request_a'),
                status: 'prepared',
                run_id: 'run-1',
                run_root: path.join(dir, 'batch-root', 'runs', '001_request_a'),
                request_id: 'req-1',
                files: {
                  request_snapshot: path.join(dir, 'item', 'request.json'),
                  report: path.join(dir, 'item', 'report.json'),
                  state: path.join(dir, 'item', 'state.json'),
                  handoff_summary: path.join(dir, 'item', 'handoff.json'),
                  run_manifest: path.join(dir, 'item', 'run-manifest.json'),
                },
                error: null,
              },
            ],
            next_actions: ['inspect: report'],
          };
        },
      },
    );

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /"status":"completed"/u);
    assert.match(result.stdout, /"batch_id":"batch-1"/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli maps process batch-build failures to exit code 1', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-process-batch-build-cli-failure-'));
  const inputPath = path.join(dir, 'batch-request.json');
  writeFileSync(inputPath, '{"items":["./request-a.json"]}', 'utf8');

  try {
    const result = await executeCli(['process', 'batch-build', '--input', inputPath], {
      ...makeDeps(),
      runProcessBatchBuildImpl: async () => ({
        schema_version: 1,
        generated_at_utc: '2026-03-29T00:23:00.000Z',
        status: 'completed_with_failures',
        manifest_path: inputPath,
        batch_id: 'batch-2',
        batch_root: path.join(dir, 'batch-root'),
        continue_on_error: true,
        counts: {
          total: 1,
          prepared: 0,
          failed: 1,
          skipped: 0,
        },
        files: {
          request_snapshot: path.join(dir, 'batch-root', 'request', 'batch-request.json'),
          normalized_request: path.join(dir, 'batch-root', 'request', 'request.normalized.json'),
          invocation_index: path.join(dir, 'batch-root', 'manifests', 'invocation-index.json'),
          run_manifest: path.join(dir, 'batch-root', 'manifests', 'run-manifest.json'),
          report: path.join(dir, 'batch-root', 'reports', 'process-batch-build-report.json'),
        },
        items: [],
        next_actions: ['inspect: report'],
      }),
    });

    assert.equal(result.exitCode, 1);
    assert.match(result.stdout, /completed_with_failures/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli keeps subcommand --json inside remote command parsing', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-search-json-'));
  const inputPath = path.join(dir, 'request.json');
  writeFileSync(inputPath, '{"query":"steel"}', 'utf8');

  try {
    const result = await executeCli(['search', 'flow', '--json', '--input', inputPath], makeDeps());
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '{"ok":true}\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli respects explicit remote override flags', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-search-overrides-'));
  const inputPath = path.join(dir, 'request.json');
  writeFileSync(inputPath, '{"query":"steel"}', 'utf8');

  try {
    const result = await executeCli(
      [
        'search',
        'flow',
        '--dry-run',
        '--input',
        inputPath,
        '--api-key',
        'override-token',
        '--base-url',
        'https://override.example/functions/v1',
        '--region',
        'eu-west-1',
      ],
      makeDeps(),
    );

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /override\.example\/functions\/v1\/flow_hybrid_search/u);
    assert.match(result.stdout, /eu-west-1/u);
    assert.match(result.stdout, /Bearer \*\*\*\*/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli resolves remote config from canonical TIANGONG_LCA_* env keys', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-search-env-'));
  const inputPath = path.join(dir, 'request.json');
  writeFileSync(inputPath, '{"query":"steel"}', 'utf8');

  try {
    const result = await executeCli(
      ['search', 'process', '--dry-run', '--input', inputPath],
      makeDeps({
        TIANGONG_LCA_API_BASE_URL: 'https://env.example/functions/v1',
        TIANGONG_LCA_API_KEY: 'env-token',
        TIANGONG_LCA_REGION: 'cn-east-1',
      }),
    );

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /env\.example\/functions\/v1\/process_hybrid_search/u);
    assert.match(result.stdout, /cn-east-1/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli executes admin embedding-run dry-run with default region fallback', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-admin-dry-run-'));
  const inputPath = path.join(dir, 'jobs.json');
  writeFileSync(inputPath, '[{"jobId":1}]', 'utf8');

  try {
    const result = await executeCli(
      ['admin', 'embedding-run', '--dry-run', '--input', inputPath],
      makeDeps({
        TIANGONG_LCA_REGION: undefined,
      }),
    );

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /embedding_ft/u);
    assert.doesNotMatch(result.stdout, /x-region/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli surfaces missing search API configuration after exhausting all fallbacks', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-search-missing-config-'));
  const inputPath = path.join(dir, 'request.json');
  writeFileSync(inputPath, '{"query":"steel"}', 'utf8');

  try {
    const result = await executeCli(
      ['search', 'flow', '--input', inputPath],
      makeDeps({
        TIANGONG_LCA_API_BASE_URL: undefined,
        TIANGONG_LCA_API_KEY: undefined,
        TIANGONG_LCA_REGION: undefined,
      }),
    );

    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /API_BASE_URL_REQUIRED/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli surfaces missing admin API configuration after exhausting all fallbacks', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-admin-missing-config-'));
  const inputPath = path.join(dir, 'jobs.json');
  writeFileSync(inputPath, '[{"jobId":1}]', 'utf8');

  try {
    const result = await executeCli(
      ['admin', 'embedding-run', '--input', inputPath],
      makeDeps({
        TIANGONG_LCA_API_BASE_URL: undefined,
        TIANGONG_LCA_API_KEY: undefined,
        TIANGONG_LCA_REGION: undefined,
      }),
    );

    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /API_BASE_URL_REQUIRED/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli returns remote error payloads for invalid remote flags', async () => {
  const result = await executeCli(['search', 'flow', '--timeout-ms', '0'], makeDeps());
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /INVALID_TIMEOUT/u);
});

test('executeCli returns parsing errors for invalid remote flags', async () => {
  const result = await executeCli(['search', 'flow', '--bad-flag'], makeDeps());
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /INVALID_ARGS/u);
  assert.match(result.stderr, /Unknown option '--bad-flag'/u);
});

test('executeCli returns parsing errors for invalid doctor flags', async () => {
  const result = await executeCli(['doctor', '--bad-flag'], makeDeps());
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /INVALID_ARGS/u);
  assert.match(result.stderr, /Unknown option '--bad-flag'/u);
});

test('executeCli returns unexpected error payloads from remote execution failures', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-search-error-'));
  const inputPath = path.join(dir, 'request.json');
  writeFileSync(inputPath, '{"query":"steel"}', 'utf8');

  try {
    const result = await executeCli(['search', 'flow', '--input', inputPath], {
      ...makeDeps(),
      fetchImpl: (async () => {
        throw new Error('network down');
      }) as FetchLike,
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /UNEXPECTED_ERROR/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli executes publish run with mode overrides and compact JSON output', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-publish-cli-'));
  const inputPath = path.join(dir, 'request.json');
  writeFileSync(inputPath, '{"publish":{"commit":false}}', 'utf8');

  try {
    const result = await executeCli(
      ['publish', 'run', '--json', '--commit', '--input', inputPath, '--out-dir', './out'],
      {
        ...makeDeps(),
        runPublishImpl: async (options) => {
          assert.equal(options.inputPath, inputPath);
          assert.equal(options.outDir, './out');
          assert.equal(options.commit, true);
          return {
            generated_at_utc: '2026-03-28T00:00:00.000Z',
            request_path: inputPath,
            out_dir: path.join(dir, 'out'),
            commit: true,
            status: 'completed',
            counts: {
              bundle_paths: 0,
              lifecyclemodels: 0,
              processes: 0,
              sources: 0,
              relations: 0,
              process_build_runs: 0,
              executed: 0,
              deferred: 0,
              failed: 0,
            },
            files: {
              normalized_request: path.join(dir, 'out', 'normalized-request.json'),
              collected_inputs: path.join(dir, 'out', 'collected-inputs.json'),
              relation_manifest: path.join(dir, 'out', 'relation-manifest.json'),
              publish_report: path.join(dir, 'out', 'publish-report.json'),
            },
            lifecyclemodels: [],
            processes: [],
            sources: [],
            process_build_runs: [],
            relations: {
              generated_at_utc: '2026-03-28T00:00:00.000Z',
              relation_mode: 'local_manifest_only',
              status: 'prepared_local_relation_manifest',
              relations: [],
            },
          };
        },
      },
    );

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.includes('\n'), true);
    assert.match(result.stdout, /"commit":true/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli maps publish dry-run override and completed_with_failures exit code', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-publish-cli-failure-'));
  const inputPath = path.join(dir, 'request.json');
  writeFileSync(inputPath, '{"publish":{"commit":true}}', 'utf8');

  try {
    const result = await executeCli(['publish', 'run', '--dry-run', '--input', inputPath], {
      ...makeDeps(),
      runPublishImpl: async (options) => {
        assert.equal(options.commit, false);
        return {
          generated_at_utc: '2026-03-28T00:00:00.000Z',
          request_path: inputPath,
          out_dir: path.join(dir, 'out'),
          commit: false,
          status: 'completed_with_failures',
          counts: {
            bundle_paths: 0,
            lifecyclemodels: 0,
            processes: 0,
            sources: 0,
            relations: 0,
            process_build_runs: 0,
            executed: 0,
            deferred: 0,
            failed: 1,
          },
          files: {
            normalized_request: path.join(dir, 'out', 'normalized-request.json'),
            collected_inputs: path.join(dir, 'out', 'collected-inputs.json'),
            relation_manifest: path.join(dir, 'out', 'relation-manifest.json'),
            publish_report: path.join(dir, 'out', 'publish-report.json'),
          },
          lifecyclemodels: [],
          processes: [],
          sources: [],
          process_build_runs: [],
          relations: {
            generated_at_utc: '2026-03-28T00:00:00.000Z',
            relation_mode: 'local_manifest_only',
            status: 'prepared_local_relation_manifest',
            relations: [],
          },
        };
      },
    });

    assert.equal(result.exitCode, 1);
    assert.match(result.stdout, /completed_with_failures/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli rejects conflicting publish mode flags', async () => {
  const result = await executeCli(
    ['publish', 'run', '--input', './request.json', '--commit', '--dry-run'],
    makeDeps(),
  );
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /INVALID_PUBLISH_MODE/u);
});

test('executeCli returns parsing errors for invalid publish and validation flags', async () => {
  const publishResult = await executeCli(['publish', 'run', '--bad-flag'], makeDeps());
  assert.equal(publishResult.exitCode, 2);
  assert.match(publishResult.stderr, /INVALID_ARGS/u);

  const validationResult = await executeCli(['validation', 'run', '--bad-flag'], makeDeps());
  assert.equal(validationResult.exitCode, 2);
  assert.match(validationResult.stderr, /INVALID_ARGS/u);

  const reviewFlagResult = await executeCli(['review', 'process', '--bad-flag'], makeDeps());
  assert.equal(reviewFlagResult.exitCode, 2);
  assert.match(reviewFlagResult.stderr, /INVALID_ARGS/u);

  const reviewResult = await executeCli(
    [
      'review',
      'process',
      '--run-root',
      '/tmp/run',
      '--run-id',
      'run',
      '--out-dir',
      '/tmp/out',
      '--llm-max-processes',
      '0',
    ],
    makeDeps(),
  );
  assert.equal(reviewResult.exitCode, 2);
  assert.match(reviewResult.stderr, /INVALID_LLM_MAX_PROCESSES/u);
});

test('executeCli returns parsing errors for invalid lifecyclemodel build, process get/build, resume, publish-build, and batch-build flags', async () => {
  const result = await executeCli(
    ['lifecyclemodel', 'build-resulting-process', '--bad-flag'],
    makeDeps(),
  );
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /INVALID_ARGS/u);

  const publishResult = await executeCli(
    ['lifecyclemodel', 'publish-resulting-process', '--bad-flag'],
    makeDeps(),
  );
  assert.equal(publishResult.exitCode, 2);
  assert.equal(publishResult.stdout, '');
  assert.match(publishResult.stderr, /INVALID_ARGS/u);

  const processGetResult = await executeCli(['process', 'get', '--bad-flag'], makeDeps());
  assert.equal(processGetResult.exitCode, 2);
  assert.equal(processGetResult.stdout, '');
  assert.match(processGetResult.stderr, /INVALID_ARGS/u);

  const processResult = await executeCli(['process', 'auto-build', '--bad-flag'], makeDeps());
  assert.equal(processResult.exitCode, 2);
  assert.equal(processResult.stdout, '');
  assert.match(processResult.stderr, /INVALID_ARGS/u);

  const processResumeResult = await executeCli(
    ['process', 'resume-build', '--bad-flag'],
    makeDeps(),
  );
  assert.equal(processResumeResult.exitCode, 2);
  assert.equal(processResumeResult.stdout, '');
  assert.match(processResumeResult.stderr, /INVALID_ARGS/u);

  const processPublishResult = await executeCli(
    ['process', 'publish-build', '--bad-flag'],
    makeDeps(),
  );
  assert.equal(processPublishResult.exitCode, 2);
  assert.equal(processPublishResult.stdout, '');
  assert.match(processPublishResult.stderr, /INVALID_ARGS/u);

  const processBatchResult = await executeCli(['process', 'batch-build', '--bad-flag'], makeDeps());
  assert.equal(processBatchResult.exitCode, 2);
  assert.equal(processBatchResult.stdout, '');
  assert.match(processBatchResult.stderr, /INVALID_ARGS/u);
});

test('executeCli executes validation run with injected implementation and report file', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-validation-cli-'));

  try {
    const result = await executeCli(
      [
        'validation',
        'run',
        '--json',
        '--input-dir',
        dir,
        '--engine',
        'all',
        '--report-file',
        './validation-report.json',
      ],
      {
        ...makeDeps(),
        runValidationImpl: async (options) => {
          assert.equal(options.inputDir, dir);
          assert.equal(options.engine, 'all');
          assert.equal(options.reportFile, './validation-report.json');
          return {
            input_dir: dir,
            mode: 'all',
            ok: false,
            summary: {
              engine_count: 2,
              ok_count: 0,
              failed_count: 2,
            },
            files: {
              report: path.join(dir, 'validation-report.json'),
            },
            reports: [],
            comparison: {
              equivalent: false,
              differences: ['summary'],
            },
          };
        },
      },
    );

    assert.equal(result.exitCode, 1);
    assert.match(result.stdout, /"mode":"all"/u);
    assert.match(result.stdout, /"comparison"/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli executes review process with injected implementation', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-review-cli-'));

  try {
    const result = await executeCli(
      [
        'review',
        'process',
        '--run-root',
        path.join(dir, 'run-root'),
        '--run-id',
        'run-001',
        '--out-dir',
        path.join(dir, 'review'),
        '--start-ts',
        '2026-03-30T00:00:00.000Z',
        '--end-ts',
        '2026-03-30T00:05:00.000Z',
        '--logic-version',
        'v2.2',
        '--enable-llm',
        '--llm-model',
        'gpt-5.4',
        '--llm-max-processes',
        '4',
      ],
      {
        ...makeDeps(),
        runProcessReviewImpl: async (options) => {
          assert.equal(options.startTs, '2026-03-30T00:00:00.000Z');
          assert.equal(options.endTs, '2026-03-30T00:05:00.000Z');
          assert.equal(options.logicVersion, 'v2.2');
          assert.equal(options.llmModel, 'gpt-5.4');
          assert.equal(options.llmMaxProcesses, 4);
          return {
            schema_version: 1,
            generated_at_utc: '2026-03-30T00:00:00.000Z',
            status: 'completed_local_process_review',
            run_id: options.runId,
            run_root: options.runRoot,
            out_dir: options.outDir,
            logic_version: options.logicVersion ?? 'v2.1',
            process_count: 1,
            totals: {
              raw_input: 1,
              product_plus_byproduct_plus_waste: 1,
              delta: 0,
              relative_deviation: 0,
              energy_excluded: 0,
            },
            files: {
              review_zh: path.join(dir, 'review', 'zh.md'),
              review_en: path.join(dir, 'review', 'en.md'),
              timing: path.join(dir, 'review', 'timing.md'),
              unit_issue_log: path.join(dir, 'review', 'unit.md'),
              summary: path.join(dir, 'review', 'summary.json'),
              report: path.join(dir, 'review', 'report.json'),
            },
            llm: {
              enabled: true,
              ok: true,
              result: {
                findings: [],
              },
            },
          };
        },
      },
    );

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /"status": "completed_local_process_review"/u);
    assert.match(result.stdout, /"run_id": "run-001"/u);
    assert.match(result.stdout, /"logic_version": "v2\.2"/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli executes review process with only required flags', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-review-cli-required-'));

  try {
    const result = await executeCli(
      [
        'review',
        'process',
        '--run-root',
        path.join(dir, 'run-root'),
        '--run-id',
        'run-required',
        '--out-dir',
        path.join(dir, 'review'),
      ],
      {
        ...makeDeps(),
        runProcessReviewImpl: async (options) => {
          assert.equal(options.startTs, undefined);
          assert.equal(options.endTs, undefined);
          assert.equal(options.logicVersion, undefined);
          assert.equal(options.enableLlm, false);
          assert.equal(options.llmModel, undefined);
          assert.equal(options.llmMaxProcesses, undefined);
          return {
            schema_version: 1,
            generated_at_utc: '2026-03-30T00:00:00.000Z',
            status: 'completed_local_process_review',
            run_id: options.runId,
            run_root: options.runRoot,
            out_dir: options.outDir,
            logic_version: 'v2.1',
            process_count: 0,
            totals: {
              raw_input: 0,
              product_plus_byproduct_plus_waste: 0,
              delta: 0,
              relative_deviation: null,
              energy_excluded: 0,
            },
            files: {
              review_zh: path.join(dir, 'review', 'zh.md'),
              review_en: path.join(dir, 'review', 'en.md'),
              timing: path.join(dir, 'review', 'timing.md'),
              unit_issue_log: path.join(dir, 'review', 'unit.md'),
              summary: path.join(dir, 'review', 'summary.json'),
              report: path.join(dir, 'review', 'report.json'),
            },
            llm: {
              enabled: false,
              reason: 'disabled',
            },
          };
        },
      },
    );

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /"run_id": "run-required"/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli returns success for validation reports that are ok', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-validation-cli-ok-'));

  try {
    const result = await executeCli(['validation', 'run', '--input-dir', dir], {
      ...makeDeps(),
      runValidationImpl: async () => ({
        input_dir: dir,
        mode: 'auto',
        ok: true,
        summary: {
          engine_count: 1,
          ok_count: 1,
          failed_count: 0,
        },
        files: {
          report: null,
        },
        reports: [],
        comparison: null,
      }),
    });

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /"ok": true/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli rejects unknown root options', async () => {
  const result = await executeCli(['--json'], makeDeps());
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /UNKNOWN_ROOT_OPTION/u);
});

test('executeCli prints main help when root help appears before the command', async () => {
  const result = await executeCli(['--help', 'search', 'flow'], makeDeps());
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Unified TianGong command entrypoint/u);
});

test('executeCli supports root argument separator before the command', async () => {
  const result = await executeCli(['--', 'doctor', '--json'], makeDeps());
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /"ok":true/u);
});

test('executeCli prints main help for the explicit help command', async () => {
  const result = await executeCli(['help'], makeDeps());
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Unified TianGong command entrypoint/u);
});

test('executeCli returns planned command message for unimplemented command', async () => {
  const result = await executeCli(['flow', 'get'], makeDeps());
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /not implemented yet/u);
});

test('executeCli returns planned command message for lifecyclemodel subcommands after help is introduced', async () => {
  const result = await executeCli(['lifecyclemodel', 'auto-build'], makeDeps());
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Command 'lifecyclemodel auto-build'/u);
});

test('executeCli returns planned command message and dedicated help for review lifecyclemodel', async () => {
  const lifecyclemodelResult = await executeCli(['review', 'lifecyclemodel'], makeDeps());
  assert.equal(lifecyclemodelResult.exitCode, 2);
  assert.equal(lifecyclemodelResult.stdout, '');
  assert.match(lifecyclemodelResult.stderr, /Command 'review lifecyclemodel'/u);

  const lifecyclemodelHelpResult = await executeCli(
    ['review', 'lifecyclemodel', '--help'],
    makeDeps(),
  );
  assert.equal(lifecyclemodelHelpResult.exitCode, 0);
  assert.match(lifecyclemodelHelpResult.stdout, /Planned contract:/u);
  assert.match(lifecyclemodelHelpResult.stdout, /lifecycle model build run/u);
});

test('executeCli dispatches review flow to the implemented CLI module', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-review-flow-dispatch-'));
  const rowsFile = path.join(dir, 'flows.json');
  writeFileSync(rowsFile, '[]\n', 'utf8');

  try {
    let observedOptions: RunFlowReviewOptions | undefined;
    const result = await executeCli(
      [
        'review',
        'flow',
        '--rows-file',
        rowsFile,
        '--out-dir',
        path.join(dir, 'review'),
        '--run-id',
        'flow-run',
        '--enable-llm',
        '--llm-max-flows',
        '5',
        '--llm-batch-size',
        '2',
        '--similarity-threshold',
        '0.9',
        '--methodology-id',
        'custom-method',
        '--json',
      ],
      {
        ...makeDeps(),
        runFlowReviewImpl: async (options) => {
          observedOptions = options;
          return {
            schema_version: 1,
            generated_at_utc: '2026-03-30T00:00:00.000Z',
            status: 'completed_local_flow_review',
            run_id: 'flow-run',
            out_dir: path.join(dir, 'review'),
            input_mode: 'rows_file',
            effective_flows_dir: path.join(dir, 'review-input', 'flows'),
            logic_version: 'flow-v1.0-cli',
            flow_count: 1,
            similarity_threshold: 0.9,
            methodology_rule_source: 'custom-method',
            with_reference_context: false,
            reference_context_mode: 'disabled',
            rule_finding_count: 1,
            llm_finding_count: 0,
            finding_count: 1,
            severity_counts: { warning: 1 },
            rule_counts: { sample_rule: 1 },
            llm: {
              enabled: true,
              ok: true,
              batch_count: 1,
              reviewed_flow_count: 1,
              truncated: false,
              batch_results: [],
            },
            files: {
              review_input_summary: path.join(dir, 'review', 'review-input-summary.json'),
              materialization_summary: path.join(
                dir,
                'review',
                'review-input',
                'materialization-summary.json',
              ),
              rule_findings: path.join(dir, 'review', 'rule_findings.jsonl'),
              llm_findings: path.join(dir, 'review', 'llm_findings.jsonl'),
              findings: path.join(dir, 'review', 'findings.jsonl'),
              flow_summaries: path.join(dir, 'review', 'flow_summaries.jsonl'),
              similarity_pairs: path.join(dir, 'review', 'similarity_pairs.jsonl'),
              summary: path.join(dir, 'review', 'flow_review_summary.json'),
              review_zh: path.join(dir, 'review', 'flow_review_zh.md'),
              review_en: path.join(dir, 'review', 'flow_review_en.md'),
              timing: path.join(dir, 'review', 'flow_review_timing.md'),
              report: path.join(dir, 'review', 'flow_review_report.json'),
            },
          };
        },
      },
    );

    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '');
    assert.equal(JSON.parse(result.stdout).status, 'completed_local_flow_review');
    assert.equal(observedOptions?.rowsFile, rowsFile);
    assert.equal(observedOptions?.runId, 'flow-run');
    assert.equal(observedOptions?.enableLlm, true);
    assert.equal(observedOptions?.llmMaxFlows, 5);
    assert.equal(observedOptions?.llmBatchSize, 2);
    assert.equal(observedOptions?.similarityThreshold, 0.9);
    assert.equal(observedOptions?.methodologyId, 'custom-method');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli dispatches flow remediate to the implemented CLI module', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-flow-remediate-dispatch-'));
  const inputFile = path.join(dir, 'invalid-flows.jsonl');
  writeFileSync(inputFile, '[]\n', 'utf8');

  try {
    let observedOptions: RunFlowRemediateOptions | undefined;
    const result = await executeCli(
      [
        'flow',
        'remediate',
        '--input-file',
        inputFile,
        '--out-dir',
        path.join(dir, 'remediation'),
        '--json',
      ],
      {
        ...makeDeps(),
        runFlowRemediateImpl: async (options) => {
          observedOptions = options;
          return {
            schema_version: 1,
            generated_at_utc: '2026-03-30T09:00:00.000Z',
            status: 'completed_local_flow_remediation',
            input_file: inputFile,
            out_dir: path.join(dir, 'remediation'),
            counts: {
              input_rows: 1,
              state_code_0_rows: 1,
              state_code_100_rows: 0,
              remediated_rows: 1,
              ready_for_mcp_rows: 1,
              residual_manual_rows: 0,
            },
            applied_fix_counts: {
              normalize_flow_properties: 1,
            },
            residual_manual_ids: [],
            validation_backend: 'tidas_sdk',
            files: {
              all_remediated: path.join(
                dir,
                'remediation',
                'flows_tidas_sdk_plus_classification_remediated_all.jsonl',
              ),
              ready_for_mcp: path.join(
                dir,
                'remediation',
                'flows_tidas_sdk_plus_classification_remediated_ready_for_mcp.jsonl',
              ),
              residual_manual_queue: path.join(
                dir,
                'remediation',
                'flows_tidas_sdk_plus_classification_residual_manual_queue.jsonl',
              ),
              audit: path.join(
                dir,
                'remediation',
                'flows_tidas_sdk_plus_classification_remediation_audit.jsonl',
              ),
              prompt: path.join(
                dir,
                'remediation',
                'flows_tidas_sdk_plus_classification_residual_manual_queue_prompt.md',
              ),
              report: path.join(
                dir,
                'remediation',
                'flows_tidas_sdk_plus_classification_remediation_report.json',
              ),
            },
          };
        },
      },
    );

    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '');
    assert.equal(JSON.parse(result.stdout).status, 'completed_local_flow_remediation');
    assert.equal(observedOptions?.inputFile, inputFile);
    assert.equal(observedOptions?.outDir, path.join(dir, 'remediation'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli returns parsing errors for invalid flow remediate flags', async () => {
  const result = await executeCli(['flow', 'remediate', '--bad-flag'], makeDeps());
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /INVALID_ARGS/u);
});

test('executeCli supports alternate review flow input modes and validates numeric review-flow flags', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-review-flow-alt-dispatch-'));
  const rowsFile = path.join(dir, 'flows.json');
  const observedOptions: RunFlowReviewOptions[] = [];

  writeFileSync(rowsFile, '[]\n', 'utf8');

  try {
    const runFlowReviewImpl = async (options: RunFlowReviewOptions) => {
      observedOptions.push(options);
      const inputMode: 'flows_dir' | 'run_root' | 'rows_file' = options.flowsDir
        ? 'flows_dir'
        : options.runRoot
          ? 'run_root'
          : 'rows_file';
      const effectiveFlowsDir =
        options.flowsDir ??
        options.runRoot ??
        path.join(path.dirname(options.outDir), 'review-input', 'flows');
      return {
        schema_version: 1 as const,
        generated_at_utc: '2026-03-30T00:00:00.000Z',
        status: 'completed_local_flow_review' as const,
        run_id: options.runId ?? 'flow-run',
        out_dir: options.outDir,
        input_mode: inputMode,
        effective_flows_dir: effectiveFlowsDir,
        logic_version: options.logicVersion ?? 'flow-v1.0-cli',
        flow_count: 1,
        similarity_threshold: options.similarityThreshold ?? 0.92,
        methodology_rule_source: options.methodologyId ?? 'built_in',
        with_reference_context: false as const,
        reference_context_mode: 'disabled' as const,
        rule_finding_count: 1,
        llm_finding_count: 0,
        finding_count: 1,
        severity_counts: { warning: 1 },
        rule_counts: { sample_rule: 1 },
        llm: {
          enabled: Boolean(options.enableLlm),
          batch_count: 0,
          reviewed_flow_count: 0,
          truncated: false,
          batch_results: [],
        },
        files: {
          review_input_summary: path.join(options.outDir, 'review-input-summary.json'),
          materialization_summary: null,
          rule_findings: path.join(options.outDir, 'rule_findings.jsonl'),
          llm_findings: path.join(options.outDir, 'llm_findings.jsonl'),
          findings: path.join(options.outDir, 'findings.jsonl'),
          flow_summaries: path.join(options.outDir, 'flow_summaries.jsonl'),
          similarity_pairs: path.join(options.outDir, 'similarity_pairs.jsonl'),
          summary: path.join(options.outDir, 'flow_review_summary.json'),
          review_zh: path.join(options.outDir, 'flow_review_zh.md'),
          review_en: path.join(options.outDir, 'flow_review_en.md'),
          timing: path.join(options.outDir, 'flow_review_timing.md'),
          report: path.join(options.outDir, 'flow_review_report.json'),
        },
      };
    };

    const flowsDir = path.join(dir, 'flows');
    const flowsDirResult = await executeCli(
      ['review', 'flow', '--flows-dir', flowsDir, '--out-dir', path.join(dir, 'review-flows')],
      {
        ...makeDeps(),
        runFlowReviewImpl,
      },
    );
    assert.equal(flowsDirResult.exitCode, 0);
    assert.equal(observedOptions[0].flowsDir, flowsDir);
    assert.equal(observedOptions[0].rowsFile, undefined);
    assert.equal(observedOptions[0].runRoot, undefined);
    assert.equal(observedOptions[0].runId, undefined);

    const runRoot = path.join(dir, 'run-root');
    const runRootResult = await executeCli(
      [
        'review',
        'flow',
        '--run-root',
        runRoot,
        '--run-id',
        'run-root-review',
        '--out-dir',
        path.join(dir, 'review-run-root'),
        '--start-ts',
        '2026-03-30T00:00:00.000Z',
        '--end-ts',
        '2026-03-30T00:05:00.000Z',
        '--logic-version',
        'flow-v2',
        '--llm-model',
        'gpt-5.4-mini',
      ],
      {
        ...makeDeps(),
        runFlowReviewImpl,
      },
    );
    assert.equal(runRootResult.exitCode, 0);
    assert.equal(observedOptions[1].runRoot, runRoot);
    assert.equal(observedOptions[1].flowsDir, undefined);
    assert.equal(observedOptions[1].runId, 'run-root-review');
    assert.equal(observedOptions[1].startTs, '2026-03-30T00:00:00.000Z');
    assert.equal(observedOptions[1].endTs, '2026-03-30T00:05:00.000Z');
    assert.equal(observedOptions[1].logicVersion, 'flow-v2');
    assert.equal(observedOptions[1].llmModel, 'gpt-5.4-mini');

    const badFlagResult = await executeCli(['review', 'flow', '--bad-flag'], makeDeps());
    assert.equal(badFlagResult.exitCode, 2);
    assert.match(badFlagResult.stderr, /INVALID_ARGS/u);

    const invalidMaxFlowsResult = await executeCli(
      [
        'review',
        'flow',
        '--rows-file',
        rowsFile,
        '--out-dir',
        path.join(dir, 'bad-max'),
        '--llm-max-flows',
        '0',
      ],
      makeDeps(),
    );
    assert.equal(invalidMaxFlowsResult.exitCode, 2);
    assert.match(invalidMaxFlowsResult.stderr, /INVALID_LLM_MAX_FLOWS/u);

    const invalidBatchSizeResult = await executeCli(
      [
        'review',
        'flow',
        '--rows-file',
        rowsFile,
        '--out-dir',
        path.join(dir, 'bad-batch'),
        '--llm-batch-size',
        '0',
      ],
      makeDeps(),
    );
    assert.equal(invalidBatchSizeResult.exitCode, 2);
    assert.match(invalidBatchSizeResult.stderr, /INVALID_LLM_BATCH_SIZE/u);

    const invalidThresholdResult = await executeCli(
      [
        'review',
        'flow',
        '--rows-file',
        rowsFile,
        '--out-dir',
        path.join(dir, 'bad-threshold'),
        '--similarity-threshold',
        '0',
      ],
      makeDeps(),
    );
    assert.equal(invalidThresholdResult.exitCode, 2);
    assert.match(invalidThresholdResult.stderr, /INVALID_SIMILARITY_THRESHOLD/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('executeCli returns planned command message for other unimplemented process subcommands', async () => {
  const result = await executeCli(['process', 'list'], makeDeps());
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Command 'process list'/u);

  const flowGetHelp = await executeCli(['flow', 'get', '--help'], makeDeps());
  assert.equal(flowGetHelp.exitCode, 0);
  assert.match(flowGetHelp.stdout, /Planned contract:/u);
  assert.match(flowGetHelp.stdout, /canonical flow/u);
});

test('executeCli returns dedicated help for planned lifecyclemodel subcommands', async () => {
  const result = await executeCli(['lifecyclemodel', 'auto-build', '--help'], makeDeps());
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Planned contract:/u);
  assert.match(result.stdout, /discover candidate processes/u);
  assert.equal(result.stderr, '');
});

test('executeCli returns planned command message when a command is missing a subcommand', async () => {
  const result = await executeCli(['job'], makeDeps());
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Command 'job'/u);
});
