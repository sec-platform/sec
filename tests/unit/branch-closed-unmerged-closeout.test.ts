import { describe, expect, test } from 'bun:test';
import path from 'node:path';

import { createBranchCloseoutPreparation } from '../../src/control/branch-lifecycle/branch-closeout-contract.ts';
import {
  BRANCH_CLOSEOUT_PREPARED_ENVELOPE_SCHEMA,
  type PreparedBranchCloseoutEnvelope
} from '../../src/control/branch-lifecycle/branch-closeout.ts';
import { branchLifecycleDigest } from '../../src/control/branch-lifecycle/branch-lifecycle-audit.ts';
import type {
  BranchLifecycleInventory
} from '../../src/control/branch-lifecycle/branch-lifecycle-types.ts';
import {
  compileClosedUnmergedCloseoutOperation,
  createClosedSupersededDispositionEvidence,
  createEvidenceCloseDispositionEvidence,
  executeClosedUnmergedCloseoutOperation,
  issueClosedUnmergedCloseoutEffectProvider,
  type ClosedUnmergedCloseoutEffectAdapter,
  type ClosedUnmergedCloseoutEffectStartReceipt,
  type ClosedUnmergedProviderMutation,
  type ClosedUnmergedTerminal
} from '../../src/control/branch-lifecycle/closed-unmerged-closeout.ts';

const MAIN_SHA = '1'.repeat(40);
const BASE_SHA = '2'.repeat(40);
const HEAD_SHA = '3'.repeat(40);
const HEAD_TREE = '4'.repeat(40);
const MAIN_TREE = '5'.repeat(40);
const BRANCH = 'codex/closed-unmerged-fixture';
const REPOSITORY = 'sec-platform/sec';
const PR_NUMBER = 570;

