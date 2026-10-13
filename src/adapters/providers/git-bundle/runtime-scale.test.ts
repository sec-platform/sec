import { afterEach, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inspectNoFollowDirectoryChain, retainNoFollowOrdinaryFile } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { DEFAULT_TEST_TIMEOUT_MS } from '../../self-hosting/development/runner/test-execution-policy.ts';
import { createGitCandidateBundle, materializeGitCandidateCheckoutTransport, withGitCandidateCheckout } from './runtime.ts';
import { createGitBundleTestFixture } from './test/runtime-fixture.ts';

const { roots, temporaryRoot, git, repositoryFixture } = createGitBundleTestFixture();

afterEach(() => {
  for (const root of roots.splice(0).reverse()) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Git candidate bundle native scale', () => {
  test('transports complete history above sixteen MiB as native files even when the current tree is small', async () => {
    const repository = repositoryFixture();
    const oldFile = path.join(repository.root, 'historical.bin');
    writeFileSync(oldFile, randomBytes(17 * 1024 * 1024));
    git(repository.root, ['add', '--', 'historical.bin']);
    git(repository.root, ['commit', '--quiet', '-m', 'historical content']);
    const historySha = git(repository.root, ['rev-parse', 'HEAD']);
    rmSync(oldFile);
    git(repository.root, ['commit', '--quiet', '-am', 'remove current content']);
    const headSha = git(repository.root, ['rev-parse', 'HEAD']);
    await withGitCandidateCheckout({ sourceRoot: repository.root, baseSha: headSha, headSha,
      purpose: 'action-materialization', deadlineAtUnixMs: Date.now() + 120_000 }, async checkout => {
      await materializeGitCandidateCheckoutTransport(checkout);
      const source = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(path.dirname(checkout.candidateRoot)), 'candidate.bundle');
      const projected = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(path.join(checkout.candidateRoot, '.sec-trusted-input')), 'candidate.bundle');
      try {
        expect(source.digest().size).toBeGreaterThan(16 * 1024 * 1024);
        expect(projected.digest()).toEqual(source.digest());
        source.assertCurrent(); projected.assertCurrent();
      } finally { projected.dispose(); source.dispose(); }
      const restored = temporaryRoot('restored-history');
      git(restored, ['init', '--quiet']);
      git(restored, ['fetch', '--quiet', path.join(checkout.candidateRoot, '.sec-trusted-input/candidate.bundle'), 'refs/sec/head']);
      expect(git(restored, ['rev-parse', 'FETCH_HEAD'])).toBe(headSha);
      expect(git(restored, ['cat-file', '-s', `${historySha}:historical.bin`])).toBe(String(17 * 1024 * 1024));
      expect(git(restored, ['ls-tree', '--name-only', 'FETCH_HEAD'])).not.toContain('historical.bin');
    });
  }, DEFAULT_TEST_TIMEOUT_MS);

  test('rejects a completed artifact above the consumer admitted byte budget', async () => {
    const repository = repositoryFixture();
    const outputRoot = temporaryRoot('oversized-history');
    await expect(createGitCandidateBundle({ sourceRoot: repository.root,
      temporaryRoot: outputRoot, baseSha: repository.baseSha, headSha: repository.headSha,
      maximumBundleBytes: 1 })).rejects.toThrow('exceeds its admitted artifact byte budget');
    expect(git(repository.root, ['rev-parse', 'HEAD'])).toBe(repository.headSha);
  });

});
