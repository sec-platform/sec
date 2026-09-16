import { describe, expect, test } from 'bun:test';

import {
  buildGitHubDefaultBranchOpenPullRequestsArgs,
  buildGitHubDefaultBranchRefArgs,
  buildGitHubOpenInventoryCountsArgs,
  buildGitHubOpenIssuesArgs,
  buildGitHubOpenPullRequestReviewThreadsArgs,
  buildGitHubOpenPullRequestsArgs,
  buildGitHubPullRequestReviewThreadsArgs,
  parseExactGitHubNumberedInventory,
  parseGitHubDefaultBranchRef,
  parseGitHubOpenInventoryCounts,
  parseGitHubOpenPullRequestReviewThreadPages,
  parseGitHubPullRequestReviewThreadPages,
  parseGitHubRepositoryIdentityFromRemoteUrl,
  replaceIncompleteGitHubReviewThreads
} from '../../src/control/documentation/document-control-plane-github-observation.ts';

const REPOSITORY = 'sec-platform/sec';

function response(value: unknown): string {
  return JSON.stringify(value);
}

function threadNodes(count: number): Readonly<{ isResolved: boolean }>[] {
  return Array.from({ length: count }, (_, index) => ({ isResolved: index % 2 === 0 }));
}

function pullRequestNode(number: number, options: {
  totalCount?: number;
  nodes?: readonly Readonly<{ isResolved: boolean }>[];
  hasNextPage?: boolean;
} = {}): Readonly<Record<string, unknown>> {
  const nodes = options.nodes ?? [];
  return {
    number,
    reviewThreads: {
      totalCount: options.totalCount ?? nodes.length,
      nodes,
      pageInfo: {
        hasNextPage: options.hasNextPage ?? false,
        endCursor: options.hasNextPage ? `threads-${number}` : null
      }
    }
  };
}

function openPullRequestPage(
  totalCount: number,
  nodes: readonly Readonly<Record<string, unknown>>[],
  hasNextPage: boolean,
  endCursor: string | null
): Readonly<Record<string, unknown>> {
  return {
    data: {
      repository: {
        pullRequests: {
          totalCount,
          nodes,
          pageInfo: { hasNextPage, endCursor }
        }
      }
    }
  };
}

function pullRequestThreadPage(
  number: number,
  totalCount: number,
  nodes: readonly Readonly<{ isResolved: boolean }>[],
  hasNextPage: boolean,
  endCursor: string | null
): Readonly<Record<string, unknown>> {
  return {
    data: {
      repository: {
        pullRequest: {
          number,
          reviewThreads: {
            totalCount,
            nodes,
            pageInfo: { hasNextPage, endCursor }
          }
        }
      }
    }
  };
}

