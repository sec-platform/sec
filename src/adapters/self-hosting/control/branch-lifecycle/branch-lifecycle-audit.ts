import path from 'node:path';

import { rawSha256Hex } from '../../../../contracts/canonical.ts';
import { assertGitBranchName } from '../../../../contracts/git-reference.ts';
import type {
  BranchAuditSeverity,
  BranchLifecycleAuditFinding,
  BranchLifecycleAuditReport,
  BranchLifecycleClassification,
  BranchLifecycleDispositionRecord,
  BranchLifecycleInventory,
  BranchPullRequestObservation,
  BranchRecoveryAuthority,
  BranchRefObservation,
  BranchWorktreeObservation,
  ClassifiedBranchLifecycle
} from './branch-lifecycle-types.ts';

export { assertGitBranchName };

const BRANCH_LIFECYCLE_SELECTION_PROJECTION_SCHEMA =
  'sec-branch-lifecycle-selection-projection-v1' as const;

export interface BranchLifecycleSelectionRef {
  readonly branch: string;
  readonly sha: string;
}

export interface BranchLifecycleSelectionWorktree {
  readonly worktreeRef: `sha256:${string}`;
  readonly branch: string | null;
  readonly headSha: string;
}

export interface BranchLifecycleSelectionPullRequest {
  readonly number: number;
  readonly headBranch: string;
  readonly headSha: string;
  readonly baseBranch: string;
  readonly baseSha: string;
}

function physicalBranchIdentityKey(branch: string, headSha: string): string {
  return `${branch}\0${headSha}`;
}

/**
 * Retain every live PR plus only historical PRs whose exact head still has a
 * physical local-ref, remote-ref, or attached-worktree consumer. Historical
 * PR comments cannot authorize or diagnose an absent branch, so loading them
 * would turn a bounded physical inventory into an unbounded repository-history
 * scan without adding lifecycle evidence.
 */
export function selectBranchLifecyclePullRequests(
  pullRequests: readonly BranchPullRequestObservation[],
  physicalBranchIdentities: readonly Readonly<{ branch: string; headSha: string }>[]
): BranchPullRequestObservation[] {
  const physical = new Set(
    physicalBranchIdentities.map(({ branch, headSha }) => (
      physicalBranchIdentityKey(branch, headSha)
    ))
  );
  return pullRequests.filter((pullRequest) => (
    pullRequest.state === 'open'
    || (
      pullRequest.headSha !== null
      && physical.has(physicalBranchIdentityKey(pullRequest.headBranch, pullRequest.headSha))
    )
  ));
}

export interface BranchLifecycleProspectiveTransport {
  readonly branch: string;
  readonly headSha: string;
  readonly worktreeRef: `sha256:${string}`;
}

export interface BranchLifecycleSelectionProjection {
  readonly schema: typeof BRANCH_LIFECYCLE_SELECTION_PROJECTION_SCHEMA;
  readonly exactMain: string;
  readonly defaultBranch: string;
  readonly activeState: 'none' | 'incomplete';
  readonly activeBranch: string | null;
  readonly activeHeadSha: string | null;
  readonly activeLegality: 'not-applicable' | 'legal' | 'invalid';
  readonly preservedPullRequests: readonly BranchLifecycleSelectionPullRequest[];
  readonly inventoryObservationDigest: `sha256:${string}`;
  readonly closeoutState: 'none' | 'required';
  readonly blockerRefs: readonly `sha256:${string}`[];
  readonly projectionDigest: `sha256:${string}`;
}

export function assertGitSha(value: string, label = 'Git SHA'): void {
  if (!/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase 40-character Git SHA.`);
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
  return `sha256:${rawSha256Hex(JSON.stringify(stableValue(value)))}`;
}

function selectionDigest(value: unknown, label: string): `sha256:${string}` {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be one SHA-256 digest.`);
  }
  return value as `sha256:${string}`;
}

function compareSelectionText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeSelectionRefs(
  entries: readonly BranchLifecycleSelectionRef[],
  label: string
): readonly BranchLifecycleSelectionRef[] {
  const normalized = entries.map((entry, index) => {
    assertGitBranchName(entry.branch, `${label}[${index}].branch`);
    assertGitSha(entry.sha, `${label}[${index}].sha`);
    return Object.freeze({ branch: entry.branch, sha: entry.sha });
  }).sort((left, right) => (
    compareSelectionText(left.branch, right.branch)
    || compareSelectionText(left.sha, right.sha)
  ));
  if (new Set(normalized.map(({ branch }) => branch)).size !== normalized.length) {
    throw new Error(`${label} contains a duplicate branch identity.`);
  }
  return Object.freeze(normalized);
}

