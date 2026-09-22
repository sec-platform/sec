import { Buffer } from 'node:buffer';
import type { ExplainGraph } from '../../semantics/projection/explain.ts';
import type { ProvenanceFile } from '../../semantics/provenance/types.ts';
import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import type { VerificationReport } from '../../assurance/verification/contract/types.ts';
import { validateReviewSummary } from '../../assurance/verification/review/contract/summary.ts';
import type { ReviewSummary } from '../../assurance/verification/review/contract/types.ts';
import { createPipelineCompletionProof, type PipelineCompletionProof } from '../../assurance/verification/pipeline/completion-proof.ts';
import { samePipelineSequence } from '../../assurance/verification/pipeline/proof-data.ts';
import { formatJsonFile } from '../../contracts/json-text.ts';
import { readCanonicalJsonArtifact, readCanonicalVerificationArtifactSet } from './canonical-artifacts.ts';
import type { LockFile } from '../../compiler/contract.ts';
import { PIPELINE_STAGE_IDS, type PipelineStageId } from '../../compiler/pipeline/stages.ts';
import type { PipelineSemanticContext } from '../../compiler/pipeline/semantic-context.ts';
import { resolveWorkspaceArtifactPath } from '../workspace-context.ts';
import { readReviewGovernanceReports } from '../compilation/emit/read-review-governance-reports.ts';
import { buildExplainGraph, renderExplainGraphDot, renderExplainGraphMermaid } from '../compilation/emit/write-explain-graph.ts';
import { buildProvenance } from '../artifacts/provenance.ts';
import { buildReviewSummary } from '../compilation/emit/write-review-summary.ts';
import { buildAcceptanceCoverage } from './build-acceptance-coverage.ts';
import { readOptionalAuthorityBytes } from '../workspace/sources/read-authority-source.ts';

export interface PipelineCompletionProofStageEvidence {
  readonly transactionId: string;
  readonly completedStages: readonly PipelineStageId[];
  readonly semanticContext: PipelineSemanticContext | undefined;
  readonly lock: LockFile | undefined;
  readonly verificationReport: VerificationReport | undefined;
  readonly provenance: ProvenanceFile | undefined;
  readonly explainGraph: ExplainGraph | undefined;
  readonly reviewSummary: ReviewSummary | undefined;
}

function assertSameCanonicalJsonValue(label: string, actual: unknown, expected: unknown): void {
  if (formatJsonFile(actual) !== formatJsonFile(expected)) {
    throw new Error(`Pipeline completion ${label} does not match its canonical derivation`);
  }
}

async function readRequiredArtifactBytes(filePath: string, label: string): Promise<Uint8Array> {
  try {
    const observed = readOptionalAuthorityBytes(filePath, `Pipeline completion ${label}`);
    if (observed === null) throw new Error('not found');
    return new Uint8Array(observed);
  } catch (error) {
    throw new Error(`Pipeline completion ${label} is missing or unreadable: ${String(error)}`, { cause: error });
  }
}

function assertExactArtifactBytes(label: string, actual: Uint8Array, expectedText: string): void {
  if (!Buffer.from(actual).equals(Buffer.from(expectedText, 'utf8'))) {
    throw new Error(`Pipeline completion ${label} does not match its canonical rendering`);
  }
}

export async function buildPipelineCompletionProof(
  workspaceRoot: string,
  stageEvidence: PipelineCompletionProofStageEvidence
): Promise<PipelineCompletionProof | undefined> {
  if (!samePipelineSequence(stageEvidence.completedStages, PIPELINE_STAGE_IDS)) return undefined;
  const { semanticContext, lock: stageLock, verificationReport: stageVerificationReport,
    provenance: stageProvenance, explainGraph: stageExplainGraph, reviewSummary: stageReviewSummary } = stageEvidence;
  if (!semanticContext || !stageLock || !stageVerificationReport || !stageProvenance || !stageExplainGraph || !stageReviewSummary) {
    throw new Error('Full Pipeline completion is missing derivative binding evidence');
  }

  const [lock, verificationArtifacts, provenance, explainGraph, reviewSummary, graphProjectionBytes] = await Promise.all([
    readCanonicalJsonArtifact<LockFile>(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock), 'Lock'),
    readCanonicalVerificationArtifactSet(workspaceRoot),
    readCanonicalJsonArtifact<ProvenanceFile>(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance), 'Provenance'),
    readCanonicalJsonArtifact<ExplainGraph>(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.explainGraph), 'ExplainGraph'),
    readCanonicalJsonArtifact(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.reviewSummary), 'ReviewSummary', validateReviewSummary),
    Promise.all([
      readRequiredArtifactBytes(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.explainGraphMermaid), 'ExplainGraph Mermaid'),
      readRequiredArtifactBytes(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.explainGraphDot), 'ExplainGraph DOT')
    ])
  ]);
  const [explainGraphMermaidBytes, explainGraphDotBytes] = graphProjectionBytes;

  assertSameCanonicalJsonValue('Lock', lock, stageLock);
  assertSameCanonicalJsonValue('Verification report', verificationArtifacts.verificationReport, stageVerificationReport);
  assertSameCanonicalJsonValue('Provenance', provenance, stageProvenance);
  assertSameCanonicalJsonValue('ExplainGraph', explainGraph, stageExplainGraph);
  assertSameCanonicalJsonValue('ReviewSummary', reviewSummary, stageReviewSummary);
  const expectedCoverage = await buildAcceptanceCoverage(workspaceRoot, lock, verificationArtifacts.runtimeReport);
  assertSameCanonicalJsonValue('acceptance coverage', verificationArtifacts.acceptanceCoverage, expectedCoverage);
  const expectedProvenance = await buildProvenance(workspaceRoot, lock);
  assertSameCanonicalJsonValue('Provenance', provenance, expectedProvenance);
  const { policyReport: governancePolicyReport, upgradePlan, upgradeDiagnostics } = await readReviewGovernanceReports(workspaceRoot);
  assertSameCanonicalJsonValue('policy report', governancePolicyReport, verificationArtifacts.policyReport);
  const expectedExplainGraph = await buildExplainGraph(workspaceRoot, lock, provenance, verificationArtifacts.acceptanceCoverage,
    governancePolicyReport, upgradePlan, upgradeDiagnostics);
  assertSameCanonicalJsonValue('ExplainGraph', explainGraph, expectedExplainGraph);
  assertExactArtifactBytes('ExplainGraph Mermaid', explainGraphMermaidBytes, renderExplainGraphMermaid(explainGraph));
  assertExactArtifactBytes('ExplainGraph DOT', explainGraphDotBytes, renderExplainGraphDot(explainGraph));
  const expectedReviewSummary = await buildReviewSummary(workspaceRoot, lock, provenance,
    verificationArtifacts.verificationReport, verificationArtifacts.acceptanceCoverage);
  assertSameCanonicalJsonValue('ReviewSummary', reviewSummary, expectedReviewSummary);

  return createPipelineCompletionProof({ transactionId: stageEvidence.transactionId,
    completedStages: stageEvidence.completedStages, semanticContext, lock,
    verificationReport: verificationArtifacts.verificationReport, provenance, explainGraph, reviewSummary });
}
