import { CompilerError } from './errors.ts';
import { pathExists, readJson } from './fs.ts';
import type { LockFile, PassState } from './lock-types.ts';
import { saveLock } from './lock-utils.ts';
import {
  commitPipelineTransaction,
  failPipelineTransaction,
  recordPipelinePassFailure,
  recordPipelinePassStart,
  recordPipelinePassSuccess,
  startPipelineTransaction
} from './pipeline-journal.ts';
import { getPipelineStageDefinition } from './pipeline-pass-registry.ts';
import type {
  PassId,
  PipelineEventHandler,
  PipelineExecutionContext,
  PipelineSource,
  PipelineStageId
} from './pipeline-types.ts';
import { resolveWorkspaceLockPath } from './paths.ts';

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

async function readExistingLock(workspaceRoot: string): Promise<LockFile | null> {
  const lockPath = await resolveWorkspaceLockPath(workspaceRoot);
  if (!(await pathExists(lockPath))) return null;
  return readJson<LockFile>(lockPath);
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
  for (const passId of invalidates) {
    lock.passStatus[passId] = invalidatedState(passId);
  }
  for (const passId of ownedPasses) {
    lock.passStatus[passId] = 'running';
  }
}

function completeStageState(lock: LockFile, ownedPasses: readonly PassId[]): void {
  for (const passId of ownedPasses) {
    lock.passStatus[passId] = 'succeeded';
  }
}

function passFromErrorCode(code: string, fallback: PassId): PassId {
  if (code.startsWith('PARSE-') || code.startsWith('MANIFEST-') || code.startsWith('PLAN-')) return 'parse';
  if (code.startsWith('ALIGN-')) return 'align';
  if (code.startsWith('RESOLVE-')) return 'resolve';
  if (code.startsWith('COMPOSE-')) return 'compose';
  if (code.startsWith('SLOT-') || code.startsWith('ADAPT-')) return 'adapt';
  if (code.startsWith('VERIFY-') || code.startsWith('ERROR-DRIFT-')) return 'verify';
  if (code.startsWith('REPAIR-')) return 'repair';
  if (code.startsWith('LOCK-')) return 'lock';
  if (code.startsWith('EXPLAIN-') || code.startsWith('EMIT-')) return 'emit';
  return fallback;
}

function failStageState(
  lock: LockFile,
  primaryPass: PassId,
  ownedPasses: readonly PassId[],
  invalidates: readonly PassId[],
  errorCode: string
): void {
  const inferredPass = passFromErrorCode(errorCode, primaryPass);
  const failurePass = ownedPasses.includes(inferredPass) ? inferredPass : primaryPass;
  const failureIndex = ownedPasses.indexOf(failurePass);

  for (let index = 0; index < ownedPasses.length; index += 1) {
    const passId = ownedPasses[index]!;
    lock.passStatus[passId] = index < failureIndex ? 'succeeded' : index === failureIndex ? 'failed' : 'blocked';
  }
  for (const passId of invalidates) {
    lock.passStatus[passId] = 'blocked';
  }
}

async function executeStageWithContext<T>(
  workspaceRoot: string,
  stageId: PipelineStageId,
  context: PipelineExecutionContext,
  execute: () => Promise<T>,
  options: StageExecutionOptions<T>
): Promise<T> {
  const definition = getPipelineStageDefinition(stageId);
  const previousLock = await readExistingLock(workspaceRoot);
  assertStageRequirements(previousLock, stageId, definition.requires);

  if (previousLock) {
    beginStageState(previousLock, definition.ownedPasses, definition.invalidates);
    await saveLock(workspaceRoot, previousLock);
  }
  await recordPipelinePassStart(
    workspaceRoot,
    context.transactionId,
    definition.primaryPass,
    context.onEvent
  );

  try {
    const result = await execute();
    const lock = options.extractLock
      ? await options.extractLock(result)
      : await readExistingLock(workspaceRoot);
    if (lock && !options.preserveOwnedPassStates) {
      completeStageState(lock, definition.ownedPasses);
      await saveLock(workspaceRoot, lock);
    }
    await recordPipelinePassSuccess(
      workspaceRoot,
      context.transactionId,
      definition.primaryPass,
      context.onEvent
    );
    return result;
  } catch (error) {
    const failure = normalizeFailure(error);
    const lock = await readExistingLock(workspaceRoot);
    if (lock) {
      failStageState(
        lock,
        definition.primaryPass,
        definition.ownedPasses,
        definition.invalidates,
        failure.code
      );
      await saveLock(workspaceRoot, lock);
    }
    await recordPipelinePassFailure(
      workspaceRoot,
      context.transactionId,
      definition.primaryPass,
      failure.code,
      failure.message,
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
  execute: (context: PipelineExecutionContext) => Promise<T>
): Promise<T> {
  const transactionId = await startPipelineTransaction(workspaceRoot, source, requestedStages, onEvent);
  const context: PipelineExecutionContext = {
    transactionId,
    source,
    ...(onEvent ? { onEvent } : {})
  };

  try {
    const result = await execute(context);
    await commitPipelineTransaction(workspaceRoot, transactionId, onEvent);
    return result;
  } catch (error) {
    const failure = normalizeFailure(error);
    await failPipelineTransaction(workspaceRoot, transactionId, failure.code, failure.message, onEvent);
    throw error;
  }
}

export async function executePipelineStage<T>(
  workspaceRoot: string,
  stageId: PipelineStageId,
  context: PipelineExecutionContext | undefined,
  execute: () => Promise<T>,
  options: StageExecutionOptions<T> = {}
): Promise<T> {
  if (context) {
    return executeStageWithContext(workspaceRoot, stageId, context, execute, options);
  }
  return withPipelineTransaction(workspaceRoot, 'api', [stageId], undefined, (transaction) =>
    executeStageWithContext(workspaceRoot, stageId, transaction, execute, options)
  );
}
