/** VerificationSession physical owner recovered from current-main semantics. */
import { decodeBranchLifecycleChildError, decodeBranchLifecycleChildStdout } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-command.ts';
import type { IntegrationAuthorizationOperationPublication } from '../../../../self-hosting/control/integration/integration-authorization-publication.ts';
import { assertCanonicalMergeMessage } from '../../../../self-hosting/control/integration/merge-gate.ts';
import { type IssueDispositionPlan, parseGitHubClosingKeywordOccurrences } from '../../../../self-hosting/control/issues/disposition.ts';
import { renderIndependentReviewTrailer, type ReviewStabilityReceipt } from '../../review/contract/stability.ts';
import type { VerificationSessionScope } from '../contract/session-scope.ts';
import { runVerificationSessionCommand } from './session-local-repository.ts';
import type { GitHubCandidateObservation } from './verification-session-github.ts';
import { integrationMergeMarkers } from './verification-session-runtime.ts';

export function assertHostedSquashMergeCompletion(input: {
  candidate: GitHubCandidateObservation;
  expectedBaseSha: string;
  expectedHeadSha: string;
  expectedHeadTreeSha: string;
  markers: readonly string[];
  reviewReceipt: ReviewStabilityReceipt;
  expectedTitle: string;
  providerMergeCommitSha?: string | null;
}): void {
  const { candidate } = input;
  if (candidate.state !== 'MERGED') {
    throw new Error(
      `hosted exact-head squash merge is not physically complete: candidate state is ${candidate.state}; `
      + 'merge-queue enqueue is not integration success.'
    );
  }
  if (candidate.headSha !== input.expectedHeadSha
    || candidate.headTreeSha !== input.expectedHeadTreeSha
    || candidate.mergeCommitSha === null
    || candidate.mergeCommitTreeSha !== input.expectedHeadTreeSha
    || candidate.mergeCommitMessage === null) {
    throw new Error('hosted exact-head squash merge completed with a mismatched head or merge tree.');
  }
  if (candidate.baseSha !== input.expectedBaseSha
    || candidate.mergeCommitParentShas?.length !== 1
    || candidate.mergeCommitParentShas[0] !== input.expectedBaseSha) {
    throw new Error('exact-head squash merge parent does not equal the verified base.');
  }
  const messageLines = candidate.mergeCommitMessage.split(/\r?\n/u);
  if (!input.markers.every((marker) => messageLines.includes(marker))) {
    throw new Error('hosted exact-head squash merge completed without the exact authorization markers.');
  }
  assertCanonicalMergeMessage({ authorizationMarkers: input.markers,
    reviewReceipt: input.reviewReceipt, expectedTitle: input.expectedTitle,
    message: candidate.mergeCommitMessage });
  if (input.providerMergeCommitSha !== undefined && input.providerMergeCommitSha !== null
    && candidate.mergeCommitSha !== input.providerMergeCommitSha) {
    throw new Error('hosted exact-head squash merge provider response does not match the merge commit readback.');
  }
}

export interface HostedSynchronousSquashMergeResponse {
  readonly merged: true;
  readonly sha: string;
  readonly message: string;
}

export function parseHostedSynchronousSquashMergeResponse(
  source: string
): HostedSynchronousSquashMergeResponse {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('hosted synchronous squash merge response is not valid JSON.');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('hosted synchronous squash merge response must be one object.');
  }
  const record = value as Record<string, unknown>;
  if (record.merged !== true || typeof record.sha !== 'string'
    || !/^[0-9a-f]{40}$/u.test(record.sha) || typeof record.message !== 'string') {
    throw new Error('hosted synchronous squash merge response does not prove one physical merge commit.');
  }
  return Object.freeze({ merged: true, sha: record.sha, message: record.message });
}

export function executeHostedSquashMerge(input: {
  ctx: VerificationSessionScope;
  repository: string;
  prNumber: number;
  headSha: string;
  sessionRevision: `sha256:${string}`;
  publication: IntegrationAuthorizationOperationPublication;
  commentId: number;
  issueDispositionPlan: IssueDispositionPlan;
}): HostedSynchronousSquashMergeResponse {
  const authorization = input.publication.result.authorization;
  const authorizationMarkers = integrationMergeMarkers({
    sessionRevision: input.sessionRevision,
    authorizationId: authorization.authorizationId,
    authorizationReceiptDigest: authorization.receiptDigest,
    consumptionOperationId: authorization.consumptionOperationId as `sha256:${string}`,
    authorizationPublicationId: input.publication.authorizationPublicationId,
    authorizationPublicationDigest: input.publication.publicationDigest,
    commentId: input.commentId
  });
  const reviewTrailer = renderIndependentReviewTrailer(input.publication.result.reviewReceipt);
  const issueMarkers = [
    `Issue-Disposition-Plan: ${input.issueDispositionPlan.planDigest}`,
    `Issue-Disposition-Mode: ${input.issueDispositionPlan.mode}`,
    `Issue-Disposition-Tracking: ${input.issueDispositionPlan.trackingIssueNumber ?? 'none'}`,
    `Issue-Disposition-Prose: ${input.issueDispositionPlan.titleBodyDigest}`
  ];
  const markers = [...authorizationMarkers, ...issueMarkers, reviewTrailer];
  const commitTitle = `Verified integration ${input.sessionRevision.slice(7, 19)}`;
  if (parseGitHubClosingKeywordOccurrences(
    `${commitTitle}\n${markers.join('\n')}`,
    input.repository
  ).length > 0) {
    throw new Error('Canonical merge renderer produced a forbidden GitHub closing-keyword pattern.');
  }
  const request = JSON.stringify({
    sha: input.headSha,
    merge_method: 'squash',
    commit_title: commitTitle,
    commit_message: markers.join('\n')
  });
  const result = runVerificationSessionCommand(input.ctx, 'gh', [
    'api', '--method', 'PUT',
    `/repos/${input.repository}/pulls/${input.prNumber}/merge`,
    '--input', '-'
  ], input.ctx.repositoryRoot, request);
  if (result.status !== 0) {
    throw new Error(
      `hosted synchronous exact-head squash merge failed: ${decodeBranchLifecycleChildError(result)}`
    );
  }
  return parseHostedSynchronousSquashMergeResponse(decodeBranchLifecycleChildStdout(result));
}

/**
 * Authority-bearing Review-provider revalidation operation.
 *
 * CLI command selection is deliberately outside this function. The operation
 * re-derives live PR identity, viewer authority, provider negative state,
 * exact comment publication/readback, candidate stability, and the selected
 * provider epoch before it returns a revalidation receipt.
 */
