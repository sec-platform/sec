import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
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
  createClosedSupersededDispositionEvidence,
  executeClosedUnmergedCloseoutOperation,
  issueClosedUnmergedCloseoutEffectProvider,
  type ClosedUnmergedCloseoutEffectAdapter,
  type ClosedUnmergedCloseoutExecutionResult,
  type ClosedUnmergedCloseoutOperation,
  type ClosedUnmergedTerminal
} from '../../src/control/branch-lifecycle/closed-unmerged-closeout.ts';
import { retireClosedUnmergedRecoveryFamily } from '../../src/control/branch-lifecycle/closed-unmerged-recovery-retirement.ts';
import type { GitHubApiPrincipal } from '../../src/external-capabilities/github-api/operation-session.ts';
import {
  issueGitHubApiTestCapability,
  withGitHubApiTestSession,
  type GitHubApiTransport
} from '../../src/external-capabilities/github-api/test/operation-session.ts';
import { canonicalJson } from '../../src/system-architecture/foundation/runtime/canonical.ts';
import { observeTestClosedSupersessionEvidence } from '../helpers/closed-supersession-evidence.ts';

const REPOSITORY = 'sec-platform/sec';
const BRANCH = 'codex/retirement-coordinator-topic';
const PR_NUMBER = 593;
const PRINCIPAL: GitHubApiPrincipal = Object.freeze({
  transport: 'github-rest-token',
  login: 'maintainer',
  nodeId: 'MDQ6VXNlcjE=',
  userId: 900001,
  permission: 'maintain'
});

