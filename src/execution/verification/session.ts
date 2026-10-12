/** Canonical pure verification session contracts. Native schemas,
 * parsers, retained issuers and physical effects remain with their owners. */
import type { CiVerificationActionPlanClosure, VerificationActionKey } from './action.ts';

export type VerificationSessionArtifact<SourceProgramAcceptance, SourceProgramAttemptEvidence, ContractRevision extends string, ResultStatus extends string, GateResult extends { readonly status: ResultStatus }> = Readonly<{
  schema: "sec-verification-session-artifact-v2";
  scopeAuthorization: ScopeAuthorization;
  session: VerificationSession;
  preGateReview: ReviewStabilityReceipt;
  mainHealth: MainHealthLedger;
  evidence: VerificationEvidence<ContractRevision, ResultStatus, GateResult>;
  producer: VerificationEvidenceProducer;
  sourceProgramTransitionAcceptance?: SourceProgramAcceptance;
  sourceProgramTransitionEvidence?: SourceProgramAttemptEvidence;
  artifactDigest: string;
}>;

export type VerificationEvidence<ContractRevision extends string, ResultStatus extends string, GateResult extends { readonly status: ResultStatus }> = Readonly<{
  schema: "codex-development-verification-evidence-v4";
  contractRevision: ContractRevision;
  sessionRevision: string;
  sessionProposalDigest: string;
  scopeAuthorizationRevision: string;
  scopeAuthorizationDigest: string;
  reviewReceiptDigest: string;
  mainHealthRevision: string;
  mainHealthDigest: string;
  trustRevision: string;
  profile: 'quick' | 'full';
  baseSha: string;
  baseTreeSha: string;
  headSha: string;
  headTreeSha: string;
  manifestPath: string;
  manifestDigest: string;
  producer: VerificationEvidenceProducer;
  actionPlan: CiVerificationActionPlanClosure;
  status: ResultStatus;
  startedAt: string;
  finishedAt: string;
  gates: readonly VerificationGateEvidence<GateResult>[];
  evidenceRefs: readonly string[];
  invalidationRules: readonly string[];
  evidenceDigest: string;
}>;

export type VerificationEvidenceProducer = Readonly<{
  sourceTransport: 'github-actions' | 'local-dev-runner';
  workflowPath: string;
  workflowRef: string;
  workflowSha: string;
  runId: string;
  runAttempt: number;
  actorNodeId: string;
  sourceDigest: string;
}>;

export type VerificationGateEvidence<GateResult> = Readonly<{
  action: VerificationActionKey;
  result: GateResult;
  cleanup: VerificationCleanup;
}>;

export type VerificationCleanup = Readonly<{
  status: 'passed' | 'failed' | 'not-required';
  evidenceRefs: readonly string[];
  diagnostic: string | null;
}>;

export interface ScopeAuthorization {
  readonly schema: "sec-scope-authorization-v1";
  readonly repository: string;
  readonly prNumber: number;
  readonly baseSha: string;
  readonly baseTreeSha: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly manifestPath: string;
  readonly manifestDigest: ScopeAuthorizationDigest;
  /** Digest of the immutable proposal before trusted-base authorization. */
  readonly proposalDigest: ScopeAuthorizationDigest;
  readonly authorizedPaths: readonly string[];
  /** Full downstream session proposal coherence; excluded from authorizationRevision. */
  readonly sessionProposalDigest: ScopeAuthorizationDigest;
  readonly actionPlanClosureDigest: ScopeAuthorizationDigest;
  readonly profile: string;
  readonly environmentDigest: ScopeAuthorizationDigest;
  readonly issuer: ScopeAuthorizationIssuer;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly authorizationRevision: ScopeAuthorizationDigest;
  readonly authorizationDigest: ScopeAuthorizationDigest;
}

export type ScopeAuthorizationDigest = `sha256:${string}`;

export interface ScopeAuthorizationIssuer {
  readonly principalId: string;
  readonly role: 'trusted-base-a0';
  readonly trustRevision: string;
  readonly producerIdentity: string;
  readonly sourceTransport: 'trusted-base' | 'github-actions';
  readonly sourceRunId: string;
  readonly sourceRef: string;
  readonly sourceDigest: ScopeAuthorizationDigest;
}

