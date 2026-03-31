import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectPublishInputs, normalizePublishRequest, runPublish } from '../src/lib/publish.js';

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function makeCanonicalProcess(id: string): Record<string, unknown> {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          'common:UUID': id,
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          'common:dataSetVersion': '01.01.000',
        },
      },
    },
  };
}

function makeSource(id: string): Record<string, unknown> {
  return {
    sourceDataSet: {
      sourceInformation: {
        dataSetInformation: {
          'common:UUID': id,
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          'common:dataSetVersion': '01.01.000',
        },
      },
    },
  };
}

function makeResponse(options: {
  ok: boolean;
  status: number;
  contentType?: string;
  body?: string;
}) {
  return {
    ok: options.ok,
    status: options.status,
    headers: {
      get(name: string): string | null {
        return name.toLowerCase() === 'content-type'
          ? (options.contentType ?? 'application/json')
          : null;
      },
    },
    async text(): Promise<string> {
      return options.body ?? '';
    },
  };
}

test('normalizePublishRequest resolves paths relative to the request file and applies defaults', () => {
  const requestPath = '/tmp/tg-cli-publish/request.json';
  const normalized = normalizePublishRequest(
    {
      inputs: {
        bundle_paths: ['./bundle.json'],
      },
      out_dir: './out',
    },
    {
      requestPath,
      now: new Date('2026-03-28T00:00:00Z'),
    },
  );

  assert.deepEqual(normalized.inputs.bundle_paths, ['/tmp/tg-cli-publish/bundle.json']);
  assert.equal(normalized.out_dir, '/tmp/tg-cli-publish/out');
  assert.equal(normalized.publish.commit, false);
  assert.equal(normalized.publish.publish_process_build_runs, true);
  assert.equal(normalized.publish.max_attempts, 5);
  assert.equal(normalized.publish.retry_delay_seconds, 2);
});

test('normalizePublishRequest rejects unsupported relation modes and invalid integer settings', () => {
  assert.throws(
    () =>
      normalizePublishRequest('not-an-object', {
        requestPath: '/tmp/request.json',
      }),
    /must be a JSON object/u,
  );

  assert.throws(
    () =>
      normalizePublishRequest(
        {
          publish: {
            relation_mode: 'remote_table',
          },
        },
        {
          requestPath: '/tmp/request.json',
        },
      ),
    /relation_mode only supports/u,
  );

  assert.throws(
    () =>
      normalizePublishRequest(
        {
          publish: {
            max_attempts: 0,
          },
        },
        {
          requestPath: '/tmp/request.json',
        },
      ),
    /positive integer/u,
  );
});

test('normalizePublishRequest parses numeric strings and rejects invalid numeric shapes', () => {
  const normalized = normalizePublishRequest(
    {
      inputs: {
        relations: { id: 'rel-scalar' },
      },
      publish: {
        max_attempts: '7',
        retry_delay_seconds: '1.5',
        process_build_forward_args: '--flag',
      },
    },
    {
      requestPath: '/tmp/request.json',
    },
  );

  assert.equal(normalized.publish.max_attempts, 7);
  assert.equal(normalized.publish.retry_delay_seconds, 1.5);
  assert.deepEqual(normalized.inputs.relations, [{ id: 'rel-scalar' }]);
  assert.deepEqual(normalized.publish.process_build_forward_args, ['--flag']);

  assert.throws(
    () =>
      normalizePublishRequest(
        {
          publish: {
            max_attempts: { attempts: 1 },
          },
        },
        {
          requestPath: '/tmp/request.json',
        },
      ),
    /positive integer/u,
  );

  assert.throws(
    () =>
      normalizePublishRequest(
        {
          publish: {
            retry_delay_seconds: { seconds: 1 },
          },
        },
        {
          requestPath: '/tmp/request.json',
        },
      ),
    /non-negative number/u,
  );

  assert.throws(
    () =>
      normalizePublishRequest(
        {
          publish: {
            retry_delay_seconds: -1,
          },
        },
        {
          requestPath: '/tmp/request.json',
        },
      ),
    /non-negative number/u,
  );
});

