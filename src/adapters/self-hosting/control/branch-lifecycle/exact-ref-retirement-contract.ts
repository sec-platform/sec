import { assertGitBranchName } from '../../../../contracts/git-reference.ts';

export type PlannedRefSupersessionReview = Readonly<{
  kind: 'branch-supersession-review';
  version: 4;
  repository: string;
  branch: string;
  headSha: string;
  headTreeSha: string;
  currentMainSha: string;
  currentMainTreeSha: string;
  mergeBaseSha: string;
  mergeBaseTreeSha: string;
  reviewer: string;
  verdict: 'approved';
  sourcePathSet: Readonly<{ count: number; digest: `sha256:${string}` }>;
  assessment: string;
  unknowns: readonly never[];
}>;

export type ExactRefRetirement =
  | Readonly<{
      classification: 'reviewed-plan-superseded';
      branches: readonly [string];
      expectedHeadSha: string;
      review: PlannedRefSupersessionReview;
    }>
  | Readonly<{
      classification: 'transport-only';
      branches: readonly [string];
      expectedHeadSha: string;
    }>
  | Readonly<{
      classification: 'main-tree-identical';
      branches: readonly [string];
      expectedHeadSha: string;
    }>
  | Readonly<{
      classification: 'closed-pr-superseded';
      branches: readonly [string];
      expectedHeadSha: string;
      pullRequestNumber: number;
    }>
  | Readonly<{
      classification: 'reviewed-superseded';
      branches: readonly [string];
      expectedHeadSha: string;
      reviewIssueNumber: number;
      reviewCommentId: number;
    }>;

