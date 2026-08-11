import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import {
  GITHUB_PULL_REQUEST_CLOSING_QUERY_V1,
  decideUnexpectedIssueReopenV1,
  parseGitHubClosingKeywordOccurrencesV1,
  parseGitHubPullRequestClosingFactsPageV1,
  type GitHubIssueReferenceV1,
  type GitHubPullRequestClosingFactsV1,
  type IssueDispositionDigestV1
} from '../../platform/shared/issue-disposition-contract.ts';
import { encodeVerificationActionDataV2 } from '../../platform/shared/verification-action-contract.ts';

export interface GitHubIssueObservationV1 {
  readonly repository: string;
  readonly issueNumber: number;
  readonly issueNodeId: string;
  readonly state: 'OPEN' | 'CLOSED';
  readonly stateReason: string | null;
  readonly title: string;
  readonly body: string;
  readonly updatedAt: string;
  readonly closedAt: string | null;
  readonly specRevision: IssueDispositionDigestV1;
  readonly responseDigest: IssueDispositionDigestV1;
}

export interface GitHubLatestClosedEventV1 {
  readonly eventId: string;
  readonly createdAt: string;
  readonly actorLogin: string;
  readonly closer: null | Readonly<{
    repository: string;
    prNumber: number;
    mergeCommitSha: string;
  }>;
  readonly responseDigest: IssueDispositionDigestV1;
}

export type GitHubIssueReconciliationResultV1 = Readonly<{
  status: 'no-op' | 'manual-action-required' | 'blocked';
  issueNumber: number;
  issueDigest: IssueDispositionDigestV1;
  closedEventDigest: IssueDispositionDigestV1 | null;
  decision: ReturnType<typeof decideUnexpectedIssueReopenV1>;
}>;

function fail(message: string): never {
  throw new Error(`IssueDispositionGitHub ${message}`);
}

function hash(value: string | Uint8Array | object): IssueDispositionDigestV1 {
  const source = typeof value === 'string' || value instanceof Uint8Array
    ? value : encodeVerificationActionDataV2(value);
  return `sha256:${createHash('sha256').update(source).digest('hex')}`;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail(`${label} must be one object.`);
  }
  return value as Record<string, unknown>;
}

