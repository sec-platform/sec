import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  executeMergedLocalBranchResidueCloseoutV1,
  parseMergedPullRequestHeadsV1,
  parseRepositoryProviderObservationV1,
  planMergedLocalBranchResidueCloseoutV1
} from '../../scripts/codex/branch-local-residue-closeout.ts';
import { acquireBranchRecoveryStoreV1 } from '../../scripts/codex/branch-recovery.ts';

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
          headRefOid: headSha,
          baseRefName: 'main',
          state: 'MERGED',
          mergeCommit: { oid: mainSha },
          url: 'https://github.com/sec-platform/sec/pull/42'
        }])),
        stderr: Buffer.alloc(0)
      };
    }
    if (args.includes('ls-remote')) {
      return {
        status: 0,
        stdout: Buffer.from(`${mainSha}\trefs/heads/main\n`),
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
    dispose: () => rmSync(root, { recursive: true, force: true })
  };
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
  const plan = planMergedLocalBranchResidueCloseoutV1({
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
    expect(planMergedLocalBranchResidueCloseoutV1({
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
  expect(parseMergedPullRequestHeadsV1(JSON.stringify([{
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
  expect(() => parseMergedPullRequestHeadsV1(
    JSON.stringify(saturated),
    'sec-platform/sec'
  )).toThrow(/bounded 1000-item limit/u);
});

test('binds repository provider identity and exact PR repository URLs', () => {
  expect(parseRepositoryProviderObservationV1(JSON.stringify({
    nameWithOwner: 'sec-platform/sec',
    defaultBranchRef: { name: 'main' }
  }), 'sec-platform/sec')).toEqual({
    repository: 'sec-platform/sec',
    defaultBranch: 'main'
  });
  expect(() => parseRepositoryProviderObservationV1(JSON.stringify({
    nameWithOwner: 'other/repository',
    defaultBranchRef: { name: 'main' }
  }), 'sec-platform/sec')).toThrow(/identity differs/u);
  expect(() => parseMergedPullRequestHeadsV1(JSON.stringify([{
    number: 42,
    headRefName: 'fix/example',
    headRefOid: HEAD,
    baseRefName: 'main',
    state: 'MERGED',
    mergeCommit: { oid: MERGE },
    url: 'https://github.com/other/repository/pull/42'
  }]), 'sec-platform/sec')).toThrow(/URL differs/u);
});

test('resumes the same durable authorization after crashes before and after the ref effect', async () => {
  for (const boundary of ['afterAuthorization', 'afterDelete', 'afterReadback'] as const) {
    const fixture = createEffectFixture(boundary);
    try {
      await expect(executeMergedLocalBranchResidueCloseoutV1({
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
        .filter((name) => name.endsWith('.receipt.json'))).toHaveLength(0);
      expect(refExists(fixture.repositoryRoot, 'refs/heads/fix/example'))
        .toBe(boundary === 'afterAuthorization');

      const result = await executeMergedLocalBranchResidueCloseoutV1({
        repositoryRoot: fixture.repositoryRoot,
        recoveryRoot: fixture.recoveryRoot,
        run: fixture.run,
        now: () => new Date('2026-08-22T00:01:00.000Z')
      });
      expect(result.settled).toEqual(['fix/example']);
      expect(readdirSync(fixture.recoveryRoot)
        .filter((name) => name.endsWith('.authorization.json'))).toEqual(authorizationNames);
      expect(readdirSync(fixture.recoveryRoot)
        .filter((name) => name.endsWith('.receipt.json'))).toHaveLength(1);
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
        .toHaveLength(1);
      expect(fixture.calls.filter((call) => call.includes('ls-remote'))
        .every((call) => call.at(-1) === 'https://github.com/sec-platform/sec.git'))
        .toBeTrue();
    } finally {
      fixture.dispose();
    }
  }
}, 30_000);

test('fails closed on recovery target substitution and unsafe recovery roots', async () => {
  const fixture = createEffectFixture('recovery-boundary');
  try {
    const commonDir = path.join(fixture.repositoryRoot, '.git');
    expect(() => acquireBranchRecoveryStoreV1({
      repositoryRoot: fixture.repositoryRoot,
      commonDir,
      worktreeRoots: [fixture.repositoryRoot],
      recoveryRoot: path.join(fixture.repositoryRoot, 'caller-owned')
    })).toThrow(/physically separate/u);

    const target = path.join(fixture.root, 'foreign-recovery-target');
    const alias = path.join(fixture.root, 'recovery-alias');
    mkdirSync(target);
    symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => acquireBranchRecoveryStoreV1({
      repositoryRoot: fixture.repositoryRoot,
      commonDir,
      worktreeRoots: [fixture.repositoryRoot],
      recoveryRoot: alias
    })).toThrow();

    await expect(executeMergedLocalBranchResidueCloseoutV1({
      repositoryRoot: fixture.repositoryRoot,
      recoveryRoot: fixture.recoveryRoot,
      run: fixture.run,
      now: () => new Date('2026-08-22T00:00:00.000Z'),
      faults: {
        afterAuthorization: () => {
          const bundle = readdirSync(fixture.recoveryRoot)
            .find((name) => name.endsWith('.bundle'))!;
          writeFileSync(path.join(fixture.recoveryRoot, bundle), 'substituted');
        }
      }
    })).rejects.toThrow(/Recovery bytes changed/u);
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
    await expect(executeMergedLocalBranchResidueCloseoutV1({
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
    await expect(executeMergedLocalBranchResidueCloseoutV1({
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
    await expect(executeMergedLocalBranchResidueCloseoutV1({
      repositoryRoot: restartedFixture.repositoryRoot,
      recoveryRoot: restartedFixture.recoveryRoot,
      run: restartedFixture.run,
      now: () => new Date('2026-08-22T00:01:00.000Z')
    })).rejects.toThrow(/physical identity changed/u);
    expect(refExists(restartedFixture.repositoryRoot, 'refs/heads/fix/example')).toBeTrue();
  } finally {
    restartedFixture.dispose();
  }

  const dynamicWorktreeFixture = createEffectFixture('dynamic-worktree-alias');
  try {
    await expect(executeMergedLocalBranchResidueCloseoutV1({
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
