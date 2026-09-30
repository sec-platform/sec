/** VerificationSession physical owner recovered from current-main semantics. */
import { createBranchCloseoutOperationBinding } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout-contract.ts';
import { type HostedWorkflowCommentProvenance, observeBranchCloseoutOperationPublication } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout-receipt.ts';
import { type IntegrationAuthorizationOperationPublication, observeIntegrationAuthorizationOperationPublications } from '../../../../self-hosting/control/integration/integration-authorization-publication.ts';
import { CodexDevelopmentEvaluateMergeGate, CodexDevelopmentParseMergeGateResult } from '../../../../self-hosting/control/integration/merge-gate.ts';
import type { IssueDispositionPlan } from '../../../../self-hosting/control/issues/disposition.ts';
import { createMainHealthLedger } from '../../../../self-hosting/control/main-health/contract.ts';
import { createObservedMainHealthInput } from '../../../../self-hosting/control/main-health/main-health-observation.ts';
import { CodexDevelopmentParseCurrentWorkPackageManifest, CodexDevelopmentWorkPackageManifestDigest } from '../../../../self-hosting/control/task/contract/work-package.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import type { VerificationSession } from '../../session/contract/session.ts';
import type { VerificationSessionScope } from '../contract/session-scope.ts';
import { loadHostedArtifactForMergeWorkflow, loadProviderBranchCloseoutRecoveryArtifact } from './session-hosted-artifacts.ts';
import { assertHostedIntegrationIdentity } from './session-hosted-identity.ts';
import { observeExactIssueDispositionPlan } from './session-issue-reconciliation.ts';
import { inspectTrustedRuntime } from './trusted-runtime-observation.ts';
import type { GitHubCandidateObservation, VerificationSessionGitHubClient } from './verification-session-github.ts';
import { classifyDurableVerificationSessionProjection, selectMergedAuthorizationPublication } from './verification-session-integration-routing.ts';
import { assertTrustedMergedRequestRuntimeReachability, classifyVerificationSessionArtifactReuse, createVerificationSessionMergeOperationId, createVerificationSessionReviewReceipt, parseVerificationSessionHostedRequest, prepareVerificationSessionMergeInput } from './verification-session-runtime.ts';
import { createHash } from 'node:crypto';
import path from 'node:path';

const HOSTED_INTEGRATION_PREFLIGHT_RESULT_FILE =
  'integration-preflight-result-v2.json' as const;

export function hostedIntegrationPreflightResultPath(repositoryRoot: string): string {
  return path.join(repositoryRoot, '.tmp', 'codex', HOSTED_INTEGRATION_PREFLIGHT_RESULT_FILE);
}

export function assertHostedIntegrationPreflightStillControls(input: Readonly<{
  frozen: ReturnType<typeof CodexDevelopmentParseMergeGateResult>;
  fresh: ReturnType<typeof CodexDevelopmentEvaluateMergeGate>;
}>): void {
  const stableFields = [
    'consumptionOperationId', 'repository', 'prNumber', 'sessionRevision',
    'baseSha', 'baseTreeSha', 'headSha', 'headTreeSha', 'manifestDigest',
    'scopeAuthorizationRevision', 'scopeAuthorizationReceiptDigest',
    'actionClosureDigest', 'evidenceDigest', 'trustRevision', 'rulesetDigest'
  ] as const;
  for (const field of stableFields) {
    if (input.frozen.authorization[field] !== input.fresh.authorization[field]) {
      throw new Error(`integrate-hosted frozen preflight ${field} drifted before effect.`);
    }
  }
  if (input.frozen.authorization.expiresAt <= new Date().toISOString()) {
    throw new Error('integrate-hosted frozen preflight expired before effect.');
  }
}

export function addSeconds(instant: string, seconds: number): string {
  return new Date(new Date(instant).getTime() + seconds * 1000).toISOString();
}

