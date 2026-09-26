import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';

import { assertGitBranchName } from '../../../../contracts/git-reference.ts';
import { isNativeAborted, linkNativeAbortSignals } from '../../../../contracts/native-abort.ts';
import { ResourceCompositeSettlementError } from '../../../../execution/resource-settlement.ts';
import { withOwnedByteStreamReader } from '../../../../execution/stream-reader.ts';

import { GITHUB_API_BASE_URL, GITHUB_HOST } from '../contract.ts';
import {
  GitHubCredentialUnavailableError,
  inspectGitHubActionsProjectionCredentialIdentity,
  readGitHubToken
} from '../credential.ts';

export type GitHubApiEffect =
  | 'read'
  | 'status-write'
  | 'issue-comment-write'
  | 'merge-write'
  | 'runner-admin'
  | 'branch-closeout-write';

export type GitHubApiTransport = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export type GitHubApiPrincipal =
  | Readonly<{
      transport: 'github-rest-token';
      login: string;
      nodeId: string;
      userId: number | null;
      permission: 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none';
    }>
  | Readonly<{
      transport: 'github-actions-token';
      login: 'github-actions[bot]';
      nodeId: 'MDM6Qm90NDE4OTgyODI=';
      userId: 41898282;
      permission: 'workflow';
      workflowRef: string;
      workflowSha: string;
    }>;

type GitHubUserApiPrincipal = Extract<
  GitHubApiPrincipal,
  Readonly<{ transport: 'github-rest-token' }>
>;

declare const githubApiCapabilityBrand: unique symbol;

/** Opaque, in-process authority. Credential and transport stay in this owner. */
export type GitHubApiCapability = Readonly<{
  readonly [githubApiCapabilityBrand]: true;
}>;

type GitHubApiCapabilityBinding = Readonly<{
  repository: string;
  token: string;
  principal: GitHubApiPrincipal;
  effect: GitHubApiEffect;
  transport: GitHubApiTransport;
  origin: 'production' | 'test';
}>;

type GitHubApiOperationBudget = {
  readonly repositoryRoot: string;
  readonly repository: string;
  readonly effect: GitHubApiEffect;
  readonly origin: 'production' | 'test';
  readonly now: () => number;
  readonly deadlineAt: number;
  readonly maxSessions: number;
  sessionCount: number;
  requestCount: number;
  requestBytes: number;
  responseBytes: number;
};

type GitHubApiRequestSession = {
  capability: GitHubApiCapability | undefined;
  readonly repository: string;
  readonly effect: GitHubApiEffect;
  readonly origin: 'production' | 'test';
  readonly operationBudget: GitHubApiOperationBudget | undefined;
  readonly now: () => number;
  readonly deadlineAt: number;
  readonly abortController: AbortController;
  readonly deadlineTimer: ReturnType<typeof setTimeout>;
  phase: 'open' | 'closing' | 'settled';
  readonly responseSettlementFailures: unknown[];
  inFlight: number;
  requestCount: number;
  requestBytes: number;
  responseBytes: number;
};

export type GitHubApiOperation =
  | Readonly<{ kind: 'current-user' }>
  | Readonly<{ kind: 'repository' }>
  | Readonly<{ kind: 'pull'; pullRequestNumber: number }>
  | Readonly<{ kind: 'branch'; branch: string }>
  | Readonly<{ kind: 'collaborator-permission'; login: string }>
  | Readonly<{ kind: 'commit-statuses'; sha: string; page: number }>
  | Readonly<{
      kind: 'create-commit-status';
      sha: string;
      status: Readonly<{
        state: 'success';
        context: string;
        description: string;
        targetUrl: string;
      }>;
    }>
  | Readonly<{ kind: 'effective-branch-rules'; branch: string; page: number }>
  | Readonly<{ kind: 'ruleset'; rulesetId: number }>
  | Readonly<{ kind: 'open-issues'; page: number }>
  | Readonly<{ kind: 'issue'; issueNumber: number }>
  | Readonly<{ kind: 'issue-comments'; issueNumber: number; page: number }>
  | Readonly<{ kind: 'issue-comment'; commentId: number }>
  | Readonly<{ kind: 'update-issue-comment'; commentId: number; body: string }>
  | Readonly<{ kind: 'create-issue-comment'; issueNumber: number; body: string }>
  | Readonly<{ kind: 'open-pulls'; baseBranch: string }>
  | Readonly<{ kind: 'matching-head-refs'; page: number }>
  | Readonly<{ kind: 'git-ref'; branch: string }>
  | Readonly<{ kind: 'workflow-run'; runId: string }>
  | Readonly<{ kind: 'check-runs'; sha: string; page: number }>
  | Readonly<{ kind: 'code-scanning-alerts'; pullRequestNumber: number; page: number }>
  | Readonly<{
      kind: 'code-scanning-alert-instances';
      alertNumber: number;
      pullRequestNumber: number;
      page: number;
    }>
  | Readonly<{ kind: 'repository-runners'; page: number }>
  | Readonly<{ kind: 'create-runner-registration-token' }>
  | Readonly<{ kind: 'delete-repository-runner'; runnerId: number }>
  | Readonly<{ kind: 'control-inventory-open-counts' }>
  | Readonly<{
      kind: 'control-inventory-review-threads';
      pullRequestNumber: number;
      endCursor: string | null;
    }>
  | Readonly<{
      kind: 'merge-pull';
      pullRequestNumber: number;
      headSha: string;
      title: string;
      message: string;
    }>
  | Readonly<{ kind: 'delete-ref-cas'; branch: string; expectedOldSha: string }>;

type CompiledGitHubApiRequest = Readonly<{
  kind: GitHubApiOperation['kind'];
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
  path: string;
  body?: unknown;
}>;

const capabilityBindings = new WeakMap<object, GitHubApiCapabilityBinding>();
const requestSession = new AsyncLocalStorage<GitHubApiRequestSession>();
const operationBudget = new AsyncLocalStorage<GitHubApiOperationBudget>();

const MAX_REQUESTS = 2_048;
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_READ_SESSIONS = 2;
const MAX_TOKEN_BYTES = 1_024;
export const GITHUB_API_REQUEST_TIMEOUT_MS = 30_000 as const;
export const GITHUB_API_READ_OPERATION_TIMEOUT_MS = 600_000 as const;

const OPEN_COUNTS_QUERY =
  'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){pullRequests(states:OPEN){totalCount}issues(states:OPEN){totalCount}}}';
