import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync
} from 'node:fs';
import path from 'node:path';

import { inspectGitBundleBytes } from '../../../providers/git-bundle/runtime.ts';
import { withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import { GIT_READ_OPERATION_BUDGET } from '../../development/tooling/git/git-read.ts';
import { assertClosedSupersessionEvidence, type ClosedSupersessionEvidence } from './closed-supersession-review.ts';

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
  createMainAbsorptionRecovery,
  createRecoveryBundle,
  ensureRecoveryRoot,
  verifyRecoveryAuthorityLive,
  writeDurableFile
} from './branch-recovery.ts';

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

async function runCloseoutGitRead(repositoryRoot: string, args: readonly string[]) {
  if (args.some((arg) => arg.includes('\0'))) {
    throw new Error('Branch closeout argument contains NUL.');
  }
  return withAuthorityGitReadSession({
    cwd: repositoryRoot,
    budget: GIT_READ_OPERATION_BUDGET,
    environment: createBranchLifecycleGitChildEnvironment(process.env)
  }, async (session) => {
    const command = await session.run(args);
    if (command.kind !== 'completed') throw new Error(command.detail);
    return Object.freeze({
      status: command.result.code,
      stdout: Buffer.from(command.result.stdout),
      stderr: Buffer.from(command.result.stderr, 'utf8')
    });
  });
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
  /** Required only when exact native main absorption cannot prove retention. */
  reviewEvidence?: ClosedSupersessionEvidence;
}

type BranchCloseoutPreparationAdmission =
  | { kind: 'active-work-package' }
  | {
      kind: 'closed-unmerged';
      expectedBaseBranch: string;
      expectedBaseSha: string;
      exactPullRequest: BranchPullRequestObservation;
      reviewEvidence?: ClosedSupersessionEvidence;
    };

