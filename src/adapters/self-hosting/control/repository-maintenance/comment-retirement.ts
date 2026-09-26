import { sha256 } from '../../../../contracts/canonical.ts';
import {
  executeGitHubApiOperation,
  withGitHubApiIssueCommentWriteSession
} from '../../../providers/github-api/operation-session.ts';

import type { ExactCommentRetirement } from './comment-retirement-contract.ts';

const MAX_COMMENT_PAGES = 64;
const COMMENTS_PER_PAGE = 100;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be one object`);
  }
  return value as Record<string, unknown>;
}

function assertClosedIssue(value: unknown, repository: string, issueNumber: number): void {
  const issue = record(value, 'GitHub issue');
  if (issue.number !== issueNumber || issue.state !== 'closed'
      || issue.repository_url !== `https://api.github.com/repos/${repository}`) {
    throw new Error('comment retirement requires the exact closed repository issue or pull request');
  }
}

function assertExactComment(
  value: unknown,
  repository: string,
  issueNumber: number,
  expected: ExactCommentRetirement
): void {
  const comment = record(value, 'GitHub issue comment');
  const user = record(comment.user, 'GitHub issue comment user');
  if (comment.id !== expected.commentId
      || comment.issue_url !== `https://api.github.com/repos/${repository}/issues/${issueNumber}`
      || user.login !== expected.expectedAuthorLogin
      || typeof comment.body !== 'string'
      || sha256(comment.body) !== expected.expectedBodyDigest) {
    throw new Error(`comment ${expected.commentId} identity, author, issue or body digest drifted`);
  }
}

async function commentInventory(
  capability: Parameters<typeof executeGitHubApiOperation>[0],
  issueNumber: number
): Promise<readonly unknown[]> {
  const comments: unknown[] = [];
  for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
    const value = await executeGitHubApiOperation(capability, {
      kind: 'issue-comments', issueNumber, page
    });
    if (!Array.isArray(value)) throw new Error('GitHub issue comment inventory is invalid');
    comments.push(...value);
    if (value.length < COMMENTS_PER_PAGE) return Object.freeze(comments);
  }
  throw new Error('GitHub issue comment inventory exceeds the bounded complete census');
}

async function assertCommentAbsent(
  capability: Parameters<typeof executeGitHubApiOperation>[0],
  issueNumber: number,
  commentId: number
): Promise<void> {
  const inventory = await commentInventory(capability, issueNumber);
  if (inventory.some((entry) => record(entry, 'GitHub issue comment inventory entry').id === commentId)) {
    throw new Error(`comment ${commentId} remains after deletion`);
  }
}

export async function retireExactClosedIssueComments(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  issueNumber: number;
  comments: readonly ExactCommentRetirement[];
}>): Promise<Readonly<{ retired: readonly number[]; alreadyAbsent: readonly number[] }>> {
  if (new Set(input.comments.map(({ commentId }) => commentId)).size !== input.comments.length) {
    throw new Error('comment retirement request contains duplicate comment ids');
  }
  return await withGitHubApiIssueCommentWriteSession({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    operation: async (capability) => {
      assertClosedIssue(
        await executeGitHubApiOperation(capability, { kind: 'issue', issueNumber: input.issueNumber }),
        input.repository,
        input.issueNumber
      );
      const initial = await commentInventory(capability, input.issueNumber);
      const byId = new Map(initial.map((entry) => {
        const comment = record(entry, 'GitHub issue comment inventory entry');
        return [comment.id, entry] as const;
      }));
      const retired: number[] = [];
      const alreadyAbsent: number[] = [];
      for (const expected of input.comments) {
        const current = byId.get(expected.commentId);
        if (current === undefined) {
          alreadyAbsent.push(expected.commentId);
          continue;
        }
        assertExactComment(current, input.repository, input.issueNumber, expected);
        await executeGitHubApiOperation(capability, {
          kind: 'delete-issue-comment', commentId: expected.commentId
        });
        await assertCommentAbsent(capability, input.issueNumber, expected.commentId);
        retired.push(expected.commentId);
      }
      return Object.freeze({ retired: Object.freeze(retired), alreadyAbsent: Object.freeze(alreadyAbsent) });
    }
  });
}
