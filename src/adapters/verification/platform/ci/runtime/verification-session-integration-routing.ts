import { createBranchCloseoutOperationBinding } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout-contract.ts';
import type { IntegrationAuthorizationOperationPublication } from '../../../../self-hosting/control/integration/integration-authorization-publication.ts';
import type { VerificationSession } from '../../session/contract/session.ts';
import type { VerificationSessionHostedRequest } from '../contract/session-request.ts';
import type { GitHubCandidateObservation } from './verification-session-github.ts';
import { readExactCommitMarker } from './merge-commit-marker.ts';

function selectMergedAuthorizationPublication(input: {
  candidate: GitHubCandidateObservation;
  sessionRevision: `sha256:${string}`;
  publications: readonly Readonly<{
    commentId: number;
    publication: IntegrationAuthorizationOperationPublication;
  }>[];
}): Readonly<{ commentId: number; publication: IntegrationAuthorizationOperationPublication }> {
  const message = input.candidate.mergeCommitMessage;
  if (input.candidate.state !== 'MERGED' || message === null) {
    throw new Error('Merged PR has no exact merge commit message readback.');
  }
  const commentText = readExactCommitMarker(message, 'Integration-Authorization-Comment');
  if (!/^[1-9][0-9]*$/u.test(commentText)) {
    throw new Error('Merged commit authorization comment marker is not a positive decimal id.');
  }
  const markerCommentId = Number(commentText);
  if (!Number.isSafeInteger(markerCommentId)) {
    throw new Error('Merged commit authorization comment marker exceeds safe integer range.');
  }
  const markerPublicationId = readExactCommitMarker(message, 'Integration-Authorization-Publication');
  const markerPublicationDigest = readExactCommitMarker(message,
    'Integration-Authorization-Publication-Digest');
  const markerAuthorizationId = readExactCommitMarker(message, 'Integration-Authorization');
  const markerReceiptDigest = readExactCommitMarker(message, 'Integration-Authorization-Receipt');
  const markerOperationId = readExactCommitMarker(message, 'Integration-Authorization-Operation');
  const markerSession = readExactCommitMarker(message, 'Verification-Session');
  const matches = input.publications.filter(({ commentId, publication }) => (
    commentId === markerCommentId
    && publication.authorizationPublicationId === markerPublicationId
    && publication.publicationDigest === markerPublicationDigest
    && publication.authorizationId === markerAuthorizationId
    && publication.authorizationReceiptDigest === markerReceiptDigest
    && publication.consumptionOperationId === markerOperationId
    && publication.sessionRevision === markerSession
    && publication.sessionRevision === input.sessionRevision
  ));
  if (matches.length !== 1) {
    throw new Error('Merged commit marker does not select exactly one trusted remote authorization publication.');
  }
  return matches[0]!;
}

function assertAuthorizationPublicationMatchesRequest(input: {
  publication: IntegrationAuthorizationOperationPublication;
  request: VerificationSessionHostedRequest;
  repository: string;
}): void {
  const authorization = input.publication.result.authorization;
  const checks: readonly [unknown, unknown, string][] = [
    [input.publication.repository, input.repository, 'publication repository'],
    [input.publication.pullRequestNumber, input.request.prNumber, 'publication pull request'],
    [input.publication.sessionRevision, input.request.expectedSessionRevision, 'publication Session'],
    [authorization.repository, input.repository, 'authorization repository'],
    [authorization.prNumber, input.request.prNumber, 'authorization pull request'],
    [authorization.sessionRevision, input.request.expectedSessionRevision, 'authorization Session'],
    [authorization.baseSha, input.request.expectedBaseSha, 'authorization base'],
    [authorization.baseTreeSha, input.request.expectedBaseTreeSha, 'authorization base tree'],
    [authorization.headSha, input.request.expectedHeadSha, 'authorization head'],
    [authorization.headTreeSha, input.request.expectedHeadTreeSha, 'authorization head tree'],
    [authorization.manifestDigest, input.request.manifestDigest, 'authorization manifest'],
    [authorization.actionClosureDigest, input.request.expectedActionPlanDigest, 'authorization Action closure'],
    [authorization.trustRevision, input.request.expectedBaseSha, 'authorization trust revision']
  ];
  for (const [actual, expected, label] of checks) {
    if (actual !== expected) throw new Error(`Durable ${label} differs from the trusted Session request.`);
  }
}

export const HOSTED_INTEGRATION_ROUTE_SCHEMA =
  'sec-verification-session-hosted-integration-route-v1' as const;

