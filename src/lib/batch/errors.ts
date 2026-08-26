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

export class BatchItemIdentityDriftError extends BatchContractError {
  readonly itemId: string;

  constructor(itemId: string) {
    super(`Batch item ${itemId} identity drifted before claim.`);
    this.name = 'BatchItemIdentityDriftError';
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
