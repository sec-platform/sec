import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  issueDevelopmentCommitAdmission,
  type DevelopmentCommitAdmission,
  type DevelopmentCommitRequest
} from '../../src/development/commit-admission/operation.ts';
import { runDevelopmentCommit } from '../../src/development/commit/operation.ts';
import { IMPORT_NORMALIZATION_OPERATION } from '../../src/development/import-normalization/contract.ts';

function git(root: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

async function fixture(): Promise<Readonly<{
  root: string;
  request: DevelopmentCommitRequest;
}>> {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-development-commit-'));
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'SEC Tests']);
  git(root, ['config', 'user.email', 'tests@example.com']);
  const moduleRoot = path.join(root, 'src', 'development', 'import-normalization');
  await mkdir(moduleRoot, { recursive: true });
  await Promise.all([
    writeFile(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"noEmit":true}}\n'),
    writeFile(path.join(moduleRoot, 'kernel.ts'), 'export function normalize(): void {}\n'),
    writeFile(
      path.join(moduleRoot, 'runtime.ts'),
      "export { normalize as verifyCandidateImportNormalization } from './kernel.ts';\n"
    ),
    writeFile(path.join(moduleRoot, 'sec.module.json'), `${JSON.stringify({
      importGraph: 'runtime',
      externalEntrypoints: ['src/development/import-normalization/runtime.ts'],
      capabilityProviders: [{
        capability: IMPORT_NORMALIZATION_OPERATION.capability,
        operations: [IMPORT_NORMALIZATION_OPERATION.operation]
      }]
    })}\n`)
  ]);
  git(root, ['add', '--all']);
  git(root, ['commit', '--quiet', '-m', 'base']);
  await writeFile(path.join(root, 'next.txt'), 'next\n');
  git(root, ['add', 'next.txt']);
  return Object.freeze({
    root,
    request: Object.freeze({
      repositoryRoot: path.resolve(root),
      message: 'apply staged candidate\n',
      author: Object.freeze({
        name: 'SEC Tests',
        email: 'tests@example.com',
        date: '1700000100 +0000'
      }),
      committer: Object.freeze({
        name: 'SEC Tests',
        email: 'tests@example.com',
        date: '1700000100 +0000'
      })
    })
  });
}

test('development.commit consumes one exact staged admission before publishing its Git Effect', async () => {
  const { root } = await fixture();
  try {
    const preimage = git(root, ['rev-parse', 'HEAD']);
    const prepared = await issueDevelopmentCommitAdmission({
      repositoryRoot: root,
      message: 'apply staged candidate\n'
    });
    const { request } = prepared;
    await expect(runDevelopmentCommit(
      request,
      { ...prepared.admission } as DevelopmentCommitAdmission
    )).rejects.toThrow('foreign or structurally reproduced');
    expect(git(root, ['rev-parse', 'HEAD'])).toBe(preimage);

    const result = await runDevelopmentCommit(request, prepared.admission);
    expect(result.disposition).toBe('applied');
    expect(result.preimage).toBe(preimage);
    expect(git(root, ['rev-parse', 'HEAD'])).toBe(result.target);
    expect(git(root, ['status', '--porcelain'])).toBe('');
    await expect(runDevelopmentCommit(request, prepared.admission))
      .rejects.toThrow('already been consumed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

test('development.commit rejects missing admission before repository Effect', async () => {
  const { root, request } = await fixture();
  try {
    const before = Object.freeze({
      head: git(root, ['rev-parse', 'HEAD']),
      tree: git(root, ['write-tree']),
      objects: git(root, ['count-objects', '-v'])
    });
    await expect(runDevelopmentCommit(
      request,
      Object.freeze({}) as DevelopmentCommitAdmission
    )).rejects.toThrow('foreign or structurally reproduced');
    expect({
      head: git(root, ['rev-parse', 'HEAD']),
      tree: git(root, ['write-tree']),
      objects: git(root, ['count-objects', '-v'])
    }).toEqual(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
