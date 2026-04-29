import { expect, test } from 'vitest';

import {
  adaptWorkspace,
  composeWorkspace,
  initWorkspace,
  lockWorkspace,
  resolveWorkspace,
  verifyWorkspace
} from '../../platform/orchestrator.ts';
import { createWorkspace } from '../helpers/test-utils.ts';

test('fast lane alone does not unlock the workspace', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-fast-lane-');

  await initWorkspace(workspaceRoot, { reset: true });
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);

  const { report } = await verifyWorkspace(workspaceRoot, { lane: 'fast' });
  expect(report.summary.status).toBe('passed');
  expect(report.summary.requestedLane).toBe('fast');
  expect(report.runtime.status).toBe('passed');
  expect(report.runtime.build.status).toBe('skipped');
  expect(report.runtime.unit.status).toBe('passed');
  expect(report.runtime.acceptance.status).toBe('skipped');

  await expect(lockWorkspace(workspaceRoot)).rejects.toThrow();
});

test('runtime lane runs generated service tests without full browser acceptance', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-runtime-service-lane-');

  await initWorkspace(workspaceRoot, { reset: true });
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);

  const { report } = await verifyWorkspace(workspaceRoot, { lane: 'runtime' });
  expect(report.summary.status).toBe('passed');
  expect(report.summary.requestedLane).toBe('runtime');
  expect(report.fast.status).toBe('skipped');
  expect(report.runtime.status).toBe('passed');
  expect(report.runtime.build.status).toBe('skipped');
  expect(report.runtime.unit.status).toBe('passed');
  expect(report.runtime.acceptance.status).toBe('skipped');
});
