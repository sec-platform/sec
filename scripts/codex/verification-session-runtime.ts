/** Canonical VerificationSession V2 operator reducer and trusted runtime guards. */

import { createHash } from 'node:crypto';

import {
  CodexDevelopmentAssertVerificationSessionArtifactCurrentV2,
  CodexDevelopmentAssertVerificationSessionArtifactV2,
  CodexDevelopmentFinalizeVerificationSessionArtifactV2,
  CodexDevelopmentRefreshVerificationSessionArtifactV2,
  type CodexDevelopmentVerificationEvidenceProducerV4,
  type CodexDevelopmentVerificationEvidenceV4,
  type CodexDevelopmentVerificationSessionArtifactV2
} from '../../platform/shared/ci-evidence-contract.ts';
import {
  CodexDevelopmentAssertTestImpactTransitionSelectionV1,
  type CodexDevelopmentTestImpactTransitionObservationV1
} from '../../platform/shared/ci-git-changed-files.ts';
import { CI_VERIFICATION_CONTRACT_REVISION, CodexDevelopmentBuildVerificationPlanV1 } from '../../platform/shared/ci-verification-plan.ts';
import {
  CI_MAIN_HEALTH_POLICY_DIGEST_V1,
  CI_MAIN_HEALTH_POLICY_V1,
  CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS_V2,
  CI_VERIFICATION_SESSION_DISPATCH_TYPE,
  CI_VERIFICATION_SESSION_REQUEST_SCHEMA
} from '../../platform/shared/ci-verification-revision.ts';
import {
  assertIntegrationAuthorizationUsableV1,
  type IntegrationAuthorizationV1
} from '../../platform/shared/integration-authorization-contract.ts';
import {
  createMainHealthLedgerV1,
  resolveMainHealthLaneV1,
  type MainHealthLedgerInputV1,
  type MainHealthLedgerV1
} from '../../platform/shared/main-health-contract.ts';
import {
  assertReviewStabilityReceiptCurrentV1,
  createReviewStabilityReceiptV1,
  SEC_REVIEW_STABILITY_POLICY_V1,
  type ReviewStabilityReceiptV1
} from '../../platform/shared/review-stability-contract.ts';
import {
  assertScopeAuthorizationCurrentV1,
  createScopeAuthorizationRevisionV1,
  createScopeAuthorizationV1,
  parseScopeAuthorizationV1,
  type ScopeAuthorizationInputV1,
  type ScopeAuthorizationV1
} from '../../platform/shared/scope-authorization-contract.ts';
import {
  buildCiVerificationActionPlanClosureV1,
  ciVerificationGateStepV1,
  parseCiVerificationActionPlanClosureV1,
  type CiVerificationActionPlanClosureV1,
  type CiVerificationExecutionEnvironmentV2
} from '../../platform/shared/verification-action-ci-contract.ts';
import {
  encodeVerificationActionDataV2,
  type VerificationActionInputRefV2
} from '../../platform/shared/verification-action-contract.ts';
import {
  createVerificationSessionProposalDigestV1,
  createVerificationSessionRevisionV2,
  createVerificationSessionV2,
  parseVerificationSessionV2,
  type VerificationSessionInputV2,
  type VerificationSessionV2
} from '../../platform/shared/verification-session-contract.ts';
import {
  assertBranchCloseoutOperationBindingV1,
  type BranchCloseoutOperationBindingV1
} from './branch-closeout-contract.ts';
import {
  parseIntegrationAuthorizationOperationPublicationV1,
  type IntegrationAuthorizationOperationPublicationV1
} from './integration-authorization-publication.ts';
import { createObservedMainHealthInputV1 } from './main-health-observation.ts';
import {
  assertCanonicalMergeMessageV1,
  CodexDevelopmentCreateHostedArtifactObservationV2,
  CodexDevelopmentCreateMergeGateInputV2,
  CodexDevelopmentParseMergeGateResultV2,
  createMergeGateProvenanceV2,
  type CodexDevelopmentHostedArtifactObservationV2,
  type CodexDevelopmentMergeGateCandidateV2,
  type CodexDevelopmentMergeGateInputV2,
  type CodexDevelopmentMergeGateProvenanceV2,
  type CodexDevelopmentMergeGateResultV2
} from './merge-gate.ts';
import {
  assertGitHubReviewAuthorityObservationV1,
  type GitHubActionsArtifactObservationV1,
  type GitHubCandidateObservationV1,
  type GitHubCheckObservationV1,
  type GitHubReviewBarrierObservationV1,
  type PlatformEnforcementObservationV1,
  type VerificationSessionGitHubClientV1
} from './verification-session-github.ts';
import {
  appendVerificationSessionJournalEventV1,
  claimVerificationSessionOperationV1,
  createVerificationSessionOperationId,
  readVerificationSessionJournalV1,
  type VerificationSessionJournalFileSystem
} from './verification-session-journal.ts';

export const VERIFICATION_SESSION_HOSTED_REQUEST_SCHEMA_V1 =
  CI_VERIFICATION_SESSION_REQUEST_SCHEMA;
export const VERIFICATION_SESSION_HOSTED_EVENT_V2 = CI_VERIFICATION_SESSION_DISPATCH_TYPE;

/**
 * Canonical post-new-main health consumer for IssueDisposition evidence.
 * Callers supply provider observations only; exact-main identity, freshness,
 * producer matching, convergence, and ordinary-lane eligibility remain owned
 * by MainHealth.
 */
export function compilePostMainIssueDispositionHealthReadbackV1(input: Readonly<{
  repository: string;
  newMainSha: string;
  newMainTreeSha: string;
  observedAt: string;
  sourceRunId: string;
  sourceRef: string;
  checks: readonly GitHubCheckObservationV1[];
}>): MainHealthLedgerV1 {
  const expiresAt = new Date(new Date(input.observedAt).getTime() + 300_000).toISOString();
  const ledger = createMainHealthLedgerV1(createObservedMainHealthInputV1({
    repository: input.repository,
    mainSha: input.newMainSha,
    mainTreeSha: input.newMainTreeSha,
    trustRevision: input.newMainSha,
    observedAt: input.observedAt,
    expiresAt,
    sourceRunId: input.sourceRunId,
    sourceRef: input.sourceRef,
    checks: input.checks
  }));
  const lane = resolveMainHealthLaneV1({
    ledger,
    lane: 'ordinary',
    now: input.observedAt,
    expectedRepository: input.repository,
    expectedDefaultBranch: 'main',
    expectedMainSha: input.newMainSha,
    expectedMainTreeSha: input.newMainTreeSha,
    expectedTrustRevision: input.newMainSha
  });
  if (!lane.allowed || lane.status !== 'healthy' || lane.observationValidity !== 'valid'
    || lane.ledger === null || lane.ledger.allowedLanes.length !== 1
    || lane.ledger.allowedLanes[0] !== 'ordinary') {
    throw new Error('IssueDisposition post-main evidence requires canonical fresh healthy ordinary-only MainHealth.');
  }
  return lane.ledger;
}
export const VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA_V1 =
  'sec-verification-session-hosted-envelope-v1' as const;

type Digest = `sha256:${string}`;

function hash(value: unknown): Digest {
  return `sha256:${createHash('sha256').update(encodeVerificationActionDataV2(value)).digest('hex')}`;
}

export const SEC_INTEGRATION_PLATFORM_POLICY_V1 = Object.freeze({
  schema: 'sec-integration-platform-policy-v1',
  physicalMerge: 'gh-pr-merge-squash-match-head-no-admin',
  allowPlatformEnforcementUnavailable: true,
  claimsNoBypassEnforcement: false
});
export const SEC_INTEGRATION_PLATFORM_POLICY_DIGEST_V1 = hash(SEC_INTEGRATION_PLATFORM_POLICY_V1);
export const SEC_MAIN_HEALTH_POLICY_DIGEST_V1 = CI_MAIN_HEALTH_POLICY_DIGEST_V1;
export const SEC_EVIDENCE_REQUIREMENT_DIGEST_V1 = hash(Object.freeze({
  schema: 'sec-verification-evidence-requirement-v4', terminalStatus: 'passed', exactActionClosure: true
}));
export const SEC_SCOPE_ISSUER_IDENTITY_V1 = 'scripts/codex/verification-session.ts@scope-issuer-v1' as const;

export type VerificationSessionActionDependencyBlobObservationV2 = Readonly<{
  path: (typeof CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS_V2)[number];
  baseSource: string;
  candidateSource: string;
}>;

/**
 * Canonical Action dependency inputs are semantic candidate inputs, not a
 * post-hoc ActionKey supplement. The Session producer observes exact blobs at
 * both the trusted base and candidate head, rejects any byte drift, and only
 * then hashes the candidate bytes into the Action input closure.
 */
export function createVerificationSessionActionDependencyRequiredBlobsV2(
  observations: readonly VerificationSessionActionDependencyBlobObservationV2[]
): readonly VerificationActionInputRefV2[] {
  if (!Array.isArray(observations)) {
    throw new Error('VerificationSession Action dependency observations must be an array.');
  }
  const byPath = new Map<string, VerificationSessionActionDependencyBlobObservationV2>();
  for (const observation of observations) {
    if (observation === null || typeof observation !== 'object'
      || !CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS_V2.includes(observation.path)
      || typeof observation.baseSource !== 'string'
      || typeof observation.candidateSource !== 'string'
      || byPath.has(observation.path)) {
      throw new Error('VerificationSession Action dependency observation set is malformed or duplicated.');
    }
    byPath.set(observation.path, observation);
  }
  if (byPath.size !== CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS_V2.length) {
    throw new Error('VerificationSession Action dependency observation set is incomplete.');
  }
  return Object.freeze(CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS_V2.map((dependencyPath) => {
    const observation = byPath.get(dependencyPath)!;
    const baseBytes = Buffer.from(observation.baseSource, 'utf8');
    const candidateBytes = Buffer.from(observation.candidateSource, 'utf8');
    if (!baseBytes.equals(candidateBytes)) {
      throw new Error(`VerificationSession Action dependency ${dependencyPath} drifted from the trusted base.`);
    }
    return Object.freeze({
      path: dependencyPath,
      digest: `sha256:${createHash('sha256').update(candidateBytes).digest('hex')}` as Digest
    });
  }));
}

export function createVerificationSessionMergeOperationIdV1(input: {
  sessionRevision: Digest; headSha: string; actionPlanDigest: Digest;
}): Digest {
  return createVerificationSessionOperationId({ sessionRevision: input.sessionRevision, operationKind: 'merge',
    semanticInputDigest: hash(Object.freeze({ headSha: input.headSha, actionPlanDigest: input.actionPlanDigest })) });
}

export function createVerificationSessionScopeProposalDigestV1(input: {
  repository: string; prNumber: number; baseSha: string; baseTreeSha: string;
  headSha: string; headTreeSha: string; manifestPath: string; manifestDigest: Digest;
  authorizedPaths: readonly string[]; profile: string; environmentDigest: Digest; trustRevision: string;
  testImpactTransitionDigest: Digest;
}): Digest {
  return hash(Object.freeze({ schema: 'sec-scope-proposal-v1', ...input,
    authorizedPaths: Object.freeze([...input.authorizedPaths].sort()) }));
}

function bindVerificationSessionTestImpactTransitionV1(input: {
  baseSha: string;
  headSha: string;
  changedPaths: readonly string[];
  transition: CodexDevelopmentTestImpactTransitionObservationV1;
  expectedDigest?: Digest;
}): Readonly<{
  digest: Digest;
  observation: CodexDevelopmentTestImpactTransitionObservationV1;
}> {
  const digest = CodexDevelopmentAssertTestImpactTransitionSelectionV1({
    baseSha: input.baseSha,
    headSha: input.headSha,
    changedPaths: input.changedPaths,
    observation: input.transition
  });
  if (input.expectedDigest !== undefined && digest !== input.expectedDigest) {
    throw new Error('VerificationSession test-impact transition differs from exact candidate selection input.');
  }
  return Object.freeze({ digest, observation: input.transition });
}

