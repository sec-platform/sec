import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  readFileSync,
  readdirSync
} from 'node:fs';
import path from 'node:path';

import {
  createBranchLifecycleGitChildEnvironment,
  decodeBranchLifecycleChildStdout
} from './branch-lifecycle-command.ts';
import {
  assertBranchCloseoutPreparation,
  assertGitBranchName,
  assertGitSha,
  auditBranchLifecycle,
  branchLifecycleDigest,
  createBranchCloseoutPreparation,
  type BranchCloseoutAttempt,
  type BranchCloseoutPreparation,
  type BranchLifecycleInventory,
  type BranchPullRequestObservation,
  type BranchRecoveryAuthority
} from './branch-lifecycle-contract.ts';
import {
  collectBranchLifecycleInventory,
  type BranchLifecycleInventoryScope
} from './branch-lifecycle-inventory.ts';
import {
  acquireBranchRecoveryStore,
  createRecoveryBundle,
  ensureRecoveryRoot,
  verifyRecoveryAuthorityLive
} from './branch-recovery.ts';

const COMMAND_TIMEOUT_MS = 60_000;
const COMMAND_MAX_BUFFER = 32 * 1024 * 1024;

export interface BranchCloseoutScope extends BranchLifecycleInventoryScope {
  recoveryRoot?: string;
}

function assertBranchCloseoutInventoryResolved(inventory: BranchLifecycleInventory): void {
  const report = auditBranchLifecycle(inventory);
  if (report.status === 'blocked') {
    throw new Error(
      `Branch lifecycle is not closeout-ready (unknown facts block): ${report.findings
        .filter(({ severity }) => severity === 'error')
        .map(({ code, branch, message }) => `${code}${branch ? `(${branch})` : ''}: ${message}`)
        .join(' | ')}`
    );
  }
}

function runCloseoutGit(repositoryRoot: string, args: readonly string[]) {
  if (args.some((arg) => arg.includes('\0'))) {
    throw new Error('Branch closeout argument contains NUL.');
  }
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'buffer',
    windowsHide: true,
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: COMMAND_MAX_BUFFER,
    env: createBranchLifecycleGitChildEnvironment(process.env)
  });
  return {
    status: result.status,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(String(result.stdout ?? '')),
    stderr: Buffer.isBuffer(result.stderr)
      ? result.stderr
      : Buffer.from(String(result.stderr ?? result.error?.message ?? ''))
  };
}

export const BRANCH_CLOSEOUT_PREPARED_ENVELOPE_SCHEMA =
  'sec-branch-closeout-prepared-envelope-v2' as const;

/** A non-reversible observation of a worktree seen by a different host. */
interface ForeignWorktreeCloseoutObservation {
  readonly schema: 'sec-branch-closeout-foreign-worktree-observation-v1';
  readonly hostBindingDigest: `sha256:${string}`;
  readonly observationDigest: `sha256:${string}`;
}

export interface PreparedBranchCloseoutEnvelope {
  schema: typeof BRANCH_CLOSEOUT_PREPARED_ENVELOPE_SCHEMA;
  preparation: BranchCloseoutPreparation;
  before: BranchLifecycleInventory;
  attempts: BranchCloseoutAttempt[];
  foreignWorktreeObservations: readonly ForeignWorktreeCloseoutObservation[];
  envelopeDigest: `sha256:${string}`;
}

export interface PrepareBranchCloseoutInput {
  branch: string;
  /**
   * Remote-ref state at preparation. `present` (default) binds the live remote
   * ref. `absent` binds its absence while local ref/worktree state remains an
   * independent, exact closeout input.
   */
  refState?: 'present' | 'absent';
  expectedHeadSha?: string;
  /** Exact PR-recorded head SHA when it differs from the prepared ref head. */
  expectedPrHeadSha?: string | null;
  pullRequestNumber?: number | null;
}

export interface PrepareClosedUnmergedPullRequestCloseoutInput {
  number: number;
  refState: 'present' | 'absent';
  headBranch: string;
  headSha: string;
  baseBranch: string;
  baseSha: string;
  /** Fresh provider observation retained even after the branch ref is absent. */
  exactPullRequest: BranchPullRequestObservation;
}

type BranchCloseoutPreparationAdmission =
  | { kind: 'active-work-package' }
  | {
      kind: 'closed-unmerged';
      expectedBaseBranch: string;
      expectedBaseSha: string;
      exactPullRequest: BranchPullRequestObservation;
    };

