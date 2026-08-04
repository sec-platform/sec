import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  cleanGeneratedState,
  getGeneratedStateRoot,
  inspectGeneratedState,
  registerCurrentTestProcessGeneratedState
} from '../../platform/dev-runner/generated-state.ts';
import {
  GENERATED_STATE_OWNER_SCHEMA
} from '../../platform/shared/generated-state-contract.ts';

async function withRepository<T>(callback: (root: string) => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-generated-state-'));
  try {
    await fs.writeFile(path.join(root, 'package.json'), '{}\n', 'utf8');
    return await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeOwner(
  runRoot: string,
  input: { pid: number; host?: string; repositoryRoot: string; namespace: string; malformed?: boolean }
): Promise<void> {
  const ownerRoot = path.join(runRoot, '.sec-generated-state-owners');
  await fs.mkdir(ownerRoot, { recursive: true });
  const token = '11111111-1111-4111-8111-111111111111';
  const owner = input.malformed
    ? { schema: GENERATED_STATE_OWNER_SCHEMA, namespace: input.namespace }
    : {
        schema: GENERATED_STATE_OWNER_SCHEMA,
        repositoryRoot: input.repositoryRoot,
        namespace: input.namespace,
        host: input.host ?? 'test-host',
        pid: input.pid,
        token,
        createdAt: '2026-08-04T00:00:00.000Z'
      };
  await fs.writeFile(
    path.join(ownerRoot, `${input.pid}-${token}.json`),
    `${JSON.stringify(owner)}\n`,
    'utf8'
  );
}

function entryByPath(
  inventory: Awaited<ReturnType<typeof inspectGeneratedState>>,
  relativePath: string
) {
  const entry = inventory.entries.find((candidate) => candidate.relativePath === relativePath);
  if (!entry) throw new Error(`Missing inventory entry ${relativePath}`);
  return entry;
}

describe('generated-state runtime', () => {
  test('dry-run is physically read-only, including when .tmp is absent', async () => {
    await withRepository(async (repositoryRoot) => {
      const generatedRoot = getGeneratedStateRoot(repositoryRoot);
      const receipt = await cleanGeneratedState({
        repositoryRoot,
        profile: 'all-rebuildable',
        dryRun: true
      });
      expect(receipt.status).toBe('no-op');
      await expect(fs.access(generatedRoot)).rejects.toThrow();
    });
  });

  test('active owners are preserved and dead owners are automatically reclaimed', async () => {
    await withRepository(async (repositoryRoot) => {
      const generatedRoot = getGeneratedStateRoot(repositoryRoot);
      const activeRoot = path.join(generatedRoot, 'test-workspaces', 'active-run');
      const deadRoot = path.join(generatedRoot, 'test-workspaces', 'dead-run');
      await fs.mkdir(path.join(activeRoot, 'workspace'), { recursive: true });
      await fs.mkdir(path.join(deadRoot, 'workspace'), { recursive: true });
      await writeOwner(activeRoot, { pid: 101, repositoryRoot, namespace: 'active-run' });
      await writeOwner(deadRoot, { pid: 202, repositoryRoot, namespace: 'dead-run' });

      const runtime = {
        repositoryRoot,
        host: 'test-host',
        processIsAlive: (pid: number) => pid === 101,
        now: () => new Date('2026-08-04T01:00:00.000Z'),
        deepInventory: false
      };
      const before = await inspectGeneratedState(runtime);
      expect(entryByPath(before, 'test-workspaces/active-run').status).toBe('active');
      expect(entryByPath(before, 'test-workspaces/dead-run').status).toBe('orphaned');

      const receipt = await cleanGeneratedState({ ...runtime, profile: 'automatic' });
      expect(receipt.status).toBe('completed');
      expect(receipt.selected).toEqual(['test-workspaces/dead-run']);
      await expect(fs.access(activeRoot)).resolves.toBeUndefined();
      await expect(fs.access(deadRoot)).rejects.toThrow();
    });
  });

  test('cross-host and malformed owners are fail-closed and never reaped', async () => {
    await withRepository(async (repositoryRoot) => {
      const generatedRoot = getGeneratedStateRoot(repositoryRoot);
      const crossHostRoot = path.join(generatedRoot, 'test-workspaces', 'cross-host');
      const malformedRoot = path.join(generatedRoot, 'test-workspaces', 'malformed');
      await fs.mkdir(crossHostRoot, { recursive: true });
      await fs.mkdir(malformedRoot, { recursive: true });
      await writeOwner(crossHostRoot, {
        pid: 303,
        repositoryRoot,
        namespace: 'cross-host',
        host: 'other-host'
      });
      await writeOwner(malformedRoot, {
        pid: 404,
        repositoryRoot,
        namespace: 'malformed',
        malformed: true
      });

      const runtime = {
        repositoryRoot,
        host: 'test-host',
        processIsAlive: () => false,
        deepInventory: false
      };
      const inventory = await inspectGeneratedState(runtime);
      expect(entryByPath(inventory, 'test-workspaces/cross-host').status).toBe('unsafe-entry');
      expect(entryByPath(inventory, 'test-workspaces/malformed').status).toBe('unsafe-entry');
      const receipt = await cleanGeneratedState({ ...runtime, profile: 'automatic' });
      expect(receipt.status).toBe('no-op');
      expect(receipt.protected).toEqual(expect.arrayContaining([
        'test-workspaces/cross-host',
        'test-workspaces/malformed'
      ]));
      await expect(fs.access(crossHostRoot)).resolves.toBeUndefined();
      await expect(fs.access(malformedRoot)).resolves.toBeUndefined();
    });
  });

  test('legacy state needs explicit safe cleanup and recovery or unknown state remains protected', async () => {
    await withRepository(async (repositoryRoot) => {
      const generatedRoot = getGeneratedStateRoot(repositoryRoot);
      const legacyRoot = path.join(generatedRoot, 'test-workspaces', 'engineering-compiler-upgrade-old');
      await fs.mkdir(path.join(legacyRoot, 'project'), { recursive: true });
      await fs.mkdir(path.join(generatedRoot, 'recovery'), { recursive: true });
      await fs.writeFile(path.join(generatedRoot, 'recovery', 'branch.bundle'), 'bundle', 'utf8');
      await fs.writeFile(path.join(generatedRoot, 'mystery.bin'), 'unknown', 'utf8');
      const old = new Date('2026-08-01T00:00:00.000Z');
      await fs.utimes(legacyRoot, old, old);

      const runtime = {
        repositoryRoot,
        host: 'test-host',
        processIsAlive: () => false,
        now: () => new Date('2026-08-04T00:00:00.000Z'),
        deepInventory: false
      };
      const automatic = await cleanGeneratedState({ ...runtime, profile: 'automatic' });
      expect(automatic.selected).toEqual([]);
      await expect(fs.access(legacyRoot)).resolves.toBeUndefined();

      const safe = await cleanGeneratedState({ ...runtime, profile: 'safe' });
      expect(safe.selected).toEqual(['test-workspaces/engineering-compiler-upgrade-old']);
      await expect(fs.access(legacyRoot)).rejects.toThrow();
      await expect(fs.access(path.join(generatedRoot, 'recovery', 'branch.bundle'))).resolves.toBeUndefined();
      await expect(fs.access(path.join(generatedRoot, 'mystery.bin'))).resolves.toBeUndefined();

      const after = await inspectGeneratedState(runtime);
      expect(after.blockers).toEqual(expect.arrayContaining([
        'mystery.bin:unknown',
        'recovery:invalid-location'
      ]));
    });
  });

  test('expired diagnostics require explicit safe cleanup and are not automatic cache eviction', async () => {
    await withRepository(async (repositoryRoot) => {
      const generatedRoot = getGeneratedStateRoot(repositoryRoot);
      const diagnosticPath = path.join(generatedRoot, 'fence-policy.json');
      await fs.mkdir(generatedRoot, { recursive: true });
      await fs.writeFile(diagnosticPath, '{}', 'utf8');
      const old = new Date('2026-07-01T00:00:00.000Z');
      await fs.utimes(diagnosticPath, old, old);
      const runtime = {
        repositoryRoot,
        now: () => new Date('2026-08-04T00:00:00.000Z'),
        deepInventory: false
      };

      const inventory = await inspectGeneratedState(runtime);
      expect(entryByPath(inventory, 'fence-policy.json').status).toBe('expired-diagnostic');
      const automatic = await cleanGeneratedState({ ...runtime, profile: 'automatic' });
      expect(automatic.selected).toEqual([]);
      await expect(fs.access(diagnosticPath)).resolves.toBeUndefined();

      const safe = await cleanGeneratedState({ ...runtime, profile: 'safe' });
      expect(safe.selected).toEqual(['fence-policy.json']);
      await expect(fs.access(diagnosticPath)).rejects.toThrow();
    });
  });

  test('exact compatibility cleanup removes only the requested namespace', async () => {
    await withRepository(async (repositoryRoot) => {
      const generatedRoot = getGeneratedStateRoot(repositoryRoot);
      const first = path.join(generatedRoot, 'test-workspaces', 'engineering-compiler-first-old');
      const second = path.join(generatedRoot, 'test-workspaces', 'engineering-compiler-second-old');
      await fs.mkdir(first, { recursive: true });
      await fs.mkdir(second, { recursive: true });
      const old = new Date('2026-08-01T00:00:00.000Z');
      await fs.utimes(first, old, old);
      await fs.utimes(second, old, old);

      const receipt = await cleanGeneratedState({
        repositoryRoot,
        profile: 'safe',
        explicitRelativePaths: ['test-workspaces/engineering-compiler-first-old'],
        onlyExplicit: true,
        now: () => new Date('2026-08-04T00:00:00.000Z'),
        deepInventory: false
      });
      expect(receipt.selected).toEqual(['test-workspaces/engineering-compiler-first-old']);
      await expect(fs.access(first)).rejects.toThrow();
      await expect(fs.access(second)).resolves.toBeUndefined();
    });
  });

  test('all-rebuildable removes only registered caches and preserves protected state', async () => {
    await withRepository(async (repositoryRoot) => {
      const generatedRoot = getGeneratedStateRoot(repositoryRoot);
      await fs.mkdir(path.join(generatedRoot, 'typecheck'), { recursive: true });
      await fs.writeFile(path.join(generatedRoot, 'typecheck', 'tsconfig.tsbuildinfo'), 'cache', 'utf8');
      await fs.writeFile(path.join(generatedRoot, 'compiler-deps.stamp.json'), '{}', 'utf8');
      await fs.writeFile(path.join(generatedRoot, 'test-impact-cache.json'), '{}', 'utf8');
      const templateRoot = path.join(generatedRoot, 'test-workspaces', '.templates', 'locked-default');
      await fs.mkdir(templateRoot, { recursive: true });
      await fs.writeFile(path.join(templateRoot, '.template-ready'), 'ready', 'utf8');
      await fs.mkdir(path.join(generatedRoot, 'recovery'), { recursive: true });
      await fs.writeFile(path.join(generatedRoot, 'recovery', 'branch.bundle'), 'bundle', 'utf8');

      const dryRun = await cleanGeneratedState({
        repositoryRoot,
        profile: 'all-rebuildable',
        dryRun: true
      });
      expect(dryRun.status).toBe('completed');
      await expect(fs.access(path.join(generatedRoot, 'compiler-deps.stamp.json'))).resolves.toBeUndefined();

      const receipt = await cleanGeneratedState({ repositoryRoot, profile: 'all-rebuildable' });
      expect(receipt.status).toBe('completed');
      expect(receipt.selected).toEqual(expect.arrayContaining([
        'compiler-deps.stamp.json',
        'test-impact-cache.json',
        'test-workspaces/.templates/locked-default',
        'typecheck'
      ]));
      for (const target of [
        path.join(generatedRoot, 'compiler-deps.stamp.json'),
        path.join(generatedRoot, 'test-impact-cache.json'),
        path.join(generatedRoot, 'typecheck'),
        templateRoot
      ]) {
        await expect(fs.access(target)).rejects.toThrow();
      }
      await expect(fs.access(path.join(generatedRoot, 'recovery', 'branch.bundle'))).resolves.toBeUndefined();
    });
  });

  test('owner registration binds the run namespace and becomes reapable after owner death', async () => {
    await withRepository(async (repositoryRoot) => {
      const env = { SEC_TEST_WORKSPACE_NAMESPACE: 'fast-owned' };
      const owner = await registerCurrentTestProcessGeneratedState(env, {
        repositoryRoot,
        host: 'test-host',
        now: () => new Date('2026-08-04T00:00:00.000Z')
      });
      expect(owner).toMatchObject({ namespace: 'fast-owned', repositoryRoot, host: 'test-host' });
      const active = await inspectGeneratedState({
        repositoryRoot,
        host: 'test-host',
        processIsAlive: (pid) => pid === process.pid,
        deepInventory: false
      });
      expect(entryByPath(active, 'test-workspaces/fast-owned').status).toBe('active');
      const cleaned = await cleanGeneratedState({
        repositoryRoot,
        host: 'test-host',
        processIsAlive: () => false,
        profile: 'automatic',
        deepInventory: false
      });
      expect(cleaned.selected).toEqual(['test-workspaces/fast-owned']);
    });
  });

  test('typed interrupted quarantine is recovered without touching an unquarantined source', async () => {
    await withRepository(async (repositoryRoot) => {
      const generatedRoot = getGeneratedStateRoot(repositoryRoot);
      const quarantinedSource = path.join(generatedRoot, 'compiler-deps.stamp.json');
      const preservedRoot = path.join(generatedRoot, 'typecheck');
      const preservedSource = path.join(preservedRoot, 'tsconfig.tsbuildinfo');
      await fs.mkdir(preservedRoot, { recursive: true });
      await fs.writeFile(quarantinedSource, '{}', 'utf8');
      await fs.writeFile(preservedSource, 'preserved', 'utf8');

      await expect(cleanGeneratedState({
        repositoryRoot,
        host: 'test-host',
        processIsAlive: () => false,
        profile: 'all-rebuildable',
        afterQuarantineForTest: async (relativePath) => {
          if (relativePath === 'compiler-deps.stamp.json') {
            throw new Error('simulated cleanup process crash');
          }
        }
      })).rejects.toThrow('simulated cleanup process crash');

      await expect(fs.access(quarantinedSource)).rejects.toThrow();
      await expect(fs.readFile(preservedSource, 'utf8')).resolves.toBe('preserved');
      const interrupted = await inspectGeneratedState({ repositoryRoot, deepInventory: false });
      expect(interrupted.entries.some((entry) => entry.status === 'cleanup-residue')).toBe(true);

      const receipt = await cleanGeneratedState({
        repositoryRoot,
        host: 'test-host',
        processIsAlive: () => false,
        profile: 'safe',
        deepInventory: false
      });
      expect(receipt.status).toBe('completed');
      expect(receipt.attempts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          relativePath: 'compiler-deps.stamp.json',
          action: 'recovered'
        })
      ]));
      expect((await inspectGeneratedState({ repositoryRoot })).entries
        .some((entry) => entry.status === 'cleanup-residue')).toBe(false);
      await expect(fs.readFile(preservedSource, 'utf8')).resolves.toBe('preserved');
    });
  });

  test('changed-after-inventory targets are blocked and remain visible', async () => {
    await withRepository(async (repositoryRoot) => {
      const generatedRoot = getGeneratedStateRoot(repositoryRoot);
      const cacheRoot = path.join(generatedRoot, 'typecheck');
      const cachePath = path.join(cacheRoot, 'tsconfig.tsbuildinfo');
      await fs.mkdir(cacheRoot, { recursive: true });
      await fs.writeFile(cachePath, 'old-state', 'utf8');
      let changed = false;
      const receipt = await cleanGeneratedState({
        repositoryRoot,
        profile: 'all-rebuildable',
        beforeQuarantineForTest: async (relativePath) => {
          if (relativePath !== 'typecheck' || changed) return;
          changed = true;
          await fs.writeFile(cachePath, 'new-state', 'utf8');
          const changedAt = new Date('2026-08-04T02:00:00.000Z');
          await fs.utimes(cachePath, changedAt, changedAt);
        }
      });
      expect(receipt.status).toBe('blocked');
      expect(receipt.attempts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          relativePath: 'typecheck',
          action: 'protected',
          code: 'PRESTATE_CHANGED'
        })
      ]));
      await expect(fs.readFile(cachePath, 'utf8')).resolves.toBe('new-state');
    });
  });

  test('symlinked roots and descendants are never followed or deleted', async () => {
    await withRepository(async (repositoryRoot) => {
      const generatedRoot = getGeneratedStateRoot(repositoryRoot);
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-generated-state-outside-'));
      try {
        await fs.writeFile(path.join(outside, 'sentinel.txt'), 'keep', 'utf8');
        await fs.mkdir(generatedRoot, { recursive: true });
        const unknownLink = path.join(generatedRoot, 'mystery-link');
        await fs.symlink(outside, unknownLink, process.platform === 'win32' ? 'junction' : 'dir');
        const cacheRoot = path.join(generatedRoot, 'typecheck');
        await fs.mkdir(cacheRoot, { recursive: true });
        const descendantLink = path.join(cacheRoot, 'external');
        await fs.symlink(outside, descendantLink, process.platform === 'win32' ? 'junction' : 'dir');

        const inventory = await inspectGeneratedState({ repositoryRoot });
        expect(entryByPath(inventory, 'mystery-link').status).toBe('unsafe-entry');
        expect(entryByPath(inventory, 'typecheck').status).toBe('unsafe-entry');
        const receipt = await cleanGeneratedState({ repositoryRoot, profile: 'all-rebuildable' });
        expect(receipt.protected).toEqual(expect.arrayContaining(['mystery-link', 'typecheck']));
        await expect(fs.readFile(path.join(outside, 'sentinel.txt'), 'utf8')).resolves.toBe('keep');
        await expect(fs.lstat(unknownLink)).resolves.toBeDefined();
        await expect(fs.lstat(descendantLink)).resolves.toBeDefined();
      } finally {
        await fs.rm(outside, { recursive: true, force: true });
      }
    });
  });
});
