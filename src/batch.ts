import {
  MAX_NODE_TIMER_DELAY_MS,
  assertBatchContractMatches,
  assertBatchItemContractMatches,
  assertUniqueItemIds,
  batchItemContractsMatch,
  canonicalBatchJson,
  createBatchContract,
  createBatchItemContract,
  isRecord,
  parseBatchContract,
  parseBatchItemContract,
  parseItemIdentity,
  sha256BatchBytes,
  sha256BatchJson,
} from './lib/batch/canonical-contracts.js';
import {
  BatchContractError,
  BatchItemIdentityDriftError,
  BatchItemProjectionDriftError,
  BatchItemResourceDriftError,
  BatchItemResumeContractError,
  BatchMutationReplayError,
  BatchMutationRetryError,
  BatchRunLockIdentityConflictError,
  BatchRunLockTimeoutError,
} from './lib/batch/errors.js';
import { MAX_BATCH_CONCURRENCY } from './lib/batch/types.js';
import { batchRunLockPath, batchRunLockStatePath, withBatchRunLock } from './lib/batch/run-lock.js';
import {
  MinReadyIndexHeap,
  createAsyncLock,
  createEventEmitter,
  defaultBatchSleep,
  failedResult,
  freezeResult,
  inputOrderedResults,
  readClock,
} from './lib/batch/scheduler-runtime.js';
import type { EventEmitter } from './lib/batch/scheduler-runtime.js';
import {
  identityDriftFailure,
  itemIdentityMatches,
  projectBatchItemContract,
  projectExclusiveKey,
  projectionDriftFailure,
  resourceDriftFailure,
  resumeContractFailure,
  validateBatchOptions,
  validateResume,
} from './lib/batch/item-projection.js';

