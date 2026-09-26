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
  issueGitHubApiTestCapability,
  withGitHubApiTestSession,
  type GitHubApiTransport
} from '../../src/adapters/providers/github-api/test/operation-session.ts';
import {
  preparationFilePath,
  prepareBranchCloseout,
  prepareClosedUnmergedPullRequestCloseout,
  rehydratePreparedBranchCloseoutRecoveryArtifact
} from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-closeout.ts';
import {
  createBranchLifecycleGitChildEnvironment,
  createBranchLifecycleGitHubCredentialArgs
} from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-command.ts';
import {
  collectBranchLifecycleCloseoutTargetInventory,
  collectBranchLifecycleInventory
} from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-inventory.ts';
import {
  BRANCH_LIFECYCLE_INVENTORY_SCHEMA,
  type BranchLifecycleInventory
} from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-types.ts';
import {
  createMainAbsorptionRecovery,
  observeNativeMainAbsorption,
  verifyRecoveryAuthorityLive
} from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-recovery.ts';
import {
  compileClosedUnmergedCloseoutOperation,
  createClosedNativeAbsorptionDispositionEvidence,
  tryCreateClosedNativeAbsorptionDispositionEvidence
} from '../../src/adapters/self-hosting/control/branch-lifecycle/closed-unmerged-closeout.ts';
import {
  issueActiveWorkPackageOwnerObservation,
  type ActiveWorkPackageOwnerObservation
} from '../../src/adapters/self-hosting/control/task/contract/active-work-observation.ts';

