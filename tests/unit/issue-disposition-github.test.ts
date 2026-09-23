import { expect, test } from 'bun:test';
import { parseGitHubPullRequestClosingFactsPage } from '../../src/adapters/self-hosting/control/issues/disposition.ts';
import {
  parseGitHubIssueObservation,
  parseGitHubLatestClosedEvent
} from '../../src/adapters/self-hosting/control/issues/issue-disposition-github.ts';

const REPOSITORY = 'sec-platform/sec';

function issue(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ repository_url: 'https://api.github.com/repos/sec-platform/sec',
    number: 352, node_id: 'I_node', state: 'open', state_reason: null,
    title: 'Focused Issue', body: 'Exact current specification',
    updated_at: '2026-08-12T00:00:00.000Z', closed_at: null, ...overrides });
}

function pullPage(input: { nodes?: unknown[]; totalCount?: number; hasNextPage?: boolean;
  endCursor?: string | null; title?: string; errors?: unknown[] } = {}): string {
  return JSON.stringify({ ...(input.errors === undefined ? {} : { errors: input.errors }),
    data: { repository: { pullRequest: { number: 357,
    title: input.title ?? 'Safe PR', body: 'Work-Package: config/repository/work-packages/x.md\n',
    state: 'OPEN', mergeCommit: null, closingIssuesReferences: {
      totalCount: input.totalCount ?? input.nodes?.length ?? 0,
      nodes: input.nodes ?? [], pageInfo: { hasNextPage: input.hasNextPage ?? false,
        endCursor: input.endCursor ?? null }
    } } } } });
}

test('Issue observation binds exact ordinary-Issue identity, specification, state, and raw bytes', () => {
  const observed = parseGitHubIssueObservation({ source: issue(), repository: REPOSITORY,
    issueNumber: 352 });
  expect(observed).toMatchObject({ repository: REPOSITORY, issueNumber: 352,
    issueNodeId: 'I_node', state: 'OPEN', title: 'Focused Issue',
    body: 'Exact current specification' });
  expect(observed.specRevision).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(parseGitHubIssueObservation({ source: issue({ body: 'changed' }),
    repository: REPOSITORY, issueNumber: 352 }).specRevision).not.toBe(observed.specRevision);
  expect(parseGitHubIssueObservation({ source: `${issue()} `, repository: REPOSITORY,
    issueNumber: 352 }).responseDigest).not.toBe(observed.responseDigest);
  expect(parseGitHubIssueObservation({ source: issue({
    updated_at: '2026-08-12T00:00:00Z'
  }), repository: REPOSITORY, issueNumber: 352 }).updatedAt)
    .toBe('2026-08-12T00:00:00.000Z');
});

test('Issue observation rejects PR resources, identity drift, and malformed provider shape', () => {
  expect(() => parseGitHubIssueObservation({ source: issue({ pull_request: {} }),
    repository: REPOSITORY, issueNumber: 352 })).toThrow('cannot target a pull request');
  expect(() => parseGitHubIssueObservation({ source: issue({ number: 351 }),
    repository: REPOSITORY, issueNumber: 352 })).toThrow('differs');
  expect(() => parseGitHubIssueObservation({ source: 'provider raw secret',
    repository: REPOSITORY, issueNumber: 352 })).toThrow(/decoded response digest sha256:/u);
  const failure = (source: string) => {
    try {
      parseGitHubIssueObservation({ source, repository: REPOSITORY, issueNumber: 352 });
      throw new Error('expected malformed provider response');
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
  const first = failure(issue({ number: 351 }));
  const second = failure(issue({ number: 350 }));
  expect(first).toMatch(/decoded response digest sha256:[0-9a-f]{64}/u);
  expect(second).toMatch(/decoded response digest sha256:[0-9a-f]{64}/u);
  expect(first).not.toBe(second);
});

test('PR closing reference pages require sequential bounded pagination and stable identity', () => {
  const first = parseGitHubPullRequestClosingFactsPage({ source: pullPage({
    nodes: [{ number: 352, repository: { nameWithOwner: REPOSITORY } }],
    totalCount: 2, hasNextPage: true, endCursor: 'cursor-1' }), repository: REPOSITORY,
  prNumber: 357, expectedCursor: null, observedBeforeCount: 0, expectedTotalCount: null });
  expect(first.closingIssues).toEqual([{ repository: REPOSITORY, issueNumber: 352 }]);
  expect(first.nextCursor).toBe('cursor-1');
  const last = parseGitHubPullRequestClosingFactsPage({ source: pullPage({ totalCount: 2,
    nodes: [{ number: 353, repository: { nameWithOwner: REPOSITORY } }],
    hasNextPage: false, endCursor: null }), repository: REPOSITORY,
  prNumber: 357, expectedCursor: 'cursor-1', observedBeforeCount: 1,
  expectedTotalCount: 2 });
  expect(last.nextCursor).toBeNull();
  expect(() => parseGitHubPullRequestClosingFactsPage({ source: pullPage({
    hasNextPage: true, endCursor: 'same' }), repository: REPOSITORY,
  prNumber: 357, expectedCursor: 'same', observedBeforeCount: 0,
  expectedTotalCount: null })).toThrow('did not advance');
  expect(() => parseGitHubPullRequestClosingFactsPage({ source: pullPage({
    errors: [{ message: 'partial provider failure' }] }), repository: REPOSITORY,
  prNumber: 357, expectedCursor: null, observedBeforeCount: 0,
  expectedTotalCount: null })).toThrow('contains provider errors');
  expect(() => parseGitHubPullRequestClosingFactsPage({ source: pullPage({
    nodes: [], totalCount: 1 }), repository: REPOSITORY,
  prNumber: 357, expectedCursor: null, observedBeforeCount: 0,
  expectedTotalCount: null })).toThrow('incomplete or inconsistent');
  expect(() => parseGitHubPullRequestClosingFactsPage({ source: pullPage({
    totalCount: 3 }), repository: REPOSITORY, prNumber: 357, expectedCursor: 'cursor-1',
  observedBeforeCount: 1, expectedTotalCount: 2 })).toThrow('changed during pagination');
});

test('latest ClosedEvent exposes exact PR and merge causality, while reopen or actor-only close does not', () => {
  const source = JSON.stringify({ data: { repository: { issue: { number: 346,
    timelineItems: { nodes: [{ __typename: 'ClosedEvent', id: 'CE_1',
      createdAt: '2026-08-11T12:04:29Z', actor: { login: 'maintainer' },
      closer: { __typename: 'PullRequest', number: 351,
        repository: { nameWithOwner: REPOSITORY }, mergeCommit: { oid: 'a'.repeat(40) } } }] }
  } } } });
  expect(parseGitHubLatestClosedEvent({ source, repository: REPOSITORY, issueNumber: 346 }))
    .toMatchObject({ eventId: 'CE_1', closer: { repository: REPOSITORY, prNumber: 351,
      mergeCommitSha: 'a'.repeat(40) }, createdAt: '2026-08-11T12:04:29.000Z' });
  const reopened = JSON.stringify({ data: { repository: { issue: { number: 346,
    timelineItems: { nodes: [{ __typename: 'ClosedEvent', id: 'CE_1',
      createdAt: '2026-08-11T12:04:29.000Z', actor: { login: 'maintainer' }, closer: null },
    { __typename: 'ReopenedEvent', id: 'RE_1', createdAt: '2026-08-11T12:15:05.000Z',
      actor: { login: 'maintainer' } }] } } } } });
  expect(parseGitHubLatestClosedEvent({ source: reopened, repository: REPOSITORY,
    issueNumber: 346 })).toBeNull();
});
