import { expect, test } from 'bun:test';
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
  expect(names(builderA.getText())).toEqual(['aValue']);
  expect(names(builderB.getText())).toEqual(['bValue']);
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

  expect(source.startsWith('// @generated owner:semantic-lowering\n')).toBe(true);
  expect(sourceFile.statements.map((statement) => statement.kind)).toEqual([
    ts.SyntaxKind.ImportDeclaration,
    ts.SyntaxKind.VariableStatement,
    ts.SyntaxKind.VariableStatement
  ]);
  const declaration = sourceFile.statements[0];
  expect(declaration && ts.isImportDeclaration(declaration)
    ? declaration.importClause?.namedBindings?.getText()
    : null).toBe('{ Ticket }');
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

  expect(sourceFile.statements.some(ts.isInterfaceDeclaration)).toBe(true);
  expect(sourceFile.statements.some(ts.isClassDeclaration)).toBe(true);
  expect(sourceFile.statements.some(ts.isExportAssignment)).toBe(true);
  const classDeclaration = sourceFile.statements.find(ts.isClassDeclaration)!;
  const method = classDeclaration.members.find(ts.isMethodDeclaration)!;
  expect(method.parameters[0]?.questionToken).toBeDefined();
});

test('builder rejects malformed fragments before exposing generated source', () => {
  expect(() => new CodeBuilder().addFunction({
    name: 'broken',
    body: 'return {'
  })).toThrow('Function broken body is not valid TypeScript');
  expect(() => new CodeBuilder().addVariable({
    name: 'broken',
    initializer: 'value +'
  })).toThrow('Variable broken initializer is not valid TypeScript');
  expect(() => new CodeBuilder().addImport({
    moduleSpecifier: './contract.ts',
    namedImports: ['Named'],
    namespaceImport: 'contract'
  })).toThrow('cannot combine namespaceImport with namedImports');
});
