/** VerificationSession physical owner recovered from current-main semantics. */
import { assertHostedCommentProvenanceLive, hostedPublisherMatches, issueCommentRecord } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout-receipt.ts';
import { decodeBranchLifecycleChildError, decodeBranchLifecycleChildStdout } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-command.ts';
import { type IntegrationAuthorizationOperationPublication, observeIntegrationAuthorizationOperationPublications, parseIntegrationAuthorizationOperationPublication, parseIntegrationAuthorizationOperationPublicationComment, renderIntegrationAuthorizationOperationPublicationComment } from '../../../../self-hosting/control/integration/integration-authorization-publication.ts';
import type { VerificationSessionScope } from '../contract/session-scope.ts';
import { runVerificationSessionCommand } from './session-local-repository.ts';

type HostedIntegrationAuthorizationPublicationResult = Readonly<{
  publication: IntegrationAuthorizationOperationPublication | null;
  commentId: number | null;
  status: 'published' | 'reused' | 'failed';
  /** True only after this invocation receives created bytes and exact provider readback. */
  createdByThisInvocation: boolean;
  detail: string;
}>;

function readBackHostedIntegrationAuthorizationComment(
  ctx: VerificationSessionScope,
  publication: IntegrationAuthorizationOperationPublication,
  commentId: number
): IntegrationAuthorizationOperationPublication {
  const result = runVerificationSessionCommand(ctx, 'gh', [
    'api', `/repos/${publication.repository}/issues/comments/${commentId}`
  ]);
  if (result.status !== 0) {
    throw new Error(
      `integration authorization comment readback failed: ${decodeBranchLifecycleChildError(result)}`
    );
  }
  const comment = issueCommentRecord(
    JSON.parse(decodeBranchLifecycleChildStdout(result)),
    'integration authorization comment readback'
  );
  if (comment.id !== commentId || !hostedPublisherMatches(comment)) {
    throw new Error('Integration authorization comment readback identity/app mismatch.');
  }
  const parsed = parseIntegrationAuthorizationOperationPublicationComment(comment.body);
  if (parsed === null || parsed.authorizationPublicationId !== publication.authorizationPublicationId
    || parsed.publicationDigest !== publication.publicationDigest) {
    throw new Error('Integration authorization comment readback canonical bytes differ.');
  }
  assertHostedCommentProvenanceLive(
    ctx.repositoryRoot,
    publication.repository,
    comment,
    parsed.provenance
  );
  return parsed;
}

export function publishHostedIntegrationAuthorizationOperation(
  ctx: VerificationSessionScope,
  publicationInput: IntegrationAuthorizationOperationPublication
): HostedIntegrationAuthorizationPublicationResult {
  const publication = parseIntegrationAuthorizationOperationPublication(publicationInput);
  let inventory: readonly Readonly<{
    commentId: number;
    publication: IntegrationAuthorizationOperationPublication;
  }>[];
  try {
    inventory = observeIntegrationAuthorizationOperationPublications(ctx.repositoryRoot, {
      repository: publication.repository,
      pullRequestNumber: publication.pullRequestNumber,
      sessionRevision: publication.sessionRevision
    });
  } catch (error) {
    return Object.freeze({ publication: null, commentId: null, status: 'failed',
      createdByThisInvocation: false,
      detail: error instanceof Error ? error.message : String(error) });
  }
  const same = inventory.filter(({ publication: observed }) => (
    observed.authorizationPublicationId === publication.authorizationPublicationId
  ));
  if (same.length > 1) {
    return Object.freeze({ publication: null, commentId: null, status: 'failed',
      createdByThisInvocation: false,
      detail: 'Duplicate comments exist for one authorization publication.' });
  }
  if (same.length === 1) {
    if (same[0]!.publication.publicationDigest !== publication.publicationDigest) {
      return Object.freeze({ publication: null, commentId: same[0]!.commentId, status: 'failed',
        createdByThisInvocation: false,
        detail: 'Authorization publication id exists with different canonical bytes.' });
    }
    try {
      const readback = readBackHostedIntegrationAuthorizationComment(
        ctx,
        publication,
        same[0]!.commentId
      );
      return Object.freeze({ publication: readback, commentId: same[0]!.commentId,
        status: 'reused', createdByThisInvocation: false,
        detail: `reused authorization publication ${publication.authorizationPublicationId}` });
    } catch (error) {
      return Object.freeze({ publication: null, commentId: same[0]!.commentId, status: 'failed',
        createdByThisInvocation: false,
        detail: error instanceof Error ? error.message : String(error) });
    }
  }

  const endpoint = `/repos/${publication.repository}/issues/${publication.pullRequestNumber}/comments`;
  const body = renderIntegrationAuthorizationOperationPublicationComment(publication);
  const posted = runVerificationSessionCommand(ctx, 'gh', [
    'api', '-X', 'POST', endpoint, '-f', `body=${body}`
  ]);
  if (posted.status !== 0) {
    return Object.freeze({ publication: null, commentId: null, status: 'failed',
      createdByThisInvocation: false,
      detail: `authorization publication failed without retry: ${decodeBranchLifecycleChildError(posted)}` });
  }
  try {
    const created = issueCommentRecord(
      JSON.parse(decodeBranchLifecycleChildStdout(posted)),
      'created authorization comment'
    );
    if (created.body !== body || !hostedPublisherMatches(created)) {
      throw new Error('created authorization comment bytes/app differ');
    }
    const readback = readBackHostedIntegrationAuthorizationComment(ctx, publication, created.id);
    const complete = observeIntegrationAuthorizationOperationPublications(ctx.repositoryRoot, {
      repository: publication.repository,
      pullRequestNumber: publication.pullRequestNumber,
      sessionRevision: publication.sessionRevision
    }).filter(({ publication: observed }) => (
      observed.authorizationPublicationId === publication.authorizationPublicationId
    ));
    if (complete.length !== 1 || complete[0]!.commentId !== created.id) {
      throw new Error('authorization publication is not unique in complete remote readback');
    }
    return Object.freeze({ publication: readback, commentId: created.id, status: 'published',
      createdByThisInvocation: true,
      detail: `published authorization operation ${publication.authorizationPublicationId}` });
  } catch (error) {
    return Object.freeze({ publication: null, commentId: null, status: 'failed',
      createdByThisInvocation: false,
      detail: error instanceof Error ? error.message : String(error) });
  }
}
