import { expect, test } from 'bun:test';
import ts from 'typescript';

import { readCompilerTypeScriptMutationFixture } from '../../helpers/compiler-fixtures.ts';

const CONTRACT =
  'src/adapters/toolchain/dependencies/runtime/dependency-transition/contract.ts';
const PHYSICAL_RUNTIME_FRAGMENT = '/physical/runtime/';

test('dependency transition contract erases physical-provider type imports from runtime emission', async () => {
  const source = await readCompilerTypeScriptMutationFixture(CONTRACT, 'tcb-analysis');
  // The source really declares this physical type dependency. Without the
  // source witness, removing that import entirely would make a no-runtime-
  // import assertion pass vacuously.
  const sourceAst = ts.createSourceFile(CONTRACT, source, ts.ScriptTarget.Latest, true);
  const physicalImports = sourceAst.statements
    .filter(ts.isImportDeclaration)
    .filter((node) => ts.isStringLiteralLike(node.moduleSpecifier)
      && node.moduleSpecifier.text.includes(PHYSICAL_RUNTIME_FRAGMENT));
  expect(physicalImports).toHaveLength(1);
  expect(physicalImports[0]!.importClause?.isTypeOnly).toBe(true);

  const emitted = ts.transpileModule(source, {
    fileName: CONTRACT,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
      verbatimModuleSyntax: true
    }
  }).outputText;
  const output = ts.createSourceFile(
    'contract.js',
    emitted,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const runtimeImports = output.statements
    .filter(ts.isImportDeclaration)
    .map((node) => (node.moduleSpecifier as ts.StringLiteral).text);
  // A functioning emitter preserves genuine value imports while excluding
  // the TypeScript-only physical capability. Both sides are independently
  // grounded by the currently adopted source contract.
  expect(runtimeImports).toContain('node:path');
  expect(runtimeImports.some((specifier) =>
    specifier.includes(PHYSICAL_RUNTIME_FRAGMENT)
  )).toBe(false);
});