export function reconstructVerificationSessionHostedFactsV1(input: {
  request: VerificationSessionHostedRequestV1;
  repository: string;
  candidate: GitHubCandidateObservationV1;
  changedPaths: readonly string[];
  testImpactTransition: CodexDevelopmentTestImpactTransitionObservationV1;
  integrationPrincipalNodeId: string;
  producerPrincipalNodeId: string;
  sourceRunId: string;
  sourceRef: string;
  observedAt: string;
  reviewBarrier: Extract<GitHubReviewBarrierObservationV1, { status: 'clear' }>;
  mainHealthChecks: readonly GitHubCheckObservationV1[];
  dependencyBlobs: readonly VerificationSessionActionDependencyBlobObservationV2[];
}): VerificationSessionHostedFactsV1 {
  const request = input.request;
  const transition = bindVerificationSessionTestImpactTransitionV1({
    baseSha: request.expectedBaseSha,
    headSha: request.expectedHeadSha,
    changedPaths: input.changedPaths,
    transition: input.testImpactTransition
  });
  const environmentDigest = hash(Object.freeze({
    schema: 'sec-hosted-verification-environment-v1',
    toolchainRevision: `bun@${Bun.version}`,
    providerRevision: 'github-actions@trusted-default',
    contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
    trustRevision: request.expectedBaseSha
  }));
  const issuerSemantic = Object.freeze({
    principalId: input.producerPrincipalNodeId,
    role: 'trusted-base-a0' as const,
    trustRevision: request.expectedBaseSha,
    producerIdentity: SEC_SCOPE_ISSUER_IDENTITY_V1
  });
  const proposalDigest = createVerificationSessionScopeProposalDigestV1({
    repository: input.repository, prNumber: request.prNumber,
    baseSha: request.expectedBaseSha, baseTreeSha: request.expectedBaseTreeSha,
    headSha: request.expectedHeadSha, headTreeSha: request.expectedHeadTreeSha,
    manifestPath: request.manifestPath, manifestDigest: request.manifestDigest,
    authorizedPaths: input.changedPaths, profile: request.profile,
    environmentDigest, trustRevision: request.expectedBaseSha,
    testImpactTransitionDigest: transition.digest
  });
  if (proposalDigest !== request.expectedScopeProposalDigest) {
    throw new Error('observe-hosted reconstructed Scope proposal digest differs from request.');
  }
  const scopeAuthorizationRevision = createScopeAuthorizationRevisionV1({
    repository: input.repository, prNumber: request.prNumber,
    baseSha: request.expectedBaseSha, baseTreeSha: request.expectedBaseTreeSha,
    headSha: request.expectedHeadSha, headTreeSha: request.expectedHeadTreeSha,
    manifestPath: request.manifestPath, manifestDigest: request.manifestDigest,
    proposalDigest, authorizedPaths: input.changedPaths, profile: request.profile,
    environmentDigest, issuer: issuerSemantic
  });
  const plan = CodexDevelopmentBuildVerificationPlanV1(
    request.profile as 'quick' | 'full',
    input.changedPaths,
    undefined,
    transition.observation
  );
  if (!plan.selectionResolved) throw new Error('observe-hosted verification plan selection is unresolved.');
  const actionPlanClosure = buildCiVerificationActionPlanClosureV1({
    candidate: {
      baseSha: request.expectedBaseSha, baseTreeSha: request.expectedBaseTreeSha,
      headSha: request.expectedHeadSha, headTreeSha: request.expectedHeadTreeSha,
      manifestPath: request.manifestPath, manifestDigest: request.manifestDigest,
      scopeAuthorizationRevision, profile: request.profile as 'quick' | 'full',
      toolchainRevision: `bun@${Bun.version}`, providerRevision: 'github-actions@trusted-default',
      contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
      requiredBlobs: createVerificationSessionActionDependencyRequiredBlobsV2(input.dependencyBlobs)
    },
    gates: plan.gates.map(ciVerificationGateStepV1)
  });
  if (actionPlanClosure.actionPlanDigest !== request.expectedActionPlanDigest) {
    throw new Error('observe-hosted reconstructed Action plan differs from request.');
  }
  const sessionProposalDigest = createVerificationSessionProposalDigestV1({
    repository: input.repository, prNumber: request.prNumber,
    baseSha: request.expectedBaseSha, baseTreeSha: request.expectedBaseTreeSha,
    headSha: request.expectedHeadSha, headTreeSha: request.expectedHeadTreeSha,
    manifestPath: request.manifestPath, manifestDigest: request.manifestDigest,
    testImpactTransitionDigest: transition.digest,
    scopeProposalDigest: proposalDigest, actionPlanClosureDigest: actionPlanClosure.actionPlanDigest,
    profile: request.profile, environmentDigest, trustRevision: request.expectedBaseSha,
    reviewPolicyDigest: request.reviewPolicyDigest, mainHealthPolicyDigest: SEC_MAIN_HEALTH_POLICY_DIGEST_V1
  });
  const mainHealthInput = createObservedMainHealthInputV1({ repository: input.repository,
    mainSha: request.expectedBaseSha, mainTreeSha: request.expectedBaseTreeSha, trustRevision: request.expectedBaseSha,
    observedAt: input.observedAt, expiresAt: new Date(new Date(input.observedAt).getTime() + 600_000).toISOString(),
    sourceRunId: input.sourceRunId, sourceRef: input.sourceRef, checks: input.mainHealthChecks });
  const mainHealth = createMainHealthLedgerV1(mainHealthInput);
  const sessionRevision = createVerificationSessionRevisionV2({
    repository: input.repository, prNumber: request.prNumber,
    baseSha: request.expectedBaseSha, baseTreeSha: request.expectedBaseTreeSha,
    headSha: request.expectedHeadSha, headTreeSha: request.expectedHeadTreeSha,
    manifestPath: request.manifestPath, manifestDigest: request.manifestDigest,
    sessionProposalDigest, scopeAuthorizationRevision, actionPlanClosureDigest: actionPlanClosure.actionPlanDigest,
    profile: request.profile, environmentDigest, trustRevision: request.expectedBaseSha,
    reviewPolicyDigest: request.reviewPolicyDigest, evidenceRequirementDigest: SEC_EVIDENCE_REQUIREMENT_DIGEST_V1,
    integrationPolicyDigest: SEC_INTEGRATION_PLATFORM_POLICY_DIGEST_V1,
    mainHealthRef: { mainSha: request.expectedBaseSha, mainTreeSha: request.expectedBaseTreeSha, healthRevision: mainHealth.healthRevision }
  });
  if (sessionRevision !== request.expectedSessionRevision) {
    throw new Error('observe-hosted reconstructed Session revision differs from request.');
  }
  return Object.freeze({
    repository: input.repository, sessionId: `session-${sessionRevision.slice(7)}`, createdAt: input.observedAt,
    candidate: input.candidate, authorizedPaths: Object.freeze([...input.changedPaths]), sessionProposalDigest,
    scopeIssuer: { ...issuerSemantic, sourceTransport: 'github-actions' as const, sourceRunId: input.sourceRunId,
      sourceRef: input.sourceRef, sourceDigest: hash({ requestOperationId: request.requestOperationId, proposalDigest }) },
    scopeIssuedAt: input.observedAt, scopeExpiresAt: new Date(new Date(input.observedAt).getTime() + 600_000).toISOString(),
    environmentDigest, actionPlanClosure, testImpactTransitionDigest: transition.digest,
    mainHealth: mainHealthInput,
    evidenceRequirementDigest: SEC_EVIDENCE_REQUIREMENT_DIGEST_V1,
    integrationPolicyDigest: SEC_INTEGRATION_PLATFORM_POLICY_DIGEST_V1,
    reviewBarrier: input.reviewBarrier,
    reviewExpiresAt: new Date(new Date(input.observedAt).getTime() + 300_000).toISOString(),
    integrationPrincipalNodeId: input.integrationPrincipalNodeId
  });
}

export interface VerificationSessionHostedRequestV1 {
  schema: typeof VERIFICATION_SESSION_HOSTED_REQUEST_SCHEMA_V1;
  prNumber: number;
  expectedBaseSha: string;
  expectedBaseTreeSha: string;
  expectedHeadSha: string;
  expectedHeadTreeSha: string;
  manifestPath: string;
  manifestDigest: Digest;
  profile: string;
  expectedScopeProposalDigest: Digest;
  expectedActionPlanDigest: Digest;
  expectedSessionRevision: Digest;
  reviewPolicyDigest: Digest;
  requestOperationId: Digest;
}

export interface VerificationSessionHostedEnvelopeV1 {
  schema: typeof VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA_V1;
  requestOperationId: Digest;
  scopeAuthorization: ScopeAuthorizationV1;
  preGateReview: ReviewStabilityReceiptV1;
  mainHealth: MainHealthLedgerV1;
  session: VerificationSessionV2;
  actionPlanClosure: CiVerificationActionPlanClosureV1;
  envelopeDigest: Digest;
}

export interface VerificationSessionHostedFactsV1 {
  repository: string;
  sessionId: string;
  createdAt: string;
  candidate: GitHubCandidateObservationV1;
  authorizedPaths: readonly string[];
  sessionProposalDigest: Digest;
  scopeIssuer: ScopeAuthorizationInputV1['issuer'];
  scopeIssuedAt: string;
  scopeExpiresAt: string;
  environmentDigest: Digest;
  actionPlanClosure: CiVerificationActionPlanClosureV1;
  testImpactTransitionDigest: Digest;
  mainHealth: MainHealthLedgerInputV1;
  evidenceRequirementDigest: Digest;
  integrationPolicyDigest: Digest;
  reviewBarrier: Extract<GitHubReviewBarrierObservationV1, { status: 'clear' }>;
  reviewExpiresAt: string;
  integrationPrincipalNodeId: string;
}

export interface TrustedRuntimeProofV1 {
  currentHeadSha: string;
  currentBranch: string;
  localDefaultSha: string;
  remoteDefaultSha: string;
  workingTreeClean: boolean;
  tcbClosureMatched: boolean;
  runtimeEntrypointBlobMatched: boolean;
  boundaryTargetsMatched: boolean;
}

export interface TrustedArtifactProvenanceV1 {
  observation: CodexDevelopmentHostedArtifactObservationV2;
  artifactId: string;
  artifactName: string;
  canonicalByteDigest: Digest;
  downloadTransport: 'github-actions-artifact-api';
  artifactDigest: Digest;
  transport: {
    workflowPath: string;
    workflowRef: string;
    workflowSha: string;
    runId: string;
    runAttempt: number;
    actorNodeId: string;
    actorPermission: 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none';
  };
}

export interface TrustedIntegrationAuthorizationArtifactV1 {
  resultJson: string;
  artifactId: string;
  artifactName: string;
  canonicalByteDigest: Digest;
  workflowPath: '.github/workflows/sec-merge-gate.yml';
  workflowRef: string;
  workflowSha: string;
  runId: string;
  runAttempt: number;
  eventName: 'workflow_run';
  actorNodeId: string;
  actorPermission: 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none';
  downloadTransport: 'github-actions-artifact-api';
}

export type TrustedIntegrationAuthorizationSourceV1 =
  | Readonly<{ kind: 'actions-artifact'; artifact: TrustedIntegrationAuthorizationArtifactV1 }>
  | Readonly<{
      kind: 'github-comment';
      publication: IntegrationAuthorizationOperationPublicationV1;
      commentId: number;
    }>;

export function createTrustedIntegrationAuthorizationPublicationSourceV1(input: {
  publication: IntegrationAuthorizationOperationPublicationV1;
  commentId: number;
}): TrustedIntegrationAuthorizationSourceV1 {
  if (!Number.isSafeInteger(input.commentId) || input.commentId < 1) {
    throw new Error('Trusted integration authorization publication commentId must be positive.');
  }
  return Object.freeze({ kind: 'github-comment' as const,
    publication: parseIntegrationAuthorizationOperationPublicationV1(input.publication),
    commentId: input.commentId });
}

