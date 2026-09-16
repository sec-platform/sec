import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { createBranchCloseoutPreparation } from '../../src/control/branch-lifecycle/branch-closeout-contract.ts';
import {
  BRANCH_CLOSEOUT_PREPARED_ENVELOPE_SCHEMA,
  type PreparedBranchCloseoutEnvelope
} from '../../src/control/branch-lifecycle/branch-closeout.ts';
import { branchLifecycleDigest } from '../../src/control/branch-lifecycle/branch-lifecycle-audit.ts';
import type { BranchLifecycleInventory } from '../../src/control/branch-lifecycle/branch-lifecycle-types.ts';
import {
  compileClosedUnmergedCloseoutOperation,
  createEvidenceCloseDispositionEvidence,
  executeClosedUnmergedCloseoutOperation,
  issueClosedUnmergedCloseoutEffectProvider,
  type ClosedUnmergedCloseoutEffectAdapter,
  type ClosedUnmergedCloseoutExecutionResult,
  type ClosedUnmergedCloseoutOperation,
  type ClosedUnmergedTerminal
} from '../../src/control/branch-lifecycle/closed-unmerged-closeout.ts';
import { retireClosedUnmergedRecoveryFamily } from '../../src/control/branch-lifecycle/closed-unmerged-recovery-retirement.ts';

const REPOSITORY = 'sec-platform/sec';
const BRANCH = 'codex/retired-closed-branch';
const PR_NUMBER = 593;

