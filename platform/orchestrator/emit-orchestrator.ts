import { writeCiArtifactManifest } from '../compiler/emit/ci-artifacts.ts';
import { lockProject } from '../compiler/emit/lock-project.ts';
import { writeExplainGraph } from '../compiler/emit/write-explain-graph.ts';
import { writeLocalViews } from '../compiler/emit/write-local-views.ts';
import { writeReviewSummary } from '../compiler/emit/write-review-summary.ts';
import type { AcceptanceCoverageReport } from '../shared/acceptance-types.ts';
import { CompilerError } from '../shared/errors.ts';
import type { ExplainGraph } from '../shared/explain-types.ts';
import { pathExists, readJson } from '../shared/fs.ts';
import type { LockFile } from '../shared/lock-types.ts';
import { assertPassStatus } from '../shared/lock-utils.ts';
import { getWorkspacePaths, resolveWorkspaceLockPath, resolveWorkspaceProvenancePath } from '../shared/paths.ts';
import type { ProvenanceFile } from '../shared/provenance-types.ts';
import type { ReviewSummary } from '../shared/review-types.ts';
import type { VerificationReport } from '../shared/verification-types.ts';

export async function lockWorkspace(workspaceRoot = process.cwd()): Promise<LockFile> {
  const lock = await readJson<LockFile>(await resolveWorkspaceLockPath(workspaceRoot));
  await lockProject(workspaceRoot, lock);
  return lock;
}

export async function explainWorkspace(
  workspaceRoot = process.cwd()
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
  const lock = await readJson<LockFile>(await resolveWorkspaceLockPath(workspaceRoot));

  assertPassStatus(lock, 'lock', 'succeeded', new CompilerError('EXPLAIN-BLOCKED-001', 'lock must succeed before explain'));

  const provenance = await readJson<ProvenanceFile>(await resolveWorkspaceProvenancePath(workspaceRoot));
  const report = await readJson<VerificationReport>(verificationReportPath);
  const coverage = await readJson<AcceptanceCoverageReport>(acceptanceCoveragePath);
  const graph = await writeExplainGraph(workspaceRoot, lock, provenance);
  const refreshedProvenance = await readJson<ProvenanceFile>(await resolveWorkspaceProvenancePath(workspaceRoot));
  const reviewSummary = await writeReviewSummary(workspaceRoot, lock, refreshedProvenance, report, coverage);
  await writeLocalViews(workspaceRoot);
  return { lock, provenance: refreshedProvenance, report, graph, reviewSummary };
}

async function refreshReviewArtifacts(workspaceRoot: string, lock: LockFile): Promise<ReviewSummary | null> {
  const {
    acceptanceCoveragePath,
    explainGraphPath,
    policyReportPath,
    reviewSummaryPath,
    verificationReportPath
  } = getWorkspacePaths(workspaceRoot);
  const readableProvenancePath = await resolveWorkspaceProvenancePath(workspaceRoot);
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

  const provenance = await readJson<ProvenanceFile>(readableProvenancePath);
  const report = await readJson<VerificationReport>(verificationReportPath);
  const coverage = await readJson<AcceptanceCoverageReport>(acceptanceCoveragePath);
  const reviewSummary = await writeReviewSummary(workspaceRoot, lock, provenance, report, coverage);
  await writeLocalViews(workspaceRoot);
  return reviewSummary;
}

export async function writeWorkspaceArtifacts(workspaceRoot = process.cwd()): Promise<{
  manifest: Awaited<ReturnType<typeof writeCiArtifactManifest>>;
  reviewSummary: ReviewSummary | null;
}> {
  const manifest = await writeCiArtifactManifest(workspaceRoot);
  const lock = await readJson<LockFile>(await resolveWorkspaceLockPath(workspaceRoot));
  const reviewSummary = await refreshReviewArtifacts(workspaceRoot, lock);
  return { manifest, reviewSummary };
}
