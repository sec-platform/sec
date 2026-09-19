import path from 'node:path';

import {
  createWorkspaceWriteCommitFence,
  withWorkspaceWriteLease,
  type WorkspaceWriteLeaseToken
} from '../../filesystem/write-lease.ts';
import type { LockFile } from '../../../compiler/contract.ts';
import { getErrorCode } from '../../../compiler/errors.ts';
import {
  readLockFile,
  saveLock
} from '../../workspace/lock.ts';
import {
  requirePipelineSource,
  sealPipelineExecutionContext
} from './execution-context.ts';
import { capturePipelineRequestedStages } from '../../../compiler/pipeline/stages.ts';
import {
  capturePipelineStageExecutionOptions,
  type PipelineStageExecutionOptions
} from '../../../application/pipeline-stage-lifecycle.ts';
import {
  executePipelineTransactionLifecycle
} from '../../../application/pipeline-transaction-lifecycle.ts';
import {
  coordinatePipelineStageAdmission,
  executePipelineStageLifecycle
} from '../../../application/pipeline-stage-lifecycle.ts';
export { runPipelinePass } from '../../../application/pipeline-pass.ts';
import {
  commitPipelineTransaction,
  failPipelineTransaction,
  recordPipelinePassBlocked,
  recordPipelinePassFailure,
  recordPipelinePassStart,
  recordPipelinePassSuccess,
  startPipelineTransaction
} from './journal.ts';
import type {
  PipelineEventHandler,
  PipelineExecutionContext,
  PipelineSource,
  PipelineStageId
} from '../../compilation-protocol/types.ts';

type StageExecutionOptions<T> = PipelineStageExecutionOptions<T>;

function readExistingLock(workspaceRoot: string): LockFile | null {
  try {
    return readLockFile(workspaceRoot);
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Bind one Application-owned stage lifecycle to the concrete workspace lock,
 * journal, lease and commit-fence providers.
 *
 * The preflight flag preserves the historical distinction between a stage
 * entered through an existing transaction context and a standalone stage whose
 * enclosing transaction has just been admitted and fenced.
 */
async function executeStageWithContext<T>(
  workspaceRoot: string,
  stageId: PipelineStageId,
  context: PipelineExecutionContext,
  execute: (effectiveContext: PipelineExecutionContext) => Promise<T>,
  options: StageExecutionOptions<T>,
  preflightFence: boolean
): Promise<T> {
  const commitFence = createWorkspaceWriteCommitFence(
    workspaceRoot,
    context.workspaceWriteLease
  );
  if (preflightFence) await commitFence();

  return executePipelineStageLifecycle(
    stageId,
    {
      readExistingLock: () => readExistingLock(workspaceRoot),
      assertWrite: commitFence,
      saveLock: lock => saveLock(workspaceRoot, lock, commitFence),
      recordBlocked: (passId, code, message) =>
        recordPipelinePassBlocked(
          workspaceRoot,
          context.transactionId,
          passId,
          code,
          message,
          commitFence,
          context.onEvent
        ),
      recordStart: passId =>
        recordPipelinePassStart(
          workspaceRoot,
          context.transactionId,
          passId,
          commitFence,
          context.onEvent
        ),
      recordSuccess: passId =>
        recordPipelinePassSuccess(
          workspaceRoot,
          context.transactionId,
          passId,
          commitFence,
          context.onEvent
        ),
      recordFailure: (passId, code, message) =>
        recordPipelinePassFailure(
          workspaceRoot,
          context.transactionId,
          passId,
          code,
          message,
          commitFence,
          context.onEvent
        ),
      execute: () => execute(context)
    },
    options
  );
}

export async function withPipelineTransaction<T>(
  workspaceRoot: string,
  source: PipelineSource,
  requestedStages: readonly PipelineStageId[],
  onEvent: PipelineEventHandler | undefined,
  execute: (context: PipelineExecutionContext) => Promise<T>,
  workspaceWriteLease?: WorkspaceWriteLeaseToken
): Promise<T> {
  workspaceRoot = path.resolve(workspaceRoot);
  const stages = capturePipelineRequestedStages(requestedStages);
  source = requirePipelineSource(source);
  if (onEvent !== undefined && typeof onEvent !== 'function') {
    throw new TypeError('Pipeline observer must be callable');
  }
  if (typeof execute !== 'function') {
    throw new TypeError('Pipeline executor must be callable');
  }

  return withWorkspaceWriteLease(
    workspaceRoot,
    workspaceWriteLease,
    lease => {
      const commitFence = createWorkspaceWriteCommitFence(workspaceRoot, lease);
      return executePipelineTransactionLifecycle({
        assertWrite: commitFence,
        start: () => startPipelineTransaction(
          workspaceRoot,
          source,
          stages,
          commitFence,
          onEvent
        ),
        createContext: transactionId => {
          const context: PipelineExecutionContext = {
            transactionId,
            source,
            ...(onEvent ? { onEvent } : {}),
            workspaceWriteLease: lease
          };
          return sealPipelineExecutionContext(context);
        },
        execute,
        commit: transactionId => commitPipelineTransaction(
          workspaceRoot,
          transactionId,
          commitFence,
          onEvent
        ),
        fail: (transactionId, code, message) => failPipelineTransaction(
          workspaceRoot,
          transactionId,
          code,
          message,
          commitFence,
          onEvent
        )
      });
    }
  );
}

export async function executePipelineStage<T>(
  workspaceRoot: string,
  stageId: PipelineStageId,
  context: PipelineExecutionContext | undefined,
  execute: (effectiveContext: PipelineExecutionContext) => Promise<T>,
  options: StageExecutionOptions<T> = {}
): Promise<T> {
  workspaceRoot = path.resolve(workspaceRoot);
  const effectiveOptions = capturePipelineStageExecutionOptions(options);
  if (typeof execute !== 'function') {
    throw new TypeError('Pipeline stage executor must be callable');
  }

  return coordinatePipelineStageAdmission(context, {
    runWithContext: transaction => {
      sealPipelineExecutionContext(transaction);
      return executeStageWithContext(
        workspaceRoot,
        stageId,
        transaction,
        execute,
        effectiveOptions,
        true
      );
    },
    runStandalone: () => withPipelineTransaction(
      workspaceRoot,
      'api',
      [stageId],
      undefined,
      transaction =>
        executeStageWithContext(
          workspaceRoot,
          stageId,
          transaction,
          execute,
          effectiveOptions,
          false
        )
    )
  });
}