export function observeDurableVerificationSessionProjection(input: {
  ctx: VerificationSessionScope;
  github: VerificationSessionGitHubClient;
  repository: string;
  request: ReturnType<typeof parseVerificationSessionHostedRequest>;
  candidate: GitHubCandidateObservation;
  publications: readonly Readonly<{
    commentId: number;
    publication: IntegrationAuthorizationOperationPublication;
  }>[];
}): Readonly<Record<string, unknown>> | null {
  if (input.candidate.state === 'MERGED') {
    assertTrustedMergedRequestRuntimeReachability({
      proof: inspectTrustedRuntime({ repositoryRoot: input.ctx.repositoryRoot }),
      repository: input.repository,
      prNumber: input.request.prNumber,
      baseSha: input.request.expectedBaseSha,
      headSha: input.request.expectedHeadSha,
      headTreeSha: input.request.expectedHeadTreeSha,
      candidate: input.candidate,
      github: input.github
    });
  }
  const initial = classifyDurableVerificationSessionProjection(input);
  if (initial === null || input.candidate.state !== 'MERGED') return initial;
  const closeoutOperationId = initial.closeoutOperationId;
  if (typeof closeoutOperationId !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(closeoutOperationId)) {
    throw new Error('Durable merged projection did not produce one closeout operation identity.');
  }
  const closeout = observeBranchCloseoutOperationPublication(input.ctx.repositoryRoot, {
    repository: input.repository,
    pullRequestNumber: input.request.prNumber,
    closeoutOperationId: closeoutOperationId as `sha256:${string}`
  });
  return classifyDurableVerificationSessionProjection({ ...input,
    closeout: closeout === null ? null : Object.freeze({
      closeoutOperationId: closeoutOperationId as `sha256:${string}`,
      commentId: closeout.commentId,
      status: closeout.publication.receipt.closeoutStatus
    }) });
}

function assertAuthorizationPublicationMatchesSession(input: {
  publication: IntegrationAuthorizationOperationPublication;
  repository: string;
  session: VerificationSession;
}): void {
  const authorization = input.publication.result.authorization;
  const checks: readonly [unknown, unknown, string][] = [
    [input.publication.repository, input.repository, 'publication repository'],
    [input.publication.pullRequestNumber, input.session.prNumber, 'publication pull request'],
    [input.publication.sessionRevision, input.session.sessionRevision, 'publication Session revision'],
    [authorization.repository, input.repository, 'repository'],
    [authorization.prNumber, input.session.prNumber, 'pull request'],
    [authorization.sessionRevision, input.session.sessionRevision, 'Session revision'],
    [authorization.baseSha, input.session.baseSha, 'base'],
    [authorization.baseTreeSha, input.session.baseTreeSha, 'base tree'],
    [authorization.headSha, input.session.headSha, 'head'],
    [authorization.headTreeSha, input.session.headTreeSha, 'head tree'],
    [authorization.manifestDigest, input.session.manifestDigest, 'manifest'],
    [authorization.scopeAuthorizationRevision, input.session.scopeAuthorizationRevision,
      'ScopeAuthorization revision'],
    [authorization.actionClosureDigest, input.session.actionPlanClosureDigest, 'Action closure'],
    [authorization.trustRevision, input.session.trustRevision, 'trust revision']
  ];
  for (const [actual, expected, label] of checks) {
    if (actual !== expected) throw new Error(`Durable IntegrationAuthorization ${label} drifted.`);
  }
}

export function loadMarkerBoundMergedAuthorizationRecovery(input: {
  ctx: VerificationSessionScope;
  github: VerificationSessionGitHubClient;
  repository: string;
  session: VerificationSession;
  candidate: GitHubCandidateObservation;
  publications: readonly Readonly<{
    commentId: number;
    publication: IntegrationAuthorizationOperationPublication;
  }>[];
}): Readonly<{
  selected: Readonly<{ commentId: number; publication: IntegrationAuthorizationOperationPublication }>;
  recovery: ReturnType<typeof loadProviderBranchCloseoutRecoveryArtifact>;
}> {
  const selected = selectMergedAuthorizationPublication({ candidate: input.candidate,
    sessionRevision: input.session.sessionRevision, publications: input.publications });
  assertAuthorizationPublicationMatchesSession({ publication: selected.publication,
    repository: input.repository, session: input.session });
  const recovery = loadProviderBranchCloseoutRecoveryArtifact({ ctx: input.ctx,
    github: input.github, repository: input.repository, session: input.session,
    runId: selected.publication.recoveryArtifact.runId,
    runAttempt: selected.publication.recoveryArtifact.runAttempt });
  const remotePreparationDigest = recovery.remotePrepared.preparation.preparationDigest;
  const localPreparationDigest = recovery.prepared.preparation.preparationDigest;
  const publishedPreparationDigest =
    selected.publication.closeoutPreparation.preparation.preparationDigest;
  if (recovery.metadata.artifactId !== selected.publication.recoveryArtifact.artifactId
    || recovery.metadata.artifactName !== selected.publication.recoveryArtifact.artifactName
    || recovery.artifact.artifactDigest !== selected.publication.recoveryArtifact.artifactDigest
    || recovery.remotePrepared.envelopeDigest
      !== selected.publication.closeoutPreparation.envelopeDigest
    || encodeVerificationActionData(recovery.remotePrepared)
      !== encodeVerificationActionData(selected.publication.closeoutPreparation)
    || remotePreparationDigest !== localPreparationDigest
    || remotePreparationDigest !== publishedPreparationDigest) {
    throw new Error('Marker-bound recovery artifact differs from the original authorization publication.');
  }
  return Object.freeze({ selected, recovery });
}

