import type {
  SemanticMutationVerificationCapabilityPlan,
  SemanticMutationVerificationReport,
  SemanticMutationVerifyAllRunner
} from '../../../assurance/verification/contract/types.ts';
import {
  assessIsolatedArtifacts
} from '../../../assurance/verification/semantic-mutation/isolated/artifact-assessment.ts';
import type {
  IsolatedVerificationEvidenceArtifacts
} from '../../../assurance/verification/semantic-mutation/isolated/evidence.ts';
import {
  buildStagedVerificationProofBinding,
  type StagedVerificationProof,
  type StagedVerificationProofBinding,
  type StagedVerificationProofSource
} from '../../../assurance/verification/staged-proof/contract.ts';
import { sha256 } from '../../../compiler/semantic-mutation/canonical.ts';
import { semanticMutationRequiredVerificationDigest } from '../../../compiler/semantic-mutation/verification-policy.ts';
import type {
  SemanticMutationPlan,
  SemanticMutationVerificationExecutionRef
} from '../../../semantics/mutation/types.ts';

type ReadyPlan = Extract<SemanticMutationPlan, { readonly status: 'ready' }>;
type Awaitable<T> = T | PromiseLike<T>;

interface SemanticMutationIsolatedArtifactSet
  extends IsolatedVerificationEvidenceArtifacts {
  readonly status: 'passed' | 'failed';
  readonly stagedVerificationProofSource?: StagedVerificationProofSource;
}

export interface IsolationFailureObservation {
  readonly stage: string;
}

export interface IsolatedVerificationOperations {
  commitFence(): Awaitable<void>;
  executeVerification(
    input: Readonly<{
      capabilityPlan: SemanticMutationVerificationCapabilityPlan;
      requirements: ReadyPlan['requiredVerification'];
      planRevision: string;
      attempted: ReadyPlan['staged'];
      stagedSourceDigest: string;
      requiredVerificationDigest: string;
    }>,
    runner: SemanticMutationVerifyAllRunner
  ): Promise<SemanticMutationVerificationReport>;
  runArtifacts(): Promise<SemanticMutationIsolatedArtifactSet>;
  classifyFailure(error: unknown): IsolationFailureObservation;
  blockedEvidenceDigest(failure: IsolationFailureObservation): string;
  buildExecutionRef(report: SemanticMutationVerificationReport): SemanticMutationVerificationExecutionRef;
  issueProof(input: Readonly<{
    source: StagedVerificationProofSource;
    evidenceDigest: string;
    binding: StagedVerificationProofBinding;
  }>): Promise<StagedVerificationProof>;
  assertProofBinding(proof: StagedVerificationProof, binding: StagedVerificationProofBinding): void;
  recordBlockedFailure?(failure: IsolationFailureObservation): void;
  recordPassedVerificationProof?(proof: StagedVerificationProof): void;
}

/** Coordinate isolated Verification for one already-derived ready mutation.
 * Child execution and proof issuance remain injected effects; assurance owns
 * artifact binding and application owns sequencing/result promotion. */
export async function coordinateSemanticMutationIsolatedVerification(
  plan: ReadyPlan,
  capabilityPlan: SemanticMutationVerificationCapabilityPlan,
  operations: IsolatedVerificationOperations
): Promise<SemanticMutationVerificationExecutionRef> {
  const {
    commitFence, executeVerification, runArtifacts, classifyFailure,
    blockedEvidenceDigest, buildExecutionRef, issueProof, assertProofBinding,
    recordBlockedFailure, recordPassedVerificationProof
  } = operations;
  if ([commitFence, executeVerification, runArtifacts, classifyFailure, blockedEvidenceDigest,
    buildExecutionRef, issueProof, assertProofBinding].some(value => typeof value !== 'function') ||
    (recordBlockedFailure !== undefined && typeof recordBlockedFailure !== 'function') ||
    (recordPassedVerificationProof !== undefined &&
      typeof recordPassedVerificationProof !== 'function')) {
    throw new TypeError('Semantic Mutation isolated Verification operations must be callable');
  }

  await commitFence.call(operations);
  const requiredVerificationDigest =
    semanticMutationRequiredVerificationDigest(plan.requiredVerification);
  let passedArtifacts: SemanticMutationIsolatedArtifactSet | undefined;
  let passedEvidenceDigest: string | undefined;
  const report = await executeVerification.call(operations, {
    capabilityPlan,
    requirements: plan.requiredVerification,
    planRevision: plan.planRevision,
    attempted: plan.staged,
    stagedSourceDigest: plan.sourceChanges[0].stagedByteDigest,
    requiredVerificationDigest
  }, async () => {
    try {
      const artifacts = await runArtifacts.call(operations);
      await commitFence.call(operations);
      const assessment = assessIsolatedArtifacts({
        attempted: plan.staged,
        artifactStatus: artifacts.status,
        artifacts
      });
      if (assessment.status === 'blocked') {
        recordBlockedFailure?.call(operations, assessment.failure);
        return assessment;
      }
      if (artifacts.status === 'passed') {
        passedArtifacts = artifacts;
        passedEvidenceDigest = assessment.evidenceDigest;
      }
      return {
        status: artifacts.status,
        evidenceDigest: assessment.evidenceDigest
      };
    } catch (error) {
      const failure = classifyFailure.call(operations, error);
      recordBlockedFailure?.call(operations, failure);
      return {
        status: 'blocked' as const,
        evidenceDigest: blockedEvidenceDigest.call(operations, failure)
      };
    }
  });

  await commitFence.call(operations);
  const execution = buildExecutionRef.call(operations, report);
  if (execution.status !== 'passed') return execution;
  if (!passedArtifacts || passedEvidenceDigest === undefined) {
    throw new Error('Passed isolated Verification is missing its canonical artifact set');
  }
  const passedExecution = Object.freeze({ ...execution, status: 'passed' as const });
  if (!passedArtifacts.stagedVerificationProofSource ||
      report.status !== 'passed' ||
      report.executions.some(candidate =>
        candidate.status !== 'passed' ||
        candidate.runner !== 'verify-all' ||
        candidate.evidenceDigest !== passedEvidenceDigest)) {
    throw new Error('Passed isolated Verification does not own one exact staged proof source');
  }
  const binding = buildStagedVerificationProofBinding(passedExecution, sha256(report));
  const proof = await issueProof.call(operations, {
    source: passedArtifacts.stagedVerificationProofSource,
    evidenceDigest: passedEvidenceDigest,
    binding
  });
  assertProofBinding.call(operations, proof, binding);
  await commitFence.call(operations);
  recordPassedVerificationProof?.call(operations, proof);
  return execution;
}
