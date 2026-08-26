import { BatchContractError } from './errors.js';
import type {
  BatchClock,
  BatchEvent,
  BatchEventType,
  BatchItemContract,
  BatchItemFailedResult,
  BatchItemResult,
} from './types.js';

export class MinReadyIndexHeap {
  private readonly values: number[] = [];

  push(value: number): void {
    this.values.push(value);
    let child = this.values.length - 1;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (this.values[parent]! <= this.values[child]!) break;
      [this.values[parent], this.values[child]] = [this.values[child]!, this.values[parent]!];
      child = parent;
    }
  }

  pop(): number | undefined {
    if (this.values.length === 0) return undefined;
    const minimum = this.values[0]!;
    const last = this.values.pop()!;
    if (this.values.length === 0) return minimum;
    this.values[0] = last;
    let parent = 0;
    while (true) {
      const left = parent * 2 + 1;
      if (left >= this.values.length) break;
      const right = left + 1;
      const smallest =
        right < this.values.length && this.values[right]! < this.values[left]! ? right : left;
      if (this.values[parent]! <= this.values[smallest]!) break;
      [this.values[parent], this.values[smallest]] = [this.values[smallest]!, this.values[parent]!];
      parent = smallest;
    }
    return minimum;
  }
}

export type EventEmitter = ReturnType<typeof createEventEmitter>;

export function createEventEmitter(
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

export function readClock(clock: BatchClock): number {
  const value = clock.now();
  if (!Number.isFinite(value)) {
    throw new BatchContractError('Batch clock must return a finite millisecond value.');
  }
  return value;
}

export function createAsyncLock(onError: (error: unknown) => void) {
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
    } catch (error) {
      onError(error);
      throw error;
    } finally {
      release();
    }
  };
}

export function inputOrderedResults<TInput, TOutput>(
  results: Map<number, BatchItemResult<TInput, TOutput>>,
): BatchItemResult<TInput, TOutput>[] {
  return [...results.entries()].sort(([left], [right]) => left - right).map(([, result]) => result);
}

export function failedResult<TInput>(
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

export function freezeResult<T extends BatchItemResult<unknown, unknown>>(value: T): T {
  return Object.freeze(value);
}

export function defaultBatchSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
