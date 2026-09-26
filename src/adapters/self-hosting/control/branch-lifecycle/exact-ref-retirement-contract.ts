import { assertGitBranchName } from '../../../../contracts/git-reference.ts';

export type ExactRefRetirement =
  | Readonly<{
      classification: 'transport-only' | 'duplicate-transport-alias';
      branches: readonly string[];
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

function branches(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16
      || value.some((branch) => typeof branch !== 'string')) {
    throw new Error('exact ref retirement requires 1..16 branch names');
  }
  const parsed = value.map((branch) => {
    assertGitBranchName(branch as string, 'maintenance retirement branch');
    return branch as string;
  });
  if (new Set(parsed).size !== parsed.length) {
    throw new Error('exact ref retirement contains duplicate branches');
  }
  return Object.freeze(parsed);
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
    const parsedBranches = branches(input.branches);
    if (parsedBranches.length !== 1) {
      throw new Error('closed PR retirement requires exactly one branch');
    }
    return Object.freeze({
      classification: 'closed-pr-superseded',
      branches: Object.freeze([parsedBranches[0]!] as const),
      expectedHeadSha: sha(input.expectedHeadSha, 'expectedHeadSha'),
      pullRequestNumber: positiveInteger(input.pullRequestNumber, 'pullRequestNumber')
    });
  }

  const keys = Object.keys(input).sort();
  const expected = ['branches', 'classification', 'expectedHeadSha'].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error('exact ref retirement fields are invalid');
  }
  if (input.classification !== 'transport-only'
      && input.classification !== 'duplicate-transport-alias') {
    throw new Error('exact ref retirement classification is invalid');
  }
  const parsedBranches = branches(input.branches);
  if (input.classification === 'transport-only') {
    if (!parsedBranches.every((branch) => branch.startsWith('transport/'))) {
      throw new Error('transport-only retirement accepts only transport/* branches');
    }
  } else if (parsedBranches.length < 2
      || !parsedBranches.some((branch) => branch.startsWith('transport/'))
      || !parsedBranches.every((branch) => (
        branch.startsWith('transport/') || branch.startsWith('work/')
      ))) {
    throw new Error(
      'duplicate transport alias retirement requires transport/* plus only transport/* or work/* aliases'
    );
  }
  return Object.freeze({
    classification: input.classification,
    branches: parsedBranches,
    expectedHeadSha: sha(input.expectedHeadSha, 'expectedHeadSha')
  });
}
