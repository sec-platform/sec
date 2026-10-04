import type { BranchCloseoutOperationBinding } from '../execution/verification/branch-closeout.ts';
import type {
  GitHubPrincipalObservation, HostedSessionTerminalArtifact, IntegrationAuthorizationPublicationObservation, VerificationSessionCloseoutObservation, VerificationSessionJournalEventKind, VerificationSessionJournalReadback,
  VerificationSessionOperationClaim, VerificationSessionStage
} from "../execution/verification/hosted.ts";
import type { IntegrationAuthorization, MergeGateResult } from '../execution/verification/integration.ts';
import type {
  Digest, GitHubCandidateObservation, GitHubReviewBarrierObservation, MainHealthLedger,
  PlatformEnforcementObservation, ReviewStabilityReceipt, ScopeAuthorization,
  TrustedArtifactProvenance, TrustedIntegrationAuthorizationSource, TrustedRuntimeProof,
  VerificationSession, VerificationSessionArtifact, VerificationSessionRuntimeOutcome
} from '../execution/verification/session.ts';

/** Native payloads keep their original concrete type through the application. */
export interface VerificationSessionResumeExternal<
  SourceAcceptance, SourceAttemptEvidence, ContractRevision extends string,
  ResultStatus extends string, GateResult extends { readonly status: ResultStatus }, SignalSchema extends string
> {
  now(): string;
  expiresAt(now: string, durationSeconds: number): string;
  trustedRuntimeProof(session: VerificationSession): TrustedRuntimeProof;
  runLocalActions(session: VerificationSession):
    | { status: 'passed'; resultDigest: Digest }
    | { status: 'waiting' }
    | { status: 'failed'; reason: string };
  hostedArtifact(): {
    artifact: HostedSessionTerminalArtifact<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema>;
    provenance: TrustedArtifactProvenance;
  } | null;
  saveReviewReceipt(stage: 'pre-expensive' | 'pre-merge', receipt: ReviewStabilityReceipt): void;
  integrationAuthorizationArtifact(): TrustedIntegrationAuthorizationSource | null;
  integrationAuthorizationPublication(): IntegrationAuthorizationPublicationObservation | null;
  consumedAuthorizationIds(): ReadonlySet<string> | Promise<ReadonlySet<string>>;
  observeCloseoutPreparation(operationId: Digest, authorization: IntegrationAuthorization, session: VerificationSession):
    | { status: 'prepared'; preparationDigest: Digest }
    | { status: 'waiting' | 'blocked'; reason: string };
  observeCloseoutBinding(authorization: IntegrationAuthorization, session: VerificationSession, merged: GitHubCandidateObservation):
    | { status: 'available'; binding: BranchCloseoutOperationBinding }
    | { status: 'waiting' | 'blocked'; reason: string };
  observeCloseout(binding: BranchCloseoutOperationBinding, authorization: IntegrationAuthorization,
    session: VerificationSession, merged: GitHubCandidateObservation):
    VerificationSessionCloseoutObservation | Promise<VerificationSessionCloseoutObservation>;
}

export interface VerificationSessionResumeGitHub<Request> {
  observeCandidate(repository: string, prNumber: number): Promise<GitHubCandidateObservation>;
  observeReviewBarrier(input: Readonly<{
    repository: string; prNumber: number; headSha: string; excludedPrincipalNodeIds: ReadonlySet<string>;
  }>): Promise<GitHubReviewBarrierObservation>;
  observePrincipalByNodeId(repository: string, nodeId: string): Promise<GitHubPrincipalObservation>;
  observePlatformEnforcement(repository: string): Promise<PlatformEnforcementObservation>;
  ensureVerificationSessionWakeup(repository: string, request: Request): Promise<void>;
}

/** Each port owns one validation, observation or durable primitive. The
 * application chooses the business order and owns every waiting/terminal path. */
