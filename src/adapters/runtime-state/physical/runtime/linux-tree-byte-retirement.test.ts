import { expect, spyOn, test } from 'bun:test';
import { closeSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { linuxOpenRetainedAbsoluteDirectory, linuxReleaseExclusiveFileGuard, linuxTryExclusiveFileGuard } from './physical-no-follow-native.ts';
import { inspectNoFollowDirectoryChain, retireNoFollowDirectoryTree, scanNoFollowDirectoryTreeInventory } from './physical-no-follow.ts';

function fixture() {
  const parentPath = mkdtempSync(path.join(tmpdir(), 'gift-linux-tree-byte-retirement-'));
  const rootPath = path.join(parentPath, 'original');
  mkdirSync(path.join(rootPath, 'nested'), { recursive: true });
  const expectedFileBytes = new Map([['nested/z.json', Buffer.from('first original\n')], ['nested/a.json', Buffer.from('second original\n')]]);
  for (const [relativePath, bytes] of expectedFileBytes) writeFileSync(path.join(rootPath, relativePath), bytes);
  const parent = inspectNoFollowDirectoryChain(parentPath, 'Tree byte retirement test parent').target;
  const root = inspectNoFollowDirectoryChain(rootPath, 'Tree byte retirement test root').target;
  // Permission restoration consumes the canonical scan's original mode and
  // retained POSIX ownership; the default content inventory omits both.
  const inventory = scanNoFollowDirectoryTreeInventory(root, { deadlineAtMs: performance.now() + 30_000,
    includePermissionMode: true, maximumBytes: 1024, maximumEntries: 8 });
  const retire = (restoreOwnerPermissions = false) => retireNoFollowDirectoryTree({ parent, root, inventory, expectedFileBytes,
    restoreOwnerPermissions, deadlineAtMonotonicMs: performance.now() + 30_000 });
  return { parentPath, rootPath, expectedFileBytes, retire };
}

for (const interruptionPoint of ['file', 'directory'] as const) {
test.skipIf(process.platform !== 'linux')(`Linux byte retirement resumes after actual ${interruptionPoint} unlink and completes retirement`, () => {
  const item = fixture();
  const first = path.join(item.rootPath, interruptionPoint === 'file' ? 'nested/z.json' : 'nested');
  const originalNow = performance.now.bind(performance);
  let interrupted = false;
  const clock = spyOn(performance, 'now').mockImplementation(() => {
    if (!existsSync(first)) { interrupted = true; throw new Error('fixture interruption after durable original unlink'); }
    return originalNow();
  });
  try {
    expect(() => item.retire(true)).toThrow('fixture interruption');
    clock.mockRestore();
    expect(interrupted).toBe(true);
    expect(existsSync(first)).toBe(false);
    if (interruptionPoint === 'file') expect(readFileSync(path.join(item.rootPath, 'nested/a.json'), 'utf8')).toBe('second original\n');
    else expect(existsSync(item.rootPath)).toBe(true);
    expect(item.retire(true).status).toBe('physically-absent');
    expect(existsSync(item.rootPath)).toBe(false);
    expect(item.retire().status).toBe('physically-absent');
  } finally {
    clock.mockRestore();
    rmSync(item.parentPath, { recursive: true, force: true });
  }
});
}

test.skipIf(process.platform !== 'linux')('Linux strict retirement preserves byte drift, unknown entries and replacement identities before any deletion', () => {
  const item = fixture();
  try {
    const file = path.join(item.rootPath, 'nested/a.json');
    writeFileSync(file, 'changed bytes\n');
    expect(item.retire).toThrow(expect.objectContaining({ code: 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED' }));
    expect(existsSync(path.join(item.rootPath, 'nested/z.json'))).toBe(true);
    writeFileSync(file, item.expectedFileBytes.get('nested/a.json')!);
    const extra = path.join(item.rootPath, 'unowned.json');
    writeFileSync(extra, 'foreign\n');
    expect(item.retire).toThrow(expect.objectContaining({ code: 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED' }));
    rmSync(extra);
    renameSync(file, path.join(item.parentPath, 'displaced.json'));
    writeFileSync(file, item.expectedFileBytes.get('nested/a.json')!);
    expect(item.retire).toThrow(expect.objectContaining({ code: 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED' }));
    expect(readFileSync(file, 'utf8')).toBe('second original\n');
    expect(readFileSync(path.join(item.parentPath, 'displaced.json'), 'utf8')).toBe('second original\n');
    const displacedRoot = path.join(item.parentPath, 'displaced-root');
    renameSync(item.rootPath, displacedRoot);
    mkdirSync(item.rootPath);
    writeFileSync(path.join(item.rootPath, 'replacement.json'), 'new root\n');
    expect(item.retire).toThrow(expect.objectContaining({ code: 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED' }));
    expect(readFileSync(path.join(displacedRoot, 'nested/a.json'), 'utf8')).toBe('second original\n');
    expect(readFileSync(path.join(item.rootPath, 'replacement.json'), 'utf8')).toBe('new root\n');
  } finally { rmSync(item.parentPath, { recursive: true, force: true }); }
});

test.skipIf(process.platform !== 'linux')('Linux byte retirement rejects an independently held directory flock, then succeeds after real release', () => {
  const item = fixture();
  const retained = linuxOpenRetainedAbsoluteDirectory(item.rootPath, 'Independent tree retirement contender');
  let held = false;
  try {
    held = linuxTryExclusiveFileGuard(retained.directoryFd, 'Independent tree retirement contender');
    expect(held).toBe(true);
    expect(item.retire).toThrow(expect.objectContaining({ code: 'PHYSICAL_NO_FOLLOW_EXCLUSIVE_CONFLICT' }));
    expect(existsSync(path.join(item.rootPath, 'nested/z.json'))).toBe(true);
    linuxReleaseExclusiveFileGuard(retained.directoryFd, 'Independent tree retirement contender');
    held = false;
    expect(item.retire().status).toBe('physically-absent');
  } finally {
    if (held) linuxReleaseExclusiveFileGuard(retained.directoryFd, 'Independent tree retirement contender');
    closeSync(retained.directoryFd);
    closeSync(retained.filesystemRootFd);
    rmSync(item.parentPath, { recursive: true, force: true });
  }
});
