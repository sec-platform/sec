import { expect, test } from 'bun:test';

import { TCB_REVIEWED_PROCESS_DISPATCHERS } from '../../platform/shared/tcb-closure-lock.ts';
import { getTestFilesSync, isFastTestFile, isSlowTestFile } from '../../platform/shared/test-budget-contract.ts';
import {
  classifyTestImpactSource,
  readRepositoryModuleGraphV1,
  resolveTestImpactSelectionTrustBoundary,
  selectTestsForSources,
  testImpactFallbackRules,
  testOwnershipDeclarations,
  type CodexDevelopmentTestImpactSourceProviderV2
} from '../../platform/shared/test-impact-contract.ts';
import {
  matchesTestOwnershipDeclaration,
  resolveTestOwnershipClosureMode,
  type TestOwnershipDeclaration
} from '../../platform/shared/test-ownership-contract.ts';

function expectUnique(values: readonly string[]): void {
  expect(new Set(values).size).toBe(values.length);
}

test('source classification is a deterministic public contract', () => {
  expect(classifyTestImpactSource('platform/compiler/semantic-linker.ts')).toBe('typescript');
  expect(classifyTestImpactSource('platform/registry/official/ticket.basic/block.manifest.yaml')).toBe('manifest');
  expect(classifyTestImpactSource('platform/registry/official/ticket.basic/contracts/ticket.yaml'))
    .toBe('semantic-contract');
  expect(classifyTestImpactSource('source/model/app.plan.yaml')).toBe('source-model');
  expect(classifyTestImpactSource('.github/workflows/compiler-pr-validation.yml')).toBe('workflow');
  expect(classifyTestImpactSource('package.json')).toBe('repository-config');
  expect(classifyTestImpactSource('docs/roadmap.md')).toBe('active-documentation');
  expect(classifyTestImpactSource('docs/unregistered.manifest.yaml')).toBeNull();
});

test('repository module graph is the single resolved dependency observation', () => {
  const graph = readRepositoryModuleGraphV1();
  const resolution = resolveTestImpactSelectionTrustBoundary();

  expect(resolution).toEqual({ selectionResolved: true, unresolvedModuleFiles: [] });
  expect(graph.files.length).toBeGreaterThan(0);
  expectUnique(graph.files);
  expectUnique(graph.references.map((reference) => (
    `${reference.from}\0${reference.kind}\0${reference.specifier}\0${reference.resolvedTarget ?? ''}`
  )));
  for (const reference of graph.references) {
    expect(reference.candidateTargets).toEqual([...new Set(reference.candidateTargets)].sort());
    if (reference.resolvedTarget !== null) expect(graph.files).toContain(reference.resolvedTarget);
  }
});

test('syntax scanning ignores import-like text and accepts shebang plus generic TypeScript', () => {
  const selected = 'tests/unit/virtual-import-impact.test.ts';
  const ignored = 'tests/unit/virtual-import-text.test.ts';
  const provider: CodexDevelopmentTestImpactSourceProviderV2 = {
    moduleFiles: ['platform/shared/virtual-source.ts', selected, ignored],
    testFiles: [selected, ignored],
    readModuleSource: (moduleFile) => ({
      'platform/shared/virtual-source.ts': 'export const identity = <T,>(value: T): T => value;',
      [selected]: [
        '#!/usr/bin/env bun',
        "import { identity } from '../../platform/shared/virtual-source.ts';",
        'void identity(1);'
      ].join('\n'),
      [ignored]: "const text = \"import '../../platform/shared/virtual-source.ts'\"; void text;"
    })[moduleFile] ?? null
  };

  const selection = selectTestsForSources(['platform/shared/virtual-source.ts'], provider);
  expect(selection.fast).toContain(selected);
  expect(selection.fast).not.toContain(ignored);
});

test('a deleted local module makes the dependency graph unresolved before test execution', () => {
  const consumer = 'tests/unit/retired-owner-consumer.test.ts';
  const provider: CodexDevelopmentTestImpactSourceProviderV2 = {
    moduleFiles: [consumer],
    testFiles: [consumer],
    readModuleSource: () => "import '../../tooling/sec-dev/retired-owner.ts';"
  };

  expect(resolveTestImpactSelectionTrustBoundary(provider)).toEqual({
    selectionResolved: false,
    unresolvedModuleFiles: [consumer]
  });
});

test('module impact follows facades and test helpers transitively', () => {
  const source = 'platform/shared/virtual-source.ts';
  const facade = 'platform/shared/virtual-facade.ts';
  const helper = 'tests/helpers/virtual-facade.ts';
  const selected = 'tests/unit/virtual-facade.test.ts';
  const provider: CodexDevelopmentTestImpactSourceProviderV2 = {
    moduleFiles: [source, facade, helper, selected],
    testFiles: [selected],
    readModuleSource: (moduleFile) => ({
      [source]: 'export const value = 1;',
      [facade]: "export { value } from './virtual-source.ts';",
      [helper]: "export { value } from '../../platform/shared/virtual-facade.ts';",
      [selected]: "import { value } from '../helpers/virtual-facade.ts'; void value;"
    })[moduleFile] ?? null
  };

  expect(selectTestsForSources([source], provider)).toEqual({
    fast: [selected],
    slow: [],
    owners: ['module-graph']
  });
});

