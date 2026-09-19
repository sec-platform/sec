import type { LockFile } from '../compiler/contract.ts';
import type { PassId } from '../compiler/contract/pass-status.ts';
import { CompilerError } from '../compiler/errors.ts';
import { getPipelineStageDefinition } from '../compiler/pipeline/stage-definitions.ts';
import {
  pipelineStageBlockers,
  pipelineStageStatePatch,
  type PipelineStageTransition
} from '../compiler/pipeline/stage-state.ts';
import type { PipelineStageId } from '../compiler/pipeline/stages.ts';
import {
  describePipelineFailure,
  settlePipelineFailure
} from './pipeline-failure.ts';
import { isPipelinePassFailure } from './pipeline-pass.ts';

type Awaitable<T> = T | PromiseLike<T>;

export interface PipelineStageLifecycleOptions<T> {
  readonly extractLock?: (result: T) => Awaitable<LockFile>;
  readonly preserveOwnedPassStates?: boolean;
}

export type PipelineStageExecutionOptions<T> = PipelineStageLifecycleOptions<T>;

/** Capture option method identity and policy before any suspension point. */
export function capturePipelineStageExecutionOptions<T>(
  options: PipelineStageExecutionOptions<T>
): Readonly<PipelineStageExecutionOptions<T>> {
  const { extractLock, preserveOwnedPassStates } = options;
  if (extractLock !== undefined && typeof extractLock !== 'function') {
    throw new TypeError('Pipeline lock extractor must be callable');
  }
  if (preserveOwnedPassStates !== undefined &&
      typeof preserveOwnedPassStates !== 'boolean') {
    throw new TypeError('Pipeline preserveOwnedPassStates must be boolean');
  }
  return Object.freeze({
    preserveOwnedPassStates,
    extractLock: extractLock === undefined
      ? undefined
      : (result: T): Awaitable<LockFile> =>
          Reflect.apply(extractLock, options, [result]) as Awaitable<LockFile>
  });
}

export interface PipelineStageLifecycleOperations<T> {
  readExistingLock(): Awaitable<LockFile | null>;
  assertWrite(): Awaitable<void>;
  saveLock(lock: LockFile): Awaitable<void>;
  recordBlocked(passId: PassId, code: string, message: string): Awaitable<void>;
  recordStart(passId: PassId): Awaitable<void>;
  recordSuccess(passId: PassId): Awaitable<void>;
  recordFailure(passId: PassId, code: string, message: string): Awaitable<void>;
  execute(): Promise<T>;
}

function assertStageRequirements(
  lock: LockFile | null,
  stageId: PipelineStageId,
  requires: readonly PassId[]
): void {
  if (requires.length === 0) return;
  if (!lock) {
    throw new CompilerError(
      'PIPELINE-BLOCKED-001',
      `Pipeline stage "${stageId}" requires an existing graph lock`,
      { stageId, requires }
    );
  }
  const blockers = pipelineStageBlockers(lock.passStatus, requires);
  if (blockers.length > 0) {
    throw new CompilerError(
      'PIPELINE-BLOCKED-002',
      `Pipeline stage "${stageId}" has unsatisfied pass dependencies`,
      { stageId, blockers }
    );
  }
}

function transitionStageState(
  lock: LockFile,
  stageId: PipelineStageId,
  transition: PipelineStageTransition
): void {
  Object.assign(
    lock.passStatus,
    pipelineStageStatePatch(getPipelineStageDefinition(stageId), transition)
  );
}

/**
 * Own one pipeline stage's blocked/start/success/failure state machine.
 * Physical lock persistence, journal writes and commit fences are injected.
 */
export async function executePipelineStageLifecycle<T>(
  stageId: PipelineStageId,
  operations: PipelineStageLifecycleOperations<T>,
  options: PipelineStageLifecycleOptions<T> = {}
): Promise<T> {
  const required = [
    operations.readExistingLock,
    operations.assertWrite,
    operations.saveLock,
    operations.recordBlocked,
    operations.recordStart,
    operations.recordSuccess,
    operations.recordFailure,
    operations.execute
  ];
  if (required.some(operation => typeof operation !== 'function')) {
    throw new TypeError('Pipeline stage lifecycle operations must be callable');
  }
  if (options.extractLock !== undefined && typeof options.extractLock !== 'function') {
    throw new TypeError('Pipeline lock extractor must be callable');
  }
  if (options.preserveOwnedPassStates !== undefined &&
      typeof options.preserveOwnedPassStates !== 'boolean') {
    throw new TypeError('Pipeline preserveOwnedPassStates must be boolean');
  }

  const definition = getPipelineStageDefinition(stageId);
  const previousLock = definition.requires.length === 0
    ? null
    : await operations.readExistingLock.call(operations);

  try {
    assertStageRequirements(previousLock, stageId, definition.requires);
  } catch (error) {
    const failure = describePipelineFailure(error);
    return settlePipelineFailure(error, [
      {
        operation: 'lock-blocked',
        run: async () => {
          if (previousLock) {
            transitionStageState(previousLock, stageId, { kind: 'blocked' });
            await operations.assertWrite.call(operations);
            await operations.saveLock.call(operations, previousLock);
          }
        }
      },
      {
        operation: 'journal-blocked',
        run: async () => {
          await operations.assertWrite.call(operations);
          await operations.recordBlocked.call(
            operations,
            definition.primaryPass,
            failure.code,
            failure.message
          );
        }
      }
    ]);
  }

  let startAttempted = false;
  let executionStarted = false;
  try {
    if (previousLock) {
      transitionStageState(previousLock, stageId, { kind: 'started' });
      await operations.assertWrite.call(operations);
      await operations.saveLock.call(operations, previousLock);
    }

    await operations.assertWrite.call(operations);
    startAttempted = true;
    await operations.recordStart.call(operations, definition.primaryPass);

    executionStarted = true;
    const result = await operations.execute.call(operations);
    const lock = options.extractLock
      ? await options.extractLock(result)
      : await operations.readExistingLock.call(operations);
    if (lock && !options.preserveOwnedPassStates) {
      transitionStageState(lock, stageId, { kind: 'succeeded' });
      await operations.assertWrite.call(operations);
      await operations.saveLock.call(operations, lock);
    }

    await operations.assertWrite.call(operations);
    await operations.recordSuccess.call(operations, definition.primaryPass);
    return result;
  } catch (error) {
    const failure = describePipelineFailure(error);
    return settlePipelineFailure(error, [
      {
        operation: 'lock-failed',
        run: async () => {
          const lock = definition.requires.length === 0
            ? null
            : await operations.readExistingLock.call(operations);
          if (lock) {
            transitionStageState(
              lock,
              stageId,
              executionStarted
                ? {
                    kind: 'failed',
                    originPass: isPipelinePassFailure(error)
                      ? error.originPass
                      : definition.primaryPass
                  }
                : { kind: startAttempted ? 'preparation-failed' : 'blocked' }
            );
            await operations.assertWrite.call(operations);
            await operations.saveLock.call(operations, lock);
          }
        }
      },
      {
        operation: startAttempted
          ? 'journal-failed'
          : 'journal-preparation-blocked',
        run: async () => {
          await operations.assertWrite.call(operations);
          if (startAttempted) {
            await operations.recordFailure.call(
              operations,
              definition.primaryPass,
              failure.code,
              failure.message
            );
          } else {
            await operations.recordBlocked.call(
              operations,
              definition.primaryPass,
              failure.code,
              failure.message
            );
          }
        }
      }
    ]);
  }
}