const REVIEW_THREADS_QUERY =
  'query($owner:String!,$name:String!,$number:Int!,$endCursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){number reviewThreads(first:100,after:$endCursor){totalCount nodes{isResolved}pageInfo{hasNextPage endCursor}}}}}';
const DELETE_REF_CAS_MUTATION =
  'mutation($repositoryId:ID!,$name:GitRefname!,$beforeOid:GitObjectID!,$afterOid:GitObjectID!){updateRefs(input:{repositoryId:$repositoryId,refUpdates:[{name:$name,beforeOid:$beforeOid,afterOid:$afterOid,force:true}]}){clientMutationId}}';
const ZERO_GIT_OID = '0000000000000000000000000000000000000000';

export class GitHubApiProviderError extends Error {
  readonly code: string = 'github-api-provider-unavailable';

  constructor(message: string, readonly statusCode: number | null = null) {
    super(message);
    this.name = 'GitHubApiProviderError';
  }
}

function repository(value: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value)) {
    throw new GitHubApiProviderError('GitHub API repository must be an exact owner/name pair');
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new GitHubApiProviderError(`GitHub API ${label} must be a positive safe integer`);
  }
  return value;
}

function page(value: number): number {
  return positiveInteger(value, 'page');
}

function sha(value: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new GitHubApiProviderError('GitHub API SHA must be a lowercase 40-character Git SHA');
  }
  return value;
}

function boundedText(value: string, label: string, maximum = 4096): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || value.trim() !== value
      || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new GitHubApiProviderError(`GitHub API ${label} is not bounded canonical text`);
  }
  return value;
}

function boundedMultilineText(value: string, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || value.trim() !== value
      || /[\u0000-\u0009\u000b-\u001f\u007f]/u.test(value)) {
    throw new GitHubApiProviderError(`GitHub API ${label} is not bounded canonical multiline text`);
  }
  return value;
}

function repositoryParts(value: string): Readonly<{ owner: string; name: string }> {
  const [owner, name] = repository(value).split('/');
  return Object.freeze({ owner: owner!, name: name! });
}

function canonicalTarget(pathname: string): URL {
  const target = new URL(pathname, `${GITHUB_API_BASE_URL}/`);
  if (target.protocol !== 'https:' || target.hostname !== 'api.github.com'
      || target.port !== '' || target.username !== '' || target.password !== ''
      || target.hash !== '') {
    throw new GitHubApiProviderError(
      'GitHub API operation only permits credential-free https://api.github.com targets'
    );
  }
  return target;
}