function repository(value: unknown, label = 'repository'): string {
  if (typeof value !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(value)) {
    return fail(`${label} must be one owner/name identity.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) return fail(`${label} must be positive.`);
  return Number(value);
}

function sha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    return fail(`${label} must be one lowercase Git SHA.`);
  }
  return value;
}

function iso(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    return fail(`${label} must be one canonical UTC instant.`);
  }
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.([0-9]{3}))?Z$/u.exec(value);
  if (match === null) return fail(`${label} must be one canonical UTC instant.`);
  const canonical = `${match[1]}.${match[2] ?? '000'}Z`;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== canonical) {
    return fail(`${label} must be one canonical UTC instant.`);
  }
  return canonical;
}

function nullableIso(value: unknown, label: string): string | null {
  return value === null ? null : iso(value, label);
}

function json(source: string, label: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    return fail(`${label} is not valid JSON; decoded response digest ${hash(source)}.`);
  }
}

function providerShapeFailure(source: string, error: unknown): never {
  const reason = error instanceof Error ? error.message : 'unknown provider response shape';
  throw new Error(`${reason}; decoded response digest ${hash(source)}.`);
}

function parseGitHubIssueObservationUncheckedV1(input: Readonly<{
  source: string;
  repository: string;
  issueNumber: number;
}>): GitHubIssueObservationV1 {
  const raw = record(json(input.source, 'Issue response'), 'Issue response');
  const expectedRepository = repository(input.repository);
  const expectedIssueNumber = positiveInteger(input.issueNumber, 'issueNumber');
  if ('pull_request' in raw) return fail('Issue lifecycle adapter cannot target a pull request resource.');
  const repositoryUrl = raw.repository_url;
  if (typeof repositoryUrl !== 'string'
    || repositoryUrl.toLowerCase() !== `https://api.github.com/repos/${expectedRepository}`.toLowerCase()) {
    return fail('Issue response repository identity differs from the exact target.');
  }
  if (raw.number !== expectedIssueNumber || typeof raw.node_id !== 'string' || raw.node_id.length === 0) {
    return fail('Issue response number or node identity differs from the exact target.');
  }
  if (raw.state !== 'open' && raw.state !== 'closed') return fail('Issue response state is unsupported.');
  if (typeof raw.title !== 'string' || (typeof raw.body !== 'string' && raw.body !== null)) {
    return fail('Issue response specification bytes are invalid.');
  }
  if (raw.state_reason !== null && typeof raw.state_reason !== 'string') {
    return fail('Issue response state reason is invalid.');
  }
  const title = raw.title;
  const body = raw.body ?? '';
  return Object.freeze({ repository: expectedRepository, issueNumber: expectedIssueNumber,
    issueNodeId: raw.node_id, state: raw.state === 'open' ? 'OPEN' : 'CLOSED',
    stateReason: raw.state_reason, title, body,
    updatedAt: iso(raw.updated_at, 'Issue updated_at'),
    closedAt: nullableIso(raw.closed_at, 'Issue closed_at'),
    specRevision: hash({ repository: expectedRepository, issueNumber: expectedIssueNumber, title, body }),
    responseDigest: hash(input.source) });
}

export function parseGitHubIssueObservationV1(input: Readonly<{
  source: string;
  repository: string;
  issueNumber: number;
}>): GitHubIssueObservationV1 {
  try {
    return parseGitHubIssueObservationUncheckedV1(input);
  } catch (error) {
    return providerShapeFailure(input.source, error);
  }
}

function parseGitHubLatestClosedEventUncheckedV1(input: Readonly<{
  source: string;
  repository: string;
  issueNumber: number;
}>): GitHubLatestClosedEventV1 | null {
  const root = record(json(input.source, 'Issue timeline GraphQL response'),
    'Issue timeline GraphQL response');
  if ('errors' in root && (!Array.isArray(root.errors) || root.errors.length > 0)) {
    return fail('Issue timeline GraphQL response contains provider errors.');
  }
  const data = record(root.data, 'Issue timeline GraphQL data');
  const repo = record(data.repository, 'Issue timeline repository');
  const issue = record(repo.issue, 'Issue timeline issue');
  if (issue.number !== positiveInteger(input.issueNumber, 'issueNumber')) {
    return fail('Issue timeline number differs from the exact target.');
  }
  const timeline = record(issue.timelineItems, 'Issue timelineItems');
  if (!Array.isArray(timeline.nodes) || timeline.nodes.length > 100) {
    return fail('Issue timeline terminal-event page is invalid or overbound.');
  }
  const terminal = timeline.nodes.at(-1);
  if (terminal === undefined) return null;
  const event = record(terminal, 'Issue latest terminal event');
  if (event.__typename !== 'ClosedEvent') return null;
  const actor = record(event.actor, 'Issue ClosedEvent actor');
  if (typeof event.id !== 'string' || typeof actor.login !== 'string') {
    return fail('Issue ClosedEvent identity is invalid.');
  }
  let closer: GitHubLatestClosedEventV1['closer'] = null;
  if (event.closer !== null) {
    const closerValue = record(event.closer, 'Issue ClosedEvent closer');
    if (closerValue.__typename === 'PullRequest') {
      const closerRepository = record(closerValue.repository, 'Issue closer repository');
      const mergeCommit = record(closerValue.mergeCommit, 'Issue closer merge commit');
      closer = Object.freeze({ repository: repository(closerRepository.nameWithOwner,
        'Issue closer repository.nameWithOwner'),
      prNumber: positiveInteger(closerValue.number, 'Issue closer PR number'),
      mergeCommitSha: sha(mergeCommit.oid, 'Issue closer merge commit oid') });
    }
  }
  return Object.freeze({ eventId: event.id, createdAt: iso(event.createdAt,
    'Issue ClosedEvent createdAt'), actorLogin: actor.login, closer,
  responseDigest: hash(input.source) });
}

export function parseGitHubLatestClosedEventV1(input: Readonly<{
  source: string;
  repository: string;
  issueNumber: number;
}>): GitHubLatestClosedEventV1 | null {
  try {
    return parseGitHubLatestClosedEventUncheckedV1(input);
  } catch (error) {
    return providerShapeFailure(input.source, error);
  }
}

function gh(args: readonly string[]): string {
  const result = spawnSync('gh', args, { encoding: 'utf8', windowsHide: true,
    maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error !== undefined || result.status !== 0) {
    const diagnostic = `${result.error?.message ?? ''}\n${result.stderr ?? ''}`.trim();
    return fail(`provider command failed; diagnostic digest ${hash(diagnostic)}.`);
  }
  return result.stdout;
}

function ghGraphql(query: string, variables: Readonly<Record<string, unknown>>): string {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [name, value] of Object.entries(variables)) {
    if (value !== null) args.push('-F', `${name}=${String(value)}`);
  }
  return gh(args);
}

function observeIssue(repositoryIdentity: string, issueNumber: number): GitHubIssueObservationV1 {
  return parseGitHubIssueObservationV1({ source: gh(['api',
    `/repos/${repositoryIdentity}/issues/${issueNumber}`]), repository: repositoryIdentity, issueNumber });
}

export function observeGitHubIssueV1(
  repositoryIdentity: string,
  issueNumber: number
): GitHubIssueObservationV1 {
  return observeIssue(repository(repositoryIdentity), positiveInteger(issueNumber, 'issueNumber'));
}

export function observeGitHubPullRequestClosingFactsV1(
  repositoryIdentity: string,
  prNumber: number
): GitHubPullRequestClosingFactsV1 {
  const [owner, name] = repository(repositoryIdentity).split('/') as [string, string];
  let cursor: string | null = null;
  let common: ReturnType<typeof parseGitHubPullRequestClosingFactsPageV1>['facts'] | null = null;
  let expectedTotal: number | null = null;
  let terminalObserved = false;
  const references: GitHubIssueReferenceV1[] = [];
  const decodedPageDigests: IssueDispositionDigestV1[] = [];
  for (let page = 0; page < 256; page += 1) {
    const parsed = parseGitHubPullRequestClosingFactsPageV1({ source: ghGraphql(
      GITHUB_PULL_REQUEST_CLOSING_QUERY_V1, { owner, name, number: prNumber, cursor }
    ), repository: repositoryIdentity, prNumber, expectedCursor: cursor,
    observedBeforeCount: references.length, expectedTotalCount: expectedTotal });
    if (common === null) common = parsed.facts;
    else if (encodeVerificationActionDataV2(common) !== encodeVerificationActionDataV2(parsed.facts)) {
      return fail('pull request identity or prose changed during closing-issue pagination.');
    }
    if (expectedTotal === null) expectedTotal = parsed.totalCount;
    else if (parsed.totalCount !== expectedTotal) {
      return fail('pull request closing-issue totalCount changed during pagination.');
    }
    if (references.length + parsed.closingIssues.length > 256
      || references.length + parsed.closingIssues.length > parsed.totalCount) {
      return fail('pull request closing-issue inventory exceeded its bound or totalCount.');
    }
    references.push(...parsed.closingIssues);
    decodedPageDigests.push(parsed.responseDigest);
    if (parsed.nextCursor === null) {
      terminalObserved = true;
      break;
    }
    cursor = parsed.nextCursor;
    if (page === 255) return fail('pull request closing-issue pagination exceeded its bound.');
  }
  if (common === null || expectedTotal === null || !terminalObserved
    || references.length !== expectedTotal) {
    return fail('pull request closing facts are incomplete against totalCount.');
  }
  const providerReferenceKeys = references.map((entry) =>
    `${entry.repository.toLowerCase()}#${entry.issueNumber}`);
  if (new Set(providerReferenceKeys).size !== providerReferenceKeys.length) {
    return fail('pull request closing-issue pagination contains duplicate identities.');
  }
  const lexical = [
    ...parseGitHubClosingKeywordOccurrencesV1(common.title, repositoryIdentity),
    ...parseGitHubClosingKeywordOccurrencesV1(common.body, repositoryIdentity)
  ].map(({ repository, issueNumber }) => ({ repository, issueNumber }));
  const combined = [...references, ...lexical].sort((left, right) =>
    left.repository.localeCompare(right.repository) || left.issueNumber - right.issueNumber);
  const unique = combined.filter((entry, index) => index === 0
    || entry.repository.toLowerCase() !== combined[index - 1]!.repository.toLowerCase()
    || entry.issueNumber !== combined[index - 1]!.issueNumber);
  return Object.freeze({ ...common, closingIssues: Object.freeze(unique),
    responseDigest: hash({ pages: decodedPageDigests, facts: common,
      providerTotalCount: expectedTotal, closingIssues: unique }) });
}

const ISSUE_TERMINAL_EVENTS_QUERY = 'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){number timelineItems(last:100,itemTypes:[CLOSED_EVENT,REOPENED_EVENT]){nodes{__typename ... on ClosedEvent{id createdAt actor{login} closer{__typename ... on PullRequest{number repository{nameWithOwner} mergeCommit{oid}}}} ... on ReopenedEvent{id createdAt actor{login}}}}}}}';

function observeLatestClosedEvent(
  repositoryIdentity: string,
  issueNumber: number
): GitHubLatestClosedEventV1 | null {
  const [owner, name] = repository(repositoryIdentity).split('/') as [string, string];
  const source = ghGraphql(ISSUE_TERMINAL_EVENTS_QUERY, { owner, name, number: issueNumber });
  return parseGitHubLatestClosedEventV1({ source, repository: repositoryIdentity, issueNumber });
}

/**
 * Read-only reconciliation. GitHub's documented Issue PATCH endpoint has no
 * conditional-write precondition, so this adapter never closes or reopens an
 * Issue. An exact causal mismatch becomes a typed maintainer action instead of
 * a racy last-writer-wins mutation disguised as CAS.
 */
export function observeUnexpectedGitHubIssueClosuresV1(input: Readonly<{
  repository: string;
  prNumber: number;
  mergeCommitSha: string;
}>): readonly GitHubIssueReconciliationResultV1[] {
  const repositoryIdentity = repository(input.repository);
  const prNumber = positiveInteger(input.prNumber, 'prNumber');
  const mergeCommitSha = sha(input.mergeCommitSha, 'mergeCommitSha');
  const pullRequest = observeGitHubPullRequestClosingFactsV1(repositoryIdentity, prNumber);
  if (pullRequest.state !== 'MERGED' || pullRequest.mergeCommitSha !== mergeCommitSha) {
    return fail('unexpected-close reconciliation requires exact merged PR readback.');
  }
  return Object.freeze(pullRequest.closingIssues.map((reference) => {
    if (reference.repository.toLowerCase() !== repositoryIdentity.toLowerCase()) {
      return fail('cross-repository unexpected close requires its owning repository observation.');
    }
    const issue = observeIssue(repositoryIdentity, reference.issueNumber);
    const event = issue.state === 'CLOSED'
      ? observeLatestClosedEvent(repositoryIdentity, reference.issueNumber) : null;
    const decision = decideUnexpectedIssueReopenV1({ repository: repositoryIdentity,
      issueNumber: reference.issueNumber, issueState: issue.state, authorizedIssueNumbers: [],
      closer: event?.closer ?? null, expectedPrNumber: prNumber,
      expectedMergeCommitSha: mergeCommitSha });
    return Object.freeze({ status: decision.decision === 'no-op' ? 'no-op'
      : decision.decision === 'manual-reopen-required' ? 'manual-action-required' : 'blocked',
    issueNumber: reference.issueNumber, issueDigest: issue.responseDigest,
    closedEventDigest: event?.responseDigest ?? null, decision });
  }));
}
