import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { StateLockTimeoutError, lockPathForState, withStateFileLock } from './lib/state-lock.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
export const MAX_BATCH_CONCURRENCY = 64 as const;
const DEFAULT_BATCH_RUN_LOCK_TIMEOUT_MS = 300_000;
type ActiveBatchRunLock = {
  scopeDepth: number;
  identitySha256: string;
  receipt: BatchRunLockReceipt;
  drained: Promise<void>;
  drain: () => void;
  released: Promise<void>;
  release: () => void;
};
type BatchRunLockScope = {
  active: boolean;
  owner: ActiveBatchRunLock;
};
const ACTIVE_BATCH_RUN_LOCKS = new Map<string, ActiveBatchRunLock>();
const BATCH_RUN_LOCK_CONTEXT = new AsyncLocalStorage<ReadonlyMap<string, BatchRunLockScope>>();

export type BatchJsonPrimitive = boolean | null | number | string;
export type BatchJsonValue = BatchJsonPrimitive | BatchJsonValue[] | BatchJsonObject;
export type BatchJsonObject = { [key: string]: BatchJsonValue };

export type BatchContract<TIdentity extends BatchJsonValue = BatchJsonValue> = {
  identity: TIdentity;
  content_sha256: string;
  policy_sha256: string;
};

export type BatchItemContract = Readonly<{
  item_id: string;
  content_sha256: string;
  policy_sha256: string;
}>;

export type CreateBatchItemContractOptions = Readonly<{
  item_id: string;
  content: BatchJsonValue;
  policy: BatchJsonValue;
}>;

export type CreateBatchContractOptions<TIdentity extends BatchJsonValue> = {
  identity: TIdentity;
  content: BatchJsonValue;
  policy: BatchJsonValue;
};

export type BatchMode = 'mutation' | 'read';
export type BatchStatus = 'completed' | 'paused' | 'stopped';
export type BatchItemSuccessStatus = 'recovered' | 'succeeded';

export type BatchEventType =
  | 'attempt_failed'
  | 'attempt_started'
  | 'attempt_succeeded'
  | 'batch_completed'
  | 'batch_paused'
  | 'batch_started'
  | 'batch_stopped'
  | 'item_claimed'
  | 'item_completed'
  | 'item_projection_drift'
  | 'item_resource_acquired'
  | 'item_resource_drift'
  | 'item_resource_queued'
  | 'item_resource_released'
  | 'item_resume_rejected'
  | 'item_resumed'
  | 'recovery_failed'
  | 'recovery_started'
  | 'recovery_succeeded'
  | 'retry_scheduled';

export type BatchEvent = Readonly<{
  sequence: number;
  timestamp_ms: number;
  type: BatchEventType;
  item_id?: string;
  input_index?: number;
  attempt?: number;
  delay_ms?: number;
  status?: BatchItemResultStatus | BatchStatus;
  source?: BatchRecoverySource;
  exclusive_key?: string;
}>;

type BatchItemResultCommon<TInput> = Readonly<{
  item: TInput;
  item_id: string;
  item_contract: BatchItemContract;
  exclusive_key: string | null;
  input_index: number;
  attempts: number;
  attempt_consumed: boolean;
  resumed: boolean;
  completed_at_ms: number;
}>;

export type BatchItemSucceededResult<TInput, TOutput> = BatchItemResultCommon<TInput> &
  Readonly<{
    status: BatchItemSuccessStatus;
    value: TOutput;
  }>;

export type BatchItemFailedResult<TInput> = BatchItemResultCommon<TInput> &
  Readonly<{
    status: 'failed';
    error: unknown;
  }>;

export type BatchItemResultStatus = BatchItemSuccessStatus | 'failed';
export type BatchItemResult<TInput, TOutput> =
  | BatchItemFailedResult<TInput>
  | BatchItemSucceededResult<TInput, TOutput>;

export type BatchRunResult<
  TInput,
  TOutput,
  TIdentity extends BatchJsonValue = BatchJsonValue,
> = Readonly<{
  contract: BatchContract<TIdentity>;
  status: BatchStatus;
  claim_order: readonly string[];
  completion_order: readonly string[];
  results_input_order: readonly BatchItemResult<TInput, TOutput>[];
  results_completion_order: readonly BatchItemResult<TInput, TOutput>[];
  unclaimed_item_ids: readonly string[];
  events: readonly BatchEvent[];
}>;

export type BatchExecutionContext<TInput, TExclusiveKey extends string = string> = Readonly<{
  item: TInput;
  item_id: string;
  item_contract: BatchItemContract;
  exclusive_key: TExclusiveKey | null;
  input_index: number;
  attempt: number;
  mode: BatchMode;
}>;

export type BatchRetryContext<
  TInput,
  TExclusiveKey extends string = string,
> = BatchExecutionContext<TInput, TExclusiveKey> &
  Readonly<{
    error: unknown;
  }>;

export type BatchRetryPolicy<TInput, TExclusiveKey extends string = string> = Readonly<{
  maxAttempts: number;
  maxDelayMs: number;
  shouldRetry: (context: BatchRetryContext<TInput, TExclusiveKey>) => boolean | Promise<boolean>;
  delayMs: (context: BatchRetryContext<TInput, TExclusiveKey>) => number | Promise<number>;
}>;

export type BatchRecoverySource = 'execution_error' | 'resume_incomplete';

export type BatchMutationRecoveryContext<TInput, TExclusiveKey extends string = string> = Readonly<{
  item: TInput;
  item_id: string;
  item_contract: BatchItemContract;
  exclusive_key: TExclusiveKey | null;
  input_index: number;
  attempts: number;
  error: unknown;
  source: BatchRecoverySource;
}>;

export type BatchMutationRecoveryResult<TOutput> =
  | Readonly<{ status: 'recovered'; value: TOutput }>
  | Readonly<{ status: 'unresolved'; error?: unknown }>;

export type BatchCompletedResumeItem<TOutput> = BatchItemContract &
  Readonly<{
    state: 'completed';
    outcome: BatchItemSuccessStatus;
    value: TOutput;
    attempts: number;
  }>;

export type BatchAttemptedResumeItem = BatchItemContract &
  Readonly<{
    state: 'attempted';
    attempts: number;
  }>;

export type BatchResumeItem<TOutput> = BatchAttemptedResumeItem | BatchCompletedResumeItem<TOutput>;