function compileOperation(
  repositoryName: string,
  effect: GitHubApiEffect,
  operation: GitHubApiOperation,
  exactRepositoryNodeId?: string
): CompiledGitHubApiRequest {
  const kind = operation.kind;
  const repo = repository(repositoryName);
  if (effect === 'runner-admin'
      && kind !== 'current-user'
      && kind !== 'collaborator-permission'
      && kind !== 'create-runner-registration-token'
      && kind !== 'delete-repository-runner') {
    throw new GitHubApiProviderError(
      'GitHub API runner-admin authority permits only fixed runner lifecycle effects'
    );
  }
  if (effect === 'branch-closeout-write'
      && kind !== 'current-user'
      && kind !== 'collaborator-permission'
      && kind !== 'repository'
      && kind !== 'pull'
      && kind !== 'git-ref'
      && kind !== 'issue-comments'
      && kind !== 'issue-comment'
      && kind !== 'create-issue-comment'
      && kind !== 'delete-ref-cas') {
    throw new GitHubApiProviderError(
      'GitHub API branch-closeout-write authority permits only fixed closeout observations and effects'
    );
  }
  if (effect === 'issue-comment-write'
      && kind !== 'current-user'
      && kind !== 'collaborator-permission'
      && kind !== 'repository'
      && kind !== 'issue-comments'
      && kind !== 'issue-comment'
      && kind !== 'create-issue-comment'
      && kind !== 'update-issue-comment') {
    throw new GitHubApiProviderError(
      'GitHub API issue-comment-write authority permits only fixed comment observations and effects'
    );
  }
  const read = (path: string, body?: unknown): CompiledGitHubApiRequest =>
    Object.freeze({ kind, method: body === undefined ? 'GET' as const : 'POST' as const, path, body });
  switch (kind) {
    case 'current-user': return read('/user');
    case 'repository': return read(`/repos/${repo}`);
    case 'pull': return read(`/repos/${repo}/pulls/${positiveInteger(operation.pullRequestNumber, 'pull request number')}`);
    case 'branch': return read(`/repos/${repo}/branches/${encodeURIComponent(boundedText(operation.branch, 'branch', 255))}`);
    case 'collaborator-permission':
      return read(`/repos/${repo}/collaborators/${encodeURIComponent(boundedText(operation.login, 'login', 64))}/permission`);
    case 'commit-statuses':
      return read(`/repos/${repo}/commits/${sha(operation.sha)}/statuses?per_page=100&page=${page(operation.page)}`);
    case 'create-commit-status': {
      if (effect !== 'status-write') {
        throw new GitHubApiProviderError('GitHub API status publication requires status-write authority');
      }
      const status = operation.status;
      if (status.state !== 'success') throw new GitHubApiProviderError('GitHub API status publication requires the admitted success state');
      return read(`/repos/${repo}/statuses/${sha(operation.sha)}`, Object.freeze({
        state: 'success',
        context: boundedText(status.context, 'status context', 100),
        description: boundedText(status.description, 'status description', 140),
        target_url: boundedText(status.targetUrl, 'status target URL', 512)
      }));
    }
    case 'effective-branch-rules':
      return read(`/repos/${repo}/rules/branches/${encodeURIComponent(boundedText(operation.branch, 'branch', 255))}?per_page=100&page=${page(operation.page)}`);
    case 'ruleset':
      return read(`/repos/${repo}/rulesets/${positiveInteger(operation.rulesetId, 'ruleset id')}?includes_parents=true`);
    case 'open-issues': return read(`/repos/${repo}/issues?state=open&per_page=100&page=${page(operation.page)}`);
    case 'issue': return read(`/repos/${repo}/issues/${positiveInteger(operation.issueNumber, 'issue number')}`);
    case 'issue-comments':
      return read(`/repos/${repo}/issues/${positiveInteger(operation.issueNumber, 'issue number')}/comments?per_page=100&page=${page(operation.page)}`);
    case 'issue-comment':
      return read(`/repos/${repo}/issues/comments/${positiveInteger(operation.commentId, 'issue comment id')}`);
    case 'update-issue-comment':
      if (effect !== 'issue-comment-write') {
        throw new GitHubApiProviderError('GitHub API issue comment update requires issue-comment-write authority');
      }
      return Object.freeze({
        kind,
        method: 'PATCH',
        path: `/repos/${repo}/issues/comments/${positiveInteger(operation.commentId, 'issue comment id')}`,
        body: Object.freeze({ body: boundedMultilineText(operation.body, 'issue comment body', 65_536) })
      });
    case 'create-issue-comment':
      if (effect !== 'branch-closeout-write' && effect !== 'issue-comment-write') {
        throw new GitHubApiProviderError(
          'GitHub API issue comment publication requires issue-comment-write or branch-closeout-write authority'
        );
      }
      return read(
        `/repos/${repo}/issues/${positiveInteger(operation.issueNumber, 'issue number')}/comments`,
        Object.freeze({ body: boundedMultilineText(operation.body, 'issue comment body', 65_536) })
      );
    case 'open-pulls': return read(`/repos/${repo}/pulls?state=open&base=${encodeURIComponent(boundedText(operation.baseBranch, 'base branch', 255))}&per_page=2&page=1`);
    case 'matching-head-refs': return read(`/repos/${repo}/git/matching-refs/heads/?per_page=100&page=${page(operation.page)}`);
    case 'git-ref': return read(`/repos/${repo}/git/ref/heads/${encodeURIComponent(boundedText(operation.branch, 'branch', 255))}`);
    case 'workflow-run': {
      const runId = operation.runId;
      if (typeof runId !== 'string' || !/^[1-9][0-9]*$/u.test(runId)) {
        throw new GitHubApiProviderError('GitHub API workflow run id is invalid');
      }
      return read(`/repos/${repo}/actions/runs/${runId}`);
    }
    case 'check-runs': return read(`/repos/${repo}/commits/${sha(operation.sha)}/check-runs?per_page=100&page=${page(operation.page)}`);
    case 'code-scanning-alerts':
      return read(`/repos/${repo}/code-scanning/alerts?state=open&tool_name=CodeQL&ref=${encodeURIComponent(`refs/pull/${positiveInteger(operation.pullRequestNumber, 'pull request number')}/merge`)}&per_page=100&page=${page(operation.page)}`);
    case 'code-scanning-alert-instances': {
      const pullRequestNumber = positiveInteger(operation.pullRequestNumber, 'pull request number');
      return read(
        `/repos/${repo}/code-scanning/alerts/${positiveInteger(operation.alertNumber, 'code scanning alert number')}/instances?ref=${encodeURIComponent(`refs/pull/${pullRequestNumber}/merge`)}&pr=${pullRequestNumber}&per_page=100&page=${page(operation.page)}`
      );
    }
    case 'repository-runners':
      return read(`/repos/${repo}/actions/runners?per_page=100&page=${page(operation.page)}`);
    case 'create-runner-registration-token':
      if (effect !== 'runner-admin') {
        throw new GitHubApiProviderError('GitHub API runner registration requires runner-admin authority');
      }
      return Object.freeze({
        kind,
        method: 'POST',
        path: `/repos/${repo}/actions/runners/registration-token`
      });
    case 'delete-repository-runner':
      if (effect !== 'runner-admin') {
        throw new GitHubApiProviderError('GitHub API runner deletion requires runner-admin authority');
      }
      return Object.freeze({
        kind,
        method: 'DELETE',
        path: `/repos/${repo}/actions/runners/${positiveInteger(operation.runnerId, 'runner id')}`
      });
    case 'control-inventory-open-counts': {
      const parts = repositoryParts(repo);
      return read('/graphql', Object.freeze({
        query: OPEN_COUNTS_QUERY,
        variables: Object.freeze(parts)
      }));
    }
    case 'control-inventory-review-threads': {
      const parts = repositoryParts(repo);
      const endCursor = operation.endCursor;
      return read('/graphql', Object.freeze({
        query: REVIEW_THREADS_QUERY,
        variables: Object.freeze({
          ...parts,
          number: positiveInteger(operation.pullRequestNumber, 'pull request number'),
          endCursor: endCursor === null
            ? null
            : boundedText(endCursor, 'GraphQL cursor', 1024)
        })
      }));
    }
    case 'merge-pull':
      if (effect !== 'merge-write') {
        throw new GitHubApiProviderError('GitHub API pull merge requires merge-write authority');
      }
      return Object.freeze({
        kind,
        method: 'PUT',
        path: `/repos/${repo}/pulls/${positiveInteger(operation.pullRequestNumber, 'pull request number')}/merge`,
        body: Object.freeze({
          sha: sha(operation.headSha),
          merge_method: 'squash',
          commit_title: boundedText(operation.title, 'merge title', 256),
          commit_message: boundedMultilineText(operation.message, 'merge message', 65_536)
        })
      });
    case 'delete-ref-cas':
      if (effect !== 'branch-closeout-write') {
        throw new GitHubApiProviderError(
          'GitHub API exact ref deletion requires branch-closeout-write authority'
        );
      }
      if (exactRepositoryNodeId === undefined) {
        throw new GitHubApiProviderError(
          'GitHub API exact ref deletion requires the provider-observed repository node identity'
        );
      }
      assertGitBranchName(operation.branch, 'GitHub API exact ref deletion branch');
      return read('/graphql', Object.freeze({
        query: DELETE_REF_CAS_MUTATION,
        variables: Object.freeze({
          repositoryId: boundedText(exactRepositoryNodeId, 'repository node id', 512),
          name: `refs/heads/${boundedText(operation.branch, 'branch', 255)}`,
          beforeOid: sha(operation.expectedOldSha),
          afterOid: ZERO_GIT_OID
        })
      }));
  }
  throw new GitHubApiProviderError('GitHub API operation kind is unsupported');
}

function binding(capability: GitHubApiCapability): GitHubApiCapabilityBinding {
  const value = capabilityBindings.get(capability);
  if (value === undefined) {
    throw new GitHubApiProviderError('GitHub API capability is forged or was not issued by this owner');
  }
  return value;
}

export function inspectGitHubApiCapability(capability: GitHubApiCapability): Readonly<{
  repository: string;
  effect: GitHubApiEffect;
  principal: GitHubApiPrincipal;
  origin: 'production' | 'test';
}> {
  const value = binding(capability);
  return Object.freeze({
    repository: value.repository,
    effect: value.effect,
    principal: value.principal,
    origin: value.origin
  });
}

