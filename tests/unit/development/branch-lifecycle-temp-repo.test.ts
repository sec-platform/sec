import { settleWorkspaceCallbackSync } from '../../testkit/workspace-cleanup.ts';
import { settleResources } from '../../../src/execution/resource-settlement.ts';
import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  preparationFilePath,
  prepareBranchCloseout,
  rehydratePreparedBranchCloseoutRecoveryArtifact
} from '../../../src/adapters/self-hosting/control/branch-lifecycle/branch-closeout.ts';
import {
  createBranchLifecycleGitHubCredentialArgs
} from '../../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-command.ts';
import {
  collectBranchLifecycleCloseoutTargetInventory,
  collectBranchLifecycleInventory
} from '../../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-inventory.ts';
import {
  verifyRecoveryAuthorityHeadLive
} from '../../../src/adapters/self-hosting/control/branch-lifecycle/branch-recovery.ts';
import {
  issueActiveWorkPackageOwnerObservation,
  type ActiveWorkPackageOwnerObservation
} from '../../../src/adapters/self-hosting/control/task/contract/active-work-observation.ts';

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

function buildRepositoryTemplate(): Readonly<{
  root: string;
  remote: string;
  repository: string;
  branch: string;
  headSha: string;
  mainSha: string;
}> {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-branch-lifecycle-v6-'));
  try {
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
  } catch (error) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Branch repository preparation and cleanup both failed');
    }
    throw error;
  }
}

// Only the original committed Git graph is reused. Copy both native repos,
// rebind the remote to this case and retain independent indexes and refs.
let nativeRepositoryTemplate: ReturnType<typeof buildRepositoryTemplate> | undefined;

function repositoryFixture(): ReturnType<typeof buildRepositoryTemplate> {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-branch-lifecycle-v6-'));
  try {
    const template = nativeRepositoryTemplate ??= buildRepositoryTemplate();
    const remote = path.join(root, 'remote.git');
    const repository = path.join(root, 'repository');
    cpSync(template.remote, remote, { recursive: true });
    cpSync(template.repository, repository, { recursive: true });
    git(repository, ['remote', 'set-url', 'origin', remote]);
    return Object.freeze({
      root, remote, repository, branch: template.branch,
      headSha: template.headSha, mainSha: template.mainSha
    });
  } catch (error) {
    try { rmSync(root, { recursive: true, force: true }); }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Branch fixture copy and cleanup both failed');
    }
    throw error;
  }
}

