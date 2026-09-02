import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import path from 'node:path';

import {
  preparationFilePath,
  prepareBranchCloseout,
  rehydratePreparedBranchCloseoutRecoveryArtifact
} from '../../src/control/branch-lifecycle/branch-closeout.ts';
import {
  createBranchLifecycleGitChildEnvironment,
  createBranchLifecycleGitHubCredentialArgs
} from '../../src/control/branch-lifecycle/branch-lifecycle-command.ts';
import { collectBranchLifecycleInventory } from '../../src/control/branch-lifecycle/branch-lifecycle-inventory.ts';
import {
  issueActiveWorkPackageOwnerObservation,
  type ActiveWorkPackageOwnerObservation
} from '../../src/control/task/contract/active-work-observation.ts';

test('canonical Git child environment removes ambient steering and preserves host integration', () => {
  const environment = createBranchLifecycleGitChildEnvironment({
    Path: 'trusted-path',
    PATH: 'duplicate-path',
    HOME: 'trusted-home',
    USERPROFILE: 'trusted-profile',
    SSH_AUTH_SOCK: 'trusted-agent',
    HTTPS_PROXY: 'trusted-proxy',
    Git_Dir: 'forged-git-dir',
    GIT_WORK_TREE: 'forged-worktree',
    GIT_INDEX_FILE: 'forged-index',
    GIT_OBJECT_DIRECTORY: 'forged-objects',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.worktree',
    GIT_CONFIG_VALUE_0: 'forged-worktree',
    git_config_key_19: 'core.fsmonitor',
    git_config_value_19: 'forged-monitor',
    GIT_CONFIG_GLOBAL: 'forged-config',
    GIT_ASKPASS_REQUIRE: 'force',
    git_no_replace_objects: '0',
    GIT_OPTIONAL_LOCKS: '1',
    GIT_TERMINAL_PROMPT: '1'
  });
  expect(Object.keys(environment).filter((name) => name.toUpperCase() === 'PATH'))
    .toHaveLength(1);
  expect(environment.Path).toBe('trusted-path');
  expect(environment.HOME).toBe('trusted-home');
  expect(environment.USERPROFILE).toBe('trusted-profile');
  expect(environment.SSH_AUTH_SOCK).toBe('trusted-agent');
  expect(environment.HTTPS_PROXY).toBe('trusted-proxy');
  expect(environment.GIT_TERMINAL_PROMPT).toBe('0');
  expect(environment.GIT_OPTIONAL_LOCKS).toBe('0');
  expect(environment.GIT_NO_REPLACE_OBJECTS).toBe('1');
  expect(environment.GIT_CONFIG_GLOBAL).toBe(process.platform === 'win32' ? 'NUL' : devNull);
  expect(Object.keys(environment).filter((name) => name.toUpperCase() === 'GIT_NO_REPLACE_OBJECTS'))
    .toEqual(['GIT_NO_REPLACE_OBJECTS']);
  for (const name of Object.keys(environment)) {
    const canonicalName = name.toUpperCase();
    expect([
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'GIT_OBJECT_DIRECTORY',
      'GIT_CONFIG_COUNT',
      'GIT_ASKPASS_REQUIRE'
    ]).not.toContain(canonicalName);
    expect(canonicalName).not.toMatch(/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/u);
  }
});

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return (result.stdout ?? '').trim();
}

function repositoryFixture(): Readonly<{
  root: string;
  remote: string;
  repository: string;
  branch: string;
  headSha: string;
  mainSha: string;
}> {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-branch-lifecycle-v6-'));
  const remote = path.join(root, 'remote.git');
  const repository = path.join(root, 'repository');
  git(root, ['init', '--bare', remote]);
  git(root, ['clone', remote, repository]);
  git(repository, ['config', 'user.name', 'SEC Test']);
  git(repository, ['config', 'user.email', 'sec-test@example.invalid']);
  git(repository, ['config', '--local', 'fetch.prune', 'true']);
  git(repository, ['config', '--local', 'remote.origin.prune', 'true']);
  git(repository, ['config', '--local', 'fetch.pruneTags', 'true']);
  writeFileSync(path.join(repository, 'README.md'), '# main\n', 'utf8');
  git(repository, ['add', 'README.md']);
  git(repository, ['commit', '-m', 'initial main']);
  git(repository, ['branch', '-M', 'main']);
  git(repository, ['push', '-u', 'origin', 'main']);
  const mainSha = git(repository, ['rev-parse', 'HEAD']);
  const branch = 'feat/v6-closeout';
  git(repository, ['switch', '-c', branch]);
  writeFileSync(path.join(repository, 'candidate.txt'), 'candidate\n', 'utf8');
  git(repository, ['add', 'candidate.txt']);
  git(repository, ['commit', '-m', 'candidate']);
  const headSha = git(repository, ['rev-parse', 'HEAD']);
  git(repository, ['push', '-u', 'origin', branch]);
  return Object.freeze({ root, remote, repository, branch, headSha, mainSha });
}

