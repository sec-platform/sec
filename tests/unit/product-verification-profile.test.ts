import { expect, test } from 'bun:test';

import { POLICY_SOURCE_PATHS } from '../../src/workspace/contract/policy-source-paths.ts';
import type { PolicyReport } from '../../src/semantics/policies/types.ts';
import type { FastVerificationLaneReport, RuntimeVerificationLaneReport } from '../../src/assurance/verification/contract/types.ts';
import { buildExpectedProductFastGate, buildExpectedProductPolicyGate, buildExpectedProductRuntimeGate, buildExpectedProductVerificationClaimSummary, PRODUCT_POLICY_CLAIM_ID } from '../../src/assurance/verification/profile/contract/product.ts';
import { productVerificationObservationsFixture } from '../helpers/verification-fixtures.ts';

function emptyPolicyReport(): PolicyReport {
  return {
    status: 'skipped',
    official: { policies: [], sources: [], violations: [] },
    project: { policies: [], sources: [], violations: [] },
    merged: { policies: [] },
    violations: []
  };
}

function shadowedPolicyReport(
  targets: string[] = ['src/customer.ts'],
  assurance: 'source-structure' | 'semantic' = 'semantic'
): PolicyReport {
  return {
    status: targets.length === 0 ? 'skipped' : 'passed',
    official: {
      policies: ['tenant-policy'],
      sources: [
        { path: 'catalog/policies/official/a.yaml', policyIds: ['tenant-policy'] },
        { path: 'catalog/policies/official/b.yaml', policyIds: ['tenant-policy'] }
      ],
      violations: []
    },
    project: {
      policies: ['tenant-policy'],
      sources: [{ path: `${POLICY_SOURCE_PATHS.project}/c.yaml`, policyIds: ['tenant-policy'] }],
      violations: []
    },
    merged: {
      policies: [{
        id: 'tenant-policy',
        sourceScope: 'project',
        sourcePath: `${POLICY_SOURCE_PATHS.project}/c.yaml`,
        targets
      }]
    },
    violations: [],
    diagnostics: [],
    evaluation: {
      providerId: assurance === 'semantic' ? 'fixture-semantic-policy-provider' : 'fixture-source-structure-provider',
      providerRevision: '1',
      assurance,
      requiredSemanticPredicates: ['FLOWS_TO'],
      unsupportedSemanticPredicates: assurance === 'semantic' ? [] : ['FLOWS_TO']
    }
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

function runtime(
  unitPassed: string[] = ['tests/unit/customer.test.ts'],
  acceptancePassed: string[] = ['tests/acceptance/customer.test.ts']
): RuntimeVerificationLaneReport {
  return {
    status: 'passed',
    build: { status: 'passed', passed: ['bun run build'], failed: [], command: 'bun run build' },
    unit: { status: 'passed', passed: unitPassed, failed: [], command: 'bun run test:unit' },
    acceptance: {
      status: 'passed',
      passed: acceptancePassed,
      failed: [],
      command: 'bun run test:acceptance'
    },
    logs: { stdout: '', stderr: '' }
  };
}

function completeCoverage(runtimeReport: RuntimeVerificationLaneReport) {
  return {
    formatVersion: '1' as const,
    status: runtimeReport.status,
    acceptancePassed: ['customer_acceptance'],
    blocks: [{
      id: 'customer/basic',
      declaredAcceptance: ['customer_acceptance'],
      coveredBy: ['customer_acceptance'],
      uncovered: false
    }],
    uncoveredBlocks: []
  };
}

test('no-policy writer profile omits the not-applicable policy claim', () => {
  const policy = emptyPolicyReport();
  const runtimeReport = runtime();
  const summary = buildExpectedProductVerificationClaimSummary(
    'all',
    fast(policy),
    runtimeReport,
    'full',
    policy,
    completeCoverage(runtimeReport),
    productVerificationObservationsFixture()
  );

  expect(summary.overall.claimResults.map((claim) => claim.claimId)).not.toContain(
    PRODUCT_POLICY_CLAIM_ID
  );
  expect(summary.overall.overallStatus).toBe('passed');
});

test('policy shadow declarations preserve explicit project precedence with semantic assurance', () => {
  const gate = buildExpectedProductPolicyGate(
    shadowedPolicyReport(),
    productVerificationObservationsFixture().policy
  );
  expect(gate.status).toBe('passed');
  expect(gate.supportedClaims).toEqual([PRODUCT_POLICY_CLAIM_ID]);
});

test('source-structure policy success cannot authorize a semantic policy claim', () => {
  const gate = buildExpectedProductPolicyGate(
    shadowedPolicyReport(['src/customer.ts'], 'source-structure'),
    productVerificationObservationsFixture().policy
  );
  expect(gate.status).toBe('unsupported');
  expect(gate.reasonCode).toBe('capability-unsupported');
  expect(gate.supportedClaims).toEqual([]);
});

test('policy merged entries require the canonical winning source; no applicable target is not-applicable', () => {
  const wrongWinner = shadowedPolicyReport();
  wrongWinner.merged.policies[0]!.sourceScope = 'official';
  wrongWinner.merged.policies[0]!.sourcePath = 'catalog/policies/official/b.yaml';
  expect(buildExpectedProductPolicyGate(
    wrongWinner,
    productVerificationObservationsFixture().policy
  ).status).toBe('invalidated');

  const noTarget = buildExpectedProductPolicyGate(
    shadowedPolicyReport([]),
    productVerificationObservationsFixture().policy
  );
  expect(noTarget.status).toBe('not-run');
  expect(noTarget.reasonCode).toBe('not-applicable');
});

test('a passed fast lane cannot retain failed acceptance inventory', () => {
  const report = fast(shadowedPolicyReport());
  report.acceptance.failed = ['tests/acceptance/failed.test.ts'];
  expect(buildExpectedProductFastGate(
    report,
    'all',
    productVerificationObservationsFixture().fast
  ).status).toBe('invalidated');
});

test('full runtime pass requires nonempty physical inventories and complete coverage', () => {
  const zeroUnit = runtime([], ['tests/acceptance/customer.test.ts']);
  expect(buildExpectedProductRuntimeGate(
    zeroUnit,
    'all',
    'full',
    false,
    completeCoverage(zeroUnit),
    productVerificationObservationsFixture().runtime
  ).status).toBe('invalidated');

  const complete = runtime();
  expect(buildExpectedProductRuntimeGate(
    complete,
    'all',
    'full',
    false,
    completeCoverage(complete),
    productVerificationObservationsFixture().runtime
  ).status).toBe('passed');

  expect(buildExpectedProductRuntimeGate(
    complete,
    'all',
    'full',
    false,
    {
      ...completeCoverage(complete),
      uncoveredBlocks: ['customer/basic'],
      blocks: [{
        id: 'customer/basic',
        declaredAcceptance: ['customer_acceptance'],
        coveredBy: [],
        uncovered: true
      }]
    },
    productVerificationObservationsFixture().runtime
  ).status).toBe('invalidated');
});


test('project policy declarations outside the canonical author root cannot authorize a claim', () => {
  const report = shadowedPolicyReport();
  report.project.sources[0]!.path = 'project/policies/c.yaml';
  report.merged.policies[0]!.sourcePath = 'project/policies/c.yaml';
  expect(buildExpectedProductPolicyGate(report, productVerificationObservationsFixture().policy).status)
    .toBe('invalidated');
});
