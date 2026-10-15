import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// Production entrypoints must close admission and join started work on every exit.
const structuredOperations = new Set(['mapTaskGroup', 'runTaskGroup', 'createTaskGroupEffectFence']);
function unstructuredImports(sourceFile: import('typescript').SourceFile,
  resolve: (specifier: string) => 'limiter' | 'task-group' | undefined): string[] {
  const violations: string[] = [];
  const inspect = (node: import('typescript').Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) return;
      if (ts.isExportDeclaration(node) && node.isTypeOnly) return;
      const kind = resolve(node.moduleSpecifier.text);
      if (kind !== undefined) {
        const named = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : node.exportClause;
        const names = named && (ts.isNamedImports(named) || ts.isNamedExports(named))
          ? named.elements.filter(element => !element.isTypeOnly).map(element => (element.propertyName ?? element.name).text)
          : null;
        const defaults = ts.isImportDeclaration(node) && node.importClause?.name !== undefined;
        if (kind === 'limiter' || names === null || defaults || names.some(name => !structuredOperations.has(name))) {
          violations.push(node.getText(sourceFile));
        }
      }
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly
        && ts.isExternalModuleReference(node.moduleReference)
        && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)
        && resolve(node.moduleReference.expression.text)) {
      violations.push(node.getText(sourceFile));
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      const target = node.arguments[0];
      if (target && ts.isStringLiteralLike(target) && resolve(target.text)) violations.push(node.getText(sourceFile));
    }
    ts.forEachChild(node, inspect);
  };
  inspect(sourceFile);
  return violations;
}


test('production concurrency entrypoints expose only structured group operations', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const sourceRoot = path.join(root, 'src');
  const owner = path.join(sourceRoot, 'execution/task-group.ts');
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
  const cache = ts.createModuleResolutionCache(root, value => value, options);
  const violations: string[] = [];
  for (const relative of new Bun.Glob('**/*.{ts,tsx,js,mjs,cjs}').scanSync(sourceRoot)) {
    if (relative.endsWith('.test.ts')) continue;
    const file = path.join(sourceRoot, relative);
    if (file === owner) continue;
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const found = unstructuredImports(source, specifier => {
      if (specifier === 'p-limit' || specifier.startsWith('p-limit/')) return 'limiter';
      return ts.resolveModuleName(specifier, file, options, ts.sys, cache).resolvedModule?.resolvedFileName === owner
        ? 'task-group' : undefined;
    });
    violations.push(...found.map(text => `${relative}: ${text}`));
  }
  assert.deepEqual(violations, []);
});

test('concurrency entrypoint guard distinguishes renamed, namespace, dynamic and type-only imports', () => {
  const resolve = (value: string) => value === 'p-limit' ? 'limiter' as const
    : value === './group' ? 'task-group' as const : undefined;
  for (const source of [
    "import { createConcurrencyLimit as hidden } from './group';",
    "import * as group from './group';", "export * from './group';",
    "export { defaultLimit as queue } from './group';", "await import('./group');",
    "const group = require('./group');", "import limit = require('p-limit');",
    "import limit from 'p-limit';", "import group, { mapTaskGroup } from './group';"
  ]) assert.equal(unstructuredImports(ts.createSourceFile('example.ts', source, ts.ScriptTarget.Latest, true), resolve).length, 1);
  for (const source of [
    "import { mapTaskGroup as map, type TaskGroupOptions } from './group';",
    "export { runTaskGroup as run } from './group';", "import type * as group from './group';",
    "export type { TaskGroupOptions } from './group';", "import helper from './other';"
  ]) assert.deepEqual(unstructuredImports(ts.createSourceFile('example.ts', source, ts.ScriptTarget.Latest, true), resolve), []);
});