test('ownership declarations contain only valid supplemental evidence', () => {
  const tests = new Set(getTestFilesSync());

  for (const declaration of testOwnershipDeclarations) {
    expect(
      declaration.sourceFiles !== undefined
      || declaration.sourcePrefixes !== undefined
      || declaration.sourceKinds !== undefined
      || declaration.removedSourceTransitions !== undefined
    ).toBe(true);
    expectUnique(declaration.supplementalFast);
    expectUnique(declaration.supplementalSlow);
    expect(declaration.supplementalFast.filter((file) => declaration.supplementalSlow.includes(file)))
      .toEqual([]);
    for (const file of declaration.supplementalFast) {
      expect(tests.has(file), `${declaration.owner} references missing fast evidence ${file}`).toBe(true);
      expect(isFastTestFile(file), `${declaration.owner} misclassifies fast evidence ${file}`).toBe(true);
    }
    for (const file of declaration.supplementalSlow) {
      expect(tests.has(file), `${declaration.owner} references missing slow evidence ${file}`).toBe(true);
      expect(isSlowTestFile(file), `${declaration.owner} misclassifies slow evidence ${file}`).toBe(true);
    }
  }
});

test('ownership closure mode is explicit and conflicts fail closed', () => {
  const declaredOnly: TestOwnershipDeclaration = {
    owner: 'declared-only-owner',
    identity: { kind: 'contract', id: 'declared-only-owner' },
    closureMode: 'declared-only',
    sourceFiles: ['platform/shared/test-impact-rules/governance.ts'],
    supplementalFast: [],
    supplementalSlow: []
  };
  const included: TestOwnershipDeclaration = {
    owner: 'included-owner',
    identity: { kind: 'contract', id: 'included-owner' },
    closureMode: 'include',
    sourceFiles: ['platform/shared/test-impact-rules/governance.ts'],
    supplementalFast: [],
    supplementalSlow: []
  };

  expect(resolveTestOwnershipClosureMode([])).toBe('include');
  expect(resolveTestOwnershipClosureMode([declaredOnly])).toBe('declared-only');
  expect(() => resolveTestOwnershipClosureMode([declaredOnly, included]))
    .toThrow('conflicting closure modes');
});

test('the governance registry uses its declared-only owner without reverse-import or product e2e closure', () => {
  const registryDeclarations = testOwnershipDeclarations.filter((declaration) => (
    matchesTestOwnershipDeclaration(
      declaration,
      'platform/shared/test-impact-rules/governance.ts'
    )
  ));
  expect(registryDeclarations).toHaveLength(1);
  expect(registryDeclarations[0]?.closureMode).toBe('declared-only');

  const selection = selectTestsForSources(['platform/shared/test-impact-rules/governance.ts']);

  expect(selection).toEqual({
    fast: [
      'tests/contract/test-impact.test.ts',
      'tests/unit/ci-pr-risk-selection.test.ts'
    ],
    slow: [],
    owners: ['test-impact-governance-registry']
  });
  expect(selection.owners).not.toContain('module-graph');
  expect(selection.slow.some((file) => file.startsWith('tests/e2e/'))).toBe(false);
});

test('fallback declarations contain valid evidence and never target test sources', () => {
  const tests = new Set(getTestFilesSync());
  for (const rule of testImpactFallbackRules) {
    expectUnique(rule.fast);
    expectUnique(rule.slow);
    for (const file of rule.fast) {
      expect(tests.has(file), `${rule.owner} references missing fast evidence ${file}`).toBe(true);
      expect(isFastTestFile(file), `${rule.owner} misclassifies fast evidence ${file}`).toBe(true);
    }
    for (const file of rule.slow) {
      expect(tests.has(file), `${rule.owner} references missing slow evidence ${file}`).toBe(true);
      expect(isSlowTestFile(file), `${rule.owner} misclassifies slow evidence ${file}`).toBe(true);
    }
    expect(getTestFilesSync().some((file) => rule.sourcePattern.test(file))).toBe(false);
  }
});

test('every reviewed process capability reaches an explicit verification closure', () => {
  for (const identity of TCB_REVIEWED_PROCESS_DISPATCHERS) {
    const source = identity.split('::', 1)[0]!;
    const selection = selectTestsForSources([source]);
    expect(selection.fast.length + selection.slow.length, identity).toBeGreaterThan(0);
    expect(selection.owners, identity).not.toEqual(['module-graph']);
  }
});

test('Verification Action canonical owners select direct behavior and boundary evidence', () => {
  const selection = selectTestsForSources([
    'tooling/sec-dev/verification-action-runner.ts',
    'tooling/sec-dev/verification-action-journal.ts'
  ]);

  expect(selection.owners).toEqual(expect.arrayContaining(['module-graph', 'verification-action-runtime']));
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/contract/verification-action-tooling-boundary.test.ts',
    'tests/unit/verification-action-journal.test.ts',
    'tests/unit/verification-action-runner.test.ts',
    'tests/unit/verification-session-runtime.test.ts'
  ]));
});

test('semantic resources retain explicit behavior evidence while unmapped sources stay narrow', () => {
  const manifest = selectTestsForSources(['platform/registry/official/ticket.basic/block.manifest.yaml']);
  expect(manifest.owners).toContain('registry-manifest');
  expect(manifest.slow).toContain('tests/e2e/registry.test.ts');

  const sourceModel = selectTestsForSources(['source/model/app.plan.yaml']);
  expect(sourceModel.owners).toContain('source-model');
  expect(sourceModel.fast.length).toBeGreaterThan(0);
  expect(sourceModel.slow).toContain('tests/e2e/semantic-runtime-contract.test.ts');

  expect(selectTestsForSources(['platform/shared/unmapped-helper.ts'])).toEqual({
    fast: [],
    slow: [],
    owners: []
  });
});