let observedRepository: ReturnType<typeof repositoryFixture> | undefined;
function observationFixture(): ReturnType<typeof repositoryFixture> {
  return observedRepository ??= repositoryFixture();
}
afterAll(() => {
  const failures: unknown[] = [];
  for (const fixture of [observedRepository, nativeRepositoryTemplate]) {
    if (fixture === undefined) continue;
    try { rmSync(fixture.root, { recursive: true, force: true }); }
    catch (error) { failures.push(error); }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Branch fixture cleanup failed');
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

function installGitHubObservationShim(
  fixture: ReturnType<typeof repositoryFixture>,
  pullRequests: readonly Readonly<Record<string, unknown>>[] = [],
  apiResponses: Readonly<Record<string, string>> = {}
): () => void {
  const shimRoot = path.join(fixture.root, 'command-shims');
  mkdirSync(shimRoot, { recursive: true });
  const program = path.join(shimRoot, 'gh-shim.ts');
  writeFileSync(program, `
const args = process.argv.slice(2);
const apiResponses = ${JSON.stringify(apiResponses)};
const endpoint = args.find(arg => arg.startsWith('/repos/'));
if (args[0] === 'api' && Object.hasOwn(apiResponses, endpoint)) {
  if (args.includes('--jq')) throw new Error('paired permission response must remain intact');
  process.stdout.write(apiResponses[endpoint]);
  process.exit(0);
}
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
    ], { cwd: shimRoot, encoding: 'utf8', windowsHide: true });
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

test('target-scoped closeout inventory binds authenticated exact PR and fresh target refs', () => {
  const fixture = observationFixture();
  const restorePath = installGitHubObservationShim(fixture);
  settleWorkspaceCallbackSync(() => {
    const observation = noActiveWorkObservation(fixture);
    const preparedInventory = collectBranchLifecycleInventory({
      repositoryRoot: fixture.repository,
      repositoryFullName: 'sec-platform/sec',
      defaultBranch: 'main',
      activeWorkPackageObservation: observation
    });
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
      currentOpenPullRequests: [],
      preparedInventory
    };
    const scoped = collectBranchLifecycleCloseoutTargetInventory(input);
    expect(scoped.pullRequests.map(({ number }) => number)).toEqual([42]);
    expect(collectBranchLifecycleCloseoutTargetInventory({ ...input,
      currentOpenPullRequests: undefined }).unknowns)
      .toContain('Current complete open pull request consumer census is unavailable.');
    expect(scoped.remoteBranches.find(({ branch }) => branch === fixture.branch)?.sha)
      .toBe(fixture.headSha);
    expect(scoped.worktrees.every(({ dirtyCount, untrackedCount }) =>
      dirtyCount === null && untrackedCount === null)).toBeTrue();
    expect(() => collectBranchLifecycleCloseoutTargetInventory({
      ...input,
      exactPullRequest: { ...exactPullRequest, headBranch: 'other/branch' }
    })).toThrow('authenticated exact PR observation differs from the closeout target');
  }, () => { restorePath(); });
}, 180_000);

test('remote-absent preparation recovers the exact local branch without mutating either ref', () => {
  const fixture = repositoryFixture();
  let restorePath: (() => void) | undefined;
  settleWorkspaceCallbackSync(() => {
    git(fixture.repository, ['push', 'origin', '--delete', fixture.branch]);
    restorePath = installGitHubObservationShim(fixture, [{
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
  }, () => {
    restorePath?.();
    rmSync(fixture.root, { recursive: true, force: true });
  });
}, 180_000);

test('canonical GitHub credential prefix masks checkout HTTP authorization before gh lookup', () => {
  const credentialArgs = createBranchLifecycleGitHubCredentialArgs();
  expect(credentialArgs).toEqual([
    '-c', 'http.extraHeader=',
    '-c', 'http.https://github.com/.extraheader=',
    '-c', 'credential.helper=',
    '-c', 'credential.helper=!gh auth git-credential'
  ]);
  const root = mkdtempSync(path.join(tmpdir(), 'sec-branch-credential-'));
  settleWorkspaceCallbackSync(() => {
    git(root, ['init']);
    git(root, ['config', 'http.https://github.com/.extraheader', 'AUTHORIZATION: ambient-checkout-token']);
    const observed = spawnSync('git', [
      ...credentialArgs,
      'config', '--get-urlmatch', 'http.extraheader', 'https://github.com/sec-platform/sec.git'
    ], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true
    });
    expect(observed.status).toBe(0);
    expect(String(observed.stdout ?? '')).toBe('\n');
  }, () => { rmSync(root, { recursive: true, force: true }); });
});

test('typed inventory boundary ignores ambient repository and index steering without refreshing target index', () => {
  const fixture = repositoryFixture();
  let restorePath: (() => void) | undefined;
  const priorEnvironment = new Map<string, string | undefined>();
  settleWorkspaceCallbackSync(() => {
    restorePath = installGitHubObservationShim(fixture);
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
    for (const [name, value] of Object.entries(hostileEnvironment)) {
      priorEnvironment.set(name, process.env[name]);
      process.env[name] = value;
    }
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
  }, () => {
    restorePath?.();
    for (const [name, value] of priorEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(fixture.root, { recursive: true, force: true });
  });
});

test('closeout requires its documentation owner and revalidates the exact recovery head before effects', () => {
  // Preparing recovery artifacts is a physical Git Effect. Do not mutate the
  // observation-only repository shared with the inventory reader cases.
  const fixture = repositoryFixture();
  let restorePath: (() => void) | undefined;
  const recoveryRoot = path.join(fixture.root, 'recovery');
  settleWorkspaceCallbackSync(() => {
    // Shim acquisition belongs to the same cleanup scope as this owned
    // native repository, including failed shim creation or compilation.
    restorePath = installGitHubObservationShim(fixture);
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
    expect(authorized.preparation.expectedHeadSha).toBe(fixture.headSha);
    expect(existsSync(preparationFilePath(authorized.preparation))).toBe(true);
    expect(git(fixture.repository, ['rev-parse', `refs/heads/${fixture.branch}`]))
      .toBe(fixture.headSha);
    expect(git(fixture.repository, ['ls-remote', '--heads', 'origin', `refs/heads/${fixture.branch}`]))
      .toContain(fixture.headSha);
    const recovery = authorized.preparation.recovery;
    if (recovery === null) throw new Error('Expected exact recovery authority.');

    expect(verifyRecoveryAuthorityHeadLive({
      inventory: authorized.before,
      recovery,
      expectedHeadSha: fixture.headSha
    })).toMatchObject({
      operation: 'recovery-verify',
      status: 'success'
    });
    expect(verifyRecoveryAuthorityHeadLive({
      inventory: authorized.before,
      recovery,
      expectedHeadSha: fixture.mainSha
    })).toMatchObject({
      operation: 'recovery-verify',
      status: 'failed'
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
  }, () => {
    settleResources({ cleanup: [
      { label: 'closeout GitHub shim', settle: () => restorePath?.() },
      { label: 'closeout native repository', settle: () => rmSync(fixture.root, { recursive: true, force: true }) }
    ] });
  });
}, 180_000);


test('receipt inventory consumes paired permission JSON and preserves unreadable-provider uncertainty', () => {
  const fixture = observationFixture();
  const baseSha = 'a'.repeat(40);
  const pullRequests = [{ number: 42, headRefName: fixture.branch, headRefOid: fixture.headSha,
    baseRefName: 'main', baseRefOid: baseSha, state: 'CLOSED', isDraft: false, isCrossRepository: false }];
  const responses = {
    [`/repos/sec-platform/sec/contents/src/adapters/self-hosting/control/branch-lifecycle/branch-closeout-receipt.ts?ref=${baseSha}`]: '',
    '/repos/sec-platform/sec/issues/42/comments?per_page=100': JSON.stringify([[{
      body: '<!-- sec-branch-closeout-receipt-v1 -->\n{invalid-receipt', user: { login: 'maintainer' }
    }]]),
    '/repos/sec-platform/sec/collaborators/maintainer/permission': JSON.stringify({ permission: 'write', role_name: 'maintain' })
  };
  let restorePath = installGitHubObservationShim(fixture, pullRequests, responses);
  const observe = () => collectBranchLifecycleInventory({ repositoryRoot: fixture.repository,
    repositoryFullName: 'sec-platform/sec', defaultBranch: 'main', activeWorkPackageObservation: noActiveWorkObservation(fixture) });
  settleWorkspaceCallbackSync(() => {
    const paired = observe().pullRequests.find(pr => pr.number === 42)!;
    expect(paired.invalidCloseoutReceiptComments).toHaveLength(1);
    restorePath();
    responses['/repos/sec-platform/sec/collaborators/maintainer/permission'] = '{unreadable';
    restorePath = installGitHubObservationShim(fixture, pullRequests, responses);
    expect(observe().pullRequests.find(pr => pr.number === 42)!.closeoutReceipt)
      .toMatchObject({ status: 'unknown', reason: expect.stringContaining('invalid JSON') });
  }, () => { restorePath(); });
});
