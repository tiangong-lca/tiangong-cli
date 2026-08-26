import { createHash } from 'node:crypto';
import path from 'node:path';

import { BatchContractError, BatchItemResumeContractError } from './errors.js';
import type {
  BatchContract,
  BatchItemContract,
  BatchJsonValue,
  CreateBatchContractOptions,
  CreateBatchItemContractOptions,
} from './types.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
export const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647;

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

export function canonicalizeBatchValue(value: unknown, ancestors: Set<object>): BatchJsonValue {
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

export function freezeBatchJson<T extends BatchJsonValue>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeBatchJson(child);
    Object.freeze(value);
  }
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseBatchRunPath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || /[\0\r\n]/u.test(value)) {
    throw new BatchContractError('Batch runPath must be a non-empty single-line path.');
  }
  return path.resolve(value);
}

export function parseBatchRunLockToken(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || /[\0\r\n]/u.test(value)) {
    throw new BatchContractError(`Batch run-lock ${label} must be a non-empty single-line string.`);
  }
  return value;
}

export function assertBatchTimerDelaySupported(value: number | undefined, label: string): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BatchContractError(`Batch ${label} must be a non-negative safe integer.`);
  }
  if (value > MAX_NODE_TIMER_DELAY_MS) {
    throw new BatchContractError(
      `Batch ${label} exceeds the maximum supported timer delay (${MAX_NODE_TIMER_DELAY_MS} ms).`,
    );
  }
}

export function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function parseItemIdentity(value: unknown, location: number | 'contract'): string {
  if (typeof value !== 'string' || value.length === 0 || /[\0\r\n]/u.test(value)) {
    throw new BatchContractError(
      location === 'contract'
        ? 'Batch item contract identity must be a non-empty single-line string.'
        : `Batch item identity at input index ${location} must be a non-empty single-line string.`,
    );
  }
  return value;
}

export function assertUniqueItemIds(itemIds: readonly string[]): void {
  if (new Set(itemIds).size !== itemIds.length) {
    throw new BatchContractError('Batch item identities must be unique.');
  }
}

export function batchItemContractsMatch(
  left: BatchItemContract,
  right: BatchItemContract,
): boolean {
  return (
    left.item_id === right.item_id &&
    left.content_sha256 === right.content_sha256 &&
    left.policy_sha256 === right.policy_sha256
  );
}
