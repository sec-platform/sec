import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { inspectNoFollowDirectoryChain } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import {
  createBranchCloseoutOperationBinding,
  createBranchCloseoutOperationJournal,
  createBranchCloseoutOperationReceipt,
  createBranchCloseoutPreparation,
  createBranchCloseoutReceipt
} from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-closeout-contract.ts';
import { BRANCH_CLOSEOUT_PREPARED_ENVELOPE_SCHEMA } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-closeout.ts';
import { branchLifecycleDigest } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-audit.ts';
import type { BranchCloseoutReceiptObservation, BranchLifecycleInventory } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-types.ts';
import {
  executeMergedLocalBranchResidueCloseout,
  parseMergedPullRequestHeads,
  parseRepositoryProviderObservation,
  planMergedLocalBranchResidueCloseout
} from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-local-residue-closeout.ts';
import { acquireBranchRecoveryStore } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-recovery.ts';

const MAIN = '1'.repeat(40);
const HEAD = '2'.repeat(40);
const MERGE = '3'.repeat(40);

function git(cwd: string, args: readonly string[], input?: string) {
  const result = spawnSync('git', [...args], {
    cwd,
    ...(input === undefined ? {} : { input: Buffer.from(input, 'utf8') }),
    encoding: null,
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${Buffer.from(result.stderr).toString('utf8')}`);
  }
  return Buffer.from(result.stdout).toString('utf8').trim();
}

function refExists(cwd: string, ref: string): boolean {
  return spawnSync('git', ['show-ref', '--verify', '--quiet', ref], {
    cwd,
    windowsHide: true
  }).status === 0;
}

function createEffectFixture(label: string) {
  const root = mkdtempSync(path.join(tmpdir(), `sec-local-residue-${label}-`));
  const repositoryRoot = path.join(root, 'repository');
  const recoveryRoot = path.join(root, 'recovery');
  mkdirSync(repositoryRoot);
  git(repositoryRoot, ['init', '-b', 'main']);
  git(repositoryRoot, ['config', 'user.name', 'SEC Test']);
  git(repositoryRoot, ['config', 'user.email', 'sec@example.invalid']);
  writeFileSync(path.join(repositoryRoot, 'base.txt'), 'base\n');
  git(repositoryRoot, ['add', 'base.txt']);
  git(repositoryRoot, ['commit', '-m', 'base']);
  git(repositoryRoot, ['checkout', '-b', 'fix/example']);
  writeFileSync(path.join(repositoryRoot, 'feature.txt'), 'feature\n');
  git(repositoryRoot, ['add', 'feature.txt']);
  git(repositoryRoot, ['commit', '-m', 'feature']);
  const headSha = git(repositoryRoot, ['rev-parse', 'HEAD']);
  git(repositoryRoot, ['checkout', 'main']);
  git(repositoryRoot, ['merge', '--no-ff', 'fix/example', '-m', 'merge feature']);
  const mainSha = git(repositoryRoot, ['rev-parse', 'HEAD']);
  git(repositoryRoot, ['remote', 'add', 'origin', 'https://github.com/sec-platform/sec.git']);
  git(repositoryRoot, ['branch', 'release', 'main']);
  git(repositoryRoot, ['update-ref', 'refs/remotes/origin/release', mainSha]);
  git(repositoryRoot, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/release']);
  const calls: string[][] = [];
  let observedMainSha = mainSha;
  let observedPrHeadSha = headSha;
  let observedPrMergeSha = mainSha;
  const run = (command: 'gh' | 'git', args: readonly string[], cwd: string, input?: string) => {
    calls.push([command, ...args]);
    if (command === 'gh') {
      if (args[0] === 'repo') {
        if (JSON.stringify(args) !== JSON.stringify([
          'repo', 'view', 'sec-platform/sec', '--json', 'nameWithOwner,defaultBranchRef'
        ])) {
          return {
            status: 1,
            stdout: Buffer.alloc(0),
            stderr: Buffer.from(`unexpected gh repo view argv: ${args.join(' ')}`)
          };
        }
        return {
          status: 0,
          stdout: Buffer.from(JSON.stringify({
            nameWithOwner: 'sec-platform/sec',
            defaultBranchRef: { name: 'main' }
          })),
          stderr: Buffer.alloc(0)
        };
      }
      return {
        status: 0,
        stdout: Buffer.from(JSON.stringify([{
          number: 42,
          headRefName: 'fix/example',
          headRefOid: observedPrHeadSha,
          baseRefName: 'main',
          state: 'MERGED',
          mergeCommit: { oid: observedPrMergeSha },
          url: 'https://github.com/sec-platform/sec/pull/42'
        }])),
        stderr: Buffer.alloc(0)
      };
    }
    if (args.includes('ls-remote')) {
      return {
        status: 0,
        stdout: Buffer.from(`${observedMainSha}\trefs/heads/main\n${mainSha}\trefs/heads/release\n`),
        stderr: Buffer.alloc(0)
      };
    }
    const result = spawnSync('git', [...args], {
      cwd,
      ...(input === undefined ? {} : { input: Buffer.from(input, 'utf8') }),
      encoding: null,
      windowsHide: true
    });
    return {
      status: result.status,
      stdout: Buffer.from(result.stdout ?? ''),
      stderr: Buffer.from(result.stderr ?? result.error?.message ?? '')
    };
  };
  return {
    root,
    repositoryRoot,
    recoveryRoot,
    headSha,
    mainSha,
    calls,
    run,
    setObservedMainSha: (sha: string) => { observedMainSha = sha; },
    setObservedMergedPr: (head: string, merge: string) => {
      observedPrHeadSha = head;
      observedPrMergeSha = merge;
    },
    dispose: () => rmSync(root, { recursive: true, force: true })
  };
}

function materializeLegacyPending(fixture: ReturnType<typeof createEffectFixture>): void {
  const commonDir = path.join(fixture.repositoryRoot, '.git');
  const store = acquireBranchRecoveryStore({ repositoryRoot: fixture.repositoryRoot,
    commonDir, worktreeRoots: [fixture.repositoryRoot], recoveryRoot: fixture.recoveryRoot });
  const identity = branchLifecycleDigest({ schema: 'sec-local-branch-residue-recovery-v1',
    branch: 'fix/example', headSha: fixture.headSha, pullRequestNumber: 42 });
  const bundleName = `sec-local-branch-residue-fix-example-${identity.slice(7)}.bundle`;
  const temporaryBundle = path.join(fixture.root, 'legacy-pending.bundle');
  git(fixture.repositoryRoot, ['bundle', 'create', temporaryBundle, 'refs/heads/fix/example']);
  const bytes = readFileSync(temporaryBundle);
  const bundleDigest = `sha256:${createHash('sha256').update(bytes).digest('hex')}` as const;
  store.publishExclusive({ name: bundleName, bytes, validate: (candidate) => {
    if (!Buffer.from(candidate).equals(bytes)) throw new Error('Legacy bundle fixture changed.');
  } });
  const checksumName = `${bundleName}.sha256`;
  const checksum = Buffer.from(`${bundleDigest.slice(7)}  ${bundleName}\n`);
  store.publishExclusive({ name: checksumName, bytes: checksum, validate: (candidate) => {
    if (!Buffer.from(candidate).equals(checksum)) throw new Error('Legacy checksum fixture changed.');
  } });
  const bundle = store.inspectFile(bundleName)!;
  const sidecar = store.inspectFile(checksumName)!;
  const physical = (directory: string) => {
    const chain = inspectNoFollowDirectoryChain(directory, 'legacy fixture directory');
    return { path: chain.target.path, finalPath: chain.target.finalPath,
      device: chain.target.device, inode: chain.target.inode, objectId: chain.target.objectId,
      ancestorChainDigest: branchLifecycleDigest(chain.ancestors) };
  };
  const entry = { branch: 'fix/example', headSha: fixture.headSha,
    pullRequestNumber: 42, mergeCommitSha: fixture.mainSha,
    pullRequestUrl: 'https://github.com/sec-platform/sec/pull/42',
    recovery: { path: path.join(store.root.path, bundleName), digest: bundleDigest,
      device: bundle.device, inode: bundle.inode,
      checksumDevice: sidecar.device, checksumInode: sidecar.inode } };
  const material = { schema: 'sec-local-branch-residue-closeout-authorization-v1',
    repository: 'sec-platform/sec', repositoryRoot: fixture.repositoryRoot,
    commonDir, remote: 'origin', remoteUrl: 'https://github.com/sec-platform/sec.git',
    repositoryPhysical: physical(fixture.repositoryRoot), commonDirPhysical: physical(commonDir),
    recoveryRootPhysical: physical(fixture.recoveryRoot), remoteMainSha: fixture.mainSha,
    defaultBranch: 'main', entries: [entry] };
  const operationId = branchLifecycleDigest(material);
  const unsigned = { ...material, operationId, authorizedAt: '2026-08-22T00:00:00.000Z' };
  const authorization = { ...unsigned, authorizationDigest: branchLifecycleDigest(unsigned) };
  const name = `sec-local-branch-residue-${operationId.slice(7)}.authorization.json`;
  const canonical = Buffer.from(`${JSON.stringify(authorization, null, 2)}\n`);
  store.publishExclusive({ name, bytes: canonical, validate: (candidate) => {
    if (!Buffer.from(candidate).equals(canonical)) throw new Error('Legacy authorization fixture changed.');
  } });
}

function materializeCompletedReviewedRetention(fixture: ReturnType<typeof createEffectFixture>): void {
  git(fixture.repositoryRoot, ['branch', '-D', 'fix/example']);
  const commonDir = path.join(fixture.repositoryRoot, '.git');
  const store = acquireBranchRecoveryStore({ repositoryRoot: fixture.repositoryRoot,
    commonDir, worktreeRoots: [fixture.repositoryRoot], recoveryRoot: fixture.recoveryRoot });
  const physical = (directory: string) => {
    const chain = inspectNoFollowDirectoryChain(directory, 'reviewed retention fixture directory');
    return { path: chain.target.path, finalPath: chain.target.finalPath,
      device: chain.target.device, inode: chain.target.inode, objectId: chain.target.objectId,
      ancestorChainDigest: branchLifecycleDigest(chain.ancestors) };
  };
  const sourceTreeSha = git(fixture.repositoryRoot, ['rev-parse', `${fixture.headSha}^{tree}`]);
  const mainTreeSha = git(fixture.repositoryRoot, ['rev-parse', `${fixture.mainSha}^{tree}`]);
  const entries = [{
    branch: 'fix/example', headSha: fixture.headSha, sourceTreeSha,
    mainSha: fixture.mainSha, mainTreeSha, basis: 'reviewed-supersession',
    review: {
      pullRequestNumber: 99,
      commentId: 123,
      reference: 'https://github.com/sec-platform/sec/pull/99#issuecomment-123',
      receiptDigest: branchLifecycleDigest({ fixture: 'review-receipt' }),
      headSha: fixture.headSha,
      headTreeSha: sourceTreeSha,
      pathSet: { count: 1, digest: branchLifecycleDigest({ fixture: 'review-path-set' }) }
    }
  }] as const;
  const material = {
    schema: 'sec-local-branch-residue-closeout-authorization-v2',
    repository: 'sec-platform/sec', repositoryRoot: fixture.repositoryRoot,
    commonDir, remote: 'origin', remoteUrl: 'https://github.com/sec-platform/sec.git',
    repositoryPhysical: physical(fixture.repositoryRoot), commonDirPhysical: physical(commonDir),
    recoveryRootPhysical: physical(fixture.recoveryRoot), remoteMainSha: fixture.mainSha,
    defaultBranch: 'main', entries
  } as const;
  const operationId = branchLifecycleDigest(material);
  const unsigned = { ...material, operationId, authorizedAt: '2026-08-22T00:00:00.000Z' } as const;
  const authorization = { ...unsigned, authorizationDigest: branchLifecycleDigest(unsigned) } as const;
  const receiptMaterial = {
    schema: 'sec-local-branch-residue-closeout-receipt-v2',
    operationId,
    authorizationDigest: authorization.authorizationDigest,
    repository: authorization.repository,
    remoteMainSha: authorization.remoteMainSha,
    entries: authorization.entries,
    effect: 'delete-exact-transaction',
    completedAt: '2026-08-22T00:01:00.000Z'
  } as const;
  const receipt = { ...receiptMaterial, receiptDigest: branchLifecycleDigest(receiptMaterial) } as const;
  const suffix = operationId.slice('sha256:'.length);
  for (const [name, value] of [
    [`sec-local-branch-residue-${suffix}.authorization.json`, authorization],
    [`sec-local-branch-residue-${suffix}.receipt.json`, receipt]
  ] as const) {
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    store.publishExclusive({ name, bytes, validate: (candidate) => {
      if (!Buffer.from(candidate).equals(bytes)) throw new Error(`Reviewed retention fixture changed: ${name}`);
    } });
  }
}

function completedDuplicateOperationReceipt(input: Readonly<{
  repositoryRoot: string;
  headSha: string;
  mainSha: string;
  recoveryPath: string;
  recoveryDigest: `sha256:${string}`;
  consumptionOperationId?: string;
}>) {
  const closeoutReceipt: BranchCloseoutReceiptObservation = {
    requirement: 'not-required',
    status: 'not-required',
    receipt: null,
    reason: null
  };
  const snapshot: BranchLifecycleInventory = {
    schema: 'sec-branch-lifecycle-inventory-v1',
    observedAt: '2026-08-22T00:00:00.000Z',
    repository: {
      root: input.repositoryRoot,
      commonDir: path.join(input.repositoryRoot, '.git'),
      fullName: 'sec-platform/sec',
      remote: 'origin',
      remoteUrl: 'https://github.com/sec-platform/sec.git',
      defaultBranch: 'main'
    },
    main: { localSha: input.mainSha, remoteSha: input.mainSha },
    localBranches: [{ branch: 'main', sha: input.mainSha }],
    remoteBranches: [{ branch: 'main', sha: input.mainSha }],
    worktrees: [{
      path: input.repositoryRoot,
      headSha: input.mainSha,
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
      headBranch: 'fix/example',
      headSha: input.headSha,
      baseBranch: 'main',
      baseSha: input.mainSha,
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
  const preparation = createBranchCloseoutPreparation({
    preparedAt: '2026-08-22T00:00:00.000Z',
    repository: snapshot.repository,
    branch: 'fix/example',
    refState: 'present',
    expectedHeadSha: input.headSha,
    expectedRemoteSha: input.headSha,
    expectedLocalSha: null,
    expectedPrHeadSha: null,
    pullRequestNumber: 42,
    pullRequestStateAtPreparation: 'merged',
    recovery: {
      kind: 'bundle',
      path: input.recoveryPath,
      sha256: input.recoveryDigest,
      verified: true,
      verifyOutput: 'ok'
    },
    worktreePathsAtPreparation: []
  });
  const receipt = createBranchCloseoutReceipt({
    generatedAt: '2026-08-22T00:01:00.000Z',
    preparation,
    request: {
      capability: 'branch-ref-closeout-v1',
      disposition: 'merged',
      durableGoal: { kind: 'main', reference: `main@${input.mainSha}` }
    },
    authorization: {
      branch: 'fix/example',
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
  const binding = createBranchCloseoutOperationBinding({
    integrationAuthorization: {
      authorizationId: 'authorization-42',
      consumptionOperationId: input.consumptionOperationId ?? 'merge-42',
      receiptDigest: `sha256:${'d'.repeat(64)}`,
      repository: 'sec-platform/sec',
      prNumber: 42,
      headSha: input.headSha
    },
    preparation,
    newMainSha: input.mainSha,
    newMainTreeSha: input.mainSha,
    candidateTreeSha: input.mainSha
  });
  return createBranchCloseoutOperationReceipt({
    binding,
    writerId: 'duplicate-family-test',
    generatedAt: '2026-08-22T00:01:00.000Z',
    remote: { state: 'observed-absent', detailDigest: input.recoveryDigest },
    local: { state: 'observed-absent', detailDigest: input.recoveryDigest },
    prune: { state: 'applied', detailDigest: input.recoveryDigest },
    receipt
  });
}

function merged(branch = 'fix/example', headSha = HEAD) {
  return {
    number: 42,
    headBranch: branch,
    headSha,
    baseBranch: 'main',
    mergeCommitSha: MERGE,
    state: 'MERGED' as const,
    url: 'https://github.com/sec-platform/sec/pull/42'
  };
}

test('plans only exact merged local-only refs and protects worktree-owned branches', () => {
  const plan = planMergedLocalBranchResidueCloseout({
    defaultBranch: 'main',
    localRefs: {
      main: MAIN,
      'fix/example': HEAD,
      'fix/current': MAIN,
      'fix/remote-survives': '4'.repeat(40),
      'fix/unknown': '5'.repeat(40)
    },
    remoteRefs: {
      main: MAIN,
      'fix/remote-survives': '4'.repeat(40)
    },
    worktreeBranches: ['main', 'fix/current'],
    worktreeRoots: ['D:\\Project\\sec'],
    mergedPullRequests: [merged()]
  });

  expect(plan).toEqual({
    eligible: [{
      branch: 'fix/example',
      headSha: HEAD,
      pullRequestNumber: 42,
      mergeCommitSha: MERGE,
      pullRequestUrl: 'https://github.com/sec-platform/sec/pull/42'
    }],
    protectedBranches: ['fix/current'],
    unresolvedBranches: ['fix/remote-survives', 'fix/unknown']
  });
});

test('prefixes never authorize a drifted PR, duplicate identity, or wrong base', () => {
  for (const mergedPullRequests of [
    [merged('fix/example', '6'.repeat(40))],
    [merged(), { ...merged(), number: 43, url: 'https://github.com/sec-platform/sec/pull/43' }],
    [{ ...merged(), baseBranch: 'release' }]
  ]) {
    expect(planMergedLocalBranchResidueCloseout({
      defaultBranch: 'main',
      localRefs: { main: MAIN, 'fix/example': HEAD },
      remoteRefs: { main: MAIN },
      worktreeBranches: ['main'],
      worktreeRoots: ['D:\\Project\\sec'],
      mergedPullRequests
    })).toMatchObject({ eligible: [], unresolvedBranches: ['fix/example'] });
  }
});

test('parses canonical merged PR facts and rejects bounded-query saturation', () => {
  expect(parseMergedPullRequestHeads(JSON.stringify([{
    number: 42,
    headRefName: 'fix/example',
    headRefOid: HEAD,
    baseRefName: 'main',
    state: 'MERGED',
    mergeCommit: { oid: MERGE },
    url: 'https://github.com/sec-platform/sec/pull/42'
  }]), 'sec-platform/sec')).toEqual([merged()]);

  const saturated = Array.from({ length: 1_000 }, (_, index) => ({
    number: index + 1,
    headRefName: `fix/example-${index}`,
    headRefOid: HEAD,
    baseRefName: 'main',
    state: 'MERGED',
    mergeCommit: { oid: MERGE },
    url: `https://github.com/sec-platform/sec/pull/${index + 1}`
  }));
  expect(() => parseMergedPullRequestHeads(
    JSON.stringify(saturated),
    'sec-platform/sec'
  )).toThrow(/bounded 1000-item limit/u);
});

