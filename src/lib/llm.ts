import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { EnvSpec } from './env.js';
import { resolveEnv } from './env.js';
import { CliError } from './errors.js';
import type { FetchLike } from './http.js';
import { readJsonArtifact, writeJsonArtifact, writeJsonLinesArtifact } from './artifacts.js';

export const LLM_ENV_KEYS = {
  baseUrl: 'TIANGONG_LCA_REVIEW_LLM_BASE_URL',
  apiKey: 'TIANGONG_LCA_REVIEW_LLM_API_KEY',
  model: 'TIANGONG_LCA_REVIEW_LLM_MODEL',
} as const;

export const LLM_ENV_SPECS: EnvSpec[] = [
  {
    key: LLM_ENV_KEYS.baseUrl,
    required: true,
    description: 'Review LLM OpenAI-compatible Responses API base URL',
  },
  {
    key: LLM_ENV_KEYS.apiKey,
    required: true,
    description: 'LLM API key',
  },
  {
    key: LLM_ENV_KEYS.model,
    required: true,
    description: 'LLM model identifier',
  },
];

export type LlmRuntimeEnv = {
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
};

export type LlmUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
};

export type LlmInvocationInput = {
  prompt: string;
  context?: unknown;
  responseFormat?: unknown;
  text?: Record<string, unknown>;
};

export type LlmInvocationResult = {
  output: string;
  usage: LlmUsage | null;
  cacheHit: boolean;
  promptHash: string;
};

export type InvokeLlmOptions = {
  env: LlmRuntimeEnv;
  input: LlmInvocationInput;
  fetchImpl: FetchLike;
  timeoutMs: number;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  retryDelayMs?: number;
  cacheDir?: string | null;
  tracePath?: string | null;
  runId?: string | null;
  module?: string;
  stage?: string;
  now?: () => Date;
};

type SuccessfulLlmResponse = {
  output: string;
  usage: LlmUsage | null;
};

type CachedLlmResult = {
  output: string;
  usage?: LlmUsage | null;
};

type RequiredLlmRuntimeEnv = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