export function assertGitHubApiCapability(
  capability: GitHubApiCapability,
  repositoryName: string,
  requiredEffect: GitHubApiEffect
): void {
  const value = binding(capability);
  const effectSatisfied = requiredEffect === 'read'
    ? true
    : value.effect === requiredEffect;
  const userPrincipal = value.principal.transport === 'github-rest-token'
    ? value.principal
    : null;
  const workflowCommentPrincipal = requiredEffect === 'issue-comment-write'
    && value.principal.transport === 'github-actions-token'
    && value.principal.permission === 'workflow';
  if (value.repository !== repositoryName || !effectSatisfied
      || (requiredEffect === 'runner-admin' && userPrincipal?.permission !== 'admin')
      || ((requiredEffect === 'status-write'
          || requiredEffect === 'merge-write'
          || requiredEffect === 'branch-closeout-write')
        && userPrincipal?.permission !== 'admin'
        && userPrincipal?.permission !== 'maintain')
      || (requiredEffect === 'issue-comment-write'
        && !workflowCommentPrincipal
        && userPrincipal?.permission !== 'admin'
        && userPrincipal?.permission !== 'maintain')) {
    throw new GitHubApiProviderError(
      'GitHub API capability is absent, repository-bound incorrectly, or not effect-authorized'
    );
  }
}

function issueCapability(input: Readonly<{
  repository: string;
  token: string;
  principal: GitHubApiPrincipal;
  effect: GitHubApiEffect;
  transport: GitHubApiTransport;
  origin: 'production' | 'test';
}>): GitHubApiCapability {
  repository(input.repository);
  const userPrincipalValid = input.principal.transport === 'github-rest-token'
    && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/u.test(input.principal.login)
    && input.principal.nodeId.length > 0
    && (input.principal.userId === null
      || (Number.isSafeInteger(input.principal.userId) && input.principal.userId > 0))
    && ['admin', 'maintain', 'write', 'triage', 'read', 'none'].includes(input.principal.permission);
  const workflowPrincipalValid = input.principal.transport === 'github-actions-token'
    && input.principal.login === 'github-actions[bot]'
    && input.principal.nodeId === 'MDM6Qm90NDE4OTgyODI='
    && input.principal.userId === 41898282
    && input.principal.permission === 'workflow'
    && input.principal.workflowRef
      === `${input.repository}/.github/workflows/code-scanning-projection.yml@refs/heads/main`
    && /^[0-9a-f]{40}$/u.test(input.principal.workflowSha);
  if (!/^[^\s\u0000-\u001f\u007f-\u009f]{20,1024}$/u.test(input.token)
      || (!userPrincipalValid && !workflowPrincipalValid)
      || typeof input.transport !== 'function') {
    throw new GitHubApiProviderError('GitHub API capability issuance input is invalid');
  }
  if (input.effect === 'runner-admin'
      && (input.principal.transport !== 'github-rest-token'
        || input.principal.permission !== 'admin')) {
    throw new GitHubApiProviderError('GitHub API runner-admin capability requires admin permission');
  }
  if ((input.effect === 'status-write'
      || input.effect === 'merge-write'
      || input.effect === 'branch-closeout-write')
      && (input.principal.transport !== 'github-rest-token'
        || (input.principal.permission !== 'admin' && input.principal.permission !== 'maintain'))) {
    throw new GitHubApiProviderError('GitHub API privileged write capability requires maintain/admin user permission');
  }
  if (input.effect === 'issue-comment-write'
      && input.principal.transport === 'github-rest-token'
      && input.principal.permission !== 'admin' && input.principal.permission !== 'maintain') {
    throw new GitHubApiProviderError('GitHub API user comment write capability requires maintain/admin permission');
  }
  if (input.principal.transport === 'github-actions-token'
      && input.effect !== 'read' && input.effect !== 'issue-comment-write') {
    throw new GitHubApiProviderError('GitHub Actions workflow principal permits only read and issue-comment-write effects');
  }
  const capability = Object.freeze({}) as GitHubApiCapability;
  capabilityBindings.set(capability, Object.freeze({
    repository: input.repository,
    token: input.token,
    principal: Object.freeze({ ...input.principal }),
    effect: input.effect,
    transport: input.transport,
    origin: input.origin
  }));
  return capability;
}

/** Test-only issuance. A structural clone is not present in the owner WeakMap. */
export function issueGitHubApiCapabilityForTestSupport(input: Readonly<{
  repository: string;
  token: string;
  principal: GitHubApiPrincipal;
  effect: GitHubApiEffect;
  transport: GitHubApiTransport;
}>): GitHubApiCapability {
  return issueCapability({ ...input, origin: 'test' });
}

function createSession(input: Readonly<{
  capability?: GitHubApiCapability;
  repository: string;
  effect: GitHubApiEffect;
  origin: 'production' | 'test';
  budget?: GitHubApiOperationBudget;
  now?: () => number;
  timeoutMs?: number;
}>): GitHubApiRequestSession {
  repository(input.repository);
  const now = input.now ?? Date.now;
  const timeoutMs = input.timeoutMs ?? GITHUB_API_REQUEST_TIMEOUT_MS;
  const startedAt = now();
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isFinite(startedAt)) {
    throw new GitHubApiProviderError('GitHub API operation clock or timeout is invalid');
  }
  const deadlineAt = Math.min(startedAt + timeoutMs, input.budget?.deadlineAt ?? Number.POSITIVE_INFINITY);
  if (!Number.isFinite(deadlineAt) || deadlineAt <= startedAt) {
    throw new GitHubApiProviderError('GitHub API operation parent deadline exceeded');
  }
  const abortController = new AbortController();
  return {
    capability: input.capability,
    repository: input.repository,
    effect: input.effect,
    origin: input.origin,
    operationBudget: input.budget,
    now,
    deadlineAt,
    abortController,
    deadlineTimer: setTimeout(() => abortController.abort(), Math.max(1, Math.ceil(deadlineAt - startedAt))),
    phase: 'open',
    responseSettlementFailures: [],
    inFlight: 0,
    requestCount: 0,
    requestBytes: 0,
    responseBytes: 0
  };
}