test('binds repository provider identity and exact PR repository URLs', () => {
  expect(parseRepositoryProviderObservation(JSON.stringify({
    nameWithOwner: 'sec-platform/sec',
    defaultBranchRef: { name: 'main' }
  }), 'sec-platform/sec')).toEqual({
    repository: 'sec-platform/sec',
    defaultBranch: 'main'
  });
  expect(() => parseRepositoryProviderObservation(JSON.stringify({
    nameWithOwner: 'other/repository',
    defaultBranchRef: { name: 'main' }
  }), 'sec-platform/sec')).toThrow(/identity differs/u);
  expect(() => parseMergedPullRequestHeads(JSON.stringify([{
    number: 42,
    headRefName: 'fix/example',
    headRefOid: HEAD,
    baseRefName: 'main',
    state: 'MERGED',
    mergeCommit: { oid: MERGE },
    url: 'https://github.com/other/repository/pull/42'
  }]), 'sec-platform/sec')).toThrow(/URL differs/u);
});

for (const boundary of ['afterAuthorization', 'afterDelete', 'afterReadback', 'afterReceipt'] as const) {
  test(`resumes the same durable authorization after ${boundary}`, async () => {
    const fixture = createEffectFixture(boundary);
    try {
      await expect(executeMergedLocalBranchResidueCloseout({
        repositoryRoot: fixture.repositoryRoot,
        recoveryRoot: fixture.recoveryRoot,
        run: fixture.run,
        now: () => new Date('2026-08-22T00:00:00.000Z'),
        faults: { [boundary]: () => { throw new Error(`fault:${boundary}`); } }
      })).rejects.toThrow(`fault:${boundary}`);

      const authorizationNames = readdirSync(fixture.recoveryRoot)
        .filter((name) => name.endsWith('.authorization.json'));
      expect(authorizationNames).toHaveLength(1);
      expect(readdirSync(fixture.recoveryRoot)
        .filter((name) => name.endsWith('.receipt.json')))
        .toHaveLength(boundary === 'afterReceipt' ? 1 : 0);
      if (boundary === 'afterReceipt') {
        const terminalReceipt = readdirSync(fixture.recoveryRoot)
          .find((name) => name.endsWith('.receipt.json'))!;
        rmSync(path.join(fixture.recoveryRoot, terminalReceipt));
      }
      expect(refExists(fixture.repositoryRoot, 'refs/heads/fix/example'))
        .toBe(boundary === 'afterAuthorization');

      const result = await executeMergedLocalBranchResidueCloseout({
        repositoryRoot: fixture.repositoryRoot,
        recoveryRoot: fixture.recoveryRoot,
        run: fixture.run,
        now: () => new Date('2026-08-22T00:01:00.000Z')
      });
      expect(result.settled).toEqual(['fix/example']);
      expect(readdirSync(fixture.recoveryRoot)
        .filter((name) => name.endsWith('.authorization.json'))).toEqual([]);
      expect(readdirSync(fixture.recoveryRoot)
        .filter((name) => name.endsWith('.receipt.json'))).toHaveLength(0);
      expect(readdirSync(fixture.recoveryRoot)
        .filter((name) => name.endsWith('.bundle') || name.endsWith('.bundle.sha256'))).toEqual([]);
      expect(result.authorizationPath).toBeNull();
      expect(result.receiptPath).toBeNull();
      expect(result.retiredRecoveryFiles.length).toBeGreaterThanOrEqual(2);
      const ref = spawnSync('git', ['show-ref', '--verify', '--quiet', 'refs/heads/fix/example'], {
        cwd: fixture.repositoryRoot,
        windowsHide: true
      });
      expect(ref.status).not.toBe(0);
      expect(fixture.calls.some((call) => call.includes('symbolic-ref'))).toBeFalse();
      expect(fixture.calls.filter(([command]) => command === 'gh')
        .every((call) => call.includes('sec-platform/sec'))).toBeTrue();
      expect(fixture.calls.filter((call) => call[0] === 'gh' && call[1] === 'repo')
        .every((call) => JSON.stringify(call.slice(1)) === JSON.stringify([
          'repo', 'view', 'sec-platform/sec', '--json', 'nameWithOwner,defaultBranchRef'
        ]))).toBeTrue();
      expect(fixture.calls.filter((call) => call[0] === 'gh' && call[1] === 'pr')
        .every((call) => call.includes('--repo') && call.includes('sec-platform/sec'))).toBeTrue();
      expect(fixture.calls.filter((call) => call.includes('bundle') && call.includes('create')))
        .toHaveLength(0);
      expect(fixture.calls.filter((call) => call.includes('ls-remote'))
        .every((call) => call.at(-1) === 'https://github.com/sec-platform/sec.git'))
        .toBeTrue();
    } finally {
      fixture.dispose();
    }
  }, 30_000);
}

