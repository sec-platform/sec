import { expect, test } from 'bun:test';

import { buildPolicyClaimGate } from '../../platform/compiler/verify/run-policy-gate.ts';
import { buildRuntimeClaimGate } from '../../platform/compiler/verify/run-runtime-verification.ts';
import {
  buildBlockedClaimSummary,
  buildClaimSummary
} from '../../platform/compiler/verify/verify-project.ts';
import type { PolicyReport } from '../../platform/shared/policy-types.ts';
import type {
  FastVerificationLaneReport,
  RuntimeVerificationLaneReport
} from '../../platform/shared/verification-types.ts';

function createPassedFastLane(): FastVerificationLaneReport {
  return {
    status: 'passed',
    build: { status: 'passed' },
    unit: { status: 'passed', passed: [] },
    acceptance: { status: 'passed', passed: [], failed: [] },
    policy: { status: 'passed', violations: [] },
    logs: { stdout: '', stderr: '' }
  };
}

function createFailedFastLane(): FastVerificationLaneReport {
  return {
    status: 'failed',
    build: { status: 'passed' },
    unit: { status: 'failed', passed: [] },
    acceptance: { status: 'skipped', passed: [], failed: [] },
    policy: { status: 'skipped', violations: [] },
    logs: { stdout: '', stderr: 'unit failed' }
  };
}

function createSkippedFastLane(): FastVerificationLaneReport {
  return {
    status: 'skipped',
    build: { status: 'skipped' },
    unit: { status: 'skipped', passed: [] },
    acceptance: { status: 'skipped', passed: [], failed: [] },
    policy: { status: 'skipped', violations: [] },
    logs: { stdout: '', stderr: '' }
  };
}

function createPassedRuntimeLane(): RuntimeVerificationLaneReport {
  return {
    status: 'passed',
    build: { status: 'passed', passed: ['next build'], failed: [], command: 'bun run build' },
    unit: { status: 'passed', passed: ['unit'], failed: [], command: 'bun run test:unit' },
    acceptance: { status: 'passed', passed: ['acceptance'], failed: [], command: 'bun run test:acceptance' },
    logs: { stdout: '', stderr: '' }
  };
}

function createFailedRuntimeLane(): RuntimeVerificationLaneReport {
  return {
    status: 'failed',
    build: { status: 'passed', passed: ['next build'], failed: [], command: 'bun run build' },
    unit: { status: 'passed', passed: ['unit'], failed: [], command: 'bun run test:unit' },
    acceptance: { status: 'failed', passed: [], failed: ['acceptance'], command: 'bun run test:acceptance' },
    logs: { stdout: '', stderr: 'acceptance failed' }
  };
}

function createSkippedRuntimeLane(): RuntimeVerificationLaneReport {
  return {
    status: 'skipped',
    build: { status: 'skipped', passed: [], failed: [], command: 'bun run build' },
    unit: { status: 'skipped', passed: [], failed: [], command: 'bun run test:unit' },
    acceptance: { status: 'skipped', passed: [], failed: [], command: 'bun run test:acceptance' },
    logs: { stdout: '', stderr: '' }
  };
}

function createSkippedPolicyReport(): PolicyReport {
  return {
    status: 'skipped',
    official: { policies: [], sources: [], violations: [] },
    project: { policies: [], sources: [], violations: [] },
    merged: { policies: [] },
    violations: []
  };
}

function createPassedPolicyReport(): PolicyReport {
  return {
    status: 'passed',
    official: { policies: [], sources: [], violations: [] },
    project: { policies: [], sources: [], violations: [] },
    merged: { policies: [] },
    violations: []
  };
}

// ---------------------------------------------------------------------------
// Regression 1: all-lane fast-passed + runtime-skipped → overall NOT passed
// ---------------------------------------------------------------------------

test('regression 1: all-lane fast-passed + runtime-skipped no longer yields overall passed', () => {
  const fast = createPassedFastLane();
  const runtime = createSkippedRuntimeLane();
  const policy = createPassedPolicyReport();
  const summary = buildClaimSummary('all', fast, runtime, 'full', policy);

  // The legacy code would return 'passed' because runtime.status === 'skipped'
  // was silently ignored. Now the claim aggregator must NOT return 'passed'.
  expect(summary.overall.overallStatus).not.toBe('passed');
  // Runtime was skipped (fastFailed=false but runtime didn't run) → not-run
  expect(summary.overall.overallStatus).toBe('not-run');
  // Legacy status must derive from the unified status
  const legacyStatus = summary.overall.overallStatus === 'passed' ? 'passed' : 'failed';
  expect(legacyStatus).toBe('failed');
});

// ---------------------------------------------------------------------------
// Regression 2: policy skipped with no policies → not-run, NOT passed
// ---------------------------------------------------------------------------

test('regression 2: policy skipped with no policies yields not-run not passed', () => {
  const policyReport = createSkippedPolicyReport();
  const gate = buildPolicyClaimGate(policyReport, 'all');

  expect(gate.status).toBe('not-run');
  expect(gate.reasonCode).toBe('not-applicable');
  expect(gate.applicability).toBe('not-applicable');
  expect(gate.status).not.toBe('passed');
});

test('regression 2b: all-lane with skipped policy → overall not-run (not silently passed)', () => {
  const fast = createPassedFastLane();
  const runtime = createPassedRuntimeLane();
  const policy = createSkippedPolicyReport();
  const summary = buildClaimSummary('all', fast, runtime, 'full', policy);

  // Policy is not-applicable → its claim is not-run → overall is not-run
  expect(summary.overall.overallStatus).not.toBe('passed');
});

