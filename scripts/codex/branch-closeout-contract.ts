import {
  BRANCH_CLOSEOUT_PREPARATION_SCHEMA_V1,
  BRANCH_CLOSEOUT_RECEIPT_SCHEMA_V1,
  BRANCH_REF_CLOSEOUT_CAPABILITY_V1,
  type BranchCloseoutAttempt,
  type BranchCloseoutAuthorization,
  type BranchCloseoutPreparation,
  type BranchCloseoutReceipt,
  type BranchCloseoutRequest,
  type BranchCloseoutStatus,
  type BranchLifecycleInventory,
  type ClassifiedBranchLifecycle,
  type BranchPullRequestObservation
} from './branch-lifecycle-types.ts';
import {
  assertDurableRecoveryAuthority,
  assertGitBranchName,
  assertGitSha,
  auditBranchLifecycle,
  branchLifecycleDigest,
  classifyBranchLifecycle,
  matchingWorktrees
} from './branch-lifecycle-audit.ts';

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function normalizeSha(value: string | null, label: string): string | null {
  if (value === null) return null;
  assertGitSha(value, label);
  return value;
}

export function createBranchCloseoutPreparation(input: Omit<
  BranchCloseoutPreparation,
  'schema' | 'preparationDigest'
>): BranchCloseoutPreparation {
  assertGitBranchName(input.branch);
  assertGitSha(input.expectedHeadSha, 'expectedHeadSha');
  assertGitSha(input.expectedRemoteSha, 'expectedRemoteSha');
  normalizeSha(input.expectedLocalSha, 'expectedLocalSha');
  if (
    input.pullRequestNumber !== null
    && (!Number.isSafeInteger(input.pullRequestNumber) || input.pullRequestNumber <= 0)
  ) {
    throw new Error('pullRequestNumber must be null or a positive safe integer.');
  }
  if ((input.pullRequestNumber === null) !== (input.pullRequestStateAtPreparation === null)) {
    throw new Error('pullRequest number and preparation state must either both be present or both be null.');
  }
  if (!input.recovery.verified) throw new Error('Recovery authority is not verified.');
  const withoutDigest = {
    schema: BRANCH_CLOSEOUT_PREPARATION_SCHEMA_V1,
    ...input
  };
  return {
    ...withoutDigest,
    preparationDigest: branchLifecycleDigest(withoutDigest)
  };
}

export function assertBranchCloseoutPreparation(
  preparation: BranchCloseoutPreparation
): void {
  if (preparation.schema !== BRANCH_CLOSEOUT_PREPARATION_SCHEMA_V1) {
    throw new Error('Branch closeout preparation schema mismatch.');
  }
  const { preparationDigest, ...withoutDigest } = preparation;
  if (branchLifecycleDigest(withoutDigest) !== preparationDigest) {
    throw new Error('Branch closeout preparation digest mismatch.');
  }
  assertGitBranchName(preparation.branch);
  assertGitSha(preparation.expectedHeadSha, 'expectedHeadSha');
  assertGitSha(preparation.expectedRemoteSha, 'expectedRemoteSha');
  normalizeSha(preparation.expectedLocalSha, 'expectedLocalSha');
}

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