export interface VerificationSession {
  readonly schema: "sec-verification-session-v2";
  /** Run identity only; excluded from sessionRevision. */
  readonly sessionId: string;
  /** Run timestamp only; excluded from sessionRevision. */
  readonly createdAt: string;
  readonly repository: string;
  readonly prNumber: number;
  readonly baseSha: string;
  readonly baseTreeSha: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly manifestPath: string;
  readonly manifestDigest: `sha256:${string}`;
  readonly sessionProposalDigest: `sha256:${string}`;
  readonly scopeAuthorizationRevision: `sha256:${string}`;
  /** Full provenance receipt reference; excluded from stable sessionRevision. */
  readonly scopeAuthorizationReceiptDigest: `sha256:${string}`;
  readonly actionPlanClosureDigest: `sha256:${string}`;
  readonly profile: string;
  readonly environmentDigest: `sha256:${string}`;
  readonly trustRevision: string;
  readonly reviewPolicyDigest: `sha256:${string}`;
  readonly evidenceRequirementDigest: `sha256:${string}`;
  readonly integrationPolicyDigest: `sha256:${string}`;
  readonly mainHealthRef: VerificationSessionMainHealthRef;
  readonly sessionRevision: `sha256:${string}`;
}

export interface VerificationSessionMainHealthRef {
  readonly mainSha: string;
  readonly mainTreeSha: string;
  readonly healthRevision: `sha256:${string}`;
  /** Full observation receipt reference; excluded from stable sessionRevision. */
  readonly ledgerReceiptDigest: `sha256:${string}`;
}

export interface ReviewStabilityReceipt {
  readonly schema: "sec-review-stability-receipt-v1";
  readonly stage: ReviewStabilityStage;
  readonly repository: string;
  readonly prNumber: number;
  readonly sessionRevision: ReviewStabilityDigest;
  readonly scopeAuthorizationRevision: ReviewStabilityDigest;
  readonly scopeAuthorizationReceiptDigest: ReviewStabilityDigest;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly policy: ReviewStabilityPolicy;
  readonly principal: ReviewPrincipal;
  readonly independence: ReviewIndependence;
  readonly producer: ReviewStabilityProducer;
  readonly snapshot: ReviewSnapshot;
  readonly reviewedAt: string;
  readonly expiresAt: string;
  readonly reviewRevision: ReviewStabilityDigest;
  readonly receiptDigest: ReviewStabilityDigest;
}

export type ReviewStabilityStage = 'pre-expensive' | 'pre-merge';

export type ReviewStabilityDigest = `sha256:${string}`;

export interface ReviewStabilityPolicy {
  readonly schema: "sec-review-stability-policy-v1";
  readonly policyId: string;
  readonly trustedRevision: string;
  readonly trustedApps: readonly ReviewStabilityTrustedApp[];
  readonly allowIndependentHumanApproval: boolean;
  readonly policyDigest: ReviewStabilityDigest;
}

export interface ReviewStabilityTrustedApp {
  readonly actorNodeId: string;
  readonly appId: number;
  readonly appNodeId: string;
  readonly appSlug: string;
}

export type ReviewPrincipal = Readonly<{
  kind: 'human'; nodeId: string; approvalState: 'APPROVED';
}> | Readonly<{
  kind: 'github-app'; actorNodeId: string; appId: number; appNodeId: string; appSlug: string;
  reviewState: 'APPROVED' | 'COMMENTED';
}>;

export interface ReviewIndependence {
  readonly candidateAuthorNodeId: string;
  readonly integrationPrincipalNodeId: string;
}

export interface ReviewStabilityProducer {
  readonly identity: string;
  readonly executionIdentity: string;
  readonly providerIdentity: 'github';
  readonly candidateWriteCapability: 'read-only';
  readonly capabilityReceiptDigest: ReviewStabilityDigest;
  readonly trustedRevision: string;
  readonly sourceTransport: 'github-graphql' | 'github-rest';
  readonly sourceRunId: string;
  readonly sourceRef: string;
  readonly sourceDigest: ReviewStabilityDigest;
}

export interface ReviewSnapshot {
  readonly paginationComplete: true;
  readonly reviewedHeadSha: string;
  readonly reviewPageDigests: readonly ReviewStabilityDigest[];
  readonly threadPageDigests: readonly ReviewStabilityDigest[];
  readonly reviewCount: number;
  readonly threadCount: number;
  readonly unresolvedBlockingThreadCount: 0;
  readonly requestChangesPrincipalIds: readonly [];
  readonly snapshotDigest: ReviewStabilityDigest;
}

