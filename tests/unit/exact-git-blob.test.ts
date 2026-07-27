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
  CodexDevelopmentReadExactGitBlobV1,
  type CodexDevelopmentExactGitBlobCommandResultV1
} from '../../scripts/codex/exact-git-blob.ts';

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

    const result = CodexDevelopmentReadExactGitBlobV1({
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

    expect(() => CodexDevelopmentReadExactGitBlobV1({
      repositoryRoot,
      commitSha,
      repositoryPath: '../ordinary'
    })).toThrow('canonical repository-relative path');
    expect(() => CodexDevelopmentReadExactGitBlobV1({
      repositoryRoot,
      commitSha,
      repositoryPath: 'missing'
    })).toThrow('path is missing');
    for (const repositoryPath of ['link', 'module']) {
      expect(() => CodexDevelopmentReadExactGitBlobV1({
        repositoryRoot,
        commitSha,
        repositoryPath
      })).toThrow('not an ordinary blob');
    }
    expect(() => CodexDevelopmentReadExactGitBlobV1({
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
  ): CodexDevelopmentExactGitBlobCommandResultV1 => {
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

  expect(() => CodexDevelopmentReadExactGitBlobV1({
    repositoryRoot,
    commitSha,
    repositoryPath: 'fixture',
    runGit
  })).toThrow('size mismatch');
});
