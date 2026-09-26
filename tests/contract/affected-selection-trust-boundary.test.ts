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
import { AssertVerificationGateResult } from '../../src/assurance/verification/result/contract/result.ts';
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

// Issue #206 contract: six end-to-end regression scenarios for the
// affected-selection trust boundary. These verify the cross-cutting invariants
// that prevent false-greens: classification priority, projection correctness,
// fail-closed behaviour, and check-runner gate selection.
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

  // 3. classification is deterministic for one normalized owner input
  test('classification is deterministic regardless of cache state', () => {
    const input = baseInput({
      sourceChanged: true,
      selectedFastTestCount: 0,
      broadFallbackEnabled: false
    });
    const a = classifyAffectedSelectionTrustBoundary(input);
    const b = classifyAffectedSelectionTrustBoundary(input);
    expect(a).toBe(b);
    expect(a).toBe('unresolved-selection');
  });

  // 4. non-source change + no fast tests → applicable-no-tests (NOT fail-closed)
  test('non-source change with no fast tests is applicable-no-tests, not fail-closed', () => {
    const boundary = classifyAffectedSelectionTrustBoundary(baseInput({
      sourceChanged: false,
      selectedFastTestCount: 0
    }));
    expect(boundary).toBe('applicable-no-tests');
    expect(isAffectedSelectionFailClosed(boundary)).toBe(false);
    const result = projectAffectedSelectionToVerificationGateResult(
      boundary,
      defaultAffectedSelectionProjectionContext('HEAD', TEST_INPUT_DIGEST, null)
    );
    expect(result.status).toBe('not-run');
    expect(result.reasonCode).toBe('not-applicable');
  });

  // 5. check-runner includes test:affected gate for fail-closed boundaries
  test('check-runner includes test:affected gate when boundary is fail-closed', () => {
    for (const boundary of ['unresolved-selection', 'unresolved-module-graph'] as const) {
      const plan = makePlan(boundary);
      const checkPlan = buildLocalAffectedCheckPlan(plan);
      expect(checkPlan.gates.some((g) => g.id === 'test:affected')).toBe(true);
    }
  });

  // 6. check-runner excludes test:affected gate for applicable-no-tests
  test('check-runner excludes test:affected gate when boundary is applicable-no-tests', () => {
    const plan = makePlan('applicable-no-tests', {
      changedPaths: ['tests/e2e/registry.test.ts']
    });
    const checkPlan = buildLocalAffectedCheckPlan(plan);
    expect(checkPlan.gates.some((g) => g.id === 'test:affected')).toBe(false);
  });
});

describe('affected-selection-trust-boundary projection invariants (Issue #206)', () => {
  const allBoundaries: AffectedSelectionTrustBoundary[] = [
    'applicable-no-tests',
    'applicable-with-tests',
    'unresolved-selection',
    'unresolved-module-graph',
    'broad-fallback',
    'unresolved-ownership',
    'unresolved-git'
  ];

  test('every boundary projects to a schema-valid VerificationGateResult', () => {
    for (const boundary of allBoundaries) {
      const result = projectAffectedSelectionToVerificationGateResult(
        boundary,
        defaultAffectedSelectionProjectionContext('HEAD', TEST_INPUT_DIGEST, null)
      );
      // Must not throw — verifies all cross-field invariants.
      AssertVerificationGateResult(result);
    }
  });

  test('fail-closed boundaries always project to invalidated/selection-unresolved', () => {
    const failClosed: AffectedSelectionTrustBoundary[] = [
      'unresolved-git',
      'unresolved-ownership',
      'unresolved-selection',
      'unresolved-module-graph'
    ];
    for (const boundary of failClosed) {
      const result = projectAffectedSelectionToVerificationGateResult(
        boundary,
        defaultAffectedSelectionProjectionContext('HEAD', TEST_INPUT_DIGEST, null)
      );
      expect(result.status).toBe('invalidated');
      expect(result.reasonCode).toBe('selection-unresolved');
      expect(result.applicability).toBe('unresolved');
    }
  });

  test('non-fail-closed boundaries never project to invalidated', () => {
    const nonFailClosed: AffectedSelectionTrustBoundary[] = [
      'applicable-no-tests',
      'applicable-with-tests',
      'broad-fallback'
    ];
    for (const boundary of nonFailClosed) {
      const result = projectAffectedSelectionToVerificationGateResult(
        boundary,
        defaultAffectedSelectionProjectionContext('HEAD', TEST_INPUT_DIGEST, null)
      );
      expect(result.status).not.toBe('invalidated');
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

    // selection failure (source+empty+no-fallback) dominates fallback
    expect(classifyAffectedSelectionTrustBoundary(baseInput({
      ownershipResolved: true,
      sourceChanged: true,
      selectedFastTestCount: 0,
      broadFallbackEnabled: false
    }))).toBe('unresolved-selection');

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

    // no source change and no tests → applicable-no-tests
    expect(classifyAffectedSelectionTrustBoundary(baseInput({
      ownershipResolved: true,
      sourceChanged: false,
      selectedFastTestCount: 0
    }))).toBe('applicable-no-tests');
  });
});
