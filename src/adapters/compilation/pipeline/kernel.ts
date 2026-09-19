import path from 'node:path';
import { createWorkspaceWriteCommitFence, withWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../filesystem/write-lease.ts';
import type { LockFile } from '../../../compiler/contract.ts';
import { PASS_INITIAL_STATES } from '../../../compiler/contract/pass-status.ts';
import { CompilerError, getErrorCode } from '../../../compiler/errors.ts';
import { readLockFile, saveLock } from "../../workspace/lock.ts";
import { capturePipelineRequestedStages, capturePipelineStageExecutionOptions, requirePipelineSource, sealPipelineExecutionContext, type PipelineStageExecutionOptions } from './execution-context.ts';
import {
  describePipelineFailure,
  settlePipelineFailure
} from '../../../application/pipeline-failure.ts';
import {
  commitPipelineTransaction,
  failPipelineTransaction,
  recordPipelinePassBlocked,
  recordPipelinePassFailure,
  recordPipelinePassStart,
  recordPipelinePassSuccess,
  startPipelineTransaction
} from './journal.ts';
import { getPipelineStageDefinition } from '../../../compiler/pipeline/stage-definitions.ts';
import {
  pipelineStageBlockers,
  pipelineStageStatePatch,
  type PipelineStageTransition
} from '../../../compiler/pipeline/stage-state.ts';
import type {
  PassId,
  PipelineEventHandler,
  PipelineExecutionContext,
  PipelineSource,
  PipelineStageId
} from '../../compilation-protocol/types.ts';

type StageExecutionOptions<T> = PipelineStageExecutionOptions<T>;

const issuedPassFailures = new WeakSet<object>();

class PipelinePassFailure extends CompilerError {
  readonly originPass: PassId;

  constructor(originPass: PassId, error: unknown) {
    const failure = describePipelineFailure(error);
    let details = {};
    try { if (error instanceof CompilerError) details = error.details ?? {}; }
    catch { /* Keep the original cause when its diagnostic details are unreadable. */ }
    super(failure.code, failure.message, details);
    this.name = 'PipelinePassFailure';
    this.originPass = originPass;
    Object.defineProperty(this, 'originPass', { value: originPass, enumerable: true, writable: false, configurable: false });
    this.cause = error;
    issuedPassFailures.add(this);
  }
}

export async function runPipelinePass<T>(
  originPass: PassId,
  execute: () => T | Promise<T>
): Promise<T> {
  if (!Object.hasOwn(PASS_INITIAL_STATES, originPass)) throw new CompilerError('PIPELINE-USAGE-001', 'Unknown pipeline pass');
  try {
    return await execute();
  } catch (error) {
    if (isPipelinePassFailure(error)) throw error;
    throw new PipelinePassFailure(originPass, error);
  }
}

function isPipelinePassFailure(value: unknown): value is PipelinePassFailure {
  return typeof value === 'object' && value !== null && issuedPassFailures.has(value);
}

function readExistingLock(workspaceRoot: string): LockFile | null {
  try {
    return readLockFile(workspaceRoot);
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') return null;
    throw error;
  }
}

function assertStageRequirements(lock: LockFile | null, stageId: PipelineStageId, requires: readonly PassId[]): void {
  if (requires.length === 0) return;
  if (!lock) {
    throw new CompilerError('PIPELINE-BLOCKED-001', `Pipeline stage "${stageId}" requires an existing graph lock`, {
      stageId,
      requires
    });
  }
  const blockers = pipelineStageBlockers(lock.passStatus, requires);
  if (blockers.length > 0) {
    throw new CompilerError('PIPELINE-BLOCKED-002', `Pipeline stage "${stageId}" has unsatisfied pass dependencies`, {
      stageId, blockers
    });
  }
}

function transitionStageState(
  lock: LockFile,
  definition: ReturnType<typeof getPipelineStageDefinition>,
  transition: PipelineStageTransition
): void {
  Object.assign(lock.passStatus, pipelineStageStatePatch(definition, transition));
}

async function executeStageWithContext<T>(
  workspaceRoot: string,
  stageId: PipelineStageId,
  context: PipelineExecutionContext,
  execute: (effectiveContext: PipelineExecutionContext) => Promise<T>,
  commitFence: () => Promise<void>,
  options: StageExecutionOptions<T>
): Promise<T> {
  const definition = getPipelineStageDefinition(stageId);
  // A root stage rebuilds derived state from canonical inputs. Parsing a stale
  // derived lock before the rebuild would let the retired artifact veto its
  // only producer and make schema retirement impossible without a dual reader.
  const previousLock = definition.requires.length === 0
    ? null
    : readExistingLock(workspaceRoot);

  try {
    assertStageRequirements(previousLock, stageId, definition.requires);
  } catch (error) {
    const failure = describePipelineFailure(error);
    return settlePipelineFailure(error, [
      { operation: 'lock-blocked', run: async () => {
        if (previousLock) {
          transitionStageState(previousLock, definition, { kind: 'blocked' });
          await commitFence();
          await saveLock(workspaceRoot, previousLock, commitFence);
        }
      } },
      { operation: 'journal-blocked', run: async () => {
        await commitFence();
        await recordPipelinePassBlocked(workspaceRoot, context.transactionId, definition.primaryPass,
          failure.code, failure.message, commitFence, context.onEvent);
      } }
    ]);
  }

  let startAttempted = false;
  let executionStarted = false;
  try {
    if (previousLock) {
      transitionStageState(previousLock, definition, { kind: 'started' });
      await commitFence();
      await saveLock(workspaceRoot, previousLock, commitFence);
    }
    await commitFence();
    startAttempted = true;
    await recordPipelinePassStart(
      workspaceRoot,
      context.transactionId,
      definition.primaryPass,
      commitFence,
      context.onEvent
    );

    executionStarted = true;
    const result = await execute(context);
    const lock = options.extractLock
      ? await options.extractLock(result)
      : readExistingLock(workspaceRoot);
    if (lock && !options.preserveOwnedPassStates) {
      transitionStageState(lock, definition, { kind: 'succeeded' });
      await commitFence();
      await saveLock(workspaceRoot, lock, commitFence);
    }
    await commitFence();
    await recordPipelinePassSuccess(
      workspaceRoot,
      context.transactionId,
      definition.primaryPass,
      commitFence,
      context.onEvent
    );
    return result;
  } catch (error) {
    const failure = describePipelineFailure(error);
    return settlePipelineFailure(error, [
      { operation: 'lock-failed', run: async () => {
        const lock = definition.requires.length === 0 ? null : readExistingLock(workspaceRoot);
        if (lock) {
          transitionStageState(lock, definition, executionStarted
            ? { kind: 'failed', originPass: isPipelinePassFailure(error) ? error.originPass : definition.primaryPass }
            : { kind: startAttempted ? 'preparation-failed' : 'blocked' });
          await commitFence();
          await saveLock(workspaceRoot, lock, commitFence);
        }
      } },
      { operation: startAttempted ? 'journal-failed' : 'journal-preparation-blocked', run: async () => {
        await commitFence();
        // Before calling the start owner there cannot be a running record. A
        // rejected start may already have persisted one; retain that owner's
        // failure, including an absent-running-record settlement error, rather
        // than guessing whether a partial publication occurred.
        const settle = startAttempted ? recordPipelinePassFailure : recordPipelinePassBlocked;
        await settle(workspaceRoot, context.transactionId, definition.primaryPass,
          failure.code, failure.message, commitFence, context.onEvent);
      } }
    ]);
  }
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
  // A caller cannot change the journal request while lease admission is suspended.
  const stages = capturePipelineRequestedStages(requestedStages);
  source = requirePipelineSource(source);
  if (onEvent !== undefined && typeof onEvent !== 'function') throw new TypeError('Pipeline observer must be callable');
  if (typeof execute !== 'function') throw new TypeError('Pipeline executor must be callable');
  return withWorkspaceWriteLease(workspaceRoot, workspaceWriteLease, async (lease) => {
    const commitFence = createWorkspaceWriteCommitFence(workspaceRoot, lease);
    await commitFence();
    const transactionId = await startPipelineTransaction(
      workspaceRoot,
      source,
      stages,
      commitFence,
      onEvent
    );
    const context: PipelineExecutionContext = {
      transactionId,
      source,
      ...(onEvent ? { onEvent } : {}),
      workspaceWriteLease: lease
    };
    sealPipelineExecutionContext(context);

    try {
      const result = await execute(context);
      await commitFence();
      await commitPipelineTransaction(workspaceRoot, transactionId, commitFence, onEvent);
      return result;
    } catch (error) {
      const failure = describePipelineFailure(error);
      return settlePipelineFailure(error, [{ operation: 'transaction-failed', run: async () => {
        await commitFence();
        await failPipelineTransaction(workspaceRoot, transactionId, failure.code, failure.message, commitFence, onEvent);
      } }]);
    }
  });
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
  if (typeof execute !== 'function') throw new TypeError('Pipeline stage executor must be callable');
  getPipelineStageDefinition(stageId);
  if (context !== undefined) {
    sealPipelineExecutionContext(context);
    const commitFence = createWorkspaceWriteCommitFence(workspaceRoot, context.workspaceWriteLease);
    await commitFence();
    return executeStageWithContext(workspaceRoot, stageId, context, execute, commitFence, effectiveOptions);
  }
  return withPipelineTransaction(workspaceRoot, 'api', [stageId], undefined, (transaction) =>
    executeStageWithContext(
      workspaceRoot,
      stageId,
      transaction,
      execute,
      createWorkspaceWriteCommitFence(workspaceRoot, transaction.workspaceWriteLease),
      effectiveOptions
    )
  );
}
