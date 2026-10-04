import { expect, test } from 'bun:test';
import { lstatSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inspectNoFollowDirectoryChain, retainNoFollowOrdinaryFile } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { runRetainedGitWriteTreeProbe } from '../helpers/retained-git-write-tree-probe.ts';
import { gitProtocolSuccess, inGitProtocolRepository } from '../testkit/git-protocol.ts';
import { settleWorkspaceCallback } from '../testkit/workspace-cleanup.ts';

// The warm-index success case lives in physical-no-follow.test.ts. Neither
// command names nor GIT_OPTIONAL_LOCKS=0 make a native writable index immutable.
test('cold write-tree succeeds with a private index beneath its retained parent', () => {
  expect(runRetainedGitWriteTreeProbe({ warmIndex: false, indexCustody: 'retained-parent' })).toMatch(/^[0-9a-f]{40}$/u);
});

test.skipIf(process.platform !== 'linux')('cold write-tree mutation cannot pass the retained-index currentness fence', () => {
  let rejection: unknown;
  try { runRetainedGitWriteTreeProbe({ warmIndex: false, indexCustody: 'immutable-file' }); }
  catch (error) { rejection = error; }
  expect(rejection).toMatchObject({ code: 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED' });
});

test.skipIf(process.platform !== 'linux')('same-byte replacement interference invalidates an immutable warm Git index', () =>
  inGitProtocolRepository(async (root, git) => {
    writeFileSync(path.join(root, 'tracked.txt'), 'warm index input\n');
    gitProtocolSuccess(git(['add', 'tracked.txt']));
    gitProtocolSuccess(git(['write-tree']));
    const parent = inspectNoFollowDirectoryChain(path.join(root, '.git'), 'warm index parent');
    const retained = retainNoFollowOrdinaryFile(parent, 'index');
    await settleWorkspaceCallback(async () => {
      const before = retained.readBytes();
      const indexPath = path.join(root, '.git', 'index');
      const beforeIdentity = lstatSync(indexPath, { bigint: true });
      // This fixture owns the replacement. Git is allowed, but not required,
      // to perform this same-byte replacement when it consumes a warm index.
      writeFileSync(path.join(root, '.git', 'replacement-index'), before, { flag: 'wx' });
      renameSync(path.join(root, '.git', 'replacement-index'), path.join(root, '.git', 'index'));
      const replacementIdentity = lstatSync(indexPath, { bigint: true });
      expect(replacementIdentity.dev).toBe(beforeIdentity.dev);
      expect(replacementIdentity.ino).not.toBe(beforeIdentity.ino);
      const replacement = retainNoFollowOrdinaryFile(parent, 'index');
      await settleWorkspaceCallback(async () => {
        expect(replacement.readBytes()).toEqual(before);
        expect(replacement.physical).not.toEqual(retained.physical);
        expect(() => retained.assertCurrent()).toThrow(expect.objectContaining({
          code: 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'
        }));
      }, async () => { replacement.dispose(); });
    }, async () => { retained.dispose(); });
  }));
