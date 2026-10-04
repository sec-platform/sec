import type { VerificationGateResult, VerificationResultStatus } from "../../../../../assurance/verification/result/contract/result.ts";
import type { HostedResumeSignal, HostedSessionTerminalArtifact, VerificationSessionHostedRequest } from "../../../../../execution/verification/hosted.ts";
import { HOSTED_RESUME_SIGNAL_SCHEMA, parseHostedResumeDispatchSignal } from '../../../../providers/github-api/contract/hosted-resume-dispatch.ts';
import { assertHostedSessionTerminalArtifact, assertHostedSessionTerminalArtifactCurrent, finalizeVerificationSessionResumeArtifact } from "../contract/evidence.ts";
import { parseVerificationSessionHostedRequest, VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA } from "../contract/session-request.ts";
/** Canonical VerificationSession V2 operator reducer and trusted runtime guards. */

import { createHash } from 'node:crypto';
import { rawSha256 } from '../../../../../contracts/canonical.ts';
import { parseDigest } from '../../../../../contracts/digest.ts';
import type { CiVerificationActionPlanClosure, VerificationActionInputRef } from '../../../../../execution/verification/action.ts';
import type { BranchCloseoutOperationBinding } from '../../../../../execution/verification/branch-closeout.ts';
import type { HostedArtifactObservation, IntegrationAuthorization, IntegrationAuthorizationOperationPublication, MergeGateProvenance, MergeGateResult } from '../../../../../execution/verification/integration.ts';
import type { Digest, GitHubActionsArtifactObservation, GitHubCandidateObservation, GitHubCheckObservation, GitHubReviewBarrierObservation, MainHealthLedger, PlatformEnforcementObservation, ReviewStabilityReceipt, ScopeAuthorization, TrustedArtifactProvenance, TrustedIntegrationAuthorizationArtifact, TrustedIntegrationAuthorizationSource, TrustedRuntimeProof, VerificationEvidence, VerificationEvidenceProducer, VerificationSession, VerificationSessionArtifact } from '../../../../../execution/verification/session.ts';
import { createDelegatedHostedArtifactObservation } from '../../../../self-hosting/control/integration/merge-gate.ts';
import type { TrustedRuntimeSourceProgramAttemptEvidence } from '../../trusted-runtime/trusted-runtime-container.ts';
import { assertSourceProgramTransitionQualification, sourceProgramTransitionEvidenceForQualification, type SourceProgramTransitionQualification } from '../../trusted-runtime/trusted-runtime-container.ts';
import type { SourceProgramTransitionAcceptanceRecord } from '../contract/evidence.ts';

import { CI_VERIFICATION_CONTRACT_REVISION, CI_VERIFICATION_WORKFLOW_PATH } from '../../../../../assurance/verification/contract/revision.ts';

