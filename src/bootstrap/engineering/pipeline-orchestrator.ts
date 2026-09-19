import path from 'node:path';
import { pipelineStageBoundary } from '../../adapters/compilation-protocol/execution-boundaries.ts';

import type { ExplainGraph } from '../../semantics/projection/explain.ts';
import type { VerificationReport } from '../../assurance/verification/contract/types.ts';
import { type ReviewSummary } from '../../assurance/verification/review/contract/types.ts';
import { assertWorkspaceWriteLease, withWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../adapters/filesystem/write-lease.ts';
import type { LockFile, PlanFile } from '../../compiler/contract.ts';
import { readLockFile } from '../../adapters/workspace/lock.ts';
import { bindPipelineCompileRequest, type PipelineCompileRequest } from '../../application/pipeline-request.ts';
import { completeWorkspaceCompilationTransaction } from '../../application/compile-workspace.ts';
import { emitPipelineExecutionBoundary } from '../../adapters/compilation/pipeline/journal.ts';
import { withPipelineTransaction } from '../../adapters/compilation/pipeline/kernel.ts';
import { withLeaseObservationMonitor } from '../../adapters/compilation/pipeline/lease-monitor.ts';
import { requirePipelineSemanticContext } from '../../adapters/compilation/pipeline/semantic-context.ts';
import { buildPipelineCompletionProof } from '../../adapters/verification/pipeline-completion-proof.ts';
import { revalidateStagedVerificationProofAfterPipeline } from '../../adapters/verification/pipeline-staged-proof.ts';
export { buildPipelineCompletionProof } from '../../adapters/verification/pipeline-completion-proof.ts';
export type { PipelineCompletionProofStageEvidence } from '../../adapters/verification/pipeline-completion-proof.ts';
import {
  type PipelineEventHandler,
  type PipelineSemanticContext,
  type PipelineStageId
} from '../../adapters/compilation-protocol/types.ts';
import type { PipelineCompletionProof } from '../../assurance/verification/pipeline/completion-proof.ts';
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

const PIPELINE_PENDING_TRANSACTION_ID = 'tx:pending';

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

export interface CompileWorkspaceResult {
  transactionId: string;
  completedStages: PipelineStageId[];
  semanticContext?: PipelineSemanticContext;
  plan?: PlanFile;
  lock: LockFile;
  verificationReport?: VerificationReport;
  explainGraph?: ExplainGraph;
  reviewSummary?: ReviewSummary;
  completionProof?: PipelineCompletionProof;
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
  await emitPipelineExecutionBoundary(
    bindings.onEvent,
    PIPELINE_PENDING_TRANSACTION_ID,
    'pipeline-lease-bind'
  );
  return withWorkspaceWriteLease(workspaceRoot, bindings.requestedLease, async workspaceWriteLease => {
    await emitPipelineExecutionBoundary(
      bindings.onEvent,
      PIPELINE_PENDING_TRANSACTION_ID,
      'pipeline-lease-bound'
    );
    return withMonitoredWorkspaceWriteLease(workspaceRoot, workspaceWriteLease, async leaseSignal => {
      await emitPipelineExecutionBoundary(
        bindings.onEvent,
        PIPELINE_PENDING_TRANSACTION_ID,
        'pipeline-transaction-bootstrap'
      );
      return withPipelineTransaction(
        workspaceRoot,
        request.source,
        stages,
        bindings.onEvent,
        async context => completeWorkspaceCompilationTransaction(context.transactionId, stages, {
          beforeStage: async stage => {
            await assertWorkspaceWriteLease(workspaceRoot, workspaceWriteLease);
            await emitPipelineExecutionBoundary(context.onEvent, context.transactionId, pipelineStageBoundary(stage));
          },
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
      ).then(result => ({
        transactionId: result.transactionId,
        completedStages: [...result.completedStages],
        ...(result.semanticContext ? { semanticContext: result.semanticContext } : {}),
        ...(result.plan ? { plan: result.plan } : {}),
        lock: result.lock,
        ...(result.verificationReport ? { verificationReport: result.verificationReport } : {}),
        ...(result.explainGraph ? { explainGraph: result.explainGraph } : {}),
        ...(result.reviewSummary ? { reviewSummary: result.reviewSummary } : {}),
        ...(result.completionProof ? { completionProof: result.completionProof } : {})
      }));
    });
  });
}
