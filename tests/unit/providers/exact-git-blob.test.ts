import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  listExactGitTreeEntries,
  parseExactGitBlobsBatch,
  readExactGitTextBlobsBatch
} from '../../../src/adapters/providers/git-read/exact-blob.ts';

function git(
  repositoryRoot: string,
  args: readonly string[],
  options: { input?: string } = {}
): string {
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    input: options.input,
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function initializeRepository(): string {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'sec-exact-git-blob-'));
  git(repositoryRoot, ['init', '--quiet', '--initial-branch=main']);
  git(repositoryRoot, ['config', 'user.name', 'SEC Test']);
  git(repositoryRoot, ['config', 'user.email', 'sec-test@example.invalid']);
  git(repositoryRoot, ['config', 'core.autocrlf', 'true']);
  return repositoryRoot;
}

test('exact Git batch reader preserves absence and rejects invalid, nonordinary, or oversized requests', () => {
  const repositoryRoot = initializeRepository();
  try {
    writeFileSync(path.join(repositoryRoot, 'ordinary'), 'ordinary\n', 'utf8');
    writeFileSync(path.join(repositoryRoot, 'nested-file'), 'nested\n', 'utf8');
    git(repositoryRoot, ['add', 'ordinary', 'nested-file']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'base']);
    const baseCommit = git(repositoryRoot, ['rev-parse', 'HEAD']);
    const linkBlob = git(repositoryRoot, ['hash-object', '-w', '--stdin'], { input: 'ordinary' });
    git(repositoryRoot, ['update-index', '--add', '--cacheinfo', `120000,${linkBlob},link`]);
    git(repositoryRoot, ['update-index', '--add', '--cacheinfo', `160000,${baseCommit},module`]);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'nonordinary']);
    const commitSha = git(repositoryRoot, ['rev-parse', 'HEAD']);

    const entries = listExactGitTreeEntries({ repositoryRoot, commitSha });
    const ordinary = entries.find(({ repositoryPath }) => repositoryPath === 'ordinary')!;
    expect(() => readExactGitTextBlobsBatch({
      repositoryRoot,
      entries: [{ ...ordinary, repositoryPath: '../ordinary' }]
    })).toThrow('canonical repository-relative path');
    expect(entries.some(({ repositoryPath }) => repositoryPath === 'missing')).toBe(false);
    for (const repositoryPath of ['link', 'module']) {
      expect(() => readExactGitTextBlobsBatch({
        repositoryRoot,
        entries: [entries.find((entry) => entry.repositoryPath === repositoryPath)!]
      })).toThrow('not one ordinary blob');
    }
    expect(() => readExactGitTextBlobsBatch({
      repositoryRoot,
      maxTotalBytes: 2,
      entries: [ordinary]
    })).toThrow('exceeds maxTotalBytes');
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
});

test('exact Git batch reader preserves LF path-to-blob identity despite checkout, replacement, and environment drift', () => {
  const repositoryRoot = initializeRepository();
  const previousGitDir = process.env.GIT_DIR;
  try {
    writeFileSync(path.join(repositoryRoot, 'first.ts'), 'export const first = 1;\n', 'utf8');
    writeFileSync(path.join(repositoryRoot, 'second.ts'), 'export const second = 2;\n', 'utf8');
    git(repositoryRoot, ['add', 'first.ts', 'second.ts']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'batch']);
    const commitSha = git(repositoryRoot, ['rev-parse', 'HEAD']);
    const originalBlob = git(repositoryRoot, ['rev-parse', `${commitSha}:first.ts`]);
    const replacementBlob = git(repositoryRoot, ['hash-object', '-w', '--stdin'], {
      input: 'replacement-object-view\n'
    });
    git(repositoryRoot, ['replace', originalBlob, replacementBlob]);
    expect(git(repositoryRoot, ['cat-file', 'blob', originalBlob])).toBe('replacement-object-view');
    writeFileSync(path.join(repositoryRoot, 'first.ts'), 'export const first = 1;\r\n', 'utf8');
    expect(readFileSync(path.join(repositoryRoot, 'first.ts'), 'utf8')).toBe('export const first = 1;\r\n');
    process.env.GIT_DIR = path.join(repositoryRoot, 'nonexistent-ambient.git');

    // This synchronous reader still supplies exact compiler/TestImpact fixtures.
    // Each diversion independently disagrees with these fixed committed bytes.
    const entries = listExactGitTreeEntries({ repositoryRoot, commitSha });
    expect(entries).toEqual([
      expect.objectContaining({ repositoryPath: 'first.ts', mode: '100644', type: 'blob' }),
      expect.objectContaining({ repositoryPath: 'second.ts', mode: '100644', type: 'blob' })
    ]);
    const source = readExactGitTextBlobsBatch({ repositoryRoot, entries });
    expect(source.map(({ repositoryPath, source: text }) => [repositoryPath, text])).toEqual([
      ['first.ts', 'export const first = 1;\n'],
      ['second.ts', 'export const second = 2;\n']
    ]);
    expect(() => parseExactGitBlobsBatch(
      [entries[0]!],
      Buffer.from(`${'f'.repeat(40)} blob 1\nx\n`, 'utf8'),
      1024
    )).toThrow('header does not match');
  } finally {
    if (previousGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previousGitDir;
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
});