export function createTrustedHostedArtifactProvenanceV1(input: {
  artifact: CodexDevelopmentVerificationSessionArtifactV2;
  artifactText: string;
  observation: GitHubActionsArtifactObservationV1;
  actorPermission: TrustedArtifactProvenanceV1['transport']['actorPermission'];
}): TrustedArtifactProvenanceV1 {
  const observation = createHostedArtifactObservationV2({ artifact: input.artifact,
    artifactText: input.artifactText, observation: input.observation });
  return Object.freeze({ observation, artifactId: input.observation.artifactId, artifactName: input.observation.artifactName,
    canonicalByteDigest: hash(input.artifact), downloadTransport: 'github-actions-artifact-api',
    artifactDigest: input.artifact.artifactDigest as Digest, transport: Object.freeze({
      workflowPath: input.observation.workflowPath, workflowRef: input.observation.workflowRef,
      workflowSha: input.observation.workflowSha, runId: input.observation.runId,
      runAttempt: input.observation.runAttempt, actorNodeId: input.observation.actorNodeId,
      actorPermission: input.actorPermission }) });
}

export type VerificationSessionArtifactReuseDispositionV1 = Readonly<{
  status: 'whole-artifact-current' | 'fresh-authority-required' | 'not-reusable';
  actionEvidenceCandidate: boolean;
  reason: string;
}>;

/**
 * Separates short-lived authorization receipts from candidate Action Evidence.
 * `actionEvidenceCandidate` is deliberately not an authorization: the trusted
 * compiler must still run the canonical Evidence invalidation/reuse checks
 * before composing it into a fresh hosted envelope.
 */
export function classifyVerificationSessionArtifactReuseV1(
  artifact: CodexDevelopmentVerificationSessionArtifactV2,
  now: string
): VerificationSessionArtifactReuseDispositionV1 {
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs) || new Date(nowMs).toISOString() !== now) {
    throw new Error('artifact reuse observation time must be a canonical ISO instant.');
  }
  const actionEvidenceCandidate = artifact.evidence.status === 'passed'
    || artifact.evidence.status === 'failed';
  try {
    CodexDevelopmentAssertVerificationSessionArtifactCurrentV2(artifact, now);
    return Object.freeze({ status: 'whole-artifact-current', actionEvidenceCandidate,
      reason: 'canonical hosted authority is current' });
  } catch (error) {
    const currentReason = error instanceof Error ? error.message : String(error);
    if (actionEvidenceCandidate) return Object.freeze({ status: 'fresh-authority-required',
      actionEvidenceCandidate,
      reason: `rebuild fresh Scope/Review/MainHealth/Session authority and independently revalidate reusable Action Evidence: ${currentReason}` });
    return Object.freeze({ status: 'not-reusable', actionEvidenceCandidate,
      reason: `hosted authority is not current and Action Evidence is not passed: ${currentReason}` });
  }
}

export function createHostedArtifactObservationV2(input: {
  artifact: CodexDevelopmentVerificationSessionArtifactV2;
  artifactText: string;
  observation: GitHubActionsArtifactObservationV1;
}): CodexDevelopmentHostedArtifactObservationV2 {
  const canonicalBytes = `${encodeVerificationActionDataV2(input.artifact)}\n`;
  if (input.artifactText !== canonicalBytes) throw new Error('Downloaded hosted artifact bytes are not canonical or do not match the parsed artifact.');
  return CodexDevelopmentCreateHostedArtifactObservationV2({ artifactId: input.observation.artifactId,
    artifactName: input.observation.artifactName, artifactFileName: 'verification-session-artifact.json',
    artifactByteDigest: `sha256:${createHash('sha256').update(canonicalBytes).digest('hex')}`,
    artifactByteLength: Buffer.byteLength(canonicalBytes, 'utf8'), artifactExpired: false,
    workflowPath: input.observation.workflowPath as '.github/workflows/compiler-pr-validation.yml',
    workflowRef: input.observation.workflowRef, workflowSha: input.observation.workflowSha,
    runId: input.observation.runId, runAttempt: input.observation.runAttempt,
    eventName: input.observation.eventName as 'repository_dispatch', actorNodeId: input.observation.actorNodeId,
    actorPermission: input.observation.actorPermission as 'maintain' | 'admin',
    downloadTransport: 'github-actions-artifact-api' });
}

export function createTrustedIntegrationAuthorizationArtifactV1(input: {
  resultJson: string;
  observation: GitHubActionsArtifactObservationV1;
}): TrustedIntegrationAuthorizationArtifactV1 {
  const result = CodexDevelopmentParseMergeGateResultV2(input.resultJson);
  return Object.freeze({ resultJson: input.resultJson, artifactId: input.observation.artifactId,
    artifactName: input.observation.artifactName, canonicalByteDigest: hash(result),
    workflowPath: input.observation.workflowPath as '.github/workflows/sec-merge-gate.yml',
    workflowRef: input.observation.workflowRef, workflowSha: input.observation.workflowSha,
    runId: input.observation.runId, runAttempt: input.observation.runAttempt,
    eventName: input.observation.eventName as 'workflow_run', actorNodeId: input.observation.actorNodeId,
    actorPermission: input.observation.actorPermission, downloadTransport: 'github-actions-artifact-api' });
}

export interface VerificationSessionRuntimeExternal {
  now(): string;
  expiresAt(now: string, durationSeconds: number): string;
  trustedRuntimeProof(session: VerificationSessionV2): TrustedRuntimeProofV1;
  runLocalActions(session: VerificationSessionV2):
    | { status: 'passed'; resultDigest: Digest }
    | { status: 'waiting' }
    | { status: 'failed'; reason: string };
  hostedArtifact(): { artifact: CodexDevelopmentVerificationSessionArtifactV2; provenance: TrustedArtifactProvenanceV1 } | null;
  saveReviewReceipt(stage: 'pre-expensive' | 'pre-merge', receipt: ReviewStabilityReceiptV1): void;
  integrationAuthorizationArtifact(): TrustedIntegrationAuthorizationSourceV1 | null;
  integrationAuthorizationPublication(): IntegrationAuthorizationPublicationObservationV1 | null;
  consumedAuthorizationIds(): ReadonlySet<string>;
  observeCloseoutPreparation(
    operationId: Digest,
    authorization: IntegrationAuthorizationV1,
    session: VerificationSessionV2
  ): { status: 'prepared'; preparationDigest: Digest } | { status: 'waiting' | 'blocked'; reason: string };
  observeCloseoutBinding(
    authorization: IntegrationAuthorizationV1,
    session: VerificationSessionV2,
    merged: GitHubCandidateObservationV1
  ):
    | { status: 'available'; binding: BranchCloseoutOperationBindingV1 }
    | { status: 'waiting' | 'blocked'; reason: string };
  observeCloseout(
    binding: BranchCloseoutOperationBindingV1,
    authorization: IntegrationAuthorizationV1,
    session: VerificationSessionV2,
    merged: GitHubCandidateObservationV1
  ):
    | { status: 'completed' | 'protected-pending'; receiptDigest: Digest }
    | { status: 'waiting' | 'blocked'; reason: string };
}

export interface IntegrationAuthorizationPublicationObservationV1 {
  authorizationId: string;
  authorizationReceiptDigest: Digest;
  consumptionOperationId: Digest;
  authorizationPublicationId: Digest;
  authorizationPublicationDigest: Digest;
  commentId: number;
  preparationDigest: Digest;
}

export function integrationAuthorizationMergeMarkersV1(input: {
  sessionRevision: Digest;
  authorizationId: string;
  authorizationReceiptDigest: Digest;
  consumptionOperationId: Digest;
  authorizationPublicationId: Digest;
  authorizationPublicationDigest: Digest;
  commentId: number;
}): readonly string[] {
  if (!Number.isSafeInteger(input.commentId) || input.commentId < 1) {
    throw new Error('Integration authorization comment id must be positive.');
  }
  return Object.freeze([
    `Integration-Authorization: ${input.authorizationId}`,
    `Integration-Authorization-Receipt: ${input.authorizationReceiptDigest}`,
    `Integration-Authorization-Operation: ${input.consumptionOperationId}`,
    `Integration-Authorization-Publication: ${input.authorizationPublicationId}`,
    `Integration-Authorization-Publication-Digest: ${input.authorizationPublicationDigest}`,
    `Integration-Authorization-Comment: ${input.commentId}`,
    `Verification-Session: ${input.sessionRevision}`
  ]);
}

export type VerificationSessionRuntimeOutcomeV1 = Readonly<{
  status:
    | 'WAITING_ACTIONS'
    | 'WAITING_REVIEW'
    | 'WAITING_HOSTED_VERIFICATION'
    | 'WAITING_INTEGRATION_AUTHORIZATION'
    | 'READY_TO_INTEGRATE'
    | 'WAITING_MERGE_READBACK'
    | 'READY_TO_CLOSEOUT'
    | 'WAITING_CLOSEOUT'
    | 'AMBIGUOUS_SIDE_EFFECT'
    | 'BLOCKED'
    | 'COMPLETED';
  sessionRevision: Digest;
  completedStage: string | null;
  reason: string;
  receiptDigest: Digest | null;
  operationId: Digest | null;
  authorizationId: string | null;
}>;

function outcome(
  input: Omit<VerificationSessionRuntimeOutcomeV1, 'completedStage' | 'operationId' | 'authorizationId'> & {
    completedStage?: string | null;
    operationId?: Digest | null;
    authorizationId?: string | null;
  }
): VerificationSessionRuntimeOutcomeV1 {
  return Object.freeze({ completedStage: input.completedStage ?? null,
    operationId: input.operationId ?? null, authorizationId: input.authorizationId ?? null, ...input });
}

/**
 * Proves an exact trusted-default revision checkout. Hosted jobs intentionally
 * use detached HEAD when actions/checkout receives an exact SHA; local
 * main-authority operations use assertTrustedMainRuntimeV1 instead.
 */
export function assertTrustedExactRevisionRuntimeV1(
  proof: TrustedRuntimeProofV1,
  expectedMainSha: string,
  allowRemoteMainTransition = false
): void {
  if (
    // `actions/checkout` at an exact SHA intentionally leaves HEAD detached.
    // A detached checkout proves the trusted default revision through the SHA
    // bindings below; a named branch must still be the default branch.
    (proof.currentBranch !== '' && proof.currentBranch !== 'main')
    || proof.currentHeadSha !== expectedMainSha
    || proof.localDefaultSha !== expectedMainSha
    || (!allowRemoteMainTransition && proof.remoteDefaultSha !== expectedMainSha)
    || !proof.workingTreeClean
    || !proof.tcbClosureMatched
    || !proof.runtimeEntrypointBlobMatched || !proof.boundaryTargetsMatched
  ) {
    throw new Error('VerificationSession runtime is not the clean exact trusted default revision TCB.');
  }
}

export function assertTrustedRuntimeV1(
  proof: TrustedRuntimeProofV1,
  session: VerificationSessionV2,
  allowRemoteMainTransition = false
): void {
  if (session.trustRevision !== session.baseSha) {
    throw new Error('VerificationSession runtime is not the clean exact trusted default TCB.');
  }
  assertTrustedExactRevisionRuntimeV1(proof, session.baseSha, allowRemoteMainTransition);
}

export function assertTrustedMainRuntimeV1(proof: TrustedRuntimeProofV1, expectedMainSha: string): void {
  if (proof.currentBranch !== 'main') {
    throw new Error('VerificationSession preparation is not running from the clean exact trusted default TCB.');
  }
  assertTrustedExactRevisionRuntimeV1(proof, expectedMainSha);
}

