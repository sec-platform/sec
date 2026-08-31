import { expect, test } from 'bun:test';

import type { LockFile } from '../../src/compiler/contract.ts';
import type { PolicyReport } from '../../src/compiler/policies/contract/types.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import type { VerificationReport } from '../../src/verification/contract/types.ts';
import { readJson } from '../../src/workspace/files.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from '../../src/workspace/paths.ts';
import { expectWorkspaceVerifies, prepareAdaptedWorkspace } from '../testkit/workspace.ts';

test('smoke: init -> resolve -> compose -> adapt -> verify --lane fast passes', async () => {
  const workspaceRoot = await prepareAdaptedWorkspace({ prefix: 'engineering-compiler-smoke-' });
  const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
  const policyReportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.policyReport);
  const verificationReportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.verificationReport);

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