export type BatchResumeState<
  TOutput,
  TIdentity extends BatchJsonValue = BatchJsonValue,
> = Readonly<{
  contract: BatchContract<TIdentity>;
  items: readonly BatchResumeItem<TOutput>[];
}>;

export type BatchPauseContext<TInput, TOutput> = Readonly<{
  item: TInput;
  item_id: string;
  item_contract: BatchItemContract;
  exclusive_key: string | null;
  input_index: number;
  claimed_count: number;
  results_input_order: readonly BatchItemResult<TInput, TOutput>[];
}>;

export type BatchStopContext<TInput, TOutput> = Readonly<{
  last_result: BatchItemResult<TInput, TOutput>;
  claimed_count: number;
  results_input_order: readonly BatchItemResult<TInput, TOutput>[];
  results_completion_order: readonly BatchItemResult<TInput, TOutput>[];
}>;

export type BatchClock = Readonly<{ now: () => number }>;
export type BatchSleep = (milliseconds: number) => Promise<void>;

export type BatchRunLockOptions<TIdentity extends BatchJsonValue> = Readonly<{
  runPath: string;
  identity: TIdentity;
  reason: string;
  timeoutMs?: number;
  pollMs?: number;
  sleep?: BatchSleep;
}>;

export type BatchRunLockReceipt = Readonly<{
  run_path: string;
  state_path: string;
  lock_path: string;
  identity_sha256: string;
}>;

export type BatchExclusiveKeyContext<TInput> = Readonly<{
  item: TInput;
  item_id: string;
  item_contract: BatchItemContract;
  input_index: number;
}>;

export type RunBoundedBatchOptions<
  TInput,
  TOutput,
  TIdentity extends BatchJsonValue,
  TExclusiveKey extends string = string,
> = Readonly<{
  contract: BatchContract<TIdentity>;
  items: readonly TInput[];
  getItemIdentity: (item: TInput, inputIndex: number) => string;
  projectItemContent: (item: TInput, inputIndex: number) => BatchJsonValue;
  projectItemPolicy: (item: TInput, inputIndex: number) => BatchJsonValue;
  getExclusiveKey?: (context: BatchExclusiveKeyContext<TInput>) => TExclusiveKey | null | undefined;
  mode: BatchMode;
  maxConcurrency: number;
  execute: (context: BatchExecutionContext<TInput, TExclusiveKey>) => TOutput | Promise<TOutput>;
  retry?: BatchRetryPolicy<TInput, TExclusiveKey>;
  recoverMutation?: (
    context: BatchMutationRecoveryContext<TInput, TExclusiveKey>,
  ) => BatchMutationRecoveryResult<TOutput> | Promise<BatchMutationRecoveryResult<TOutput>>;
  resume?: BatchResumeState<TOutput, TIdentity>;
  shouldPauseBeforeClaim?: (
    context: BatchPauseContext<TInput, TOutput>,
  ) => boolean | Promise<boolean>;
  shouldStop?: (context: BatchStopContext<TInput, TOutput>) => boolean | Promise<boolean>;
  eventSink?: (event: BatchEvent) => void | Promise<void>;
  clock?: BatchClock;
  sleep?: BatchSleep;
}>;

export class BatchContractError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BatchContractError';
  }
}

export class BatchMutationRetryError extends BatchContractError {
  constructor() {
    super('Mutation batches reject automatic retry; use explicit readback recovery instead.');
    this.name = 'BatchMutationRetryError';
  }
}

export class BatchMutationReplayError extends Error {
  constructor(itemId: string) {
    super(
      `Mutation item ${itemId} has a consumed incomplete attempt and cannot be replayed without explicit readback recovery.`,
    );
    this.name = 'BatchMutationReplayError';
  }
}

export class BatchItemResumeContractError extends BatchContractError {
  readonly itemId: string;

  constructor(itemId: string) {
    super(
      `Batch resume item ${itemId} does not match the current item identity, content SHA-256, and policy SHA-256 triple.`,
    );
    this.name = 'BatchItemResumeContractError';
    this.itemId = itemId;
  }
}

export class BatchItemProjectionDriftError extends BatchContractError {
  readonly itemId: string;

  constructor(itemId: string) {
    super(`Batch item ${itemId} content or policy projection drifted before claim.`);
    this.name = 'BatchItemProjectionDriftError';
    this.itemId = itemId;
  }
}

export class BatchItemResourceDriftError extends BatchContractError {
  readonly itemId: string;

  constructor(itemId: string) {
    super(`Batch item ${itemId} exclusive resource key drifted before claim.`);
    this.name = 'BatchItemResourceDriftError';
    this.itemId = itemId;
  }
}

export class BatchRunLockTimeoutError extends Error {
  readonly code = 'BATCH_RUN_LOCK_TIMEOUT' as const;
  readonly runPath: string;
  readonly lockPath: string;
  readonly identitySha256: string;
  readonly waitedMs: number;
  readonly owner: Readonly<Record<string, unknown>> | null;

  constructor(options: {
    runPath: string;
    lockPath: string;
    identitySha256: string;
    waitedMs: number;
    owner: Readonly<Record<string, unknown>> | null;
  }) {
    super(`Timed out after ${options.waitedMs}ms acquiring batch run lock: ${options.lockPath}`);
    this.name = 'BatchRunLockTimeoutError';
    this.runPath = options.runPath;
    this.lockPath = options.lockPath;
    this.identitySha256 = options.identitySha256;
    this.waitedMs = options.waitedMs;
    this.owner = options.owner;
  }
}

export class BatchRunLockIdentityConflictError extends Error {
  readonly code = 'BATCH_RUN_LOCK_IDENTITY_CONFLICT' as const;
  readonly runPath: string;
  readonly activeIdentitySha256: string;
  readonly requestedIdentitySha256: string;

  constructor(options: {
    runPath: string;
    activeIdentitySha256: string;
    requestedIdentitySha256: string;
  }) {
    super(
      `Batch run path is already locked by another identity in this process: ${options.runPath}`,
    );
    this.name = 'BatchRunLockIdentityConflictError';
    this.runPath = options.runPath;
    this.activeIdentitySha256 = options.activeIdentitySha256;
    this.requestedIdentitySha256 = options.requestedIdentitySha256;
  }
}

