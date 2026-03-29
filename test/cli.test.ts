import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeCli } from '../src/cli.js';
import type { DotEnvLoadResult } from '../src/lib/dotenv.js';
import type { FetchLike } from '../src/lib/http.js';

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
  assert.match(result.stdout, /lifecyclemodel build-resulting-process/u);
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
});

test('executeCli returns help for publish and validation subcommands', async () => {
  const publishHelp = await executeCli(['publish', 'run', '--help'], makeDeps());
  assert.equal(publishHelp.exitCode, 0);
  assert.match(publishHelp.stdout, /--out-dir/u);

  const validationHelp = await executeCli(['validation', 'run', '--help'], makeDeps());
  assert.equal(validationHelp.exitCode, 0);
  assert.match(validationHelp.stdout, /--report-file/u);
});

test('executeCli returns group help for search and admin namespaces', async () => {
  const searchHelp = await executeCli(['search', '--help'], makeDeps());
  assert.equal(searchHelp.exitCode, 0);
  assert.match(searchHelp.stdout, /tiangong search <flow\|process\|lifecyclemodel>/u);

  const adminHelp = await executeCli(['admin', '--help'], makeDeps());
  assert.equal(adminHelp.exitCode, 0);
  assert.match(adminHelp.stdout, /tiangong admin embedding-run/u);
});

test('executeCli returns help for the lifecyclemodel namespace and planned subcommands', async () => {
  const lifecyclemodelHelp = await executeCli(['lifecyclemodel'], makeDeps());
  assert.equal(lifecyclemodelHelp.exitCode, 0);
  assert.match(lifecyclemodelHelp.stdout, /tiangong lifecyclemodel <subcommand>/u);
  assert.match(lifecyclemodelHelp.stdout, /build-resulting-process/u);

  const buildHelp = await executeCli(
    ['lifecyclemodel', 'build-resulting-process', '--help'],
    makeDeps(),
  );
  assert.equal(buildHelp.exitCode, 0);
  assert.match(buildHelp.stdout, /tiangong lifecyclemodel build-resulting-process --input <file>/u);
  assert.doesNotMatch(buildHelp.stdout, /Planned command/u);
});

test('executeCli executes lifecyclemodel build-resulting-process with injected implementation', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-lifecyclemodel-cli-'));
  const inputPath = path.join(dir, 'request.json');
  writeFileSync(inputPath, '{"source_model":{"json_ordered_path":"./model.json"}}', 'utf8');

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
        ...makeDeps(),
        runLifecyclemodelBuildResultingProcessImpl: async (options) => {
          assert.equal(options.inputPath, inputPath);
          assert.equal(options.outDir, './out');
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
});

test('executeCli returns parsing errors for invalid lifecyclemodel build flags', async () => {
  const result = await executeCli(
    ['lifecyclemodel', 'build-resulting-process', '--bad-flag'],
    makeDeps(),
  );
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /INVALID_ARGS/u);
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
  const result = await executeCli(['process', 'auto-build'], makeDeps());
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

test('executeCli returns dedicated help for planned lifecyclemodel subcommands', async () => {
  const result = await executeCli(['lifecyclemodel', 'auto-build', '--help'], makeDeps());
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Planned contract:/u);
  assert.match(result.stdout, /discover candidate processes/u);
  assert.equal(result.stderr, '');
});

test('executeCli returns planned command message when a command is missing a subcommand', async () => {
  const result = await executeCli(['flow'], makeDeps());
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Command 'flow'/u);
});