export {
  BatchContractError,
  BatchItemIdentityDriftError,
  BatchItemProjectionDriftError,
  BatchItemResourceDriftError,
  BatchItemResumeContractError,
  BatchMutationReplayError,
  BatchMutationRetryError,
  BatchRunLockIdentityConflictError,
  BatchRunLockTimeoutError,
};
export {
  assertBatchContractMatches,
  assertBatchItemContractMatches,
  canonicalBatchJson,
  createBatchContract,
  createBatchItemContract,
  parseBatchContract,
  parseBatchItemContract,
  sha256BatchBytes,
  sha256BatchJson,
};
export { MAX_BATCH_CONCURRENCY };
export { batchRunLockPath, batchRunLockStatePath, withBatchRunLock };

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
  | 'item_identity_drift'
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
  const resultsByIndex = new Map<number, BatchItemResult<TInput, TOutput>>();
  const completionResults: BatchItemResult<TInput, TOutput>[] = [];
  const claimOrder: string[] = [];
  const pendingIndexes: number[] = [];
  let paused = false;
  let stopped = false;
  let hasInfrastructureFailure = false;
  let firstInfrastructureFailure: unknown;
  const recordInfrastructureFailure = (error: unknown): void => {
    if (!hasInfrastructureFailure) {
      hasInfrastructureFailure = true;
      firstInfrastructureFailure = error;
    }
    stopped = true;
  };
  const schedulerLock = createAsyncLock(recordInfrastructureFailure);

  await emitter.emit('batch_started');

  const recordPreclaimResult = async (
    result: BatchItemResult<TInput, TOutput>,
    eventType:
      | 'item_identity_drift'
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
      if (!itemIdentityMatches(options, item, index, itemContract.item_id)) {
        const result = identityDriftFailure(
          item,
          itemContract,
          exclusiveKey,
          index,
          resumeItem,
          clock,
        );
        await recordPreclaimResult(result, 'item_identity_drift');
        continue;
      }
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
  const unclaimedIndexes = new Set(pendingIndexes);
  type PendingResourceKey = number | string;
  type PendingResourceQueue = { indexes: number[]; cursor: number };
  const resourceKeysByIndex = new Map<number, PendingResourceKey>();
  const resourceQueues = new Map<PendingResourceKey, PendingResourceQueue>();
  for (const index of pendingIndexes) {
    const exclusiveKey = preflightExclusiveKeys[index]!;
    const resourceKey: PendingResourceKey = exclusiveKey ?? index;
    resourceKeysByIndex.set(index, resourceKey);
    const queue = resourceQueues.get(resourceKey) ?? { indexes: [], cursor: 0 };
    queue.indexes.push(index);
    resourceQueues.set(resourceKey, queue);
  }
  const readyIndexes = new MinReadyIndexHeap();
  for (const queue of resourceQueues.values()) readyIndexes.push(queue.indexes[0]!);

  type Claim =
    | {
        kind: 'claimed';
        index: number;
        itemContract: BatchItemContract;
        exclusiveKey: TExclusiveKey | null;
        resourceKey: PendingResourceKey;
        resumeItem: BatchResumeItem<TOutput> | undefined;
      }
    | {
        kind: 'rejected';
        resourceKey: PendingResourceKey;
        result: BatchItemFailedResult<TInput>;
      };

  const claimNext = async (): Promise<Claim | null> =>
    schedulerLock(async () => {
      if (paused || stopped || unclaimedIndexes.size === 0) return null;
      const index = readyIndexes.pop();
      if (index === undefined) return null;
      const resourceKey = resourceKeysByIndex.get(index)!;
      const item = options.items[index]!;
      const itemId = itemIds[index]!;
      const itemContract = preflightItemContracts[index]!;
      const exclusiveKey = preflightExclusiveKeys[index]!;
      if (!itemIdentityMatches(options, item, index, itemId)) {
        unclaimedIndexes.delete(index);
        const result = identityDriftFailure(
          item,
          itemContract,
          exclusiveKey,
          index,
          resumeItems.get(itemId),
          clock,
        );
        await emitter.emit('item_identity_drift', {
          item_id: result.item_id,
          input_index: result.input_index,
          status: result.status,
        });
        return { kind: 'rejected', resourceKey, result };
      }
      const currentItemContract = projectBatchItemContract(options, item, index, itemId);
      const resumeItem = resumeItems.get(itemId);
      if (!batchItemContractsMatch(itemContract, currentItemContract)) {
        unclaimedIndexes.delete(index);
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
        return { kind: 'rejected', resourceKey, result };
      }
      const currentExclusiveKey = projectExclusiveKey(options, item, index, currentItemContract);
      if (exclusiveKey !== currentExclusiveKey) {
        unclaimedIndexes.delete(index);
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
        return { kind: 'rejected', resourceKey, result };
      }
      if (resumeItem && !batchItemContractsMatch(itemContract, resumeItem)) {
        unclaimedIndexes.delete(index);
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
        return { kind: 'rejected', resourceKey, result };
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
        readyIndexes.push(index);
        return null;
      }
      unclaimedIndexes.delete(index);
      claimOrder.push(itemId);
      await emitter.emit('item_claimed', { item_id: itemId, input_index: index });
      if (exclusiveKey !== null) {
        await emitter.emit('item_resource_queued', {
          item_id: itemId,
          input_index: index,
          exclusive_key: exclusiveKey,
        });
        await emitter.emit('item_resource_acquired', {
          item_id: itemId,
          input_index: index,
          exclusive_key: exclusiveKey,
        });
      }
      return { kind: 'claimed', index, itemContract, exclusiveKey, resourceKey, resumeItem };
    });

  const complete = async (
    result: BatchItemResult<TInput, TOutput>,
    exclusiveKey: string | null,
    resourceKey: PendingResourceKey,
  ): Promise<void> =>
    schedulerLock(async () => {
      if (exclusiveKey !== null) {
        await emitter.emit('item_resource_released', {
          item_id: result.item_id,
          input_index: result.input_index,
          exclusive_key: exclusiveKey,
        });
      }
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
      const resourceQueue = resourceQueues.get(resourceKey)!;
      resourceQueue.cursor += 1;
      const nextIndex = resourceQueue.indexes[resourceQueue.cursor];
      if (nextIndex !== undefined && !paused && !stopped) readyIndexes.push(nextIndex);
    });

  const worker = async () => {
    try {
      while (true) {
        const claim = await claimNext();
        if (!claim) return;
        if (claim.kind === 'rejected') {
          await complete(claim.result, null, claim.resourceKey);
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
        const result = await execute();
        await complete(result, claim.exclusiveKey, claim.resourceKey);
      }
    } catch (error) {
      recordInfrastructureFailure(error);
      throw error;
    }
  };

  if (!stopped) {
    const workerCount = Math.min(options.maxConcurrency, pendingIndexes.length);
    await Promise.allSettled(Array.from({ length: workerCount }, worker));
  }
  if (hasInfrastructureFailure) throw firstInfrastructureFailure;

  const status: BatchStatus = paused ? 'paused' : stopped ? 'stopped' : 'completed';
  await emitter.emit('batch_completed', { status });
  await emitter.settled();
  const resultsInputOrder = inputOrderedResults(resultsByIndex);
  const unclaimedItemIds = pendingIndexes
    .filter((index) => unclaimedIndexes.has(index))
    .map((index) => itemIds[index]!);
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
        if (
          !Number.isSafeInteger(requestedDelay) ||
          requestedDelay < 0 ||
          requestedDelay > MAX_NODE_TIMER_DELAY_MS
        ) {
          throw new BatchContractError(
            `Batch retry delay must be a non-negative safe integer no greater than the maximum supported timer delay (${MAX_NODE_TIMER_DELAY_MS} ms).`,
          );
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
