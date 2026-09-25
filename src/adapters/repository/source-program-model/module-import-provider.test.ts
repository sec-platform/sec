import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { compileRepositoryModuleGraph } from "./typescript.ts";

function compileFixture(sources: Readonly<Record<string, string>>) {
  const paths = Object.keys(sources);
  return compileRepositoryModuleGraph({
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

  assert.deepEqual(graph.directDependencies('src/example/main.ts'), [
    'src/example/ambient.d.ts',
    'src/example/values.json'
  ]);
  assert.deepEqual(graph.unresolvedFiles, []);
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

  assert.deepEqual(graph.references.map(({ specifier }) => specifier), [
    './missing.d.ts',
    './missing.json'
  ]);
  assert.deepEqual(graph.unresolvedFiles, ['src/example/main.ts']);
});

test('compiler syntax preserves import kinds and every precompilation reference class', () => {
  const graph = compileFixture({
    'src/example/main.ts': [
      '/// <reference types="node" />',
      '/// <reference lib="es2022" />',
      "import './static.ts';",
      "void import('./dynamic.ts');",
      "require('./required.ts');",
      ''
    ].join('\n')
  });

  assert.deepEqual(graph.references.map(({ from: _from, candidateTargets: _candidates, resolvedTarget: _target, ...reference }) => reference), [
    { kind: 'dynamic', specifier: './dynamic.ts', typeOnly: false },
    { kind: 'require', specifier: './required.ts', typeOnly: false },
    { kind: 'static', specifier: './static.ts', typeOnly: false },
    { kind: 'static', specifier: 'es2022', typeOnly: true },
    { kind: 'static', specifier: 'node', typeOnly: true }
  ]);
});

test('runtime closure excludes type-only edges while compile impact retains them', () => {
  const graph = compileFixture({
    'src/example/main.ts': [
      "import type { CompileFact } from './types.ts';",
      "import { run } from './runtime.ts';",
      'export const value: CompileFact = run();',
      ''
    ].join('\n'),
    'src/example/types.ts': 'export type CompileFact = string;\n',
    'src/example/runtime.ts': "export function run(): string { return 'ready'; }\n"
  });

  assert.deepEqual(graph.directDependencies('src/example/main.ts'), [
    'src/example/runtime.ts',
    'src/example/types.ts'
  ]);
  assert.deepEqual(graph.directRuntimeDependencies('src/example/main.ts'), [
    'src/example/runtime.ts'
  ]);
});

test('ordinary TypeScript import facts cannot be replaced by an embedded-language provider', () => {
  let providerCalls = 0;
  const graph = compileRepositoryModuleGraph({
    files: ['src/example/main.ts', 'src/example/value.ts'],
    readSource: (repositoryPath) => repositoryPath === 'src/example/main.ts'
      ? "export { value } from './value.ts';"
      : 'export const value = true;',
    readImports: () => {
      providerCalls += 1;
      return [{ kind: 'static', specifier: './foreign.ts', typeOnly: false }];
    }
  });

  assert.equal(providerCalls, 0);
  assert.deepEqual(graph.directDependencies('src/example/main.ts'), ['src/example/value.ts']);
});

test('canonical frontend joins unresolved and import-type observations into its returned graph', () => {
  const sources = new Map([
    ['src/a.ts', "type Value = import('./b.ts').Value; void import(target);"],
    ['src/b.ts', 'export type Value = string;']
  ]);
  const graph = compileRepositoryModuleGraph({
    files: [...sources.keys()], readSource: (file) => sources.get(file) ?? null
  });
  assert.deepEqual(graph.unresolvedFiles, ['src/a.ts']);
  assert.deepEqual(graph.directDependencies('src/a.ts'), ['src/b.ts']);
  assert.deepEqual(graph.directRuntimeDependencies('src/a.ts'), []);
});

test('canonical frontend preserves empty-runtime imports left by inline type specifiers', () => {
  const graph = compileFixture({
    'src/statement.ts': "import type { Value } from './provider.ts';",
    'src/inline.ts': "import { type Value } from './provider.ts';",
    'src/reexport.ts': "export { type Value } from './provider.ts';",
    'src/provider.ts': 'export type Value = string;'
  });
  assert.deepEqual(graph.directRuntimeDependencies('src/statement.ts'), []);
  assert.deepEqual(graph.directRuntimeDependencies('src/inline.ts'), ['src/provider.ts']);
  assert.deepEqual(graph.directRuntimeDependencies('src/reexport.ts'), ['src/provider.ts']);
  assert.deepEqual(graph.directConsumers('src/provider.ts'), ['src/inline.ts', 'src/reexport.ts', 'src/statement.ts']);
});
