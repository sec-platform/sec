/** Branch-closeout authorization policy owner; data contract remains separate. */
import { assertBranchCloseoutPreparation } from './branch-closeout-contract.ts';
import { assertDurableRecoveryAuthority, classifyBranchLifecycle, matchingWorktrees } from './branch-lifecycle-audit.ts';
import { BRANCH_REF_CLOSEOUT_CAPABILITY, type BranchCloseoutAuthorization, type BranchCloseoutDisposition, type BranchCloseoutPreparation, type BranchCloseoutRequest, type BranchLifecycleClassification, type BranchLifecycleInventory, type BranchPullRequestObservation, type ClassifiedBranchLifecycle } from './branch-lifecycle-types.ts';
import { assertTrustedCompletedWorktreePhysicalCloseout, type WorktreePhysicalCloseoutConsumptionToken } from './worktree-physical-closeout.ts';

function resolveClassification(
  inventory: BranchLifecycleInventory,
  branch: string
): ClassifiedBranchLifecycle {
  return classifyBranchLifecycle(inventory).find((entry) => entry.branch === branch) ?? {
    branch,
    localSha: null,
    remoteSha: null,
    classification: 'orphan-unknown',
    worktreePaths: [],
    pullRequestNumbers: [],
    reasons: ['branch absent from current inventory']
  };
}

export function currentPullRequest(
  inventory: BranchLifecycleInventory,
  number: number
): BranchPullRequestObservation | undefined {
  return inventory.pullRequests.find((pullRequest) => pullRequest.number === number);
}

function durableGoalBlocker(
  request: BranchCloseoutRequest,
  inventory: BranchLifecycleInventory
): string | null {
  if (request.durableGoal.reference.trim() !== request.durableGoal.reference) {
    return 'durable goal reference must be trimmed';
  }
  if (request.durableGoal.reference.length === 0) {
    return 'durable goal reference is required';
  }
  if (request.disposition === 'merged') {
    if (request.durableGoal.kind !== 'main') {
      return 'merged closeout must retain its durable goal on main';
    }
    const match = /^main@([0-9a-f]{40})$/u.exec(request.durableGoal.reference);
    if (!match) return 'merged durable goal must be `main@<40-char-sha>`';
    if (inventory.main.remoteSha !== match[1]) {
      return 'merged durable goal SHA must match current remote main';
    }
  } else if (
    request.durableGoal.kind !== 'issue'
    && request.durableGoal.kind !== 'evidence'
  ) {
    return 'non-merged closeout must retain its goal in an Issue or canonical Evidence';
  }
  return null;
}