test('completed reviewed retention retires from its durable receipt without re-fetching the review', async () => {
  const fixture = createEffectFixture('completed-reviewed-retirement');
  try {
    materializeCompletedReviewedRetention(fixture);
    const result = await executeMergedLocalBranchResidueCloseout({
      repositoryRoot: fixture.repositoryRoot,
      recoveryRoot: fixture.recoveryRoot,
      run: fixture.run,
      now: () => new Date('2026-08-22T00:02:00.000Z')
    });
    expect(result.settled).toContain('fix/example');
    expect(readdirSync(fixture.recoveryRoot)
      .filter((name) => name.includes('sec-local-branch-residue-'))).toEqual([]);
  } finally {
    fixture.dispose();
  }
}, 30_000);

test('terminal settlement removes the duplicate branch-closeout bundle family', async () => {
  const fixture = createEffectFixture('duplicate-bundle-retirement');
  try {
    materializeLegacyPending(fixture);
    await expect(executeMergedLocalBranchResidueCloseout({
      repositoryRoot: fixture.repositoryRoot,
      recoveryRoot: fixture.recoveryRoot,
      run: fixture.run,
      now: () => new Date('2026-08-22T00:00:00.000Z'),
      faults: {
        afterDelete: () => {
          const authorizationName = readdirSync(fixture.recoveryRoot)
            .find((name) => name.endsWith('.authorization.json'))!;
          const authorization = JSON.parse(
            readFileSync(path.join(fixture.recoveryRoot, authorizationName), 'utf8')
          ) as { entries: Array<{ recovery: { path: string } }> };
          const original = readFileSync(authorization.entries[0]!.recovery.path);
          const duplicateName = `sec-branch-closeout-fix-example-1-1-${fixture.headSha.slice(0, 12)}.bundle`;
          writeFileSync(path.join(fixture.recoveryRoot, duplicateName), original);
          const digest = createHash('sha256').update(original).digest('hex');
          writeFileSync(
            path.join(fixture.recoveryRoot, `${duplicateName}.sha256`),
            `${digest}  ${duplicateName}\n`
          );
          const operationReceipt = completedDuplicateOperationReceipt({
            repositoryRoot: fixture.repositoryRoot,
            headSha: fixture.headSha,
            mainSha: fixture.mainSha,
            recoveryPath: path.join(fixture.recoveryRoot, duplicateName),
            recoveryDigest: `sha256:${digest}`
          });
          const preparationMaterial = {
            schema: BRANCH_CLOSEOUT_PREPARED_ENVELOPE_SCHEMA,
            preparation: operationReceipt.receipt.preparation,
            before: operationReceipt.receipt.before,
            attempts: [],
            foreignWorktreeObservations: []
          };
          writeFileSync(
            path.join(fixture.recoveryRoot, `${duplicateName}.preparation.json`),
            `${JSON.stringify({
              ...preparationMaterial,
              envelopeDigest: branchLifecycleDigest(preparationMaterial)
            }, null, 2)}\n`
          );
          writeFileSync(
            path.join(
              fixture.recoveryRoot,
              `${duplicateName}.closeout-${operationReceipt.binding.closeoutOperationId.slice('sha256:'.length)}.receipt.json`
            ),
            `${JSON.stringify(operationReceipt, null, 2)}\n`
          );
          throw new Error('fault:duplicate-ready');
        }
      }
    })).rejects.toThrow('fault:duplicate-ready');

    const result = await executeMergedLocalBranchResidueCloseout({
      repositoryRoot: fixture.repositoryRoot,
      recoveryRoot: fixture.recoveryRoot,
      run: fixture.run,
      now: () => new Date('2026-08-22T00:01:00.000Z')
    });
    expect(result.settled).toEqual(['fix/example']);
    expect(readdirSync(fixture.recoveryRoot)).toEqual([]);
    expect(result.retiredRecoveryFiles.some((file) => file.includes('sec-branch-closeout-fix-example')))
      .toBeTrue();
  } finally {
    fixture.dispose();
  }
}, 30_000);

