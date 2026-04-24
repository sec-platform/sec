import { afterAll, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  addBlock,
  adaptWorkspace,
  composeWorkspace,
  initWorkspace,
  lockWorkspace,
  resolveWorkspace,
  verifyWorkspace
} from '../platform/orchestrator.ts';

const activeWorkspaces = new Set<string>();

afterAll(async () => {
  for (const workspace of activeWorkspaces) {
    try {
      await fs.rm(workspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

async function createWorkspace(prefix: string): Promise<string> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  activeWorkspaces.add(workspaceRoot);
  return workspaceRoot;
}

test('expanded official block set composes and verifies as one project', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-expanded-');

  await initWorkspace(workspaceRoot, { reset: true });
  await addBlock(workspaceRoot, 'rbac/basic');
  await addBlock(workspaceRoot, 'audit/basic');
  await addBlock(workspaceRoot, 'export/csv-basic');
  await addBlock(workspaceRoot, 'file/upload');
  await addBlock(workspaceRoot, 'notify/email-basic');
  await addBlock(workspaceRoot, 'table/filter-search');

  const { lock: resolvedLock } = await resolveWorkspace(workspaceRoot);
  expect(resolvedLock.resolvedBlocks.length).toBe(9);
  expect(resolvedLock.slotTasks).toHaveLength(1);

  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);
  const { report } = await verifyWorkspace(workspaceRoot);
  expect(report.summary.status).toBe('passed');

  const coverage = JSON.parse(
    await fs.readFile(path.join(workspaceRoot, 'project', 'generated', 'acceptance-coverage.json'), 'utf8')
  ) as { uncoveredBlocks: string[] };
  expect(coverage.uncoveredBlocks).not.toContain('file/upload');
  expect(coverage.uncoveredBlocks).not.toContain('notify/email-basic');
  expect(coverage.uncoveredBlocks).not.toContain('table/filter-search');

  const locked = await lockWorkspace(workspaceRoot);
  expect(locked.passStatus.lock).toBe('succeeded');
  expect(locked.resolvedBlocks.some((block) => block.id === 'rbac/basic')).toBe(true);
  expect(locked.resolvedBlocks.some((block) => block.id === 'audit/basic')).toBe(true);
  expect(locked.resolvedBlocks.some((block) => block.id === 'export/csv-basic')).toBe(true);
  expect(locked.resolvedBlocks.some((block) => block.id === 'file/upload')).toBe(true);
  expect(locked.resolvedBlocks.some((block) => block.id === 'notify/email-basic')).toBe(true);
  expect(locked.resolvedBlocks.some((block) => block.id === 'table/filter-search')).toBe(true);
});