export function assertTrustedMergedRuntimeReachabilityV1(input: {
  proof: TrustedRuntimeProofV1;
  session: VerificationSessionV2;
  candidate: GitHubCandidateObservationV1;
  github: VerificationSessionGitHubClientV1;
}): void {
  const { proof, session, candidate, github } = input;
  assertTrustedMergedRequestRuntimeReachabilityV1({ proof, repository: session.repository,
    prNumber: session.prNumber, baseSha: session.baseSha, headSha: session.headSha,
    headTreeSha: session.headTreeSha, candidate, github });
}

export function assertTrustedMergedRequestRuntimeReachabilityV1(input: {
  proof: TrustedRuntimeProofV1;
  repository: string;
  prNumber: number;
  baseSha: string;
  headSha: string;
  headTreeSha: string;
  candidate: GitHubCandidateObservationV1;
  github: VerificationSessionGitHubClientV1;
}): void {
  const { proof, repository, prNumber, baseSha, headSha, headTreeSha, candidate, github } = input;
  if ((proof.currentBranch !== '' && proof.currentBranch !== 'main') || proof.currentHeadSha !== baseSha
    || proof.localDefaultSha !== proof.remoteDefaultSha || !proof.workingTreeClean || !proof.tcbClosureMatched
    || !proof.runtimeEntrypointBlobMatched || !proof.boundaryTargetsMatched) {
    throw new Error('VerificationSession MERGED recovery is not executing the clean exact old-base trusted TCB with a synchronized local/live default.');
  }
  if (candidate.state !== 'MERGED' || candidate.repository !== repository
    || candidate.number !== prNumber || candidate.headSha !== headSha
    || candidate.headTreeSha !== headTreeSha || candidate.mergeCommitSha === null
    || candidate.mergeCommitTreeSha === null || candidate.mergeCommitTreeSha !== headTreeSha
    || candidate.mergeCommitMessage === null) {
    throw new Error('VerificationSession MERGED recovery lacks exact marker-bound candidate/tree identity.');
  }
  const baseToMerge = github.observeComparison(repository, baseSha, candidate.mergeCommitSha);
  if (baseToMerge.behindBy !== 0
    || baseToMerge.status !== 'ahead' && baseToMerge.status !== 'identical') {
    throw new Error('VerificationSession MERGED recovery cannot prove old base ancestry to the merge commit.');
  }
  const mergeToDefault = github.observeComparison(repository, candidate.mergeCommitSha,
    proof.remoteDefaultSha);
  if (mergeToDefault.behindBy !== 0
    || mergeToDefault.status !== 'ahead' && mergeToDefault.status !== 'identical') {
    throw new Error('VerificationSession MERGED recovery merge commit is not equal to or an ancestor of live default.');
  }
}

export function prepareTrustedMainVerificationSessionV1(input: {
  repository: string;
  candidate: GitHubCandidateObservationV1;
  manifestPath: string;
  manifestDigest: Digest;
  changedPaths: readonly string[];
  testImpactTransition: CodexDevelopmentTestImpactTransitionObservationV1;
  profile: 'quick' | 'full';
  integrationPrincipalNodeId: string;
  producerPrincipalNodeId: string;
  sourceRunId: string;
  sourceRef: string;
  observedAt: string;
  reviewBarrier: GitHubReviewBarrierObservationV1;
  mainHealthChecks: readonly GitHubCheckObservationV1[];
  dependencyBlobs: readonly VerificationSessionActionDependencyBlobObservationV2[];
}): Readonly<{
  request: VerificationSessionHostedRequestV1;
  sessionRevision: Digest;
  scopeAuthorizationRevision: Digest;
  sessionProposalDigest: Digest;
  actionPlanClosure: CiVerificationActionPlanClosureV1;
  testImpactTransitionDigest: Digest;
  reviewBarrier: GitHubReviewBarrierObservationV1;
}> {
  const candidate = input.candidate;
  const transition = bindVerificationSessionTestImpactTransitionV1({
    baseSha: candidate.baseSha,
    headSha: candidate.headSha,
    changedPaths: input.changedPaths,
    transition: input.testImpactTransition
  });
  const environmentDigest = hash(Object.freeze({ schema: 'sec-hosted-verification-environment-v1',
    toolchainRevision: `bun@${Bun.version}`, providerRevision: 'github-actions@trusted-default',
    contractRevision: CI_VERIFICATION_CONTRACT_REVISION, trustRevision: candidate.baseSha }));
  const issuerSemantic = Object.freeze({ principalId: input.producerPrincipalNodeId, role: 'trusted-base-a0' as const,
    trustRevision: candidate.baseSha, producerIdentity: SEC_SCOPE_ISSUER_IDENTITY_V1 });
  const proposalDigest = createVerificationSessionScopeProposalDigestV1({ repository: input.repository,
    prNumber: candidate.number, baseSha: candidate.baseSha, baseTreeSha: candidate.baseTreeSha,
    headSha: candidate.headSha, headTreeSha: candidate.headTreeSha, manifestPath: input.manifestPath,
    manifestDigest: input.manifestDigest, authorizedPaths: input.changedPaths, profile: input.profile,
    environmentDigest, trustRevision: candidate.baseSha,
    testImpactTransitionDigest: transition.digest });
  const scopeRevision = createScopeAuthorizationRevisionV1({ repository: input.repository, prNumber: candidate.number,
    baseSha: candidate.baseSha, baseTreeSha: candidate.baseTreeSha, headSha: candidate.headSha,
    headTreeSha: candidate.headTreeSha, manifestPath: input.manifestPath, manifestDigest: input.manifestDigest,
    proposalDigest, authorizedPaths: input.changedPaths, profile: input.profile, environmentDigest, issuer: issuerSemantic });
  const plan = CodexDevelopmentBuildVerificationPlanV1(
    input.profile,
    input.changedPaths,
    undefined,
    transition.observation
  );
  if (!plan.selectionResolved) throw new Error('trusted-main preparation verification plan is unresolved.');
  const actionPlan = buildCiVerificationActionPlanClosureV1({ candidate: { baseSha: candidate.baseSha,
    baseTreeSha: candidate.baseTreeSha, headSha: candidate.headSha, headTreeSha: candidate.headTreeSha,
    manifestPath: input.manifestPath, manifestDigest: input.manifestDigest, scopeAuthorizationRevision: scopeRevision,
    profile: input.profile, toolchainRevision: `bun@${Bun.version}`, providerRevision: 'github-actions@trusted-default',
    contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
    requiredBlobs: createVerificationSessionActionDependencyRequiredBlobsV2(input.dependencyBlobs)
  }, gates: plan.gates.map(ciVerificationGateStepV1) });
  const sessionProposalDigest = createVerificationSessionProposalDigestV1({ repository: input.repository,
    prNumber: candidate.number, baseSha: candidate.baseSha, baseTreeSha: candidate.baseTreeSha,
    headSha: candidate.headSha, headTreeSha: candidate.headTreeSha, manifestPath: input.manifestPath,
    manifestDigest: input.manifestDigest, testImpactTransitionDigest: transition.digest,
    scopeProposalDigest: proposalDigest,
    actionPlanClosureDigest: actionPlan.actionPlanDigest, profile: input.profile, environmentDigest,
    trustRevision: candidate.baseSha, reviewPolicyDigest: SEC_REVIEW_STABILITY_POLICY_V1.policyDigest,
    mainHealthPolicyDigest: SEC_MAIN_HEALTH_POLICY_DIGEST_V1 });
  const mainHealthInput = createObservedMainHealthInputV1({ repository: input.repository, mainSha: candidate.baseSha,
    mainTreeSha: candidate.baseTreeSha, trustRevision: candidate.baseSha, observedAt: input.observedAt,
    expiresAt: new Date(new Date(input.observedAt).getTime() + 600_000).toISOString(), sourceRunId: input.sourceRunId,
    sourceRef: input.sourceRef, checks: input.mainHealthChecks });
  const mainHealth = createMainHealthLedgerV1(mainHealthInput);
  const sessionRevision = createVerificationSessionRevisionV2({ repository: input.repository, prNumber: candidate.number,
    baseSha: candidate.baseSha, baseTreeSha: candidate.baseTreeSha, headSha: candidate.headSha,
    headTreeSha: candidate.headTreeSha, manifestPath: input.manifestPath, manifestDigest: input.manifestDigest,
    sessionProposalDigest, scopeAuthorizationRevision: scopeRevision, actionPlanClosureDigest: actionPlan.actionPlanDigest,
    profile: input.profile, environmentDigest, trustRevision: candidate.baseSha,
    reviewPolicyDigest: SEC_REVIEW_STABILITY_POLICY_V1.policyDigest,
    evidenceRequirementDigest: SEC_EVIDENCE_REQUIREMENT_DIGEST_V1,
    integrationPolicyDigest: SEC_INTEGRATION_PLATFORM_POLICY_DIGEST_V1,
    mainHealthRef: { mainSha: candidate.baseSha, mainTreeSha: candidate.baseTreeSha, healthRevision: mainHealth.healthRevision } });
  const semanticRequest = Object.freeze({ schema: VERIFICATION_SESSION_HOSTED_REQUEST_SCHEMA_V1,
    prNumber: candidate.number, expectedBaseSha: candidate.baseSha, expectedBaseTreeSha: candidate.baseTreeSha,
    expectedHeadSha: candidate.headSha, expectedHeadTreeSha: candidate.headTreeSha, manifestPath: input.manifestPath,
    manifestDigest: input.manifestDigest, profile: input.profile, expectedScopeProposalDigest: proposalDigest,
    expectedActionPlanDigest: actionPlan.actionPlanDigest, expectedSessionRevision: sessionRevision,
    reviewPolicyDigest: SEC_REVIEW_STABILITY_POLICY_V1.policyDigest });
  const requestOperationId = createVerificationSessionOperationId({ sessionRevision, operationKind: 'hosted-dispatch',
    semanticInputDigest: hash(semanticRequest) });
  const request = Object.freeze({ ...semanticRequest, requestOperationId });
  return Object.freeze({ request, sessionRevision, scopeAuthorizationRevision: scopeRevision,
    sessionProposalDigest, actionPlanClosure: actionPlan,
    testImpactTransitionDigest: transition.digest, reviewBarrier: input.reviewBarrier });
}

/**
 * Local developer feedback uses a distinct local Action identity. It consumes
 * the trusted Scope revision, but never replaces the hosted Action closure
 * bound into the VerificationSession request.
 */
export function prepareLocalQuickVerificationActionPlanV2(input: {
  candidate: GitHubCandidateObservationV1;
  manifestPath: string;
  manifestDigest: Digest;
  changedPaths: readonly string[];
  testImpactTransition: CodexDevelopmentTestImpactTransitionObservationV1;
  expectedTestImpactTransitionDigest: Digest;
  scopeAuthorizationRevision: Digest;
  executionEnvironment: CiVerificationExecutionEnvironmentV2;
  dependencyBlobs: readonly VerificationSessionActionDependencyBlobObservationV2[];
}): CiVerificationActionPlanClosureV1 {
  const environment = input.executionEnvironment;
  if (environment.kind !== 'local' || environment.runnerImage !== null) {
    throw new Error('local quick Action preparation requires one canonical local execution environment.');
  }
  const transition = bindVerificationSessionTestImpactTransitionV1({
    baseSha: input.candidate.baseSha,
    headSha: input.candidate.headSha,
    changedPaths: input.changedPaths,
    transition: input.testImpactTransition,
    expectedDigest: input.expectedTestImpactTransitionDigest
  });
  const plan = CodexDevelopmentBuildVerificationPlanV1(
    'quick',
    input.changedPaths,
    undefined,
    transition.observation
  );
  if (!plan.selectionResolved) {
    throw new Error('local quick Action preparation verification plan is unresolved.');
  }
  const quickGates = plan.gates.filter((gate) => gate.phase === 'quick');
  if (quickGates.length === 0) {
    throw new Error('local quick Action preparation resolved no quick gates.');
  }
  return buildCiVerificationActionPlanClosureV1({ candidate: {
    baseSha: input.candidate.baseSha,
    baseTreeSha: input.candidate.baseTreeSha,
    headSha: input.candidate.headSha,
    headTreeSha: input.candidate.headTreeSha,
    manifestPath: input.manifestPath,
    manifestDigest: input.manifestDigest,
    scopeAuthorizationRevision: input.scopeAuthorizationRevision,
    profile: 'quick',
    toolchainRevision: environment.toolchainRevision,
    providerRevision: environment.executionEnvironmentRevision,
    contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
    requiredBlobs: createVerificationSessionActionDependencyRequiredBlobsV2(input.dependencyBlobs)
  }, gates: quickGates.map(ciVerificationGateStepV1) });
}