function createPreparedEnvelope(input: Omit<
  PreparedBranchCloseoutEnvelope,
  'schema' | 'envelopeDigest'
>): PreparedBranchCloseoutEnvelope {
  const withoutDigest = {
    schema: BRANCH_CLOSEOUT_PREPARED_ENVELOPE_SCHEMA,
    ...input
  };
  return {
    ...withoutDigest,
    envelopeDigest: branchLifecycleDigest(withoutDigest)
  };
}

function foreignWorktreeObservation(input: {
  repository: BranchCloseoutPreparation['repository'];
  targetPath: string;
  branch: string;
  headSha: string;
}): ForeignWorktreeCloseoutObservation {
  const hostBindingDigest = branchLifecycleDigest({
    schema: 'sec-branch-closeout-foreign-host-binding-v1',
    root: input.repository.root,
    commonDir: input.repository.commonDir
  });
  const observationDigest = branchLifecycleDigest({
    schema: 'sec-branch-closeout-foreign-worktree-observation-v1',
    hostBindingDigest,
    targetPath: input.targetPath,
    branch: input.branch,
    headSha: input.headSha
  });
  return Object.freeze({ schema: 'sec-branch-closeout-foreign-worktree-observation-v1',
    hostBindingDigest, observationDigest });
}

function normalizeForeignWorktreeObservations(
  values: readonly ForeignWorktreeCloseoutObservation[]
): readonly ForeignWorktreeCloseoutObservation[] {
  const normalized = values.map((value) => {
    if (value.schema !== 'sec-branch-closeout-foreign-worktree-observation-v1'
      || !/^sha256:[0-9a-f]{64}$/u.test(value.hostBindingDigest)
      || !/^sha256:[0-9a-f]{64}$/u.test(value.observationDigest)) {
      throw new Error('Foreign worktree closeout observation is invalid.');
    }
    return Object.freeze({ ...value });
  }).sort((left, right) => left.observationDigest.localeCompare(right.observationDigest));
  return Object.freeze(normalized.filter((value, index) => (
    index === 0 || normalized[index - 1]!.observationDigest !== value.observationDigest
  )));
}

export function assertPreparedBranchCloseoutEnvelope(
  envelope: PreparedBranchCloseoutEnvelope
): void {
  if (envelope.schema !== BRANCH_CLOSEOUT_PREPARED_ENVELOPE_SCHEMA) {
    throw new Error('Prepared branch closeout envelope schema mismatch.');
  }
  const { envelopeDigest, ...withoutDigest } = envelope;
  if (branchLifecycleDigest(withoutDigest) !== envelopeDigest) {
    throw new Error('Prepared branch closeout envelope digest mismatch.');
  }
  normalizeForeignWorktreeObservations(envelope.foreignWorktreeObservations);
}

export function parsePreparedBranchCloseoutEnvelope(
  source: string
): PreparedBranchCloseoutEnvelope {
  const parsed: unknown = JSON.parse(source);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Prepared branch closeout envelope must be an object.');
  }
  const raw = parsed as Record<string, unknown>;
  const envelope = raw as unknown as PreparedBranchCloseoutEnvelope;
  assertPreparedBranchCloseoutEnvelope(envelope);
  return envelope;
}

/**
 * Rehydrates a remotely published stable preparation on a fresh hosted
 * checkout. Remote operation semantics remain byte-identical while all
 * host-local recovery paths and inventory are independently reconstructed and
 * verified on the current runner.
 */
