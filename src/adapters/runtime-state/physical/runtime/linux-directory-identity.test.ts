import { expect, test } from 'bun:test';
import { spawnSync, type StdioOptions } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  assertSameNoFollowDirectoryIdentity,
  inspectNoFollowDirectoryChain,
  materializeRetainedNoFollowProvenDirectoryGeneration,
  scanNoFollowDirectoryTreeInventory,
  publishExclusiveNoFollowProvenDirectoryLink
} from './physical-no-follow.ts';

const linuxTest = test.skipIf(process.platform !== 'linux');
const binding = (count: number) => ({
  generationDigest: `sha256:${'1'.repeat(64)}` as const,
  treeDigest: `sha256:${'2'.repeat(64)}` as const,
  treeEntryCount: count
});

linuxTest('directory identity survives owner mode transitions while the read-only proof still rejects mode drift', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-linux-directory-identity-'));
  let generation: Awaited<ReturnType<typeof materializeRetainedNoFollowProvenDirectoryGeneration>> | undefined;
  try {
    await writeFile(path.join(root, 'value.txt'), 'value');
    await chmod(root, 0o750);
    const before = inspectNoFollowDirectoryChain(root).target;
    const inventory = scanNoFollowDirectoryTreeInventory(before, {
      deadlineAtMs: performance.now() + 30_000, maximumBytes: 1024, maximumEntries: 4
    });
    generation = await materializeRetainedNoFollowProvenDirectoryGeneration({
      binding: binding(inventory.length), deadlineAtUnixMs: Date.now() + 30_000,
      inventory, proofText: null, releaseMode: 'restore-owner-write', root: before
    });
    expect(generation.generation.root).toEqual(before);
    expect((await lstat(root)).mode & 0o777).toBe(0o555);
    await generation.generation.assertAuthorityCurrent();
    await chmod(root, 0o755);
    expect(assertSameNoFollowDirectoryIdentity(before).target).toEqual(before);
    await expect(generation.generation.assertAuthorityCurrent()).rejects.toThrow();
    await chmod(root, 0o555);
    const receipt = await generation.generation.retire();
    expect(receipt.root).toEqual(before);
    expect((await lstat(root)).mode & 0o777).toBe(0o750);
  } finally {
    // A drifted root mode has to be reconciled before the owner can restore it.
    if (generation) {
      try { await generation.generation.retire(); } catch { /* preserve the asserted primary failure */ }
    }
    await chmod(root, 0o750);
    await rm(root, { recursive: true, force: true });
  }
});

linuxTest('replacement of an empty root is rejected before sealing the foreign directory', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'sec-linux-root-replacement-'));
  const root = path.join(parent, 'source');
  try {
    await mkdir(root, { mode: 0o750 });
    const before = inspectNoFollowDirectoryChain(root).target;
    await rename(root, path.join(parent, 'preserved'));
    await mkdir(root, { mode: 0o750 });
    const replacement = await lstat(root);
    await expect(materializeRetainedNoFollowProvenDirectoryGeneration({
      binding: binding(0), deadlineAtUnixMs: Date.now() + 30_000,
      inventory: [], proofText: null, root: before
    })).rejects.toThrow('Proven generation admission root physical identity changed');
    expect((await lstat(root)).mode).toBe(replacement.mode);
    expect((await lstat(root)).ino).toBe(replacement.ino);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

linuxTest('legacy mode-bearing observations fail closed without changing permissions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-linux-legacy-identity-'));
  try {
    const metadata = await lstat(root, { bigint: true });
    const current = inspectNoFollowDirectoryChain(root).target;
    const legacy = { ...current, objectId: `linux:${metadata.dev}:${metadata.ino}:${metadata.mode}` };
    await expect(materializeRetainedNoFollowProvenDirectoryGeneration({
      binding: binding(0), deadlineAtUnixMs: Date.now() + 30_000,
      inventory: [], proofText: null, root: legacy
    })).rejects.toThrow('Proven generation admission root physical identity changed');
    expect((await lstat(root, { bigint: true })).mode).toBe(metadata.mode);
  } finally { await rm(root, { recursive: true, force: true }); }
});

linuxTest('proven links use the inherited child slot rather than the parent descriptor number', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'sec-linux-inherited-slot-'));
  const root = path.join(parent, 'dependency');
  let generation: Awaited<ReturnType<typeof materializeRetainedNoFollowProvenDirectoryGeneration>> | undefined;
  try {
    await mkdir(root);
    await writeFile(path.join(root, 'value.txt'), 'retained value');
    const physical = inspectNoFollowDirectoryChain(root).target;
    const inventory = scanNoFollowDirectoryTreeInventory(physical, {
      deadlineAtMs: performance.now() + 30_000, maximumBytes: 1024, maximumEntries: 4
    });
    generation = await materializeRetainedNoFollowProvenDirectoryGeneration({
      binding: binding(inventory.length), deadlineAtUnixMs: Date.now() + 30_000,
      inventory, proofText: null, releaseMode: 'restore-owner-write', root: physical
    });
    const source = generation.generation;
    expect(source.childPath).toBe('/proc/self/fd/15');
    expect(source.stdioSourceDescriptor).not.toBe(15);
    const link = publishExclusiveNoFollowProvenDirectoryLink({
      parent: inspectNoFollowDirectoryChain(parent).target, name: 'borrowed', source
    });
    expect(link.linkTarget).toBe(source.childPath);
    const stdio: StdioOptions = Array.from({ length: 16 }, () => 'ignore' as const);
    stdio[1] = 'pipe'; stdio[2] = 'pipe'; stdio[15] = source.stdioSourceDescriptor!;
    const child = spawnSync(process.execPath, ['-e',
      `process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(path.join(parent, 'borrowed', 'value.txt'))}, 'utf8'))`
    ], { stdio, encoding: 'utf8', timeout: 5000 });
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toBe('retained value');
    await source.assertAuthorityCurrent();
  } finally {
    if (generation) await generation.generation.retire();
    await rm(parent, { recursive: true, force: true });
  }
});