type LlmTraceRecord = {
  timestamp: string;
  runId: string;
  module: string;
  stage: string;
  promptHash: string;
  model: string;
  latencyMs: number;
  cacheHit: boolean;
  status: 'ok' | 'error';
  usage?: LlmUsage;
  error?: string;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function requireLlmRuntime(env: LlmRuntimeEnv): RequiredLlmRuntimeEnv {
  if (!env.baseUrl) {
    throw new CliError(`Missing LLM base URL. Set ${LLM_ENV_KEYS.baseUrl}.`, {
      code: 'LLM_BASE_URL_REQUIRED',
      exitCode: 2,
    });
  }

  if (!env.apiKey) {
    throw new CliError(`Missing LLM API key. Set ${LLM_ENV_KEYS.apiKey}.`, {
      code: 'LLM_API_KEY_REQUIRED',
      exitCode: 2,
    });
  }

  if (!env.model) {
    throw new CliError(`Missing LLM model. Set ${LLM_ENV_KEYS.model}.`, {
      code: 'LLM_MODEL_REQUIRED',
      exitCode: 2,
    });
  }

  return {
    baseUrl: env.baseUrl,
    apiKey: env.apiKey,
    model: env.model,
  };
}

function buildLlmUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/u, '')}/responses`;
}

function normalizeContext(context: unknown): string {
  if (context === undefined || context === null) {
    return '';
  }

  if (typeof context === 'string') {
    return context;
  }

  return JSON.stringify(context);
}

function buildTextOptions(input: LlmInvocationInput): Record<string, unknown> | undefined {
  const options = { ...(input.text ?? {}) };
  if (input.responseFormat !== undefined) {
    options.format = input.responseFormat;
  }

  return Object.keys(options).length ? options : undefined;
}

function buildRequestBody(model: string, input: LlmInvocationInput): Record<string, unknown> {
  const textOptions = buildTextOptions(input);
  const body: Record<string, unknown> = {
    model,
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: input.prompt }],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: normalizeContext(input.context) }],
      },
    ],
  };

  if (textOptions) {
    body.text = textOptions;
  }

  return body;
}

function hashRequest(baseUrl: string, body: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify({ baseUrl, body })).digest('hex');
}

function buildCachePath(cacheDir: string | null | undefined, promptHash: string): string | null {
  if (!cacheDir) {
    return null;
  }

  return path.join(cacheDir, `${promptHash}.json`);
}

function getUsageValue(value: unknown, key: string): unknown {
  if (value && typeof value === 'object' && key in value) {
    return (value as Record<string, unknown>)[key];
  }

  return undefined;
}

function coerceInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }

  return undefined;
}

export function extractLlmOutput(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const directText = (payload as { output_text?: unknown }).output_text;
    if (typeof directText === 'string' && directText) {
      return directText;
    }

    const output = (payload as { output?: unknown }).output;
    if (Array.isArray(output)) {
      const parts: string[] = [];
      output.forEach((item) => {
        if (!item || typeof item !== 'object') {
          return;
        }

        if ((item as { type?: unknown }).type !== 'message') {
          return;
        }

        const content = (item as { content?: unknown }).content;
        if (!Array.isArray(content)) {
          return;
        }

        content.forEach((entry) => {
          if (!entry || typeof entry !== 'object') {
            return;
          }

          if ((entry as { type?: unknown }).type !== 'output_text') {
            return;
          }

          const text = (entry as { text?: unknown }).text;
          if (typeof text === 'string' && text) {
            parts.push(text);
          }
        });
      });
      return parts.join('\n');
    }
  }

  return '';
}

export function extractLlmUsage(payload: unknown): LlmUsage | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const usageObject = getUsageValue(payload, 'usage');
  if (!usageObject || typeof usageObject !== 'object') {
    return null;
  }

  const usage: LlmUsage = {};
  const inputTokens = coerceInteger(getUsageValue(usageObject, 'input_tokens'));
  const outputTokens = coerceInteger(getUsageValue(usageObject, 'output_tokens'));
  const totalTokens = coerceInteger(getUsageValue(usageObject, 'total_tokens'));
  const inputDetails = getUsageValue(usageObject, 'input_tokens_details');
  const outputDetails = getUsageValue(usageObject, 'output_tokens_details');
  const cachedInputTokens = coerceInteger(getUsageValue(inputDetails, 'cached_tokens'));
  const reasoningTokens = coerceInteger(getUsageValue(outputDetails, 'reasoning_tokens'));

  if (inputTokens !== undefined) {
    usage.inputTokens = inputTokens;
  }

  if (outputTokens !== undefined) {
    usage.outputTokens = outputTokens;
  }

  if (totalTokens !== undefined) {
    usage.totalTokens = totalTokens;
  } else if (inputTokens !== undefined && outputTokens !== undefined) {
    usage.totalTokens = inputTokens + outputTokens;
  }

  if (cachedInputTokens !== undefined) {
    usage.cachedInputTokens = cachedInputTokens;
  }

  if (reasoningTokens !== undefined) {
    usage.reasoningTokens = reasoningTokens;
  }

  return Object.keys(usage).length ? usage : null;
}

function loadCachedResult(cachePath: string): LlmInvocationResult {
  const payload = readJsonArtifact(cachePath) as CachedLlmResult;
  if (!payload || typeof payload !== 'object' || typeof payload.output !== 'string') {
    throw new CliError(`LLM cache payload is invalid: ${cachePath}`, {
      code: 'LLM_CACHE_INVALID',
      exitCode: 2,
    });
  }

  return {
    output: payload.output,
    usage: payload.usage ?? null,
    cacheHit: true,
    promptHash: path.basename(cachePath, '.json'),
  };
}

function buildTraceRecord(options: {
  now: Date;
  runId: string | null | undefined;
  module: string | undefined;
  stage: string | undefined;
  promptHash: string;
  model: string;
  latencyMs: number;
  cacheHit: boolean;
  status: 'ok' | 'error';
  usage: LlmUsage | null;
  error?: string;
}): LlmTraceRecord {
  const record: LlmTraceRecord = {
    timestamp: options.now.toISOString(),
    runId: options.runId?.trim() || 'unknown',
    module: options.module?.trim() || 'unknown',
    stage: options.stage?.trim() || 'unknown',
    promptHash: options.promptHash,
    model: options.model,
    latencyMs: Math.round(options.latencyMs * 100) / 100,
    cacheHit: options.cacheHit,
    status: options.status,
  };

  if (options.usage) {
    record.usage = options.usage;
  }

  if (options.error) {
    record.error = options.error.slice(0, 500);
  }

  return record;
}

function writeTrace(tracePath: string | null | undefined, record: LlmTraceRecord): void {
  if (!tracePath) {
    return;
  }

  writeJsonLinesArtifact(tracePath, record, { append: true });
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isJsonContentType(contentType: string | null): boolean {
  return (contentType ?? '').toLowerCase().includes('application/json');
}

async function requestLlm(
  url: string,
  body: Record<string, unknown>,
  options: Pick<InvokeLlmOptions, 'fetchImpl' | 'timeoutMs'>,
  apiKey: string,
): Promise<SuccessfulLlmResponse> {
  const response = await options.fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs),
  });

  const rawText = await response.text();
  const contentType = response.headers.get('content-type');

  if (!isJsonContentType(contentType)) {
    throw new CliError(`LLM response was not valid JSON for ${url}`, {
      code: 'LLM_INVALID_JSON',
      exitCode: 1,
      details: rawText,
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawText);
  } catch (error) {
    throw new CliError(`LLM response was not valid JSON for ${url}`, {
      code: 'LLM_INVALID_JSON',
      exitCode: 1,
      details: String(error),
    });
  }

  if (!response.ok) {
    const httpError = new CliError(`LLM request failed with HTTP ${response.status} from ${url}`, {
      code: 'LLM_REQUEST_FAILED',
      exitCode: 1,
      details: payload,
    });
    (httpError as CliError & { retryable?: boolean }).retryable = isRetryableStatus(
      response.status,
    );
    throw httpError;
  }

  return {
    output: extractLlmOutput(payload),
    usage: extractLlmUsage(payload),
  };
}

export function readLlmRuntimeEnv(env: NodeJS.ProcessEnv): LlmRuntimeEnv {
  return {
    baseUrl: resolveEnv(LLM_ENV_SPECS[0], env).value,
    apiKey: resolveEnv(LLM_ENV_SPECS[1], env).value,
    model: resolveEnv(LLM_ENV_SPECS[2], env).value,
  };
}

export async function invokeLlm(options: InvokeLlmOptions): Promise<LlmInvocationResult> {
  const runtime = requireLlmRuntime(options.env);
  const url = buildLlmUrl(runtime.baseUrl);
  const body = buildRequestBody(runtime.model, options.input);
  const promptHash = hashRequest(runtime.baseUrl, body);
  const cachePath = buildCachePath(options.cacheDir, promptHash);
  const startedAt = process.hrtime.bigint();
  const now = options.now ?? (() => new Date());

  if (cachePath && existsSync(cachePath)) {
    const cachedResult = loadCachedResult(cachePath);
    writeTrace(
      options.tracePath,
      buildTraceRecord({
        now: now(),
        runId: options.runId,
        module: options.module,
        stage: options.stage,
        promptHash,
        model: runtime.model,
        latencyMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        cacheHit: true,
        status: 'ok',
        usage: cachedResult.usage,
      }),
    );
    return cachedResult;
  }

  const maxAttempts = Math.max(options.maxAttempts ?? 3, 1);
  const sleep = options.sleep ?? defaultSleep;
  const retryDelayMs = Math.max(options.retryDelayMs ?? 1_000, 0);
  let lastError: unknown = new CliError('LLM invocation failed without a terminal result.', {
    code: 'LLM_INVOCATION_INCOMPLETE',
    exitCode: 1,
  });

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await requestLlm(url, body, options, runtime.apiKey);
      if (cachePath) {
        writeJsonArtifact(cachePath, {
          output: result.output,
          usage: result.usage,
        });
      }

      writeTrace(
        options.tracePath,
        buildTraceRecord({
          now: now(),
          runId: options.runId,
          module: options.module,
          stage: options.stage,
          promptHash,
          model: runtime.model,
          latencyMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
          cacheHit: false,
          status: 'ok',
          usage: result.usage,
        }),
      );
      return {
        output: result.output,
        usage: result.usage,
        cacheHit: false,
        promptHash,
      };
    } catch (error) {
      lastError = error;
      const retryable = Boolean(
        error instanceof CliError &&
        'retryable' in error &&
        (error as CliError & { retryable?: boolean }).retryable,
      );

      if (attempt < maxAttempts - 1 && (!(error instanceof CliError) || retryable)) {
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }
      break;
    }
  }

  writeTrace(
    options.tracePath,
    buildTraceRecord({
      now: now(),
      runId: options.runId,
      module: options.module,
      stage: options.stage,
      promptHash,
      model: runtime.model,
      latencyMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
      cacheHit: false,
      status: 'error',
      usage: null,
      error: String(lastError),
    }),
  );

  throw lastError;
}
