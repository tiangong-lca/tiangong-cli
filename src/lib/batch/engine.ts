import { executeClaim } from './attempt-recovery.js';
import {
  assertUniqueItemIds,
  batchItemContractsMatch,
  parseBatchContract,
  parseItemIdentity,
} from './canonical-contracts.js';
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
} from './item-projection.js';
import {
  MinReadyIndexHeap,
  createAsyncLock,
  createEventEmitter,
  defaultBatchSleep,
  freezeResult,
  inputOrderedResults,
  readClock,
} from './scheduler-runtime.js';
import type {
  BatchItemContract,
  BatchItemFailedResult,
  BatchItemResult,
  BatchJsonValue,
  BatchResumeItem,
  BatchRunResult,
  BatchStatus,
  RunBoundedBatchOptions,
} from './types.js';

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
