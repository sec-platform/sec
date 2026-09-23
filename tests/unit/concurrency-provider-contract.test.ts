import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { createConcurrencyLimit, defaultLimit, getDefaultLimit } from '../../src/execution/task-group.ts';

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
function latch(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

test('default limiter and accessor expose the same provider instance', () => {
  assert.equal(defaultLimit, getDefaultLimit());
  assert.equal(defaultLimit.concurrency, 10);
  assert.equal(defaultLimit.activeCount, 0);
  assert.equal(defaultLimit.pendingCount, 0);
});

test('default limiter exposes actual provider methods instead of a type-only facade', () => {
  assert.equal(typeof defaultLimit.map, 'function');
  assert.equal(typeof defaultLimit.clearQueue, 'function');
});

test('default limiter forwards arguments and result types', async () => {
  assert.equal(await defaultLimit((prefix: string, number: number) => `${prefix}:${number}`, 'x', 7), 'x:7');
});

test('default limiter map preserves input result order and mapper indices', async () => {
  assert.deepEqual(await defaultLimit.map([3, 1, 2], async (value, index) => {
    await tick();
    return [value, index];
  }), [[3, 0], [1, 1], [2, 2]]);
});

test('default limiter concurrency setter changes the actual queue', async () => {
  const provider = getDefaultLimit();
  const previous = provider.concurrency;
  const gate = latch();
  const tasks: Promise<number>[] = [];
  try {
    defaultLimit.concurrency = 1;
    assert.equal(provider.concurrency, 1);
    tasks.push(defaultLimit(async () => { await gate.promise; return 1; }));
    tasks.push(defaultLimit(() => 2));
    await tick();
    assert.equal(defaultLimit.activeCount, 1);
    assert.equal(defaultLimit.pendingCount, 1);
    defaultLimit.concurrency = 2;
    await tick();
    assert.equal(defaultLimit.pendingCount, 0);
    assert.equal(await tasks[1], 2);
  } finally {
    gate.release();
    await Promise.all(tasks);
    provider.concurrency = previous;
  }
});

test('independent limiter factories do not share queues', async () => {
  const first = createConcurrencyLimit(1);
  const second = createConcurrencyLimit(2);
  const gate = latch();
  const blocked = first(() => gate.promise);
  try {
    assert.notEqual(first, second);
    assert.equal(await second(() => 42), 42);
    assert.equal(first.activeCount, 1);
    assert.equal(second.activeCount, 0);
  } finally { gate.release(); await blocked; }
});

for (const value of [0, -1, 0.5, NaN, -Infinity]) {
  test(`limiter rejects invalid concurrency ${String(value)}`, () => {
    assert.throws(() => createConcurrencyLimit(value), TypeError);
  });
}

test('provider setter rejects invalid limit without changing the old limit', () => {
  const limit = createConcurrencyLimit(2);
  assert.throws(() => { limit.concurrency = 0; }, TypeError);
  assert.equal(limit.concurrency, 2);
});

test('factory retains the provider unlimited-concurrency mode', async () => {
  const limit = createConcurrencyLimit(Infinity);
  assert.equal(limit.concurrency, Infinity);
  assert.deepEqual(await limit.map([1, 2], (value) => value * 2), [2, 4]);
});

test('synchronous failure releases a slot and preserves the thrown identity', async () => {
  const limit = createConcurrencyLimit(1);
  const sentinel = new Error('primary');
  const first = limit(() => { throw sentinel; });
  const second = limit(() => 'successor');
  await assert.rejects(first, (error: unknown) => error === sentinel);
  assert.equal(await second, 'successor');
  assert.equal(limit.activeCount, 0);
});

test('asynchronous failure releases a slot and preserves the rejection identity', async () => {
  const limit = createConcurrencyLimit(1);
  const sentinel = Object.freeze({ failure: 'primary' });
  const first = limit(async () => { await tick(); throw sentinel; });
  const second = limit(() => 1);
  await assert.rejects(first, (error: unknown) => error === sentinel);
  assert.equal(await second, 1);
});

test('clearQueue discards pending work without cancelling already running work', async () => {
  const limit = createConcurrencyLimit(1);
  const gate = latch();
  let pendingRan = false;
  const running = limit(() => gate.promise);
  // The existing provider default leaves discarded promises pending. Do not
  // await that promise or falsely present clearQueue as cancellation.
  void limit(() => { pendingRan = true; });
  try {
    await tick();
    assert.equal(limit.pendingCount, 1);
    limit.clearQueue();
    assert.equal(limit.pendingCount, 0);
    assert.equal(limit.activeCount, 1);
  } finally { gate.release(); await running; }
  await tick();
  assert.equal(pendingRan, false);
});

test('factory enforces the observed concurrent task cap', async () => {
  const limit = createConcurrencyLimit(3);
  let active = 0;
  let peak = 0;
  const results = await Promise.all(Array.from({ length: 30 }, (_, index) => limit(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await tick();
    active -= 1;
    return index;
  })));
  assert.equal(peak, 3);
  assert.equal(active, 0);
  assert.deepEqual(results, Array.from({ length: 30 }, (_, index) => index));
});

// A native limiter is retained for provider compatibility and test infrastructure,
// not as a production operation lifetime. New production consumers must select
// an API that closes admission and joins started work on every exit.
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
