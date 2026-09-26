import { assertGitBranchName } from '../../../../contracts/git-reference.ts';

export type ExactRefRetirement = Readonly<{
  classification: 'transport-only' | 'duplicate-transport-alias';
  branches: readonly string[];
  expectedHeadSha: string;
}>;

function sha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${label} must be one SHA-1 Git object id`);
  }
  return value;
}

export function parseExactRefRetirement(value: unknown): ExactRefRetirement {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('exact ref retirement must be one object');
  }
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort();
  const expected = ['branches', 'classification', 'expectedHeadSha'].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error('exact ref retirement fields are invalid');
  }
  if (input.classification !== 'transport-only'
      && input.classification !== 'duplicate-transport-alias') {
    throw new Error('exact ref retirement classification is invalid');
  }
  if (!Array.isArray(input.branches) || input.branches.length < 1 || input.branches.length > 16
      || input.branches.some((branch) => typeof branch !== 'string')) {
    throw new Error('exact ref retirement requires 1..16 branch names');
  }
  const branches = input.branches.map((branch) => {
    assertGitBranchName(branch as string, 'maintenance retirement branch');
    return branch as string;
  });
  if (new Set(branches).size !== branches.length) throw new Error('exact ref retirement contains duplicate branches');
  if (input.classification === 'transport-only') {
    if (!branches.every((branch) => branch.startsWith('transport/'))) {
      throw new Error('transport-only retirement accepts only transport/* branches');
    }
  } else {
    if (branches.length < 2 || !branches.some((branch) => branch.startsWith('transport/'))
        || !branches.every((branch) => branch.startsWith('transport/') || branch.startsWith('work/'))) {
      throw new Error('duplicate transport alias retirement requires transport/* plus only transport/* or work/* aliases');
    }
  }
  return Object.freeze({
    classification: input.classification,
    branches: Object.freeze(branches),
    expectedHeadSha: sha(input.expectedHeadSha, 'expectedHeadSha')
  });
}
