/** VerificationSession physical owner recovered from current-main semantics. */
import { CompilerError } from '../../../../../compiler/errors.ts';
import { decodeBranchLifecycleChildError, decodeBranchLifecycleChildStdout } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-command.ts';
import type { VerificationSessionScope } from '../contract/session-scope.ts';
import { requireVerificationSessionCommandText, runVerificationSessionCommand } from './session-local-repository.ts';
import { createReviewProviderRevalidationCommentBody, type VerificationSessionGitHubClient } from './verification-session-github.ts';

export function apiRecord(ctx: VerificationSessionScope, endpoint: string, label: string): Record<string, any> {
  const source = requireVerificationSessionCommandText(
    ctx,
    'gh',
    ['api', endpoint],
    label,
    ctx.repositoryRoot
  );
  const value: unknown = JSON.parse(source);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must return one object.`);
  }
  return value as Record<string, any>;
}

export function ensureHostedReviewLocator(
  ctx: VerificationSessionScope,
  github: VerificationSessionGitHubClient,
  input: Readonly<{
    repository: string;
    prNumber: number;
    sessionRevision: `sha256:${string}`;
    operationId: `sha256:${string}`;
    headSha: string;
    headTreeSha: string;
    sourceRunId: string;
    sourceRunAttempt: number;
    workflowRef: string;
  }>
): Readonly<{
  status: 'published' | 'reused';
  commentId: string;
  publicationDigest: `sha256:${string}`;
}> {
  const observed = github.observeHostedReviewLocator(input);
  if (observed.status === 'reused') {
    if (observed.commentId === null) {
      throw new Error('Hosted Review locator reuse has no comment identity.');
    }
    return Object.freeze({
      status: 'reused' as const,
      commentId: observed.commentId,
      publicationDigest: observed.publicationDigest
    });
  }
  const posted = runVerificationSessionCommand(ctx, 'gh', [
    'api',
    '-X',
    'POST',
    `/repos/${input.repository}/issues/${input.prNumber}/comments`,
    '-f',
    `body=${observed.body}`
  ]);
  if (posted.status !== 0) {
    throw new Error(
      `AMBIGUOUS_SIDE_EFFECT: hosted Review locator POST outcome is unknown: ${decodeBranchLifecycleChildError(posted)}`
    );
  }
  let commentId: string;
  try {
    const response: unknown = JSON.parse(decodeBranchLifecycleChildStdout(posted));
    if (!response || typeof response !== 'object' || Array.isArray(response)
      || !Number.isSafeInteger((response as Record<string, unknown>).id)
      || Number((response as Record<string, unknown>).id) <= 0) {
      throw new Error('created comment has no positive id');
    }
    commentId = String((response as Record<string, unknown>).id);
  } catch (error) {
    throw new Error(
      `AMBIGUOUS_SIDE_EFFECT: hosted Review locator POST response is invalid: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const exact = runVerificationSessionCommand(ctx, 'gh', [
    'api',
    `/repos/${input.repository}/issues/comments/${commentId}`
  ]);
  if (exact.status !== 0) {
    throw new Error(
      `AMBIGUOUS_SIDE_EFFECT: hosted Review locator exact readback failed: ${decodeBranchLifecycleChildError(exact)}`
    );
  }
  const complete = github.observeHostedReviewLocator(input);
  if (complete.status !== 'reused' || complete.commentId !== commentId
    || complete.publicationDigest !== observed.publicationDigest) {
    throw new Error(
      'AMBIGUOUS_SIDE_EFFECT: hosted Review locator is not unique after complete readback.'
    );
  }
  return Object.freeze({
    status: 'published' as const,
    commentId,
    publicationDigest: complete.publicationDigest
  });
}

