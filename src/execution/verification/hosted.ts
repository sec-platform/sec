import type { CiVerificationActionPlanClosure, VerificationActionKeyDigest, VerificationActionPlan } from './action.ts';
import type { BranchCloseoutEffectStartPublication, BranchCloseoutOperationPublication, BranchCloseoutRecoveryArtifact, HostedWorkflowCommentProvenance, PreparedBranchCloseoutEnvelope } from './branch-closeout.ts';
import type { HostedArtifactObservation, HostedIntegrationPhaseOwnership, IntegrationAuthorizationOperationPublication, MergeGateProvenance } from './integration.ts';
import type { Digest, GitHubActionsArtifactObservation, GitHubCandidateObservation, GitHubReviewBarrierObservation, MainHealthLedger, ReviewStabilityReceipt, ScopeAuthorization, VerificationSession, VerificationSessionArtifact } from './session.ts';

export interface VerificationSessionHostedEnvelope<EnvelopeSchema extends string> {
  schema: EnvelopeSchema;
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
  scopeIssuer: ScopeAuthorization['issuer'];
  scopeIssuedAt: string;
  scopeExpiresAt: string;
  environmentDigest: Digest;
  actionPlanClosure: CiVerificationActionPlanClosure;
  testImpactTransitionDigest: Digest;
  mainHealth: Omit<MainHealthLedger, 'schema' | 'healthRevision' | 'ledgerDigest'>;
  evidenceRequirementDigest: Digest;
  integrationPolicyDigest: Digest;
  reviewBarrier: Extract<GitHubReviewBarrierObservation, { status: 'clear' }>;
  reviewExpiresAt: string;
  integrationPrincipalNodeId: string;
}

/** Complete original native capture results shared with hosted composition. */
export interface HostedSessionArtifactTransport<SourceAcceptance, SourceAttemptEvidence,
  ContractRevision extends string, ResultStatus extends string,
  GateResult extends { readonly status: ResultStatus }, SignalSchema extends string> {
  readonly artifact: HostedSessionTerminalArtifact<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema>;
  readonly origin: HostedArtifactObservation;
  readonly transport: HostedArtifactObservation;
  readonly originMetadata: GitHubActionsArtifactObservation;
  readonly transportMetadata: GitHubActionsArtifactObservation;
  readonly originText: string;
  readonly transportText: string;
}

export interface HostedSessionArtifactCapture<SourceAcceptance, SourceAttemptEvidence,
  ContractRevision extends string, ResultStatus extends string,
  GateResult extends { readonly status: ResultStatus }, SignalSchema extends string> {
  readonly artifact: HostedSessionTerminalArtifact<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema>;
  readonly artifactText: string;
  readonly metadata: GitHubActionsArtifactObservation;
  readonly observation: HostedArtifactObservation;
}

export interface HostedRecoveryArtifactObservation {
  readonly artifact: BranchCloseoutRecoveryArtifact;
  readonly metadata: GitHubActionsArtifactObservation;
  readonly remotePrepared: PreparedBranchCloseoutEnvelope;
  readonly prepared: PreparedBranchCloseoutEnvelope;
}

export interface HostedRecoveryArtifactMaterialization {
  readonly artifact: HostedRecoveryArtifactObservation['artifact'];
  readonly artifactName: string;
  readonly artifactFilePath: string;
}

export type HostedIntegrationAuthorizationPublicationReadback = Readonly<{
  publication: IntegrationAuthorizationOperationPublication | null;
  commentId: number | null;
  status: 'published' | 'reused' | 'failed';
  /** True only after this invocation receives created bytes and exact provider readback. */
  createdByThisInvocation: boolean;
  detail: string;
}>;

export interface HostedSquashMergeResponse {
  readonly merged: true;
  readonly sha: string;
  readonly message: string;
}

export interface HostedIntegrationIdentity {
  readonly provenance: HostedWorkflowCommentProvenance;
  readonly phase: HostedIntegrationPhaseOwnership;
  readonly integrationPrincipal: Pick<GitHubPrincipalObservation, 'nodeId'> & {
    readonly permission: MergeGateProvenance['actorPermission'];
  };
}

export type HostedCloseoutEffectStartReadback = Readonly<{
  disposition: 'published' | 'existing';
  publication: BranchCloseoutEffectStartPublication;
  commentId: number;
}>;

