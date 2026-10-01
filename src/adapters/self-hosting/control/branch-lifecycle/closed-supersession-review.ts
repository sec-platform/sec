import { withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import { assertGitHubRepositoryBinding } from '../../../providers/git-read/repository-binding.ts';
import {
  executeGitHubApiOperation,
  inspectGitHubApiCapability,
  type GitHubApiCapability
} from '../../../providers/github-api/operation-session.ts';
import { normalizeGitHubRepositoryPermission } from '../../../providers/github-api/repository-permission.ts';
import {
  GIT_READ_OPERATION_BUDGET,
  parseNulUtf8
} from '../../development/tooling/git/git-read.ts';
import {
  assertGitBranchName,
  assertGitSha,
  branchLifecycleDigest
} from './branch-lifecycle-audit.ts';

const CLOSED_SUPERSESSION_REVIEW_MARKER =
  '<!-- sec-branch-supersession-review -->\n';

/**
 * Maintainer adoption of an exact-object semantic review. The reviewer field
 * is review prose, not an authenticated independent-reviewer identity.
 */
interface ClosedSupersessionReviewBase {
  readonly kind: 'branch-supersession-review';
  readonly repository: string;
  readonly pullRequestNumber: number;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly currentMainSha: string;
  readonly currentMainTreeSha: string;
  readonly reviewer: string;
  readonly verdict: 'approved';
  readonly unknowns: readonly never[];
}

interface ClosedSupersessionReviewV1 extends ClosedSupersessionReviewBase {
  readonly paths: readonly Readonly<{
    path: string;
    disposition: 'retained' | 'superseded';
    reason: string;
  }>[];
}

interface ClosedSupersessionReviewV2 extends ClosedSupersessionReviewBase {
  readonly version: 2;
  readonly pathSet: Readonly<{ count: number; digest: `sha256:${string}` }>;
  readonly assessment: string;
}

interface ReviewedRefSupersessionReviewV3 {
  readonly kind: 'branch-supersession-review';
  readonly version: 3;
  readonly repository: string;
  readonly issueNumber: number;
  readonly branch: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly currentMainSha: string;
  readonly currentMainTreeSha: string;
  readonly mergeBaseSha: string;
  readonly mergeBaseTreeSha: string;
  readonly reviewer: string;
  readonly verdict: 'approved';
  readonly sourcePathSet: Readonly<{ count: number; digest: `sha256:${string}` }>;
  readonly assessment: string;
  readonly unknowns: readonly never[];
}

type ClosedSupersessionReview = ClosedSupersessionReviewV1 | ClosedSupersessionReviewV2;
type ParsedSupersessionReview = ClosedSupersessionReview | ReviewedRefSupersessionReviewV3;

/** Pure encoding helper; only the observer's complete native Git census issues evidence. */
export function summarizeClosedSupersessionPaths(paths: readonly string[]): Readonly<{
  count: number;
  digest: `sha256:${string}`;
}> {
  const sorted = [...paths].sort((left, right) => Buffer.compare(
    Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')
  ));
  if (new Set(sorted).size !== sorted.length) {
    throw new Error('Supersession Git path set contains duplicates.');
  }
  return Object.freeze({
    count: sorted.length,
    digest: branchLifecycleDigest({ schema: 'sec-branch-supersession-path-set-v2', paths: sorted })
  });
}

export interface ClosedSupersessionEvidence {
  readonly review: ClosedSupersessionReview;
  readonly reference: string;
  readonly author: string;
  readonly commentId: number;
  readonly receiptDigest: `sha256:${string}`;
}

export interface ReviewedRefSupersessionEvidence {
  readonly review: ReviewedRefSupersessionReviewV3;
  readonly reference: string;
  readonly author: string;
  readonly commentId: number;
  readonly receiptDigest: `sha256:${string}`;
}

const issued = new WeakSet<object>();
const issuedReviewedRef = new WeakSet<object>();

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error('Supersession review has an invalid exact shape.');
  }
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum
      || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('Supersession review text is not bounded canonical text.');
  }
  return value;
}

