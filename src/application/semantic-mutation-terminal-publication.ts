type Awaitable<T> = T | PromiseLike<T>;

export interface RejectedSemanticMutationTerminalOperations {
  publish(): Awaitable<void>;
  prune(): Awaitable<void>;
}

/** Persist one rejected terminal before pruning older terminal authority. A
 * failed publication never advances pruning; physical fencing stays injected. */
export async function publishRejectedSemanticMutationTerminal(
  operations: RejectedSemanticMutationTerminalOperations
): Promise<void> {
  const { publish, prune } = operations;
  if (typeof publish !== 'function' || typeof prune !== 'function') {
    throw new TypeError('Rejected Semantic Mutation terminal operations must be callable');
  }
  await publish.call(operations);
  await prune.call(operations);
}