test('completed duplicate attempt cannot retire a newer pending operation in the same family', async () => {
  const fixture = createEffectFixture('duplicate-pending-operation');
  let duplicateName = '';
  let completedReceiptName = '';
  let pendingJournalName = '';
  try {
    materializeLegacyPending(fixture);
    await expect(executeMergedLocalBranchResidueCloseout({
      repositoryRoot: fixture.repositoryRoot,
      recoveryRoot: fixture.recoveryRoot,
      run: fixture.run,
      now: () => new Date('2026-08-22T00:00:00.000Z'),
      faults: {
        afterDelete: () => {
          const authorizationName = readdirSync(fixture.recoveryRoot)
            .find((name) => name.endsWith('.authorization.json'))!;
          const authorization = JSON.parse(
            readFileSync(path.join(fixture.recoveryRoot, authorizationName), 'utf8')
          ) as { entries: Array<{ recovery: { path: string } }> };
          const original = readFileSync(authorization.entries[0]!.recovery.path);
          duplicateName = `sec-branch-closeout-fix-example-1-1-${fixture.headSha.slice(0, 12)}.bundle`;
          writeFileSync(path.join(fixture.recoveryRoot, duplicateName), original);
          const digest = createHash('sha256').update(original).digest('hex');
          writeFileSync(
            path.join(fixture.recoveryRoot, `${duplicateName}.sha256`),
            `${digest}  ${duplicateName}\n`
          );
          const completed = completedDuplicateOperationReceipt({
            repositoryRoot: fixture.repositoryRoot,
            headSha: fixture.headSha,
            mainSha: fixture.mainSha,
            recoveryPath: path.join(fixture.recoveryRoot, duplicateName),
            recoveryDigest: `sha256:${digest}`,
            consumptionOperationId: 'merge-completed'
          });
          const pending = completedDuplicateOperationReceipt({
            repositoryRoot: fixture.repositoryRoot,
            headSha: fixture.headSha,
            mainSha: fixture.mainSha,
            recoveryPath: path.join(fixture.recoveryRoot, duplicateName),
            recoveryDigest: `sha256:${digest}`,
            consumptionOperationId: 'merge-pending'
          });
          completedReceiptName = `${duplicateName}.closeout-${completed.binding.closeoutOperationId.slice('sha256:'.length)}.receipt.json`;
          writeFileSync(path.join(fixture.recoveryRoot, completedReceiptName), `${JSON.stringify(completed, null, 2)}\n`);
          const pendingJournal = createBranchCloseoutOperationJournal({
            binding: pending.binding,
            writerId: 'duplicate-family-test',
            remote: { state: 'not-started', detailDigest: null },
            local: { state: 'not-started', detailDigest: null },
            prune: { state: 'not-started', detailDigest: null },
            terminalReceiptDigest: null
          });
          pendingJournalName = `${duplicateName}.closeout-${pending.binding.closeoutOperationId.slice('sha256:'.length)}.journal.json`;
          writeFileSync(
            path.join(fixture.recoveryRoot, pendingJournalName),
            `${JSON.stringify(pendingJournal, null, 2)}\n`
          );
          throw new Error('fault:duplicate-pending-ready');
        }
      }
    })).rejects.toThrow('fault:duplicate-pending-ready');

    const result = await executeMergedLocalBranchResidueCloseout({
      repositoryRoot: fixture.repositoryRoot,
      recoveryRoot: fixture.recoveryRoot,
      run: fixture.run,
      now: () => new Date('2026-08-22T00:01:00.000Z')
    });
    expect(result.settled).toEqual(['fix/example']);
    expect(existsSync(path.join(fixture.recoveryRoot, duplicateName))).toBeTrue();
    expect(existsSync(path.join(fixture.recoveryRoot, `${duplicateName}.sha256`))).toBeTrue();
    expect(existsSync(path.join(fixture.recoveryRoot, completedReceiptName))).toBeTrue();
    expect(existsSync(path.join(fixture.recoveryRoot, pendingJournalName))).toBeTrue();
  } finally {
    fixture.dispose();
  }
}, 30_000);