export function canonicalBatchJson(value: BatchJsonValue): string {
  return JSON.stringify(canonicalizeBatchValue(value, new Set<object>()));
}

export function sha256BatchBytes(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256BatchJson(value: BatchJsonValue): string {
  return sha256BatchBytes(canonicalBatchJson(value));
}

export function batchRunLockStatePath(runPath: string): string {
  return path.join(parseBatchRunPath(runPath), '.tiangong-lca-batch-run.state');
}

export function batchRunLockPath(runPath: string): string {
  return lockPathForState(batchRunLockStatePath(runPath));
}

export async function withBatchRunLock<T, TIdentity extends BatchJsonValue>(
  options: BatchRunLockOptions<TIdentity>,
  task: (receipt: BatchRunLockReceipt) => Promise<T> | T,
): Promise<T> {
  const runPath = parseBatchRunPath(options.runPath);
  const reason = parseBatchRunLockToken(options.reason, 'reason');
  const identitySha256 = sha256BatchJson(options.identity);
  const statePath = batchRunLockStatePath(runPath);
  const lockPath = lockPathForState(statePath);
  const receipt = Object.freeze({
    run_path: runPath,
    state_path: statePath,
    lock_path: lockPath,
    identity_sha256: identitySha256,
  });
  const active = ACTIVE_BATCH_RUN_LOCKS.get(statePath);
  if (active) {
    if (active.identitySha256 !== identitySha256) {
      throw new BatchRunLockIdentityConflictError({
        runPath,
        activeIdentitySha256: active.identitySha256,
        requestedIdentitySha256: identitySha256,
      });
    }
    const parentScope = BATCH_RUN_LOCK_CONTEXT.getStore()?.get(statePath);
    if (parentScope?.active && parentScope.owner === active) {
      return runBatchRunLockScope(statePath, active, task);
    }
    await waitForActiveBatchRunLock(active, options, runPath, lockPath, identitySha256);
    return withBatchRunLock(options, task);
  }

  let physicalOwner: ActiveBatchRunLock | undefined;
  try {
    const result = await withStateFileLock(
      statePath,
      {
        reason: `batch-run:${identitySha256}:${reason}`,
        metadata: {
          batch_identity_sha256: identitySha256,
          batch_run_path: runPath,
        },
        stalePolicy: 'same-host-pid',
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(options.pollMs === undefined ? {} : { pollMs: options.pollMs }),
        ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
      },
      async () => {
        const owner = createActiveBatchRunLock(identitySha256, receipt);
        physicalOwner = owner;
        ACTIVE_BATCH_RUN_LOCKS.set(statePath, owner);
        try {
          return await runBatchRunLockScope(statePath, owner, task);
        } finally {
          await owner.drained;
        }
      },
    );
    return result;
  } catch (error) {
    if (!(error instanceof StateLockTimeoutError)) throw error;
    const details = error.details as {
      waitedMs: number;
      owner: Record<string, unknown> | null;
    };
    throw new BatchRunLockTimeoutError({
      runPath,
      lockPath,
      identitySha256,
      waitedMs: details.waitedMs,
      owner: details.owner ? Object.freeze({ ...details.owner }) : null,
    });
  } finally {
    if (physicalOwner) {
      ACTIVE_BATCH_RUN_LOCKS.delete(statePath);
      physicalOwner.release();
    }
  }
}

export function createBatchContract<TIdentity extends BatchJsonValue>(
  options: CreateBatchContractOptions<TIdentity>,
): BatchContract<TIdentity> {
  const identity = freezeBatchJson(
    canonicalizeBatchValue(options.identity, new Set<object>()),
  ) as TIdentity;
  return Object.freeze({
    identity,
    content_sha256: sha256BatchJson(options.content),
    policy_sha256: sha256BatchJson(options.policy),
  });
}

export function createBatchItemContract(
  options: CreateBatchItemContractOptions,
): BatchItemContract {
  const itemId = parseItemIdentity(options.item_id, 'contract');
  return Object.freeze({
    item_id: itemId,
    content_sha256: sha256BatchJson(options.content),
    policy_sha256: sha256BatchJson(options.policy),
  });
}

export function parseBatchItemContract(value: unknown): BatchItemContract {
  if (
    !isRecord(value) ||
    typeof value.item_id !== 'string' ||
    typeof value.content_sha256 !== 'string' ||
    !SHA256_PATTERN.test(value.content_sha256) ||
    typeof value.policy_sha256 !== 'string' ||
    !SHA256_PATTERN.test(value.policy_sha256)
  ) {
    throw new BatchContractError(
      'Batch item contract requires item_id plus valid content and policy SHA-256 values.',
    );
  }
  return Object.freeze({
    item_id: parseItemIdentity(value.item_id, 'contract'),
    content_sha256: value.content_sha256,
    policy_sha256: value.policy_sha256,
  });
}

export function assertBatchItemContractMatches(
  expectedValue: unknown,
  actualValue: unknown,
): BatchItemContract {
  const expected = parseBatchItemContract(expectedValue);
  const actual = parseBatchItemContract(actualValue);
  if (!batchItemContractsMatch(expected, actual)) {
    throw new BatchItemResumeContractError(expected.item_id);
  }
  return actual;
}

export function parseBatchContract<TIdentity extends BatchJsonValue = BatchJsonValue>(
  value: unknown,
): BatchContract<TIdentity> {
  if (!isRecord(value) || !hasExactKeys(value, ['content_sha256', 'identity', 'policy_sha256'])) {
    throw new BatchContractError(
      'Batch contract must contain exact identity, content_sha256, and policy_sha256 keys.',
    );
  }
  let identity: TIdentity;
  try {
    identity = freezeBatchJson(
      canonicalizeBatchValue(value.identity, new Set<object>()),
    ) as TIdentity;
  } catch (error) {
    throw new BatchContractError('Batch contract identity must be canonical JSON data.', {
      cause: error,
    });
  }
  if (
    typeof value.content_sha256 !== 'string' ||
    !SHA256_PATTERN.test(value.content_sha256) ||
    typeof value.policy_sha256 !== 'string' ||
    !SHA256_PATTERN.test(value.policy_sha256)
  ) {
    throw new BatchContractError('Batch contract content and policy SHA-256 values are malformed.');
  }
  return Object.freeze({
    identity,
    content_sha256: value.content_sha256,
    policy_sha256: value.policy_sha256,
  });
}

export function assertBatchContractMatches<TIdentity extends BatchJsonValue>(
  expectedValue: unknown,
  actualValue: unknown,
): BatchContract<TIdentity> {
  const expected = parseBatchContract<TIdentity>(expectedValue);
  const actual = parseBatchContract<TIdentity>(actualValue);
  if (
    canonicalBatchJson(expected.identity) !== canonicalBatchJson(actual.identity) ||
    expected.content_sha256 !== actual.content_sha256 ||
    expected.policy_sha256 !== actual.policy_sha256
  ) {
    throw new BatchContractError(
      'Batch resume requires an exact identity, content SHA-256, and policy SHA-256 match.',
    );
  }
  return actual;
}

export async function runBoundedBatch<
  TInput,
  TOutput,
  TIdentity extends BatchJsonValue,
  TExclusiveKey extends string = string,
>(
  options: RunBoundedBatchOptions<TInput, TOutput, TIdentity, TExclusiveKey>,
): Promise<BatchRunResult<TInput, TOutput, TIdentity>> {
  const contract = parseBatchContract<TIdentity>(options.contract);
  validateBatchOptions(options);
  const itemIds = options.items.map((item, index) =>
    parseItemIdentity(options.getItemIdentity(item, index), index),
  );
  assertUniqueItemIds(itemIds);
  const preflightItemContracts = options.items.map((item, index) =>
    projectBatchItemContract(options, item, index, itemIds[index]!),
  );
  const preflightExclusiveKeys = options.items.map((item, index) =>
    projectExclusiveKey(options, item, index, preflightItemContracts[index]!),
  );
  const resumeItems = validateResume(options.resume, contract, itemIds);
  const clock = options.clock ?? { now: Date.now };
  const sleep = options.sleep ?? defaultBatchSleep;
  const emitter = createEventEmitter(clock, options.eventSink);
  const exclusiveCoordinator = createExclusiveCoordinator(emitter);
  const schedulerLock = createAsyncLock();
  const resultsByIndex = new Map<number, BatchItemResult<TInput, TOutput>>();
  const completionResults: BatchItemResult<TInput, TOutput>[] = [];
  const claimOrder: string[] = [];
  const pendingIndexes: number[] = [];
  let pendingCursor = 0;
  let paused = false;
  let stopped = false;

  await emitter.emit('batch_started');

  const recordPreclaimResult = async (
    result: BatchItemResult<TInput, TOutput>,
    eventType:
      | 'item_projection_drift'
      | 'item_resource_drift'
      | 'item_resume_rejected'
      | 'item_resumed',
  ): Promise<void> => {
    resultsByIndex.set(result.input_index, result);
    completionResults.push(result);
    await emitter.emit(eventType, {
      item_id: result.item_id,
      input_index: result.input_index,
      status: result.status,
    });
    if (
      !stopped &&
      (await shouldStopAfter(options, result, claimOrder, resultsByIndex, completionResults))
    ) {
      stopped = true;
      await emitter.emit('batch_stopped', {
        item_id: result.item_id,
        input_index: result.input_index,
        status: 'stopped',
      });
    }
  };

  for (const [index, item] of options.items.entries()) {
    const resumeItem = resumeItems.get(itemIds[index]!);
    if (resumeItem?.state === 'completed') {
      const itemContract = preflightItemContracts[index]!;
      const exclusiveKey = preflightExclusiveKeys[index]!;
      const currentItemContract = projectBatchItemContract(options, item, index, itemIds[index]!);
      if (!batchItemContractsMatch(itemContract, currentItemContract)) {
        const result = projectionDriftFailure(
          item,
          itemContract,
          exclusiveKey,
          index,
          resumeItem,
          clock,
        );
        await recordPreclaimResult(result, 'item_projection_drift');
        continue;
      }
      const currentExclusiveKey = projectExclusiveKey(options, item, index, currentItemContract);
      if (exclusiveKey !== currentExclusiveKey) {
        const result = resourceDriftFailure(
          item,
          itemContract,
          exclusiveKey,
          index,
          resumeItem,
          clock,
        );
        await recordPreclaimResult(result, 'item_resource_drift');
        continue;
      }
      if (!batchItemContractsMatch(itemContract, resumeItem)) {
        const result = resumeContractFailure(
          item,
          itemContract,
          exclusiveKey,
          index,
          resumeItem.attempts,
          clock,
        );
        await recordPreclaimResult(result, 'item_resume_rejected');
        continue;
      }
      const resumedResult = freezeResult({
        item,
        item_id: itemContract.item_id,
        item_contract: itemContract,
        exclusive_key: exclusiveKey,
        input_index: index,
        attempts: resumeItem.attempts,
        attempt_consumed: true,
        resumed: true,
        completed_at_ms: readClock(clock),
        status: resumeItem.outcome,
        value: resumeItem.value,
      });
      await recordPreclaimResult(resumedResult, 'item_resumed');
    } else {
      pendingIndexes.push(index);
    }
  }

  type Claim =
    | {
        kind: 'claimed';
        index: number;
        itemContract: BatchItemContract;
        exclusiveKey: TExclusiveKey | null;
        resumeItem: BatchResumeItem<TOutput> | undefined;
      }
    | { kind: 'rejected'; result: BatchItemFailedResult<TInput> };

  const claimNext = async (): Promise<Claim | null> =>
    schedulerLock(async () => {
      if (paused || stopped || pendingCursor >= pendingIndexes.length) return null;
      const index = pendingIndexes[pendingCursor]!;
      const item = options.items[index]!;
      const itemId = itemIds[index]!;
      const itemContract = preflightItemContracts[index]!;
      const exclusiveKey = preflightExclusiveKeys[index]!;
      const currentItemContract = projectBatchItemContract(options, item, index, itemId);
      const resumeItem = resumeItems.get(itemId);
      if (!batchItemContractsMatch(itemContract, currentItemContract)) {
        pendingCursor += 1;
        const result = projectionDriftFailure(
          item,
          itemContract,
          exclusiveKey,
          index,
          resumeItem,
          clock,
        );
        await emitter.emit('item_projection_drift', {
          item_id: result.item_id,
          input_index: result.input_index,
          status: result.status,
        });
        return { kind: 'rejected', result };
      }
      const currentExclusiveKey = projectExclusiveKey(options, item, index, currentItemContract);
      if (exclusiveKey !== currentExclusiveKey) {
        pendingCursor += 1;
        const result = resourceDriftFailure(
          item,
          itemContract,
          exclusiveKey,
          index,
          resumeItem,
          clock,
        );
        await emitter.emit('item_resource_drift', {
          item_id: result.item_id,
          input_index: result.input_index,
          status: result.status,
        });
        return { kind: 'rejected', result };
      }
      if (resumeItem && !batchItemContractsMatch(itemContract, resumeItem)) {
        pendingCursor += 1;
        const result = resumeContractFailure(
          item,
          itemContract,
          exclusiveKey,
          index,
          resumeItem.attempts,
          clock,
        );
        await emitter.emit('item_resume_rejected', {
          item_id: result.item_id,
          input_index: result.input_index,
          status: result.status,
        });
        return { kind: 'rejected', result };
      }
      if (
        options.shouldPauseBeforeClaim &&
        (await options.shouldPauseBeforeClaim({
          item,
          item_id: itemId,
          item_contract: itemContract,
          exclusive_key: exclusiveKey,
          input_index: index,
          claimed_count: claimOrder.length,
          results_input_order: inputOrderedResults(resultsByIndex),
        }))
      ) {
        paused = true;
        await emitter.emit('batch_paused', {
          item_id: itemId,
          input_index: index,
          status: 'paused',
        });
        return null;
      }
      pendingCursor += 1;
      claimOrder.push(itemId);
      await emitter.emit('item_claimed', { item_id: itemId, input_index: index });
      return { kind: 'claimed', index, itemContract, exclusiveKey, resumeItem };
    });

  const complete = async (result: BatchItemResult<TInput, TOutput>): Promise<void> =>
    schedulerLock(async () => {
      resultsByIndex.set(result.input_index, result);
      completionResults.push(result);
      await emitter.emit('item_completed', {
        item_id: result.item_id,
        input_index: result.input_index,
        status: result.status,
      });
      if (
        !stopped &&
        (await shouldStopAfter(options, result, claimOrder, resultsByIndex, completionResults))
      ) {
        stopped = true;
        await emitter.emit('batch_stopped', {
          item_id: result.item_id,
          input_index: result.input_index,
          status: 'stopped',
        });
      }
    });

  const worker = async () => {
    while (true) {
      const claim = await claimNext();
      if (!claim) return;
      if (claim.kind === 'rejected') {
        await complete(claim.result);
        continue;
      }
      const execute = () =>
        executeClaim({
          options,
          index: claim.index,
          itemContract: claim.itemContract,
          exclusiveKey: claim.exclusiveKey,
          resumeItem: claim.resumeItem,
          clock,
          sleep,
          emitter,
        });
      const result =
        claim.exclusiveKey === null
          ? await execute()
          : await exclusiveCoordinator.run(
              claim.exclusiveKey,
              claim.itemContract.item_id,
              claim.index,
              execute,
            );
      await complete(result);
    }
  };

  if (!stopped) {
    const workerCount = Math.min(options.maxConcurrency, pendingIndexes.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
  }

  const status: BatchStatus = paused ? 'paused' : stopped ? 'stopped' : 'completed';
  await emitter.emit('batch_completed', { status });
  await emitter.settled();
  const resultsInputOrder = inputOrderedResults(resultsByIndex);
  const unclaimedItemIds = pendingIndexes.slice(pendingCursor).map((index) => itemIds[index]!);
  return Object.freeze({
    contract,
    status,
    claim_order: Object.freeze([...claimOrder]),
    completion_order: Object.freeze(completionResults.map((result) => result.item_id)),
    results_input_order: Object.freeze(resultsInputOrder),
    results_completion_order: Object.freeze([...completionResults]),
    unclaimed_item_ids: Object.freeze(unclaimedItemIds),
    events: Object.freeze([...emitter.events]),
  });
}

function canonicalizeBatchValue(value: unknown, ancestors: Set<object>): BatchJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new BatchContractError('Canonical batch JSON rejects non-finite numbers.');
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new BatchContractError('Canonical batch JSON accepts JSON data only.');
  }
  if (ancestors.has(value)) {
    throw new BatchContractError('Canonical batch JSON rejects cyclic data.');
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => canonicalizeBatchValue(entry, ancestors));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new BatchContractError('Canonical batch JSON accepts plain objects only.');
    }
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonicalizeBatchValue((value as Record<string, unknown>)[key], ancestors),
        ]),
    );
  } finally {
    ancestors.delete(value);
  }
}

