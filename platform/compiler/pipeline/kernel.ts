import { CompilerError } from './errors.ts';
import type { LockFile, PassState } from './lock-types.ts';
import { readLockFile, saveLock } from './lock-utils.ts';
import {
  commitPipelineTransaction,
  failPipelineTransaction,
  recordPipelinePassBlocked,
  recordPipelinePassFailure,
  recordPipelinePassStart,
  recordPipelinePassSuccess,
  startPipelineTransaction
} from './pipeline-journal.ts';
import {
  getPipelineStageDefinition,
  pipelinePassFromLegacyErrorCode
} from './pipeline-pass-registry.ts';
import type {
  PassId,
  PipelineEventHandler,
  PipelineExecutionContext,
  PipelineSource,
  PipelineStageId
} from './pipeline-types.ts';
import {
  createWorkspaceWriteCommitFence,
  withWorkspaceWriteLease,
  type WorkspaceWriteLeaseToken
} from './workspace-write-lease.ts';

interface StageExecutionOptions<T> {
  extractLock?: (result: T) => LockFile | Promise<LockFile>;
  preserveOwnedPassStates?: boolean;
}

function normalizeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof CompilerError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: 'UNEXPECTED', message: error.message };
  }
  return { code: 'UNEXPECTED', message: String(error) };
}

function readExistingLock(workspaceRoot: string): LockFile | null {
  try {
    return readLockFile(workspaceRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function invalidatedState(passId: PassId): PassState {
  return passId === 'repair' ? 'skipped' : 'pending';
}

function assertStageRequirements(lock: LockFile | null, stageId: PipelineStageId, requires: readonly PassId[]): void {
  if (requires.length === 0) return;
  if (!lock) {
    throw new CompilerError('PIPELINE-BLOCKED-001', `Pipeline stage "${stageId}" requires an existing graph lock`, {
      stageId,
      requires
    });
  }
  const blockers = requires.filter((passId) => lock.passStatus[passId] !== 'succeeded');
  if (blockers.length > 0) {
    throw new CompilerError('PIPELINE-BLOCKED-002', `Pipeline stage "${stageId}" has unsatisfied pass dependencies`, {
      stageId,
      blockers: blockers.map((passId) => ({ passId, state: lock.passStatus[passId] }))
    });
  }
}

function beginStageState(lock: LockFile, ownedPasses: readonly PassId[], invalidates: readonly PassId[]): void {
  for (const passId of invalidates) lock.passStatus[passId] = invalidatedState(passId);
  for (const passId of ownedPasses) lock.passStatus[passId] = 'running';
}

function blockStageState(lock: LockFile, ownedPasses: readonly PassId[], invalidates: readonly PassId[]): void {
  for (const passId of ownedPasses) lock.passStatus[passId] = 'blocked';
  for (const passId of invalidates) lock.passStatus[passId] = 'blocked';
}

function completeStageState(lock: LockFile, ownedPasses: readonly PassId[]): void {
  for (const passId of ownedPasses) lock.passStatus[passId] = 'succeeded';
}

function failStageState(
  lock: LockFile,
  primaryPass: PassId,
  ownedPasses: readonly PassId[],
  invalidates: readonly PassId[],
  errorCode: string
): void {
  const inferredPass = pipelinePassFromLegacyErrorCode(errorCode, primaryPass);
  const failurePass = ownedPasses.includes(inferredPass) ? inferredPass : primaryPass;
  const failureIndex = ownedPasses.indexOf(failurePass);

  for (let index = 0; index < ownedPasses.length; index += 1) {
    const passId = ownedPasses[index]!;
    lock.passStatus[passId] = index < failureIndex ? 'succeeded' : index === failureIndex ? 'failed' : 'blocked';
  }
  for (const passId of invalidates) lock.passStatus[passId] = 'blocked';
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
  const previousLock = readExistingLock(workspaceRoot);

  try {
    assertStageRequirements(previousLock, stageId, definition.requires);
  } catch (error) {
    const failure = normalizeFailure(error);
    if (previousLock) {
      blockStageState(previousLock, definition.ownedPasses, definition.invalidates);
      await commitFence();
      await saveLock(workspaceRoot, previousLock, commitFence);
    }
    await commitFence();
    await recordPipelinePassBlocked(
      workspaceRoot,
      context.transactionId,
      definition.primaryPass,
      failure.code,
      failure.message,
      commitFence,
      context.onEvent
    );
    throw error;
  }

  if (previousLock) {
    beginStageState(previousLock, definition.ownedPasses, definition.invalidates);
    await commitFence();
    await saveLock(workspaceRoot, previousLock, commitFence);
  }
  await commitFence();
  await recordPipelinePassStart(
    workspaceRoot,
    context.transactionId,
    definition.primaryPass,
    commitFence,
    context.onEvent
  );

  try {
    const result = await execute(context);
    const lock = options.extractLock
      ? await options.extractLock(result)
      : readExistingLock(workspaceRoot);
    if (lock && !options.preserveOwnedPassStates) {
      completeStageState(lock, definition.ownedPasses);
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
    const failure = normalizeFailure(error);
    const lock = readExistingLock(workspaceRoot);
    if (lock) {
      failStageState(
        lock,
        definition.primaryPass,
        definition.ownedPasses,
        definition.invalidates,
        failure.code
      );
      await commitFence();
      await saveLock(workspaceRoot, lock, commitFence);
    }
    await commitFence();
    await recordPipelinePassFailure(
      workspaceRoot,
      context.transactionId,
      definition.primaryPass,
      failure.code,
      failure.message,
      commitFence,
      context.onEvent
    );
    throw error;
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
  return withWorkspaceWriteLease(workspaceRoot, workspaceWriteLease, async (lease) => {
    const commitFence = createWorkspaceWriteCommitFence(workspaceRoot, lease);
    await commitFence();
    const transactionId = await startPipelineTransaction(
      workspaceRoot,
      source,
      requestedStages,
      commitFence,
      onEvent
    );
    const context: PipelineExecutionContext = {
      transactionId,
      source,
      ...(onEvent ? { onEvent } : {}),
      workspaceWriteLease: lease
    };

    try {
      const result = await execute(context);
      await commitFence();
      await commitPipelineTransaction(workspaceRoot, transactionId, commitFence, onEvent);
      return result;
    } catch (error) {
      const failure = normalizeFailure(error);
      await commitFence();
      await failPipelineTransaction(
        workspaceRoot,
        transactionId,
        failure.code,
        failure.message,
        commitFence,
        onEvent
      );
      throw error;
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
  if (context) {
    const commitFence = createWorkspaceWriteCommitFence(workspaceRoot, context.workspaceWriteLease);
    await commitFence();
    return executeStageWithContext(workspaceRoot, stageId, context, execute, commitFence, options);
  }
  return withPipelineTransaction(workspaceRoot, 'api', [stageId], undefined, (transaction) =>
    executeStageWithContext(
      workspaceRoot,
      stageId,
      transaction,
      execute,
      createWorkspaceWriteCommitFence(workspaceRoot, transaction.workspaceWriteLease),
      options
    )
  );
}