describe('Document Control Plane complete GitHub observation', () => {
  test('derives exact list limits from provider totalCount instead of a fixed first page', () => {
    const counts = parseGitHubOpenInventoryCounts(response({
      data: {
        repository: {
          pullRequests: { totalCount: 2 },
          issues: { totalCount: 147 }
        }
      }
    }));

    expect(counts).toEqual({ pullRequests: 2, issues: 147 });
    expect(buildGitHubOpenPullRequestsArgs(REPOSITORY, counts.pullRequests)).toContain('2');
    expect(buildGitHubOpenIssuesArgs(REPOSITORY, counts.issues)).toContain('147');
    expect(buildGitHubOpenInventoryCountsArgs(REPOSITORY)).toContain('graphql');
    expect(buildGitHubOpenPullRequestReviewThreadsArgs(REPOSITORY)).toEqual(
      expect.arrayContaining(['--paginate', '--slurp'])
    );
    expect(buildGitHubPullRequestReviewThreadsArgs(REPOSITORY, 496)).toEqual(
      expect.arrayContaining(['--paginate', '--slurp', 'number=496'])
    );
  });

  test('bounds active Work Selection to pull requests targeting the canonical default branch', () => {
    expect(buildGitHubDefaultBranchOpenPullRequestsArgs(REPOSITORY, 'main')).toEqual([
      'pr', 'list', '--repo', REPOSITORY, '--base', 'main', '--state', 'open',
      '--limit', '2', '--json',
      'number,headRefName,headRefOid,baseRefName,baseRefOid,body'
    ]);
    expect(() => buildGitHubDefaultBranchOpenPullRequestsArgs(REPOSITORY, '-unsafe'))
      .toThrow('must be one bounded option-safe Git branch name');
  });

  test('observes the exact GitHub default ref without ambient Git credentials', () => {
    expect(buildGitHubDefaultBranchRefArgs(REPOSITORY, 'main')).toEqual(
      expect.arrayContaining([
        'api', 'graphql', '-F', 'owner=sec-platform', '-F', 'name=sec',
        '-F', 'qualifiedName=refs/heads/main'
      ])
    );
    expect(parseGitHubDefaultBranchRef(response({
      data: {
        repository: {
          ref: { target: { oid: 'a'.repeat(40) } }
        }
      }
    }))).toBe('a'.repeat(40));
    expect(() => parseGitHubDefaultBranchRef(response({
      data: { repository: { ref: null } }
    }))).toThrow('default-branch ref response.data.repository.ref must be an object');
    expect(parseGitHubRepositoryIdentityFromRemoteUrl(
      'https://github.com/sec-platform/sec.git'
    )).toBe(REPOSITORY);
    expect(parseGitHubRepositoryIdentityFromRemoteUrl(
      'git@github.com:sec-platform/sec.git'
    )).toBe(REPOSITORY);
    expect(parseGitHubRepositoryIdentityFromRemoteUrl('D:/fixtures/sec.git')).toBeNull();
  });

  test('accepts a complete inventory above 100 and rejects truncation or duplicate identities', () => {
    const complete = Array.from({ length: 147 }, (_, index) => ({
      number: index + 1,
      title: `Issue ${index + 1}`
    }));
    expect(parseExactGitHubNumberedInventory(
      response(complete),
      'open issue inventory',
      147
    )).toHaveLength(147);

    expect(() => parseExactGitHubNumberedInventory(
      response(complete.slice(0, 100)),
      'open issue inventory',
      147
    )).toThrow('expected 147 entries, observed 100');
    expect(() => parseExactGitHubNumberedInventory(
      response([{ number: 1 }, { number: 1 }]),
      'open issue inventory',
      2
    )).toThrow('duplicate number 1');
  });

  test('flattens more than one hundred open pull requests without losing review-thread ownership', () => {
    const expectedNumbers = Array.from({ length: 101 }, (_, index) => index + 1);
    const first = expectedNumbers.slice(0, 100).map((number) => pullRequestNode(number));
    const second = [pullRequestNode(101)];
    const inventory = parseGitHubOpenPullRequestReviewThreadPages(response([
      openPullRequestPage(101, first, true, 'next-pr-page'),
      openPullRequestPage(101, second, false, null)
    ]), expectedNumbers);

    expect(inventory.pullRequests).toHaveLength(101);
    expect(inventory.incompletePullRequestNumbers).toEqual([]);
    expect(() => parseGitHubOpenPullRequestReviewThreadPages(response([
      openPullRequestPage(101, first, false, null)
    ]), expectedNumbers)).toThrow('expected 101 pull requests, observed 100');
  });

  test('paginates a pull request with more than one hundred review threads and requires exact replacement', () => {
    const firstThreads = threadNodes(100);
    const lastThread = threadNodes(1);
    const inventory = parseGitHubOpenPullRequestReviewThreadPages(response([
      openPullRequestPage(1, [pullRequestNode(496, {
        totalCount: 101,
        nodes: firstThreads,
        hasNextPage: true
      })], false, null)
    ]), [496]);

    expect(inventory.incompletePullRequestNumbers).toEqual([496]);
    expect(inventory.pullRequests[0]?.reviewThreads.pageInfo.hasNextPage).toBe(true);

    const completeThreads = parseGitHubPullRequestReviewThreadPages(response([
      pullRequestThreadPage(496, 101, firstThreads, true, 'next-thread-page'),
      pullRequestThreadPage(496, 101, lastThread, false, null)
    ]), 496);
    expect(completeThreads.nodes).toHaveLength(101);
    expect(replaceIncompleteGitHubReviewThreads(
      inventory,
      new Map([[496, completeThreads]])
    )).toEqual([{
      number: 496,
      reviewThreads: completeThreads
    }]);
    expect(() => replaceIncompleteGitHubReviewThreads(inventory, new Map()))
      .toThrow('replacement set does not exactly match');
  });

  test('fails closed on malformed counts and incomplete pagination sequences', () => {
    expect(() => parseGitHubOpenInventoryCounts(response({
      data: { repository: { pullRequests: { totalCount: 1 }, issues: { totalCount: -1 } } }
    }))).toThrow('issue totalCount must be a non-negative safe integer');
    expect(() => parseGitHubOpenInventoryCounts(response({
      errors: [{ message: 'partial provider response' }],
      data: { repository: { pullRequests: { totalCount: 1 }, issues: { totalCount: 1 } } }
    }))).toThrow('errors must be an absent or empty array');

    expect(() => parseGitHubPullRequestReviewThreadPages(response([
      pullRequestThreadPage(496, 2, threadNodes(1), false, null),
      pullRequestThreadPage(496, 2, threadNodes(1), false, null)
    ]), 496)).toThrow('pagination sequence is incomplete or contains trailing pages');
  });
});
