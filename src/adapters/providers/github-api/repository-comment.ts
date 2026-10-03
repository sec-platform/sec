import { deepFreeze, rawSha256, sha256 } from '../../../contracts/canonical.ts';
import {
  executeGitHubApiOperation,
  inspectGitHubApiCapability,
  type GitHubApiCapability
} from './operation-session.ts';

/** Provider facts only. A domain owner must separately adopt the comment's meaning. */
export interface GitHubRepositoryCommentObservation {
  readonly origin: 'production' | 'test';
  readonly repository: string;
  readonly issueNumber: number;
  readonly commentId: number;
  readonly author: Readonly<{
    login: string;
    nodeId: string;
    userId: number;
    kind: 'User' | 'Bot';
    permission: 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none';
    /** GitHub's permission is legacy; preserve the distinct live role name. */
    roleName: string | null;
  }>;
  readonly body: string;
  readonly bodyDigest: string;
  readonly updatedAt: string;
  readonly observationDigest: string;
}

const issued = new WeakSet<object>();

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`GitHub comment ${label} is unavailable`);
  }
  return value as Record<string, unknown>;
}

function normalizedComment(value: unknown, input: Readonly<{
  repository: string;
  issueNumber: number;
  commentId: number;
}>) {
  const comment = record(value, 'response');
  const author = record(comment.user, 'author');
  if (comment.id !== input.commentId
      || comment.issue_url !== `https://api.github.com/repos/${input.repository}/issues/${input.issueNumber}`
      || typeof comment.body !== 'string' || Buffer.byteLength(comment.body, 'utf8') > 131_072
      || typeof comment.updated_at !== 'string' || !Number.isFinite(Date.parse(comment.updated_at))
      || typeof author.login !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\[bot\])?$/u.test(author.login)
      || typeof author.node_id !== 'string' || author.node_id.length === 0
      || author.node_id.length > 256 || !Number.isSafeInteger(author.id) || Number(author.id) < 1
      || (author.type !== 'User' && author.type !== 'Bot')) {
    throw new Error('GitHub comment identity or bounded body is invalid');
  }
  return deepFreeze({
    ...input,
    author: {
      login: author.login,
      nodeId: author.node_id,
      userId: Number(author.id),
      kind: author.type as 'User' | 'Bot'
    },
    body: comment.body,
    bodyDigest: rawSha256(comment.body),
    updatedAt: comment.updated_at
  });
}

/** Read exactly the requested comment and its author's current repository permission. */
export async function observeGitHubRepositoryComment(input: Readonly<{
  capability: GitHubApiCapability;
  issueNumber: number;
  commentId: number;
}>): Promise<GitHubRepositoryCommentObservation> {
  if (!Number.isSafeInteger(input.issueNumber) || input.issueNumber < 1
      || !Number.isSafeInteger(input.commentId) || input.commentId < 1) {
    throw new Error('GitHub comment locator requires positive exact ids');
  }
  const { repository, effect, origin } = inspectGitHubApiCapability(input.capability);
  if (effect !== 'read') throw new Error('GitHub comment observation requires a read session');
  const locator = Object.freeze({ repository, issueNumber: input.issueNumber, commentId: input.commentId });
  const before = normalizedComment(await executeGitHubApiOperation(input.capability, {
    kind: 'issue-comment', commentId: input.commentId
  }), locator);
  const permission = record(await executeGitHubApiOperation(input.capability, {
    kind: 'collaborator-permission', login: before.author.login
  }), 'permission');
  const permissionUser = record(permission.user, 'permission principal');
  if (permissionUser.id !== before.author.userId || permissionUser.node_id !== before.author.nodeId
      || permissionUser.login !== before.author.login
      || typeof permission.permission !== 'string'
      || !['admin', 'maintain', 'write', 'triage', 'read', 'none'].includes(permission.permission)
      || permission.role_name !== undefined
        && (typeof permission.role_name !== 'string' || permission.role_name.length > 128
          || /[\u0000-\u001f\u007f]/u.test(permission.role_name))) {
    throw new Error('GitHub comment author and live permission principal differ');
  }
  const after = normalizedComment(await executeGitHubApiOperation(input.capability, {
    kind: 'issue-comment', commentId: input.commentId
  }), locator);
  if (sha256(before) !== sha256(after)) throw new Error('GitHub comment changed during observation');
  const canonical = deepFreeze({
    origin,
    ...after,
    author: {
      ...after.author,
      permission: permission.permission as GitHubRepositoryCommentObservation['author']['permission'],
      roleName: typeof permission.role_name === 'string' ? permission.role_name : null
    }
  });
  const observation = deepFreeze({ ...canonical, observationDigest: sha256(canonical) });
  issued.add(observation);
  return observation;
}

/** Serialized provider data cannot recreate the live observation on a later process. */
export function assertGitHubRepositoryCommentObservation(value: GitHubRepositoryCommentObservation): void {
  if (!issued.has(value)) throw new Error('GitHub comment requires a live provider-issued observation');
}