function remaining(session: GitHubApiRequestSession): number {
  if (session.responseSettlementFailures.length !== 0) {
    throw new GitHubApiProviderError('GitHub API response resources have unresolved settlement failures');
  }
  const parentRemaining = session.operationBudget === undefined
    ? Number.POSITIVE_INFINITY
    : session.operationBudget.deadlineAt - session.operationBudget.now();
  const value = Math.min(session.deadlineAt - session.now(), parentRemaining);
  if (session.phase !== 'open' || isNativeAborted(session.abortController.signal) || !Number.isFinite(value) || value <= 0) {
    if (!isNativeAborted(session.abortController.signal)) session.abortController.abort();
    throw new GitHubApiProviderError('GitHub API operation deadline exceeded or is already settled');
  }
  return Math.max(1, Math.ceil(value));
}

function reserve(session: GitHubApiRequestSession, requestBytes: number): void {
  remaining(session);
  const budget = session.operationBudget;
  if (session.requestCount >= MAX_REQUESTS || (budget !== undefined && budget.requestCount >= MAX_REQUESTS)) {
    throw new GitHubApiProviderError('GitHub API operation request-count budget exceeded');
  }
  if (!Number.isSafeInteger(requestBytes) || requestBytes < 0
      || session.requestBytes + requestBytes > MAX_REQUEST_BYTES
      || (budget !== undefined && budget.requestBytes + requestBytes > MAX_REQUEST_BYTES)) {
    throw new GitHubApiProviderError('GitHub API operation request-byte budget exceeded');
  }
  session.requestCount += 1;
  session.requestBytes += requestBytes;
  if (budget !== undefined) {
    budget.requestCount += 1;
    budget.requestBytes += requestBytes;
  }
}

function recordResponseBytes(session: GitHubApiRequestSession, bytes: number): void {
  session.responseBytes += bytes;
  if (session.operationBudget !== undefined) session.operationBudget.responseBytes += bytes;
  if (session.responseBytes > MAX_RESPONSE_BYTES
      || (session.operationBudget !== undefined && session.operationBudget.responseBytes > MAX_RESPONSE_BYTES)) {
    throw new GitHubApiProviderError('GitHub API operation response-byte budget exceeded');
  }
}

async function executeWithToken<T>(
  session: GitHubApiRequestSession,
  token: string,
  transport: GitHubApiTransport,
  operation: GitHubApiOperation,
  exactRepositoryNodeId?: string
): Promise<T> {
  const compiled = compileOperation(
    session.repository,
    session.effect,
    operation,
    exactRepositoryNodeId
  );
  const body = compiled.body === undefined ? undefined : JSON.stringify(compiled.body);
  reserve(session, body === undefined ? 0 : Buffer.byteLength(body, 'utf8'));
  const timeoutMs = remaining(session);
  const transportSignal = linkNativeAbortSignals(session.abortController.signal);
  session.inFlight += 1;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let firstFailure: { error: unknown } | undefined;
  const captureFailure = (error: unknown): unknown => {
    const failure = error instanceof GitHubApiProviderError || error instanceof ResourceCompositeSettlementError
      ? error
      : new GitHubApiProviderError(
        `GitHub API ${compiled.kind} transport unavailable: ${isNativeAborted(session.abortController.signal) ? 'operation deadline exceeded' : error instanceof Error ? error.message : String(error)}`
      );
    firstFailure ??= { error: failure };
    return failure;
  };
  // This promise owns the real transport and response, not just observation of
  // them. A deadline may reject its observer but must not debit inFlight early.
  const request = (async (): Promise<T> => {
    try {
      const response = await transport(canonicalTarget(compiled.path), {
        method: compiled.method,
        redirect: 'error',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'sec-github-api-operation-session-v1',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        signal: transportSignal,
        ...(body === undefined ? {} : { body })
      });
      if (response.body === null) {
        remaining(session);
        if (response.status === 204 && response.ok && compiled.method === 'DELETE'
            && compiled.kind === 'delete-repository-runner') return null as T;
        if (response.status === 204) throw new GitHubApiProviderError(
          `GitHub API ${compiled.kind} returned an invalid 204 response`, response.status
        );
        throw new GitHubApiProviderError('GitHub API response does not expose a bounded streaming body', response.status);
      }
      if (typeof response.body.getReader !== 'function') {
        throw new GitHubApiProviderError('GitHub API response does not expose a bounded streaming body', response.status);
      }
      return await withOwnedByteStreamReader(response.body, async read => {
        try {
          // Also rejects a late response before decoding or installing it, but
          // only after its returned body has entered the closeout owner.
          remaining(session);
          if (response.status === 204) throw new GitHubApiProviderError(
            `GitHub API ${compiled.kind} returned an invalid 204 response`, response.status
          );
          const decoder = new TextDecoder('utf-8', { fatal: true });
          const chunks: string[] = [];
          for (;;) {
            const chunk = await read();
            if (!chunk.done) recordResponseBytes(session, chunk.value.byteLength);
            remaining(session);
            if (chunk.done) break;
            chunks.push(decoder.decode(chunk.value, { stream: true }));
          }
          chunks.push(decoder.decode());
          const source = chunks.join('');
          if (!response.ok) throw new GitHubApiProviderError(
            `GitHub API ${compiled.kind} failed with HTTP ${response.status}: ${source.slice(-2048)}`, response.status
          );
          try { return JSON.parse(source) as T; }
          catch (error) { throw new GitHubApiProviderError(
            `GitHub API ${compiled.kind} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`, response.status
          ); }
        } catch (error) { throw captureFailure(error); }
      }, session.abortController.signal);
    } catch (error) {
      if (error instanceof ResourceCompositeSettlementError) session.responseSettlementFailures.push(error);
      throw captureFailure(error);
    } finally {
      session.inFlight -= 1;
      if (session.phase === 'closing' && session.inFlight === 0) session.phase = 'settled';
    }
  })();
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      const error = new GitHubApiProviderError('GitHub API operation deadline exceeded');
      if (!isNativeAborted(session.abortController.signal)) session.abortController.abort();
      reject(firstFailure === undefined ? error : new AggregateError(
        [firstFailure.error, error], 'GitHub API request failed before its resource settlement deadline'
      ));
    }, timeoutMs);
  });
  try { return await Promise.race([request, deadline]); }
  finally { clearTimeout(timeout); }
}

