import path from 'node:path';
import { readOptionalRetainedJson } from '../../adapters/runtime-state/physical/runtime/retained-file-read.ts';
import type { ExplainGraph } from '../../semantics/projection/explain.ts';
import { readOptionalProvenanceFile } from '../../adapters/workspace/provenance-reader.ts';
import type { ProvenanceFile } from '../../semantics/provenance/types.ts';
import { readOptionalCanonicalVerificationArtifactSet } from '../../adapters/verification/platform/artifact/runtime/authority.ts';
import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import type { VerificationReport } from '../../assurance/verification/contract/types.ts';
import type { ReviewSummary } from '../../assurance/verification/review/contract/types.ts';
import { createWorkspaceWriteCommitFence, withWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../adapters/filesystem/write-lease.ts';
import { resolveWorkspaceArtifactPath, resolveWorkspaceProvenancePath } from "../../adapters/workspace-context.ts";
import type { LockFile } from '../../compiler/contract.ts';
import { buildCiArtifactManifest, writeCiArtifactManifest } from '../../adapters/compilation/emit/ci-artifacts.ts';
import { lockProject } from '../../adapters/compilation/emit/lock-project.ts';
import { publishReviewSummary } from '../../adapters/compilation/emit/publish-review-summary.ts';
import { semanticViewArtifactsAreCurrent } from '../../adapters/compilation/emit/semantic-view-artifact-contract.ts';
import { writeExplainGraph } from '../../adapters/compilation/emit/write-explain-graph.ts';
import { CompilerError } from '../../compiler/errors.ts';
import { assertPassStatus } from "../../compiler/contract/lock-schema.ts";
import { readLockFile } from "../../adapters/workspace/lock.ts";
import { executePipelineStage } from '../../adapters/compilation/pipeline/kernel.ts';
import type { PipelineExecutionContext } from '../../adapters/compilation-protocol/types.ts';

function readOptionalValidatedProvenance(filePath: string, label: string): ProvenanceFile | null {
  try {
    return readOptionalProvenanceFile(filePath, label);
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
    const artifacts = readOptionalCanonicalVerificationArtifactSet(
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

/** Public read operation for the CLI and other entrypoint layers. Compiler
 * internals remain behind the orchestration boundary. */
export function observeWorkspaceArtifacts(workspaceRoot = process.cwd()) {
  return buildCiArtifactManifest(workspaceRoot);
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
  workspaceRoot = path.resolve(workspaceRoot);
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
  workspaceRoot = path.resolve(workspaceRoot);
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
  const explainGraphPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.explainGraph
  );
  const reviewSummaryPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.reviewSummary
  );
  const readableProvenancePath = await resolveWorkspaceProvenancePath(workspaceRoot);
  if (lock.passStatus.lock !== 'succeeded' || lock.passStatus.emit !== 'succeeded') return null;

  const graph = readOptionalRetainedJson<ExplainGraph>(explainGraphPath, 'Explain graph');
  const provenance = readOptionalValidatedProvenance(readableProvenancePath, 'Provenance report');
  const priorReview = readOptionalRetainedJson<unknown>(reviewSummaryPath, 'Review summary');
  const verificationArtifacts = readOptionalCanonicalVerificationArtifactSet(
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
  return reviewSummary;
}

export async function writeWorkspaceArtifacts(
  workspaceRoot = process.cwd(),
  workspaceWriteLease?: WorkspaceWriteLeaseToken
): Promise<{
  manifest: Awaited<ReturnType<typeof writeCiArtifactManifest>>;
  reviewSummary: ReviewSummary | null;
}> {
  workspaceRoot = path.resolve(workspaceRoot);
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
