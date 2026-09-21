import type { VerificationLane, VerificationReport } from '../assurance/verification/contract/types.ts';
import type { LockFile } from '../compiler/contract.ts';
import { ProjectIntegrityError } from '../workspace/contract/project-integrity.ts';

export interface WorkspaceVerificationRequestOptions<
  Capability = unknown,
  StagedProof = unknown
> {
  readonly emitTiming?: boolean;
  readonly isolatedVerificationCapability?: Capability;
  readonly lane?: VerificationLane;
  readonly signal?: AbortSignal;
  readonly stagedVerificationProof?: StagedProof;
}

export interface PreparedWorkspaceVerificationRequest<
  Capability = unknown,
  StagedProof = unknown
> {
  readonly emitTiming: boolean | undefined;
  readonly isolatedVerificationCapability: Capability | undefined;
  readonly lane: VerificationLane;
  readonly signal: AbortSignal | undefined;
  readonly stagedVerificationProof: StagedProof | undefined;
}

/**
 * Capture one verification request before any transaction or provider call.
 * The original AbortSignal remains live; isolated verification deliberately
 * does not inherit ordinary timing emission.
 */
export function prepareWorkspaceVerificationRequest<Capability, StagedProof>(
  options: WorkspaceVerificationRequestOptions<Capability, StagedProof> = {}
): PreparedWorkspaceVerificationRequest<Capability, StagedProof> {
  const isolatedVerificationCapability = options.isolatedVerificationCapability;
  return Object.freeze({
    isolatedVerificationCapability,
    lane: options.lane ?? 'all',
    signal: options.signal,
    stagedVerificationProof: options.stagedVerificationProof,
    emitTiming: isolatedVerificationCapability === undefined ? options.emitTiming : undefined
  });
}

export interface WorkspaceVerificationOperations {
  readLock(): LockFile;
  admit?(): void;
  verify(lock: LockFile): Promise<VerificationReport>;
  publishBlocked(lock: LockFile, lane: Exclude<VerificationLane, 'runtime'>, failure: unknown): Promise<void>;
  settleFailure(failure: unknown, publish: () => Promise<void>): Promise<never>;
}

/** Coordinate the already selected verification profile. Admission failures
 * remain outside failed-report publication; only integrity failures on lanes
 * that own fast verification request that snapshot. Physical settlement is
 * injected from the existing pipeline owner, not replaced by diagnostic output. */
export async function verifyWorkspaceResult(lane: VerificationLane, operations: WorkspaceVerificationOperations) {
  const { readLock, admit, verify, publishBlocked, settleFailure } = operations;
  if ([readLock, verify, publishBlocked, settleFailure].some(fn => typeof fn !== 'function')
      || (admit !== undefined && typeof admit !== 'function')) {
    throw new TypeError('Workspace verification operations must be callable');
  }
  const lock = readLock.call(operations);
  admit?.call(operations);
  try {
    const report = await verify.call(operations, lock);
    return { lock, report };
  } catch (failure) {
    if (lane !== 'runtime' && failure instanceof ProjectIntegrityError) {
      return settleFailure.call(operations, failure,
        () => publishBlocked.call(operations, lock, lane, failure));
    }
    throw failure;
  }
}
