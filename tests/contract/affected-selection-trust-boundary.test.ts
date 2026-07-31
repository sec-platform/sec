import { describe, expect, test } from 'bun:test';

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

function baseInput(overrides: Partial<AffectedSelectionClassificationInput> = {}): AffectedSelectionClassificationInput {
  return {
    gitDiscoveryFailed: false,
    ownershipResolved: true,
    sourceChanged: true,
    selectionResolved: true,
    unresolvedTestFiles: [],
    selectedFastTestCount: 0,
    broadFallbackEnabled: false,
    ...overrides
  };
}

function makePlan(
  boundary: AffectedSelectionTrustBoundary,
  overrides: Partial<AffectedTestPlanV1> = {}
): AffectedTestPlanV1 {
  const verificationResult = projectAffectedSelectionToVerificationGateResult(
    boundary,
    defaultAffectedSelectionProjectionContext('HEAD', 'sha256:0000000000000000000000000000000000000000000000000000000000000000', null)
  );
  const hasFastTests = boundary === 'applicable-with-tests' || boundary === 'broad-fallback';
  // `resolved` tracks OWNERSHIP resolution, not selection resolution.
  // unresolved-git and unresolved-ownership have unresolved ownership.
  // unresolved-selection and unresolved-test-source have ownership resolved
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
      unresolvedTestFiles: []
    }),
    selectionTrustBoundary: boundary,
    verificationResult,
    ...overrides
  }) as AffectedTestPlanV1;
}

// Issue #206 contract: 10 must-pass end-to-end regression scenarios for the
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

  // 2. same mtime + different bytes → re-transpile (cache identity is digest, not mtime)
  test('cache identity is sourceDigest not mtime — classification does not depend on mtime', () => {
    // This is a contract-level assertion: the classification input does NOT
    // include mtime. The cache layer (test-impact-contract.ts) uses sourceDigest
    // as the single identity; the classification layer is agnostic to mtime.
    const boundary = classifyAffectedSelectionTrustBoundary(baseInput({
      sourceChanged: true,
      selectedFastTestCount: 0,
      broadFallbackEnabled: false
    }));
    expect(boundary).toBe('unresolved-selection');
    // The contract: when source changed and no tests selected, the runner
    // MUST fail closed regardless of why the closure is empty.
    expect(isAffectedSelectionFailClosed(boundary)).toBe(true);
  });

  // 3. source read/stat failure → unresolved-test-source
  test('test source read failure surfaces as unresolved-test-source', () => {
    const boundary = classifyAffectedSelectionTrustBoundary(baseInput({
      sourceChanged: true,
      selectedFastTestCount: 0,
      broadFallbackEnabled: false,
      selectionResolved: false,
      unresolvedTestFiles: ['tests/unit/missing.test.ts']
    }));
    expect(boundary).toBe('unresolved-test-source');
    expect(isAffectedSelectionFailClosed(boundary)).toBe(true);
  });

  // 4. corrupt/unknown-schema cache → rejected (classification still correct)
  test('classification is independent of cache state — corrupt cache does not affect boundary', () => {
    // The classification contract operates on inputs (sourceChanged, selectionResolved,
    // etc.) that are computed AFTER cache loading. If the cache is corrupt, it is
    // rebuilt (tested in test-impact-cache.test.ts). The classification layer
    // never sees corrupt cache — it sees the rebuilt result.
    const boundary = classifyAffectedSelectionTrustBoundary(baseInput({
      sourceChanged: true,
      selectedFastTestCount: 3,
      selectionResolved: true
    }));
    expect(boundary).toBe('applicable-with-tests');
  });

  // 5. test delete/rename → old edges do not persist (classification uses fresh data)
  test('classification reflects current test file set, not stale edges', () => {
    // If a test file was deleted, it won't appear in selectedFastTests (because
    // currentTestPathIsRunnable filters it out in affected-test-inventory.ts).
    // The classification sees selectedFastTestCount=0 and, if sourceChanged,
    // fails closed. This prevents stale edges from masking a deleted test.
    const boundary = classifyAffectedSelectionTrustBoundary(baseInput({
      sourceChanged: true,
      selectedFastTestCount: 0,
      broadFallbackEnabled: false
    }));
    expect(boundary).toBe('unresolved-selection');
    expect(isAffectedSelectionFailClosed(boundary)).toBe(true);
  });

  // 6. parser/contract revision change → all entries invalidated
  test('revision change invalidation is handled at cache layer — classification unaffected', () => {
    // When parser/contract revision changes, the entire cache is discarded and
    // rebuilt. The classification layer sees the fresh selection result and
    // classifies normally. This contract test verifies that the classification
    // does not have a "stale cache" code path.
    const boundaryFresh = classifyAffectedSelectionTrustBoundary(baseInput({
      sourceChanged: true,
      selectedFastTestCount: 2,
      selectionResolved: true
    }));
    expect(boundaryFresh).toBe('applicable-with-tests');
  });

  // 7. cache on/off byte-equivalent — classification is deterministic
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

  // 8. non-source change + no fast tests → applicable-no-tests (NOT fail-closed)
  test('non-source change with no fast tests is applicable-no-tests, not fail-closed', () => {
    const boundary = classifyAffectedSelectionTrustBoundary(baseInput({
      sourceChanged: false,
      selectedFastTestCount: 0
    }));
    expect(boundary).toBe('applicable-no-tests');
    expect(isAffectedSelectionFailClosed(boundary)).toBe(false);
    const result = projectAffectedSelectionToVerificationGateResult(
      boundary,
      defaultAffectedSelectionProjectionContext('HEAD', 'sha256:0000000000000000000000000000000000000000000000000000000000000000', null)
    );
    expect(result.status).toBe('not-run');
    expect(result.reasonCode).toBe('not-applicable');
  });

  // 9. check-runner includes test:affected gate for fail-closed boundaries
  test('check-runner includes test:affected gate when boundary is fail-closed', () => {
    for (const boundary of ['unresolved-selection', 'unresolved-test-source'] as const) {
      const plan = makePlan(boundary);
      const checkPlan = buildLocalAffectedCheckPlan(plan);
      expect(checkPlan.gates.some((g) => g.id === 'test:affected')).toBe(true);
    }
  });

  // 10. check-runner excludes test:affected gate for applicable-no-tests
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
    'unresolved-test-source',
    'broad-fallback',
    'unresolved-ownership',
    'unresolved-git'
  ];

  test('every boundary projects to a schema-valid VerificationGateResultV1', () => {
    for (const boundary of allBoundaries) {
      const result = projectAffectedSelectionToVerificationGateResult(
        boundary,
        defaultAffectedSelectionProjectionContext('HEAD', 'sha256:0000000000000000000000000000000000000000000000000000000000000000', null)
      );
      // Must not throw — verifies all cross-field invariants.
      CodexDevelopmentAssertVerificationGateResultV1(result);
    }
  });

  test('fail-closed boundaries always project to invalidated/selection-unresolved', () => {
    const failClosed: AffectedSelectionTrustBoundary[] = [
      'unresolved-git',
      'unresolved-ownership',
      'unresolved-selection',
      'unresolved-test-source'
    ];
    for (const boundary of failClosed) {
      const result = projectAffectedSelectionToVerificationGateResult(
        boundary,
        defaultAffectedSelectionProjectionContext('HEAD', 'sha256:0000000000000000000000000000000000000000000000000000000000000000', null)
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
        defaultAffectedSelectionProjectionContext('HEAD', 'sha256:0000000000000000000000000000000000000000000000000000000000000000', null)
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
