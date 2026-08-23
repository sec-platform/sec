import { expect, test } from 'bun:test';

import { CodexDevelopmentCreateTestImpactTransitionObservationV1 } from '../../platform/shared/ci-git-changed-files.ts';
import { selectCiPrRiskSlowSuites } from '../../platform/shared/ci-pr-risk-selection.ts';
import { TCB_REVIEWED_PROCESS_DISPATCHERS } from '../../platform/shared/tcb-closure-lock.ts';
import { getTestFilesSync, isFastTestFile, isSlowTestFile } from '../../platform/shared/test-budget-contract.ts';
import {
  classifyTestImpactSource,
  readRepositoryModuleGraphV1,
  resolveTestImpactRiskPolicies,
  resolveTestImpactSelectionTrustBoundary,
  selectTestsForSources,
  testImpactFallbackRules,
  testOwnershipDeclarations,
  type CodexDevelopmentTestImpactSourceProviderV2
} from '../../platform/shared/test-impact-contract.ts';
import { RETIRED_WORK_PACKAGE_EVIDENCE_TRANSITIONS } from '../../platform/shared/test-impact-rules/governance.ts';

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

test('imported machine data resolves through the module graph without a hand-authored path kind', () => {
  const data = 'platform/shared/virtual-registry.json';
  const consumer = 'platform/shared/virtual-registry-consumer.ts';
  const selected = 'tests/unit/virtual-registry-consumer.test.ts';
  const provider: CodexDevelopmentTestImpactSourceProviderV2 = {
    moduleFiles: [consumer, selected],
    testFiles: [selected],
    readModuleSource: (moduleFile) => ({
      [consumer]: "import registry from './virtual-registry.json' with { type: 'json' }; export { registry };",
      [selected]: "import { registry } from '../../platform/shared/virtual-registry-consumer.ts'; void registry;"
    })[moduleFile] ?? null
  };

  expect(selectTestsForSources([data], provider)).toEqual({
    fast: [selected],
    slow: [],
    owners: ['module-graph']
  });
  expect(selectCiPrRiskSlowSuites([data], provider).resolved).toBe(true);
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
    const slowEvidence = new Set<string>(declaration.supplementalSlow);
    expect(declaration.supplementalFast.filter((file) => slowEvidence.has(file)))
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

test('test runtime and runner owners retain their direct independent failure spaces', () => {
  const runtime = selectTestsForSources(['bunfig.toml', 'tests/setup/test-runtime.setup.ts']);
  expect(runtime.owners).toContain('test-process-runtime');
  expect(runtime.fast).toEqual(expect.arrayContaining([
    'tests/unit/test-process-temp.test.ts',
    'tests/unit/test-runner.test.ts'
  ]));

  const runner = selectTestsForSources(['platform/dev-runner/test-runner.ts']);
  expect(runner.owners).toContain('dev-runner');
  expect(runner.fast).toContain('tests/unit/test-runner.test.ts');
});

test('cross-lane risk is derived from the source owner without inventing test evidence', () => {
  const source = 'tests/helpers/workspace-fixtures.ts';
  expect(resolveTestImpactRiskPolicies([source])).toEqual(['slow-risk-baseline']);
  expect(selectTestsForSources([source])).toEqual({ fast: [], slow: [], owners: [] });
  expect(selectCiPrRiskSlowSuites([source])).toMatchObject({
    owners: ['bounded-slow-risk'],
    reasons: ['bounded-baseline'],
    resolved: true
  });
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

test('generated-state machine registry selects only its behavior and producer evidence', () => {
  const selection = selectTestsForSources([
    'platform/shared/generated-state-registry.json'
  ]);
  expect(selection).toEqual({
    fast: [
      'tests/integration/compiler-dependency-installation.test.ts',
      'tests/unit/generated-state-contract.test.ts',
      'tests/unit/generated-state-lifecycle.test.ts'
    ],
    slow: [],
    owners: ['generated-state-registry']
  });
});

test('retired evidence ownership requires the exact removed transition', () => {
  const retired = RETIRED_WORK_PACKAGE_EVIDENCE_TRANSITIONS[0]!;
  const headSha = 'b'.repeat(40);
  const observation = (
    status: 'added' | 'changed' | 'removed',
    baseSha: string = retired.baseSha,
    baseBlobSha: string = retired.baseBlobSha,
    baseMode: '100644' | '100755' = retired.baseMode
  ) => CodexDevelopmentCreateTestImpactTransitionObservationV1({
    baseSha,
    headSha,
    records: [{ status, path: retired.path }],
    readPathBlob: (revision) => status === 'removed' && revision === baseSha
      ? { mode: baseMode, blobSha: baseBlobSha }
      : null
  });

  expect(selectTestsForSources([retired.path])).toEqual({ fast: [], slow: [], owners: [] });
  const exact = selectTestsForSources([retired.path], undefined, observation('removed'));
  expect(exact.owners).toContain('work-package-gate');
  expect(exact.fast).toContain('tests/unit/work-package-gate-execution.test.ts');
  for (const transition of [
    observation('added'),
    observation('changed'),
    observation('removed', 'c'.repeat(40)),
    observation('removed', retired.baseSha, 'd'.repeat(40)),
    observation('removed', retired.baseSha, retired.baseBlobSha, '100755')
  ]) {
    expect(selectTestsForSources([retired.path], undefined, transition))
      .toEqual({ fast: [], slow: [], owners: [] });
  }
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
