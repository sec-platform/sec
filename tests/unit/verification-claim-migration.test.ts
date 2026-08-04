import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { buildPolicyClaimGate } from '../../platform/compiler/verify/run-policy-gate.ts';
import { buildRuntimeClaimGate } from '../../platform/compiler/verify/run-runtime-verification.ts';
import {
  buildBlockedClaimSummary,
  buildClaimSummary
} from '../../platform/compiler/verify/verify-project.ts';
import type { PolicyReport } from '../../platform/shared/policy-types.ts';
import {
  buildProductVerificationClaimPlan,
  projectProductVerificationGateClaim,
  projectProductVerificationGateOrder,
  type ProductVerificationGateKind
} from '../../platform/shared/product-verification-claim-plan.ts';
import { CodexDevelopmentAggregateVerificationClaimsV1 } from '../../platform/shared/verification-result-contract.ts';
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

function productBinding(gate: ProductVerificationGateKind, supportsClaim: boolean = true) {
  return projectProductVerificationGateClaim(gate, supportsClaim);
}

test('product verification identifiers and lane plans have one exact shared owner', () => {
  const owningEnvironments = [`${process.platform}-${process.arch}`];
  const fast = productBinding('fast');
  const runtime = productBinding('runtime');
  const policy = productBinding('policy');
  expect([
    fast.gateId,
    runtime.gateId,
    policy.gateId,
    fast.requiredForClaims[0],
    runtime.requiredForClaims[0],
    policy.requiredForClaims[0]
  ]).toEqual([
    'product-fast-lane',
    'product-runtime-lane',
    'product-policy-gate',
    'product-fast-verification',
    'product-runtime-verification',
    'product-policy-verification'
  ]);
  expect(buildProductVerificationClaimPlan('fast')).toEqual([
    {
      claimId: fast.requiredForClaims[0],
      requiredGateIds: [fast.gateId],
      owningEnvironments
    },
    {
      claimId: policy.requiredForClaims[0],
      requiredGateIds: [policy.gateId],
      owningEnvironments
    }
  ]);
  expect(buildProductVerificationClaimPlan('runtime')).toEqual([
    {
      claimId: runtime.requiredForClaims[0],
      requiredGateIds: [runtime.gateId],
      owningEnvironments
    }
  ]);
  expect(buildProductVerificationClaimPlan('all')).toEqual([
    {
      claimId: fast.requiredForClaims[0],
      requiredGateIds: [fast.gateId],
      owningEnvironments
    },
    {
      claimId: policy.requiredForClaims[0],
      requiredGateIds: [policy.gateId],
      owningEnvironments
    },
    {
      claimId: runtime.requiredForClaims[0],
      requiredGateIds: [runtime.gateId],
      owningEnvironments
    }
  ]);

  const first = buildProductVerificationClaimPlan('all');
  const second = buildProductVerificationClaimPlan('all');
  first[0]!.requiredGateIds.push('forged-gate');
  first[0]!.owningEnvironments.push('forged-environment');
  expect(second).toEqual(buildProductVerificationClaimPlan('all'));

  const mutableProjection = productBinding('fast');
  mutableProjection.requiredForClaims.push('forged-claim');
  mutableProjection.supportedClaims.length = 0;
  expect(productBinding('fast')).toEqual(fast);
});

test('product gate order projection is canonical and returns an isolated fresh array', () => {
  const first = projectProductVerificationGateOrder();
  expect(first).toEqual(['fast', 'runtime', 'policy']);

  first.reverse();
  expect(projectProductVerificationGateOrder()).toEqual(['fast', 'runtime', 'policy']);
});

test('owned production consumers use binding projections without local pairing authority', () => {
  const fast = productBinding('fast');
  const runtime = productBinding('runtime');
  const policy = productBinding('policy');
  const identities = [
    fast.gateId,
    runtime.gateId,
    policy.gateId,
    fast.requiredForClaims[0]!,
    runtime.requiredForClaims[0]!,
    policy.requiredForClaims[0]!
  ];
  const ownerSource = readFileSync(
    new URL('../../platform/shared/product-verification-claim-plan.ts', import.meta.url),
    'utf8'
  );
  const consumerSources = [
    '../../platform/shared/verification-result-contract.ts',
    '../../platform/shared/verification-artifact-contract.ts',
    '../../platform/compiler/verify/verify-project.ts',
    '../../platform/compiler/verify/run-runtime-verification.ts',
    '../../platform/compiler/verify/run-policy-gate.ts',
    '../../platform/compiler/verify/run-semantic-mutation-isolated-child.ts'
  ].map((relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8'));

  for (const identity of identities) {
    expect(ownerSource.split(identity)).toHaveLength(2);
    for (const consumerSource of consumerSources) {
      expect(consumerSource).not.toContain(`'${identity}'`);
      expect(consumerSource).not.toContain(`\"${identity}\"`);
    }
  }

  const producerSources = [
    '../../platform/compiler/verify/verify-project.ts',
    '../../platform/compiler/verify/run-runtime-verification.ts',
    '../../platform/compiler/verify/run-policy-gate.ts'
  ].map((relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
  for (const producerSource of producerSources) {
    expect(producerSource).toContain('projectProductVerificationGateClaim');
    expect(producerSource).not.toMatch(/requiredForClaims:\s*\[/u);
    expect(producerSource).not.toMatch(/supportedClaims:\s*\[/u);
  }
});

test('normal and blocked summaries are byte-equivalent to the canonical plan writer', () => {
  const fast = createPassedFastLane();
  const runtime = createPassedRuntimeLane();
  const policy = createPassedPolicyReport();

  for (const lane of ['fast', 'runtime', 'all'] as const) {
    const normal = buildClaimSummary(lane, fast, runtime, 'full', policy);
    const expectedNormal = CodexDevelopmentAggregateVerificationClaimsV1({
      claims: buildProductVerificationClaimPlan(lane),
      gateResults: normal.gates
    });
    expect(JSON.stringify(normal.overall)).toBe(JSON.stringify(expectedNormal));

    const blocked = buildBlockedClaimSummary(lane);
    const expectedBlocked = CodexDevelopmentAggregateVerificationClaimsV1({
      claims: buildProductVerificationClaimPlan(lane),
      gateResults: blocked.gates
    });
    expect(JSON.stringify(blocked.overall)).toBe(JSON.stringify(expectedBlocked));
  }
});

test('normal and blocked summaries serialize the literal canonical product gate order', () => {
  const expectedGateIds = [
    'product-fast-lane',
    'product-runtime-lane',
    'product-policy-gate'
  ];
  const normal = buildClaimSummary(
    'all',
    createPassedFastLane(),
    createPassedRuntimeLane(),
    'full',
    createPassedPolicyReport()
  );
  const blocked = buildBlockedClaimSummary('all');

  expect(normal.gates.map((gate) => gate.gateId)).toEqual(expectedGateIds);
  expect(blocked.gates.map((gate) => gate.gateId)).toEqual(expectedGateIds);
});

test('runtime and policy gate builders use canonical identities and claim links', () => {
  const runtimeGate = buildRuntimeClaimGate(createPassedRuntimeLane(), 'all', 'full');
  const policyGate = buildPolicyClaimGate(createPassedPolicyReport(), 'all');
  const runtime = productBinding('runtime');
  const policy = productBinding('policy');

  expect(runtimeGate).toMatchObject(runtime);
  expect(policyGate).toMatchObject(policy);
});

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
