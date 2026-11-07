import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

import { assembleRepositoryModuleGraph } from './module-graph.ts';
import { typeScriptModuleImportFacts } from './typescript-module-imports.ts';
const cases: readonly {
  name: string; source: string; imports: readonly { kind: string; specifier: string; typeOnly: boolean }[];
  unresolved: boolean;
}[] = JSON.parse(readFileSync(new URL('./typescript-module-import-cases.json', import.meta.url), 'utf8'));

const targetSource = 'export type Value = string; export type A = string; export type B = number; export const value = 1;';

function fixtureProgram(source: string | Readonly<Record<string, string>>, fileName = 'src/a.ts') {
  const sources = new Map<string, string>([
    ...(typeof source === 'string' ? [[fileName, source] as const] : Object.entries(source)),
    ['src/b.ts', targetSource] as const
  ]);
  const files = new Map([...sources].map(([file, text]) => [file,
    ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true)]));
  const host: ts.CompilerHost = {
    getSourceFile: (file) => files.get(file), getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => { throw new Error('Import observation must not emit source.'); },
    getCurrentDirectory: () => '', getDirectories: () => [],
    fileExists: (file) => files.has(file), readFile: (file) => sources.get(file),
    getCanonicalFileName: (file) => file, useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n'
  };
  const program = ts.createProgram([...files.keys()], {
    noLib: true, noResolve: true, noEmit: true, target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true
  }, host);
  return { program, sourceFiles: [...files.values()], repositoryPath: (file: ts.SourceFile) => file.fileName };
}

const emitCases = [
  "import type { Value } from './b.ts';", "import { type Value } from './b.ts';",
  "import {type A, type B} from './b.ts';", "import {} from './b.ts';",
  "import './b.ts';", "import { value } from './b.ts';",
  "export type { Value } from './b.ts';", "export { type Value } from './b.ts';",
  "export {} from './b.ts';", "export * from './b.ts';",
  "export type * from './b.ts';", "export type * as types from './b.ts';",
  "import type * as types from './b.ts';", "type V = import('./b.ts').Value;",
  "void import('./b.ts');"
];

function assertObservation(
  facts: ReturnType<typeof typeScriptModuleImportFacts>,
  imports: (typeof cases)[number]['imports'],
  unresolved: boolean
): void {
  assert.deepEqual(facts.imports.map(({ kind, specifier, typeOnly }) => ({ kind, specifier, typeOnly })), imports);
  assert.deepEqual(facts.unresolvedFiles, unresolved ? ['src/a.ts'] : []);
}