function activeWorkObservation(
  fixture: ReturnType<typeof repositoryFixture>
): ActiveWorkPackageOwnerObservation {
  // Exercise the lower admission contract directly; production module
  // topology permits only the documentation owner to call this issuer.
  return issueActiveWorkPackageOwnerObservation({
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    defaultSha: fixture.mainSha,
    observedAt: new Date().toISOString(),
    state: 'active',
    branch: fixture.branch,
    manifest: 'docs/work-packages/v6-test.md',
    reason: null
  });
}

function installGitHubObservationShim(
  fixture: ReturnType<typeof repositoryFixture>,
  pullRequests: readonly Readonly<Record<string, unknown>>[] = []
): () => void {
  const shimRoot = path.join(fixture.root, 'command-shims');
  mkdirSync(shimRoot, { recursive: true });
  const program = path.join(shimRoot, 'gh-shim.ts');
  writeFileSync(program, `
const args = process.argv.slice(2);
if (args[0] === 'pr' && args[1] === 'list') {
  process.stdout.write(${JSON.stringify(JSON.stringify(pullRequests))});
  process.exit(0);
}
if (args[0] === 'api' && args[1] === '/repos/sec-platform/sec') {
  process.stdout.write('true');
  process.exit(0);
}
process.stderr.write('unsupported test gh observation: ' + args.join(' '));
process.exit(1);
`, 'utf8');
  if (process.platform === 'win32') {
    const compiled = spawnSync('bun', [
      'build',
      '--compile',
      program,
      '--outfile',
      path.join(shimRoot, 'gh.exe')
    ], { encoding: 'utf8', windowsHide: true });
    if (compiled.status !== 0) {
      throw new Error(`cannot compile bounded gh.exe test shim: ${compiled.stderr || compiled.stdout}`);
    }
  } else {
    const shellShim = path.join(shimRoot, 'gh');
    writeFileSync(shellShim, `#!/usr/bin/env sh\nexec bun "$(dirname "$0")/gh-shim.ts" "$@"\n`, 'utf8');
    chmodSync(shellShim, 0o755);
  }
  const priorPath = process.env.PATH;
  process.env.PATH = `${shimRoot}${path.delimiter}${priorPath ?? ''}`;
  return () => {
    if (priorPath === undefined) delete process.env.PATH;
    else process.env.PATH = priorPath;
  };
}

test('V6 branch preparation is recovery-only and leaves exact local/remote refs intact', () => {
  const fixture = repositoryFixture();
  const restorePath = installGitHubObservationShim(fixture);
  try {
    const scope = {
      repositoryRoot: fixture.repository,
      repositoryFullName: 'sec-platform/sec',
      defaultBranch: 'main',
      activeWorkPackageObservation: activeWorkObservation(fixture),
      recoveryRoot: path.join(fixture.root, 'recovery')
    };
    const prepared = prepareBranchCloseout(scope, {
      branch: fixture.branch,
      expectedHeadSha: fixture.headSha
    });
    expect(prepared.preparation.expectedHeadSha).toBe(fixture.headSha);
    expect(existsSync(preparationFilePath(prepared.preparation))).toBe(true);
    expect(git(fixture.repository, ['rev-parse', `refs/heads/${fixture.branch}`]))
      .toBe(fixture.headSha);
    expect(git(fixture.repository, ['ls-remote', '--heads', 'origin', `refs/heads/${fixture.branch}`]))
      .toContain(fixture.headSha);
  } finally {
    restorePath();
    rmSync(fixture.root, { recursive: true, force: true });
  }
}, 180_000);

