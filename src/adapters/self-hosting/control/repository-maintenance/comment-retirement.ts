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
  type ExactCommentRetirement,
  type MaintenanceRequest
} from './contract.ts';
import { REPOSITORY_MAINTENANCE_ISSUE_NUMBER } from './hosted-admission.ts';

type ObservedComment = Readonly<{
  id: number;
  body: string;
  issueUrl: string;
  authorLogin: string;
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be one object`);
  }
  return value as Record<string, unknown>;
}

function observeComment(value: unknown): ObservedComment {
  const comment = record(value, 'issue comment');
  const user = record(comment.user, 'issue comment user');
  if (!Number.isSafeInteger(comment.id) || Number(comment.id) < 1
      || typeof comment.body !== 'string'
      || typeof comment.issue_url !== 'string'
      || typeof user.login !== 'string' || user.login.length === 0) {
    throw new Error('issue comment observation is invalid');
  }
  return Object.freeze({
    id: Number(comment.id),
    body: comment.body,
    issueUrl: comment.issue_url,
    authorLogin: user.login
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

function maintenanceTargetBranch(body: string): string | null {
  let request: MaintenanceRequest;
  try {
    request = parseRepositoryMaintenanceRequest(body);
  } catch {
    return null;
  }
  const operation = request.operations[0]!;
  if (operation.kind !== 'exact-ref-retirement') return null;
  return operation.retirement.branches[0];
}

function classifyDisposableComment(
  retirement: ExactCommentRetirement,
  comment: ObservedComment
): Readonly<
  | { kind: 'maintenance-trigger'; targetBranch: string }
  | { kind: 'codex-command' }
  | { kind: 'codex-summary' }
  | { kind: 'codex-usage-limit' }
> {
  const trimmed = comment.body.trim();
  if (retirement.issueNumber === REPOSITORY_MAINTENANCE_ISSUE_NUMBER) {
    const targetBranch = maintenanceTargetBranch(trimmed);
    if (targetBranch !== null) return Object.freeze({ kind: 'maintenance-trigger', targetBranch });
  }
  if (trimmed === '@codex review' || trimmed === '@codex security review') {
    return Object.freeze({ kind: 'codex-command' });
  }
  if (comment.authorLogin === 'chatgpt-codex-connector[bot]'
      && trimmed.startsWith('<!-- codex-pull-request-review-summary -->')) {
    return Object.freeze({ kind: 'codex-summary' });
  }
  if (comment.authorLogin === 'chatgpt-codex-connector[bot]'
      && trimmed.startsWith('You have reached your Codex usage limits for code reviews.')) {
    return Object.freeze({ kind: 'codex-usage-limit' });
  }
  throw new Error('comment is not in the closed disposable maintenance/comment set');
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

async function assertClosedPullConversation(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  issueNumber: number;
}>): Promise<void> {
  await withGitHubApiReadSession({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    operation: async (capability) => {
      const value = record(
        await executeGitHubApiOperation(capability, {
          kind: 'issue',
          issueNumber: input.issueNumber
        }),
        'comment parent issue'
      );
      if (value.state !== 'closed'
          || value.pull_request === null
          || typeof value.pull_request !== 'object'
          || Array.isArray(value.pull_request)) {
        throw new Error('Codex transport comment retirement requires one closed pull request');
      }
    }
  });
}

async function assertMaintenanceTargetAbsent(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  branch: string;
}>): Promise<void> {
  await withGitHubApiReadSession({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    operation: async (capability) => {
      try {
        await executeGitHubApiOperation(capability, { kind: 'git-ref', branch: input.branch });
      } catch (error) {
        if (error instanceof GitHubApiProviderError && error.statusCode === 404) return;
        throw error;
      }
      throw new Error(`maintenance trigger target branch ${input.branch} is still present`);
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
  classification:
    | 'maintenance-trigger'
    | 'codex-command'
    | 'codex-summary'
    | 'codex-usage-limit'
    | 'already-absent';
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
  if (classification.kind === 'maintenance-trigger') {
    await assertMaintenanceTargetAbsent({
      repositoryRoot,
      repository: input.repository,
      branch: classification.targetBranch
    });
  } else if (classification.kind === 'codex-command'
      || classification.kind === 'codex-summary') {
    await assertClosedPullConversation({
      repositoryRoot,
      repository: input.repository,
      issueNumber: input.retirement.issueNumber
    });
  }

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
