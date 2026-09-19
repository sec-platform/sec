import path from 'node:path';
import { assertWorkspaceWriteLease, withWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../adapters/filesystem/write-lease.ts';
import { readLockFile } from '../../adapters/workspace/lock.ts';
import { bindPipelineCompileRequest, type PipelineCompileRequest } from '../../application/pipeline-request.ts';
import {
  completeWorkspaceCompilationTransaction,
  coordinateWorkspaceCompilationAdmission,
  projectWorkspaceCompilationResult,
  type CompileWorkspaceResult
} from '../../application/compile-workspace.ts';
import { emitPipelineExecutionBoundary } from '../../adapters/compilation/pipeline/journal.ts';
import { withPipelineTransaction } from '../../adapters/compilation/pipeline/kernel.ts';
import { withLeaseObservationMonitor } from '../../adapters/compilation/pipeline/lease-monitor.ts';
import { requirePipelineSemanticContext } from '../../adapters/compilation/pipeline/semantic-context.ts';
import { buildPipelineCompletionProof } from '../../adapters/verification/pipeline-completion-proof.ts';
import { revalidateStagedVerificationProofAfterPipeline } from '../../adapters/verification/pipeline-staged-proof.ts';
export { buildPipelineCompletionProof } from '../../adapters/verification/pipeline-completion-proof.ts';
export type { PipelineCompletionProofStageEvidence } from '../../adapters/verification/pipeline-completion-proof.ts';
import { type PipelineEventHandler } from '../../adapters/compilation-protocol/types.ts';
export { assertPipelineCompletionProofInvariant, createPipelineCompletionProof } from '../../assurance/verification/pipeline/completion-proof.ts';
export type { PipelineCompletionProofEvidence } from '../../assurance/verification/pipeline/completion-proof.ts';
import { resolveWorkspace } from './block-orchestrator.ts';
import { composeWorkspace } from './compose-orchestrator.ts';
import { explainWorkspace, lockWorkspace } from './emit-orchestrator.ts';
import {
  assertIsolatedVerificationCapability,
  type IsolatedVerificationCapability
} from '../../execution/isolated-verification-capability.ts';
import { runWorkspaceSemanticFrontend } from './semantic-orchestrator.ts';
import {
  verifyWorkspace,
  type StagedVerificationProof
} from './verify-orchestrator.ts';

export interface CompileWorkspaceOptions extends PipelineCompileRequest {
  onEvent?: PipelineEventHandler;
  isolatedVerificationCapability?: IsolatedVerificationCapability;
  stagedVerificationProof?: StagedVerificationProof;
  workspaceWriteLease?: WorkspaceWriteLeaseToken;
}

export async function withMonitoredWorkspaceWriteLease<T>(
  workspaceRoot: string,
  workspaceWriteLease: WorkspaceWriteLeaseToken,
  callback: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const root = path.resolve(workspaceRoot);
  return withLeaseObservationMonitor(
    () => assertWorkspaceWriteLease(root, workspaceWriteLease), callback
  );
}

export async function compileWorkspace(
  workspaceRoot = process.cwd(),
  options: CompileWorkspaceOptions = {}
): Promise<CompileWorkspaceResult> {
  workspaceRoot = path.resolve(workspaceRoot);
  const request = bindPipelineCompileRequest(options);
  const { onEvent, isolatedVerificationCapability, stagedVerificationProof, workspaceWriteLease: requestedLease } = options;
  if (onEvent !== undefined && typeof onEvent !== 'function') {
    throw new TypeError('Pipeline event handler must be callable');
  }
  const bindings = Object.freeze({ onEvent, isolatedVerificationCapability, stagedVerificationProof, requestedLease });
  const { stages } = request;
  if (bindings.isolatedVerificationCapability) {
    assertIsolatedVerificationCapability(workspaceRoot, bindings.isolatedVerificationCapability);
  }
  return coordinateWorkspaceCompilationAdmission({
    emitBoundary: (transactionId, boundary) =>
      emitPipelineExecutionBoundary(bindings.onEvent, transactionId, boundary),
    withLease: callback =>
      withWorkspaceWriteLease(workspaceRoot, bindings.requestedLease, callback),
    withLeaseMonitor: (workspaceWriteLease, callback) =>
      withMonitoredWorkspaceWriteLease(workspaceRoot, workspaceWriteLease, callback),
    runTransaction: (leaseSignal, workspaceWriteLease) =>
      withPipelineTransaction(
        workspaceRoot,
        request.source,
        stages,
        bindings.onEvent,
        async context => completeWorkspaceCompilationTransaction(context.transactionId, stages, {
          assertStageLease: () =>
            assertWorkspaceWriteLease(workspaceRoot, workspaceWriteLease),
          emitStageBoundary: (_stage, boundary) =>
            emitPipelineExecutionBoundary(context.onEvent, context.transactionId, boundary),
          resolve: () => resolveWorkspace(workspaceRoot, context),
          semantic: () => runWorkspaceSemanticFrontend(workspaceRoot, context),
          compose: async () => {
            requirePipelineSemanticContext(context);
            return composeWorkspace(workspaceRoot, { signal: leaseSignal }, context);
          },
          verify: async () => {
            requirePipelineSemanticContext(context);
            return verifyWorkspace(
              workspaceRoot,
              {
                lane: request.verificationLane,
                signal: leaseSignal,
                ...(bindings.stagedVerificationProof
                  ? { stagedVerificationProof: bindings.stagedVerificationProof }
                  : {}),
                ...(bindings.isolatedVerificationCapability
                  ? { isolatedVerificationCapability: bindings.isolatedVerificationCapability }
                  : {})
              },
              context
            );
          },
          lock: async () => {
            requirePipelineSemanticContext(context);
            await lockWorkspace(workspaceRoot, context);
          },
          emit: async () => {
            requirePipelineSemanticContext(context);
            return explainWorkspace(workspaceRoot, context);
          },
          readLock: () => readLockFile(workspaceRoot),
          buildCompletionProof: result => buildPipelineCompletionProof(workspaceRoot, {
            transactionId: result.transactionId,
            completedStages: result.completedStages,
            semanticContext: result.semanticContext,
            lock: result.emittedLock,
            verificationReport: result.verificationReport,
            provenance: result.emittedProvenance,
            explainGraph: result.explainGraph,
            reviewSummary: result.reviewSummary
          }),
          ...(bindings.stagedVerificationProof ? {
            revalidateStagedProof: async lock => {
              await assertWorkspaceWriteLease(workspaceRoot, workspaceWriteLease);
              await revalidateStagedVerificationProofAfterPipeline(
                workspaceRoot,
                lock,
                bindings.stagedVerificationProof!
              );
              await assertWorkspaceWriteLease(workspaceRoot, workspaceWriteLease);
            }
          } : {})
        }),
        workspaceWriteLease
      ).then(projectWorkspaceCompilationResult)
  });
}
