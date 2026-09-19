import path from 'node:path';
import { explainWorkspaceResult, publishWorkspaceArtifactSet, refreshWorkspaceReview } from '../../application/explain-workspace.ts';
import { lockWorkspaceResult } from '../../application/lock-workspace.ts';
import { createWorkspaceWriteCommitFence, withWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../adapters/filesystem/write-lease.ts';
import type { LockFile } from '../../compiler/contract.ts';
import { readLockFile } from '../../adapters/workspace/lock.ts';
import { prepareReviewRefreshRead, readRequiredExplanationProvenance, readRequiredExplanationVerification } from '../../adapters/workspace/explanation-read.ts';
import { buildCiArtifactManifest, writeCiArtifactManifest } from '../../adapters/compilation/emit/ci-artifacts.ts';
import { lockProject } from '../../adapters/compilation/emit/lock-project.ts';
import { publishReviewSummary } from '../../adapters/compilation/emit/publish-review-summary.ts';
import { semanticViewArtifactsAreCurrent } from '../../adapters/compilation/emit/semantic-view-artifact-contract.ts';
import { writeExplainGraph } from '../../adapters/compilation/emit/write-explain-graph.ts';
import { executePipelineStage } from './pipeline-kernel.ts';
import type { PipelineExecutionContext } from '../../adapters/compilation-protocol/types.ts';

/** Public observation: no publication is inferred from an inventory read. */
export function observeWorkspaceArtifacts(workspaceRoot = process.cwd()) {
  return buildCiArtifactManifest(workspaceRoot);
}

export async function lockWorkspace(
  workspaceRoot = process.cwd(),
  context?: PipelineExecutionContext
): Promise<LockFile> {
  workspaceRoot = path.resolve(workspaceRoot);
  return executePipelineStage(workspaceRoot, 'lock', context, stageContext => {
    const fence = createWorkspaceWriteCommitFence(workspaceRoot, stageContext.workspaceWriteLease);
    return lockWorkspaceResult({
      readLock: () => readLockFile(workspaceRoot),
      publishLock: lock => lockProject(workspaceRoot, lock, fence)
    });
  }, { extractLock: lock => lock });
}

export async function explainWorkspace(
  workspaceRoot = process.cwd(),
  context?: PipelineExecutionContext
): Promise<Awaited<ReturnType<typeof explainWorkspaceResult>>> {
  workspaceRoot = path.resolve(workspaceRoot);
  return executePipelineStage(workspaceRoot, 'emit', context, stageContext => {
    const fence = createWorkspaceWriteCommitFence(workspaceRoot, stageContext.workspaceWriteLease);
    return explainWorkspaceResult({
      readLock: () => readLockFile(workspaceRoot),
      readProvenance: label => readRequiredExplanationProvenance(workspaceRoot, label),
      readVerification: () => readRequiredExplanationVerification(workspaceRoot),
      publishGraph: (lock, provenance) => writeExplainGraph(workspaceRoot, lock, provenance, fence),
      publishReview: (lock, provenance, report, coverage) =>
        publishReviewSummary(workspaceRoot, lock, provenance, report, coverage, fence)
    });
  }, { extractLock: result => result.lock });
}

export async function writeWorkspaceArtifacts(
  workspaceRoot = process.cwd(),
  workspaceWriteLease?: WorkspaceWriteLeaseToken
) {
  workspaceRoot = path.resolve(workspaceRoot);
  return withWorkspaceWriteLease(workspaceRoot, workspaceWriteLease, token => {
    const fence = createWorkspaceWriteCommitFence(workspaceRoot, token);
    return publishWorkspaceArtifactSet({
      fence,
      publishManifest: () => writeCiArtifactManifest(workspaceRoot, fence),
      readLock: () => readLockFile(workspaceRoot),
      refreshReview: lock => refreshWorkspaceReview(lock, {
        prepareRead: () => prepareReviewRefreshRead(workspaceRoot),
        isCurrent: semanticViewArtifactsAreCurrent,
        publishReview: (current, provenance, report, coverage) =>
          publishReviewSummary(workspaceRoot, current, provenance, report, coverage, fence)
      })
    });
  });
}
