import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { createHostGitReadSessionForTests } from '../../src/adapters/providers/git-read/runtime/session.ts';
import {
  issueDevelopmentCommitAdmission,
  type DevelopmentCommitAdmission,
  type DevelopmentCommitRequest
} from '../../src/adapters/self-hosting/development/commit-admission/operation.ts';
import {
  acknowledgeDevelopmentCommitResult,
  readDevelopmentCommitOutcome,
  recoverDevelopmentCommit,
  runDevelopmentCommit,
  settleDevelopmentCommitJournalsForRef
} from '../../src/adapters/self-hosting/development/commit/operation.ts';
import { IMPORT_NORMALIZATION_OPERATION } from '../../src/adapters/self-hosting/development/import-normalization/contract.ts';

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
  const moduleRoot = path.join(
    root,
    'src',
    'adapters',
    'self-hosting',
    'development',
    'import-normalization'
  );
  await mkdir(moduleRoot, { recursive: true });
  await Promise.all([
    writeFile(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"noEmit":true}}\n'),
    writeFile(path.join(moduleRoot, 'kernel.ts'), 'export function normalize(): void {}\n'),
    writeFile(
      path.join(moduleRoot, 'runtime.ts'),
      "export { normalize as verifyCandidateImportNormalization } from './kernel.ts';\n"
    ),
    writeFile(path.join(moduleRoot, 'module.json'), `${JSON.stringify({
      importGraph: 'runtime',
      externalEntrypoints: ['src/adapters/self-hosting/development/import-normalization/runtime.ts'],
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
    const recovered = await recoverDevelopmentCommit({ repositoryRoot: root, journalPath: result.journalPath });
    expect(recovered.result.disposition).toBe('applied');
    expect(recovered.result.target).toBe(result.target);
    await expect(runDevelopmentCommit(request, prepared.admission))
      .rejects.toThrow('already been consumed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

test('development.commit retires only the exact owner-issued applied journal after delivery', async () => {
  const { root } = await fixture();
  try {
    const prepared = await issueDevelopmentCommitAdmission({ repositoryRoot: root, message: 'apply staged candidate\n' });
    const result = await runDevelopmentCommit(prepared.request, prepared.admission);
    const source = await readFile(result.journalPath, 'utf8');
    expect(source).toContain('"terminal":"applied"');
    expect(() => acknowledgeDevelopmentCommitResult({ ...result })).toThrow('owner-issued result');
    expect(await readFile(result.journalPath, 'utf8')).toBe(source);
    if (process.platform === 'linux') {
      expect(() => acknowledgeDevelopmentCommitResult(result))
        .toThrow('needs a native namespace exclusion on Linux');
      expect(await readFile(result.journalPath, 'utf8')).toBe(source);
      return;
    }
    acknowledgeDevelopmentCommitResult(result);
    await expect(lstat(result.journalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(() => acknowledgeDevelopmentCommitResult(result)).toThrow('owner-issued result');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

test('development.commit classifies every exact-ref journal before retiring any', async () => {
  const { root } = await fixture();
  try {
    const prepared = await issueDevelopmentCommitAdmission({ repositoryRoot: root, message: 'apply staged candidate\n' });
    const result = await runDevelopmentCommit(prepared.request, prepared.admission);
    const source = await readFile(result.journalPath, 'utf8');
    const unknown = { ...JSON.parse(source) as Record<string, unknown>,
      attempt: `sha256:${'a'.repeat(64)}`, target: 'b'.repeat(40), object: null, terminal: 'unknown' };
    const unknownPath = path.join(path.dirname(result.journalPath), `${'a'.repeat(64)}.json`);
    await writeFile(unknownPath, `${JSON.stringify(unknown)}\n`);
    await expect(settleDevelopmentCommitJournalsForRef({ repositoryRoot: root, ref: result.ref }))
      .rejects.toThrow('requires applied readback');
    expect(await readFile(result.journalPath, 'utf8')).toBe(source);
    await rm(unknownPath);
    if (process.platform === 'linux') {
      await expect(settleDevelopmentCommitJournalsForRef({ repositoryRoot: root, ref: result.ref }))
        .rejects.toThrow('needs a native namespace exclusion on Linux');
      expect(await readFile(result.journalPath, 'utf8')).toBe(source);
      return;
    }
    expect(await settleDevelopmentCommitJournalsForRef({ repositoryRoot: root, ref: result.ref }))
      .toEqual({ ref: result.ref, observed: 1, retired: 1 });
    await expect(lstat(result.journalPath)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

test('development.commit reports failed staged normalization without publishing the candidate', async () => {
  const { root, request } = await fixture();
  try {
    const kernelPath = 'src/adapters/self-hosting/development/import-normalization/kernel.ts';
    await writeFile(path.join(root, kernelPath),
      "import path from 'node:path';\nimport fs from 'node:fs';\nexport function normalize(): void { void fs; void path; }\n");
    git(root, ['add', '--', kernelPath]);
    const before = {
      head: git(root, ['rev-parse', 'HEAD']),
      tree: git(root, ['write-tree'])
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(issueDevelopmentCommitAdmission({ request }))
        .rejects.toThrow('Candidate import normalization blocked commit: failed; action sha256:');
      expect({
        head: git(root, ['rev-parse', 'HEAD']),
        tree: git(root, ['write-tree'])
      }).toEqual(before);
    }
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

test('development.commit keeps a failed reflog observation unknown instead of authorizing another effect', async () => {
  const { root } = await fixture();
  try {
    const preimage = git(root, ['rev-parse', 'HEAD']);
    git(root, ['commit', '--quiet', '-m', 'detached target object']);
    const target = git(root, ['rev-parse', 'HEAD']);
    const tree = git(root, ['rev-parse', 'HEAD^{tree}']);
    const ref = git(root, ['symbolic-ref', 'HEAD']);
    git(root, ['reset', '--soft', preimage]);
    const commonDirectory = path.resolve(root, git(root, ['rev-parse', '--git-common-dir']));
    const hostSession = createHostGitReadSessionForTests({ cwd: root });
    const session = Object.freeze({
      ...hostSession,
      run: (args: readonly string[]) => args[0] === 'rev-list' && args[1] === '--walk-reflogs'
        ? Promise.resolve(Object.freeze({
          kind: 'unresolved-git-read-session' as const,
          reason: 'command-error' as const,
          detail: 'independent reflog observation failure'
        }))
        : hostSession.run(args)
    });
    try {
      const journal: Parameters<typeof readDevelopmentCommitOutcome>[0]['journal'] = Object.freeze({
        schema: 'sec-development-commit-journal-v1',
        operation: `sha256:${'1'.repeat(64)}`,
        attempt: `sha256:${'2'.repeat(64)}`,
        ref,
        preimage,
        target,
        object: target,
        tree,
        terminal: null
      });
      const readback = await readDevelopmentCommitOutcome({
        session,
        commonDirectory,
        journal,
        normal: null
      });
      expect(readback.disposition).toBe('unknown');
    } finally {
      await hostSession.close?.();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('development.commit rejects a real unfinished merge without publishing or consuming its state', async () => {
  const { root, request } = await fixture();
  try {
    const base = git(root, ['rev-parse', 'HEAD']);
    git(root, ['commit', '--quiet', '-m', 'current branch delta']);
    const currentBranch = git(root, ['symbolic-ref', '--short', 'HEAD']);
    git(root, ['switch', '--quiet', '-c', 'incoming', base]);
    await writeFile(path.join(root, 'incoming.txt'), 'incoming\n');
    git(root, ['add', 'incoming.txt']);
    git(root, ['commit', '--quiet', '-m', 'incoming delta']);
    git(root, ['switch', '--quiet', currentBranch]);
    git(root, ['merge', '--no-commit', '--no-ff', 'incoming']);
    const gitDirectory = git(root, ['rev-parse', '--absolute-git-dir']);
    const observe = async () => ({
      head: git(root, ['rev-parse', 'HEAD']),
      tree: git(root, ['write-tree']),
      objects: git(root, ['count-objects', '-v']),
      mergeHead: await readFile(path.join(gitDirectory, 'MERGE_HEAD'), 'utf8')
    });
    const before = await observe();
    await expect(issueDevelopmentCommitAdmission({ request }))
      .rejects.toThrow('unfinished Git operation: MERGE_HEAD');
    expect(await observe()).toEqual(before);
    await expect(lstat(path.join(gitDirectory, 'sec-development-commit')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

test('development.commit fences sequencer state introduced after admission', async () => {
  const { root, request } = await fixture();
  try {
    const prepared = await issueDevelopmentCommitAdmission({ request });
    const gitDirectory = git(root, ['rev-parse', '--absolute-git-dir']);
    await mkdir(path.join(gitDirectory, 'sequencer'));
    const before = {
      head: git(root, ['rev-parse', 'HEAD']),
      tree: git(root, ['write-tree']),
      objects: git(root, ['count-objects', '-v'])
    };
    await expect(runDevelopmentCommit(request, prepared.admission))
      .rejects.toThrow('unfinished Git operation: sequencer');
    expect({
      head: git(root, ['rev-parse', 'HEAD']),
      tree: git(root, ['write-tree']),
      objects: git(root, ['count-objects', '-v'])
    }).toEqual(before);
    await expect(lstat(path.join(gitDirectory, 'sec-development-commit')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