import { parseIntegrationAuthorizationOperationPublication } from '../../../../self-hosting/control/integration/integration-authorization-publication.ts';
import { CodexDevelopmentCreateHostedArtifactObservation, CodexDevelopmentCreateMergeGateInput, CodexDevelopmentCreateTrustedRuntimeMergeGateInput, CodexDevelopmentMergeGateProducerIdentity, CodexDevelopmentParseMergeGateResult, createMergeGateProvenance, createTrustedRuntimeArtifactObservation, createTrustedRuntimeMergeGateProvenance, type CodexDevelopmentMergeGateCandidate, type CodexDevelopmentMergeGateInput, type CodexDevelopmentTrustedRuntimeArtifactObservation, type CodexDevelopmentTrustedRuntimeMergeGateInput, type CodexDevelopmentTrustedRuntimeMergeGateProvenance } from '../../../../self-hosting/control/integration/merge-gate.ts';
import {
  SEC_INTEGRATION_PLATFORM_POLICY_DIGEST
} from '../../../../self-hosting/control/integration/platform-policy.ts';
import { createMainHealthLedger, resolveOrdinaryMainHealthLane, type MainHealthLedgerInput } from '../../../../self-hosting/control/main-health/contract.ts';
import { createObservedMainHealthInput } from '../../../../self-hosting/control/main-health/main-health-observation.ts';
import { CI_MAIN_HEALTH_POLICY_DIGEST } from '../../../../self-hosting/control/main-health/provider-policy.ts';
import { createScopeAuthorization, createScopeAuthorizationRevision, type ScopeAuthorizationInput } from '../../../../self-hosting/control/scope/authorization.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import { buildCiVerificationActionPlanClosure, CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENTS, ciVerificationGateStep, parseCiVerificationActionPlanClosure, parseCiVerificationHostedExecutionEnvironment, SOURCE_PROGRAM_TRANSITION_GATE_ID, type CiSourceProgramTransitionBinding, type CiVerificationExecutionEnvironment } from '../../action/contract/ci.ts';
import { CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS } from '../../action/contract/environment.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY } from '../../action/contract/provider.ts';
import { assertReviewStabilityReceiptCurrent, createReviewStabilityReceipt, REVIEW_OBSERVER_PRODUCER_IDENTITY, SEC_REVIEW_STABILITY_POLICY } from '../../review/contract/stability.ts';
import { createVerificationSession, createVerificationSessionProposalDigest, createVerificationSessionRevision, type VerificationSessionInput } from '../../session/contract/session.ts';
import type { CodexDevelopmentTestImpactSourceProvider } from '../../test-impact/runtime/impact.ts';
import { CodexDevelopmentAssertTestImpactTransitionSelection, type CodexDevelopmentTestImpactTransitionObservation } from '../../test-impact/runtime/transition.ts';
import { CodexDevelopmentAssertVerificationSessionArtifact, CodexDevelopmentFinalizeVerificationSessionArtifact, CodexDevelopmentRefreshVerificationSessionArtifact } from '../contract/evidence.ts';
import {
  CodexDevelopmentBuildVerificationPlan
} from '../contract/plan.ts';
import {
  CI_VERIFICATION_SESSION_LOCAL_PREPARATION_SCHEMA,
  CI_VERIFICATION_SESSION_REQUEST_SCHEMA,
  type VerificationSessionLocalPreparationRequest
} from "../contract/session-request.ts";
import { assertGitHubReviewAuthorityObservation, type VerificationSessionGitHubClient } from './verification-session-github.ts';
import {
  createVerificationSessionOperationId
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


export function verificationSessionDataDigest(value: unknown): Digest {
  return `sha256:${createHash('sha256').update(encodeVerificationActionData(value)).digest('hex')}`;
}

const SEC_EVIDENCE_REQUIREMENT_DIGEST = verificationSessionDataDigest(Object.freeze({
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
    semanticInputDigest: verificationSessionDataDigest(Object.freeze({ headSha: input.headSha, actionPlanDigest: input.actionPlanDigest })) });
}

function createVerificationSessionScopeProposalDigest(input: {
  repository: string; prNumber: number; baseSha: string; baseTreeSha: string;
  headSha: string; headTreeSha: string; manifestPath: string; manifestDigest: Digest;
  authorizedPaths: readonly string[]; profile: string; environmentDigest: Digest; trustRevision: string;
  testImpactTransitionDigest: Digest;
}): Digest {
  return verificationSessionDataDigest(Object.freeze({ schema: 'sec-scope-proposal-v1', ...input,
    authorizedPaths: Object.freeze([...input.authorizedPaths].sort()) }));
}

export function bindVerificationSessionTestImpactTransition(input: {
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
  request: VerificationSessionHostedRequest<typeof import("../contract/session-request.ts").CI_VERIFICATION_SESSION_REQUEST_SCHEMA>;
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
  const issuerSemantic = Object.freeze({
    principalId: input.producerPrincipalNodeId,
    role: 'trusted-base-a0' as const,
    trustRevision: request.expectedBaseSha,
    producerIdentity: SEC_SCOPE_ISSUER_IDENTITY
  });
  // The original request transports this choice only through its Scope digest.
  // Recover exactly one canonical profile; a matching digest grants no runtime authority.
  const matches = CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENTS.map((executionEnvironment) => {
    const environmentDigest = verificationSessionDataDigest(Object.freeze({
      schema: 'sec-hosted-verification-environment-v1',
      toolchainRevision: executionEnvironment.toolchainRevision,
      providerRevision: executionEnvironment.executionEnvironmentRevision,
      contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
      trustRevision: request.expectedBaseSha
    }));
    const proposalDigest = createVerificationSessionScopeProposalDigest({
      repository: input.repository, prNumber: request.prNumber,
      baseSha: request.expectedBaseSha, baseTreeSha: request.expectedBaseTreeSha,
      headSha: request.expectedHeadSha, headTreeSha: request.expectedHeadTreeSha,
      manifestPath: request.manifestPath, manifestDigest: request.manifestDigest,
      authorizedPaths: input.changedPaths, profile: request.profile,
      environmentDigest, trustRevision: request.expectedBaseSha,
      testImpactTransitionDigest: transition.digest
    });
    return { executionEnvironment, environmentDigest, proposalDigest };
  }).filter(({ proposalDigest }) => proposalDigest === request.expectedScopeProposalDigest);
  if (matches.length !== 1) {
    throw new Error('observe-hosted reconstructed Scope proposal digest must select exactly one closed hosted environment.');
  }
  const { executionEnvironment, environmentDigest, proposalDigest } = matches[0]!;
  if (executionEnvironment.toolchainRevision !== `bun@${Bun.version}`) {
    throw new Error('observe-hosted loaded Bun revision differs from the selected execution environment.');
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
      toolchainRevision: executionEnvironment.toolchainRevision,
      providerRevision: executionEnvironment.executionEnvironmentRevision,
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
    checks: input.mainHealthChecks });
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
      sourceRef: input.sourceRef, sourceDigest: verificationSessionDataDigest({ requestOperationId: request.requestOperationId, proposalDigest }) },
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
  artifact: HostedSessionTerminalArtifact<SourceProgramTransitionAcceptanceRecord, TrustedRuntimeSourceProgramAttemptEvidence, typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult, typeof HOSTED_RESUME_SIGNAL_SCHEMA>;
  artifactText: string;
  observation: GitHubActionsArtifactObservation;
  actorPermission: TrustedArtifactProvenance['transport']['actorPermission'];
}): TrustedArtifactProvenance {
  const observation = createHostedArtifactObservation({ artifact: input.artifact,
    artifactText: input.artifactText, observation: input.observation });
  return Object.freeze({ observation, artifactId: input.observation.artifactId, artifactName: input.observation.artifactName,
    canonicalByteDigest: verificationSessionDataDigest(input.artifact), downloadTransport: 'github-actions-artifact-api',
    artifactDigest: input.artifact.artifactDigest as Digest, transport: Object.freeze({
      workflowPath: input.observation.workflowPath, workflowRef: input.observation.workflowRef,
      workflowSha: input.observation.workflowSha, runId: input.observation.runId,
      runAttempt: input.observation.runAttempt, actorNodeId: input.observation.actorNodeId,
      actorPermission: input.actorPermission }) });
}