export type HostedCloseoutTerminalReadback = Readonly<{
  disposition: 'published' | 'reused' | 'recovered';
  publication: BranchCloseoutOperationPublication;
  commentId: number;
}>;

/** Durable Session progression data shared by application and its native journal. */
export const VERIFICATION_SESSION_STAGES = [
  'frozen',
  'actions-terminal',
  'pre-gate-review-clear',
  'hosted-verification-terminal',
  'pre-merge-review-clear',
  'authorized',
  'merge-attempted',
  'merge-readback',
  'tree-parity',
  'closeout-terminal'
] as const;

export type VerificationSessionStage = typeof VERIFICATION_SESSION_STAGES[number];
export type VerificationSessionJournalEventKind = 'completed' | 'waiting' | 'failed' | 'observation';

export interface VerificationSessionJournalEvent<EventSchema extends string> {
  schema: EventSchema;
  sequence: number;
  sessionRevision: `sha256:${string}`;
  targetStage: VerificationSessionStage;
  kind: VerificationSessionJournalEventKind;
  operationId: `sha256:${string}` | null;
  receiptDigest: `sha256:${string}` | null;
  recordedAt: string;
  note: string | null;
  previousDigest: `sha256:${string}` | null;
  eventDigest: `sha256:${string}`;
}

export interface VerificationSessionOperationClaim<ClaimSchema extends string> {
  schema: ClaimSchema;
  sessionRevision: `sha256:${string}`;
  operationId: `sha256:${string}`;
  operationKind: string;
  claimedAt: string;
  claimDigest: `sha256:${string}`;
}

export interface VerificationSessionJournalReadback<EventSchema extends string> {
  filePath: string;
  events: readonly VerificationSessionJournalEvent<EventSchema>[];
  completedStage: VerificationSessionStage | null;
  completedStageIndex: number;
  latestEvent: VerificationSessionJournalEvent<EventSchema> | null;
}

export interface GitHubPrincipalObservation {
  login: string;
  nodeId: string;
  permission: 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none';
}

export interface IntegrationAuthorizationPublicationObservation {
  authorizationId: string;
  authorizationReceiptDigest: `sha256:${string}`;
  consumptionOperationId: `sha256:${string}`;
  authorizationPublicationId: `sha256:${string}`;
  authorizationPublicationDigest: `sha256:${string}`;
  commentId: number;
  preparationDigest: `sha256:${string}`;
}


/** Historical hosted Action data. Schemas and native producer payload types are
 * bound explicitly by their genuine owner; these shapes issue no capability. */
export type HostedSutCommandPlan<
  CommandSchema extends string,
  PolicyDigest extends VerificationActionKeyDigest
> = Readonly<{
  schema: CommandSchema;
  policyDigest: PolicyDigest;
  phase: 'capability-self-test' | 'execute' | 'bootstrap-execute' | 'teardown';
  unitName: string;
  command: '/usr/bin/unshare' | '/usr/bin/bash';
  argv: readonly string[];
  candidateEnvironmentNames: readonly string[];
  executionAuthorizationDigest: VerificationActionKeyDigest | null;
  physicalCommandProjectionDigest: VerificationActionKeyDigest | null;
  planDigest: VerificationActionKeyDigest;
}>;

export type HostedSutProcessObservation<
  ProcessResult extends Readonly<{ code: number; rawOutputDigest: string; stdout?: Uint8Array; failureTail: string }>
> = ProcessResult & Readonly<{
    lifecycle: HostedSutProcessLifecycle;
    stdoutDigest: VerificationActionKeyDigest;
    stderrDigest: VerificationActionKeyDigest;
    stdoutBytesObserved: number;
    stderrBytesObserved: number;
    outputTruncated: boolean;
  }>;

export type HostedActionResolution<
  Environment extends Readonly<{ executionEnvironmentRevision: string }>,
  ResolutionSchema extends string
> = Readonly<{
  schema: ResolutionSchema;
  requestDigest: VerificationActionKeyDigest;
  actionKeyHex: string;
  actionPlan: VerificationActionPlan;
  actionPlanClosure: CiVerificationActionPlanClosure;
  artifactInput: HostedActionArtifactInput;
  executionEnvironment: Environment;
  resolutionDigest: VerificationActionKeyDigest;
}>;

export type HostedActionExecutionTicket<
  Producer extends object,
  TicketSchema extends string
