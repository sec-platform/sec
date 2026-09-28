import { expect, test } from 'bun:test';
import ts from 'typescript';

import { readCompilerTypeScriptMutationFixture } from '../helpers/compiler-fixtures.ts';

const CONTRACT =
  'src/adapters/toolchain/dependencies/runtime/dependency-transition/contract.ts';
const PHYSICAL_RUNTIME_FRAGMENT = '/physical/runtime/';

test('dependency transition contract erases physical-provider type imports from runtime emission', async () => {
  const source = await readCompilerTypeScriptMutationFixture(CONTRACT, 'tcb-analysis');
  const ast = ts.createSourceFile(
    CONTRACT,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const physicalImports = ast.statements
    .filter(ts.isImportDeclaration)
    .filter((node) => (
      ts.isStringLiteral(node.moduleSpecifier)
      && node.moduleSpecifier.text.includes(PHYSICAL_RUNTIME_FRAGMENT)
    ));
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
  expect(runtimeImports.some((specifier) =>
    specifier.includes(PHYSICAL_RUNTIME_FRAGMENT)
  )).toBe(false);
});

test('regression discriminates inline type specifiers under verbatim module syntax', () => {
  const unsafe = ts.transpileModule(
    "import { type Identity } from './physical/runtime/provider.ts';",
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ESNext,
        verbatimModuleSyntax: true
      }
    }
  ).outputText;
  expect(unsafe).toMatch(/import\s*\{\s*\}\s*from/u);
  expect(unsafe).toContain('./physical/runtime/provider.ts');
});