export function createTrustedRuntimeArtifactObservationFromDurableFile(input: {
  artifact: VerificationSessionArtifact<SourceProgramTransitionAcceptanceRecord, TrustedRuntimeSourceProgramAttemptEvidence, typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult>;
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
  artifact: HostedSessionTerminalArtifact<SourceProgramTransitionAcceptanceRecord, TrustedRuntimeSourceProgramAttemptEvidence, typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult, typeof HOSTED_RESUME_SIGNAL_SCHEMA>,
  now: string
): VerificationSessionArtifactReuseDisposition {
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs) || new Date(nowMs).toISOString() !== now) {
    throw new Error('artifact reuse observation time must be a canonical ISO instant.');
  }
  const actionEvidenceCandidate = artifact.evidence.status === 'passed'
    || artifact.evidence.status === 'failed';
  try {
    assertHostedSessionTerminalArtifactCurrent(artifact, now);
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
  artifact: HostedSessionTerminalArtifact<SourceProgramTransitionAcceptanceRecord, TrustedRuntimeSourceProgramAttemptEvidence, typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult, typeof HOSTED_RESUME_SIGNAL_SCHEMA>;
  artifactText: string;
  observation: GitHubActionsArtifactObservation;
}): HostedArtifactObservation {
  const canonicalBytes = `${encodeVerificationActionData(input.artifact)}\n`;
  if (input.artifactText !== canonicalBytes) throw new Error('Downloaded hosted artifact bytes are not canonical or do not match the parsed artifact.');
  if (input.artifact.schema === 'verification-session-delegated-terminal') {
    if (input.observation.workflowPath !== '.github/workflows/compiler-pr-validation.yml'
        || input.observation.eventName !== 'repository_dispatch' || input.observation.actorPermission !== 'none'
        || input.observation.expired !== false) {
      throw new Error('Delegated observation must preserve its actual compiler workflow bot transport.');
    }
    return createDelegatedHostedArtifactObservation({ kind: 'delegated-session-terminal',
      delegatedArtifactDigest: parseDigest(input.artifact.artifactDigest, 'sha256'),
      artifactId: input.observation.artifactId, artifactName: input.observation.artifactName,
      artifactFileName: 'verification-session-artifact.json', artifactByteDigest: rawSha256(canonicalBytes),
      artifactByteLength: Buffer.byteLength(canonicalBytes, 'utf8'), artifactExpired: input.observation.expired,
      workflowPath: input.observation.workflowPath, workflowRef: input.observation.workflowRef,
      workflowSha: input.observation.workflowSha, runId: input.observation.runId, runAttempt: input.observation.runAttempt,
      eventName: input.observation.eventName, actorNodeId: input.observation.actorNodeId,
      actorPermission: input.observation.actorPermission, downloadTransport: 'github-actions-artifact-api' }, input.artifact);
  }
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
  if (input.observation.workflowPath !== '.github/workflows/merge-gate.yml'
    || input.observation.eventName !== 'workflow_run') {
    throw new Error('Integration authorization artifact is not bound to the completed-source workflow.');
  }
  return Object.freeze({ resultJson: input.resultJson, artifactId: input.observation.artifactId,
    artifactName: input.observation.artifactName, canonicalByteDigest: verificationSessionDataDigest(result),
    workflowPath: input.observation.workflowPath as '.github/workflows/merge-gate.yml',
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
  hostedArtifact(): { artifact: HostedSessionTerminalArtifact<SourceProgramTransitionAcceptanceRecord, TrustedRuntimeSourceProgramAttemptEvidence, typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult, typeof HOSTED_RESUME_SIGNAL_SCHEMA>; provenance: TrustedArtifactProvenance } | null;
  saveReviewReceipt(stage: 'pre-expensive' | 'pre-merge', receipt: ReviewStabilityReceipt): void;
  integrationAuthorizationArtifact(): TrustedIntegrationAuthorizationSource | null;
  integrationAuthorizationPublication(): IntegrationAuthorizationPublicationObservation | null;
  consumedAuthorizationIds(): ReadonlySet<string> | Promise<ReadonlySet<string>>;
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
  ): VerificationSessionCloseoutObservation | Promise<VerificationSessionCloseoutObservation>;
}

import type { IntegrationAuthorizationPublicationObservation, VerificationSessionCloseoutObservation, VerificationSessionHostedEnvelope, VerificationSessionHostedFacts } from '../../../../../execution/verification/hosted.ts';

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

export async function assertTrustedMergedRuntimeReachability(input: {
  proof: TrustedRuntimeProof;
  session: VerificationSession;
  candidate: GitHubCandidateObservation;
  github: VerificationSessionGitHubClient;
}): Promise<void> {
  const { proof, session, candidate, github } = input;
  (await assertTrustedMergedRequestRuntimeReachability({ proof, repository: session.repository,
    prNumber: session.prNumber, baseSha: session.baseSha, headSha: session.headSha,
    headTreeSha: session.headTreeSha, candidate, github }));
}

export async function assertTrustedMergedRequestRuntimeReachability(input: {
  proof: TrustedRuntimeProof;
  repository: string;
  prNumber: number;
  baseSha: string;
  headSha: string;
  headTreeSha: string;
  candidate: GitHubCandidateObservation;
  github: VerificationSessionGitHubClient;
}): Promise<void> {
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
  const baseToMerge = (await github.observeComparison(repository, baseSha, candidate.mergeCommitSha));
  if (baseToMerge.behindBy !== 0
    || baseToMerge.status !== 'ahead' && baseToMerge.status !== 'identical') {
    throw new Error('VerificationSession MERGED recovery cannot prove old base ancestry to the merge commit.');
  }
  const mergeToDefault = (await github.observeComparison(repository, candidate.mergeCommitSha,
    proof.remoteDefaultSha));
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
  executionEnvironment: CiVerificationExecutionEnvironment;
  mainHealthInput?: MainHealthLedgerInput;
  scopeSourceTransport?: ScopeAuthorizationInput['issuer']['sourceTransport'];
  sourceProgramTransition?: CiSourceProgramTransitionBinding;
}): Readonly<{
  request: VerificationSessionHostedRequest<typeof import("../contract/session-request.ts").CI_VERIFICATION_SESSION_REQUEST_SCHEMA>;
  sessionRevision: Digest;
  scopeAuthorizationRevision: Digest;
  sessionProposalDigest: Digest;
  actionPlanClosure: CiVerificationActionPlanClosure;
  testImpactTransitionDigest: Digest;
  reviewBarrier: GitHubReviewBarrierObservation;
  facts: VerificationSessionHostedFacts | null;
}> {
  const candidate = input.candidate;
  if (input.executionEnvironment === undefined) {
    throw new Error('VerificationSession preparation requires an explicit execution environment.');
  }
  const executionEnvironment = input.executionEnvironment.kind === 'hosted'
    ? parseCiVerificationHostedExecutionEnvironment(input.executionEnvironment)
    : input.executionEnvironment;
  const providerRevision = executionEnvironment.executionEnvironmentRevision;
  const transition = bindVerificationSessionTestImpactTransition({
    baseSha: candidate.baseSha,
    headSha: candidate.headSha,
    changedPaths: input.changedPaths,
    transition: input.testImpactTransition
  });
  const environmentDigest = verificationSessionDataDigest(Object.freeze({ schema: executionEnvironment.kind === 'hosted'
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
    transition.observation,
    input.sourceProgramTransition
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
    expiresAt: new Date(new Date(input.observedAt).getTime() + 600_000).toISOString(),
    checks: input.mainHealthChecks
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
    semanticInputDigest: verificationSessionDataDigest(semanticRequest) });
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
          sourceDigest: verificationSessionDataDigest({ requestOperationId, proposalDigest })
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
  request: VerificationSessionHostedRequest<typeof import("../contract/session-request.ts").CI_VERIFICATION_SESSION_REQUEST_SCHEMA>;
  envelope: VerificationSessionHostedEnvelope<typeof VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA>;
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

export function assertCandidateCurrent(candidate: GitHubCandidateObservation, session: VerificationSession): void {
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

export function createVerificationSessionHostedRequest(input: {
  session: VerificationSession;
  scope: ScopeAuthorization;
  testImpactTransitionDigest: Digest;
}): VerificationSessionHostedRequest<typeof import("../contract/session-request.ts").CI_VERIFICATION_SESSION_REQUEST_SCHEMA> {
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
    semanticInputDigest: verificationSessionDataDigest(semanticRequest)
  });
  return Object.freeze({ ...semanticRequest, requestOperationId });
}

export function createVerificationSessionLocalPreparationRequest(
  request: VerificationSessionHostedRequest<typeof import("../contract/session-request.ts").CI_VERIFICATION_SESSION_REQUEST_SCHEMA>
): VerificationSessionLocalPreparationRequest {
  return Object.freeze({
    schema: CI_VERIFICATION_SESSION_LOCAL_PREPARATION_SCHEMA,
    executionPlacement: 'local',
    authorityStage: 'preparation-only',
    request: parseVerificationSessionHostedRequest(JSON.stringify(request))
  });
}

/** Decode once at the local entry; the saved input grants no execution authority. */
export function parseVerificationSessionLocalPreparationRequest(
  source: string
): VerificationSessionLocalPreparationRequest {
  const value: unknown = JSON.parse(source);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Local preparation request must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'authorityStage,executionPlacement,request,schema'
      || record.schema !== CI_VERIFICATION_SESSION_LOCAL_PREPARATION_SCHEMA
      || record.executionPlacement !== 'local' || record.authorityStage !== 'preparation-only') {
    throw new Error('Local preparation request requires the exact local preparation-only envelope.');
  }
  return createVerificationSessionLocalPreparationRequest(
    parseVerificationSessionHostedRequest(JSON.stringify(record.request))
  );
}

