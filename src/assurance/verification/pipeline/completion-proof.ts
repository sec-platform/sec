import type { ExplainGraph } from '../../../semantics/projection/explain.ts';
import type { ProvenanceFile } from '../../../semantics/provenance/types.ts';
import { rawSha256 } from '../../../contracts/canonical.ts';
import type { LockFile } from '../../../compiler/contract.ts';
import type { PassId } from '../../../compiler/contract/pass-status.ts';
import { getPipelineStageDefinition } from '../../../compiler/pipeline/stage-definitions.ts';
import { PIPELINE_STAGE_IDS, type PipelineStageId } from '../../../compiler/pipeline/stages.ts';
import type { PipelineSemanticContext } from '../../../compiler/pipeline/semantic-context.ts';
import type { VerificationReport } from '../contract/types.ts';
import type { ReviewSummary } from '../review/contract/types.ts';
import { buildProvenanceSummary, buildSemanticViewSummary } from '../review/summary-derivations.ts';
import { capturePipelineProofRecord, samePipelineSequence } from './proof-data.ts';

export const PIPELINE_COMPLETION_PROOF_REVISION = 'pipeline-completion-proof-v2' as const;

export interface PipelineCompletionProof {
  readonly formatRevision: typeof PIPELINE_COMPLETION_PROOF_REVISION;
  readonly transactionId: string;
  readonly inputRevision: string;
  readonly semanticRevision: string;
  readonly completedStages: readonly PipelineStageId[];
  readonly completedPasses: readonly PassId[];
  readonly verificationDigest: string;
  readonly provenanceDigest: string;
  readonly explainGraphDigest: string;
  readonly reviewSummaryDigest: string;
  readonly proofRevision: string;
}

export interface PipelineCompletionProofEvidence {
  readonly transactionId: string;
  readonly completedStages: readonly PipelineStageId[];
  readonly semanticContext: PipelineSemanticContext;
  readonly lock: LockFile;
  readonly verificationReport: VerificationReport;
  readonly provenance: ProvenanceFile;
  readonly explainGraph: ExplainGraph;
  readonly reviewSummary: ReviewSummary;
}

const PIPELINE_COMPLETION_PROOF_KEYS = [
  'formatRevision', 'transactionId', 'inputRevision', 'semanticRevision',
  'completedStages', 'completedPasses', 'verificationDigest', 'provenanceDigest',
  'explainGraphDigest', 'reviewSummaryDigest', 'proofRevision'
] as const;

function proofJsonDigest(value: unknown): string {
  return rawSha256(JSON.stringify(value));
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function completionPassClosure(): PassId[] {
  const seen = new Set<PassId>();
  return PIPELINE_STAGE_IDS.flatMap((stage) => getPipelineStageDefinition(stage).ownedPasses).filter((passId) => {
    if (seen.has(passId)) return false;
    seen.add(passId);
    return true;
  });
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`);
}

function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a canonical SHA-256 digest`);
  }
}

function completionProofPayload(proof: PipelineCompletionProof): Omit<PipelineCompletionProof, 'proofRevision'> {
  return {
    formatRevision: proof.formatRevision,
    transactionId: proof.transactionId,
    inputRevision: proof.inputRevision,
    semanticRevision: proof.semanticRevision,
    completedStages: proof.completedStages,
    completedPasses: proof.completedPasses,
    verificationDigest: proof.verificationDigest,
    provenanceDigest: proof.provenanceDigest,
    explainGraphDigest: proof.explainGraphDigest,
    reviewSummaryDigest: proof.reviewSummaryDigest
  };
}

