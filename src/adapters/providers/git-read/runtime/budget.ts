export type GitReadSessionBudget = Readonly<{
  deadlineMs: number;
  maxProcesses: number;
  maxTotalArgumentBytes: number;
  maxStdinBytes: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  maxRecords: number;
  maxRootObservedBytes: number;
  maxReopenRefreshes: number;
  maxSettlementAttempts: number;
  maxCommandStdoutBytes: number;
  maxCommandStderrBytes: number;
  /** Aggregate bytes retained while binding/rechecking the Git executable. */
  maxExecutableBytes: number;
}>;

const MEBIBYTE = 1024 * 1024;
const EXACT_TREE_MAX_SOURCE_BYTES = 128 * MEBIBYTE;
const EXACT_TREE_MAX_RECORDS = 250_000;
const EXACT_TREE_BATCH_PROTOCOL_BYTES_PER_RECORD = 128;
const EXACT_TREE_MAX_COMMAND_STDOUT_BYTES =
  EXACT_TREE_MAX_SOURCE_BYTES
  + EXACT_TREE_MAX_RECORDS * EXACT_TREE_BATCH_PROTOCOL_BYTES_PER_RECORD;
const EXACT_TREE_MAX_OPERATION_STDOUT_BYTES = 256 * MEBIBYTE;

/**
 * Canonical bounded envelope for a production Git read operation. Callers
 * must select an envelope explicitly; operation owners may narrow it but may
 * not rely on an implicit fresh session or widen the provider ceiling.
 */
export const GIT_READ_DEFAULT_OPERATION_BUDGET: GitReadSessionBudget = Object.freeze({
  deadlineMs: 5_000,
  maxProcesses: 32,
  maxTotalArgumentBytes: 16 * 1024 * 1024,
  maxStdinBytes: 16 * 1024 * 1024,
  maxStdoutBytes: 64 * 1024 * 1024,
  maxStderrBytes: 2 * 1024 * 1024,
  maxRecords: 250_000,
  maxRootObservedBytes: 256 * 1024 * 1024,
  maxReopenRefreshes: 10_000,
  maxSettlementAttempts: 32,
  maxCommandStdoutBytes: 32 * 1024 * 1024,
  maxCommandStderrBytes: 512 * 1024,
  maxExecutableBytes: 64 * 1024 * 1024
});

/** Exact-tree observations may read the complete tracked source graph once. */
export const GIT_READ_EXACT_TREE_OPERATION_BUDGET: GitReadSessionBudget = Object.freeze({
  ...GIT_READ_DEFAULT_OPERATION_BUDGET,
  deadlineMs: 120_000,
  maxStdoutBytes: EXACT_TREE_MAX_OPERATION_STDOUT_BYTES,
  maxCommandStdoutBytes: EXACT_TREE_MAX_COMMAND_STDOUT_BYTES
});

/**
 * Absolute ceilings for every GitRead transport. Operation-specific callers
 * may narrow these values, but a caller cannot silently widen the canonical
 * envelope or use a fresh session to reset an aggregate owner budget.
 */
const CANONICAL_GIT_READ_BUDGET_CEILING: GitReadSessionBudget = Object.freeze({
  deadlineMs: 120_000,
  maxProcesses: 128,
  maxTotalArgumentBytes: 16 * 1024 * 1024,
  maxStdinBytes: 64 * 1024 * 1024,
  // Exact-tree consumers admit a bounded 128 MiB source snapshot plus native
  // batch protocol metadata. Aggregate observations may additionally include
  // tree membership and one baseline/current reconciliation. The ordinary
  // default remains 64 MiB; only an explicit operation budget can select this
  // larger canonical envelope.
  maxStdoutBytes: EXACT_TREE_MAX_OPERATION_STDOUT_BYTES,
  maxStderrBytes: 2 * 1024 * 1024,
  maxRecords: 250_000,
  maxRootObservedBytes: 256 * 1024 * 1024,
  maxReopenRefreshes: 10_000,
  maxSettlementAttempts: 10_000,
  maxCommandStdoutBytes: EXACT_TREE_MAX_COMMAND_STDOUT_BYTES,
  maxCommandStderrBytes: 512 * 1024,
  maxExecutableBytes: 64 * 1024 * 1024
});

export class GitReadBudgetError extends Error {
  readonly kind = 'git-read-budget-error' as const;

  constructor(
    readonly reason: 'unknown-field' | 'invalid-value' | 'canonical-ceiling-exceeded',
    readonly field: string,
    message: string
  ) {
    super(message);
    this.name = 'GitReadBudgetError';
  }
}

export function resolveGitReadSessionBudget(
  input: Partial<GitReadSessionBudget> | undefined
): GitReadSessionBudget {
  if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input))) {
    throw new GitReadBudgetError('invalid-value', '<root>', 'Git read budget must be a record');
  }
  const budget = { ...GIT_READ_DEFAULT_OPERATION_BUDGET };
  // Inspect a single set of declarations, then read each admitted field once.
  // Validation and the returned execution budget consume the same value.
  for (const label of Object.keys(input ?? {})) {
    if (!Object.hasOwn(CANONICAL_GIT_READ_BUDGET_CEILING, label)) {
      throw new GitReadBudgetError('unknown-field', label, `Git read session budget field ${label} is not canonical.`);
    }
    const field = label as keyof GitReadSessionBudget;
    const value = input![field];
    validBudgetNumber(label, value as number);
    if (value! > CANONICAL_GIT_READ_BUDGET_CEILING[field]) {
      throw new GitReadBudgetError('canonical-ceiling-exceeded', label,
        `Git read session ${label} exceeds its canonical ceiling.`);
    }
    budget[field] = value!;
  }
  return Object.freeze(budget);
}

function validBudgetNumber(label: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new GitReadBudgetError(
      'invalid-value',
      label,
      `Git read session ${label} must be a positive safe integer.`
    );
  }
  return value;
}

export function boundedGitReadDeadlineAt(
  startedAt: number,
  budget: GitReadSessionBudget,
  parentDeadlineAt: number | undefined
): number {
  if (parentDeadlineAt !== undefined
      && (!Number.isSafeInteger(parentDeadlineAt) || parentDeadlineAt < 0)) {
    throw new GitReadBudgetError(
      'invalid-value',
      'deadlineAtUnixMs',
      'Git read parent deadline must be a non-negative safe integer.'
    );
  }
  return Math.min(
    parentDeadlineAt ?? startedAt + budget.deadlineMs,
    startedAt + budget.deadlineMs
  );
}
