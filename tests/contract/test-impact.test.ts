import { expect, test } from 'bun:test';

import { selectTestsForSources } from '../../platform/shared/test-impact-contract.ts';

test('test impact selector includes tests that directly import changed sources', () => {
  const selection = selectTestsForSources(['platform/shared/test-impact-contract.ts']);

  expect(selection.owners).toContain('auto-reference');
  expect(selection.fast).toContain('tests/contract/test-impact.test.ts');
  expect(selection.slow).not.toContain('tests/contract/test-impact.test.ts');
});

test('test impact selector includes tests that dynamically import changed sources', () => {
  const selection = selectTestsForSources(['platform/dev-runner/test-runner.ts']);

  expect(selection.owners).toContain('auto-reference');
  expect(selection.fast).toContain('tests/unit/test-runner.test.ts');
});

test('test impact selector uses auto-reference for CI contract coverage', () => {
  const selection = selectTestsForSources(['platform/shared/ci-contract.ts']);

  expect(selection.owners).toContain('auto-reference');
  expect(selection.owners).not.toContain('ci-contract');
  expect(selection.fast).toContain('tests/contract/ci-contract.test.ts');
  expect(selection.fast).toContain('tests/contract/ci-lanes.test.ts');
  expect(selection.slow).toEqual([]);
});

test('test impact selector uses auto-reference for test budget coverage', () => {
  const selection = selectTestsForSources(['platform/shared/test-budget-contract.ts']);

  expect(selection.owners).toContain('auto-reference');
  expect(selection.owners).not.toContain('test-budget');
  expect(selection.fast).toContain('tests/contract/benchmark-budget.test.ts');
});

test('test impact selector owns canonical IR changes as semantic core changes', () => {
  const selection = selectTestsForSources(['platform/compiler/ir/build-engineering-ir.ts']);

  expect(selection.owners).toContain('semantic-ir');
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/unit/canonical-ir-identity-revision.test.ts',
    'tests/unit/engineering-ir.test.ts',
    'tests/unit/semantic-contract-ir.test.ts',
    'tests/integration/semantic-projections.test.ts',
    'tests/integration/workspace-engineering-ir.test.ts',
    'tests/integration/semantic-core-vertical.test.ts'
  ]));
});

test('test impact selector binds predicate signature authority to focused semantic IR coverage', () => {
  const selection = selectTestsForSources([
    'platform/shared/engineering-ir/predicate-signature-types.ts',
    'platform/compiler/ir/predicate-signatures.ts'
  ]);

  expect(selection.owners).toContain('semantic-ir');
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/unit/predicate-signatures.test.ts',
    'tests/unit/engineering-ir.test.ts',
    'tests/unit/semantic-contract-ir.test.ts'
  ]));
});

test('test impact selector binds policy declaration loading to revision and policy coverage', () => {
  const selection = selectTestsForSources(['platform/compiler/parse/load-policy-declarations.ts']);

  expect(selection.owners).toContain('policy-declarations');
  expect(selection.fast).toContain('tests/unit/canonical-ir-identity-revision.test.ts');
  expect(selection.slow).toContain('tests/e2e/policy.test.ts');
});

test('test impact selector isolates semantic projection ownership', () => {
  const selection = selectTestsForSources(['platform/compiler/projection/project-state-view.ts']);

  expect(selection.owners).toContain('semantic-projection');
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/integration/semantic-projections.test.ts',
    'tests/integration/semantic-core-vertical.test.ts'
  ]));
  expect(selection.slow).toEqual([]);
});

test('test impact selector maps semantic lowering into runtime contract coverage', () => {
  const selection = selectTestsForSources(['platform/compiler/semantic-lowering.ts']);

  expect(selection.owners).toContain('semantic-lowering');
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/unit/semantic-lowering.test.ts',
    'tests/integration/semantic-core-vertical.test.ts'
  ]));
  expect(selection.slow).toContain('tests/e2e/semantic-runtime-contract.test.ts');
});

test('test impact selector keeps declarative registry files visible to registry rules', () => {
  const selection = selectTestsForSources([
    'platform/registry/official/ticket.basic/contracts/ticket.yaml'
  ]);

  expect(selection.owners).toContain('registry');
  expect(selection.fast).toContain('tests/unit/path-containment.test.ts');
  expect(selection.slow).toContain('tests/e2e/registry.test.ts');
});

test('test impact selector keeps slow coverage as notice-only selection', () => {
  const selection = selectTestsForSources(['platform/compiler/upgrade/plan.ts']);

  expect(selection.owners).toContain('upgrade');
  expect(selection.fast).toContain('tests/integration/migration-files.test.ts');
  expect(selection.slow).toContain('tests/e2e/upgrade.test.ts');
  expect(selection.slow).toContain('tests/e2e/dry-run-plan.test.ts');
});

test('test impact selector does not invent broad fallback for unmapped sources', () => {
  const selection = selectTestsForSources(['platform/shared/unmapped-helper.ts']);

  expect(selection).toEqual({
    fast: [],
    slow: [],
    owners: []
  });
});