function assertSemanticBindings(proof: PipelineCompletionProof, evidence: PipelineCompletionProofEvidence): void {
  const semantic = evidence.semanticContext;
  if (
    evidence.transactionId !== proof.transactionId || semantic.transactionId !== proof.transactionId ||
    semantic.inputRevision !== proof.inputRevision || semantic.semanticRevision !== proof.semanticRevision ||
    semantic.snapshot.ir.inputRevision !== proof.inputRevision || semantic.snapshot.ir.semanticRevision !== proof.semanticRevision ||
    semantic.generatorPlan.inputRevision !== proof.inputRevision || semantic.generatorPlan.semanticRevision !== proof.semanticRevision ||
    semantic.semanticViews.inputRevision !== proof.inputRevision || semantic.semanticViews.semanticRevision !== proof.semanticRevision
  ) throw new Error('Pipeline completion proof does not bind the completed semantic transaction');
  if (!samePipelineSequence(evidence.completedStages, PIPELINE_STAGE_IDS)) {
    throw new Error('Pipeline completion evidence does not contain the registry-owned stage closure');
  }
  if (!evidence.lock.semanticViews || proofJsonDigest(evidence.lock.semanticViews) !== proofJsonDigest(semantic.semanticViews)) {
    throw new Error('Pipeline completion Lock does not bind the completed semantic views');
  }

  type LoweringTask = NonNullable<LockFile['semanticLoweringTasks']>[number];
  const loweringById = new Map<string, Map<string, { record: LoweringTask; count: number }>>();
  for (const record of evidence.lock.semanticLoweringTasks ?? []) {
    let byTarget = loweringById.get(record.id);
    if (!byTarget) { byTarget = new Map(); loweringById.set(record.id, byTarget); }
    const found = byTarget.get(record.target);
    if (found) found.count++;
    else byTarget.set(record.target, { record, count: 1 });
  }
  for (const task of semantic.generatorPlan.tasks) {
    if (task.inputRevision !== proof.inputRevision || task.semanticRevision !== proof.semanticRevision) {
      throw new Error(`Semantic Generator task "${task.id}" has stale proof revisions`);
    }
    const matched = loweringById.get(task.id)?.get(task.target);
    if (matched !== undefined && matched.count !== 1) throw new Error(`Semantic Generator task "${task.id}" has ambiguous Lock bindings`);
    const lockTask = matched?.record;
    const binding = lockTask?.artifactBinding;
    if (!lockTask || (lockTask.status !== 'generated' && lockTask.status !== 'verified') ||
      binding?.generatorEntityId !== task.generatorEntityId || binding.artifactEntityId !== task.artifactEntityId ||
      binding.semanticRevision !== proof.semanticRevision || binding.compilationTransactionId !== proof.transactionId) {
      throw new Error(`Semantic Generator task "${task.id}" is not bound to the completed transaction`);
    }
  }
}

function assertDerivativeBindings(proof: PipelineCompletionProof, evidence: PipelineCompletionProofEvidence): void {
  const expectedPasses = completionPassClosure();
  if (expectedPasses.some((passId) => evidence.lock.passStatus[passId] !== 'succeeded')) {
    throw new Error('Pipeline completion Lock does not contain the registry-owned pass closure');
  }
  if (evidence.verificationReport.summary.status !== 'passed' || evidence.verificationReport.summary.requestedLane !== 'all' ||
    evidence.verificationReport.summary.failedLanes.length !== 0 || evidence.verificationReport.fast.status !== 'passed' ||
    evidence.verificationReport.runtime.status !== 'passed' || proof.verificationDigest !== proofJsonDigest(evidence.verificationReport)) {
    throw new Error('Pipeline completion Verification report is incomplete or stale');
  }
  if (proof.provenanceDigest !== proofJsonDigest(evidence.provenance)) throw new Error('Pipeline completion Provenance digest is stale');

  for (const artifact of evidence.provenance.artifacts) {
    if (artifact.compilationTransactionId === proof.transactionId && artifact.semanticRevision !== proof.semanticRevision) {
      throw new Error(`Provenance artifact "${artifact.path}" has a stale semantic revision`);
    }
  }
  type Artifact = ProvenanceFile['artifacts'][number];
  const artifactsByPath = new Map<string, { record: Artifact; count: number }>();
  for (const record of evidence.provenance.artifacts) {
    const found = artifactsByPath.get(record.path);
    if (found) found.count++;
    else artifactsByPath.set(record.path, { record, count: 1 });
  }
  for (const task of evidence.semanticContext.generatorPlan.tasks) {
    const matched = artifactsByPath.get(task.target);
    if (matched !== undefined && matched.count !== 1) throw new Error(`Provenance artifact for Semantic Generator task "${task.id}" is ambiguous`);
    const artifact = matched?.record;
    if (!artifact || artifact.generatorTaskId !== task.id || artifact.generatorEntityId !== task.generatorEntityId ||
      artifact.artifactEntityId !== task.artifactEntityId || artifact.semanticRevision !== proof.semanticRevision ||
      artifact.compilationTransactionId !== proof.transactionId) {
      throw new Error(`Provenance artifact for Semantic Generator task "${task.id}" is not current`);
    }
  }
  if (proof.explainGraphDigest !== proofJsonDigest(evidence.explainGraph) ||
    proofJsonDigest(evidence.explainGraph.semanticViews) !== proofJsonDigest(evidence.semanticContext.semanticViews) ||
    proofJsonDigest(evidence.explainGraph.overlays.provenance) !== proofJsonDigest(evidence.provenance.artifacts)) {
    throw new Error('Pipeline completion ExplainGraph is incomplete or stale');
  }
  const reviewViews = evidence.reviewSummary.semanticViewSummary;
  const expectedReviewViews = buildSemanticViewSummary(evidence.lock);
  const expectedProvenanceSummary = buildProvenanceSummary(evidence.provenance);
  if (proof.reviewSummaryDigest !== proofJsonDigest(evidence.reviewSummary) || !reviewViews ||
    reviewViews.inputRevision !== proof.inputRevision || reviewViews.semanticRevision !== proof.semanticRevision ||
    reviewViews.viewCount !== evidence.semanticContext.semanticViews.views.length ||
    !sameJsonValue(reviewViews, expectedReviewViews) ||
    !sameJsonValue(evidence.reviewSummary.provenanceSummary, expectedProvenanceSummary)) {
    throw new Error('Pipeline completion ReviewSummary is incomplete or stale');
  }
}

