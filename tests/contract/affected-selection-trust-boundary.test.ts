import { expect, test } from 'bun:test';

import { buildLocalAffectedCheckPlan } from '../../platform/dev-runner/check-runner.ts';
import type { AffectedTestPlanV1 } from '../../platform/dev-runner/test-runner.ts';
import {
  classifyAffectedSelectionTrustBoundary,
  defaultAffectedSelectionProjectionContext,
  isAffectedSelectionFailClosed,
  projectAffectedSelectionToVerificationGateResult,
  type AffectedSelectionClassificationInput,
  type AffectedSelectionTrustBoundary
} from '../../platform/shared/affected-test-inventory.ts';
import { CodexDevelopmentAssertVerificationGateResultV1 } from '../../platform/shared/verification-result-contract.ts';

const DIGEST = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';

function input(overrides: Partial<AffectedSelectionClassificationInput>): AffectedSelectionClassificationInput {
  return {
    gitDiscoveryFailed: false,
    ownershipResolved: true,
    sourceChanged: true,
    selectionResolved: true,
    unresolvedModuleFiles: [],
    selectedFastTestCount: 0,
    ...overrides
  };
}

function plan(boundary: AffectedSelectionTrustBoundary): AffectedTestPlanV1 {
  const selectedFastTests = boundary === 'applicable-with-tests'
    ? ['tests/unit/example.test.ts']
    : [];
  const ownershipResolved = boundary !== 'unresolved-git' && boundary !== 'unresolved-ownership';
  return Object.freeze({
    schema: 'sec-affected-test-plan-v1',
    changedPaths: ['platform/shared/example.ts'],
    owners: [],
    selectedFastTests,
    selectedSlowTests: [],
    riskSuites: [],
    riskTests: [],
    riskReasons: [],
    unresolvedPaths: ownershipResolved ? [] : ['platform/shared/example.ts'],
    resolved: ownershipResolved,
    selectionResolved: Object.freeze({
      tests: selectedFastTests,
      slowTests: [],
      affectedTests: selectedFastTests,
      affectedSlowTests: [],
      affectedOwners: [],
      sourceChanged: boundary !== 'applicable-no-tests',
      selectionResolved: boundary !== 'unresolved-module-graph',
      unresolvedModuleFiles: boundary === 'unresolved-module-graph'
        ? ['platform/shared/missing.ts']
        : []
    }),
    selectionTrustBoundary: boundary,
    verificationResult: projectAffectedSelectionToVerificationGateResult(
      boundary,
      defaultAffectedSelectionProjectionContext('HEAD', DIGEST)
    )
  });
}

test('affected selection classifies every observable authority boundary', () => {
  const cases: Array<readonly [AffectedSelectionTrustBoundary, Partial<AffectedSelectionClassificationInput>]> = [
    ['unresolved-git', { gitDiscoveryFailed: true, ownershipResolved: false }],
    ['unresolved-ownership', { ownershipResolved: false }],
    ['unresolved-module-graph', {
      selectionResolved: false,
      unresolvedModuleFiles: ['platform/shared/missing.ts']
    }],
    ['unresolved-selection', {}],
    ['applicable-with-tests', { selectedFastTestCount: 1 }],
    ['applicable-no-tests', { sourceChanged: false }]
  ];

  for (const [expected, overrides] of cases) {
    const actual = classifyAffectedSelectionTrustBoundary(input(overrides));
    expect(actual).toBe(expected);
    expect(isAffectedSelectionFailClosed(actual)).toBe(expected.startsWith('unresolved-'));
  }
});

test('every affected selection boundary has one schema-valid plan projection', () => {
  const boundaries: AffectedSelectionTrustBoundary[] = [
    'unresolved-git',
    'unresolved-ownership',
    'unresolved-module-graph',
    'unresolved-selection',
    'applicable-with-tests',
    'applicable-no-tests'
  ];

  for (const boundary of boundaries) {
    const result = projectAffectedSelectionToVerificationGateResult(
      boundary,
      defaultAffectedSelectionProjectionContext('HEAD', DIGEST)
    );
    CodexDevelopmentAssertVerificationGateResultV1(result);
    if (boundary.startsWith('unresolved-')) {
      expect(result).toMatchObject({
        applicability: 'unresolved',
        status: 'invalidated',
        reasonCode: 'selection-unresolved'
      });
    } else if (boundary === 'applicable-with-tests') {
      expect(result).toMatchObject({
        applicability: 'required',
        status: 'not-run',
        reasonCode: 'not-dispatched'
      });
    } else {
      expect(result).toMatchObject({
        applicability: 'not-applicable',
        status: 'not-run',
        reasonCode: 'not-applicable'
      });
    }
  }
});

test('affected Gate runs for selected or unresolved work and skips proven no-impact work', () => {
  for (const boundary of [
    'unresolved-selection',
    'unresolved-module-graph',
    'applicable-with-tests'
  ] as const) {
    expect(buildLocalAffectedCheckPlan(plan(boundary)).gates.map(({ id }) => id)).toContain('test:affected');
  }
  expect(buildLocalAffectedCheckPlan(plan('applicable-no-tests')).gates.map(({ id }) => id)).not.toContain('test:affected');
});
