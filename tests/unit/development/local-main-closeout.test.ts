import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';

import { withWorkspaceWriteLease } from '../../../src/adapters/filesystem/write-lease.ts';
import { settleResourcesAsync } from '../../../src/execution/resource-settlement.ts';
import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';
import {
  createLocalMainCloseoutBinding,
  executeLocalMainCloseout,
  inspectLocalMainCloseout
} from '../../../src/adapters/self-hosting/control/branch-lifecycle/local-main-closeout.ts';

function git(repoRoot: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: repoRoot, encoding: 'utf8', windowsHide: true,
    env: { ...process.env,
      GIT_AUTHOR_NAME: 'SEC Tests', GIT_AUTHOR_EMAIL: 'tests@example.com',
      GIT_COMMITTER_NAME: 'SEC Tests', GIT_COMMITTER_EMAIL: 'tests@example.com'
    }
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return String(result.stdout);
}

const gitRunner = (repoRoot: string, args: readonly string[]) => {
  const result = spawnSync('git', [...args], { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
  return Object.freeze({ status: result.status ?? 1, stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? result.error?.message ?? '') });
};

let seedRoot: string | undefined;
let caseRoot: string | undefined;
let remoteRoot: string | undefined;
let protectedRoot: string | undefined;
let developerRoot: string | undefined;
const RECEIPT = `sha256:${'a'.repeat(64)}` as const;
const SESSION = `sha256:${'b'.repeat(64)}` as const;

function binding(expectedLocalPreimageSha?: string) {
  const localObjects = expectedLocalPreimageSha === undefined
    ? git(protectedRoot!, ['rev-parse', 'HEAD', 'HEAD^{tree}']).trim().split(/\r?\n/u)
    : [expectedLocalPreimageSha,
      git(protectedRoot!, ['rev-parse', `${expectedLocalPreimageSha}^{tree}`]).trim()];
  if (localObjects.length !== 2 || localObjects.some(value =>
    !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(value))) {
    throw new Error('Expected exact local main commit and tree identities');
  }
  const [localSha, localTree] = localObjects as [string, string];
  const [remoteSha, remoteTree] = git(remoteRoot!, [
    'rev-parse', 'main', 'main^{tree}'
  ]).trim().split(/\r?\n/u) as [string, string];
  return createLocalMainCloseoutBinding({ repository: 'sec-platform/sec', pullRequestNumber: 42,
    protectedRootRealPath: protectedRoot!,
    expectedLocalPreimageSha: localSha, expectedRemoteMainSha: remoteSha,
    expectedLocalPreimageTreeSha: localTree, expectedCandidateHeadSha: remoteSha,
    expectedRemoteMainTreeSha: remoteTree, expectedCandidateTreeSha: remoteTree,
    sessionRevision: SESSION, authorizationId: SESSION,
    authorizationReceiptDigest: RECEIPT, consumptionOperationId: RECEIPT,
    authorizationPublicationId: RECEIPT, authorizationPublicationDigest: RECEIPT,
    authorizationCommentId: 101, reviewReceiptDigest: RECEIPT, reviewRevision: SESSION,
    integrationWorkflowSha: remoteSha, integrationRunId: '101', integrationRunAttempt: 1 });
}

async function execute(bindingValue: ReturnType<typeof binding>) {
  const commonDir = git(protectedRoot!, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
  return withWorkspaceWriteLease(commonDir, undefined, (commonLease) => (
    withWorkspaceWriteLease(protectedRoot!, undefined, (lease) => (
      executeLocalMainCloseout(protectedRoot!, bindingValue, gitRunner, lease, commonLease)
    ))
  ));
}


// The seed is never mutated after beforeAll. Every case gets separate Git
// object stores, index, refs, worktrees and remote history. The sibling-relative
// origins remain valid after copying the whole seed; no Git init/clone is needed
// per case and no absolute remote paths leak back into the seed.
beforeAll(async () => {
  seedRoot = await mkdtemp(path.join(tmpdir(), 'sec-local-main-closeout-seed-'));
  const remote = path.join(seedRoot, 'remote.git');
  const protectedRepository = path.join(seedRoot, 'protected');
  const developer = path.join(seedRoot, 'developer');
  await mkdir(protectedRepository);
  git(seedRoot, ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
  git(protectedRepository, ['init', '--quiet', '--initial-branch=main']);
  git(protectedRepository, ['config', 'core.autocrlf', 'false']);
  git(protectedRepository, ['remote', 'add', 'origin', '../remote.git']);
  await writeFile(path.join(protectedRepository, '.gitignore'), '.sec/\n', 'utf8');
  await writeFile(path.join(protectedRepository, 'main.txt'), 'v1\n', 'utf8');
  git(protectedRepository, ['add', '--all']);
  git(protectedRepository, ['commit', '--quiet', '-m', 'v1']);
  git(protectedRepository, ['push', '--quiet', '-u', 'origin', 'main']);
  git(seedRoot, ['clone', '--quiet', remote, developer]);
  git(developer, ['remote', 'set-url', 'origin', '../remote.git']);
});

beforeEach(async () => {
  if (!seedRoot) throw new Error('Local main seed was not prepared');
  const allocated = await mkdtemp(path.join(tmpdir(), 'sec-local-main-closeout-'));
  caseRoot = allocated;
  try {
    const isolated = path.join(allocated, 'repositories');
    await cp(seedRoot, isolated, { recursive: true, force: false, errorOnExist: true });
    remoteRoot = path.join(isolated, 'remote.git');
    protectedRoot = path.join(isolated, 'protected');
    developerRoot = path.join(isolated, 'developer');
  } catch (error) {
    caseRoot = undefined;
    remoteRoot = protectedRoot = developerRoot = undefined;
    try {
      await rm(allocated, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Local main fixture setup and cleanup both failed');
    }
    throw error;
  }
});

afterEach(async () => {
  const allocated = caseRoot;
  caseRoot = undefined;
  remoteRoot = protectedRoot = developerRoot = undefined;
  if (allocated) await rm(allocated, { recursive: true, force: true });
});

afterAll(async () => {
  if (seedRoot) await rm(seedRoot, { recursive: true, force: true });
});

test.serial('local-main mutation requires the Git common-dir lease before fetch', async () => {
  const beforeHead = git(protectedRoot!, ['rev-parse', 'HEAD']).trim();
  let fetchCount = 0;
  const observingRunner: typeof gitRunner = (repoRoot, args) => {
    if (args[0] === 'fetch') fetchCount += 1;
    return gitRunner(repoRoot, args);
  };
  await withWorkspaceWriteLease(protectedRoot!, undefined, async (rootLease) => {
    await expect(executeLocalMainCloseout(protectedRoot!, binding(beforeHead),
      observingRunner, rootLease, rootLease)).rejects.toThrow();
  });
  expect(fetchCount).toBe(0);
  expect(git(protectedRoot!, ['rev-parse', 'HEAD']).trim()).toBe(beforeHead);
});

test.serial('clean fast-forwardable protected main ends in LOCAL_MAIN_READY via ff-only with exact readback', async () => {
  const [head, tree] = git(protectedRoot!, [
    'rev-parse', 'HEAD', 'HEAD^{tree}'
  ]).trim().split(/\r?\n/u) as [string, string];
  // remote advances
  developerPush('v2\n');
  const [remoteSha, remoteTree] = git(remoteRoot!, [
    'rev-parse', 'main', 'main^{tree}'
  ]).trim().split(/\r?\n/u) as [string, string];
  expect(head).not.toBe(remoteSha);

  const status = await execute(binding(head));
  expect(status.status).toBe('LOCAL_MAIN_READY');
  if (status.status === 'LOCAL_MAIN_READY') {
    expect(status.action).toBe('ff-only-synced');
    expect(status.localHeadSha).toBe(remoteSha);
    expect(status.localTreeSha).toBe(remoteTree);
    expect(status.remoteMainSha).toBe(remoteSha);
  }
  const [readbackHead, readbackTree] = git(protectedRoot!, [
    'rev-parse', 'HEAD', 'HEAD^{tree}'
  ]).trim().split(/\r?\n/u) as [string, string];
  expect(readbackHead).toBe(remoteSha);
  expect(readbackTree).toBe(remoteTree);
  expect(tree).not.toBe(remoteTree);

  // The already-current reader consumes this same successfully synchronized
  // native Git state. Keep its independent no-op verdict without requiring
  // a separate test to run after the fast-forward case.
  const current = inspectLocalMainCloseout(protectedRoot!, binding(), gitRunner);
  expect(current.status).toBe('LOCAL_MAIN_READY');
  if (current.status === 'LOCAL_MAIN_READY') expect(current.action).toBe('already-current');
});



test.serial('a dirty protected main returns LOCAL_MAIN_SYNC_BLOCKED(dirty) and never mutates', async () => {
  const [remoteSha, beforeHead] = git(protectedRoot!, [
    'rev-parse', 'origin/main', 'HEAD'
  ]).trim().split(/\r?\n/u) as [string, string];
  const dirtyPath = path.join(protectedRoot!, 'main.txt');
  await settleWorkspaceCallback(async () => {
    writeFileSync(dirtyPath, 'dirty user work\n');

    const status = await execute(binding(beforeHead));
    expect(status.status).toBe('LOCAL_MAIN_SYNC_BLOCKED');
    if (status.status === 'LOCAL_MAIN_SYNC_BLOCKED') expect(status.reason).toBe('dirty');
    const [readbackHead, readbackRemote] = git(protectedRoot!, [
      'rev-parse', 'HEAD', 'origin/main'
    ]).trim().split(/\r?\n/u) as [string, string];
    expect(readbackHead).toBe(beforeHead);
    expect(readbackRemote).toBe(remoteSha);
    expect(readFileSync(dirtyPath, 'utf8')).toBe('dirty user work\n');
  }, async () => { git(protectedRoot!, ['checkout', '--', 'main.txt']); });
  expect(git(protectedRoot!, ['status', '--porcelain=v1']).trim()).toBe('');
});

test.serial('a diverged protected main preserves local commits while refreshing remote tracking', async () => {
  developerPush('v3\n');
  const remoteSha = git(remoteRoot!, ['rev-parse', 'main']).trim();
  const beforeHead = git(protectedRoot!, ['rev-parse', 'HEAD']).trim();
  const localPath = path.join(protectedRoot!, 'diverged.txt');
  await settleWorkspaceCallback(async () => {
    writeFileSync(localPath, 'diverged\n');
    git(protectedRoot!, ['add', 'diverged.txt']);
    git(protectedRoot!, ['commit', '--quiet', '--no-verify', '-m', 'diverged local work']);
    const localHead = git(protectedRoot!, ['rev-parse', 'HEAD']).trim();

    const status = await execute(binding(localHead));
    expect(status.status).toBe('LOCAL_MAIN_SYNC_BLOCKED');
    if (status.status === 'LOCAL_MAIN_SYNC_BLOCKED') {
      expect(status.reason).toBe('local-only-commits');
    }
    const [observedLocalHead, observedRemoteHead] = git(protectedRoot!, [
      'rev-parse', 'HEAD', 'origin/main'
    ]).trim().split(/\r?\n/u);
    expect(observedLocalHead).toBe(localHead);
    expect(observedRemoteHead).toBe(remoteSha);

  }, () => settleResourcesAsync({ cleanup: [
    { label: 'diverged-fixture-commit', settle: () => { git(protectedRoot!, ['reset', '--hard', beforeHead]); } },
    { label: 'diverged-fixture-file', settle: () => rm(localPath, { force: true }) }
  ] }).then(() => undefined));
});

test.serial('an ignored local path colliding with the incoming tracked write set blocks ff-only publication', async () => {
  const localPath = path.join(protectedRoot!, 'generated.ts');
  const excludePath = path.join(protectedRoot!, '.git', 'info', 'exclude');
  const originalExclude = readFileSync(excludePath);
  const initialHead = git(protectedRoot!, ['rev-parse', 'HEAD']).trim();
  await settleWorkspaceCallback(async () => {
    writeFileSync(excludePath, 'generated.ts\n');
    writeFileSync(localPath, 'developer-owned ignored bytes\n');
    writeFileSync(path.join(developerRoot!, 'generated.ts'), 'incoming tracked bytes\n');
    git(developerRoot!, ['add', 'generated.ts']);
    git(developerRoot!, ['commit', '--quiet', '--no-verify', '-m', 'remote generated path']);
    git(developerRoot!, ['push', '--quiet', 'origin', 'main']);
    const beforeHead = git(protectedRoot!, ['rev-parse', 'HEAD']).trim();

    const status = await execute(binding(beforeHead));
    expect(status.status).toBe('LOCAL_MAIN_SYNC_BLOCKED');
    if (status.status === 'LOCAL_MAIN_SYNC_BLOCKED') expect(status.reason).toBe('dirty');
    expect(git(protectedRoot!, ['rev-parse', 'HEAD']).trim()).toBe(beforeHead);
    expect(readFileSync(localPath, 'utf8')).toBe('developer-owned ignored bytes\n');

  }, () => settleResourcesAsync({ cleanup: [
    { label: 'ignored-fixture-file', settle: () => rm(localPath, { force: true }) },
    { label: 'fixture-excludes', settle: () => { writeFileSync(excludePath, originalExclude); } },
    { label: 'protected-fixture-head', settle: () => { git(protectedRoot!, ['reset', '--hard', initialHead]); } }
  ] }).then(() => undefined));
});

function developerPush(content: string): void {
  writeFileSync(path.join(developerRoot!, 'main.txt'), content);
  git(developerRoot!, ['commit', '--quiet', '--no-verify', '-m', `remote ${content.trim()}`, '--', 'main.txt']);
  git(developerRoot!, ['push', '--quiet', 'origin', 'main']);
}