export function ensureMaintainerReviewWakeup(
  ctx: VerificationSessionScope,
  github: VerificationSessionGitHubClient,
  input: Readonly<{
    repository: string;
    prNumber: number;
    sessionRevision: `sha256:${string}`;
    operationId: `sha256:${string}`;
    requestOperationId: `sha256:${string}`;
    headSha: string;
    headTreeSha: string;
    publisherLogin: string;
    publisherNodeId: string;
  }>
): Readonly<{
  status: 'published' | 'reused';
  commentId: string;
  wakeupDigest: `sha256:${string}`;
}> {
  const observed = github.observeMaintainerReviewWakeup(input);
  if (observed.status === 'reused') {
    if (observed.commentId === null) throw new Error('Maintainer Review wake-up reuse has no comment identity.');
    return Object.freeze({ status: 'reused' as const, commentId: observed.commentId,
      wakeupDigest: observed.wakeupDigest });
  }
  const providerNow = new Date().toISOString();
  const providerAvailability = github.observeReviewProviderAvailability({
    repository: input.repository,
    prNumber: input.prNumber,
    headSha: input.headSha,
    headTreeSha: input.headTreeSha,
    observedAt: providerNow
  });
  if (providerAvailability.status === 'unavailable') {
    throw new CompilerError(
      'PROVIDER-UNAVAILABLE-NOT-RETRIED',
      'Provider codex-review is unavailable and must not be retried without an exact target-bound revalidation receipt.',
      {
        capability: 'codex-review',
        reasonCode: providerAvailability.reasonCode,
        receiptRef: providerAvailability.receiptRef,
        sourceCommentId: providerAvailability.sourceCommentId,
        sourceObservedAt: providerAvailability.sourceObservedAt,
        censusDigest: providerAvailability.censusDigest
      }
    );
  }
  if (providerAvailability.status === 'unresolved') {
    throw new CompilerError(
      'PROVIDER-AVAILABILITY-UNRESOLVED',
      `Provider codex-review availability census is unresolved: ${providerAvailability.reason}.`,
      {
        capability: 'codex-review',
        reason: providerAvailability.reason,
        censusDigest: providerAvailability.censusDigest
      }
    );
  }
  const effectBoundaryNow = new Date().toISOString();
  const effectBoundaryAvailability = github.observeReviewProviderAvailability({
    repository: input.repository,
    prNumber: input.prNumber,
    headSha: input.headSha,
    headTreeSha: input.headTreeSha,
    observedAt: effectBoundaryNow
  });
  if (effectBoundaryAvailability.status === 'unavailable') {
    throw new CompilerError(
      'PROVIDER-UNAVAILABLE-NOT-RETRIED',
      'Provider codex-review became unavailable before wake-up publication; a new target-bound revalidation receipt is required.',
      {
        capability: 'codex-review',
        reasonCode: effectBoundaryAvailability.reasonCode,
        receiptRef: effectBoundaryAvailability.receiptRef,
        sourceCommentId: effectBoundaryAvailability.sourceCommentId,
        sourceObservedAt: effectBoundaryAvailability.sourceObservedAt,
        censusDigest: effectBoundaryAvailability.censusDigest
      }
    );
  }
  if (effectBoundaryAvailability.status === 'unresolved'
      || effectBoundaryAvailability.censusDigest !== providerAvailability.censusDigest) {
    throw new CompilerError(
      'PROVIDER-AVAILABILITY-UNRESOLVED',
      'Provider codex-review availability changed before wake-up publication.',
      {
        capability: 'codex-review',
        initialCensusDigest: providerAvailability.censusDigest,
        effectBoundaryCensusDigest: effectBoundaryAvailability.censusDigest,
        effectBoundaryStatus: effectBoundaryAvailability.status,
        ...(effectBoundaryAvailability.status === 'unresolved'
          ? { reason: effectBoundaryAvailability.reason }
          : {})
      }
    );
  }
  const posted = runVerificationSessionCommand(ctx, 'gh', [
    'api',
    '-X',
    'POST',
    `/repos/${input.repository}/issues/${input.prNumber}/comments`,
    '-f',
    `body=${observed.body}`
  ]);
  if (posted.status !== 0) {
    throw new Error(
      `AMBIGUOUS_SIDE_EFFECT: maintainer Review wake-up POST outcome is unknown: ${decodeBranchLifecycleChildError(posted)}`
    );
  }
  let commentId: string;
  try {
    const response: unknown = JSON.parse(decodeBranchLifecycleChildStdout(posted));
    if (!response || typeof response !== 'object' || Array.isArray(response)
      || !Number.isSafeInteger((response as Record<string, unknown>).id)
      || Number((response as Record<string, unknown>).id) <= 0) {
      throw new Error('created comment has no positive id');
    }
    commentId = String((response as Record<string, unknown>).id);
  } catch (error) {
    throw new Error(
      `AMBIGUOUS_SIDE_EFFECT: maintainer Review wake-up POST response is invalid: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const exact = runVerificationSessionCommand(ctx, 'gh', [
    'api',
    `/repos/${input.repository}/issues/comments/${commentId}`
  ]);
  if (exact.status !== 0) {
    throw new Error(
      `AMBIGUOUS_SIDE_EFFECT: maintainer Review wake-up exact readback failed: ${decodeBranchLifecycleChildError(exact)}`
    );
  }
  const complete = github.observeMaintainerReviewWakeup(input);
  if (complete.status !== 'reused' || complete.commentId !== commentId
    || complete.wakeupDigest !== observed.wakeupDigest) {
    throw new Error('AMBIGUOUS_SIDE_EFFECT: maintainer Review wake-up is not unique after complete readback.');
  }
  return Object.freeze({ status: 'published' as const, commentId,
    wakeupDigest: complete.wakeupDigest });
}

export function executeReviewProviderRevalidation(input: Readonly<{
  ctx: VerificationSessionScope;
  github: VerificationSessionGitHubClient;
  repository: string;
  prNumber: number;
  now: () => string;
}>): string {
  const prNumber = Number(String(input.prNumber));
  if (!Number.isSafeInteger(prNumber) || prNumber < 1) throw new Error('--pr must be a positive integer.');
  const github = input.github;
  const candidate = github.observeCandidate(input.repository, prNumber);
  if (candidate.state !== 'OPEN' || candidate.isDraft || candidate.isCrossRepository) {
    throw new Error('Review provider revalidation requires one open same-repository non-draft PR.');
  }
  const viewer = github.observeViewerPrincipal(input.repository);
  if (viewer.permission !== 'admin' && viewer.permission !== 'maintain') {
    throw new Error('Review provider revalidation requires current maintain/admin authority.');
  }
  const target = {
    repository: input.repository,
    prNumber,
    headSha: candidate.headSha,
    headTreeSha: candidate.headTreeSha
  } as const;
  const before = github.observeReviewProviderAvailability({ ...target, observedAt: input.now() });
  if (before.status === 'unresolved') {
    throw new CompilerError('PROVIDER-AVAILABILITY-UNRESOLVED',
      `Provider codex-review availability census is unresolved: ${before.reason}.`,
      { capability: 'codex-review', reason: before.reason, censusDigest: before.censusDigest });
  }
  if (before.status === 'no-current-negative') {
    return JSON.stringify({ status: 'revalidation-not-required', ...target,
      availabilityCensusDigest: before.censusDigest }, null, 2);
  }
  const rendered = createReviewProviderRevalidationCommentBody({
    ...target,
    publisherNodeId: viewer.nodeId
  });
  const posted = runVerificationSessionCommand(input.ctx, 'gh', [
    'api', '-X', 'POST',
    `/repos/${input.repository}/issues/${prNumber}/comments`,
    '-f', `body=${rendered.body}`
  ]);
  if (posted.status !== 0) {
    throw new Error(`AMBIGUOUS_SIDE_EFFECT: Review provider revalidation POST outcome is unknown: ${decodeBranchLifecycleChildError(posted)}`);
  }
  const response: unknown = JSON.parse(decodeBranchLifecycleChildStdout(posted));
  if (!response || typeof response !== 'object' || Array.isArray(response)
      || !Number.isSafeInteger((response as Record<string, unknown>).id)
      || Number((response as Record<string, unknown>).id) < 1) {
    throw new Error('AMBIGUOUS_SIDE_EFFECT: Review provider revalidation POST returned no exact comment identity.');
  }
  const commentId = String((response as Record<string, unknown>).id);
  const exact = runVerificationSessionCommand(input.ctx, 'gh', [
    'api', `/repos/${input.repository}/issues/comments/${commentId}`
  ]);
  if (exact.status !== 0) {
    throw new Error('AMBIGUOUS_SIDE_EFFECT: Review provider revalidation exact readback failed.');
  }
  const readback: unknown = JSON.parse(decodeBranchLifecycleChildStdout(exact));
  if (!readback || typeof readback !== 'object' || Array.isArray(readback)
      || String((readback as Record<string, unknown>).id) !== commentId
      || (readback as Record<string, unknown>).body !== rendered.body) {
    throw new Error('AMBIGUOUS_SIDE_EFFECT: Review provider revalidation exact readback differs.');
  }
  const candidateAfter = github.observeCandidate(input.repository, prNumber);
  if (candidateAfter.state !== 'OPEN' || candidateAfter.headSha !== target.headSha
      || candidateAfter.headTreeSha !== target.headTreeSha) {
    throw new Error('Review provider revalidation target drifted during publication.');
  }
  const after = github.observeReviewProviderAvailability({ ...target, observedAt: input.now() });
  if (after.status !== 'no-current-negative'
      || after.revalidationCommentId !== commentId
      || after.revalidationDigest !== rendered.revalidationDigest) {
    throw new Error('Review provider revalidation was not durably selected as the current target epoch.');
  }
  return JSON.stringify({ status: 'revalidated-for-single-probe', ...target,
    commentId, revalidationDigest: rendered.revalidationDigest,
    availabilityCensusDigest: after.censusDigest }, null, 2);

}