function freezeBatchJson<T extends BatchJsonValue>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeBatchJson(child);
    Object.freeze(value);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBatchRunPath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || /[\0\r\n]/u.test(value)) {
    throw new BatchContractError('Batch runPath must be a non-empty single-line path.');
  }
  return path.resolve(value);
}

function parseBatchRunLockToken(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || /[\0\r\n]/u.test(value)) {
    throw new BatchContractError(`Batch run-lock ${label} must be a non-empty single-line string.`);
  }
  return value;
}

function createActiveBatchRunLock(
  identitySha256: string,
  receipt: BatchRunLockReceipt,
): ActiveBatchRunLock {
  let drain: () => void = () => undefined;
  const drained = new Promise<void>((resolve) => {
    drain = resolve;
  });
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    scopeDepth: 0,
    identitySha256,
    receipt,
    drained,
    drain,
    released,
    release,
  };
}

async function runBatchRunLockScope<T>(
  statePath: string,
  owner: ActiveBatchRunLock,
  task: (receipt: BatchRunLockReceipt) => Promise<T> | T,
): Promise<T> {
  const scope: BatchRunLockScope = { active: true, owner };
  owner.scopeDepth += 1;
  const context = new Map(BATCH_RUN_LOCK_CONTEXT.getStore() ?? []);
  context.set(statePath, scope);
  try {
    return await BATCH_RUN_LOCK_CONTEXT.run(context, () => task(owner.receipt));
  } finally {
    scope.active = false;
    owner.scopeDepth -= 1;
    if (owner.scopeDepth === 0) owner.drain();
  }
}

