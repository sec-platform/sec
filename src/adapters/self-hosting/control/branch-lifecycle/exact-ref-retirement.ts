import path from 'node:path';

import {
  executeGitHubApiOperation,
  withGitHubApiBranchCloseoutWriteSession
} from '../../../providers/github-api/operation-session.ts';
import { collectBranchLifecycleInventory } from './branch-lifecycle-inventory.ts';
import {
  parseExactRefRetirement,
  type ExactRefRetirement
} from './exact-ref-retirement-contract.ts';
import { createRecoveryBundle } from './branch-recovery.ts';

function assertClosedPullRequest(
  retirement: Extract<ExactRefRetirement, { classification: 'closed-pr-superseded' }>,
  inventory: ReturnType<typeof collectBranchLifecycleInventory>
): void {
  const branch = retirement.branches[0];
  const pull = inventory.pullRequests.find(({ number }) => number === retirement.pullRequestNumber);
  if (pull === undefined
      || (pull.state !== 'closed' && pull.state !== 'merged')
      || pull.isCrossRepository
      || pull.headBranch !== branch
      || pull.headSha !== retirement.expectedHeadSha) {
    throw new Error(
      `closed PR #${retirement.pullRequestNumber} does not bind ${branch}@${retirement.expectedHeadSha}`
    );
  }
}

export async function retireExactRemoteRefs(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  retirement: ExactRefRetirement;
  recoveryRoot?: string;
}>): Promise<Readonly<{
  retired: readonly string[];
  alreadyAbsent: readonly string[];
  recoveries: readonly Readonly<{ branch: string; path: string; sha256: string }>[];
}>> {
  const root = path.resolve(input.repositoryRoot);
  const request = parseExactRefRetirement(input.retirement);
  const before = collectBranchLifecycleInventory({ repositoryRoot: root });
  if (before.repository.fullName !== input.repository) {
    throw new Error('exact ref retirement repository identity differs');
  }
  if (before.unknowns.length > 0) {
    throw new Error(`exact ref retirement inventory is unresolved: ${before.unknowns.join(' | ')}`);
  }
  if (request.branches.includes(before.repository.defaultBranch)) {
    throw new Error('default branch cannot be retired');
  }
  for (const branch of request.branches) {
    const activePull = before.pullRequests.find((pull) => (
      pull.state === 'open' && (pull.headBranch === branch || pull.baseBranch === branch)
    ));
    if (activePull !== undefined) {
      throw new Error(
        `branch ${branch} is still referenced by open PR #${activePull.number} as head or base`
      );
    }
  }
  if (request.classification === 'closed-pr-superseded') {
    assertClosedPullRequest(request, before);
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

  const recoveries = present.map((branch) => {
    const prepared = createRecoveryBundle({
      inventory: before,
      branch,
      expectedSha: request.expectedHeadSha,
      recoveryRoot: input.recoveryRoot,
      refSource: request.classification === 'closed-pr-superseded'
        ? { kind: 'pull' as const, number: request.pullRequestNumber }
        : { kind: 'remote-branch' as const }
    });
    const recovery = prepared.recovery;
    if (recovery.kind !== 'bundle' || recovery.verified !== true) {
      throw new Error(`branch ${branch} recovery is not one verified git bundle`);
    }
    return Object.freeze({ branch, path: recovery.path, sha256: recovery.sha256 });
  });

  const retired: string[] = [];
  for (const branch of present) {
    await withGitHubApiBranchCloseoutWriteSession({
      repositoryRoot: root,
      repository: input.repository,
      operation: async (capability) => {
        await executeGitHubApiOperation(capability, {
          kind: 'delete-ref-cas',
          branch,
          expectedOldSha: request.expectedHeadSha
        });
      }
    });
    retired.push(branch);
  }

  const after = collectBranchLifecycleInventory({ repositoryRoot: root });
  if (after.repository.fullName !== input.repository || after.unknowns.length > 0) {
    throw new Error('exact ref retirement readback inventory is unresolved');
  }
  for (const branch of request.branches) {
    if (after.remoteBranches.some((entry) => entry.branch === branch)) {
      throw new Error(`branch ${branch} remains after exact ref retirement`);
    }
  }
  return Object.freeze({
    retired: Object.freeze(retired),
    alreadyAbsent: Object.freeze(alreadyAbsent),
    recoveries: Object.freeze(recoveries)
  });
}