type HostedIntegrationRouteCommon = Readonly<{
  schema: typeof HOSTED_INTEGRATION_ROUTE_SCHEMA;
  repository: string;
  prNumber: number;
  sessionRevision: `sha256:${string}`;
  candidateState: GitHubCandidateObservation['state'];
}>;

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

export interface HostedIntegrationEffectPlan {
  prepareRecoveryArtifact: boolean;
  createAuthorizationPublication: boolean;
  executePhysicalMerge: boolean;
  consumeOriginalAuthorizationPublication: boolean;
  consumeOriginalRecoveryArtifact: boolean;
}

/** Pure state router. It owns no provider capability and performs no I/O. */
export function routeHostedIntegration(input: {
  repository: string;
  session: VerificationSession;
  candidate: GitHubCandidateObservation;
  priorEffectStarted: boolean;
  authorizationPublicationCount: number;
}): HostedIntegrationRoute {
  if (!Number.isSafeInteger(input.authorizationPublicationCount)
    || input.authorizationPublicationCount < 0) {
    throw new Error('Hosted integration authorization publication count must be a non-negative safe integer.');
  }
  const common = Object.freeze({ schema: HOSTED_INTEGRATION_ROUTE_SCHEMA,
    repository: input.repository, prNumber: input.session.prNumber,
    sessionRevision: input.session.sessionRevision, candidateState: input.candidate.state });
  const blocked = (reason: Extract<HostedIntegrationRoute, { lane: 'blocked' }>['reason']) => (
    Object.freeze({ ...common, lane: 'blocked' as const, reason })
  );
  if (input.candidate.repository !== input.repository
    || input.candidate.number !== input.session.prNumber
    || input.candidate.headSha !== input.session.headSha
    || input.candidate.headTreeSha !== input.session.headTreeSha) {
    return blocked('candidate-session-identity-drift');
  }
  if (input.candidate.state === 'OPEN') {
    if (input.candidate.baseSha !== input.session.baseSha
      || input.candidate.baseTreeSha !== input.session.baseTreeSha
      || input.candidate.isDraft || input.candidate.isCrossRepository) {
      return blocked('open-candidate-identity-drift');
    }
    if (input.priorEffectStarted || input.authorizationPublicationCount > 0) {
      return blocked('open-prior-effect-started');
    }
    return Object.freeze({ ...common, lane: 'open-first-effect' as const,
      reason: 'exact-open-candidate-without-prior-effect' as const });
  }
  if (input.candidate.state === 'MERGED') {
    if (input.candidate.mergeCommitSha === null || input.candidate.mergeCommitTreeSha === null
      || input.candidate.mergeCommitMessage === null
      || input.candidate.mergeCommitTreeSha !== input.session.headTreeSha) {
      return blocked('merged-readback-incomplete-or-tree-mismatch');
    }
    return Object.freeze({ ...common, lane: 'merged-recovery' as const,
      reason: 'exact-marker-bound-merged-candidate' as const,
      mergeCommitSha: input.candidate.mergeCommitSha,
      mergeCommitTreeSha: input.candidate.mergeCommitTreeSha });
  }
  return blocked('pull-request-closed-without-exact-merge');
}

/** Pure mutation-intent projection consumed by hosted handlers and tests. */
export function planHostedIntegrationEffects(
  route: HostedIntegrationRoute
): Readonly<HostedIntegrationEffectPlan> {
  if (route.lane === 'open-first-effect') {
    return Object.freeze({ prepareRecoveryArtifact: true,
      createAuthorizationPublication: true, executePhysicalMerge: true,
      consumeOriginalAuthorizationPublication: false, consumeOriginalRecoveryArtifact: false });
  }
  if (route.lane === 'merged-recovery') {
    return Object.freeze({ prepareRecoveryArtifact: false,
      createAuthorizationPublication: false, executePhysicalMerge: false,
      consumeOriginalAuthorizationPublication: true, consumeOriginalRecoveryArtifact: true });
  }
  return Object.freeze({ prepareRecoveryArtifact: false,
    createAuthorizationPublication: false, executePhysicalMerge: false,
    consumeOriginalAuthorizationPublication: false, consumeOriginalRecoveryArtifact: false });
}

