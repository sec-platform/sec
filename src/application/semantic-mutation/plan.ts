import type { SemanticMutationPlan } from '../../semantics/mutation/types.ts';

type Awaitable<T> = T | PromiseLike<T>;

export interface SemanticMutationPlanningOperations {
  inspectRecovery(): Awaitable<Readonly<{
    unfinished: readonly unknown[];
    blocked?: unknown;
  }>>;
  derive(): Awaitable<Readonly<{ plan: SemanticMutationPlan }>>;
}

/** Decide whether a new mutation plan may be derived. Recovery authority is
 * consulted before staging effects; physical lease/fence ownership remains
 * injected by bootstrap/execution. */
export async function planSemanticMutation(
  operations: SemanticMutationPlanningOperations
): Promise<SemanticMutationPlan> {
  const { inspectRecovery, derive } = operations;
  if (typeof inspectRecovery !== 'function' || typeof derive !== 'function') {
    throw new TypeError('Semantic Mutation planning operations must be callable');
  }
  const recovery = await inspectRecovery.call(operations);
  if (recovery.unfinished.length !== 0 || recovery.blocked !== undefined) {
    throw new Error(
      'Semantic Mutation planning is blocked by unfinished or recovery-required workspace state'
    );
  }
  return (await derive.call(operations)).plan;
}
