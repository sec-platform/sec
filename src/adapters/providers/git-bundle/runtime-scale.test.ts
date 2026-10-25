import { settleResources, type ResourceSettlementFailure } from '../../../execution/resource-settlement.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inspectNoFollowDirectoryChain, retainNoFollowOrdinaryFile } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { DEFAULT_TEST_TIMEOUT_MS } from '../../self-hosting/development/runner/test-execution-policy.ts';
import { materializeGitCandidateCheckoutTransport, withGitCandidateCheckout } from './runtime.ts';
import { createGitBundleTestFixture } from './test/runtime-fixture.ts';

const { roots, temporaryRoot, git } = createGitBundleTestFixture();

afterEach(() => {
  for (const root of roots.splice(0).reverse()) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Git candidate bundle native scale', () => {
  test('transports complete history above sixteen MiB as native files even when the current tree is small', async () => {
    const sourceRoot = temporaryRoot('repository');
    git(sourceRoot, ['init', '--quiet']);
    git(sourceRoot, ['config', 'user.name', 'SEC Test']);
    git(sourceRoot, ['config', 'user.email', 'sec-test@example.invalid']);
    // Only the retained historical commit and its small current successor are
    // needed here; preserve the same ordinary current-tree bytes as the fixture.
    writeFileSync(path.join(sourceRoot, 'value.txt'), 'head\n');
    const oldFile = path.join(sourceRoot, 'historical.bin');
    writeFileSync(oldFile, randomBytes(17 * 1024 * 1024));
    git(sourceRoot, ['add', '--', 'historical.bin', 'value.txt']);
    git(sourceRoot, ['commit', '--quiet', '-m', 'historical content']);
    const historySha = git(sourceRoot, ['rev-parse', 'HEAD']);
    rmSync(oldFile);
    git(sourceRoot, ['commit', '--quiet', '-am', 'remove current content']);
    const headSha = git(sourceRoot, ['rev-parse', 'HEAD']);
    await withGitCandidateCheckout({ sourceRoot, baseSha: headSha, headSha,
      purpose: 'action-materialization', deadlineAtUnixMs: Date.now() + 120_000 }, async checkout => {
      await materializeGitCandidateCheckoutTransport(checkout);
      const source = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(path.dirname(checkout.candidateRoot)), 'candidate.bundle');
      const cleanup: { label: string; settle(): void }[] = [
        { label: 'source bundle', settle: () => source.dispose() }
      ];
      let primary: ResourceSettlementFailure | undefined;
      try {
        const projected = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(path.join(checkout.candidateRoot, '.sec-trusted-input')), 'candidate.bundle');
        cleanup.unshift({ label: 'projected bundle', settle: () => projected.dispose() });
        expect(source.digest().size).toBeGreaterThan(16 * 1024 * 1024);
        expect(projected.digest()).toEqual(source.digest());
        source.assertCurrent(); projected.assertCurrent();
      } catch (error) {
        primary = { label: 'native bundle comparison', error };
      } finally { settleResources({ primary, cleanup }); }
      const restored = temporaryRoot('restored-history');
      git(restored, ['init', '--quiet']);
      git(restored, ['fetch', '--quiet', path.join(checkout.candidateRoot, '.sec-trusted-input/candidate.bundle'), 'refs/sec/head']);
      expect(git(restored, ['rev-parse', 'FETCH_HEAD'])).toBe(headSha);
      expect(git(restored, ['cat-file', '-s', `${historySha}:historical.bin`])).toBe(String(17 * 1024 * 1024));
      expect(git(restored, ['ls-tree', '--name-only', 'FETCH_HEAD'])).not.toContain('historical.bin');
    });
  }, DEFAULT_TEST_TIMEOUT_MS);



});
