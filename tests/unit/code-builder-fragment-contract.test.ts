import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { CodeBuilder } from '../../src/adapters/targets/typescript/code-builder.ts';

function statements(builder: CodeBuilder) {
  return ts.createSourceFile('generated.ts', builder.getText(), ts.ScriptTarget.Latest, true).statements;
}

for (const [name, add] of [
  ['trailing expression statement', (builder: CodeBuilder) => builder.addVariable({ name: 'value', initializer: '1; const silentlyDropped = 2' })],
  ['second variable declaration', (builder: CodeBuilder) => builder.addVariable({ name: 'value', initializer: '1, silentlyDropped = 2' })],
  ['trailing type declaration', (builder: CodeBuilder) => builder.addTypeAlias('Value', 'number; type SilentlyDropped = string')],
  ['escaped function body', (builder: CodeBuilder) => builder.addFunction({ name: 'value', body: 'return 1; } const silentlyDropped = 2; function second(){' })],
  ['extra heritage class', (builder: CodeBuilder) => builder.addClass({ name: 'Value', extends: 'Base {} class SilentlyDropped' })],
  ['multiple heritage entries', (builder: CodeBuilder) => builder.addClass({ name: 'Value', implements: ['First, Second'] })]
] as const) {
  test(`one requested fragment cannot silently ignore ${name}`, () => {
    const builder = new CodeBuilder().addVariable({ name: 'retained', initializer: '7' });
    const before = builder.getText();
    assert.throws(() => add(builder)); assert.equal(builder.getText(), before);
  });
}

for (const separator of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
  test(`file comment containing ${JSON.stringify(separator)} cannot introduce executable statements`, () => {
    const builder = new CodeBuilder().addFileComment(`metadata${separator}globalThis.unexpected = true;`)
      .addVariable({ name: 'safe', initializer: '7', isExported: true });
    assert.equal(statements(builder).length, 1);
    const compiled = ts.transpileModule(builder.getText(), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const sandbox = { exports: {} as Record<string, unknown>, unexpected: false };
    runInNewContext(compiled, sandbox); assert.equal(sandbox.unexpected, false); assert.equal(sandbox.exports.safe, 7);
  });
}

for (const [name, add] of [
  ['variable', (builder: CodeBuilder) => builder.addVariable({ name: 'first = 1, unexpected', initializer: '2' })],
  ['function', (builder: CodeBuilder) => builder.addFunction({ name: 'first() {} function unexpected', body: 'return 7;' })],
  ['class', (builder: CodeBuilder) => builder.addClass({ name: 'First {} class Unexpected' })],
  ['type alias', (builder: CodeBuilder) => builder.addTypeAlias('First = number; type Unexpected', 'string')],
  ['interface', (builder: CodeBuilder) => builder.addInterface('First {} interface Unexpected', [])],
  ['parameter', (builder: CodeBuilder) => builder.addFunction({ name: 'safe', parameters: [{ name: 'first, unexpected', type: 'number' }], body: 'return 7;' })],
  ['import', (builder: CodeBuilder) => builder.addImport({ moduleSpecifier: './types', namedImports: ['First, Unexpected'] })],
  ['property', (builder: CodeBuilder) => builder.addClass({ name: 'Safe', properties: [{ name: 'first = 1; unexpected', type: 'number' }] })],
  ['method', (builder: CodeBuilder) => builder.addClass({ name: 'Safe', methods: [{ name: 'first() {} unexpected', body: 'return 7;' }] })]
] as const) {
  test(`${name} fields name one declaration or member, not injected source`, () => {
    const builder = new CodeBuilder(); assert.throws(() => add(builder)); assert.equal(statements(builder).length, 0);
  });
}

test('identifier admission keeps Unicode, dollar and underscore names', () => {
  const builder = new CodeBuilder().addVariable({ name: '状态', initializer: '1' })
    .addVariable({ name: '$value', initializer: '2' }).addVariable({ name: '_value', initializer: '3' });
  assert.equal(statements(builder).length, 3);
});

test('member names retain literal, computed and class-private forms', () => {
  const builder = new CodeBuilder().addClass({ name: 'Values',
    properties: [
      { name: '"with space"', type: 'number', initializer: '1' },
      { name: '#privateValue', initializer: '2' },
      { name: '[Symbol.toStringTag]', initializer: '"Values"' }
    ], methods: [{ name: 'read', returnType: 'number', body: 'return this.#privateValue;' }] });
  const node = statements(builder)[0]; assert.ok(ts.isClassDeclaration(node!)); assert.equal(node.members.length, 4);
});

test('complex legitimate fragments and explicit raw statements remain available', () => {
  const builder = new CodeBuilder().addTypeAlias('Values', '{ readonly [K in "a" | "b"]: K extends "a" ? number : string }')
    .addVariable({ name: 'value', initializer: '(() => { const x = 1; return x + 1; })()' })
    .addFunction({ name: 'read', body: 'if (value) { return value; } return 0;' })
    .addClass({ name: 'Derived', extends: 'mixin(Base)', implements: ['First', 'Second'] })
    .appendRaw('export const first = 1; export const second = 2;');
  assert.equal(statements(builder).length, 6);
});

for (const [name, add] of [
  ['exported', (builder: CodeBuilder) => builder.addVariable({ name: 'value', initializer: '7', isExported: 'false' as never })],
  ['async', (builder: CodeBuilder) => builder.addFunction({ name: 'read', body: '', isAsync: 1 as never })],
  ['readonly', (builder: CodeBuilder) => builder.addInterface('Value', [{ name: 'value', type: 'number', isReadonly: 'true' as never }])],
  ['optional', (builder: CodeBuilder) => builder.addFunction({ name: 'read', body: '', parameters: [{ name: 'value', isOptional: 'false' as never }] })],
  ['scope', (builder: CodeBuilder) => builder.addClass({ name: 'Value', properties: [{ name: 'value', scope: 'internal' as never }] })],
  ['type-only', (builder: CodeBuilder) => builder.addImport({ moduleSpecifier: './types', namedImports: ['Value'], isTypeOnly: 'false' as never })]
] as const) {
  test(`declaration policy ${name} is not coerced through truthiness or silently dropped`, () => assert.throws(() => add(new CodeBuilder()), TypeError));
}

test('non-text fragments are refused without custom coercion', () => {
  const value = { toString() { assert.fail('coercion'); }, [Symbol.toPrimitive]() { assert.fail('coercion'); } } as never;
  assert.throws(() => new CodeBuilder().addVariable({ name: 'value', initializer: value }), TypeError);
  assert.throws(() => new CodeBuilder().addTypeAlias('Value', value), TypeError);
  assert.throws(() => new CodeBuilder().addFunction({ name: 'read', body: value }), TypeError);
  assert.throws(() => new CodeBuilder().addFileComment(value), TypeError);
});

test('ordinary declaration ordering and independent builders retain prior semantics', () => {
  const first = new CodeBuilder().addFileComment('@generated owner:semantic')
    .addVariable({ name: 'first', initializer: '1' })
    .addImport({ moduleSpecifier: './types', namedImports: ['Value', 'Value'], isTypeOnly: true });
  const second = new CodeBuilder().addVariable({ name: 'second', initializer: '2' });
  assert.ok(first.getText().startsWith('// @generated owner:semantic\n'));
  assert.deepEqual(statements(first).map(node => node.kind), [ts.SyntaxKind.ImportDeclaration, ts.SyntaxKind.VariableStatement]);
  assert.equal(statements(second).length, 1); assert.ok(!second.getText().includes('first'));
});
