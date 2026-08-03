import { expect, test } from 'bun:test';

import {
  buildBlockedClaimSummary,
  buildClaimSummary
} from '../../platform/compiler/verify/verify-project.ts';
import type { AcceptanceCoverageReport } from '../../platform/shared/acceptance-types.ts';
import {
  buildExpectedProductPolicyGate,
  buildExpectedProductRuntimeGate
} from '../../platform/shared/product-verification-profile.ts';
import type { PolicyReport } from '../../platform/shared/policy-types.ts';
import type {
  FastVerificationLaneReport,
  RuntimeVerificationLaneReport
} from '../../platform/shared/verification-types.ts';

function policy(status: 'passed' | 'failed' | 'skipped'): PolicyReport {
  const declared = status !== 'skipped';
  const blocking = status === 'failed';
  const violation = {
    id: 'policy',
    severity: 'error' as const,
    appliesTo: ['target'],
    rule: 'rule',
    files: ['target.ts'],
    message: 'blocked',
    sourceScope: 'official' as const,
    sourcePath: 'policy.yaml'
  };
  return {
    status,
    official: {
      policies: declared ? ['policy'] : [],
      sources: declared ? [{ path: 'policy.yaml', policyIds: ['policy'] }] : [],
      violations: blocking ? [violation] : []
    },
    project: { policies: [], sources: [], violations: [] },
    merged: {
      policies: declared ? [{
        id: 'policy',
        sourceScope: 'official',
        sourcePath: 'policy.yaml',
        targets: ['target.ts']
      }] : []
    },
    violations: blocking ? [violation] : []
  };
}

function fast(status: 'passed' | 'failed' | 'skipped' = 'passed'): FastVerificationLaneReport {
  const policyReport = status === 'passed' ? policy('passed') : policy('skipped');
  return {
    status,
    build: { status: status === 'failed' ? 'passed' : status },
    unit: { status: status === 'failed' ? 'failed' : status, passed: [] },
    acceptance: {
      status: status === 'failed' ? 'skipped' : status,
      passed: [],
      failed: []
    },
    policy: { status: policyReport.status, violations: policyReport.violations },
    policyReport,
    logs: { stdout: '', stderr: status === 'failed' ? 'unit failed' : '' }
  };
}

function runtimePassed(): RuntimeVerificationLaneReport {
  return {
    status: 'passed',
    build: { status: 'passed', passed: ['next build'], failed: [], command: 'bun run build' },
    unit: {
      status: 'passed',
      passed: ['tests/runtime/unit/runtime.test.ts'],
      failed: [],
      command: 'bun run test:unit'
    },
    acceptance: {
      status: 'passed',
      passed: ['tests/runtime/acceptance/customer-flow.spec.ts'],
      failed: [],
      command: 'bun run test:acceptance'
    },
    logs: { stdout: '', stderr: '' }
  };
}

function runtimeFailed(): RuntimeVerificationLaneReport {
  return {
    status: 'failed',
    build: { status: 'passed', passed: ['next build'], failed: [], command: 'bun run build' },
    unit: {
      status: 'passed',
      passed: ['tests/runtime/unit/runtime.test.ts'],
      failed: [],
      command: 'bun run test:unit'
    },
    acceptance: {
      status: 'failed',
      passed: [],
      failed: ['tests/runtime/acceptance/customer-flow.spec.ts'],
      command: 'bun run test:acceptance'
    },
    logs: { stdout: '', stderr: 'acceptance failed' }
  };
}

function runtimeSkipped(): RuntimeVerificationLaneReport {
  return {
    status: 'skipped',
    build: { status: 'skipped', passed: [], failed: [], command: null },
    unit: { status: 'skipped', passed: [], failed: [], command: null },
    acceptance: { status: 'skipped', passed: [], failed: [], command: null },
    logs: { stdout: '', stderr: '' }
  };
}

function runtimeZeroTests(): RuntimeVerificationLaneReport {
  return {
    status: 'passed',
    build: { status: 'passed', passed: ['next build'], failed: [], command: 'bun run build' },
    unit: { status: 'passed', passed: [], failed: [], command: 'bun run test:unit' },
    acceptance: { status: 'passed', passed: [], failed: [], command: 'bun run test:acceptance' },
    logs: { stdout: '', stderr: '' }
  };
}

function coverage(complete = true): AcceptanceCoverageReport {
  return {
    formatVersion: '1',
    status: 'passed',
    acceptancePassed: complete ? ['user_can_login'] : [],
    blocks: [{
      id: 'auth/basic-session',
      declaredAcceptance: ['user_can_login'],
      coveredBy: complete ? ['user_can_login'] : [],
      uncovered: !complete
    }],
    slots: [{
      id: 'slot',
      declaredAcceptance: ['user_can_login'],
      coveredBy: complete ? ['user_can_login'] : [],
      uncovered: !complete
    }],
    uncoveredBlocks: complete ? [] : ['auth/basic-session'],
    uncoveredSlots: complete ? [] : ['slot']
  };
}