function git(root: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function fixture(): Readonly<{
  root: string;
  recoveryRoot: string;
  bundlePath: string;
  prepared: PreparedBranchCloseoutEnvelope;
  inventory: BranchLifecycleInventory;
  headSha: string;
}> {
  const parent = mkdtempSync(path.join(tmpdir(), 'sec-retirement-coordinator-'));
  const root = path.join(parent, 'repository');
  const recoveryRoot = `${root}-recovery`;
  git(parent, ['init', '--quiet', '--initial-branch=main', root]);
  git(root, ['config', 'user.name', 'SEC Tests']);
  git(root, ['config', 'user.email', 'tests@example.com']);
  git(root, ['remote', 'add', 'origin', `https://github.com/${REPOSITORY}.git`]);
  writeFileSync(path.join(root, 'tracked.txt'), 'closed branch behavior\n', 'utf8');
  git(root, ['add', 'tracked.txt']);
  git(root, ['commit', '--quiet', '-m', 'closed branch head']);
  const headSha = git(root, ['rev-parse', 'HEAD']);
  writeFileSync(path.join(root, 'tracked.txt'), 'current main replacement\n', 'utf8');
  git(root, ['commit', '--quiet', '-am', 'current main replacement']);
  const mainSha = git(root, ['rev-parse', 'HEAD']);
  const commonDir = path.resolve(root, '.git');
  const inventory: BranchLifecycleInventory = {
    schema: 'sec-branch-lifecycle-inventory-v1',
    observedAt: '2026-09-17T00:00:00.000Z',
    repository: {
      root,
      commonDir,
      fullName: REPOSITORY,
      remote: 'origin',
      remoteUrl: `https://github.com/${REPOSITORY}.git`,
      defaultBranch: 'main'
    },
    main: { localSha: mainSha, remoteSha: mainSha },
    localBranches: [{ branch: 'main', sha: mainSha }],
    remoteBranches: [{ branch: 'main', sha: mainSha }],
    worktrees: [{
      path: root,
      headSha: mainSha,
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
      headSha,
      baseBranch: 'main',
      baseSha: headSha,
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
  const bundlePath = path.join(recoveryRoot, 'coordinator-fixture.bundle');
  mkdirSync(recoveryRoot);
  git(root, ['bundle', 'create', bundlePath, 'refs/heads/main']);
  const bundleDigest = createHash('sha256').update(readFileSync(bundlePath)).digest('hex');
  writeFileSync(
    `${bundlePath}.sha256`,
    `${bundleDigest}  ${path.basename(bundlePath)}\n`,
    'utf8'
  );
  const preparation = createBranchCloseoutPreparation({
    preparedAt: '2026-09-17T00:01:00.000Z',
    repository: inventory.repository,
    branch: BRANCH,
    refState: 'absent',
    expectedHeadSha: headSha,
    expectedRemoteSha: headSha,
    expectedLocalSha: null,
    expectedPrHeadSha: headSha,
    pullRequestNumber: PR_NUMBER,
    pullRequestStateAtPreparation: 'closed',
    recovery: {
      kind: 'bundle',
      path: bundlePath,
      sha256: `sha256:${bundleDigest}`,
      verified: true,
      verifyOutput: 'verified fixture bundle'
    },
    worktreePathsAtPreparation: []
  });
  const payload = {
    schema: BRANCH_CLOSEOUT_PREPARED_ENVELOPE_SCHEMA,
    preparation,
    before: inventory,
    attempts: [],
    foreignWorktreeObservations: []
  };
  const prepared = { ...payload, envelopeDigest: branchLifecycleDigest(payload) };
  writeFileSync(
    `${bundlePath}.preparation.json`,
    `${JSON.stringify(prepared, null, 2)}\n`,
    'utf8'
  );
  return Object.freeze({ root, recoveryRoot, bundlePath, prepared, inventory, headSha });
}

async function completed(input: ReturnType<typeof fixture>): Promise<Readonly<{
  operation: ClosedUnmergedCloseoutOperation;
  completed: ClosedUnmergedCloseoutExecutionResult;
}>> {
  const currentMainSha = input.inventory.main.remoteSha!;
  const supersession = await observeTestClosedSupersessionEvidence({
    repositoryRoot: input.root,
    repository: REPOSITORY,
    pullRequestNumber: PR_NUMBER,
    commentId: 5932,
    headSha: input.headSha,
    headTreeSha: git(input.root, ['rev-parse', `${input.headSha}^{tree}`]),
    currentMainSha,
    currentMainTreeSha: git(input.root, ['rev-parse', `${currentMainSha}^{tree}`]),
    paths: [{
      path: 'tracked.txt',
      disposition: 'superseded',
      reason: 'Current main replaces the closed branch behavior.'
    }]
  });
  const evidence = createClosedSupersededDispositionEvidence({
    repository: REPOSITORY,
    pullRequestNumber: PR_NUMBER,
    branch: BRANCH,
    headSha: input.headSha,
    headTreeSha: git(input.root, ['rev-parse', `${input.headSha}^{tree}`]),
    baseBranch: 'main',
    baseSha: input.headSha,
    currentMainSha,
    currentMainTreeSha: git(input.root, ['rev-parse', `${currentMainSha}^{tree}`]),
    durableGoal: { kind: 'evidence', reference: 'coordinator-fixture' },
    supersession
  });
  const compiled = compileClosedUnmergedCloseoutOperation({ prepared: input.prepared, evidence });
  if (compiled.status !== 'ready') throw new Error(compiled.blockers.join(' | '));
  const starts = new Map<string, Parameters<ClosedUnmergedCloseoutEffectAdapter['publishEffectStart']>[0]>();
  const terminals = new Map<string, ClosedUnmergedTerminal>();
  const adapter: ClosedUnmergedCloseoutEffectAdapter = {
    providerIdentity: 'coordinator-fixture-provider',
    repository: REPOSITORY,
    async observeInventory() {
      return { status: 'observed', value: structuredClone(input.inventory) };
    },
    async observeEffectStart(operationId) {
      return { status: 'observed', value: starts.get(operationId) ?? null };
    },
    async publishEffectStart(receipt) {
      starts.set(receipt.operationId, receipt);
      return { status: 'applied', detail: 'persisted' };
    },
    async deleteRemoteRefCas() { return { status: 'already-applied', detail: 'absent' }; },
    async deleteLocalRefCas() { return { status: 'already-applied', detail: 'absent' }; },
    async pruneRemote() { return { status: 'applied', detail: 'tracking absent' }; },
    async observeTerminalReceipt(operationId) {
      return { status: 'observed', value: terminals.get(operationId) ?? null };
    },
    async publishTerminalReceipt(terminal) {
      terminals.set(terminal.operationId, terminal);
      return { status: 'applied', detail: 'persisted' };
    }
  };
  const result = await executeClosedUnmergedCloseoutOperation({
    operation: compiled.operation,
    provider: issueClosedUnmergedCloseoutEffectProvider(adapter)
  });
  if (result.status !== 'completed') {
    throw new Error(`${result.stage}: ${result.reasons.join(' | ')}`);
  }
  return Object.freeze({ operation: compiled.operation, completed: result });
}

function capability(headSha: string) {
  return issueGitHubApiTestCapability({
    repository: REPOSITORY,
    token: 'closed-retirement-coordinator-test-token',
    principal: PRINCIPAL,
    effect: 'branch-closeout-write',
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
          head: { ref: BRANCH, sha: headSha, repo: { full_name: REPOSITORY } },
          base: { ref: 'main', repo: { full_name: REPOSITORY } }
        });
      }
      if (pathname === `/repos/${REPOSITORY}/git/ref/heads/${encodeURIComponent(BRANCH)}`) {
        return Response.json({ message: 'Not Found' }, { status: 404 });
      }
      return Response.json({ message: `Unexpected path ${pathname}` }, { status: 500 });
    }) satisfies GitHubApiTransport
  });
}