async function waitForActiveBatchRunLock<TIdentity extends BatchJsonValue>(
  active: {
    released: Promise<void>;
  },
  options: BatchRunLockOptions<TIdentity>,
  runPath: string,
  lockPath: string,
  identitySha256: string,
): Promise<void> {
  const timeoutMs = Math.max(options.timeoutMs ?? DEFAULT_BATCH_RUN_LOCK_TIMEOUT_MS, 0);
  if (timeoutMs === 0) {
    throw new BatchRunLockTimeoutError({
      runPath,
      lockPath,
      identitySha256,
      waitedMs: 0,
      owner: null,
    });
  }
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      active.released,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new BatchRunLockTimeoutError({
                runPath,
                lockPath,
                identitySha256,
                waitedMs: Date.now() - startedAt,
                owner: null,
              }),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validateBatchOptions<
  TInput,
  TOutput,
  TIdentity extends BatchJsonValue,
  TExclusiveKey extends string,
>(options: RunBoundedBatchOptions<TInput, TOutput, TIdentity, TExclusiveKey>): void {
  if (
    !Number.isSafeInteger(options.maxConcurrency) ||
    options.maxConcurrency < 1 ||
    options.maxConcurrency > MAX_BATCH_CONCURRENCY
  ) {
    throw new BatchContractError(
      `Batch maxConcurrency must be a safe integer from 1 to ${MAX_BATCH_CONCURRENCY}.`,
    );
  }
  if (options.mode !== 'read' && options.mode !== 'mutation') {
    throw new BatchContractError('Batch mode must be read or mutation.');
  }
  if (options.mode === 'mutation' && options.retry) {
    throw new BatchMutationRetryError();
  }
  if (
    options.retry &&
    (!Number.isSafeInteger(options.retry.maxAttempts) ||
      options.retry.maxAttempts < 1 ||
      !Number.isSafeInteger(options.retry.maxDelayMs) ||
      options.retry.maxDelayMs < 0)
  ) {
    throw new BatchContractError(
      'Batch retry maxAttempts must be positive and maxDelayMs must be a non-negative safe integer.',
    );
  }
}

function parseItemIdentity(value: unknown, location: number | 'contract'): string {
  if (typeof value !== 'string' || value.length === 0 || /[\0\r\n]/u.test(value)) {
    throw new BatchContractError(
      location === 'contract'
        ? 'Batch item contract identity must be a non-empty single-line string.'
        : `Batch item identity at input index ${location} must be a non-empty single-line string.`,
    );
  }
  return value;
}

function assertUniqueItemIds(itemIds: readonly string[]): void {
  if (new Set(itemIds).size !== itemIds.length) {
    throw new BatchContractError('Batch item identities must be unique.');
  }
}

function validateResume<TOutput, TIdentity extends BatchJsonValue>(
  resume: BatchResumeState<TOutput, TIdentity> | undefined,
  contract: BatchContract<TIdentity>,
  itemIds: readonly string[],
): Map<string, BatchResumeItem<TOutput>> {
  const result = new Map<string, BatchResumeItem<TOutput>>();
  if (!resume) return result;
  assertBatchContractMatches<TIdentity>(contract, resume.contract);
  const currentIds = new Set(itemIds);
  for (const item of resume.items) {
    let itemContract: BatchItemContract;
    try {
      itemContract = parseBatchItemContract(item);
    } catch (error) {
      throw new BatchContractError('Batch resume contains an invalid item contract.', {
        cause: error,
      });
    }
    if (
      !isRecord(item) ||
      !currentIds.has(itemContract.item_id) ||
      !Number.isSafeInteger(item.attempts) ||
      Number(item.attempts) < 1 ||
      !['attempted', 'completed'].includes(String(item.state))
    ) {
      throw new BatchContractError('Batch resume contains an invalid or foreign item.');
    }
    if (result.has(itemContract.item_id)) {
      throw new BatchContractError('Batch resume item identities must be unique.');
    }
    if (item.state === 'completed') {
      if (!['succeeded', 'recovered'].includes(String(item.outcome))) {
        throw new BatchContractError('Completed batch resume items require a successful outcome.');
      }
      result.set(
        itemContract.item_id,
        Object.freeze({
          ...itemContract,
          state: 'completed',
          outcome: item.outcome,
          value: item.value,
          attempts: Number(item.attempts),
        }),
      );
    } else {
      result.set(
        itemContract.item_id,
        Object.freeze({
          ...itemContract,
          state: 'attempted',
          attempts: Number(item.attempts),
        }),
      );
    }
  }
  return result;
}

function batchItemContractsMatch(left: BatchItemContract, right: BatchItemContract): boolean {
  return (
    left.item_id === right.item_id &&
    left.content_sha256 === right.content_sha256 &&
    left.policy_sha256 === right.policy_sha256
  );
}

function projectBatchItemContract<
  TInput,
  TOutput,
  TIdentity extends BatchJsonValue,
  TExclusiveKey extends string,
>(
  options: RunBoundedBatchOptions<TInput, TOutput, TIdentity, TExclusiveKey>,
  item: TInput,
  index: number,
  itemId: string,
): BatchItemContract {
  return createBatchItemContract({
    item_id: itemId,
    content: options.projectItemContent(item, index),
    policy: options.projectItemPolicy(item, index),
  });
}

function projectExclusiveKey<
  TInput,
  TOutput,
  TIdentity extends BatchJsonValue,
  TExclusiveKey extends string,
>(
  options: RunBoundedBatchOptions<TInput, TOutput, TIdentity, TExclusiveKey>,
  item: TInput,
  index: number,
  itemContract: BatchItemContract,
): TExclusiveKey | null {
  if (!options.getExclusiveKey) return null;
  const value = options.getExclusiveKey({
    item,
    item_id: itemContract.item_id,
    item_contract: itemContract,
    input_index: index,
  });
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length === 0 || /[\0\r\n]/u.test(value)) {
    throw new BatchContractError(
      'Batch exclusive resource keys must be non-empty single-line strings.',
    );
  }
  return value;
}

