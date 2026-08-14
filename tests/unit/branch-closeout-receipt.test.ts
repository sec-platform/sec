import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  createBranchCloseoutOperationBindingV1,
  createBranchCloseoutOperationReceiptV1,
  createBranchCloseoutPreparation,
  createBranchCloseoutReceipt,
  parseBranchCloseoutOperationReceiptV1
} from '../../scripts/codex/branch-closeout-contract.ts';
import {
  BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME_V1,
  createBranchCloseoutEffectStartPublicationV1,
  createBranchCloseoutOperationPublicationV1,
  createHostedWorkflowCommentProvenanceV1,
  hostedPublisherMatches,
  issueCommentRecord,
  parseBranchCloseoutEffectStartPublicationComment,
  parseBranchCloseoutOperationPublicationComment,
  parsePublishedBranchCloseoutReceiptComment,
  renderBranchCloseoutEffectStartPublicationComment,
  renderBranchCloseoutOperationPublicationComment,
  renderPublishedBranchCloseoutReceiptComment
} from '../../scripts/codex/branch-closeout-receipt.ts';
import { branchLifecycleDigest } from '../../scripts/codex/branch-lifecycle-audit.ts';
import {
  BRANCH_CLOSEOUT_PUBLISHED_RECEIPT_SCHEMA_V1,
  type BranchCloseoutReceiptObservation,
  type BranchLifecycleInventory,
  type BranchPublishedCloseoutReceiptV1
} from '../../scripts/codex/branch-lifecycle-types.ts';
import { SEC_HOSTED_COMMENT_PUBLISHER_POLICY_V1 } from '../../scripts/codex/verification-session-github.ts';

const MAIN_SHA = '1111111111111111111111111111111111111111';
const HEAD_SHA = '2222222222222222222222222222222222222222';
const TREE_SHA = '3333333333333333333333333333333333333333';
const RECOVERY_DIGEST = `sha256:${'b'.repeat(64)}` as const;

function inventory(closeoutReceipt: BranchCloseoutReceiptObservation): BranchLifecycleInventory {
  return {
    schema: 'sec-branch-lifecycle-inventory-v1',
    observedAt: '2026-08-09T00:00:00.000Z',
    repository: {
      root: 'D:\\workspace\\sec',
      commonDir: 'D:\\workspace\\sec\\.git',
      fullName: 'sec-platform/sec',
      remote: 'origin',
      remoteUrl: 'https://github.com/sec-platform/sec.git',
      defaultBranch: 'main'
    },
    main: { localSha: MAIN_SHA, remoteSha: MAIN_SHA },
    localBranches: [{ branch: 'main', sha: MAIN_SHA }],
    remoteBranches: [{ branch: 'main', sha: MAIN_SHA }],
    worktrees: [{
      path: 'D:\\workspace\\sec',
      headSha: MAIN_SHA,
      branch: 'main',
      dirtyCount: 0,
      untrackedCount: 0,
      locked: false,
      prunable: false,
      observation: 'resolved',
      reason: null
    }],
    pullRequests: [{
      number: 42,
      headBranch: 'feat/example',
      headSha: HEAD_SHA,
      baseBranch: 'main',
      baseSha: MAIN_SHA,
      state: 'merged',
      isDraft: false,
      isCrossRepository: false,
      url: 'https://github.com/sec-platform/sec/pull/42',
      publishedCloseoutReceipts: [],
      invalidCloseoutReceiptComments: [],
      closeoutReceipt
    }],
    activeWorkPackage: { state: 'none', branch: null, manifest: null, reason: null },
    repositorySetting: { observation: 'resolved', deleteBranchOnMerge: true, reason: null },
    pruneConfiguration: {
      observation: 'resolved',
      fetchPrune: true,
      remotePrune: true,
      fetchPruneTags: true,
      reason: null
    },
    unknowns: []
  };
}

