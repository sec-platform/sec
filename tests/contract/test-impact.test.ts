import { expect, test } from 'bun:test';
import path from 'node:path';

import { rawSha256 } from '../../src/system-architecture/foundation/runtime/canonical.ts';
import { compileTypeScriptSourceProgramModel } from '../../src/brownfield/source-program-model/typescript.ts';
import { compileSecRepositoryModuleMembership } from '../../src/system-architecture/repository-modules/contract.ts';
import { currentActiveDocumentationPaths } from '../../src/control/documentation/active.ts';
import { classifyTestImpactSource } from '../../src/verification/test-impact/contract/ownership.ts';
import { createTestImpactSourceProvider, readRepositoryModuleGraphV1, resolveTestImpactSelectionTrustBoundary, resolveTestOwnership, selectTestsForSources } from '../../src/verification/test-impact/runtime/impact.ts';

const repositoryRoot = path.resolve(import.meta.dir, '../..');
const moduleMembership = compileSecRepositoryModuleMembership(repositoryRoot);

function sourceProvider(sources: Readonly<Record<string, string>>) {
  const repositoryFiles = Object.keys(sources);
  return createTestImpactSourceProvider({
    repositoryFiles,
    moduleMembership,
    activeDocumentationPaths: currentActiveDocumentationPaths(),
    readModuleSource: (moduleFile) => sources[moduleFile] ?? null
  });
}

function semanticSourceProvider(sources: Readonly<Record<string, string>>) {
  const repositoryFiles = Object.keys(sources).sort();
  const sourceProgramModel = compileTypeScriptSourceProgramModel({
    sourceRevision: rawSha256(JSON.stringify(sources)),
    files: repositoryFiles.map((repositoryPath) => ({
      path: repositoryPath,
      source: sources[repositoryPath]!,
      contentDigest: rawSha256(sources[repositoryPath]!)
    })),
    moduleMembership
  });
  return createTestImpactSourceProvider({
    repositoryFiles,
    moduleMembership,
    activeDocumentationPaths: currentActiveDocumentationPaths(),
    sourceProgramModel,
    readModuleSource: (moduleFile) => sources[moduleFile] ?? null
  });
}

function expectUnique(values: readonly string[]): void {
  expect(new Set(values).size).toBe(values.length);
}

