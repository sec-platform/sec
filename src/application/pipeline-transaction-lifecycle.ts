import {
  describePipelineFailure,
  settlePipelineFailure
} from './pipeline-failure.ts';

type Awaitable<T> = T | PromiseLike<T>;

export interface PipelineTransactionLifecycleOperations<TContext, TResult> {
  assertWrite(): Awaitable<void>;
  start(): Promise<string>;
  createContext(transactionId: string): TContext;
  execute(context: TContext): Promise<TResult>;
  commit(transactionId: string): Promise<void>;
  fail(transactionId: string, code: string, message: string): Promise<void>;
}

/**
 * Own one admitted Pipeline transaction's start/execute/commit/failure ordering.
 * Lease admission, commit fences, journal persistence and context construction
 * remain injected by the physical binding layer.
 */
export async function executePipelineTransactionLifecycle<TContext, TResult>(
  operations: PipelineTransactionLifecycleOperations<TContext, TResult>
): Promise<TResult> {
  const required = [
    operations.assertWrite,
    operations.start,
    operations.createContext,
    operations.execute,
    operations.commit,
    operations.fail
  ];
  if (required.some(operation => typeof operation !== 'function')) {
    throw new TypeError('Pipeline transaction lifecycle operations must be callable');
  }

  await operations.assertWrite.call(operations);
  const transactionId = await operations.start.call(operations);
  if (typeof transactionId !== 'string' || transactionId.length === 0) {
    throw new TypeError('Pipeline transaction identity must be non-empty');
  }
  const context = operations.createContext.call(operations, transactionId);

  try {
    const result = await operations.execute.call(operations, context);
    await operations.assertWrite.call(operations);
    await operations.commit.call(operations, transactionId);
    return result;
  } catch (error) {
    const failure = describePipelineFailure(error);
    return settlePipelineFailure(error, [{
      operation: 'transaction-failed',
      run: async () => {
        await operations.assertWrite.call(operations);
        await operations.fail.call(
          operations,
          transactionId,
          failure.code,
          failure.message
        );
      }
    }]);
  }
}
