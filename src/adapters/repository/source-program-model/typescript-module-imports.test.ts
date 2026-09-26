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

function fixtureProgram(source: string, fileName = 'src/a.ts', verbatimModuleSyntax: boolean | undefined = true) {
  const sources = new Map([[fileName, source], ['src/b.ts', targetSource]]);
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
    module: ts.ModuleKind.ESNext, verbatimModuleSyntax
  }, host);
  return { program, sourceFiles: [...files.values()], repositoryPath: (file: ts.SourceFile) => file.fileName };
}

for (const { name, source, imports, unresolved } of cases) {
  test(`module observation: ${name}`, () => {
    const facts = typeScriptModuleImportFacts(fixtureProgram(source));
    assert.deepEqual(facts.imports.map(({ kind, specifier, typeOnly }) => ({ kind, specifier, typeOnly })), imports);
    assert.deepEqual(facts.unresolvedFiles, unresolved ? ['src/a.ts'] : []);
    assert.ok(Object.isFrozen(facts));
    assert.ok(Object.isFrozen(facts.imports));
    assert.ok(Object.isFrozen(facts.unresolvedFiles));
  });
}

test('unresolved loader observations survive graph assembly alongside known reverse edges', () => {
  const facts = typeScriptModuleImportFacts(fixtureProgram("import {value} from './b.ts'; void import(target);"));
  const graph = assembleRepositoryModuleGraph({ files: ['src/a.ts', 'src/b.ts'], ...facts });
  assert.deepEqual(graph.directRuntimeDependencies('src/a.ts'), ['src/b.ts']);
  assert.deepEqual(graph.directConsumers('src/b.ts'), ['src/a.ts']);
  assert.deepEqual(graph.unresolvedFiles, ['src/a.ts']);
});

const emitCases = [
  "import type { Value } from './b.ts';", "import { type Value } from './b.ts';",
  "import { type A, type B } from './b.ts';", "import {} from './b.ts';",
  "import './b.ts';", "import { value } from './b.ts';",
  "export type { Value } from './b.ts';", "export { type Value } from './b.ts';",
  "export {} from './b.ts';", "export * from './b.ts';",
  "export type * from './b.ts';", "export type * as types from './b.ts';",
  "import type * as types from './b.ts';", "type V = import('./b.ts').Value;",
  "void import('./b.ts');"
];

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

test('runtime edges agree with actual verbatim compiler emit, including every pair in both orders', () => {
  for (const first of emitCases) {
    for (const second of ['', ...emitCases]) {
      const source = `${first}\n${second}`;
      const facts = typeScriptModuleImportFacts(fixtureProgram(source));
      const observed = [...new Set(facts.imports.filter((item) => !item.typeOnly)
        .map((item) => item.specifier))].sort();
      assert.deepEqual(observed, emittedModuleDependencies(source), source);
    }
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

test('a different compiler erasure profile cannot be silently treated as canonical', () => {
  const fixture = fixtureProgram("import {type Value} from './b.ts';", 'src/a.ts', false);
  assert.throws(() => typeScriptModuleImportFacts(fixture), /verbatimModuleSyntax/);
  delete fixture.program.getCompilerOptions().verbatimModuleSyntax;
  assert.throws(() => typeScriptModuleImportFacts(fixture), /verbatimModuleSyntax/);
});