function assertCandidateCurrent(candidate: GitHubCandidateObservationV1, session: VerificationSessionV2): void {
  const checks: readonly [unknown, unknown, string][] = [
    [candidate.repository, session.repository, 'repository'], [candidate.number, session.prNumber, 'PR'],
    [candidate.baseSha, session.baseSha, 'base'], [candidate.baseTreeSha, session.baseTreeSha, 'base tree'],
    [candidate.headSha, session.headSha, 'head'], [candidate.headTreeSha, session.headTreeSha, 'head tree']
  ];
  for (const [actual, expected, label] of checks) {
    if (actual !== expected) throw new Error(`VerificationSession live ${label} drifted.`);
  }
  if (candidate.isDraft || candidate.isCrossRepository || candidate.state !== 'OPEN') {
    throw new Error('VerificationSession candidate is not one open same-repository non-draft PR.');
  }
}

export function createVerificationSessionReviewReceiptV1(input: {
  stage: 'pre-expensive' | 'pre-merge';
  session: VerificationSessionV2;
  scope: ScopeAuthorizationV1;
  barrier: Extract<GitHubReviewBarrierObservationV1, { status: 'clear' }>;
  candidateAuthorNodeId: string;
  integrationPrincipalNodeId: string;
  expiresAt: string;
  operationId: Digest;
  producerSourceRef?: string;
  producerSourceRunId?: string;
}): ReviewStabilityReceiptV1 {
  assertGitHubReviewAuthorityObservationV1(input.barrier);
  const receipt = createReviewStabilityReceiptV1({
    stage: input.stage,
    repository: input.session.repository,
    prNumber: input.session.prNumber,
    sessionRevision: input.session.sessionRevision,
    scopeAuthorizationRevision: input.scope.authorizationRevision,
    scopeAuthorizationReceiptDigest: input.scope.authorizationDigest,
    headSha: input.session.headSha,
    headTreeSha: input.session.headTreeSha,
    policy: SEC_REVIEW_STABILITY_POLICY_V1,
    principal: input.barrier.principal,
    independence: {
      candidateAuthorNodeId: input.candidateAuthorNodeId,
      integrationPrincipalNodeId: input.integrationPrincipalNodeId
    },
    producer: {
      identity: 'scripts/codex/verification-session-github.ts',
      executionIdentity: input.barrier.authority.executionIdentity,
      providerIdentity: input.barrier.authority.providerIdentity,
      candidateWriteCapability: input.barrier.authority.candidateWriteCapability,
      capabilityReceiptDigest: input.barrier.authority.capabilityReceiptDigest,
      trustedRevision: SEC_REVIEW_STABILITY_POLICY_V1.trustedRevision,
      sourceTransport: input.barrier.authority.sourceTransport,
      sourceRunId: input.producerSourceRunId ?? input.operationId,
      sourceRef: input.producerSourceRef ?? `github://${input.session.repository}/pull/${input.session.prNumber}@${input.session.headSha}`,
      sourceDigest: input.barrier.authority.sourceDigest
    },
    snapshot: input.barrier.snapshot,
    reviewedAt: input.barrier.observedAt,
    expiresAt: input.expiresAt
  });
  return receipt;
}

export const SEC_VERIFICATION_SESSION_IMPLEMENTATION_IDENTITY_V1 =
  'scripts/codex/verification-session.ts' as const;

export function assertReviewReceiptProducerIndependentV1(receipt: ReviewStabilityReceiptV1): void {
  if (receipt.producer.identity !== 'scripts/codex/verification-session-github.ts'
    || receipt.producer.executionIdentity === SEC_VERIFICATION_SESSION_IMPLEMENTATION_IDENTITY_V1
    || receipt.producer.providerIdentity !== 'github'
    || receipt.producer.candidateWriteCapability !== 'read-only') {
    throw new Error('VerificationSession implementation session cannot issue an independent Review receipt.');
  }
}

export function createVerificationSessionHostedRequestV1(input: {
  session: VerificationSessionV2;
  scope: ScopeAuthorizationV1;
  testImpactTransitionDigest: Digest;
}): VerificationSessionHostedRequestV1 {
  const { session, scope } = input;
  const proposalDigest = createVerificationSessionScopeProposalDigestV1({
    repository: session.repository,
    prNumber: session.prNumber,
    baseSha: session.baseSha,
    baseTreeSha: session.baseTreeSha,
    headSha: session.headSha,
    headTreeSha: session.headTreeSha,
    manifestPath: session.manifestPath,
    manifestDigest: session.manifestDigest,
    authorizedPaths: scope.authorizedPaths,
    profile: session.profile,
    environmentDigest: session.environmentDigest,
    trustRevision: session.trustRevision,
    testImpactTransitionDigest: input.testImpactTransitionDigest
  });
  if (proposalDigest !== scope.proposalDigest) {
    throw new Error('Hosted request test-impact transition differs from the authorized Scope proposal.');
  }
  const semanticRequest = Object.freeze({
    schema: VERIFICATION_SESSION_HOSTED_REQUEST_SCHEMA_V1,
    prNumber: session.prNumber,
    expectedBaseSha: session.baseSha,
    expectedBaseTreeSha: session.baseTreeSha,
    expectedHeadSha: session.headSha,
    expectedHeadTreeSha: session.headTreeSha,
    manifestPath: session.manifestPath,
    manifestDigest: session.manifestDigest,
    profile: session.profile,
    expectedScopeProposalDigest: scope.proposalDigest,
    expectedActionPlanDigest: session.actionPlanClosureDigest,
    expectedSessionRevision: session.sessionRevision,
    reviewPolicyDigest: session.reviewPolicyDigest
  });
  const requestOperationId = createVerificationSessionOperationId({
    sessionRevision: session.sessionRevision,
    operationKind: 'hosted-dispatch',
    semanticInputDigest: hash(semanticRequest)
  });
  return Object.freeze({ ...semanticRequest, requestOperationId });
}

export function parseVerificationSessionHostedRequestV1(
  source: string
): VerificationSessionHostedRequestV1 {
  const value = JSON.parse(source) as Record<string, unknown>;
  const expected = [
    'schema', 'prNumber', 'expectedBaseSha', 'expectedBaseTreeSha', 'expectedHeadSha',
    'expectedHeadTreeSha', 'manifestPath', 'manifestDigest', 'profile',
    'expectedScopeProposalDigest', 'expectedActionPlanDigest', 'expectedSessionRevision',
    'reviewPolicyDigest', 'requestOperationId'
  ].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`Hosted request must contain exactly: ${expected.join(', ')}.`);
  }
  if (value.schema !== VERIFICATION_SESSION_HOSTED_REQUEST_SCHEMA_V1) {
    throw new Error('Hosted request schema mismatch.');
  }
  const shaFields = ['expectedBaseSha', 'expectedBaseTreeSha', 'expectedHeadSha', 'expectedHeadTreeSha'];
  const digestFields = [
    'manifestDigest', 'expectedScopeProposalDigest', 'expectedActionPlanDigest',
    'expectedSessionRevision', 'reviewPolicyDigest', 'requestOperationId'
  ];
  for (const field of shaFields) if (typeof value[field] !== 'string' || !/^[0-9a-f]{40}$/u.test(value[field] as string)) {
    throw new Error(`Hosted request ${field} is invalid.`);
  }
  for (const field of digestFields) if (typeof value[field] !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value[field] as string)) {
    throw new Error(`Hosted request ${field} is invalid.`);
  }
  if (!Number.isSafeInteger(value.prNumber) || (value.prNumber as number) <= 0 ||
      typeof value.manifestPath !== 'string' || typeof value.profile !== 'string') {
    throw new Error('Hosted request scalar identity is invalid.');
  }
  return Object.freeze(value as unknown as VerificationSessionHostedRequestV1);
}

