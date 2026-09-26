import { test } from 'bun:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import ts from 'typescript';

import { createTypeScriptSnapshotDirectoryReader } from '../../toolchain/typescript/snapshot-directory.ts';
import { parseContainedTypeScriptProjectConfig, parseTypeScriptProjectConfiguration } from './workspace-typescript-config.ts';

const inventory = new Map([
  ['src/root.ts', 'export const root = true;'],
  ['packages/a/src/a.ts', 'export const a = true;'],
  ['packages/a/src/excluded/e.ts', 'export const e = true;'],
  ['packages/a/extra/manual.ts', 'export const manual = true;'],
  ['packages/b/src/b.ts', 'export const b = true;']
]);

function parse(source: string, configPath = 'packages/a/tsconfig.json') {
  const root = path.resolve('snapshot-config-fixture');
  const config = parseContainedTypeScriptProjectConfig(source, configPath);
  const absolute = path.join(root, configPath);
  const host: ts.ParseConfigHost = {
    useCaseSensitiveFileNames: true,
    readDirectory: createTypeScriptSnapshotDirectoryReader([...inventory.keys()], root),
    readFile: filename => inventory.get(path.relative(root, filename).split(path.sep).join('/')),
    fileExists: filename => inventory.has(path.relative(root, filename).split(path.sep).join('/'))
  };
  const result = parseTypeScriptProjectConfiguration(absolute, source, config, host);
  return { root, result, files: result.fileNames.map(file => path.relative(root, file).split(path.sep).join('/')) };
}

test('nested JSONC include and directory exclude resolve from the config directory, not the repository root', () => {
  const actual = parse(`{ // JSONC is intentional\n"compilerOptions": {"strict": true,}, "include": ["src"], "exclude": ["src/excluded"],}`);
  assert.equal(actual.result.errors.length, 0);
  assert.deepEqual(actual.files, ['packages/a/src/a.ts']);
});

test('explicit files and relative compiler options retain their config-local interpretation', () => {
  const actual = parse(JSON.stringify({
    compilerOptions: { baseUrl: '.', rootDir: 'src', outDir: 'dist' },
    files: ['extra/manual.ts'], include: ['src'], exclude: ['src/excluded']
  }));
  assert.deepEqual(actual.files, ['packages/a/extra/manual.ts', 'packages/a/src/a.ts']);
  assert.equal(actual.result.options.rootDir, path.join(actual.root, 'packages/a/src').replaceAll('\\', '/'));
  assert.equal(actual.result.options.outDir, path.join(actual.root, 'packages/a/dist').replaceAll('\\', '/'));
  assert.equal(actual.result.options.baseUrl, path.join(actual.root, 'packages/a').replaceAll('\\', '/'));
});

test('root configuration still resolves from the root', () => {
  const actual = parse('{"include":["src"]}', 'tsconfig.json');
  assert.equal(actual.result.errors.length, 0);
  assert.deepEqual(actual.files, ['src/root.ts']);
});

test('empty include-based project is valid but invalid options remain errors', () => {
  const empty = parse('{"include":["unmatched"]}');
  assert.equal(empty.result.errors.length, 0);
  assert.deepEqual(empty.files, []);
  const invalid = parse('{"compilerOptions":{"target":"invalid-target"},"include":["unmatched"]}');
  assert.ok(invalid.result.errors.length > 0);
});

test('configuration containment still rejects external lookup and plugin execution before parsing', () => {
  for (const config of [
    {extends:'./other.json'}, {references:[]}, {compilerOptions:{plugins:[]}},
    {include:['../foreign']}, {files:['/absolute.ts']}, {exclude:['bad\u0000path']},
    {compilerOptions:{rootDirs:['src','../foreign']}},
    {compilerOptions:{paths:{alias:['../foreign']}}}
  ]) assert.throws(() => parse(JSON.stringify(config)), /TypeScript ProjectInput/);
});

test('empty-project validation never mutates the captured configuration or its nested options', () => {
  const root = path.resolve('snapshot-config-fixture');
  const source = '{"compilerOptions":{"strict":true},"include":["missing"]}';
  const captured = parseContainedTypeScriptProjectConfig(source, 'tsconfig.json');
  Object.freeze(captured.compilerOptions);
  Object.freeze(captured.include);
  const before = JSON.stringify(captured);
  const host: ts.ParseConfigHost = {
    useCaseSensitiveFileNames: true, fileExists: () => false, readFile: () => undefined,
    readDirectory: createTypeScriptSnapshotDirectoryReader([], root)
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = parseTypeScriptProjectConfiguration(path.join(root, 'tsconfig.json'), source, captured, host);
    assert.deepEqual(result.fileNames, []);
    assert.equal(result.errors.length, 0);
    assert.equal(JSON.stringify(captured), before);
    assert.equal(Object.hasOwn(captured, 'compileOnSave'), false);
  }
});
