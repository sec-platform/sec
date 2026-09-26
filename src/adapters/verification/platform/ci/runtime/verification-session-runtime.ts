/** Canonical VerificationSession V2 operator reducer and trusted runtime guards. */

import { createHash } from 'node:crypto';

import { CI_VERIFICATION_CONTRACT_REVISION, CI_VERIFICATION_WORKFLOW_PATH } from '../../../../../assurance/verification/contract/revision.ts';
import type { GitHubCheckObservation } from '../../../../providers/github-api/contract.ts';
import {
  assertBranchCloseoutOperationBinding,
  type BranchCloseoutOperationBinding
} from '../../../../self-hosting/control/branch-lifecycle/branch-closeout-contract.ts';
import {
  assertIntegrationAuthorizationUsable,
  type IntegrationAuthorization
} from '../../../../self-hosting/control/integration/authorization.ts';
import {
  parseIntegrationAuthorizationOperationPublication,
  type IntegrationAuthorizationOperationPublication
} from '../../../../self-hosting/control/integration/integration-authorization-publication.ts';
import {
  assertCanonicalMergeMessage,
  CodexDevelopmentCreateHostedArtifactObservation,
  CodexDevelopmentCreateMergeGateInput,
  CodexDevelopmentCreateTrustedRuntimeMergeGateInput,
  CodexDevelopmentMergeGateProducerIdentity,
  CodexDevelopmentParseMergeGateResult,
  createMergeGateProvenance,
  createTrustedRuntimeArtifactObservation,
  createTrustedRuntimeMergeGateProvenance,
  type CodexDevelopmentHostedArtifactObservation,
  type CodexDevelopmentMergeGateCandidate,
  type CodexDevelopmentMergeGateInput,
  type CodexDevelopmentMergeGateProvenance,
  type CodexDevelopmentMergeGateResult,
  type CodexDevelopmentTrustedRuntimeArtifactObservation,
  type CodexDevelopmentTrustedRuntimeMergeGateInput,
  type CodexDevelopmentTrustedRuntimeMergeGateProvenance
} from '../../../../self-hosting/control/integration/merge-gate.ts';
import {
  SEC_INTEGRATION_PLATFORM_POLICY_DIGEST
} from '../../../../self-hosting/control/integration/platform-policy.ts';
import {
  createMainHealthLedger,
  resolveOrdinaryMainHealthLane,
  type MainHealthLedger,
  type MainHealthLedgerInput
} from '../../../../self-hosting/control/main-health/contract.ts';
import { createObservedMainHealthInput } from '../../../../self-hosting/control/main-health/main-health-observation.ts';
import { CI_MAIN_HEALTH_POLICY, CI_MAIN_HEALTH_POLICY_DIGEST } from '../../../../self-hosting/control/main-health/provider-policy.ts';
import {
  assertScopeAuthorizationCurrent,
  createScopeAuthorization,
  createScopeAuthorizationRevision,
  parseScopeAuthorization,
  type ScopeAuthorization,
  type ScopeAuthorizationInput
} from '../../../../self-hosting/control/scope/authorization.ts';
import { encodeVerificationActionData, type VerificationActionInputRef } from '../../action/contract/action.ts';
import { buildCiVerificationActionPlanClosure, CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT, ciVerificationGateStep, parseCiVerificationActionPlanClosure, type CiVerificationActionPlanClosure, type CiVerificationExecutionEnvironment } from '../../action/contract/ci.ts';
import { CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS } from '../../action/contract/environment.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY } from '../../action/contract/provider.ts';
import { assertReviewStabilityReceiptCurrent, createReviewStabilityReceipt, REVIEW_OBSERVER_PRODUCER_IDENTITY, SEC_REVIEW_STABILITY_POLICY, type ReviewStabilityReceipt } from '../../review/contract/stability.ts';
import { createVerificationSession, createVerificationSessionProposalDigest, createVerificationSessionRevision, parseVerificationSession, type VerificationSession, type VerificationSessionInput } from '../../session/contract/session.ts';
import type { CodexDevelopmentTestImpactSourceProvider } from '../../test-impact/runtime/impact.ts';
import { CodexDevelopmentAssertTestImpactTransitionSelection, type CodexDevelopmentTestImpactTransitionObservation } from '../../test-impact/runtime/transition.ts';
import {
  CodexDevelopmentAssertVerificationSessionArtifact,
  CodexDevelopmentAssertVerificationSessionArtifactCurrent,
  CodexDevelopmentFinalizeVerificationSessionArtifact,
  CodexDevelopmentRefreshVerificationSessionArtifact,
  type CodexDevelopmentVerificationEvidenceProducer,
  type CodexDevelopmentVerificationEvidenceV4,
  type CodexDevelopmentVerificationSessionArtifact
} from '../contract/evidence.ts';
import {
  CodexDevelopmentBuildVerificationPlan
} from '../contract/plan.ts';
import {
  CI_VERIFICATION_SESSION_REQUEST_SCHEMA
} from '../contract/revision.ts';
import type { VerificationSessionHostedRequest } from '../contract/session-request.ts';
import {
  assertGitHubReviewAuthorityObservation,
  type GitHubActionsArtifactObservation,
  type GitHubCandidateObservation,
  type GitHubReviewBarrierObservation,
  type PlatformEnforcementObservation,
  type VerificationSessionGitHubClient
} from './verification-session-github.ts';
import {
  appendVerificationSessionJournalEvent,
  claimVerificationSessionOperation,
  createVerificationSessionOperationId,
  readVerificationSessionJournal,
  type VerificationSessionJournalFileSystem
} from './verification-session-journal.ts';
/**
 * Canonical post-new-main health consumer for IssueDisposition evidence.
 * Callers supply provider observations only; exact-main identity, freshness,
 * producer matching, convergence, and ordinary-lane eligibility remain owned
 * by MainHealth.
 */
