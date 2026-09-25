import path from 'node:path';

import {
  executeGitHubApiOperation,
  withGitHubApiBranchCloseoutWriteSession
} from '../../../providers/github-api/operation-session.ts';
import { collectBranchLifecycleInventory } from './branch-lifecycle-inventory.ts';
import { assertGitBranchName } from './branch-lifecycle-audit.ts';
import { prepareBranchCloseout } from './branch-closeout.ts';

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

export async function retireExactRemoteRefs(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  retirement: ExactRefRetirement;
  recoveryRoot?: string;
}>): Promise<Readonly<{
  retired: readonly string[];
  alreadyAbsent: readonly string[];
  recoveryPath: string | null;
  recoverySha256: string | null;
}>> {
  const root = path.resolve(input.repositoryRoot);
  const request = parseExactRefRetirement(input.retirement);
  const before = await collectBranchLifecycleInventory({ repositoryRoot: root, recoveryRoot: input.recoveryRoot });
  if (before.repository.fullName !== input.repository) throw new Error('exact ref retirement repository identity differs');
  if (request.branches.includes(before.repository.defaultBranch)) throw new Error('default branch cannot be retired');
  for (const branch of request.branches) {
    if (before.pullRequests.some((pull) => pull.state === 'open' && pull.headBranch === branch)) {
      throw new Error(`branch ${branch} is still the head of an open pull request`);
    }
  }
  const present = request.branches.filter((branch) => {
    const remote = before.remoteBranches.find((entry) => entry.branch === branch);
    if (remote === undefined) return false;
    if (remote.sha !== request.expectedHeadSha) {
      throw new Error(`branch ${branch} does not bind expected head ${request.expectedHeadSha}`);
    }
    return true;
  });
  const alreadyAbsent = request.branches.filter((branch) => !present.includes(branch));

  // A rerun after a partial provider outcome treats already-absent refs as the
  // desired terminal state. If at least one alias is still present, create one
  // verified recovery bundle from that exact object before the next ref effect.
  let recovery: Readonly<{ path: string; sha256: string }> | null = null;
  if (present.length > 0) {
    const prepared = await prepareBranchCloseout({ repositoryRoot: root, recoveryRoot: input.recoveryRoot }, {
      branch: present[0]!, refState: 'present', expectedHeadSha: request.expectedHeadSha
    });
    const candidate = prepared.preparation.recovery;
    if (candidate.kind !== 'bundle' || candidate.verified !== true) {
      throw new Error('exact ref retirement requires one verified recovery bundle');
    }
    recovery = Object.freeze({ path: candidate.path, sha256: candidate.sha256 });
  }

  const retired: string[] = [];
  if (present.length > 0) await withGitHubApiBranchCloseoutWriteSession({
    repositoryRoot: root,
    repository: input.repository,
    operation: async (capability) => {
      for (const branch of present) {
        await executeGitHubApiOperation(capability, {
          kind: 'delete-ref-cas', branch, expectedOldSha: request.expectedHeadSha
        });
        retired.push(branch);
      }
    }
  });

  const after = await collectBranchLifecycleInventory({ repositoryRoot: root, recoveryRoot: input.recoveryRoot });
  for (const branch of request.branches) {
    if (after.remoteBranches.some((entry) => entry.branch === branch)) {
      throw new Error(`branch ${branch} remains after exact ref retirement`);
    }
  }
  return Object.freeze({
    retired: Object.freeze(retired),
    alreadyAbsent: Object.freeze(alreadyAbsent),
    recoveryPath: recovery?.path ?? null,
    recoverySha256: recovery?.sha256 ?? null
  });
}
