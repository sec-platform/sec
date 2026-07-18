import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  buildAcceptanceCoverage,
  buildExplainGraph,
  buildLocalViewArtifacts,
  buildProvenance,
  buildProvenanceSummary,
  buildReviewSummary,
  buildSemanticViewSummary,
  readReviewGovernanceReports,
  renderExplainGraphDot,
  renderExplainGraphMermaid
} from '../compiler/index.ts';
import type { ExplainGraph } from '../shared/explain-types.ts';
import { formatJsonFile } from '../shared/fs.ts';
import type { LockFile } from '../shared/lock-types.ts';
import { readLockFile } from '../shared/lock-utils.ts';
import {
  getWorkspacePaths,
  graphViewRelativePath,
  overviewViewRelativePath,
  reviewViewRelativePath,
  slotRuleViewRelativePath,
  sourceViewRelativePath
} from '../shared/paths.ts';
import { emitPipelineExecutionBoundary } from '../shared/pipeline-journal.ts';
import { withPipelineTransaction } from '../shared/pipeline-kernel.ts';
import { getPipelineStageDefinition } from '../shared/pipeline-pass-registry.ts';
import { requirePipelineSemanticContext } from '../shared/pipeline-semantic-context.ts';
import {
  PIPELINE_COMPLETION_PROOF_REVISION,
  PIPELINE_STAGE_IDS,
  type PassId,
  type PipelineCompletionProofV1,
  type PipelineEventHandler,
  type PipelineSemanticContext,
  type PipelineSource,
  type PipelineStageId
} from '../shared/pipeline-types.ts';
import type { PlanFile } from '../shared/plan-manifest-types.ts';
import type { ProvenanceFile } from '../shared/provenance-types.ts';
import type { ReviewSummary } from '../shared/review-types.ts';
import { assertCanonicalVerificationArtifactSet } from '../shared/verification-artifact-contract.ts';
import type { VerificationLane, VerificationReport } from '../shared/verification-types.ts';
import {
  assertWorkspaceWriteLease,
  withWorkspaceWriteLease,
  type WorkspaceWriteLeaseToken
} from '../shared/workspace-write-lease.ts';
import { resolveWorkspace } from './block-orchestrator.ts';
import { adaptWorkspace, composeWorkspace } from './compose-orchestrator.ts';
import { explainWorkspace, lockWorkspace } from './emit-orchestrator.ts';
import {
  assertIsolatedVerificationCapability,
  type IsolatedVerificationCapability
} from './isolated-verification-capability.ts';
import { runWorkspaceSemanticFrontend } from './semantic-orchestrator.ts';
import {
  assertStagedVerificationProofAfterPipeline,
  verifyWorkspace,
  type StagedVerificationProof
} from './verify-orchestrator.ts';
import { applyWorkbenchMutations } from './workbench-orchestrator.ts';

const PIPELINE_LEASE_MONITOR_INTERVAL_MS = 250;
const PIPELINE_PENDING_TRANSACTION_ID = 'tx:pending';

export interface CompileWorkspaceOptions {
  source?: PipelineSource;
  from?: PipelineStageId;
  through?: PipelineStageId;
  verificationLane?: VerificationLane;
  applyWorkbenchMutations?: boolean;
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
  const controller = new AbortController();
  let checkingLease = false;
  let leaseFailure: unknown;
  const checkLease = (): void => {
    if (checkingLease || leaseFailure !== undefined) return;
    checkingLease = true;
    void assertWorkspaceWriteLease(workspaceRoot, workspaceWriteLease)
      .catch((error: unknown) => {
        leaseFailure = error;
        controller.abort();
      })
      .finally(() => {
        checkingLease = false;
      });
  };
  const monitor = setInterval(checkLease, PIPELINE_LEASE_MONITOR_INTERVAL_MS);
  try {
    await assertWorkspaceWriteLease(workspaceRoot, workspaceWriteLease);
    const result = await callback(controller.signal);
    await assertWorkspaceWriteLease(workspaceRoot, workspaceWriteLease);
    if (leaseFailure !== undefined) throw leaseFailure;
    return result;
  } catch (error) {
    if (leaseFailure !== undefined) throw leaseFailure;
    throw error;
  } finally {
    clearInterval(monitor);
  }
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
  completionProof?: PipelineCompletionProofV1;
}

