import { expect, test } from 'bun:test';

import {
  buildLocalAffectedCheckPlan,
  type AffectedTestPlan,
  type LocalAffectedGateId
} from '../../src/development/runner/affected-plan-contract.ts';
import {
  classifyAffectedSelectionTrustBoundary,
  defaultAffectedSelectionProjectionContext,
  projectAffectedSelectionToVerificationGateResult
} from '../../src/verification/test-impact/affected.ts';

function affectedPlan(
  changedPaths: string[],
  selectedFastTests: string[] = [],
  resolved = true
): AffectedTestPlan {
  const sourceChanged = changedPaths.some((file) => !file.endsWith('.md'));
  const ownershipResolved = resolved;
  const boundary = classifyAffectedSelectionTrustBoundary({
    gitDiscoveryFailed: false,
    ownershipResolved,
    sourceChanged,
    selectionResolved: true,
    unresolvedModuleFiles: [],
    selectedFastTestCount: selectedFastTests.length,
    broadFallbackEnabled: false
  });
  return {
    schema: 'sec-affected-test-plan-v1',
    changedPaths,
    owners: [],
    selectedFastTests,
    selectedSlowTests: [],
    riskSuites: [],
    riskTests: [],
    riskReasons: [],
    unresolvedPaths: resolved ? [] : changedPaths,
    resolved,
    selectionResolved: {
      tests: selectedFastTests,
      slowTests: [],
      affectedTests: selectedFastTests,
      affectedSlowTests: [],
      affectedOwners: [],
      sourceChanged,
      selectionResolved: true,
      unresolvedModuleFiles: []
    },
    selectionTrustBoundary: boundary,
    broadFallbackEnabled: false,
    verificationResult: projectAffectedSelectionToVerificationGateResult(
      boundary,
      defaultAffectedSelectionProjectionContext('HEAD', 'sha256:0', null)
    )
  };
}

function gateIds(plan: ReturnType<typeof buildLocalAffectedCheckPlan>): LocalAffectedGateId[] {
  return plan.gates.map(({ id }) => id);
}

test('local affected plan selects docs doctor alone for pure active documentation', () => {
  const plan = buildLocalAffectedCheckPlan(affectedPlan(
    ['docs/verification-governance.md'],
    ['tests/unit/codex-work-package-contract.test.ts']
  ));

  expect(gateIds(plan)).toEqual(['docs:doctor']);
  expect(plan.subsumedStandaloneCommands).toEqual(['bun run docs:doctor']);
});

test('local affected plan forms one ordered union for mixed TypeScript and docs changes', () => {
  const plan = buildLocalAffectedCheckPlan(affectedPlan(
    [
      'docs/verification-governance.md',
      'src/development/runner/check-runner.ts'
    ],
    [
      'tests/unit/local-gate-union.test.ts',
      'tests/unit/test-runner.test.ts'
    ]
  ));

  expect(gateIds(plan)).toEqual([
    'imports:check',
    'typecheck',
    'docs:doctor',
    'test:affected'
  ]);
  expect(plan.subsumedStandaloneCommands).toEqual([
    'bun run imports:check',
    'bun run typecheck',
    'bun run docs:doctor',
    'bun run test:affected'
  ]);
  expect(new Set(plan.subsumedStandaloneCommands).size).toBe(plan.subsumedStandaloneCommands.length);
  expect(plan.umbrellaCommand).toBe('bun run check:affected');
});

test('local affected plan keeps non-TypeScript contracts narrow', () => {
  expect(gateIds(buildLocalAffectedCheckPlan(affectedPlan(
    ['package.json'],
    ['tests/contract/repository-runtime.test.ts']
  )))).toEqual(['typecheck', 'test:affected']);

  expect(gateIds(buildLocalAffectedCheckPlan(affectedPlan(
    ['.github/workflows/compiler-pr-validation.yml'],
    ['tests/contract/ci-lanes.test.ts']
  )))).toEqual(['test:affected']);
});

test('local affected plan preserves unresolved authority and selects no invented broad fallback', () => {
  const plan = buildLocalAffectedCheckPlan(affectedPlan(['assets/unowned.bin'], [], false));

  expect(plan.resolved).toBe(false);
  expect(plan.gates).toEqual([]);
  expect(plan.affectedPlan.unresolvedPaths).toEqual(['assets/unowned.bin']);
});