test('repository sources route by semantic kind and module identity', () => {
  expect(classifyTestImpactSource('catalog/registry/official/ticket.basic/block.manifest.yaml'))
    .toBe('manifest');
  expect(classifyTestImpactSource('source/model/app.plan.yaml')).toBe('source-model');
  expect(classifyTestImpactSource('.github/workflows/compiler-pr-validation.yml')).toBe('workflow');
  expect(classifyTestImpactSource('docs/roadmap.md')).toBe('active-documentation');
  expect(classifyTestImpactSource('docs/unregistered.manifest.yaml')).toBeNull();

  const compilerFixturePath = 'src/compiler/fixture.ts';
  expect(resolveTestOwnership([compilerFixturePath])).toEqual([{
    source: compilerFixturePath,
    owner: 'compiler',
    identity: { kind: 'module', id: 'compiler' }
  }]);
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

test('impact follows executable imports instead of import-like text', () => {
  const source = 'src/compiler/virtual-source.ts';
  const facade = 'src/compiler/virtual-entrypoint.ts';
  const helper = 'tests/helpers/virtual-facade.ts';
  const selected = 'tests/unit/virtual-facade.test.ts';
  const ignored = 'tests/unit/virtual-import-text.test.ts';
  const provider = sourceProvider({
      [source]: 'export const value = 1;',
      [facade]: "export { value } from './virtual-source.ts';",
      [helper]: "export { value } from '../../src/compiler/virtual-entrypoint.ts';",
      [selected]: "import { value } from '../helpers/virtual-facade.ts'; void value;",
      [ignored]: "const text = \"import '../../src/compiler/virtual-source.ts'\"; void text;"
  });

  const selection = selectTestsForSources([source], provider);
  expect(selection.fast).toEqual([selected]);
  expect(selection.slow).toEqual([]);
  expect(selection.owners).toEqual(['compiler']);
});

test('compiler-resolved named barrel references do not select unrelated consumers', () => {
  const alpha = 'src/compiler/virtual-alpha.ts';
  const beta = 'src/compiler/virtual-beta.ts';
  const facade = 'src/compiler/virtual-public.ts';
  const alphaTest = 'tests/unit/virtual-alpha.test.ts';
  const betaTest = 'tests/unit/virtual-beta.test.ts';
  const provider = semanticSourceProvider({
    [alpha]: 'export const alpha = 1;',
    [beta]: 'export const beta = 2;',
    [facade]: "export { alpha } from './virtual-alpha.ts';\nexport { beta } from './virtual-beta.ts';",
    [alphaTest]: "import { alpha } from '../../src/compiler/virtual-public.ts'; void alpha;",
    [betaTest]: "import { beta } from '../../src/compiler/virtual-public.ts'; void beta;"
  });

  expect(selectTestsForSources([alpha], provider).fast).toEqual([alphaTest]);
  expect(selectTestsForSources([beta], provider).fast).toEqual([betaTest]);
  expect(selectTestsForSources([facade], provider).fast).toEqual([alphaTest, betaTest]);
});

test('parser reuse is keyed by exact source bytes rather than size or timestamp hints', () => {
  const sourceA = 'src/compiler/virtual-source-a.ts';
  const sourceB = 'src/compiler/virtual-source-b.ts';
  const selected = 'tests/unit/virtual-source-switch.test.ts';
  const sources: Record<string, string> = {
    [sourceA]: 'export const a = 1;',
    [sourceB]: 'export const b = 1;',
    [selected]: "import '../../src/compiler/virtual-source-a.ts';"
  };
  const provider = sourceProvider(sources);

  expect(selectTestsForSources([sourceA], provider).fast).toEqual([selected]);
  const previousLength = Buffer.byteLength(sources[selected]!);
  sources[selected] = "import '../../src/compiler/virtual-source-b.ts';";
  expect(Buffer.byteLength(sources[selected]!)).toBe(previousLength);
  expect(selectTestsForSources([sourceA], provider).fast).toEqual([]);
  expect(selectTestsForSources([sourceB], provider).fast).toEqual([selected]);
});

test('deleted local dependency makes selection unresolved', () => {
  const consumer = 'tests/unit/retired-owner-consumer.test.ts';
  const provider = sourceProvider({
    [consumer]: "import '../../src/development/tooling/retired-owner.ts';"
  });

  expect(resolveTestImpactSelectionTrustBoundary(provider)).toEqual({
    selectionResolved: false,
    unresolvedModuleFiles: [consumer]
  });
});

test('imported machine data uses the same reverse dependency graph', () => {
  const data = 'src/compiler/virtual-registry.json';
  const consumer = 'src/compiler/virtual-registry-consumer.ts';
  const selected = 'tests/unit/virtual-registry-consumer.test.ts';
  const provider = sourceProvider({
      [consumer]: "import registry from './virtual-registry.json' with { type: 'json' }; export { registry };",
      [selected]: "import { registry } from '../../src/compiler/virtual-registry-consumer.ts'; void registry;"
  });

  expect(selectTestsForSources([data], provider)).toEqual({
    fast: [selected],
    slow: [],
    owners: ['compiler']
  });
});

test('non-code product inputs reach tests through semantic module owners', () => {
  const documentation = selectTestsForSources(['docs/product.md']);
  expect(documentation.owners).toContain('control.documentation');
  expect(documentation.fast).toEqual([]);
  expect(documentation.slow).toEqual([]);

  const manifest = selectTestsForSources([
    'catalog/registry/official/ticket.basic/block.manifest.yaml'
  ]);
  expect(manifest.owners).toEqual(expect.arrayContaining(['compiler', 'compiler.registry']));
  expect(manifest.fast.length + manifest.slow.length).toBeGreaterThan(0);
});
