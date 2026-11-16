import { expect, test } from 'bun:test';

import { sourceInput } from './test/typescript-model-input.ts';
import {
  assertSourceProgramTypeScriptRequiredApiClosure,
  compileTypeScriptSourceProgramModel,
  sourceProgramTypeScriptRequiredApiClosure,
  type SourceProgramTypeScriptRequiredApiClosure
} from './typescript.ts';

test('Source Program preserves bound TypeScript API requirements while rejecting dynamic and unstable surfaces', () => {
  // Keep the positive and negative source witnesses independent within one
  // model compilation, so the negative import does not define positive API usage.
  const model = compileTypeScriptSourceProgramModel(sourceInput({
    'src/example.ts': "import ts, { factory as syntaxFactory } from 'typescript';\n"
      + 'export function inspect(program: ts.Program): number {\n'
      + "  syntaxFactory.createIdentifier('value');\n"
      + '  return program.getTypeChecker().getSymbolCount() + ts.SyntaxKind.Identifier;\n'
      + '}\n',
    'src/unstable.ts': "import ts from 'typescript';\n"
      + "import { createNode } from 'typescript/unstable/ast';\n"
      + 'export function inspect(key: string): unknown {\n'
      + '  void createNode;\n'
      + '  return ts[key];\n'
      + '}\n'
  }));
  const closure = sourceProgramTypeScriptRequiredApiClosure(model);
  if (closure === null) throw new Error('Expected one exact TypeScript API closure');

  assertSourceProgramTypeScriptRequiredApiClosure(closure);
  expect(() => assertSourceProgramTypeScriptRequiredApiClosure({
    ...closure
  } as SourceProgramTypeScriptRequiredApiClosure)).toThrow('not Source Program issued');
  expect(closure.requirements.map(({ apiPath, space }) => `${space}:${apiPath}`)).toEqual([
    'type:Program',
    'value:SyntaxKind.Identifier',
    'value:factory.createIdentifier'
  ]);
  expect(closure.requirements.every(({ consumerPaths }) => (
    consumerPaths.length === 1 && consumerPaths[0] === 'src/example.ts'
  ))).toBeTrue();
  expect(closure.unknowns).toEqual([
    expect.objectContaining({
      code: 'typescript-computed-api-unresolved',
      path: 'src/unstable.ts'
    }),
    expect.objectContaining({
      code: 'typescript-unstable-entrypoint',
      path: 'src/unstable.ts'
    })
  ]);
});