test('pure duplicate bundle and checksum retire without lifecycle evidence', async () => {
  const fixture = createEffectFixture('duplicate-bundle-only-retirement');
  let duplicateName = '';
  try {
    materializeLegacyPending(fixture);
    await expect(executeMergedLocalBranchResidueCloseout({
      repositoryRoot: fixture.repositoryRoot,
      recoveryRoot: fixture.recoveryRoot,
      run: fixture.run,
      now: () => new Date('2026-08-22T00:00:00.000Z'),
      faults: {
        afterDelete: () => {
          const authorizationName = readdirSync(fixture.recoveryRoot)
            .find((name) => name.endsWith('.authorization.json'))!;
          const authorization = JSON.parse(
            readFileSync(path.join(fixture.recoveryRoot, authorizationName), 'utf8')
          ) as { entries: Array<{ recovery: { path: string } }> };
          const original = readFileSync(authorization.entries[0]!.recovery.path);
          duplicateName = `sec-branch-closeout-fix-example-1-1-${fixture.headSha.slice(0, 12)}.bundle`;
          writeFileSync(path.join(fixture.recoveryRoot, duplicateName), original);
          const digest = createHash('sha256').update(original).digest('hex');
          writeFileSync(
            path.join(fixture.recoveryRoot, `${duplicateName}.sha256`),
            `${digest}  ${duplicateName}\n`
          );
          throw new Error('fault:bundle-only-duplicate-ready');
        }
      }
    })).rejects.toThrow('fault:bundle-only-duplicate-ready');

    const result = await executeMergedLocalBranchResidueCloseout({
      repositoryRoot: fixture.repositoryRoot,
      recoveryRoot: fixture.recoveryRoot,
      run: fixture.run,
      now: () => new Date('2026-08-22T00:01:00.000Z')
    });
    expect(result.settled).toEqual(['fix/example']);
    expect(existsSync(path.join(fixture.recoveryRoot, duplicateName))).toBeFalse();
    expect(existsSync(path.join(fixture.recoveryRoot, `${duplicateName}.sha256`))).toBeFalse();
    expect(readdirSync(fixture.recoveryRoot)).toEqual([]);
  } finally {
    fixture.dispose();
  }
}, 30_000);

