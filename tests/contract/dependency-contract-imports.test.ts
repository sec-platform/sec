import { test } from 'bun:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

import { readCompilerTypeScriptMutationFixture } from '../helpers/compiler-fixtures.ts';

test('dependency transition contract erases physical-provider type imports under the actual compiler profile', async () => {
  const source = await readCompilerTypeScriptMutationFixture(
    'src/adapters/toolchain/dependencies/runtime/dependency-transition/contract.ts', 'tcb-analysis'
  );
  const emitted = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext, verbatimModuleSyntax: true
  } }).outputText;
  const output = ts.createSourceFile('contract.js', emitted, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const runtimeImports = output.statements.filter(ts.isImportDeclaration)
    .map((node) => (node.moduleSpecifier as ts.StringLiteral).text);
  assert.ok(!runtimeImports.some((specifier) => specifier.includes('/physical/runtime/')),
    `Contract loaded a physical provider at runtime: ${runtimeImports.join(', ')}`);
  // Inline type specifiers are not a substitute for statement-level import type.
  const unsafe = ts.transpileModule("import { type Identity } from './physical/runtime/provider.ts';", {
    compilerOptions: { module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true }
  }).outputText;
  assert.match(unsafe, /import\s*\{\s*\}\s*from/);
});