export async function executeGitHubApiOperation(
  capability: GitHubApiCapability,
  operation: GitHubApiOperation
): Promise<unknown> {
  const value = binding(capability);
  const session = requestSession.getStore();
  if (session === undefined || session.capability !== capability
      || session.repository !== value.repository || session.effect !== value.effect
      || session.origin !== value.origin) {
    throw new GitHubApiProviderError('GitHub API request requires the active exact operation session');
  }
  const kind = operation.kind;
  if (kind !== 'delete-ref-cas') {
    const capturedOperation = Object.create(operation) as GitHubApiOperation;
    Object.defineProperty(capturedOperation, 'kind', { value: kind });
    return await executeWithToken<unknown>(session, value.token, value.transport, capturedOperation);
  }
  if (value.effect !== 'branch-closeout-write') {
    throw new GitHubApiProviderError(
      'GitHub API exact ref deletion requires branch-closeout-write authority'
    );
  }
  const deleteOperation = operation as Extract<GitHubApiOperation, { kind: 'delete-ref-cas' }>;
  const branch = deleteOperation.branch;
  const expectedOldSha = deleteOperation.expectedOldSha;
  assertGitBranchName(branch, 'GitHub API exact ref deletion branch');
  boundedText(branch, 'branch', 255);
  sha(expectedOldSha);
  const capturedOperation: GitHubApiOperation = Object.freeze({
    kind: 'delete-ref-cas', branch, expectedOldSha
  });
  const repositoryObservation = await executeWithToken<unknown>(
    session,
    value.token,
    value.transport,
    { kind: 'repository' }
  );
  if (repositoryObservation === null || typeof repositoryObservation !== 'object'
      || Array.isArray(repositoryObservation)) {
    throw new GitHubApiProviderError(
      'GitHub API exact ref deletion repository identity response is invalid'
    );
  }
  const repositoryRecord = repositoryObservation as Record<string, unknown>;
  if (repositoryRecord.full_name !== value.repository
      || typeof repositoryRecord.node_id !== 'string'
      || repositoryRecord.node_id.length === 0
      || repositoryRecord.node_id.length > 512
      || /[\u0000-\u001f\u007f]/u.test(repositoryRecord.node_id)) {
    throw new GitHubApiProviderError(
      'GitHub API exact ref deletion repository identity differs from the active session'
    );
  }
  const mutation = await executeWithToken<unknown>(
    session,
    value.token,
    value.transport,
    capturedOperation,
    repositoryRecord.node_id
  );
  if (mutation === null || typeof mutation !== 'object' || Array.isArray(mutation)) {
    throw new GitHubApiProviderError('GitHub API exact ref deletion response is invalid');
  }
  const mutationRecord = mutation as Record<string, unknown>;
  if (Object.hasOwn(mutationRecord, 'errors')
      && (!Array.isArray(mutationRecord.errors) || mutationRecord.errors.length > 0)) {
    throw new GitHubApiProviderError('GitHub API exact ref deletion returned GraphQL errors');
  }
  const data = mutationRecord.data;
  const updateRefs = data !== null && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>).updateRefs
    : null;
  if (data === null || typeof data !== 'object' || Array.isArray(data)
      || updateRefs === null || typeof updateRefs !== 'object' || Array.isArray(updateRefs)
      || !Object.hasOwn(updateRefs, 'clientMutationId')
      || (updateRefs as Record<string, unknown>).clientMutationId !== null) {
    throw new GitHubApiProviderError(
      'GitHub API exact ref deletion response lacks one successful updateRefs result'
    );
  }
  return mutation;
}

export function currentGitHubApiCapability(
  repositoryName: string,
  effect: GitHubApiEffect
): GitHubApiCapability {
  const session = requestSession.getStore();
  if (session?.capability === undefined || session.repository !== repositoryName
      || session.effect !== effect) {
    throw new GitHubApiProviderError('GitHub API operation requires a live owner-issued capability');
  }
  remaining(session);
  return session.capability;
}

async function settleSession<T>(
  session: GitHubApiRequestSession,
  operation: () => Promise<T>
): Promise<T> {
  // Failure occurrence is independent of its payload, including undefined/null.
  // Every effect-specific entry and nested session closes through this owner.
  let outcome: Readonly<{ status: 'succeeded'; value: T }>
    | Readonly<{ status: 'failed'; error: unknown }>;
  try {
    const value = await operation();
    remaining(session);
    outcome = { status: 'succeeded', value };
  } catch (error) {
    outcome = { status: 'failed', error };
  }
  const inFlight = session.inFlight;
  session.phase = inFlight === 0 ? 'settled' : 'closing';
  clearTimeout(session.deadlineTimer);
  if (!isNativeAborted(session.abortController.signal)) session.abortController.abort();
  const failures = outcome.status === 'failed' ? [outcome.error] : [];
  for (const failure of session.responseSettlementFailures) {
    if (!failures.includes(failure)) failures.push(failure);
  }
  if (inFlight !== 0) failures.push(new GitHubApiProviderError(
    'GitHub API operation settlement failed because requests remain in flight'
  ));
  if (failures.length > 1) throw new AggregateError(failures, 'GitHub API operation and settlement both failed');
  if (failures.length === 1) throw failures[0];
  if (outcome.status === 'failed') throw outcome.error;
  return outcome.value;
}

async function readProductionToken(repositoryRoot: string, session: GitHubApiRequestSession): Promise<string> {
  reserve(session, 0);
  let bytes: Uint8Array | null = null;
  try {
    bytes = await readGitHubToken({
      cwd: path.resolve(repositoryRoot),
      repository: session.repository,
      hostname: GITHUB_HOST,
      deadlineAtUnixMs: Math.min(session.deadlineAt, Date.now() + remaining(session))
    });
    remaining(session);
    recordResponseBytes(session, bytes.byteLength);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof GitHubCredentialUnavailableError) {
      throw new GitHubApiProviderError('GitHub API credential provider is unavailable');
    }
    throw error;
  } finally {
    bytes?.fill(0);
  }
}

type TokenReader = (
  repositoryRoot: string,
  session: GitHubApiRequestSession
) => Promise<string>;