function operationReceipt(generatedAt = '2026-08-09T00:01:00.000Z', writerId = 'writer-a') {
  const none: BranchCloseoutReceiptObservation = {
    requirement: 'not-required',
    status: 'not-required',
    receipt: null,
    reason: null
  };
  const snapshot = inventory(none);
  const preparation = createBranchCloseoutPreparation({
    preparedAt: '2026-08-09T00:00:00.000Z',
    repository: snapshot.repository,
    branch: 'feat/example',
    refState: 'present',
    expectedHeadSha: HEAD_SHA,
    expectedRemoteSha: HEAD_SHA,
    expectedLocalSha: null,
    expectedPrHeadSha: null,
    pullRequestNumber: 42,
    pullRequestStateAtPreparation: 'open',
    recovery: {
      kind: 'bundle',
      path: 'D:\\recovery\\example.bundle',
      sha256: RECOVERY_DIGEST,
      verified: true,
      verifyOutput: 'ok'
    },
    worktreePathsAtPreparation: []
  });
  const receipt = createBranchCloseoutReceipt({
    generatedAt,
    preparation,
    request: {
      capability: 'branch-ref-closeout-v1',
      disposition: 'merged',
      durableGoal: { kind: 'main', reference: `main@${MAIN_SHA}` }
    },
    authorization: {
      branch: 'feat/example',
      classification: 'merged-closeout',
      remoteAction: 'already-absent',
      localAction: 'already-absent',
      blockers: [],
      protections: []
    },
    attempts: [{ operation: 'readback', status: 'success', detail: 'exact readback' }],
    before: snapshot,
    after: snapshot
  });
  const binding = createBranchCloseoutOperationBindingV1({
    integrationAuthorization: {
      authorizationId: 'authorization-42',
      consumptionOperationId: 'merge-42',
      receiptDigest: `sha256:${'d'.repeat(64)}`,
      repository: 'sec-platform/sec',
      prNumber: 42,
      headSha: HEAD_SHA
    },
    preparation,
    newMainSha: MAIN_SHA,
    newMainTreeSha: TREE_SHA,
    candidateTreeSha: TREE_SHA
  });
  return createBranchCloseoutOperationReceiptV1({
    binding,
    writerId,
    generatedAt,
    remote: { state: 'observed-absent', detailDigest: RECOVERY_DIGEST },
    local: { state: 'observed-absent', detailDigest: RECOVERY_DIGEST },
    prune: { state: 'applied', detailDigest: RECOVERY_DIGEST },
    receipt
  });
}

function provenance() {
  return createHostedWorkflowCommentProvenanceV1({
    repositoryId: '123',
    workflowPath: '.github/workflows/sec-merge-gate.yml',
    workflowRef: `.github/workflows/sec-merge-gate.yml@${MAIN_SHA}`,
    workflowSha: MAIN_SHA,
    runId: '200',
    runAttempt: 1,
    eventName: 'workflow_run',
    sourceRunId: '100',
    sourceRunAttempt: 1,
    actorLogin: 'integrator',
    actorNodeId: 'MDQ6VXNlcjE=',
    actorPermission: 'maintain',
    app: SEC_HOSTED_COMMENT_PUBLISHER_POLICY_V1.app
  });
}

function effectStart(operation = operationReceipt(), commentId = 20) {
  const publication = createBranchCloseoutEffectStartPublicationV1({
    binding: operation.binding,
    authorizationPublication: {
      authorizationPublicationId: `sha256:${'e'.repeat(64)}`,
      publicationDigest: `sha256:${'f'.repeat(64)}`,
      commentId: 19
    },
    recoveryArtifact: {
      artifactId: '300',
      artifactName: 'sec-branch-closeout-recovery-v1-pr-42-run-200-attempt-1',
      artifactDigest: `sha256:${'9'.repeat(64)}`,
      runId: '200',
      runAttempt: 1
    },
    phase: {
      runId: '200',
      runAttempt: 1,
      jobId: '400',
      jobName: 'integrate',
      phase: 'closeoutMutation',
      stepName: BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME_V1,
      stepNumber: 7,
      workflowSha: MAIN_SHA
    },
    provenance: provenance()
  });
  return Object.freeze({ publication, commentId });
}