function pathSet(value: unknown): Readonly<{ count: number; digest: `sha256:${string}` }> {
  const candidate = exactObject(value, ['count', 'digest']);
  if (!Number.isSafeInteger(candidate.count) || Number(candidate.count) < 0
      || typeof candidate.digest !== 'string'
      || !/^sha256:[0-9a-f]{64}$/u.test(candidate.digest)) {
    throw new Error('Supersession review path-set identity is invalid.');
  }
  return Object.freeze({
    count: Number(candidate.count),
    digest: candidate.digest as `sha256:${string}`
  });
}

function parseSupersessionReview(source: string): ParsedSupersessionReview {
  if (Buffer.byteLength(source, 'utf8') > 60_000
      || !source.startsWith(CLOSED_SUPERSESSION_REVIEW_MARKER)) {
    throw new Error('Supersession review marker or byte bound is invalid.');
  }
  const raw = JSON.parse(source.slice(CLOSED_SUPERSESSION_REVIEW_MARKER.length)) as unknown;
  const recordValue = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown> : null;
  const versionTwo = recordValue?.version === 2;
  const versionThree = recordValue?.version === 3;
  const value = exactObject(raw, versionThree
    ? [
        'kind', 'version', 'repository', 'issueNumber', 'branch', 'headSha', 'headTreeSha',
        'currentMainSha', 'currentMainTreeSha', 'mergeBaseSha', 'mergeBaseTreeSha',
        'reviewer', 'verdict', 'sourcePathSet', 'assessment', 'unknowns'
      ]
    : [
        'kind', 'repository', 'pullRequestNumber', 'headSha', 'headTreeSha',
        'currentMainSha', 'currentMainTreeSha', 'reviewer', 'verdict', 'unknowns',
        ...(versionTwo ? ['version', 'pathSet', 'assessment'] : ['paths'])
      ]);
  if (value.kind !== 'branch-supersession-review' || value.verdict !== 'approved'
      || !Array.isArray(value.unknowns) || value.unknowns.length !== 0) {
    throw new Error('Supersession review is incomplete or unresolved.');
  }
  const repository = boundedText(value.repository, 201);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error('Invalid review repository.');
  }
  for (const key of [
    'headSha', 'headTreeSha', 'currentMainSha', 'currentMainTreeSha',
    ...(versionThree ? ['mergeBaseSha', 'mergeBaseTreeSha'] : [])
  ]) {
    assertGitSha(boundedText(value[key], 64), `Supersession review ${key}`);
  }
  const reviewer = boundedText(value.reviewer, 512);
  if (versionThree) {
    if (!Number.isSafeInteger(value.issueNumber) || Number(value.issueNumber) < 1) {
      throw new Error('Reviewed-ref supersession issue identity is invalid.');
    }
    const branch = boundedText(value.branch, 512);
    assertGitBranchName(branch, 'reviewed-ref supersession branch');
    return Object.freeze({
      ...value,
      version: 3,
      repository,
      issueNumber: Number(value.issueNumber),
      branch,
      reviewer,
      sourcePathSet: pathSet(value.sourcePathSet),
      assessment: boundedText(value.assessment, 8192),
      unknowns: Object.freeze([])
    }) as ReviewedRefSupersessionReviewV3;
  }
  if (!Number.isSafeInteger(value.pullRequestNumber) || Number(value.pullRequestNumber) < 1) {
    throw new Error('Supersession review pull request identity is invalid.');
  }
  if (versionTwo) {
    return Object.freeze({
      ...value,
      repository,
      reviewer,
      pathSet: pathSet(value.pathSet),
      assessment: boundedText(value.assessment, 8192),
      unknowns: Object.freeze([])
    }) as ClosedSupersessionReviewV2;
  }
  if (!Array.isArray(value.paths) || value.paths.length > 1_000) {
    throw new Error('Legacy supersession review paths are incomplete or over bound.');
  }
  const paths = value.paths.map((entry) => {
    const row = exactObject(entry, ['path', 'disposition', 'reason']);
    const pathname = boundedText(row.path, 4096);
    if (pathname.startsWith('/') || pathname.includes('\\')
        || pathname.split('/').some((part) => part === '' || part === '.' || part === '..')
        || (row.disposition !== 'retained' && row.disposition !== 'superseded')) {
      throw new Error('Supersession review path or disposition is invalid.');
    }
    return Object.freeze({
      path: pathname,
      disposition: row.disposition,
      reason: boundedText(row.reason, 2048)
    });
  });
  if (new Set(paths.map(({ path }) => path)).size !== paths.length) {
    throw new Error('Supersession review contains duplicate paths.');
  }
  return Object.freeze({
    ...value,
    repository,
    reviewer,
    paths: Object.freeze(paths),
    unknowns: Object.freeze([])
  }) as unknown as ClosedSupersessionReview;
}

