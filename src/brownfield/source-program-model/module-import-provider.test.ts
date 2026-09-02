import { expect, test } from 'bun:test';

import {
  compileSecRepositoryModuleGraph,
  scanSecRepositoryModuleImports
} from '../../system-architecture/repository-modules/contract.ts';

function compileFixture(sources: Readonly<Record<string, string>>) {
  const paths = Object.keys(sources);
  return compileSecRepositoryModuleGraph({
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
  const imports = scanSecRepositoryModuleImports([
    '/// <reference types="node" />',
    '/// <reference lib="es2022" />',
    "import './static.ts';",
    "void import('./dynamic.ts');",
    "require('./required.ts');",
    ''
  ].join('\n'));

  expect(imports).toEqual([
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

  expect(graph.directDependencies('src/example/main.ts')).toEqual([
    'src/example/runtime.ts',
    'src/example/types.ts'
  ]);
  expect(graph.directRuntimeDependencies('src/example/main.ts')).toEqual([
    'src/example/runtime.ts'
  ]);
});