async function enroll(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  effect: GitHubApiEffect;
  origin: 'production' | 'test';
  transport: GitHubApiTransport;
  readToken: TokenReader;
}>): Promise<GitHubApiCapability> {
  const session = requestSession.getStore();
  if (session === undefined || session.origin !== input.origin
      || session.repository !== input.repository || session.effect !== input.effect) {
    throw new GitHubApiProviderError('GitHub API capability enrollment requires the active matching session');
  }
  if (session.capability !== undefined) return session.capability;
  const token = await input.readToken(input.repositoryRoot, session);
  const workflowIdentity = input.origin === 'production'
    ? inspectGitHubActionsProjectionCredentialIdentity(process.env, input.repository)
    : null;
  if (workflowIdentity !== null) {
    if (input.effect !== 'read' && input.effect !== 'issue-comment-write') {
      throw new GitHubApiProviderError(
        'GitHub Actions projection credential cannot enroll a privileged repository effect'
      );
    }
    const repositoryValue = await executeWithToken<unknown>(
      session,
      token,
      input.transport,
      { kind: 'repository' }
    );
    if (repositoryValue === null || typeof repositoryValue !== 'object' || Array.isArray(repositoryValue)
        || (repositoryValue as Record<string, unknown>).full_name !== input.repository) {
      throw new GitHubApiProviderError('GitHub Actions projection token is not bound to this repository');
    }
    const capability = issueCapability({
      repository: input.repository,
      token,
      principal: Object.freeze({
        transport: 'github-actions-token',
        login: 'github-actions[bot]',
        nodeId: 'MDM6Qm90NDE4OTgyODI=',
        userId: 41898282,
        permission: 'workflow',
        workflowRef: workflowIdentity.workflowRef,
        workflowSha: workflowIdentity.workflowSha
      }),
      effect: input.effect,
      transport: input.transport,
      origin: input.origin
    });
    session.capability = capability;
    remaining(session);
    return capability;
  }
  const viewer = await executeWithToken<unknown>(session, token, input.transport, { kind: 'current-user' });
  if (viewer === null || typeof viewer !== 'object' || Array.isArray(viewer)) {
    throw new GitHubApiProviderError('GitHub API token principal response is invalid');
  }
  const viewerRecord = viewer as Record<string, unknown>;
  const login = viewerRecord.login;
  const nodeId = viewerRecord.node_id;
  const userId = viewerRecord.id === undefined ? null : viewerRecord.id;
  if (typeof login !== 'string' || typeof nodeId !== 'string'
      || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/u.test(login) || nodeId.length === 0
      || (userId !== null && (!Number.isSafeInteger(userId) || (userId as number) < 1))) {
    throw new GitHubApiProviderError('GitHub API token principal identity is invalid');
  }
  const permissionValue = await executeWithToken<unknown>(session, token, input.transport, {
    kind: 'collaborator-permission',
    login
  });
  const permission = permissionValue !== null && typeof permissionValue === 'object'
      && !Array.isArray(permissionValue)
    ? (permissionValue as Record<string, unknown>).permission
    : null;
  if (typeof permission !== 'string'
      || !['admin', 'maintain', 'write', 'triage', 'read', 'none'].includes(permission)) {
    throw new GitHubApiProviderError('GitHub API token repository permission is invalid');
  }
  if (input.origin === 'production' && input.effect === 'runner-admin' && permission !== 'admin') {
    throw new GitHubApiProviderError('GitHub API production runner-admin credential requires admin permission');
  }
  if (input.origin === 'production' && permission !== 'admin' && permission !== 'maintain') {
    throw new GitHubApiProviderError('GitHub API production credential requires maintain/admin permission');
  }
  const capability = issueCapability({
    repository: input.repository,
    token,
    principal: Object.freeze({
      transport: 'github-rest-token',
      login,
      nodeId,
      userId: userId as number | null,
      permission: permission as GitHubUserApiPrincipal['permission']
    }),
    effect: input.effect,
    transport: input.transport,
    origin: input.origin
  });
  session.capability = capability;
  remaining(session);
  return capability;
}

async function runSession<T>(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  effect: GitHubApiEffect;
  origin: 'production' | 'test';
  transport: GitHubApiTransport;
  readToken: TokenReader;
  operation: (capability: GitHubApiCapability) => Promise<T>;
  budget?: GitHubApiOperationBudget;
  now?: () => number;
  timeoutMs?: number;
}>): Promise<T> {
  const current = requestSession.getStore();
  if (current !== undefined) {
    if (current.repository !== input.repository || current.effect !== input.effect
        || current.origin !== input.origin || current.capability === undefined) {
      throw new GitHubApiProviderError(
        'GitHub API session is not bound to this repository/effect/origin or exact capability'
      );
    }
    remaining(current);
    return await input.operation(current.capability);
  }
  if (input.budget !== undefined) {
    const remainingBudget = input.budget.deadlineAt - input.budget.now();
    if (input.budget.repositoryRoot !== path.resolve(input.repositoryRoot)
        || input.budget.repository !== input.repository || input.budget.effect !== input.effect
        || input.budget.origin !== input.origin || remainingBudget <= 0) {
      throw new GitHubApiProviderError('GitHub API parent operation budget boundary is invalid');
    }
    if (input.budget.sessionCount >= input.budget.maxSessions) {
      throw new GitHubApiProviderError('GitHub API parent operation session-count budget exceeded');
    }
    input.budget.sessionCount += 1;
  }
  const session = createSession({
    repository: input.repository,
    effect: input.effect,
    origin: input.origin,
    budget: input.budget,
    now: input.now ?? input.budget?.now,
    timeoutMs: Math.min(
      input.timeoutMs ?? GITHUB_API_REQUEST_TIMEOUT_MS,
      input.budget === undefined
        ? Number.POSITIVE_INFINITY
        : Math.max(1, Math.ceil(input.budget.deadlineAt - input.budget.now()))
    )
  });
  return await requestSession.run(session, async () => await settleSession(session, async () => {
    const capability = await enroll({
      repositoryRoot: input.repositoryRoot,
      repository: input.repository,
      effect: input.effect,
      origin: input.origin,
      transport: input.transport,
      readToken: input.readToken
    });
    return await input.operation(capability);
  }));
}

async function withProductionSession<T>(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  effect: GitHubApiEffect;
  operation: (capability: GitHubApiCapability) => Promise<T>;
}>): Promise<T> {
  return await runSession({
    ...input,
    origin: 'production',
    transport: async (target, init) => await globalThis.fetch(target, init),
    readToken: readProductionToken,
    budget: operationBudget.getStore()
  });
}

export async function withGitHubApiReadSession<T>(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  operation: (capability: GitHubApiCapability) => Promise<T>;
}>): Promise<T> {
  return await withProductionSession({ ...input, effect: 'read' });
}

export async function withGitHubApiStatusWriteSession<T>(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  operation: (capability: GitHubApiCapability) => Promise<T>;
}>): Promise<T> {
  return await withProductionSession({ ...input, effect: 'status-write' });
}

export async function withGitHubApiIssueCommentWriteSession<T>(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  operation: (capability: GitHubApiCapability) => Promise<T>;
}>): Promise<T> {
  return await withProductionSession({ ...input, effect: 'issue-comment-write' });
}

