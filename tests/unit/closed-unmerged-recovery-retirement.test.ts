import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import type { GitHubApiPrincipal } from '../../src/adapters/providers/github-api/operation-session.ts';
import {
  issueGitHubApiTestCapability,
  withGitHubApiTestSession,
  type GitHubApiTransport
} from '../../src/adapters/providers/github-api/test/operation-session.ts';
import { createBranchCloseoutPreparation } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-closeout-contract.ts';
import {
  BRANCH_CLOSEOUT_PREPARED_ENVELOPE_SCHEMA,
  type PreparedBranchCloseoutEnvelope
} from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-closeout.ts';
import { branchLifecycleDigest } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-audit.ts';
import type { BranchLifecycleInventory } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-types.ts';
import { createMainAbsorptionRecovery } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-recovery.ts';
import {
  compileClosedUnmergedCloseoutOperation,
  createClosedNativeAbsorptionDispositionEvidence,
  createClosedSupersededDispositionEvidence,
  executeClosedUnmergedCloseoutOperation,
  issueClosedUnmergedCloseoutEffectProvider,
  type ClosedUnmergedCloseoutEffectAdapter,
  type ClosedUnmergedCloseoutExecutionResult,
  type ClosedUnmergedCloseoutOperation,
  type ClosedUnmergedTerminal
} from '../../src/adapters/self-hosting/control/branch-lifecycle/closed-unmerged-closeout.ts';
import { retireClosedUnmergedRecoveryFamily } from '../../src/adapters/self-hosting/control/branch-lifecycle/closed-unmerged-recovery-retirement.ts';
import { canonicalJson } from '../../src/contracts/canonical.ts';
import { observeTestClosedSupersessionEvidence } from '../helpers/closed-supersession-evidence.ts';

const REPOSITORY = 'sec-platform/sec';
const BRANCH = 'codex/retired-closed-branch';
const PR_NUMBER = 593;
const GITHUB_PRINCIPAL: GitHubApiPrincipal = Object.freeze({
  transport: 'github-rest-token',
  login: 'maintainer',
  nodeId: 'MDQ6VXNlcjU5Mw==',
  userId: 593,
  permission: 'maintain'
});

