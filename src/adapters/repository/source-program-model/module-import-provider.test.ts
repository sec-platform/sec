import { expect, test } from 'bun:test';
import assert from 'node:assert/strict';

import { assembleRepositoryModuleGraph as assemble, resolveRepositoryModuleImportCandidates as candidates } from './module-graph.ts';
import { compileSourceProgramRepositoryModuleGraph } from './source-program-module-graph.ts';

function compileFixture(sources: Readonly<Record<string, string>>) {
  const paths = Object.keys(sources);
  return compileSourceProgramRepositoryModuleGraph({
    files: paths,
    readSource: (repositoryPath) => sources[repositoryPath] ?? null
  });
}

test('TypeScript compiler supplies JSON and triple-slash dependencies to the canonical graph', () => {
  const graph = compileFixture({
    'src/example/main.ts': [
      '/// <reference path="./ambient.d.ts" />',
      "import values from './values.json';",
      'export const value = values;',
      ''
    ].join('\n'),
    'src/example/ambient.d.ts': 'declare const ambient: string;\n',
    'src/example/values.json': '{"ready":true}\n'
  });

  expect(graph.directDependencies('src/example/main.ts')).toEqual([
    'src/example/ambient.d.ts',
    'src/example/values.json'
  ]);
  expect(graph.unresolvedFiles).toEqual([]);
});

test('missing relative resource and triple-slash targets fail closed in the same graph', () => {
  const graph = compileFixture({
    'src/example/main.ts': [
      '/// <reference path="./missing.d.ts" />',
      "import values from './missing.json';",
      'export const value = values;',
      ''
    ].join('\n')
  });

  expect(graph.references.map(({ specifier }) => specifier)).toEqual([
    './missing.d.ts',
    './missing.json'
  ]);
  expect(graph.unresolvedFiles).toEqual(['src/example/main.ts']);
});

test('compiler syntax preserves import kinds and every precompilation reference class', () => {
  const graph = compileFixture({
    'src/example/main.ts': [
      '/// <reference types="node" />',
      '/// <reference lib="es2022" />',
      "import './shared.ts';",
      "void import('./shared.ts');",
      "require('./shared.ts');",
      ''
    ].join('\n'),
    'src/example/shared.ts': 'export const value = 1;'
  });

  expect(graph.references.map(({ from: _from, candidateTargets: _candidates, resolvedTarget: _target, ...reference }) => reference)).toEqual([
    { kind: 'dynamic', specifier: './shared.ts', typeOnly: false },
    { kind: 'require', specifier: './shared.ts', typeOnly: false },
    { kind: 'static', specifier: './shared.ts', typeOnly: false },
    { kind: 'static', specifier: 'es2022', typeOnly: true },
    { kind: 'static', specifier: 'node', typeOnly: true }
  ]);
  expect(graph.directConsumers('src/example/shared.ts')).toEqual(['src/example/main.ts']);
  for (const query of [graph.directDependencies, graph.directRuntimeDependencies]) {
    const paths = query('src/example/main.ts');
    expect(paths).toEqual(['src/example/shared.ts']);
    expect(Reflect.set(paths, 0, 'injected')).toBe(false);
    expect(query('src/example/main.ts')).toEqual(['src/example/shared.ts']);
  }
});

test('ordinary TypeScript import facts cannot be replaced by an embedded-language provider', () => {
  let providerCalls = 0;
  const graph = compileSourceProgramRepositoryModuleGraph({
    files: ['src/example/main.ts', 'src/example/value.ts'],
    readSource: (repositoryPath) => repositoryPath === 'src/example/main.ts'
      ? "export { value } from './value.ts';"
      : 'export const value = true;',
    readEmbeddedLanguageImports: () => {
      providerCalls += 1;
      return [{ kind: 'static', specifier: './foreign.ts', typeOnly: false }];
    }
  });

  expect(providerCalls).toBe(0);
  expect(graph.directDependencies('src/example/main.ts')).toEqual(['src/example/value.ts']);
});


