import { describe, expect, test } from 'bun:test';

import {
  buildLocalAffectedCheckPlan,
  type AffectedTestPlan
} from '../../src/adapters/self-hosting/development/runner/affected-plan-contract.ts';
import {
  classifyAffectedSelectionTrustBoundary,
  defaultAffectedSelectionProjectionContext,
  isAffectedSelectionFailClosed,
  projectAffectedSelectionToVerificationGateResult,
  type AffectedSelectionClassificationInput,
  type AffectedSelectionTrustBoundary
} from '../../src/adapters/verification/platform/test-impact/affected.ts';
import { CodexDevelopmentAssertVerificationGateResult } from '../../src/assurance/verification/result/contract/result.ts';
import { sha256 } from '../../src/contracts/canonical.ts';

const TEST_INPUT_DIGEST = sha256({
  contract: 'affected-selection-trust-boundary',
  observation: 'synthetic-plan-input'
});

function baseInput(overrides: Partial<AffectedSelectionClassificationInput> = {}): AffectedSelectionClassificationInput {
  return {
    gitDiscoveryFailed: false,
    ownershipResolved: true,
    sourceChanged: true,
    selectionResolved: true,
    unresolvedModuleFiles: [],
    selectedFastTestCount: 0,
    broadFallbackEnabled: false,
    ...overrides
  };
}

function makePlan(
  boundary: AffectedSelectionTrustBoundary,
  overrides: Partial<AffectedTestPlan> = {}
): AffectedTestPlan {
  const verificationResult = projectAffectedSelectionToVerificationGateResult(
    boundary,
    defaultAffectedSelectionProjectionContext('HEAD', TEST_INPUT_DIGEST, null)
  );
  const hasFastTests = boundary === 'applicable-with-tests' || boundary === 'broad-fallback';
  // `resolved` tracks OWNERSHIP resolution, not selection resolution.
  // unresolved-git and unresolved-ownership have unresolved ownership.
  // unresolved-selection and unresolved-module-graph have ownership resolved
  // but selection unresolved — resolved=true, failClosed=true.
  const ownershipUnresolved = boundary === 'unresolved-git' || boundary === 'unresolved-ownership';
  return Object.freeze({
    schema: 'sec-affected-test-plan-v1',
    changedPaths: ['tests/setup/unmapped.ts'],
    owners: [],
    selectedFastTests: hasFastTests && boundary === 'applicable-with-tests'
      ? ['tests/unit/example.test.ts']
      : [],
    selectedSlowTests: [],
    riskSuites: [],
    riskTests: [],
    riskReasons: [],
    unresolvedPaths: [],
    resolved: !ownershipUnresolved,
    selectionResolved: Object.freeze({
      tests: [],
      slowTests: [],
      affectedTests: [],
      affectedSlowTests: [],
      affectedOwners: [],
      sourceChanged: boundary !== 'applicable-no-tests',
      selectionResolved: true,
      unresolvedModuleFiles: []
    }),
    selectionTrustBoundary: boundary,
    verificationResult,
    ...overrides
  }) as AffectedTestPlan;
}