export function authorizeBranchCloseout(input: {
  preparation: BranchCloseoutPreparation;
  request: BranchCloseoutRequest;
  before: BranchLifecycleInventory;
  current: BranchLifecycleInventory;
  worktreeCleanupTokens?: readonly WorktreePhysicalCloseoutConsumptionToken[];
  expectedHeadTreeSha?: string;
  /**
   * A fresh host may observe that another host owned a registered worktree,
   * but it cannot convert its own absence readback into that host's completed
   * physical closeout.  The normal path is original-host physical completion
   * followed by a newly prepared closeout with no foreign observation;
   * merged recovery otherwise needs an explicit external maintainer decision.
   */
  foreignWorktreeObservationDigests?: readonly `sha256:${string}`[];
}): BranchCloseoutAuthorization {
  const { preparation, request, before, current } = input;
  const blockers: string[] = [];
  const protections: string[] = [];

  try {
    assertBranchCloseoutPreparation(preparation);
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }

  if (request.capability !== BRANCH_REF_CLOSEOUT_CAPABILITY) {
    blockers.push('branch/ref closeout capability is missing');
  }

  if (preparation.branch === current.repository.defaultBranch) {
    blockers.push('default branch cannot be closed out');
  }

  if (
    preparation.repository.fullName !== current.repository.fullName
    || preparation.repository.remote !== current.repository.remote
    || preparation.repository.defaultBranch !== current.repository.defaultBranch
    || preparation.repository.root !== current.repository.root
    || preparation.repository.commonDir !== current.repository.commonDir
  ) {
    blockers.push('prepared repository identity does not match current inventory');
  }

  if (preparation.pullRequestNumber !== null) {
    const beforePullRequest = currentPullRequest(before, preparation.pullRequestNumber);
    if (
      !beforePullRequest
      || beforePullRequest.headBranch !== preparation.branch
      || beforePullRequest.headSha !== (
        preparation.refState === 'absent'
          ? preparation.expectedPrHeadSha
          : preparation.expectedHeadSha
      )
      || beforePullRequest.state !== preparation.pullRequestStateAtPreparation
    ) {
      blockers.push('preparation does not bind one exact PR head and state');
    }
  }

  if (preparation.refState === 'absent') {
    const beforeRemote = before.remoteBranches.find(
      ({ branch }) => branch === preparation.branch
    );
    const currentRemote = current.remoteBranches.find(
      ({ branch }) => branch === preparation.branch
    );
    if (beforeRemote !== undefined || currentRemote !== undefined) {
      blockers.push('absent-ref closeout observed a surviving remote ref');
    }
    const pr = currentPullRequest(current, preparation.pullRequestNumber ?? -1);
    if (pr) {
      if (pr.headBranch !== preparation.branch) {
        blockers.push('current PR head branch differs from the prepared branch');
      }
      if (pr.headSha !== null && pr.headSha !== preparation.expectedPrHeadSha) {
        blockers.push('current PR head SHA differs from the prepared PR-recorded head');
      }
      const expectedState = preparation.pullRequestStateAtPreparation;
      if (expectedState !== null && pr.state !== expectedState) {
        blockers.push(`current PR state must be ${expectedState}`);
      }
    }
  } else {
    const beforeRemote = before.remoteBranches.find(
      ({ branch }) => branch === preparation.branch
    );
    if (!beforeRemote || beforeRemote.sha !== preparation.expectedRemoteSha) {
      blockers.push('preparation does not bind the exact pre-merge remote ref');
    }
  }

  try {
    assertDurableRecoveryAuthority(preparation.recovery, current);
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }

  const durableGoalError = durableGoalBlocker(request, current);
  if (durableGoalError !== null) blockers.push(durableGoalError);

  if (request.disposition === 'merged' || request.disposition === 'closed-superseded') {
    if (preparation.pullRequestNumber === null) {
      blockers.push('merged or closed-superseded closeout requires an exact PR binding');
    } else {
      const currentPr = currentPullRequest(current, preparation.pullRequestNumber);
      if (!currentPr) {
        blockers.push('current PR readback is missing');
      } else {
        if (
          currentPr.headBranch !== preparation.branch
          || currentPr.headSha !== (
            preparation.refState === 'absent'
              ? preparation.expectedPrHeadSha
              : preparation.expectedHeadSha
          )
        ) {
          blockers.push('current PR identity differs from the prepared PR');
        }
        const expectedState = request.disposition === 'merged' ? 'merged' : 'closed';
        if (currentPr.state !== expectedState) {
          blockers.push(`current PR state must be ${expectedState}`);
        }
      }
    }
  }

  if (
    current.activeWorkPackage.state === 'active'
    && current.activeWorkPackage.branch === preparation.branch
  ) {
    blockers.push('active Work Package still selects the candidate being closed out');
  } else if (
    current.activeWorkPackage.state === 'invalid'
    || current.activeWorkPackage.state === 'unresolved'
  ) {
    blockers.push('active Work Package readback is invalid or unresolved');
  }

  if (current.pullRequests.some((pullRequest) => (
    pullRequest.state === 'open'
    && pullRequest.headBranch === preparation.branch
  ))) {
    blockers.push('branch is still the head of an open PR');
  }

  if (before.unknowns.length > 0 || current.unknowns.length > 0) {
    blockers.push('inventory contains unresolved facts');
  }

  const classification = resolveClassification(current, preparation.branch);
  const dispositionClassifications = (
    disposition: BranchCloseoutDisposition
  ): readonly BranchLifecycleClassification[] => {
    switch (disposition) {
      case 'merged':
        return [
          'active-candidate',
          'open-pr-candidate',
          'merged-closeout',
          'protected-pending'
        ];
      case 'closed-superseded':
        return ['closed-superseded', 'protected-pending'];
      case 'completed-spike':
        return ['completed-spike', 'orphan-unknown', 'protected-pending'];
    }
  };
  if (!dispositionClassifications(request.disposition).includes(classification.classification)) {
    blockers.push(
      `disposition ${request.disposition} cannot close out ${classification.classification}`
    );
  }
  const currentRemote = current.remoteBranches.find(
    ({ branch }) => branch === preparation.branch
  );
  const currentLocal = current.localBranches.find(
    ({ branch }) => branch === preparation.branch
  );
  const boundWorktrees = matchingWorktrees(current, preparation.branch);
  const preparedBoundPaths = [...new Set(preparation.worktreePathsAtPreparation)]
    .sort((left, right) => left.localeCompare(right));

  const foreignObservations = [...new Set(input.foreignWorktreeObservationDigests ?? [])]
    .sort((left, right) => left.localeCompare(right));
  if (foreignObservations.some((digest) => !/^sha256:[0-9a-f]{64}$/u.test(digest))) {
    blockers.push('foreign worktree closeout observation identity is invalid');
  } else if (foreignObservations.length > 0) {
    // Do not accept a caller locator, raw receipt, self-digest, or this host's
    // inventory absence as a substitute for the foreign host's terminal fact.
    blockers.push('external-maintainer-disposition-required');
  }

  if (boundWorktrees.length > 0) {
    blockers.push('registered worktree must reach completed physical closeout before branch/ref CAS');
  } else if (preparedBoundPaths.length > 0) {
    if (input.expectedHeadTreeSha === undefined || !/^[0-9a-f]{40}$/u.test(input.expectedHeadTreeSha)) {
      blockers.push('exact prepared head tree is required to consume worktree cleanup receipts');
    }
    const tokens = input.worktreeCleanupTokens ?? [];
    for (const targetPath of preparedBoundPaths) {
      const matches = tokens.filter((token) => {
        try {
          assertTrustedCompletedWorktreePhysicalCloseout({
            token,
            repositoryRoot: current.repository.root,
            targetPath,
            branch: preparation.branch,
            headSha: preparation.expectedHeadSha,
            treeSha: input.expectedHeadTreeSha ?? '',
            recoveryAuthorityDigest: preparation.recovery.sha256
          });
          return true;
        } catch {
          return false;
        }
      });
      if (matches.length !== 1) {
        blockers.push(`exact completed worktree cleanup receipt is required for ${targetPath}`);
      }
    }
  }

  let remoteAction: BranchCloseoutAuthorization['remoteAction'];
  if (currentRemote === undefined) {
    remoteAction = 'already-absent';
  } else if (currentRemote.sha === preparation.expectedRemoteSha) {
    remoteAction = 'delete-cas';
  } else {
    remoteAction = 'blocked';
    blockers.push('remote branch SHA changed after preparation');
  }

  let localAction: BranchCloseoutAuthorization['localAction'];
  if (currentLocal === undefined) {
    localAction = 'already-absent';
  } else if (preparation.expectedLocalSha === null) {
    localAction = 'blocked';
    blockers.push('local branch appeared after preparation');
  } else if (currentLocal.sha !== preparation.expectedLocalSha) {
    localAction = 'blocked';
    blockers.push('local branch SHA changed after preparation');
  } else if (preparation.expectedLocalSha !== preparation.expectedHeadSha) {
    localAction = 'protect-local';
    protections.push(
      `local branch ${preparation.branch}@${preparation.expectedLocalSha} diverges from recovered remote head ${preparation.expectedHeadSha}`
    );
  } else if (boundWorktrees.length > 0) {
    localAction = 'protect-local';
    protections.push(...boundWorktrees.map((worktree) => {
      const details = [
        worktree.observation,
        worktree.locked ? 'locked' : null,
        worktree.prunable ? 'prunable' : null,
        worktree.dirtyCount === null ? 'dirty=unknown' : `dirty=${worktree.dirtyCount}`,
        worktree.untrackedCount === null
          ? 'untracked=unknown'
          : `untracked=${worktree.untrackedCount}`
      ].filter(Boolean).join(',');
      return `${worktree.path} (${details})`;
    }));
  } else {
    localAction = 'delete-exact';
  }

  if (blockers.length > 0) {
    if (remoteAction === 'delete-cas') remoteAction = 'blocked';
    if (localAction === 'delete-exact') localAction = 'blocked';
  }

  return {
    branch: preparation.branch,
    classification: classification.classification,
    remoteAction,
    localAction,
    blockers: [...new Set(blockers)].sort((left, right) => left.localeCompare(right)),
    protections: [...new Set(protections)].sort((left, right) => left.localeCompare(right))
  };
}
