import { expect, test } from 'bun:test';

import { readJson } from "../../src/adapters/filesystem/files.ts";
import { resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import type { VerificationReport } from '../../src/assurance/verification/contract/types.ts';
import { verifyWorkspace } from '../../src/bootstrap/engineering/cli.ts';
import type { LockFile } from '../../src/compiler/contract.ts';
import type { PolicyReport } from '../../src/semantics/policies/types.ts';
import { prepareComposedWorkspace } from '../testkit/workspace.ts';

test('smoke: business lanes and semantic Policy authority pass together', async () => {
  const workspaceRoot = await prepareComposedWorkspace({ prefix: 'engineering-compiler-smoke-' });
  const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
  const policyReportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.policyReport);
  const verificationReportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.verificationReport);

  await verifyWorkspace(workspaceRoot, { lane: 'fast' });

  const lock = await readJson<LockFile>(lockPath);
  const policy = await readJson<PolicyReport>(policyReportPath);
  const verification = await readJson<VerificationReport>(verificationReportPath);

  expect(verification.summary.status).toBe('passed');
  expect(verification.summary.requestedLane).toBe('fast');
  expect(verification.fast.status).toBe('passed');
  expect(verification.fast.build.status).toBe('passed');
  expect(verification.fast.unit.status).toBe('passed');
  expect(verification.fast.acceptance.status).toBe('passed');
  expect(verification.runtime.acceptance.status).toBe('skipped');
  expect(verification.summary.claimSummary?.overall.overallStatus).toBe('passed');
  expect(verification.summary.claimSummary?.gates).toContainEqual(
    expect.objectContaining({
      gateId: 'product-policy-gate',
      applicability: 'required',
      status: 'passed',
      reasonCode: 'claim-observed'
    })
  );
  expect(lock.resolvedBlocks.length).toBeGreaterThan(0);
  expect(policy.violations).toHaveLength(0);
  expect(policy.evaluation?.assurance).toBe('semantic');
  expect(policy.evaluation?.unsupportedSemanticPredicates).toEqual([]);
  expect(lock.passStatus.verify).toBe('succeeded');
  expect(lock.generatedPaths.length).toBeGreaterThan(0);
}, 180000);
