import type { PipelineCompletionProof } from '../assurance/verification/pipeline/completion-proof.ts';
import type { LockFile } from '../compiler/contract.ts';
import type { PipelineStageId } from '../compiler/pipeline/stages.ts';
import {
  coordinatePipelineStages,
  type PipelineUseCaseOperations,
  type PipelineUseCaseResult
} from './pipeline-run.ts';

type Awaitable<T> = T | PromiseLike<T>;

export interface WorkspaceCompilationCompletionInput extends PipelineUseCaseResult {
  readonly transactionId: string;
  readonly lock: LockFile;
}

export interface WorkspaceCompilationTransactionOperations extends PipelineUseCaseOperations {
  readLock(): Awaitable<LockFile>;
  buildCompletionProof(input: WorkspaceCompilationCompletionInput): Awaitable<PipelineCompletionProof | null>;
  revalidateStagedProof?(lock: LockFile): Awaitable<void>;
}

export interface WorkspaceCompilationTransactionResult extends WorkspaceCompilationCompletionInput {
  readonly completionProof?: PipelineCompletionProof;
}

/** Coordinate one already-open pipeline transaction. Lease acquisition,
 * transaction lifetime and concrete stage effects remain with bootstrap/execution. */
export async function completeWorkspaceCompilationTransaction(
  transactionId: string,
  stages: readonly PipelineStageId[],
  operations: WorkspaceCompilationTransactionOperations
): Promise<WorkspaceCompilationTransactionResult> {
  if (typeof transactionId !== 'string' || transactionId.length === 0) {
    throw new TypeError('Workspace compilation transactionId must be non-empty');
  }
  const { readLock, buildCompletionProof, revalidateStagedProof } = operations;
  if (typeof readLock !== 'function' || typeof buildCompletionProof !== 'function'
      || (revalidateStagedProof !== undefined && typeof revalidateStagedProof !== 'function')) {
    throw new TypeError('Workspace compilation completion operations must be callable');
  }
  const stageResult = await coordinatePipelineStages(stages, operations);
  const lock = await readLock.call(operations);
  const completionInput = Object.freeze({ transactionId, lock, ...stageResult });
  const completionProof = await buildCompletionProof.call(operations, completionInput);
  if (revalidateStagedProof !== undefined) {
    await revalidateStagedProof.call(operations, lock);
  }
  return {
    ...completionInput,
    ...(completionProof === null ? {} : { completionProof })
  };
}
