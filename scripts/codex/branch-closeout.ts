import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  commandErrorText,
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
  type BranchLifecycleInventory
} from './branch-lifecycle-contract.ts';
import { collectBranchLifecycleInventory } from './branch-lifecycle-inventory.ts';
import {
  createRecoveryBundle,
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
  expectedHeadSha?: string;
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
  if (input.expectedHeadSha !== undefined) {
    assertGitSha(input.expectedHeadSha, 'expected branch head');
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

  const remote = before.remoteBranches.find(({ branch }) => branch === input.branch);
  if (!remote) throw new Error(`Remote branch ${input.branch} is absent.`);
  if (input.expectedHeadSha !== undefined && remote.sha !== input.expectedHeadSha) {
    throw new Error(
      `Remote branch SHA mismatch: expected ${input.expectedHeadSha}, observed ${remote.sha}.`
    );
  }

  const pullRequestNumber = input.pullRequestNumber ?? null;
  const pullRequest = pullRequestNumber === null
    ? undefined
    : before.pullRequests.find(({ number }) => number === pullRequestNumber);
  if (pullRequestNumber !== null && !pullRequest) {
    throw new Error(`PR #${pullRequestNumber} is absent from inventory.`);
  }
  if (pullRequest) {
    if (pullRequest.headBranch !== input.branch || pullRequest.headSha !== remote.sha) {
      throw new Error(`PR #${pullRequest.number} does not bind the exact remote branch head.`);
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

  const { recovery, attempts } = createRecoveryBundle({
    ctx,
    inventory: before,
    branch: input.branch,
    expectedSha: remote.sha
  });
  const localSha = before.localBranches.find(({ branch }) => branch === input.branch)?.sha ?? null;
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
    expectedHeadSha: remote.sha,
    expectedRemoteSha: remote.sha,
    expectedLocalSha: localSha,
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