export function loadMergedHostedCloseoutContext(input: {
  ctx: VerificationSessionScope;
  github: VerificationSessionGitHubClient;
  repository: string;
  event: Record<string, any>;
  environment: Readonly<Record<string, string | undefined>>;
  repositoryRoot: string;
  phase: 'closeoutMutation' | 'closeoutPublication';
}): Readonly<{
  hosted: ReturnType<typeof loadHostedArtifactForMergeWorkflow>;
  candidate: GitHubCandidateObservation;
  identity: ReturnType<typeof assertHostedIntegrationIdentity>;
  selected: Readonly<{ commentId: number; publication: IntegrationAuthorizationOperationPublication }>;
  recovery: ReturnType<typeof loadProviderBranchCloseoutRecoveryArtifact>;
  binding: ReturnType<typeof createBranchCloseoutOperationBinding>;
}> {
  const hosted = loadHostedArtifactForMergeWorkflow(input.github, input.repository, input.event);
  const artifact = hosted.artifact;
  if (artifact.session.repository !== input.repository) {
    throw new Error('Hosted closeout repository differs from the authenticated Session artifact.');
  }
  const candidate = input.github.observeCandidate(input.repository, artifact.session.prNumber);
  if (candidate.state !== 'MERGED' || candidate.mergeCommitSha === null
    || candidate.mergeCommitTreeSha === null || candidate.mergeCommitMessage === null
    || candidate.mergeCommitTreeSha !== artifact.session.headTreeSha) {
    throw new Error('Hosted closeout requires exact marker-bound merged tree parity.');
  }
  const identity = assertHostedIntegrationIdentity({ ctx: input.ctx, github: input.github,
    repository: input.repository, event: input.event, session: artifact.session, candidate,
    phase: input.phase, environment: input.environment, repositoryRoot: input.repositoryRoot });
  const publications = observeIntegrationAuthorizationOperationPublications(input.ctx.repositoryRoot, {
    repository: input.repository, pullRequestNumber: artifact.session.prNumber,
    sessionRevision: artifact.session.sessionRevision });
  const merged = loadMarkerBoundMergedAuthorizationRecovery({ ctx: input.ctx,
    github: input.github, repository: input.repository, session: artifact.session,
    candidate, publications });
  const { selected, recovery } = merged;
  const authorization = selected.publication.result.authorization;
  const binding = createBranchCloseoutOperationBinding({ integrationAuthorization: authorization,
    preparation: recovery.prepared.preparation, newMainSha: candidate.mergeCommitSha,
    newMainTreeSha: candidate.mergeCommitTreeSha, candidateTreeSha: artifact.session.headTreeSha });
  return Object.freeze({ hosted, candidate, identity, selected, recovery, binding });
}