export function rehydratePreparedBranchCloseoutEnvelope(input: {
  remote: PreparedBranchCloseoutEnvelope;
  local: PreparedBranchCloseoutEnvelope;
}): PreparedBranchCloseoutEnvelope {
  assertPreparedBranchCloseoutEnvelope(input.remote);
  assertPreparedBranchCloseoutEnvelope(input.local);
  if (input.remote.preparation.repository.fullName !== input.local.preparation.repository.fullName
    || input.remote.preparation.branch !== input.local.preparation.branch
    || input.remote.preparation.expectedHeadSha !== input.local.preparation.expectedHeadSha
    || input.remote.preparation.pullRequestNumber !== input.local.preparation.pullRequestNumber
    || input.remote.preparation.recovery.sha256 !== input.local.preparation.recovery.sha256) {
    throw new Error('Fresh-host closeout recovery differs from the remotely authorized branch identity.');
  }
  const preparation = {
    ...input.remote.preparation,
    preparedAt: input.local.preparation.preparedAt,
    repository: {
      ...input.remote.preparation.repository,
      root: input.local.preparation.repository.root,
      commonDir: input.local.preparation.repository.commonDir
    },
    expectedLocalSha: input.local.preparation.expectedLocalSha,
    recovery: input.local.preparation.recovery,
    // A fresh host may retain only its own paths.  Foreign paths are reduced
    // below to host-qualified digests and can never become local completion.
    worktreePathsAtPreparation: [...input.local.preparation.worktreePathsAtPreparation]
      .sort((left, right) => left.localeCompare(right))
  };
  assertBranchCloseoutPreparation(preparation);
  return createPreparedEnvelope({ preparation, before: input.remote.before,
    attempts: [...input.local.attempts],
    foreignWorktreeObservations: normalizeForeignWorktreeObservations([
      ...input.remote.foreignWorktreeObservations,
      ...input.local.foreignWorktreeObservations,
      ...input.remote.preparation.worktreePathsAtPreparation.map((targetPath) =>
        foreignWorktreeObservation({ repository: input.remote.preparation.repository, targetPath,
          branch: input.remote.preparation.branch,
          headSha: input.remote.preparation.expectedHeadSha }))
    ]) });
}

/**
 * Restores the exact pre-merge recovery bytes from a provider-authenticated
 * Actions artifact on a fresh hosted runner. The stable preparation identity
 * remains byte-identical; only host-local paths/inventory are reconstructed.
 */
export function rehydratePreparedBranchCloseoutRecoveryArtifact(input: {
  scope: BranchCloseoutScope;
  remote: PreparedBranchCloseoutEnvelope;
  recoveryBundleBytes: Uint8Array;
}): PreparedBranchCloseoutEnvelope {
  assertPreparedBranchCloseoutEnvelope(input.remote);
  const bytes = Buffer.from(input.recoveryBundleBytes);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (`sha256:${digest}` !== input.remote.preparation.recovery.sha256) {
    throw new Error('Provider recovery bundle digest differs from the authorized preparation.');
  }
  const inventory = collectBranchLifecycleInventory(input.scope);
  assertBranchCloseoutInventoryResolved(inventory);
  const store = acquireBranchRecoveryStore({
    repositoryRoot: inventory.repository.root,
    commonDir: inventory.repository.commonDir,
    worktreeRoots: inventory.worktrees.map((worktree) => worktree.path),
    ...(input.scope.recoveryRoot === undefined ? {} : { recoveryRoot: input.scope.recoveryRoot })
  });
  const recoveryRoot = store.root.path;
  const bundleName = `sec-branch-closeout-restored-${digest}.bundle`;
  const bundlePath = path.join(recoveryRoot, bundleName);
  const existingBundle = store.read(bundleName);
  if (existingBundle !== null) {
    if (!Buffer.from(existingBundle).equals(bytes)) {
      throw new Error('Existing restored recovery bundle path contains conflicting bytes.');
    }
  } else {
    store.publishExclusive({
      name: bundleName,
      bytes,
      validate: (published) => {
        if (!Buffer.from(published).equals(bytes)) {
          throw new Error('Restored recovery bundle publication changed bytes.');
        }
      }
    });
  }
  const checksumText = `${digest}  ${bundleName}\n`;
  const checksumName = `${bundleName}.sha256`;
  const existingChecksum = store.read(checksumName);
  if (existingChecksum !== null) {
    if (Buffer.from(existingChecksum).toString('utf8') !== checksumText) {
      throw new Error('Existing restored recovery checksum contains conflicting bytes.');
    }
  } else {
    store.publishExclusive({
      name: checksumName,
      bytes: Buffer.from(checksumText, 'utf8'),
      validate: (published) => {
        if (Buffer.from(published).toString('utf8') !== checksumText) {
          throw new Error('Restored recovery checksum publication changed bytes.');
        }
      }
    });
  }
  const recovery = {
    ...input.remote.preparation.recovery,
    path: bundlePath,
    sha256: `sha256:${digest}` as const
  };
  const recoveryReadback = verifyRecoveryAuthorityLive({ inventory, recovery });
  if (recoveryReadback.status !== 'success') {
    throw new Error(`Restored provider recovery bundle failed live verification: ${recoveryReadback.detail}`);
  }
  const localBranch = inventory.localBranches.find(({ branch }) => (
    branch === input.remote.preparation.branch
  ));
  const preparation = createBranchCloseoutPreparation({
    preparedAt: new Date().toISOString(),
    repository: {
      ...input.remote.preparation.repository,
      root: inventory.repository.root,
      commonDir: inventory.repository.commonDir
    },
    branch: input.remote.preparation.branch,
    refState: input.remote.preparation.refState,
    expectedHeadSha: input.remote.preparation.expectedHeadSha,
    expectedRemoteSha: input.remote.preparation.expectedRemoteSha,
    expectedLocalSha: localBranch?.sha ?? null,
    expectedPrHeadSha: input.remote.preparation.expectedPrHeadSha,
    pullRequestNumber: input.remote.preparation.pullRequestNumber,
    pullRequestStateAtPreparation: input.remote.preparation.pullRequestStateAtPreparation,
    recovery,
    worktreePathsAtPreparation: inventory.worktrees
        .filter(({ branch }) => branch === input.remote.preparation.branch)
        .map(({ path: worktreePath }) => worktreePath)
        .sort((left, right) => left.localeCompare(right))
  });
  if (preparation.preparationDigest !== input.remote.preparation.preparationDigest) {
    throw new Error('Fresh-host provider recovery changed the stable preparation identity.');
  }
  return createPreparedEnvelope({ preparation, before: input.remote.before,
    attempts: [recoveryReadback],
    foreignWorktreeObservations: normalizeForeignWorktreeObservations([
      ...input.remote.foreignWorktreeObservations,
      ...input.remote.preparation.worktreePathsAtPreparation.map((targetPath) =>
        foreignWorktreeObservation({ repository: input.remote.preparation.repository, targetPath,
          branch: input.remote.preparation.branch,
          headSha: input.remote.preparation.expectedHeadSha }))
    ]) });
}