function sha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${label} must be one SHA-1 Git object id`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`${label} must be one positive integer`);
  }
  return Number(value);
}

function singleBranch(value: unknown): readonly [string] {
  if (!Array.isArray(value) || value.length !== 1 || typeof value[0] !== 'string') {
    throw new Error('exact ref retirement requires exactly one branch');
  }
  assertGitBranchName(value[0], 'maintenance retirement branch');
  return Object.freeze([value[0]] as const);
}

export function parsePlannedRefSupersessionReview(value: unknown): PlannedRefSupersessionReview {
  const keys = ['kind', 'version', 'repository', 'branch', 'headSha', 'headTreeSha',
    'currentMainSha', 'currentMainTreeSha', 'mergeBaseSha', 'mergeBaseTreeSha',
    'reviewer', 'verdict', 'sourcePathSet', 'assessment', 'unknowns'];
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys.sort())) {
    throw new Error('Planned supersession review fields are invalid');
  }
  const input = value as Record<string, unknown>;
  if (input.kind !== 'branch-supersession-review' || input.version !== 4
      || input.verdict !== 'approved' || !Array.isArray(input.unknowns) || input.unknowns.length !== 0
      || typeof input.repository !== 'string'
      || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(input.repository)) {
    throw new Error('Planned supersession review is incomplete or unresolved');
  }
  for (const key of ['branch', 'reviewer', 'assessment']) {
    const text = input[key];
    if (typeof text !== 'string' || text.length === 0 || text.trim() !== text
        || text.length > (key === 'assessment' ? 8192 : 512)
        || /[\u0000-\u001f\u007f]/u.test(text)) {
      throw new Error('Planned supersession review text is invalid');
    }
  }
  assertGitBranchName(input.branch as string, 'Planned supersession branch');
  for (const key of ['headSha', 'headTreeSha', 'currentMainSha', 'currentMainTreeSha',
    'mergeBaseSha', 'mergeBaseTreeSha']) sha(input[key], key);
  const paths = input.sourcePathSet as Record<string, unknown> | null;
  if (paths === null || typeof paths !== 'object' || Array.isArray(paths)
      || JSON.stringify(Object.keys(paths).sort()) !== JSON.stringify(['count', 'digest'])
      || !Number.isSafeInteger(paths.count) || Number(paths.count) < 0
      || typeof paths.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(paths.digest)) {
    throw new Error('Planned supersession source path-set identity is invalid');
  }
  return Object.freeze({ ...input,
    sourcePathSet: Object.freeze({ count: Number(paths.count), digest: paths.digest }),
    unknowns: Object.freeze([]) }) as PlannedRefSupersessionReview;
}

export function parseExactRefRetirement(value: unknown): ExactRefRetirement {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('exact ref retirement must be one object');
  }
  const input = value as Record<string, unknown>;
  if (input.classification === 'reviewed-plan-superseded') {
    if (JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(
      ['branches', 'classification', 'expectedHeadSha', 'review'].sort())) {
      throw new Error('Planned ref retirement fields are invalid');
    }
    const branches = singleBranch(input.branches);
    const expectedHeadSha = sha(input.expectedHeadSha, 'expectedHeadSha');
    const review = parsePlannedRefSupersessionReview(input.review);
    if (review.branch !== branches[0] || review.headSha !== expectedHeadSha) {
      throw new Error('Planned ref retirement differs from its exact review');
    }
    return Object.freeze({ classification: 'reviewed-plan-superseded', branches, expectedHeadSha, review });
  }
  if (input.classification === 'closed-pr-superseded') {
    const keys = Object.keys(input).sort();
    const expected = ['branches', 'classification', 'expectedHeadSha', 'pullRequestNumber'].sort();
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
      throw new Error('closed PR retirement fields are invalid');
    }
    return Object.freeze({
      classification: 'closed-pr-superseded',
      branches: singleBranch(input.branches),
      expectedHeadSha: sha(input.expectedHeadSha, 'expectedHeadSha'),
      pullRequestNumber: positiveInteger(input.pullRequestNumber, 'pullRequestNumber')
    });
  }
  if (input.classification === 'reviewed-superseded') {
    const keys = Object.keys(input).sort();
    const expected = [
      'branches', 'classification', 'expectedHeadSha', 'reviewIssueNumber', 'reviewCommentId'
    ].sort();
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
      throw new Error('reviewed supersession retirement fields are invalid');
    }
    return Object.freeze({
      classification: 'reviewed-superseded',
      branches: singleBranch(input.branches),
      expectedHeadSha: sha(input.expectedHeadSha, 'expectedHeadSha'),
      reviewIssueNumber: positiveInteger(input.reviewIssueNumber, 'reviewIssueNumber'),
      reviewCommentId: positiveInteger(input.reviewCommentId, 'reviewCommentId')
    });
  }

  const keys = Object.keys(input).sort();
  const expected = ['branches', 'classification', 'expectedHeadSha'].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error('exact ref retirement fields are invalid');
  }
  if (input.classification !== 'transport-only'
      && input.classification !== 'main-tree-identical') {
    throw new Error('exact ref retirement classification is invalid');
  }
  const branches = singleBranch(input.branches);
  if (input.classification === 'transport-only'
      && !branches[0].startsWith('transport/')) {
    throw new Error('transport-only retirement accepts only transport/* branches');
  }
  return Object.freeze({
    classification: input.classification,
    branches,
    expectedHeadSha: sha(input.expectedHeadSha, 'expectedHeadSha')
  });
}

/** Continuation data only. The effect owner must still authenticate receipts and recheck live guards. */
export function decideExactRefBatchContinuation(input: Readonly<{
  mode: 'fresh' | 'resume';
  preparedState: 'present' | 'absent' | 'unknown';
  absenceObserved: boolean;
  recreationObserved: boolean;
  expectedHeadSha: string;
  currentHeadSha: string | null;
  priorEffect: 'not-started' | 'started' | 'returned' | 'settled';
}>): 'delete-cas' | 'retired' | 'converged-observed' | 'absent-unattributed' | 'blocked-recreation' | 'blocked-drift' | 'readback-only' | 'unsettled-identity' {
  sha(input.expectedHeadSha, 'expectedHeadSha');
  if (input.currentHeadSha !== null) sha(input.currentHeadSha, 'currentHeadSha');
  if (input.currentHeadSha !== null && input.currentHeadSha !== input.expectedHeadSha) return 'blocked-drift';
  if (input.currentHeadSha !== null && (input.absenceObserved || input.recreationObserved)) return 'blocked-recreation';
  if (input.currentHeadSha === null && input.recreationObserved && input.priorEffect !== 'not-started') return 'unsettled-identity';
  if (input.priorEffect !== 'not-started') {
    if (input.currentHeadSha !== null) return 'blocked-recreation';
    return input.priorEffect === 'started' ? 'converged-observed' : 'retired';
  }
  if (input.currentHeadSha === null) return 'absent-unattributed';
  if (input.preparedState === 'absent') return 'blocked-recreation';
  if (input.mode === 'resume') return 'readback-only';
  return 'delete-cas';
}