export interface PipelineCompletionProofEvidenceV1 {
  readonly transactionId: string;
  readonly completedStages: readonly PipelineStageId[];
  readonly semanticContext: PipelineSemanticContext;
  readonly lock: LockFile;
  readonly verificationReport: VerificationReport;
  readonly provenance: ProvenanceFile;
  readonly explainGraph: ExplainGraph;
  readonly reviewSummary: ReviewSummary;
  readonly localViews: readonly {
    readonly relativePath: string;
    readonly bytes: Uint8Array;
  }[];
}

export interface PipelineCompletionProofStageEvidenceV1 {
  readonly transactionId: string;
  readonly completedStages: readonly PipelineStageId[];
  readonly semanticContext: PipelineSemanticContext | undefined;
  readonly lock: LockFile | undefined;
  readonly verificationReport: VerificationReport | undefined;
  readonly provenance: ProvenanceFile | undefined;
  readonly explainGraph: ExplainGraph | undefined;
  readonly reviewSummary: ReviewSummary | undefined;
}

const PIPELINE_COMPLETION_PROOF_KEYS = [
  'formatRevision',
  'transactionId',
  'inputRevision',
  'semanticRevision',
  'completedStages',
  'completedPasses',
  'verificationDigest',
  'provenanceDigest',
  'explainGraphDigest',
  'reviewSummaryDigest',
  'localViewDigests',
  'proofRevision'
] as const;

const PIPELINE_COMPLETION_LOCAL_VIEW_PATHS = [
  overviewViewRelativePath,
  sourceViewRelativePath,
  slotRuleViewRelativePath,
  graphViewRelativePath,
  reviewViewRelativePath
] as const;

