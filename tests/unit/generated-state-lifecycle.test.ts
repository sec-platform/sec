import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { generatedStateDigestV1 } from '../../platform/shared/generated-state-contract.ts';
import {
  inspectGeneratedStateV1,
  planGeneratedStateCleanupV1,
  registerGeneratedStateBirthV1,
  retireGeneratedStateV1,
  settleGeneratedStateV1
} from '../../tooling/sec-dev/generated-state-lifecycle.ts';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true });
});

async function fixture() {
  const hostRoot = await mkdtemp(path.join(os.tmpdir(), 'sec-generated-state-'));
  roots.push(hostRoot);
  const repositoryRoot = path.join(hostRoot, 'repository');
  const stateRoot = path.join(hostRoot, 'state');
  const cacheRoot = path.join(hostRoot, 'cache');
  await mkdir(repositoryRoot);
  const environment = {
    ...process.env,
    SEC_STATE_HOME: stateRoot,
    SEC_CACHE_HOME: cacheRoot
  };
  const options = {
    environment,
    runGit: async () => ({ code: 1, stdout: new Uint8Array(), stderr: 'not registered' })
  } as const;
  return { cacheRoot, options, repositoryRoot, stateRoot };
}

async function absent(target: string): Promise<boolean> {
  return stat(target).then(() => false, (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return true;
    throw error;
  });
}

test('inspect is zero-write and protects one ignored unknown root', async () => {
  const { cacheRoot, options, repositoryRoot, stateRoot } = await fixture();
  await mkdir(path.join(repositoryRoot, '.tmp', 'mystery'), { recursive: true });

  const inventory = await inspectGeneratedStateV1({ repositoryRoot }, options);

  expect(inventory.entries.find(({ relativePath }) => relativePath === '.tmp/mystery')).toMatchObject({
    stateClass: 'unknown-unclassified',
    settlement: 'blocked',
    blockers: ['unknown-generated-state']
  });
  expect(await absent(stateRoot)).toBe(true);
  expect(await absent(cacheRoot)).toBe(true);
});

test('birth and retirement are owner-generated and make only the exact retired root selectable', async () => {
  const { options, repositoryRoot } = await fixture();
  const generatedRoot = path.join(repositoryRoot, '.tmp', 'typecheck');
  await mkdir(generatedRoot, { recursive: true });
  await writeFile(path.join(generatedRoot, 'cache.bin'), 'cache');
  const firstClock = () => new Date('2026-08-23T01:00:00.000Z');
  const secondClock = () => new Date('2026-08-23T01:01:00.000Z');

  const active = await registerGeneratedStateBirthV1({
    repositoryRoot,
    relativePath: '.tmp/typecheck',
    operationId: 'typecheck-operation-1'
  }, { ...options, clock: firstClock });
  expect(active.generatedAt).toBe('2026-08-23T01:00:00.000Z');
  const activeInventory = await inspectGeneratedStateV1({ repositoryRoot }, options);
  expect(activeInventory.blockers).toEqual([]);
  expect(activeInventory.entries.find(
    ({ relativePath }) => relativePath === '.tmp/typecheck'
  )).toMatchObject({ registrationState: 'active', settlement: 'protected' });

  const retired = await retireGeneratedStateV1({
    repositoryRoot,
    relativePath: '.tmp/typecheck',
    retirementRef: generatedStateDigestV1('typecheck-owner-completed')
  }, { ...options, clock: secondClock });
  expect(retired.generatedAt).toBe('2026-08-23T01:01:00.000Z');
  const inventory = await inspectGeneratedStateV1({ repositoryRoot }, options);
  expect(planGeneratedStateCleanupV1({ inventory, profile: 'all-rebuildable' })).toEqual({
    selected: ['.tmp/typecheck'],
    protected: []
  });
});

test('cleanup quarantines, bounded-deletes and reads back one retired physical generation', async () => {
  const { options, repositoryRoot } = await fixture();
  const generatedRoot = path.join(repositoryRoot, '.tmp', 'typecheck');
  await mkdir(path.join(generatedRoot, 'nested'), { recursive: true });
  await writeFile(path.join(generatedRoot, 'nested', 'cache.bin'), 'cache');
  await mkdir(path.join(repositoryRoot, '.tmp', 'foreign-sibling'));
  await writeFile(path.join(repositoryRoot, '.tmp', 'foreign-sibling', 'keep.txt'), 'foreign');
  await registerGeneratedStateBirthV1({
    repositoryRoot,
    relativePath: '.tmp/typecheck',
    operationId: 'typecheck-operation-2'
  }, options);
  await retireGeneratedStateV1({
    repositoryRoot,
    relativePath: '.tmp/typecheck',
    retirementRef: generatedStateDigestV1('typecheck-owner-completed')
  }, options);

  const receipt = await settleGeneratedStateV1({
    repositoryRoot,
    profile: 'all-rebuildable',
    relativePaths: ['.tmp/typecheck']
  }, options);

  expect(receipt.terminal).toBe('completed');
  expect(receipt.selected).toEqual(['.tmp/typecheck']);
  expect(receipt.attempts.map(({ action }) => action)).toEqual(['quarantined', 'deleted']);
  expect(await absent(generatedRoot)).toBe(true);
  expect(await absent(path.join(repositoryRoot, '.tmp', 'generated-state-quarantine'))).toBe(true);
  expect((await inspectGeneratedStateV1({
    repositoryRoot,
    relativePaths: ['.tmp/typecheck']
  }, options)).blockers).toEqual([]);
  expect(await absent(path.join(repositoryRoot, '.tmp', 'foreign-sibling', 'keep.txt'))).toBe(false);
});