function currentPullRequest(
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
}): BranchCloseoutAuthorization {
  const { preparation, request, before, current } = input;
  const blockers: string[] = [];
  const protections: string[] = [];

  try {
    assertBranchCloseoutPreparation(preparation);
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }

  if (request.capability !== BRANCH_REF_CLOSEOUT_CAPABILITY_V1) {
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

  const beforeRemote = before.remoteBranches.find(
    ({ branch }) => branch === preparation.branch
  );
  if (!beforeRemote || beforeRemote.sha !== preparation.expectedRemoteSha) {
    blockers.push('preparation does not bind the exact pre-merge remote ref');
  }

  if (preparation.pullRequestNumber !== null) {
    const beforePullRequest = currentPullRequest(before, preparation.pullRequestNumber);
    if (
      !beforePullRequest
      || beforePullRequest.headBranch !== preparation.branch
      || beforePullRequest.headSha !== preparation.expectedHeadSha
      || beforePullRequest.state !== preparation.pullRequestStateAtPreparation
    ) {
      blockers.push('preparation does not bind one exact PR head and state');
    }
  }

  try {
    assertDurableRecoveryAuthority(preparation.recovery, before);
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
          || currentPr.headSha !== preparation.expectedHeadSha
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

  if (current.activeWorkPackage.state === 'active') {
    blockers.push('active Work Package still selects a candidate after closeout');
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
  const currentRemote = current.remoteBranches.find(
    ({ branch }) => branch === preparation.branch
  );
  const currentLocal = current.localBranches.find(
    ({ branch }) => branch === preparation.branch
  );
  const boundWorktrees = matchingWorktrees(current, preparation.branch);

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

export function deriveBranchCloseoutStatus(input: {
  preparation: BranchCloseoutPreparation;
  authorization: BranchCloseoutAuthorization;
  attempts: readonly BranchCloseoutAttempt[];
  after: BranchLifecycleInventory;
}): { status: BranchCloseoutStatus; residue: string[] } {
  const residue: string[] = [];
  const { preparation, authorization, attempts, after } = input;

  if (authorization.blockers.length > 0) {
    return {
      status: 'blocked',
      residue: [...authorization.blockers]
    };
  }

  const remote = after.remoteBranches.find(({ branch }) => branch === preparation.branch);
  const local = after.localBranches.find(({ branch }) => branch === preparation.branch);
  const failedAttempts = attempts.filter(({ status }) => status === 'failed');

  if (remote !== undefined) {
    residue.push(`remote ref remains at ${remote.sha}`);
  }
  if (local !== undefined && authorization.localAction !== 'protect-local') {
    residue.push(`local ref remains at ${local.sha}`);
  }
  for (const attempt of failedAttempts) {
    residue.push(`${attempt.operation}: ${attempt.detail}`);
  }
  const afterAudit = auditBranchLifecycle(
    after,
    local !== undefined && authorization.localAction === 'protect-local'
      ? [{
          branch: preparation.branch,
          disposition: 'protected-pending',
          reference: preparation.preparationDigest
        }]
      : []
  );
  if (afterAudit.status === 'drift' || afterAudit.status === 'blocked') {
    for (const finding of afterAudit.findings.filter(({ severity }) => severity === 'error')) {
      residue.push(
        `lifecycle ${finding.code}${finding.branch ? `(${finding.branch})` : ''}: ${finding.message}`
      );
    }
  }

  if (residue.length > 0) {
    return {
      status: 'residue',
      residue: [...new Set(residue)].sort((left, right) => left.localeCompare(right))
    };
  }

  if (local !== undefined && authorization.localAction === 'protect-local') {
    return {
      status: 'protected-pending',
      residue: authorization.protections.length > 0
        ? authorization.protections
        : ['local branch remains protected by a worktree binding']
    };
  }

  return { status: 'completed', residue: [] };
}

export function createBranchCloseoutReceipt(input: Omit<
  BranchCloseoutReceipt,
  'schema' | 'status' | 'residue' | 'receiptDigest'
>): BranchCloseoutReceipt {
  const outcome = deriveBranchCloseoutStatus({
    preparation: input.preparation,
    authorization: input.authorization,
    attempts: input.attempts,
    after: input.after
  });
  const withoutDigest = {
    schema: BRANCH_CLOSEOUT_RECEIPT_SCHEMA_V1,
    ...input,
    status: outcome.status,
    residue: outcome.residue
  };
  return {
    ...withoutDigest,
    receiptDigest: branchLifecycleDigest(withoutDigest)
  };
}

export function parseBranchCloseoutReceipt(source: string): BranchCloseoutReceipt {
  const parsed: unknown = JSON.parse(source);
  assertRecord(parsed, 'Branch closeout receipt');
  if (parsed.schema !== BRANCH_CLOSEOUT_RECEIPT_SCHEMA_V1) {
    throw new Error('Branch closeout receipt schema mismatch.');
  }
  const receipt = parsed as unknown as BranchCloseoutReceipt;
  const { receiptDigest, ...withoutDigest } = receipt;
  if (branchLifecycleDigest(withoutDigest) !== receiptDigest) {
    throw new Error('Branch closeout receipt digest mismatch.');
  }
  assertBranchCloseoutPreparation(receipt.preparation);
  const derived = deriveBranchCloseoutStatus({
    preparation: receipt.preparation,
    authorization: receipt.authorization,
    attempts: receipt.attempts,
    after: receipt.after
  });
  if (
    receipt.status !== derived.status
    || JSON.stringify(receipt.residue) !== JSON.stringify(derived.residue)
  ) {
    throw new Error('Branch closeout receipt outcome does not match its evidence.');
  }
  return receipt;
}
