import { expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  copyNoFollowDirectoryTreesBulk,
  deleteRetainedNoFollowEntry,
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile,
  scanNoFollowDirectoryTree,
  scanNoFollowDirectoryTreeInventory,
  scanNoFollowDirectoryTreeMetadata,
  scanNoFollowDirectoryTreeSelectedForest
} from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';

function fixture() {
  const workspace = mkdtempSync(path.join(tmpdir(), 'sec-physical-resource-boundary-'));
  const source = path.join(workspace, 'source');
  mkdirSync(source);
  return { workspace, source, cleanup: () => rmSync(workspace, { recursive: true, force: true }) };
}

function rootDescriptors(): number {
  return readdirSync('/proc/self/fd').filter(name => {
    try { return readlinkSync(`/proc/self/fd/${name}`) === '/'; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  }).length;
}

test.skipIf(process.platform !== 'linux')('ordinary-file capability disposes the complete Linux directory chain including the filesystem root', () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.source, 'value'), 'exact');
    const parent = inspectNoFollowDirectoryChain(f.source);
    retainNoFollowOrdinaryFile(parent, 'value').dispose(); // Lazy backend admission is not measured.
    const before = rootDescriptors();
    for (let index = 0; index < 8; index += 1) {
      const retained = retainNoFollowOrdinaryFile(parent, 'value');
      try { expect(Buffer.from(retained.readBytes()).toString()).toBe('exact'); }
      finally { retained.dispose(); }
    }
    expect(rootDescriptors()).toBe(before);
  } finally { f.cleanup(); }
});

test.skipIf(process.platform !== 'linux')('failed ordinary-file admission also disposes its Linux filesystem root', () => {
  const f = fixture();
  try {
    const parent = inspectNoFollowDirectoryChain(f.source);
    expect(() => retainNoFollowOrdinaryFile(parent, 'absent')).toThrow();
    const before = rootDescriptors();
    for (let index = 0; index < 8; index += 1) {
      expect(() => retainNoFollowOrdinaryFile(parent, 'absent')).toThrow();
    }
    expect(rootDescriptors()).toBe(before);
  } finally { f.cleanup(); }
});

test.skipIf(process.platform !== 'win32')('Windows failed directory identity admission releases its not-yet-accepted pinned handle', () => {
  const f = fixture();
  try {
    const chain = inspectNoFollowDirectoryChain(f.source);
    const foreign = { ...chain.target, inode: `${chain.target.inode}-foreign` };
    const invalid = { target: foreign, ancestors: [...chain.ancestors.slice(0, -1), foreign] };
    expect(() => retainNoFollowDirectoryForChildProcess(invalid, 4)).toThrow();
    // An unclosed handle without delete sharing would make this rename fail.
    const moved = path.join(f.workspace, 'moved');
    renameSync(f.source, moved);
    expect(inspectNoFollowDirectoryChain(moved).target.inode).toBe(chain.target.inode);
  } finally { f.cleanup(); }
});

test('retained deletion rejects dot and traversal components anywhere, not only at the end', () => {
  const f = fixture();
  try {
    const sibling = path.join(f.workspace, 'sibling');
    mkdirSync(sibling);
    writeFileSync(path.join(sibling, 'keep'), 'foreign to source');
    const root = inspectNoFollowDirectoryChain(f.source).target;
    const outer = inspectNoFollowDirectoryChain(f.workspace).target;
    const other = inspectNoFollowDirectoryChain(sibling).target;
    const leaf = inspectNoFollowOrdinaryFileEntry(other, 'keep')!;
    for (const relativePath of ['../sibling/keep', './value', 'nested/../value', 'nested/../../sibling/keep', 'nested/./value', 'nested//value']) {
      expect(() => deleteRetainedNoFollowEntry({
        root, relativePath, kind: 'file', device: leaf.device, inode: leaf.inode,
        ancestorDirectories: [
          { relativePath: '..', device: outer.device, inode: outer.inode },
          { relativePath: '../sibling', device: other.device, inode: other.inode }
        ]
      })).toThrow('relative path is invalid');
      expect(readFileSync(path.join(sibling, 'keep'), 'utf8')).toBe('foreign to source');
    }
  } finally { f.cleanup(); }
});

test('retained deletion still accepts the exact ordinary descendant inventory', () => {
  const f = fixture();
  try {
    const nested = path.join(f.source, 'nested');
    mkdirSync(nested);
    writeFileSync(path.join(nested, 'owned'), 'owned');
    const root = inspectNoFollowDirectoryChain(f.source).target;
    const parent = inspectNoFollowDirectoryChain(nested).target;
    const leaf = inspectNoFollowOrdinaryFileEntry(parent, 'owned')!;
    deleteRetainedNoFollowEntry({
      root, relativePath: 'nested/owned', kind: 'file', device: leaf.device, inode: leaf.inode,
      ancestorDirectories: [{ relativePath: 'nested', device: parent.device, inode: parent.inode }]
    });
    expect(readdirSync(nested)).toEqual([]);
  } finally { f.cleanup(); }
});