/** Re-preparation binds the actual environment into Session and Action identities.
 * Compare every saved pin before invoking any SourceTransition execution. */
export function assertVerificationSessionLocalPreparationCurrent(
  saved: VerificationSessionLocalPreparationRequest,
  current: VerificationSessionHostedRequest<typeof import("../contract/session-request.ts").CI_VERIFICATION_SESSION_REQUEST_SCHEMA>
): void {
  const parsed = parseVerificationSessionLocalPreparationRequest(JSON.stringify(saved));
  const prepared = parseVerificationSessionHostedRequest(JSON.stringify(current));
  if (encodeVerificationActionData(parsed.request) !== encodeVerificationActionData(prepared)) {
    throw new Error('Local preparation request differs from current exact candidate, Session or Action environment. Prepare again.');
  }
}



export function prepareVerificationSessionHosted(input: {
  request: VerificationSessionHostedRequest<typeof import("../contract/session-request.ts").CI_VERIFICATION_SESSION_REQUEST_SCHEMA>;
  facts: VerificationSessionHostedFacts;
  now?: string;
}): VerificationSessionHostedEnvelope<typeof VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA> {
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
  return Object.freeze({ ...withoutDigest, envelopeDigest: verificationSessionDataDigest(withoutDigest) });
}

function assertSourceProgramTransitionQualified(input: Readonly<{
  actionPlan: CiVerificationActionPlanClosure;
  evidence: VerificationEvidence<typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult>;
  sessionRevision: string;
  qualification?: SourceProgramTransitionQualification;
}>): void {
  const selected = input.actionPlan.actions.filter(
    ({ action }) => action.operation.identity === SOURCE_PROGRAM_TRANSITION_GATE_ID);
  if (selected.length === 0) {
    if (input.qualification !== undefined) throw new Error('Unselected Source Program transition cannot qualify this Session.');
    return;
  }
  if (selected.length !== 1 || input.qualification === undefined) {
    throw new Error('Conditional Source Program completion requires live host qualification before Session acceptance.');
  }
  assertSourceProgramTransitionQualification(input.qualification);
  const completion = input.evidence.gates.find(({ action }) => action.actionKey === selected[0]!.action.actionKey);
  if (completion !== undefined) assertSourceProgramTransitionQualification(input.qualification, completion);
  if (input.qualification.actionKey !== selected[0]!.action.actionKey
      || input.qualification.sessionRevision !== input.sessionRevision
      || completion?.result.status !== 'passed' || completion.result.evidenceRefs.length !== 1
      || completion.result.evidenceRefs[0] !== (input.qualification.origin === 'first-qualified'
        ? input.qualification.sourceActionOutputDigest : input.qualification.predecessorActionOutputDigest)) {
    throw new Error('Source Program qualification belongs to another Action or Session.');
  }
}