test('remote-absent preparation recovers the exact local branch without mutating either ref', () => {
  const fixture = repositoryFixture();
  git(fixture.repository, ['push', 'origin', '--delete', fixture.branch]);
  const restorePath = installGitHubObservationShim(fixture, [{
    number: 42,
    headRefName: fixture.branch,
    headRefOid: fixture.headSha,
    baseRefName: 'main',
    baseRefOid: fixture.mainSha,
    state: 'MERGED',
    isDraft: false,
    isCrossRepository: false,
    url: 'https://github.com/sec-platform/sec/pull/42'
  }]);
  try {
    const prepared = prepareBranchCloseout({
      repositoryRoot: fixture.repository,
      repositoryFullName: 'sec-platform/sec',
      defaultBranch: 'main',
      activeWorkPackageObservation: activeWorkObservation(fixture),
      recoveryRoot: path.join(fixture.root, 'recovery')
    }, {
      branch: fixture.branch,
      refState: 'absent',
      expectedHeadSha: fixture.headSha,
      pullRequestNumber: 42,
      expectedPrHeadSha: fixture.headSha
    });
    expect(prepared.preparation.expectedLocalSha).toBe(fixture.headSha);
    expect(prepared.preparation.recovery).not.toBeNull();
    const recovery = prepared.preparation.recovery;
    if (recovery === null) throw new Error('Expected exact local recovery authority.');
    expect(existsSync(recovery.path)).toBe(true);
    expect(git(fixture.repository, ['bundle', 'list-heads', recovery.path]))
      .toContain(fixture.headSha);
    expect(git(fixture.repository, ['rev-parse', `refs/heads/${fixture.branch}`]))
      .toBe(fixture.headSha);
    expect(git(fixture.repository, [
      'ls-remote', '--heads', 'origin', `refs/heads/${fixture.branch}`
    ])).toBe('');
  } finally {
    restorePath();
    rmSync(fixture.root, { recursive: true, force: true });
  }
}, 180_000);