test('all inventory modes stop enumeration at the same inclusive entry ceiling', () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.source, 'first'), 'first');
    const root = inspectNoFollowDirectoryChain(f.source).target;
    for (const scan of [scanNoFollowDirectoryTree, scanNoFollowDirectoryTreeInventory, scanNoFollowDirectoryTreeMetadata]) {
      expect(scan(root, { maximumEntries: 1, deadlineAtMs: performance.now() + 5000 })).toHaveLength(1);
    }
    writeFileSync(path.join(f.source, 'second'), 'second');
    for (const scan of [scanNoFollowDirectoryTree, scanNoFollowDirectoryTreeInventory, scanNoFollowDirectoryTreeMetadata]) {
      expect(() => scan(root, { maximumEntries: 1, deadlineAtMs: performance.now() + 5000 })).toThrow('entry bound');
    }
  } finally { f.cleanup(); }
});

test('selected-forest filtering cannot reset or hide directory enumeration work', () => {
  const f = fixture();
  try {
    for (let index = 0; index < 4; index += 1) writeFileSync(path.join(f.source, `ignored-${index}`), 'ignored');
    const root = inspectNoFollowDirectoryChain(f.source).target;
    expect(() => scanNoFollowDirectoryTreeSelectedForest(root, {
      maximumEntries: 2,
      deadlineAtMs: performance.now() + 5000,
      includeRelativePaths: ['selected/missing'],
      omitNavigationPrefixes: true
    })).toThrow('entry bound');
  } finally { f.cleanup(); }
});

test('bulk-copy entry accounting includes excluded names across all three inventories', async () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.source, 'included'), 'one');
    mkdirSync(path.join(f.source, 'excluded'));
    writeFileSync(path.join(f.source, 'excluded', 'not-traversed'), 'not copied');
    const root = inspectNoFollowDirectoryChain(f.source).target;
    await expect(copyNoFollowDirectoryTreesBulk([{ source: root, target: path.join(f.workspace, 'target') }], {
      excludeRelativePaths: ['excluded'], maximumEntries: 4, maximumBytes: 1024,
      deadlineAtMs: performance.now() + 5000
    })).rejects.toThrow('entry bound');
    expect(readFileSync(path.join(f.source, 'included'), 'utf8')).toBe('one');
    expect(readFileSync(path.join(f.source, 'excluded', 'not-traversed'), 'utf8')).toBe('not copied');
  } finally { f.cleanup(); }
});

test.skipIf(process.platform !== 'linux')('streaming inventory checks its deadline during a large ordinary leaf, not only between files', () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.source, 'large'), Buffer.alloc(256 * 1024, 0x61));
    const root = inspectNoFollowDirectoryChain(f.source).target;
    let ticks = 0;
    const clock = spyOn(performance, 'now').mockImplementation(() => ++ticks < 8 ? 1 : 20);
    try {
      expect(() => scanNoFollowDirectoryTreeInventory(root, { maximumEntries: 4, deadlineAtMs: 10 })).toThrow('deadline');
    } finally { clock.mockRestore(); }
  } finally { f.cleanup(); }
});

test('transaction creation snapshots caller bytes before an awaited create actor', async () => {
  const f = fixture();
  try {
    const { retainNoFollowFileTransaction, createRetainedNoFollowFileTransactionTestActorForTests } =
      await import('../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts');
    const bytes = Buffer.from('captured bytes');
    const transaction = retainNoFollowFileTransaction(f.source, 'creation input fixture',
      createRetainedNoFollowFileTransactionTestActorForTests({ beforeCreate: async () => { bytes.fill(0); } }));
    try {
      await transaction.createExclusive('created', bytes, 'captured create');
      expect(readFileSync(path.join(f.source, 'created'), 'utf8')).toBe('captured bytes');
    } finally { transaction.dispose(); }
  } finally { f.cleanup(); }
});

test.skipIf(process.platform !== 'linux')('retained rewrite rejects a changed permission preimage before touching bytes', async () => {
  const f = fixture();
  try {
    const { chmodSync } = await import('node:fs');
    const { retainNoFollowFileTransaction } = await import('../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts');
    const target = path.join(f.source, 'value');
    writeFileSync(target, 'original');
    chmodSync(target, 0o640);
    const transaction = retainNoFollowFileTransaction(f.source, 'rewrite permission fixture');
    try {
      const observed = transaction.observe('value', 'permission preimage')!;
      chmodSync(target, 0o600);
      await expect(transaction.rewriteExact('value', observed, Buffer.from('mutated'), 'rewrite permission fence'))
        .rejects.toThrow('permission mode changed');
      expect(readFileSync(target, 'utf8')).toBe('original');
    } finally { transaction.dispose(); }
  } finally { f.cleanup(); }
});
