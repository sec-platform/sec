import { test } from 'bun:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

import { CodeBuilder } from '../../src/compiler/codegen/code-builder.ts';

function parsed(source: string): ts.SourceFile {
  return ts.createSourceFile(
    'generated.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

test('independent builders retain declaration ownership without shared mutable compiler state', () => {
  const builderA = new CodeBuilder('generated/a.ts')
    .addVariable({ name: 'aValue', initializer: '1' });
  const builderB = new CodeBuilder('generated/b.ts')
    .addVariable({ name: 'bValue', initializer: '2' });

  const names = (source: string) => parsed(source).statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .map((declaration) => declaration.name.getText());
  assert.deepEqual(names(builderA.getText()), ['aValue']);
  assert.deepEqual(names(builderB.getText()), ['bValue']);
});

test('builder preserves comment/import/declaration order and deduplicates named imports', () => {
  const source = new CodeBuilder('generated/order.ts')
    .addVariable({ name: 'existing', initializer: '0' })
    .addFileComment('@generated owner:semantic-lowering')
    .addImport({
      moduleSpecifier: './contract.ts',
      namedImports: ['Ticket', 'Ticket'],
      isTypeOnly: true
    })
    .addVariable({ name: 'result', initializer: 'existing', isExported: true })
    .getText();
  const sourceFile = parsed(source);

  assert.equal(source.startsWith('// @generated owner:semantic-lowering\n'), true);
  assert.deepEqual(sourceFile.statements.map((statement) => statement.kind), [
    ts.SyntaxKind.ImportDeclaration,
    ts.SyntaxKind.VariableStatement,
    ts.SyntaxKind.VariableStatement
  ]);
  const declaration = sourceFile.statements[0];
  assert.equal(declaration && ts.isImportDeclaration(declaration)
    ? declaration.importClause?.namedBindings?.getText()
    : null, '{ Ticket }');
});

test('builder emits optional parameters, access modifiers, interfaces and export assignments', () => {
  const source = new CodeBuilder('generated/contract.ts')
    .addInterface('Options', [{ name: 'label', type: 'string', isReadonly: true, isOptional: true }], true)
    .addClass({
      name: 'Service',
      isExported: true,
      properties: [{ name: 'value', type: 'number', scope: 'private', isReadonly: true, initializer: '1' }],
      methods: [{
        name: 'read',
        scope: 'public',
        parameters: [{ name: 'options', type: 'Options', isOptional: true }],
        returnType: 'number',
        body: 'return this.value;'
      }]
    })
    .addExportAssignment('Service')
    .getText();
  const sourceFile = parsed(source);

  assert.equal(sourceFile.statements.some(ts.isInterfaceDeclaration), true);
  assert.equal(sourceFile.statements.some(ts.isClassDeclaration), true);
  assert.equal(sourceFile.statements.some(ts.isExportAssignment), true);
  const classDeclaration = sourceFile.statements.find(ts.isClassDeclaration)!;
  const method = classDeclaration.members.find(ts.isMethodDeclaration)!;
  assert.notEqual(method.parameters[0]?.questionToken, undefined);
});

test('builder rejects malformed fragments before exposing generated source', () => {
  assert.throws(() => new CodeBuilder().addFunction({
    name: 'broken',
    body: 'return {'
  }), /Function broken body is not valid TypeScript/);
  assert.throws(() => new CodeBuilder().addVariable({
    name: 'broken',
    initializer: 'value +'
  }), /Variable broken initializer is not valid TypeScript/);
  assert.throws(() => new CodeBuilder().addImport({
    moduleSpecifier: './contract.ts',
    namedImports: ['Named'],
    namespaceImport: 'contract'
  }), /cannot combine namespaceImport with namedImports/);
});