async function verifySupersessionGitReview(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  review: ParsedSupersessionReview;
}>): Promise<void> {
  const review = input.review;
  await withAuthorityGitReadSession(
    { cwd: input.repositoryRoot, budget: GIT_READ_OPERATION_BUDGET },
    async (session) => {
      await assertGitHubRepositoryBinding(session, input.repository);
      const read = async (args: readonly string[]): Promise<Buffer> => {
        const result = await session.run(args);
        if (result.kind !== 'completed' || result.result.code !== 0
            || result.result.stderr.length !== 0) {
          throw new Error('Supersession Git observation failed.');
        }
        return Buffer.from(result.result.stdout);
      };
      const exactObjects: readonly (readonly [string, string])[] = 'issueNumber' in review
        ? [
            [review.headSha, review.headTreeSha],
            [review.currentMainSha, review.currentMainTreeSha],
            [review.mergeBaseSha, review.mergeBaseTreeSha]
          ]
        : [
            [review.headSha, review.headTreeSha],
            [review.currentMainSha, review.currentMainTreeSha]
          ];
      for (const [sha, tree] of exactObjects) {
        if ((await read(['rev-parse', '--verify', `${sha}^{tree}`]))
          .toString('utf8').trim() !== tree) {
          throw new Error('Supersession review tree differs from its exact Git commit.');
        }
      }
      if ('issueNumber' in review) {
        const observedMergeBase = (await read([
          'merge-base', review.headSha, review.currentMainSha
        ])).toString('utf8').trim();
        if (observedMergeBase !== review.mergeBaseSha) {
          throw new Error(
            'Reviewed-ref supersession merge-base differs from the exact Git relation.'
          );
        }
        const sourceChanged = parseNulUtf8(await read([
          'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z',
          review.mergeBaseSha, review.headSha, '--'
        ]), 'Reviewed-ref source changed paths');
        const observed = summarizeClosedSupersessionPaths(sourceChanged);
        if (observed.count !== review.sourcePathSet.count
            || observed.digest !== review.sourcePathSet.digest) {
          throw new Error(
            'Reviewed-ref supersession source path set differs from the complete merge-base to head delta.'
          );
        }
        return;
      }
      const changed = parseNulUtf8(await read([
        'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z',
        review.headSha, review.currentMainSha, '--'
      ]), 'Supersession changed paths');
      if ('pathSet' in review) {
        const observed = summarizeClosedSupersessionPaths(changed);
        if (observed.count !== review.pathSet.count || observed.digest !== review.pathSet.digest) {
          throw new Error('Supersession review path set differs from the complete exact Git delta.');
        }
      } else {
        const reviewed = review.paths.map(({ path }) => path).sort();
        if (JSON.stringify([...changed].sort()) !== JSON.stringify(reviewed)) {
          throw new Error('Supersession review does not cover the complete exact Git delta.');
        }
      }
    }
  );
}

async function observeMaintainerSupersessionComment(input: Readonly<{
  capability: GitHubApiCapability;
  issueNumber: number;
  commentId: number;
}>): Promise<Readonly<{ repository: string; author: string; body: string }>> {
  const binding = inspectGitHubApiCapability(input.capability);
  const response = await executeGitHubApiOperation(input.capability, {
    kind: 'issue-comment',
    commentId: input.commentId
  });
  if (response === null || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('Supersession comment is absent.');
  }
  const comment = response as Record<string, unknown>;
  const user = comment.user as Record<string, unknown> | undefined;
  if (comment.id !== input.commentId || typeof comment.body !== 'string'
      || comment.issue_url
        !== `https://api.github.com/repos/${binding.repository}/issues/${input.issueNumber}`
      || typeof user?.login !== 'string') {
    throw new Error('Supersession comment identity differs.');
  }
  const permission = await executeGitHubApiOperation(input.capability, {
    kind: 'collaborator-permission',
    login: user.login
  });
  const role = normalizeGitHubRepositoryPermission(permission);
  if (role !== 'admin' && role !== 'maintain') {
    throw new Error('Supersession review has not been adopted by a repository maintainer.');
  }
  return Object.freeze({
    repository: binding.repository,
    author: user.login,
    body: comment.body
  });
}

