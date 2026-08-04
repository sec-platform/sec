import { createHash } from 'node:crypto';
import path from 'node:path';

import type {
  BranchAuditSeverity,
  BranchLifecycleAuditFinding,
  BranchLifecycleClassification,
  BranchLifecycleAuditReport,
  BranchLifecycleDispositionRecord,
  BranchLifecycleInventory,
  BranchPullRequestObservation,
  BranchRecoveryAuthority,
  BranchRefObservation,
  BranchWorktreeObservation,
  ClassifiedBranchLifecycle
} from './branch-lifecycle-types.ts';

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

export function assertGitSha(value: string, label = 'Git SHA'): void {
  if (!/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase 40-character Git SHA.`);
  }
}

export function assertGitBranchName(value: string, label = 'Git branch'): void {
  if (
    value.length === 0
    || value.length > 255
    || value.trim() !== value
    || value === '@'
    || value.startsWith('-')
    || value.startsWith('/')
    || value.endsWith('/')
    || value.endsWith('.')
    || value.includes('..')
    || value.includes('@{')
    || value.includes('//')
    || /[\u0000-\u0020\u007f~^:?*[\]\\]/u.test(value)
    || value.split('/').some((segment) => (
      segment.length === 0
      || segment.startsWith('.')
      || segment.endsWith('.lock')
    ))
  ) {
    throw new Error(`${label} must be one bounded option-safe Git branch name.`);
  }
}

function normalizeSha(value: string | null, label: string): string | null {
  if (value === null) return null;
  assertGitSha(value, label);
  return value;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, stableValue(record[key])])
    );
  }
  return value;
}

export function branchLifecycleDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex')}`;
}

function normalizeAbsolutePath(value: string): string {
  if (!path.isAbsolute(value)) throw new Error(`Path must be absolute: ${value}`);
  return path.resolve(value);
}

export function isPathWithin(candidate: string, parent: string): boolean {
  const normalizedCandidate = normalizeAbsolutePath(candidate);
  const normalizedParent = normalizeAbsolutePath(parent);
  const relative = path.relative(normalizedParent, normalizedCandidate);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

export function assertDurableRecoveryAuthority(
  recovery: BranchRecoveryAuthority,
  inventory: BranchLifecycleInventory
): void {
  if (recovery.kind !== 'bundle') throw new Error('Recovery authority must be a bundle.');
  if (!recovery.verified) throw new Error('Recovery bundle must be verified.');
  if (!/^sha256:[0-9a-f]{64}$/u.test(recovery.sha256)) {
    throw new Error('Recovery bundle digest must be SHA-256.');
  }
  const recoveryPath = normalizeAbsolutePath(recovery.path);
  const forbiddenRoots = new Set<string>([
    inventory.repository.root,
    inventory.repository.commonDir,
    ...inventory.worktrees.map((worktree) => worktree.path)
  ]);
  for (const forbiddenRoot of forbiddenRoots) {
    if (isPathWithin(recoveryPath, forbiddenRoot)) {
      throw new Error(
        `Recovery bundle must be outside repository/common-dir/worktree roots: ${forbiddenRoot}`
      );
    }
  }
}

function mapRefs(entries: readonly BranchRefObservation[], label: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const entry of entries) {
    assertGitBranchName(entry.branch, `${label} branch`);
    assertGitSha(entry.sha, `${label} ${entry.branch} SHA`);
    if (result.has(entry.branch)) throw new Error(`${label} contains duplicate branch ${entry.branch}.`);
    result.set(entry.branch, entry.sha);
  }
  return result;
}

function branchNames(inventory: BranchLifecycleInventory): string[] {
  return [...new Set<string>([
    inventory.repository.defaultBranch,
    ...inventory.localBranches.map(({ branch }) => branch),
    ...inventory.remoteBranches.map(({ branch }) => branch),
    ...inventory.worktrees.flatMap(({ branch }) => branch === null ? [] : [branch]),
    ...inventory.pullRequests.map(({ headBranch }) => headBranch),
    ...(inventory.activeWorkPackage.branch === null ? [] : [inventory.activeWorkPackage.branch])
  ])].sort((left, right) => left.localeCompare(right));
}

function matchingPullRequests(
  inventory: BranchLifecycleInventory,
  branch: string
): BranchPullRequestObservation[] {
  return inventory.pullRequests
    .filter((pullRequest) => pullRequest.headBranch === branch)
    .sort((left, right) => left.number - right.number);
}

export function matchingWorktrees(
  inventory: BranchLifecycleInventory,
  branch: string
): BranchWorktreeObservation[] {
  return inventory.worktrees
    .filter((worktree) => worktree.branch === branch)
    .sort((left, right) => left.path.localeCompare(right.path));
}

function explicitDisposition(
  dispositions: readonly BranchLifecycleDispositionRecord[],
  branch: string
): BranchLifecycleDispositionRecord | undefined {
  return dispositions.find((disposition) => disposition.branch === branch);
}

export function classifyBranchLifecycle(
  inventory: BranchLifecycleInventory,
  dispositions: readonly BranchLifecycleDispositionRecord[] = []
): ClassifiedBranchLifecycle[] {
  const localRefs = mapRefs(inventory.localBranches, 'localBranches');
  const remoteRefs = mapRefs(inventory.remoteBranches, 'remoteBranches');

  return branchNames(inventory).map((branch) => {
    const pullRequests = matchingPullRequests(inventory, branch);
    const worktrees = matchingWorktrees(inventory, branch);
    const protectedWorktrees = worktrees.filter((worktree) => (
      worktree.observation === 'unknown'
      || worktree.locked
      || worktree.prunable
      || worktree.dirtyCount !== 0
      || worktree.untrackedCount !== 0
    ));
    const reasons: string[] = [];
    let classification: BranchLifecycleClassification;

    if (branch === inventory.repository.defaultBranch) {
      classification = 'main';
      reasons.push('default branch');
    } else if (
      inventory.activeWorkPackage.state === 'active'
      && inventory.activeWorkPackage.branch === branch
    ) {
      classification = 'active-candidate';
      reasons.push('selected by the active Work Package resolver');
    } else if (pullRequests.some(({ state }) => state === 'open')) {
      classification = 'open-pr-candidate';
      reasons.push('head of an open pull request');
    } else if (worktrees.length > 0) {
      classification = 'protected-pending';
      reasons.push(
        protectedWorktrees.length > 0
          ? 'bound to a dirty, unknown, locked, or prunable worktree'
          : 'bound to a worktree and therefore not locally deletable'
      );
    } else if (pullRequests.some(({ state }) => state === 'merged')) {
      classification = 'merged-closeout';
      reasons.push('head of a merged pull request');
    } else if (pullRequests.some(({ state }) => state === 'closed')) {
      classification = 'closed-superseded';
      reasons.push('head of a closed pull request');
    } else if (explicitDisposition(dispositions, branch)?.disposition === 'completed-spike') {
      classification = 'completed-spike';
      reasons.push('explicit completed-spike disposition');
    } else {
      classification = 'orphan-unknown';
      reasons.push('no active Work Package, open PR, worktree protection, or durable disposition');
    }

    return {
      branch,
      localSha: localRefs.get(branch) ?? null,
      remoteSha: remoteRefs.get(branch) ?? null,
      classification,
      worktreePaths: worktrees.map(({ path: worktreePath }) => worktreePath),
      pullRequestNumbers: pullRequests.map(({ number }) => number),
      reasons
    };
  });
}

function auditFinding(
  code: string,
  severity: BranchAuditSeverity,
  message: string,
  branch: string | null = null
): BranchLifecycleAuditFinding {
  return { code, severity, branch, message };
}

export function auditBranchLifecycle(
  inventory: BranchLifecycleInventory,
  dispositions: readonly BranchLifecycleDispositionRecord[] = []
): BranchLifecycleAuditReport {
  const classifications = classifyBranchLifecycle(inventory, dispositions);
  const findings: BranchLifecycleAuditFinding[] = [];
  const defaultBranch = inventory.repository.defaultBranch;

  if (inventory.unknowns.length > 0) {
    for (const unknown of inventory.unknowns) {
      findings.push(auditFinding('inventory-unknown', 'error', unknown));
    }
  }

  if (inventory.repositorySetting.observation !== 'resolved') {
    findings.push(auditFinding(
      'delete-branch-setting-unknown',
      'error',
      inventory.repositorySetting.reason ?? 'GitHub delete_branch_on_merge setting is unknown.'
    ));
  } else if (inventory.repositorySetting.deleteBranchOnMerge !== true) {
    findings.push(auditFinding(
      'delete-branch-setting-drift',
      'error',
      'GitHub delete_branch_on_merge must be true.'
    ));
  }

  if (inventory.pruneConfiguration.observation !== 'resolved') {
    findings.push(auditFinding(
      'prune-configuration-unknown',
      'warning',
      inventory.pruneConfiguration.reason ?? 'Local prune configuration is unknown.'
    ));
  } else {
    const drift = [
      ['fetch.prune', inventory.pruneConfiguration.fetchPrune],
      [`remote.${inventory.repository.remote}.prune`, inventory.pruneConfiguration.remotePrune],
      ['fetch.pruneTags', inventory.pruneConfiguration.fetchPruneTags]
    ].filter(([, value]) => value !== true);
    for (const [key] of drift) {
      findings.push(auditFinding(
        'prune-configuration-drift',
        'warning',
        `${key} must be true in this clone.`
      ));
    }
  }

  if (
    inventory.main.remoteSha === null
    || inventory.main.remoteSha !== normalizeSha(
      inventory.remoteBranches.find(({ branch }) => branch === defaultBranch)?.sha ?? null,
      'remote default branch SHA'
    )
  ) {
    findings.push(auditFinding(
      'default-branch-readback-mismatch',
      'error',
      'Default branch identity is absent or inconsistent with remote head inventory.',
      defaultBranch
    ));
  }

  const openPullRequests = inventory.pullRequests.filter(({ state }) => state === 'open');
  const active = inventory.activeWorkPackage;
  const allowedRemoteBranches = new Set<string>([defaultBranch]);

  if (active.state === 'active' && active.branch !== null) {
    allowedRemoteBranches.add(active.branch);
  }
  for (const pullRequest of openPullRequests) {
    allowedRemoteBranches.add(pullRequest.headBranch);
  }

  if (active.state === 'none') {
    if (openPullRequests.length > 0) {
      for (const pullRequest of openPullRequests) {
        findings.push(auditFinding(
          'open-pr-without-active-package',
          'error',
          `Open PR #${pullRequest.number} has no active Work Package authorization.`,
          pullRequest.headBranch
        ));
        allowedRemoteBranches.delete(pullRequest.headBranch);
      }
    }
    for (const remote of inventory.remoteBranches) {
      if (remote.branch !== defaultBranch) {
        findings.push(auditFinding(
          'idle-remote-head-drift',
          'error',
          'Idle repository must have no remote head except the default branch.',
          remote.branch
        ));
      }
    }
  } else if (active.state === 'active') {
    if (active.branch === null) {
      findings.push(auditFinding(
        'active-candidate-branch-unknown',
        'error',
        'Active Work Package resolution does not identify its candidate branch.'
      ));
    }
    for (const pullRequest of openPullRequests) {
      if (active.branch !== pullRequest.headBranch) {
        findings.push(auditFinding(
          'open-pr-outside-active-package',
          'error',
          `Open PR #${pullRequest.number} is not the active Work Package branch.`,
          pullRequest.headBranch
        ));
      }
    }
  } else if (active.state === 'invalid' || active.state === 'unresolved') {
    findings.push(auditFinding(
      'active-work-package-unresolved',
      'error',
      active.reason ?? `Active Work Package state is ${active.state}.`
    ));
  }

  for (const remote of inventory.remoteBranches) {
    if (!allowedRemoteBranches.has(remote.branch)) {
      findings.push(auditFinding(
        'unauthorized-remote-head',
        'error',
        'Remote head is not default, active, or an open PR candidate.',
        remote.branch
      ));
    }
  }

  for (const classification of classifications) {
    if (
      classification.remoteSha !== null
      && (
        classification.classification === 'merged-closeout'
        || classification.classification === 'closed-superseded'
      )
    ) {
      findings.push(auditFinding(
        'closed-pr-head-still-remote',
        'error',
        `Remote head remains after PR disposition (${classification.classification}).`,
        classification.branch
      ));
    }
    if (
      classification.remoteSha !== null
      && classification.classification === 'orphan-unknown'
    ) {
      findings.push(auditFinding(
        'orphan-remote-head',
        'error',
        'Remote head has no machine-recognized lifecycle owner.',
        classification.branch
      ));
    }
    if (
      classification.localSha !== null
      && classification.classification === 'orphan-unknown'
    ) {
      findings.push(auditFinding(
        'orphan-local-branch',
        'error',
        'Local branch has no PR, active Work Package, worktree protection or disposition.',
        classification.branch
      ));
    }
    if (classification.classification === 'protected-pending') {
      findings.push(auditFinding(
        'protected-local-branch',
        'warning',
        'Local branch is intentionally protected by a worktree binding.',
        classification.branch
      ));
    }
  }

  const status = findings.some(({ severity }) => severity === 'error')
    ? (inventory.unknowns.length > 0 ? 'blocked' : 'drift')
    : findings.length > 0
      ? 'drift'
      : 'clean';

  return { status, classifications, findings };
}
