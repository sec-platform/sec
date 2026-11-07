import { describe, expect, test } from 'bun:test';

import {
  buildLocalAffectedCheckPlan,
  type AffectedTestPlan
} from '../../../src/adapters/self-hosting/development/runner/affected-plan-contract.ts';
import {
  classifyAffectedSelectionTrustBoundary,
  defaultAffectedSelectionProjectionContext,
  isAffectedSelectionFailClosed,
  projectAffectedSelectionToVerificationGateResult,
  type AffectedSelectionClassificationInput,
  type AffectedSelectionTrustBoundary
} from '../../../src/adapters/verification/platform/test-impact/affected.ts';
import { CodexDevelopmentAssertVerificationGateResult } from '../../../src/assurance/verification/result/contract/result.ts';
import { sha256 } from '../../../src/contracts/canonical.ts';

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

// Keep classification and its projection in one observed chain. The local gate
// consumer remains independently exercised; none of these plans runs a test.
describe('affected-selection-trust-boundary contract (Issue #206)', () => {
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
      changedPaths: ['tests/e2e/toolchain/registry.test.ts']
    });
    const checkPlan = buildLocalAffectedCheckPlan(plan);
    expect(checkPlan.gates.some((g) => g.id === 'test:affected')).toBe(false);
  });
});

describe('affected-selection-trust-boundary projection invariants (Issue #206)', () => {
  test('classification priority produces the exact unexecuted verification outcome', () => {
    const cases = [
      ['applicable-no-tests', { sourceChanged: false }, 'not-applicable', 'not-run', 'not-applicable', false],
      ['applicable-with-tests', { selectedFastTestCount: 1 }, 'required', 'not-run', 'not-dispatched', null],
      ['broad-fallback', { broadFallbackEnabled: true }, 'required', 'not-run', 'not-dispatched', null],
      ['unresolved-git', { gitDiscoveryFailed: true, ownershipResolved: false }, 'unresolved', 'invalidated', 'selection-unresolved', null],
      ['unresolved-ownership', { ownershipResolved: false }, 'unresolved', 'invalidated', 'selection-unresolved', null],
      ['unresolved-selection', {}, 'unresolved', 'invalidated', 'selection-unresolved', true],
      ['unresolved-module-graph', { selectionResolved: false, unresolvedModuleFiles: ['platform/shared/missing.ts'] },
        'unresolved', 'invalidated', 'selection-unresolved', true]
    ] as const;
    for (const [expectedBoundary, input, applicability, status, reasonCode, failClosed] of cases) {
      const boundary = classifyAffectedSelectionTrustBoundary(baseInput(input));
      expect(boundary).toBe(expectedBoundary);
      if (failClosed !== null) expect(isAffectedSelectionFailClosed(boundary)).toBe(failClosed);
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
});