function git(root: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function fixture(): Readonly<{
  root: string;
  recoveryRoot: string;
  bundlePath: string;
  prepared: PreparedBranchCloseoutEnvelope;
  inventory: BranchLifecycleInventory;
}> {
  const parent = mkdtempSync(path.join(tmpdir(), 'sec-closed-recovery-retirement-'));
  const root = path.join(parent, 'repository');
  const recoveryRoot = `${root}-recovery`;
  git(parent, ['init', '--quiet', '--initial-branch=main', root]);
  git(root, ['config', 'user.name', 'SEC Tests']);
  git(root, ['config', 'user.email', 'tests@example.com']);
  writeFileSync(path.join(root, 'tracked.txt'), 'tracked\n', 'utf8');
  git(root, ['add', 'tracked.txt']);
  git(root, ['commit', '--quiet', '-m', 'fixture']);
  const head = git(root, ['rev-parse', 'HEAD']);
  const commonDir = path.resolve(root, '.git');
  const inventory: BranchLifecycleInventory = {
    schema: 'sec-branch-lifecycle-inventory-v1', observedAt: '2026-09-16T00:00:00.000Z',
    repository: { root, commonDir, fullName: REPOSITORY, remote: 'origin',
      remoteUrl: `https://github.com/${REPOSITORY}.git`, defaultBranch: 'main' },
    main: { localSha: head, remoteSha: head },
    localBranches: [{ branch: 'main', sha: head }],
    remoteBranches: [{ branch: 'main', sha: head }],
    worktrees: [{ path: root, headSha: head, branch: 'main', dirtyCount: 0,
      untrackedCount: 0, locked: false, prunable: false, observation: 'resolved', reason: null }],
    pullRequests: [{ number: PR_NUMBER, headBranch: BRANCH, headSha: head,
      baseBranch: 'main', baseSha: head, state: 'closed', isDraft: false,
      isCrossRepository: false, url: `https://github.com/${REPOSITORY}/pull/${PR_NUMBER}`,
      closeoutReceipt: { requirement: 'not-required', status: 'not-required', receipt: null, reason: null } }],
    activeWorkPackage: { state: 'none', branch: null, manifest: null, reason: null },
    repositorySetting: { observation: 'resolved', deleteBranchOnMerge: true, reason: null },
    pruneConfiguration: { observation: 'resolved', fetchPrune: true,
      remotePrune: true, fetchPruneTags: true, reason: null }, unknowns: []
  };
  const bundlePath = path.join(recoveryRoot, 'sec-branch-closeout-retirement-fixture.bundle');
  mkdirSync(recoveryRoot);
  git(root, ['bundle', 'create', bundlePath, 'refs/heads/main']);
  const bundle = readFileSync(bundlePath);
  const bundleDigest = createHash('sha256').update(bundle).digest('hex');
  writeFileSync(`${bundlePath}.sha256`, `${bundleDigest}  ${path.basename(bundlePath)}\n`, 'utf8');
  const preparation = createBranchCloseoutPreparation({
    preparedAt: '2026-09-16T00:01:00.000Z',
    repository: inventory.repository, branch: BRANCH, refState: 'absent',
    expectedHeadSha: head, expectedRemoteSha: head, expectedLocalSha: null,
    expectedPrHeadSha: head, pullRequestNumber: PR_NUMBER,
    pullRequestStateAtPreparation: 'closed',
    recovery: { kind: 'bundle', path: bundlePath, sha256: `sha256:${bundleDigest}`,
      verified: true, verifyOutput: 'verified fixture bundle' },
    worktreePathsAtPreparation: []
  });
  const payload = { schema: BRANCH_CLOSEOUT_PREPARED_ENVELOPE_SCHEMA, preparation,
    before: inventory, attempts: [], foreignWorktreeObservations: [] };
  const prepared = { ...payload, envelopeDigest: branchLifecycleDigest(payload) };
  writeFileSync(`${bundlePath}.preparation.json`, `${JSON.stringify(prepared, null, 2)}\n`, 'utf8');
  return Object.freeze({ root, recoveryRoot, bundlePath, prepared, inventory });
}

async function completed(input: ReturnType<typeof fixture>): Promise<Readonly<{
  operation: ClosedUnmergedCloseoutOperation;
  completed: ClosedUnmergedCloseoutExecutionResult;
}>> {
  const head = input.inventory.main.remoteSha;
  if (head === null) throw new Error('Retirement fixture must observe a main commit.');
  const tree = git(input.root, ['rev-parse', 'HEAD^{tree}']);
  const evidence = createEvidenceCloseDispositionEvidence({ repository: REPOSITORY,
    pullRequestNumber: PR_NUMBER, branch: BRANCH, headSha: head, headTreeSha: tree,
    baseBranch: 'main', baseSha: head, currentMainSha: head, currentMainTreeSha: tree,
    durableGoal: { kind: 'evidence', reference: 'exact-tree-parity-retirement-fixture' } });
  const compiled = compileClosedUnmergedCloseoutOperation({ prepared: input.prepared, evidence });
  if (compiled.status !== 'ready') throw new Error(compiled.blockers.join(' | '));
  const starts = new Map<string, Parameters<ClosedUnmergedCloseoutEffectAdapter['publishEffectStart']>[0]>();
  const terminals = new Map<string, ClosedUnmergedTerminal>();
  const adapter: ClosedUnmergedCloseoutEffectAdapter = {
    providerIdentity: 'fixture-provider', repository: REPOSITORY,
    async observeInventory() { return { status: 'observed', value: structuredClone(input.inventory) }; },
    async observeEffectStart(operationId) { return { status: 'observed', value: starts.get(operationId) ?? null }; },
    async publishEffectStart(receipt) { starts.set(receipt.operationId, receipt); return { status: 'applied', detail: 'persisted' }; },
    async closePullRequest() { return { status: 'already-applied', detail: 'closed' }; },
    async deleteRemoteRefCas() { return { status: 'already-applied', detail: 'absent' }; },
    async deleteLocalRefCas() { return { status: 'already-applied', detail: 'absent' }; },
    async pruneRemote() { return { status: 'applied', detail: 'tracking absent' }; },
    async observeTerminalReceipt(operationId) { return { status: 'observed', value: terminals.get(operationId) ?? null }; },
    async publishTerminalReceipt(terminal) { terminals.set(terminal.operationId, terminal); return { status: 'applied', detail: 'persisted' }; }
  };
  const result = await executeClosedUnmergedCloseoutOperation({ operation: compiled.operation,
    provider: issueClosedUnmergedCloseoutEffectProvider(adapter) });
  if (result.status !== 'completed') throw new Error(`${result.stage}: ${result.reasons.join(' | ')}`);
  return Object.freeze({ operation: compiled.operation, completed: result });
}

test('closed-unmerged terminal retires its exact recovery family and default empty root', async () => {
  const value = fixture();
  try {
    const settlement = await completed(value);
    const result = retireClosedUnmergedRecoveryFamily(settlement);
    expect(result.status).toBe('completed');
    expect(result.retired).toEqual([
      value.bundlePath, `${value.bundlePath}.sha256`, `${value.bundlePath}.preparation.json`
    ]);
    expect(result.retained).toEqual([]);
    expect(result.recoveryRootRetired).toBe(true);
    expect(existsSync(value.recoveryRoot)).toBe(false);
    const repeated = retireClosedUnmergedRecoveryFamily(settlement);
    expect(repeated).toEqual({
      status: 'already-retired',
      retired: [],
      retained: [],
      recoveryRootRetired: true,
      failure: null
    });
    expect(existsSync(value.recoveryRoot)).toBe(false);
  } finally {
    rmSync(path.dirname(value.root), { recursive: true, force: true });
  }
});

test('retirement rejects copied settlement and unknown family consumer before the first delete', async () => {
  for (const mode of ['copy', 'sidecar'] as const) {
    const value = fixture();
    try {
      const settlement = await completed(value);
      if (mode === 'sidecar') writeFileSync(`${value.bundlePath}.consumer.json`, '{}\n', 'utf8');
      const candidate = mode === 'copy' ? { ...settlement.completed } : settlement.completed;
      expect(() => retireClosedUnmergedRecoveryFamily({
        operation: settlement.operation, completed: candidate
      })).toThrow(mode === 'copy' ? /owner-issued completed settlement/u : /active or unknown consumers/u);
      expect(existsSync(value.bundlePath)).toBe(true);
      expect(existsSync(`${value.bundlePath}.sha256`)).toBe(true);
      expect(existsSync(`${value.bundlePath}.preparation.json`)).toBe(true);
    } finally {
      rmSync(path.dirname(value.root), { recursive: true, force: true });
    }
  }
});

test('ordered partial retirement resumes safely and preserves an explicit shared root', async () => {
  const value = fixture();
  try {
    const settlement = await completed(value);
    unlinkSync(value.bundlePath);
    const result = retireClosedUnmergedRecoveryFamily({ ...settlement, recoveryRoot: value.recoveryRoot });
    expect(result.status).toBe('completed');
    expect(result.retired).toEqual([
      `${value.bundlePath}.sha256`, `${value.bundlePath}.preparation.json`
    ]);
    expect(result.retained).toEqual([]);
    expect(result.recoveryRootRetired).toBe(false);
    expect(existsSync(value.recoveryRoot)).toBe(true);
  } finally {
    rmSync(path.dirname(value.root), { recursive: true, force: true });
  }
});