export function finalizeVerificationSessionHostedArtifact(input: {
  envelope: VerificationSessionHostedEnvelope<typeof VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA>;
  evidence: VerificationEvidence<typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult>;
  sourceProgramTransitionQualification?: SourceProgramTransitionQualification;
}): VerificationSessionArtifact<SourceProgramTransitionAcceptanceRecord, TrustedRuntimeSourceProgramAttemptEvidence, typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult> {
  const envelope = input.envelope;
  assertSourceProgramTransitionQualified({ actionPlan: envelope.actionPlanClosure, evidence: input.evidence,
    sessionRevision: envelope.session.sessionRevision, qualification: input.sourceProgramTransitionQualification });
  const { envelopeDigest, ...withoutDigest } = envelope;
  if (envelope.schema !== VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA || verificationSessionDataDigest(withoutDigest) !== envelopeDigest) {
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
    producer: input.evidence.producer,
    ...(input.sourceProgramTransitionQualification === undefined ? {} : {
      sourceProgramTransitionAcceptance: input.sourceProgramTransitionQualification,
      sourceProgramTransitionEvidence: sourceProgramTransitionEvidenceForQualification(input.sourceProgramTransitionQualification)
    })
  });
}

/** Constructs historical data; native intake must authenticate the complete cause. */
export function finalizeHostedSessionResumeArtifact(input: Parameters<typeof finalizeVerificationSessionHostedArtifact>[0] &
  Readonly<{ signal: HostedResumeSignal<typeof HOSTED_RESUME_SIGNAL_SCHEMA> }>) {
  const signal = parseHostedResumeDispatchSignal(encodeVerificationActionData(input.signal));
  const direct = finalizeVerificationSessionHostedArtifact(input);
  const { schema, artifactDigest, ...fields } = direct;
  return finalizeVerificationSessionResumeArtifact({ ...fields, sourceCause: Object.freeze({
    kind: 'hosted-action-resume' as const, signal,
    actionPlanClosureDigest: input.envelope.actionPlanClosure.actionPlanDigest,
    requestOperationId: input.envelope.requestOperationId,
    scopeAuthorizationDigest: input.envelope.scopeAuthorization.authorizationDigest,
    sessionRevision: input.envelope.session.sessionRevision
  }) });
}

