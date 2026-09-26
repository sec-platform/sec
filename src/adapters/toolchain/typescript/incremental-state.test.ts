import { afterEach, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { inspectNoFollowDirectoryChain } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { prepareTypeScriptIncrementalState } from './incremental-state.ts';

const roots: string[] = [];
const BINDING = `sha256:${'a'.repeat(64)}` as const;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(name: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `sec-ts-state-${name}-`));
  roots.push(root);
  const seedParentPath = path.join(root, 'seed');
  const actionParentPath = path.join(root, 'actions');
  await fs.mkdir(seedParentPath);
  await fs.mkdir(actionParentPath);
  return Object.freeze({
    actionPrivateParent: inspectNoFollowDirectoryChain(actionParentPath).target,
    deadlineAtUnixMs: Date.now() + 30_000,
    seedBindingDigest: BINDING,
    stableSeedFile: path.join(seedParentPath, 'typescript-incremental-seed.json'),
    stableSeedParent: inspectNoFollowDirectoryChain(seedParentPath).target
  });
}

test('incremental state validates a stable envelope into a fixed-layout private auxiliary tree', async () => {
  const input = await fixture('private');
  const cold = await prepareTypeScriptIncrementalState(input);
  expect(path.basename(cold.executionBuildInfoFile)).toBe('tsconfig.tsbuildinfo');
  await fs.writeFile(cold.executionBuildInfoFile, 'next');
  expect(await cold.publish()).toEqual({ status: 'published' });
  const firstCleanup = await cold.dispose();
  expect(firstCleanup.tree.status).toBe('physically-absent');

  const seeded = await prepareTypeScriptIncrementalState(input);
  expect(await fs.readFile(seeded.executionBuildInfoFile, 'utf8')).toBe('next');
  const secondCleanup = await seeded.dispose();
  expect(secondCleanup.tree.status).toBe('physically-absent');
});

test('cache contention selects cold semantics and cannot replace a foreign stable seed', async () => {
  const input = await fixture('contended');
  const session = await prepareTypeScriptIncrementalState(input);
  await fs.writeFile(input.stableSeedFile, 'foreign');
  await fs.writeFile(session.executionBuildInfoFile, 'private');
  expect(await session.publish()).toEqual({ status: 'cache-unavailable' });
  expect(await fs.readFile(input.stableSeedFile, 'utf8')).toBe('foreign');
  expect((await session.dispose()).tree.status).toBe('physically-absent');
});

test('invalid stable bytes select cold execution and are repaired only by retained CAS publication', async () => {
  const input = await fixture('invalid');
  await fs.writeFile(input.stableSeedFile, 'not-an-envelope');
  const session = await prepareTypeScriptIncrementalState(input);
  await expect(fs.stat(session.executionBuildInfoFile)).rejects.toMatchObject({ code: 'ENOENT' });
  await fs.writeFile(session.executionBuildInfoFile, 'repaired');
  expect(await session.publish()).toEqual({ status: 'published' });
  await session.dispose();
  const reused = await prepareTypeScriptIncrementalState(input);
  expect(await fs.readFile(reused.executionBuildInfoFile, 'utf8')).toBe('repaired');
  await reused.dispose();
});

test('expired or cancelled incremental admission creates no private tree or stable seed', async () => {
  const expired = await fixture('expired');
  await expect(prepareTypeScriptIncrementalState({
    ...expired,
    deadlineAtUnixMs: Date.now() - 1
  })).rejects.toThrow('deadline');
  expect(await fs.readdir(expired.actionPrivateParent.path)).toEqual([]);
  await expect(fs.stat(expired.stableSeedFile)).rejects.toMatchObject({ code: 'ENOENT' });

  const cancelled = await fixture('cancelled');
  const controller = new AbortController();
  controller.abort();
  await expect(prepareTypeScriptIncrementalState({
    ...cancelled,
    signal: controller.signal
  })).rejects.toThrow('cancelled');
  expect(await fs.readdir(cancelled.actionPrivateParent.path)).toEqual([]);
  await expect(fs.stat(cancelled.stableSeedFile)).rejects.toMatchObject({ code: 'ENOENT' });
});
