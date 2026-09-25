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
  ListExactGitTreeEntriesFromSession,
  ReadExactGitBlobFromSession,
  ReadExactGitTextBlobsBatchFromSession,
  parseExactGitBlobsBatch
} from '../../src/adapters/providers/git-read/exact-blob.ts';
import { withTestGitReadAuthority } from '../helpers/git-read-authority.ts';

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

test('exact Git blob reader binds raw LF bytes despite a CRLF checkout', async () => {
  const repositoryRoot = initializeRepository();
  try {
    const repositoryPath = 'config/repository/work-packages/fixture.md';
    const absolutePath = path.join(repositoryRoot, ...repositoryPath.split('/'));
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, 'line-one\nline-two\n', 'utf8');
    git(repositoryRoot, ['add', repositoryPath]);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'fixture']);
    const commitSha = git(repositoryRoot, ['rev-parse', 'HEAD']);
    writeFileSync(absolutePath, 'line-one\r\nline-two\r\n', 'utf8');
    expect(readFileSync(absolutePath, 'utf8')).toBe('line-one\r\nline-two\r\n');

    const result = await withTestGitReadAuthority(repositoryRoot, (session) => (
      ReadExactGitBlobFromSession(session, { commitSha, repositoryPath })
    ));

    expect(result).toMatchObject({ mode: '100644', type: 'blob' });
    expect(new TextDecoder().decode(result.bytes)).toBe('line-one\nline-two\n');
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
});

test('exact Git blob reader ignores replacement-object views', async () => {
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

    const result = await withTestGitReadAuthority(repositoryRoot, (session) => (
      ReadExactGitBlobFromSession(session, {
        commitSha,
        repositoryPath: 'fixture.txt'
      })
    ));
    expect(new TextDecoder().decode(result.bytes)).toBe('original-bytes\n');
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
});

test('exact Git blob reader ignores ambient repository redirection', async () => {
  const repositoryRoot = initializeRepository();
  const previousGitDir = process.env.GIT_DIR;
  try {
    writeFileSync(path.join(repositoryRoot, 'fixture.txt'), 'repository-subject\n', 'utf8');
    git(repositoryRoot, ['add', 'fixture.txt']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'subject']);
    const commitSha = git(repositoryRoot, ['rev-parse', 'HEAD']);
    process.env.GIT_DIR = path.join(repositoryRoot, 'nonexistent-ambient.git');

    const result = await withTestGitReadAuthority(repositoryRoot, (session) => (
      ReadExactGitBlobFromSession(session, {
        commitSha,
        repositoryPath: 'fixture.txt'
      })
    ));
    expect(new TextDecoder().decode(result.bytes)).toBe('repository-subject\n');
  } finally {
    if (previousGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previousGitDir;
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
});

test('exact Git blob reader rejects invalid, missing, nonordinary, and oversized paths', async () => {
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

    await withTestGitReadAuthority(repositoryRoot, async (session) => {
      await expect(ReadExactGitBlobFromSession(session, {
        commitSha,
        repositoryPath: '../ordinary'
      })).rejects.toThrow('canonical repository-relative path');
      await expect(ReadExactGitBlobFromSession(session, {
        commitSha,
        repositoryPath: 'missing'
      })).rejects.toThrow('path is missing');
      for (const repositoryPath of ['link', 'module']) {
        await expect(ReadExactGitBlobFromSession(session, {
          commitSha,
          repositoryPath
        })).rejects.toThrow('not an ordinary blob');
      }
      await expect(ReadExactGitBlobFromSession(session, {
        commitSha,
        maxBytes: 2,
        repositoryPath: 'ordinary'
      })).rejects.toThrow('exceeds maxBytes');
    });
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
});

test('exact Git blob parser rejects a cat-file byte-count mismatch', () => {
  const blobSha = '2'.repeat(40);
  expect(() => parseExactGitBlobsBatch(
    [{ blobSha, repositoryPath: 'fixture' }],
    Buffer.from(`${blobSha} blob 4\nabc\n`, 'utf8'),
    16
  )).toThrow('byte count is malformed');
});

test('exact Git text batch preserves path-to-blob identity and rejects malformed output', async () => {
  const repositoryRoot = initializeRepository();
  try {
    writeFileSync(path.join(repositoryRoot, 'first.ts'), 'export const first = 1;\n', 'utf8');
    writeFileSync(path.join(repositoryRoot, 'second.ts'), 'export const second = 2;\n', 'utf8');
    git(repositoryRoot, ['add', 'first.ts', 'second.ts']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'batch']);
    const commitSha = git(repositoryRoot, ['rev-parse', 'HEAD']);
    const { entries, source } = await withTestGitReadAuthority(repositoryRoot, async (session) => {
      const entries = await ListExactGitTreeEntriesFromSession(session, commitSha);
      return {
        entries,
        source: await ReadExactGitTextBlobsBatchFromSession(session, { entries })
      };
    });
    expect(source.map(({ repositoryPath, source: text }) => [repositoryPath, text])).toEqual([
      ['first.ts', 'export const first = 1;\n'],
      ['second.ts', 'export const second = 2;\n']
    ]);

    expect(() => parseExactGitBlobsBatch(
      [entries[0]!],
      Buffer.from(`${'f'.repeat(40)} blob 1\nx\n`, 'utf8'),
      16
    )).toThrow('header does not match');
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
});
