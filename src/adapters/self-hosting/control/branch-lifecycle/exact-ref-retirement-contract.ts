import { assertGitBranchName } from '../../../../contracts/git-reference.ts';

export type ExactRefRetirement =
  | Readonly<{
      classification: 'transport-only';
      branches: readonly [string];
      expectedHeadSha: string;
    }>
  | Readonly<{
      classification: 'closed-pr-superseded';
      branches: readonly [string];
      expectedHeadSha: string;
      pullRequestNumber: number;
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

export function parseExactRefRetirement(value: unknown): ExactRefRetirement {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('exact ref retirement must be one object');
  }
  const input = value as Record<string, unknown>;
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

  const keys = Object.keys(input).sort();
  const expected = ['branches', 'classification', 'expectedHeadSha'].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error('exact ref retirement fields are invalid');
  }
  if (input.classification !== 'transport-only') {
    throw new Error('exact ref retirement classification is invalid');
  }
  const branches = singleBranch(input.branches);
  if (!branches[0].startsWith('transport/')) {
    throw new Error('transport-only retirement accepts only transport/* branches');
  }
  return Object.freeze({
    classification: 'transport-only',
    branches,
    expectedHeadSha: sha(input.expectedHeadSha, 'expectedHeadSha')
  });
}
