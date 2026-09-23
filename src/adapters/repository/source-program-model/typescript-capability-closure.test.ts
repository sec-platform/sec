import { expect, test } from 'bun:test';

import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import {
  assertSourceProgramTypeScriptRequiredApiClosure,
  compileTypeScriptSourceProgramModel,
  sourceProgramTypeScriptRequiredApiClosure,
  type SourceProgramTypeScriptRequiredApiClosure
} from './typescript.ts';

const moduleMembership = Object.freeze({
  descriptors: Object.freeze([]),
  graphRoots: Object.freeze([]),
  moduleRoots: Object.freeze([]),
  moduleForPath: () => null
});

function compile(source: string): SourceProgramTypeScriptRequiredApiClosure {
  const files = Object.freeze([Object.freeze({
    path: 'src/example.ts',
    source,
    contentDigest: rawSha256(source)
  })]);
  const model = compileTypeScriptSourceProgramModel({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership
  });
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

test('a structural closure cannot cross the Source Program issuer boundary', () => {
  const closure = compile("import ts from 'typescript';\nexport const compilerVersion = ts.version;\n");
  expect(() => assertSourceProgramTypeScriptRequiredApiClosure({
    ...closure
  } as SourceProgramTypeScriptRequiredApiClosure)).toThrow('not Source Program issued');
});
