import { expect, test } from 'bun:test';
import { sourceInput } from './test/typescript-model-input.ts';
import {
  compileTypeScriptSourceProgramModel,
  observeSourceProgramTypeScriptRename,
  observeSourceProgramTypeScriptSyntax
} from './typescript.ts';

test('TypeScript rename observations expire with their exact compiler generation', () => {
  const source = 'export const renamableSymbol = 1;\n';
  const model = compileTypeScriptSourceProgramModel(sourceInput({ 'src/example.ts': source }));
  const position = source.indexOf('renamableSymbol');
  expect(observeSourceProgramTypeScriptRename(model, 'src/example.ts', position)).toEqual(
    expect.objectContaining({ status: 'resolved', canRename: true })
  );

  const changedSource = 'export const renamableSymbol = 2;\n';
  compileTypeScriptSourceProgramModel(sourceInput({ 'src/example.ts': changedSource }));
  expect(observeSourceProgramTypeScriptRename(model, 'src/example.ts', position)).toEqual(
    expect.objectContaining({ status: 'unresolved', reason: 'generation-stale' })
  );
});

test('TypeScript syntax observations come only from an exact compiler generation', () => {
  const source = 'export const = ;\n';
  const model = compileTypeScriptSourceProgramModel(sourceInput({ 'tests/invalid.test.ts': source }));

  expect(observeSourceProgramTypeScriptSyntax(model, 'tests/invalid.test.ts')).toEqual(
    expect.objectContaining({ status: 'resolved', syntax: 'invalid' })
  );
});
