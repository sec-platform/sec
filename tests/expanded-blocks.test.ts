import test from 'node:test';
import assert from 'node:assert/strict';
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

test('expanded official block set composes and verifies as one project', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-expanded-'));

  await initWorkspace(workspaceRoot, { reset: true });
  await addBlock(workspaceRoot, 'rbac/basic');
  await addBlock(workspaceRoot, 'audit/basic');
  await addBlock(workspaceRoot, 'export/csv-basic');

  const { lock: resolvedLock } = await resolveWorkspace(workspaceRoot);
  assert.equal(resolvedLock.resolvedBlocks.length, 6);

  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);
  const { report } = await verifyWorkspace(workspaceRoot);
  assert.equal(report.summary.status, 'passed');

  const locked = await lockWorkspace(workspaceRoot);
  assert.equal(locked.passStatus.lock, 'succeeded');
  assert.ok(locked.resolvedBlocks.some((block) => block.id === 'rbac/basic'));
  assert.ok(locked.resolvedBlocks.some((block) => block.id === 'audit/basic'));
  assert.ok(locked.resolvedBlocks.some((block) => block.id === 'export/csv-basic'));
});
