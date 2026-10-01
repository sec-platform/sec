import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { issueGitReadAuthorityOperation, withAuthorityGitReadSession } from '../../src/adapters/providers/git-read/authority.ts';
import { decodeGitIndexGeneration } from '../../src/adapters/providers/git-read/runtime/scratch-index-generation.ts';
import { createAuthorityGitScratchIndexTreeSession } from '../../src/adapters/providers/git-read/runtime/session.ts';
import { gitProtocolSuccess, inGitProtocolRepository } from '../testkit/git-protocol.ts';
import { settleWorkspaceCallback } from '../testkit/workspace-cleanup.ts';

// Production Git and retained scratch capabilities are required. This test
// must not pass through a replacement issuer, fake process counter or raw
// command substituted for the actual public scratch operation. Ordinary Git
// is used only to establish an independent temporary repository fixture.
const scenarios = process.platform === 'win32'
  ? ['empty', 'populated', 'narrow-parent', 'narrow-record-parent', 'stdin-worker'] as const
  : ['empty', 'populated', 'narrow-parent', 'narrow-record-parent'] as const;
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
          ? { operation: issueGitReadAuthorityOperation({ cwd: root, budget: { maxProcesses: 2 } }) }
          : scenario === 'narrow-record-parent'
            ? { operation: issueGitReadAuthorityOperation({ cwd: root, budget: { maxProcesses: 32, maxRecords: 1 } }) } : {};
        await withAuthorityGitReadSession({ cwd: root, ...binding,
          budget: { maxProcesses: scenario === 'narrow-parent' || scenario === 'narrow-record-parent' ? 32
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

test.skipIf(process.platform !== 'linux')(
  'production scratch owner reconstructs an untrusted cache without mutating inputs or invoking index helpers',
  () => inGitProtocolRepository(async (root, git, base) => {
    const inputPath = path.join(root, 'cold-index.txt');
    writeFileSync(inputPath, 'cold index input\n', 'utf8');
    writeFileSync(path.join(root, '.gitattributes'), 'cold-index.txt filter=tripwire\n');
    // Future mtime makes any retained native stat cache racy deterministically,
    // without sleeps; the clean helper is installed only after fixture setup.
    const future = new Date(Date.now() + 60_000); utimesSync(inputPath, future, future);
    gitProtocolSuccess(git(['add', '--', 'cold-index.txt', '.gitattributes']));

    const scratchRoot = mkdtempSync(path.join(tmpdir(), 'sec-native-cold-write-tree-'));
    await settleWorkspaceCallback(async () => {
      const scratchIndex = path.join(scratchRoot, 'index');
      copyFileSync(path.join(root, '.git', 'index'), scratchIndex);
      mkdirSync(path.join(scratchRoot, 'objects'));
      const coldBytes = readFileSync(scratchIndex);
      // Fixture's ordinary Git computes the semantic expectation before the
      // subject receives a deliberately false but validly checksummed TREE.
      const expectedTree = gitProtocolSuccess(git(['write-tree'])).trim();
      const wrongTree = gitProtocolSuccess(git(['mktree'], undefined, '')).trim();
      assert.notEqual(wrongTree, expectedTree);
      const payload = Buffer.concat([Buffer.from('\0' + '2 0\n'), Buffer.from(wrongTree, 'hex')]);
      const extension = Buffer.alloc(8); extension.write('TREE'); extension.writeUInt32BE(payload.length, 4);
      const content = Buffer.concat([coldBytes.subarray(0, -20), extension, payload]);
      const retainedBytes = Buffer.concat([content, createHash('sha1').update(content).digest()]);
      writeFileSync(scratchIndex, retainedBytes);
      const hookDirectory = path.join(root, 'fixture-hooks'); mkdirSync(hookDirectory);
      const marker = path.join(root, 'unadmitted-index-helper');
      const hook = path.join(hookDirectory, 'post-index-change');
      writeFileSync(hook, `#!/bin/sh\nprintf invoked > '${marker}'\ncat\n`); chmodSync(hook, 0o700);
      gitProtocolSuccess(git(['config', 'core.hooksPath', hookDirectory]));
      gitProtocolSuccess(git(['config', 'core.fsmonitor', hook]));
      gitProtocolSuccess(git(['config', 'core.splitIndex', 'true']));
      gitProtocolSuccess(git(['config', 'filter.tripwire.clean', hook]));
      const repositoryIndex = readFileSync(path.join(root, '.git', 'index'));
      const repositoryConfig = readFileSync(path.join(root, '.git', 'config'));

      await withAuthorityGitReadSession(
        { cwd: root, budget: { maxProcesses: 8 }, environment: { GIT_TEST_SPARSE_INDEX: '1' } },
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
            if (tree.status !== 'ready') {
              throw new Error(`Cold scratch write-tree failed: ${tree.reason}`);
            }
            assert.equal(tree.status, 'ready');
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
            const published = resolution.session.indexBytes();
            assert.equal(published.status, 'ready');
            if (published.status !== 'ready') throw new Error('Published index bytes are required.');
            const publishedPath = path.join(scratchRoot, 'published-index');
            writeFileSync(publishedPath, published.value);
            assert.match(gitProtocolSuccess(git(['-c', 'core.fsmonitor=false', 'ls-files', '--debug', '--', 'cold-index.txt'],
              { ...base, GIT_INDEX_FILE: publishedPath })), /mtime: 0:0/u,
              'originally racy cache data must stay invalidated in the publication index');
            assert.deepEqual(readFileSync(path.join(root, '.git', 'index')), repositoryIndex);
            assert.deepEqual(readFileSync(path.join(root, '.git', 'config')), repositoryConfig);
            assert.equal(existsSync(marker), false);
            assert.equal(readdirSync(path.join(root, '.git')).some(name => name.startsWith('sharedindex.')), false);
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
      const oldTimestamp = new Date('2000-01-01T00:00:00Z');
      utimesSync(path.join(root, 'keep'), oldTimestamp, oldTimestamp);
      gitProtocolSuccess(git(['add', '--', 'old', 'keep']));
      gitProtocolSuccess(git(['update-index', '--skip-worktree', 'keep']));
      gitProtocolSuccess(git(['update-index', '--index-version', '4']));
      // One existing ordinary case covers native conflict-undo preservation;
      // SHA-256 framing is covered by the pure codec case, without a second fixture.
      let resolveUndo: string | undefined;
      if (format === 'sha1') {
        const oldOid = gitProtocolSuccess(git(['rev-parse', ':old'])).trim();
        gitProtocolSuccess(git(['update-index', '--index-info'], undefined,
          `0 ${'0'.repeat(oldOid.length)}\told\n`
          + [1, 2, 3].map(stage => `100644 ${oldOid} ${stage}\told\n`).join('')));
        gitProtocolSuccess(git(['add', '--', 'old']));
        resolveUndo = gitProtocolSuccess(git(['ls-files', '--resolve-undo']));
        assert.equal(resolveUndo.trim().split('\n').length, 3);
      }

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
              if (tree.status !== 'ready') throw new Error(`Scratch delta failed: ${tree.reason}`);
              assert.equal(tree.status, 'ready');

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
              if (generated.status !== 'ready') throw new Error(`Successor index unavailable: ${generated.reason}`);
              assert.equal(generated.status, 'ready');
              writeFileSync(candidateIndex, generated.value);
              const candidateEnvironment = {
                ...base,
                GIT_INDEX_FILE: candidateIndex,
                GIT_OBJECT_DIRECTORY: path.join(scratchRoot, 'objects'),
                GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(root, '.git', 'objects')
              };
              if (resolveUndo !== undefined) {
                assert.equal(decodeGitIndexGeneration(generated.value, format).resolveUndoHex,
                  decodeGitIndexGeneration(retainedBytes, format).resolveUndoHex);
                assert.equal(gitProtocolSuccess(git(['ls-files', '--resolve-undo'], candidateEnvironment)), resolveUndo);
              }
              const reconstructedTree = gitProtocolSuccess(
                git(['write-tree'], candidateEnvironment)
              ).trim();
              assert.equal(reconstructedTree, tree.value);
              const keptDebug = gitProtocolSuccess(git(['ls-files', '-v', '--debug', '--', 'keep'], candidateEnvironment));
              assert.match(
                keptDebug.split(/\r?\n/u, 1)[0]!,
                /^S keep$/u,
                'unchanged extended index flags must survive deterministic successor encoding'
              );
              assert.match(keptDebug, /mtime: 946684800:0/u,
                'unchanged non-racy entries retain their original stat cache rather than forcing a full refresh');
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
