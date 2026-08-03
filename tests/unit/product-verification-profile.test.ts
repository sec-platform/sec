import { expect, test } from 'bun:test';

import {
  buildExpectedProductFastGate,
  buildExpectedProductPolicyGate,
  buildExpectedProductVerificationClaimSummary,
  PRODUCT_POLICY_CLAIM_ID
} from '../../platform/shared/product-verification-profile.ts';
import type { PolicyReport } from '../../platform/shared/policy-types.ts';
import type {
  FastVerificationLaneReport,
  RuntimeVerificationLaneReport
} from '../../platform/shared/verification-types.ts';

function emptyPolicyReport(): PolicyReport {
  return {
    status: 'skipped',
    official: { policies: [], sources: [], violations: [] },
    project: { policies: [], sources: [], violations: [] },
    merged: { policies: [] },
    violations: []
  };
}

function shadowedPolicyReport(targets: string[] = ['src/customer.ts']): PolicyReport {
  return {
    status: 'passed',
    official: {
      policies: ['tenant-policy'],
      sources: [
        { path: 'policies/a.yaml', policyIds: ['tenant-policy'] },
        { path: 'policies/b.yaml', policyIds: ['tenant-policy'] }
      ],
      violations: []
    },
    project: {
      policies: ['tenant-policy'],
      sources: [{ path: 'project/policies/c.yaml', policyIds: ['tenant-policy'] }],
      violations: []
    },
    merged: {
      policies: [{
        id: 'tenant-policy',
        sourceScope: 'project',
        sourcePath: 'project/policies/c.yaml',
        targets
      }]
    },
    violations: []
  };
}

function fast(policyReport: PolicyReport): FastVerificationLaneReport {
  return {
    status: 'passed',
    build: { status: 'passed' },
    unit: { status: 'passed', passed: [] },
    acceptance: { status: 'passed', passed: [], failed: [] },
    policy: { status: policyReport.status, violations: policyReport.violations },
    policyReport,
    logs: { stdout: '', stderr: '' }
  };
}

function runtime(): RuntimeVerificationLaneReport {
  return {
    status: 'passed',
    build: { status: 'passed', passed: [], failed: [], command: 'bun run build' },
    unit: { status: 'passed', passed: [], failed: [], command: 'bun run test:unit' },
    acceptance: {
      status: 'passed',
      passed: [],
      failed: [],
      command: 'bun run test:acceptance'
    },
    logs: { stdout: '', stderr: '' }
  };
}

test('no-policy current writer profile retains the not-applicable policy claim', () => {
  const policy = emptyPolicyReport();
  const summary = buildExpectedProductVerificationClaimSummary(
    'all',
    fast(policy),
    runtime(),
    'full',
    policy
  );

  expect(summary.overall.claimResults.map((claim) => claim.claimId)).toContain(
    PRODUCT_POLICY_CLAIM_ID
  );
  expect(summary.overall.claimResults.find(
    (claim) => claim.claimId === PRODUCT_POLICY_CLAIM_ID
  )?.status).toBe('not-run');
  expect(summary.overall.overallStatus).toBe('not-run');
});

test('policy shadow declarations preserve the loader last-wins source identity', () => {
  const gate = buildExpectedProductPolicyGate(shadowedPolicyReport());
  expect(gate.status).toBe('passed');
  expect(gate.supportedClaims).toEqual([PRODUCT_POLICY_CLAIM_ID]);
});

test('policy merged entries require the winning source and nonempty targets', () => {
  const wrongWinner = shadowedPolicyReport();
  wrongWinner.merged.policies[0]!.sourceScope = 'official';
  wrongWinner.merged.policies[0]!.sourcePath = 'policies/b.yaml';
  expect(buildExpectedProductPolicyGate(wrongWinner).status).toBe('invalidated');

  expect(buildExpectedProductPolicyGate(shadowedPolicyReport([])).status).toBe('invalidated');
});

test('a passed fast lane cannot retain failed acceptance inventory', () => {
  const report = fast(shadowedPolicyReport());
  report.acceptance.failed = ['tests/acceptance/failed.test.ts'];
  expect(buildExpectedProductFastGate(report, 'all').status).toBe('invalidated');
});
