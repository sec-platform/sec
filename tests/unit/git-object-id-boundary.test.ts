import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { canonicalCommitTreeInput, captureGitDevelopmentCommitContract } from '../../src/adapters/providers/git-read/runtime/commit-contract.ts';

test('commit contract consumes the shared grammar and rejects mixed object formats', () => {
  const repositoryRoot = path.resolve('identity-boundary-fixture');
  const identity = { name: 'Builder', email: 'builder@example.test', date: '0 +0000' };
  for (const width of [40, 64]) {
    const input = { tree: 'a'.repeat(width), parents: ['b'.repeat(width)],
      message: 'independent commit\n', author: identity, committer: identity };
    assert.deepEqual(canonicalCommitTreeInput(input), input);
    assert.equal(canonicalCommitTreeInput({ ...input, parents: ['b'.repeat(width === 40 ? 64 : 40)] }), null);
    const contract = { ...input, repositoryRoot, worktreeRoot: repositoryRoot,
      ref: 'refs/heads/identity-boundary', expectedOld: input.parents[0]!, target: 'c'.repeat(width),
      signing: 'disabled' as const, hooks: 'disabled' as const,
      preflightReceiptDigest: `sha256:${'d'.repeat(64)}` as const };
    assert.notEqual(captureGitDevelopmentCommitContract(contract), null);
    assert.equal(captureGitDevelopmentCommitContract({ ...contract,
      preflightReceiptDigest: `blake3:${'d'.repeat(64)}` as never }), null);
  }
});