function actionsComment(id: number, body: string, app: unknown = SEC_HOSTED_COMMENT_PUBLISHER_POLICY_V1.app) {
  return {
    id,
    body,
    user: {
      login: SEC_HOSTED_COMMENT_PUBLISHER_POLICY_V1.bot.login,
      id: SEC_HOSTED_COMMENT_PUBLISHER_POLICY_V1.bot.id,
      node_id: SEC_HOSTED_COMMENT_PUBLISHER_POLICY_V1.bot.nodeId,
      type: SEC_HOSTED_COMMENT_PUBLISHER_POLICY_V1.bot.type
    },
    performed_via_github_app: app === null ? null : {
      id: (app as typeof SEC_HOSTED_COMMENT_PUBLISHER_POLICY_V1.app).id,
      node_id: (app as typeof SEC_HOSTED_COMMENT_PUBLISHER_POLICY_V1.app).nodeId,
      slug: (app as typeof SEC_HOSTED_COMMENT_PUBLISHER_POLICY_V1.app).slug
    }
  };
}

test('legacy published closeout receipt remains a strict read-only round trip', () => {
  const payload: Omit<BranchPublishedCloseoutReceiptV1, 'publicationDigest'> = {
    schema: BRANCH_CLOSEOUT_PUBLISHED_RECEIPT_SCHEMA_V1,
    repository: 'sec-platform/sec',
    pullRequest: 42,
    branch: 'feat/example',
    preparedHeadSha: HEAD_SHA,
    preparationDigest: `sha256:${'a'.repeat(64)}`,
    recoveryDigest: RECOVERY_DIGEST,
    disposition: 'merged',
    durableGoal: { kind: 'main', reference: `main@${MAIN_SHA}` },
    authorization: { remoteAction: 'already-absent', localAction: 'already-absent' },
    attempts: [{
      operation: 'readback',
      status: 'success',
      detailDigest: branchLifecycleDigest({ detail: 'exact terminal readback' })
    }],
    readback: {
      mainRemoteSha: MAIN_SHA,
      remoteBranchSha: null,
      localBranchSha: null,
      boundWorktreeCount: 0,
      unknownCount: 0
    },
    closeoutStatus: 'completed',
    mainSha: MAIN_SHA,
    receiptDigest: `sha256:${'c'.repeat(64)}`
  };
  const value = { ...payload, publicationDigest: branchLifecycleDigest(payload) };
  expect(parsePublishedBranchCloseoutReceiptComment(
    renderPublishedBranchCloseoutReceiptComment(value)
  )).toEqual(value);
});

test('effect-start and terminal comments bind the exact operation and marker', () => {
  const operation = operationReceipt();
  expect(parseBranchCloseoutOperationReceiptV1(
    `${JSON.stringify(operation, null, 2)}\n`
  )).toEqual(operation);
  const start = effectStart(operation);
  expect(parseBranchCloseoutEffectStartPublicationComment(
    renderBranchCloseoutEffectStartPublicationComment(start.publication)
  )).toEqual(start.publication);
  const terminal = createBranchCloseoutOperationPublicationV1(operation, provenance(), start);
  expect(parseBranchCloseoutOperationPublicationComment(
    renderBranchCloseoutOperationPublicationComment(terminal)
  )).toEqual(terminal);
  expect(terminal.effectStart).toEqual({
    effectStartId: start.publication.effectStartId,
    publicationDigest: start.publication.publicationDigest,
    commentId: start.commentId
  });
});

test('terminal publication is stable across host-local writer and generated time', () => {
  const first = operationReceipt('2026-08-09T00:01:00.000Z', 'writer-a');
  const second = operationReceipt('2026-08-09T00:02:00.000Z', 'writer-b');
  const start = effectStart(first);
  const firstPublication = createBranchCloseoutOperationPublicationV1(first, provenance(), start);
  const secondPublication = createBranchCloseoutOperationPublicationV1(second, provenance(), start);
  expect(secondPublication.publicationDigest).toBe(firstPublication.publicationDigest);
  expect(secondPublication.receipt).toEqual(firstPublication.receipt);
});

