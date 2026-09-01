import {
  armWindowsRepositoryChangeObserver,
  settleWindowsRepositoryChangeObserver
} from '../../runtime-state/physical/runtime/windows-repository-change-observer.ts';
import type { SecBoundSemanticOperation } from '../../system-architecture/operation/semantic.ts';
import { compilerRoot } from '../../workspace/runtime/paths.ts';
import {
  resolveRepositoryObservationRoots
} from './repository-observation.ts';

export interface RepositoryMutationFenceOptions {
  readonly operation: SecBoundSemanticOperation;
  readonly repositoryRoot?: string;
  readonly report?: (message: string) => void;
}

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
  const repositoryRoot = options.repositoryRoot ?? compilerRoot;
  const report = options.report ?? console.error;
  const roots = await resolveRepositoryObservationRoots(repositoryRoot, options.operation);
  const observerResolution = await armWindowsRepositoryChangeObserver({
    roots,
    deadlineAtUnixMs: Date.now() + 30_000
  });
  if (observerResolution.status !== 'ready') {
    report(
      `${commandId} strict-zero-write-unproven: native repository observation is unavailable `
      + `(${observerResolution.reason}).`
    );
    return 1;
  }
  let result: number | undefined;
  let primaryFailure: unknown;
  try {
    result = await operation();
  } catch (error) {
    primaryFailure = error;
  }
  const settlement = await settleWindowsRepositoryChangeObserver(observerResolution.observer);
  if (primaryFailure !== undefined) throw primaryFailure;
  if (settlement.status !== 'zero-events') {
    report(
      `${commandId} mutated or lost continuous observation of repository state; `
      + `observer=${settlement.status}.`
    );
    return 1;
  }
  return result!;
}
