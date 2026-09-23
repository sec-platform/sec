import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createBranchCloseoutPreparation } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-closeout-contract.ts';
import {
  BRANCH_CLOSEOUT_PREPARED_ENVELOPE_SCHEMA,
  type PreparedBranchCloseoutEnvelope
} from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-closeout.ts';
import { branchLifecycleDigest } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-audit.ts';
import type {
  BranchLifecycleInventory
} from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-types.ts';
import {
  assertClosedUnmergedCloseoutCompletedSettlement,
  compileClosedUnmergedCloseoutOperation,
  createClosedSupersededDispositionEvidence,
  executeClosedUnmergedCloseoutOperation,
  issueClosedUnmergedCloseoutEffectProvider,
  type ClosedSupersededDispositionEvidence,
  type ClosedUnmergedCloseoutEffectAdapter,
  type ClosedUnmergedCloseoutEffectStartReceipt,
  type ClosedUnmergedProviderMutation,
  type ClosedUnmergedTerminal
} from '../../src/adapters/self-hosting/control/branch-lifecycle/closed-unmerged-closeout.ts';
import { observeTestClosedSupersessionEvidence } from '../helpers/closed-supersession-evidence.ts';

let MAIN_SHA = '';
let BASE_SHA = '';
let HEAD_SHA = '';
let HEAD_TREE = '';
let MAIN_TREE = '';
const BRANCH = 'codex/closed-unmerged-fixture';
const REPOSITORY = 'sec-platform/sec';
const PR_NUMBER = 570;
let repositoryRoot = '';
let recoveryRoot = '';
let bundlePath = '';
let bundleDigest = '';
let supersededEvidence: ClosedSupersededDispositionEvidence;

function git(root: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr.trim());
  return result.stdout.trim();
}

beforeAll(async () => {
  repositoryRoot = mkdtempSync(path.join(tmpdir(), 'sec-closed-unmerged-operation-'));
  git(repositoryRoot, ['init', '--quiet', '--initial-branch=main']);
  git(repositoryRoot, ['config', 'user.name', 'SEC Test']);
  git(repositoryRoot, ['config', 'user.email', 'sec-test@example.invalid']);
  git(repositoryRoot, ['remote', 'add', 'origin', `https://github.com/${REPOSITORY}.git`]);
  writeFileSync(path.join(repositoryRoot, 'behavior.txt'), 'base\n', 'utf8');
  git(repositoryRoot, ['add', 'behavior.txt']);
  git(repositoryRoot, ['commit', '--quiet', '-m', 'base']);
  BASE_SHA = git(repositoryRoot, ['rev-parse', 'HEAD']);
  git(repositoryRoot, ['switch', '--quiet', '-c', BRANCH]);
  writeFileSync(path.join(repositoryRoot, 'behavior.txt'), 'closed branch behavior\n', 'utf8');
  git(repositoryRoot, ['commit', '--quiet', '-am', 'closed branch head']);
  HEAD_SHA = git(repositoryRoot, ['rev-parse', 'HEAD']);
  HEAD_TREE = git(repositoryRoot, ['rev-parse', 'HEAD^{tree}']);
  git(repositoryRoot, ['switch', '--quiet', 'main']);
  writeFileSync(path.join(repositoryRoot, 'behavior.txt'), 'current main replacement\n', 'utf8');
  git(repositoryRoot, ['commit', '--quiet', '-am', 'current main replacement']);
  MAIN_SHA = git(repositoryRoot, ['rev-parse', 'HEAD']);
  MAIN_TREE = git(repositoryRoot, ['rev-parse', 'HEAD^{tree}']);
  recoveryRoot = `${repositoryRoot}-recovery`;
  mkdirSync(recoveryRoot);
  bundlePath = path.join(recoveryRoot, 'fixture.bundle');
  git(repositoryRoot, ['bundle', 'create', bundlePath, '--all']);
  bundleDigest = createHash('sha256').update(readFileSync(bundlePath)).digest('hex');
  writeFileSync(`${bundlePath}.sha256`, `${bundleDigest}  ${path.basename(bundlePath)}\n`, 'utf8');
  const supersession = await observeTestClosedSupersessionEvidence({
    repositoryRoot,
    repository: REPOSITORY,
    pullRequestNumber: PR_NUMBER,
    commentId: 5701,
    headSha: HEAD_SHA,
    headTreeSha: HEAD_TREE,
    currentMainSha: MAIN_SHA,
    currentMainTreeSha: MAIN_TREE,
    paths: [{
      path: 'behavior.txt',
      disposition: 'superseded',
      reason: 'Current main replaces the closed branch behavior.'
    }]
  });
  supersededEvidence = createClosedSupersededDispositionEvidence({
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
    supersession
  });
}, 180_000);

