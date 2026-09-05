import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';

import type { ExplainGraph } from '../../semantic/projection/contract/explain.ts';
import type { ProvenanceFile } from '../../semantic/provenance/contract/types.ts';
import { compareCodeUnits, rawSha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import { assertCanonicalVerificationArtifactSet } from '../../verification/artifact/contract/artifact.ts';
import { CI_ARTIFACT_FILES } from '../../verification/ci-artifacts/contract/manifest.ts';
import type { VerificationReport } from '../../verification/contract/types.ts';
import { validateReviewSummary } from '../../verification/review/contract/summary.ts';
import { type ReviewSummary } from '../../verification/review/contract/types.ts';
import { formatJsonFile } from '../../workspace/files.ts';
import { assertWorkspaceWriteLease, withWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../workspace/lease.ts';
import { resolveWorkspaceArtifactPath } from '../../workspace/runtime/paths.ts';
import type { LockFile, PlanFile } from '../contract.ts';
import { readReviewGovernanceReports } from '../emit/read-review-governance-reports.ts';
import {
  buildExplainGraph,
  renderExplainGraphDot,
  renderExplainGraphMermaid
} from '../emit/write-explain-graph.ts';
import { buildProvenance } from '../emit/write-provenance.ts';
import {
  buildProvenanceSummary,
  buildReviewSummary,
  buildSemanticViewSummary
} from '../emit/write-review-summary.ts';
import { readLockFile } from '../lock.ts';
import { emitPipelineExecutionBoundary } from '../pipeline/journal.ts';
import { withPipelineTransaction } from '../pipeline/kernel.ts';
import { getPipelineStageDefinition } from '../pipeline/pass-registry.ts';
import { withLeaseObservationMonitor } from '../pipeline/lease-monitor.ts';
import { bindPipelineCompileRequest, type PipelineCompileRequest } from '../pipeline/invocation.ts';
import { requirePipelineSemanticContext } from '../pipeline/semantic-context.ts';
import {
  PIPELINE_COMPLETION_PROOF_REVISION,
  PIPELINE_STAGE_IDS,
  type PassId,
  type PipelineCompletionProof,
  type PipelineEventHandler,
  type PipelineSemanticContext,
  type PipelineStageId
} from '../pipeline/types.ts';
import { buildAcceptanceCoverage } from '../verify/build-acceptance-coverage.ts';
import { resolveWorkspace } from './block-orchestrator.ts';
import { composeWorkspace } from './compose-orchestrator.ts';
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
  return withLeaseObservationMonitor(
    () => assertWorkspaceWriteLease(workspaceRoot, workspaceWriteLease), callback
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
  'proofRevision'
] as const;

function proofJsonDigest(value: unknown): string {
  return rawSha256(JSON.stringify(value));
}


function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertSameCanonicalJsonValue(label: string, actual: unknown, expected: unknown): void {
  if (formatJsonFile(actual) !== formatJsonFile(expected)) {
    throw new Error(`Pipeline completion ${label} does not match its canonical derivation`);
  }
}

async function readCanonicalJsonArtifact<T>(
  filePath: string,
  label: string,
  validate: (value: unknown) => T = (value) => value as T
): Promise<T> {
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
  try {
    return validate(value);
  } catch (error) {
    throw new Error(`Pipeline completion ${label} does not match its contract: ${String(error)}`);
  }
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
    throw new Error(`${label} must be an object with the exact schema`);
  }
  const actualKeys = Object.keys(value).sort(compareCodeUnits);
  const expectedKeys = [...expected].sort(compareCodeUnits);
  if (!sameOrderedValues(actualKeys, expectedKeys)) {
    throw new Error(`${label} does not match the exact schema`);
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

function assertDerivativeBindings(proof: PipelineCompletionProof, evidence: PipelineCompletionProofEvidence): void {
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

}

export function assertPipelineCompletionProofInvariant(
  value: unknown,
  evidence?: PipelineCompletionProofEvidence
): asserts value is PipelineCompletionProof {
  assertExactKeys(value, PIPELINE_COMPLETION_PROOF_KEYS, 'Pipeline completion proof');
  const proof = value as unknown as PipelineCompletionProof;
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

export function createPipelineCompletionProof(evidence: PipelineCompletionProofEvidence): PipelineCompletionProof {
  const completedPasses = completionPassClosure();
  const withoutRevision: Omit<PipelineCompletionProof, 'proofRevision'> = {
    formatRevision: PIPELINE_COMPLETION_PROOF_REVISION,
    transactionId: evidence.transactionId,
    inputRevision: evidence.semanticContext.inputRevision,
    semanticRevision: evidence.semanticContext.semanticRevision,
    completedStages: [...evidence.completedStages],
    completedPasses,
    verificationDigest: proofJsonDigest(evidence.verificationReport),
    provenanceDigest: proofJsonDigest(evidence.provenance),
    explainGraphDigest: proofJsonDigest(evidence.explainGraph),
    reviewSummaryDigest: proofJsonDigest(evidence.reviewSummary)
  };
  const proof: PipelineCompletionProof = {
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
    completedPasses: Object.freeze([...proof.completedPasses])
  });
}

export async function buildPipelineCompletionProof(
  workspaceRoot: string,
  stageEvidence: PipelineCompletionProofStageEvidence
): Promise<PipelineCompletionProof | undefined> {
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

  const [jsonArtifacts, graphProjectionBytes] = await Promise.all([
    Promise.all([
      readCanonicalJsonArtifact<LockFile>(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock), 'Lock'),
      readCanonicalJsonArtifact<unknown>(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.verificationReport), 'Verification report'),
      readCanonicalJsonArtifact<unknown>(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.runtimeReport), 'runtime report'),
      readCanonicalJsonArtifact<unknown>(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.policyReport), 'policy report'),
      readCanonicalJsonArtifact<unknown>(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.acceptanceCoverage), 'acceptance coverage'),
      readCanonicalJsonArtifact<ProvenanceFile>(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance), 'Provenance'),
      readCanonicalJsonArtifact<ExplainGraph>(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.explainGraph), 'ExplainGraph'),
      readCanonicalJsonArtifact(
        resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.reviewSummary),
        'ReviewSummary',
        validateReviewSummary
      )
    ]),
    Promise.all([
      readRequiredArtifactBytes(
        resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.explainGraphMermaid),
        'ExplainGraph Mermaid'
      ),
      readRequiredArtifactBytes(
        resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.explainGraphDot),
        'ExplainGraph DOT'
      )
    ])
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

  const { policyReport: governancePolicyReport, upgradePlan, upgradeDiagnostics } =
    await readReviewGovernanceReports(workspaceRoot);
  assertSameCanonicalJsonValue('policy report', governancePolicyReport, verificationArtifacts.policyReport);
  const expectedExplainGraph = await buildExplainGraph(
    workspaceRoot,
    lock,
    provenance,
    verificationArtifacts.acceptanceCoverage,
    governancePolicyReport,
    upgradePlan,
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

  return createPipelineCompletionProof({
    transactionId: stageEvidence.transactionId,
    completedStages: stageEvidence.completedStages,
    semanticContext,
    lock,
    verificationReport: verificationArtifacts.verificationReport,
    provenance,
    explainGraph,
    reviewSummary
  });
}

