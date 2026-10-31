import { expect, test } from 'bun:test';

import { sourceInput } from './test/typescript-model-input.ts';
import {
  assertSourceProgramTypeScriptRequiredApiClosure,
  compileTypeScriptSourceProgramModel,
  sourceProgramTypeScriptRequiredApiClosure,
  type SourceProgramTypeScriptRequiredApiClosure
} from './typescript.ts';

function compile(source: string): SourceProgramTypeScriptRequiredApiClosure {
  const model = compileTypeScriptSourceProgramModel(sourceInput({ 'src/example.ts': source }));
  const closure = sourceProgramTypeScriptRequiredApiClosure(model);
  if (closure === null) throw new Error('Expected one exact TypeScript API closure');
  return closure;
}

test('Source Program derives stable TypeScript API requirements from bound symbols', () => {
  const closure = compile(
    "import ts, { factory as syntaxFactory } from 'typescript';\n"
    + 'export function inspect(program: ts.Program): number {\n'
    + "  syntaxFactory.createIdentifier('value');\n"
    + '  return program.getTypeChecker().getSymbolCount() + ts.SyntaxKind.Identifier;\n'
    + '}\n'
  );

  assertSourceProgramTypeScriptRequiredApiClosure(closure);
  expect(() => assertSourceProgramTypeScriptRequiredApiClosure({
    ...closure
  } as SourceProgramTypeScriptRequiredApiClosure)).toThrow('not Source Program issued');
  expect(closure.unknowns).toEqual([]);
  expect(closure.requirements.map(({ apiPath, space }) => `${space}:${apiPath}`)).toEqual([
    'type:Program',
    'value:SyntaxKind.Identifier',
    'value:factory.createIdentifier'
  ]);
  expect(closure.requirements.every(({ consumerPaths }) => (
    consumerPaths.length === 1 && consumerPaths[0] === 'src/example.ts'
  ))).toBeTrue();
});

test('Source Program blocks dynamic and unstable TypeScript surfaces', () => {
  const closure = compile(
    "import ts from 'typescript';\n"
    + "import { createNode } from 'typescript/unstable/ast';\n"
    + 'export function inspect(key: string): unknown {\n'
    + '  void createNode;\n'
    + '  return ts[key];\n'
    + '}\n'
  );

  expect(closure.unknowns.map(({ code }) => code)).toEqual([
    'typescript-computed-api-unresolved',
    'typescript-unstable-entrypoint'
  ]);
});