export function refreshVerificationSessionHostedArtifact(input: {
  envelope: VerificationSessionHostedEnvelope<typeof VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA>;
  previousArtifact: VerificationSessionArtifact<SourceProgramTransitionAcceptanceRecord, TrustedRuntimeSourceProgramAttemptEvidence, typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult>;
  producer: VerificationEvidenceProducer;
  refreshedAt: string;
  sourceProgramTransitionQualification?: SourceProgramTransitionQualification;
}): VerificationSessionArtifact<SourceProgramTransitionAcceptanceRecord, TrustedRuntimeSourceProgramAttemptEvidence, typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult> {
  assertSourceProgramTransitionQualified({ actionPlan: input.envelope.actionPlanClosure, evidence: input.previousArtifact.evidence,
    sessionRevision: input.envelope.session.sessionRevision, qualification: input.sourceProgramTransitionQualification });
  const { envelopeDigest, ...withoutDigest } = input.envelope;
  if (input.envelope.schema !== VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA
    || verificationSessionDataDigest(withoutDigest) !== envelopeDigest) {
    throw new Error('prepare-hosted refresh envelope digest mismatch.');
  }
  return CodexDevelopmentRefreshVerificationSessionArtifact({
    previousArtifact: input.previousArtifact,
    scopeAuthorization: input.envelope.scopeAuthorization,
    session: input.envelope.session,
    preGateReview: input.envelope.preGateReview,
    mainHealth: input.envelope.mainHealth,
    producer: input.producer,
    ...(input.sourceProgramTransitionQualification === undefined ? {} : {
      sourceProgramTransitionAcceptance: input.sourceProgramTransitionQualification,
      sourceProgramTransitionEvidence: sourceProgramTransitionEvidenceForQualification(input.sourceProgramTransitionQualification)
    }),
    refreshedAt: input.refreshedAt
  });
}