function inventory(): BranchLifecycleInventory {
  const root = path.resolve('branch-closeout-fixture');
  return {
    schema: 'sec-branch-lifecycle-inventory-v1',
    observedAt: '2026-09-01T00:00:00.000Z',
    repository: {
      root,
      commonDir: path.join(root, '.git'),
      fullName: REPOSITORY,
      remote: 'origin',
      remoteUrl: `https://github.com/${REPOSITORY}.git`,
      defaultBranch: 'main'
    },
    main: { localSha: MAIN_SHA, remoteSha: MAIN_SHA },
    localBranches: [{ branch: 'main', sha: MAIN_SHA }],
    remoteBranches: [
      { branch: 'main', sha: MAIN_SHA },
      { branch: BRANCH, sha: HEAD_SHA }
    ],
    worktrees: [{
      path: root,
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
      number: PR_NUMBER,
      headBranch: BRANCH,
      headSha: HEAD_SHA,
      baseBranch: 'main',
      baseSha: BASE_SHA,
      state: 'open',
      isDraft: false,
      isCrossRepository: false,
      url: `https://github.com/${REPOSITORY}/pull/${PR_NUMBER}`,
      closeoutReceipt: {
        requirement: 'not-required',
        status: 'not-required',
        receipt: null,
        reason: null
      }
    }],
    activeWorkPackage: { state: 'none', branch: null, manifest: null, reason: null },
    repositorySetting: {
      observation: 'resolved',
      deleteBranchOnMerge: true,
      reason: null
    },
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

function prepared(before: BranchLifecycleInventory): PreparedBranchCloseoutEnvelope {
  const pullRequest = before.pullRequests.find(({ number }) => number === PR_NUMBER)!;
  const remote = before.remoteBranches.find(({ branch }) => branch === BRANCH);
  const local = before.localBranches.find(({ branch }) => branch === BRANCH);
  const preparation = createBranchCloseoutPreparation({
    preparedAt: '2026-09-01T00:01:00.000Z',
    repository: {
      root: before.repository.root,
      commonDir: before.repository.commonDir,
      fullName: before.repository.fullName,
      remote: before.repository.remote,
      defaultBranch: before.repository.defaultBranch
    },
    branch: BRANCH,
    refState: remote ? 'present' : 'absent',
    expectedHeadSha: HEAD_SHA,
    expectedRemoteSha: HEAD_SHA,
    expectedLocalSha: local?.sha ?? null,
    expectedPrHeadSha: remote ? null : HEAD_SHA,
    pullRequestNumber: PR_NUMBER,
    pullRequestStateAtPreparation: pullRequest.state,
    recovery: {
      kind: 'bundle',
      path: path.resolve('branch-closeout-recovery', 'fixture.bundle'),
      sha256: `sha256:${'6'.repeat(64)}`,
      verified: true,
      verifyOutput: 'verified exact fixture recovery'
    },
    worktreePathsAtPreparation: []
  });
  const payload = {
    schema: BRANCH_CLOSEOUT_PREPARED_ENVELOPE_SCHEMA,
    preparation,
    before,
    attempts: [
      { operation: 'recovery-create' as const, status: 'success' as const, detail: 'created' },
      { operation: 'recovery-verify' as const, status: 'success' as const, detail: 'verified' }
    ],
    foreignWorktreeObservations: []
  };
  return { ...payload, envelopeDigest: branchLifecycleDigest(payload) };
}

interface ProviderHarness {
  readonly provider: ReturnType<typeof issueClosedUnmergedCloseoutEffectProvider>;
  readonly counters: {
    closePullRequest: number;
    deleteRemoteRef: number;
    deleteLocalRef: number;
    pruneRemote: number;
    closeIssue: number;
  };
  setCloseResult(value: ClosedUnmergedProviderMutation): void;
  setInventoryUnavailable(detail: string | null): void;
  setBeforeDelete(value: (() => void) | null): void;
  setAfterClose(value: (() => void) | null): void;
  setTerminal(operationId: string, value: ClosedUnmergedTerminal): void;
  terminal(operationId: string): ClosedUnmergedTerminal | undefined;
  mutate(mutator: (value: BranchLifecycleInventory) => void): void;
}

function providerHarness(initial: BranchLifecycleInventory): ProviderHarness {
  let current = structuredClone(initial);
  let closeResult: ClosedUnmergedProviderMutation = {
    status: 'applied',
    detail: 'exact PR closed'
  };
  let beforeDelete: (() => void) | null = null;
  let afterClose: (() => void) | null = null;
  let inventoryUnavailable: string | null = null;
  const effectStarts = new Map<string, ClosedUnmergedCloseoutEffectStartReceipt>();
  const terminalReceipts = new Map<string, ClosedUnmergedTerminal>();
  const counters = { closePullRequest: 0, deleteRemoteRef: 0,
    deleteLocalRef: 0, pruneRemote: 0, closeIssue: 0 };
  const adapter: ClosedUnmergedCloseoutEffectAdapter = {
    providerIdentity: 'fixture-github-and-git-provider',
    repository: REPOSITORY,
    async observeInventory() {
      if (inventoryUnavailable !== null) {
        return { status: 'unavailable', detail: inventoryUnavailable };
      }
      return { status: 'observed', value: structuredClone(current) };
    },
    async observeEffectStart(operationId) {
      return { status: 'observed', value: effectStarts.get(operationId) ?? null };
    },
    async publishEffectStart(receipt) {
      const existing = effectStarts.get(receipt.operationId);
      if (existing && existing.receiptDigest !== receipt.receiptDigest) {
        return { status: 'rejected', detail: 'conflicting effect-start' };
      }
      effectStarts.set(receipt.operationId, receipt);
      return { status: existing ? 'already-applied' : 'applied', detail: 'effect-start durable' };
    },
    async closePullRequest(input) {
      counters.closePullRequest += 1;
      if (closeResult.status === 'applied' || closeResult.status === 'already-applied') {
        const pullRequest = current.pullRequests.find(({ number }) => number === input.pullRequestNumber);
        if (!pullRequest
          || pullRequest.headBranch !== input.expectedHeadBranch
          || pullRequest.headSha !== input.expectedHeadSha
          || pullRequest.baseBranch !== input.expectedBaseBranch
          || pullRequest.baseSha !== input.expectedBaseSha) {
          return { status: 'rejected', detail: 'exact PR identity changed' };
        }
        pullRequest.state = 'closed';
        afterClose?.();
        afterClose = null;
      }
      return closeResult;
    },
    async deleteRemoteRefCas(input) {
      counters.deleteRemoteRef += 1;
      beforeDelete?.();
      beforeDelete = null;
      const target = current.remoteBranches.find(({ branch }) => branch === input.branch);
      if (!target) return { status: 'already-applied', detail: 'remote branch already absent' };
      if (target.sha !== input.expectedOldSha) {
        return { status: 'rejected', detail: 'remote CAS mismatch' };
      }
      current.remoteBranches = current.remoteBranches.filter(({ branch }) => branch !== input.branch);
      return { status: 'applied', detail: 'exact remote branch deleted' };
    },
    async deleteLocalRefCas(input) {
      counters.deleteLocalRef += 1;
      const target = current.localBranches.find(({ branch }) => branch === input.branch);
      if (!target) return { status: 'already-applied', detail: 'local branch already absent' };
      if (target.sha !== input.expectedOldSha) {
        return { status: 'rejected', detail: 'local CAS mismatch' };
      }
      current.localBranches = current.localBranches.filter(({ branch }) => branch !== input.branch);
      return { status: 'applied', detail: 'exact local branch deleted' };
    },
    async pruneRemote(input) {
      counters.pruneRemote += 1;
      if (input.branch !== BRANCH || input.expectedOldSha !== HEAD_SHA) {
        return { status: 'rejected', detail: 'prune identity mismatch' };
      }
      return { status: 'applied', detail: 'remote tracking refs pruned' };
    },
    async observeTerminalReceipt(operationId) {
      return { status: 'observed', value: terminalReceipts.get(operationId) ?? null };
    },
    async publishTerminalReceipt(terminal) {
      const existing = terminalReceipts.get(terminal.operationId);
      if (existing && existing.receipt.publicationDigest !== terminal.receipt.publicationDigest) {
        return { status: 'rejected', detail: 'conflicting terminal receipt' };
      }
      terminalReceipts.set(terminal.operationId, terminal);
      return { status: existing ? 'already-applied' : 'applied', detail: 'terminal receipt durable' };
    }
  };
  return {
    provider: issueClosedUnmergedCloseoutEffectProvider(adapter),
    counters,
    setCloseResult(value) { closeResult = value; },
    setInventoryUnavailable(detail) { inventoryUnavailable = detail; },
    setBeforeDelete(value) { beforeDelete = value; },
    setAfterClose(value) { afterClose = value; },
    setTerminal(operationId, value) { terminalReceipts.set(operationId, value); },
    terminal(operationId) { return terminalReceipts.get(operationId); },
    mutate(mutator) { mutator(current); }
  };
}

function evidenceClose(_before: BranchLifecycleInventory) {
  return createEvidenceCloseDispositionEvidence({
    repository: REPOSITORY,
    pullRequestNumber: PR_NUMBER,
    branch: BRANCH,
    headSha: HEAD_SHA,
    headTreeSha: HEAD_TREE,
    baseBranch: 'main',
    baseSha: BASE_SHA,
    currentMainSha: MAIN_SHA,
    currentMainTreeSha: HEAD_TREE,
    durableGoal: { kind: 'evidence', reference: 'exact-tree-parity-readback' }
  });
}

function fakeSupersededEvidence() {
  return createClosedSupersededDispositionEvidence({
    repository: REPOSITORY,
    pullRequestNumber: PR_NUMBER,
    branch: BRANCH,
    headSha: HEAD_SHA,
    headTreeSha: HEAD_TREE,
    baseBranch: 'main',
    baseSha: BASE_SHA,
    currentMainSha: MAIN_SHA,
    currentMainTreeSha: MAIN_TREE,
    durableGoal: { kind: 'issue', reference: 'Issue #313' },
    supersession: {
      review: {
        kind: 'branch-supersession-review', repository: REPOSITORY,
        pullRequestNumber: PR_NUMBER, headSha: HEAD_SHA, headTreeSha: HEAD_TREE,
        currentMainSha: MAIN_SHA, currentMainTreeSha: MAIN_TREE,
        reviewer: 'fixture-reviewer', verdict: 'approved', paths: [], unknowns: []
      },
      reference: `https://github.com/${REPOSITORY}/pull/${PR_NUMBER}#issuecomment-1`,
      author: 'fixture-maintainer', commentId: 1,
      receiptDigest: `sha256:${'7'.repeat(64)}`
    }
  });
}

function operation(inputEvidence: ReturnType<typeof evidenceClose>) {
  const result = compileClosedUnmergedCloseoutOperation({
    prepared: prepared(inventory()),
    evidence: inputEvidence
  });
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error(result.blockers.join(' | '));
  return result.operation;
}

describe('closed-unmerged branch lifecycle operation', () => {
  test('evidence-close closes the exact PR and deletes only exact refs', async () => {
    const closeout = operation(evidenceClose(inventory()));
    const harness = providerHarness(inventory());
    const result = await executeClosedUnmergedCloseoutOperation({
      operation: closeout,
      provider: harness.provider
    });

    expect(result.status).toBe('completed');
    expect(harness.counters).toEqual({
      closePullRequest: 1,
      deleteRemoteRef: 1,
      deleteLocalRef: 0,
      pruneRemote: 1,
      closeIssue: 0
    });
    if (result.status === 'completed') {
      expect(result.receipt.branch).toBe(BRANCH);
      expect(result.receipt.pullRequest).toBe(PR_NUMBER);
      expect(result.receipt.disposition).toBe('closed-superseded');
    }
  });

  test('structurally plausible supersession evidence is rejected without owner issuance', () => {
    expect(() => fakeSupersededEvidence()).toThrow(
      'Supersession evidence requires authenticated owner observation.'
    );
  });

  test('head drift blocks before effect-start, PR close, or remote deletion', async () => {
    const closeout = operation(evidenceClose(inventory()));
    const harness = providerHarness(inventory());
    harness.mutate((value) => {
      value.remoteBranches = value.remoteBranches.map((entry) => (
        entry.branch === BRANCH ? { ...entry, sha: '8'.repeat(40) } : entry
      ));
    });

    const result = await executeClosedUnmergedCloseoutOperation({
      operation: closeout,
      provider: harness.provider
    });

    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' ? result.reasons : []).toContain('remote branch SHA changed');
    expect(harness.counters.closePullRequest).toBe(0);
    expect(harness.counters.deleteRemoteRef).toBe(0);
  });

  test('remote CAS drift after PR close preserves the exact branch', async () => {
    const closeout = operation(evidenceClose(inventory()));
    const harness = providerHarness(inventory());
    harness.setBeforeDelete(() => {
      harness.mutate((value) => {
        value.remoteBranches = value.remoteBranches.map((entry) => (
          entry.branch === BRANCH ? { ...entry, sha: '8'.repeat(40) } : entry
        ));
      });
    });

    const result = await executeClosedUnmergedCloseoutOperation({
      operation: closeout,
      provider: harness.provider
    });

    expect(result.status).toBe('preserved');
    expect(result.status === 'preserved' ? result.stage : null).toBe('remote-delete');
    expect(harness.counters.deleteRemoteRef).toBe(1);
    expect(harness.counters.closeIssue).toBe(0);
  });

  test('late drift after PR close is caught before either ref deletion', async () => {
    const closeout = operation(evidenceClose(inventory()));
    const harness = providerHarness(inventory());
    harness.setAfterClose(() => {
      harness.mutate((value) => {
        value.remoteBranches = value.remoteBranches.map((entry) => (
          entry.branch === BRANCH ? { ...entry, sha: '8'.repeat(40) } : entry
        ));
      });
    });

    const result = await executeClosedUnmergedCloseoutOperation({
      operation: closeout,
      provider: harness.provider
    });

    expect(result.status).toBe('blocked');
    expect(harness.counters.deleteRemoteRef).toBe(0);
    expect(harness.counters.deleteLocalRef).toBe(0);
  });

  test('an exact prepared local ref is deleted by local CAS and read back absent', async () => {
    const before = inventory();
    before.localBranches.push({ branch: BRANCH, sha: HEAD_SHA });
    const result = compileClosedUnmergedCloseoutOperation({
      prepared: prepared(before),
      evidence: evidenceClose(before)
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error(result.blockers.join(' | '));
    const harness = providerHarness(before);

    const executed = await executeClosedUnmergedCloseoutOperation({
      operation: result.operation,
      provider: harness.provider
    });

    expect(executed.status).toBe('completed');
    expect(harness.counters.deleteLocalRef).toBe(1);
  });

  test('an already closed exact PR is accepted as the operation starting point', async () => {
    const before = inventory();
    before.pullRequests[0]!.state = 'closed';
    const result = compileClosedUnmergedCloseoutOperation({
      prepared: prepared(before), evidence: evidenceClose(before)
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error(result.blockers.join(' | '));
    const harness = providerHarness(before);
    const executed = await executeClosedUnmergedCloseoutOperation({
      operation: result.operation, provider: harness.provider
    });
    expect(executed.status).toBe('completed');
    expect(harness.counters.closePullRequest).toBe(0);
    expect(harness.counters.deleteRemoteRef).toBe(1);
  });

  test('a closed exact PR with an already absent remote ref resumes from recovery', async () => {
    const before = inventory();
    before.pullRequests[0]!.state = 'closed';
    before.remoteBranches = before.remoteBranches.filter(({ branch }) => branch !== BRANCH);
    const result = compileClosedUnmergedCloseoutOperation({
      prepared: prepared(before), evidence: evidenceClose(before)
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error(result.blockers.join(' | '));
    const harness = providerHarness(before);
    const executed = await executeClosedUnmergedCloseoutOperation({
      operation: result.operation, provider: harness.provider
    });
    expect(executed.status).toBe('completed');
    expect(harness.counters.closePullRequest).toBe(0);
    expect(harness.counters.deleteRemoteRef).toBe(0);
  });

  test('PR identity mutation blocks before closing or deleting anything', async () => {
    const closeout = operation(evidenceClose(inventory()));
    const harness = providerHarness(inventory());
    harness.mutate((value) => {
      value.pullRequests[0]!.baseSha = '9'.repeat(40);
    });

    const result = await executeClosedUnmergedCloseoutOperation({
      operation: closeout,
      provider: harness.provider
    });

    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' ? result.reasons : []).toContain(
      'pull request base identity changed'
    );
    expect(harness.counters.closePullRequest).toBe(0);
    expect(harness.counters.deleteRemoteRef).toBe(0);
  });

  test('provider unavailability preserves preparation and performs no Effect', async () => {
    const closeout = operation(evidenceClose(inventory()));
    const harness = providerHarness(inventory());
    harness.setInventoryUnavailable('provider session unavailable');

    const result = await executeClosedUnmergedCloseoutOperation({
      operation: closeout,
      provider: harness.provider
    });

    expect(result.status).toBe('preserved');
    expect(result.status === 'preserved' ? result.stage : null).toBe('effect-start-precondition');
    expect(harness.counters).toEqual({ closePullRequest: 0, deleteRemoteRef: 0,
      deleteLocalRef: 0, pruneRemote: 0, closeIssue: 0 });
  });

  test('ambiguous PR close preserves the branch and retry can finish from exact readback', async () => {
    const closeout = operation(evidenceClose(inventory()));
    const harness = providerHarness(inventory());
    harness.setCloseResult({ status: 'ambiguous', detail: 'provider settlement unknown' });

    const first = await executeClosedUnmergedCloseoutOperation({
      operation: closeout,
      provider: harness.provider
    });
    expect(first.status).toBe('preserved');
    expect(first.status === 'preserved' ? first.stage : null).toBe('pull-request-close');
    expect(harness.counters.deleteRemoteRef).toBe(0);

    harness.setCloseResult({ status: 'applied', detail: 'exact PR closed on retry' });
    const second = await executeClosedUnmergedCloseoutOperation({
      operation: closeout,
      provider: harness.provider
    });
    expect(second.status).toBe('completed');
    expect(harness.counters.closeIssue).toBe(0);
  });

  test('already closed PR and absent branch resume from durable effect-start readback', async () => {
    const closeout = operation(evidenceClose(inventory()));
    const harness = providerHarness(inventory());
    harness.setCloseResult({ status: 'ambiguous', detail: 'effect settlement unknown' });
    const first = await executeClosedUnmergedCloseoutOperation({
      operation: closeout,
      provider: harness.provider
    });
    expect(first.status).toBe('preserved');

    harness.mutate((value) => {
      const pullRequest = value.pullRequests.find(({ number }) => number === PR_NUMBER)!;
      pullRequest.state = 'closed';
      value.remoteBranches = value.remoteBranches.filter(({ branch }) => branch !== BRANCH);
    });
    const resumed = await executeClosedUnmergedCloseoutOperation({
      operation: closeout,
      provider: harness.provider
    });

    expect(resumed.status).toBe('completed');
    expect(harness.counters.deleteRemoteRef).toBe(0);
    expect(harness.counters.closeIssue).toBe(0);
  });

  test('terminal readback with a different evidence digest is rejected', async () => {
    const closeout = operation(evidenceClose(inventory()));
    const completedHarness = providerHarness(inventory());
    const completed = await executeClosedUnmergedCloseoutOperation({
      operation: closeout, provider: completedHarness.provider
    });
    expect(completed.status).toBe('completed');
    const terminal = completedHarness.terminal(closeout.operationId)!;
    const harness = providerHarness(inventory());
    harness.setTerminal(closeout.operationId, {
      ...terminal, evidenceDigest: `sha256:${'9'.repeat(64)}`
    });

    const replay = await executeClosedUnmergedCloseoutOperation({
      operation: closeout, provider: harness.provider
    });

    expect(replay.status).toBe('blocked');
    expect(replay.status === 'blocked' ? replay.stage : null).toBe('terminal-readback');
    expect(harness.counters.deleteRemoteRef).toBe(0);
    expect(harness.counters.deleteLocalRef).toBe(0);
  });

  test('terminal recovery refuses a recreated remote ref without performing any mutation', async () => {
    const closeout = operation(evidenceClose(inventory()));
    const completedHarness = providerHarness(inventory());
    const completed = await executeClosedUnmergedCloseoutOperation({
      operation: closeout, provider: completedHarness.provider
    });
    expect(completed.status).toBe('completed');
    const terminal = completedHarness.terminal(closeout.operationId)!;
    const recreated = inventory();
    recreated.pullRequests[0]!.state = 'closed';
    const harness = providerHarness(recreated);
    harness.setTerminal(closeout.operationId, terminal);

    const replay = await executeClosedUnmergedCloseoutOperation({
      operation: closeout, provider: harness.provider
    });

    expect(replay.status).toBe('preserved');
    expect(replay.status === 'preserved' ? replay.stage : null).toBe('terminal-live-readback');
    expect(replay.status === 'preserved' ? replay.reasons : []).toEqual([
      'remote branch exists after the terminal receipt'
    ]);
    expect(harness.counters).toEqual({ closePullRequest: 0, deleteRemoteRef: 0,
      deleteLocalRef: 0, pruneRemote: 0, closeIssue: 0 });
  });
});