> = Readonly<{
  schema: TicketSchema;
  resolutionDigest: VerificationActionKeyDigest;
  actionKey: VerificationActionKeyDigest;
  candidateSha: string;
  candidateBytesDigest: VerificationActionKeyDigest;
  startStatusId: number;
  startStatusNodeId: string;
  startMarkerDigest: VerificationActionKeyDigest;
  startArtifactOriginId: string;
  startArtifactName: string;
  startArtifactArchiveDigest: VerificationActionKeyDigest;
  preparedCandidateArtifactName: string;
  preparedCandidateArchiveDigest: VerificationActionKeyDigest;
  preparedCandidateInventoryDigest: VerificationActionKeyDigest;
  preparedCandidateEntryCount: number;
  preparedCandidateTotalFileBytes: number;
  baseDependencyClosureDigest: VerificationActionKeyDigest;
  authenticatedGitClosureDigest: VerificationActionKeyDigest;
  producer: Producer;
  ticketDigest: VerificationActionKeyDigest;
}>;

export type HostedSutEnvironmentProjection = readonly Readonly<{
  name: string;
  valueDigest: VerificationActionKeyDigest;
}>[];

export type HostedSutPhysicalCommandAuthorization<
  PhysicalSchema extends string,
  PolicyDigest extends VerificationActionKeyDigest,
  ProviderRevision extends string
> = Readonly<{
  schema: PhysicalSchema;
  actionKey: VerificationActionKeyDigest;
  operationSemanticDigest: VerificationActionKeyDigest;
  unitName: string;
  canonicalArgvDigest: VerificationActionKeyDigest;
  semanticEnvironment: HostedSutEnvironmentProjection;
  fixedSandboxEnvironment: HostedSutEnvironmentProjection;
  sandboxPolicyDigest: PolicyDigest;
  providerRevision: ProviderRevision;
  projectionDigest: VerificationActionKeyDigest;
}>;

export type HostedSutProcessLifecycle = Readonly<{
  supervisorSpawned: boolean | null;
  supervisorClosed: boolean | null;
  supervisorCloseCode: number | null;
  supervisorSignal: string | null;
  namespaceEstablished: boolean | null;
  candidateStarted: boolean | null;
  candidateUnitSettled: boolean | null;
  observationGap: 'unsupported-source' | 'observation-lost' | null;
}>;

export type HostedSutCleanupObservation = Readonly<{
  supervisorSpawned: boolean | null;
  supervisorClosed: boolean | null;
  exitCode: number | null;
  outputDigest: VerificationActionKeyDigest;
}>;

export type HostedSutCapabilityObservation = Readonly<{
  commandPlanDigest: VerificationActionKeyDigest | null;
  lifecycle: HostedSutProcessLifecycle;
  exitCode: number | null;
  markerObserved: boolean;
  outputDigest: VerificationActionKeyDigest;
  cleanup: HostedSutCleanupObservation;
  diagnostic: string | null;
}>;

export type HostedSutSandboxReceipt<
  Policy extends Readonly<{ limits: object; substrate: string; namespaces: readonly string[]; isolatedUid: number; isolatedGid: number; network: string; inputMount: string; workspace: string; outputTransport: string }>,
  PolicyDigest extends VerificationActionKeyDigest,
  ReceiptSchema extends string
> = Readonly<{
  schema: ReceiptSchema;
  policyDigest: PolicyDigest;
  actionKey: VerificationActionKeyDigest;
  capability: HostedSutCapabilityObservation;
  commandPlanDigest: VerificationActionKeyDigest | null;
  resources: Policy["limits"];
  authenticatedArchive: Readonly<{
    archiveDigest: VerificationActionKeyDigest | null;
    inventoryDigest: VerificationActionKeyDigest | null;
    dependencyClosureDigest: VerificationActionKeyDigest | null;
    gitBundleDigest: VerificationActionKeyDigest | null;
    entryCount: number;
    totalFileBytes: number;
  }>;
  rootIsolation: Readonly<{
    substrate: Policy["substrate"];
    namespaces: Policy["namespaces"];
    uid: Policy["isolatedUid"];
    gid: Policy["isolatedGid"];
    network: Policy["network"];
    inputMount: Policy["inputMount"];
    workspace: Policy["workspace"];
    outputTransport: Policy["outputTransport"];
    candidateEnvironmentNames: readonly string[];
  }>;
  execution: Readonly<{
    lifecycle: HostedSutProcessLifecycle;
    unitName: string | null;
    exitCode: number | null;
    authenticatedInputDigest: VerificationActionKeyDigest | null;
    postExecutionInputDigest: VerificationActionKeyDigest | null;
    postExecutionReadbackErrorDigest: VerificationActionKeyDigest | null;
    stdoutStderrDigest: VerificationActionKeyDigest;
    stdoutDigest: VerificationActionKeyDigest;
    stderrDigest: VerificationActionKeyDigest;
    stdoutBytesObserved: number;
    stderrBytesObserved: number;
    outputTruncated: boolean;
    boundedFailureTailDigest: VerificationActionKeyDigest;
  }>;
  cleanup: HostedSutCleanupObservation;
  diagnostic: string | null;
  receiptDigest: VerificationActionKeyDigest;
}>;

