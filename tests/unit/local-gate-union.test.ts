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
    ['docs/运行/保证/要求证据与裁决.md'],
    ['tests/unit/codex-work-package-contract.test.ts']
  ));

  expect(gateIds(plan)).toEqual(['docs:doctor']);
  expect(plan.subsumedStandaloneCommands).toEqual(['bun run docs:doctor']);
});

test('local affected plan forms one ordered union for mixed TypeScript and docs changes', () => {
  const plan = buildLocalAffectedCheckPlan(affectedPlan(
    [
      'docs/运行/保证/要求证据与裁决.md',
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

test('local affected plan does not turn Source Program invalidation into full-repository conformance', () => {
  expect(gateIds(buildLocalAffectedCheckPlan(affectedPlan(
    ['src/development/runner/check-runner.ts']
  )))).toEqual(['imports:check', 'typecheck', 'test:affected']);

  expect(gateIds(buildLocalAffectedCheckPlan(affectedPlan(
    ['docs/运行/保证/要求证据与裁决.md']
  )))).toEqual(['docs:doctor']);

  expect(gateIds(buildLocalAffectedCheckPlan(affectedPlan(
    ['.documentation/documents.json']
  )))).toEqual(['docs:doctor', 'test:affected']);
});

test('documentation support assets trigger docs doctor without becoming product TypeScript', () => {
  expect(gateIds(buildLocalAffectedCheckPlan(affectedPlan([
    '.documentation/baseline.json'
  ])))).toEqual(['docs:doctor', 'test:affected']);
  expect(gateIds(buildLocalAffectedCheckPlan(affectedPlan([
    'examples/documentation-example.ts'
  ])))).toEqual(['docs:doctor']);
  expect(gateIds(buildLocalAffectedCheckPlan(affectedPlan(
    ['tools/check_docs.py'],
    ['tests/unit/active-documentation-contract.test.ts']
  )))).toEqual(['docs:doctor', 'test:affected']);
  expect(gateIds(buildLocalAffectedCheckPlan(affectedPlan([
    'docs/unregistered-legacy.md'
  ])))).toEqual(['docs:doctor']);
  expect(gateIds(buildLocalAffectedCheckPlan(affectedPlan([
    'docs/work/active-work-package.md'
  ])))).toEqual([]);
});

test('local affected plan preserves unresolved authority and selects no invented broad fallback', () => {
  const plan = buildLocalAffectedCheckPlan(affectedPlan(['assets/unowned.bin'], [], false));

  expect(plan.resolved).toBe(false);
  expect(plan.gates).toEqual([]);
  expect(plan.affectedPlan.unresolvedPaths).toEqual(['assets/unowned.bin']);
});