test('collectPublishInputs merges bundle and direct inputs with source metadata', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-publish-collect-'));
  const bundlePath = path.join(dir, 'bundle.json');

  writeJson(bundlePath, {
    lifecyclemodels: [{ '@id': 'lm-bundle', '@version': '01.01.000' }],
    projected_processes: [{ '@id': 'projection-bundle' }],
    sources: [makeSource('src-bundle')],
    resulting_process_relations: [{ id: 'rel-bundle' }],
    process_build_runs: [{ run_id: 'bundle-run' }],
  });

  try {
    const collected = collectPublishInputs(
      {
        inputs: {
          bundle_paths: [bundlePath],
          lifecyclemodels: [{ '@id': 'lm-input', '@version': '01.01.000' }],
          processes: [makeCanonicalProcess('proc-input')],
          sources: [makeSource('src-input')],
          relations: [{ id: 'rel-input' }],
          process_build_runs: ['input-run'],
        },
        publish: {
          commit: false,
          publish_lifecyclemodels: true,
          publish_processes: true,
          publish_sources: true,
          publish_relations: true,
          publish_process_build_runs: true,
          relation_mode: 'local_manifest_only',
          max_attempts: 5,
          retry_delay_seconds: 2,
          process_build_forward_args: [],
        },
        out_dir: path.join(dir, 'out'),
      },
      dir,
    );

    assert.equal(collected.lifecyclemodels.length, 2);
    assert.equal(collected.lifecyclemodels[0].origin.source, 'bundle');
    assert.equal(collected.lifecyclemodels[0].origin.bundle_path, bundlePath);
    assert.equal(collected.lifecyclemodels[1].origin.source, 'input');
    assert.equal(collected.processes.length, 2);
    assert.equal(collected.relations.length, 2);
    assert.equal(collected.process_build_runs.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPublish produces a dry-run report and artifacts from bundle and direct inputs', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-publish-dry-run-'));
  const bundlePath = path.join(dir, 'bundle.json');
  const sourcePath = path.join(dir, 'source.json');
  const requestPath = path.join(dir, 'request.json');

  writeJson(bundlePath, {
    lifecyclemodels: [{ '@id': 'lm-bundle', '@version': '01.01.000' }],
    projected_processes: [{ '@id': 'projection-bundle', '@version': '0.0.1' }],
    resulting_process_relations: [{ id: 'rel-bundle' }],
    process_build_runs: [{ run_id: 'bundle-run' }],
  });
  writeJson(sourcePath, makeSource('src-file'));
  writeJson(requestPath, {
    inputs: {
      bundle_paths: ['./bundle.json'],
      sources: [{ file: './source.json' }],
      relations: [{ id: 'rel-input' }],
      process_build_runs: ['input-run'],
    },
    publish: {
      commit: false,
    },
  });

  try {
    const report = await runPublish({
      inputPath: requestPath,
      now: new Date('2026-03-28T00:00:00Z'),
    });

    assert.equal(report.commit, false);
    assert.equal(report.status, 'completed');
    assert.equal(report.lifecyclemodels[0].status, 'prepared');
    assert.equal(report.processes[0].status, 'deferred_projection_payload');
    assert.equal(report.sources[0].status, 'prepared');
    assert.equal(report.process_build_runs[0].status, 'prepared');
    assert.equal(report.counts.bundle_paths, 1);
    assert.equal(report.counts.relations, 2);
    assert.equal(report.counts.deferred, 1);
    assert.equal(report.relations.status, 'prepared_local_relation_manifest');
    assert.equal(report.relations.relations.length, 2);
    assert.equal(existsSync(report.files.publish_report), true);
    assert.deepEqual(JSON.parse(readFileSync(report.files.publish_report, 'utf8')), report);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPublish supports wrapped payload objects and string dataset entry paths', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-publish-wrapped-'));
  const sourcePath = path.join(dir, 'source.json');
  const requestPath = path.join(dir, 'request.json');

  writeJson(sourcePath, makeSource('src-string'));
  writeJson(requestPath, {
    inputs: {
      lifecyclemodels: [
        {
          json_ordered: {
            '@id': 'lm-wrapped',
            '@version': '01.01.000',
          },
        },
      ],
      sources: ['./source.json'],
    },
  });

  try {
    const report = await runPublish({
      inputPath: requestPath,
      now: new Date('2026-03-28T00:00:00Z'),
    });

    assert.equal(report.lifecyclemodels[0].status, 'prepared');
    assert.equal(report.sources[0].status, 'prepared');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPublish executes available commit executors and records failures', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-publish-commit-'));
  const requestPath = path.join(dir, 'request.json');

  writeJson(requestPath, {
    inputs: {
      lifecyclemodels: [{ '@id': 'lm-1', '@version': '01.01.000' }],
      processes: [makeCanonicalProcess('proc-1')],
      sources: [makeSource('src-1')],
      process_build_runs: ['run-1'],
    },
    publish: {
      commit: true,
      process_build_forward_args: ['--strict'],
    },
    out_dir: './publish-out',
  });

  try {
    const report = await runPublish({
      inputPath: requestPath,
      executors: {
        lifecyclemodels: () => ({ inserted: true }),
        processes: () => {
          throw new Error('process failed');
        },
        sources: () => ({ updated: true }),
        process_build_runs: () => ({ published: true }),
      },
      now: new Date('2026-03-28T00:00:00Z'),
    });

    assert.equal(report.commit, true);
    assert.equal(report.out_dir, path.join(dir, 'publish-out'));
    assert.equal(report.lifecyclemodels[0].status, 'executed');
    assert.equal(report.sources[0].status, 'executed');
    assert.equal(report.process_build_runs[0].status, 'executed');
    assert.equal(report.process_build_runs[0].forward_args[0], '--strict');
    assert.equal(report.processes[0].status, 'failed');
    assert.match(report.processes[0].error?.message ?? '', /process failed/u);
    assert.equal(report.status, 'completed_with_failures');
    assert.equal(report.counts.executed, 3);
    assert.equal(report.counts.failed, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPublish honors commit override, defers missing executors, and rejects invalid run entries', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-publish-override-'));
  const requestPath = path.join(dir, 'request.json');
  const invalidRequestPath = path.join(dir, 'invalid-request.json');

  writeJson(requestPath, {
    inputs: {
      processes: [makeCanonicalProcess('proc-override')],
    },
    publish: {
      commit: false,
    },
  });
  writeJson(invalidRequestPath, {
    inputs: {
      process_build_runs: [{}],
    },
  });

  try {
    const report = await runPublish({
      inputPath: requestPath,
      commit: true,
      now: new Date('2026-03-28T00:00:00Z'),
    });

    assert.equal(report.commit, true);
    assert.equal(report.processes[0].status, 'deferred_no_executor');

    await assert.rejects(
      async () =>
        runPublish({
          inputPath: invalidRequestPath,
        }),
      /missing run_id/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPublish uses default Supabase REST dataset executors when runtime env and fetch are provided', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-publish-default-rest-'));
  const requestPath = path.join(dir, 'request.json');
  const observed: Array<{ method: string; url: string; body?: string }> = [];

  writeJson(requestPath, {
    inputs: {
      processes: [makeCanonicalProcess('proc-default-rest')],
      sources: [makeSource('src-default-rest')],
    },
    publish: {
      commit: true,
    },
  });

  try {
    const report = await runPublish({
      inputPath: requestPath,
      env: {
        TIANGONG_LCA_API_BASE_URL: 'https://example.supabase.co',
        TIANGONG_LCA_API_KEY: 'key',
      } as NodeJS.ProcessEnv,
      fetchImpl: async (url, init) => {
        observed.push({
          method: String(init?.method ?? 'GET'),
          url: String(url),
          body: typeof init?.body === 'string' ? init.body : undefined,
        });

        if (String(url).includes('/processes?select=')) {
          return makeResponse({
            ok: true,
            status: 200,
            body: '[]',
          });
        }

        if (String(url).includes('/sources?select=')) {
          return makeResponse({
            ok: true,
            status: 200,
            body: '[{"id":"src-default-rest","version":"01.01.000","state_code":0}]',
          });
        }

        return makeResponse({
          ok: true,
          status: 200,
          body: '[{"id":"ok"}]',
        });
      },
      now: new Date('2026-03-28T00:00:00Z'),
    });

    assert.equal(report.processes[0].status, 'executed');
    assert.equal(report.sources[0].status, 'executed');
    assert.deepEqual(report.processes[0].execution, {
      status: 'success',
      operation: 'insert',
    });
    assert.deepEqual(report.sources[0].execution, {
      status: 'success',
      operation: 'update_existing',
    });
    assert.deepEqual(
      observed.map((entry) => entry.method),
      ['GET', 'POST', 'GET', 'PATCH'],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPublish skips disabled publish groups and can clear relation manifests', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-publish-disabled-'));
  const requestPath = path.join(dir, 'request.json');

  writeJson(requestPath, {
    inputs: {
      lifecyclemodels: [{ '@id': 'lm-disabled', '@version': '01.01.000' }],
      processes: [makeCanonicalProcess('proc-disabled')],
      sources: [makeSource('src-disabled')],
      relations: [{ id: 'rel-disabled' }],
      process_build_runs: ['run-disabled'],
    },
    publish: {
      publish_lifecyclemodels: false,
      publish_processes: false,
      publish_sources: false,
      publish_relations: false,
      publish_process_build_runs: false,
    },
  });

  try {
    const report = await runPublish({
      inputPath: requestPath,
      now: new Date('2026-03-28T00:00:00Z'),
    });

    assert.deepEqual(report.lifecyclemodels, []);
    assert.deepEqual(report.processes, []);
    assert.deepEqual(report.sources, []);
    assert.deepEqual(report.process_build_runs, []);
    assert.deepEqual(report.relations.relations, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPublish records non-canonical process errors and process-build-run executor failures', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-publish-branches-'));
  const requestPath = path.join(dir, 'request.json');

  writeJson(requestPath, {
    inputs: {
      process_build_runs: ['run-fail'],
    },
    publish: {
      commit: true,
    },
  });

  try {
    const brokenProcessEntry = {
      toJSON() {
        return { kind: 'broken-process' };
      },
      get processDataSet() {
        throw new Error('broken payload');
      },
    };

    const report = await runPublish({
      inputPath: requestPath,
      rawRequest: {
        inputs: {
          processes: [brokenProcessEntry],
          process_build_runs: ['run-fail'],
        },
        publish: {
          commit: true,
        },
      },
      executors: {
        process_build_runs: () => {
          return Promise.reject('build-run failed');
        },
      },
      now: new Date('2026-03-28T00:00:00Z'),
    });

    assert.equal(report.processes[0].status, 'deferred_projection_payload');
    assert.match(report.processes[0].reason ?? '', /broken payload/u);
    assert.equal(report.process_build_runs[0].status, 'failed');
    assert.match(report.process_build_runs[0].error?.message ?? '', /build-run failed/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPublish defers process build runs when commit is true and no executor is provided', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-publish-run-defer-'));
  const requestPath = path.join(dir, 'request.json');

  writeJson(requestPath, {
    inputs: {
      process_build_runs: ['run-deferred'],
    },
    publish: {
      commit: true,
    },
  });

  try {
    const report = await runPublish({
      inputPath: requestPath,
    });

    assert.equal(report.process_build_runs[0].status, 'deferred_no_executor');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPublish rejects invalid source payloads and unsupported dataset entries', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-publish-invalid-'));
  const invalidSourceRequestPath = path.join(dir, 'invalid-source.json');
  const unsupportedEntryRequestPath = path.join(dir, 'unsupported-entry.json');

  writeJson(invalidSourceRequestPath, {
    inputs: {
      sources: [{}],
    },
  });
  writeJson(unsupportedEntryRequestPath, {
    inputs: {
      lifecyclemodels: [0],
    },
  });

  try {
    await assert.rejects(
      async () =>
        runPublish({
          inputPath: invalidSourceRequestPath,
        }),
      /Source payload missing/u,
    );

    await assert.rejects(
      async () =>
        runPublish({
          inputPath: unsupportedEntryRequestPath,
        }),
      /Unsupported dataset entry/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPublish rejects non-object dataset files and missing lifecyclemodel identities', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-publish-invalid-files-'));
  const invalidDatasetPath = path.join(dir, 'invalid.json');
  const invalidDatasetRequestPath = path.join(dir, 'invalid-dataset-request.json');
  const invalidLifecyclemodelRequestPath = path.join(dir, 'invalid-lifecyclemodel-request.json');

  writeJson(invalidDatasetPath, [1, 2, 3]);
  writeJson(invalidDatasetRequestPath, {
    inputs: {
      sources: ['./invalid.json'],
    },
  });
  writeJson(invalidLifecyclemodelRequestPath, {
    inputs: {
      lifecyclemodels: [
        {
          jsonOrdered: {
            '@version': '01.01.000',
          },
        },
      ],
    },
  });

  try {
    await assert.rejects(
      async () =>
        runPublish({
          inputPath: invalidDatasetRequestPath,
        }),
      /Expected JSON object input/u,
    );

    await assert.rejects(
      async () =>
        runPublish({
          inputPath: invalidLifecyclemodelRequestPath,
        }),
      /Lifecycle model payload missing/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPublish accepts native lifecyclemodel json_ordered payload wrappers', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-publish-native-lifecyclemodel-'));
  const requestPath = path.join(dir, 'request.json');

  writeJson(requestPath, {
    inputs: {
      lifecyclemodels: [
        {
          jsonOrdered: {
            lifeCycleModelDataSet: {
              lifeCycleModelInformation: {
                dataSetInformation: {
                  'common:UUID': 'lm-native-1',
                  referenceToResultingProcess: {
                    '@refObjectId': 'lm-native-1-result',
                  },
                },
                quantitativeReference: {
                  referenceToReferenceProcess: '1',
                },
              },
              administrativeInformation: {
                publicationAndOwnership: {
                  'common:dataSetVersion': '02.03.004',
                },
              },
            },
          },
        },
      ],
    },
  });

  try {
    const report = await runPublish({
      inputPath: requestPath,
    });

    assert.equal(report.lifecyclemodels.length, 1);
    assert.equal(report.lifecyclemodels[0].status, 'prepared');
    assert.equal(report.lifecyclemodels[0].id, 'lm-native-1');
    assert.equal(report.lifecyclemodels[0].version, '02.03.004');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