export async function compileWorkspace(
  workspaceRoot = process.cwd(),
  options: CompileWorkspaceOptions = {}
): Promise<CompileWorkspaceResult> {
  const request = bindPipelineCompileRequest(options);
  const { onEvent, isolatedVerificationCapability, stagedVerificationProof, workspaceWriteLease: requestedLease } = options;
  if (onEvent !== undefined && typeof onEvent !== 'function') {
    throw new TypeError('Pipeline event handler must be callable');
  }
  // Capture capability identities before any callback or await. This snapshot
  // grants nothing: existing capability, lease and proof owners still validate.
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
  return withWorkspaceWriteLease(workspaceRoot, bindings.requestedLease, async (workspaceWriteLease) => {
    await emitPipelineExecutionBoundary(
      bindings.onEvent,
      PIPELINE_PENDING_TRANSACTION_ID,
      'pipeline-lease-bound'
    );
    return withMonitoredWorkspaceWriteLease(workspaceRoot, workspaceWriteLease, async (leaseSignal) => {
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
      async (context) => {
        let plan: PlanFile | undefined;
        let verificationReport: VerificationReport | undefined;
        let emittedLock: LockFile | undefined;
        let emittedProvenance: ProvenanceFile | undefined;
        let explainGraph: ExplainGraph | undefined;
        let reviewSummary: ReviewSummary | undefined;
        let semanticContext: PipelineSemanticContext | undefined;
        const completedStages: PipelineStageId[] = [];

        const executeStage: Readonly<Record<PipelineStageId, () => Promise<void>>> = Object.freeze({
          resolve: async () => {
            const result = await resolveWorkspace(workspaceRoot, context);
            plan = result.plan;
          },
          semantic: async () => {
            semanticContext = await runWorkspaceSemanticFrontend(workspaceRoot, context);
          },
          compose: async () => {
            requirePipelineSemanticContext(context);
            const result = await composeWorkspace(workspaceRoot, { signal: leaseSignal }, context);
            plan = result.plan;
          },
          verify: async () => {
            requirePipelineSemanticContext(context);
            const result = await verifyWorkspace(
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
            verificationReport = result.report;
          },
          lock: async () => {
            requirePipelineSemanticContext(context);
            await lockWorkspace(workspaceRoot, context);
          },
          emit: async () => {
            requirePipelineSemanticContext(context);
            const result = await explainWorkspace(workspaceRoot, context);
            emittedLock = result.lock;
            emittedProvenance = result.provenance;
            explainGraph = result.graph;
            reviewSummary = result.reviewSummary;
          }
        });
        for (const stage of stages) {
          await assertWorkspaceWriteLease(workspaceRoot, workspaceWriteLease);
          await emitPipelineExecutionBoundary(context.onEvent, context.transactionId, `pipeline-${stage}`);
          await executeStage[stage]();
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
        if (bindings.stagedVerificationProof) {
          await assertWorkspaceWriteLease(workspaceRoot, workspaceWriteLease);
          const verificationArtifacts = {
            verificationReport: await readCanonicalJsonArtifact<unknown>(
              resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.verificationReport),
              'Verification report'
            ),
            runtimeReport: await readCanonicalJsonArtifact<unknown>(
              resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.runtimeReport),
              'runtime report'
            ),
            policyReport: await readCanonicalJsonArtifact<unknown>(
              resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.policyReport),
              'policy report'
            ),
            acceptanceCoverage: await readCanonicalJsonArtifact<unknown>(
              resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.acceptanceCoverage),
              'acceptance coverage'
            )
          };
          assertCanonicalVerificationArtifactSet(verificationArtifacts);
          await assertStagedVerificationProofAfterPipeline(
            workspaceRoot,
            lock,
            verificationArtifacts,
            bindings.stagedVerificationProof
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