export function assertClosedSupersessionEvidence(value: ClosedSupersessionEvidence): void {
  if (!issued.has(value)) {
    throw new Error('Supersession evidence requires authenticated owner observation.');
  }
}

export function assertReviewedRefSupersessionEvidence(
  value: ReviewedRefSupersessionEvidence
): void {
  if (!issuedReviewedRef.has(value)) {
    throw new Error('Reviewed-ref supersession evidence requires authenticated owner observation.');
  }
}

/**
 * Only an authenticated GitHub observation can issue this evidence. It proves
 * maintainer adoption and complete exact-object/path coverage; independent
 * review quality remains a separate assurance obligation.
 */
export async function observeClosedSupersessionEvidence(input: Readonly<{
  repositoryRoot: string;
  capability: GitHubApiCapability;
  pullRequestNumber: number;
  commentId: number;
}>): Promise<ClosedSupersessionEvidence> {
  const observed = await observeMaintainerSupersessionComment({
    capability: input.capability,
    issueNumber: input.pullRequestNumber,
    commentId: input.commentId
  });
  const review = parseSupersessionReview(observed.body);
  if ('issueNumber' in review
      || review.repository !== observed.repository
      || review.pullRequestNumber !== input.pullRequestNumber) {
    throw new Error('Supersession review repository or PR binding differs.');
  }
  await verifySupersessionGitReview({
    repositoryRoot: input.repositoryRoot,
    repository: observed.repository,
    review
  });
  const material = Object.freeze({
    review,
    reference:
      `https://github.com/${observed.repository}/pull/${input.pullRequestNumber}#issuecomment-${input.commentId}`,
    author: observed.author,
    commentId: input.commentId
  });
  const evidence = Object.freeze({
    ...material,
    receiptDigest: branchLifecycleDigest(material)
  });
  issued.add(evidence);
  return evidence;
}

/**
 * Reviewed orphan/ref supersession uses the same semantic-review owner but
 * binds an Issue comment to one exact branch/head and current-main snapshot.
 */
export async function observeReviewedRefSupersessionEvidence(input: Readonly<{
  repositoryRoot: string;
  capability: GitHubApiCapability;
  issueNumber: number;
  commentId: number;
  branch: string;
  expectedHeadSha: string;
  expectedMainSha: string;
}>): Promise<ReviewedRefSupersessionEvidence> {
  assertGitBranchName(input.branch, 'reviewed-ref supersession branch');
  assertGitSha(input.expectedHeadSha, 'reviewed-ref expected head');
  assertGitSha(input.expectedMainSha, 'reviewed-ref expected main');
  const observed = await observeMaintainerSupersessionComment({
    capability: input.capability,
    issueNumber: input.issueNumber,
    commentId: input.commentId
  });
  const review = parseSupersessionReview(observed.body);
  if (!('issueNumber' in review) || review.version !== 3
      || review.repository !== observed.repository
      || review.issueNumber !== input.issueNumber
      || review.branch !== input.branch
      || review.headSha !== input.expectedHeadSha
      || review.currentMainSha !== input.expectedMainSha) {
    throw new Error('Reviewed-ref supersession evidence identity differs.');
  }
  await verifySupersessionGitReview({
    repositoryRoot: input.repositoryRoot,
    repository: observed.repository,
    review
  });
  const material = Object.freeze({
    review,
    reference:
      `https://github.com/${observed.repository}/issues/${input.issueNumber}#issuecomment-${input.commentId}`,
    author: observed.author,
    commentId: input.commentId
  });
  const evidence = Object.freeze({
    ...material,
    receiptDigest: branchLifecycleDigest(material)
  });
  issuedReviewedRef.add(evidence);
  return evidence;
}