export function assertPipelineCompletionProofInvariant(
  value: unknown,
  evidence?: PipelineCompletionProofEvidence
): asserts value is PipelineCompletionProof {
  const proof = capturePipelineProofRecord(value, PIPELINE_COMPLETION_PROOF_KEYS, 'Pipeline completion proof') as unknown as PipelineCompletionProof;
  if (proof.formatRevision !== PIPELINE_COMPLETION_PROOF_REVISION) throw new Error('Pipeline completion proof has an unsupported format revision');
  assertNonEmptyString(proof.transactionId, 'Pipeline completion transactionId');
  assertDigest(proof.inputRevision, 'Pipeline completion inputRevision');
  assertDigest(proof.semanticRevision, 'Pipeline completion semanticRevision');
  assertDigest(proof.verificationDigest, 'Pipeline completion verificationDigest');
  assertDigest(proof.provenanceDigest, 'Pipeline completion provenanceDigest');
  assertDigest(proof.explainGraphDigest, 'Pipeline completion explainGraphDigest');
  assertDigest(proof.reviewSummaryDigest, 'Pipeline completion reviewSummaryDigest');
  assertDigest(proof.proofRevision, 'Pipeline completion proofRevision');
  const expectedPasses = completionPassClosure();
  if (!Array.isArray(proof.completedStages) || !samePipelineSequence(proof.completedStages, PIPELINE_STAGE_IDS)) {
    throw new Error('Pipeline completion proof does not contain the registry-owned stage closure');
  }
  if (!Array.isArray(proof.completedPasses) || !samePipelineSequence(proof.completedPasses, expectedPasses)) {
    throw new Error('Pipeline completion proof does not contain the registry-owned pass closure');
  }
  const expectedProofRevision = proofJsonDigest({ domain: PIPELINE_COMPLETION_PROOF_REVISION, ...completionProofPayload(proof) });
  if (proof.proofRevision !== expectedProofRevision) throw new Error('Pipeline completion proof revision does not bind its exact payload');
  if (evidence) { assertSemanticBindings(proof, evidence); assertDerivativeBindings(proof, evidence); }
}

export function createPipelineCompletionProof(evidence: PipelineCompletionProofEvidence): PipelineCompletionProof {
  const completedPasses = completionPassClosure();
  const withoutRevision: Omit<PipelineCompletionProof, 'proofRevision'> = {
    formatRevision: PIPELINE_COMPLETION_PROOF_REVISION,
    transactionId: evidence.transactionId,
    inputRevision: evidence.semanticContext.inputRevision,
    semanticRevision: evidence.semanticContext.semanticRevision,
    completedStages: [...evidence.completedStages], completedPasses,
    verificationDigest: proofJsonDigest(evidence.verificationReport),
    provenanceDigest: proofJsonDigest(evidence.provenance),
    explainGraphDigest: proofJsonDigest(evidence.explainGraph),
    reviewSummaryDigest: proofJsonDigest(evidence.reviewSummary)
  };
  const proof: PipelineCompletionProof = {
    ...withoutRevision,
    proofRevision: proofJsonDigest({ domain: PIPELINE_COMPLETION_PROOF_REVISION, ...withoutRevision })
  };
  assertPipelineCompletionProofInvariant(proof, evidence);
  return Object.freeze({ ...proof, completedStages: Object.freeze([...proof.completedStages]), completedPasses: Object.freeze([...proof.completedPasses]) });
}