export async function withGitHubApiMergeWriteSession<T>(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  operation: (capability: GitHubApiCapability) => Promise<T>;
}>): Promise<T> {
  return await withProductionSession({ ...input, effect: 'merge-write' });
}

export async function withGitHubApiBranchCloseoutWriteSession<T>(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  operation: (capability: GitHubApiCapability) => Promise<T>;
}>): Promise<T> {
  return await withProductionSession({ ...input, effect: 'branch-closeout-write' });
}

export async function withGitHubApiRunnerAdminSession<T>(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  operation: (capability: GitHubApiCapability) => Promise<T>;
}>): Promise<T> {
  return await withProductionSession({ ...input, effect: 'runner-admin' });
}

export async function withGitHubApiReadOperationBudget<T>(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  operation: () => Promise<T>;
}>): Promise<T> {
  const current = operationBudget.getStore();
  if (current !== undefined) {
    if (current.repositoryRoot !== path.resolve(input.repositoryRoot)
        || current.repository !== input.repository || current.effect !== 'read'
        || current.origin !== 'production' || current.deadlineAt - current.now() <= 0) {
      throw new GitHubApiProviderError(
        'GitHub API nested read operation budget is not bound to this repository'
      );
    }
    const result = await input.operation();
    if (current.deadlineAt - current.now() <= 0) {
      throw new GitHubApiProviderError('GitHub API parent operation deadline exceeded');
    }
    return result;
  }
  const now = Date.now;
  const startedAt = now();
  const budget: GitHubApiOperationBudget = {
    repositoryRoot: path.resolve(input.repositoryRoot),
    repository: repository(input.repository),
    effect: 'read',
    origin: 'production',
    now,
    deadlineAt: startedAt + GITHUB_API_READ_OPERATION_TIMEOUT_MS,
    maxSessions: MAX_READ_SESSIONS,
    sessionCount: 0,
    requestCount: 0,
    requestBytes: 0,
    responseBytes: 0
  };
  return await operationBudget.run(budget, input.operation);
}

export function assertGitHubApiReadOperationBudgetCurrent(input: Readonly<{
  repositoryRoot: string;
  repository: string;
}>): void {
  const budget = operationBudget.getStore();
  if (budget === undefined || budget.repositoryRoot !== path.resolve(input.repositoryRoot)
      || budget.repository !== input.repository || budget.effect !== 'read'
      || budget.origin !== 'production' || budget.deadlineAt - budget.now() <= 0) {
    throw new GitHubApiProviderError('GitHub API read operation budget is not current for this repository');
  }
}

export async function withGitHubApiSessionForTestSupport<T>(input: Readonly<{
  capability: GitHubApiCapability;
  operation: () => Promise<T>;
  now?: () => number;
  timeoutMs?: number;
}>): Promise<T> {
  const value = binding(input.capability);
  if (value.origin !== 'test') {
    throw new GitHubApiProviderError('GitHub API test session cannot consume a production capability');
  }
  const current = requestSession.getStore();
  if (current !== undefined) {
    if (current.capability !== input.capability) {
      throw new GitHubApiProviderError('Nested GitHub API test session must reuse the exact capability');
    }
    remaining(current);
    return await input.operation();
  }
  const session = createSession({
    capability: input.capability,
    repository: value.repository,
    effect: value.effect,
    origin: 'test',
    now: input.now,
    timeoutMs: input.timeoutMs
  });
  return await requestSession.run(session, async () => await settleSession(session, input.operation));
}

async function readTestToken(
  reader: (input: Readonly<{ signal: AbortSignal; timeoutMs: number }>) => Promise<string>,
  session: GitHubApiRequestSession
): Promise<string> {
  reserve(session, 0);
  const timeoutMs = remaining(session);
  const token = await reader({ signal: session.abortController.signal, timeoutMs });
  remaining(session);
  if (typeof token !== 'string' || Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES
      || !/^[^\s\u0000-\u001f\u007f-\u009f]{20,1024}$/u.test(token.trim())) {
    throw new GitHubApiProviderError('GitHub API test token grammar is invalid');
  }
  recordResponseBytes(session, Buffer.byteLength(token, 'utf8'));
  return token.trim();
}

export async function withGitHubApiEnrollmentSessionForTestSupport<T>(input: Readonly<{
  repository: string;
  effect: GitHubApiEffect;
  transport: GitHubApiTransport;
  readToken: (input: Readonly<{ signal: AbortSignal; timeoutMs: number }>) => Promise<string>;
  operation: (capability: GitHubApiCapability) => Promise<T>;
  now?: () => number;
  timeoutMs?: number;
}>): Promise<T> {
  return await runSession({
    repositoryRoot: '',
    repository: input.repository,
    effect: input.effect,
    origin: 'test',
    transport: input.transport,
    readToken: async (_root, session) => await readTestToken(input.readToken, session),
    operation: input.operation,
    now: input.now,
    timeoutMs: input.timeoutMs
  });
}

type TestReadOperationOpen = <T>(
  operation: (capability: GitHubApiCapability) => Promise<T>
) => Promise<T>;

export async function withGitHubApiReadOperationBudgetForTestSupport<T>(input: Readonly<{
  repository: string;
  transport: GitHubApiTransport;
  readToken: (input: Readonly<{ signal: AbortSignal; timeoutMs: number }>) => Promise<string>;
  operation: (open: TestReadOperationOpen) => Promise<T>;
  now?: () => number;
  timeoutMs: number;
  maxSessions?: number;
}>): Promise<T> {
  const now = input.now ?? Date.now;
  const startedAt = now();
  const budget: GitHubApiOperationBudget = {
    repositoryRoot: path.resolve(''),
    repository: repository(input.repository),
    effect: 'read',
    origin: 'test',
    now,
    deadlineAt: startedAt + input.timeoutMs,
    maxSessions: input.maxSessions ?? MAX_READ_SESSIONS,
    sessionCount: 0,
    requestCount: 0,
    requestBytes: 0,
    responseBytes: 0
  };
  return await operationBudget.run(budget, async () => {
    const result = await input.operation(async (operation) => await runSession({
      repositoryRoot: '',
      repository: input.repository,
      effect: 'read',
      origin: 'test',
      transport: input.transport,
      readToken: async (_root, session) => await readTestToken(input.readToken, session),
      operation,
      budget,
      now,
      timeoutMs: GITHUB_API_REQUEST_TIMEOUT_MS
    }));
    if (budget.deadlineAt - budget.now() <= 0) {
      throw new GitHubApiProviderError('GitHub API parent operation deadline exceeded');
    }
    return result;
  });
}
