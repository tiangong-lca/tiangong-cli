import { CliError } from './errors.js';
import type { FetchLike } from './http.js';
import {
  fetchOneFlowRow,
  normalizeSupabaseFlowPayload,
  type SupabaseFlowLookup,
} from './flow-read.js';
import { requireSupabaseRestRuntime } from './supabase-rest.js';

type JsonObject = Record<string, unknown>;

const FLOW_GET_TIMEOUT_MS = 10_000;

export type RunFlowGetOptions = {
  flowId: string;
  version?: string | null;
  userId?: string | null;
  stateCode?: number | null;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: Date;
};

export type FlowGetReport = {
  schema_version: 1;
  generated_at_utc: string;
  status: 'resolved_remote_flow';
  flow_id: string;
  requested_version: string | null;
  requested_user_id: string | null;
  requested_state_code: number | null;
  resolved_version: string;
  resolution: SupabaseFlowLookup['resolution'];
  source_url: string;
  modified_at: string | null;
  user_id: string | null;
  state_code: number | null;
  flow: JsonObject;
};

function normalizeToken(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

export async function runFlowGet(options: RunFlowGetOptions): Promise<FlowGetReport> {
  const flowId = normalizeToken(options.flowId);
  if (!flowId) {
    throw new CliError('Missing required --id value.', {
      code: 'FLOW_ID_REQUIRED',
      exitCode: 2,
    });
  }

  const requestedVersion = normalizeToken(options.version ?? null);
  const requestedUserId = normalizeToken(options.userId ?? null);
  const requestedStateCode =
    Number.isInteger(options.stateCode) && (options.stateCode as number) >= 0
      ? (options.stateCode as number)
      : null;

  const runtime = requireSupabaseRestRuntime(options.env ?? process.env);
  const lookup = await fetchOneFlowRow({
    runtime,
    id: flowId,
    version: requestedVersion,
    userId: requestedUserId,
    stateCode: requestedStateCode,
    timeoutMs: options.timeoutMs ?? FLOW_GET_TIMEOUT_MS,
    fetchImpl: options.fetchImpl ?? (fetch as FetchLike),
    fallbackToLatest: requestedVersion !== null,
  });

  if (!lookup) {
    throw new CliError(
      requestedVersion
        ? `Could not resolve flow dataset for ${flowId}@${requestedVersion}.`
        : `Could not resolve flow dataset for ${flowId}.`,
      {
        code: 'FLOW_GET_NOT_FOUND',
        exitCode: 2,
        details: {
          flow_id: flowId,
          version: requestedVersion,
          user_id: requestedUserId,
          state_code: requestedStateCode,
        },
      },
    );
  }

  return {
    schema_version: 1,
    generated_at_utc: nowIso(options.now),
    status: 'resolved_remote_flow',
    flow_id: lookup.row.id || flowId,
    requested_version: requestedVersion,
    requested_user_id: requestedUserId,
    requested_state_code: requestedStateCode,
    resolved_version: lookup.row.version || requestedVersion || '',
    resolution: lookup.resolution,
    source_url: lookup.sourceUrl,
    modified_at: lookup.row.modified_at,
    user_id: lookup.row.user_id,
    state_code: lookup.row.state_code,
    flow: normalizeSupabaseFlowPayload(
      lookup.row.json,
      requestedVersion ? `${flowId}@${requestedVersion}` : flowId,
    ),
  };
}

export const __testInternals = {
  normalizeToken,
};