function projectionDriftFailure<TInput, TOutput>(
  item: TInput,
  itemContract: BatchItemContract,
  exclusiveKey: string | null,
  index: number,
  resumeItem: BatchResumeItem<TOutput> | undefined,
  clock: BatchClock,
): BatchItemFailedResult<TInput> {
  return failedResult(
    item,
    itemContract,
    index,
    resumeItem?.attempts ?? 0,
    resumeItem !== undefined,
    resumeItem !== undefined,
    clock,
    new BatchItemProjectionDriftError(itemContract.item_id),
    exclusiveKey,
  );
}

function resourceDriftFailure<TInput, TOutput>(
  item: TInput,
  itemContract: BatchItemContract,
  exclusiveKey: string | null,
  index: number,
  resumeItem: BatchResumeItem<TOutput> | undefined,
  clock: BatchClock,
): BatchItemFailedResult<TInput> {
  return failedResult(
    item,
    itemContract,
    index,
    resumeItem?.attempts ?? 0,
    resumeItem !== undefined,
    resumeItem !== undefined,
    clock,
    new BatchItemResourceDriftError(itemContract.item_id),
    exclusiveKey,
  );
}

function resumeContractFailure<TInput>(
  item: TInput,
  itemContract: BatchItemContract,
  exclusiveKey: string | null,
  index: number,
  attempts: number,
  clock: BatchClock,
): BatchItemFailedResult<TInput> {
  return failedResult(
    item,
    itemContract,
    index,
    attempts,
    true,
    true,
    clock,
    new BatchItemResumeContractError(itemContract.item_id),
    exclusiveKey,
  );
}