export type HostedSutInventory = Readonly<{
  archiveDigest: VerificationActionKeyDigest;
  inventoryDigest: VerificationActionKeyDigest;
  entryCount: number;
  totalFileBytes: number;
  dependencyClosureDigest: VerificationActionKeyDigest;
  gitBundleDigest: VerificationActionKeyDigest;
}>;

export type HostedSutExecutionAuthorization<
  AuthorizationSchema extends string,
  Environment extends Readonly<{ executionEnvironmentRevision: string }>,
  PhysicalSchema extends string,
  Policy extends Readonly<{ limits: object; substrate: string; namespaces: readonly string[]; isolatedUid: number; isolatedGid: number; network: string; inputMount: string; workspace: string; outputTransport: string }>,
  PolicyDigest extends VerificationActionKeyDigest,
  ProviderOrigin extends object,
  ProviderRevision extends string
> = Readonly<{
  schema: AuthorizationSchema;
  resolutionDigest: VerificationActionKeyDigest;
  ticketDigest: VerificationActionKeyDigest;
  actionKey: VerificationActionKeyDigest;
  candidateSha: string;
  candidateBytesDigest: VerificationActionKeyDigest;
  operationSemanticDigest: VerificationActionKeyDigest;
  normalizedArgv: readonly string[];
  inventoryClosure: HostedSutInventory;
  physicalCommand: HostedSutPhysicalCommandAuthorization<PhysicalSchema, PolicyDigest, ProviderRevision>;
  executionEnvironment: Environment;
  sandboxPolicyDigest: PolicyDigest;
  toolPolicy: Readonly<{
    runtime: 'bun';
    supervisor: '/usr/bin/unshare';
    substrate: Policy["substrate"];
    outputTransport: Policy["outputTransport"];
  }>;
  providerOrigin: ProviderOrigin;
  authorizationDigest: VerificationActionKeyDigest;
}>;

export type HostedSutPhysicalCommandObservation = Readonly<{
  commandPlanDigest: VerificationActionKeyDigest;
  executionAuthorizationDigest: VerificationActionKeyDigest;
  physicalCommandProjectionDigest: VerificationActionKeyDigest;
}>;

export type HostedActionRawResult<
  Policy extends Readonly<{ limits: object; substrate: string; namespaces: readonly string[]; isolatedUid: number; isolatedGid: number; network: string; inputMount: string; workspace: string; outputTransport: string }>,
  PolicyDigest extends VerificationActionKeyDigest,
  RawResultSchema extends string,
  ReceiptSchema extends string
> = Readonly<{
  schema: RawResultSchema;
  executionAuthorizationDigest: VerificationActionKeyDigest;
  command: HostedSutPhysicalCommandObservation | null;
  sandboxReceipt: HostedSutSandboxReceipt<Policy, PolicyDigest, ReceiptSchema>;
  startedAt: string;
  finishedAt: string;
  rawResultDigest: VerificationActionKeyDigest;
}>;

export type HostedSutDerivedCleanup = Readonly<{
  status: 'passed' | 'failed' | 'not-required';
  evidenceRefs: readonly string[];
  diagnostic: string | null;
}>;

export type HostedSutExecutionProof<
  AuthorizationSchema extends string,
  Environment extends Readonly<{ executionEnvironmentRevision: string }>,
  PhysicalSchema extends string,
  Policy extends Readonly<{ limits: object; substrate: string; namespaces: readonly string[]; isolatedUid: number; isolatedGid: number; network: string; inputMount: string; workspace: string; outputTransport: string }>,
  PolicyDigest extends VerificationActionKeyDigest,
  ProofSchema extends string,
  ProviderOrigin extends object,
  ProviderRevision extends string,
  RawResultSchema extends string,
  ReceiptSchema extends string