// ---------------------------------------------------------------------------
// Regression 3: service mode without acceptance → not-run
// ---------------------------------------------------------------------------

test('regression 3: service-mode runtime passed → not-run with current-runner-not-owning-environment', () => {
  const runtime = createPassedRuntimeLane();
  const gate = buildRuntimeClaimGate(runtime, 'runtime', 'service');

  expect(gate.status).toBe('not-run');
  expect(gate.reasonCode).toBe('current-runner-not-owning-environment');
  expect(gate.status).not.toBe('passed');
});

test('regression 3b: full-mode runtime passed → passed (service mode is the only special case)', () => {
  const runtime = createPassedRuntimeLane();
  const gate = buildRuntimeClaimGate(runtime, 'all', 'full');

  expect(gate.status).toBe('passed');
  expect(gate.reasonCode).toBe('executed-success');
});

test('regression 3c: runtime lane only with service mode → overall not-run', () => {
  const fast = createSkippedFastLane();
  const runtime = createPassedRuntimeLane();
  const policy = createSkippedPolicyReport();
  const summary = buildClaimSummary('runtime', fast, runtime, 'service', policy);

  // Runtime claim is required but service-mode → not-run → overall not-run
  expect(summary.overall.overallStatus).toBe('not-run');
  expect(summary.overall.overallStatus).not.toBe('passed');
});

// ---------------------------------------------------------------------------
// Regression 4: drift failure (blocked snapshot) → failed claims, not mixed
// ---------------------------------------------------------------------------

test('regression 4: drift failure yields not-run claims (not silently passed)', () => {
  const summary = buildBlockedClaimSummary('all');

  // All gates are not-run with fail-fast-prerequisite-failed
  for (const gate of summary.gates) {
    expect(gate.status).toBe('not-run');
    expect(gate.reasonCode).toBe('fail-fast-prerequisite-failed');
  }
  // Overall must NOT be passed
  expect(summary.overall.overallStatus).not.toBe('passed');
  // Legacy status would be 'failed'
  const legacyStatus = summary.overall.overallStatus === 'passed' ? 'passed' : 'failed';
  expect(legacyStatus).toBe('failed');
});

test('regression 4b: blocked snapshot for fast lane only → fast claim not-run', () => {
  const summary = buildBlockedClaimSummary('fast');

  // Only fast and policy claims are included
  const claimIds = summary.overall.claimResults.map((c) => c.claimId);
  expect(claimIds).toContain('product-fast-verification');
  expect(claimIds).toContain('product-policy-verification');
  expect(claimIds).not.toContain('product-runtime-verification');

  // All claims are not-run
  for (const claim of summary.overall.claimResults) {
    expect(claim.status).toBe('not-run');
  }
  expect(summary.overall.overallStatus).not.toBe('passed');
});

// ---------------------------------------------------------------------------
// Regression 5: all-lane all-passed → overall passed (positive case)
// ---------------------------------------------------------------------------

test('regression 5: all-lane fast+runtime+policy all passed → overall passed', () => {
  const fast = createPassedFastLane();
  const runtime = createPassedRuntimeLane();
  const policy = createPassedPolicyReport();
  const summary = buildClaimSummary('all', fast, runtime, 'full', policy);

  expect(summary.overall.overallStatus).toBe('passed');
});

// ---------------------------------------------------------------------------
// Regression 6: fast failed → runtime skipped, overall not passed
// ---------------------------------------------------------------------------

test('regression 6: fast failed → overall failed (not silently passed)', () => {
  const fast = createFailedFastLane();
  const runtime = createSkippedRuntimeLane();
  const policy = createSkippedPolicyReport();
  const summary = buildClaimSummary('all', fast, runtime, 'full', policy);

  expect(summary.overall.overallStatus).not.toBe('passed');
  // Fast gate failed → fast claim failed → overall failed
  const fastClaim = summary.overall.claimResults.find((c) => c.claimId === 'product-fast-verification');
  expect(fastClaim?.status).toBe('failed');
});

// ---------------------------------------------------------------------------
// Regression 7: fast lane only → runtime not included in claims
// ---------------------------------------------------------------------------

test('regression 7: fast lane only → runtime claim not included', () => {
  const fast = createPassedFastLane();
  const runtime = createSkippedRuntimeLane();
  const policy = createPassedPolicyReport();
  const summary = buildClaimSummary('fast', fast, runtime, 'service', policy);

  const claimIds = summary.overall.claimResults.map((c) => c.claimId);
  expect(claimIds).toContain('product-fast-verification');
  expect(claimIds).toContain('product-policy-verification');
  expect(claimIds).not.toContain('product-runtime-verification');

  // Fast and policy passed → overall passed (runtime not required)
  expect(summary.overall.overallStatus).toBe('passed');
});

// ---------------------------------------------------------------------------
// Regression 8: runtime failed in full mode → overall failed
// ---------------------------------------------------------------------------

test('regression 8: runtime failed in full mode → overall failed', () => {
  const fast = createPassedFastLane();
  const runtime = createFailedRuntimeLane();
  const policy = createPassedPolicyReport();
  const summary = buildClaimSummary('all', fast, runtime, 'full', policy);

  expect(summary.overall.overallStatus).toBe('failed');
  const runtimeClaim = summary.overall.claimResults.find((c) => c.claimId === 'product-runtime-verification');
  expect(runtimeClaim?.status).toBe('failed');
});
