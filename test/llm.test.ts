import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CliError } from '../src/lib/errors.js';
import { extractLlmOutput, extractLlmUsage, invokeLlm, readLlmRuntimeEnv } from '../src/lib/llm.js';

test('readLlmRuntimeEnv returns canonical TianGong LCA LLM env keys', () => {
  const runtime = readLlmRuntimeEnv({
    TIANGONG_LCA_REVIEW_LLM_BASE_URL: 'https://llm.example/v1',
    TIANGONG_LCA_REVIEW_LLM_API_KEY: 'secret-token',
    TIANGONG_LCA_REVIEW_LLM_MODEL: 'gpt-5.4',
  });

  assert.deepEqual(runtime, {
    baseUrl: 'https://llm.example/v1',
    apiKey: 'secret-token',
    model: 'gpt-5.4',
  });
});

test('extractLlmOutput and extractLlmUsage read direct response payloads', () => {
  const payload = {
    output_text: 'hello world',
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
      input_tokens_details: {
        cached_tokens: 2,
      },
      output_tokens_details: {
        reasoning_tokens: 1,
      },
    },
  };

  assert.equal(extractLlmOutput(payload), 'hello world');
  assert.deepEqual(extractLlmUsage(payload), {
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    cachedInputTokens: 2,
    reasoningTokens: 1,
  });
});

test('extractLlmOutput falls back to message parts and extractLlmUsage derives totals', () => {
  const payload = {
    output: [
      {
        type: 'message',
        content: [
          { type: 'output_text', text: 'line one' },
          { type: 'tool_call', text: 'ignored' },
          { type: 'output_text', text: 'line two' },
        ],
      },
      {
        type: 'tool_result',
        content: [{ type: 'output_text', text: 'ignored' }],
      },
    ],
    usage: {
      input_tokens: '3',
      output_tokens: 2.8,
      input_tokens_details: {
        cached_tokens: '1',
      },
      output_tokens_details: {
        reasoning_tokens: 'bad',
      },
    },
  };

  assert.equal(extractLlmOutput(payload), 'line one\nline two');
  assert.deepEqual(extractLlmUsage(payload), {
    inputTokens: 3,
    outputTokens: 2,
    totalTokens: 5,
    cachedInputTokens: 1,
  });
  assert.equal(extractLlmOutput(null), '');
  assert.equal(extractLlmUsage({ usage: 'invalid' }), null);
});

test('extractLlmOutput skips malformed items and extractLlmUsage returns null for empty payloads', () => {
  const payload = {
    output: [
      null,
      {
        type: 'message',
        content: 'not-an-array',
      },
      {
        type: 'message',
        content: [null, { type: 'output_text', text: 'kept text' }],
      },
    ],
  };

  assert.equal(extractLlmOutput(payload), 'kept text');
  assert.equal(extractLlmUsage(null), null);
  assert.equal(extractLlmUsage({ usage: {} }), null);
});