function proofJsonDigest(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function proofByteDigest(value: Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertSameCanonicalJsonValue(label: string, actual: unknown, expected: unknown): void {
  if (formatJsonFile(actual) !== formatJsonFile(expected)) {
    throw new Error(`Pipeline completion ${label} does not match its canonical derivation`);
  }
}

async function readCanonicalJsonArtifact<T>(filePath: string, label: string): Promise<T> {
  let rawBytes: Buffer;
  try {
    rawBytes = await readFile(filePath);
  } catch (error) {
    throw new Error(`Pipeline completion ${label} is missing or unreadable: ${String(error)}`);
  }

  let value: unknown;
  try {
    value = JSON.parse(rawBytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Pipeline completion ${label} is not valid JSON: ${String(error)}`);
  }
  const canonicalBytes = Buffer.from(formatJsonFile(value), 'utf8');
  if (!rawBytes.equals(canonicalBytes)) {
    throw new Error(`Pipeline completion ${label} is not canonical JSON`);
  }
  return value as T;
}

async function readRequiredArtifactBytes(filePath: string, label: string): Promise<Uint8Array> {
  try {
    return new Uint8Array(await readFile(filePath));
  } catch (error) {
    throw new Error(`Pipeline completion ${label} is missing or unreadable: ${String(error)}`);
  }
}

function assertExactArtifactBytes(label: string, actual: Uint8Array, expectedText: string): void {
  const expected = Buffer.from(expectedText, 'utf8');
  if (!Buffer.from(actual).equals(expected)) {
    throw new Error(`Pipeline completion ${label} does not match its canonical rendering`);
  }
}

function sameOrderedValues(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function completionPassClosure(): PassId[] {
  const seen = new Set<PassId>();
  return PIPELINE_STAGE_IDS.flatMap((stage) => getPipelineStageDefinition(stage).ownedPasses).filter((passId) => {
    if (seen.has(passId)) return false;
    seen.add(passId);
    return true;
  });
}

function assertExactKeys(
  value: unknown,
  expected: readonly string[],
  label: string
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object with the exact v1 schema`);
  }
  const actualKeys = Object.keys(value).sort((left, right) => left.localeCompare(right));
  const expectedKeys = [...expected].sort((left, right) => left.localeCompare(right));
  if (!sameOrderedValues(actualKeys, expectedKeys)) {
    throw new Error(`${label} does not match the exact v1 schema`);
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a canonical SHA-256 digest`);
  }
}

function completionProofPayload(proof: PipelineCompletionProofV1): Omit<PipelineCompletionProofV1, 'proofRevision'> {
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
    reviewSummaryDigest: proof.reviewSummaryDigest,
    localViewDigests: proof.localViewDigests
  };
}

function assertSemanticBindings(proof: PipelineCompletionProofV1, evidence: PipelineCompletionProofEvidenceV1): void {
  const semantic = evidence.semanticContext;
  if (
    evidence.transactionId !== proof.transactionId ||
    semantic.transactionId !== proof.transactionId ||
    semantic.inputRevision !== proof.inputRevision ||
    semantic.semanticRevision !== proof.semanticRevision ||
    semantic.snapshot.ir.inputRevision !== proof.inputRevision ||
    semantic.snapshot.ir.semanticRevision !== proof.semanticRevision ||
    semantic.generatorPlan.inputRevision !== proof.inputRevision ||
    semantic.generatorPlan.semanticRevision !== proof.semanticRevision ||
    semantic.semanticViews.inputRevision !== proof.inputRevision ||
    semantic.semanticViews.semanticRevision !== proof.semanticRevision
  ) {
    throw new Error('Pipeline completion proof does not bind the completed semantic transaction');
  }
  if (!sameOrderedValues(evidence.completedStages, PIPELINE_STAGE_IDS)) {
    throw new Error('Pipeline completion evidence does not contain the registry-owned stage closure');
  }
  if (
    !evidence.lock.semanticViews ||
    proofJsonDigest(evidence.lock.semanticViews) !== proofJsonDigest(semantic.semanticViews)
  ) {
    throw new Error('Pipeline completion Lock does not bind the completed semantic views');
  }

  for (const task of semantic.generatorPlan.tasks) {
    if (task.inputRevision !== proof.inputRevision || task.semanticRevision !== proof.semanticRevision) {
      throw new Error(`Semantic Generator task "${task.id}" has stale proof revisions`);
    }
    const lockTask = evidence.lock.semanticLoweringTasks?.find(
      (candidate) => candidate.id === task.id && candidate.target === task.target
    );
    const binding = lockTask?.artifactBinding;
    if (
      !lockTask ||
      (lockTask.status !== 'generated' && lockTask.status !== 'verified') ||
      binding?.generatorEntityId !== task.generatorEntityId ||
      binding.artifactEntityId !== task.artifactEntityId ||
      binding.semanticRevision !== proof.semanticRevision ||
      binding.compilationTransactionId !== proof.transactionId
    ) {
      throw new Error(`Semantic Generator task "${task.id}" is not bound to the completed transaction`);
    }
  }
}

function assertDerivativeBindings(proof: PipelineCompletionProofV1, evidence: PipelineCompletionProofEvidenceV1): void {
  const expectedPasses = completionPassClosure();
  if (expectedPasses.some((passId) => evidence.lock.passStatus[passId] !== 'succeeded')) {
    throw new Error('Pipeline completion Lock does not contain the registry-owned pass closure');
  }
  if (
    evidence.verificationReport.summary.status !== 'passed' ||
    evidence.verificationReport.summary.requestedLane !== 'all' ||
    evidence.verificationReport.summary.failedLanes.length !== 0 ||
    evidence.verificationReport.fast.status !== 'passed' ||
    evidence.verificationReport.runtime.status !== 'passed' ||
    proof.verificationDigest !== proofJsonDigest(evidence.verificationReport)
  ) {
    throw new Error('Pipeline completion Verification report is incomplete or stale');
  }
  if (proof.provenanceDigest !== proofJsonDigest(evidence.provenance)) {
    throw new Error('Pipeline completion Provenance digest is stale');
  }

  for (const artifact of evidence.provenance.artifacts) {
    if (
      artifact.compilationTransactionId === proof.transactionId &&
      artifact.semanticRevision !== proof.semanticRevision
    ) {
      throw new Error(`Provenance artifact "${artifact.path}" has a stale semantic revision`);
    }
  }
  for (const task of evidence.semanticContext.generatorPlan.tasks) {
    const artifact = evidence.provenance.artifacts.find((candidate) => candidate.path === task.target);
    if (
      !artifact ||
      artifact.generatorTaskId !== task.id ||
      artifact.generatorEntityId !== task.generatorEntityId ||
      artifact.artifactEntityId !== task.artifactEntityId ||
      artifact.semanticRevision !== proof.semanticRevision ||
      artifact.compilationTransactionId !== proof.transactionId
    ) {
      throw new Error(`Provenance artifact for Semantic Generator task "${task.id}" is not current`);
    }
  }

  if (
    proof.explainGraphDigest !== proofJsonDigest(evidence.explainGraph) ||
    proofJsonDigest(evidence.explainGraph.semanticViews) !== proofJsonDigest(evidence.semanticContext.semanticViews) ||
    proofJsonDigest(evidence.explainGraph.overlays.provenance) !== proofJsonDigest(evidence.provenance.artifacts)
  ) {
    throw new Error('Pipeline completion ExplainGraph is incomplete or stale');
  }
  const reviewViews = evidence.reviewSummary.semanticViewSummary;
  const expectedReviewViews = buildSemanticViewSummary(evidence.lock);
  const expectedProvenanceSummary = buildProvenanceSummary(evidence.provenance);
  if (
    proof.reviewSummaryDigest !== proofJsonDigest(evidence.reviewSummary) ||
    !reviewViews ||
    reviewViews.inputRevision !== proof.inputRevision ||
    reviewViews.semanticRevision !== proof.semanticRevision ||
    reviewViews.viewCount !== evidence.semanticContext.semanticViews.views.length ||
    !sameJsonValue(reviewViews, expectedReviewViews) ||
    !sameJsonValue(evidence.reviewSummary.provenanceSummary, expectedProvenanceSummary)
  ) {
    throw new Error('Pipeline completion ReviewSummary is incomplete or stale');
  }

  if (
    evidence.localViews.length !== PIPELINE_COMPLETION_LOCAL_VIEW_PATHS.length ||
    evidence.localViews.some(
      (view, index) =>
        view.relativePath !== PIPELINE_COMPLETION_LOCAL_VIEW_PATHS[index] ||
        !(view.bytes instanceof Uint8Array) ||
        proof.localViewDigests[index]?.digest !== proofByteDigest(view.bytes)
    )
  ) {
    throw new Error('Pipeline completion local-view byte bindings are incomplete or stale');
  }
}

export function assertPipelineCompletionProofInvariant(
  value: unknown,
  evidence?: PipelineCompletionProofEvidenceV1
): asserts value is PipelineCompletionProofV1 {
  assertExactKeys(value, PIPELINE_COMPLETION_PROOF_KEYS, 'Pipeline completion proof');
  const proof = value as unknown as PipelineCompletionProofV1;
  if (proof.formatRevision !== PIPELINE_COMPLETION_PROOF_REVISION) {
    throw new Error('Pipeline completion proof has an unsupported format revision');
  }
  assertNonEmptyString(proof.transactionId, 'Pipeline completion transactionId');
  assertDigest(proof.inputRevision, 'Pipeline completion inputRevision');
  assertDigest(proof.semanticRevision, 'Pipeline completion semanticRevision');
  assertDigest(proof.verificationDigest, 'Pipeline completion verificationDigest');
  assertDigest(proof.provenanceDigest, 'Pipeline completion provenanceDigest');
  assertDigest(proof.explainGraphDigest, 'Pipeline completion explainGraphDigest');
  assertDigest(proof.reviewSummaryDigest, 'Pipeline completion reviewSummaryDigest');
  assertDigest(proof.proofRevision, 'Pipeline completion proofRevision');

  const expectedPasses = completionPassClosure();
  if (!Array.isArray(proof.completedStages) || !sameOrderedValues(proof.completedStages, PIPELINE_STAGE_IDS)) {
    throw new Error('Pipeline completion proof does not contain the registry-owned stage closure');
  }
  if (!Array.isArray(proof.completedPasses) || !sameOrderedValues(proof.completedPasses, expectedPasses)) {
    throw new Error('Pipeline completion proof does not contain the registry-owned pass closure');
  }
  if (
    !Array.isArray(proof.localViewDigests) ||
    proof.localViewDigests.length !== PIPELINE_COMPLETION_LOCAL_VIEW_PATHS.length
  ) {
    throw new Error('Pipeline completion proof does not contain the local-view closure');
  }
  for (const [index, view] of proof.localViewDigests.entries()) {
    assertExactKeys(view, ['relativePath', 'digest'], `Pipeline completion local view ${index}`);
    if (view.relativePath !== PIPELINE_COMPLETION_LOCAL_VIEW_PATHS[index]) {
      throw new Error('Pipeline completion proof does not contain the local-view closure');
    }
    assertDigest(view.digest, `Pipeline completion local view ${view.relativePath}`);
  }

  const expectedProofRevision = proofJsonDigest({
    domain: PIPELINE_COMPLETION_PROOF_REVISION,
    ...completionProofPayload(proof)
  });
  if (proof.proofRevision !== expectedProofRevision) {
    throw new Error('Pipeline completion proof revision does not bind its exact payload');
  }
  if (evidence) {
    assertSemanticBindings(proof, evidence);
    assertDerivativeBindings(proof, evidence);
  }
}

export function createPipelineCompletionProof(evidence: PipelineCompletionProofEvidenceV1): PipelineCompletionProofV1 {
  const completedPasses = completionPassClosure();
  const localViewDigests = evidence.localViews.map((view) => ({
    relativePath: view.relativePath,
    digest: proofByteDigest(view.bytes)
  }));
  const withoutRevision: Omit<PipelineCompletionProofV1, 'proofRevision'> = {
    formatRevision: PIPELINE_COMPLETION_PROOF_REVISION,
    transactionId: evidence.transactionId,
    inputRevision: evidence.semanticContext.inputRevision,
    semanticRevision: evidence.semanticContext.semanticRevision,
    completedStages: [...evidence.completedStages],
    completedPasses,
    verificationDigest: proofJsonDigest(evidence.verificationReport),
    provenanceDigest: proofJsonDigest(evidence.provenance),
    explainGraphDigest: proofJsonDigest(evidence.explainGraph),
    reviewSummaryDigest: proofJsonDigest(evidence.reviewSummary),
    localViewDigests
  };
  const proof: PipelineCompletionProofV1 = {
    ...withoutRevision,
    proofRevision: proofJsonDigest({
      domain: PIPELINE_COMPLETION_PROOF_REVISION,
      ...withoutRevision
    })
  };
  assertPipelineCompletionProofInvariant(proof, evidence);
  return Object.freeze({
    ...proof,
    completedStages: Object.freeze([...proof.completedStages]),
    completedPasses: Object.freeze([...proof.completedPasses]),
    localViewDigests: Object.freeze(proof.localViewDigests.map((view) => Object.freeze({ ...view })))
  });
}

export async function buildPipelineCompletionProof(
  workspaceRoot: string,
  stageEvidence: PipelineCompletionProofStageEvidenceV1
): Promise<PipelineCompletionProofV1 | undefined> {
  if (!sameOrderedValues(stageEvidence.completedStages, PIPELINE_STAGE_IDS)) return undefined;
  const {
    semanticContext,
    lock: stageLock,
    verificationReport: stageVerificationReport,
    provenance: stageProvenance,
    explainGraph: stageExplainGraph,
    reviewSummary: stageReviewSummary
  } = stageEvidence;
  if (
    !semanticContext ||
    !stageLock ||
    !stageVerificationReport ||
    !stageProvenance ||
    !stageExplainGraph ||
    !stageReviewSummary
  ) {
    throw new Error('Full Pipeline completion is missing derivative binding evidence');
  }

  const paths = getWorkspacePaths(workspaceRoot);
  const localViewLocations = [
    [overviewViewRelativePath, paths.overviewViewPath],
    [sourceViewRelativePath, paths.sourceViewPath],
    [slotRuleViewRelativePath, paths.slotRuleViewPath],
    [graphViewRelativePath, paths.graphViewPath],
    [reviewViewRelativePath, paths.reviewViewPath]
  ] as const;
  const [jsonArtifacts, graphProjectionBytes, localViewBytes] = await Promise.all([
    Promise.all([
      readCanonicalJsonArtifact<LockFile>(paths.lockPath, 'Lock'),
      readCanonicalJsonArtifact<unknown>(paths.verificationReportPath, 'Verification report'),
      readCanonicalJsonArtifact<unknown>(paths.runtimeReportPath, 'runtime report'),
      readCanonicalJsonArtifact<unknown>(paths.policyReportPath, 'policy report'),
      readCanonicalJsonArtifact<unknown>(paths.acceptanceCoveragePath, 'acceptance coverage'),
      readCanonicalJsonArtifact<ProvenanceFile>(paths.provenancePath, 'Provenance'),
      readCanonicalJsonArtifact<ExplainGraph>(paths.explainGraphPath, 'ExplainGraph'),
      readCanonicalJsonArtifact<ReviewSummary>(paths.reviewSummaryPath, 'ReviewSummary')
    ]),
    Promise.all([
      readRequiredArtifactBytes(paths.explainGraphMermaidPath, 'ExplainGraph Mermaid'),
      readRequiredArtifactBytes(paths.explainGraphDotPath, 'ExplainGraph DOT')
    ]),
    Promise.all(localViewLocations.map(([relativePath, absolutePath]) =>
      readRequiredArtifactBytes(absolutePath, `local view ${relativePath}`)
    ))
  ]);
  const [
    lock,
    verificationReport,
    runtimeReport,
    policyReport,
    acceptanceCoverage,
    provenance,
    explainGraph,
    reviewSummary
  ] = jsonArtifacts;
  const [explainGraphMermaidBytes, explainGraphDotBytes] = graphProjectionBytes;

  const verificationArtifacts = {
    verificationReport,
    runtimeReport,
    policyReport,
    acceptanceCoverage
  };
  assertCanonicalVerificationArtifactSet(verificationArtifacts);

  assertSameCanonicalJsonValue('Lock', lock, stageLock);
  assertSameCanonicalJsonValue('Verification report', verificationArtifacts.verificationReport, stageVerificationReport);
  assertSameCanonicalJsonValue('Provenance', provenance, stageProvenance);
  assertSameCanonicalJsonValue('ExplainGraph', explainGraph, stageExplainGraph);
  assertSameCanonicalJsonValue('ReviewSummary', reviewSummary, stageReviewSummary);

  const expectedCoverage = await buildAcceptanceCoverage(workspaceRoot, lock, verificationArtifacts.runtimeReport);
  assertSameCanonicalJsonValue('acceptance coverage', verificationArtifacts.acceptanceCoverage, expectedCoverage);

  const expectedProvenance = await buildProvenance(workspaceRoot, lock);
  assertSameCanonicalJsonValue('Provenance', provenance, expectedProvenance);

  const { policyReport: governancePolicyReport, repairPlan, upgradePlan, upgradeDiagnostics } =
    await readReviewGovernanceReports(workspaceRoot);
  assertSameCanonicalJsonValue('policy report', governancePolicyReport, verificationArtifacts.policyReport);
  const expectedExplainGraph = await buildExplainGraph(
    workspaceRoot,
    lock,
    provenance,
    verificationArtifacts.acceptanceCoverage,
    governancePolicyReport,
    upgradePlan,
    repairPlan,
    upgradeDiagnostics
  );
  assertSameCanonicalJsonValue('ExplainGraph', explainGraph, expectedExplainGraph);
  assertExactArtifactBytes('ExplainGraph Mermaid', explainGraphMermaidBytes, renderExplainGraphMermaid(explainGraph));
  assertExactArtifactBytes('ExplainGraph DOT', explainGraphDotBytes, renderExplainGraphDot(explainGraph));

  const expectedReviewSummary = await buildReviewSummary(
    workspaceRoot,
    lock,
    provenance,
    verificationArtifacts.verificationReport,
    verificationArtifacts.acceptanceCoverage
  );
  assertSameCanonicalJsonValue('ReviewSummary', reviewSummary, expectedReviewSummary);

  const expectedLocalViews = await buildLocalViewArtifacts(workspaceRoot);
  if (
    expectedLocalViews.length !== localViewLocations.length ||
    localViewBytes.length !== localViewLocations.length
  ) {
    throw new Error('Pipeline completion local-view closure is incomplete');
  }
  const localViews = expectedLocalViews.map((expectedView, index) => {
    const [relativePath] = localViewLocations[index]!;
    const bytes = localViewBytes[index]!;
    if (expectedView.relativePath !== relativePath) {
      throw new Error('Pipeline completion local-view closure is out of order');
    }
    assertExactArtifactBytes(`local view ${relativePath}`, bytes, expectedView.text);
    return { relativePath, bytes };
  });

  return createPipelineCompletionProof({
    transactionId: stageEvidence.transactionId,
    completedStages: stageEvidence.completedStages,
    semanticContext,
    lock,
    verificationReport: verificationArtifacts.verificationReport,
    provenance,
    explainGraph,
    reviewSummary,
    localViews
  });
}

function selectStages(options: CompileWorkspaceOptions): PipelineStageId[] {
  const fromIndex = options.from ? PIPELINE_STAGE_IDS.indexOf(options.from) : 0;
  const throughIndex = options.through
    ? PIPELINE_STAGE_IDS.indexOf(options.through)
    : PIPELINE_STAGE_IDS.length - 1;

  if (fromIndex < 0 || throughIndex < 0 || fromIndex > throughIndex) {
    throw new Error(`Invalid pipeline stage range: ${options.from ?? PIPELINE_STAGE_IDS[0]} -> ${options.through ?? PIPELINE_STAGE_IDS.at(-1)}`);
  }
  const selected = PIPELINE_STAGE_IDS.slice(fromIndex, throughIndex + 1);
  const semanticIndex = PIPELINE_STAGE_IDS.indexOf('semantic');
  return fromIndex > semanticIndex ? ['semantic', ...selected] : selected;
}

export async function compileWorkspace(
  workspaceRoot = process.cwd(),
  options: CompileWorkspaceOptions = {}
): Promise<CompileWorkspaceResult> {
  const stages = selectStages(options);
  if (options.applyWorkbenchMutations && !stages.includes('resolve')) {
    throw new Error('Workbench mutations require a pipeline range that includes resolve');
  }
  if (options.isolatedVerificationCapability) {
    assertIsolatedVerificationCapability(workspaceRoot, options.isolatedVerificationCapability);
  }
  await emitPipelineExecutionBoundary(
    options.onEvent,
    PIPELINE_PENDING_TRANSACTION_ID,
    'pipeline-lease-bind'
  );
  return withWorkspaceWriteLease(workspaceRoot, options.workspaceWriteLease, async (workspaceWriteLease) => {
    await emitPipelineExecutionBoundary(
      options.onEvent,
      PIPELINE_PENDING_TRANSACTION_ID,
      'pipeline-lease-bound'
    );
    return withMonitoredWorkspaceWriteLease(workspaceRoot, workspaceWriteLease, async (leaseSignal) => {
      await emitPipelineExecutionBoundary(
        options.onEvent,
        PIPELINE_PENDING_TRANSACTION_ID,
        'pipeline-transaction-bootstrap'
      );
      return withPipelineTransaction(
      workspaceRoot,
      options.source ?? 'api',
      stages,
      options.onEvent,
      async (context) => {
        if (options.applyWorkbenchMutations) {
          await assertWorkspaceWriteLease(workspaceRoot, workspaceWriteLease);
          await applyWorkbenchMutations(workspaceRoot, workspaceWriteLease);
        }

        let plan: PlanFile | undefined;
        let verificationReport: VerificationReport | undefined;
        let emittedLock: LockFile | undefined;
        let emittedProvenance: ProvenanceFile | undefined;
        let explainGraph: ExplainGraph | undefined;
        let reviewSummary: ReviewSummary | undefined;
        let semanticContext: PipelineSemanticContext | undefined;
        const completedStages: PipelineStageId[] = [];

        for (const stage of stages) {
          await assertWorkspaceWriteLease(workspaceRoot, workspaceWriteLease);
          await emitPipelineExecutionBoundary(
            context.onEvent,
            context.transactionId,
            `pipeline-${stage}`
          );
          if (stage === 'resolve') {
            const result = await resolveWorkspace(workspaceRoot, context);
            plan = result.plan;
          } else if (stage === 'semantic') {
            semanticContext = await runWorkspaceSemanticFrontend(workspaceRoot, context);
          } else if (stage === 'compose') {
            requirePipelineSemanticContext(context);
            const result = await composeWorkspace(workspaceRoot, { signal: leaseSignal }, context);
            plan = result.plan;
          } else if (stage === 'adapt') {
            requirePipelineSemanticContext(context);
            const result = await adaptWorkspace(workspaceRoot, context);
            plan = result.plan;
          } else if (stage === 'verify') {
            requirePipelineSemanticContext(context);
            const result = await verifyWorkspace(
              workspaceRoot,
              {
                lane: options.verificationLane ?? 'all',
                signal: leaseSignal,
                ...(options.stagedVerificationProof
                  ? { stagedVerificationProof: options.stagedVerificationProof }
                  : {}),
                ...(options.isolatedVerificationCapability
                  ? { isolatedVerificationCapability: options.isolatedVerificationCapability }
                  : {})
              },
              context
            );
            verificationReport = result.report;
          } else if (stage === 'lock') {
            requirePipelineSemanticContext(context);
            await lockWorkspace(workspaceRoot, context);
          } else if (stage === 'emit') {
            requirePipelineSemanticContext(context);
            const result = await explainWorkspace(workspaceRoot, context);
            emittedLock = result.lock;
            emittedProvenance = result.provenance;
            explainGraph = result.graph;
            reviewSummary = result.reviewSummary;
          }
          completedStages.push(stage);
        }

        const lock = await readLockFile(workspaceRoot);
        const completionProof = await buildPipelineCompletionProof(
          workspaceRoot,
          {
            transactionId: context.transactionId,
            completedStages,
            semanticContext,
            lock: emittedLock,
            verificationReport,
            provenance: emittedProvenance,
            explainGraph,
            reviewSummary
          }
        );
        if (options.stagedVerificationProof) {
          await assertWorkspaceWriteLease(workspaceRoot, workspaceWriteLease);
          const paths = getWorkspacePaths(workspaceRoot);
          const verificationArtifacts = {
            verificationReport: await readCanonicalJsonArtifact<unknown>(
              paths.verificationReportPath,
              'Verification report'
            ),
            runtimeReport: await readCanonicalJsonArtifact<unknown>(
              paths.runtimeReportPath,
              'runtime report'
            ),
            policyReport: await readCanonicalJsonArtifact<unknown>(
              paths.policyReportPath,
              'policy report'
            ),
            acceptanceCoverage: await readCanonicalJsonArtifact<unknown>(
              paths.acceptanceCoveragePath,
              'acceptance coverage'
            )
          };
          assertCanonicalVerificationArtifactSet(verificationArtifacts);
          await assertStagedVerificationProofAfterPipeline(
            workspaceRoot,
            lock,
            verificationArtifacts,
            options.stagedVerificationProof
          );
          await assertWorkspaceWriteLease(workspaceRoot, workspaceWriteLease);
        }
        return {
          transactionId: context.transactionId,
          completedStages,
          ...(semanticContext ? { semanticContext } : {}),
          ...(plan ? { plan } : {}),
          lock,
          ...(verificationReport ? { verificationReport } : {}),
          ...(explainGraph ? { explainGraph } : {}),
          ...(reviewSummary ? { reviewSummary } : {}),
          ...(completionProof ? { completionProof } : {})
        };
      },
      workspaceWriteLease
      );
    });
  });
}