> = Readonly<{
  schema: ProofSchema;
  authorization: HostedSutExecutionAuthorization<AuthorizationSchema, Environment, PhysicalSchema, Policy, PolicyDigest, ProviderOrigin, ProviderRevision>;
  observation: HostedActionRawResult<Policy, PolicyDigest, RawResultSchema, ReceiptSchema>;
  externalRawResultDigest: VerificationActionKeyDigest;
  proofDigest: VerificationActionKeyDigest;
}>;

export type HostedSutTerminalProjection<
  AuthorizationSchema extends string,
  Environment extends Readonly<{ executionEnvironmentRevision: string }>,
  GateResult extends Readonly<{ status: string }>,
  PhysicalSchema extends string,
  Policy extends Readonly<{ limits: object; substrate: string; namespaces: readonly string[]; isolatedUid: number; isolatedGid: number; network: string; inputMount: string; workspace: string; outputTransport: string }>,
  PolicyDigest extends VerificationActionKeyDigest,
  ProofSchema extends string,
  ProviderOrigin extends object,
  ProviderRevision extends string,
  RawResultSchema extends string,
  ReceiptSchema extends string
> = Readonly<{
  result: GateResult;
  cleanup: HostedSutDerivedCleanup;
  proof: HostedSutExecutionProof<AuthorizationSchema, Environment, PhysicalSchema, Policy, PolicyDigest, ProofSchema, ProviderOrigin, ProviderRevision, RawResultSchema, ReceiptSchema>;
}>;

export type HostedDependencyArchiveProjection = Readonly<{
  schema: 'sec-hosted-dependency-archive-projection-v1';
  entriesObserved: number;
  linksProjected: number;
  sourceSnapshotDigest: VerificationActionKeyDigest;
  archiveProjectionDigest: VerificationActionKeyDigest;
}>;

export type DependencyMaterializationRecovery = Readonly<{
  attempts: 1 | 2;
  recoveredFrom: 'none' | 'bun-tarball-extraction';
}>;

export type PreparedTrustedBootstrapSutInputs = Readonly<{
  preparedCandidateArchive: string;
  archiveDigest: VerificationActionKeyDigest;
  archiveInventoryDigest: VerificationActionKeyDigest;
  dependencyClosureDigest: VerificationActionKeyDigest;
  authenticatedGitClosureDigest: VerificationActionKeyDigest;
  entryCount: number;
  totalFileBytes: number;
  dependencyArchiveProjection: HostedDependencyArchiveProjection;
}>;

export type HostedActionArtifactInput = Readonly<{
  baseSha: string;
  baseTreeSha: string;
  headSha: string;
  headTreeSha: string;
  manifestPath: string;
  manifestDigest: string;
  inputClosureDigest: string;
  candidateBytesDigest: string;
}>;

export interface VerificationSessionHostedRequest<RequestSchema extends string> {
  schema: RequestSchema;
  prNumber: number;
  expectedBaseSha: string;
  expectedBaseTreeSha: string;
  expectedHeadSha: string;
  expectedHeadTreeSha: string;
  manifestPath: string;
  manifestDigest: `sha256:${string}`;
  profile: string;
  expectedScopeProposalDigest: `sha256:${string}`;
  expectedActionPlanDigest: `sha256:${string}`;
  expectedSessionRevision: `sha256:${string}`;
  reviewPolicyDigest: `sha256:${string}`;
  requestOperationId: `sha256:${string}`;
}
export const HOSTED_VERIFICATION_COMMANDS = [
  'prepare-integration-hosted', 'verify-integration-recovery',
  'integrate-hosted', 'closeout-mutate-hosted', 'closeout-publish-hosted'
] as const;
export type HostedVerificationCommand = typeof HOSTED_VERIFICATION_COMMANDS[number];
export type VerificationSessionCloseoutObservation =
  | { status: 'completed' | 'protected-pending'; receiptDigest: Digest }
  | { status: 'waiting' | 'blocked'; reason: string };
export const HOSTED_SESSION_WAKE_KEY_SCHEMA = 'sec-verification-session-wake-key-v1' as const;