export function compilePostMainIssueDispositionHealthReadback(input: Readonly<{
  repository: string;
  newMainSha: string;
  newMainTreeSha: string;
  observedAt: string;
  sourceRunId: string;
  sourceRef: string;
  checks: readonly GitHubCheckObservation[];
}>): MainHealthLedger {
  const expiresAt = new Date(new Date(input.observedAt).getTime() + 300_000).toISOString();
  const ledger = createMainHealthLedger(createObservedMainHealthInput({
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
  const lane = resolveOrdinaryMainHealthLane({
    ledger,
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
export const VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA =
  'sec-verification-session-hosted-envelope-v1' as const;

type Digest = `sha256:${string}`;

function hash(value: unknown): Digest {
  return `sha256:${createHash('sha256').update(encodeVerificationActionData(value)).digest('hex')}`;
}

const SEC_EVIDENCE_REQUIREMENT_DIGEST = hash(Object.freeze({
  schema: 'sec-verification-evidence-requirement-v4', terminalStatus: 'passed', exactActionClosure: true
}));
const SEC_SCOPE_ISSUER_IDENTITY = 'src/adapters/verification/platform/ci/runtime/verification-session.ts@scope-issuer-v1' as const;

export type VerificationSessionActionDependencyBlobObservation = Readonly<{
  path: (typeof CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS)[number];
  baseSource: string;
  candidateSource: string;
}>;

/**
 * Canonical Action dependency inputs are semantic candidate inputs, not a
 * post-hoc ActionKey supplement. The Session producer observes exact blobs at
 * both the trusted base and candidate head, rejects any byte drift, and only
 * then hashes the candidate bytes into the Action input closure.
 */
function createVerificationSessionActionDependencyRequiredBlobs(
  observations: readonly VerificationSessionActionDependencyBlobObservation[]
): readonly VerificationActionInputRef[] {
  if (!Array.isArray(observations)) {
    throw new Error('VerificationSession Action dependency observations must be an array.');
  }
  const byPath = new Map<string, VerificationSessionActionDependencyBlobObservation>();
  for (const observation of observations) {
    if (observation === null || typeof observation !== 'object'
      || !CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS.includes(observation.path)
      || typeof observation.baseSource !== 'string'
      || typeof observation.candidateSource !== 'string'
      || byPath.has(observation.path)) {
      throw new Error('VerificationSession Action dependency observation set is malformed or duplicated.');
    }
    byPath.set(observation.path, observation);
  }
  if (byPath.size !== CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS.length) {
    throw new Error('VerificationSession Action dependency observation set is incomplete.');
  }
  return Object.freeze(CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS.map((dependencyPath) => {
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

export function createVerificationSessionMergeOperationId(input: {
  sessionRevision: Digest; headSha: string; actionPlanDigest: Digest;
}): Digest {
  return createVerificationSessionOperationId({ sessionRevision: input.sessionRevision, operationKind: 'merge',
    semanticInputDigest: hash(Object.freeze({ headSha: input.headSha, actionPlanDigest: input.actionPlanDigest })) });
}

function createVerificationSessionScopeProposalDigest(input: {
  repository: string; prNumber: number; baseSha: string; baseTreeSha: string;
  headSha: string; headTreeSha: string; manifestPath: string; manifestDigest: Digest;
  authorizedPaths: readonly string[]; profile: string; environmentDigest: Digest; trustRevision: string;
  testImpactTransitionDigest: Digest;
}): Digest {
  return hash(Object.freeze({ schema: 'sec-scope-proposal-v1', ...input,
    authorizedPaths: Object.freeze([...input.authorizedPaths].sort()) }));
}

function bindVerificationSessionTestImpactTransition(input: {
  baseSha: string;
  headSha: string;
  changedPaths: readonly string[];
  transition: CodexDevelopmentTestImpactTransitionObservation;
  expectedDigest?: Digest;
}): Readonly<{
  digest: Digest;
  observation: CodexDevelopmentTestImpactTransitionObservation;
}> {
  const digest = CodexDevelopmentAssertTestImpactTransitionSelection({
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

export function reconstructVerificationSessionHostedFacts(input: {
  request: VerificationSessionHostedRequest;
  repository: string;
  candidate: GitHubCandidateObservation;
  changedPaths: readonly string[];
  testImpactTransition: CodexDevelopmentTestImpactTransitionObservation;
  testImpactSourceProvider: CodexDevelopmentTestImpactSourceProvider;
  integrationPrincipalNodeId: string;
  producerPrincipalNodeId: string;
  sourceRunId: string;
  sourceRef: string;
  observedAt: string;
  reviewBarrier: Extract<GitHubReviewBarrierObservation, { status: 'clear' }>;
  mainHealthChecks: readonly GitHubCheckObservation[];
  dependencyBlobs: readonly VerificationSessionActionDependencyBlobObservation[];
}): VerificationSessionHostedFacts {
  const request = input.request;
  const transition = bindVerificationSessionTestImpactTransition({
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
    producerIdentity: SEC_SCOPE_ISSUER_IDENTITY
  });
  const proposalDigest = createVerificationSessionScopeProposalDigest({
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
  const scopeAuthorizationRevision = createScopeAuthorizationRevision({
    repository: input.repository, prNumber: request.prNumber,
    baseSha: request.expectedBaseSha, baseTreeSha: request.expectedBaseTreeSha,
    headSha: request.expectedHeadSha, headTreeSha: request.expectedHeadTreeSha,
    manifestPath: request.manifestPath, manifestDigest: request.manifestDigest,
    proposalDigest, authorizedPaths: input.changedPaths, profile: request.profile,
    environmentDigest, issuer: issuerSemantic
  });
  const plan = CodexDevelopmentBuildVerificationPlan(
    request.profile as 'quick' | 'full',
    input.changedPaths,
    input.testImpactSourceProvider,
    transition.observation
  );
  if (!plan.selectionResolved) throw new Error('observe-hosted verification plan selection is unresolved.');
  const actionPlanClosure = buildCiVerificationActionPlanClosure({
    candidate: {
      baseSha: request.expectedBaseSha, baseTreeSha: request.expectedBaseTreeSha,
      headSha: request.expectedHeadSha, headTreeSha: request.expectedHeadTreeSha,
      manifestPath: request.manifestPath, manifestDigest: request.manifestDigest,
      scopeAuthorizationRevision, profile: request.profile as 'quick' | 'full',
      toolchainRevision: `bun@${Bun.version}`, providerRevision: 'github-actions@trusted-default',
      contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
      requiredBlobs: createVerificationSessionActionDependencyRequiredBlobs(input.dependencyBlobs)
    },
    gates: plan.gates.map(ciVerificationGateStep)
  });
  if (actionPlanClosure.actionPlanDigest !== request.expectedActionPlanDigest) {
    throw new Error('observe-hosted reconstructed Action plan differs from request.');
  }
  const sessionProposalDigest = createVerificationSessionProposalDigest({
    repository: input.repository, prNumber: request.prNumber,
    baseSha: request.expectedBaseSha, baseTreeSha: request.expectedBaseTreeSha,
    headSha: request.expectedHeadSha, headTreeSha: request.expectedHeadTreeSha,
    manifestPath: request.manifestPath, manifestDigest: request.manifestDigest,
    testImpactTransitionDigest: transition.digest,
    scopeProposalDigest: proposalDigest, actionPlanClosureDigest: actionPlanClosure.actionPlanDigest,
    profile: request.profile, environmentDigest, trustRevision: request.expectedBaseSha,
    reviewPolicyDigest: request.reviewPolicyDigest, mainHealthPolicyDigest: CI_MAIN_HEALTH_POLICY_DIGEST
  });
  const mainHealthInput = createObservedMainHealthInput({ repository: input.repository,
    mainSha: request.expectedBaseSha, mainTreeSha: request.expectedBaseTreeSha, trustRevision: request.expectedBaseSha,
    observedAt: input.observedAt, expiresAt: new Date(new Date(input.observedAt).getTime() + 600_000).toISOString(),
    sourceRunId: input.sourceRunId, sourceRef: input.sourceRef, checks: input.mainHealthChecks });
  const mainHealth = createMainHealthLedger(mainHealthInput);
  const sessionRevision = createVerificationSessionRevision({
    repository: input.repository, prNumber: request.prNumber,
    baseSha: request.expectedBaseSha, baseTreeSha: request.expectedBaseTreeSha,
    headSha: request.expectedHeadSha, headTreeSha: request.expectedHeadTreeSha,
    manifestPath: request.manifestPath, manifestDigest: request.manifestDigest,
    sessionProposalDigest, scopeAuthorizationRevision, actionPlanClosureDigest: actionPlanClosure.actionPlanDigest,
    profile: request.profile, environmentDigest, trustRevision: request.expectedBaseSha,
    reviewPolicyDigest: request.reviewPolicyDigest, evidenceRequirementDigest: SEC_EVIDENCE_REQUIREMENT_DIGEST,
    integrationPolicyDigest: SEC_INTEGRATION_PLATFORM_POLICY_DIGEST,
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
    evidenceRequirementDigest: SEC_EVIDENCE_REQUIREMENT_DIGEST,
    integrationPolicyDigest: SEC_INTEGRATION_PLATFORM_POLICY_DIGEST,
    reviewBarrier: input.reviewBarrier,
    reviewExpiresAt: new Date(new Date(input.observedAt).getTime() + 300_000).toISOString(),
    integrationPrincipalNodeId: input.integrationPrincipalNodeId
  });
}

export interface VerificationSessionHostedEnvelope {
  schema: typeof VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA;
  requestOperationId: Digest;
  scopeAuthorization: ScopeAuthorization;
  preGateReview: ReviewStabilityReceipt;
  mainHealth: MainHealthLedger;
  session: VerificationSession;
  actionPlanClosure: CiVerificationActionPlanClosure;
  envelopeDigest: Digest;
}

export interface VerificationSessionHostedFacts {
  repository: string;
  sessionId: string;
  createdAt: string;
  candidate: GitHubCandidateObservation;
  authorizedPaths: readonly string[];
  sessionProposalDigest: Digest;
  scopeIssuer: ScopeAuthorizationInput['issuer'];
  scopeIssuedAt: string;
  scopeExpiresAt: string;
  environmentDigest: Digest;
  actionPlanClosure: CiVerificationActionPlanClosure;
  testImpactTransitionDigest: Digest;
  mainHealth: MainHealthLedgerInput;
  evidenceRequirementDigest: Digest;
  integrationPolicyDigest: Digest;
  reviewBarrier: Extract<GitHubReviewBarrierObservation, { status: 'clear' }>;
  reviewExpiresAt: string;
  integrationPrincipalNodeId: string;
}

export interface TrustedRuntimeProof {
  currentHeadSha: string;
  currentBranch: string;
  localDefaultSha: string;
  remoteDefaultSha: string;
  workingTreeClean: boolean;
  runtimeEntrypointBlobMatched: boolean;
  boundaryTargetsMatched: boolean;
}

export interface TrustedArtifactProvenance {
  observation: CodexDevelopmentHostedArtifactObservation;
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

export interface TrustedIntegrationAuthorizationArtifact {
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

export type TrustedIntegrationAuthorizationSource =
  | Readonly<{ kind: 'actions-artifact'; artifact: TrustedIntegrationAuthorizationArtifact }>
  | Readonly<{
      kind: 'github-comment';
      publication: IntegrationAuthorizationOperationPublication;
      commentId: number;
    }>;

export function createTrustedIntegrationAuthorizationPublicationSource(input: {
  publication: IntegrationAuthorizationOperationPublication;
  commentId: number;
}): TrustedIntegrationAuthorizationSource {
  if (!Number.isSafeInteger(input.commentId) || input.commentId < 1) {
    throw new Error('Trusted integration authorization publication commentId must be positive.');
  }
  return Object.freeze({ kind: 'github-comment' as const,
    publication: parseIntegrationAuthorizationOperationPublication(input.publication),
    commentId: input.commentId });
}

export function createTrustedHostedArtifactProvenance(input: {
  artifact: CodexDevelopmentVerificationSessionArtifact;
  artifactText: string;
  observation: GitHubActionsArtifactObservation;
  actorPermission: TrustedArtifactProvenance['transport']['actorPermission'];
}): TrustedArtifactProvenance {
  const observation = createHostedArtifactObservation({ artifact: input.artifact,
    artifactText: input.artifactText, observation: input.observation });
  return Object.freeze({ observation, artifactId: input.observation.artifactId, artifactName: input.observation.artifactName,
    canonicalByteDigest: hash(input.artifact), downloadTransport: 'github-actions-artifact-api',
    artifactDigest: input.artifact.artifactDigest as Digest, transport: Object.freeze({
      workflowPath: input.observation.workflowPath, workflowRef: input.observation.workflowRef,
      workflowSha: input.observation.workflowSha, runId: input.observation.runId,
      runAttempt: input.observation.runAttempt, actorNodeId: input.observation.actorNodeId,
      actorPermission: input.actorPermission }) });
}

export function createTrustedRuntimeArtifactObservationFromDurableFile(input: {
  artifact: CodexDevelopmentVerificationSessionArtifact;
  artifactText: string;
  runtimeSha: string;
  executionId: string;
}): CodexDevelopmentTrustedRuntimeArtifactObservation {
  const canonicalBytes = `${encodeVerificationActionData(input.artifact)}\n`;
  if (input.artifactText !== canonicalBytes) {
    throw new Error('Trusted runtime artifact bytes are not canonical or do not match the parsed artifact.');
  }
  if (input.artifact.producer.sourceTransport !== 'local-dev-runner'
      || input.artifact.producer.workflowPath !== CI_VERIFICATION_WORKFLOW_PATH
      || input.artifact.producer.workflowSha !== input.runtimeSha
      || input.artifact.producer.runId !== input.executionId) {
    throw new Error('Trusted runtime artifact producer does not bind the exact execution.');
  }
  return createTrustedRuntimeArtifactObservation({
    artifactFileName: 'verification-session-artifact.json',
    artifactByteDigest: `sha256:${createHash('sha256').update(canonicalBytes).digest('hex')}`,
    artifactByteLength: Buffer.byteLength(canonicalBytes, 'utf8'),
    runtimeRef: `${CodexDevelopmentMergeGateProducerIdentity}@${input.runtimeSha}`,
    runtimeSha: input.runtimeSha,
    executionId: input.executionId,
    producerSourceDigest: input.artifact.producer.sourceDigest as Digest,
    readbackTransport: 'trusted-runtime-durable-file'
  });
}

export type VerificationSessionArtifactReuseDisposition = Readonly<{
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
export function classifyVerificationSessionArtifactReuse(
  artifact: CodexDevelopmentVerificationSessionArtifact,
  now: string
): VerificationSessionArtifactReuseDisposition {
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs) || new Date(nowMs).toISOString() !== now) {
    throw new Error('artifact reuse observation time must be a canonical ISO instant.');
  }
  const actionEvidenceCandidate = artifact.evidence.status === 'passed'
    || artifact.evidence.status === 'failed';
  try {
    CodexDevelopmentAssertVerificationSessionArtifactCurrent(artifact, now);
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

export function createHostedArtifactObservation(input: {
  artifact: CodexDevelopmentVerificationSessionArtifact;
  artifactText: string;
  observation: GitHubActionsArtifactObservation;
}): CodexDevelopmentHostedArtifactObservation {
  const canonicalBytes = `${encodeVerificationActionData(input.artifact)}\n`;
  if (input.artifactText !== canonicalBytes) throw new Error('Downloaded hosted artifact bytes are not canonical or do not match the parsed artifact.');
  return CodexDevelopmentCreateHostedArtifactObservation({ artifactId: input.observation.artifactId,
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

export function createTrustedIntegrationAuthorizationArtifact(input: {
  resultJson: string;
  observation: GitHubActionsArtifactObservation;
}): TrustedIntegrationAuthorizationArtifact {
  const result = CodexDevelopmentParseMergeGateResult(input.resultJson);
  if (input.observation.workflowPath !== '.github/workflows/sec-merge-gate.yml'
    || input.observation.eventName !== 'workflow_run') {
    throw new Error('Integration authorization artifact is not bound to the completed-source workflow.');
  }
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
  trustedRuntimeProof(session: VerificationSession): TrustedRuntimeProof;
  runLocalActions(session: VerificationSession):
    | { status: 'passed'; resultDigest: Digest }
    | { status: 'waiting' }
    | { status: 'failed'; reason: string };
  hostedArtifact(): { artifact: CodexDevelopmentVerificationSessionArtifact; provenance: TrustedArtifactProvenance } | null;
  saveReviewReceipt(stage: 'pre-expensive' | 'pre-merge', receipt: ReviewStabilityReceipt): void;
  integrationAuthorizationArtifact(): TrustedIntegrationAuthorizationSource | null;
  integrationAuthorizationPublication(): IntegrationAuthorizationPublicationObservation | null;
  consumedAuthorizationIds(): ReadonlySet<string>;
  observeCloseoutPreparation(
    operationId: Digest,
    authorization: IntegrationAuthorization,
    session: VerificationSession
  ): { status: 'prepared'; preparationDigest: Digest } | { status: 'waiting' | 'blocked'; reason: string };
  observeCloseoutBinding(
    authorization: IntegrationAuthorization,
    session: VerificationSession,
    merged: GitHubCandidateObservation
  ):
    | { status: 'available'; binding: BranchCloseoutOperationBinding }
    | { status: 'waiting' | 'blocked'; reason: string };
  observeCloseout(
    binding: BranchCloseoutOperationBinding,
    authorization: IntegrationAuthorization,
    session: VerificationSession,
    merged: GitHubCandidateObservation
  ):
    | { status: 'completed' | 'protected-pending'; receiptDigest: Digest }
    | { status: 'waiting' | 'blocked'; reason: string };
}

interface IntegrationAuthorizationPublicationObservation {
  authorizationId: string;
  authorizationReceiptDigest: Digest;
  consumptionOperationId: Digest;
  authorizationPublicationId: Digest;
  authorizationPublicationDigest: Digest;
  commentId: number;
  preparationDigest: Digest;
}

export function integrationMergeMarkers(input: {
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

/** Compatibility name for callers that still consume the historical schema label. */
export const integrationAuthorizationMergeMarkers = integrationMergeMarkers;

export type VerificationSessionRuntimeOutcome = Readonly<{
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
  input: Omit<VerificationSessionRuntimeOutcome, 'completedStage' | 'operationId' | 'authorizationId'> & {
    completedStage?: string | null;
    operationId?: Digest | null;
    authorizationId?: string | null;
  }
): VerificationSessionRuntimeOutcome {
  return Object.freeze({ completedStage: input.completedStage ?? null,
    operationId: input.operationId ?? null, authorizationId: input.authorizationId ?? null, ...input });
}

/**
 * Proves an exact trusted-default revision checkout. Hosted jobs intentionally
 * use detached HEAD when actions/checkout receives an exact SHA; local
 * main-authority operations use assertTrustedMainRuntimeV1 instead.
 */
export function assertTrustedExactRevisionRuntime(
  proof: TrustedRuntimeProof,
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
    || !proof.runtimeEntrypointBlobMatched || !proof.boundaryTargetsMatched
  ) {
    throw new Error('VerificationSession runtime is not the clean exact trusted default revision TCB.');
  }
}

export function assertTrustedRuntime(
  proof: TrustedRuntimeProof,
  session: VerificationSession,
  allowRemoteMainTransition = false
): void {
  if (session.trustRevision !== session.baseSha) {
    throw new Error('VerificationSession runtime is not the clean exact trusted default TCB.');
  }
  assertTrustedExactRevisionRuntime(proof, session.baseSha, allowRemoteMainTransition);
}

export function assertTrustedMainRuntime(proof: TrustedRuntimeProof, expectedMainSha: string): void {
  if (proof.currentBranch !== 'main') {
    throw new Error('VerificationSession preparation is not running from the clean exact trusted default TCB.');
  }
  assertTrustedExactRevisionRuntime(proof, expectedMainSha);
}

export function assertTrustedMergedRuntimeReachability(input: {
  proof: TrustedRuntimeProof;
  session: VerificationSession;
  candidate: GitHubCandidateObservation;
  github: VerificationSessionGitHubClient;
}): void {
  const { proof, session, candidate, github } = input;
  assertTrustedMergedRequestRuntimeReachability({ proof, repository: session.repository,
    prNumber: session.prNumber, baseSha: session.baseSha, headSha: session.headSha,
    headTreeSha: session.headTreeSha, candidate, github });
}

export function assertTrustedMergedRequestRuntimeReachability(input: {
  proof: TrustedRuntimeProof;
  repository: string;
  prNumber: number;
  baseSha: string;
  headSha: string;
  headTreeSha: string;
  candidate: GitHubCandidateObservation;
  github: VerificationSessionGitHubClient;
}): void {
  const { proof, repository, prNumber, baseSha, headSha, headTreeSha, candidate, github } = input;
  if ((proof.currentBranch !== '' && proof.currentBranch !== 'main') || proof.currentHeadSha !== baseSha
    || proof.localDefaultSha !== proof.remoteDefaultSha || !proof.workingTreeClean
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

export function prepareTrustedMainVerificationSession(input: {
  repository: string;
  candidate: GitHubCandidateObservation;
  manifestPath: string;
  manifestDigest: Digest;
  changedPaths: readonly string[];
  testImpactTransition: CodexDevelopmentTestImpactTransitionObservation;
  testImpactSourceProvider: CodexDevelopmentTestImpactSourceProvider;
  profile: 'quick' | 'full';
  integrationPrincipalNodeId: string;
  producerPrincipalNodeId: string;
  sourceRunId: string;
  sourceRef: string;
  observedAt: string;
  reviewBarrier: GitHubReviewBarrierObservation;
  mainHealthChecks: readonly GitHubCheckObservation[];
  dependencyBlobs: readonly VerificationSessionActionDependencyBlobObservation[];
  executionEnvironment?: CiVerificationExecutionEnvironment;
  mainHealthInput?: MainHealthLedgerInput;
  scopeSourceTransport?: ScopeAuthorizationInput['issuer']['sourceTransport'];
}): Readonly<{
  request: VerificationSessionHostedRequest;
  sessionRevision: Digest;
  scopeAuthorizationRevision: Digest;
  sessionProposalDigest: Digest;
  actionPlanClosure: CiVerificationActionPlanClosure;
  testImpactTransitionDigest: Digest;
  reviewBarrier: GitHubReviewBarrierObservation;
  facts: VerificationSessionHostedFacts | null;
}> {
  const candidate = input.candidate;
  const executionEnvironment = input.executionEnvironment
    ?? CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT;
  const providerRevision = executionEnvironment.kind === 'hosted'
    ? 'github-actions@trusted-default'
    : executionEnvironment.executionEnvironmentRevision;
  const transition = bindVerificationSessionTestImpactTransition({
    baseSha: candidate.baseSha,
    headSha: candidate.headSha,
    changedPaths: input.changedPaths,
    transition: input.testImpactTransition
  });
  const environmentDigest = hash(Object.freeze({ schema: executionEnvironment.kind === 'hosted'
    ? 'sec-hosted-verification-environment-v1' : 'sec-trusted-runtime-verification-environment-v1',
    toolchainRevision: executionEnvironment.toolchainRevision, providerRevision,
    contractRevision: CI_VERIFICATION_CONTRACT_REVISION, trustRevision: candidate.baseSha }));
  const issuerSemantic = Object.freeze({ principalId: input.producerPrincipalNodeId, role: 'trusted-base-a0' as const,
    trustRevision: candidate.baseSha, producerIdentity: SEC_SCOPE_ISSUER_IDENTITY });
  const proposalDigest = createVerificationSessionScopeProposalDigest({ repository: input.repository,
    prNumber: candidate.number, baseSha: candidate.baseSha, baseTreeSha: candidate.baseTreeSha,
    headSha: candidate.headSha, headTreeSha: candidate.headTreeSha, manifestPath: input.manifestPath,
    manifestDigest: input.manifestDigest, authorizedPaths: input.changedPaths, profile: input.profile,
    environmentDigest, trustRevision: candidate.baseSha,
    testImpactTransitionDigest: transition.digest });
  const scopeRevision = createScopeAuthorizationRevision({ repository: input.repository, prNumber: candidate.number,
    baseSha: candidate.baseSha, baseTreeSha: candidate.baseTreeSha, headSha: candidate.headSha,
    headTreeSha: candidate.headTreeSha, manifestPath: input.manifestPath, manifestDigest: input.manifestDigest,
    proposalDigest, authorizedPaths: input.changedPaths, profile: input.profile, environmentDigest, issuer: issuerSemantic });
  const plan = CodexDevelopmentBuildVerificationPlan(
    input.profile,
    input.changedPaths,
    input.testImpactSourceProvider,
    transition.observation
  );
  if (!plan.selectionResolved) throw new Error('trusted-main preparation verification plan is unresolved.');
  const actionPlan = buildCiVerificationActionPlanClosure({ candidate: { baseSha: candidate.baseSha,
    baseTreeSha: candidate.baseTreeSha, headSha: candidate.headSha, headTreeSha: candidate.headTreeSha,
    manifestPath: input.manifestPath, manifestDigest: input.manifestDigest, scopeAuthorizationRevision: scopeRevision,
    profile: input.profile, toolchainRevision: executionEnvironment.toolchainRevision, providerRevision,
    contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
    requiredBlobs: createVerificationSessionActionDependencyRequiredBlobs(input.dependencyBlobs)
  }, gates: plan.gates.map(ciVerificationGateStep) });
  const sessionProposalDigest = createVerificationSessionProposalDigest({ repository: input.repository,
    prNumber: candidate.number, baseSha: candidate.baseSha, baseTreeSha: candidate.baseTreeSha,
    headSha: candidate.headSha, headTreeSha: candidate.headTreeSha, manifestPath: input.manifestPath,
    manifestDigest: input.manifestDigest, testImpactTransitionDigest: transition.digest,
    scopeProposalDigest: proposalDigest,
    actionPlanClosureDigest: actionPlan.actionPlanDigest, profile: input.profile, environmentDigest,
    trustRevision: candidate.baseSha, reviewPolicyDigest: SEC_REVIEW_STABILITY_POLICY.policyDigest,
    mainHealthPolicyDigest: CI_MAIN_HEALTH_POLICY_DIGEST });
  const mainHealthInput = input.mainHealthInput ?? createObservedMainHealthInput({
    repository: input.repository, mainSha: candidate.baseSha,
    mainTreeSha: candidate.baseTreeSha, trustRevision: candidate.baseSha, observedAt: input.observedAt,
    expiresAt: new Date(new Date(input.observedAt).getTime() + 600_000).toISOString(), sourceRunId: input.sourceRunId,
    sourceRef: input.sourceRef, checks: input.mainHealthChecks
  });
  const mainHealth = createMainHealthLedger(mainHealthInput);
  const sessionRevision = createVerificationSessionRevision({ repository: input.repository, prNumber: candidate.number,
    baseSha: candidate.baseSha, baseTreeSha: candidate.baseTreeSha, headSha: candidate.headSha,
    headTreeSha: candidate.headTreeSha, manifestPath: input.manifestPath, manifestDigest: input.manifestDigest,
    sessionProposalDigest, scopeAuthorizationRevision: scopeRevision, actionPlanClosureDigest: actionPlan.actionPlanDigest,
    profile: input.profile, environmentDigest, trustRevision: candidate.baseSha,
    reviewPolicyDigest: SEC_REVIEW_STABILITY_POLICY.policyDigest,
    evidenceRequirementDigest: SEC_EVIDENCE_REQUIREMENT_DIGEST,
    integrationPolicyDigest: SEC_INTEGRATION_PLATFORM_POLICY_DIGEST,
    mainHealthRef: { mainSha: candidate.baseSha, mainTreeSha: candidate.baseTreeSha, healthRevision: mainHealth.healthRevision } });
  const semanticRequest = Object.freeze({ schema: CI_VERIFICATION_SESSION_REQUEST_SCHEMA,
    prNumber: candidate.number, expectedBaseSha: candidate.baseSha, expectedBaseTreeSha: candidate.baseTreeSha,
    expectedHeadSha: candidate.headSha, expectedHeadTreeSha: candidate.headTreeSha, manifestPath: input.manifestPath,
    manifestDigest: input.manifestDigest, profile: input.profile, expectedScopeProposalDigest: proposalDigest,
    expectedActionPlanDigest: actionPlan.actionPlanDigest, expectedSessionRevision: sessionRevision,
    reviewPolicyDigest: SEC_REVIEW_STABILITY_POLICY.policyDigest });
  const requestOperationId = createVerificationSessionOperationId({ sessionRevision, operationKind: 'hosted-dispatch',
    semanticInputDigest: hash(semanticRequest) });
  const request = Object.freeze({ ...semanticRequest, requestOperationId });
  const facts: VerificationSessionHostedFacts | null = input.reviewBarrier.status === 'clear'
    ? Object.freeze({
        repository: input.repository,
        sessionId: `session-${sessionRevision.slice(7)}`,
        createdAt: input.observedAt,
        candidate,
        authorizedPaths: Object.freeze([...input.changedPaths]),
        sessionProposalDigest,
        scopeIssuer: Object.freeze({
          ...issuerSemantic,
          sourceTransport: input.scopeSourceTransport ?? 'github-actions',
          sourceRunId: input.sourceRunId,
          sourceRef: input.sourceRef,
          sourceDigest: hash({ requestOperationId, proposalDigest })
        }),
        scopeIssuedAt: input.observedAt,
        scopeExpiresAt: new Date(new Date(input.observedAt).getTime() + 600_000).toISOString(),
        environmentDigest,
        actionPlanClosure: actionPlan,
        testImpactTransitionDigest: transition.digest,
        mainHealth: mainHealthInput,
        evidenceRequirementDigest: SEC_EVIDENCE_REQUIREMENT_DIGEST,
        integrationPolicyDigest: SEC_INTEGRATION_PLATFORM_POLICY_DIGEST,
        reviewBarrier: input.reviewBarrier,
        reviewExpiresAt: new Date(new Date(input.observedAt).getTime() + 300_000).toISOString(),
        integrationPrincipalNodeId: input.integrationPrincipalNodeId
      })
    : null;
  return Object.freeze({ request, sessionRevision, scopeAuthorizationRevision: scopeRevision,
    sessionProposalDigest, actionPlanClosure: actionPlan,
    testImpactTransitionDigest: transition.digest, reviewBarrier: input.reviewBarrier, facts });
}

export function prepareTrustedRuntimeVerificationSession(input: Parameters<
  typeof prepareTrustedMainVerificationSession
>[0] & Readonly<{
  executionEnvironment: CiVerificationExecutionEnvironment;
  mainHealthInput: MainHealthLedgerInput;
}>): Readonly<{
  request: VerificationSessionHostedRequest;
  envelope: VerificationSessionHostedEnvelope;
  testImpactTransitionDigest: Digest;
}> {
  if (input.executionEnvironment.kind !== 'local') {
    throw new Error('trusted runtime Verification requires one local execution environment.');
  }
  const prepared = prepareTrustedMainVerificationSession({
    ...input,
    scopeSourceTransport: 'trusted-base'
  });
  if (prepared.facts === null) {
    throw new Error('trusted runtime Verification requires a clear independent Review barrier.');
  }
  return Object.freeze({
    request: prepared.request,
    envelope: prepareVerificationSessionHosted({
      request: prepared.request,
      facts: prepared.facts,
      now: input.observedAt
    }),
    testImpactTransitionDigest: prepared.testImpactTransitionDigest
  });
}

/**
 * Local developer feedback uses a distinct local Action identity. It consumes
 * the trusted Scope revision, but never replaces the hosted Action closure
 * bound into the VerificationSession request.
 */
export function prepareLocalQuickVerificationActionPlan(input: {
  candidate: GitHubCandidateObservation;
  manifestPath: string;
  manifestDigest: Digest;
  changedPaths: readonly string[];
  testImpactTransition: CodexDevelopmentTestImpactTransitionObservation;
  testImpactSourceProvider: CodexDevelopmentTestImpactSourceProvider;
  expectedTestImpactTransitionDigest: Digest;
  scopeAuthorizationRevision: Digest;
  executionEnvironment: CiVerificationExecutionEnvironment;
  dependencyBlobs: readonly VerificationSessionActionDependencyBlobObservation[];
}): CiVerificationActionPlanClosure {
  const environment = input.executionEnvironment;
  if (environment.kind !== 'local' || environment.runnerImage !== null) {
    throw new Error('local quick Action preparation requires one canonical local execution environment.');
  }
  const transition = bindVerificationSessionTestImpactTransition({
    baseSha: input.candidate.baseSha,
    headSha: input.candidate.headSha,
    changedPaths: input.changedPaths,
    transition: input.testImpactTransition,
    expectedDigest: input.expectedTestImpactTransitionDigest
  });
  const plan = CodexDevelopmentBuildVerificationPlan(
    'quick',
    input.changedPaths,
    input.testImpactSourceProvider,
    transition.observation
  );
  if (!plan.selectionResolved) {
    throw new Error('local quick Action preparation verification plan is unresolved.');
  }
  const quickGates = plan.gates.filter((gate) => gate.phase === 'quick');
  if (quickGates.length === 0) {
    throw new Error('local quick Action preparation resolved no quick gates.');
  }
  return buildCiVerificationActionPlanClosure({ candidate: {
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
    requiredBlobs: createVerificationSessionActionDependencyRequiredBlobs(input.dependencyBlobs)
  }, gates: quickGates.map(ciVerificationGateStep) });
}

function assertCandidateCurrent(candidate: GitHubCandidateObservation, session: VerificationSession): void {
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

export function createVerificationSessionReviewReceipt(input: {
  stage: 'pre-expensive' | 'pre-merge';
  session: VerificationSession;
  scope: ScopeAuthorization;
  barrier: Extract<GitHubReviewBarrierObservation, { status: 'clear' }>;
  candidateAuthorNodeId: string;
  integrationPrincipalNodeId: string;
  expiresAt: string;
  operationId: Digest;
  producerSourceRef?: string;
  producerSourceRunId?: string;
}): ReviewStabilityReceipt {
  assertGitHubReviewAuthorityObservation(input.barrier);
  const receipt = createReviewStabilityReceipt({
    stage: input.stage,
    repository: input.session.repository,
    prNumber: input.session.prNumber,
    sessionRevision: input.session.sessionRevision,
    scopeAuthorizationRevision: input.scope.authorizationRevision,
    scopeAuthorizationReceiptDigest: input.scope.authorizationDigest,
    headSha: input.session.headSha,
    headTreeSha: input.session.headTreeSha,
    policy: SEC_REVIEW_STABILITY_POLICY,
    principal: input.barrier.principal,
    independence: {
      candidateAuthorNodeId: input.candidateAuthorNodeId,
      integrationPrincipalNodeId: input.integrationPrincipalNodeId
    },
    producer: {
      identity: REVIEW_OBSERVER_PRODUCER_IDENTITY,
      executionIdentity: input.barrier.authority.executionIdentity,
      providerIdentity: input.barrier.authority.providerIdentity,
      candidateWriteCapability: input.barrier.authority.candidateWriteCapability,
      capabilityReceiptDigest: input.barrier.authority.capabilityReceiptDigest,
      trustedRevision: SEC_REVIEW_STABILITY_POLICY.trustedRevision,
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

export { SEC_VERIFICATION_SESSION_IMPLEMENTATION_IDENTITY } from '../../session/contract/session.ts';

function createVerificationSessionHostedRequest(input: {
  session: VerificationSession;
  scope: ScopeAuthorization;
  testImpactTransitionDigest: Digest;
}): VerificationSessionHostedRequest {
  const { session, scope } = input;
  const proposalDigest = createVerificationSessionScopeProposalDigest({
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
    schema: CI_VERIFICATION_SESSION_REQUEST_SCHEMA,
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

export function parseVerificationSessionHostedRequest(
  source: string
): VerificationSessionHostedRequest {
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
  if (value.schema !== CI_VERIFICATION_SESSION_REQUEST_SCHEMA) {
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
  return Object.freeze(value as unknown as VerificationSessionHostedRequest);
}

export function prepareVerificationSessionHosted(input: {
  request: VerificationSessionHostedRequest;
  facts: VerificationSessionHostedFacts;
  now?: string;
}): VerificationSessionHostedEnvelope {
  const request = parseVerificationSessionHostedRequest(JSON.stringify(input.request));
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
  if (request.reviewPolicyDigest !== SEC_REVIEW_STABILITY_POLICY.policyDigest) {
    throw new Error('prepare-hosted review policy is not canonical.');
  }
  if (facts.integrationPolicyDigest !== SEC_INTEGRATION_PLATFORM_POLICY_DIGEST) {
    throw new Error('prepare-hosted integration policy is not canonical.');
  }
  const reconstructedScopeProposalDigest = createVerificationSessionScopeProposalDigest({
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
  const actionPlanClosure = parseCiVerificationActionPlanClosure(
    encodeVerificationActionData(facts.actionPlanClosure)
  );
  if (actionPlanClosure.actionPlanDigest !== request.expectedActionPlanDigest) {
    throw new Error('prepare-hosted Action plan digest differs from proposed request.');
  }
  const scopeAuthorization = createScopeAuthorization({
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
  const mainHealth = createMainHealthLedger(facts.mainHealth);
  const sessionInput: VerificationSessionInput = {
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
    reviewPolicyDigest: SEC_REVIEW_STABILITY_POLICY.policyDigest,
    evidenceRequirementDigest: facts.evidenceRequirementDigest,
    integrationPolicyDigest: facts.integrationPolicyDigest,
    mainHealthRef: {
      mainSha: mainHealth.mainSha,
      mainTreeSha: mainHealth.mainTreeSha,
      healthRevision: mainHealth.healthRevision,
      ledgerReceiptDigest: mainHealth.ledgerDigest
    }
  };
  const session = createVerificationSession(sessionInput);
  if (session.sessionRevision !== request.expectedSessionRevision) {
    throw new Error('prepare-hosted Session revision differs from proposed request.');
  }
  if (facts.reviewBarrier.status !== 'clear') throw new Error('prepare-hosted Review barrier is not clear.');
  const reviewOperationId = createVerificationSessionOperationId({
    sessionRevision: session.sessionRevision,
    operationKind: 'pre-gate-review',
    semanticInputDigest: facts.reviewBarrier.snapshot.snapshotDigest
  });
  const preGateReview = createVerificationSessionReviewReceipt({
    stage: 'pre-expensive', session, scope: scopeAuthorization, barrier: facts.reviewBarrier,
    candidateAuthorNodeId: candidate.authorNodeId,
    integrationPrincipalNodeId: facts.integrationPrincipalNodeId,
    expiresAt: facts.reviewExpiresAt,
    operationId: reviewOperationId
  });
  assertReviewStabilityReceiptCurrent(preGateReview, {
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
    schema: VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA,
    requestOperationId: request.requestOperationId,
    scopeAuthorization,
    preGateReview,
    mainHealth,
    session,
    actionPlanClosure
  });
  return Object.freeze({ ...withoutDigest, envelopeDigest: hash(withoutDigest) });
}

export function finalizeVerificationSessionHostedArtifact(input: {
  envelope: VerificationSessionHostedEnvelope;
  evidence: CodexDevelopmentVerificationEvidenceV4;
}): CodexDevelopmentVerificationSessionArtifact {
  const envelope = input.envelope;
  const { envelopeDigest, ...withoutDigest } = envelope;
  if (envelope.schema !== VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA || hash(withoutDigest) !== envelopeDigest) {
    throw new Error('prepare-hosted envelope digest mismatch.');
  }
  if (input.evidence.actionPlan.actionPlanDigest !== envelope.actionPlanClosure.actionPlanDigest) {
    throw new Error('finalize-hosted Evidence Action plan differs from prepared envelope.');
  }
  return CodexDevelopmentFinalizeVerificationSessionArtifact({
    scopeAuthorization: envelope.scopeAuthorization,
    session: envelope.session,
    preGateReview: envelope.preGateReview,
    mainHealth: envelope.mainHealth,
    evidence: input.evidence,
    producer: input.evidence.producer
  });
}

export function refreshVerificationSessionHostedArtifact(input: {
  envelope: VerificationSessionHostedEnvelope;
  previousArtifact: CodexDevelopmentVerificationSessionArtifact;
  producer: CodexDevelopmentVerificationEvidenceProducer;
  refreshedAt: string;
}): CodexDevelopmentVerificationSessionArtifact {
  const { envelopeDigest, ...withoutDigest } = input.envelope;
  if (input.envelope.schema !== VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA
    || hash(withoutDigest) !== envelopeDigest) {
    throw new Error('prepare-hosted refresh envelope digest mismatch.');
  }
  return CodexDevelopmentRefreshVerificationSessionArtifact({
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
  artifact: CodexDevelopmentVerificationSessionArtifact,
  provenance: TrustedArtifactProvenance,
  session: VerificationSession
): void {
  CodexDevelopmentAssertVerificationSessionArtifact(artifact);
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

export function prepareVerificationSessionMergeInput(input: {
  artifact: CodexDevelopmentVerificationSessionArtifact;
  preMergeReview: ReviewStabilityReceipt;
  platform: PlatformEnforcementObservation;
  candidate: CodexDevelopmentMergeGateCandidate;
  hostedArtifactOrigin: CodexDevelopmentHostedArtifactObservation;
  hostedArtifactTransport: CodexDevelopmentHostedArtifactObservation;
  provenance: Omit<CodexDevelopmentMergeGateProvenance, 'sourceDigest'>;
  mainHealth: MainHealthLedger;
  consumptionOperationId: Digest;
  issuedAt: string;
  expiresAt: string;
}): CodexDevelopmentMergeGateInput {
  if (input.platform.status === 'unknown') throw new Error('Unknown platform enforcement blocks merge input.');
  CodexDevelopmentAssertVerificationSessionArtifact(input.artifact);
  const provenance = createMergeGateProvenance(input.provenance);
  return CodexDevelopmentCreateMergeGateInput({
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

export function prepareVerificationSessionTrustedRuntimeMergeInput(input: {
  artifact: CodexDevelopmentVerificationSessionArtifact;
  preMergeReview: ReviewStabilityReceipt;
  platform: PlatformEnforcementObservation;
  candidate: CodexDevelopmentMergeGateCandidate;
  artifactObservation: CodexDevelopmentTrustedRuntimeArtifactObservation;
  provenance: Omit<CodexDevelopmentTrustedRuntimeMergeGateProvenance, 'sourceDigest'>;
  mainHealth: MainHealthLedger;
  consumptionOperationId: Digest;
  issuedAt: string;
  expiresAt: string;
}): CodexDevelopmentTrustedRuntimeMergeGateInput {
  if (input.platform.status === 'unknown') {
    throw new Error('Unknown platform enforcement blocks trusted runtime merge input.');
  }
  CodexDevelopmentAssertVerificationSessionArtifact(input.artifact);
  const provenance = createTrustedRuntimeMergeGateProvenance(input.provenance);
  return CodexDevelopmentCreateTrustedRuntimeMergeGateInput({
    provenance,
    candidate: Object.freeze({ ...input.candidate,
      changedPaths: Object.freeze([...input.candidate.changedPaths]) }),
    artifact: input.artifact,
    artifactObservation: input.artifactObservation,
    expectedActionPlan: input.artifact.evidence.actionPlan,
    reviewReceipt: input.preMergeReview,
    reviewSnapshotDigest: input.preMergeReview.snapshot.snapshotDigest,
    mainHealth: input.mainHealth,
    environmentDigest: input.artifact.session.environmentDigest,
    trustRevision: input.artifact.session.trustRevision,
    platformObservation: Object.freeze({
      status: input.platform.status,
      rulesetDigest: input.platform.rulesetDigest,
      reason: input.platform.reason
    }),
    consumptionOperationId: input.consumptionOperationId,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt
  });
}

function verifyIntegrationArtifact(input: {
  source: TrustedIntegrationAuthorizationSource;
  result: CodexDevelopmentMergeGateResult;
  hosted: TrustedArtifactProvenance;
  session: VerificationSession;
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
    || artifact.actorNodeId !== CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.nodeId
    || artifact.actorPermission !== 'none'
    || artifact.downloadTransport !== 'github-actions-artifact-api')
    || provenance.workflowSha !== session.trustRevision
    || provenance.workflowRef !== `.github/workflows/sec-merge-gate.yml@${session.trustRevision}`
    || authorization.issuer.producerIdentity !== CodexDevelopmentMergeGateProducerIdentity
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
export function resumeVerificationSession(input: {
  repositoryRoot: string;
  session: VerificationSession;
  scopeAuthorization: ScopeAuthorization;
  changedPaths: readonly string[];
  testImpactTransition?: CodexDevelopmentTestImpactTransitionObservation;
  integrationPrincipalNodeId: string;
  github: VerificationSessionGitHubClient;
  external: VerificationSessionRuntimeExternal;
  journalFs: VerificationSessionJournalFileSystem;
}): VerificationSessionRuntimeOutcome {
  const session = parseVerificationSession(encodeVerificationActionData(input.session));
  const scope = parseScopeAuthorization(encodeVerificationActionData(input.scopeAuthorization));
  const fs = input.journalFs;
  let journal = readVerificationSessionJournal({ sessionRevision: session.sessionRevision, fs });
  const candidate = input.github.observeCandidate(session.repository, session.prNumber);
  const liveMerged = candidate.state === 'MERGED';
  const trustedRuntimeProof = input.external.trustedRuntimeProof(session);
  if (liveMerged) {
    assertTrustedMergedRuntimeReachability({ proof: trustedRuntimeProof, session, candidate,
      github: input.github });
  } else {
    assertTrustedRuntime(trustedRuntimeProof, session, false);
  }
  if (!liveMerged) {
    assertCandidateCurrent(candidate, session);
  } else if (candidate.repository !== session.repository || candidate.number !== session.prNumber
    || candidate.headSha !== session.headSha || candidate.headTreeSha !== session.headTreeSha) {
    throw new Error('VerificationSession merged PR identity drifted.');
  }
  assertScopeAuthorizationCurrent(scope, {
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

  const append = (targetStage: Parameters<typeof appendVerificationSessionJournalEvent>[0]['targetStage'], receiptDigest: Digest | null, operationId: Digest | null = null) => {
    appendVerificationSessionJournalEvent({ sessionRevision: session.sessionRevision,
      targetStage, kind: 'completed', receiptDigest, operationId, fs });
    journal = readVerificationSessionJournal({ sessionRevision: session.sessionRevision, fs });
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
      const receipt = createVerificationSessionReviewReceipt({ stage: 'pre-expensive', session, scope, barrier,
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
      const transition = bindVerificationSessionTestImpactTransition({
        baseSha: session.baseSha,
        headSha: session.headSha,
        changedPaths: input.changedPaths,
        transition: input.testImpactTransition
      });
      const request = createVerificationSessionHostedRequest({
        session,
        scope,
        testImpactTransitionDigest: transition.digest
      });
      const claim = claimVerificationSessionOperation({ sessionRevision: session.sessionRevision,
        operationId: request.requestOperationId, operationKind: 'hosted-dispatch', fs });
      if (claim.claimed) input.github.ensureVerificationSessionWakeup(session.repository, request);
      appendVerificationSessionJournalEvent({ sessionRevision: session.sessionRevision,
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

  if (session.integrationPolicyDigest !== SEC_INTEGRATION_PLATFORM_POLICY_DIGEST) {
    throw new Error('Session integration platform policy is not the canonical no-admin policy.');
  }
  const integrationSource = input.external.integrationAuthorizationArtifact();
  if (integrationSource === null) return outcome({ status: 'WAITING_INTEGRATION_AUTHORIZATION', sessionRevision: session.sessionRevision,
    reason: 'trusted merge-gate authorization artifact is not available', receiptDigest: hosted.artifact.evidence.evidenceDigest as Digest, completedStage: journal.completedStage });
  const integrationResult = integrationSource.kind === 'actions-artifact'
    ? CodexDevelopmentParseMergeGateResult(integrationSource.artifact.resultJson)
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
  const markers = integrationMergeMarkers({ sessionRevision: session.sessionRevision,
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
  assertReviewStabilityReceiptCurrent(preMergeReceipt, { stage: 'pre-merge',
    sessionRevision: session.sessionRevision, scopeAuthorizationRevision: scope.authorizationRevision,
    scopeAuthorizationReceiptDigest: scope.authorizationDigest, headSha: session.headSha, headTreeSha: session.headTreeSha,
    expectedPolicyDigest: session.reviewPolicyDigest,
    snapshotDigest: barrier === null ? preMergeReceipt.snapshot.snapshotDigest : barrier.snapshot.snapshotDigest,
    expectedReviewRevision: preMergeReceipt.reviewRevision,
    now: liveMerged ? preMergeReceipt.reviewedAt : input.external.now() });
  const health = resolveOrdinaryMainHealthLane({ ledger: integrationResult.mainHealth,
    now: liveMerged ? integrationResult.mainHealth.observedAt : input.external.now(),
    expectedRepository: session.repository,
    expectedDefaultBranch: CI_MAIN_HEALTH_POLICY.producer.branch,
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
  assertIntegrationAuthorizationUsable(authorization, {
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
  assertCanonicalMergeMessage({
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
  assertBranchCloseoutOperationBinding(closeoutBinding);
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
