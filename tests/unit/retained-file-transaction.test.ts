import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
} from '../../src/runtime-state/physical/runtime/physical-no-follow.ts';


test.skipIf(process.platform !== 'win32')('Windows retained file transaction transfers a cross-parent file and retires its exact successor', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-retained-file-transaction-'));
  try {
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
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retained file transaction rejects an unissued test actor', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-retained-file-transaction-'));
  try {
    expect(() => retainNoFollowFileTransaction(root, 'foreign actor', {})).toThrow(
      expect.objectContaining({
        code: 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE'
      })
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')('Windows retained file transaction revalidates bytes after an awaited pre-effect actor', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-retained-file-transaction-'));
  try {
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
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')('Windows retained file transaction cannot report a parent barrier before its real pre-barrier seam succeeds', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-retained-file-transaction-'));
  try {
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
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')('Windows no-follow directory creation reports only real create and parent-barrier phases', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-directory-create-actor-'));
  try {
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
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')('Windows no-follow directory creation cannot report a barrier when its pre-barrier actor fails', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-directory-create-actor-'));
  try {
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
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('direct no-follow metadata census does not traverse or charge nested entries', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-direct-metadata-'));
  try {
    const nested = path.join(root, 'nested');
    mkdirSync(nested);
    for (let index = 0; index < 32; index += 1) {
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
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')('Windows absolute directory chains distinguish a missing ancestor from unsafe existing entries', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-missing-chain-'));
  try {
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
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')('Windows ordinary-file inspection classifies directory and junction leaves as unsafe', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-file-kind-mismatch-'));
  try {
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
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