function git(root: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

async function fixture(remote = 'origin', retention: 'bundle' | 'main-absorption' = 'bundle'): Promise<Readonly<{
  root: string;
  recoveryRoot: string;
  bundlePath: string;
  prepared: PreparedBranchCloseoutEnvelope;
  inventory: BranchLifecycleInventory;
}>> {
  const parent = mkdtempSync(path.join(tmpdir(), 'sec-closed-recovery-retirement-'));
  const root = path.join(parent, 'repository');
  const recoveryRoot = `${root}-recovery`;
  git(parent, ['init', '--quiet', '--initial-branch=main', root]);
  git(root, ['config', 'user.name', 'SEC Tests']);
  git(root, ['config', 'user.email', 'tests@example.com']);
  git(root, ['remote', 'add', 'origin', `https://github.com/${REPOSITORY}.git`]);
  if (remote !== 'origin') git(root, ['remote', 'add', remote, `https://github.com/${REPOSITORY}.git`]);
  writeFileSync(path.join(root, 'tracked.txt'), 'closed branch behavior\n', 'utf8');
  git(root, ['add', 'tracked.txt']);
  git(root, ['commit', '--quiet', '-m', 'closed branch head']);
  const headSha = git(root, ['rev-parse', 'HEAD']);
  writeFileSync(path.join(root, 'tracked.txt'), 'current main replacement\n', 'utf8');
  git(root, ['commit', '--quiet', '-am', 'current main replacement']);
  const mainSha = git(root, ['rev-parse', 'HEAD']);
  git(root, ['update-ref', `refs/remotes/${remote}/main`, mainSha]);
  const commonDir = path.resolve(root, '.git');
  const inventory: BranchLifecycleInventory = {
    schema: 'sec-branch-lifecycle-inventory-v1', observedAt: '2026-09-16T00:00:00.000Z',
    repository: { root, commonDir, fullName: REPOSITORY, remote,
      remoteUrl: `https://github.com/${REPOSITORY}.git`, defaultBranch: 'main' },
    main: { localSha: mainSha, remoteSha: mainSha },
    localBranches: [{ branch: 'main', sha: mainSha }],
    remoteBranches: [{ branch: 'main', sha: mainSha }],
    worktrees: [{ path: root, headSha: mainSha, branch: 'main', dirtyCount: 0,
      untrackedCount: 0, locked: false, prunable: false, observation: 'resolved', reason: null }],
    pullRequests: [{ number: PR_NUMBER, headBranch: BRANCH, headSha,
      baseBranch: 'main', baseSha: headSha, state: 'closed', isDraft: false,
      isCrossRepository: false, url: `https://github.com/${REPOSITORY}/pull/${PR_NUMBER}`,
      closeoutReceipt: { requirement: 'not-required', status: 'not-required', receipt: null, reason: null } }],
    activeWorkPackage: { state: 'none', branch: null, manifest: null, reason: null },
    repositorySetting: { observation: 'resolved', deleteBranchOnMerge: true, reason: null },
    pruneConfiguration: { observation: 'resolved', fetchPrune: true,
      remotePrune: true, fetchPruneTags: true, reason: null }, unknowns: []
  };
  let bundlePath: string;
  let recovery;
  if (retention === 'main-absorption') {
    recovery = (await createMainAbsorptionRecovery({ inventory, branch: BRANCH,
      expectedSha: headSha, mainSha, basis: 'native-ancestor', recoveryRoot })).recovery;
    bundlePath = recovery.path;
  } else {
    bundlePath = path.join(recoveryRoot, 'sec-branch-closeout-retirement-fixture.bundle');
    mkdirSync(recoveryRoot);
    git(root, ['bundle', 'create', bundlePath, 'refs/heads/main']);
    const bundle = readFileSync(bundlePath);
    const bundleDigest = createHash('sha256').update(bundle).digest('hex');
    writeFileSync(`${bundlePath}.sha256`, `${bundleDigest}  ${path.basename(bundlePath)}\n`, 'utf8');
    recovery = { kind: 'bundle' as const, path: bundlePath, sha256: `sha256:${bundleDigest}` as const,
      verified: true, verifyOutput: 'verified fixture bundle' };
  }
  const preparation = createBranchCloseoutPreparation({
    preparedAt: '2026-09-16T00:01:00.000Z',
    repository: inventory.repository, branch: BRANCH, refState: 'absent',
    expectedHeadSha: headSha, expectedRemoteSha: headSha, expectedLocalSha: null,
    expectedPrHeadSha: headSha, pullRequestNumber: PR_NUMBER,
    pullRequestStateAtPreparation: 'closed',
    recovery,
    worktreePathsAtPreparation: []
  });
  const payload = { schema: BRANCH_CLOSEOUT_PREPARED_ENVELOPE_SCHEMA, preparation,
    before: inventory, attempts: [], foreignWorktreeObservations: [] };
  const prepared = { ...payload, envelopeDigest: branchLifecycleDigest(payload) };
  writeFileSync(`${bundlePath}.preparation.json`, `${JSON.stringify(prepared, null, 2)}\n`, 'utf8');
  return Object.freeze({ root, recoveryRoot, bundlePath, prepared, inventory });
}

async function completed(input: Awaited<ReturnType<typeof fixture>>): Promise<Readonly<{
  operation: ClosedUnmergedCloseoutOperation;
  completed: ClosedUnmergedCloseoutExecutionResult;
}>> {
  const pullRequest = input.inventory.pullRequests[0]!;
  if (pullRequest.headSha === null || pullRequest.baseSha == null) {
    throw new Error('Retirement fixture requires exact PR head and base commits.');
  }
  const currentMainSha = input.inventory.main.remoteSha;
  if (currentMainSha === null) throw new Error('Retirement fixture must observe a main commit.');
  const headTreeSha = git(input.root, ['rev-parse', `${pullRequest.headSha}^{tree}`]);
  const currentMainTreeSha = git(input.root, ['rev-parse', `${currentMainSha}^{tree}`]);
  const supersession = input.prepared.preparation.recovery.kind === 'bundle'
    ? await observeTestClosedSupersessionEvidence({
    repositoryRoot: input.root,
    repository: REPOSITORY,
    pullRequestNumber: PR_NUMBER,
    commentId: 5931,
    headSha: pullRequest.headSha,
    headTreeSha,
    currentMainSha,
    currentMainTreeSha,
    paths: [{
      path: 'tracked.txt', disposition: 'superseded',
      reason: 'Current main replaces the closed branch behavior.'
    }]
    }) : null;
  const evidence = supersession === null
    ? createClosedNativeAbsorptionDispositionEvidence({ prepared: input.prepared,
        repository: REPOSITORY, pullRequestNumber: PR_NUMBER, branch: BRANCH,
        headSha: pullRequest.headSha, headTreeSha,
        baseBranch: 'main', baseSha: pullRequest.baseSha,
        currentMainSha, currentMainTreeSha,
        durableGoal: { kind: 'evidence', reference: 'native-main-absorption-fixture' } })
    : createClosedSupersededDispositionEvidence({ repository: REPOSITORY,
        pullRequestNumber: PR_NUMBER, branch: BRANCH,
        headSha: pullRequest.headSha, headTreeSha,
        baseBranch: 'main', baseSha: pullRequest.baseSha,
        currentMainSha, currentMainTreeSha,
        durableGoal: { kind: 'evidence', reference: 'closed-superseded-retirement-fixture' },
        supersession });
  const compiled = compileClosedUnmergedCloseoutOperation({ prepared: input.prepared, evidence });
  if (compiled.status !== 'ready') throw new Error(compiled.blockers.join(' | '));
  const starts = new Map<string, Parameters<ClosedUnmergedCloseoutEffectAdapter['publishEffectStart']>[0]>();
  const terminals = new Map<string, ClosedUnmergedTerminal>();
  const adapter: ClosedUnmergedCloseoutEffectAdapter = {
    localRefDeleteCoordination: 'coordinated',
    providerIdentity: 'fixture-provider', repository: REPOSITORY,
    async observeInventory() { return { status: 'observed', value: structuredClone(input.inventory) }; },
    async observeEffectStart(operationId) { return { status: 'observed', value: starts.get(operationId) ?? null }; },
    async publishEffectStart(receipt) { starts.set(receipt.operationId, receipt); return { status: 'applied', detail: 'persisted' }; },
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

async function retireWithGitHubObservation(
  fixtureValue: Awaited<ReturnType<typeof fixture>>,
  input: Omit<Parameters<typeof retireClosedUnmergedRecoveryFamily>[0], 'capability'>
) {
  const pullRequest = fixtureValue.inventory.pullRequests.find(({ number }) => number === PR_NUMBER);
  if (pullRequest === undefined) throw new Error('Retirement fixture PR is missing.');
  const capability = issueGitHubApiTestCapability({
    repository: REPOSITORY,
    token: 'closed-unmerged-recovery-retirement-test-token',
    principal: GITHUB_PRINCIPAL,
    effect: 'read',
    transport: (async (target) => {
      const pathname = new URL(String(target)).pathname;
      if (pathname === `/repos/${REPOSITORY}`) {
        return Response.json({ full_name: REPOSITORY, default_branch: 'main' });
      }
      if (pathname === `/repos/${REPOSITORY}/pulls/${PR_NUMBER}`) {
        return Response.json({
          number: PR_NUMBER,
          state: 'closed',
          merged: false,
          head: {
            ref: pullRequest.headBranch,
            sha: pullRequest.headSha,
            repo: { full_name: REPOSITORY }
          },
          base: {
            ref: pullRequest.baseBranch,
            sha: pullRequest.baseSha,
            repo: { full_name: REPOSITORY }
          }
        });
      }
      if (decodeURIComponent(pathname) === `/repos/${REPOSITORY}/git/ref/heads/${BRANCH}`) {
        return Response.json({ message: 'Not Found' }, { status: 404 });
      }
      return Response.json({ message: `Unexpected path ${pathname}` }, { status: 500 });
    }) satisfies GitHubApiTransport
  });
  return await withGitHubApiTestSession({
    capability,
    operation: async () => await retireClosedUnmergedRecoveryFamily({ ...input, capability })
  });
}

test('closed-unmerged terminal retires its exact recovery family and default empty root', async () => {
  const value = await fixture();
  try {
    const settlement = await completed(value);
    const result = await retireWithGitHubObservation(value, settlement);
    expect(result.status).toBe('completed');
    expect(result.retired).toEqual([
      value.bundlePath, `${value.bundlePath}.sha256`, `${value.bundlePath}.preparation.json`
    ]);
    expect(result.retained).toEqual([]);
    expect(result.recoveryRootRetired).toBe(true);
    expect(existsSync(value.recoveryRoot)).toBe(false);
    const repeated = await retireWithGitHubObservation(value, settlement);
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
}, 30_000);

test('closed-unmerged native absorption retires proof and preparation without a history bundle', async () => {
  const value = await fixture('origin', 'main-absorption');
  try {
    const settlement = await completed(value);
    const result = await retireWithGitHubObservation(value, settlement);
    expect(result.status).toBe('completed');
    expect(result.retired).toEqual([value.bundlePath, `${value.bundlePath}.preparation.json`]);
    expect(existsSync(value.recoveryRoot)).toBe(false);
  } finally {
    rmSync(path.dirname(value.root), { recursive: true, force: true });
  }
}, 30_000);

test('retirement rejects copied settlement and unknown family consumer before the first delete', async () => {
  for (const mode of ['copy', 'sidecar'] as const) {
    const value = await fixture();
    try {
      const settlement = await completed(value);
      if (mode === 'sidecar') writeFileSync(`${value.bundlePath}.consumer.json`, '{}\n', 'utf8');
      const candidate = mode === 'copy' ? { ...settlement.completed } : settlement.completed;
      await expect(retireWithGitHubObservation(value, {
        operation: settlement.operation, completed: candidate
      })).rejects.toThrow(
        mode === 'copy' ? /owner-issued completed settlement/u : /active or unknown consumers/u
      );
      expect(existsSync(value.bundlePath)).toBe(true);
      expect(existsSync(`${value.bundlePath}.sha256`)).toBe(true);
      expect(existsSync(`${value.bundlePath}.preparation.json`)).toBe(true);
    } finally {
      rmSync(path.dirname(value.root), { recursive: true, force: true });
    }
  }
}, 30_000);

test('ordered partial retirement resumes safely and preserves an explicit shared root', async () => {
  const value = await fixture();
  try {
    const settlement = await completed(value);
    unlinkSync(value.bundlePath);
    const result = await retireWithGitHubObservation(value, {
      ...settlement,
      recoveryRoot: value.recoveryRoot
    });
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
}, 30_000);

test('matching unknown journal preserves recovery before and after an absent-root continuation', async () => {
  const value = await fixture();
  try {
    const settlement = await completed(value);
    const headSha = value.inventory.pullRequests[0]!.headSha;
    if (headSha === null) throw new Error('fixture PR head is absent');
    const journalRoot = path.join(value.root, '.git', 'sec-development-commit');
    mkdirSync(journalRoot, { recursive: true });
    const journalPath = path.join(journalRoot, `${'a'.repeat(64)}.json`);
    const writeUnknown = () => {
      mkdirSync(journalRoot, { recursive: true });
      writeFileSync(journalPath, `${JSON.stringify(canonicalJson({
      schema: 'sec-development-commit-journal-v1',
      operation: `sha256:${'1'.repeat(64)}`,
      attempt: `sha256:${'2'.repeat(64)}`,
      ref: `refs/heads/${BRANCH}`,
      preimage: headSha,
      target: headSha,
      object: headSha,
      tree: git(value.root, ['rev-parse', `${headSha}^{tree}`]),
      terminal: 'unknown'
      }))}\n`, 'utf8');
    };
    writeUnknown();
    await expect(retireWithGitHubObservation(value, settlement))
      .rejects.toThrow(/nonterminal or unknown journal consumers/u);
    expect(existsSync(value.bundlePath)).toBe(true);
    expect(existsSync(`${value.bundlePath}.preparation.json`)).toBe(true);
    unlinkSync(journalPath);
    const retired = await retireWithGitHubObservation(value, settlement);
    expect(retired.status).toBe('completed');
    expect(existsSync(value.recoveryRoot)).toBe(false);
    writeUnknown();
    await expect(retireWithGitHubObservation(value, settlement))
      .rejects.toThrow(/nonterminal or unknown journal consumers/u);
    expect(existsSync(journalPath)).toBe(true);
  } finally {
    rmSync(path.dirname(value.root), { recursive: true, force: true });
  }
}, 30_000);

test('non-origin prepared remote tracking ref blocks journal and recovery retirement', async () => {
  const value = await fixture('upstream');
  try {
    const settlement = await completed(value);
    const headSha = value.inventory.pullRequests[0]!.headSha;
    if (headSha === null) throw new Error('fixture PR head is absent');
    const journalRoot = path.join(value.root, '.git', 'sec-development-commit');
    mkdirSync(journalRoot, { recursive: true });
    const journalPath = path.join(journalRoot, `${'b'.repeat(64)}.json`);
    writeFileSync(journalPath, `${JSON.stringify(canonicalJson({
      schema: 'sec-development-commit-journal-v1',
      operation: `sha256:${'1'.repeat(64)}`,
      attempt: `sha256:${'2'.repeat(64)}`,
      ref: `refs/heads/${BRANCH}`,
      preimage: headSha,
      target: headSha,
      object: headSha,
      tree: git(value.root, ['rev-parse', `${headSha}^{tree}`]),
      terminal: 'unknown'
    }))}\n`, 'utf8');
    git(value.root, ['update-ref', `refs/remotes/upstream/${BRANCH}`, headSha]);
    await expect(retireWithGitHubObservation(value, settlement))
      .rejects.toThrow(/remote-tracking ref consumer/u);
    expect(existsSync(journalPath)).toBe(true);
    expect(existsSync(value.bundlePath)).toBe(true);
  } finally {
    rmSync(path.dirname(value.root), { recursive: true, force: true });
  }
}, 30_000);
