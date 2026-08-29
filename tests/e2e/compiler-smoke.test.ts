import { expect, test } from 'bun:test';

import { readJson } from '../../src/workspace/files.ts';
import { getWorkspacePaths } from '../../src/workspace/paths.ts';
import type { LockFile } from '../../src/compiler/contract.ts';
import type { PolicyReport } from '../../src/compiler/policies/contract/types.ts';
import type { VerificationReport } from '../../src/verification/contract/types.ts';
import { expectWorkspaceVerifies, prepareAdaptedWorkspace } from '../testkit/workspace.ts';

test('smoke: init -> resolve -> compose -> adapt -> verify --lane fast passes', async () => {
  const workspaceRoot = await prepareAdaptedWorkspace({ prefix: 'engineering-compiler-smoke-' });
  const { lockPath, policyReportPath, verificationReportPath } = getWorkspacePaths(workspaceRoot);

  await expectWorkspaceVerifies(workspaceRoot, { lane: 'fast' });

  const lock = await readJson<LockFile>(lockPath);
  const policy = await readJson<PolicyReport>(policyReportPath);
  const verification = await readJson<VerificationReport>(verificationReportPath);

  expect(verification.summary.status).toBe('passed');
  expect(verification.summary.requestedLane).toBe('fast');
  expect(verification.runtime.acceptance.status).toBe('skipped');
  expect(lock.resolvedBlocks.length).toBeGreaterThan(0);
  expect(policy.violations).toHaveLength(0);
  expect(lock.generatedPaths.length).toBeGreaterThan(0);
}, 180000);
