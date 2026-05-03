import { expect, test } from 'bun:test';

import { lockWorkspace, verifyWorkspace } from '../../platform/orchestrator.ts';
import { prepareAdaptedWorkspace } from '../helpers/workspace-fixtures.ts';

test('fast lane alone does not unlock the workspace', async () => {
  const workspaceRoot = await prepareAdaptedWorkspace({ prefix: 'engineering-compiler-fast-lane-' });

  const { report } = await verifyWorkspace(workspaceRoot, { lane: 'fast' });
  expect(report.summary.status).toBe('passed');
  expect(report.summary.requestedLane).toBe('fast');
  expect(report.runtime.status).toBe('passed');
  expect(report.runtime.build.status).toBe('skipped');
  expect(report.runtime.unit.status).toBe('passed');
  expect(report.runtime.acceptance.status).toBe('skipped');

  await expect(lockWorkspace(workspaceRoot)).rejects.toThrow();
}, 180000);
test('runtime lane runs generated service tests without full browser acceptance', async () => {
  const workspaceRoot = await prepareAdaptedWorkspace({ prefix: 'engineering-compiler-runtime-service-lane-' });

  const { report } = await verifyWorkspace(workspaceRoot, { lane: 'runtime' });
  expect(report.summary.status).toBe('passed');
  expect(report.summary.requestedLane).toBe('runtime');
  expect(report.fast.status).toBe('skipped');
  expect(report.runtime.status).toBe('passed');
  expect(report.runtime.build.status).toBe('skipped');
  expect(report.runtime.unit.status).toBe('passed');
  expect(report.runtime.acceptance.status).toBe('skipped');
}, 180000);
