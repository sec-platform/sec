import { writeCiArtifactManifest } from '../compiler/emit/ci-artifacts.ts';
import { lockProject } from '../compiler/emit/lock-project.ts';
import { publishReviewSummary } from '../compiler/emit/publish-review-summary.ts';
import { semanticViewArtifactsAreCurrent } from '../compiler/emit/semantic-view-artifact-contract.ts';
import { writeExplainGraph } from '../compiler/emit/write-explain-graph.ts';
import { writeLocalViews } from '../compiler/emit/write-local-views.ts';
import { CompilerError } from '../shared/errors.ts';
import type { ExplainGraph } from '../shared/explain-types.ts';
import type { LockFile } from '../shared/lock-types.ts';
import { assertPassStatus, readLockFile } from '../shared/lock-utils.ts';
import { getWorkspacePaths, resolveWorkspaceProvenancePath } from '../shared/paths.ts';
import { executePipelineStage } from '../shared/pipeline-kernel.ts';
import type { PipelineExecutionContext } from '../shared/pipeline-types.ts';
import { readOptionalProvenanceFileV1 } from '../shared/provenance-authority.ts';
import type { ProvenanceFile } from '../shared/provenance-types.ts';
import { readOptionalRetainedJsonV1 } from '../shared/retained-file-read.ts';
import type { ReviewSummary } from '../shared/review-types.ts';
import { readOptionalCanonicalVerificationArtifactSetV1 } from '../shared/verification-artifact-authority.ts';
import type { VerificationReport } from '../shared/verification-types.ts';
import {
  createWorkspaceWriteCommitFence,
  withWorkspaceWriteLease,
  type WorkspaceWriteLeaseToken
} from '../shared/workspace-write-lease.ts';

function readOptionalValidatedProvenance(filePath: string, label: string): ProvenanceFile | null {
  try {
    return readOptionalProvenanceFileV1(filePath, label);
  } catch (error) {
    throw new CompilerError(
      'EXPLAIN-BLOCKED-003',
      `${label} is malformed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function readRequiredValidatedProvenance(filePath: string, label: string): ProvenanceFile {
  const value = readOptionalValidatedProvenance(filePath, label);
  if (value === null) throw new CompilerError('EXPLAIN-BLOCKED-003', `${label} is missing`);
  return value;
}

function readRequiredVerificationArtifacts(workspaceRoot: string) {
  try {
    const artifacts = readOptionalCanonicalVerificationArtifactSetV1(
      workspaceRoot,
      'Explain Verification artifact set'
    );
    if (artifacts === null) {
      throw new CompilerError('EXPLAIN-BLOCKED-003', 'Verification artifact set is missing');
    }
    return artifacts;
  } catch (error) {
    if (error instanceof CompilerError) throw error;
    throw new CompilerError(
      'EXPLAIN-BLOCKED-003',
      `Verification artifact closure is not canonical: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function lockWorkspaceCore(
  workspaceRoot: string,
  context: PipelineExecutionContext
): Promise<LockFile> {
  const lock = readLockFile(workspaceRoot);
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
  const commitFence = createWorkspaceWriteCommitFence(workspaceRoot, context.workspaceWriteLease);
  const lock = readLockFile(workspaceRoot);
  assertPassStatus(lock, 'lock', 'succeeded', new CompilerError('EXPLAIN-BLOCKED-001', 'lock must succeed before explain'));

  const provenancePath = await resolveWorkspaceProvenancePath(workspaceRoot);
  const provenance = readRequiredValidatedProvenance(provenancePath, 'Provenance report');
  const verificationArtifacts = readRequiredVerificationArtifacts(workspaceRoot);
  const report = verificationArtifacts.verificationReport;
  const coverage = verificationArtifacts.acceptanceCoverage;

  const graph = await writeExplainGraph(workspaceRoot, lock, provenance, commitFence);
  const refreshedProvenance = readRequiredValidatedProvenance(
    await resolveWorkspaceProvenancePath(workspaceRoot),
    'Refreshed Provenance report'
  );
  const reviewSummary = await publishReviewSummary(
    workspaceRoot,
    lock,
    refreshedProvenance,
    report,
    coverage,
    commitFence
  );
  await writeLocalViews(workspaceRoot, commitFence);
  const finalLock = readLockFile(workspaceRoot);
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
  const { explainGraphPath, reviewSummaryPath } = getWorkspacePaths(workspaceRoot);
  const readableProvenancePath = await resolveWorkspaceProvenancePath(workspaceRoot);
  if (lock.passStatus.lock !== 'succeeded' || lock.passStatus.emit !== 'succeeded') return null;

  const graph = readOptionalRetainedJsonV1<ExplainGraph>(explainGraphPath, 'Explain graph');
  const provenance = readOptionalValidatedProvenance(readableProvenancePath, 'Provenance report');
  const priorReview = readOptionalRetainedJsonV1<unknown>(reviewSummaryPath, 'Review summary');
  const verificationArtifacts = readOptionalCanonicalVerificationArtifactSetV1(
    workspaceRoot,
    'Review refresh Verification artifact set'
  );
  if (graph === null || provenance === null || priorReview === null || verificationArtifacts === null) return null;
  if (!semanticViewArtifactsAreCurrent(lock, graph)) return null;

  const reviewSummary = await publishReviewSummary(
    workspaceRoot,
    lock,
    provenance,
    verificationArtifacts.verificationReport,
    verificationArtifacts.acceptanceCoverage,
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
    const lock = readLockFile(workspaceRoot);
    await commitFence();
    const reviewSummary = await refreshReviewArtifacts(workspaceRoot, lock, commitFence);
    return { manifest, reviewSummary };
  });
}
