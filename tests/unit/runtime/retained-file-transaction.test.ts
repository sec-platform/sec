import { settleResources } from '../../../src/execution/resource-settlement.ts';
import { settleWorkspaceCallback, settleWorkspaceCallbackSync } from '../../testkit/workspace-cleanup.ts';
import { expect, test } from 'bun:test';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createNoFollowDirectoryChain,
  createNoFollowDirectoryCreateTestActorForTests,
  createNoFollowOrdinaryDirectoryChain,
  createRetainedNoFollowFileTransactionTestActorForTests,
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  retainNoFollowFileTransaction,
  scanNoFollowDirectoryDirectMetadata
} from '../../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';


function withFixtureRoot(prefix: string, use: (root: string) => void): void {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  settleWorkspaceCallbackSync(() => use(root), () => rmSync(root, { recursive: true, force: true }));
}

async function withAsyncFixtureRoot(prefix: string, use: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  await settleWorkspaceCallback(() => use(root), async () => {
    rmSync(root, { recursive: true, force: true });
  });
}

test.skipIf(process.platform !== 'win32')('Windows retained file transaction transfers a cross-parent file and retires its exact successor', async () => {
  await withAsyncFixtureRoot('sec-retained-file-transaction-', async root => {
    mkdirSync(path.join(root, 'source'));
    mkdirSync(path.join(root, 'destination'));
    const sourcePath = path.join(root, 'source', 'next');
    const destinationPath = path.join(root, 'destination', 'installed');
    writeFileSync(sourcePath, 'exact retained source\n', 'utf8');
    const durability: string[] = [];
    const transaction = retainNoFollowFileTransaction(
      root,
      'retained file transaction fixture',
      createRetainedNoFollowFileTransactionTestActorForTests({
        durabilityObserver: async ({ stage }) => {
          await Promise.resolve();
          durability.push(stage);
        },
        afterNamespaceMutationBeforeFlush: async () => {
          await Promise.resolve();
          durability.push('namespace-hook');
        }
      })
    );
    try {
      const source = transaction.observe('source/next', 'retained source');
      expect(source).not.toBeNull();
      // Public bytes are a projection. Mutating them cannot alter the private
      // native-handle preimage used by the physical Effect fence.
      source!.bytes[0] = 0;
      const installed = await transaction.renameNoReplace(
        'source/next', 'destination/installed', source!, 'cross-parent install'
      );
      expect(readFileSync(destinationPath, 'utf8')).toBe('exact retained source\n');
      expect(existsSync(sourcePath)).toBe(false);
      await expect(transaction.removeExact(
        'destination/installed', source!, 'stale source removal'
      )).rejects.toMatchObject({ code: 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE' });
      await transaction.removeExact('destination/installed', installed, 'installed cleanup');
      expect(existsSync(destinationPath)).toBe(false);
    } finally {
      transaction.dispose();
    }
    expect(durability).toEqual([
      'renamed', 'namespace-hook', 'file-flushed', 'parent-barrier'
    ]);
  });
});

test('retained file transaction exposes its retained root identity and current fence', () => {
  withFixtureRoot('sec-retained-file-transaction-root-', root => {
    const expected = inspectNoFollowDirectoryChain(root, 'retained root fixture').target;
    const transaction = retainNoFollowFileTransaction(root, 'retained root fixture');
    try {
      expect(transaction.rootPath).toBe(expected.path);
      expect(transaction.rootIdentity).toEqual(expected);
      expect(() => transaction.assertCurrent()).not.toThrow();
    } finally {
      transaction.dispose();
    }
  });
});

test.skipIf(process.platform !== 'win32')('Windows retained file transaction revalidates bytes after an awaited pre-effect actor', async () => {
  await withAsyncFixtureRoot('sec-retained-file-transaction-', async root => {
    mkdirSync(path.join(root, 'source'));
    mkdirSync(path.join(root, 'destination'));
    const sourcePath = path.join(root, 'source', 'next');
    writeFileSync(sourcePath, 'authorized bytes\n', 'utf8');
    const transaction = retainNoFollowFileTransaction(
      root,
      'post-actor fence fixture',
      createRetainedNoFollowFileTransactionTestActorForTests({
        beforeRename: async () => {
          await Promise.resolve();
          writeFileSync(sourcePath, 'foreign bytes\n', 'utf8');
        }
      })
    );
    try {
      const source = transaction.observe('source/next', 'post-actor source')!;
      await expect(transaction.renameNoReplace(
        'source/next', 'destination/installed', source, 'post-actor rename'
      )).rejects.toMatchObject({ code: 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED' });
      expect(existsSync(path.join(root, 'destination', 'installed'))).toBe(false);
      expect(readFileSync(sourcePath, 'utf8')).toBe('foreign bytes\n');
    } finally {
      transaction.dispose();
    }
  });
});

test.skipIf(process.platform !== 'win32')('Windows retained file transaction cannot report a parent barrier before its real pre-barrier seam succeeds', async () => {
  await withAsyncFixtureRoot('sec-retained-file-transaction-', async root => {
    mkdirSync(path.join(root, 'source'));
    mkdirSync(path.join(root, 'destination'));
    writeFileSync(path.join(root, 'source', 'next'), 'barrier bytes\n', 'utf8');
    const stages: string[] = [];
    const transaction = retainNoFollowFileTransaction(
      root,
      'pre-parent-barrier fixture',
      createRetainedNoFollowFileTransactionTestActorForTests({
        durabilityObserver: async ({ stage }) => {
          await Promise.resolve();
          stages.push(stage);
        },
        beforeParentBarrier: async ({ parentPath, targetPath }) => {
          await Promise.resolve();
          expect(parentPath).toBe(path.dirname(targetPath));
          stages.push('before-parent-barrier');
          throw new Error('injected before parent barrier');
        }
      })
    );
    try {
      const source = transaction.observe('source/next', 'barrier source')!;
      await expect(transaction.renameNoReplace(
        'source/next', 'destination/installed', source, 'barrier rename'
      )).rejects.toThrow('injected before parent barrier');
      expect(stages).toEqual(['renamed', 'file-flushed', 'before-parent-barrier']);
      expect(readFileSync(path.join(root, 'destination', 'installed'), 'utf8')).toBe('barrier bytes\n');
    } finally {
      transaction.dispose();
    }
  });
});

test.skipIf(process.platform !== 'win32')('Windows no-follow directory creation reports only real create and parent-barrier phases', () => {
  withFixtureRoot('sec-directory-create-actor-', root => {
    const stages: string[] = [];
    const actor = createNoFollowDirectoryCreateTestActorForTests({
      beforeCreate: ({ parentPath, targetPath }) => {
        expect(parentPath).toBe(root);
        expect(targetPath).toBe(path.join(root, 'document-control-plane-freeze-v1'));
        stages.push('before-create');
      },
      beforeParentBarrier: ({ parentPath, createdPath }) => {
        expect(parentPath).toBe(root);
        expect(createdPath).toBe(path.join(root, 'document-control-plane-freeze-v1'));
        stages.push('before-parent-barrier');
      },
      durabilityObserver: () => { stages.push('parent-barrier'); }
    });
    const identity = inspectNoFollowDirectoryChain(root, 'directory actor root').target;
    createNoFollowOrdinaryDirectoryChain(identity, ['document-control-plane-freeze-v1'], actor);
    expect(stages).toEqual(['before-create', 'before-parent-barrier', 'parent-barrier']);
    createNoFollowOrdinaryDirectoryChain(identity, ['document-control-plane-freeze-v1'], actor);
    expect(stages).toEqual(['before-create', 'before-parent-barrier', 'parent-barrier']);
  });
});

test.skipIf(process.platform !== 'win32')('Windows no-follow directory creation adopts and barriers an exact competing child', () => {
  withFixtureRoot('sec-directory-create-race-', root => {
    const target = path.join(root, 'joined-generation');
    const actor = createNoFollowDirectoryCreateTestActorForTests({
      beforeCreate: ({ targetPath }) => {
        expect(targetPath).toBe(target);
        mkdirSync(targetPath);
      }
    });
    const identity = inspectNoFollowDirectoryChain(root, 'directory race root').target;
    const joined = createNoFollowDirectoryChain(identity, ['joined-generation'], actor);

    expect(joined.path).toBe(target);
    expect(joined.inode).toBe(inspectNoFollowDirectoryChain(target, 'joined directory').target.inode);
  });
});

test.skipIf(process.platform !== 'win32')('Windows no-follow directory creation cannot report a barrier when its pre-barrier actor fails', () => {
  withFixtureRoot('sec-directory-create-actor-', root => {
    const stages: string[] = [];
    const actor = createNoFollowDirectoryCreateTestActorForTests({
      beforeCreate: () => { stages.push('before-create'); },
      beforeParentBarrier: () => {
        stages.push('before-parent-barrier');
        throw new Error('injected directory parent barrier failure');
      },
      durabilityObserver: () => { stages.push('parent-barrier'); }
    });
    const identity = inspectNoFollowDirectoryChain(root, 'directory actor failure root').target;
    expect(() => createNoFollowDirectoryChain(identity, ['created'], actor)).toThrow(
      'injected directory parent barrier failure'
    );
    expect(stages).toEqual(['before-create', 'before-parent-barrier']);
    expect(existsSync(path.join(root, 'created'))).toBe(true);
  });
});

test('direct no-follow metadata census does not traverse or charge nested entries', () => {
  withFixtureRoot('sec-direct-metadata-', root => {
    const nested = path.join(root, 'nested');
    mkdirSync(nested);
    for (let index = 0; index < 3; index += 1) {
      writeFileSync(path.join(nested, `descendant-${index}.txt`), `nested ${index}\n`, 'utf8');
    }
    writeFileSync(path.join(root, 'foreign-direct-entry'), 'foreign\n', 'utf8');
    const identity = inspectNoFollowDirectoryChain(root, 'direct metadata root').target;
    const entries = scanNoFollowDirectoryDirectMetadata(identity, {
      deadlineAtMs: performance.now() + 2_000,
      maximumEntries: 2
    });
    expect(entries.map((entry) => entry.relativePath)).toEqual([
      'foreign-direct-entry',
      'nested'
    ]);
    expect(entries.find((entry) => entry.relativePath === 'foreign-direct-entry')).toMatchObject({
      kind: 'file'
    });
    expect(entries.every((entry) => !entry.relativePath.includes('/'))).toBe(true);
    expect(() => scanNoFollowDirectoryDirectMetadata(identity, {
      deadlineAtMs: performance.now() + 2_000,
      maximumEntries: 1
    })).toThrow(expect.objectContaining({
      code: 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE'
    }));
  });
});

test.skipIf(process.platform !== 'win32')('Windows absolute directory chains distinguish a missing ancestor from unsafe existing entries', () => {
  withFixtureRoot('sec-missing-chain-', root => {
    const docs = path.join(root, 'docs');
    mkdirSync(docs);
    expect(() => inspectNoFollowDirectoryChain(
      path.join(docs, 'work-packages', 'nested'),
      'required control parent'
    )).toThrow(expect.objectContaining({ code: 'PHYSICAL_NO_FOLLOW_ABSENT' }));

    const ordinaryFile = path.join(docs, 'ordinary-file');
    writeFileSync(ordinaryFile, 'not a directory\n', 'utf8');
    expect(() => inspectNoFollowDirectoryChain(
      path.join(ordinaryFile, 'nested'),
      'ordinary file ancestor'
    )).toThrow(expect.objectContaining({ code: 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH' }));

    const external = path.join(root, 'external');
    mkdirSync(external);
    const junction = path.join(docs, 'junction');
    symlinkSync(external, junction, 'junction');
    expect(() => inspectNoFollowDirectoryChain(
      path.join(junction, 'nested'),
      'junction ancestor'
    )).toThrow(expect.objectContaining({ code: 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH' }));
  });
});

test.skipIf(process.platform !== 'win32')('Windows ordinary-file inspection classifies directory and junction leaves as unsafe', () => {
  withFixtureRoot('sec-file-kind-mismatch-', root => {
    const parentPath = path.join(root, 'work');
    const external = path.join(root, 'external');
    mkdirSync(parentPath);
    mkdirSync(external);
    mkdirSync(path.join(parentPath, 'ordinary-directory'));
    symlinkSync(external, path.join(parentPath, 'junction-next'), 'junction');
    const parent = inspectNoFollowDirectoryChain(parentPath, 'file kind mismatch parent').target;
    for (const name of ['ordinary-directory', 'junction-next']) {
      expect(() => inspectNoFollowOrdinaryFileEntry(parent, name)).toThrow(
        expect.objectContaining({ code: 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH' })
      );
    }
  });
});

test.skipIf(process.platform !== 'linux' && process.platform !== 'win32')('retained file transaction atomically replaces the exact name without changing its permission surface', async () => {
  await withAsyncFixtureRoot('sec-retained-file-rewrite-', async root => {
    mkdirSync(path.join(root, 'work'));
    const target = path.join(root, 'work', 'value.txt');
    writeFileSync(target, 'before\\n', 'utf8');
    if (process.platform === 'linux') chmodSync(target, 0o640);
    const transaction = retainNoFollowFileTransaction(root, 'retained rewrite fixture');
    try {
      const observed = transaction.observe('work/value.txt', 'rewrite source')!;
      const rewritten = await transaction.rewriteExact(
        'work/value.txt', observed, Buffer.from('after\\n', 'utf8'), 'rewrite exact file'
      );
      const after = statSync(target, { bigint: true });
      expect(String(after.dev)).toBe(rewritten.identity.device);
      expect(String(after.ino)).toBe(rewritten.identity.inode);
      expect(rewritten.identity).not.toEqual(observed.identity);
      if (process.platform === 'linux') expect(Number(after.mode & 0o7777n)).toBe(0o640);
      expect(readFileSync(target, 'utf8')).toBe('after\\n');
      await expect(transaction.rewriteExact(
        'work/value.txt', observed, Buffer.from('stale\\n', 'utf8'), 'stale rewrite'
      )).rejects.toMatchObject({ code: 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE' });
      expect(rewritten.bytes).toEqual(Buffer.from('after\\n', 'utf8'));
    } finally {
      transaction.dispose();
    }
  });
});

test.skipIf(process.platform !== 'linux' && process.platform !== 'win32')('retained file transaction refuses to rewrite a hard-linked inode', async () => {
  await withAsyncFixtureRoot('sec-retained-file-hardlink-', async root => {
    mkdirSync(path.join(root, 'work'));
    const target = path.join(root, 'work', 'value.txt');
    const alias = path.join(root, 'alias.txt');
    writeFileSync(target, 'shared\\n', 'utf8');
    linkSync(target, alias);
    const transaction = retainNoFollowFileTransaction(root, 'retained hardlink fixture');
    try {
      const observed = transaction.observe('work/value.txt', 'hardlink source')!;
      await expect(transaction.rewriteExact(
        'work/value.txt', observed, Buffer.from('mutated\\n', 'utf8'), 'hardlink rewrite'
      )).rejects.toMatchObject({ code: 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH' });
      expect(readFileSync(target, 'utf8')).toBe('shared\\n');
      expect(readFileSync(alias, 'utf8')).toBe('shared\\n');
    } finally {
      transaction.dispose();
    }
  });
});