function writeUnknownMatchingJournal(root: string, headSha: string): string {
  const directory = path.join(root, '.git', 'sec-development-commit');
  mkdirSync(directory, { recursive: true });
  const journalPath = path.join(directory, `${'a'.repeat(64)}.json`);
  const journal = {
    schema: 'sec-development-commit-journal-v1',
    operation: `sha256:${'1'.repeat(64)}`,
    attempt: `sha256:${'2'.repeat(64)}`,
    ref: `refs/heads/${BRANCH}`,
    preimage: headSha,
    target: headSha,
    object: headSha,
    tree: git(root, ['rev-parse', `${headSha}^{tree}`]),
    terminal: 'unknown'
  };
  writeFileSync(journalPath, `${JSON.stringify(canonicalJson(journal))}\n`, 'utf8');
  return journalPath;
}

test('commit-journal coordinator preserves recovery before failure and rechecks an absent root', async () => {
  const value = fixture();
  try {
    const settlement = await completed(value);
    const api = capability(value.headSha);
    await withGitHubApiTestSession({ capability: api, operation: async () => {
      const firstUnknown = writeUnknownMatchingJournal(value.root, value.headSha);
      await expect(retireClosedUnmergedRecoveryFamily({
        ...settlement,
        capability: api
      })).rejects.toThrow(/nonterminal or unknown journal consumers/u);
      expect(existsSync(firstUnknown)).toBe(true);
      expect(existsSync(value.bundlePath)).toBe(true);
      expect(existsSync(`${value.bundlePath}.sha256`)).toBe(true);
      expect(existsSync(`${value.bundlePath}.preparation.json`)).toBe(true);

      unlinkSync(firstUnknown);
      const retired = await retireClosedUnmergedRecoveryFamily({
        ...settlement,
        capability: api
      });
      expect(retired.status).toBe('completed');
      expect(existsSync(value.recoveryRoot)).toBe(false);

      const recreatedUnknown = writeUnknownMatchingJournal(value.root, value.headSha);
      await expect(retireClosedUnmergedRecoveryFamily({
        ...settlement,
        capability: api
      })).rejects.toThrow(/nonterminal or unknown journal consumers/u);
      expect(existsSync(recreatedUnknown)).toBe(true);
      expect(existsSync(value.recoveryRoot)).toBe(false);
    } });
  } finally {
    rmSync(path.dirname(value.root), { recursive: true, force: true });
  }
}, 30_000);
