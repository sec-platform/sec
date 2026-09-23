import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { CodeBuilder } from '../../src/adapters/targets/typescript/code-builder.ts';

function sourceFile(text: string, tsx = false): ts.SourceFile {
  return ts.createSourceFile(tsx ? 'view.tsx' : 'generated.ts', text,
    ts.ScriptTarget.Latest, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

async function executeGenerated<Result extends object = Record<string, unknown>>(
  text: string, tsx = false
): Promise<Result> {
  // Run the actual compiler output as a native ECMAScript module. The JSX
  // factory is declared by the fixture, not supplied by a fake parser/renderer.
  const result = ts.transpileModule(text, {
    fileName: tsx ? 'view.tsx' : 'generated.ts', reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.React, jsxFactory: 'h', jsxFragmentFactory: 'Fragment' }
  });
  assert.deepEqual((result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error), []);
  return import(`data:text/javascript;base64,${Buffer.from(result.outputText).toString('base64')}`);
}

const jsxPrelude = `
function h(tag: string, props: unknown, ...children: unknown[]) {
  return { tag, props, children };
}
const Fragment = 'fragment';
`;

test('a side-effect-only import has no binding clause and native module loading executes it', async () => {
  const key = `sec-codegen-${randomUUID()}`;
  const specifier = `data:text/javascript,${encodeURIComponent(`globalThis[${JSON.stringify(key)}] = 41;`)}`;
  const builder = new CodeBuilder().addImport({ moduleSpecifier: specifier })
    .addVariable({ name: 'result', initializer: `(globalThis as unknown as Record<string, number>)[${JSON.stringify(key)}] + 1`, isExported: true });
  const text = builder.getText();
  const declaration = sourceFile(text).statements[0]!;
  assert.ok(ts.isImportDeclaration(declaration)); assert.equal(declaration.importClause, undefined);
  try { assert.equal((await executeGenerated(text)).result, 42); }
  finally { Reflect.deleteProperty(globalThis, key); }
});

test('type-only requests cannot accidentally become runtime side effects', () => {
  const builder = new CodeBuilder().addVariable({ name: 'kept', initializer: '1' });
  const before = builder.getText();
  assert.throws(() => builder.addImport({ moduleSpecifier: './never-load', isTypeOnly: true }), /Type-only import/);
  assert.equal(builder.getText(), before);
  builder.addImport({ moduleSpecifier: './types', namedImports: [], isTypeOnly: true });
  const first = sourceFile(builder.getText()).statements[0]!;
  assert.ok(ts.isImportDeclaration(first)); assert.equal(first.importClause!.isTypeOnly, true);
});

test('default, namespace, empty named and ordinary named imports retain their distinct shapes', () => {
  const builder = new CodeBuilder().addImport({ moduleSpecifier: './default', defaultImport: 'Default' })
    .addImport({ moduleSpecifier: './namespace', namespaceImport: 'Namespace' })
    .addImport({ moduleSpecifier: './empty', namedImports: [] })
    .addImport({ moduleSpecifier: './named', namedImports: ['Value', 'Value'] });
  const imports = sourceFile(builder.getText()).statements.filter(ts.isImportDeclaration);
  assert.equal(imports[0]!.importClause!.name!.text, 'Default');
  assert.ok(ts.isNamespaceImport(imports[1]!.importClause!.namedBindings!));
  const empty = imports[2]!.importClause!.namedBindings!; assert.ok(ts.isNamedImports(empty)); assert.equal(empty.elements.length, 0);
  const named = imports[3]!.importClause!.namedBindings!; assert.ok(ts.isNamedImports(named)); assert.deepEqual(named.elements.map(x => x.name.text), ['Value']);
});

test('TSX initializers preserve JSX attributes, children and fragments through real emission and execution', async () => {
  const text = new CodeBuilder('view.tsx', jsxPrelude)
    .addVariable({ name: 'view', initializer: '<section data-count={2}>Hello<span /></section>', isExported: true })
    .addVariable({ name: 'fragment', initializer: '<>one<em /></>', isExported: true }).getText();
  const module = await executeGenerated(text, true);
  assert.deepEqual(module.view, { tag: 'section', props: { 'data-count': 2 }, children: ['Hello', { tag: 'span', props: null, children: [] }] });
  assert.deepEqual(module.fragment, { tag: 'fragment', props: null, children: ['one', { tag: 'em', props: null, children: [] }] });
});

test('TSX function and class method bodies use the destination grammar, not a TS-only temporary file', async () => {
  const text = new CodeBuilder('view.tsx', jsxPrelude)
    .addFunction({ name: 'render', isExported: true, parameters: [{ name: 'label', type: 'string' }], body: 'return <b>{label}</b>;' })
    .addClass({ name: 'View', isExported: true, properties: [{ name: 'first', initializer: '<i />' }],
      methods: [{ name: 'render', body: 'return <main>{this.first}</main>;' }] }).getText();
  const module = await executeGenerated<{ render(label: string): unknown; View: new () => { render(): unknown } }>(text, true);
  assert.deepEqual(module.render('label'), { tag: 'b', props: null, children: ['label'] });
  assert.deepEqual(new module.View().render(), { tag: 'main', props: null,
    children: [{ tag: 'i', props: null, children: [] }] });
});

test('TSX raw statements and default-export expressions follow the same target syntax', async () => {
  const text = new CodeBuilder('view.tsx', jsxPrelude)
    .appendRaw('export const raw = <strong />;').addExportAssignment('<footer />').getText();
  const module = await executeGenerated(text, true);
  assert.deepEqual(module.raw, { tag: 'strong', props: null, children: [] });
  assert.deepEqual(module.default, { tag: 'footer', props: null, children: [] });
});

test('TSX computed names and heritage expressions retain their runtime expressions', async () => {
  const text = new CodeBuilder('view.tsx', jsxPrelude + '\nclass Base {}\nfunction select(_v: unknown) { return Base; }')
    .addClass({ name: 'Derived', isExported: true, extends: 'select(<marker />)',
      properties: [{ name: '[h("key", null).tag]', initializer: '<value />' }],
      methods: [{ name: '[h("read", null).tag]', body: 'return this.key;' }] }).getText();
  const module = await executeGenerated<{ Derived: new () => { read(): unknown } }>(text, true);
  assert.deepEqual(new module.Derived().read(), { tag: 'value', props: null, children: [] });
});

test('generic arrow syntax stays valid in TSX and angle assertions remain TS-only', async () => {
  const text = new CodeBuilder('view.tsx').addVariable({ name: 'id', initializer: '<T,>(value: T) => value', isExported: true }).getText();
  assert.equal((await executeGenerated<{ id(value: number): number }>(text, true)).id(7), 7);
  assert.equal((await executeGenerated(new CodeBuilder('value.ts')
    .addVariable({ name: 'value', initializer: '<number>7', isExported: true }).getText())).value, 7);
  assert.throws(() => new CodeBuilder('value.tsx').addVariable({ name: 'value', initializer: '<number>7' }));
});

test('malformed JSX is rejected before any builder state is changed', () => {
  const operations = [
    (b: CodeBuilder) => b.addVariable({ name: 'bad', initializer: '<div>' }),
    (b: CodeBuilder) => b.addFunction({ name: 'bad', body: 'return <div>;' }),
    (b: CodeBuilder) => b.addClass({ name: 'Bad', properties: [{ name: 'view', initializer: '<div>' }] }),
    (b: CodeBuilder) => b.appendRaw('const bad = <div>;'),
    (b: CodeBuilder) => b.addExportAssignment('<div>')
  ];
  for (const operation of operations) {
    const builder = new CodeBuilder('view.tsx').addVariable({ name: 'kept', initializer: '1' });
    const before = builder.getText(); assert.throws(() => operation(builder)); assert.equal(builder.getText(), before);
    builder.addVariable({ name: 'after', initializer: '2' }); assert.ok(builder.getText().includes('const after = 2;'));
  }
});

test('a generated comment cannot displace an executable hashbang from the first line', async () => {
  const text = new CodeBuilder('tool.ts', '#!/usr/bin/env node\nexport const initial = 6;')
    .addFileComment('@generated\nowner:compiler').addVariable({ name: 'answer', initializer: 'initial * 7', isExported: true }).getText();
  assert.ok(text.startsWith('#!/usr/bin/env node\n// @generated\n// owner:compiler\n'));
  assert.equal((await executeGenerated(text)).answer, 42);
});

test('hashbang-only input and repeated comment edits preserve one native executable prologue', () => {
  const builder = new CodeBuilder('tool.ts', '#!/usr/bin/env node').addFileComment('first');
  assert.ok(builder.getText().startsWith('#!/usr/bin/env node\n// first\n'));
  builder.addFileComment('second'); assert.ok(builder.getText().startsWith('#!/usr/bin/env node\n// second\n'));
  assert.equal((builder.getText().match(/#!/g) ?? []).length, 1);
});

test('all native line terminators in file comments remain comments, not executable statements', async () => {
  const text = new CodeBuilder().addFileComment('title\r\nthrow 1;\rthrow 2;\nthrow 3;\u2028throw 4;\u2029throw 5;')
    .addVariable({ name: 'value', initializer: '42', isExported: true }).getText();
  assert.equal((await executeGenerated(text)).value, 42);
});

test('malformed fragments and breakout attempts remain rejected without poisoning subsequent output', () => {
  const operations = [
    (b: CodeBuilder) => b.addTypeAlias('Bad', 'number; const extra = 1'),
    (b: CodeBuilder) => b.addVariable({ name: 'bad', initializer: '1; const extra = 1' }),
    (b: CodeBuilder) => b.addFunction({ name: 'bad', body: '} const extra = 1; function other() {' }),
    (b: CodeBuilder) => b.addClass({ name: 'Bad', properties: [{ name: 'x; extra', type: 'number' }] }),
    (b: CodeBuilder) => b.addClass({ name: 'Bad', extends: 'Base {} class Extra' }),
    (b: CodeBuilder) => b.appendRaw('const before = 1; const broken = ;')
  ];
  for (const operation of operations) {
    const builder = new CodeBuilder().addVariable({ name: 'kept', initializer: '1' });
    const before = builder.getText(); assert.throws(() => operation(builder)); assert.equal(builder.getText(), before);
  }
});

test('fragment type parsing and exported declaration structure remain available without resolving user imports', () => {
  const text = new CodeBuilder().addImport({ moduleSpecifier: './not-installed-user-contract', namedImports: ['Foreign'], isTypeOnly: true })
    .addTypeAlias('Result', 'ReadonlyArray<Foreign | null>', true)
    .addInterface('Shape', [{ name: 'item', type: 'Foreign', isOptional: true, isReadonly: true }], true).getText();
  const parsed = sourceFile(text);
  assert.equal(parsed.statements.filter(ts.isTypeAliasDeclaration).length, 1);
  assert.equal(parsed.statements.filter(ts.isInterfaceDeclaration).length, 1);
});

test('adding declarations preserves initial code, hoisted imports and caller-requested statement order', async () => {
  const builder = new CodeBuilder('pipeline.ts', 'export const start = 2;');
  for (let i = 0; i < 150; i++) builder.addVariable({ name: `v${i}`, initializer: i === 0 ? 'start + 1' : `v${i - 1} + 1`, isExported: true });
  builder.addImport({ moduleSpecifier: './types', namedImports: ['Shape'], isTypeOnly: true });
  const text = builder.getText(), parsed = sourceFile(text);
  assert.ok(ts.isImportDeclaration(parsed.statements[0]!));
  const names = parsed.statements.filter(ts.isVariableStatement).flatMap(s => s.declarationList.declarations.map(d => d.name.getText(parsed)));
  assert.deepEqual(names, ['start', ...Array.from({ length: 150 }, (_, i) => `v${i}`)]);
  assert.equal((await executeGenerated(text)).v149, 152);
});

test('independent TS and TSX builders keep target grammar local across interleaved operations', async () => {
  const plain = new CodeBuilder('plain.ts'), jsx = new CodeBuilder('view.tsx', jsxPrelude);
  plain.addVariable({ name: 'n', initializer: '<number>1', isExported: true });
  jsx.addVariable({ name: 'v', initializer: '<div />', isExported: true });
  assert.throws(() => plain.addVariable({ name: 'bad', initializer: '<div />' }));
  assert.equal((await executeGenerated(plain.getText())).n, 1);
  assert.deepEqual((await executeGenerated(jsx.getText(), true)).v, { tag: 'div', props: null, children: [] });
});

test('virtual filenames and path separators preserve ordinary TS emission', () => {
  const expected = 'export const value = 42;\n';
  for (const name of ['generated.ts', './generated.ts', 'nested/file.ts', 'nested/../file.ts', 'C:\\workspace\\file.ts', '/virtual/file.ts']) {
    assert.equal(new CodeBuilder(name).addVariable({ name: 'value', initializer: '42', isExported: true }).getText(), expected);
  }
});

test('complete supported generated modules pass actual strict TypeScript semantic checking', () => {
  const text = new CodeBuilder('fixture.ts')
    .addInterface('Options', [{ name: 'value', type: 'number', isReadonly: true }], true)
    .addTypeAlias('Maybe', 'Options | undefined', true)
    .addFunction({ name: 'valueOf', isExported: true, parameters: [{ name: 'options', type: 'Maybe' }],
      returnType: 'number', body: 'return options?.value ?? 0;' })
    .addClass({ name: 'Service', isExported: true,
      properties: [{ name: 'seed', type: 'number', initializer: '42', scope: 'private', isReadonly: true }],
      methods: [{ name: 'read', scope: 'public', returnType: 'number', body: 'return this.seed;' }] }).getText();
  const name = 'fixture.ts', options: ts.CompilerOptions = { strict: true, noEmit: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext };
  const host = ts.createCompilerHost(options), nativeSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, ...args) => file === name ? sourceFile(text) : nativeSourceFile(file, ...args);
  // Native TypeScript libraries are read normally. No declaration stubs or
  // semantic diagnostics are removed to manufacture a passing generated file.
  const program = ts.createProgram([name], options, host);
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
});
