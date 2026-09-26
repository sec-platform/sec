import { withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import { assertGitHubRepositoryBinding } from '../../../providers/git-read/repository-binding.ts';
import {
  executeGitHubApiOperation,
  inspectGitHubApiCapability,
  type GitHubApiCapability
} from '../../../providers/github-api/operation-session.ts';
import {
  GIT_READ_OPERATION_BUDGET,
  parseNulUtf8
} from '../../development/tooling/git/git-read.ts';
import { assertGitSha, branchLifecycleDigest } from './branch-lifecycle-audit.ts';

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

interface LegacyClosedSupersessionReview extends ClosedSupersessionReviewBase {
  readonly paths: readonly Readonly<{
    path: string;
    disposition: 'retained' | 'superseded';
    reason: string;
  }>[];
}

interface CurrentClosedSupersessionReview extends ClosedSupersessionReviewBase {
  readonly version: 2;
  readonly pathSet: Readonly<{ count: number; digest: `sha256:${string}` }>;
  readonly assessment: string;
}

type ClosedSupersessionReview = LegacyClosedSupersessionReview | CurrentClosedSupersessionReview;

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

const issued = new WeakSet<object>();

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

function parseClosedSupersessionReview(source: string): ClosedSupersessionReview {
  if (Buffer.byteLength(source, 'utf8') > 60_000
      || !source.startsWith(CLOSED_SUPERSESSION_REVIEW_MARKER)) {
    throw new Error('Supersession review marker or byte bound is invalid.');
  }
  const raw = JSON.parse(source.slice(CLOSED_SUPERSESSION_REVIEW_MARKER.length)) as unknown;
  const versionTwo = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    && (raw as Record<string, unknown>).version === 2;
  const value = exactObject(raw, [
    'kind', 'repository', 'pullRequestNumber', 'headSha', 'headTreeSha',
    'currentMainSha', 'currentMainTreeSha', 'reviewer', 'verdict', 'unknowns',
    ...(versionTwo ? ['version', 'pathSet', 'assessment'] : ['paths'])
  ]);
  if (value.kind !== 'branch-supersession-review' || value.verdict !== 'approved'
      || !Number.isSafeInteger(value.pullRequestNumber) || Number(value.pullRequestNumber) < 1
      || !Array.isArray(value.unknowns) || value.unknowns.length !== 0) {
    throw new Error('Supersession review is incomplete or unresolved.');
  }
  const repository = boundedText(value.repository, 201);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error('Invalid review repository.');
  }
  for (const key of ['headSha', 'headTreeSha', 'currentMainSha', 'currentMainTreeSha']) {
    assertGitSha(boundedText(value[key], 64), `Supersession review ${key}`);
  }
  const reviewer = boundedText(value.reviewer, 512);
  if (versionTwo) {
    const pathSet = exactObject(value.pathSet, ['count', 'digest']);
    if (!Number.isSafeInteger(pathSet.count) || Number(pathSet.count) < 0
        || typeof pathSet.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(pathSet.digest)) {
      throw new Error('Supersession review path-set identity is invalid.');
    }
    return Object.freeze({
      ...value,
      repository,
      reviewer,
      pathSet: Object.freeze({ count: pathSet.count, digest: pathSet.digest }),
      assessment: boundedText(value.assessment, 8192),
      unknowns: Object.freeze([])
    }) as CurrentClosedSupersessionReview;
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

export function assertClosedSupersessionEvidence(value: ClosedSupersessionEvidence): void {
  if (!issued.has(value)) {
    throw new Error('Supersession evidence requires authenticated owner observation.');
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
        !== `https://api.github.com/repos/${binding.repository}/issues/${input.pullRequestNumber}`
      || typeof user?.login !== 'string') {
    throw new Error('Supersession comment identity differs.');
  }
  const permission = await executeGitHubApiOperation(input.capability, {
    kind: 'collaborator-permission',
    login: user.login
  }) as Record<string, unknown>;
  if (permission.permission !== 'admin' && permission.permission !== 'maintain') {
    throw new Error('Supersession review has not been adopted by a repository maintainer.');
  }
  const review = parseClosedSupersessionReview(comment.body);
  if (review.repository !== binding.repository
      || review.pullRequestNumber !== input.pullRequestNumber) {
    throw new Error('Supersession review repository or PR binding differs.');
  }

  await withAuthorityGitReadSession(
    { cwd: input.repositoryRoot, budget: GIT_READ_OPERATION_BUDGET },
    async (session) => {
      await assertGitHubRepositoryBinding(session, binding.repository);
      const read = async (args: readonly string[]): Promise<Buffer> => {
        const result = await session.run(args);
        if (result.kind !== 'completed' || result.result.code !== 0
            || result.result.stderr.length !== 0) {
          throw new Error('Supersession Git observation failed.');
        }
        return Buffer.from(result.result.stdout);
      };
      for (const [sha, tree] of [
        [review.headSha, review.headTreeSha],
        [review.currentMainSha, review.currentMainTreeSha]
      ] as const) {
        if ((await read(['rev-parse', '--verify', `${sha}^{tree}`]))
          .toString('utf8').trim() !== tree) {
          throw new Error('Supersession review tree differs from its exact Git commit.');
        }
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

  const material = Object.freeze({
    review,
    reference:
      `https://github.com/${binding.repository}/pull/${input.pullRequestNumber}#issuecomment-${input.commentId}`,
    author: user.login,
    commentId: input.commentId
  });
  const evidence = Object.freeze({
    ...material,
    receiptDigest: branchLifecycleDigest(material)
  });
  issued.add(evidence);
  return evidence;
}
