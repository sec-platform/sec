/**
 * Complete, machine-readable GitHub observation for Document Control Plane status.
 *
 * This module only owns protocol normalization and completeness checks. GitHub
 * remains the external fact provider and Document Control Plane remains the
 * semantic owner. Fixed-size first-page results are never accepted as a complete
 * repository census.
 */

import { assertGitBranchName } from '../../contracts/git-reference.ts';

export interface GitHubOpenInventoryCounts {
  readonly pullRequests: number;
  readonly issues: number;
}

export interface GitHubReviewThreadConnection {
  readonly totalCount: number;
  readonly nodes: readonly Readonly<{ isResolved: boolean }>[];
  readonly pageInfo: Readonly<{
    hasNextPage: false;
    endCursor: null;
  }>;
}

export interface GitHubReviewThreadPullRequest {
  readonly number: number;
  readonly reviewThreads: GitHubReviewThreadConnection;
}

export interface GitHubObservedReviewThreadPullRequest {
  readonly number: number;
  readonly reviewThreads: Readonly<{
    totalCount: number;
    nodes: readonly Readonly<{ isResolved: boolean }>[];
    pageInfo: Readonly<{
      hasNextPage: boolean;
      endCursor: null;
    }>;
  }>;
}

export interface GitHubReviewThreadInventory {
  readonly pullRequests: readonly GitHubObservedReviewThreadPullRequest[];
  readonly incompletePullRequestNumbers: readonly number[];
}

const OPEN_INVENTORY_COUNTS_QUERY =
  'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){pullRequests(states:OPEN){totalCount}issues(states:OPEN){totalCount}}}';

const DEFAULT_BRANCH_REF_QUERY =
  'query($owner:String!,$name:String!,$qualifiedName:String!){repository(owner:$owner,name:$name){ref(qualifiedName:$qualifiedName){target{oid}}}}';

const OPEN_PULL_REQUEST_REVIEW_THREADS_QUERY =
  'query($owner:String!,$name:String!,$endCursor:String){repository(owner:$owner,name:$name){pullRequests(first:100,after:$endCursor,states:OPEN,orderBy:{field:UPDATED_AT,direction:DESC}){totalCount nodes{number reviewThreads(first:100){totalCount nodes{isResolved}pageInfo{hasNextPage endCursor}}}pageInfo{hasNextPage endCursor}}}}';

const PULL_REQUEST_REVIEW_THREADS_QUERY =
  'query($owner:String!,$name:String!,$number:Int!,$endCursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){number reviewThreads(first:100,after:$endCursor){totalCount nodes{isResolved}pageInfo{hasNextPage endCursor}}}}}';