export function classifyDurableVerificationSessionProjection(input: {
  repository: string;
  request: VerificationSessionHostedRequest;
  candidate: GitHubCandidateObservation;
  publications: readonly Readonly<{
    commentId: number;
    publication: IntegrationAuthorizationOperationPublication;
  }>[];
  closeout?: Readonly<{
    closeoutOperationId: `sha256:${string}`;
    commentId: number;
    status: 'completed' | 'protected-pending' | 'blocked' | 'residue';
  }> | null;
}): Readonly<Record<string, unknown>> | null {
  const { candidate, repository, request, publications } = input;
  if (candidate.repository !== repository || candidate.number !== request.prNumber) {
    throw new Error('Durable Session PR identity differs from the trusted request.');
  }
  if (candidate.state === 'OPEN') {
    if (publications.length > 0) {
      return Object.freeze({ mode: 'remote', status: 'BLOCKED_AMBIGUOUS_SIDE_EFFECT',
        reason: 'an authorization effect-start receipt already exists while the PR is OPEN',
        repository, prNumber: request.prNumber, sessionRevision: request.expectedSessionRevision,
        candidateState: candidate.state,
        authorizationPublications: publications.map(({ publication, commentId }) => Object.freeze({
          authorizationPublicationId: publication.authorizationPublicationId,
          authorizationReceiptDigest: publication.authorizationReceiptDigest, commentId
        })) });
    }
    const exact = candidate.baseSha === request.expectedBaseSha
      && candidate.baseTreeSha === request.expectedBaseTreeSha
      && candidate.headSha === request.expectedHeadSha
      && candidate.headTreeSha === request.expectedHeadTreeSha
      && !candidate.isDraft && !candidate.isCrossRepository;
    if (!exact) {
      return Object.freeze({ mode: 'remote', status: 'BLOCKED',
        reason: 'OPEN candidate repository/base/head/tree identity drifted', repository,
        prNumber: request.prNumber, sessionRevision: request.expectedSessionRevision,
        candidateState: candidate.state });
    }
    return null;
  }
  if (candidate.state !== 'MERGED') {
    return Object.freeze({ mode: 'remote', status: 'BLOCKED',
      reason: 'pull request is closed without one marker-bound verified merge', repository,
      prNumber: request.prNumber, sessionRevision: request.expectedSessionRevision,
      candidateState: candidate.state });
  }
  if (candidate.headSha !== request.expectedHeadSha
    || candidate.headTreeSha !== request.expectedHeadTreeSha
    || candidate.mergeCommitSha === null || candidate.mergeCommitTreeSha === null
    || candidate.mergeCommitMessage === null) {
    throw new Error('Durable MERGED Session readback is partial or differs from the trusted candidate.');
  }
  const selected = selectMergedAuthorizationPublication({ candidate,
    sessionRevision: request.expectedSessionRevision, publications });
  assertAuthorizationPublicationMatchesRequest({ publication: selected.publication, request, repository });
  if (candidate.mergeCommitTreeSha !== request.expectedHeadTreeSha) {
    return Object.freeze({ mode: 'remote', status: 'BLOCKED',
      reason: 'merged tree differs from verified candidate tree', repository,
      prNumber: request.prNumber, sessionRevision: request.expectedSessionRevision,
      candidateState: candidate.state, mergeCommitSha: candidate.mergeCommitSha,
      mergeCommitTreeSha: candidate.mergeCommitTreeSha });
  }
  const binding = createBranchCloseoutOperationBinding({
    integrationAuthorization: selected.publication.result.authorization,
    preparation: selected.publication.closeoutPreparation.preparation,
    newMainSha: candidate.mergeCommitSha, newMainTreeSha: candidate.mergeCommitTreeSha,
    candidateTreeSha: request.expectedHeadTreeSha
  });
  if (input.closeout !== undefined && input.closeout !== null
    && input.closeout.closeoutOperationId !== binding.closeoutOperationId) {
    throw new Error('Durable closeout publication belongs to a different operation binding.');
  }
  const closeoutStatus = input.closeout?.status ?? null;
  return Object.freeze({ mode: 'remote', status: closeoutStatus === 'completed'
    || closeoutStatus === 'protected-pending' ? 'COMPLETED'
    : closeoutStatus === 'blocked' || closeoutStatus === 'residue' ? 'BLOCKED' : 'READY_TO_CLOSEOUT',
    reason: closeoutStatus === null ? 'marker-bound merge awaits canonical closeout publication' : null,
    durableSource: 'github-app-comments-and-merge-marker', repository,
    prNumber: request.prNumber, sessionRevision: request.expectedSessionRevision,
    candidateState: candidate.state, mergeCommitSha: candidate.mergeCommitSha,
    mergeCommitTreeSha: candidate.mergeCommitTreeSha,
    authorizationPublicationId: selected.publication.authorizationPublicationId,
    authorizationCommentId: selected.commentId, closeoutOperationId: binding.closeoutOperationId,
    closeoutCommentId: input.closeout?.commentId ?? null, closeoutStatus });
}