type EventEmitter = ReturnType<typeof createEventEmitter>;

function createEventEmitter(
  clock: BatchClock,
  sink: ((event: BatchEvent) => void | Promise<void>) | undefined,
) {
  const events: BatchEvent[] = [];
  let sequence = 0;
  let lastTimestamp = Number.NEGATIVE_INFINITY;
  let tail = Promise.resolve();
  return {
    events,
    emit: async (
      type: BatchEventType,
      details: Omit<BatchEvent, 'sequence' | 'timestamp_ms' | 'type'> = {},
    ) => {
      const timestamp = Math.max(lastTimestamp, readClock(clock));
      lastTimestamp = timestamp;
      const event = Object.freeze({
        sequence: (sequence += 1),
        timestamp_ms: timestamp,
        type,
        ...details,
      }) as BatchEvent;
      events.push(event);
      const delivery = tail.then(() => sink?.(event));
      tail = delivery.then(
        () => undefined,
        () => undefined,
      );
      await delivery;
    },
    settled: () => tail,
  };
}

function createExclusiveCoordinator(emitter: EventEmitter) {
  const tails = new Map<string, Promise<void>>();
  return {
    run: async <T>(
      exclusiveKey: string,
      itemId: string,
      inputIndex: number,
      task: () => Promise<T>,
    ): Promise<T> => {
      await emitter.emit('item_resource_queued', {
        item_id: itemId,
        input_index: inputIndex,
        exclusive_key: exclusiveKey,
      });
      const previous = tails.get(exclusiveKey) ?? Promise.resolve();
      let release: () => void = () => undefined;
      const turn = new Promise<void>((resolve) => {
        release = resolve;
      });
      tails.set(exclusiveKey, turn);
      await previous;
      try {
        await emitter.emit('item_resource_acquired', {
          item_id: itemId,
          input_index: inputIndex,
          exclusive_key: exclusiveKey,
        });
        return await task();
      } finally {
        try {
          await emitter.emit('item_resource_released', {
            item_id: itemId,
            input_index: inputIndex,
            exclusive_key: exclusiveKey,
          });
        } finally {
          release();
          if (tails.get(exclusiveKey) === turn) tails.delete(exclusiveKey);
        }
      }
    },
  };
}

function readClock(clock: BatchClock): number {
  const value = clock.now();
  if (!Number.isFinite(value)) {
    throw new BatchContractError('Batch clock must return a finite millisecond value.');
  }
  return value;
}

function createAsyncLock() {
  let tail = Promise.resolve();
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = tail;
    let release: () => void = () => undefined;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };
}

function inputOrderedResults<TInput, TOutput>(
  results: Map<number, BatchItemResult<TInput, TOutput>>,
): BatchItemResult<TInput, TOutput>[] {
  return [...results.entries()].sort(([left], [right]) => left - right).map(([, result]) => result);
}

async function shouldStopAfter<
  TInput,
  TOutput,
  TIdentity extends BatchJsonValue,
  TExclusiveKey extends string,
>(
  options: RunBoundedBatchOptions<TInput, TOutput, TIdentity, TExclusiveKey>,
  lastResult: BatchItemResult<TInput, TOutput>,
  claimOrder: readonly string[],
  resultsByIndex: Map<number, BatchItemResult<TInput, TOutput>>,
  completionResults: readonly BatchItemResult<TInput, TOutput>[],
): Promise<boolean> {
  if (!options.shouldStop) return false;
  return options.shouldStop({
    last_result: lastResult,
    claimed_count: claimOrder.length,
    results_input_order: inputOrderedResults(resultsByIndex),
    results_completion_order: [...completionResults],
  });
}

async function executeClaim<
  TInput,
  TOutput,
  TIdentity extends BatchJsonValue,
  TExclusiveKey extends string,