export function preparationFilePath(preparation: BranchCloseoutPreparation): string {
  return `${preparation.recovery.path}.preparation.json`;
}

function operationSuffix(closeoutOperationId: `sha256:${string}`): string {
  return closeoutOperationId.slice('sha256:'.length);
}

export function operationJournalFilePath(
  preparation: BranchCloseoutPreparation,
  closeoutOperationId: `sha256:${string}`
): string {
  return `${preparation.recovery.path}.closeout-${operationSuffix(closeoutOperationId)}.journal.json`;
}

export function operationReceiptFilePath(
  preparation: BranchCloseoutPreparation,
  closeoutOperationId: `sha256:${string}`
): string {
  return `${preparation.recovery.path}.closeout-${operationSuffix(closeoutOperationId)}.receipt.json`;
}

function persistPreparedEnvelope(
  envelope: PreparedBranchCloseoutEnvelope,
  configuredRecoveryRoot?: string
): string {
  const store = acquireBranchRecoveryStore({
    repositoryRoot: envelope.before.repository.root,
    commonDir: envelope.before.repository.commonDir,
    worktreeRoots: envelope.before.worktrees.map((worktree) => worktree.path),
    ...(configuredRecoveryRoot === undefined ? {} : { recoveryRoot: configuredRecoveryRoot })
  });
  const recoveryPath = path.resolve(envelope.preparation.recovery.path);
  if (path.dirname(recoveryPath) !== store.root.path) {
    throw new Error('Prepared closeout recovery path is outside the owned recovery store.');
  }
  const fileName = `${path.basename(recoveryPath)}.preparation.json`;
  const payload = `${JSON.stringify(envelope, null, 2)}\n`;
  const published = store.publishExclusive({
    name: fileName,
    bytes: Buffer.from(payload, 'utf8'),
    validate: (bytes) => {
      if (Buffer.from(bytes).toString('utf8') !== payload) {
        throw new Error('Prepared closeout envelope publication changed bytes.');
      }
    }
  });
  return published.path;
}

