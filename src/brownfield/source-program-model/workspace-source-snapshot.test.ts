import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'bun:test';

import { GIT_READ_OPERATION_BUDGET } from '../../development/tooling/git/git-read.ts';
import { withAuthorityGitReadSession } from '../../external-capabilities/git-read/authority.ts';
import { auditRepository } from '../repository-audit/cli.ts';
import {
  acquireExactGitTreeWorkspaceSourceSnapshot,
  acquireWorkingTreeWorkspaceSourceSnapshot
} from './workspace-source-snapshot.ts';

const temporaryRepositories: string[] = [];

function git(repositoryRoot: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

async function createRepository(): Promise<Readonly<{ commitSha: string; repositoryRoot: string }>> {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-workspace-source-generation-'));
  temporaryRepositories.push(repositoryRoot);
  git(repositoryRoot, ['init', '--quiet']);
  git(repositoryRoot, ['config', 'user.email', 'tests@example.com']);
  git(repositoryRoot, ['config', 'user.name', 'SEC Tests']);
  git(repositoryRoot, ['config', 'core.autocrlf', 'false']);
  await mkdir(path.join(repositoryRoot, 'src', 'example'), { recursive: true });
  await writeFile(
    path.join(repositoryRoot, 'src', 'example', 'sec.module.json'),
    `${JSON.stringify({
      importGraph: 'runtime',
      externalEntrypoints: [],
      capabilityProviders: [],
      preDependencyBootstrap: false
    }, null, 2)}\n`
  );
  await writeFile(
    path.join(repositoryRoot, 'src', 'example', 'value.ts'),
    'export const value = 1;\n'
  );
  await writeFile(
    path.join(repositoryRoot, 'src', 'example', 'removed.ts'),
    'export const removed = true;\n'
  );
  git(repositoryRoot, ['add', '--all']);
  git(repositoryRoot, ['update-index', '--chmod=+x', 'src/example/value.ts']);
  git(repositoryRoot, ['commit', '--quiet', '-m', 'source generation fixture']);
  return Object.freeze({
    commitSha: git(repositoryRoot, ['rev-parse', 'HEAD']),
    repositoryRoot
  });
}

async function workingSnapshot(repositoryRoot: string) {
  return withAuthorityGitReadSession({
    cwd: repositoryRoot,
    budget: Object.freeze({ ...GIT_READ_OPERATION_BUDGET, maxProcesses: 4 })
  }, (session) => acquireWorkingTreeWorkspaceSourceSnapshot({ session }));
}

afterEach(async () => {
  while (temporaryRepositories.length > 0) {
    await rm(temporaryRepositories.pop()!, { recursive: true, force: true });
  }
});

test('working tree and exact Git tree issue one transport-neutral source generation', async () => {
  const { commitSha, repositoryRoot } = await createRepository();
  const exact = acquireExactGitTreeWorkspaceSourceSnapshot({ repositoryRoot, commitSha });
  const working = await workingSnapshot(repositoryRoot);

  expect(working.sourceRevision).toBe(exact.sourceRevision);
  expect(working.files.map(({ path: repositoryPath, mode, contentDigest }) => ({
    path: repositoryPath,
    mode,
    contentDigest
  }))).toEqual(exact.files.map(({ path: repositoryPath, mode, contentDigest }) => ({
    path: repositoryPath,
    mode,
    contentDigest
  })));
  expect(exact.file('src/example/value.ts')?.mode).toBe('100755');
  expect(working.file('src/example/value.ts')?.mode).toBe('100755');
  expect(working.subjectDigest).not.toBe(exact.subjectDigest);
  expect(working.physicalObservationReceipt?.kind).toBe('working-tree-observation');
  expect(exact.physicalObservationReceipt).toMatchObject({ kind: 'git-tree', commitSha });
});

test('working generation includes dirty and untracked source while excluding deleted membership', async () => {
  const { commitSha, repositoryRoot } = await createRepository();
  const exact = acquireExactGitTreeWorkspaceSourceSnapshot({ repositoryRoot, commitSha });
  await writeFile(
    path.join(repositoryRoot, 'src', 'example', 'value.ts'),
    'export const value = 2;\n'
  );
  await unlink(path.join(repositoryRoot, 'src', 'example', 'removed.ts'));
  await writeFile(
    path.join(repositoryRoot, 'src', 'example', 'untracked.ts'),
    'export const untracked = true;\n'
  );

  const working = await workingSnapshot(repositoryRoot);
  expect(working.sourceRevision).not.toBe(exact.sourceRevision);
  expect(working.file('src/example/value.ts')?.source).toContain('value = 2');
  expect(working.file('src/example/untracked.ts')).not.toBeNull();
  expect(working.file('src/example/removed.ts')).toBeNull();
});

test('repository audit projects the owner-issued exact source generation', async () => {
  const { commitSha, repositoryRoot } = await createRepository();
  const exact = acquireExactGitTreeWorkspaceSourceSnapshot({ repositoryRoot, commitSha });
  const report = await auditRepository(repositoryRoot, { defaultRef: commitSha });

  expect(report.sourceProgram.sourceRevision).toBe(exact.sourceRevision);
  expect(report.sourceProgramCompilation.snapshotDigest).toBe(exact.snapshotDigest);
  expect(report.sourceProgramCompilation.moduleGraphDigest).toBe(exact.moduleGraphDigest);
});
