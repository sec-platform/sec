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
for (const scenario of ['empty', 'populated', 'narrow-parent'] as const) {
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
          budget: { maxProcesses: scenario === 'narrow-parent' ? 32 : populated ? 2 : 1 } }, async session => {
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

test.skipIf(process.platform !== 'linux')(
  'production scratch owner computes a cold index tree without mutating the retained index',
  () => inGitProtocolRepository(async (root, git) => {
    writeFileSync(path.join(root, 'cold-index.txt'), 'cold index input\n', 'utf8');
    gitProtocolSuccess(git(['add', '--', 'cold-index.txt']));

    const scratchRoot = mkdtempSync(path.join(tmpdir(), 'sec-native-cold-write-tree-'));
    await settleWorkspaceCallback(async () => {
      const scratchIndex = path.join(scratchRoot, 'index');
      copyFileSync(path.join(root, '.git', 'index'), scratchIndex);
      mkdirSync(path.join(scratchRoot, 'objects'));
      const retainedBytes = readFileSync(scratchIndex);
      // Compute the independent semantic expectation only after copying the
      // cold scratch index, so this does not warm the subject under test.
      const expectedTree = gitProtocolSuccess(git(['write-tree'])).trim();

      await withAuthorityGitReadSession(
        { cwd: root, budget: { maxProcesses: 8 } },
        async session => {
          const resolution = await createAuthorityGitScratchIndexTreeSession({
            gitReadSession: session,
            scratchRoot
          });
          assert.equal(
            resolution.status,
            'ready',
            'production scratch owner must admit the cold-index fixture'
          );
          if (resolution.status !== 'ready') {
            throw new Error('Production scratch owner is required for the cold-index regression.');
          }

          let primary: unknown;
          try {
            const tree = await resolution.session.writeTree();
            assert.equal(tree.status, 'ready');
            if (tree.status !== 'ready') {
              throw new Error(`Cold scratch write-tree failed: ${tree.reason}`);
            }
            assert.match(tree.value, /^[0-9a-f]{40,64}$/u);
            assert.equal(tree.value, expectedTree);

            assert.deepEqual(
              readFileSync(scratchIndex),
              retainedBytes,
              'tree computation must not rewrite cache-tree or replace the retained index generation'
            );
            const second = await resolution.session.writeTree();
            assert.equal(second.status, 'ready');
            if (second.status === 'ready') assert.equal(second.value, tree.value);
            assert.deepEqual(readFileSync(scratchIndex), retainedBytes);
          } catch (error) {
            primary = error;
            throw error;
          } finally {
            const closeFailure = await resolution.session.close();
            if (primary === undefined) assert.equal(closeFailure, null);
          }
        }
      );
    }, async () => {
      rmSync(scratchRoot, { recursive: true, force: true });
    });
  }),
  { timeout: 30_000 }
);


for (const format of ['sha1', 'sha256'] as const) {
  test(`${format} v4 scratch delta returns a Git-readable successor index without replacing its retained source`, () =>
    inGitProtocolRepository(async (root, git, base) => {
      writeFileSync(path.join(root, 'old'), 'old staged bytes\n', 'utf8');
      writeFileSync(path.join(root, 'keep'), 'kept staged bytes\n', 'utf8');
      gitProtocolSuccess(git(['add', '--', 'old', 'keep']));
      gitProtocolSuccess(git(['update-index', '--skip-worktree', 'keep']));
      gitProtocolSuccess(git(['update-index', '--index-version', '4']));

      const scratchRoot = mkdtempSync(path.join(tmpdir(), 'sec-native-index-generation-'));
      await settleWorkspaceCallback(async () => {
        const scratchIndex = path.join(scratchRoot, 'index');
        const candidateIndex = path.join(scratchRoot, 'candidate-index');
        copyFileSync(path.join(root, '.git', 'index'), scratchIndex);
        mkdirSync(path.join(scratchRoot, 'objects'));
        const retainedBytes = readFileSync(scratchIndex);

        await withAuthorityGitReadSession(
          { cwd: root, budget: { maxProcesses: 16, maxStdinBytes: 1024 * 1024 } },
          async session => {
            const resolution = await createAuthorityGitScratchIndexTreeSession({
              gitReadSession: session,
              scratchRoot
            });
            assert.equal(resolution.status, 'ready');
            if (resolution.status !== 'ready') throw new Error('Native scratch generation is required.');

            let primary: unknown;
            try {
              const tree = await resolution.session.applyIndexDelta({
                additions: [{ path: 'nested/new', bytes: Buffer.from('new staged bytes\n') }],
                removals: ['old']
              });
              assert.equal(tree.status, 'ready');
              if (tree.status !== 'ready') throw new Error(`Scratch delta failed: ${tree.reason}`);

              assert.deepEqual(readFileSync(scratchIndex), retainedBytes);
              assert.equal(gitProtocolSuccess(git(['show', `${tree.value}:nested/new`], {
                ...base,
                GIT_OBJECT_DIRECTORY: path.join(scratchRoot, 'objects'),
                GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(root, '.git', 'objects')
              })), 'new staged bytes\n');
              assert.notEqual(git(['show', `${tree.value}:old`], {
                ...base,
                GIT_OBJECT_DIRECTORY: path.join(scratchRoot, 'objects'),
                GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(root, '.git', 'objects')
              }).status, 0);

              const generated = resolution.session.indexBytes();
              assert.equal(generated.status, 'ready');
              if (generated.status !== 'ready') throw new Error(`Successor index unavailable: ${generated.reason}`);
              writeFileSync(candidateIndex, generated.value);
              const candidateEnvironment = {
                ...base,
                GIT_INDEX_FILE: candidateIndex,
                GIT_OBJECT_DIRECTORY: path.join(scratchRoot, 'objects'),
                GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(root, '.git', 'objects')
              };
              const reconstructedTree = gitProtocolSuccess(
                git(['write-tree'], candidateEnvironment)
              ).trim();
              assert.equal(reconstructedTree, tree.value);
              assert.match(
                gitProtocolSuccess(git(['ls-files', '-v', '--', 'keep'], candidateEnvironment)),
                /^S keep\r?\n$/u,
                'unchanged extended index flags must survive deterministic successor encoding'
              );
              assert.deepEqual(readFileSync(scratchIndex), retainedBytes);
            } catch (error) {
              primary = error;
              throw error;
            } finally {
              const closeFailure = await resolution.session.close();
              if (primary === undefined) assert.equal(closeFailure, null);
            }
          }
        );
      }, async () => {
        rmSync(scratchRoot, { recursive: true, force: true });
      });
    }, format));
}
