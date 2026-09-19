import type {
  SemanticMutationInternalRecoveryOutcome,
  SemanticMutationRecoveryRecord
} from '../semantics/mutation/transaction.ts';

type Awaitable<T> = T | PromiseLike<T>;

export interface SemanticMutationRecoveryCoordinatorOperations {
  inspectAuthority(): Awaitable<Readonly<{
    unfinished: readonly Readonly<{
      transactionRoot: string;
      record: SemanticMutationRecoveryRecord;
    }>[];
    blocked?: Readonly<{
      transactionRoot: string;
      record: SemanticMutationRecoveryRecord;
    }>;
  }>>;
  recoverRecord(
    transactionRoot: string,
    record: SemanticMutationRecoveryRecord
  ): Awaitable<SemanticMutationInternalRecoveryOutcome>;
  prune(): Awaitable<void>;
}

/** Coordinate durable recovery authority without owning filesystem details.
 * A recovery-required record stops later work; accepted/rolled-back terminals
 * are pruned before another authority is considered. */
export async function coordinateSemanticMutationRecovery(
  operations: SemanticMutationRecoveryCoordinatorOperations
): Promise<SemanticMutationInternalRecoveryOutcome> {
  const { inspectAuthority, recoverRecord, prune } = operations;
  if ([inspectAuthority, recoverRecord, prune].some(operation => typeof operation !== 'function')) {
    throw new TypeError('Semantic Mutation recovery operations must be callable');
  }
  const { unfinished, blocked } = await inspectAuthority.call(operations);
  if (blocked !== undefined) {
    return { status: 'recovery-required', record: blocked.record };
  }

  let last: SemanticMutationInternalRecoveryOutcome = { status: 'clean' };
  for (const authority of unfinished) {
    const outcome = await recoverRecord.call(
      operations,
      authority.transactionRoot,
      authority.record
    );
    if (outcome.status === 'recovery-required') return outcome;
    if (outcome.status === 'terminal' &&
        (outcome.result.status === 'accepted' || outcome.result.status === 'rolled-back')) {
      await prune.call(operations);
    }
    last = outcome;
  }
  await prune.call(operations);
  return last;
}
