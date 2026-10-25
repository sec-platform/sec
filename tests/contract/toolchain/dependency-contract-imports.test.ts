import { expect, test } from 'bun:test';
import ts from 'typescript';

import { readCompilerTypeScriptMutationFixture } from '../../helpers/compiler-fixtures.ts';

const CONTRACT =
  'src/adapters/toolchain/dependencies/runtime/dependency-transition/contract.ts';
const PHYSICAL_RUNTIME_FRAGMENT = '/physical/runtime/';

test('dependency transition contract keeps physical-provider imports type-only', async () => {
  const source = await readCompilerTypeScriptMutationFixture(CONTRACT, 'tcb-analysis');
  const sourceAst = ts.createSourceFile(CONTRACT, source, ts.ScriptTarget.Latest, true);
  const physicalImports = sourceAst.statements
    .filter(ts.isImportDeclaration)
    .filter((node) => ts.isStringLiteralLike(node.moduleSpecifier)
      && node.moduleSpecifier.text.includes(PHYSICAL_RUNTIME_FRAGMENT));
  // Removing a type dependency is allowed; introducing a runtime dependency is not.
  for (const node of physicalImports) expect(node.importClause?.isTypeOnly).toBe(true);
});
