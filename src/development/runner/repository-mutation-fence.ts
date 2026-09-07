import path from 'node:path';
import {
  armWindowsRepositoryChangeObserver,
  settleWindowsRepositoryChangeObserver,
  type WindowsRepositoryChangeObserverSettlement
} from '../../runtime-state/physical/runtime/windows-repository-change-observer.ts';
import { settlePhysicalResourcesAsync, type PhysicalResourceSettlementFailure } from '../../runtime-state/physical/runtime/resource-settlement.ts';
import { observeOptionalDiagnostic } from '../../system-architecture/foundation/runtime/optional-diagnostic.ts';
import type { SecBoundSemanticOperation } from '../../system-architecture/operation/semantic.ts';
import { compilerRoot } from '../../workspace/runtime/paths.ts';
import { requireCommandExitCode } from './command-outcome.ts';
import { RepositoryObservationError, resolveRepositoryObservationRoots } from './repository-observation.ts';

export interface RepositoryMutationFenceOptions {
  readonly operation: SecBoundSemanticOperation;
  readonly repositoryRoot?: string;
  readonly report?: (message: string) => void;
}

const REPOSITORY_ZERO_WRITE_OBSERVATION_MAX_MS = 30_000;

/**
 * Strict zero-write admission remains closed until the Runtime State physical
 * owner supplies one opaque native recursive change-observer capability.
 * Final-state Git equality cannot detect write-and-restore ABA and must not be
 * promoted into this authority boundary.
 */
export async function runRepositoryZeroWriteOperation(
  commandId: string,
  operation: () => Promise<number>,
  options: RepositoryMutationFenceOptions
): Promise<number> {
  const cwd = process.cwd();
  const startedAt = Date.now();
  const { operation: semanticOperation, repositoryRoot: requestedRoot, report: suppliedReport } = options;
  if (typeof operation !== 'function' || (suppliedReport !== undefined && typeof suppliedReport !== 'function')) {
    throw new TypeError('Repository observation operation and reporter must be callable');
  }
  const repositoryRoot = path.resolve(cwd, requestedRoot === undefined ? compilerRoot : requestedRoot);
  const parentDeadline = semanticOperation.plan.attempt.deadlineAtUnixMs;
  if (!Number.isSafeInteger(parentDeadline)) throw new TypeError('Repository observation requires a finite parent deadline');
  // Root discovery consumes this window; arming cannot open a fresh deadline.
  const deadlineAtUnixMs = Math.min(parentDeadline, startedAt + REPOSITORY_ZERO_WRITE_OBSERVATION_MAX_MS);
  const report = suppliedReport === undefined ? console.error : (message: string) => Reflect.apply(suppliedReport, options, [message]);
  if (deadlineAtUnixMs <= startedAt) {
    observeOptionalDiagnostic(() => report(`${commandId} strict-zero-write-unproven: observation deadline exhausted.`));
    return 1;
  }
  const roots = await resolveRepositoryObservationRoots(repositoryRoot, semanticOperation);
  const observerResolution = await armWindowsRepositoryChangeObserver({ roots, deadlineAtUnixMs });
  if (observerResolution.status !== 'ready') {
    observeOptionalDiagnostic(() => report(
      `${commandId} strict-zero-write-unproven: native repository observation is unavailable `
      + `(${observerResolution.reason}).`
    ));
    return 1;
  }
  let result: number | undefined;
  let primary: PhysicalResourceSettlementFailure | undefined;
  try {
    result = requireCommandExitCode(await operation(), 'Repository-observed command');
  } catch (error) {
    primary = { label: 'repository-observed-command', error };
  }
  let settlement: WindowsRepositoryChangeObserverSettlement | undefined;
  await settlePhysicalResourcesAsync({
    primary,
    cleanup: [{ label: 'repository-native-change-observer', settle: async () => {
      settlement = await settleWindowsRepositoryChangeObserver(observerResolution.observer);
      // A failed command does not erase a second loss-of-observation result.
      // Keep the native settlement as cause; display text is not the evidence.
      if (primary !== undefined && settlement.status !== 'zero-events') {
        throw new RepositoryObservationError('physical-unresolved',
          'Repository change observation did not establish zero writes', settlement);
      }
    } }]
  });
  if (settlement!.status !== 'zero-events') {
    observeOptionalDiagnostic(() => report(
      `${commandId} mutated or lost continuous observation of repository state; `
      + `observer=${settlement!.status}.`
    ));
    return 1;
  }
  return result!;
}