// External-module cases have isolated lexical scopes; expression-only scripts
// declare no global bindings. Both can share one Program without cross-case
// symbol capture, while each case keeps its own source-path oracle.
const shareableCases = cases.filter(({ source }) => !emitCases.includes(source)
  && (/^(?:import\b(?!\s*\()|export\b)/mu.test(source)
    || /^(?:void\s+import\(|require(?:\(|\.|\[)|module(?:\.|\[))/u.test(source)));
const shareableSources = new Set(shareableCases.map(({ source }) => source));

// These are execution cohorts, not a replacement oracle or a second case inventory.
// Keep each original script intact: top-level `require`, `module` and `load`
// bindings must not leak into another case's TypeChecker symbol space.
const remainingCases = cases.filter(({ source }) =>
  !emitCases.includes(source) && !shareableSources.has(source));
const joinedNames = [
  'import type expression',
  'ordinary same-named parameter',
  'immutable require alias',
  'alias cycle is not a module loader',
  'syntax failure is not a complete graph'
] as const;
const isolatedCohorts = [
  ['immutable alias chain', 'typeof import expression', 'ordinary same-named module'],
  ['mutable alias is unresolved'],
  ['destructured commonjs factory'],
  ['bound require is unresolved'],
  ['node module namespace immutable alias'],
  ['destructured commonjs require alias', 'ordinary same-named function'],
  ['conditional loader identity remains unknown'],
  ['short circuit loader identity remains unknown'],
  ['ordinary same-named arrow']
] as const;

// The oracle consumes the compiler's JavaScript output, independently of the
// production extractor's source-level modifier rules. It checks side effects,
// not whether the imported names are ever referenced by another declaration.
function emittedModuleDependencies(source: string): readonly string[] {
  const output = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true
  } }).outputText;
  const dependencies = new Set<string>();
  const outputFile = ts.createSourceFile('output.js', output, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      dependencies.add(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      assert.ok(node.arguments[0] && ts.isStringLiteral(node.arguments[0]));
      dependencies.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(outputFile);
  return [...dependencies].sort();
}

test('runtime edges agree with verbatim compiler emit for each syntax and type/runtime union order', () => {
  const typeImport = "import type { Value } from './b.ts';";
  const runtimeImport = "import { value } from './b.ts';";
  const dynamicImport = "void import('./b.ts');";
  // Syntax classification is local. Combined observations only interact through
  // same-key runtime precedence or distinct static/dynamic kinds.
  const unions = [
    [typeImport, typeImport], [runtimeImport, runtimeImport],
    [typeImport, runtimeImport], [runtimeImport, typeImport],
    [typeImport, dynamicImport], [dynamicImport, typeImport]
  ];
  for (const source of [...emitCases, ...unions.map(parts => parts.join('\n'))]) {
    const facts = typeScriptModuleImportFacts(fixtureProgram(source));
    const exactCase = cases.find((candidate) => candidate.source === source);
    if (exactCase !== undefined) assertObservation(facts, exactCase.imports, exactCase.unresolved);
    const observed = [...new Set(facts.imports.filter((item) => !item.typeOnly)
      .map((item) => item.specifier))].sort();
    const emitted = emittedModuleDependencies(source);
    assert.deepEqual(observed, emitted, source);
    const graph = assembleRepositoryModuleGraph({ files: ['src/a.ts', 'src/b.ts'], ...facts });
    assert.deepEqual(graph.directDependencies('src/a.ts'), ['src/b.ts'], source);
    assert.deepEqual(graph.directRuntimeDependencies('src/a.ts'), emitted.map((specifier) => {
      assert.equal(specifier, './b.ts');
      return 'src/b.ts';
    }), source);
    assert.deepEqual(graph.directConsumers('src/b.ts'), ['src/a.ts'], source);
  }

  const selectedNames = [...joinedNames, ...isolatedCohorts.flat()];
  assert.deepEqual([...selectedNames].sort(),
    remainingCases.map(({ name }) => name).sort(),
    'every non-emit import scenario has exactly one grouped carrier');

  const select = (names: readonly string[]) => names.map((name) => {
    const item = remainingCases.find((candidate) => candidate.name === name);
    if (item === undefined) throw new Error(`Missing module import case: ${name}`);
    return item;
  });
  // The already-isolated external-module / expression-only group can also
  // accept these global scripts: no name they declare is read by another case.
  const joined = [...shareableCases, ...select(joinedNames)];
  const observeCohort = (items: typeof cases, prefix: string): void => {
    const sources = Object.fromEntries(items.map(({ source }, index) =>
      [`src/${prefix}-${index}.ts`, source]));
    const observed = typeScriptModuleImportFacts(fixtureProgram(sources));
    let totalImports = 0;
    for (const [index, { name, imports, unresolved }] of items.entries()) {
      const path = `src/${prefix}-${index}.ts`;
      assert.deepEqual(observed.imports.filter(({ from }) => from === path)
        .map(({ kind, specifier, typeOnly }) => ({ kind, specifier, typeOnly })), imports, name);
      assert.deepEqual(observed.unresolvedFiles.filter((from) => from === path),
        unresolved ? [path] : [], name);
      totalImports += imports.length;
    }
    assert.equal(observed.imports.length, totalImports, 'no extra module imports');
    assert.deepEqual(observed.unresolvedFiles,
      items.flatMap(({ unresolved }, index) =>
        unresolved ? [`src/${prefix}-${index}.ts`] : []).sort(),
      'no extra unresolved files');
  };
  observeCohort(joined, 'module-case');
  for (const [index, names] of isolatedCohorts.entries()) {
    observeCohort(select(names), `module-isolated-${index}`);
  }
});

test('declaration files retain dependency impact without inventing runtime evaluation', () => {
  const source = "import { Value } from './b.ts'; export { Value } from './b.ts'; import b = require('./b.ts');";
  for (const extension of ['d.ts', 'd.mts', 'd.cts']) {
    const fileName = `src/a.${extension}`;
    const facts = typeScriptModuleImportFacts(fixtureProgram(source, fileName));
    const graph = assembleRepositoryModuleGraph({ files: [fileName, 'src/b.ts'], ...facts });
    assert.deepEqual(graph.directDependencies(fileName), ['src/b.ts']);
    assert.deepEqual(graph.directRuntimeDependencies(fileName), []);
  }
});
