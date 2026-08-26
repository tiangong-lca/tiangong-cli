import { MAX_NODE_TIMER_DELAY_MS } from './canonical-contracts.js';
import { BatchContractError, BatchMutationReplayError } from './errors.js';
import { failedResult, freezeResult, readClock, type EventEmitter } from './scheduler-runtime.js';
import type {
  BatchClock,
  BatchExecutionContext,
  BatchItemContract,
  BatchItemResult,
  BatchJsonValue,
  BatchRecoverySource,
  BatchResumeItem,
  BatchRetryContext,
  BatchSleep,
  RunBoundedBatchOptions,
} from './types.js';

export async function executeClaim<
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
