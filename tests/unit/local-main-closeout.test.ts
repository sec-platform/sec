import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, expect, test } from 'bun:test';

import { withWorkspaceWriteLease } from '../../src/adapters/filesystem/write-lease.ts';
import {
  createLocalMainCloseoutBinding,
  executeLocalMainCloseout,
  inspectLocalMainCloseout
} from '../../src/adapters/self-hosting/control/branch-lifecycle/local-main-closeout.ts';

function git(repoRoot: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return String(result.stdout);
}

const gitRunner = (repoRoot: string, args: readonly string[]) => {
  const result = spawnSync('git', [...args], { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
  return Object.freeze({ status: result.status ?? 1, stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? result.error?.message ?? '') });
};

let baseRoot: string | undefined;
let remoteRoot: string | undefined;
let protectedRoot: string | undefined;
let developerRoot: string | undefined;
const RECEIPT = `sha256:${'a'.repeat(64)}` as const;
const SESSION = `sha256:${'b'.repeat(64)}` as const;

function binding(expectedLocalPreimageSha = git(protectedRoot!, ['rev-parse', 'HEAD']).trim()) {
  const remoteSha = git(remoteRoot!, ['rev-parse', 'main']).trim();
  const remoteTree = git(remoteRoot!, ['rev-parse', 'main^{tree}']).trim();
  const localTree = git(protectedRoot!, ['rev-parse', `${expectedLocalPreimageSha}^{tree}`]).trim();
  return createLocalMainCloseoutBinding({ repository: 'sec-platform/sec', pullRequestNumber: 42,
    protectedRootRealPath: protectedRoot!,
    expectedLocalPreimageSha, expectedRemoteMainSha: remoteSha,
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


beforeAll(async () => {
  baseRoot = await mkdtemp(path.join(tmpdir(), 'sec-local-main-closeout-'));
  remoteRoot = path.join(baseRoot, 'remote.git');
  protectedRoot = path.join(baseRoot, 'protected');
  developerRoot = path.join(baseRoot, 'developer');
  await mkdir(protectedRoot);
  git(baseRoot, ['init', '--quiet', '--bare', remoteRoot]);
  git(baseRoot, ['--git-dir', remoteRoot, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  git(protectedRoot, ['init', '--quiet']);
  git(protectedRoot, ['branch', '-M', 'main']);
  git(protectedRoot, ['config', 'user.email', 'tests@example.com']);
  git(protectedRoot, ['config', 'user.name', 'SEC Tests']);
  git(protectedRoot, ['config', 'core.autocrlf', 'false']);
  git(protectedRoot, ['remote', 'add', 'origin', remoteRoot]);
  await writeFile(path.join(protectedRoot, '.gitignore'), '.sec/\n', 'utf8');
  await writeFile(path.join(protectedRoot, 'main.txt'), 'v1\n', 'utf8');
  git(protectedRoot, ['add', '--all']);
  git(protectedRoot, ['commit', '--quiet', '-m', 'v1']);
  git(protectedRoot, ['push', '--quiet', '-u', 'origin', 'main']);
  git(baseRoot, ['clone', '--quiet', remoteRoot, developerRoot]);
  git(developerRoot, ['config', 'user.email', 'tests@example.com']);
  git(developerRoot, ['config', 'user.name', 'SEC Tests']);
});

afterAll(async () => {
  if (baseRoot) await rm(baseRoot, { recursive: true, force: true });
});

test.serial('clean fast-forwardable protected main ends in LOCAL_MAIN_READY via ff-only with exact readback', async () => {
  const head = git(protectedRoot!, ['rev-parse', 'HEAD']).trim();
  const tree = git(protectedRoot!, ['rev-parse', 'HEAD^{tree}']).trim();
  // remote advances
  developerPush('v2\n');
  const remoteSha = git(remoteRoot!, ['rev-parse', 'main']).trim();
  const remoteTree = git(remoteRoot!, ['rev-parse', 'main^{tree}']).trim();
  expect(head).not.toBe(remoteSha);

  const status = await execute(binding(head));
  expect(status.status).toBe('LOCAL_MAIN_READY');
  if (status.status === 'LOCAL_MAIN_READY') {
    expect(status.action).toBe('ff-only-synced');
    expect(status.localHeadSha).toBe(remoteSha);
    expect(status.localTreeSha).toBe(remoteTree);
    expect(status.remoteMainSha).toBe(remoteSha);
  }
  expect(git(protectedRoot!, ['rev-parse', 'HEAD']).trim()).toBe(remoteSha);
  expect(git(protectedRoot!, ['rev-parse', 'HEAD^{tree}']).trim()).toBe(remoteTree);
  expect(tree).not.toBe(remoteTree);
});

test.serial('already-current protected main returns LOCAL_MAIN_READY without mutation', () => {
  const status = inspectLocalMainCloseout(protectedRoot!, binding(), gitRunner);
  expect(status.status).toBe('LOCAL_MAIN_READY');
  if (status.status === 'LOCAL_MAIN_READY') expect(status.action).toBe('already-current');
});



test.serial('a dirty protected main returns LOCAL_MAIN_SYNC_BLOCKED(dirty) and never mutates', async () => {
  const remoteSha = git(protectedRoot!, ['rev-parse', 'origin/main']).trim();
  const beforeHead = git(protectedRoot!, ['rev-parse', 'HEAD']).trim();
  const dirtyPath = path.join(protectedRoot!, 'main.txt');
  writeFileSync(dirtyPath, 'dirty user work\n');

  const status = await execute(binding(beforeHead));
  expect(status.status).toBe('LOCAL_MAIN_SYNC_BLOCKED');
  if (status.status === 'LOCAL_MAIN_SYNC_BLOCKED') expect(status.reason).toBe('dirty');
  expect(git(protectedRoot!, ['rev-parse', 'HEAD']).trim()).toBe(beforeHead);
  expect(git(protectedRoot!, ['rev-parse', 'origin/main']).trim()).toBe(remoteSha);
  expect(readFileSync(dirtyPath, 'utf8')).toBe('dirty user work\n');
  git(protectedRoot!, ['checkout', '--', 'main.txt']);
  expect(git(protectedRoot!, ['status', '--porcelain=v1']).trim()).toBe('');
});

test.serial('local-only commits return LOCAL_MAIN_SYNC_BLOCKED(local-only-commits) without mutation', async () => {
  const remoteSha = git(protectedRoot!, ['rev-parse', 'origin/main']).trim();
  writeFileSync(path.join(protectedRoot!, 'local.txt'), 'local\n');
  git(protectedRoot!, ['add', 'local.txt']);
  git(protectedRoot!, ['commit', '--quiet', '--no-verify', '-m', 'local-only']);
  const localHead = git(protectedRoot!, ['rev-parse', 'HEAD']).trim();

  const status = await execute(binding(localHead));
  expect(status.status).toBe('LOCAL_MAIN_SYNC_BLOCKED');
  if (status.status === 'LOCAL_MAIN_SYNC_BLOCKED') expect(status.reason).toBe('local-only-commits');
  expect(git(protectedRoot!, ['rev-parse', 'HEAD']).trim()).toBe(localHead);
  expect(git(protectedRoot!, ['rev-parse', 'origin/main']).trim()).toBe(remoteSha);

  git(protectedRoot!, ['reset', '--hard', 'origin/main']);
});

test.serial('a diverged protected main returns LOCAL_MAIN_SYNC_BLOCKED without mutation', async () => {
  developerPush('v3\n');
  const remoteSha = git(remoteRoot!, ['rev-parse', 'main']).trim();
  writeFileSync(path.join(protectedRoot!, 'diverged.txt'), 'diverged\n');
  git(protectedRoot!, ['add', 'diverged.txt']);
  git(protectedRoot!, ['commit', '--quiet', '--no-verify', '-m', 'diverged local work']);
  const localHead = git(protectedRoot!, ['rev-parse', 'HEAD']).trim();

  const status = await execute(binding(localHead));
  expect(status.status).toBe('LOCAL_MAIN_SYNC_BLOCKED');
  if (status.status === 'LOCAL_MAIN_SYNC_BLOCKED') {
    expect(['local-only-commits', 'not-fast-forwardable']).toContain(status.reason);
  }
  expect(git(protectedRoot!, ['rev-parse', 'HEAD']).trim()).toBe(localHead);
  expect(git(protectedRoot!, ['rev-parse', 'origin/main']).trim()).toBe(remoteSha);

  git(protectedRoot!, ['reset', '--hard', 'origin/main']);
});

test.serial('an ignored local path colliding with the incoming tracked write set blocks ff-only publication', async () => {
  const localPath = path.join(protectedRoot!, 'generated.ts');
  const excludePath = path.join(protectedRoot!, '.git', 'info', 'exclude');
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

  await rm(localPath, { force: true });
  writeFileSync(excludePath, '');
  git(protectedRoot!, ['reset', '--hard', 'origin/main']);
});

function developerPush(content: string): void {
  writeFileSync(path.join(developerRoot!, 'main.txt'), content);
  git(developerRoot!, ['add', 'main.txt']);
  git(developerRoot!, ['commit', '--quiet', '--no-verify', '-m', `remote ${content.trim()}`]);
  git(developerRoot!, ['push', '--quiet', 'origin', 'main']);
}
