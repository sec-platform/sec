import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createExclusiveNoFollowDirectory,
  deleteRetainedNoFollowEntry,
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  publishExclusiveDurableCanonicalFile,
  replaceDurableCanonicalFile,
  tryRetainExclusiveFileGuard,
  type RetainedExclusiveFileGuard
} from './physical-no-follow.ts';

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-native-file-guard-'));
  const parent = inspectNoFollowDirectoryChain(root, 'Native guard fixture').target;
  const bytes = Buffer.from('fixture-owned immutable native anchor\n');
  const receipt = publishExclusiveDurableCanonicalFile({
    parent, name: 'anchor.lock', bytes, validate: () => undefined
  });
  return { root, parent, bytes, receipt };
}

test('native guard retains one object through contention and exact settlement', () => {
  const { root, parent, bytes, receipt } = fixture();
  let held: RetainedExclusiveFileGuard | null = null;
  try {
    held = tryRetainExclusiveFileGuard(parent, 'anchor.lock', receipt.physical, bytes);
    expect(held).not.toBeNull();
    held!.assertCurrent();
    expect(tryRetainExclusiveFileGuard(parent, 'anchor.lock', receipt.physical, bytes)).toBeNull();
    held!.dispose();
    expect(() => held!.assertCurrent()).toThrow();
    held = tryRetainExclusiveFileGuard(parent, 'anchor.lock', receipt.physical, bytes);
    expect(held).not.toBeNull();
    held!.dispose();
    held = null;
    expect(inspectNoFollowOrdinaryFileEntry(parent, 'anchor.lock')?.inode).toBe(receipt.physical.inode);
  } finally {
    held?.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});

test('same-byte anchor replacement cannot inherit a retained native token', () => {
  const { root, parent, bytes, receipt } = fixture();
  const held = tryRetainExclusiveFileGuard(parent, 'anchor.lock', receipt.physical, bytes)!;
  try {
    // Windows refuses replacement while the native anchor is pinned; Linux
    // detects the detached inode. Neither behavior grants the successor a lock.
    let replaced = false;
    try {
      replaceDurableCanonicalFile({
        parent, name: 'anchor.lock', bytes, expectedExisting: receipt.physical,
        validate: () => undefined
      });
      replaced = true;
    } catch (error) {
      if (process.platform !== 'win32') throw error;
    }
    if (replaced) {
      expect(() => held.assertCurrent()).toThrow();
      expect(() => tryRetainExclusiveFileGuard(parent, 'anchor.lock', receipt.physical, bytes)).toThrow();
    } else {
      held.assertCurrent();
      expect(inspectNoFollowOrdinaryFileEntry(parent, 'anchor.lock')?.inode).toBe(receipt.physical.inode);
    }
  } finally {
    held.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});

test('exact guarded deletion rejects forged, foreign, closed and byte-drift preconditions', () => {
  const { root, parent, bytes, receipt } = fixture();
  const payload = Buffer.from('expected payload\n');
  const file = publishExclusiveDurableCanonicalFile({
    parent, name: 'payload.json', bytes: payload, validate: () => undefined
  });
  const input = {
    root: parent, relativePath: 'payload.json', kind: 'file' as const,
    device: file.physical.device, inode: file.physical.inode,
    expectedFileBytes: payload, ancestorDirectories: []
  };
  let held = tryRetainExclusiveFileGuard(parent, 'anchor.lock', receipt.physical, bytes, 'payload.json')!;
  try {
    if (process.platform === 'linux') {
      expect(() => deleteRetainedNoFollowEntry(input)).toThrow('native namespace exclusion');
    }
    expect(() => deleteRetainedNoFollowEntry({ ...input, resourceGuard: { ...held } })).toThrow();
    const foreign = createExclusiveNoFollowDirectory(parent, 'foreign-parent');
    expect(() => deleteRetainedNoFollowEntry({ ...input, root: foreign, resourceGuard: held })).toThrow();
    expect(() => deleteRetainedNoFollowEntry({ ...input, relativePath: 'foreign.json', resourceGuard: held })).toThrow();
    writeFileSync(path.join(root, 'payload.json'), 'changed payload\n');
    expect(() => deleteRetainedNoFollowEntry({ ...input, resourceGuard: held })).toThrow();
    expect(readFileSync(path.join(root, 'payload.json'), 'utf8')).toBe('changed payload\n');
    writeFileSync(path.join(root, 'payload.json'), payload);
    held.dispose();
    expect(() => deleteRetainedNoFollowEntry({ ...input, resourceGuard: held })).toThrow();
    held = tryRetainExclusiveFileGuard(parent, 'anchor.lock', receipt.physical, bytes, 'payload.json')!;
    deleteRetainedNoFollowEntry({ ...input, resourceGuard: held });
    expect(inspectNoFollowOrdinaryFileEntry(parent, 'payload.json')).toBeNull();
  } finally {
    held.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});