test('canonical Git child environment removes ambient steering and preserves host integration', () => {
  const source = {
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
  };
  if (process.platform === 'win32') {
    expect(() => createBranchLifecycleGitChildEnvironment(source))
      .toThrow('conflicting case variants');
    return;
  }
  const environment = createBranchLifecycleGitChildEnvironment(source);
  expect(Object.keys(environment).filter((name) => name.toUpperCase() === 'PATH').sort())
    .toEqual(['PATH', 'Path']);
  expect(environment.Path).toBe('trusted-path');
  expect(environment.PATH).toBe('duplicate-path');
  expect(environment.HOME).toBe('trusted-home');
  expect(environment.USERPROFILE).toBe('trusted-profile');
  expect(environment.SSH_AUTH_SOCK).toBe('trusted-agent');
  expect(environment.HTTPS_PROXY).toBe('trusted-proxy');
  expect(environment.GIT_TERMINAL_PROMPT).toBe('0');
  expect(environment.GIT_OPTIONAL_LOCKS).toBe('0');
  expect(environment.GIT_NO_REPLACE_OBJECTS).toBe('1');
  expect(environment.GIT_CONFIG_GLOBAL).toBe(devNull);
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

function absorptionFixture(): Readonly<{
  root: string;
  repository: string;
  sourceSha: string;
  mainSha: string;
  inventory: BranchLifecycleInventory;
}> {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-main-absorption-'));
  const repository = path.join(root, 'repository');
  mkdirSync(repository);
  git(repository, ['init', '-b', 'main']);
  git(repository, ['config', 'user.name', 'SEC Test']);
  git(repository, ['config', 'user.email', 'sec-test@example.invalid']);
  writeFileSync(path.join(repository, 'source.txt'), 'source\n');
  git(repository, ['add', 'source.txt']);
  git(repository, ['commit', '-m', 'source']);
  const sourceSha = git(repository, ['rev-parse', 'HEAD']);
  git(repository, ['branch', 'candidate']);
  writeFileSync(path.join(repository, 'absorbed.txt'), 'absorbed\n');
  git(repository, ['add', 'absorbed.txt']);
  git(repository, ['commit', '-m', 'main absorbs source']);
  const mainSha = git(repository, ['rev-parse', 'HEAD']);
  const inventory = {
    schema: BRANCH_LIFECYCLE_INVENTORY_SCHEMA,
    observedAt: new Date().toISOString(),
    repository: {
      root: repository,
      commonDir: path.join(repository, '.git'),
      fullName: 'sec-platform/sec',
      remote: 'origin',
      remoteUrl: 'https://github.com/sec-platform/sec.git',
      defaultBranch: 'main'
    },
    main: { localSha: mainSha, remoteSha: null },
    localBranches: [],
    remoteBranches: [],
    worktrees: [],
    pullRequests: [],
    activeWorkPackage: { state: 'none', branch: null, manifest: null, reason: null },
    repositorySetting: { observation: 'unknown', deleteBranchOnMerge: null, reason: 'fixture' },
    pruneConfiguration: { observation: 'unknown', fetchPrune: null, remotePrune: null,
      fetchPruneTags: null, reason: 'fixture' },
    unknowns: []
  } satisfies BranchLifecycleInventory;
  return { root, repository, sourceSha, mainSha, inventory };
}

test('main absorption proof revalidates native ancestry and rejects changed proof bytes', async () => {
  const fixture = absorptionFixture();
  const recoveryRoot = path.join(fixture.root, 'recovery');
  try {
    const { recovery } = await createMainAbsorptionRecovery({
      inventory: fixture.inventory,
      branch: 'candidate',
      expectedSha: fixture.sourceSha,
      mainSha: fixture.mainSha,
      basis: 'native-ancestor',
      recoveryRoot
    });
    expect(recovery.kind).toBe('main-absorption');
    expect((await verifyRecoveryAuthorityLive({ inventory: fixture.inventory, recovery })).status).toBe('success');
    const initialProof = statSync(recovery.path);
    const retried = (await createMainAbsorptionRecovery({
      inventory: fixture.inventory,
      branch: 'candidate',
      expectedSha: fixture.sourceSha,
      mainSha: fixture.mainSha,
      basis: 'native-ancestor',
      recoveryRoot
    })).recovery;
    expect(retried.path).toBe(recovery.path);
    expect(statSync(retried.path).ino).toBe(initialProof.ino);
    writeFileSync(recovery.path, 'forged proof\n');
    expect((await verifyRecoveryAuthorityLive({ inventory: fixture.inventory, recovery })).status).toBe('failed');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('native absorption evidence is deterministic before any recovery or preparation publication', async () => {
  const fixture = absorptionFixture();
  const recoveryRoot = path.join(fixture.root, 'recovery');
  try {
    const observed = await observeNativeMainAbsorption({
      repositoryRoot: fixture.repository,
      sourceSha: fixture.sourceSha,
      mainSha: fixture.mainSha
    });
    expect(observed).not.toBeNull();
    if (observed === null) throw new Error('native absorption fixture was not observed');
    const evidence = await tryCreateClosedNativeAbsorptionDispositionEvidence({
      repositoryRoot: fixture.repository,
      repository: 'sec-platform/sec',
      pullRequestNumber: 42,
      branch: 'candidate',
      headSha: fixture.sourceSha,
      baseBranch: 'main',
      baseSha: fixture.sourceSha,
      currentMainSha: fixture.mainSha
    });
    expect(evidence).not.toBeNull();
    expect(evidence?.recoveryDigest).toBe(observed.recoveryDigest);
    expect(existsSync(recoveryRoot)).toBeFalse();

    const durable = (await createMainAbsorptionRecovery({
      inventory: fixture.inventory,
      branch: 'candidate',
      expectedSha: fixture.sourceSha,
      mainSha: fixture.mainSha,
      basis: observed.basis,
      recoveryRoot
    })).recovery;
    expect(durable.kind).toBe('main-absorption');
    expect(durable.sha256).toBe(observed.recoveryDigest);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('main absorption rejects unrelated source without authenticated review before proof publication', async () => {
  const fixture = absorptionFixture();
  const recoveryRoot = path.join(fixture.root, 'recovery');
  try {
    await expect(createMainAbsorptionRecovery({
      inventory: fixture.inventory,
      branch: 'candidate',
      expectedSha: fixture.mainSha,
      mainSha: fixture.sourceSha,
      basis: 'native-ancestor',
      recoveryRoot
    })).rejects.toThrow('Source commit is not an ancestor');
    await expect(createMainAbsorptionRecovery({
      inventory: fixture.inventory,
      branch: 'candidate',
      expectedSha: fixture.sourceSha,
      mainSha: fixture.mainSha,
      basis: 'reviewed-supersession',
      recoveryRoot
    })).rejects.toThrow('review');
    expect(existsSync(recoveryRoot)).toBe(false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

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
    manifest: 'config/repository/work-packages/v6-test.md',
    reason: null
  });
}

function noActiveWorkObservation(
  fixture: ReturnType<typeof repositoryFixture>
): ActiveWorkPackageOwnerObservation {
  return issueActiveWorkPackageOwnerObservation({
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    defaultSha: fixture.mainSha,
    observedAt: new Date().toISOString(),
    state: 'none',
    branch: null,
    manifest: null,
    reason: 'no active Work Package'
  });
}


function withGitHubObservationSession<T>(
  fixture: ReturnType<typeof repositoryFixture>,
  pullRequests: readonly Readonly<Record<string, unknown>>[],
  operation: () => Promise<T>
): Promise<T> {
  const normalizedPulls = pullRequests.map((value) => {
    if (typeof value.headRefName !== 'string') return value;
    const merged = value.state === 'MERGED';
    return {
      number: value.number,
      head: {
        ref: value.headRefName,
        sha: value.headRefOid,
        repo: { full_name: 'sec-platform/sec' }
      },
      base: {
        ref: value.baseRefName,
        sha: value.baseRefOid
      },
      state: merged ? 'closed' : 'open',
      merged_at: merged ? new Date(0).toISOString() : null,
      draft: value.isDraft === true,
      html_url: value.url ?? `https://github.com/sec-platform/sec/pull/${String(value.number)}`
    };
  });
  const transport: GitHubApiTransport = async (target) => {
    const url = String(target);
    if (url.includes('/git/matching-refs/heads/')) {
      const observed = spawnSync('git', [
        '--git-dir', fixture.remote, 'for-each-ref', '--format=%(objectname)%09%(refname)', 'refs/heads'
      ], {
        encoding: 'utf8',
        windowsHide: true,
        env: createBranchLifecycleGitChildEnvironment(process.env)
      });
      if (observed.status !== 0) {
        throw new Error(`cannot observe test remote refs: ${observed.stderr || observed.stdout}`);
      }
      const refs = String(observed.stdout ?? '').trim().split(/\r?\n/u).filter(Boolean).map((line) => {
        const [sha, ref] = line.split(/\s+/u);
        return { ref, object: { sha } };
      });
      return Response.json(refs);
    }
    if (url === 'https://api.github.com/repos/sec-platform/sec') {
      return Response.json({ default_branch: 'main', delete_branch_on_merge: true });
    }
    if (url.includes('/pulls?state=open')) {
      return Response.json(normalizedPulls.filter((value) => value.state === 'open'));
    }
    if (url.includes('/pulls?state=closed')) {
      return Response.json(normalizedPulls.filter((value) => value.state === 'closed'));
    }
    if (url.includes('/issues/') && url.includes('/comments?')) return Response.json([]);
    if (url.includes('/collaborators/') && url.endsWith('/permission')) {
      return Response.json({ permission: 'maintain' });
    }
    if (url.includes('/contents/')) return new Response('Not Found', { status: 404 });
    throw new Error(`Unexpected GitHub inventory test request: ${url}`);
  };
  const capability = issueGitHubApiTestCapability({
    repository: 'sec-platform/sec',
    token: 'test-token-branch-lifecycle-inventory',
    principal: {
      transport: 'github-rest-token',
      login: 'integrator',
      nodeId: 'MDQ6VXNlcjE=',
      userId: 900001,
      permission: 'maintain'
    },
    effect: 'read',
    transport
  });
  return withGitHubApiTestSession({ capability, operation });
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
if (args[0] === 'repo' && args[1] === 'view') {
  process.stdout.write(args.includes('defaultBranchRef') ? 'main' : 'sec-platform/sec');
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
    const quotedBun = `'${process.execPath.replaceAll("'", "'\\''")}'`;
    writeFileSync(shellShim,
      `#!/usr/bin/env sh\nexec ${quotedBun} "$(dirname "$0")/gh-shim.ts" "$@"\n`, 'utf8');
    chmodSync(shellShim, 0o755);
  }
  const priorPath = process.env.PATH;
  process.env.PATH = `${shimRoot}${path.delimiter}${priorPath ?? ''}`;
  return () => {
    if (priorPath === undefined) delete process.env.PATH;
    else process.env.PATH = priorPath;
  };
}

test('target-scoped closeout inventory binds authenticated exact PR and fresh target refs', async () => {
  const fixture = repositoryFixture();
  const restorePath = installGitHubObservationShim(fixture);
  try {
    const observation = noActiveWorkObservation(fixture);
    const preparedInventory = await withGitHubObservationSession(fixture, [], async () => await collectBranchLifecycleInventory({
      repositoryRoot: fixture.repository,
      repositoryFullName: 'sec-platform/sec',
      defaultBranch: 'main',
      activeWorkPackageObservation: observation
    }));
    const exactPullRequest = {
      number: 42,
      headBranch: fixture.branch,
      headSha: fixture.headSha,
      baseBranch: 'main',
      baseSha: fixture.mainSha,
      state: 'closed' as const,
      isDraft: false,
      isCrossRepository: false,
      url: 'https://github.com/sec-platform/sec/pull/42'
    };
    const input = {
      repositoryRoot: fixture.repository,
      repositoryFullName: 'sec-platform/sec',
      activeWorkPackageObservation: observation,
      targetBranch: fixture.branch,
      pullRequestNumber: 42,
      exactPullRequest,
      preparedInventory
    };
    const scoped = await withGitHubObservationSession(fixture, [], async () => await collectBranchLifecycleCloseoutTargetInventory(input));
    expect(scoped.pullRequests.map(({ number }) => number)).toEqual([42]);
    expect(scoped.remoteBranches.find(({ branch }) => branch === fixture.branch)?.sha)
      .toBe(fixture.headSha);
    expect(scoped.worktrees.every(({ dirtyCount, untrackedCount }) =>
      dirtyCount === null && untrackedCount === null)).toBeTrue();
    await expect(withGitHubObservationSession(fixture, [], async () => await collectBranchLifecycleCloseoutTargetInventory({
      ...input,
      exactPullRequest: { ...exactPullRequest, headBranch: 'other/branch' }
    }))).rejects.toThrow('authenticated exact PR observation differs from the closeout target');
  } finally {
    restorePath();
    rmSync(fixture.root, { recursive: true, force: true });
  }
}, 180_000);

test('V6 branch preparation is recovery-only and leaves exact local/remote refs intact', async () => {
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
    const prepared = await withGitHubObservationSession(fixture, [], async () => await prepareBranchCloseout(scope, {
      branch: fixture.branch,
      expectedHeadSha: fixture.headSha
    }));
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

test('closed PR native main absorption preserves a divergent local ref before remote CAS', async () => {
  const fixture = repositoryFixture();
  const restorePath = installGitHubObservationShim(fixture);
  try {
    git(fixture.repository, ['switch', 'main']);
    git(fixture.repository, ['merge', '--ff-only', fixture.branch]);
    git(fixture.repository, ['push', 'origin', 'main']);
    const absorbedMainSha = git(fixture.repository, ['rev-parse', 'HEAD']);
    git(fixture.repository, ['switch', fixture.branch]);
    writeFileSync(path.join(fixture.repository, 'local-only.txt'), 'local-only\n');
    git(fixture.repository, ['add', 'local-only.txt']);
    git(fixture.repository, ['commit', '-m', 'independent local continuation']);
    const divergentLocalSha = git(fixture.repository, ['rev-parse', 'HEAD']);
    git(fixture.repository, ['switch', 'main']);
    const exactPullRequest = {
      number: 42, headBranch: fixture.branch, headSha: fixture.headSha,
      baseBranch: 'main', baseSha: fixture.mainSha, state: 'closed' as const,
      isDraft: false, isCrossRepository: false,
      url: 'https://github.com/sec-platform/sec/pull/42'
    };
    const prepared = await withGitHubObservationSession(fixture, [], async () => await prepareClosedUnmergedPullRequestCloseout({
      repositoryRoot: fixture.repository, repositoryFullName: 'sec-platform/sec',
      activeWorkPackageObservation: issueActiveWorkPackageOwnerObservation({
        repository: 'sec-platform/sec', defaultBranch: 'main', defaultSha: absorbedMainSha,
        observedAt: new Date().toISOString(), state: 'none', branch: null,
        manifest: null, reason: 'no active Work Package'
      }), recoveryRoot: path.join(fixture.root, 'recovery')
    }, { number: 42, refState: 'present', headBranch: fixture.branch,
      headSha: fixture.headSha, baseBranch: 'main', baseSha: fixture.mainSha,
      exactPullRequest }));
    expect(prepared.preparation.expectedLocalSha).toBe(divergentLocalSha);
    expect(prepared.preparation.recovery.kind).toBe('main-absorption');
    if (prepared.preparation.recovery.kind !== 'main-absorption') throw new Error('expected absorption');
    expect(prepared.preparation.recovery.basis).toBe('native-ancestor');
    const evidence = createClosedNativeAbsorptionDispositionEvidence({
      prepared, repository: 'sec-platform/sec', pullRequestNumber: 42,
      branch: fixture.branch, headSha: fixture.headSha,
      headTreeSha: prepared.preparation.recovery.sourceTreeSha,
      baseBranch: 'main', baseSha: fixture.mainSha,
      currentMainSha: absorbedMainSha,
      currentMainTreeSha: prepared.preparation.recovery.mainTreeSha,
      durableGoal: { kind: 'evidence', reference: `main-absorption:${prepared.preparation.recovery.sha256}` }
    });
    const compiled = compileClosedUnmergedCloseoutOperation({ prepared, evidence });
    expect(compiled.status).toBe('ready');
    if (compiled.status !== 'ready') throw new Error(compiled.blockers.join(' | '));
    expect(compiled.operation.authorization.localAction).toBe('protect-local');
    expect(git(fixture.repository, ['rev-parse', `refs/heads/${fixture.branch}`])).toBe(divergentLocalSha);
  } finally {
    restorePath();
    rmSync(fixture.root, { recursive: true, force: true });
  }
}, 180_000);

test('remote-absent preparation recovers the exact local branch without mutating either ref', async () => {
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
    const prepared = await withGitHubObservationSession(fixture, [{
      number: 42, headRefName: fixture.branch, headRefOid: fixture.headSha,
      baseRefName: 'main', baseRefOid: fixture.mainSha, state: 'MERGED',
      isDraft: false, isCrossRepository: false,
      url: 'https://github.com/sec-platform/sec/pull/42'
    }], async () => await prepareBranchCloseout({
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
    }));
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

test('typed inventory boundary ignores ambient repository and index steering without refreshing target index', async () => {
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
    const inventory = await withGitHubObservationSession(fixture, [], async () => await collectBranchLifecycleInventory({
      repositoryRoot: fixture.repository,
      repositoryFullName: 'sec-platform/sec',
      defaultBranch: 'main',
      activeWorkPackageObservation: activeWorkObservation(fixture)
    }));
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

test('missing documentation-owner observation is typed unresolved and blocks before recovery effect', async () => {
  const fixture = repositoryFixture();
  const restorePath = installGitHubObservationShim(fixture);
  const recoveryRoot = path.join(fixture.root, 'recovery');
  try {
    const inventory = await withGitHubObservationSession(fixture, [], async () => await collectBranchLifecycleInventory({
      repositoryRoot: fixture.repository,
      repositoryFullName: 'sec-platform/sec',
      defaultBranch: 'main'
    }));
    expect(inventory.activeWorkPackage).toEqual({
      state: 'unresolved',
      branch: null,
      manifest: null,
      reason: 'active-work-owner-observation-unavailable'
    });
    expect(inventory.unknowns).toContain('active-work-owner-observation-unavailable');
    const issued = activeWorkObservation(fixture);
    await expect(withGitHubObservationSession(fixture, [], async () => await collectBranchLifecycleInventory({
      repositoryRoot: fixture.repository,
      repositoryFullName: 'sec-platform/sec',
      defaultBranch: 'main',
      activeWorkPackageObservation: { ...issued } as ActiveWorkPackageOwnerObservation
    }))).rejects.toThrow('active-work-owner-observation-not-issued');
    await expect(withGitHubObservationSession(fixture, [], async () => await prepareBranchCloseout({
      repositoryRoot: fixture.repository,
      repositoryFullName: 'sec-platform/sec',
      defaultBranch: 'main',
      recoveryRoot
    }, {
      branch: fixture.branch,
      expectedHeadSha: fixture.headSha
    }))).rejects.toThrow('active-work-owner-observation-unavailable');
    expect(existsSync(recoveryRoot)).toBe(false);

    const authorized = await withGitHubObservationSession(fixture, [], async () => await prepareBranchCloseout({
      repositoryRoot: fixture.repository,
      repositoryFullName: 'sec-platform/sec',
      defaultBranch: 'main',
      activeWorkPackageObservation: activeWorkObservation(fixture),
      recoveryRoot: path.join(fixture.root, 'authorized-recovery')
    }, {
      branch: fixture.branch,
      expectedHeadSha: fixture.headSha
    }));
    const rehydrationRoot = path.join(fixture.root, 'blocked-rehydration');
    await expect(withGitHubObservationSession(fixture, [], async () => await rehydratePreparedBranchCloseoutRecoveryArtifact({
      scope: {
        repositoryRoot: fixture.repository,
        repositoryFullName: 'sec-platform/sec',
        defaultBranch: 'main',
        recoveryRoot: rehydrationRoot
      },
      remote: authorized,
      recoveryBundleBytes: readFileSync(authorized.preparation.recovery.path)
    }))).rejects.toThrow('active-work-owner-observation-unavailable');
    expect(existsSync(rehydrationRoot)).toBe(false);
  } finally {
    restorePath();
    rmSync(fixture.root, { recursive: true, force: true });
  }
}, 180_000);
