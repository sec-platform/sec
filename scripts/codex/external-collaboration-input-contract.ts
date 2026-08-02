export const SEC_EXTERNAL_COLLABORATION_INPUT_POLICY = 'external-metadata-only-v1' as const;

const PullRequestInputKeys = [
  'baseRefOid',
  'headRefOid',
  'isDraft',
  'mergeStateStatus',
  'number',
  'reviewDecision',
  'reviewRequests',
  'statusCheckRollup'
] as const;

const MergeStateStatuses = new Set([
  'BEHIND',
  'BLOCKED',
  'CLEAN',
  'DIRTY',
  'DRAFT',
  'HAS_HOOKS',
  'UNKNOWN',
  'UNSTABLE'
]);

const ReviewDecisions = new Set([
  'APPROVED',
  'CHANGES_REQUESTED',
  'REVIEW_REQUIRED'
]);

export type SecExternalCheckStateCountsV1 = Readonly<{
  cancelled: number;
  failed: number;
  neutral: number;
  passed: number;
  pending: number;
  skipped: number;
  unknown: number;
}>;

export type SecExternalPullRequestFactV1 = Readonly<{
  baseRefOid: string;
  checkStates: SecExternalCheckStateCountsV1;
  headRefOid: string;
  isDraft: boolean;
  mergeStateStatus: string;
  number: number;
  reviewDecision: string | null;
  reviewRequestCount: number;
}>;

export type SecExternalIssueFactV1 = Readonly<{
  number: number;
}>;

export type SecExternalReviewThreadFactV1 = Readonly<{
  pullRequestNumber: number;
  totalCount: number;
  unresolvedCount: number;
}>;

export type SecExternalGitHubControlFactsV1 = Readonly<{
  inputPolicy: typeof SEC_EXTERNAL_COLLABORATION_INPUT_POLICY;
  openIssues: readonly SecExternalIssueFactV1[];
  openPullRequests: readonly SecExternalPullRequestFactV1[];
  reviewThreads: readonly SecExternalReviewThreadFactV1[];
  schema: 'sec-external-github-control-facts-v1';
}>;

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void {
  const actual = Object.keys(value).sort();
  const canonicalExpected = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(canonicalExpected)) {
    throw new Error(`${label} has unexpected or missing keys.`);
  }
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value as number;
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a nonnegative safe integer.`);
  }
  return value as number;
}

function exactCommitOid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${label} must be one lowercase 40-character Git object ID.`);
  }
  return value;
}

function enumValue(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string
): string {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new Error(`${label} is outside the bounded enum.`);
  }
  return value;
}

function optionalEnumValue(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string
): string | null {
  if (value === null) return null;
  return enumValue(value, allowed, label);
}

type CheckBucket = keyof SecExternalCheckStateCountsV1;

function classifyCheckToken(value: unknown): CheckBucket | null {
  if (typeof value !== 'string') return null;
  switch (value) {
    case 'SUCCESS':
      return 'passed';
    case 'ACTION_REQUIRED':
    case 'ERROR':
    case 'FAILURE':
    case 'STALE':
    case 'STARTUP_FAILURE':
    case 'TIMED_OUT':
      return 'failed';
    case 'EXPECTED':
    case 'IN_PROGRESS':
    case 'PENDING':
    case 'QUEUED':
    case 'REQUESTED':
    case 'WAITING':
      return 'pending';
    case 'NEUTRAL':
      return 'neutral';
    case 'SKIPPED':
      return 'skipped';
    case 'CANCELLED':
      return 'cancelled';
    default:
      return null;
  }
}

function projectCheckStates(value: unknown, label: string): SecExternalCheckStateCountsV1 {
  if (!Array.isArray(value) || value.length > 1000) {
    throw new Error(`${label} must be a bounded array.`);
  }
  const counts: Record<CheckBucket, number> = {
    cancelled: 0,
    failed: 0,
    neutral: 0,
    passed: 0,
    pending: 0,
    skipped: 0,
    unknown: 0
  };
  for (const [index, check] of value.entries()) {
    assertRecord(check, `${label}[${index}]`);
    const bucket = classifyCheckToken(check.conclusion)
      ?? classifyCheckToken(check.state)
      ?? classifyCheckToken(check.status)
      ?? 'unknown';
    counts[bucket] += 1;
  }
  return Object.freeze({ ...counts });
}