test('canonical frontend joins unresolved, type-only and runtime observations without losing reverse edges', () => {
  const sources = new Map([
    ['src/a.ts', "type Value = import('./b.ts').Value; import { value } from './c.ts'; void import(target);"],
    ['src/b.ts', 'export type Value = string;'],
    ['src/c.ts', 'export const value = 1;']
  ]);
  const graph = compileSourceProgramRepositoryModuleGraph({
    files: [...sources.keys()],
    readSource: (file) => sources.get(file) ?? null
  });
  expect(graph.unresolvedFiles).toEqual(['src/a.ts']);
  expect(graph.directDependencies('src/a.ts')).toEqual(['src/b.ts', 'src/c.ts']);
  expect(graph.directRuntimeDependencies('src/a.ts')).toEqual(['src/c.ts']);
  expect(graph.directConsumers('src/c.ts')).toEqual(['src/a.ts']);
});

test('canonical frontend preserves empty-runtime imports left by inline type specifiers', () => {
  const graph = compileFixture({
    'src/statement.ts': "import type { Value } from './provider.ts';",
    'src/inline.ts': "import { type Value } from './provider.ts';",
    'src/reexport.ts': "export { type Value } from './provider.ts';",
    'src/provider.ts': 'export type Value = string;'
  });
  expect(graph.directDependencies('src/statement.ts')).toEqual(['src/provider.ts']);
  expect(graph.directRuntimeDependencies('src/statement.ts')).toEqual([]);
  expect(graph.directRuntimeDependencies('src/inline.ts')).toEqual(['src/provider.ts']);
  expect(graph.directRuntimeDependencies('src/reexport.ts')).toEqual(['src/provider.ts']);
  expect(graph.directConsumers('src/provider.ts')).toEqual([
    'src/inline.ts', 'src/reexport.ts', 'src/statement.ts'
  ]);
});

test('lexical resolution retains ordered candidates, exact first targets and missing-target reverse impact', () => {
  const precedence = [
    'src/target.ts', 'src/target.tsx', 'src/target.mts', 'src/target.cts',
    'src/target.js', 'src/target.jsx', 'src/target.mjs', 'src/target.cjs',
    'src/target/index.ts', 'src/target/index.tsx',
    'src/target/index.mts', 'src/target/index.cts'
  ];
  assert.deepEqual(candidates('src/a.ts', './target'), precedence);
  assert.deepEqual(candidates('src/a.ts', './target.js'), [
    'src/target.js', 'src/target.ts', 'src/target.tsx', 'src/target.mts', 'src/target.cts'
  ]);
  assert.deepEqual(candidates('src/a.ts', './target.ts'), ['src/target.ts']);
  const reference = { from: 'src/a.ts', specifier: './target', typeOnly: false, kind: 'static' as const };
  const selections = [[], precedence, ...precedence.map(target => [target]),
    ...precedence.flatMap((target, index) => precedence.slice(index + 1).map(later => [target, later]))];
  for (const admitted of selections) {
    const expected = admitted.slice(0, 1);
    for (const ordered of admitted.length < 2 ? [admitted] : [admitted, [...admitted].reverse()]) {
      const graph = assemble({ files: ['src/a.ts', ...ordered], imports: [reference] });
      assert.deepEqual(graph.directDependencies('src/a.ts'), expected, `admitted=${admitted.join(",")}`);
      assert.deepEqual(graph.directRuntimeDependencies('src/a.ts'), expected, `admitted=${admitted.join(",")}`);
      assert.equal(graph.references[0]!.resolvedTarget, expected[0] ?? null);
      assert.deepEqual(graph.unresolvedFiles, expected.length === 0 ? ['src/a.ts'] : []);
      for (const target of precedence) {
        assert.deepEqual(graph.directConsumers(target), ['src/a.ts']);
      }
    }
  }
});