export function evaluateFreshHostedIntegration(input: {
  github: VerificationSessionGitHubClient;
  repository: string;
  hosted: ReturnType<typeof loadHostedArtifactForMergeWorkflow>;
  candidate: GitHubCandidateObservation;
  provenance: HostedWorkflowCommentProvenance;
  observedAt: string;
}): Readonly<{
  result: ReturnType<typeof CodexDevelopmentEvaluateMergeGate>;
  changedPaths: readonly string[];
  issueDispositionPlan: IssueDispositionPlan;
}> {
  const { github, repository, hosted, candidate, provenance, observedAt } = input;
  const artifact = hosted.artifact;
  const artifactReuse = classifyVerificationSessionArtifactReuse(artifact, observedAt);
  if (!artifactReuse.actionEvidenceCandidate || artifact.evidence.status !== 'passed') {
    throw new Error(`Hosted integration requires reusable passed Action Evidence: ${artifactReuse.reason}`);
  }
  if (candidate.state !== 'OPEN' || candidate.baseSha !== artifact.session.baseSha
    || candidate.baseTreeSha !== artifact.session.baseTreeSha
    || candidate.headSha !== artifact.session.headSha
    || candidate.headTreeSha !== artifact.session.headTreeSha
    || candidate.isDraft || candidate.isCrossRepository) {
    throw new Error('Hosted integration OPEN candidate identity drifted.');
  }
  const manifestSource = github.readBlobText(repository, candidate.headSha, artifact.session.manifestPath);
  if (CodexDevelopmentWorkPackageManifestDigest(manifestSource) !== artifact.session.manifestDigest) {
    throw new Error('Hosted integration Issue disposition manifest bytes drifted.');
  }
  const manifest = CodexDevelopmentParseCurrentWorkPackageManifest(
    manifestSource,
    artifact.session.manifestPath
  );
  const issueDispositionPlan = observeExactIssueDispositionPlan({
    github,
    repository,
    candidate,
    manifestPath: artifact.session.manifestPath,
    manifestDigest: artifact.session.manifestDigest,
    tracking: manifest.tracking
  });
  const integrationPrincipalNodeId = provenance.actorNodeId;
  const barrier = github.observeReviewBarrier({ repository, prNumber: artifact.session.prNumber,
    headSha: artifact.session.headSha,
    excludedPrincipalNodeIds: new Set([candidate.authorNodeId, integrationPrincipalNodeId]) });
  if (barrier.status !== 'clear') {
    throw new Error(`Hosted integration Review barrier ${barrier.status}: ${
      barrier.status === 'provider-schema-unsupported' ? barrier.reasonCode : barrier.reason}`);
  }
  const operationId = `sha256:${createHash('sha256').update(
    `${artifact.session.sessionRevision}:pre-merge-review`
  ).digest('hex')}` as const;
  const preMergeReview = createVerificationSessionReviewReceipt({ stage: 'pre-merge',
    session: artifact.session, scope: artifact.scopeAuthorization, barrier,
    candidateAuthorNodeId: candidate.authorNodeId, integrationPrincipalNodeId,
    expiresAt: addSeconds(barrier.observedAt, 300), operationId });
  const changedPaths = github.observeChangedPaths({ repository,
    prNumber: artifact.session.prNumber, state: 'OPEN', draft: false,
    baseSha: artifact.session.baseSha, headSha: artifact.session.headSha }).paths;
  const comparison = github.observeComparison(repository, candidate.baseSha, candidate.headSha);
  const headOpenPullRequestCount = github.observeOpenPullRequestCountForHead(repository, candidate.headSha);
  if (headOpenPullRequestCount !== 1 || comparison.behindBy !== 0
    || (comparison.status !== 'ahead' && comparison.status !== 'identical')) {
    throw new Error('Hosted integration candidate ancestry or same-head PR identity is not mergeable.');
  }
  const issuedAt = barrier.observedAt;
  const workflowRef = `.github/workflows/merge-gate.yml@${artifact.session.baseSha}`;
  const freshMainHealth = createMainHealthLedger(createObservedMainHealthInput({
    repository, mainSha: candidate.baseSha, mainTreeSha: candidate.baseTreeSha,
    trustRevision: artifact.session.trustRevision, observedAt: issuedAt,
    expiresAt: addSeconds(issuedAt, 300), sourceRunId: provenance.runId,
    sourceRef: workflowRef, checks: github.observeChecks(repository, candidate.baseSha) }));
  const consumptionOperationId = createVerificationSessionMergeOperationId({
    sessionRevision: artifact.session.sessionRevision, headSha: artifact.session.headSha,
    actionPlanDigest: artifact.evidence.actionPlan.actionPlanDigest });
  const mergeInput = prepareVerificationSessionMergeInput({ artifact, preMergeReview,
    hostedArtifactOrigin: hosted.origin, hostedArtifactTransport: hosted.transport,
    candidate: { repository, prNumber: artifact.session.prNumber, draft: false,
      headOpenPullRequestCount: 1, currentBaseSha: candidate.baseSha,
      currentBaseTreeSha: candidate.baseTreeSha, headSha: candidate.headSha,
      headTreeSha: candidate.headTreeSha, baseIsAncestor: true, behindBy: 0,
      manifestPath: artifact.session.manifestPath, manifestDigest: artifact.session.manifestDigest,
      changedPaths },
    provenance: { workflowPath: '.github/workflows/merge-gate.yml', workflowRef,
      workflowSha: artifact.session.baseSha, eventName: 'workflow_run',
      sourceRunId: provenance.runId, sourceRunAttempt: provenance.runAttempt,
      actorNodeId: integrationPrincipalNodeId, actorPermission: provenance.actorPermission },
    mainHealth: freshMainHealth, platform: github.observePlatformEnforcement(repository),
    consumptionOperationId, issuedAt, expiresAt: addSeconds(issuedAt, 300) });
  return Object.freeze({ result: CodexDevelopmentEvaluateMergeGate(mergeInput),
    changedPaths: Object.freeze([...changedPaths]), issueDispositionPlan });
}
