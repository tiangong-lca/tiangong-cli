import {
  MAX_NODE_TIMER_DELAY_MS,
  assertBatchContractMatches,
  createBatchItemContract,
  isRecord,
  parseBatchItemContract,
  parseItemIdentity,
} from './canonical-contracts.js';
import {
  BatchContractError,
  BatchItemIdentityDriftError,
  BatchItemProjectionDriftError,
  BatchItemResourceDriftError,
  BatchItemResumeContractError,
  BatchMutationRetryError,
} from './errors.js';
import { failedResult } from './scheduler-runtime.js';
import { MAX_BATCH_CONCURRENCY } from './types.js';
import type {
  BatchClock,
  BatchContract,
  BatchItemContract,
  BatchItemFailedResult,
  BatchJsonValue,
  BatchResumeItem,
  BatchResumeState,
  RunBoundedBatchOptions,
} from './types.js';

export function validateBatchOptions<
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
      options.retry.maxDelayMs < 0 ||
      options.retry.maxDelayMs > MAX_NODE_TIMER_DELAY_MS)
  ) {
    throw new BatchContractError(
      `Batch retry maxAttempts must be positive and maxDelayMs must be a non-negative safe integer no greater than the maximum supported timer delay (${MAX_NODE_TIMER_DELAY_MS} ms).`,
    );
  }
}

export function validateResume<TOutput, TIdentity extends BatchJsonValue>(
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

export function projectBatchItemContract<
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

export function itemIdentityMatches<
  TInput,
  TOutput,
  TIdentity extends BatchJsonValue,
  TExclusiveKey extends string,
>(
  options: RunBoundedBatchOptions<TInput, TOutput, TIdentity, TExclusiveKey>,
  item: TInput,
  index: number,
  expectedItemId: string,
): boolean {
  try {
    const projected = options.getItemIdentity(item, index);
    return parseItemIdentity(projected, index) === expectedItemId;
  } catch {
    return false;
  }
}

export function identityDriftFailure<TInput, TOutput>(
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
    new BatchItemIdentityDriftError(itemContract.item_id),
    exclusiveKey,
  );
}

export function projectExclusiveKey<
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

export function projectionDriftFailure<TInput, TOutput>(
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

export function resourceDriftFailure<TInput, TOutput>(
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

export function resumeContractFailure<TInput>(
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