test('all-lane fast passed plus runtime skipped cannot pass', () => {
  const summary = buildClaimSummary(
    'all', fast(), runtimeSkipped(), 'full', policy('passed'), null
  );
  expect(summary.overall.overallStatus).toBe('not-run');
});

test('proven not-applicable policy remains visible but does not block overall', () => {
  const report = policy('skipped');
  const gate = buildExpectedProductPolicyGate(report);
  const summary = buildClaimSummary(
    'all', fast(), runtimePassed(), 'full', report, coverage()
  );
  expect(gate.status).toBe('not-run');
  expect(gate.applicability).toBe('not-applicable');
  expect(summary.overall.claimResults.map((entry) => entry.claimId))
    .not.toContain('product-policy-verification');
  expect(summary.overall.overallStatus).toBe('passed');
});

test('required policy pass still contributes a required claim', () => {
  const report = policy('passed');
  const summary = buildClaimSummary(
    'all', fast(), runtimePassed(), 'full', report, coverage()
  );
  expect(summary.overall.claimResults.map((entry) => entry.claimId))
    .toContain('product-policy-verification');
  expect(summary.overall.overallStatus).toBe('passed');
});

test('service-mode runtime cannot manufacture full runtime proof', () => {
  const gate = buildExpectedProductRuntimeGate(
    runtimePassed(), 'runtime', 'service', false, null
  );
  const summary = buildClaimSummary(
    'runtime', fast('skipped'), runtimePassed(), 'service', policy('skipped'), null
  );
  expect(gate.status).toBe('not-run');
  expect(gate.reasonCode).toBe('current-runner-not-owning-environment');
  expect(summary.overall.overallStatus).toBe('not-run');
});

test('full runtime with no unit or acceptance inventory is invalidated', () => {
  const runtime = runtimeZeroTests();
  const gate = buildExpectedProductRuntimeGate(runtime, 'all', 'full', false, coverage());
  const summary = buildClaimSummary(
    'all', fast(), runtime, 'full', policy('skipped'), coverage()
  );
  expect(gate.status).toBe('invalidated');
  expect(summary.overall.overallStatus).toBe('invalidated');
});

test('full runtime execution with incomplete semantic coverage is invalidated', () => {
  const gate = buildExpectedProductRuntimeGate(
    runtimePassed(), 'all', 'full', false, coverage(false)
  );
  const summary = buildClaimSummary(
    'all', fast(), runtimePassed(), 'full', policy('passed'), coverage(false)
  );
  expect(gate.status).toBe('invalidated');
  expect(gate.diagnostic).toMatch(/semantic acceptance coverage/);
  expect(summary.overall.overallStatus).toBe('invalidated');
});

test('full runtime with executed tests and complete coverage passes', () => {
  const gate = buildExpectedProductRuntimeGate(
    runtimePassed(), 'all', 'full', false, coverage()
  );
  const summary = buildClaimSummary(
    'all', fast(), runtimePassed(), 'full', policy('passed'), coverage()
  );
  expect(gate.status).toBe('passed');
  expect(summary.overall.overallStatus).toBe('passed');
});

test('fast or runtime failures remain failed', () => {
  expect(buildClaimSummary(
    'all', fast('failed'), runtimeSkipped(), 'full', policy('skipped'), null
  ).overall.overallStatus).toBe('failed');
  expect(buildClaimSummary(
    'all', fast(), runtimeFailed(), 'full', policy('passed'), coverage(false)
  ).overall.overallStatus).toBe('failed');
});

test('blocked snapshots preserve explicit not-run prerequisite truth', () => {
  const summary = buildBlockedClaimSummary('all');
  expect(summary.overall.overallStatus).not.toBe('passed');
  for (const gate of summary.gates) {
    expect(gate.status).toBe('not-run');
    expect(gate.reasonCode).toBe('fail-fast-prerequisite-failed');
  }
});

test('fast-only verification excludes runtime claim', () => {
  const summary = buildClaimSummary(
    'fast', fast(), runtimeSkipped(), 'service', policy('passed'), null
  );
  const claims = summary.overall.claimResults.map((entry) => entry.claimId);
  expect(claims).toContain('product-fast-verification');
  expect(claims).toContain('product-policy-verification');
  expect(claims).not.toContain('product-runtime-verification');
  expect(summary.overall.overallStatus).toBe('passed');
});