test('invokeLlm posts a responses request, writes cache, and appends trace records', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-llm-success-'));
  const cacheDir = path.join(dir, 'cache');
  const tracePath = path.join(dir, 'trace.jsonl');
  const captured: { url?: string; init?: RequestInit } = {};

  try {
    const result = await invokeLlm({
      env: {
        baseUrl: 'https://llm.example/v1/',
        apiKey: 'secret-token',
        model: 'gpt-5.4',
      },
      input: {
        prompt: 'You are a helpful LCA model.',
        context: { flow: 'steel' },
        responseFormat: { type: 'json_schema', schema: { type: 'object' } },
        text: { verbosity: 'low' },
      },
      fetchImpl: async (url, init) => {
        captured.url = url;
        captured.init = init;
        return {
          ok: true,
          status: 200,
          headers: {
            get: () => 'application/json; charset=utf-8',
          },
          text: async () =>
            JSON.stringify({
              output_text: 'done',
              usage: {
                input_tokens: 10,
                output_tokens: 5,
                total_tokens: 15,
              },
            }),
        };
      },
      timeoutMs: 25,
      cacheDir,
      tracePath,
      runId: 'run-001',
      module: 'process-auto-build',
      stage: 'main',
    });

    assert.equal(result.output, 'done');
    assert.equal(result.cacheHit, false);
    assert.deepEqual(result.usage, {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
    assert.match(result.promptHash, /^[a-f0-9]{64}$/u);

    assert.equal(captured.url, 'https://llm.example/v1/responses');
    assert.equal(captured.init?.method, 'POST');
    assert.equal(
      (captured.init?.headers as Record<string, string>).Authorization,
      'Bearer secret-token',
    );

    const requestBody = JSON.parse(String(captured.init?.body));
    assert.equal(requestBody.model, 'gpt-5.4');
    assert.equal(requestBody.input[0].content[0].text, 'You are a helpful LCA model.');
    assert.equal(requestBody.input[1].content[0].text, '{"flow":"steel"}');
    assert.deepEqual(requestBody.text, {
      verbosity: 'low',
      format: { type: 'json_schema', schema: { type: 'object' } },
    });

    assert.equal(readdirSync(cacheDir).length, 1);
    const traceRecord = JSON.parse(readFileSync(tracePath, 'utf8').trim());
    assert.equal(traceRecord.runId, 'run-001');
    assert.equal(traceRecord.module, 'process-auto-build');
    assert.equal(traceRecord.stage, 'main');
    assert.equal(traceRecord.model, 'gpt-5.4');
    assert.equal(traceRecord.cacheHit, false);
    assert.equal(traceRecord.status, 'ok');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('invokeLlm reuses the cache without calling fetch and records cache-hit traces', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-llm-cache-hit-'));
  const cacheDir = path.join(dir, 'cache');
  const tracePath = path.join(dir, 'trace.jsonl');
  let fetchCalls = 0;

  try {
    const baseOptions = {
      env: {
        baseUrl: 'https://llm.example/v1',
        apiKey: 'secret-token',
        model: 'gpt-5.4',
      },
      input: {
        prompt: 'prompt',
        context: 'context',
      },
      timeoutMs: 20,
      cacheDir,
      tracePath,
      runId: 'run-002',
      module: 'cache-test',
      stage: 'main',
    } as const;

    await invokeLlm({
      ...baseOptions,
      fetchImpl: async () => {
        fetchCalls += 1;
        return {
          ok: true,
          status: 200,
          headers: {
            get: () => 'application/json',
          },
          text: async () => JSON.stringify({ output_text: 'first result' }),
        };
      },
    });

    const cachedResult = await invokeLlm({
      ...baseOptions,
      fetchImpl: async () => {
        throw new Error('fetch should not be called when cache exists');
      },
    });

    assert.equal(fetchCalls, 1);
    assert.equal(cachedResult.output, 'first result');
    assert.equal(cachedResult.cacheHit, true);

    const traceRecords = readFileSync(tracePath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(traceRecords.length, 2);
    assert.equal(traceRecords[1].cacheHit, true);
    assert.equal(traceRecords[1].status, 'ok');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('invokeLlm retries transport errors and succeeds after a custom sleep', async () => {
  const sleeps: number[] = [];
  let attempts = 0;

  const result = await invokeLlm({
    env: {
      baseUrl: 'https://llm.example/v1',
      apiKey: 'secret-token',
      model: 'gpt-5.4',
    },
    input: {
      prompt: 'prompt',
    },
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('network down');
      }

      return {
        ok: true,
        status: 200,
        headers: {
          get: () => 'application/json',
        },
        text: async () => JSON.stringify({ output_text: 'recovered' }),
      };
    },
    timeoutMs: 20,
    maxAttempts: 2,
    retryDelayMs: 7,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [7]);
  assert.equal(result.output, 'recovered');
});

test('invokeLlm retries retryable HTTP failures using the default sleep path', async () => {
  let attempts = 0;

  const result = await invokeLlm({
    env: {
      baseUrl: 'https://llm.example/v1',
      apiKey: 'secret-token',
      model: 'gpt-5.4',
    },
    input: {
      prompt: 'prompt',
      context: null,
    },
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          ok: false,
          status: 429,
          headers: {
            get: () => 'application/json',
          },
          text: async () => JSON.stringify({ error: { message: 'rate limited' } }),
        };
      }

      return {
        ok: true,
        status: 200,
        headers: {
          get: () => 'application/json',
        },
        text: async () => JSON.stringify({ output_text: 'after retry' }),
      };
    },
    timeoutMs: 20,
    maxAttempts: 2,
    retryDelayMs: 0,
  });

  assert.equal(attempts, 2);
  assert.equal(result.output, 'after retry');
});

test('invokeLlm writes error traces and does not retry non-retryable HTTP failures', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-llm-http-error-'));
  const tracePath = path.join(dir, 'trace.jsonl');
  const sleeps: number[] = [];

  try {
    await assert.rejects(
      () =>
        invokeLlm({
          env: {
            baseUrl: 'https://llm.example/v1',
            apiKey: 'secret-token',
            model: 'gpt-5.4',
          },
          input: {
            prompt: 'prompt',
          },
          fetchImpl: async () => ({
            ok: false,
            status: 400,
            headers: {
              get: () => 'application/json',
            },
            text: async () => JSON.stringify({ error: { message: 'bad request' } }),
          }),
          timeoutMs: 20,
          maxAttempts: 3,
          retryDelayMs: 5,
          sleep: async (ms) => {
            sleeps.push(ms);
          },
          tracePath,
        }),
      (error: unknown) => {
        assert.equal(error instanceof CliError, true);
        assert.equal((error as CliError).code, 'LLM_REQUEST_FAILED');
        return true;
      },
    );

    assert.deepEqual(sleeps, []);
    const traceRecord = JSON.parse(readFileSync(tracePath, 'utf8').trim());
    assert.equal(traceRecord.status, 'error');
    assert.equal(traceRecord.cacheHit, false);
    assert.match(traceRecord.error, /HTTP 400/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('invokeLlm rejects non-json content types from the LLM service', async () => {
  await assert.rejects(
    () =>
      invokeLlm({
        env: {
          baseUrl: 'https://llm.example/v1',
          apiKey: 'secret-token',
          model: 'gpt-5.4',
        },
        input: {
          prompt: 'prompt',
        },
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          headers: {
            get: () => 'text/plain',
          },
          text: async () => 'not-json',
        }),
        timeoutMs: 20,
        maxAttempts: 1,
      }),
    /not valid JSON/u,
  );
});

test('invokeLlm rejects responses that omit the content-type header', async () => {
  await assert.rejects(
    () =>
      invokeLlm({
        env: {
          baseUrl: 'https://llm.example/v1',
          apiKey: 'secret-token',
          model: 'gpt-5.4',
        },
        input: {
          prompt: 'prompt',
        },
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          headers: {
            get: () => null,
          },
          text: async () => '{"output_text":"ignored"}',
        }),
        timeoutMs: 20,
        maxAttempts: 1,
      }),
    /not valid JSON/u,
  );
});

test('invokeLlm rejects malformed JSON responses from the LLM service', async () => {
  await assert.rejects(
    () =>
      invokeLlm({
        env: {
          baseUrl: 'https://llm.example/v1',
          apiKey: 'secret-token',
          model: 'gpt-5.4',
        },
        input: {
          prompt: 'prompt',
        },
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          headers: {
            get: () => 'application/json',
          },
          text: async () => '{invalid-json',
        }),
        timeoutMs: 20,
        maxAttempts: 1,
      }),
    /not valid JSON/u,
  );
});