function prepareBranchCloseoutInternal(
  scope: BranchCloseoutScope,
  input: PrepareBranchCloseoutInput,
  admission: BranchCloseoutPreparationAdmission
): PreparedBranchCloseoutEnvelope {
  assertGitBranchName(input.branch);
  const refState = input.refState ?? 'present';
  if (refState !== 'present' && refState !== 'absent') {
    throw new Error('refState must be present or absent.');
  }
  if (input.expectedHeadSha !== undefined) {
    assertGitSha(input.expectedHeadSha, 'expected branch head');
  }
  if (input.expectedPrHeadSha !== undefined && input.expectedPrHeadSha !== null) {
    assertGitSha(input.expectedPrHeadSha, 'expected PR-recorded head');
  }
  if (
    input.pullRequestNumber !== undefined
    && input.pullRequestNumber !== null
    && (!Number.isSafeInteger(input.pullRequestNumber) || input.pullRequestNumber <= 0)
  ) {
    throw new Error('pullRequestNumber must be a positive safe integer.');
  }

  let before = collectBranchLifecycleInventory(scope);
  if (admission.kind === 'closed-unmerged') {
    const exact = admission.exactPullRequest;
    if (exact.isCrossRepository
      || exact.url !== `https://github.com/${before.repository.fullName}/pull/${exact.number}`) {
      throw new Error('Closed-unmerged exact PR observation is not repository-local.');
    }
    before = {
      ...before,
      pullRequests: [
        ...before.pullRequests.filter(({ number }) => number !== exact.number),
        structuredClone(exact)
      ].sort((left, right) => left.number - right.number)
    };
  }
  assertBranchCloseoutInventoryResolved(before);
  if (input.branch === before.repository.defaultBranch) {
    throw new Error('Default branch cannot be prepared for closeout.');
  }

  if (refState === 'absent') {
    if (before.remoteBranches.some(({ branch }) => branch === input.branch)) {
      throw new Error(`Absent-ref preparation observed surviving remote branch ${input.branch}.`);
    }
  }
  const remote = before.remoteBranches.find(({ branch }) => branch === input.branch);
  if (refState === 'present') {
    if (!remote) throw new Error(`Remote branch ${input.branch} is absent.`);
    if (input.expectedHeadSha !== undefined && remote.sha !== input.expectedHeadSha) {
      throw new Error(
        `Remote branch SHA mismatch: expected ${input.expectedHeadSha}, observed ${remote.sha}.`
      );
    }
  }
  const local = before.localBranches.find(({ branch }) => branch === input.branch);

  const pullRequestNumber = input.pullRequestNumber ?? null;
  const pullRequest = pullRequestNumber === null
    ? undefined
    : before.pullRequests.find(({ number }) => number === pullRequestNumber);
  if (pullRequestNumber !== null && !pullRequest) {
    throw new Error(`PR #${pullRequestNumber} is absent from inventory.`);
  }
  if (pullRequest) {
    if (admission.kind === 'closed-unmerged') {
      if (pullRequest.state !== 'closed') {
        throw new Error(
          `Closed-unmerged preparation requires an exact closed PR, observed ${pullRequest.state}.`
        );
      }
      if (
        pullRequest.baseBranch !== admission.expectedBaseBranch
        || pullRequest.baseSha !== admission.expectedBaseSha
      ) {
        throw new Error('Closed-unmerged preparation base identity differs from the exact request.');
      }
      if (before.activeWorkPackage.state !== 'none') {
        throw new Error('Closed-unmerged preparation requires no active or unresolved Work Package.');
      }
    }
    if (refState === 'absent') {
      if (
        pullRequest.headBranch !== input.branch
        || pullRequest.headSha === null
      ) {
        throw new Error(`PR #${pullRequest.number} does not bind the exact prepared branch.`);
      }
      if (
        pullRequest.state !== 'merged'
        && pullRequest.state !== 'closed'
      ) {
        throw new Error(`Absent-ref preparation requires a merged or closed PR, observed ${pullRequest.state}.`);
      }
      const prHeadSha = input.expectedPrHeadSha ?? input.expectedHeadSha;
      if (prHeadSha === undefined || prHeadSha !== pullRequest.headSha) {
        throw new Error(
          `PR #${pullRequest.number} recorded head ${pullRequest.headSha} does not match prepared PR head ${prHeadSha ?? '<none>'}.`
        );
      }
    } else {
      if (remote === undefined) throw new Error(`Remote branch ${input.branch} is absent.`);
      if (
        pullRequest.headBranch !== input.branch
        || pullRequest.headSha !== remote.sha
      ) {
        throw new Error(`PR #${pullRequest.number} does not bind the exact remote branch head.`);
      }
    }
    if (
      pullRequest.state === 'open'
      && (
        before.activeWorkPackage.state !== 'active'
        || before.activeWorkPackage.branch !== input.branch
      )
      && admission.kind !== 'closed-unmerged'
    ) {
      throw new Error('Open PR closeout preparation requires the exact active Work Package branch.');
    }
  } else if (before.pullRequests.some((candidate) => (
    candidate.state === 'open'
    && candidate.headBranch === input.branch
  ))) {
    throw new Error('Branch has an open PR but no exact PR binding was supplied.');
  }

  let expectedHeadSha: string;
  if (refState === 'absent') {
    if (input.expectedHeadSha !== undefined) {
      expectedHeadSha = input.expectedHeadSha;
    } else if (pullRequest?.headSha !== undefined && pullRequest.headSha !== null) {
      expectedHeadSha = pullRequest.headSha;
    } else {
      throw new Error('Absent-ref preparation requires an exact expected head SHA.');
    }
  } else {
    if (remote === undefined) throw new Error(`Remote branch ${input.branch} is absent.`);
    expectedHeadSha = remote.sha;
  }
  if (local !== undefined && local.sha !== expectedHeadSha) {
    throw new Error(
      `Local branch SHA mismatch: expected ${expectedHeadSha}, observed ${local.sha}.`
    );
  }
  const localSha = local?.sha ?? null;
  const expectedPrHeadSha = refState === 'absent'
    ? (input.expectedPrHeadSha ?? pullRequest?.headSha ?? null)
    : null;

  const { recovery, attempts } = refState === 'absent'
    ? prepareAbsentRefRecovery(scope, before, input.branch, expectedHeadSha, pullRequestNumber)
    : createRecoveryBundle({
        inventory: before,
        branch: input.branch,
        expectedSha: expectedHeadSha,
        recoveryRoot: scope.recoveryRoot,
        refSource: { kind: 'remote-branch' }
      });
  const preparation = createBranchCloseoutPreparation({
    preparedAt: new Date().toISOString(),
    repository: {
      root: before.repository.root,
      commonDir: before.repository.commonDir,
      fullName: before.repository.fullName,
      remote: before.repository.remote,
      defaultBranch: before.repository.defaultBranch
    },
    branch: input.branch,
    refState,
    expectedHeadSha,
    expectedRemoteSha: expectedHeadSha,
    expectedLocalSha: localSha,
    expectedPrHeadSha,
    pullRequestNumber: pullRequest?.number ?? null,
    pullRequestStateAtPreparation: pullRequest?.state ?? null,
    recovery,
    worktreePathsAtPreparation: before.worktrees
      .filter(({ branch }) => branch === input.branch)
      .map(({ path: worktreePath }) => worktreePath)
      .sort((left, right) => left.localeCompare(right))
  });
  const envelope = createPreparedEnvelope({ preparation, before, attempts,
    foreignWorktreeObservations: [] });
  persistPreparedEnvelope(envelope, scope.recoveryRoot);
  return envelope;
}