// The classifier, result projection, and local gate consumer have separate
// observations; none of these synthetic plans executes an affected test run.
describe('affected-selection-trust-boundary contract (Issue #206)', () => {
  // 1. source change + empty closure + fallback off → invalidated/non-zero
  test('source change with empty closure and no fallback classifies as unresolved-selection', () => {
    const boundary = classifyAffectedSelectionTrustBoundary(baseInput({
      sourceChanged: true,
      selectedFastTestCount: 0,
      broadFallbackEnabled: false,
      selectionResolved: true
    }));
    expect(boundary).toBe('unresolved-selection');
    expect(isAffectedSelectionFailClosed(boundary)).toBe(true);
  });

  // 2. module read/target failure → unresolved-module-graph
  test('module graph resolution failure surfaces as unresolved-module-graph', () => {
    const boundary = classifyAffectedSelectionTrustBoundary(baseInput({
      sourceChanged: true,
      selectedFastTestCount: 0,
      broadFallbackEnabled: false,
      selectionResolved: false,
      unresolvedModuleFiles: ['platform/shared/missing.ts']
    }));
    expect(boundary).toBe('unresolved-module-graph');
    expect(isAffectedSelectionFailClosed(boundary)).toBe(true);
  });

  // Non-source change + no fast tests → applicable-no-tests (NOT fail-closed)
  test('non-source change with no fast tests is applicable-no-tests, not fail-closed', () => {
    const boundary = classifyAffectedSelectionTrustBoundary(baseInput({
      sourceChanged: false,
      selectedFastTestCount: 0
    }));
    expect(boundary).toBe('applicable-no-tests');
    expect(isAffectedSelectionFailClosed(boundary)).toBe(false);
  });

  // The local gate consumer includes test:affected gate for fail-closed boundaries
  test('check-runner includes test:affected gate when boundary is fail-closed', () => {
    for (const boundary of ['unresolved-selection', 'unresolved-module-graph'] as const) {
      const plan = makePlan(boundary);
      const checkPlan = buildLocalAffectedCheckPlan(plan);
      expect(checkPlan.gates.some((g) => g.id === 'test:affected')).toBe(true);
    }
  });

  // The local gate consumer excludes test:affected gate for applicable-no-tests
  test('check-runner excludes test:affected gate when boundary is applicable-no-tests', () => {
    const plan = makePlan('applicable-no-tests', {
      changedPaths: ['tests/e2e/registry.test.ts']
    });
    const checkPlan = buildLocalAffectedCheckPlan(plan);
    expect(checkPlan.gates.some((g) => g.id === 'test:affected')).toBe(false);
  });
});

describe('affected-selection-trust-boundary projection invariants (Issue #206)', () => {
  test('every boundary projects to its exact unexecuted verification outcome', () => {
    const cases = [
      ['applicable-no-tests', 'not-applicable', 'not-run', 'not-applicable'],
      ['applicable-with-tests', 'required', 'not-run', 'not-dispatched'],
      ['broad-fallback', 'required', 'not-run', 'not-dispatched'],
      ['unresolved-git', 'unresolved', 'invalidated', 'selection-unresolved'],
      ['unresolved-ownership', 'unresolved', 'invalidated', 'selection-unresolved'],
      ['unresolved-selection', 'unresolved', 'invalidated', 'selection-unresolved'],
      ['unresolved-module-graph', 'unresolved', 'invalidated', 'selection-unresolved']
    ] as const;
    for (const [boundary, applicability, status, reasonCode] of cases) {
      const result = projectAffectedSelectionToVerificationGateResult(
        boundary,
        defaultAffectedSelectionProjectionContext('HEAD', TEST_INPUT_DIGEST, null)
      );
      CodexDevelopmentAssertVerificationGateResult(result);
      expect(result).toMatchObject({
        applicability, status, reasonCode,
        disposition: 'not-executed', environment: null, execution: null
      });
    }
  });

  test('classification priority: git > ownership > selection > fallback > tests > no-tests', () => {
    // git discovery failure dominates
    expect(classifyAffectedSelectionTrustBoundary(baseInput({
      gitDiscoveryFailed: true,
      ownershipResolved: false
    }))).toBe('unresolved-git');

    // ownership failure dominates selection
    expect(classifyAffectedSelectionTrustBoundary(baseInput({
      gitDiscoveryFailed: false,
      ownershipResolved: false,
      sourceChanged: true,
      selectedFastTestCount: 0
    }))).toBe('unresolved-ownership');

    // fallback dominates "no tests"
    expect(classifyAffectedSelectionTrustBoundary(baseInput({
      ownershipResolved: true,
      sourceChanged: true,
      selectedFastTestCount: 0,
      broadFallbackEnabled: true
    }))).toBe('broad-fallback');

    // selected tests dominate "no tests"
    expect(classifyAffectedSelectionTrustBoundary(baseInput({
      ownershipResolved: true,
      sourceChanged: true,
      selectedFastTestCount: 1,
      broadFallbackEnabled: false
    }))).toBe('applicable-with-tests');
  });
});
