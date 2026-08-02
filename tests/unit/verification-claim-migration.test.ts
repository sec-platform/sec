import { expect, test } from 'bun:test';

import {
  buildBlockedClaimSummary,
  buildClaimSummary
} from '../../platform/compiler/verify/verify-project.ts';
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
  return {
    status,
    official: { policies: [], sources: [], violations: [] },
    project: { policies: [], sources: [], violations: [] },
    merged: { policies: [] },
    violations: []
  };
}

function fast(status: 'passed' | 'failed' | 'skipped' = 'passed'): FastVerificationLaneReport {
  return {
    status,
    build: { status: status === 'failed' ? 'passed' : status },
    unit: { status: status === 'failed' ? 'failed' : status, passed: [] },
    acceptance: {
      status: status === 'failed' ? 'skipped' : status,
      passed: [],
      failed: []
    },
    policy: { status: status === 'passed' ? 'passed' : 'skipped', violations: [] },
    logs: { stdout: '', stderr: status === 'failed' ? 'unit failed' : '' }
  };
}

function runtimePassed(): RuntimeVerificationLaneReport {
  return {
    status: 'passed',
    build: { status: 'passed', passed: ['next build'], failed: [], command: 'bun run build' },
    unit: { status: 'passed', passed: ['runtime-unit'], failed: [], command: 'bun run test:unit' },
    acceptance: {
      status: 'passed',
      passed: ['runtime-acceptance'],
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
    unit: { status: 'passed', passed: ['runtime-unit'], failed: [], command: 'bun run test:unit' },
    acceptance: {
      status: 'failed',
      passed: [],
      failed: ['runtime-acceptance'],
      command: 'bun run test:acceptance'
    },
    logs: { stdout: '', stderr: 'acceptance failed' }
  };
}

function runtimeSkipped(): RuntimeVerificationLaneReport {
  return {
    status: 'skipped',
    build: { status: 'skipped', passed: [], failed: [], command: 'bun run build' },
    unit: { status: 'skipped', passed: [], failed: [], command: 'bun run test:unit' },
    acceptance: {
      status: 'skipped',
      passed: [],
      failed: [],
      command: 'bun run test:acceptance'
    },
    logs: { stdout: '', stderr: '' }
  };
}

function runtimeZeroTests(): RuntimeVerificationLaneReport {
  return {
    status: 'passed',
    build: { status: 'passed', passed: ['next build'], failed: [], command: 'bun run build' },
    unit: { status: 'skipped', passed: [], failed: [], command: 'bun run test:unit' },
    acceptance: {
      status: 'passed',
      passed: [],
      failed: [],
      command: 'bun run test:acceptance'
    },
    logs: { stdout: '', stderr: '' }
  };
}

test('all-lane fast passed plus runtime skipped cannot pass', () => {
  const summary = buildClaimSummary('all', fast(), runtimeSkipped(), 'full', policy('passed'));
  expect(summary.overall.overallStatus).toBe('not-run');
});

test('proven not-applicable policy remains visible but does not block overall', () => {
  const report = policy('skipped');
  const gate = buildExpectedProductPolicyGate(report);
  const summary = buildClaimSummary('all', fast(), runtimePassed(), 'full', report);

  expect(gate.status).toBe('not-run');
  expect(gate.applicability).toBe('not-applicable');
  expect(gate.reasonCode).toBe('not-applicable');
  expect(summary.gates.find((entry) => entry.gateId === 'product-policy-gate')).toEqual(gate);
  expect(summary.overall.claimResults.map((entry) => entry.claimId))
    .not.toContain('product-policy-verification');
  expect(summary.overall.overallStatus).toBe('passed');
});

test('required policy pass still contributes a required claim', () => {
  const report = policy('passed');
  const summary = buildClaimSummary('all', fast(), runtimePassed(), 'full', report);
  expect(summary.overall.claimResults.map((entry) => entry.claimId))
    .toContain('product-policy-verification');
  expect(summary.overall.overallStatus).toBe('passed');
});

test('service-mode runtime cannot manufacture full runtime proof', () => {
  const gate = buildExpectedProductRuntimeGate(runtimePassed(), 'runtime', 'service', false);
  const summary = buildClaimSummary(
    'runtime',
    fast('skipped'),
    runtimePassed(),
    'service',
    policy('skipped')
  );
  expect(gate.status).toBe('not-run');
  expect(gate.reasonCode).toBe('current-runner-not-owning-environment');
  expect(summary.overall.overallStatus).toBe('not-run');
});

test('full runtime with no unit or acceptance inventory is invalidated', () => {
  const runtime = runtimeZeroTests();
  const gate = buildExpectedProductRuntimeGate(runtime, 'all', 'full', false);
  const summary = buildClaimSummary('all', fast(), runtime, 'full', policy('skipped'));

  expect(gate.status).toBe('invalidated');
  expect(gate.reasonCode).toBe('selection-unresolved');
  expect(summary.overall.overallStatus).toBe('invalidated');
  expect(summary.overall.overallReasonCode).toBe('selection-unresolved');
});

test('full runtime with executed unit and acceptance inventories passes', () => {
  const gate = buildExpectedProductRuntimeGate(runtimePassed(), 'all', 'full', false);
  const summary = buildClaimSummary('all', fast(), runtimePassed(), 'full', policy('passed'));
  expect(gate.status).toBe('passed');
  expect(summary.overall.overallStatus).toBe('passed');
});

test('fast or runtime failures remain failed', () => {
  expect(buildClaimSummary(
    'all', fast('failed'), runtimeSkipped(), 'full', policy('skipped')
  ).overall.overallStatus).toBe('failed');

  expect(buildClaimSummary(
    'all', fast(), runtimeFailed(), 'full', policy('passed')
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
    'fast', fast(), runtimeSkipped(), 'service', policy('passed')
  );
  const claims = summary.overall.claimResults.map((entry) => entry.claimId);
  expect(claims).toContain('product-fast-verification');
  expect(claims).toContain('product-policy-verification');
  expect(claims).not.toContain('product-runtime-verification');
  expect(summary.overall.overallStatus).toBe('passed');
});
