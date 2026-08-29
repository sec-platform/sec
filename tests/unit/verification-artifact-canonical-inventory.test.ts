import { expect, test } from 'bun:test';

import { publishVerificationArtifactSet } from '../../src/compiler/verify/verification-artifact-publication.ts';
import { buildBlockedProductVerificationClaimSummary } from '../../src/verification/profile/contract/product.ts';
import { readOptionalCanonicalVerificationArtifactSet } from '../../src/verification/artifact/runtime/authority.ts';
import { isCanonicalVerificationArtifactSet } from '../../src/verification/artifact/contract/artifact.ts';
import { buildReviewLock } from '../helpers/review-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';
import { productVerificationObservationsFixture } from '../helpers/verification-fixtures.ts';

function skippedPolicyReport() {
  return {
    status: 'skipped' as const,
    official: { policies: [], sources: [], violations: [] },
    project: { policies: [], sources: [], violations: [] },
    merged: { policies: [] },
    violations: [],
    diagnostics: []
  };
}

function skippedRuntimeStep() {
  return {
    status: 'skipped' as const,
    passed: [] as string[],
    failed: [] as string[],
    command: null as string | null
  };
}

function blockedArtifactSet() {
  const policyReport = skippedPolicyReport();
  const fast = {
    status: 'failed' as const,
    build: { status: 'skipped' as const },
    unit: { status: 'skipped' as const, passed: [] as string[] },
    acceptance: {
      status: 'skipped' as const,
      passed: [] as string[],
      failed: [] as string[]
    },
    policy: { status: 'skipped' as const, violations: [] },
    policyReport,
    logs: { stdout: '', stderr: '' }
  };
  const runtime = {
    status: 'skipped' as const,
    build: skippedRuntimeStep(),
    unit: skippedRuntimeStep(),
    acceptance: skippedRuntimeStep(),
    logs: { stdout: '', stderr: '' }
  };
  const acceptanceCoverage = {
    formatVersion: '1' as const,
    status: 'skipped' as const,
    acceptancePassed: [] as string[],
    blocks: [],
    slots: [],
    uncoveredBlocks: [] as string[],
    uncoveredSlots: [] as string[]
  };

  return {
    verificationReport: {
      build: fast.build,
      unit: fast.unit,
      acceptance: fast.acceptance,
      policy: fast.policy,
      fast,
      runtime,
      summary: {
        status: 'failed' as const,
        requestedLane: 'all' as const,
        failedLanes: ['fast' as const],
        claimSummary: buildBlockedProductVerificationClaimSummary(
          'all',
          productVerificationObservationsFixture()
        )
      },
      logs: { stdout: '', stderr: '' }
    },
    runtimeReport: runtime,
    policyReport,
    acceptanceCoverage
  };
}

test('Verification artifact accepts the canonical blocked inventory projection', () => {
  expect(isCanonicalVerificationArtifactSet(blockedArtifactSet())).toBe(true);
});

test('Verification artifact publisher bytes round-trip through the canonical reader', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const artifacts = blockedArtifactSet();
    await publishVerificationArtifactSet({
      workspaceRoot,
      lock: buildReviewLock({ passStatus: { verify: 'failed' } }),
      artifacts
    });

    expect(readOptionalCanonicalVerificationArtifactSet(workspaceRoot)).toEqual(artifacts);
  });
});

test('Verification artifact rejects duplicate, blank and noncanonical fast inventories', () => {
  for (const inventory of [
    ['unit/z.test.ts', 'unit/a.test.ts'],
    ['unit/a.test.ts', 'unit/a.test.ts'],
    ['']
  ]) {
    const candidate = blockedArtifactSet();
    candidate.verificationReport.fast.unit.passed = inventory;
    candidate.verificationReport.unit.passed = inventory;
    expect(isCanonicalVerificationArtifactSet(candidate)).toBe(false);
  }
});

test('Verification artifact rejects duplicate and noncanonical runtime inventories', () => {
  for (const inventory of [
    ['tests/runtime/z.test.ts', 'tests/runtime/a.test.ts'],
    ['tests/runtime/a.test.ts', 'tests/runtime/a.test.ts']
  ]) {
    const candidate = blockedArtifactSet();
    candidate.verificationReport.runtime.unit.passed = inventory;
    candidate.runtimeReport.unit.passed = inventory;
    expect(isCanonicalVerificationArtifactSet(candidate)).toBe(false);
  }
});
