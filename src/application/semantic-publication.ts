import type { LockFile } from '../compiler/contract.ts';
import type { SemanticCompilation } from '../compiler/semantic-compiler.ts';

export interface SemanticPublicationOperations<Context> {
  bind(compilation: SemanticCompilation): Context;
  persist(lock: LockFile): void | PromiseLike<void>;
}

/** Publish the result for the exact Lock that supplied the semantic inputs.
 * This use case cannot reopen a newer Lock or acquire a write capability;
 * the host supplies the existing transaction binder and fenced publisher. */
export async function publishSemanticCompilation<Context>(
  sourceLock: LockFile,
  compilation: SemanticCompilation,
  operations: SemanticPublicationOperations<Context>
): Promise<Readonly<{ lock: LockFile; context: Context }>> {
  const { bind, persist } = operations;
  if (typeof bind !== 'function' || typeof persist !== 'function') {
    throw new TypeError('Semantic publication requires a context binder and publisher');
  }
  const { snapshot, generatorPlan, semanticViews } = compilation;
  const captured = Object.freeze({ snapshot, generatorPlan, semanticViews });
  // These are derived fields of this owned Lock, not edits to author content.
  // Preserve the original bind-before-persistence sequence and failure path.
  delete sourceLock.semanticLoweringTasks;
  delete sourceLock.semanticViews;
  const context = bind.call(operations, captured);
  sourceLock.semanticLoweringTasks = generatorPlan.tasks.map(task => ({
    ...structuredClone(task), status: 'pending'
  }));
  sourceLock.semanticViews = structuredClone(semanticViews);
  await persist.call(operations, sourceLock);
  return Object.freeze({ lock: sourceLock, context });
}
