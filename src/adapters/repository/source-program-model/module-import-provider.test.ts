import { expect, test } from 'bun:test';
import assert from 'node:assert/strict';

import { assembleRepositoryModuleGraph as assemble, resolveRepositoryModuleImportCandidates as candidates } from './module-graph.ts';
import { compileSourceProgramRepositoryModuleGraph } from './source-program-module-graph.ts';
import { sourceProgramModuleImports } from './embedded-programs.ts';

const workflowPath = '.github/workflows/embedded-program.test.yml';
const repeatedWorkflowImport = [
  'name: embedded-program',
  'on: workflow_dispatch',
  'jobs:',
  '  inspect:',
  '    steps:',
  '      - uses: actions/github-script@0123456789012345678901234567890123456789',
  '        with:',
  '          script: |',
  "            const crypto = require('node:crypto');",
  '            await import(process.env.INSPECTOR_MODULE);',
  '      - uses: actions/github-script@0123456789012345678901234567890123456789',
  '        with:',
  '          script: |',
  "            require('node:crypto');"
].join('\n');

test('one canonical graph compilation preserves JSON, syntax, unresolved, embedded and reverse-edge obligations', () => {
  const sources = new Map<string, string>([
    ['src/example/main.ts', [
      '/// <reference path="./ambient.d.ts" />',
      "import values from './values.json';",
      'export const value = values;', ''
    ].join('\n')],
    ['src/example/ambient.d.ts', 'declare const ambient: string;\n'],
    ['src/example/values.json', '{"ready":true}\n'],
    ['src/missing/main.ts', [
      '/// <reference path="./missing.d.ts" />',
      "import values from './missing.json';",
      'export const value = values;', ''
    ].join('\n')],
    ['src/kinds/main.ts', [
      '/// <reference types="node" />',
      '/// <reference lib="es2022" />',
      "import './shared.ts';",
      "void import('./shared.ts');",
      "require('./shared.ts');", ''
    ].join('\n')],
    ['src/kinds/shared.ts', 'export const value = 1;'],
    ['src/a.ts', "type Value = import('./b.ts').Value; import { value } from './c.ts'; void import(target);"],
    ['src/b.ts', 'export type Value = string;'],
    ['src/c.ts', 'export const value = 1;'],
    ['src/provider/main.ts', "export { value } from './value.ts';"],
    ['src/provider/value.ts', 'export const value = true;'],
    [workflowPath, repeatedWorkflowImport]
  ]);
  const embeddedCalls: string[] = [];
  const graph = compileSourceProgramRepositoryModuleGraph({
    files: [...sources.keys()],
    readSource: (path) => sources.get(path) ?? null,
    readEmbeddedLanguageImports: (path, source) => {
      embeddedCalls.push(path);
      return sourceProgramModuleImports(path, source);
    }
  });

  // The independent paths remain separate failure witnesses inside one
  // TypeScript program and one graph assembly.
  expect(graph.directDependencies('src/example/main.ts')).toEqual([
    'src/example/ambient.d.ts', 'src/example/values.json'
  ]);
  expect(graph.references.filter(({ from }) => from === 'src/missing/main.ts')
    .map(({ specifier }) => specifier)).toEqual(['./missing.d.ts', './missing.json']);
  expect(graph.unresolvedFiles).toContain('src/missing/main.ts');

  expect(graph.references
    .filter(({ from }) => from === 'src/kinds/main.ts')
    .map(({ from: _from, candidateTargets: _candidates, resolvedTarget: _target, ...reference }) => reference)
  ).toEqual([
    { kind: 'dynamic', specifier: './shared.ts', typeOnly: false },
    { kind: 'require', specifier: './shared.ts', typeOnly: false },
    { kind: 'static', specifier: './shared.ts', typeOnly: false },
    { kind: 'static', specifier: 'es2022', typeOnly: true },
    { kind: 'static', specifier: 'node', typeOnly: true }
  ]);
  expect(graph.directConsumers('src/kinds/shared.ts')).toEqual(['src/kinds/main.ts']);
  for (const query of [graph.directDependencies, graph.directRuntimeDependencies]) {
    const paths = query('src/kinds/main.ts');
    expect(paths).toEqual(['src/kinds/shared.ts']);
    expect(Reflect.set(paths, 0, 'injected')).toBe(false);
    expect(query('src/kinds/main.ts')).toEqual(['src/kinds/shared.ts']);
  }

  expect(graph.unresolvedFiles).toContain('src/a.ts');
  expect(graph.directDependencies('src/a.ts')).toEqual(['src/b.ts', 'src/c.ts']);
  expect(graph.directRuntimeDependencies('src/a.ts')).toEqual(['src/c.ts']);
  expect(graph.directConsumers('src/c.ts')).toEqual(['src/a.ts']);

  // Embedded imports are consumed from YAML, not from a TypeScript parse;
  // the same imported builtin produces one graph edge for two script steps.
  expect(embeddedCalls).toContain(workflowPath);
  expect(embeddedCalls.filter((path) => path.endsWith('.ts'))).toEqual([]);
  expect(graph.unresolvedFiles).not.toContain(workflowPath);
  expect(graph.references.filter(({ from }) => from === workflowPath)).toEqual([
    expect.objectContaining({
      from: workflowPath, kind: 'require', specifier: 'node:crypto', resolvedTarget: null
    })
  ]);
  expect(graph.directDependencies('src/provider/main.ts')).toEqual(['src/provider/value.ts']);
  expect(graph.references.filter(({ from }) => from === 'src/provider/main.ts'))
    .toEqual([expect.objectContaining({ specifier: './value.ts', resolvedTarget: 'src/provider/value.ts' })]);
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
  // The exact candidate order is asserted above; Array.find and Set membership
  // own pairwise precedence. Keep absence, every candidate, and reordered input.
  const selections = [[], precedence, ...precedence.map(target => [target])];
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