function fail(message: string): never {
  throw new Error(`GitHub open-inventory observation ${message}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function json(source: string, label: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    return fail(`${label} must be valid JSON.`);
  }
}

function graphqlData(root: Record<string, unknown>, label: string): Record<string, unknown> {
  if ('errors' in root) {
    if (!Array.isArray(root.errors) || root.errors.length > 0) {
      fail(`${label}.errors must be an absent or empty array.`);
    }
  }
  return record(root.data, `${label}.data`);
}

function count(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(`${label} must be a non-negative safe integer.`);
  }
  return value as number;
}

function positiveNumber(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    fail(`${label} must be a positive safe integer.`);
  }
  return value as number;
}

function repositoryParts(repository: string): Readonly<{ owner: string; name: string }> {
  const parts = repository.split('/');
  if (parts.length !== 2 || parts.some((part) => part.length === 0 || part.includes('\0'))) {
    fail('repository must be an exact owner/name pair.');
  }
  return Object.freeze({ owner: parts[0]!, name: parts[1]! });
}

function graphqlArgs(
  repository: string,
  query: string,
  variables: readonly string[],
  paginated = false
): string[] {
  const { owner, name } = repositoryParts(repository);
  return [
    'api',
    'graphql',
    ...(paginated ? ['--paginate', '--slurp'] : []),
    '-f',
    `query=${query}`,
    '-F',
    `owner=${owner}`,
    '-F',
    `name=${name}`,
    ...variables
  ];
}

export function buildGitHubOpenInventoryCountsArgs(repository: string): string[] {
  return graphqlArgs(repository, OPEN_INVENTORY_COUNTS_QUERY, []);
}

export function buildGitHubDefaultBranchRefArgs(
  repository: string,
  defaultBranch: string
): string[] {
  repositoryParts(repository);
  assertGitBranchName(defaultBranch, 'Document-control default branch');
  return graphqlArgs(repository, DEFAULT_BRANCH_REF_QUERY, [
    '-F',
    `qualifiedName=refs/heads/${defaultBranch}`
  ]);
}

export function parseGitHubRepositoryIdentityFromRemoteUrl(remoteUrl: string): string | null {
  const normalized = remoteUrl.trim().replace(/\.git$/iu, '');
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/iu
    .exec(normalized);
  return match === null ? null : `${match[1]}/${match[2]}`;
}

export function buildGitHubOpenPullRequestsArgs(
  repository: string,
  expectedCount: number
): string[] {
  return [
    'pr',
    'list',
    '--repo',
    repository,
    '--state',
    'open',
    '--limit',
    String(Math.max(1, count(expectedCount, 'pull request count'))),
    '--json',
    'number,title,isDraft,headRefOid,baseRefOid,mergeStateStatus,reviewDecision,reviewRequests,latestReviews,reviews,comments,statusCheckRollup'
  ];
}

/**
 * Work Selection owns only pull requests whose base is the canonical default
 * branch. Stacked pull requests are independent future work and must not make
 * the active default-branch decision ambiguous.
 */
export function buildGitHubDefaultBranchOpenPullRequestsArgs(
  repository: string,
  defaultBranch: string
): string[] {
  repositoryParts(repository);
  assertGitBranchName(defaultBranch, 'Work-selection default branch');
  return [
    'pr',
    'list',
    '--repo',
    repository,
    '--base',
    defaultBranch,
    '--state',
    'open',
    // Zero and one are exact; two is a complete ambiguity witness.
    '--limit',
    '2',
    '--json',
    'number,headRefName,headRefOid,baseRefName,baseRefOid,body'
  ];
}

export function buildGitHubOpenIssuesArgs(
  repository: string,
  expectedCount: number
): string[] {
  return [
    'issue',
    'list',
    '--repo',
    repository,
    '--state',
    'open',
    '--limit',
    String(Math.max(1, count(expectedCount, 'issue count'))),
    '--json',
    'number,title'
  ];
}

export function buildGitHubOpenPullRequestReviewThreadsArgs(repository: string): string[] {
  return graphqlArgs(repository, OPEN_PULL_REQUEST_REVIEW_THREADS_QUERY, [], true);
}

export function buildGitHubPullRequestReviewThreadsArgs(
  repository: string,
  pullRequestNumber: number
): string[] {
  return graphqlArgs(
    repository,
    PULL_REQUEST_REVIEW_THREADS_QUERY,
    ['-F', `number=${positiveNumber(pullRequestNumber, 'pull request number')}`],
    true
  );
}

export function parseGitHubOpenInventoryCounts(source: string): GitHubOpenInventoryCounts {
  const root = record(json(source, 'count response'), 'count response');
  const data = graphqlData(root, 'count response');
  const repository = record(data.repository, 'count response.data.repository');
  const pullRequests = record(repository.pullRequests, 'count response pullRequests');
  const issues = record(repository.issues, 'count response issues');
  return Object.freeze({
    pullRequests: count(pullRequests.totalCount, 'pull request totalCount'),
    issues: count(issues.totalCount, 'issue totalCount')
  });
}

export function parseGitHubDefaultBranchRef(source: string): string {
  const root = record(json(source, 'default-branch ref response'), 'default-branch ref response');
  const data = graphqlData(root, 'default-branch ref response');
  const repository = record(data.repository, 'default-branch ref response.data.repository');
  const ref = record(repository.ref, 'default-branch ref response.data.repository.ref');
  const target = record(ref.target, 'default-branch ref response.data.repository.ref.target');
  if (typeof target.oid !== 'string' || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(target.oid)) {
    fail('default-branch ref response target oid must be one exact Git object id.');
  }
  return target.oid;
}

export function parseExactGitHubNumberedInventory(
  source: string,
  label: string,
  expectedCount: number
): readonly Readonly<Record<string, unknown>>[] {
  const parsed = json(source, label);
  if (!Array.isArray(parsed)) fail(`${label} must be a JSON array.`);
  const expected = count(expectedCount, `${label} expected count`);
  if (parsed.length !== expected) {
    fail(`${label} is incomplete: expected ${expected} entries, observed ${parsed.length}.`);
  }
  const numbers = new Set<number>();
  const result = parsed.map((entry, index) => {
    const item = record(entry, `${label}[${index}]`);
    const number = positiveNumber(item.number, `${label}[${index}].number`);
    if (numbers.has(number)) fail(`${label} contains duplicate number ${number}.`);
    numbers.add(number);
    return Object.freeze({ ...item });
  });
  return Object.freeze(result);
}

interface PartialReviewThreadPullRequest {
  readonly number: number;
  readonly totalCount: number;
  readonly nodes: readonly Readonly<{ isResolved: boolean }>[];
  readonly incomplete: boolean;
}

function reviewThreadNodes(
  connection: Record<string, unknown>,
  label: string,
  terminalPageMustContainTotal = true
): Readonly<{
  totalCount: number;
  nodes: readonly Readonly<{ isResolved: boolean }>[];
  hasNextPage: boolean;
}> {
  const totalCount = count(connection.totalCount, `${label}.totalCount`);
  if (!Array.isArray(connection.nodes)) fail(`${label}.nodes must be an array.`);
  const nodes = connection.nodes.map((candidate, index) => {
    const node = record(candidate, `${label}.nodes[${index}]`);
    if (typeof node.isResolved !== 'boolean') {
      fail(`${label}.nodes[${index}].isResolved must be a boolean.`);
    }
    return Object.freeze({ isResolved: node.isResolved });
  });
  const pageInfo = record(connection.pageInfo, `${label}.pageInfo`);
  if (typeof pageInfo.hasNextPage !== 'boolean') {
    fail(`${label}.pageInfo.hasNextPage must be a boolean.`);
  }
  if (terminalPageMustContainTotal && !pageInfo.hasNextPage && nodes.length !== totalCount) {
    fail(`${label} terminal page is incomplete: expected ${totalCount}, observed ${nodes.length}.`);
  }
  if (nodes.length > totalCount) fail(`${label} contains more nodes than totalCount.`);
  return Object.freeze({ totalCount, nodes: Object.freeze(nodes), hasNextPage: pageInfo.hasNextPage });
}

function paginatedResponses(source: string, label: string): readonly Record<string, unknown>[] {
  const parsed = json(source, label);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    fail(`${label} must be a non-empty --paginate --slurp response array.`);
  }
  return parsed.map((page, index) => record(page, `${label}[${index}]`));
}

function assertPageSequence(
  pageInfo: Record<string, unknown>,
  index: number,
  pageCount: number,
  label: string
): void {
  if (typeof pageInfo.hasNextPage !== 'boolean') {
    fail(`${label}.pageInfo.hasNextPage must be a boolean.`);
  }
  const final = index === pageCount - 1;
  if (pageInfo.hasNextPage === final) {
    fail(`${label} pagination sequence is incomplete or contains trailing pages.`);
  }
  if (!final && (typeof pageInfo.endCursor !== 'string' || pageInfo.endCursor.length === 0)) {
    fail(`${label}.pageInfo.endCursor must identify the next page.`);
  }
}

export function parseGitHubOpenPullRequestReviewThreadPages(
  source: string,
  expectedPullRequestNumbers: readonly number[]
): GitHubReviewThreadInventory {
  const expectedNumbers = new Set(expectedPullRequestNumbers.map((number) => (
    positiveNumber(number, 'expected pull request number')
  )));
  if (expectedNumbers.size !== expectedPullRequestNumbers.length) {
    fail('expected pull request numbers contain a duplicate.');
  }
  const pages = paginatedResponses(source, 'review-thread response');
  const observed = new Map<number, PartialReviewThreadPullRequest>();
  for (const [pageIndex, page] of pages.entries()) {
    const data = graphqlData(page, `review-thread response[${pageIndex}]`);
    const repository = record(data.repository, `review-thread response[${pageIndex}].repository`);
    const connection = record(repository.pullRequests, `review-thread response[${pageIndex}].pullRequests`);
    if (count(connection.totalCount, 'review-thread pull request totalCount') !== expectedNumbers.size) {
      fail('review-thread pull request totalCount changed during observation.');
    }
    if (!Array.isArray(connection.nodes)) fail('review-thread pull request nodes must be an array.');
    assertPageSequence(
      record(connection.pageInfo, `review-thread response[${pageIndex}].pullRequests.pageInfo`),
      pageIndex,
      pages.length,
      `review-thread response[${pageIndex}].pullRequests`
    );
    for (const [nodeIndex, candidate] of connection.nodes.entries()) {
      const pullRequest = record(candidate, `review-thread pull request[${nodeIndex}]`);
      const number = positiveNumber(pullRequest.number, 'review-thread pull request number');
      if (!expectedNumbers.has(number)) fail(`review-thread response contains unexpected pull request ${number}.`);
      if (observed.has(number)) fail(`review-thread response contains duplicate pull request ${number}.`);
      const threads = reviewThreadNodes(
        record(pullRequest.reviewThreads, `pull request ${number}.reviewThreads`),
        `pull request ${number}.reviewThreads`
      );
      observed.set(number, Object.freeze({
        number,
        totalCount: threads.totalCount,
        nodes: threads.nodes,
        incomplete: threads.hasNextPage
      }));
    }
  }
  if (observed.size !== expectedNumbers.size) {
    fail(`review-thread response is incomplete: expected ${expectedNumbers.size} pull requests, observed ${observed.size}.`);
  }
  const pullRequests = [...observed.values()]
    .sort((left, right) => left.number - right.number)
    .map((pullRequest) => Object.freeze({
      number: pullRequest.number,
      reviewThreads: Object.freeze({
        totalCount: pullRequest.totalCount,
        nodes: pullRequest.nodes,
        pageInfo: Object.freeze({ hasNextPage: pullRequest.incomplete, endCursor: null })
      })
    }));
  const incompletePullRequestNumbers = [...observed.values()]
    .filter((pullRequest) => pullRequest.incomplete)
    .map((pullRequest) => pullRequest.number)
    .sort((left, right) => left - right);
  return Object.freeze({
    pullRequests: Object.freeze(pullRequests),
    incompletePullRequestNumbers: Object.freeze(incompletePullRequestNumbers)
  });
}

export function parseGitHubPullRequestReviewThreadPages(
  source: string,
  expectedPullRequestNumber: number
): GitHubReviewThreadConnection {
  const number = positiveNumber(expectedPullRequestNumber, 'expected pull request number');
  const pages = paginatedResponses(source, `pull request ${number} review-thread response`);
  let expectedTotalCount: number | null = null;
  const nodes: Readonly<{ isResolved: boolean }>[] = [];
  for (const [pageIndex, page] of pages.entries()) {
    const data = graphqlData(page, `pull request ${number} response[${pageIndex}]`);
    const repository = record(data.repository, `pull request ${number} response[${pageIndex}].repository`);
    const pullRequest = record(repository.pullRequest, `pull request ${number} response[${pageIndex}].pullRequest`);
    if (positiveNumber(pullRequest.number, 'review-thread pull request number') !== number) {
      fail(`review-thread response resolved the wrong pull request for ${number}.`);
    }
    const connection = record(pullRequest.reviewThreads, `pull request ${number}.reviewThreads`);
    const pageThreads = reviewThreadNodes(
      connection,
      `pull request ${number}.reviewThreads page ${pageIndex}`,
      false
    );
    expectedTotalCount ??= pageThreads.totalCount;
    if (pageThreads.totalCount !== expectedTotalCount) {
      fail(`pull request ${number} review-thread totalCount changed during pagination.`);
    }
    assertPageSequence(
      record(connection.pageInfo, `pull request ${number}.reviewThreads page ${pageIndex}.pageInfo`),
      pageIndex,
      pages.length,
      `pull request ${number}.reviewThreads page ${pageIndex}`
    );
    nodes.push(...pageThreads.nodes);
  }
  if (expectedTotalCount === null || nodes.length !== expectedTotalCount) {
    fail(`pull request ${number} review-thread response is incomplete.`);
  }
  return Object.freeze({
    totalCount: expectedTotalCount,
    nodes: Object.freeze(nodes),
    pageInfo: Object.freeze({ hasNextPage: false, endCursor: null })
  });
}

export function replaceIncompleteGitHubReviewThreads(
  inventory: GitHubReviewThreadInventory,
  replacements: ReadonlyMap<number, GitHubReviewThreadConnection>
): readonly GitHubReviewThreadPullRequest[] {
  const required = new Set(inventory.incompletePullRequestNumbers);
  if (replacements.size !== required.size || [...replacements.keys()].some((number) => !required.has(number))) {
    fail('review-thread replacement set does not exactly match incomplete pull requests.');
  }
  return Object.freeze(inventory.pullRequests.map((pullRequest) => {
    const replacement = replacements.get(pullRequest.number);
    if (pullRequest.reviewThreads.pageInfo.hasNextPage && replacement === undefined) {
      fail(`pull request ${pullRequest.number} review threads remain incomplete.`);
    }
    return Object.freeze({
      number: pullRequest.number,
      reviewThreads: replacement ?? Object.freeze({
        totalCount: pullRequest.reviewThreads.totalCount,
        nodes: pullRequest.reviewThreads.nodes,
        pageInfo: Object.freeze({ hasNextPage: false as const, endCursor: null })
      })
    });
  }));
}
