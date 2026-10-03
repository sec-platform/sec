/** Canonical pure integration contracts. Native schemas,
 * parsers, retained issuers and physical effects remain with their owners. */
import type { HostedWorkflowCommentProvenance, PreparedBranchCloseoutEnvelope } from './branch-closeout.ts';
import type { GitHubCandidateObservation, MainHealthLedger, ReviewStabilityReceipt } from './session.ts';

export interface MergeGateResult {
  readonly schema: "codex-development-merge-gate-result-v2";
  readonly status: 'authorized';
  readonly authorization: IntegrationAuthorization;
  readonly reviewReceipt: ReviewStabilityReceipt;
  readonly mainHealth: MainHealthLedger;
  readonly platformObservation: MergeGatePlatformObservation;
  readonly hostedArtifactOrigin: HostedArtifactObservation;
  readonly hostedArtifactTransport: HostedArtifactObservation;
  readonly provenance: MergeGateProvenance;
  readonly terminalStatusContext: "sec/integration-authorization";
  readonly resultDigest: MergeGateDigest;
}

export interface MergeGatePlatformObservation {
  readonly status: 'available' | 'platform-enforcement-unavailable';
  readonly rulesetDigest: MergeGateDigest;
  readonly reason: string | null;
}

export type MergeGateDigest = `sha256:${string}`;

export interface HostedArtifactObservation {
  readonly artifactId: string;
  readonly artifactName: string;
  readonly artifactFileName: 'verification-session-artifact.json';
  readonly artifactByteDigest: MergeGateDigest;
  readonly artifactByteLength: number;
  readonly artifactExpired: false;
  readonly workflowPath: '.github/workflows/compiler-pr-validation.yml';
  readonly workflowRef: string;
  readonly workflowSha: string;
  readonly runId: string;
  readonly runAttempt: number;
  readonly eventName: 'repository_dispatch';
  readonly actorNodeId: string;
  readonly actorPermission: 'maintain' | 'admin';
  readonly downloadTransport: 'github-actions-artifact-api';
}

export interface MergeGateProvenance {
  readonly workflowPath: '.github/workflows/merge-gate.yml';
  readonly workflowRef: string;
  readonly workflowSha: string;
  readonly eventName: 'workflow_run';
  readonly sourceRunId: string;
  readonly sourceRunAttempt: number;
  readonly actorNodeId: string;
  readonly actorPermission: 'maintain' | 'admin';
  readonly sourceDigest: MergeGateDigest;
}

export interface IntegrationAuthorization {
  readonly schema: "sec-integration-authorization-v1";
  readonly authorizationId: string;
  readonly consumptionOperationId: string;
  readonly repository: string;
  readonly prNumber: number;
  readonly sessionRevision: IntegrationAuthorizationDigest;
  readonly baseSha: string;
  readonly baseTreeSha: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly manifestDigest: IntegrationAuthorizationDigest;
  readonly scopeAuthorizationRevision: IntegrationAuthorizationDigest;
  readonly scopeAuthorizationReceiptDigest: IntegrationAuthorizationDigest;
  readonly actionClosureDigest: IntegrationAuthorizationDigest;
  readonly evidenceDigest: IntegrationAuthorizationDigest;
  readonly reviewRevision: IntegrationAuthorizationDigest;
  readonly reviewReceiptDigest: IntegrationAuthorizationDigest;
  readonly mainHealthRevision: IntegrationAuthorizationDigest;
  readonly mainHealthReceiptDigest: IntegrationAuthorizationDigest;
  readonly trustRevision: string;
  readonly rulesetDigest: IntegrationAuthorizationDigest;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly issuer: IntegrationAuthorizationIssuer;
  readonly receiptDigest: IntegrationAuthorizationDigest;
}

export type IntegrationAuthorizationDigest = `sha256:${string}`;

export interface IntegrationAuthorizationIssuer {
  readonly principalId: string;
  readonly producerIdentity: string;
  readonly trustedRevision: string;
  readonly sourceTransport: 'trusted-integration-runtime' | 'github-actions';
  readonly sourceRunId: string;
  readonly sourceRef: string;
  readonly sourceDigest: IntegrationAuthorizationDigest;
}

export interface IntegrationAuthorizationOperationPublication {
  schema: "sec-integration-authorization-operation-publication-v1";
  repository: string;
  pullRequestNumber: number;
  sessionRevision: `sha256:${string}`;
  authorizationId: string;
  authorizationPublicationId: `sha256:${string}`;
  authorizationReceiptDigest: `sha256:${string}`;
  consumptionOperationId: `sha256:${string}`;
  result: MergeGateResult;
  closeoutPreparation: PreparedBranchCloseoutEnvelope;
  recoveryArtifact: IntegrationCloseoutRecoveryArtifactObservation;
  provenance: HostedWorkflowCommentProvenance;
  publicationDigest: `sha256:${string}`;
}