export interface MainHealthLedger {
  readonly schema: "sec-main-health-ledger-v1";
  readonly repository: string;
  readonly defaultBranch: string;
  readonly mainSha: string;
  readonly mainTreeSha: string;
  readonly status: MainHealthStatus;
  readonly failureFingerprints: readonly MainHealthDigest[];
  readonly owner: string | null;
  readonly repairWorkPackage: string | null;
  readonly expiresAt: string;
  /**
   * Semantic routing eligibility for this exact ledger. This field is not a
   * physical executor, frozen Work Package, Scope authorization, or merge
   * authority. Every effectful consumer must independently prove those
   * capabilities before it can act on an eligible lane.
   */
  readonly allowedLanes: readonly MainHealthLane[];
  readonly trustRevision: string;
  readonly observedAt: string;
  readonly producer: MainHealthProducer;
  readonly healthRevision: MainHealthDigest;
  readonly ledgerDigest: MainHealthDigest;
}

export type MainHealthStatus = 'healthy' | 'degraded' | 'locked';

export type MainHealthDigest = `sha256:${string}`;

export type MainHealthLane = 'ordinary' | 'repair';

export interface MainHealthProducer {
  readonly identity: string;
  readonly trustRevision: string;
  // Durable transport remains decodable for historical ledgers only. New
  // local observations borrow the physical producer's live receipt scope.
  readonly sourceTransport: 'github-api' | 'trusted-runtime-durable-readback'
    | 'trusted-runtime-live-readback';
  readonly sourceRunId: string;
  readonly sourceRef: string;
  readonly sourceDigest: MainHealthDigest;
}

export interface GitHubCandidateObservation {
  repository: string;
  number: number;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  isDraft: boolean;
  isCrossRepository: boolean;
  authorNodeId: string;
  baseBranch: string;
  baseSha: string;
  baseTreeSha: string;
  headBranch: string;
  headSha: string;
  headTreeSha: string;
  title: string;
  body: string;
  mergeCommitSha: string | null;
  mergeCommitTreeSha: string | null;
  mergeCommitMessage: string | null;
  mergeCommitParentShas: readonly string[] | null;
}

export interface GitHubActionsArtifactObservation {
  artifactId: string;
  artifactName: string;
  /** Provider-supplied digest of the immutable artifact archive, when available. */
  archiveDigest: SessionDigest | null;
  /** Provider timestamps are required by consumers that bind a producer window. */
  createdAt?: string;
  updatedAt?: string;
  workflowPath: string;
  workflowRef: string;
  workflowSha: string;
  runId: string;
  runAttempt: number;
  eventName: string;
  actorNodeId: string;
  actorPermission: 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none';
  expired: boolean;
}

export type GitHubReviewBarrierObservation = Readonly<{
  status: 'clear';
  principal: ReviewPrincipal;
  snapshot: ReviewSnapshot;
  authority: Readonly<{
    sourceTransport: 'github-graphql' | 'github-rest';
    sourceDigest: SessionDigest;
    executionIdentity: string;
    providerIdentity: 'github';
    candidateWriteCapability: 'read-only';
    capabilityReceiptDigest: SessionDigest;
  }>;
  observedAt: string;
}> | Readonly<{
  status: 'waiting' | 'blocked';
  reason: string;
  snapshotDigest: SessionDigest;
  observedAt: string;
}> | Readonly<{
  status: 'provider-schema-unsupported';
  reasonCode: string;
  responseDigest: SessionDigest;
  observedAt: string;
}>;

export interface GitHubComparisonObservation {
  status: 'ahead' | 'behind' | 'diverged' | 'identical';
  behindBy: number;
}

export interface PlatformEnforcementObservation {
  status: 'available' | 'platform-enforcement-unavailable' | 'unknown';
  rulesetDigest: SessionDigest;
  reason: string | null;
}

export interface GitHubCheckObservation {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  headSha: string;
  detailsUrl: string | null;
  appId: number | null;
  appNodeId: string | null;
  appSlug: string | null;
  workflowPath: string | null;
  workflowRef: string | null;
  eventName: string | null;
  workflowRunId: string | null;
  workflowRunDisplayTitle: string | null;
}

export interface GitHubWorkflowRunObservation {
  id: string;
  name: string;
  displayTitle: string;
  workflowPath: string;
  event: string;
  status: string;
  conclusion: string | null;
  headSha: string;
  runAttempt: number;
  updatedAt: string;
}

export type SessionDigest = `sha256:${string}`;

export interface TrustedRuntimeProof {
  currentHeadSha: string;
  currentBranch: string;
  localDefaultSha: string;
  remoteDefaultSha: string;
  workingTreeClean: boolean;
  runtimeEntrypointBlobMatched: boolean;
  boundaryTargetsMatched: boolean;
}

export type Digest = `sha256:${string}`;

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
