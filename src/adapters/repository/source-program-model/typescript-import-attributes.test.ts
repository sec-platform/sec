import { expect, test } from 'bun:test';
import ts from 'typescript';
import {
  directTypeScriptPackageImportAddress,
  directTypeScriptSourceAddress,
  observeTypeScriptImportLoader
} from './typescript-module-loader.ts';

function loader(source: string) {
  const file = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let literal: ts.StringLiteralLike | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) && node.text === './asset') literal = node;
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (literal === undefined) throw new Error('Fixture has no asset specifier');
  return observeTypeScriptImportLoader(literal);
}

test('static import and export attributes preserve module json and file loading modes', () => {
  expect(loader('import asset from "./asset";')).toBe('module');
  expect(loader('export * from "./asset";')).toBe('module');
  expect(loader('import asset from "./asset" with {};')).toBe('module');
  expect(loader('import asset from "./asset" with { type: "file" };')).toBe('file');
  expect(loader('export { default } from "./asset" with { "type": "file" };')).toBe('file');
  expect(loader('import asset from "./asset" with { type: "json" };')).toBe('json');
  expect(loader('export * from "./asset" with { type: "json" };')).toBe('json');
});

test('dynamic import options use explicit attributes on the same literal occurrence', () => {
  expect(loader('void import("./asset");')).toBe('module');
  expect(loader('void import("./asset", {});')).toBe('module');
  expect(loader('void import("./asset", { with: {} });')).toBe('module');
  expect(loader('void import(("./asset" as string), ({ with: { type: "file" } }));')).toBe('file');
  expect(loader('void import("./asset", { "with": { "type": "json" } });')).toBe('json');
});

test('static unsupported duplicate computed and legacy attributes remain unresolved', () => {
  for (const source of [
    'import asset from "./asset" assert { type: "json" };',
    'import asset from "./asset" with { type: "text" };',
    'import asset from "./asset" with { type: "file", type: "file" };',
    'import asset from "./asset" with { type: "file", "type": "json" };',
    'import asset from "./asset" with { type: "file", extra: "value" };',
    'import asset from "./asset" with { type: mode };',
    'import asset from "./asset" with { ["type"]: "file" };',
    'import asset from "./asset" with { ...attributes };',
    'export * from "./asset" assert { type: "file" };'
  ]) expect(loader(source)).toBe('unresolved');
});

test('dynamic attributes cannot be supplied by unknown objects or executable property forms', () => {
  for (const options of [
    'options', '{ ...options }', '{ assert: { type: "file" } }',
    '{ with: attributes }', '{ with: { ...attributes } }',
    '{ with: { type: "file" }, with: { type: "file" } }',
    '{ with: { type: "file", "type": "file" } }',
    '{ ["with"]: { type: "file" } }', '{ with: { ["type"]: "file" } }',
    '{ get with() { return { type: "file" }; } }', '{ with() { return { type: "file" }; } }',
    '{ with }', '{ with: { type } }', '{ with: { type() { return "file"; } } }',
    '{ with: { get type() { return "file"; } } }',
    '{ with: { type: mode } }', '{ with: { type: "file" }, extra: true }',
    '{ with: { type: "file", extra: true } }', '{ with: { type: "unknown" } }'
  ]) expect(loader(`void import("./asset", ${options});`)).toBe('unresolved');
  expect(loader('void import("./asset", { with: { type: "file" } }, extra);')).toBe('unresolved');
});

test('direct helpers distinguish arbitrary file inputs from module and json addresses', () => {
  expect(directTypeScriptSourceAddress('src/example', './worker.mjs', 'module')).toBe('src/example/worker.mjs');
  expect(directTypeScriptSourceAddress('src/example', './worker.d.mts', 'module')).toBeNull();
  expect(directTypeScriptSourceAddress('src/example', './data.txt', 'module')).toBeNull();
  expect(directTypeScriptSourceAddress('src/example', './README', 'file')).toBe('src/example/README');
  expect(directTypeScriptSourceAddress('src/example', '../data.txt', 'file')).toBe('src/data.txt');
  expect(directTypeScriptSourceAddress('src/example', './data.json', 'json')).toBe('src/example/data.json');
  expect(directTypeScriptSourceAddress('src/example', './worker.ts', 'json')).toBeNull();
  for (const value of ['./%61sset', './asset#fragment', './asset?query', './nested/../asset', './nested//asset', '../../../escape']) {
    expect(directTypeScriptSourceAddress('src/example', value, 'file')).toBeNull();
  }
  expect(directTypeScriptSourceAddress('src/example', './data.txt', 'unresolved')).toBeNull();
});

test('package file inputs use exact direct mappings without condition or pattern selection', () => {
  const manifest = { path: 'src/package.json', source: '{"imports":{"#asset":"./assets/data.txt"}}' };
  expect(directTypeScriptPackageImportAddress(manifest, '#asset', 'file')).toBe('src/assets/data.txt');
  expect(directTypeScriptPackageImportAddress(manifest, '#asset', 'module')).toBeNull();
  for (const imports of [
    { '#asset': { bun: './assets/data.txt' } },
    { '#asset': ['./assets/data.txt'] },
    { '#*': './assets/data.txt' },
    { '#asset': './assets/%64ata.txt' }
  ]) {
    expect(directTypeScriptPackageImportAddress({ path: manifest.path, source: JSON.stringify({ imports }) }, '#asset', 'file'))
      .toBeNull();
  }
});