>(input: {
  options: RunBoundedBatchOptions<TInput, TOutput, TIdentity, TExclusiveKey>;
  index: number;
  itemContract: BatchItemContract;
  exclusiveKey: TExclusiveKey | null;
  resumeItem: BatchResumeItem<TOutput> | undefined;
  clock: BatchClock;
  sleep: BatchSleep;
  emitter: EventEmitter;
}): Promise<BatchItemResult<TInput, TOutput>> {
  const { options, index, itemContract, exclusiveKey, resumeItem, clock, sleep, emitter } = input;
  const itemId = itemContract.item_id;
  const item = options.items[index]!;
  const resumed = resumeItem?.state === 'attempted';
  const baseAttempts = resumed ? resumeItem.attempts : 0;
  if (resumed && options.mode === 'mutation') {
    const error = new BatchMutationReplayError(itemId);
    if (!options.recoverMutation) {
      return failedResult(
        item,
        itemContract,
        index,
        baseAttempts,
        true,
        true,
        clock,
        error,
        exclusiveKey,
      );
    }
    return recoverMutation({
      options,
      item,
      itemContract,
      exclusiveKey,
      index,
      attempts: baseAttempts,
      error,
      source: 'resume_incomplete',
      resumed: true,
      clock,
      emitter,
    });
  }

  const maxAttempts = options.retry?.maxAttempts ?? 1;
  for (let invocationAttempt = 1; ; invocationAttempt += 1) {
    const attempt = baseAttempts + invocationAttempt;
    const context: BatchExecutionContext<TInput, TExclusiveKey> = {
      item,
      item_id: itemId,
      item_contract: itemContract,
      exclusive_key: exclusiveKey,
      input_index: index,
      attempt,
      mode: options.mode,
    };
    await emitter.emit('attempt_started', { item_id: itemId, input_index: index, attempt });
    try {
      const value = await options.execute(context);
      await emitter.emit('attempt_succeeded', { item_id: itemId, input_index: index, attempt });
      return freezeResult({
        item,
        item_id: itemId,
        item_contract: itemContract,
        exclusive_key: exclusiveKey,
        input_index: index,
        attempts: attempt,
        attempt_consumed: true,
        resumed,
        completed_at_ms: readClock(clock),
        status: 'succeeded',
        value,
      });
    } catch (error) {
      await emitter.emit('attempt_failed', { item_id: itemId, input_index: index, attempt });
      if (options.mode === 'mutation') {
        if (!options.recoverMutation) {
          return failedResult(
            item,
            itemContract,
            index,
            attempt,
            true,
            resumed,
            clock,
            error,
            exclusiveKey,
          );
        }
        return recoverMutation({
          options,
          item,
          itemContract,
          exclusiveKey,
          index,
          attempts: attempt,
          error,
          source: 'execution_error',
          resumed,
          clock,
          emitter,
        });
      }
      if (!options.retry || invocationAttempt >= maxAttempts) {
        return failedResult(
          item,
          itemContract,
          index,
          attempt,
          true,
          resumed,
          clock,
          error,
          exclusiveKey,
        );
      }
      const retryContext: BatchRetryContext<TInput, TExclusiveKey> = { ...context, error };
      let retry = false;
      try {
        retry = await options.retry.shouldRetry(retryContext);
      } catch (classificationError) {
        return failedResult(
          item,
          itemContract,
          index,
          attempt,
          true,
          resumed,
          clock,
          classificationError,
          exclusiveKey,
        );
      }
      if (!retry) {
        return failedResult(
          item,
          itemContract,
          index,
          attempt,
          true,
          resumed,
          clock,
          error,
          exclusiveKey,
        );
      }
      let requestedDelay: number;
      try {
        requestedDelay = await options.retry.delayMs(retryContext);
        if (!Number.isSafeInteger(requestedDelay) || requestedDelay < 0) {
          throw new BatchContractError('Batch retry delay must be a non-negative safe integer.');
        }
      } catch (delayError) {
        return failedResult(
          item,
          itemContract,
          index,
          attempt,
          true,
          resumed,
          clock,
          delayError,
          exclusiveKey,
        );
      }
      const delay = Math.min(requestedDelay, options.retry.maxDelayMs);
      await emitter.emit('retry_scheduled', {
        item_id: itemId,
        input_index: index,
        attempt,
        delay_ms: delay,
      });
      try {
        await sleep(delay);
      } catch (sleepError) {
        return failedResult(
          item,
          itemContract,
          index,
          attempt,
          true,
          resumed,
          clock,
          sleepError,
          exclusiveKey,
        );
      }
    }
  }
}

async function recoverMutation<
  TInput,
  TOutput,
  TIdentity extends BatchJsonValue,
  TExclusiveKey extends string,
>(input: {
  options: RunBoundedBatchOptions<TInput, TOutput, TIdentity, TExclusiveKey>;
  item: TInput;
  itemContract: BatchItemContract;
  exclusiveKey: TExclusiveKey | null;
  index: number;
  attempts: number;
  error: unknown;
  source: BatchRecoverySource;
  resumed: boolean;
  clock: BatchClock;
  emitter: EventEmitter;
}): Promise<BatchItemResult<TInput, TOutput>> {
  const {
    options,
    item,
    itemContract,
    exclusiveKey,
    index,
    attempts,
    error,
    source,
    resumed,
    clock,
    emitter,
  } = input;
  const itemId = itemContract.item_id;
  await emitter.emit('recovery_started', {
    item_id: itemId,
    input_index: index,
    attempt: attempts,
    source,
  });
  try {
    const recovery = await options.recoverMutation!({
      item,
      item_id: itemId,
      item_contract: itemContract,
      exclusive_key: exclusiveKey,
      input_index: index,
      attempts,
      error,
      source,
    });
    if (recovery.status === 'recovered') {
      await emitter.emit('recovery_succeeded', {
        item_id: itemId,
        input_index: index,
        attempt: attempts,
        source,
      });
      return freezeResult({
        item,
        item_id: itemId,
        item_contract: itemContract,
        exclusive_key: exclusiveKey,
        input_index: index,
        attempts,
        attempt_consumed: true,
        resumed,
        completed_at_ms: readClock(clock),
        status: 'recovered',
        value: recovery.value,
      });
    }
    if (recovery.status !== 'unresolved') {
      throw new BatchContractError('Mutation recovery returned an unsupported status.');
    }
    await emitter.emit('recovery_failed', {
      item_id: itemId,
      input_index: index,
      attempt: attempts,
      source,
    });
    return failedResult(
      item,
      itemContract,
      index,
      attempts,
      true,
      resumed,
      clock,
      recovery.error ?? error,
      exclusiveKey,
    );
  } catch (recoveryError) {
    await emitter.emit('recovery_failed', {
      item_id: itemId,
      input_index: index,
      attempt: attempts,
      source,
    });
    return failedResult(
      item,
      itemContract,
      index,
      attempts,
      true,
      resumed,
      clock,
      recoveryError,
      exclusiveKey,
    );
  }
}

function failedResult<TInput>(
  item: TInput,
  itemContract: BatchItemContract,
  inputIndex: number,
  attempts: number,
  attemptConsumed: boolean,
  resumed: boolean,
  clock: BatchClock,
  error: unknown,
  exclusiveKey: string | null = null,
): BatchItemFailedResult<TInput> {
  return freezeResult({
    item,
    item_id: itemContract.item_id,
    item_contract: itemContract,
    exclusive_key: exclusiveKey,
    input_index: inputIndex,
    attempts,
    attempt_consumed: attemptConsumed,
    resumed,
    completed_at_ms: readClock(clock),
    status: 'failed',
    error,
  });
}

function freezeResult<T extends BatchItemResult<unknown, unknown>>(value: T): T {
  return Object.freeze(value);
}

function defaultBatchSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
