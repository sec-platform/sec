import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  commandErrorText,
  requireBranchCommandText,
  runBranchCommand,
  type BranchLifecycleContext
} from './branch-lifecycle-command.ts';
import {
  BRANCH_REF_CLOSEOUT_CAPABILITY_V1,
  assertGitBranchName,
  assertGitSha,
  auditBranchLifecycle,
  authorizeBranchCloseout,
  branchLifecycleDigest,
  createBranchCloseoutPreparation,
  createBranchCloseoutReceipt,
  type BranchCloseoutAttempt,
  type BranchCloseoutDisposition,
  type BranchCloseoutPreparation,
  type BranchCloseoutReceipt,
  type BranchLifecycleInventory,
  type BranchRecoveryAuthority
} from './branch-lifecycle-contract.ts';
import { collectBranchLifecycleInventory } from './branch-lifecycle-inventory.ts';
import {
  createRecoveryBundle,
  ensureRecoveryRoot,
  verifyRecoveryAuthorityLive,
  writeDurableFile
} from './branch-recovery.ts';

export const BRANCH_CLOSEOUT_PREPARED_ENVELOPE_SCHEMA_V1 =
  'sec-branch-closeout-prepared-envelope-v1' as const;

export interface PreparedBranchCloseoutEnvelope {
  schema: typeof BRANCH_CLOSEOUT_PREPARED_ENVELOPE_SCHEMA_V1;
  preparation: BranchCloseoutPreparation;
  before: BranchLifecycleInventory;
  attempts: BranchCloseoutAttempt[];
  envelopeDigest: `sha256:${string}`;
}

export interface PrepareBranchCloseoutInput {
  branch: string;
  /**
   * `present` (default) binds an existing remote ref. `absent` settles a ref
   * that is already gone while its exact head is durably covered by a verified
   * recovery bundle or (merged PR) pull-ref recovery.
   */
  refState?: 'present' | 'absent';
  expectedHeadSha?: string;
  /** Exact PR-recorded head SHA when it differs from the prepared ref head. */
  expectedPrHeadSha?: string | null;
  pullRequestNumber?: number | null;
}

export interface FinalizeBranchCloseoutInput {
  prepared: PreparedBranchCloseoutEnvelope;
  disposition: BranchCloseoutDisposition;
  blockingReasons?: readonly string[];
  durableGoal: {
    kind: 'main' | 'issue' | 'evidence';
    reference: string;
  };
}

function createPreparedEnvelope(input: Omit<
  PreparedBranchCloseoutEnvelope,
  'schema' | 'envelopeDigest'
>): PreparedBranchCloseoutEnvelope {
  const withoutDigest = {
    schema: BRANCH_CLOSEOUT_PREPARED_ENVELOPE_SCHEMA_V1,
    ...input
  };
  return {
    ...withoutDigest,
    envelopeDigest: branchLifecycleDigest(withoutDigest)
  };
}

function assertPreparedBranchCloseoutEnvelope(
  envelope: PreparedBranchCloseoutEnvelope
): void {
  if (envelope.schema !== BRANCH_CLOSEOUT_PREPARED_ENVELOPE_SCHEMA_V1) {
    throw new Error('Prepared branch closeout envelope schema mismatch.');
  }
  const { envelopeDigest, ...withoutDigest } = envelope;
  if (branchLifecycleDigest(withoutDigest) !== envelopeDigest) {
    throw new Error('Prepared branch closeout envelope digest mismatch.');
  }
}

export function parsePreparedBranchCloseoutEnvelope(
  source: string
): PreparedBranchCloseoutEnvelope {
  const parsed: unknown = JSON.parse(source);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Prepared branch closeout envelope must be an object.');
  }
  const envelope = parsed as PreparedBranchCloseoutEnvelope;
  assertPreparedBranchCloseoutEnvelope(envelope);
  return envelope;
}

export function preparationFilePath(preparation: BranchCloseoutPreparation): string {
  return `${preparation.recovery.path}.preparation.json`;
}

export function receiptFilePath(preparation: BranchCloseoutPreparation): string {
  return `${preparation.recovery.path}.receipt.json`;
}

function persistPreparedEnvelope(envelope: PreparedBranchCloseoutEnvelope): string {
  const filePath = preparationFilePath(envelope.preparation);
  writeDurableFile(filePath, `${JSON.stringify(envelope, null, 2)}\n`);
  return filePath;
}

function persistReceipt(receipt: BranchCloseoutReceipt): string {
  const filePath = receiptFilePath(receipt.preparation);
  writeDurableFile(filePath, `${JSON.stringify(receipt, null, 2)}\n`);
  return filePath;
}

