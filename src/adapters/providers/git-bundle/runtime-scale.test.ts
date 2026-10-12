import { afterEach, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertGitCandidateBundleReceipt, closeGitCandidateBundle, createGitCandidateBundle } from './runtime.ts';
import { createGitBundleTestFixture } from './test/runtime-fixture.ts';

const { roots, temporaryRoot, git, repositoryFixture } = createGitBundleTestFixture();

afterEach(() => {
  for (const root of roots.splice(0).reverse()) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Git candidate bundle native scale', () => {
  test('retains complete history larger than eight MiB even when the current tree is small', async () => {
    const repository = repositoryFixture();
    const oldFile = path.join(repository.root, 'historical.bin');
    writeFileSync(oldFile, randomBytes(9 * 1024 * 1024));
    git(repository.root, ['add', '--', 'historical.bin']);
    git(repository.root, ['commit', '--quiet', '-m', 'historical content']);
    const historySha = git(repository.root, ['rev-parse', 'HEAD']);
    rmSync(oldFile);
    git(repository.root, ['commit', '--quiet', '-am', 'remove current content']);
    const headSha = git(repository.root, ['rev-parse', 'HEAD']);
    const outputRoot = temporaryRoot('complete-history');
    const bundle = await createGitCandidateBundle({ sourceRoot: repository.root,
      temporaryRoot: outputRoot, baseSha: headSha, headSha });
    try {
      expect(bundle.bundleSize).toBeGreaterThan(8 * 1024 * 1024);
      const restored = temporaryRoot('restored-history');
      git(restored, ['init', '--quiet']);
      git(restored, ['fetch', '--quiet', bundle.bundlePath, 'refs/sec/head']);
      expect(git(restored, ['rev-parse', 'FETCH_HEAD'])).toBe(headSha);
      expect(git(restored, ['cat-file', '-s', `${historySha}:historical.bin`])).toBe(String(9 * 1024 * 1024));
      expect(git(restored, ['ls-tree', '--name-only', 'FETCH_HEAD'])).not.toContain('historical.bin');
    } finally {
      assertGitCandidateBundleReceipt(closeGitCandidateBundle(bundle), bundle);
    }
  });

  test('rejects history exceeding sixteen MiB without publishing a partial bundle', async () => {
    const repository = repositoryFixture();
    writeFileSync(path.join(repository.root, 'large.bin'), randomBytes(17 * 1024 * 1024));
    git(repository.root, ['add', '--', 'large.bin']);
    git(repository.root, ['commit', '--quiet', '-m', 'oversized history']);
    const headSha = git(repository.root, ['rev-parse', 'HEAD']);
    const outputRoot = temporaryRoot('oversized-history');
    await expect(createGitCandidateBundle({ sourceRoot: repository.root,
      temporaryRoot: outputRoot, baseSha: headSha, headSha })).rejects.toThrow('stdout exceeded 16777216 bytes');
    expect(existsSync(path.join(outputRoot, 'candidate.bundle'))).toBe(false);
    expect(git(repository.root, ['cat-file', '-s', `${headSha}:large.bin`])).toBe(String(17 * 1024 * 1024));
  });

});