export interface IntegrationCloseoutRecoveryArtifactObservation {
  artifactId: string;
  artifactName: string;
  artifactFileName: 'branch-closeout-recovery.json';
  artifactDigest: `sha256:${string}`;
  runId: string;
  runAttempt: number;
}

export interface HostedIntegrationPhaseOwnership {
  runId: string;
  runAttempt: number;
  jobId: string;
  jobName: string;
  phase: HostedIntegrationPhase;
  stepName: string;
  stepNumber: number;
  priorAttemptStarted: boolean;
  priorEffectStarted: boolean;
  priorEffectPhases: readonly HostedIntegrationPhase[];
}

export type HostedIntegrationPhase = "recoveryPreparation" | "integration" | "closeoutMutation" | "closeoutPublication";

export interface IssueDispositionPlan {
  readonly schema: "sec-issue-disposition-plan-v1";
  readonly policyRevision: "issue-disposition-policy-v1";
  readonly repository: string;
  readonly prNumber: number;
  readonly manifestPath: string;
  readonly manifestDigest: IssueDispositionDigest;
  readonly trackingIssueNumber: number | null;
  readonly mode: IssueDispositionMode;
  readonly titleBodyDigest: IssueDispositionDigest;
  readonly linkedClosingIssues: readonly GitHubIssueReference[];
  readonly planDigest: IssueDispositionDigest;
}

export type IssueDispositionDigest = `sha256:${string}`;

export type IssueDispositionMode = 'progress-only' | 'close-tracking-after-readback';

export interface GitHubIssueReference {
  readonly repository: string;
  readonly issueNumber: number;
}

export interface IssueDisposition {
  readonly schema: "sec-issue-disposition-v1";
  readonly dispositionId: IssueDispositionDigest;
  readonly operationId: IssueDispositionDigest;
  readonly planDigest: IssueDispositionDigest;
  readonly planMode: IssueDispositionMode;
  readonly repository: string;
  readonly prNumber: number;
  readonly issueNumber: number | null;
  readonly manifestPath: string;
  readonly manifestDigest: IssueDispositionDigest;
  readonly currentSpecRevision: IssueDispositionDigest;
  readonly acceptanceIds: readonly IssueDispositionDigest[];
  readonly newMainSha: string;
  readonly newMainTreeSha: string;
  readonly evidenceRefs: readonly IssueDispositionDigest[];
  readonly completionAssessment: 'unavailable';
  readonly completionAssessmentReason: 'trusted-post-main-closure-assessment-unavailable';
  readonly providerMutationCapability: 'unsupported-no-conditional-write';
  readonly expectedProviderState: 'OPEN' | 'CLOSED';
  readonly kind: IssueDispositionKind;
  readonly blockers: readonly string[];
  readonly receiptDigest: IssueDispositionDigest;
}

export type IssueDispositionKind = 'progressed';

export type HostedIntegrationRoute =
  | (HostedIntegrationRouteCommon & Readonly<{
      lane: 'open-first-effect';
      reason: 'exact-open-candidate-without-prior-effect';
    }>)
  | (HostedIntegrationRouteCommon & Readonly<{
      lane: 'merged-recovery';
      reason: 'exact-marker-bound-merged-candidate';
      mergeCommitSha: string;
      mergeCommitTreeSha: string;
    }>)
  | (HostedIntegrationRouteCommon & Readonly<{
      lane: 'blocked';
      reason:
        | 'candidate-session-identity-drift'
        | 'open-candidate-identity-drift'
        | 'open-prior-effect-started'
        | 'merged-readback-incomplete-or-tree-mismatch'
        | 'pull-request-closed-without-exact-merge';
    }>);

export type HostedIntegrationRouteCommon = Readonly<{
  schema: "sec-verification-session-hosted-integration-route-v1";
  repository: string;
  prNumber: number;
  sessionRevision: `sha256:${string}`;
  candidateState: GitHubCandidateObservation['state'];
}>;

export interface HostedIntegrationEffectPlan {
  prepareRecoveryArtifact: boolean;
  createAuthorizationPublication: boolean;
  executePhysicalMerge: boolean;
  consumeOriginalAuthorizationPublication: boolean;
  consumeOriginalRecoveryArtifact: boolean;
}
