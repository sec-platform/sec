/** VerificationSession physical owner recovered from current-main semantics. */
import type { BranchCloseoutOperationReceipt } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout-contract.ts';
import { assertBranchCloseoutEffectStartMatches, assertHostedCommentProvenanceLive, type BranchCloseoutEffectStartPublication, type BranchCloseoutOperationPublication, createBranchCloseoutOperationPublication, hostedPublisherMatches, type HostedWorkflowCommentProvenance, issueCommentRecord, observeBranchCloseoutEffectStartPublication, observeBranchCloseoutOperationPublication, parseBranchCloseoutEffectStartPublicationComment, parseBranchCloseoutOperationPublicationComment, renderBranchCloseoutEffectStartPublicationComment, renderBranchCloseoutOperationPublicationComment } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout-receipt.ts';
import { decodeBranchLifecycleChildError, decodeBranchLifecycleChildStdout } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-command.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import type { VerificationSessionScope } from '../contract/session-scope.ts';
import { runVerificationSessionCommand } from './session-local-repository.ts';
import { createHash } from 'node:crypto';

export type HostedCloseoutEffectStartReadback = Readonly<{
  disposition: 'published' | 'existing';
  publication: BranchCloseoutEffectStartPublication;
  commentId: number;
}>;

export function publishHostedCloseoutEffectStart(
  ctx: VerificationSessionScope,
  publication: BranchCloseoutEffectStartPublication
): HostedCloseoutEffectStartReadback {
  const existing = observeBranchCloseoutEffectStartPublication(ctx.repositoryRoot, {
    repository: publication.binding.repository,
    pullRequestNumber: publication.binding.pullRequestNumber,
    closeoutOperationId: publication.closeoutOperationId
  });
  if (existing !== null) {
    assertBranchCloseoutEffectStartMatches({
      publication: existing.publication,
      binding: publication.binding,
      authorizationPublication: publication.authorizationPublication,
      recoveryArtifact: publication.recoveryArtifact
    });
    return Object.freeze({ disposition: 'existing', ...existing });
  }

  const endpoint = `/repos/${publication.binding.repository}`
    + `/issues/${publication.binding.pullRequestNumber}/comments`;
  const body = renderBranchCloseoutEffectStartPublicationComment(publication);
  const posted = runVerificationSessionCommand(ctx, 'gh', [
    'api', '-X', 'POST', endpoint, '-f', `body=${body}`
  ]);
  if (posted.status !== 0) {
    throw new Error(
      `AMBIGUOUS_SIDE_EFFECT: closeout effect-start POST outcome is unknown: ${decodeBranchLifecycleChildError(posted)}`
    );
  }

  let created;
  try {
    created = issueCommentRecord(
      JSON.parse(decodeBranchLifecycleChildStdout(posted)),
      'created hosted closeout effect-start comment'
    );
    if (created.body !== body || !hostedPublisherMatches(created)) {
      throw new Error('created effect-start bytes or App identity differ');
    }
    assertHostedCommentProvenanceLive(
      ctx.repositoryRoot,
      publication.binding.repository,
      created,
      publication.provenance
    );
  } catch (error) {
    throw new Error(
      `AMBIGUOUS_SIDE_EFFECT: closeout effect-start POST response is not authoritative: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const exact = runVerificationSessionCommand(ctx, 'gh', [
    'api',
    `/repos/${publication.binding.repository}/issues/comments/${created.id}`
  ]);
  if (exact.status !== 0) {
    throw new Error(
      `AMBIGUOUS_SIDE_EFFECT: closeout effect-start exact readback failed: ${decodeBranchLifecycleChildError(exact)}`
    );
  }
  try {
    const comment = issueCommentRecord(
      JSON.parse(decodeBranchLifecycleChildStdout(exact)),
      'hosted closeout effect-start exact readback'
    );
    const parsed = parseBranchCloseoutEffectStartPublicationComment(comment.body);
    if (comment.id !== created.id || !hostedPublisherMatches(comment)
      || parsed === null || parsed.publicationDigest !== publication.publicationDigest
      || comment.body !== body) {
      throw new Error('effect-start exact readback differs from the canonical publication');
    }
    assertHostedCommentProvenanceLive(
      ctx.repositoryRoot,
      publication.binding.repository,
      comment,
      parsed.provenance
    );
  } catch (error) {
    throw new Error(
      `AMBIGUOUS_SIDE_EFFECT: closeout effect-start exact readback is not authoritative: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const complete = observeBranchCloseoutEffectStartPublication(ctx.repositoryRoot, {
    repository: publication.binding.repository,
    pullRequestNumber: publication.binding.pullRequestNumber,
    closeoutOperationId: publication.closeoutOperationId
  });
  if (complete === null || complete.commentId !== created.id
    || complete.publication.publicationDigest !== publication.publicationDigest) {
    throw new Error(
      'AMBIGUOUS_SIDE_EFFECT: closeout effect-start is not unique in complete provider inventory.'
    );
  }
  return Object.freeze({ disposition: 'published', ...complete });
}

export function publishHostedCloseoutTerminal(input: Readonly<{
  ctx: VerificationSessionScope;
  operationReceipt: BranchCloseoutOperationReceipt;
  provenance: HostedWorkflowCommentProvenance;
  effectStart: HostedCloseoutEffectStartReadback;
}>): Readonly<{
  disposition: 'published' | 'reused' | 'recovered';
  publication: BranchCloseoutOperationPublication;
  commentId: number;
}> {
  const publication = createBranchCloseoutOperationPublication(
    input.operationReceipt,
    input.provenance,
    input.effectStart
  );
  const repository = publication.binding.repository;
  const pullRequestNumber = publication.binding.pullRequestNumber;
  const existing = observeBranchCloseoutOperationPublication(input.ctx.repositoryRoot, {
    repository,
    pullRequestNumber,
    closeoutOperationId: publication.closeoutOperationId
  });
  if (existing !== null) {
    if (existing.publication.publicationDigest !== publication.publicationDigest) {
      throw new Error('Existing closeout terminal differs from the canonical operation bytes.');
    }
    return Object.freeze({ disposition: 'reused', ...existing });
  }
  const start = observeBranchCloseoutEffectStartPublication(input.ctx.repositoryRoot, {
    repository,
    pullRequestNumber,
    closeoutOperationId: publication.closeoutOperationId
  });
  if (start === null || start.commentId !== publication.effectStart.commentId
    || start.publication.effectStartId !== publication.effectStart.effectStartId
    || start.publication.publicationDigest !== publication.effectStart.publicationDigest) {
    throw new Error(
      'Hosted closeout terminal requires exactly one matching App-authenticated effect-start marker.'
    );
  }

  const endpoint = `/repos/${repository}/issues/${pullRequestNumber}/comments`;
  const body = renderBranchCloseoutOperationPublicationComment(publication);
  const recover = (reason: string): Readonly<{
    disposition: 'recovered';
    publication: BranchCloseoutOperationPublication;
    commentId: number;
  }> => {
    const observed = observeBranchCloseoutOperationPublication(input.ctx.repositoryRoot, {
      repository,
      pullRequestNumber,
      closeoutOperationId: publication.closeoutOperationId
    });
    if (observed === null
      || observed.publication.publicationDigest !== publication.publicationDigest) {
      throw new Error(`AMBIGUOUS_SIDE_EFFECT: ${reason}; terminal inventory has no exact recovery.`);
    }
    return Object.freeze({ disposition: 'recovered', ...observed });
  };
  const posted = runVerificationSessionCommand(input.ctx, 'gh', [
    'api', '-X', 'POST', endpoint, '-f', `body=${body}`
  ]);
  if (posted.status !== 0) {
    return recover(
      `closeout terminal POST outcome is unknown: ${decodeBranchLifecycleChildError(posted)}`
    );
  }
  let created;
  try {
    created = issueCommentRecord(
      JSON.parse(decodeBranchLifecycleChildStdout(posted)),
      'created closeout terminal comment'
    );
    const parsed = parseBranchCloseoutOperationPublicationComment(created.body);
    if (created.body !== body || !hostedPublisherMatches(created)
      || parsed === null || parsed.publicationDigest !== publication.publicationDigest) {
      throw new Error('created terminal bytes or App identity differ');
    }
    assertHostedCommentProvenanceLive(
      input.ctx.repositoryRoot,
      repository,
      created,
      parsed.provenance
    );
  } catch (error) {
    return recover(
      `closeout terminal POST response is not authoritative: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const exact = runVerificationSessionCommand(input.ctx, 'gh', [
    'api', `/repos/${repository}/issues/comments/${created.id}`
  ]);
  if (exact.status !== 0) {
    return recover(
      `closeout terminal exact readback failed: ${decodeBranchLifecycleChildError(exact)}`
    );
  }
  try {
    const comment = issueCommentRecord(
      JSON.parse(decodeBranchLifecycleChildStdout(exact)),
      'closeout terminal exact readback'
    );
    const parsed = parseBranchCloseoutOperationPublicationComment(comment.body);
    if (comment.id !== created.id || comment.body !== body || !hostedPublisherMatches(comment)
      || parsed === null || parsed.publicationDigest !== publication.publicationDigest) {
      throw new Error('terminal exact readback differs from canonical bytes');
    }
    assertHostedCommentProvenanceLive(
      input.ctx.repositoryRoot,
      repository,
      comment,
      parsed.provenance
    );
  } catch (error) {
    return recover(
      `closeout terminal exact readback is not authoritative: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const complete = observeBranchCloseoutOperationPublication(input.ctx.repositoryRoot, {
    repository,
    pullRequestNumber,
    closeoutOperationId: publication.closeoutOperationId
  });
  if (complete === null || complete.commentId !== created.id
    || complete.publication.publicationDigest !== publication.publicationDigest) {
    throw new Error('AMBIGUOUS_SIDE_EFFECT: closeout terminal is not unique in complete provider inventory.');
  }
  return Object.freeze({ disposition: 'published', ...complete });
}

export function closeoutPublicationCompositeDigest(input: {
  closeoutOperationId: `sha256:${string}`;
  publicationDigest: `sha256:${string}`;
  commentId: number;
}): `sha256:${string}` {
  if (!Number.isSafeInteger(input.commentId) || input.commentId < 1) {
    throw new Error('Closeout publication comment id must be a positive safe integer.');
  }
  return `sha256:${createHash('sha256').update(encodeVerificationActionData(input)).digest('hex')}`;
}
