import path from 'node:path';

import { rawSha256, sha256 } from '../../../../contracts/canonical.ts';
import {
  executeGitHubApiOperation,
  GitHubApiProviderError,
  withGitHubApiIssueCommentWriteSession,
  withGitHubApiReadSession
} from '../../../providers/github-api/operation-session.ts';
import {
  parseRepositoryMaintenanceRequest,
  REPOSITORY_MAINTENANCE_ISSUE_NUMBER,
  type ExactCommentRetirement,
  type MaintenanceRequest
} from './contract.ts';

type ObservedComment = Readonly<{
  id: number;
  body: string;
  issueUrl: string;
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be one object`);
  }
  return value as Record<string, unknown>;
}

function observeComment(value: unknown): ObservedComment {
  const comment = record(value, 'issue comment');
  if (!Number.isSafeInteger(comment.id) || Number(comment.id) < 1
      || typeof comment.body !== 'string'
      || typeof comment.issue_url !== 'string') {
    throw new Error('issue comment observation is invalid');
  }
  return Object.freeze({
    id: Number(comment.id),
    body: comment.body,
    issueUrl: comment.issue_url
  });
}

function expectedIssueUrl(repository: string, issueNumber: number): string {
  return `https://api.github.com/repos/${repository}/issues/${issueNumber}`;
}

function assertExactCommentIdentity(
  repository: string,
  retirement: ExactCommentRetirement,
  comment: ObservedComment
): void {
  if (comment.id !== retirement.commentId
      || comment.issueUrl !== expectedIssueUrl(repository, retirement.issueNumber)
      || rawSha256(comment.body) !== retirement.expectedBodyDigest) {
    throw new Error('exact comment retirement identity or body digest changed');
  }
}

function maintenanceRequest(body: string): MaintenanceRequest | null {
  try {
    return parseRepositoryMaintenanceRequest(body);
  } catch {
    return null;
  }
}

function classifyDisposableComment(
  retirement: ExactCommentRetirement,
  comment: ObservedComment
): Readonly<{ kind: 'maintenance-trigger'; request: MaintenanceRequest }> {
  if (retirement.issueNumber !== REPOSITORY_MAINTENANCE_ISSUE_NUMBER) {
    throw new Error('exact comment retirement escaped the lifecycle issue boundary');
  }
  const request = maintenanceRequest(comment.body.trim());
  if (request === null) {
    throw new Error('comment is not one repository-maintenance transport trigger');
  }
  return Object.freeze({ kind: 'maintenance-trigger', request });
}

async function observeIssueComment(
  capability: Parameters<typeof executeGitHubApiOperation>[0],
  commentId: number
): Promise<ObservedComment | null> {
  try {
    return observeComment(await executeGitHubApiOperation(capability, {
      kind: 'issue-comment',
      commentId
    }));
  } catch (error) {
    if (error instanceof GitHubApiProviderError && error.statusCode === 404) return null;
    throw error;
  }
}

async function assertMaintenanceRequestSettled(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  request: MaintenanceRequest;
}>): Promise<void> {
  if (input.request.repository !== input.repository) {
    throw new Error('maintenance trigger repository differs from the active repository');
  }
  await withGitHubApiReadSession({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    operation: async (capability) => {
      for (const operation of input.request.operations) {
        if (operation.kind === 'exact-ref-retirement') {
          const branch = operation.retirement.branches[0];
          try {
            await executeGitHubApiOperation(capability, { kind: 'git-ref', branch });
          } catch (error) {
            if (error instanceof GitHubApiProviderError && error.statusCode === 404) continue;
            throw error;
          }
          throw new Error(`maintenance trigger target branch ${branch} is still present`);
        }
        if (await observeIssueComment(capability, operation.retirement.commentId) !== null) {
          throw new Error(
            `maintenance trigger target comment ${operation.retirement.commentId} is still present`
          );
        }
      }
    }
  });
}

export async function retireExactIssueComment(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  retirement: ExactCommentRetirement;
  triggeringCommentId: number;
}>): Promise<Readonly<{
  retired: readonly number[];
  alreadyAbsent: readonly number[];
  classification: 'maintenance-trigger' | 'already-absent';
}>> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  if (input.retirement.commentId === input.triggeringCommentId) {
    throw new Error('exact comment retirement cannot target its own maintenance trigger');
  }

  const preflight = await withGitHubApiReadSession({
    repositoryRoot,
    repository: input.repository,
    operation: async (capability) => await observeIssueComment(
      capability,
      input.retirement.commentId
    )
  });
  if (preflight === null) {
    return Object.freeze({
      retired: Object.freeze([]),
      alreadyAbsent: Object.freeze([input.retirement.commentId]),
      classification: 'already-absent' as const
    });
  }
  assertExactCommentIdentity(input.repository, input.retirement, preflight);
  const classification = classifyDisposableComment(input.retirement, preflight);
  await assertMaintenanceRequestSettled({
    repositoryRoot,
    repository: input.repository,
    request: classification.request
  });

  await withGitHubApiIssueCommentWriteSession({
    repositoryRoot,
    repository: input.repository,
    operation: async (capability) => {
      const immediatelyBefore = await observeIssueComment(
        capability,
        input.retirement.commentId
      );
      if (immediatelyBefore === null) return;
      assertExactCommentIdentity(input.repository, input.retirement, immediatelyBefore);
      classifyDisposableComment(input.retirement, immediatelyBefore);
      await executeGitHubApiOperation(capability, {
        kind: 'delete-issue-comment',
        commentId: input.retirement.commentId
      });
      if (await observeIssueComment(capability, input.retirement.commentId) !== null) {
        throw new Error('issue comment remains after exact comment retirement');
      }
    }
  });

  return Object.freeze({
    retired: Object.freeze([input.retirement.commentId]),
    alreadyAbsent: Object.freeze([]),
    classification: classification.kind
  });
}

export async function retireMaintenanceTriggerComment(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  request: MaintenanceRequest;
  commentId: number;
  issueNumber: number;
  exactBody: string;
}>): Promise<void> {
  if (input.issueNumber !== REPOSITORY_MAINTENANCE_ISSUE_NUMBER) {
    throw new Error('maintenance trigger retirement is restricted to the lifecycle issue');
  }
  const parsedBody = parseRepositoryMaintenanceRequest(input.exactBody);
  if (parsedBody.repository !== input.request.repository
      || sha256(parsedBody) !== sha256(input.request)) {
    throw new Error('maintenance trigger body differs from the parsed request');
  }
  await withGitHubApiIssueCommentWriteSession({
    repositoryRoot: path.resolve(input.repositoryRoot),
    repository: input.repository,
    operation: async (capability) => {
      const observed = await observeIssueComment(capability, input.commentId);
      if (observed === null) return;
      if (observed.id !== input.commentId
          || observed.issueUrl !== expectedIssueUrl(input.repository, input.issueNumber)
          || observed.body !== input.exactBody) {
        throw new Error('maintenance trigger comment changed before retirement');
      }
      await executeGitHubApiOperation(capability, {
        kind: 'delete-issue-comment',
        commentId: input.commentId
      });
      if (await observeIssueComment(capability, input.commentId) !== null) {
        throw new Error('maintenance trigger comment remains after retirement');
      }
    }
  });
}