export interface VerificationSessionResumePorts<
  SourceAcceptance, SourceAttemptEvidence, ContractRevision extends string,
  ResultStatus extends string, GateResult extends { readonly status: ResultStatus },
  EventSchema extends string, ClaimSchema extends string,
  Request extends { readonly requestOperationId: Digest }, Transition,
  Health extends { readonly allowed: boolean; readonly status: string; readonly reason: string }, SignalSchema extends string
> {
  parseSession(session: VerificationSession): VerificationSession;
  parseScope(scope: ScopeAuthorization): ScopeAuthorization;
  digest(value: unknown): Digest;
  readJournal(sessionRevision: Digest): VerificationSessionJournalReadback<EventSchema>;
  appendJournal(input: Readonly<{
    sessionRevision: Digest; targetStage: VerificationSessionStage; kind: VerificationSessionJournalEventKind;
    receiptDigest: Digest | null; operationId: Digest | null; note?: string;
  }>): void;
  claimOperation(input: Readonly<{ sessionRevision: Digest; operationId: Digest; operationKind: string }>): {
    claimed: boolean; claim: VerificationSessionOperationClaim<ClaimSchema>;
  };
  createOperationId(input: Readonly<{ sessionRevision: Digest; operationKind: string; semanticInputDigest: Digest }>): Digest;
  assertTrustedRuntime(proof: TrustedRuntimeProof, session: VerificationSession, allowMerged: boolean): void;
  assertTrustedMergedRuntimeReachability(input: Readonly<{
    proof: TrustedRuntimeProof; session: VerificationSession; candidate: GitHubCandidateObservation;
  }>): Promise<void>;
  assertCandidateCurrent(candidate: GitHubCandidateObservation, session: VerificationSession): void;
  assertScopeCurrent(scope: ScopeAuthorization, expected: Readonly<{
    baseSha: string; baseTreeSha: string; headSha: string; headTreeSha: string;
    manifestDigest: Digest; changedPaths: readonly string[]; sessionProposalDigest: Digest;
    actionPlanClosureDigest: Digest; environmentDigest: Digest; expectedAuthorizationRevision: Digest; now: string;
  }>): void;
  createReviewReceipt(input: Readonly<{
    stage: 'pre-expensive' | 'pre-merge'; session: VerificationSession; scope: ScopeAuthorization;
    barrier: Extract<GitHubReviewBarrierObservation, { status: 'clear' }>;
    candidateAuthorNodeId: string; integrationPrincipalNodeId: string; expiresAt: string; operationId: Digest;
  }>): ReviewStabilityReceipt;
  bindTestImpactTransition(input: Readonly<{
    baseSha: string; headSha: string; changedPaths: readonly string[]; transition: Transition;
  }>): { readonly digest: Digest };
  createHostedRequest(input: Readonly<{
    session: VerificationSession; scope: ScopeAuthorization; testImpactTransitionDigest: Digest;
  }>): Request;
  assertArtifactProvenance(
    artifact: HostedSessionTerminalArtifact<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema>,
    provenance: TrustedArtifactProvenance, session: VerificationSession
  ): void;
  integrationPlatformPolicyDigest: Digest;
  mainHealthDefaultBranch: string;
  parseMergeGateResult(source: string): MergeGateResult;
  verifyIntegrationArtifact(input: Readonly<{
    source: TrustedIntegrationAuthorizationSource; result: MergeGateResult;
    hosted: TrustedArtifactProvenance; session: VerificationSession;
  }>): void;
  integrationMergeMarkers(input: Readonly<{
    sessionRevision: Digest; authorizationId: string; authorizationReceiptDigest: Digest;
    consumptionOperationId: Digest; authorizationPublicationId: Digest;
    authorizationPublicationDigest: Digest; commentId: number;
  }>): readonly string[];
  assertReviewReceiptCurrent(receipt: ReviewStabilityReceipt, expected: Readonly<{
    stage: 'pre-merge'; sessionRevision: Digest; scopeAuthorizationRevision: Digest;
    scopeAuthorizationReceiptDigest: Digest; headSha: string; headTreeSha: string;
    expectedPolicyDigest: Digest; snapshotDigest: Digest; expectedReviewRevision: Digest; now: string;
  }>): void;
  resolveOrdinaryMainHealth(input: Readonly<{
    ledger: MainHealthLedger; now: string; expectedRepository: string; expectedDefaultBranch: string;
    expectedMainSha: string; expectedMainTreeSha: string; expectedTrustRevision: string;
  }>): Health;
  assertIntegrationAuthorizationUsable(authorization: IntegrationAuthorization, expected: Readonly<{
    now: string; consumedAuthorizationIds: ReadonlySet<string>; consumptionOperationId: string;
    repository: string; prNumber: number; sessionRevision: Digest; baseSha: string; baseTreeSha: string;
    headSha: string; headTreeSha: string; manifestDigest: Digest; scopeAuthorizationRevision: Digest;
    scopeAuthorizationReceiptDigest: Digest; actionClosureDigest: Digest; evidenceDigest: Digest;
    reviewRevision: Digest; reviewReceiptDigest: Digest; mainHealthRevision: Digest;
    mainHealthReceiptDigest: Digest; trustRevision: string; rulesetDigest: Digest;
  }>): void;
  assertCanonicalMergeMessage(input: Readonly<{
    authorizationMarkers: readonly string[]; reviewReceipt: ReviewStabilityReceipt; expectedTitle: string; message: string;
  }>): void;
  assertCloseoutBinding(binding: BranchCloseoutOperationBinding): void;
}