export function prepareVerificationSessionHostedV1(input: {
  request: VerificationSessionHostedRequestV1;
  facts: VerificationSessionHostedFactsV1;
  now?: string;
}): VerificationSessionHostedEnvelopeV1 {
  const request = parseVerificationSessionHostedRequestV1(JSON.stringify(input.request));
  const facts = input.facts;
  const candidate = facts.candidate;
  const candidateChecks: readonly [unknown, unknown, string][] = [
    [candidate.repository, facts.repository, 'repository'], [candidate.number, request.prNumber, 'PR'],
    [candidate.baseSha, request.expectedBaseSha, 'base'], [candidate.baseTreeSha, request.expectedBaseTreeSha, 'base tree'],
    [candidate.headSha, request.expectedHeadSha, 'head'], [candidate.headTreeSha, request.expectedHeadTreeSha, 'head tree']
  ];
  for (const [actualValue, expectedValue, label] of candidateChecks) {
    if (actualValue !== expectedValue) throw new Error(`prepare-hosted live ${label} drifted.`);
  }
  if (candidate.state !== 'OPEN' || candidate.isDraft || candidate.isCrossRepository) {
    throw new Error('prepare-hosted requires one open same-repository non-draft candidate.');
  }
  if (request.reviewPolicyDigest !== SEC_REVIEW_STABILITY_POLICY_V1.policyDigest) {
    throw new Error('prepare-hosted review policy is not canonical.');
  }
  if (facts.integrationPolicyDigest !== SEC_INTEGRATION_PLATFORM_POLICY_DIGEST_V1) {
    throw new Error('prepare-hosted integration policy is not canonical.');
  }
  const reconstructedScopeProposalDigest = createVerificationSessionScopeProposalDigestV1({
    repository: facts.repository,
    prNumber: request.prNumber,
    baseSha: request.expectedBaseSha,
    baseTreeSha: request.expectedBaseTreeSha,
    headSha: request.expectedHeadSha,
    headTreeSha: request.expectedHeadTreeSha,
    manifestPath: request.manifestPath,
    manifestDigest: request.manifestDigest,
    authorizedPaths: facts.authorizedPaths,
    profile: request.profile,
    environmentDigest: facts.environmentDigest,
    trustRevision: request.expectedBaseSha,
    testImpactTransitionDigest: facts.testImpactTransitionDigest
  });
  if (reconstructedScopeProposalDigest !== request.expectedScopeProposalDigest) {
    throw new Error('prepare-hosted test-impact transition differs from the proposed Scope identity.');
  }
  const actionPlanClosure = parseCiVerificationActionPlanClosureV1(
    encodeVerificationActionDataV2(facts.actionPlanClosure)
  );
  if (actionPlanClosure.actionPlanDigest !== request.expectedActionPlanDigest) {
    throw new Error('prepare-hosted Action plan digest differs from proposed request.');
  }
  const scopeAuthorization = createScopeAuthorizationV1({
    repository: facts.repository,
    prNumber: request.prNumber,
    baseSha: request.expectedBaseSha,
    baseTreeSha: request.expectedBaseTreeSha,
    headSha: request.expectedHeadSha,
    headTreeSha: request.expectedHeadTreeSha,
    manifestPath: request.manifestPath,
    manifestDigest: request.manifestDigest,
    proposalDigest: request.expectedScopeProposalDigest,
    authorizedPaths: facts.authorizedPaths,
    sessionProposalDigest: facts.sessionProposalDigest,
    actionPlanClosureDigest: actionPlanClosure.actionPlanDigest,
    profile: request.profile,
    environmentDigest: facts.environmentDigest,
    issuer: facts.scopeIssuer,
    issuedAt: facts.scopeIssuedAt,
    expiresAt: facts.scopeExpiresAt
  });
  const mainHealth = createMainHealthLedgerV1(facts.mainHealth);
  const sessionInput: VerificationSessionInputV2 = {
    sessionId: facts.sessionId,
    createdAt: facts.createdAt,
    repository: facts.repository,
    prNumber: request.prNumber,
    baseSha: request.expectedBaseSha,
    baseTreeSha: request.expectedBaseTreeSha,
    headSha: request.expectedHeadSha,
    headTreeSha: request.expectedHeadTreeSha,
    manifestPath: request.manifestPath,
    manifestDigest: request.manifestDigest,
    sessionProposalDigest: facts.sessionProposalDigest,
    scopeAuthorizationRevision: scopeAuthorization.authorizationRevision,
    scopeAuthorizationReceiptDigest: scopeAuthorization.authorizationDigest,
    actionPlanClosureDigest: actionPlanClosure.actionPlanDigest,
    profile: request.profile,
    environmentDigest: facts.environmentDigest,
    trustRevision: request.expectedBaseSha,
    reviewPolicyDigest: SEC_REVIEW_STABILITY_POLICY_V1.policyDigest,
    evidenceRequirementDigest: facts.evidenceRequirementDigest,
    integrationPolicyDigest: facts.integrationPolicyDigest,
    mainHealthRef: {
      mainSha: mainHealth.mainSha,
      mainTreeSha: mainHealth.mainTreeSha,
      healthRevision: mainHealth.healthRevision,
      ledgerReceiptDigest: mainHealth.ledgerDigest
    }
  };
  const session = createVerificationSessionV2(sessionInput);
  if (session.sessionRevision !== request.expectedSessionRevision) {
    throw new Error('prepare-hosted Session revision differs from proposed request.');
  }
  if (facts.reviewBarrier.status !== 'clear') throw new Error('prepare-hosted Review barrier is not clear.');
  const reviewOperationId = createVerificationSessionOperationId({
    sessionRevision: session.sessionRevision,
    operationKind: 'pre-gate-review',
    semanticInputDigest: facts.reviewBarrier.snapshot.snapshotDigest
  });
  const preGateReview = createVerificationSessionReviewReceiptV1({
    stage: 'pre-expensive', session, scope: scopeAuthorization, barrier: facts.reviewBarrier,
    candidateAuthorNodeId: candidate.authorNodeId,
    integrationPrincipalNodeId: facts.integrationPrincipalNodeId,
    expiresAt: facts.reviewExpiresAt,
    operationId: reviewOperationId
  });
  assertReviewStabilityReceiptCurrentV1(preGateReview, {
    stage: 'pre-expensive', sessionRevision: session.sessionRevision,
    scopeAuthorizationRevision: scopeAuthorization.authorizationRevision,
    scopeAuthorizationReceiptDigest: scopeAuthorization.authorizationDigest,
    headSha: session.headSha, headTreeSha: session.headTreeSha,
    expectedPolicyDigest: session.reviewPolicyDigest,
    snapshotDigest: facts.reviewBarrier.snapshot.snapshotDigest,
    expectedReviewRevision: preGateReview.reviewRevision,
    now: input.now ?? facts.createdAt
  });
  const withoutDigest = Object.freeze({
    schema: VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA_V1,
    requestOperationId: request.requestOperationId,
    scopeAuthorization,
    preGateReview,
    mainHealth,
    session,
    actionPlanClosure
  });
  return Object.freeze({ ...withoutDigest, envelopeDigest: hash(withoutDigest) });
}

export function finalizeVerificationSessionHostedArtifactV2(input: {
  envelope: VerificationSessionHostedEnvelopeV1;
  evidence: CodexDevelopmentVerificationEvidenceV4;
}): CodexDevelopmentVerificationSessionArtifactV2 {
  const envelope = input.envelope;
  const { envelopeDigest, ...withoutDigest } = envelope;
  if (envelope.schema !== VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA_V1 || hash(withoutDigest) !== envelopeDigest) {
    throw new Error('prepare-hosted envelope digest mismatch.');
  }
  if (input.evidence.actionPlan.actionPlanDigest !== envelope.actionPlanClosure.actionPlanDigest) {
    throw new Error('finalize-hosted Evidence Action plan differs from prepared envelope.');
  }
  return CodexDevelopmentFinalizeVerificationSessionArtifactV2({
    scopeAuthorization: envelope.scopeAuthorization,
    session: envelope.session,
    preGateReview: envelope.preGateReview,
    mainHealth: envelope.mainHealth,
    evidence: input.evidence,
    producer: input.evidence.producer
  });
}

export function refreshVerificationSessionHostedArtifactV2(input: {
  envelope: VerificationSessionHostedEnvelopeV1;
  previousArtifact: CodexDevelopmentVerificationSessionArtifactV2;
  producer: CodexDevelopmentVerificationEvidenceProducerV4;
  refreshedAt: string;
}): CodexDevelopmentVerificationSessionArtifactV2 {
  const { envelopeDigest, ...withoutDigest } = input.envelope;
  if (input.envelope.schema !== VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA_V1
    || hash(withoutDigest) !== envelopeDigest) {
    throw new Error('prepare-hosted refresh envelope digest mismatch.');
  }
  return CodexDevelopmentRefreshVerificationSessionArtifactV2({
    previousArtifact: input.previousArtifact,
    scopeAuthorization: input.envelope.scopeAuthorization,
    session: input.envelope.session,
    preGateReview: input.envelope.preGateReview,
    mainHealth: input.envelope.mainHealth,
    producer: input.producer,
    refreshedAt: input.refreshedAt
  });
}

function assertArtifactProvenance(
  artifact: CodexDevelopmentVerificationSessionArtifactV2,
  provenance: TrustedArtifactProvenanceV1,
  session: VerificationSessionV2
): void {
  CodexDevelopmentAssertVerificationSessionArtifactV2(artifact);
  const producer = artifact.producer;
  const checks: readonly [unknown, unknown, string][] = [
    [provenance.canonicalByteDigest, hash(artifact), 'canonical artifact bytes'],
    [provenance.artifactDigest, artifact.artifactDigest, 'artifact digest'],
    [provenance.transport.workflowPath, producer.workflowPath, 'workflow path'],
    [provenance.transport.workflowRef, producer.workflowRef, 'workflow ref'],
    [provenance.transport.workflowSha, producer.workflowSha, 'workflow sha']
  ];
  for (const [actual, expected, label] of checks) {
    if (actual !== expected) throw new Error(`Hosted artifact ${label} provenance mismatch.`);
  }
  if (
    provenance.artifactId.length === 0
    || provenance.artifactName !== `sec-verification-session-v2-pr-${session.prNumber}-session-${session.sessionRevision.slice(7)}-run-${provenance.transport.runId}-attempt-${provenance.transport.runAttempt}`
    || provenance.downloadTransport !== 'github-actions-artifact-api'
    || provenance.transport.actorPermission !== 'admin' && provenance.transport.actorPermission !== 'maintain'
    || producer.sourceTransport !== 'github-actions'
    || producer.workflowPath !== '.github/workflows/compiler-pr-validation.yml'
    || producer.workflowSha !== session.trustRevision
    || producer.workflowRef !== `${producer.workflowPath}@${session.trustRevision}`
    || provenance.transport.workflowPath !== '.github/workflows/compiler-pr-validation.yml'
    || provenance.transport.workflowSha !== session.trustRevision
    || provenance.transport.workflowRef !== `${provenance.transport.workflowPath}@${session.trustRevision}`
    || artifact.session.sessionRevision !== session.sessionRevision
  ) {
    throw new Error('Hosted artifact is not issued by the trusted default workflow/runtime.');
  }
}

export function prepareVerificationSessionMergeInputV2(input: {
  artifact: CodexDevelopmentVerificationSessionArtifactV2;
  preMergeReview: ReviewStabilityReceiptV1;
  platform: PlatformEnforcementObservationV1;
  candidate: CodexDevelopmentMergeGateCandidateV2;
  hostedArtifactOrigin: CodexDevelopmentHostedArtifactObservationV2;
  hostedArtifactTransport: CodexDevelopmentHostedArtifactObservationV2;
  provenance: Omit<CodexDevelopmentMergeGateProvenanceV2, 'sourceDigest'>;
  mainHealth: MainHealthLedgerV1;
  consumptionOperationId: Digest;
  issuedAt: string;
  expiresAt: string;
}): CodexDevelopmentMergeGateInputV2 {
  if (input.platform.status === 'unknown') throw new Error('Unknown platform enforcement blocks merge input.');
  CodexDevelopmentAssertVerificationSessionArtifactV2(input.artifact);
  const provenance = createMergeGateProvenanceV2(input.provenance);
  return CodexDevelopmentCreateMergeGateInputV2({
    provenance,
    candidate: Object.freeze({ ...input.candidate, changedPaths: Object.freeze([...input.candidate.changedPaths]) }),
    artifact: input.artifact,
    hostedArtifactOrigin: input.hostedArtifactOrigin,
    hostedArtifactTransport: input.hostedArtifactTransport,
    expectedActionPlan: input.artifact.evidence.actionPlan,
    reviewReceipt: input.preMergeReview,
    reviewSnapshotDigest: input.preMergeReview.snapshot.snapshotDigest,
    mainHealth: input.mainHealth,
    environmentDigest: input.artifact.session.environmentDigest,
    trustRevision: input.artifact.session.trustRevision,
    platformObservation: Object.freeze({ status: input.platform.status, rulesetDigest: input.platform.rulesetDigest,
      reason: input.platform.reason }),
    consumptionOperationId: input.consumptionOperationId,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt
  });
}

function verifyIntegrationArtifact(input: {
  source: TrustedIntegrationAuthorizationSourceV1;
  result: CodexDevelopmentMergeGateResultV2;
  hosted: TrustedArtifactProvenanceV1;
  session: VerificationSessionV2;
}): void {
  const { source, result, hosted, session } = input;
  const { authorization, provenance } = result;
  const expectedName = `sec-merge-gate-result-v2-pr-${session.prNumber}-session-${session.sessionRevision.slice(7)}-run-${provenance.sourceRunId}-attempt-${provenance.sourceRunAttempt}`;
  if (source.kind === 'github-comment') {
    const publication = source.publication;
    if (publication.result.resultDigest !== result.resultDigest
      || publication.authorizationId !== authorization.authorizationId
      || publication.authorizationReceiptDigest !== authorization.receiptDigest
      || publication.consumptionOperationId !== authorization.consumptionOperationId
      || publication.sessionRevision !== session.sessionRevision
      || publication.repository !== session.repository
      || publication.pullRequestNumber !== session.prNumber
      || publication.provenance.workflowRef !== provenance.workflowRef
      || publication.provenance.workflowSha !== provenance.workflowSha
      || publication.provenance.runId !== provenance.sourceRunId
      || publication.provenance.runAttempt !== provenance.sourceRunAttempt
      || publication.provenance.actorNodeId !== provenance.actorNodeId) {
      throw new Error('IntegrationAuthorization trusted remote comment provenance mismatch.');
    }
  }
  const artifact = source.kind === 'actions-artifact' ? source.artifact : null;
  if (
    result.hostedArtifactOrigin.artifactId !== hosted.observation.artifactId
    || result.hostedArtifactOrigin.artifactByteDigest !== hosted.observation.artifactByteDigest
    || result.hostedArtifactOrigin.artifactByteLength !== hosted.observation.artifactByteLength
    || artifact !== null && (artifact.artifactId.length === 0 || artifact.artifactName !== expectedName
    || artifact.canonicalByteDigest !== hash(result)
    || artifact.workflowPath !== provenance.workflowPath || artifact.workflowRef !== provenance.workflowRef
    || artifact.workflowSha !== provenance.workflowSha || artifact.runId !== provenance.sourceRunId
    || artifact.runAttempt !== provenance.sourceRunAttempt || artifact.eventName !== provenance.eventName
    || artifact.actorNodeId !== provenance.actorNodeId
    || artifact.actorPermission !== 'admin' && artifact.actorPermission !== 'maintain'
    || artifact.downloadTransport !== 'github-actions-artifact-api')
    || provenance.workflowSha !== session.trustRevision
    || provenance.workflowRef !== `.github/workflows/sec-merge-gate.yml@${session.trustRevision}`
    || authorization.issuer.producerIdentity !== 'scripts/codex/merge-gate.ts'
    || authorization.issuer.sourceTransport !== 'github-actions'
    || authorization.issuer.trustedRevision !== session.trustRevision
    || authorization.issuer.sourceRef !== `.github/workflows/sec-merge-gate.yml@${session.trustRevision}`
    || authorization.issuer.sourceDigest !== provenance.sourceDigest
  ) {
    throw new Error('IntegrationAuthorization trusted workflow/artifact provenance mismatch.');
  }
}