test('malformed duplicate terminal filenames cannot authorize recovery retirement', async () => {
  const fixture = createEffectFixture('malformed-duplicate-terminal');
  let duplicateBundle = '';
  try {
    materializeLegacyPending(fixture);
    await expect(executeMergedLocalBranchResidueCloseout({
      repositoryRoot: fixture.repositoryRoot,
      recoveryRoot: fixture.recoveryRoot,
      run: fixture.run,
      now: () => new Date('2026-08-22T00:00:00.000Z'),
      faults: {
        afterDelete: () => {
          const authorizationName = readdirSync(fixture.recoveryRoot)
            .find((name) => name.endsWith('.authorization.json'))!;
          const authorization = JSON.parse(
            readFileSync(path.join(fixture.recoveryRoot, authorizationName), 'utf8')
          ) as { entries: Array<{ recovery: { path: string } }> };
          const original = readFileSync(authorization.entries[0]!.recovery.path);
          duplicateBundle = `sec-branch-closeout-fix-example-1-1-${fixture.headSha.slice(0, 12)}.bundle`;
          writeFileSync(path.join(fixture.recoveryRoot, duplicateBundle), original);
          const digest = createHash('sha256').update(original).digest('hex');
          writeFileSync(
            path.join(fixture.recoveryRoot, `${duplicateBundle}.sha256`),
            `${digest}  ${duplicateBundle}\n`
          );
          const operationReceipt = completedDuplicateOperationReceipt({
            repositoryRoot: fixture.repositoryRoot,
            headSha: fixture.headSha,
            mainSha: fixture.mainSha,
            recoveryPath: path.join(fixture.recoveryRoot, duplicateBundle),
            recoveryDigest: `sha256:${digest}`
          });
          const validName = `${duplicateBundle}.closeout-${operationReceipt.binding.closeoutOperationId.slice('sha256:'.length)}.receipt.json`;
          const malformedName = `${duplicateBundle}.closeout-${'f'.repeat(64)}.receipt.json`;
          expect(validName.localeCompare(malformedName)).toBeLessThan(0);
          writeFileSync(
            path.join(fixture.recoveryRoot, validName),
            `${JSON.stringify(operationReceipt, null, 2)}\n`
          );
          writeFileSync(path.join(fixture.recoveryRoot, malformedName), '{}\n');
          throw new Error('fault:malformed-duplicate-ready');
        }
      }
    })).rejects.toThrow('fault:malformed-duplicate-ready');

    await expect(executeMergedLocalBranchResidueCloseout({
      repositoryRoot: fixture.repositoryRoot,
      recoveryRoot: fixture.recoveryRoot,
      run: fixture.run,
      now: () => new Date('2026-08-22T00:01:00.000Z')
    })).rejects.toThrow('operation receipt schema mismatch');
    expect(existsSync(path.join(fixture.recoveryRoot, duplicateBundle))).toBeTrue();
    expect(existsSync(path.join(
      fixture.recoveryRoot,
      `${duplicateBundle}.closeout-${'f'.repeat(64)}.receipt.json`
    ))).toBeTrue();
  } finally {
    fixture.dispose();
  }
}, 30_000);

