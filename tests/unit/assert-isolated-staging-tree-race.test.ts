import { link, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { assertIsolatedStagingTreeForTests } from '../../src/adapters/verification/assert-isolated-staging-tree.ts';
import { acquireWorkspaceWriteLease } from '../../src/adapters/filesystem/write-lease.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('isolated staging tree rejects a nested entry added after initial traversal', async () => {
  await withTempWorkspace(async (root) => {
    const stagingRoot = path.join(root, 'staging');
    const nested = path.join(stagingRoot, 'nested');
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, 'stable.txt'), 'stable', 'utf8');

    await expect(assertIsolatedStagingTreeForTests(stagingRoot, {
      afterInitialTraversal: async () => {
        await writeFile(path.join(nested, 'late.txt'), 'late', 'utf8');
      }
    })).rejects.toMatchObject({
      code: 'VERIFY-ISOLATION-001',
      message: 'Staging directory entries changed while its isolation boundary was inspected',
      details: { relativePath: 'nested' }
    });
  }, 'engineering-compiler-isolated-staging-late-entry-');
});

test('isolated staging tree rejects a same-name hardlink swap after initial traversal', async () => {
  await withTempWorkspace(async (root) => {
    const stagingRoot = path.join(root, 'staging');
    const nested = path.join(stagingRoot, 'nested');
    const victim = path.join(nested, 'victim.txt');
    const external = path.join(root, 'external.txt');
    await mkdir(nested, { recursive: true });
    await writeFile(victim, 'original', 'utf8');
    await writeFile(external, 'external', 'utf8');

    await expect(assertIsolatedStagingTreeForTests(stagingRoot, {
      afterInitialTraversal: async () => {
        await rename(victim, path.join(root, 'parked-original.txt'));
        await link(external, victim);
      }
    })).rejects.toMatchObject({
      code: 'VERIFY-ISOLATION-001',
      message: 'Staging entry identity changed while its isolation boundary was inspected',
      details: { relativePath: 'nested/victim.txt' }
    });
  }, 'engineering-compiler-isolated-staging-same-name-swap-');
});

test('isolated staging tree coordinates final revalidation with its active lease heartbeat', async () => {
  await withTempWorkspace(async (stagingRoot) => {
    await writeFile(path.join(stagingRoot, 'stable.txt'), 'stable', 'utf8');
    const lease = await acquireWorkspaceWriteLease(stagingRoot);
    let heartbeat: Promise<void> | undefined;
    try {
      await assertIsolatedStagingTreeForTests(stagingRoot, {
        workspaceWriteLease: lease.token,
        afterInitialTraversal: () => {
          heartbeat = lease.heartbeat();
        }
      });
      await heartbeat;
      await lease.assertOwned();
    } finally {
      await lease.release();
    }
  }, 'engineering-compiler-isolated-staging-lease-heartbeat-');
});

test('isolated staging tree active lease proof does not allow ordinary hard links', async () => {
  await withTempWorkspace(async (stagingRoot) => {
    const original = path.join(stagingRoot, 'original.txt');
    const alias = path.join(stagingRoot, 'alias.txt');
    await writeFile(original, 'shared bytes', 'utf8');
    await link(original, alias);
    const lease = await acquireWorkspaceWriteLease(stagingRoot);
    try {
      await expect(assertIsolatedStagingTreeForTests(stagingRoot, {
        workspaceWriteLease: lease.token,
        afterInitialTraversal: () => undefined
      })).rejects.toMatchObject({
        code: 'VERIFY-ISOLATION-001',
        message: 'Staging tree contains a hard-linked file'
      });
      await lease.assertOwned();
    } finally {
      await lease.release();
    }
  }, 'engineering-compiler-isolated-staging-lease-hardlink-');
});