/**
 * Advances until the next external wait or terminal state. It never polls and
 * every mutation is preceded by one durable stable-operation claim.
 */
export function resumeVerificationSessionV2(input: {
  repositoryRoot: string;
  session: VerificationSessionV2;
  scopeAuthorization: ScopeAuthorizationV1;
  changedPaths: readonly string[];
  testImpactTransition?: CodexDevelopmentTestImpactTransitionObservationV1;
  integrationPrincipalNodeId: string;
  github: VerificationSessionGitHubClientV1;
  external: VerificationSessionRuntimeExternal;
  journalFs?: VerificationSessionJournalFileSystem;
}): VerificationSessionRuntimeOutcomeV1 {
  const session = parseVerificationSessionV2(encodeVerificationActionDataV2(input.session));
  const scope = parseScopeAuthorizationV1(encodeVerificationActionDataV2(input.scopeAuthorization));
  const fs = input.journalFs;
  let journal = readVerificationSessionJournalV1({ repositoryRoot: input.repositoryRoot, sessionRevision: session.sessionRevision, fs });
  const candidate = input.github.observeCandidate(session.repository, session.prNumber);
  const liveMerged = candidate.state === 'MERGED';
  const trustedRuntimeProof = input.external.trustedRuntimeProof(session);
  if (liveMerged) {
    assertTrustedMergedRuntimeReachabilityV1({ proof: trustedRuntimeProof, session, candidate,
      github: input.github });
  } else {
    assertTrustedRuntimeV1(trustedRuntimeProof, session, false);
  }
  if (!liveMerged) {
    assertCandidateCurrent(candidate, session);
  } else if (candidate.repository !== session.repository || candidate.number !== session.prNumber
    || candidate.headSha !== session.headSha || candidate.headTreeSha !== session.headTreeSha) {
    throw new Error('VerificationSession merged PR identity drifted.');
  }
  assertScopeAuthorizationCurrentV1(scope, {
    baseSha: session.baseSha, baseTreeSha: session.baseTreeSha, headSha: session.headSha,
    headTreeSha: session.headTreeSha, manifestDigest: session.manifestDigest,
    changedPaths: input.changedPaths, sessionProposalDigest: scope.sessionProposalDigest,
    actionPlanClosureDigest: session.actionPlanClosureDigest, environmentDigest: session.environmentDigest,
    expectedAuthorizationRevision: session.scopeAuthorizationRevision,
    // Once GitHub proves the authorized merge marker, recovery validates the
    // immutable receipt at issuance time. Current expiry is a pre-effect gate,
    // not permission to strand post-effect parity/closeout recovery.
    now: liveMerged ? scope.issuedAt : input.external.now()
  });
  if (session.scopeAuthorizationReceiptDigest !== scope.authorizationDigest) {
    throw new Error('Session full ScopeAuthorization receipt binding mismatch.');
  }

  const append = (targetStage: Parameters<typeof appendVerificationSessionJournalEventV1>[0]['targetStage'], receiptDigest: Digest | null, operationId: Digest | null = null) => {
    appendVerificationSessionJournalEventV1({ repositoryRoot: input.repositoryRoot, sessionRevision: session.sessionRevision,
      targetStage, kind: 'completed', receiptDigest, operationId, fs });
    journal = readVerificationSessionJournalV1({ repositoryRoot: input.repositoryRoot, sessionRevision: session.sessionRevision, fs });
  };

  if (journal.completedStageIndex < 0) append('frozen', session.sessionRevision);
  if (journal.completedStageIndex < 1) {
    const actions = input.external.runLocalActions(session);
    if (actions.status === 'waiting') return outcome({ status: 'WAITING_ACTIONS', sessionRevision: session.sessionRevision, reason: 'local Action closure is not terminal', receiptDigest: null, completedStage: journal.completedStage });
    if (actions.status === 'failed') return outcome({ status: 'BLOCKED', sessionRevision: session.sessionRevision, reason: actions.reason, receiptDigest: null, completedStage: journal.completedStage });
    append('actions-terminal', actions.resultDigest);
  }

  const hosted = input.external.hostedArtifact();
  const preGateOperation = createVerificationSessionOperationId({ sessionRevision: session.sessionRevision, operationKind: 'pre-gate-review', semanticInputDigest: session.reviewPolicyDigest });
  if (journal.completedStageIndex < 2) {
    if (liveMerged) {
      if (hosted === null) return outcome({ status: 'WAITING_HOSTED_VERIFICATION', sessionRevision: session.sessionRevision,
        reason: 'trusted hosted artifact is required for merged recovery', receiptDigest: null, completedStage: journal.completedStage });
      append('pre-gate-review-clear', hosted.artifact.preGateReview.receiptDigest as Digest, preGateOperation);
    } else {
      const barrier = input.github.observeReviewBarrier({ repository: session.repository, prNumber: session.prNumber,
        headSha: session.headSha, excludedPrincipalNodeIds: new Set([candidate.authorNodeId, input.integrationPrincipalNodeId]) });
      if (barrier.status !== 'clear') {
        if (barrier.status === 'provider-schema-unsupported') return outcome({ status: 'BLOCKED',
          sessionRevision: session.sessionRevision, reason: barrier.reasonCode,
          receiptDigest: barrier.responseDigest, completedStage: journal.completedStage });
        if (barrier.status === 'blocked') return outcome({ status: 'BLOCKED', sessionRevision: session.sessionRevision, reason: barrier.reason, receiptDigest: barrier.snapshotDigest, completedStage: journal.completedStage });
        return outcome({ status: 'WAITING_REVIEW', sessionRevision: session.sessionRevision, reason: barrier.reason,
          receiptDigest: barrier.snapshotDigest, completedStage: journal.completedStage });
      }
      const receipt = createVerificationSessionReviewReceiptV1({ stage: 'pre-expensive', session, scope, barrier,
        candidateAuthorNodeId: candidate.authorNodeId, integrationPrincipalNodeId: input.integrationPrincipalNodeId,
        expiresAt: input.external.expiresAt(barrier.observedAt, 900), operationId: preGateOperation });
      input.external.saveReviewReceipt('pre-expensive', receipt);
      append('pre-gate-review-clear', receipt.receiptDigest, preGateOperation);
    }
  }

  if (journal.completedStageIndex < 3) {
    if (hosted === null) {
      if (input.testImpactTransition === undefined) {
        throw new Error('VerificationSession hosted dispatch requires one exact test-impact transition observation.');
      }
      const transition = bindVerificationSessionTestImpactTransitionV1({
        baseSha: session.baseSha,
        headSha: session.headSha,
        changedPaths: input.changedPaths,
        transition: input.testImpactTransition
      });
      const request = createVerificationSessionHostedRequestV1({
        session,
        scope,
        testImpactTransitionDigest: transition.digest
      });
      const claim = claimVerificationSessionOperationV1({ repositoryRoot: input.repositoryRoot, sessionRevision: session.sessionRevision,
        operationId: request.requestOperationId, operationKind: 'hosted-dispatch', fs });
      if (claim.claimed) input.github.ensureVerificationSessionWakeup(session.repository, request);
      appendVerificationSessionJournalEventV1({ repositoryRoot: input.repositoryRoot, sessionRevision: session.sessionRevision,
        targetStage: 'hosted-verification-terminal', kind: 'waiting', operationId: request.requestOperationId,
        receiptDigest: null, note: claim.claimed ? 'hosted verification dispatched' : 'hosted dispatch already claimed', fs });
      return outcome({ status: 'WAITING_HOSTED_VERIFICATION', sessionRevision: session.sessionRevision,
        reason: 'trusted hosted artifact is not available', receiptDigest: null, completedStage: journal.completedStage });
    }
    assertArtifactProvenance(hosted.artifact, hosted.provenance, session);
    if (hosted.artifact.evidence.status !== 'passed') return outcome({ status: 'BLOCKED', sessionRevision: session.sessionRevision,
      reason: `hosted verification terminal ${hosted.artifact.evidence.status}`, receiptDigest: hosted.artifact.evidence.evidenceDigest as Digest, completedStage: journal.completedStage });
    append('hosted-verification-terminal', hosted.artifact.evidence.evidenceDigest as Digest);
  }
  if (hosted === null) return outcome({ status: 'WAITING_HOSTED_VERIFICATION', sessionRevision: session.sessionRevision,
    reason: 'hosted artifact disappeared', receiptDigest: null, completedStage: journal.completedStage });
  assertArtifactProvenance(hosted.artifact, hosted.provenance, session);

  if (session.integrationPolicyDigest !== SEC_INTEGRATION_PLATFORM_POLICY_DIGEST_V1) {
    throw new Error('Session integration platform policy is not the canonical no-admin policy.');
  }
  const integrationSource = input.external.integrationAuthorizationArtifact();
  if (integrationSource === null) return outcome({ status: 'WAITING_INTEGRATION_AUTHORIZATION', sessionRevision: session.sessionRevision,
    reason: 'trusted merge-gate authorization artifact is not available', receiptDigest: hosted.artifact.evidence.evidenceDigest as Digest, completedStage: journal.completedStage });
  const integrationResult = integrationSource.kind === 'actions-artifact'
    ? CodexDevelopmentParseMergeGateResultV2(integrationSource.artifact.resultJson)
    : integrationSource.publication.result;
  verifyIntegrationArtifact({ source: integrationSource, result: integrationResult,
    hosted: hosted.provenance, session });
  const authorizationPrincipal = input.github.observePrincipalByNodeId(session.repository,
    integrationResult.provenance.actorNodeId);
  if (authorizationPrincipal.permission !== 'admin' && authorizationPrincipal.permission !== 'maintain') {
    throw new Error('IntegrationAuthorization actor no longer has maintain/admin permission.');
  }
  const authorization = integrationResult.authorization;
  const preMergeReceipt = integrationResult.reviewReceipt;
  const remoteAuthorization = input.external.integrationAuthorizationPublication();
  if (remoteAuthorization === null) return outcome({ status: 'WAITING_INTEGRATION_AUTHORIZATION',
    sessionRevision: session.sessionRevision,
    reason: 'trusted remote authorization operation publication is not available',
    receiptDigest: authorization.receiptDigest as Digest, completedStage: journal.completedStage });
  if (remoteAuthorization.authorizationId !== authorization.authorizationId
    || remoteAuthorization.authorizationReceiptDigest !== authorization.receiptDigest
    || remoteAuthorization.consumptionOperationId !== authorization.consumptionOperationId
    || (integrationSource.kind === 'github-comment'
      && remoteAuthorization.authorizationPublicationDigest !== integrationSource.publication.publicationDigest)) {
    throw new Error('Remote authorization operation publication repository/PR/receipt differs from the merge-gate result.');
  }
  const markers = integrationAuthorizationMergeMarkersV1({ sessionRevision: session.sessionRevision,
    authorizationId: authorization.authorizationId,
    authorizationReceiptDigest: authorization.receiptDigest as Digest,
    consumptionOperationId: authorization.consumptionOperationId as Digest,
    authorizationPublicationId: remoteAuthorization.authorizationPublicationId,
    authorizationPublicationDigest: remoteAuthorization.authorizationPublicationDigest,
    commentId: remoteAuthorization.commentId });
  const matchingMergedConsumption = liveMerged
    && markers.every((marker) => candidate.mergeCommitMessage?.split(/\r?\n/u).includes(marker) === true);
  if (liveMerged && !matchingMergedConsumption) return outcome({ status: 'BLOCKED', sessionRevision: session.sessionRevision,
    reason: 'merged commit lacks the exact IntegrationAuthorization consumption marker',
    receiptDigest: authorization.receiptDigest as Digest, completedStage: journal.completedStage });
  const barrier = liveMerged ? null : input.github.observeReviewBarrier({ repository: session.repository,
    prNumber: session.prNumber, headSha: session.headSha,
    excludedPrincipalNodeIds: new Set([candidate.authorNodeId, input.integrationPrincipalNodeId]) });
  if (barrier !== null && barrier.status !== 'clear') return outcome({ status: barrier.status === 'waiting' ? 'WAITING_REVIEW' : 'BLOCKED',
    sessionRevision: session.sessionRevision,
    reason: barrier.status === 'provider-schema-unsupported' ? barrier.reasonCode : barrier.reason,
    receiptDigest: barrier.status === 'provider-schema-unsupported' ? barrier.responseDigest : barrier.snapshotDigest,
    completedStage: journal.completedStage });
  const enforcement = liveMerged ? integrationResult.platformObservation
    : input.github.observePlatformEnforcement(session.repository);
  if (enforcement.status === 'unknown') return outcome({ status: 'BLOCKED', sessionRevision: session.sessionRevision,
    reason: enforcement.reason ?? 'platform enforcement unknown', receiptDigest: enforcement.rulesetDigest, completedStage: journal.completedStage });
  assertReviewStabilityReceiptCurrentV1(preMergeReceipt, { stage: 'pre-merge',
    sessionRevision: session.sessionRevision, scopeAuthorizationRevision: scope.authorizationRevision,
    scopeAuthorizationReceiptDigest: scope.authorizationDigest, headSha: session.headSha, headTreeSha: session.headTreeSha,
    expectedPolicyDigest: session.reviewPolicyDigest,
    snapshotDigest: barrier === null ? preMergeReceipt.snapshot.snapshotDigest : barrier.snapshot.snapshotDigest,
    expectedReviewRevision: preMergeReceipt.reviewRevision,
    now: liveMerged ? preMergeReceipt.reviewedAt : input.external.now() });
  const health = resolveMainHealthLaneV1({ ledger: integrationResult.mainHealth, lane: 'ordinary',
    now: liveMerged ? integrationResult.mainHealth.observedAt : input.external.now(),
    expectedRepository: session.repository,
    expectedDefaultBranch: CI_MAIN_HEALTH_POLICY_V1.producer.branch,
    expectedMainSha: session.baseSha, expectedMainTreeSha: session.baseTreeSha,
    expectedTrustRevision: session.trustRevision });
  if (!health.allowed || health.status !== 'healthy') throw new Error(`IntegrationAuthorization MainHealth is not usable: ${health.reason}`);
  if (!liveMerged && (integrationResult.platformObservation.status !== enforcement.status
    || integrationResult.platformObservation.rulesetDigest !== enforcement.rulesetDigest
    || integrationResult.platformObservation.reason !== enforcement.reason)) {
    throw new Error('IntegrationAuthorization platform observation drifted from live GitHub readback.');
  }
  input.external.saveReviewReceipt('pre-merge', preMergeReceipt);
  if (journal.completedStageIndex < 4) append('pre-merge-review-clear', preMergeReceipt.receiptDigest,
    createVerificationSessionOperationId({ sessionRevision: session.sessionRevision, operationKind: 'pre-merge-review',
      semanticInputDigest: preMergeReceipt.reviewRevision }));
  const durableConsumed = input.external.consumedAuthorizationIds();
  const effectiveConsumed = matchingMergedConsumption
    ? new Set([...durableConsumed].filter((id) => id !== authorization.authorizationId))
    : durableConsumed;
  assertIntegrationAuthorizationUsableV1(authorization, {
    now: liveMerged ? authorization.issuedAt : input.external.now(), consumedAuthorizationIds: effectiveConsumed,
    consumptionOperationId: authorization.consumptionOperationId,
    repository: session.repository,
    prNumber: session.prNumber,
    sessionRevision: session.sessionRevision, baseSha: session.baseSha, baseTreeSha: session.baseTreeSha,
    headSha: session.headSha, headTreeSha: session.headTreeSha, manifestDigest: session.manifestDigest,
    scopeAuthorizationRevision: scope.authorizationRevision,
    scopeAuthorizationReceiptDigest: scope.authorizationDigest,
    actionClosureDigest: session.actionPlanClosureDigest,
    evidenceDigest: hosted.artifact.evidence.evidenceDigest as Digest,
    reviewRevision: preMergeReceipt.reviewRevision,
    reviewReceiptDigest: preMergeReceipt.receiptDigest,
    mainHealthRevision: integrationResult.mainHealth.healthRevision,
    mainHealthReceiptDigest: integrationResult.mainHealth.ledgerDigest,
    trustRevision: session.trustRevision,
    rulesetDigest: integrationResult.platformObservation.rulesetDigest
  });
  if (journal.completedStageIndex < 5) append('authorized', authorization.receiptDigest as Digest);

  const closeoutPreparationOperationId = createVerificationSessionOperationId({
    sessionRevision: session.sessionRevision, operationKind: 'closeout-preparation',
    semanticInputDigest: hash({ authorizationId: authorization.authorizationId, headSha: session.headSha })
  });
  const closeoutPreparation = input.external.observeCloseoutPreparation(
    closeoutPreparationOperationId,
    authorization,
    session
  );
  if (!('reason' in closeoutPreparation)
    && closeoutPreparation.preparationDigest !== remoteAuthorization.preparationDigest) {
    throw new Error('Closeout preparation differs from the remote authorization publication.');
  }
  if ('reason' in closeoutPreparation) return outcome({
    status: closeoutPreparation.status === 'waiting'
      ? liveMerged ? 'WAITING_CLOSEOUT' : 'READY_TO_INTEGRATE'
      : 'BLOCKED',
    sessionRevision: session.sessionRevision, reason: closeoutPreparation.reason,
    receiptDigest: authorization.receiptDigest as Digest, completedStage: journal.completedStage,
    operationId: authorization.consumptionOperationId as Digest,
    authorizationId: authorization.authorizationId
  });

  if (!/^sha256:[0-9a-f]{64}$/u.test(authorization.consumptionOperationId)) {
    throw new Error('IntegrationAuthorization consumptionOperationId must be the stable merge operation digest.');
  }
  const mergeOperationId = authorization.consumptionOperationId as Digest;
  if (candidate.state !== 'MERGED') {
    return outcome({ status: 'READY_TO_INTEGRATE', sessionRevision: session.sessionRevision,
      reason: 'authorization and pre-merge facts are current; only the trusted hosted integrator may consume them',
      receiptDigest: authorization.receiptDigest as Digest, completedStage: journal.completedStage,
      operationId: mergeOperationId, authorizationId: authorization.authorizationId });
  }
  if (journal.completedStageIndex < 6) append('merge-attempted', authorization.receiptDigest as Digest, mergeOperationId);

  const merged = input.github.observeCandidate(session.repository, session.prNumber);
  if (merged.state !== 'MERGED' || merged.mergeCommitSha === null || merged.mergeCommitTreeSha === null || merged.mergeCommitMessage === null) {
    return outcome({ status: 'WAITING_MERGE_READBACK', sessionRevision: session.sessionRevision,
      reason: 'exact merge readback is not terminal', receiptDigest: authorization.receiptDigest as Digest, completedStage: journal.completedStage });
  }
  if (!markers.every((marker) => merged.mergeCommitMessage!.split(/\r?\n/u).includes(marker))) {
    return outcome({ status: 'BLOCKED', sessionRevision: session.sessionRevision,
      reason: 'merged commit lacks the exact IntegrationAuthorization consumption marker',
      receiptDigest: authorization.receiptDigest as Digest, completedStage: journal.completedStage });
  }
  assertCanonicalMergeMessageV1({
    authorizationMarkers: markers,
    reviewReceipt: preMergeReceipt,
    expectedTitle: `Verified integration ${session.sessionRevision.slice(7, 19)}`,
    message: merged.mergeCommitMessage!
  });
  if (journal.completedStageIndex < 7) append('merge-readback', hash({ commit: merged.mergeCommitSha, tree: merged.mergeCommitTreeSha }));
  if (merged.mergeCommitTreeSha !== session.headTreeSha) return outcome({ status: 'BLOCKED', sessionRevision: session.sessionRevision,
    reason: 'merged tree does not equal verified candidate tree', receiptDigest: hash({ candidate: session.headTreeSha, merged: merged.mergeCommitTreeSha }), completedStage: journal.completedStage });
  if (journal.completedStageIndex < 8) append('tree-parity', hash({ tree: merged.mergeCommitTreeSha }));

  const closeoutBindingObservation = input.external.observeCloseoutBinding(authorization, session, merged);
  if ('reason' in closeoutBindingObservation) return outcome({
    status: closeoutBindingObservation.status === 'waiting' ? 'READY_TO_CLOSEOUT' : 'BLOCKED',
    sessionRevision: session.sessionRevision, reason: closeoutBindingObservation.reason,
    receiptDigest: authorization.receiptDigest as Digest, completedStage: journal.completedStage,
    operationId: mergeOperationId, authorizationId: authorization.authorizationId
  });
  const closeoutBinding = closeoutBindingObservation.binding;
  assertBranchCloseoutOperationBindingV1(closeoutBinding);
  if (closeoutBinding.authorizationId !== authorization.authorizationId
    || closeoutBinding.consumptionOperationId !== authorization.consumptionOperationId
    || closeoutBinding.integrationAuthorizationReceiptDigest !== authorization.receiptDigest
    || closeoutBinding.repository !== session.repository || closeoutBinding.pullRequestNumber !== session.prNumber
    || closeoutBinding.headSha !== session.headSha || closeoutBinding.newMainSha !== merged.mergeCommitSha
    || closeoutBinding.newMainTreeSha !== merged.mergeCommitTreeSha
    || closeoutBinding.candidateTreeSha !== session.headTreeSha) {
    throw new Error('Branch closeout binding differs from the authorized post-parity identity.');
  }
  const closeoutOperationId = closeoutBinding.closeoutOperationId;
  const closeout = input.external.observeCloseout(
    closeoutBinding,
    authorization,
    session,
    merged
  );
  if ('reason' in closeout) {
    if (closeout.status === 'waiting') return outcome({ status: 'READY_TO_CLOSEOUT',
      sessionRevision: session.sessionRevision, reason: closeout.reason, receiptDigest: null,
      completedStage: journal.completedStage, operationId: closeoutOperationId,
      authorizationId: authorization.authorizationId });
    return outcome({ status: 'BLOCKED', sessionRevision: session.sessionRevision,
      reason: closeout.reason, receiptDigest: null, completedStage: journal.completedStage });
  }
  if (journal.completedStageIndex < 9) append('closeout-terminal', closeout.receiptDigest, closeoutOperationId);
  return outcome({ status: 'COMPLETED', sessionRevision: session.sessionRevision,
    reason: closeout.status, receiptDigest: closeout.receiptDigest, completedStage: 'closeout-terminal' });
}
