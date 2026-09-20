import { describe, expect, test } from 'bun:test';
import path from 'node:path';

import { createBranchCloseoutPreparation } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-closeout-contract.ts';
import {
  BRANCH_CLOSEOUT_PREPARED_ENVELOPE_SCHEMA,
  type PreparedBranchCloseoutEnvelope
} from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-closeout.ts';
import { branchLifecycleDigest } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-audit.ts';
import type {
  BranchLifecycleInventory,
  BranchPublishedCloseoutReceipt
} from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-types.ts';
import {
  compileClosedUnmergedCloseoutOperation,
  createClosedSupersededDispositionEvidence,
  createEvidenceCloseDispositionEvidence,
  executeClosedUnmergedCloseoutOperation,
  issueClosedUnmergedCloseoutEffectProvider,
  type ClosedUnmergedCloseoutEffectAdapter,
  type ClosedUnmergedCloseoutEffectStartReceipt,
  type ClosedUnmergedProviderMutation
} from '../../src/adapters/self-hosting/control/branch-lifecycle/closed-unmerged-closeout.ts';

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
    refState: 'present',
    expectedHeadSha: HEAD_SHA,
    expectedRemoteSha: HEAD_SHA,
    expectedLocalSha: null,
    expectedPrHeadSha: null,
    pullRequestNumber: PR_NUMBER,
    pullRequestStateAtPreparation: 'open',
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
    closeIssue: number;
  };
  setCloseResult(value: ClosedUnmergedProviderMutation): void;
  setInventoryUnavailable(detail: string | null): void;
  setBeforeDelete(value: (() => void) | null): void;
  mutate(mutator: (value: BranchLifecycleInventory) => void): void;
}

function providerHarness(initial: BranchLifecycleInventory): ProviderHarness {
  let current = structuredClone(initial);
  let closeResult: ClosedUnmergedProviderMutation = {
    status: 'applied',
    detail: 'exact PR closed'
  };
  let beforeDelete: (() => void) | null = null;
  let inventoryUnavailable: string | null = null;
  const effectStarts = new Map<string, ClosedUnmergedCloseoutEffectStartReceipt>();
  const terminalReceipts = new Map<string, BranchPublishedCloseoutReceipt>();
  const counters = { closePullRequest: 0, deleteRemoteRef: 0, closeIssue: 0 };
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
    async pruneRemote() {
      return { status: 'applied', detail: 'remote tracking refs pruned' };
    },
    async observeTerminalReceipt(operationId) {
      return { status: 'observed', value: terminalReceipts.get(operationId) ?? null };
    },
    async publishTerminalReceipt(operationId, receipt) {
      const existing = terminalReceipts.get(operationId);
      if (existing && existing.publicationDigest !== receipt.publicationDigest) {
        return { status: 'rejected', detail: 'conflicting terminal receipt' };
      }
      terminalReceipts.set(operationId, receipt);
      return { status: existing ? 'already-applied' : 'applied', detail: 'terminal receipt durable' };
    }
  };
  return {
    provider: issueClosedUnmergedCloseoutEffectProvider(adapter),
    counters,
    setCloseResult(value) { closeResult = value; },
    setInventoryUnavailable(detail) { inventoryUnavailable = detail; },
    setBeforeDelete(value) { beforeDelete = value; },
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

function supersededEvidence() {
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
    consumerClosureDigest: `sha256:${'7'.repeat(64)}`
  });
}

function operation(inputEvidence: ReturnType<typeof evidenceClose> | ReturnType<typeof supersededEvidence>) {
  const result = compileClosedUnmergedCloseoutOperation({
    prepared: prepared(inventory()),
    evidence: inputEvidence
  });
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error(result.blockers.join(' | '));
  return result.operation;
}

describe('closed-unmerged branch lifecycle operation', () => {
  test.each([
    ['evidence-close', () => evidenceClose(inventory())],
    ['closed-superseded', supersededEvidence]
  ] as const)('%s closes the exact PR and deletes only the exact remote ref', async (_name, createEvidence) => {
    const closeout = operation(createEvidence());
    const harness = providerHarness(inventory());
    const result = await executeClosedUnmergedCloseoutOperation({
      operation: closeout,
      provider: harness.provider
    });

    expect(result.status).toBe('completed');
    expect(harness.counters).toEqual({
      closePullRequest: 1,
      deleteRemoteRef: 1,
      closeIssue: 0
    });
    if (result.status === 'completed') {
      expect(result.receipt.branch).toBe(BRANCH);
      expect(result.receipt.pullRequest).toBe(PR_NUMBER);
      expect(result.receipt.disposition).toBe('closed-superseded');
    }
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
    expect(result.status === 'preserved' ? result.stage : null).toBe('initial-observation');
    expect(harness.counters).toEqual({ closePullRequest: 0, deleteRemoteRef: 0, closeIssue: 0 });
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
});