export function prepareBranchCloseout(
  scope: BranchCloseoutScope,
  input: PrepareBranchCloseoutInput
): PreparedBranchCloseoutEnvelope {
  return prepareBranchCloseoutInternal(scope, input, { kind: 'active-work-package' });
}

/** Durable preparation only; the operation compiler and provider still own Effect admission. */
export function prepareClosedUnmergedPullRequestCloseout(
  scope: BranchCloseoutScope,
  input: PrepareClosedUnmergedPullRequestCloseoutInput
): PreparedBranchCloseoutEnvelope {
  if (input.refState !== 'present' && input.refState !== 'absent') {
    throw new Error('Closed-unmerged ref state must be present or absent.');
  }
  assertGitBranchName(input.headBranch);
  assertGitSha(input.headSha, 'closed-unmerged PR head');
  assertGitBranchName(input.baseBranch, 'closed-unmerged PR base branch');
  assertGitSha(input.baseSha, 'closed-unmerged PR base SHA');
  return prepareBranchCloseoutInternal(scope, {
    branch: input.headBranch,
    refState: input.refState,
    expectedHeadSha: input.headSha,
    expectedPrHeadSha: input.refState === 'absent' ? input.headSha : null,
    pullRequestNumber: input.number
  }, {
    kind: 'closed-unmerged',
    expectedBaseBranch: input.baseBranch,
    expectedBaseSha: input.baseSha,
    exactPullRequest: input.exactPullRequest
  });
}

