import path from 'node:path';
import { verifyWorkspaceResult } from '../../application/verify-workspace.ts';
import type { VerificationLane, VerificationReport } from '../../assurance/verification/contract/types.ts';
import type { LockFile } from '../../compiler/contract.ts';
import { assertWorkspaceWriteLease } from '../../adapters/filesystem/write-lease.ts';
import { readLockFile } from '../../adapters/workspace/lock.ts';
import { executePipelineStage } from '../../adapters/compilation/pipeline/kernel.ts';
import { settlePipelineFailure } from '../../adapters/compilation/pipeline/failure.ts';
import type { PipelineExecutionContext } from '../../adapters/compilation-protocol/types.ts';
import { writeBlockedVerificationSnapshot } from '../../adapters/verification/blocked-verification-publication.ts';
import type { StagedVerificationProof } from '../../adapters/verification/staged-verification-proof.ts';
import { verifyProject } from '../../adapters/verification/verify-project.ts';
import { assertIsolatedVerificationCapability, type IsolatedVerificationCapability } from '../../execution/isolated-verification-capability.ts';
export type { StagedVerificationProof };

export interface VerifyWorkspaceOptions {
  readonly emitTiming?: boolean;
  readonly isolatedVerificationCapability?: IsolatedVerificationCapability;
  readonly lane?: VerificationLane;
  readonly signal?: AbortSignal;
  readonly stagedVerificationProof?: StagedVerificationProof;
}

function verifyWorkspaceCore(workspaceRoot: string, options: VerifyWorkspaceOptions, context: PipelineExecutionContext) {
  const lane = options.lane ?? 'all';
  const isolated = options.isolatedVerificationCapability !== undefined;
  const beforeCommit = () => assertWorkspaceWriteLease(workspaceRoot, context.workspaceWriteLease);
  return verifyWorkspaceResult(lane, {
    readLock: () => readLockFile(workspaceRoot),
    ...(isolated ? { admit: () => assertIsolatedVerificationCapability(workspaceRoot, options.isolatedVerificationCapability) } : {}),
    verify: lock => verifyProject(workspaceRoot, lock, lane, {
      emitTiming: isolated ? false : options.emitTiming,
      isolated,
      beforeCommit,
      ...(context.onEvent
        ? { pipelineObserver: { onEvent: context.onEvent, transactionId: context.transactionId } }
        : {}),
      signal: options.signal,
      ...(options.stagedVerificationProof ? { stagedVerificationProof: options.stagedVerificationProof } : {}),
      ...(isolated ? { stagingTreeOptions: { workspaceWriteLease: context.workspaceWriteLease } } : {})
    }),
    publishBlocked: (lock, selectedLane, failure) =>
      writeBlockedVerificationSnapshot(workspaceRoot, lock, selectedLane, failure, beforeCommit),
    settleFailure: (failure, publish) => settlePipelineFailure(failure, [{
      operation: 'verification-blocked-snapshot', run: publish
    }])
  });
}

export async function verifyWorkspace(
  workspaceRoot = process.cwd(),
  options: VerifyWorkspaceOptions = {},
  context?: PipelineExecutionContext
): Promise<{ lock: LockFile; report: VerificationReport }> {
  workspaceRoot = path.resolve(workspaceRoot);
  const { isolatedVerificationCapability, lane, signal, stagedVerificationProof } = options;
  // Capture request values, not new authority. Capability owners still admit
  // the original references; an AbortSignal must remain live rather than cloned.
  options = Object.freeze({
    isolatedVerificationCapability, lane, signal, stagedVerificationProof,
    emitTiming: isolatedVerificationCapability === undefined ? options.emitTiming : undefined
  });
  return executePipelineStage(
    workspaceRoot,
    'verify',
    context,
    (stageContext) => verifyWorkspaceCore(workspaceRoot, options, stageContext),
    {
      extractLock: (result) => result.lock,
      preserveOwnedPassStates: true
    }
  );
}
