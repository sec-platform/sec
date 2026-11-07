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

function parse(source: string) {
  const root = path.resolve('snapshot-config-fixture');
  const configPath = 'packages/a/tsconfig.json';
  const config = parseContainedTypeScriptProjectConfig(source, configPath);
  const absolute = path.join(root, configPath);
  const host: ts.ParseConfigHost = {
    useCaseSensitiveFileNames: true,
    readDirectory: createTypeScriptSnapshotDirectoryReader([...inventory.keys()], root),
    readFile: filename => inventory.get(path.relative(root, filename).split(path.sep).join('/')),
    fileExists: filename => inventory.has(path.relative(root, filename).split(path.sep).join('/'))
  };
  const result = parseTypeScriptProjectConfiguration(
    absolute, source, config, host, root
  );
  return { root, result, files: result.fileNames.map(file => path.relative(root, file).split(path.sep).join('/')) };
}

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

test('empty nested projects retain config-local compiler paths after no-input validation', () => {
  const actual = parse(JSON.stringify({
    compilerOptions: {
      baseUrl: '.', rootDir: 'src', outDir: 'dist', declarationDir: 'declarations',
      rootDirs: ['src', 'generated'], typeRoots: ['types']
    },
    include: ['unmatched']
  }));
  assert.equal(actual.result.errors.length, 0);
  assert.deepEqual(actual.files, []);
  assert.equal(actual.result.options.configFilePath, path.join(actual.root, 'packages/a/tsconfig.json').replaceAll('\\', '/'));
  assert.equal(actual.result.options.baseUrl, path.join(actual.root, 'packages/a').replaceAll('\\', '/'));
  assert.equal(actual.result.options.rootDir, path.join(actual.root, 'packages/a/src').replaceAll('\\', '/'));
  assert.equal(actual.result.options.outDir, path.join(actual.root, 'packages/a/dist').replaceAll('\\', '/'));
  assert.equal(actual.result.options.declarationDir, path.join(actual.root, 'packages/a/declarations').replaceAll('\\', '/'));
  assert.deepEqual(actual.result.options.rootDirs, [
    path.join(actual.root, 'packages/a/src').replaceAll('\\', '/'),
    path.join(actual.root, 'packages/a/generated').replaceAll('\\', '/')
  ]);
  assert.deepEqual(actual.result.options.typeRoots, [path.join(actual.root, 'packages/a/types').replaceAll('\\', '/')]);
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
    const result = parseTypeScriptProjectConfiguration(
      path.join(root, 'tsconfig.json'),
      source,
      captured,
      host,
      root
    );
    assert.deepEqual(result.fileNames, []);
    assert.equal(result.errors.length, 0);
    assert.equal(JSON.stringify(captured), before);
    assert.equal(Object.hasOwn(captured, 'compileOnSave'), false);
  }
});