test('reparse roots and changed-after-inventory generations are protected', async () => {
  const { options, repositoryRoot } = await fixture();
  const outside = path.join(path.dirname(repositoryRoot), 'outside');
  await mkdir(outside);
  await mkdir(path.join(repositoryRoot, '.tmp'), { recursive: true });
  await symlink(outside, path.join(repositoryRoot, '.tmp', 'typecheck'), 'junction');
  const linked = await inspectGeneratedStateV1({
    repositoryRoot,
    relativePaths: ['.tmp/typecheck']
  }, options);
  expect(linked.entries[0]).toMatchObject({
    kind: 'link',
    settlement: 'protected',
    blockers: ['registration-missing', 'root-is-link-or-reparse']
  });
  await unlink(path.join(repositoryRoot, '.tmp', 'typecheck'));

  const generatedRoot = path.join(repositoryRoot, '.tmp', 'typecheck');
  const replacementRoot = path.join(repositoryRoot, '.tmp', 'replacement');
  await mkdir(generatedRoot);
  await mkdir(replacementRoot);
  await writeFile(path.join(generatedRoot, 'original.txt'), 'original');
  await writeFile(path.join(replacementRoot, 'replacement.txt'), 'replacement');
  await registerGeneratedStateBirthV1({
    repositoryRoot,
    relativePath: '.tmp/typecheck',
    operationId: 'typecheck-operation-race'
  }, options);
  await retireGeneratedStateV1({
    repositoryRoot,
    relativePath: '.tmp/typecheck',
    retirementRef: generatedStateDigestV1('typecheck-owner-completed')
  }, options);

  const receipt = await settleGeneratedStateV1({
    repositoryRoot,
    profile: 'all-rebuildable',
    relativePaths: ['.tmp/typecheck']
  }, {
    ...options,
    beforeCleanupEffect: async () => {
      await rename(generatedRoot, path.join(repositoryRoot, '.tmp', 'original-moved'));
      await rename(replacementRoot, generatedRoot);
    }
  });

  expect(receipt.terminal).toBe('partial-residue');
  expect(receipt.blockers).toEqual(['.tmp/typecheck:changed-after-inventory-or-unsupported-kind']);
  expect(await absent(path.join(generatedRoot, 'replacement.txt'))).toBe(false);
});

test('an interrupted quarantine resumes from durable intent without rediscovering ownership', async () => {
  const { options, repositoryRoot } = await fixture();
  const generatedRoot = path.join(repositoryRoot, '.tmp', 'typecheck');
  await mkdir(generatedRoot, { recursive: true });
  await writeFile(path.join(generatedRoot, 'cache.bin'), 'cache');
  await registerGeneratedStateBirthV1({
    repositoryRoot,
    relativePath: '.tmp/typecheck',
    operationId: 'typecheck-operation-interrupted'
  }, options);
  await retireGeneratedStateV1({
    repositoryRoot,
    relativePath: '.tmp/typecheck',
    retirementRef: generatedStateDigestV1('typecheck-owner-completed')
  }, options);

  const interrupted = await settleGeneratedStateV1({
    repositoryRoot,
    profile: 'all-rebuildable',
    relativePaths: ['.tmp/typecheck']
  }, {
    ...options,
    afterQuarantineEffect: () => {
      throw new Error('injected process interruption');
    }
  });
  expect(interrupted.terminal).toBe('partial-residue');
  expect(await absent(generatedRoot)).toBe(true);

  const resumed = await settleGeneratedStateV1({
    repositoryRoot,
    profile: 'all-rebuildable',
    relativePaths: ['.tmp/typecheck']
  }, options);
  expect(resumed.terminal).toBe('completed');
  expect(resumed.attempts.map(({ action }) => action)).toEqual(['deleted']);
  expect(await absent(path.join(repositoryRoot, '.tmp', 'generated-state-quarantine'))).toBe(true);
});

test('a foreign quarantine entry prevents a completed physical settlement', async () => {
  const { options, repositoryRoot } = await fixture();
  const generatedRoot = path.join(repositoryRoot, '.tmp', 'typecheck');
  const quarantineRoot = path.join(repositoryRoot, '.tmp', 'generated-state-quarantine');
  await mkdir(generatedRoot, { recursive: true });
  await writeFile(path.join(generatedRoot, 'cache.bin'), 'cache');
  await registerGeneratedStateBirthV1({
    repositoryRoot,
    relativePath: '.tmp/typecheck',
    operationId: 'typecheck-operation-foreign-quarantine'
  }, options);
  await retireGeneratedStateV1({
    repositoryRoot,
    relativePath: '.tmp/typecheck',
    retirementRef: generatedStateDigestV1('typecheck-owner-completed')
  }, options);

  const receipt = await settleGeneratedStateV1({
    repositoryRoot,
    profile: 'all-rebuildable',
    relativePaths: ['.tmp/typecheck']
  }, {
    ...options,
    afterQuarantineEffect: async () => {
      await mkdir(path.join(quarantineRoot, 'foreign-residue'));
      await writeFile(path.join(quarantineRoot, 'foreign-residue', 'keep.txt'), 'foreign');
    }
  });

  expect(receipt.terminal).toBe('partial-residue');
  expect(receipt.blockers).toEqual(['.tmp/generated-state-quarantine:physical-residue']);
  expect(await absent(generatedRoot)).toBe(true);
  expect(await absent(path.join(quarantineRoot, 'foreign-residue', 'keep.txt'))).toBe(false);
});
