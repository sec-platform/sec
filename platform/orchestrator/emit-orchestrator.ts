import { writeCiArtifactManifest } from '../compiler/emit/ci-artifacts.ts';
import { lockProject } from '../compiler/emit/lock-project.ts';
import { semanticViewArtifactsAreCurrent } from '../compiler/emit/semantic-view-artifact-contract.ts';
import { writeExplainGraph } from '../compiler/emit/write-explain-graph.ts';
import { writeLocalViews } from '../compiler/emit/write-local-views.ts';
import { writeReviewSummary } from '../compiler/emit/write-review-summary.ts';
import type { AcceptanceCoverageReport } from '../shared/acceptance-types.ts';
import { CompilerError } from '../shared/errors.ts';
import type { ExplainGraph } from '../shared/explain-types.ts';
import { pathExists, readJson } from '../shared/fs.ts';
import type { LockFile } from '../shared/lock-types.ts';
import { assertPassStatus, readLockFile } from '../shared/lock-utils.ts';
import { getWorkspacePaths, resolveWorkspaceProvenancePath } from '../shared/paths.ts';
import { executePipelineStage } from '../shared/pipeline-kernel.ts';
import type { PipelineExecutionContext } from '../shared/pipeline-types.ts';
import type { ProvenanceFile } from '../shared/provenance-types.ts';
import type { ReviewSummary } from '../shared/review-types.ts';
import type { VerificationReport } from '../shared/verification-types.ts';
import {
  createWorkspaceWriteCommitFence,
  withWorkspaceWriteLease,
  type WorkspaceWriteLeaseToken
} from '../shared/workspace-write-lease.ts';

async function lockWorkspaceCore(
  workspaceRoot: string,
  context: PipelineExecutionContext
): Promise<LockFile> {
  const lock = await readLockFile(workspaceRoot);
  const commitFence = createWorkspaceWriteCommitFence(workspaceRoot, context.workspaceWriteLease);
  await lockProject(workspaceRoot, lock, commitFence);
  return lock;
}

export async function lockWorkspace(
  workspaceRoot = process.cwd(),
  context?: PipelineExecutionContext
): Promise<LockFile> {
  return executePipelineStage(
    workspaceRoot,
    'lock',
    context,
    (stageContext) => lockWorkspaceCore(workspaceRoot, stageContext),
    { extractLock: (lock) => lock }
  );
}

async function explainWorkspaceCore(
  workspaceRoot: string,
  context: PipelineExecutionContext
): Promise<{
  lock: LockFile;
  provenance: ProvenanceFile;
  report: VerificationReport;
  graph: ExplainGraph;
  reviewSummary: ReviewSummary;
}> {
  const {
    acceptanceCoveragePath,
    verificationReportPath
  } = getWorkspacePaths(workspaceRoot);
  const commitFence = createWorkspaceWriteCommitFence(workspaceRoot, context.workspaceWriteLease);
  const lock = await readLockFile(workspaceRoot);

  assertPassStatus(lock, 'lock', 'succeeded', new CompilerError('EXPLAIN-BLOCKED-001', 'lock must succeed before explain'));

  const provenance = await readJson<ProvenanceFile>(await resolveWorkspaceProvenancePath(workspaceRoot));
  const report = await readJson<VerificationReport>(verificationReportPath);
  const coverage = await readJson<AcceptanceCoverageReport>(acceptanceCoveragePath);
  const graph = await writeExplainGraph(workspaceRoot, lock, provenance, commitFence);
  const refreshedProvenance = await readJson<ProvenanceFile>(await resolveWorkspaceProvenancePath(workspaceRoot));
  const reviewSummary = await writeReviewSummary(
    workspaceRoot,
    lock,
    refreshedProvenance,
    report,
    coverage,
    commitFence
  );
  await writeLocalViews(workspaceRoot, commitFence);
  const finalLock = await readLockFile(workspaceRoot);
  return { lock: finalLock, provenance: refreshedProvenance, report, graph, reviewSummary };
}

export async function explainWorkspace(
  workspaceRoot = process.cwd(),
  context?: PipelineExecutionContext
): Promise<{
  lock: LockFile;
  provenance: ProvenanceFile;
  report: VerificationReport;
  graph: ExplainGraph;
  reviewSummary: ReviewSummary;
}> {
  return executePipelineStage(
    workspaceRoot,
    'emit',
    context,
    (stageContext) => explainWorkspaceCore(workspaceRoot, stageContext),
    { extractLock: (result) => result.lock }
  );
}

async function refreshReviewArtifacts(
  workspaceRoot: string,
  lock: LockFile,
  commitFence?: () => Promise<void>
): Promise<ReviewSummary | null> {
  const {
    acceptanceCoveragePath,
    explainGraphPath,
    policyReportPath,
    reviewSummaryPath,
    verificationReportPath
  } = getWorkspacePaths(workspaceRoot);
  const readableProvenancePath = await resolveWorkspaceProvenancePath(workspaceRoot);
  if (lock.passStatus.lock !== 'succeeded' || lock.passStatus.emit !== 'succeeded') return null;
  if (
    !(await pathExists(readableProvenancePath)) ||
    !(await pathExists(verificationReportPath)) ||
    !(await pathExists(acceptanceCoveragePath)) ||
    !(await pathExists(policyReportPath)) ||
    !(await pathExists(explainGraphPath)) ||
    !(await pathExists(reviewSummaryPath))
  ) {
    return null;
  }

  const graph = await readJson<ExplainGraph>(explainGraphPath);
  if (!semanticViewArtifactsAreCurrent(lock, graph)) return null;
  const provenance = await readJson<ProvenanceFile>(readableProvenancePath);
  const report = await readJson<VerificationReport>(verificationReportPath);
  const coverage = await readJson<AcceptanceCoverageReport>(acceptanceCoveragePath);
  const reviewSummary = await writeReviewSummary(
    workspaceRoot,
    lock,
    provenance,
    report,
    coverage,
    commitFence
  );
  await writeLocalViews(workspaceRoot, commitFence);
  return reviewSummary;
}

export async function writeWorkspaceArtifacts(
  workspaceRoot = process.cwd(),
  workspaceWriteLease?: WorkspaceWriteLeaseToken
): Promise<{
  manifest: Awaited<ReturnType<typeof writeCiArtifactManifest>>;
  reviewSummary: ReviewSummary | null;
}> {
  return withWorkspaceWriteLease(workspaceRoot, workspaceWriteLease, async (token) => {
    const commitFence = createWorkspaceWriteCommitFence(workspaceRoot, token);
    await commitFence();
    const manifest = await writeCiArtifactManifest(workspaceRoot, commitFence);
    const lock = await readLockFile(workspaceRoot);
    await commitFence();
    const reviewSummary = await refreshReviewArtifacts(workspaceRoot, lock, commitFence);
    return { manifest, reviewSummary };
  });
}