test('hosted publisher requires the exact non-null Actions bot and App tuple', () => {
  const exact = issueCommentRecord(actionsComment(20, 'body'), 'exact comment');
  const absentApp = issueCommentRecord(actionsComment(21, 'body', null), 'null App comment');
  const wrongApp = issueCommentRecord(actionsComment(22, 'body', {
    ...SEC_HOSTED_COMMENT_PUBLISHER_POLICY_V1.app,
    id: SEC_HOSTED_COMMENT_PUBLISHER_POLICY_V1.app.id + 1
  }), 'wrong App comment');
  const human = issueCommentRecord({
    ...actionsComment(23, 'body'),
    user: { login: 'maintainer', id: 1, node_id: 'U_1', type: 'User' }
  }, 'human comment');
  expect(hostedPublisherMatches(exact)).toBe(true);
  expect(hostedPublisherMatches(absentApp)).toBe(false);
  expect(hostedPublisherMatches(wrongApp)).toBe(false);
  expect(hostedPublisherMatches(human)).toBe(false);
});

test('public modules expose no permit, publisher, finalizer, or runner injection authority', async () => {
  const receiptModule = await import('../../scripts/codex/branch-closeout-receipt.ts');
  const closeoutModule = await import('../../scripts/codex/branch-closeout.ts');
  const barrel = await import('../../scripts/codex/branch-lifecycle.ts');
  for (const name of [
    'publishAndReadBackBranchCloseoutEffectStartV1',
    'publishAndReadBackIntegratedBranchCloseoutReceipt',
    'consumeBranchCloseoutEffectStartPermitV1'
  ]) {
    expect(name in receiptModule).toBe(false);
  }
  for (const name of [
    'finalizeBranchCloseout',
    'finalizeMergedPullRequestCloseout',
    'finalizeIntegratedBranchCloseout'
  ]) {
    expect(name in closeoutModule).toBe(false);
    expect(name in barrel).toBe(false);
  }
  expect('defaultBranchLifecycleCommandRunner' in barrel).toBe(false);
});

test('public branch lifecycle modules cannot mint or invoke arbitrary subprocess effects', async () => {
  const command = await import('../../scripts/codex/branch-lifecycle-command.ts');
  const barrel = await import('../../scripts/codex/branch-lifecycle.ts');
  for (const symbol of [
    'BranchLifecycleContext',
    'createBranchLifecycleContext',
    'BranchLifecycleCommandResult',
    'runBranchCommand',
    'requireBranchCommandText',
    'optionalBranchCommandText'
  ]) {
    expect(symbol in command).toBe(false);
    expect(symbol in barrel).toBe(false);
  }
});

test('physical closeout subprocesses exist only in private VerificationSession transaction', () => {
  const session = readFileSync(path.resolve('scripts/codex/verification-session.ts'), 'utf8');
  const closeout = readFileSync(path.resolve('scripts/codex/branch-closeout.ts'), 'utf8');
  const receipt = readFileSync(path.resolve('scripts/codex/branch-closeout-receipt.ts'), 'utf8');
  const command = readFileSync(path.resolve('scripts/codex/branch-lifecycle-command.ts'), 'utf8');
  expect(session).toContain('function publishHostedCloseoutEffectStartV1');
  expect(session).toContain('function finalizeHostedBranchCloseoutV1');
  expect(session).toContain('function publishHostedCloseoutTerminalV1');
  const sameInvocation = session.slice(
    session.indexOf('async function finalizeSameInvocationCloseoutV1('),
    session.indexOf('function publishHostedCloseoutTerminalV1(')
  );
  expect(sameInvocation.indexOf('publishHostedCloseoutEffectStartV1(input.ctx, effectStart)'))
    .toBeLessThan(sameInvocation.indexOf('finalizeHostedBranchCloseoutV1({'));
  expect(closeout).not.toContain('finalizeIntegratedBranchCloseout');
  expect(closeout).not.toContain("'push',\n    '--porcelain'");
  expect(receipt).not.toContain('export function publishAndReadBack');
  expect(receipt).not.toContain('export function consumeBranchCloseoutEffectStartPermitV1');
  expect(command).not.toContain('export type BranchLifecycleCommandRunner');
  expect(command).not.toContain('export const defaultBranchLifecycleCommandRunner');
});