export function prepareBranchCloseout(
  ctx: BranchLifecycleContext,
  input: PrepareBranchCloseoutInput
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

  const before = collectBranchLifecycleInventory(ctx);
  const beforeAudit = auditBranchLifecycle(before);
  if (beforeAudit.status === 'blocked') {
    throw new Error(
      `Branch lifecycle is not closeout-ready (unknown facts block): ${beforeAudit.findings
        .filter(({ severity }) => severity === 'error')
        .map(({ code, branch, message }) => `${code}${branch ? `(${branch})` : ''}: ${message}`)
        .join(' | ')}`
    );
  }
  if (input.branch === before.repository.defaultBranch) {
    throw new Error('Default branch cannot be prepared for closeout.');
  }

  if (refState === 'absent') {
    if (before.remoteBranches.some(({ branch }) => branch === input.branch)) {
      throw new Error(`Absent-ref preparation observed surviving remote branch ${input.branch}.`);
    }
    if (before.localBranches.some(({ branch }) => branch === input.branch)) {
      throw new Error(`Absent-ref preparation observed surviving local branch ${input.branch}.`);
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
  const localSha = refState === 'absent' ? null : local?.sha ?? null;
  const expectedPrHeadSha = refState === 'absent'
    ? (input.expectedPrHeadSha ?? pullRequest?.headSha ?? null)
    : null;

  const { recovery, attempts } = refState === 'absent'
    ? prepareAbsentRefRecovery(ctx, before, input.branch, expectedHeadSha, pullRequestNumber)
    : createRecoveryBundle({
        ctx,
        inventory: before,
        branch: input.branch,
        expectedSha: expectedHeadSha
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
  const envelope = createPreparedEnvelope({ preparation, before, attempts });
  persistPreparedEnvelope(envelope);
  return envelope;
}

function prepareAbsentRefRecovery(
  ctx: BranchLifecycleContext,
  inventory: BranchLifecycleInventory,
  branch: string,
  expectedSha: string,
  pullRequestNumber: number | null
): { recovery: BranchRecoveryAuthority; attempts: BranchCloseoutAttempt[] } {
  const existing = findMatchingRecoveryBundle(ctx, inventory, branch, expectedSha);
  if (existing !== null) {
    const attempts: BranchCloseoutAttempt[] = [{
      operation: 'recovery-create',
      status: 'success',
      detail: `${existing.path} (reused verified recovery bundle)`
    }];
    const live = verifyRecoveryAuthorityLive({ ctx, inventory, recovery: existing });
    attempts.push(live);
    if (live.status !== 'success') {
      throw new Error(`Reused recovery bundle failed live revalidation: ${live.detail}`);
    }
    return { recovery: existing, attempts };
  }
  if (pullRequestNumber !== null) {
    return createRecoveryBundle({
      ctx,
      inventory,
      branch,
      expectedSha,
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

function findMatchingRecoveryBundle(
  ctx: BranchLifecycleContext,
  inventory: BranchLifecycleInventory,
  branch: string,
  expectedSha: string
): BranchRecoveryAuthority | null {
  const recoveryRoot = ensureRecoveryRoot(inventory, ctx.recoveryRoot);
  const prefix = `sec-branch-closeout-${safeRecoverySegment(branch)}-`;
  const candidates = readdirSync(recoveryRoot)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.bundle'))
    .map((name) => path.join(recoveryRoot, name));
  for (const candidate of candidates.sort()) {
    try {
      const checksumPath = `${candidate}.sha256`;
      const checksum = readFileSync(checksumPath, 'utf8');
      const digestMatch = /^([0-9a-f]{64})\s+\S+$/u.exec(checksum.trim());
      const digest = createHash('sha256').update(readFileSync(candidate)).digest('hex');
      if (digestMatch === null || digestMatch[1] !== digest) continue;
      const verify = runBranchCommand(
        ctx,
        'git',
        ['bundle', 'verify', candidate],
        inventory.repository.root
      );
      if (verify.status !== 0) continue;
      const heads = requireBranchCommandText(
        ctx,
        'git',
        ['bundle', 'list-heads', candidate],
        'recovery bundle head inventory',
        inventory.repository.root
      );
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
  ctx: BranchLifecycleContext,
  input: { number: number; headBranch: string; headSha: string }
): PreparedBranchCloseoutEnvelope {
  return prepareBranchCloseout(ctx, {
    branch: input.headBranch,
    expectedHeadSha: input.headSha,
    pullRequestNumber: input.number
  });
}

function attempt(
  attempts: BranchCloseoutAttempt[],
  operation: BranchCloseoutAttempt['operation'],
  status: BranchCloseoutAttempt['status'],
  detail: string
): void {
  attempts.push({ operation, status, detail });
}

function deleteRemoteRefCas(
  ctx: BranchLifecycleContext,
  preparation: BranchCloseoutPreparation,
  attempts: BranchCloseoutAttempt[]
): void {
  const result = runBranchCommand(ctx, 'git', [
    'push',
    '--porcelain',
    `--force-with-lease=refs/heads/${preparation.branch}:${preparation.expectedRemoteSha}`,
    preparation.repository.remote,
    `:refs/heads/${preparation.branch}`
  ], preparation.repository.root);
  attempt(
    attempts,
    'remote-delete',
    result.status === 0 ? 'success' : 'failed',
    result.status === 0
      ? `deleted refs/heads/${preparation.branch} at expected ${preparation.expectedRemoteSha}`
      : commandErrorText(result)
  );
}

function deleteLocalRefCas(
  ctx: BranchLifecycleContext,
  preparation: BranchCloseoutPreparation,
  attempts: BranchCloseoutAttempt[]
): void {
  const expected = preparation.expectedLocalSha ?? preparation.expectedHeadSha;
  const result = runBranchCommand(ctx, 'git', [
    'update-ref',
    '-d',
    `refs/heads/${preparation.branch}`,
    expected
  ], preparation.repository.root);
  attempt(
    attempts,
    'local-delete',
    result.status === 0 ? 'success' : 'failed',
    result.status === 0
      ? `deleted refs/heads/${preparation.branch} at expected ${expected}`
      : commandErrorText(result)
  );
}

function pruneRemote(
  ctx: BranchLifecycleContext,
  preparation: BranchCloseoutPreparation,
  attempts: BranchCloseoutAttempt[]
): void {
  const result = runBranchCommand(ctx, 'git', [
    'remote',
    'prune',
    preparation.repository.remote
  ], preparation.repository.root);
  attempt(
    attempts,
    'prune',
    result.status === 0 ? 'success' : 'failed',
    result.status === 0 ? `pruned ${preparation.repository.remote}` : commandErrorText(result)
  );
}

export function finalizeBranchCloseout(
  ctx: BranchLifecycleContext,
  input: FinalizeBranchCloseoutInput
): BranchCloseoutReceipt {
  assertPreparedBranchCloseoutEnvelope(input.prepared);
  const observedCurrent = collectBranchLifecycleInventory(ctx);
  const attempts = [...input.prepared.attempts];
  const recoveryReadback = verifyRecoveryAuthorityLive({
    ctx,
    inventory: observedCurrent,
    recovery: input.prepared.preparation.recovery
  });
  attempts.push(recoveryReadback);
  const current = {
    ...observedCurrent,
    unknowns: [...new Set([
      ...observedCurrent.unknowns,
      ...(input.blockingReasons ?? []),
      ...(recoveryReadback.status === 'success' ? [] : [recoveryReadback.detail])
    ])].sort((left, right) => left.localeCompare(right))
  };
  const request = {
    capability: BRANCH_REF_CLOSEOUT_CAPABILITY_V1,
    disposition: input.disposition,
    durableGoal: input.durableGoal
  } as const;
  const authorization = authorizeBranchCloseout({
    preparation: input.prepared.preparation,
    request,
    before: input.prepared.before,
    current
  });

  if (authorization.blockers.length === 0) {
    if (authorization.remoteAction === 'delete-cas') {
      deleteRemoteRefCas(ctx, input.prepared.preparation, attempts);
    } else {
      attempt(attempts, 'remote-delete', 'skipped', authorization.remoteAction);
    }

    if (authorization.localAction === 'delete-exact') {
      deleteLocalRefCas(ctx, input.prepared.preparation, attempts);
    } else {
      attempt(attempts, 'local-delete', 'skipped', authorization.localAction);
    }

    pruneRemote(ctx, input.prepared.preparation, attempts);
  } else {
    attempt(
      attempts,
      'remote-delete',
      'skipped',
      `blocked: ${authorization.blockers.join(' | ')}`
    );
    attempt(
      attempts,
      'local-delete',
      'skipped',
      `blocked: ${authorization.blockers.join(' | ')}`
    );
    attempt(attempts, 'prune', 'skipped', 'closeout authorization blocked');
  }

  const after = collectBranchLifecycleInventory(ctx);
  attempt(
    attempts,
    'readback',
    after.unknowns.length === 0 ? 'success' : 'failed',
    after.unknowns.length === 0
      ? `remote/local/PR/worktree readback completed at ${after.observedAt}`
      : after.unknowns.join(' | ')
  );

  const receipt = createBranchCloseoutReceipt({
    generatedAt: new Date().toISOString(),
    preparation: input.prepared.preparation,
    request,
    authorization,
    attempts,
    before: input.prepared.before,
    after
  });
  persistReceipt(receipt);
  return receipt;
}

export function finalizeMergedPullRequestCloseout(
  ctx: BranchLifecycleContext,
  prepared: PreparedBranchCloseoutEnvelope,
  newMainSha: string,
  blockingReasons: readonly string[] = []
): BranchCloseoutReceipt {
  assertGitSha(newMainSha, 'new main SHA');
  return finalizeBranchCloseout(ctx, {
    prepared,
    disposition: 'merged',
    blockingReasons,
    durableGoal: {
      kind: 'main',
      reference: `main@${newMainSha}`
    }
  });
}

export function loadPreparedBranchCloseoutEnvelope(filePath: string): PreparedBranchCloseoutEnvelope {
  return parsePreparedBranchCloseoutEnvelope(readFileSync(path.resolve(filePath), 'utf8'));
}
