import path from 'node:path';
import type { PipelineExecutionContext } from '../../adapters/compilation-protocol/types.ts';
import { emitPipelineExecutionBoundary } from '../../adapters/compilation/pipeline/journal.ts';
import { assertWorkspaceWriteLease } from '../../adapters/filesystem/write-lease.ts';
import { ensureProjectDependencies } from '../../adapters/toolchain/dependencies/runtime.ts';
import { assertIsolatedStagingTree } from '../../adapters/verification/assert-isolated-staging-tree.ts';
import { buildAcceptanceCoverage } from '../../adapters/verification/build-acceptance-coverage.ts';
import { runPolicyGate } from '../../adapters/verification/run-policy-gate.ts';
import { runRuntimeVerification } from '../../adapters/verification/run-runtime-verification.ts';
import {
  consumeStagedVerificationProof,
  revalidateStagedVerificationProof
} from '../../adapters/verification/staged-verification-proof.ts';
import { publishVerificationArtifactSet } from '../../adapters/verification/verification-artifact-publication.ts';
import { captureVerifyProjectOptions } from '../../adapters/verification/verify-invocation.ts';
import {
  assertStagedVerificationLiveContext,
  captureProductVerificationObservation,
  reportProductVerificationFailure,
  runFastVerification
} from '../../adapters/verification/verify-project.ts';
import { readLockFile } from '../../adapters/workspace/lock.ts';
import { checkProjectBeforeVerify } from '../../adapters/workspace/project-integrity.ts';
import { executeBlockedVerificationSnapshot } from '../../application/blocked-verification.ts';
import { settlePipelineFailure } from '../../application/pipeline-failure.ts';
import { executeProductVerification } from '../../application/product-verification.ts';
import {
  prepareWorkspaceVerificationRequest,
  verifyWorkspaceResult,
  type PreparedWorkspaceVerificationRequest,
  type WorkspaceVerificationRequestOptions
} from '../../application/verify-workspace.ts';
import type { VerificationReport } from '../../assurance/verification/contract/types.ts';
import type { StagedVerificationProof } from '../../assurance/verification/staged-proof/contract.ts';
import type { LockFile } from '../../compiler/contract.ts';
import {
  assertIsolatedVerificationCapability,
  type IsolatedVerificationCapability
} from '../../execution/isolated-verification-capability.ts';
import { executePipelineStage } from './pipeline-kernel.ts';
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
    verify: lock => {
      const invocation = captureVerifyProjectOptions({
        emitTiming: isolated ? false : request.emitTiming,
        isolated,
        beforeCommit,
        ...(context.onEvent
          ? {
              pipelineObserver: {
                onEvent: context.onEvent,
                transactionId: context.transactionId
              }
            }
          : {}),
        signal: request.signal,
        ...(request.stagedVerificationProof
          ? { stagedVerificationProof: request.stagedVerificationProof }
          : {}),
        ...(isolated
          ? {
              stagingTreeOptions: {
                workspaceWriteLease: context.workspaceWriteLease
              }
            }
          : {})
      });
      return executeProductVerification(
        lock,
        lane,
        {
          emitTiming: invocation.emitTiming,
          isolated: invocation.isolated === true,
          signal: invocation.signal,
          stagedVerificationProof: invocation.stagedVerificationProof
        },
        {
          now: () => Date.now(),
          beforeCommit: async () => {
            await invocation.beforeCommit?.();
          },
          emitBoundary: async boundary => {
            if (invocation.pipelineObserver === undefined) return;
            await emitPipelineExecutionBoundary(
              invocation.pipelineObserver.onEvent,
              invocation.pipelineObserver.transactionId,
              boundary
            );
          },
          preflight: () => checkProjectBeforeVerify(workspaceRoot),
          prepareIsolated: async input => {
            await ensureProjectDependencies(workspaceRoot, {
              beforeCommit: input.beforeCommit,
              installMode: 'prebound-only',
              signal: input.signal,
            });
            await assertIsolatedStagingTree(
              workspaceRoot,
              invocation.stagingTreeOptions
            );
          },
          consumeStagedProof: proof =>
            consumeStagedVerificationProof(workspaceRoot, lock, proof),
          assertStagedLiveContext: artifacts =>
            assertStagedVerificationLiveContext(workspaceRoot, lock, artifacts),
          revalidateStagedProof: proof =>
            revalidateStagedVerificationProof(workspaceRoot, lock, proof),
          runFast: input =>
            runFastVerification(
              workspaceRoot,
              input.isolated,
              input.signal,
              input.beforeCommit
            ),
          runRuntime: (mode, input) =>
            runRuntimeVerification(workspaceRoot, mode, {
              beforeCommit: input.beforeCommit,
              emitTiming: input.emitTiming,
              isolated: input.isolated,
              signal: input.signal,
              stagingTreeOptions: invocation.stagingTreeOptions,
              ...(input.isolated ? { stagingWorkspaceRoot: workspaceRoot } : {})
            }),
          buildCoverage: (runtime, fast) =>
            buildAcceptanceCoverage(workspaceRoot, lock, runtime, fast),
          captureObservation: captureProductVerificationObservation,
          publishArtifacts: (publicationLock, artifacts, commitFence) =>
            publishVerificationArtifactSet({
              workspaceRoot,
              lock: publicationLock,
              artifacts,
              commitFence
            }),
          reportFailure: report =>
            reportProductVerificationFailure(report, invocation.logger)
        }
      );
    },
    publishBlocked: (lock, selectedLane, failure) =>
      executeBlockedVerificationSnapshot(lock, selectedLane, failure, {
        runPolicy: () => runPolicyGate(workspaceRoot),
        buildCoverage: (runtime, fast) =>
          buildAcceptanceCoverage(workspaceRoot, lock, runtime, fast),
        publish: (publicationLock, artifacts) =>
          publishVerificationArtifactSet({
            workspaceRoot,
            lock: publicationLock,
            artifacts,
            commitFence: beforeCommit
          })
      }),
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