function normalizeSelectionWorktrees(
  entries: readonly BranchLifecycleSelectionWorktree[]
): readonly BranchLifecycleSelectionWorktree[] {
  const normalized = entries.map((entry, index) => {
    const worktreeRef = selectionDigest(entry.worktreeRef, `worktrees[${index}].worktreeRef`);
    if (entry.branch !== null) {
      assertGitBranchName(entry.branch, `worktrees[${index}].branch`);
    }
    assertGitSha(entry.headSha, `worktrees[${index}].headSha`);
    return Object.freeze({ worktreeRef, branch: entry.branch, headSha: entry.headSha });
  }).sort((left, right) => compareSelectionText(left.worktreeRef, right.worktreeRef));
  if (new Set(normalized.map(({ worktreeRef }) => worktreeRef)).size !== normalized.length) {
    throw new Error('Work-selection lifecycle projection contains a duplicate worktree identity.');
  }
  return Object.freeze(normalized);
}

function normalizeSelectionPullRequests(
  entries: readonly BranchLifecycleSelectionPullRequest[],
  label: string
): readonly BranchLifecycleSelectionPullRequest[] {
  const normalized = entries.map((pullRequest, index) => {
    if (!Number.isSafeInteger(pullRequest.number) || pullRequest.number < 1) {
      throw new Error(`${label}[${index}].number must be positive.`);
    }
    assertGitBranchName(pullRequest.headBranch, `${label}[${index}].headBranch`);
    assertGitSha(pullRequest.headSha, `${label}[${index}].headSha`);
    assertGitBranchName(pullRequest.baseBranch, `${label}[${index}].baseBranch`);
    assertGitSha(pullRequest.baseSha, `${label}[${index}].baseSha`);
    return Object.freeze({ ...pullRequest });
  }).sort((left, right) => left.number - right.number);
  if (new Set(normalized.map(({ number }) => number)).size !== normalized.length) {
    throw new Error(`${label} contains a duplicate pull-request number.`);
  }
  if (new Set(normalized.map(({ headBranch }) => headBranch)).size !== normalized.length) {
    throw new Error(`${label} contains a duplicate pull-request branch.`);
  }
  return Object.freeze(normalized);
}

/**
 * Bounded #313 projection for Work Selection. The caller observes only the
 * complete non-default ref/worktree namespace, one selected OPEN pull request,
 * and every unselected OPEN pull request. This owner validates the exact active,
 * preserved, and prospective transports and decides whether any remaining
 * physical subject requires closeout. It deliberately does not scan historical
 * PRs, comments, or artifacts and does not authorize mutation.
 */
