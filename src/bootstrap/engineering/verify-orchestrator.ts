import path from 'node:path';
import {
  prepareWorkspaceVerificationRequest,
  verifyWorkspaceResult,
  type PreparedWorkspaceVerificationRequest,
  type WorkspaceVerificationRequestOptions
} from '../../application/verify-workspace.ts';
import type { VerificationReport } from '../../assurance/verification/contract/types.ts';
import type { LockFile } from '../../compiler/contract.ts';
import { assertWorkspaceWriteLease } from '../../adapters/filesystem/write-lease.ts';
import { readLockFile } from '../../adapters/workspace/lock.ts';
import { executePipelineStage } from './pipeline-kernel.ts';
import { settlePipelineFailure } from '../../application/pipeline-failure.ts';
import type { PipelineExecutionContext } from '../../adapters/compilation-protocol/types.ts';
import { writeBlockedVerificationSnapshot } from '../../adapters/verification/blocked-verification-publication.ts';
import type { StagedVerificationProof } from '../../adapters/verification/staged-verification-proof.ts';
import { verifyProject } from '../../adapters/verification/verify-project.ts';
import {
  assertIsolatedVerificationCapability,
  type IsolatedVerificationCapability
} from '../../execution/isolated-verification-capability.ts';
export type { StagedVerificationProof };

export interface VerifyWorkspaceOptions extends
  WorkspaceVerificationRequestOptions<
    IsolatedVerificationCapability,
    StagedVerificationProof
  > {}

type PreparedVerifyWorkspaceRequest = PreparedWorkspaceVerificationRequest<
  IsolatedVerificationCapability,
  StagedVerificationProof
>;

function verifyWorkspaceCore(
  workspaceRoot: string,
  request: PreparedVerifyWorkspaceRequest,
  context: PipelineExecutionContext
) {
  const lane = request.lane;
  const isolatedVerificationCapability = request.isolatedVerificationCapability;
  const isolated = isolatedVerificationCapability !== undefined;
  const beforeCommit = () => assertWorkspaceWriteLease(workspaceRoot, context.workspaceWriteLease);
  return verifyWorkspaceResult(lane, {
    readLock: () => readLockFile(workspaceRoot),
    ...(isolated
      ? {
          admit: () => assertIsolatedVerificationCapability(
            workspaceRoot,
            isolatedVerificationCapability
          )
        }
      : {}),
    verify: lock => verifyProject(workspaceRoot, lock, lane, {
      emitTiming: isolated ? false : request.emitTiming,
      isolated,
      beforeCommit,
      ...(context.onEvent
        ? { pipelineObserver: { onEvent: context.onEvent, transactionId: context.transactionId } }
        : {}),
      signal: request.signal,
      ...(request.stagedVerificationProof
        ? { stagedVerificationProof: request.stagedVerificationProof }
        : {}),
      ...(isolated
        ? { stagingTreeOptions: { workspaceWriteLease: context.workspaceWriteLease } }
        : {})
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
  const request = prepareWorkspaceVerificationRequest(options);
  return executePipelineStage(
    workspaceRoot,
    'verify',
    context,
    stageContext => verifyWorkspaceCore(workspaceRoot, request, stageContext),
    {
      extractLock: result => result.lock,
      preserveOwnedPassStates: true
    }
  );
}