function projectPullRequest(value: unknown, index: number): SecExternalPullRequestFactV1 {
  const label = `pullRequests[${index}]`;
  assertRecord(value, label);
  assertExactKeys(value, PullRequestInputKeys, label);
  if (typeof value.isDraft !== 'boolean') throw new Error(`${label}.isDraft must be boolean.`);
  if (!Array.isArray(value.reviewRequests) || value.reviewRequests.length > 1000) {
    throw new Error(`${label}.reviewRequests must be a bounded array.`);
  }
  return Object.freeze({
    baseRefOid: exactCommitOid(value.baseRefOid, `${label}.baseRefOid`),
    checkStates: projectCheckStates(value.statusCheckRollup, `${label}.statusCheckRollup`),
    headRefOid: exactCommitOid(value.headRefOid, `${label}.headRefOid`),
    isDraft: value.isDraft,
    mergeStateStatus: enumValue(
      value.mergeStateStatus,
      MergeStateStatuses,
      `${label}.mergeStateStatus`
    ),
    number: positiveInteger(value.number, `${label}.number`),
    reviewDecision: optionalEnumValue(
      value.reviewDecision,
      ReviewDecisions,
      `${label}.reviewDecision`
    ),
    reviewRequestCount: value.reviewRequests.length
  });
}

function projectIssue(value: unknown, index: number): SecExternalIssueFactV1 {
  const label = `issues[${index}]`;
  assertRecord(value, label);
  assertExactKeys(value, ['number'], label);
  return Object.freeze({ number: positiveInteger(value.number, `${label}.number`) });
}

function projectReviewThread(
  value: unknown,
  index: number
): SecExternalReviewThreadFactV1 {
  const label = `reviewThreads[${index}]`;
  assertRecord(value, label);
  assertExactKeys(value, ['number', 'reviewThreads'], label);
  assertRecord(value.reviewThreads, `${label}.reviewThreads`);
  assertExactKeys(
    value.reviewThreads,
    ['nodes', 'pageInfo', 'totalCount'],
    `${label}.reviewThreads`
  );
  assertRecord(value.reviewThreads.pageInfo, `${label}.reviewThreads.pageInfo`);
  assertExactKeys(
    value.reviewThreads.pageInfo,
    ['hasNextPage'],
    `${label}.reviewThreads.pageInfo`
  );
  if (value.reviewThreads.pageInfo.hasNextPage !== false) {
    throw new Error(`${label}.reviewThreads must fit in one bounded page.`);
  }
  if (!Array.isArray(value.reviewThreads.nodes)) {
    throw new Error(`${label}.reviewThreads.nodes must be an array.`);
  }
  const totalCount = nonnegativeInteger(
    value.reviewThreads.totalCount,
    `${label}.reviewThreads.totalCount`
  );
  if (totalCount !== value.reviewThreads.nodes.length) {
    throw new Error(`${label}.reviewThreads is incomplete.`);
  }
  let unresolvedCount = 0;
  for (const [threadIndex, thread] of value.reviewThreads.nodes.entries()) {
    assertRecord(thread, `${label}.reviewThreads.nodes[${threadIndex}]`);
    assertExactKeys(thread, ['isResolved'], `${label}.reviewThreads.nodes[${threadIndex}]`);
    if (typeof thread.isResolved !== 'boolean') {
      throw new Error(`${label}.reviewThreads.nodes[${threadIndex}].isResolved must be boolean.`);
    }
    if (!thread.isResolved) unresolvedCount += 1;
  }
  return Object.freeze({
    pullRequestNumber: positiveInteger(value.number, `${label}.number`),
    totalCount,
    unresolvedCount
  });
}

function assertUniqueNumbers(
  values: readonly { readonly number?: number; readonly pullRequestNumber?: number }[],
  label: string
): void {
  const seen = new Set<number>();
  for (const value of values) {
    const number = value.number ?? value.pullRequestNumber;
    if (number === undefined || seen.has(number)) throw new Error(`${label} contains duplicate identities.`);
    seen.add(number);
  }
}

export function CodexDevelopmentProjectExternalGitHubFactsV1(input: {
  readonly issues: readonly unknown[];
  readonly pullRequests: readonly unknown[];
  readonly reviewThreads: readonly unknown[];
}): SecExternalGitHubControlFactsV1 {
  if (input.pullRequests.length >= 100 || input.issues.length >= 100) {
    throw new Error('GitHub PR/Issue facts reached the bounded query limit.');
  }
  const openPullRequests = input.pullRequests
    .map(projectPullRequest)
    .sort((left, right) => left.number - right.number);
  const openIssues = input.issues
    .map(projectIssue)
    .sort((left, right) => left.number - right.number);
  const reviewThreads = input.reviewThreads
    .map(projectReviewThread)
    .sort((left, right) => left.pullRequestNumber - right.pullRequestNumber);
  assertUniqueNumbers(openPullRequests, 'pullRequests');
  assertUniqueNumbers(openIssues, 'issues');
  assertUniqueNumbers(reviewThreads, 'reviewThreads');
  return Object.freeze({
    inputPolicy: SEC_EXTERNAL_COLLABORATION_INPUT_POLICY,
    openIssues: Object.freeze(openIssues),
    openPullRequests: Object.freeze(openPullRequests),
    reviewThreads: Object.freeze(reviewThreads),
    schema: 'sec-external-github-control-facts-v1'
  });
}
