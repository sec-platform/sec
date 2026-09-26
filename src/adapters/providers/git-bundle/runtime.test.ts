import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  assertGitCandidateBundleReceipt,
  closeGitCandidateBundle,
  createGitCandidateBundle,
  inspectGitBundleBytes,
  type GitCandidateBundle
} from './runtime.ts';

const roots: string[] = [];

function temporaryRoot(label: string): string {
  const root = mkdtempSync(path.join(tmpdir(), `sec-git-bundle-${label}-`));
  roots.push(root);
  return root;
}

function git(cwd: string, args: readonly string[]): string {
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0'
    },
    stdout: 'pipe',
    stderr: 'pipe'
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
  return new TextDecoder().decode(result.stdout).trim();
}

function repositoryFixture(): Readonly<{
  root: string;
  baseSha: string;
  headSha: string;
}> {
  const root = temporaryRoot('repository');
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'SEC Test']);
  git(root, ['config', 'user.email', 'sec-test@example.invalid']);
  writeFileSync(path.join(root, 'value.txt'), 'base\n');
  git(root, ['add', '--', 'value.txt']);
  git(root, ['commit', '--quiet', '-m', 'base']);
  const baseSha = git(root, ['rev-parse', 'HEAD']);
  writeFileSync(path.join(root, 'value.txt'), 'head\n');
  git(root, ['commit', '--quiet', '-am', 'head']);
  return Object.freeze({ root, baseSha, headSha: git(root, ['rev-parse', 'HEAD']) });
}

afterEach(() => {
  for (const root of roots.splice(0).reverse()) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Git candidate bundle effect', () => {
  test('inspects caller-supplied bundle bytes through the bounded Git provider', async () => {
    const repository = repositoryFixture();
    const outputRoot = temporaryRoot('inspect-source');
    const bundle = await createGitCandidateBundle({
      sourceRoot: repository.root,
      temporaryRoot: outputRoot,
      baseSha: repository.baseSha,
      headSha: repository.headSha
    });
    try {
      const bytes = readFileSync(bundle.bundlePath);
      const inspection = await inspectGitBundleBytes({ repositoryRoot: repository.root, bytes });
      expect(inspection.bundleDigest).toBe(bundle.bundleDigest);
      expect(inspection.heads).toEqual([
        { objectId: repository.baseSha, reference: 'refs/sec/base' },
        { objectId: repository.headSha, reference: 'refs/sec/head' }
      ]);
    } finally {
      assertGitCandidateBundleReceipt(closeGitCandidateBundle(bundle), bundle);
    }
  });

  test('rejects malformed bundle bytes without accepting synthetic heads', async () => {
    const repository = repositoryFixture();
    await expect(inspectGitBundleBytes({
      repositoryRoot: repository.root,
      bytes: new TextEncoder().encode('not-a-git-bundle\n')
    })).rejects.toThrow();
  });

  test('publishes one verified retained bundle for the exact base and head', async () => {
    const repository = repositoryFixture();
    const outputRoot = temporaryRoot('output');
    let bundle: GitCandidateBundle | null = null;
    try {
      bundle = await createGitCandidateBundle({
        sourceRoot: repository.root,
        temporaryRoot: outputRoot,
        baseSha: repository.baseSha,
        headSha: repository.headSha
      });
      expect(bundle.bundlePath).toBe(path.join(outputRoot, 'candidate.bundle'));
      expect(bundle.bundleSize).toBeGreaterThan(0);
      expect(bundle.bundleDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
      const heads = git(outputRoot, ['bundle', 'list-heads', bundle.bundlePath]);
      expect(heads.split('\n').sort()).toEqual([
        `${repository.baseSha} refs/sec/base`,
        `${repository.headSha} refs/sec/head`
      ].sort());

      const receipt = closeGitCandidateBundle(bundle);
      assertGitCandidateBundleReceipt(receipt, bundle);
      expect(readFileSync(bundle.bundlePath).byteLength).toBe(bundle.bundleSize);
      expect(() => assertGitCandidateBundleReceipt(receipt, Object.freeze({ ...bundle! }))).toThrow(
        'owner-issued terminal settlement'
      );
      expect(closeGitCandidateBundle(bundle)).toBe(receipt);
      bundle = null;
    } finally {
      if (bundle !== null) closeGitCandidateBundle(bundle);
    }
  });

  test('rejects an occupied fixed output without replacing its bytes', async () => {
    const repository = repositoryFixture();
    const outputRoot = temporaryRoot('occupied');
    const occupied = path.join(outputRoot, 'candidate.bundle');
    writeFileSync(occupied, 'foreign\n');

    await expect(createGitCandidateBundle({
      sourceRoot: repository.root,
      temporaryRoot: outputRoot,
      baseSha: repository.baseSha,
      headSha: repository.headSha
    })).rejects.toThrow('file target must be absent');
    expect(readFileSync(occupied, 'utf8')).toBe('foreign\n');
    expect(() => readFileSync(path.join(outputRoot, 'bundle-source.git'))).toThrow();
  });

  test('reads a linked worktree through its retained common directory instead of mutable pointer files', async () => {
    const repository = repositoryFixture();
    const worktreeParent = temporaryRoot('worktree-parent');
    const sourceRoot = path.join(worktreeParent, 'source');
    git(repository.root, ['worktree', 'add', '--quiet', '--detach', sourceRoot, repository.headSha]);
    const outputRoot = temporaryRoot('worktree-output');
    const bundle = await createGitCandidateBundle({
      sourceRoot,
      temporaryRoot: outputRoot,
      baseSha: repository.baseSha,
      headSha: repository.headSha
    });
    try {
      expect(git(outputRoot, ['bundle', 'list-heads', bundle.bundlePath]).split('\n').sort()).toEqual([
        `${repository.baseSha} refs/sec/base`,
        `${repository.headSha} refs/sec/head`
      ].sort());
    } finally {
      assertGitCandidateBundleReceipt(closeGitCandidateBundle(bundle), bundle);
    }
  });

  test('rejects noncanonical revisions and forged retained capabilities before Git effects', async () => {
    const repository = repositoryFixture();
    const outputRoot = temporaryRoot('invalid');
    await expect(createGitCandidateBundle({
      sourceRoot: repository.root,
      temporaryRoot: outputRoot,
      baseSha: repository.baseSha.toUpperCase(),
      headSha: repository.headSha
    })).rejects.toThrow('input is not canonical');
    expect(() => closeGitCandidateBundle(Object.freeze({
      bundlePath: path.join(outputRoot, 'candidate.bundle'),
      bundleSize: 1,
      bundleDigest: `sha256:${'0'.repeat(64)}`,
      baseSha: repository.baseSha,
      headSha: repository.headSha,
      objectFormat: 'sha1',
      materializationIdentityDigest: `sha256:${'1'.repeat(64)}`
    }))).toThrow('owner-issued retained capability');
  });
});
