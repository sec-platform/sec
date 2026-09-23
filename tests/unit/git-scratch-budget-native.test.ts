import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { issueGitReadAuthorityOperation, withAuthorityGitReadSession } from '../../src/adapters/providers/git-read/authority.ts';
import { createAuthorityGitScratchIndexTreeSession } from '../../src/adapters/providers/git-read/runtime/session.ts';
import { gitProtocolSuccess, inGitProtocolRepository } from '../testkit/git-protocol.ts';
import { settleWorkspaceCallback } from '../testkit/workspace-cleanup.ts';

// Production Git and retained scratch capabilities are required. This test
// must not pass through a replacement issuer, fake process counter or raw
// command substituted for the actual public scratch operation. Ordinary Git
// is used only to establish an independent temporary repository fixture.
const scenarios = process.platform === 'win32'
  ? ['empty', 'populated', 'narrow-parent', 'stdin-worker'] as const
  : ['empty', 'populated', 'narrow-parent'] as const;
for (const scenario of scenarios) {
  const populated = scenario !== 'empty';
  test(`an unaffordable ${scenario} scratch batch performs no partial effect`, () =>
    inGitProtocolRepository(async (root, git) => {
      writeFileSync(path.join(root, 'old'), 'retained worktree content');
      gitProtocolSuccess(git(['add', '--', 'old']));
      const scratchRoot = mkdtempSync(path.join(tmpdir(), 'sec-native-scratch-'));
      await settleWorkspaceCallback(async () => {
        const indexPath = path.join(scratchRoot, 'index');
        copyFileSync(path.join(root, '.git', 'index'), indexPath);
        mkdirSync(path.join(scratchRoot, 'objects'));
        const beforeIndex = readFileSync(indexPath);
        const binding = scenario === 'narrow-parent'
          ? { operation: issueGitReadAuthorityOperation({ cwd: root, budget: { maxProcesses: 2 } }) } : {};
        await withAuthorityGitReadSession({ cwd: root, ...binding,
          budget: { maxProcesses: scenario === 'narrow-parent' ? 32
            : scenario === 'stdin-worker' ? 4 : populated ? 2 : 1 } }, async session => {
          const resolution = await createAuthorityGitScratchIndexTreeSession({ gitReadSession: session, scratchRoot });
          assert.equal(resolution.status, 'ready', 'the real scratch provider must have admitted the fixture');
          if (resolution.status !== 'ready') throw new Error('Native scratch admission is required');
          const scratch = resolution.session;
          await settleWorkspaceCallback(async () => {
            const beforeProcesses = session.processCount;
            const delta = populated
              ? { additions: [{ path: 'new', bytes: Buffer.from('new object') }], removals: [] }
              : { additions: [], removals: [] };
            const result = await scratch.applyIndexDelta(delta);
            assert.equal(result.status, 'unavailable');
            assert.equal(session.processCount, beforeProcesses);
            assert.deepEqual(readFileSync(indexPath), beforeIndex);
            assert.deepEqual(readdirSync(path.join(scratchRoot, 'objects')), []);
            assert.equal(readFileSync(path.join(root, 'old'), 'utf8'), 'retained worktree content');
          }, async () => { await scratch.close(); });
        });
      }, async () => { rmSync(scratchRoot, { recursive: true, force: true }); });
    }));
}
