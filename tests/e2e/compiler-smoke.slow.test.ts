import { expect, test } from 'bun:test';

import {
  adaptWorkspace,
  composeWorkspace,
  initWorkspace,
  resolveWorkspace,
  verifyWorkspace
} from '../../platform/orchestrator.ts';
import { readJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import type { LockFile, PolicyReport, VerificationReport } from '../../platform/shared/types.ts';
import { createWorkspace } from '../helpers/workspace-fixtures.ts';

test('smoke: init -> resolve -> compose -> adapt -> verify --lane fast passes', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-smoke-');
  const { lockPath, policyReportPath, verificationReportPath } = getWorkspacePaths(workspaceRoot);

  await initWorkspace(workspaceRoot, { reset: true });
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);
  await verifyWorkspace(workspaceRoot);

  const lock = await readJson<LockFile>(lockPath);
  const policy = await readJson<PolicyReport>(policyReportPath);
  const verification = await readJson<VerificationReport>(verificationReportPath);

  expect(verification.summary.status).toBe('passed');
  expect(lock.resolvedBlocks.length).toBeGreaterThan(0);
  expect(policy.violations).toHaveLength(0);
  expect(lock.generatedPaths.length).toBeGreaterThan(0);
}, 180000);
