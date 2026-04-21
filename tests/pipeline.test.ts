import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  initWorkspace,
  resolveWorkspace,
  composeWorkspace,
  adaptWorkspace,
  verifyWorkspace,
  lockWorkspace
} from '../platform/orchestrator.ts';

test('v0.1 pipeline runs end to end in a temporary workspace', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-'));

  await initWorkspace(workspaceRoot, { reset: true });
  const { lock: resolvedLock } = await resolveWorkspace(workspaceRoot);
  assert.equal(resolvedLock.resolvedBlocks.length, 3);
  assert.equal(resolvedLock.slotTasks.length, 1);

  await composeWorkspace(workspaceRoot);
  const skeleton = await fs.readFile(
    path.join(workspaceRoot, 'project', 'custom', 'customer_normalizer.ts'),
    'utf8'
  );
  assert.match(skeleton, /Not implemented/);

  await adaptWorkspace(workspaceRoot);
  const synthesized = await fs.readFile(
    path.join(workspaceRoot, 'project', 'custom', 'customer_normalizer.ts'),
    'utf8'
  );
  assert.match(synthesized, /normalizeCustomerInput/);
  assert.match(synthesized, /Unknown/);

  const { report } = await verifyWorkspace(workspaceRoot);
  assert.equal(report.summary.status, 'passed');

  const locked = await lockWorkspace(workspaceRoot);
  assert.equal(locked.passStatus.lock, 'succeeded');
  assert.equal(locked.passStatus.emit, 'succeeded');
});
