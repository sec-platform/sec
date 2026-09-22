import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmod, lstat, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectNoFollowDirectoryChain, materializeRetainedNoFollowProvenDirectoryGeneration,
  scanNoFollowDirectoryTreeInventory } from './physical-no-follow.ts';

test.skipIf(process.platform !== 'linux')('sealing preserves executable bits without adding execute permission to data and restores predecessor modes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-linux-sealed-executable-'));
  let generation: Awaited<ReturnType<typeof materializeRetainedNoFollowProvenDirectoryGeneration>> | undefined;
  try {
    const executable = path.join(root, 'tool.sh');
    const data = path.join(root, 'data.txt');
    await writeFile(executable, '#!/bin/sh\nprintf sealed');
    await writeFile(data, 'data');
    await chmod(executable, 0o751);
    await chmod(data, 0o640);
    const physical = inspectNoFollowDirectoryChain(root).target;
    const inventory = scanNoFollowDirectoryTreeInventory(physical, {
      deadlineAtMs: performance.now() + 30_000, maximumBytes: 1024, maximumEntries: 4
    });
    generation = await materializeRetainedNoFollowProvenDirectoryGeneration({
      binding: { generationDigest: `sha256:${'1'.repeat(64)}`, treeDigest: `sha256:${'2'.repeat(64)}`, treeEntryCount: inventory.length }, deadlineAtUnixMs: Date.now() + 30_000,
      inventory, proofText: null, releaseMode: 'restore-owner-write', root: physical
    });
    expect((await lstat(executable)).mode & 0o777).toBe(0o555);
    expect((await lstat(data)).mode & 0o777).toBe(0o444);
    const child = spawnSync(executable, [], { encoding: 'utf8', timeout: 5000 });
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toBe('sealed');
    await generation.generation.assertAuthorityCurrent();
    await generation.generation.retire();
    expect((await lstat(executable)).mode & 0o777).toBe(0o751);
    expect((await lstat(data)).mode & 0o777).toBe(0o640);
  } finally {
    if (generation) await generation.generation.retire();
    await rm(root, { recursive: true, force: true });
  }
});
