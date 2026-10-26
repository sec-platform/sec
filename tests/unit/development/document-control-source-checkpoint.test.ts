import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, expect, test } from 'bun:test';

import { withAcquiredResource } from '../../../src/execution/resource-settlement.ts';
import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';
import type { DevelopmentCommitAdmission } from '../../../src/adapters/self-hosting/development/commit-admission/operation.ts';
import { runDevelopmentCommit } from '../../../src/adapters/self-hosting/development/commit/operation.ts';

import { decodeDocumentControlCommand, validateSourceCheckpointStatusRequest } from '../../../src/adapters/self-hosting/control/documentation/document-control-cli.ts';
import { projectStatusContinuation } from '../../../src/adapters/self-hosting/control/documentation/document-control-plane-contract.ts';
import { resolveSourceCheckpointStatus } from '../../../src/adapters/self-hosting/control/documentation/document-control-source-checkpoint.ts';

function git(root: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

async function prepareRepository(root: string): Promise<void> {
  git(root, ['init', '--quiet', '--initial-branch=main']);
  git(root, ['config', 'user.name', 'SEC Tests']);
  git(root, ['config', 'user.email', 'tests@example.com']);
  await mkdir(path.join(root, 'config/repository'), { recursive: true });
  await writeFile(path.join(root, 'config/repository/current-state.yaml'), `schema: sec-current-state-live-v1
resolver:
  command: bun src/adapters/self-hosting/control/documentation/document-control-plane.ts status --json
  repository: sec-platform/sec
  remote: origin
  defaultBranch: main
  defaultRef: refs/remotes/origin/main
  requireRemoteMatch: true
stableFacts: {}
`);
  await writeFile(path.join(root, 'owned.txt'), 'base\n');
  await writeFile(path.join(root, 'other.txt'), 'other\n');
  git(root, ['add', '.']);
  git(root, ['commit', '--quiet', '-m', 'base']);
  git(root, ['checkout', '--quiet', '-b', 'source-checkpoint']);
}

let preparedRepository: Promise<string> | undefined;
async function fixture(root: string) {
  preparedRepository ??= (async () => {
    const template = await mkdtemp(path.join(tmpdir(), 'sec-source-checkpoint-base-'));
    try {
      await prepareRepository(template);
      return template;
    } catch (primary) {
      return settleWorkspaceCallback(async () => { throw primary; },
        () => rm(template, { recursive: true, force: true }));
    }
  })();
  await cp(await preparedRepository, root, { recursive: true });
  const base = git(root, ['rev-parse', 'HEAD']);
  return { root, base, request: { base, expectedHead: base, ownedPaths: ['owned.txt'] } };
}

afterAll(async () => {
  if (preparedRepository === undefined) return;
  const [settled] = await Promise.allSettled([preparedRepository]);
  if (settled!.status === 'fulfilled') {
    await rm(settled!.value, { recursive: true, force: true });
  }
});

async function withFixture(run: (value: Awaited<ReturnType<typeof fixture>>) => Promise<void>): Promise<void> {
  await withAcquiredResource({
    operationLabel: 'source-checkpoint-fixture', resourceLabel: 'source-checkpoint-fixture-root',
    acquire: () => mkdtemp(path.join(tmpdir(), 'sec-source-checkpoint-status-')),
    use: async root => run(await fixture(root)),
    release: root => rm(root, { recursive: true, force: true })
  });
}

test('source checkpoint CLI requires bounded exact input and leaves formal status unchanged', () => {
  const sha = 'a'.repeat(40);
  const args = ['status', '--source-checkpoint', '--base', sha, '--expected-head', sha, '--owned-path', 'owned.txt'];
  expect(decodeDocumentControlCommand(args, '/tmp').command).toBe('source-checkpoint-status');
  expect(decodeDocumentControlCommand(['status', '--json'], '/tmp')).toEqual({ command: 'status', workspace: '/tmp', full: false });
  for (const extra of [['--full'], ['--base', sha], ['--source-checkpoint'], ['--owned-path', 'owned.txt'], ['--merge']]) {
    expect(() => decodeDocumentControlCommand([...args, ...extra], '/tmp')).toThrow();
  }
  for (const file of ['../a', '/tmp/a', '.git/config', 'src/*', 'src//a', 'src/./a', 'src\\a']) {
    expect(() => validateSourceCheckpointStatusRequest({ base: sha, expectedHead: sha, ownedPaths: [file] })).toThrow();
  }
  expect(() => decodeDocumentControlCommand(['status', '--source-checkpoint'], '/tmp')).toThrow();
});

test('source route works without remote/provider or Work and does not issue formal qualification', async () => {
  await withFixture(async ({ root, base, request }) => {
    await writeFile(path.join(root, 'owned.txt'), 'source\n');
    git(root, ['add', 'owned.txt']);
    const index = path.join(root, '.git/index');
    const before = await readFile(index);
    const output = await resolveSourceCheckpointStatus(root, request);
    expect(output.blockers).toEqual([]);
    expect(output.next.owner).toBe('development.commit');
    expect(output.authority).toBe('observation-only');
    expect(output.formalQualification).toBe('not-issued');
    expect(output.unobservedOwners).toContain('development-commit-journal-census');
    expect(output.unobservedOwners).toContain('explicit-user-authorization');
    expect(output.subject.head).toBe(base);
    expect(output.changes.staged).toEqual(['owned.txt']);
    expect(await readFile(index)).toEqual(before);
    expect(git(root, ['rev-parse', 'HEAD'])).toBe(base);
    const formal = projectStatusContinuation({
      repositoryRoot: root, headSha: base, candidateTreeSha: null, defaultRefState: 'unavailable',
      activeWorkPackage: { state: 'unresolved', reason: 'default-ref-unavailable' },
      pointerManifest: null, changes: null, journal: null
    });
    expect(formal.next.action).toBe('refresh-observation');
    expect(formal.authority).toBe('observation-only');
    expect('activeWorkPackage' in output).toBeFalse();
    expect('mainHealth' in output).toBeFalse();
    await expect(runDevelopmentCommit({
      repositoryRoot: root, message: 'must not publish status',
      author: { name: 'SEC Tests', email: 'tests@example.com', date: '1700000100 +0000' },
      committer: { name: 'SEC Tests', email: 'tests@example.com', date: '1700000100 +0000' }
    }, output as unknown as DevelopmentCommitAdmission)).rejects.toThrow('foreign or structurally reproduced');
    expect(git(root, ['rev-parse', 'HEAD'])).toBe(base);

  });
});

test('source checkpoint refuses unowned staged, unstaged and untracked paths without changing them', async () => {
  await withFixture(async ({ root, request }) => {
    await writeFile(path.join(root, 'other.txt'), 'foreign staged\n');
    git(root, ['add', 'other.txt']);
    await writeFile(path.join(root, 'other.txt'), 'foreign unstaged\n');
    await writeFile(path.join(root, 'untracked.txt'), 'foreign new\n');
    const output = await resolveSourceCheckpointStatus(root, request);
    expect(output.blockers).toContain('changed-path-ownership-unresolved');
    expect(output.unownedPaths).toEqual(['other.txt', 'untracked.txt']);
    expect(output.changes.staged).toEqual(['other.txt']);
    expect(output.changes.unstaged).toEqual(['other.txt']);
    expect(await readFile(path.join(root, 'other.txt'), 'utf8')).toBe('foreign unstaged\n');
  });
});

test('source checkpoint checks both rename endpoints and complete committed delta', async () => {
  await withFixture(async ({ root, request }) => {
    git(root, ['mv', 'other.txt', 'renamed.txt']);
    git(root, ['commit', '--quiet', '-m', 'rename']);
    const expectedHead = git(root, ['rev-parse', 'HEAD']);
    const output = await resolveSourceCheckpointStatus(root, { ...request, expectedHead, ownedPaths: ['renamed.txt'] });
    expect(output.unownedPaths).toEqual(['other.txt']);
    expect(output.blockers).toContain('changed-path-ownership-unresolved');
    expect((await resolveSourceCheckpointStatus(root, { ...request, expectedHead, ownedPaths: ['other.txt', 'renamed.txt'] })).blockers).toEqual([]);
    expect((await resolveSourceCheckpointStatus(root, request)).blockers).toContain('expected-head-drift');
  });
});

test('source checkpoint refuses detached/default refs and nonancestor base', async () => {
  await withFixture(async ({ root, base, request }) => {
    git(root, ['checkout', '--quiet', 'main']);
    expect((await resolveSourceCheckpointStatus(root, request)).blockers).toContain('default-ref-not-source-checkpoint');
    git(root, ['checkout', '--quiet', '--detach', base]);
    expect((await resolveSourceCheckpointStatus(root, request)).blockers).toContain('detached-or-invalid-branch');
    git(root, ['checkout', '--quiet', 'source-checkpoint']);
    await writeFile(path.join(root, 'owned.txt'), 'future\n');
    git(root, ['add', 'owned.txt']);
    git(root, ['commit', '--quiet', '-m', 'future']);
    const future = git(root, ['rev-parse', 'HEAD']);
    git(root, ['checkout', '--quiet', '-b', 'older-checkpoint', base]);
    expect((await resolveSourceCheckpointStatus(root, { ...request, base: future })).blockers).toContain('base-not-ancestor');
  });
});

test('owned formal control projection remains outside source publication lane', async () => {
  await withFixture(async ({ root, request }) => {
    const file = 'config/repository/active-work-package.md';
    await writeFile(path.join(root, file), 'not an activation\n');
    const output = await resolveSourceCheckpointStatus(root, { ...request, ownedPaths: [file] });
    expect(output.blockers).toContain('formal-control-projection-not-source-checkpoint');
    expect(output.formalQualification).toBe('not-issued');
  });
});