function outcome(input: Omit<VerificationSessionRuntimeOutcome, 'completedStage' | 'operationId' | 'authorizationId'> & {
  completedStage?: string | null; operationId?: Digest | null; authorizationId?: string | null;
}): VerificationSessionRuntimeOutcome {
  return Object.freeze({ completedStage: input.completedStage ?? null,
    operationId: input.operationId ?? null, authorizationId: input.authorizationId ?? null, ...input });
}

/** Advances once until an external wait or a terminal state. Native claims
 * remain durable; a resumed application never renews their operation identity. */
export async function resumeVerificationSession<
  SourceAcceptance, SourceAttemptEvidence, ContractRevision extends string,
  ResultStatus extends string, GateResult extends { readonly status: ResultStatus },
  EventSchema extends string, ClaimSchema extends string,
  Request extends { readonly requestOperationId: Digest }, Transition,
  Health extends { readonly allowed: boolean; readonly status: string; readonly reason: string }, SignalSchema extends string
>(input: {
  repositoryRoot: string;
  session: VerificationSession;
  scopeAuthorization: ScopeAuthorization;
  changedPaths: readonly string[];
  testImpactTransition?: Transition;
  integrationPrincipalNodeId: string;
  github: VerificationSessionResumeGitHub<Request>;
  external: VerificationSessionResumeExternal<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema>;
}, ports: VerificationSessionResumePorts<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus,
  GateResult, EventSchema, ClaimSchema, Request, Transition, Health, SignalSchema>): Promise<VerificationSessionRuntimeOutcome> {
  const session = ports.parseSession(input.session);
  const scope = ports.parseScope(input.scopeAuthorization);
  let journal = ports.readJournal(session.sessionRevision);
  const candidate = (await input.github.observeCandidate(session.repository, session.prNumber));
  const liveMerged = candidate.state === 'MERGED';
  const trustedRuntimeProof = input.external.trustedRuntimeProof(session);
  if (liveMerged) {
    (await ports.assertTrustedMergedRuntimeReachability({ proof: trustedRuntimeProof, session, candidate,
      }));
  } else {
    ports.assertTrustedRuntime(trustedRuntimeProof, session, false);
  }
  if (!liveMerged) {
    ports.assertCandidateCurrent(candidate, session);
  } else if (candidate.repository !== session.repository || candidate.number !== session.prNumber
    || candidate.headSha !== session.headSha || candidate.headTreeSha !== session.headTreeSha) {
    throw new Error('VerificationSession merged PR identity drifted.');
  }
  ports.assertScopeCurrent(scope, {
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

  const append = (targetStage: VerificationSessionStage, receiptDigest: Digest | null, operationId: Digest | null = null) => {
    ports.appendJournal({ sessionRevision: session.sessionRevision,
      targetStage, kind: 'completed', receiptDigest, operationId });
    journal = ports.readJournal(session.sessionRevision);
  };

  if (journal.completedStageIndex < 0) append('frozen', session.sessionRevision);
  if (journal.completedStageIndex < 1) {
    const actions = input.external.runLocalActions(session);
    if (actions.status === 'waiting') return outcome({ status: 'WAITING_ACTIONS', sessionRevision: session.sessionRevision, reason: 'local Action closure is not terminal', receiptDigest: null, completedStage: journal.completedStage });
    if (actions.status === 'failed') return outcome({ status: 'BLOCKED', sessionRevision: session.sessionRevision, reason: actions.reason, receiptDigest: null, completedStage: journal.completedStage });
    append('actions-terminal', actions.resultDigest);
  }

  const hosted = input.external.hostedArtifact();
  const preGateOperation = ports.createOperationId({ sessionRevision: session.sessionRevision, operationKind: 'pre-gate-review', semanticInputDigest: session.reviewPolicyDigest });
  if (journal.completedStageIndex < 2) {
    if (liveMerged) {
      if (hosted === null) return outcome({ status: 'WAITING_HOSTED_VERIFICATION', sessionRevision: session.sessionRevision,
        reason: 'trusted hosted artifact is required for merged recovery', receiptDigest: null, completedStage: journal.completedStage });
      append('pre-gate-review-clear', hosted.artifact.preGateReview.receiptDigest as Digest, preGateOperation);
    } else {
      const barrier = (await input.github.observeReviewBarrier({ repository: session.repository, prNumber: session.prNumber,
        headSha: session.headSha, excludedPrincipalNodeIds: new Set([candidate.authorNodeId, input.integrationPrincipalNodeId]) }));
      if (barrier.status !== 'clear') {
        if (barrier.status === 'provider-schema-unsupported') return outcome({ status: 'BLOCKED',
          sessionRevision: session.sessionRevision, reason: barrier.reasonCode,
          receiptDigest: barrier.responseDigest, completedStage: journal.completedStage });
        if (barrier.status === 'blocked') return outcome({ status: 'BLOCKED', sessionRevision: session.sessionRevision, reason: barrier.reason, receiptDigest: barrier.snapshotDigest, completedStage: journal.completedStage });
        return outcome({ status: 'WAITING_REVIEW', sessionRevision: session.sessionRevision, reason: barrier.reason,
          receiptDigest: barrier.snapshotDigest, completedStage: journal.completedStage });
      }
      const receipt = ports.createReviewReceipt({ stage: 'pre-expensive', session, scope, barrier,
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
      const transition = ports.bindTestImpactTransition({
        baseSha: session.baseSha,
        headSha: session.headSha,
        changedPaths: input.changedPaths,
        transition: input.testImpactTransition
      });
      const request = ports.createHostedRequest({
        session,
        scope,
        testImpactTransitionDigest: transition.digest
      });
      const claim = ports.claimOperation({ sessionRevision: session.sessionRevision,
        operationId: request.requestOperationId, operationKind: 'hosted-dispatch' });
      if (claim.claimed) (await input.github.ensureVerificationSessionWakeup(session.repository, request));
      ports.appendJournal({ sessionRevision: session.sessionRevision,
        targetStage: 'hosted-verification-terminal', kind: 'waiting', operationId: request.requestOperationId,
        receiptDigest: null, note: claim.claimed ? 'hosted verification dispatched' : 'hosted dispatch already claimed' });
      return outcome({ status: 'WAITING_HOSTED_VERIFICATION', sessionRevision: session.sessionRevision,
        reason: 'trusted hosted artifact is not available', receiptDigest: null, completedStage: journal.completedStage });
    }
    ports.assertArtifactProvenance(hosted.artifact, hosted.provenance, session);
    if (hosted.artifact.evidence.status !== 'passed') return outcome({ status: 'BLOCKED', sessionRevision: session.sessionRevision,
      reason: `hosted verification terminal ${hosted.artifact.evidence.status}`, receiptDigest: hosted.artifact.evidence.evidenceDigest as Digest, completedStage: journal.completedStage });
    append('hosted-verification-terminal', hosted.artifact.evidence.evidenceDigest as Digest);
  }
  if (hosted === null) return outcome({ status: 'WAITING_HOSTED_VERIFICATION', sessionRevision: session.sessionRevision,
    reason: 'hosted artifact disappeared', receiptDigest: null, completedStage: journal.completedStage });
  ports.assertArtifactProvenance(hosted.artifact, hosted.provenance, session);

  if (session.integrationPolicyDigest !== ports.integrationPlatformPolicyDigest) {
    throw new Error('Session integration platform policy is not the canonical no-admin policy.');
  }
  const integrationSource = input.external.integrationAuthorizationArtifact();
  if (integrationSource === null) return outcome({ status: 'WAITING_INTEGRATION_AUTHORIZATION', sessionRevision: session.sessionRevision,
    reason: 'trusted merge-gate authorization artifact is not available', receiptDigest: hosted.artifact.evidence.evidenceDigest as Digest, completedStage: journal.completedStage });
  const integrationResult = integrationSource.kind === 'actions-artifact'
    ? ports.parseMergeGateResult(integrationSource.artifact.resultJson)
    : integrationSource.publication.result;
  ports.verifyIntegrationArtifact({ source: integrationSource, result: integrationResult,
    hosted: hosted.provenance, session });
  const authorizationPrincipal = (await input.github.observePrincipalByNodeId(session.repository,
    integrationResult.provenance.actorNodeId));
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
  const markers = ports.integrationMergeMarkers({ sessionRevision: session.sessionRevision,
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
  const barrier = liveMerged ? null : (await input.github.observeReviewBarrier({ repository: session.repository,
    prNumber: session.prNumber, headSha: session.headSha,
    excludedPrincipalNodeIds: new Set([candidate.authorNodeId, input.integrationPrincipalNodeId]) }));
  if (barrier !== null && barrier.status !== 'clear') return outcome({ status: barrier.status === 'waiting' ? 'WAITING_REVIEW' : 'BLOCKED',
    sessionRevision: session.sessionRevision,
    reason: barrier.status === 'provider-schema-unsupported' ? barrier.reasonCode : barrier.reason,
    receiptDigest: barrier.status === 'provider-schema-unsupported' ? barrier.responseDigest : barrier.snapshotDigest,
    completedStage: journal.completedStage });
  const enforcement = liveMerged ? integrationResult.platformObservation
    : (await input.github.observePlatformEnforcement(session.repository));
  if (enforcement.status === 'unknown') return outcome({ status: 'BLOCKED', sessionRevision: session.sessionRevision,
    reason: enforcement.reason ?? 'platform enforcement unknown', receiptDigest: enforcement.rulesetDigest, completedStage: journal.completedStage });
  ports.assertReviewReceiptCurrent(preMergeReceipt, { stage: 'pre-merge',
    sessionRevision: session.sessionRevision, scopeAuthorizationRevision: scope.authorizationRevision,
    scopeAuthorizationReceiptDigest: scope.authorizationDigest, headSha: session.headSha, headTreeSha: session.headTreeSha,
    expectedPolicyDigest: session.reviewPolicyDigest,
    snapshotDigest: barrier === null ? preMergeReceipt.snapshot.snapshotDigest : barrier.snapshot.snapshotDigest,
    expectedReviewRevision: preMergeReceipt.reviewRevision,
    now: liveMerged ? preMergeReceipt.reviewedAt : input.external.now() });
  const health = ports.resolveOrdinaryMainHealth({ ledger: integrationResult.mainHealth,
    now: liveMerged ? integrationResult.mainHealth.observedAt : input.external.now(),
    expectedRepository: session.repository,
    expectedDefaultBranch: ports.mainHealthDefaultBranch,
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
    ports.createOperationId({ sessionRevision: session.sessionRevision, operationKind: 'pre-merge-review',
      semanticInputDigest: preMergeReceipt.reviewRevision }));
  const durableConsumed = await input.external.consumedAuthorizationIds();
  const effectiveConsumed = matchingMergedConsumption
    ? new Set([...durableConsumed].filter((id) => id !== authorization.authorizationId))
    : durableConsumed;
  ports.assertIntegrationAuthorizationUsable(authorization, {
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

  const closeoutPreparationOperationId = ports.createOperationId({
    sessionRevision: session.sessionRevision, operationKind: 'closeout-preparation',
    semanticInputDigest: ports.digest({ authorizationId: authorization.authorizationId, headSha: session.headSha })
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

  const merged = (await input.github.observeCandidate(session.repository, session.prNumber));
  if (merged.state !== 'MERGED' || merged.mergeCommitSha === null || merged.mergeCommitTreeSha === null || merged.mergeCommitMessage === null) {
    return outcome({ status: 'WAITING_MERGE_READBACK', sessionRevision: session.sessionRevision,
      reason: 'exact merge readback is not terminal', receiptDigest: authorization.receiptDigest as Digest, completedStage: journal.completedStage });
  }
  if (!markers.every((marker) => merged.mergeCommitMessage!.split(/\r?\n/u).includes(marker))) {
    return outcome({ status: 'BLOCKED', sessionRevision: session.sessionRevision,
      reason: 'merged commit lacks the exact IntegrationAuthorization consumption marker',
      receiptDigest: authorization.receiptDigest as Digest, completedStage: journal.completedStage });
  }
  ports.assertCanonicalMergeMessage({
    authorizationMarkers: markers,
    reviewReceipt: preMergeReceipt,
    expectedTitle: `Verified integration ${session.sessionRevision.slice(7, 19)}`,
    message: merged.mergeCommitMessage!
  });
  if (journal.completedStageIndex < 7) append('merge-readback', ports.digest({ commit: merged.mergeCommitSha, tree: merged.mergeCommitTreeSha }));
  if (merged.mergeCommitTreeSha !== session.headTreeSha) return outcome({ status: 'BLOCKED', sessionRevision: session.sessionRevision,
    reason: 'merged tree does not equal verified candidate tree', receiptDigest: ports.digest({ candidate: session.headTreeSha, merged: merged.mergeCommitTreeSha }), completedStage: journal.completedStage });
  if (journal.completedStageIndex < 8) append('tree-parity', ports.digest({ tree: merged.mergeCommitTreeSha }));

  const closeoutBindingObservation = input.external.observeCloseoutBinding(authorization, session, merged);
  if ('reason' in closeoutBindingObservation) return outcome({
    status: closeoutBindingObservation.status === 'waiting' ? 'READY_TO_CLOSEOUT' : 'BLOCKED',
    sessionRevision: session.sessionRevision, reason: closeoutBindingObservation.reason,
    receiptDigest: authorization.receiptDigest as Digest, completedStage: journal.completedStage,
    operationId: mergeOperationId, authorizationId: authorization.authorizationId
  });
  const closeoutBinding = closeoutBindingObservation.binding;
  ports.assertCloseoutBinding(closeoutBinding);
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
  const closeout = await input.external.observeCloseout(
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
