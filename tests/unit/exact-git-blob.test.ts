import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  CodexDevelopmentListExactGitTreeEntries,
  CodexDevelopmentReadExactGitBlob,
  CodexDevelopmentReadExactGitTextBlobsBatch,
  type CodexDevelopmentExactGitBlobCommandResult
} from '../../src/external-capabilities/git-read/exact-blob.ts';

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

test('exact Git blob reader binds raw LF bytes despite a CRLF checkout', () => {
  const repositoryRoot = initializeRepository();
  try {
    const repositoryPath = 'docs/work-packages/fixture.md';
    const absolutePath = path.join(repositoryRoot, ...repositoryPath.split('/'));
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, 'line-one\nline-two\n', 'utf8');
    git(repositoryRoot, ['add', repositoryPath]);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'fixture']);
    const commitSha = git(repositoryRoot, ['rev-parse', 'HEAD']);
    writeFileSync(absolutePath, 'line-one\r\nline-two\r\n', 'utf8');
    expect(readFileSync(absolutePath, 'utf8')).toBe('line-one\r\nline-two\r\n');

    const result = CodexDevelopmentReadExactGitBlob({
      repositoryRoot,
      commitSha,
      repositoryPath
    });

    expect(result).toMatchObject({ mode: '100644', type: 'blob' });
    expect(new TextDecoder().decode(result.bytes)).toBe('line-one\nline-two\n');
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
});

test('exact Git blob reader ignores replacement-object views', () => {
  const repositoryRoot = initializeRepository();
  try {
    writeFileSync(path.join(repositoryRoot, 'fixture.txt'), 'original-bytes\n', 'utf8');
    git(repositoryRoot, ['add', 'fixture.txt']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'original']);
    const commitSha = git(repositoryRoot, ['rev-parse', 'HEAD']);
    const originalBlob = git(repositoryRoot, ['rev-parse', `${commitSha}:fixture.txt`]);
    const replacementBlob = git(repositoryRoot, ['hash-object', '-w', '--stdin'], {
      input: 'replacement-object-view\n'
    });
    git(repositoryRoot, ['replace', originalBlob, replacementBlob]);
    expect(git(repositoryRoot, ['cat-file', 'blob', originalBlob])).toContain('replacement-object-view');

    const result = CodexDevelopmentReadExactGitBlob({
      repositoryRoot,
      commitSha,
      repositoryPath: 'fixture.txt'
    });
    expect(new TextDecoder().decode(result.bytes)).toBe('original-bytes\n');
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
});

test('exact Git blob reader ignores ambient repository redirection', () => {
  const repositoryRoot = initializeRepository();
  const previousGitDir = process.env.GIT_DIR;
  try {
    writeFileSync(path.join(repositoryRoot, 'fixture.txt'), 'repository-subject\n', 'utf8');
    git(repositoryRoot, ['add', 'fixture.txt']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'subject']);
    const commitSha = git(repositoryRoot, ['rev-parse', 'HEAD']);
    process.env.GIT_DIR = path.join(repositoryRoot, 'nonexistent-ambient.git');

    const result = CodexDevelopmentReadExactGitBlob({
      repositoryRoot,
      commitSha,
      repositoryPath: 'fixture.txt'
    });
    expect(new TextDecoder().decode(result.bytes)).toBe('repository-subject\n');
  } finally {
    if (previousGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previousGitDir;
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
});

test('exact Git blob reader rejects invalid, missing, nonordinary, and oversized paths', () => {
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

    expect(() => CodexDevelopmentReadExactGitBlob({
      repositoryRoot,
      commitSha,
      repositoryPath: '../ordinary'
    })).toThrow('canonical repository-relative path');
    expect(() => CodexDevelopmentReadExactGitBlob({
      repositoryRoot,
      commitSha,
      repositoryPath: 'missing'
    })).toThrow('path is missing');
    for (const repositoryPath of ['link', 'module']) {
      expect(() => CodexDevelopmentReadExactGitBlob({
        repositoryRoot,
        commitSha,
        repositoryPath
      })).toThrow('not an ordinary blob');
    }
    expect(() => CodexDevelopmentReadExactGitBlob({
      repositoryRoot,
      commitSha,
      maxBytes: 2,
      repositoryPath: 'ordinary'
    })).toThrow('exceeds maxBytes');
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
});

test('exact Git blob reader rejects a cat-file byte-count mismatch', () => {
  const repositoryRoot = path.resolve(tmpdir());
  const commitSha = '1'.repeat(40);
  const blobSha = '2'.repeat(40);
  const runGit = (
    _root: string,
    args: readonly string[]
  ): CodexDevelopmentExactGitBlobCommandResult => {
    let stdout: Buffer;
    if (args[0] === 'ls-tree') {
      stdout = Buffer.from(`100644 blob ${blobSha}\tfixture\0`, 'utf8');
    } else if (args[1] === '-s') {
      stdout = Buffer.from('4\n', 'utf8');
    } else {
      stdout = Buffer.from('abc', 'utf8');
    }
    return { status: 0, stderr: Buffer.alloc(0), stdout };
  };

  expect(() => CodexDevelopmentReadExactGitBlob({
    repositoryRoot,
    commitSha,
    repositoryPath: 'fixture',
    runGit
  })).toThrow('size mismatch');
});

test('exact Git text batch preserves path-to-blob identity and rejects malformed output', () => {
  const repositoryRoot = initializeRepository();
  try {
    writeFileSync(path.join(repositoryRoot, 'first.ts'), 'export const first = 1;\n', 'utf8');
    writeFileSync(path.join(repositoryRoot, 'second.ts'), 'export const second = 2;\n', 'utf8');
    git(repositoryRoot, ['add', 'first.ts', 'second.ts']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'batch']);
    const commitSha = git(repositoryRoot, ['rev-parse', 'HEAD']);
    const entries = CodexDevelopmentListExactGitTreeEntries({ repositoryRoot, commitSha });
    const source = CodexDevelopmentReadExactGitTextBlobsBatch({
      repositoryRoot,
      entries
    });
    expect(source.map(({ repositoryPath, source: text }) => [repositoryPath, text])).toEqual([
      ['first.ts', 'export const first = 1;\n'],
      ['second.ts', 'export const second = 2;\n']
    ]);

    expect(() => CodexDevelopmentReadExactGitTextBlobsBatch({
      repositoryRoot,
      entries: [entries[0]!],
      runGitBatch: () => ({
        status: 0,
        stderr: Buffer.alloc(0),
        stdout: Buffer.from(`${'f'.repeat(40)} blob 1\nx\n`, 'utf8')
      })
    })).toThrow('header does not match');
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
});