afterAll(() => {
  if (repositoryRoot !== '') rmSync(repositoryRoot, { recursive: true, force: true });
  if (recoveryRoot !== '') rmSync(recoveryRoot, { recursive: true, force: true });
});

function inventory(): BranchLifecycleInventory {
  const root = repositoryRoot;
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
      state: 'closed',
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
      path: bundlePath,
      sha256: `sha256:${bundleDigest}`,
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
    deleteRemoteRef: number;
    deleteLocalRef: number;
    pruneRemote: number;
  };
  setInventoryUnavailable(detail: string | null): void;
  setRemoteDeleteResult(value: ClosedUnmergedProviderMutation | null): void;
  setBeforeDelete(value: (() => void) | null): void;
  setBeforePrune(value: (() => void) | null): void;
  setAfterTerminalPublication(value: (() => void) | null): void;
  setTerminal(operationId: string, value: ClosedUnmergedTerminal): void;
  terminal(operationId: string): ClosedUnmergedTerminal | undefined;
  effectStart(operationId: string): ClosedUnmergedCloseoutEffectStartReceipt | undefined;
  mutate(mutator: (value: BranchLifecycleInventory) => void): void;
}

function providerHarness(
  initial: BranchLifecycleInventory,
  localRefDeleteCoordination: 'coordinated' | 'unavailable' = 'coordinated'
): ProviderHarness {
  let current = structuredClone(initial);
  let remoteDeleteResult: ClosedUnmergedProviderMutation | null = null;
  let beforeDelete: (() => void) | null = null;
  let beforePrune: (() => void) | null = null;
  let afterTerminalPublication: (() => void) | null = null;
  let inventoryUnavailable: string | null = null;
  const effectStarts = new Map<string, ClosedUnmergedCloseoutEffectStartReceipt>();
  const terminalReceipts = new Map<string, ClosedUnmergedTerminal>();
  const counters = { deleteRemoteRef: 0, deleteLocalRef: 0, pruneRemote: 0 };
  const adapter: ClosedUnmergedCloseoutEffectAdapter = {
    providerIdentity: 'fixture-github-and-git-provider',
    repository: REPOSITORY,
    localRefDeleteCoordination,
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
    async deleteRemoteRefCas(input) {
      counters.deleteRemoteRef += 1;
      beforeDelete?.();
      beforeDelete = null;
      if (remoteDeleteResult !== null) return remoteDeleteResult;
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
      beforePrune?.();
      beforePrune = null;
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
      afterTerminalPublication?.();
      afterTerminalPublication = null;
      return { status: existing ? 'already-applied' : 'applied', detail: 'terminal receipt durable' };
    }
  };
  return {
    provider: issueClosedUnmergedCloseoutEffectProvider(adapter),
    counters,
    setInventoryUnavailable(detail) { inventoryUnavailable = detail; },
    setRemoteDeleteResult(value) { remoteDeleteResult = value; },
    setBeforeDelete(value) { beforeDelete = value; },
    setBeforePrune(value) { beforePrune = value; },
    setAfterTerminalPublication(value) { afterTerminalPublication = value; },
    setTerminal(operationId, value) { terminalReceipts.set(operationId, value); },
    terminal(operationId) { return terminalReceipts.get(operationId); },
    effectStart(operationId) { return effectStarts.get(operationId); },
    mutate(mutator) { mutator(current); }
  };
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

function operation(inputEvidence: ClosedSupersededDispositionEvidence = supersededEvidence) {
  const result = compileClosedUnmergedCloseoutOperation({
    prepared: prepared(inventory()),
    evidence: inputEvidence
  });
  if (result.status === 'blocked') throw new Error(result.blockers.join(' | '));
  expect(result.status).toBe('ready');
  return result.operation;
}

function terminalInventory(): BranchLifecycleInventory {
  const value = inventory();
  value.remoteBranches = value.remoteBranches.filter(({ branch }) => branch !== BRANCH);
  value.localBranches = value.localBranches.filter(({ branch }) => branch !== BRANCH);
  return value;
}

describe('closed-unmerged branch lifecycle operation', () => {
  test('open PR input is rejected at the closed-only preparation boundary', () => {
    const before = inventory();
    before.pullRequests[0]!.state = 'open';
    const result = compileClosedUnmergedCloseoutOperation({
      prepared: prepared(before),
      evidence: supersededEvidence
    });

    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' ? result.blockers : []).toContain(
      'current PR state must be closed'
    );
  });

  test('closed-superseded deletes only exact refs from an already closed PR', async () => {
    const closeout = operation();
    const harness = providerHarness(inventory());
    const result = await executeClosedUnmergedCloseoutOperation({
      operation: closeout,
      provider: harness.provider
    });

    expect(result.status).toBe('completed');
    expect(harness.counters).toEqual({
      deleteRemoteRef: 1,
      deleteLocalRef: 0,
      pruneRemote: 1
    });
    if (result.status === 'completed') {
      expect(result.receipt.branch).toBe(BRANCH);
      expect(result.receipt.pullRequest).toBe(PR_NUMBER);
      expect(result.receipt.disposition).toBe('closed-superseded');
    }
  });

  test('damaged bundle bytes or sidecar block before effect-start and remote CAS', async () => {
    const originalBundle = readFileSync(bundlePath);
    const originalSidecar = readFileSync(`${bundlePath}.sha256`);
    try {
      for (const target of [bundlePath, `${bundlePath}.sha256`]) {
        const closeout = operation();
        const harness = providerHarness(inventory());
        writeFileSync(target, 'damaged recovery\n');
        const result = await executeClosedUnmergedCloseoutOperation({
          operation: closeout, provider: harness.provider
        });
        expect(result.status).toBe('blocked');
        expect(result.status === 'blocked' ? result.stage : '').toBe('effect-start-precondition');
        expect(result.status === 'blocked' ? result.reasons.join(' | ') : '')
          .toMatch(/recovery bundle digest mismatch|recovery checksum sidecar does not match/u);
        expect(harness.effectStart(closeout.operationId)).toBeUndefined();
        expect(harness.counters).toEqual({ deleteRemoteRef: 0, deleteLocalRef: 0, pruneRemote: 0 });
        writeFileSync(bundlePath, originalBundle);
        writeFileSync(`${bundlePath}.sha256`, originalSidecar);
      }
    } finally {
      writeFileSync(bundlePath, originalBundle);
      writeFileSync(`${bundlePath}.sha256`, originalSidecar);
    }
  });

  test('divergent local branch stays protected while remote closes and later terminal settles', async () => {
    const before = inventory();
    const independentLocalSha = 'a'.repeat(40);
    before.localBranches.push({ branch: BRANCH, sha: independentLocalSha });
    const compiled = compileClosedUnmergedCloseoutOperation({ prepared: prepared(before),
      evidence: supersededEvidence });
    expect(compiled.status).toBe('ready');
    if (compiled.status !== 'ready') throw new Error(compiled.blockers.join(' | '));
    const harness = providerHarness(before);
    const first = await executeClosedUnmergedCloseoutOperation({ operation: compiled.operation,
      provider: harness.provider });
    expect(first.status).toBe('preserved');
    expect(harness.counters).toEqual({ deleteRemoteRef: 1, deleteLocalRef: 0, pruneRemote: 1 });
    expect(harness.terminal(compiled.operation.operationId)?.receipt.closeoutStatus)
      .toBe('protected-pending');
    harness.mutate((current) => { current.localBranches = current.localBranches
      .filter(({ branch }) => branch !== BRANCH); });
    const resumed = await executeClosedUnmergedCloseoutOperation({ operation: compiled.operation,
      provider: harness.provider });
    expect(resumed.status).toBe('completed');
    expect(harness.counters).toEqual({ deleteRemoteRef: 1, deleteLocalRef: 0, pruneRemote: 1 });
  });

  test('structurally plausible supersession evidence is rejected without owner issuance', () => {
    expect(() => fakeSupersededEvidence()).toThrow(
      'Supersession evidence requires authenticated owner observation.'
    );
  });

  test('head drift blocks before effect-start or remote deletion', async () => {
    const closeout = operation();
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
    expect(harness.counters.deleteRemoteRef).toBe(0);
  });

  test('remote CAS drift after effect-start preserves the exact branch', async () => {
    const closeout = operation();
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
  });

  test('an exact prepared local ref is deleted by local CAS and read back absent', async () => {
    const before = inventory();
    before.localBranches.push({ branch: BRANCH, sha: HEAD_SHA });
    const result = compileClosedUnmergedCloseoutOperation({
      prepared: prepared(before),
      evidence: supersededEvidence
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

  test('unavailable local-ref atomicity blocks before effect-start or remote deletion', async () => {
    const before = inventory();
    before.localBranches.push({ branch: BRANCH, sha: HEAD_SHA });
    const preparedOperation = compileClosedUnmergedCloseoutOperation({
      prepared: prepared(before), evidence: supersededEvidence
    });
    expect(preparedOperation.status).toBe('ready');
    if (preparedOperation.status !== 'ready') throw new Error(preparedOperation.blockers.join(' | '));
    const harness = providerHarness(before, 'unavailable');
    const result = await executeClosedUnmergedCloseoutOperation({
      operation: preparedOperation.operation, provider: harness.provider
    });
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' ? result.stage : null).toBe('effect-start-precondition');
    expect(harness.effectStart(preparedOperation.operation.operationId)).toBeUndefined();
    expect(harness.counters).toEqual({ deleteRemoteRef: 0, deleteLocalRef: 0, pruneRemote: 0 });
  });

  test('local ref reappearance after remote deletion blocks before prune', async () => {
    const before = inventory();
    before.localBranches.push({ branch: BRANCH, sha: HEAD_SHA });
    const preparedOperation = compileClosedUnmergedCloseoutOperation({
      prepared: prepared(before), evidence: supersededEvidence
    });
    expect(preparedOperation.status).toBe('ready');
    if (preparedOperation.status !== 'ready') throw new Error(preparedOperation.blockers.join(' | '));
    const live = structuredClone(before);
    live.localBranches = [];
    const harness = providerHarness(live, 'unavailable');
    harness.setBeforeDelete(() => harness.mutate((current) => {
      current.localBranches.push({ branch: BRANCH, sha: HEAD_SHA });
    }));
    const result = await executeClosedUnmergedCloseoutOperation({
      operation: preparedOperation.operation, provider: harness.provider
    });
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' ? result.stage : null).toBe('prune-authorization');
    expect(harness.counters).toEqual({ deleteRemoteRef: 1, deleteLocalRef: 0, pruneRemote: 0 });
  });

  test('local ref reappearance during prune blocks before local delete', async () => {
    const before = inventory();
    before.localBranches.push({ branch: BRANCH, sha: HEAD_SHA });
    const preparedOperation = compileClosedUnmergedCloseoutOperation({
      prepared: prepared(before), evidence: supersededEvidence
    });
    expect(preparedOperation.status).toBe('ready');
    if (preparedOperation.status !== 'ready') throw new Error(preparedOperation.blockers.join(' | '));
    const live = structuredClone(before);
    live.localBranches = [];
    const harness = providerHarness(live, 'unavailable');
    harness.setBeforePrune(() => harness.mutate((current) => {
      current.localBranches.push({ branch: BRANCH, sha: HEAD_SHA });
    }));
    const result = await executeClosedUnmergedCloseoutOperation({
      operation: preparedOperation.operation, provider: harness.provider
    });
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' ? result.stage : null).toBe('local-delete-authorization');
    expect(harness.counters).toEqual({ deleteRemoteRef: 1, deleteLocalRef: 0, pruneRemote: 1 });
  });

  test('an exact closed PR with a present remote ref is accepted', async () => {
    const before = inventory();
    const result = compileClosedUnmergedCloseoutOperation({
      prepared: prepared(before), evidence: supersededEvidence
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error(result.blockers.join(' | '));
    const harness = providerHarness(before);
    const executed = await executeClosedUnmergedCloseoutOperation({
      operation: result.operation, provider: harness.provider
    });
    expect(executed.status).toBe('completed');
    expect(harness.counters.deleteRemoteRef).toBe(1);
  });

  test('a closed exact PR with an already absent remote ref resumes from recovery', async () => {
    const before = inventory();
    before.remoteBranches = before.remoteBranches.filter(({ branch }) => branch !== BRANCH);
    const result = compileClosedUnmergedCloseoutOperation({
      prepared: prepared(before), evidence: supersededEvidence
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error(result.blockers.join(' | '));
    const harness = providerHarness(before);
    const executed = await executeClosedUnmergedCloseoutOperation({
      operation: result.operation, provider: harness.provider
    });
    expect(executed.status).toBe('completed');
    expect(harness.counters.deleteRemoteRef).toBe(0);
  });

  test('PR identity mutation blocks before effect-start or ref deletion', async () => {
    const closeout = operation();
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
    expect(harness.counters.deleteRemoteRef).toBe(0);
  });

  test('provider unavailability preserves preparation and performs no Effect', async () => {
    const closeout = operation();
    const harness = providerHarness(inventory());
    harness.setInventoryUnavailable('provider session unavailable');

    const result = await executeClosedUnmergedCloseoutOperation({
      operation: closeout,
      provider: harness.provider
    });

    expect(result.status).toBe('preserved');
    expect(result.status === 'preserved' ? result.stage : null).toBe('effect-start-precondition');
    expect(harness.counters).toEqual({ deleteRemoteRef: 0,
      deleteLocalRef: 0, pruneRemote: 0 });
  });

  test('an absent branch resumes from durable effect-start readback', async () => {
    const closeout = operation();
    const harness = providerHarness(inventory());
    harness.setRemoteDeleteResult({ status: 'ambiguous', detail: 'remote deletion settlement unknown' });
    const first = await executeClosedUnmergedCloseoutOperation({
      operation: closeout,
      provider: harness.provider
    });
    expect(first.status).toBe('preserved');
    expect(first.status === 'preserved' ? first.stage : null).toBe('remote-delete');

    harness.mutate((value) => {
      value.remoteBranches = value.remoteBranches.filter(({ branch }) => branch !== BRANCH);
    });
    harness.setRemoteDeleteResult(null);
    const resumed = await executeClosedUnmergedCloseoutOperation({
      operation: closeout,
      provider: harness.provider
    });

    expect(resumed.status).toBe('completed');
    expect(harness.counters.deleteRemoteRef).toBe(1);
  });

  for (const recreated of ['remote', 'local'] as const) {
    test(`terminal publication cannot complete after ${recreated} ref recreation`, async () => {
      const closeout = operation();
      const harness = providerHarness(inventory());
      harness.setAfterTerminalPublication(() => {
        harness.mutate((value) => {
          if (recreated === 'remote') {
            value.remoteBranches.push({ branch: BRANCH, sha: HEAD_SHA });
          } else {
            value.localBranches.push({ branch: BRANCH, sha: HEAD_SHA });
          }
        });
      });

      const result = await executeClosedUnmergedCloseoutOperation({
        operation: closeout, provider: harness.provider
      });

      expect(result.status).not.toBe('completed');
      expect(result.status === 'completed' ? null : result.stage).toBe('terminal-live-readback');
      expect(() => assertClosedUnmergedCloseoutCompletedSettlement(closeout, result)).toThrow(
        'Closed-unmerged recovery retirement requires an exact owner-issued completed settlement.'
      );
      expect(harness.terminal(closeout.operationId)).toBeDefined();
    });
  }

  test('terminal readback with a different evidence digest is rejected', async () => {
    const closeout = operation();
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

  test('terminal settlement survives later main movement and an unrelated active Work Package', async () => {
    const closeout = operation();
    const completedHarness = providerHarness(inventory());
    const completed = await executeClosedUnmergedCloseoutOperation({
      operation: closeout, provider: completedHarness.provider
    });
    expect(completed.status).toBe('completed');
    const current = terminalInventory();
    const advancedMain = '9'.repeat(40);
    current.main = { localSha: advancedMain, remoteSha: advancedMain };
    current.localBranches = current.localBranches.map((entry) => (
      entry.branch === 'main' ? { ...entry, sha: advancedMain } : entry
    ));
    current.remoteBranches = current.remoteBranches.map((entry) => (
      entry.branch === 'main' ? { ...entry, sha: advancedMain } : entry
    ));
    current.activeWorkPackage = {
      state: 'active', branch: 'codex/unrelated-candidate', manifest: 'WP-unrelated', reason: null
    };
    const replayHarness = providerHarness(current);
    replayHarness.setTerminal(closeout.operationId, completedHarness.terminal(closeout.operationId)!);

    const replay = await executeClosedUnmergedCloseoutOperation({
      operation: closeout, provider: replayHarness.provider
    });

    expect(replay.status).toBe('completed');
    expect(replayHarness.counters).toEqual({
      deleteRemoteRef: 0, deleteLocalRef: 0, pruneRemote: 0
    });
  });

  test('main movement without a terminal cannot authorize new effects', async () => {
    const closeout = operation();
    const current = inventory();
    const advancedMain = '9'.repeat(40);
    current.main = { localSha: advancedMain, remoteSha: advancedMain };
    current.localBranches = current.localBranches.map((entry) => (
      entry.branch === 'main' ? { ...entry, sha: advancedMain } : entry
    ));
    current.remoteBranches = current.remoteBranches.map((entry) => (
      entry.branch === 'main' ? { ...entry, sha: advancedMain } : entry
    ));
    const harness = providerHarness(current);

    const result = await executeClosedUnmergedCloseoutOperation({
      operation: closeout, provider: harness.provider
    });

    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' ? result.reasons : []).toContain('current main SHA changed');
    expect(harness.counters).toEqual({
      deleteRemoteRef: 0, deleteLocalRef: 0, pruneRemote: 0
    });
  });

  for (const drift of ['pr-head', 'repository'] as const) {
    test(`terminal settlement rejects ${drift} identity drift`, async () => {
      const closeout = operation();
      const completedHarness = providerHarness(inventory());
      const completed = await executeClosedUnmergedCloseoutOperation({
        operation: closeout, provider: completedHarness.provider
      });
      expect(completed.status).toBe('completed');
      const current = terminalInventory();
      if (drift === 'pr-head') current.pullRequests[0]!.headSha = '8'.repeat(40);
      else current.repository.fullName = 'sec-platform/different';
      const replayHarness = providerHarness(current);
      replayHarness.setTerminal(closeout.operationId, completedHarness.terminal(closeout.operationId)!);

      const replay = await executeClosedUnmergedCloseoutOperation({
        operation: closeout, provider: replayHarness.provider
      });

      expect(replay.status).toBe('blocked');
      expect(replay.status === 'blocked' ? replay.stage : null).toBe('terminal-live-readback');
      expect(replayHarness.counters).toEqual({
        deleteRemoteRef: 0, deleteLocalRef: 0, pruneRemote: 0
      });
    });
  }

  for (const consumer of ['worktree', 'active-work-package', 'unresolved-work-package'] as const) {
    test(`terminal settlement does not complete with a recreated ${consumer} consumer`, async () => {
      const closeout = operation();
      const completedHarness = providerHarness(inventory());
      const completed = await executeClosedUnmergedCloseoutOperation({
        operation: closeout, provider: completedHarness.provider
      });
      expect(completed.status).toBe('completed');
      const current = terminalInventory();
      if (consumer === 'worktree') {
        current.worktrees.push({
          path: path.resolve('recreated-topic-worktree'), headSha: HEAD_SHA, branch: BRANCH,
          dirtyCount: 0, untrackedCount: 0, locked: false, prunable: false,
          observation: 'resolved', reason: null
        });
      } else if (consumer === 'active-work-package') {
        current.activeWorkPackage = {
          state: 'active', branch: BRANCH, manifest: 'WP-recreated', reason: null
        };
      } else {
        current.activeWorkPackage = {
          state: 'unresolved', branch: null, manifest: null, reason: 'owner unavailable'
        };
      }
      const replayHarness = providerHarness(current);
      replayHarness.setTerminal(closeout.operationId, completedHarness.terminal(closeout.operationId)!);

      const replay = await executeClosedUnmergedCloseoutOperation({
        operation: closeout, provider: replayHarness.provider
      });

      expect(replay.status).toBe(
        consumer === 'unresolved-work-package' ? 'blocked' : 'preserved'
      );
      expect(replay.status === 'completed' ? null : replay.stage).toBe('terminal-live-readback');
      expect(replayHarness.counters).toEqual({
        deleteRemoteRef: 0, deleteLocalRef: 0, pruneRemote: 0
      });
    });
  }

  test('terminal recovery refuses a recreated remote ref without performing any mutation', async () => {
    const closeout = operation();
    const completedHarness = providerHarness(inventory());
    const completed = await executeClosedUnmergedCloseoutOperation({
      operation: closeout, provider: completedHarness.provider
    });
    expect(completed.status).toBe('completed');
    const terminal = completedHarness.terminal(closeout.operationId)!;
    const recreated = inventory();
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
    expect(harness.counters).toEqual({ deleteRemoteRef: 0,
      deleteLocalRef: 0, pruneRemote: 0 });
  });
});
