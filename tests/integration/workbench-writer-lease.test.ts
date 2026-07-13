import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { startWorkbenchServer } from '../../platform/orchestrator/workbench-server.ts';
import { getWorkspacePaths, sourceSlotsRelativePath } from '../../platform/shared/paths.ts';
import { acquireWorkspaceWriteLease } from '../../platform/shared/workspace-write-lease.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

async function pathExists(targetPath: string): Promise<boolean> {
  return fs.access(targetPath).then(() => true).catch(() => false);
}

async function withBusyWorkbench(
  workspaceRoot: string,
  run: (baseUrl: string) => Promise<void>
): Promise<void> {
  const lease = await acquireWorkspaceWriteLease(workspaceRoot);
  let server: Awaited<ReturnType<typeof startWorkbenchServer>> | undefined;
  try {
    server = await startWorkbenchServer(workspaceRoot, 0);
    await run(`http://127.0.0.1:${server.port ?? 0}`);
  } finally {
    server?.stop(true);
    await lease.release();
  }
}

test('POST /api/bootstrap-slot returns writer-busy without writing while the workspace lease is held', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const targetPath = path.join(workspaceRoot, sourceSlotsRelativePath, 'busy_slot.ts');

    await withBusyWorkbench(workspaceRoot, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/bootstrap-slot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId: 'busy_slot', block: 'test/block' })
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'Workspace writer is busy' });
      expect(await pathExists(targetPath)).toBe(false);
    });
  }, 'engineering-compiler-workbench-bootstrap-lease-');
});

test('POST /api/mutations returns writer-busy without writing while the workspace lease is held', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const targetPath = path.join(getWorkspacePaths(workspaceRoot).sourceViewMutationsRoot, 'graph-action.json');

    await withBusyWorkbench(workspaceRoot, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/mutations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formatVersion: '1',
          mutations: [{ id: 'busy-mutation', kind: 'add-block', blockId: 'test-block', version: '1.0.0' }]
        })
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'Workspace writer is busy' });
      expect(await pathExists(targetPath)).toBe(false);
    });
  }, 'engineering-compiler-workbench-mutation-lease-');
});