export function projectBranchLifecycleForWorkSelection(input: Readonly<{
  exactMain: string;
  defaultBranch: string;
  localRefs: readonly BranchLifecycleSelectionRef[];
  remoteRefs: readonly BranchLifecycleSelectionRef[];
  worktrees: readonly BranchLifecycleSelectionWorktree[];
  openPullRequests: readonly BranchLifecycleSelectionPullRequest[];
  preservedOpenPullRequests: readonly BranchLifecycleSelectionPullRequest[];
  prospectiveTransport: BranchLifecycleProspectiveTransport | null;
}>): BranchLifecycleSelectionProjection {
  assertGitSha(input.exactMain, 'Work-selection lifecycle exactMain');
  assertGitBranchName(input.defaultBranch, 'Work-selection lifecycle defaultBranch');
  const localRefs = normalizeSelectionRefs(input.localRefs, 'localRefs');
  const remoteRefs = normalizeSelectionRefs(input.remoteRefs, 'remoteRefs');
  const worktrees = normalizeSelectionWorktrees(input.worktrees);
  if (input.openPullRequests.length > 1) {
    throw new Error('Work-selection lifecycle projection accepts at most one OPEN pull request.');
  }
  const openPullRequests = normalizeSelectionPullRequests(input.openPullRequests, 'openPullRequests');
  const preservedOpenPullRequests = normalizeSelectionPullRequests(
    input.preservedOpenPullRequests,
    'preservedOpenPullRequests'
  );
  const completePullRequests = [...openPullRequests, ...preservedOpenPullRequests];
  if (new Set(completePullRequests.map(({ number }) => number)).size !== completePullRequests.length) {
    throw new Error('Selected and preserved pull requests contain a duplicate number.');
  }
  if (new Set(completePullRequests.map(({ headBranch }) => headBranch)).size !== completePullRequests.length) {
    throw new Error('Selected and preserved pull requests contain a conflicting branch.');
  }
  const inventoryObservationDigest = branchLifecycleDigest({
    localRefs,
    remoteRefs,
    worktrees,
    openPullRequests,
    preservedOpenPullRequests
  });
  const prospectiveTransport = input.prospectiveTransport === null
    ? null
    : (() => {
        assertGitBranchName(input.prospectiveTransport.branch, 'prospectiveTransport.branch');
        if (input.prospectiveTransport.branch === input.defaultBranch) {
          throw new Error('Prospective transport cannot reuse the canonical default branch.');
        }
        assertGitSha(input.prospectiveTransport.headSha, 'prospectiveTransport.headSha');
        const worktreeRef = selectionDigest(
          input.prospectiveTransport.worktreeRef,
          'prospectiveTransport.worktreeRef'
        );
        return Object.freeze({ ...input.prospectiveTransport, worktreeRef });
      })();

  const active = openPullRequests[0] ?? null;
  let activeLegality: BranchLifecycleSelectionProjection['activeLegality'] = 'not-applicable';
  const allowedBranches = new Map<string, string>();
  const allowedWorktrees = new Map<`sha256:${string}`, Readonly<{ branch: string; headSha: string }>>();
  if (active !== null) {
    const local = localRefs.find(({ branch }) => branch === active.headBranch);
    const remote = remoteRefs.find(({ branch }) => branch === active.headBranch);
    const boundWorktrees = worktrees.filter(({ branch }) => branch === active.headBranch);
    activeLegality = active.headBranch !== input.defaultBranch
      && active.baseBranch === input.defaultBranch
      && active.baseSha === input.exactMain
      && remote?.sha === active.headSha
      && (local === undefined || local.sha === active.headSha)
      && boundWorktrees.every(({ headSha }) => headSha === active.headSha)
      ? 'legal'
      : 'invalid';
    allowedBranches.set(active.headBranch, active.headSha);
    for (const worktree of boundWorktrees) {
      allowedWorktrees.set(worktree.worktreeRef, {
        branch: active.headBranch,
        headSha: active.headSha
      });
    }
  } else if (prospectiveTransport !== null) {
    if (prospectiveTransport.headSha !== input.exactMain) {
      throw new Error('Prospective transport must still point at the exact main preimage.');
    }
    const local = localRefs.find(({ branch }) => branch === prospectiveTransport.branch);
    const worktree = worktrees.find(({ worktreeRef }) => worktreeRef === prospectiveTransport.worktreeRef);
    if (local?.sha !== input.exactMain || worktree === undefined
        || worktree.branch !== prospectiveTransport.branch
        || worktree.headSha !== input.exactMain
        || remoteRefs.some(({ branch }) => branch === prospectiveTransport.branch)) {
      throw new Error('Prospective transport is not the exact local branch/worktree preimage.');
    }
    allowedBranches.set(prospectiveTransport.branch, input.exactMain);
    allowedWorktrees.set(prospectiveTransport.worktreeRef, {
      branch: prospectiveTransport.branch,
      headSha: input.exactMain
    });
  }

  const preservedPullRequests: BranchLifecycleSelectionPullRequest[] = [];
  const preservationBlockers: `sha256:${string}`[] = [];
  for (const pullRequest of preservedOpenPullRequests) {
    const local = localRefs.find(({ branch }) => branch === pullRequest.headBranch);
    const remote = remoteRefs.find(({ branch }) => branch === pullRequest.headBranch);
    const boundWorktrees = worktrees.filter(({ branch }) => branch === pullRequest.headBranch);
    const legal = pullRequest.headBranch !== input.defaultBranch
      && pullRequest.baseBranch === input.defaultBranch
      && pullRequest.baseSha === input.exactMain
      && remote?.sha === pullRequest.headSha
      && (local === undefined || local.sha === pullRequest.headSha)
      && boundWorktrees.every(({ headSha }) => headSha === pullRequest.headSha);
    if (!legal) {
      preservationBlockers.push(branchLifecycleDigest({
        kind: 'invalid-preservation-candidate',
        pullRequest
      }));
      continue;
    }
    preservedPullRequests.push(pullRequest);
    allowedBranches.set(pullRequest.headBranch, pullRequest.headSha);
    for (const worktree of boundWorktrees) {
      allowedWorktrees.set(worktree.worktreeRef, {
        branch: pullRequest.headBranch,
        headSha: pullRequest.headSha
      });
    }
  }

  const unexpected = [
    ...preservationBlockers,
    ...localRefs.filter(({ branch, sha }) => allowedBranches.get(branch) !== sha)
      .map((entry) => branchLifecycleDigest({ kind: 'local-ref', ...entry })),
    ...remoteRefs.filter(({ branch, sha }) => allowedBranches.get(branch) !== sha)
      .map((entry) => branchLifecycleDigest({ kind: 'remote-ref', ...entry })),
    ...worktrees.filter((entry) => {
      const allowed = allowedWorktrees.get(entry.worktreeRef);
      return allowed === undefined || entry.branch !== allowed.branch || entry.headSha !== allowed.headSha;
    }).map((entry) => branchLifecycleDigest({ kind: 'worktree', ...entry }))
  ].sort();
  const material = Object.freeze({
    schema: BRANCH_LIFECYCLE_SELECTION_PROJECTION_SCHEMA,
    exactMain: input.exactMain,
    defaultBranch: input.defaultBranch,
    activeState: active === null ? 'none' as const : 'incomplete' as const,
    activeBranch: active?.headBranch ?? null,
    activeHeadSha: active?.headSha ?? null,
    activeLegality,
    preservedPullRequests: Object.freeze(preservedPullRequests),
    inventoryObservationDigest,
    closeoutState: unexpected.length === 0 ? 'none' as const : 'required' as const,
    blockerRefs: Object.freeze(unexpected)
  });
  return Object.freeze({ ...material, projectionDigest: branchLifecycleDigest(material) });
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

/**
 * Validate the durable recovery proof carried by a closeout preparation.
 * This is structural/evidentiary validation only; it does not issue an
 * execution capability or authenticate a principal.
 */
export function assertDurableRecoveryProof(
  recovery: BranchRecoveryAuthority,
  inventory: BranchLifecycleInventory
): void {
  if (recovery.kind !== 'bundle' && recovery.kind !== 'main-absorption') {
    throw new Error('Recovery authority kind is invalid.');
  }
  if (!recovery.verified) throw new Error('Recovery authority must be verified.');
  if (!/^sha256:[0-9a-f]{64}$/u.test(recovery.sha256)) {
    throw new Error('Recovery authority digest must be SHA-256.');
  }
  if (recovery.kind === 'main-absorption') {
    for (const [label, sha] of [
      ['source', recovery.sourceSha], ['source tree', recovery.sourceTreeSha],
      ['main', recovery.mainSha], ['main tree', recovery.mainTreeSha]
    ] as const) assertGitSha(sha, `Recovery ${label}`);
    if (recovery.basis !== 'native-ancestor' && recovery.basis !== 'identical-tree'
        && recovery.basis !== 'reviewed-supersession') {
      throw new Error('Main absorption basis is invalid.');
    }
    if (recovery.basis === 'reviewed-supersession') {
      if (typeof recovery.reviewReference !== 'string'
          || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*#issuecomment-[1-9][0-9]*$/u.test(recovery.reviewReference)
          || typeof recovery.reviewReceiptDigest !== 'string'
          || !/^sha256:[0-9a-f]{64}$/u.test(recovery.reviewReceiptDigest)) {
        throw new Error('Reviewed main absorption requires an exact review reference and receipt digest.');
      }
    } else if (recovery.reviewReference !== undefined || recovery.reviewReceiptDigest !== undefined) {
      throw new Error('Native main absorption cannot carry a review binding.');
    }
    if (typeof recovery.verifyOutput !== 'string' || recovery.verifyOutput.length === 0
        || recovery.verifyOutput.length > 4096) {
      throw new Error('Main absorption verification output is invalid.');
    }
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
        `Recovery authority must be outside repository/common-dir/worktree roots: ${forbiddenRoot}`
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
    ...inventory.pullRequests
      .filter(({ isCrossRepository }) => !isCrossRepository)
      .map(({ headBranch }) => headBranch),
    ...(inventory.activeWorkPackage.branch === null ? [] : [inventory.activeWorkPackage.branch])
  ])].sort((left, right) => left.localeCompare(right));
}

function matchingPullRequests(
  inventory: BranchLifecycleInventory,
  branch: string
): BranchPullRequestObservation[] {
  return inventory.pullRequests
    .filter((pullRequest) => (
      !pullRequest.isCrossRepository
      && pullRequest.headBranch === branch
    ))
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
    } else if (
      explicitDisposition(dispositions, branch)?.disposition === 'protected-pending'
      && localRefs.has(branch)
      && !remoteRefs.has(branch)
    ) {
      classification = 'protected-pending';
      reasons.push('bound to a durable protected-pending closeout receipt');
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
      'error',
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
        'error',
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

  const openPullRequests = inventory.pullRequests.filter(({ state, isCrossRepository }) => (
    state === 'open' && !isCrossRepository
  ));
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
      classification.localSha !== null
      && (
        classification.classification === 'merged-closeout'
        || classification.classification === 'closed-superseded'
      )
    ) {
      findings.push(auditFinding(
        'closed-pr-local-ref-remains',
        'error',
        `Local branch remains after PR disposition (${classification.classification}).`,
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
      ? 'protected'
      : 'clean';

  return { status, classifications, findings };
}