test('orphan completion receipt is retained when its local branch is recreated at the effect boundary', async () => {
  const fixture = createEffectFixture('orphan-recreated-ref');
  try {
    materializeLegacyPending(fixture);
    await expect(executeMergedLocalBranchResidueCloseout({
      repositoryRoot: fixture.repositoryRoot,
      recoveryRoot: fixture.recoveryRoot,
      run: fixture.run,
      now: () => new Date('2026-08-22T00:00:00.000Z'),
      faults: { afterReceipt: () => { throw new Error('fault:orphan-receipt-ready'); } }
    })).rejects.toThrow('fault:orphan-receipt-ready');
    const authorizationName = readdirSync(fixture.recoveryRoot)
      .find((name) => name.endsWith('.authorization.json'))!;
    const receiptName = authorizationName.replace('.authorization.json', '.receipt.json');
    rmSync(path.join(fixture.recoveryRoot, authorizationName));
    let recreated = false;
    const run = (command: 'gh' | 'git', args: readonly string[], cwd: string, input?: string) => {
      const result = fixture.run(command, args, cwd, input);
      if (!recreated && command === 'git' && args[0] === 'merge-base') {
        git(fixture.repositoryRoot, ['branch', 'fix/example', fixture.headSha]);
        recreated = true;
      }
      return result;
    };

    await expect(executeMergedLocalBranchResidueCloseout({
      repositoryRoot: fixture.repositoryRoot,
      recoveryRoot: fixture.recoveryRoot,
      run,
      now: () => new Date('2026-08-22T00:01:00.000Z')
    })).rejects.toThrow('followed by ref recreation');
    expect(recreated).toBeTrue();
    expect(existsSync(path.join(fixture.recoveryRoot, receiptName))).toBeTrue();
  } finally {
    fixture.dispose();
  }
}, 30_000);

test('default recovery root is not left behind after terminal settlement', async () => {
  const fixture = createEffectFixture('default-root-retirement');
  const defaultRecoveryRoot = path.join(
    path.dirname(fixture.repositoryRoot),
    `${path.basename(fixture.repositoryRoot)}-recovery`
  );
  try {
    const result = await executeMergedLocalBranchResidueCloseout({
      repositoryRoot: fixture.repositoryRoot,
      run: fixture.run,
      now: () => new Date('2026-08-22T00:00:00.000Z')
    });
    expect(result.settled).toEqual(['fix/example']);
    expect(result.recoveryRootRetired).toBeTrue();
    expect(existsSync(defaultRecoveryRoot)).toBeFalse();
  } finally {
    fixture.dispose();
  }
}, 30_000);

test('retains a non-ancestor local commit by exact merged-PR tree anchor after main advances', async () => {
  const fixture = createEffectFixture('merged-anchor-after-main-advance');
  try {
    const baseSha = git(fixture.repositoryRoot, ['rev-parse', `${fixture.mainSha}^1`]);
    const absorbedTree = git(fixture.repositoryRoot, ['rev-parse', `${fixture.mainSha}^{tree}`]);
    const siblingSha = git(fixture.repositoryRoot,
      ['commit-tree', absorbedTree, '-p', baseSha], 'sibling with absorbed tree\n');
    git(fixture.repositoryRoot, ['update-ref', 'refs/heads/fix/example', siblingSha]);
    fixture.setObservedMergedPr(siblingSha, fixture.mainSha);
    writeFileSync(path.join(fixture.repositoryRoot, 'later-main.txt'), 'later\n');
    git(fixture.repositoryRoot, ['add', 'later-main.txt']);
    git(fixture.repositoryRoot, ['commit', '-m', 'advance main after absorption']);
    const currentMainSha = git(fixture.repositoryRoot, ['rev-parse', 'HEAD']);
    fixture.setObservedMainSha(currentMainSha);
    expect(spawnSync('git', ['merge-base', '--is-ancestor', siblingSha, currentMainSha],
      { cwd: fixture.repositoryRoot, windowsHide: true }).status).toBe(1);
    await expect(executeMergedLocalBranchResidueCloseout({
      repositoryRoot: fixture.repositoryRoot, recoveryRoot: fixture.recoveryRoot,
      run: fixture.run,
      faults: { afterAuthorization: () => { throw new Error('fault:inspect-anchor'); } }
    })).rejects.toThrow('fault:inspect-anchor');
    const name = readdirSync(fixture.recoveryRoot)
      .find((candidate) => candidate.endsWith('.authorization.json'))!;
    const authorization = JSON.parse(readFileSync(path.join(fixture.recoveryRoot, name), 'utf8')) as {
      schema: string; remoteMainSha: string;
      entries: Array<{ headSha: string; mainSha: string; basis: string }>;
    };
    expect(authorization.schema).toBe('sec-local-branch-residue-closeout-authorization-v2');
    expect(authorization.remoteMainSha).toBe(currentMainSha);
    expect(authorization.entries[0]).toMatchObject({
      headSha: siblingSha, mainSha: fixture.mainSha, basis: 'identical-tree'
    });
    const result = await executeMergedLocalBranchResidueCloseout({
      repositoryRoot: fixture.repositoryRoot, recoveryRoot: fixture.recoveryRoot,
      run: fixture.run
    });
    expect(result.settled).toEqual(['fix/example']);
    expect(refExists(fixture.repositoryRoot, 'refs/heads/fix/example')).toBeFalse();
    expect(readdirSync(fixture.recoveryRoot)).toEqual([]);
  } finally {
    fixture.dispose();
  }
}, 30_000);