function prepareAbsentRefRecovery(
  scope: BranchCloseoutScope,
  inventory: BranchLifecycleInventory,
  branch: string,
  expectedSha: string,
  pullRequestNumber: number | null
): { recovery: BranchRecoveryAuthority; attempts: BranchCloseoutAttempt[] } {
  const existing = findMatchingRecoveryBundle(scope, inventory, branch, expectedSha);
  if (existing !== null) {
    const attempts: BranchCloseoutAttempt[] = [{
      operation: 'recovery-create',
      status: 'success',
      detail: `${existing.path} (reused verified recovery bundle)`
    }];
    const live = verifyRecoveryAuthorityLive({ inventory, recovery: existing });
    attempts.push(live);
    if (live.status !== 'success') {
      throw new Error(`Reused recovery bundle failed live revalidation: ${live.detail}`);
    }
    return { recovery: existing, attempts };
  }
  if (inventory.localBranches.some((entry) => (
    entry.branch === branch && entry.sha === expectedSha
  ))) {
    return createRecoveryBundle({
      inventory,
      branch,
      expectedSha,
      recoveryRoot: scope.recoveryRoot,
      refSource: { kind: 'local-branch' }
    });
  }
  if (pullRequestNumber !== null) {
    return createRecoveryBundle({
      inventory,
      branch,
      expectedSha,
      recoveryRoot: scope.recoveryRoot,
      refSource: { kind: 'pull', number: pullRequestNumber }
    });
  }
  throw new Error(
    `Absent-ref closeout has no verified recovery bundle and no merged PR pull-ref source for ${branch}.`
  );
}

function findMatchingRecoveryBundle(
  scope: BranchCloseoutScope,
  inventory: BranchLifecycleInventory,
  branch: string,
  expectedSha: string
): BranchRecoveryAuthority | null {
  const recoveryRoot = ensureRecoveryRoot(inventory, scope.recoveryRoot);
  const candidates = readdirSync(recoveryRoot)
    .filter((name) => name.startsWith('sec-branch-closeout-') && name.endsWith('.bundle'))
    .map((name) => path.join(recoveryRoot, name));
  for (const candidate of candidates.sort()) {
    try {
      const checksumPath = `${candidate}.sha256`;
      const checksum = readFileSync(checksumPath, 'utf8');
      const digestMatch = /^([0-9a-f]{64})\s+\S+$/u.exec(checksum.trim());
      const digest = createHash('sha256').update(readFileSync(candidate)).digest('hex');
      if (digestMatch === null || digestMatch[1] !== digest) continue;
      const verify = runCloseoutGit(inventory.repository.root, ['bundle', 'verify', candidate]);
      if (verify.status !== 0) continue;
      const headsResult = runCloseoutGit(
        inventory.repository.root,
        ['bundle', 'list-heads', candidate]
      );
      if (headsResult.status !== 0) continue;
      const heads = decodeBranchLifecycleChildStdout(headsResult);
      if (!heads.split(/\r?\n/u).some((line) => line.trim().startsWith(expectedSha))) continue;
      const verifyOutput = [
        verify.stdout.toString('utf8').trim(),
        verify.stderr.toString('utf8').trim()
      ].filter(Boolean).join('\n');
      return {
        kind: 'bundle',
        path: candidate,
        sha256: `sha256:${digest}`,
        verified: true,
        verifyOutput
      };
    } catch {
      continue;
    }
  }
  return null;
}

export function prepareMergedPullRequestCloseout(
  scope: BranchCloseoutScope,
  input: { number: number; headBranch: string; headSha: string }
): PreparedBranchCloseoutEnvelope {
  return prepareBranchCloseout(scope, {
    branch: input.headBranch,
    expectedHeadSha: input.headSha,
    pullRequestNumber: input.number
  });
}

export function loadPreparedBranchCloseoutEnvelope(filePath: string): PreparedBranchCloseoutEnvelope {
  return parsePreparedBranchCloseoutEnvelope(readFileSync(path.resolve(filePath), 'utf8'));
}
