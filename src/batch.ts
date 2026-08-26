import { createHash } from 'node:crypto';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
export const MAX_BATCH_CONCURRENCY = 64 as const;

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
}>;

type BatchItemResultCommon<TInput> = Readonly<{
  item: TInput;
  item_id: string;
  item_contract: BatchItemContract;
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

export type BatchExecutionContext<TInput> = Readonly<{
  item: TInput;
  item_id: string;
  item_contract: BatchItemContract;
  input_index: number;
  attempt: number;
  mode: BatchMode;
}>;

export type BatchRetryContext<TInput> = BatchExecutionContext<TInput> &
  Readonly<{
    error: unknown;
  }>;

export type BatchRetryPolicy<TInput> = Readonly<{
  maxAttempts: number;
  maxDelayMs: number;
  shouldRetry: (context: BatchRetryContext<TInput>) => boolean | Promise<boolean>;
  delayMs: (context: BatchRetryContext<TInput>) => number | Promise<number>;
}>;

export type BatchRecoverySource = 'execution_error' | 'resume_incomplete';

export type BatchMutationRecoveryContext<TInput> = Readonly<{
  item: TInput;
  item_id: string;
  item_contract: BatchItemContract;
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

export type RunBoundedBatchOptions<TInput, TOutput, TIdentity extends BatchJsonValue> = Readonly<{
  contract: BatchContract<TIdentity>;
  items: readonly TInput[];
  getItemIdentity: (item: TInput, inputIndex: number) => string;
  projectItemContent: (item: TInput, inputIndex: number) => BatchJsonValue;
  projectItemPolicy: (item: TInput, inputIndex: number) => BatchJsonValue;
  mode: BatchMode;
  maxConcurrency: number;
  execute: (context: BatchExecutionContext<TInput>) => TOutput | Promise<TOutput>;
  retry?: BatchRetryPolicy<TInput>;
  recoverMutation?: (
    context: BatchMutationRecoveryContext<TInput>,
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

export function canonicalBatchJson(value: BatchJsonValue): string {
  return JSON.stringify(canonicalizeBatchValue(value, new Set<object>()));
}

export function sha256BatchBytes(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256BatchJson(value: BatchJsonValue): string {
  return sha256BatchBytes(canonicalBatchJson(value));
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

export async function runBoundedBatch<TInput, TOutput, TIdentity extends BatchJsonValue>(
  options: RunBoundedBatchOptions<TInput, TOutput, TIdentity>,
): Promise<BatchRunResult<TInput, TOutput, TIdentity>> {
  const contract = parseBatchContract<TIdentity>(options.contract);
  validateBatchOptions(options);
  const itemIds = options.items.map((item, index) =>
    parseItemIdentity(options.getItemIdentity(item, index), index),
  );
  assertUniqueItemIds(itemIds);
  const resumeItems = validateResume(options.resume, contract, itemIds);
  const clock = options.clock ?? { now: Date.now };
  const sleep = options.sleep ?? defaultBatchSleep;
  const emitter = createEventEmitter(clock, options.eventSink);
  const schedulerLock = createAsyncLock();
  const resultsByIndex = new Map<number, BatchItemResult<TInput, TOutput>>();
  const completionResults: BatchItemResult<TInput, TOutput>[] = [];
  const claimOrder: string[] = [];
  const pendingIndexes: number[] = [];
  let pendingCursor = 0;
  let paused = false;
  let stopped = false;

  await emitter.emit('batch_started');

  for (const [index, item] of options.items.entries()) {
    const resumeItem = resumeItems.get(itemIds[index]!);
    if (resumeItem?.state === 'completed') {
      const itemContract = projectBatchItemContract(options, item, index, itemIds[index]!);
      if (!batchItemContractsMatch(itemContract, resumeItem)) {
        const result = resumeContractFailure(item, itemContract, index, resumeItem.attempts, clock);
        resultsByIndex.set(index, result);
        completionResults.push(result);
        await emitter.emit('item_resume_rejected', {
          item_id: result.item_id,
          input_index: result.input_index,
          status: result.status,
        });
        continue;
      }
      const resumedResult = freezeResult({
        item,
        item_id: itemContract.item_id,
        item_contract: itemContract,
        input_index: index,
        attempts: resumeItem.attempts,
        attempt_consumed: true,
        resumed: true,
        completed_at_ms: readClock(clock),
        status: resumeItem.outcome,
        value: resumeItem.value,
      });
      resultsByIndex.set(index, resumedResult);
      completionResults.push(resumedResult);
      await emitter.emit('item_resumed', {
        item_id: resumedResult.item_id,
        input_index: resumedResult.input_index,
        status: resumedResult.status,
      });
    } else {
      pendingIndexes.push(index);
    }
  }

  const resumedLast = completionResults.at(-1);
  if (
    resumedLast &&
    (await shouldStopAfter(options, resumedLast, claimOrder, resultsByIndex, completionResults))
  ) {
    stopped = true;
    await emitter.emit('batch_stopped', { status: 'stopped' });
  }

  type Claim =
    | {
        kind: 'claimed';
        index: number;
        itemContract: BatchItemContract;
        resumeItem: BatchResumeItem<TOutput> | undefined;
      }
    | { kind: 'resume_rejected'; result: BatchItemFailedResult<TInput> };

  const claimNext = async (): Promise<Claim | null> =>
    schedulerLock(async () => {
      if (paused || stopped || pendingCursor >= pendingIndexes.length) return null;
      const index = pendingIndexes[pendingCursor]!;
      const item = options.items[index]!;
      const itemId = itemIds[index]!;
      const itemContract = projectBatchItemContract(options, item, index, itemId);
      const resumeItem = resumeItems.get(itemId);
      if (resumeItem && !batchItemContractsMatch(itemContract, resumeItem)) {
        pendingCursor += 1;
        const result = resumeContractFailure(item, itemContract, index, resumeItem.attempts, clock);
        await emitter.emit('item_resume_rejected', {
          item_id: result.item_id,
          input_index: result.input_index,
          status: result.status,
        });
        return { kind: 'resume_rejected', result };
      }
      if (
        options.shouldPauseBeforeClaim &&
        (await options.shouldPauseBeforeClaim({
          item,
          item_id: itemId,
          item_contract: itemContract,
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
      return { kind: 'claimed', index, itemContract, resumeItem };
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
      if (claim.kind === 'resume_rejected') {
        await complete(claim.result);
        continue;
      }
      const result = await executeClaim({
        options,
        index: claim.index,
        itemContract: claim.itemContract,
        resumeItem: claim.resumeItem,
        clock,
        sleep,
        emitter,
      });
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

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validateBatchOptions<TInput, TOutput, TIdentity extends BatchJsonValue>(
  options: RunBoundedBatchOptions<TInput, TOutput, TIdentity>,
): void {
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
    if (item.state === 'completed' && !['succeeded', 'recovered'].includes(String(item.outcome))) {
      throw new BatchContractError('Completed batch resume items require a successful outcome.');
    }
    result.set(itemContract.item_id, item);
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

function projectBatchItemContract<TInput, TOutput, TIdentity extends BatchJsonValue>(
  options: RunBoundedBatchOptions<TInput, TOutput, TIdentity>,
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

function resumeContractFailure<TInput>(
  item: TInput,
  itemContract: BatchItemContract,
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

async function shouldStopAfter<TInput, TOutput, TIdentity extends BatchJsonValue>(
  options: RunBoundedBatchOptions<TInput, TOutput, TIdentity>,
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

async function executeClaim<TInput, TOutput, TIdentity extends BatchJsonValue>(input: {
  options: RunBoundedBatchOptions<TInput, TOutput, TIdentity>;
  index: number;
  itemContract: BatchItemContract;
  resumeItem: BatchResumeItem<TOutput> | undefined;
  clock: BatchClock;
  sleep: BatchSleep;
  emitter: EventEmitter;
}): Promise<BatchItemResult<TInput, TOutput>> {
  const { options, index, itemContract, resumeItem, clock, sleep, emitter } = input;
  const itemId = itemContract.item_id;
  const item = options.items[index]!;
  const resumed = resumeItem?.state === 'attempted';
  const baseAttempts = resumed ? resumeItem.attempts : 0;
  if (resumed && options.mode === 'mutation') {
    const error = new BatchMutationReplayError(itemId);
    if (!options.recoverMutation) {
      return failedResult(item, itemContract, index, baseAttempts, true, true, clock, error);
    }
    return recoverMutation({
      options,
      item,
      itemContract,
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
    const context: BatchExecutionContext<TInput> = {
      item,
      item_id: itemId,
      item_contract: itemContract,
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
          return failedResult(item, itemContract, index, attempt, true, resumed, clock, error);
        }
        return recoverMutation({
          options,
          item,
          itemContract,
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
        return failedResult(item, itemContract, index, attempt, true, resumed, clock, error);
      }
      const retryContext: BatchRetryContext<TInput> = { ...context, error };
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
        );
      }
      if (!retry) {
        return failedResult(item, itemContract, index, attempt, true, resumed, clock, error);
      }
      let requestedDelay: number;
      try {
        requestedDelay = await options.retry.delayMs(retryContext);
        if (!Number.isSafeInteger(requestedDelay) || requestedDelay < 0) {
          throw new BatchContractError('Batch retry delay must be a non-negative safe integer.');
        }
      } catch (delayError) {
        return failedResult(item, itemContract, index, attempt, true, resumed, clock, delayError);
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
        return failedResult(item, itemContract, index, attempt, true, resumed, clock, sleepError);
      }
    }
  }
}

async function recoverMutation<TInput, TOutput, TIdentity extends BatchJsonValue>(input: {
  options: RunBoundedBatchOptions<TInput, TOutput, TIdentity>;
  item: TInput;
  itemContract: BatchItemContract;
  index: number;
  attempts: number;
  error: unknown;
  source: BatchRecoverySource;
  resumed: boolean;
  clock: BatchClock;
  emitter: EventEmitter;
}): Promise<BatchItemResult<TInput, TOutput>> {
  const { options, item, itemContract, index, attempts, error, source, resumed, clock, emitter } =
    input;
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
    );
  } catch (recoveryError) {
    await emitter.emit('recovery_failed', {
      item_id: itemId,
      input_index: index,
      attempt: attempts,
      source,
    });
    return failedResult(item, itemContract, index, attempts, true, resumed, clock, recoveryError);
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
): BatchItemFailedResult<TInput> {
  return freezeResult({
    item,
    item_id: itemContract.item_id,
    item_contract: itemContract,
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