test('no-op settlement preserves caller-owned recovery roots and retires only its created chain', async () => {
  for (const recoveryCase of [
    { name: 'absent', preexisting: false, sentinel: false, expectedPresent: false },
    { name: 'preexisting-empty', preexisting: true, sentinel: false, expectedPresent: true },
    { name: 'preexisting-nonempty', preexisting: true, sentinel: true, expectedPresent: true }
  ] as const) {
    const fixture = createEffectFixture(`custom-root-${recoveryCase.name}`);
    const customParent = path.join(fixture.root, `custom-${recoveryCase.name}`);
    const customRoot = path.join(customParent, 'recovery');
    try {
      git(fixture.repositoryRoot, ['branch', '-D', 'fix/example']);
      if (recoveryCase.preexisting) mkdirSync(customRoot, { recursive: true });
      if (recoveryCase.sentinel) writeFileSync(path.join(customRoot, 'caller-owned.txt'), 'preserve\n');
      const result = await executeMergedLocalBranchResidueCloseout({
        repositoryRoot: fixture.repositoryRoot,
        recoveryRoot: customRoot,
        run: fixture.run,
        now: () => new Date('2026-08-22T00:00:00.000Z')
      });
      expect(result.settled).toEqual([]);
      expect(result.recoveryRootRetired).toBe(!recoveryCase.expectedPresent);
      expect(existsSync(customRoot)).toBe(recoveryCase.expectedPresent);
      if (!recoveryCase.preexisting) expect(existsSync(customParent)).toBeFalse();
      if (recoveryCase.sentinel) {
        expect(readFileSync(path.join(customRoot, 'caller-owned.txt'), 'utf8')).toBe('preserve\n');
      }
    } finally {
      fixture.dispose();
    }
  }
}, 30_000);

test('fails closed on recovery target substitution and unsafe recovery roots', async () => {
  const fixture = createEffectFixture('recovery-boundary');
  try {
    const commonDir = path.join(fixture.repositoryRoot, '.git');
    expect(() => acquireBranchRecoveryStore({
      repositoryRoot: fixture.repositoryRoot,
      commonDir,
      worktreeRoots: [fixture.repositoryRoot],
      recoveryRoot: path.join(fixture.repositoryRoot, 'caller-owned')
    })).toThrow(/physically separate/u);

    const target = path.join(fixture.root, 'foreign-recovery-target');
    const alias = path.join(fixture.root, 'recovery-alias');
    mkdirSync(target);
    symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => acquireBranchRecoveryStore({
      repositoryRoot: fixture.repositoryRoot,
      commonDir,
      worktreeRoots: [fixture.repositoryRoot],
      recoveryRoot: alias
    })).toThrow();

    await expect(executeMergedLocalBranchResidueCloseout({
      repositoryRoot: fixture.repositoryRoot,
      recoveryRoot: fixture.recoveryRoot,
      run: fixture.run,
      now: () => new Date('2026-08-22T00:00:00.000Z'),
      faults: {
        afterAuthorization: () => {
          const authorization = readdirSync(fixture.recoveryRoot)
            .find((name) => name.endsWith('.authorization.json'))!;
          writeFileSync(path.join(fixture.recoveryRoot, authorization), 'substituted');
        }
      }
    })).rejects.toThrow(/authorization bytes changed/u);
    const ref = spawnSync('git', ['show-ref', '--verify', '--quiet', 'refs/heads/fix/example'], {
      cwd: fixture.repositoryRoot,
      windowsHide: true
    });
    expect(ref.status).toBe(0);
  } finally {
    fixture.dispose();
  }

  const parentFixture = createEffectFixture('recovery-parent-substitution');
  try {
    await expect(executeMergedLocalBranchResidueCloseout({
      repositoryRoot: parentFixture.repositoryRoot,
      recoveryRoot: parentFixture.recoveryRoot,
      run: parentFixture.run,
      now: () => new Date('2026-08-22T00:00:00.000Z'),
      faults: {
        afterAuthorization: () => {
          renameSync(parentFixture.recoveryRoot, `${parentFixture.recoveryRoot}-moved`);
          mkdirSync(parentFixture.recoveryRoot);
        }
      }
    })).rejects.toThrow(/identity changed/u);
    expect(refExists(parentFixture.repositoryRoot, 'refs/heads/fix/example')).toBeTrue();
  } finally {
    parentFixture.dispose();
  }

  const restartedFixture = createEffectFixture('cross-process-substitution');
  try {
    await expect(executeMergedLocalBranchResidueCloseout({
      repositoryRoot: restartedFixture.repositoryRoot,
      recoveryRoot: restartedFixture.recoveryRoot,
      run: restartedFixture.run,
      now: () => new Date('2026-08-22T00:00:00.000Z'),
      faults: { afterAuthorization: () => { throw new Error('simulated-process-exit'); } }
    })).rejects.toThrow('simulated-process-exit');
    const oldRepository = `${restartedFixture.repositoryRoot}-old`;
    const oldRecovery = `${restartedFixture.recoveryRoot}-old`;
    renameSync(restartedFixture.repositoryRoot, oldRepository);
    renameSync(restartedFixture.recoveryRoot, oldRecovery);
    cpSync(oldRepository, restartedFixture.repositoryRoot, { recursive: true });
    cpSync(oldRecovery, restartedFixture.recoveryRoot, { recursive: true });
    await expect(executeMergedLocalBranchResidueCloseout({
      repositoryRoot: restartedFixture.repositoryRoot,
      recoveryRoot: restartedFixture.recoveryRoot,
      run: restartedFixture.run,
      now: () => new Date('2026-08-22T00:01:00.000Z')
    })).rejects.toThrow(/physical identity changed|lease generation identity is inconsistent/u);
    expect(refExists(restartedFixture.repositoryRoot, 'refs/heads/fix/example')).toBeTrue();
  } finally {
    restartedFixture.dispose();
  }

  const dynamicWorktreeFixture = createEffectFixture('dynamic-worktree-alias');
  try {
    await expect(executeMergedLocalBranchResidueCloseout({
      repositoryRoot: dynamicWorktreeFixture.repositoryRoot,
      recoveryRoot: dynamicWorktreeFixture.recoveryRoot,
      run: dynamicWorktreeFixture.run,
      now: () => new Date('2026-08-22T00:00:00.000Z'),
      faults: {
        afterAuthorization: () => {
          const alias = path.join(dynamicWorktreeFixture.root, 'detached-worktree-alias');
          git(dynamicWorktreeFixture.repositoryRoot, ['worktree', 'add', '--detach', alias, 'main']);
          rmSync(alias, { recursive: true, force: true });
          symlinkSync(
            dynamicWorktreeFixture.recoveryRoot,
            alias,
            process.platform === 'win32' ? 'junction' : 'dir'
          );
        }
      }
    })).rejects.toThrow();
    expect(refExists(dynamicWorktreeFixture.repositoryRoot, 'refs/heads/fix/example')).toBeTrue();
  } finally {
    dynamicWorktreeFixture.dispose();
  }
}, 30_000);