async function closedMainAbsorptionBasis(
  repositoryRoot: string,
  sourceSha: string,
  mainSha: string
): Promise<'native-ancestor' | 'identical-tree' | null> {
  const ancestry = await runCloseoutGitRead(repositoryRoot, ['merge-base', '--is-ancestor', sourceSha, mainSha]);
  if (ancestry.status === 0) return 'native-ancestor';
  if (ancestry.status !== 1) {
    throw new Error('Closed-unmerged native main ancestry observation is unavailable.');
  }
  const sourceTree = await runCloseoutGitRead(repositoryRoot, ['rev-parse', '--verify', `${sourceSha}^{tree}`]);
  const mainTree = await runCloseoutGitRead(repositoryRoot, ['rev-parse', '--verify', `${mainSha}^{tree}`]);
  if (sourceTree.status !== 0 || mainTree.status !== 0) {
    throw new Error('Closed-unmerged exact native tree observation is unavailable.');
  }
  const sourceTreeSha = decodeBranchLifecycleChildStdout(sourceTree);
  const mainTreeSha = decodeBranchLifecycleChildStdout(mainTree);
  assertGitSha(sourceTreeSha, 'closed-unmerged source tree');
  assertGitSha(mainTreeSha, 'closed-unmerged main tree');
  return sourceTreeSha === mainTreeSha ? 'identical-tree' : null;
}

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
export async function rehydratePreparedBranchCloseoutRecoveryArtifact(input: {
  scope: BranchCloseoutScope;
  remote: PreparedBranchCloseoutEnvelope;
  recoveryBundleBytes: Uint8Array;
}): Promise<PreparedBranchCloseoutEnvelope> {
  assertPreparedBranchCloseoutEnvelope(input.remote);
  const bytes = Buffer.from(input.recoveryBundleBytes);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (`sha256:${digest}` !== input.remote.preparation.recovery.sha256) {
    throw new Error('Provider recovery bundle digest differs from the authorized preparation.');
  }
  const inventory = await collectBranchLifecycleInventory(input.scope);
  assertBranchCloseoutInventoryResolved(inventory);
  const recoveryRoot = ensureRecoveryRoot(inventory, input.scope.recoveryRoot);
  const bundlePath = path.join(recoveryRoot, `sec-branch-closeout-restored-${digest}.bundle`);
  if (existsSync(bundlePath)) {
    if (!readFileSync(bundlePath).equals(bytes)) {
      throw new Error('Existing restored recovery bundle path contains conflicting bytes.');
    }
  } else {
    writeDurableFile(bundlePath, bytes);
  }
  const checksumText = `${digest}  ${path.basename(bundlePath)}\n`;
  const checksumPath = `${bundlePath}.sha256`;
  if (existsSync(checksumPath)) {
    if (readFileSync(checksumPath, 'utf8') !== checksumText) {
      throw new Error('Existing restored recovery checksum contains conflicting bytes.');
    }
  } else {
    writeDurableFile(checksumPath, checksumText);
  }
  const recovery = {
    ...input.remote.preparation.recovery,
    path: bundlePath,
    sha256: `sha256:${digest}` as const
  };
  const recoveryReadback = await verifyRecoveryAuthorityLive({ inventory, recovery });
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

function persistPreparedEnvelope(envelope: PreparedBranchCloseoutEnvelope): string {
  const filePath = preparationFilePath(envelope.preparation);
  writeDurableFile(filePath, `${JSON.stringify(envelope, null, 2)}\n`);
  return filePath;
}

async function prepareBranchCloseoutInternal(
  scope: BranchCloseoutScope,
  input: PrepareBranchCloseoutInput,
  admission: BranchCloseoutPreparationAdmission
): Promise<PreparedBranchCloseoutEnvelope> {
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

  let before = await collectBranchLifecycleInventory(scope);
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
  // The remote ref and local branch are distinct Git objects. Preserve the
  // observed local preimage independently; authorization will protect it when
  // it differs from the recovered remote head.
  const localSha = local?.sha ?? null;
  const expectedPrHeadSha = refState === 'absent'
    ? (input.expectedPrHeadSha ?? pullRequest?.headSha ?? null)
    : null;

  const mainSha = before.main.remoteSha;
  if (admission.kind === 'closed-unmerged' && mainSha === null) {
    throw new Error('Closed-unmerged main absorption requires one exact remote main SHA.');
  }
  const retentionBasis = admission.kind === 'closed-unmerged'
      && admission.reviewEvidence === undefined
    ? await closedMainAbsorptionBasis(before.repository.root, expectedHeadSha, mainSha!)
    : null;
  if (admission.kind === 'closed-unmerged' && retentionBasis === null
      && admission.reviewEvidence === undefined) {
    throw new Error('Closed-unmerged distinct-tree head requires one exact adopted supersession review.');
  }
  if (admission.kind === 'closed-unmerged' && admission.reviewEvidence !== undefined) {
    assertClosedSupersessionEvidence(admission.reviewEvidence);
  }
  const { recovery, attempts } = admission.kind === 'closed-unmerged'
    ? await createMainAbsorptionRecovery({ inventory: before, branch: input.branch,
        expectedSha: expectedHeadSha, mainSha: mainSha!,
        basis: retentionBasis ?? 'reviewed-supersession', recoveryRoot: scope.recoveryRoot,
        ...(retentionBasis === null ? { reviewEvidence: admission.reviewEvidence } : {}) })
    : refState === 'absent'
      ? await prepareAbsentRefRecovery(scope, before, input.branch, expectedHeadSha, pullRequestNumber)
      : await createRecoveryBundle({
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
  persistPreparedEnvelope(envelope);
  return envelope;
}

export async function prepareBranchCloseout(
  scope: BranchCloseoutScope,
  input: PrepareBranchCloseoutInput
): Promise<PreparedBranchCloseoutEnvelope> {
  return prepareBranchCloseoutInternal(scope, input, { kind: 'active-work-package' });
}

/** Durable preparation only; the operation compiler and provider still own Effect admission. */
export async function prepareClosedUnmergedPullRequestCloseout(
  scope: BranchCloseoutScope,
  input: PrepareClosedUnmergedPullRequestCloseoutInput
): Promise<PreparedBranchCloseoutEnvelope> {
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
    exactPullRequest: input.exactPullRequest,
    ...(input.reviewEvidence === undefined ? {} : { reviewEvidence: input.reviewEvidence })
  });
}

async function prepareAbsentRefRecovery(
  scope: BranchCloseoutScope,
  inventory: BranchLifecycleInventory,
  branch: string,
  expectedSha: string,
  pullRequestNumber: number | null
): Promise<{ recovery: BranchRecoveryAuthority; attempts: BranchCloseoutAttempt[] }> {
  const existing = await findMatchingRecoveryBundle(scope, inventory, branch, expectedSha);
  if (existing !== null) {
    const attempts: BranchCloseoutAttempt[] = [{
      operation: 'recovery-create',
      status: 'success',
      detail: `${existing.path} (reused verified recovery bundle)`
    }];
    const live = await verifyRecoveryAuthorityLive({ inventory, recovery: existing });
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

function safeRecoverySegment(branch: string): string {
  return branch.replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80);
}

async function findMatchingRecoveryBundle(
  scope: BranchCloseoutScope,
  inventory: BranchLifecycleInventory,
  branch: string,
  expectedSha: string
): Promise<BranchRecoveryAuthority | null> {
  const recoveryRoot = ensureRecoveryRoot(inventory, scope.recoveryRoot);
  const prefix = `sec-branch-closeout-${safeRecoverySegment(branch)}-`;
  const candidates = readdirSync(recoveryRoot)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.bundle'))
    .map((name) => path.join(recoveryRoot, name));
  for (const candidate of candidates.sort()) {
    try {
      const checksumPath = `${candidate}.sha256`;
      const checksum = readFileSync(checksumPath, 'utf8');
      const digestMatch = /^([0-9a-f]{64})\s+\S+$/u.exec(checksum.trim());
      const bundleBytes = readFileSync(candidate);
      const digest = createHash('sha256').update(bundleBytes).digest('hex');
      if (digestMatch === null || digestMatch[1] !== digest) continue;
      const inspection = await inspectGitBundleBytes({
        repositoryRoot: inventory.repository.root,
        bytes: bundleBytes
      });
      if (inspection.bundleDigest !== `sha256:${digest}`
          || !inspection.heads.some(({ objectId }) => objectId === expectedSha)) continue;
      const verifyOutput = `git-bundle provider verified ${inspection.heads.length} head(s)`;
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

export async function prepareMergedPullRequestCloseout(
  scope: BranchCloseoutScope,
  input: { number: number; headBranch: string; headSha: string }
): Promise<PreparedBranchCloseoutEnvelope> {
  return prepareBranchCloseout(scope, {
    branch: input.headBranch,
    expectedHeadSha: input.headSha,
    pullRequestNumber: input.number
  });
}

export function loadPreparedBranchCloseoutEnvelope(filePath: string): PreparedBranchCloseoutEnvelope {
  return parsePreparedBranchCloseoutEnvelope(readFileSync(path.resolve(filePath), 'utf8'));
}