test('invokeLlm validates required canonical LLM env values', async () => {
  await assert.rejects(
    () =>
      invokeLlm({
        env: {
          baseUrl: null,
          apiKey: 'secret-token',
          model: 'gpt-5.4',
        },
        input: {
          prompt: 'prompt',
        },
        fetchImpl: async () => {
          throw new Error('should not fetch');
        },
        timeoutMs: 20,
      }),
    /TIANGONG_LCA_REVIEW_LLM_BASE_URL/u,
  );

  await assert.rejects(
    () =>
      invokeLlm({
        env: {
          baseUrl: 'https://llm.example/v1',
          apiKey: null,
          model: 'gpt-5.4',
        },
        input: {
          prompt: 'prompt',
        },
        fetchImpl: async () => {
          throw new Error('should not fetch');
        },
        timeoutMs: 20,
      }),
    /TIANGONG_LCA_REVIEW_LLM_API_KEY/u,
  );

  await assert.rejects(
    () =>
      invokeLlm({
        env: {
          baseUrl: 'https://llm.example/v1',
          apiKey: 'secret-token',
          model: null,
        },
        input: {
          prompt: 'prompt',
        },
        fetchImpl: async () => {
          throw new Error('should not fetch');
        },
        timeoutMs: 20,
      }),
    /TIANGONG_LCA_REVIEW_LLM_MODEL/u,
  );
});

test('invokeLlm rejects invalid cached payloads before making a network call', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-cli-llm-bad-cache-'));
  const cacheDir = path.join(dir, 'cache');

  try {
    const firstResult = await invokeLlm({
      env: {
        baseUrl: 'https://llm.example/v1',
        apiKey: 'secret-token',
        model: 'gpt-5.4',
      },
      input: {
        prompt: 'prompt',
        context: 'context',
      },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: {
          get: () => 'application/json',
        },
        text: async () => JSON.stringify({ output_text: 'cached' }),
      }),
      timeoutMs: 20,
      cacheDir,
    });

    writeFileSync(path.join(cacheDir, `${firstResult.promptHash}.json`), '{}', 'utf8');

    await assert.rejects(
      () =>
        invokeLlm({
          env: {
            baseUrl: 'https://llm.example/v1',
            apiKey: 'secret-token',
            model: 'gpt-5.4',
          },
          input: {
            prompt: 'prompt',
            context: 'context',
          },
          fetchImpl: async () => {
            throw new Error('fetch should not be called with an existing cache file');
          },
          timeoutMs: 20,
          cacheDir,
        }),
      /LLM cache payload is invalid/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