export function assertArtifactProvenance(
  artifact: HostedSessionTerminalArtifact<SourceProgramTransitionAcceptanceRecord, TrustedRuntimeSourceProgramAttemptEvidence, typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult, typeof HOSTED_RESUME_SIGNAL_SCHEMA>,
  provenance: TrustedArtifactProvenance,
  session: VerificationSession
): void {
  assertHostedSessionTerminalArtifact(artifact);
  const producer = artifact.producer;
  const checks: readonly [unknown, unknown, string][] = [
    [provenance.canonicalByteDigest, verificationSessionDataDigest(artifact), 'canonical artifact bytes'],
    [provenance.artifactDigest, artifact.artifactDigest, 'artifact digest'],
    [provenance.transport.workflowPath, producer.workflowPath, 'workflow path'],
    [provenance.transport.workflowRef, producer.workflowRef, 'workflow ref'],
    [provenance.transport.workflowSha, producer.workflowSha, 'workflow sha']
  ];
  for (const [actual, expected, label] of checks) {
    if (actual !== expected) throw new Error(`Hosted artifact ${label} provenance mismatch.`);
  }
  // Direct human terminals keep the original maintain/admin transport rule.
  // A delegated bot terminal keeps its actual 'none' permission; its provenance
  // is constructible only by the qualified creator, which re-authenticates the
  // fresh borrowed historical source under the human Scope cause before intake.
  const transportPermissionAccepted = artifact.schema === 'verification-session-delegated-terminal'
    ? provenance.transport.actorPermission === 'none'
    : provenance.transport.actorPermission === 'admin' || provenance.transport.actorPermission === 'maintain';
  if (
    !transportPermissionAccepted
    || provenance.artifactId.length === 0
    || provenance.artifactName !== `sec-verification-session-v2-pr-${session.prNumber}-session-${session.sessionRevision.slice(7)}-run-${provenance.transport.runId}-attempt-${provenance.transport.runAttempt}`
    || provenance.downloadTransport !== 'github-actions-artifact-api'
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
  artifact: HostedSessionTerminalArtifact<SourceProgramTransitionAcceptanceRecord, TrustedRuntimeSourceProgramAttemptEvidence, typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult, typeof HOSTED_RESUME_SIGNAL_SCHEMA>;
  preMergeReview: ReviewStabilityReceipt;
  platform: PlatformEnforcementObservation;
  candidate: CodexDevelopmentMergeGateCandidate;
  hostedArtifactOrigin: HostedArtifactObservation;
  hostedArtifactTransport: HostedArtifactObservation;
  provenance: Omit<MergeGateProvenance, 'sourceDigest'>;
  mainHealth: MainHealthLedger;
  consumptionOperationId: Digest;
  issuedAt: string;
  expiresAt: string;
}): CodexDevelopmentMergeGateInput {
  if (input.platform.status === 'unknown') throw new Error('Unknown platform enforcement blocks merge input.');
  assertHostedSessionTerminalArtifact(input.artifact);
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
  artifact: VerificationSessionArtifact<SourceProgramTransitionAcceptanceRecord, TrustedRuntimeSourceProgramAttemptEvidence, typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult>;
  preMergeReview: ReviewStabilityReceipt;
  platform: PlatformEnforcementObservation;
  candidate: CodexDevelopmentMergeGateCandidate;
  artifactObservation: CodexDevelopmentTrustedRuntimeArtifactObservation;
  provenance: Omit<CodexDevelopmentTrustedRuntimeMergeGateProvenance, 'sourceDigest'>;
  mainHealth: MainHealthLedger;
  consumptionOperationId: Digest;
  issuedAt: string;
  expiresAt: string;
  sourceProgramTransitionQualification?: SourceProgramTransitionQualification;
}): CodexDevelopmentTrustedRuntimeMergeGateInput {
  assertSourceProgramTransitionQualified({ actionPlan: input.artifact.evidence.actionPlan, evidence: input.artifact.evidence,
    sessionRevision: input.artifact.session.sessionRevision, qualification: input.sourceProgramTransitionQualification });
  if (input.artifact.sourceProgramTransitionAcceptance?.qualificationDigest
      !== input.sourceProgramTransitionQualification?.qualificationDigest) {
    throw new Error('Accepted artifact does not identify the current live Source Program adoption attempt.');
  }
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

export function verifyIntegrationArtifact(input: {
  source: TrustedIntegrationAuthorizationSource;
  result: MergeGateResult;
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
    || artifact.canonicalByteDigest !== verificationSessionDataDigest(result)
    || artifact.workflowPath !== provenance.workflowPath || artifact.workflowRef !== provenance.workflowRef
    || artifact.workflowSha !== provenance.workflowSha || artifact.runId !== provenance.sourceRunId
    || artifact.runAttempt !== provenance.sourceRunAttempt || artifact.eventName !== provenance.eventName
    || artifact.actorNodeId !== CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.nodeId
    || artifact.actorPermission !== 'none'
    || artifact.downloadTransport !== 'github-actions-artifact-api')
    || provenance.workflowSha !== session.trustRevision
    || provenance.workflowRef !== `.github/workflows/merge-gate.yml@${session.trustRevision}`
    || authorization.issuer.producerIdentity !== CodexDevelopmentMergeGateProducerIdentity
    || authorization.issuer.sourceTransport !== 'github-actions'
    || authorization.issuer.trustedRevision !== session.trustRevision
    || authorization.issuer.sourceRef !== `.github/workflows/merge-gate.yml@${session.trustRevision}`
    || authorization.issuer.sourceDigest !== provenance.sourceDigest
  ) {
    throw new Error('IntegrationAuthorization trusted workflow/artifact provenance mismatch.');
  }
}