test('canonical GitHub credential prefix masks checkout HTTP authorization before gh lookup', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-branch-credential-'));
  try {
    git(root, ['init']);
    git(root, ['config', 'http.https://github.com/.extraheader', 'AUTHORIZATION: ambient-checkout-token']);
    const observed = spawnSync('git', [
      ...createBranchLifecycleGitHubCredentialArgs(),
      'config', '--get-urlmatch', 'http.extraheader', 'https://github.com/sec-platform/sec.git'
    ], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true
    });
    expect(observed.status).toBe(0);
    expect(String(observed.stdout ?? '')).toBe('\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('typed inventory boundary ignores ambient repository and index steering without refreshing target index', () => {
  const fixture = repositoryFixture();
  const restorePath = installGitHubObservationShim(fixture);
  const decoy = path.join(fixture.root, 'decoy');
  const isolatedHome = path.join(fixture.root, 'home');
  mkdirSync(isolatedHome, { recursive: true });
  git(fixture.root, ['init', decoy]);
  git(decoy, ['config', 'user.name', 'SEC Decoy']);
  git(decoy, ['config', 'user.email', 'sec-decoy@example.invalid']);
  writeFileSync(path.join(decoy, 'decoy.txt'), 'decoy\n', 'utf8');
  git(decoy, ['add', 'decoy.txt']);
  git(decoy, ['commit', '-m', 'decoy']);
  const decoyGitDirectory = git(decoy, [
    'rev-parse', '--path-format=absolute', '--absolute-git-dir'
  ]);
  const decoyIndex = git(decoy, [
    'rev-parse', '--path-format=absolute', '--git-path', 'index'
  ]);
  const targetIndex = git(fixture.repository, [
    'rev-parse', '--path-format=absolute', '--git-path', 'index'
  ]);
  const targetIndexBytes = readFileSync(targetIndex);
  const targetIndexStat = statSync(targetIndex);
  const trackedPath = path.join(fixture.repository, 'candidate.txt');
  const future = new Date(Date.now() + 5_000);
  utimesSync(trackedPath, future, future);

  const hostileEnvironment: Readonly<Record<string, string>> = {
    GIT_DIR: decoyGitDirectory,
    GIT_WORK_TREE: decoy,
    GIT_COMMON_DIR: decoyGitDirectory,
    GIT_INDEX_FILE: decoyIndex,
    GIT_OBJECT_DIRECTORY: path.join(decoyGitDirectory, 'objects'),
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.worktree',
    GIT_CONFIG_VALUE_0: decoy,
    HOME: isolatedHome
  };
  const priorEnvironment = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(hostileEnvironment)) {
    priorEnvironment.set(name, process.env[name]);
    process.env[name] = value;
  }
  try {
    const inventory = collectBranchLifecycleInventory({
      repositoryRoot: fixture.repository,
      repositoryFullName: 'sec-platform/sec',
      defaultBranch: 'main',
      activeWorkPackageObservation: activeWorkObservation(fixture)
    });
    expect(inventory.localBranches.find(({ branch }) => branch === fixture.branch)?.sha)
      .toBe(fixture.headSha);
    expect(inventory.remoteBranches.find(({ branch }) => branch === fixture.branch)?.sha)
      .toBe(fixture.headSha);
    expect(readFileSync(targetIndex)).toEqual(targetIndexBytes);
    const after = statSync(targetIndex);
    expect({ dev: after.dev, ino: after.ino, size: after.size, mtimeMs: after.mtimeMs })
      .toEqual({
        dev: targetIndexStat.dev,
        ino: targetIndexStat.ino,
        size: targetIndexStat.size,
        mtimeMs: targetIndexStat.mtimeMs
      });
  } finally {
    restorePath();
    for (const [name, value] of priorEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('missing documentation-owner observation is typed unresolved and blocks before recovery effect', () => {
  const fixture = repositoryFixture();
  const restorePath = installGitHubObservationShim(fixture);
  const recoveryRoot = path.join(fixture.root, 'recovery');
  try {
    const inventory = collectBranchLifecycleInventory({
      repositoryRoot: fixture.repository,
      repositoryFullName: 'sec-platform/sec',
      defaultBranch: 'main'
    });
    expect(inventory.activeWorkPackage).toEqual({
      state: 'unresolved',
      branch: null,
      manifest: null,
      reason: 'active-work-owner-observation-unavailable'
    });
    expect(inventory.unknowns).toContain('active-work-owner-observation-unavailable');
    const issued = activeWorkObservation(fixture);
    expect(() => collectBranchLifecycleInventory({
      repositoryRoot: fixture.repository,
      repositoryFullName: 'sec-platform/sec',
      defaultBranch: 'main',
      activeWorkPackageObservation: { ...issued } as ActiveWorkPackageOwnerObservation
    })).toThrow('active-work-owner-observation-not-issued');
    expect(() => prepareBranchCloseout({
      repositoryRoot: fixture.repository,
      repositoryFullName: 'sec-platform/sec',
      defaultBranch: 'main',
      recoveryRoot
    }, {
      branch: fixture.branch,
      expectedHeadSha: fixture.headSha
    })).toThrow('active-work-owner-observation-unavailable');
    expect(existsSync(recoveryRoot)).toBe(false);

    const authorized = prepareBranchCloseout({
      repositoryRoot: fixture.repository,
      repositoryFullName: 'sec-platform/sec',
      defaultBranch: 'main',
      activeWorkPackageObservation: activeWorkObservation(fixture),
      recoveryRoot: path.join(fixture.root, 'authorized-recovery')
    }, {
      branch: fixture.branch,
      expectedHeadSha: fixture.headSha
    });
    const rehydrationRoot = path.join(fixture.root, 'blocked-rehydration');
    expect(() => rehydratePreparedBranchCloseoutRecoveryArtifact({
      scope: {
        repositoryRoot: fixture.repository,
        repositoryFullName: 'sec-platform/sec',
        defaultBranch: 'main',
        recoveryRoot: rehydrationRoot
      },
      remote: authorized,
      recoveryBundleBytes: readFileSync(authorized.preparation.recovery.path)
    })).toThrow('active-work-owner-observation-unavailable');
    expect(existsSync(rehydrationRoot)).toBe(false);
  } finally {
    restorePath();
    rmSync(fixture.root, { recursive: true, force: true });
  }
}, 180_000);