export type HostedResumeEmitter = Readonly<{
  repositoryId: string; repository: string; workflowPath: '.github/workflows/merge-gate.yml';
  workflowSha: string; runId: string; runAttempt: 1; jobId: string; checkRunId: string;
  policyJobId: 'integrate'; phase: 'resume-verification-session';
  stepName: 'Resume canonical verification Session'; stepNumber: number;
}>;
export type HostedResumeSignal<SignalSchema extends string> = Readonly<{
  schema: SignalSchema;
  wakeKey: `sha256:${string}`;
  completedAction: Readonly<{ providerEnvelope: Readonly<Record<string, unknown>>;
    runId: string; runAttempt: number; terminalArtifactId: string; terminalArtifactName: string;
    terminalArchiveDigest: `sha256:${string}`; terminalPayloadDigest: `sha256:${string}` }>;
  emitter: HostedResumeEmitter;
  signalDigest: `sha256:${string}`;
}>;

/** Recovery restriction data, never a dispatch permission or verification receipt. */
export type HostedResumeDispatchOutcome<SignalSchema extends string> = Readonly<{
  schema: 'verification-session-resume-dispatch-outcome';
  sessionRevision: `sha256:${string}`;
  operationId: `sha256:${string}`;
  actionKey: `sha256:${string}`;
  signal: HostedResumeSignal<SignalSchema>;
  receiver: Readonly<{ repository: string; workflowPath: string; workflowSha: string;
    runId: string; runAttempt: number; jobId: string }>;
  outcome: Readonly<{ disposition: 'dispatched' | 'joined' | 'blocked' | 'unknown';
    publicationState: 'not-entered' | 'entered-unknown' | 'submitted';
    reason: string | null; failureDiagnostic: string | null }>;
  recordedAt: string;
  outcomeDigest: `sha256:${string}`;
}>;

export type HostedResumeDispatchRecording<SignalSchema extends string> = Readonly<{
  recording: 'recorded' | 'unrecorded'; outcome: HostedResumeDispatchOutcome<SignalSchema>;
}>;

/** Exact planned wake membership, including members stopped before a native call. */
export type HostedResumeDispatchOutcomeCollection<SignalSchema extends string> = Readonly<{
  schema: 'verification-session-resume-dispatch-outcomes';
  signal: HostedResumeSignal<SignalSchema>;
  sessionRevision: `sha256:${string}`;
  receiver: HostedResumeDispatchOutcome<SignalSchema>['receiver'];
  expectedActionKeys: readonly `sha256:${string}`[];
  entries: readonly (Readonly<{ actionKey: `sha256:${string}`; recording: 'not-attempted'; outcome: null }> |
    Readonly<{ actionKey: `sha256:${string}`; recording: 'recorded' | 'unrecorded';
      outcome: HostedResumeDispatchOutcome<SignalSchema> }>)[];
  collectionDigest: `sha256:${string}`;
}>;

/** Persistent delegated cause is historical data; native intake must requalify it. */
export type VerificationSessionResumeCause<SignalSchema extends string> = Readonly<{
  kind: 'hosted-action-resume';
  signal: HostedResumeSignal<SignalSchema>;
  actionPlanClosureDigest: string;
  requestOperationId: string;
  scopeAuthorizationDigest: string;
  sessionRevision: string;
}>;

export type VerificationSessionResumeArtifact<SourceProgramAcceptance, SourceProgramAttemptEvidence,
  ContractRevision extends string, ResultStatus extends string, GateResult extends { readonly status: ResultStatus },
  SignalSchema extends string> = Readonly<Omit<VerificationSessionArtifact<SourceProgramAcceptance,
    SourceProgramAttemptEvidence, ContractRevision, ResultStatus, GateResult>, 'schema'> & {
  schema: 'verification-session-delegated-terminal';
  sourceCause: VerificationSessionResumeCause<SignalSchema>;
}>;

export type HostedSessionTerminalArtifact<SourceProgramAcceptance, SourceProgramAttemptEvidence,
  ContractRevision extends string, ResultStatus extends string, GateResult extends { readonly status: ResultStatus },
  SignalSchema extends string> = VerificationSessionArtifact<SourceProgramAcceptance, SourceProgramAttemptEvidence,
    ContractRevision, ResultStatus, GateResult> | VerificationSessionResumeArtifact<SourceProgramAcceptance,
      SourceProgramAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema>;
