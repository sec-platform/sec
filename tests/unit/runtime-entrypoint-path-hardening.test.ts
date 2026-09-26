import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  PACKAGE_SOURCE_LAUNCHER_SCRIPT,
  SOURCE_RUNTIME_MODULE_RELATIVE_PATH,
  parseCompilerPackageEntrypointBinding,
  resolveCompilerRuntimeLayout
} from '../../src/adapters/toolchain/runtime/layout.ts';
import { FailureError } from '../../src/contracts/failure.ts';

function manifest(source: unknown = './src/cli.ts', artifact: unknown = './dist/index.js') {
  return { source, bin: { sec: artifact }, scripts: { sec: PACKAGE_SOURCE_LAUNCHER_SCRIPT } };
}
const invalid = (error: unknown): boolean => error instanceof FailureError && error.code === 'RUNTIME-LAYOUT-001';

test('runtime source entrypoint cannot name its package root or parent', () => {
  for (const value of ['./.', './..', './', './../outside.ts', './src/../cli.ts']) {
    assert.throws(() => parseCompilerPackageEntrypointBinding(manifest(value)), invalid, value);
  }
});

test('runtime source and artifact entrypoints share portable component admission', () => {
  for (const value of ['./bad\0.ts', './C:/outside.ts', './file:stream', './NUL', './COM¹.txt', './a//b', './trailing.', './space ', './e\u0301.ts']) {
    assert.throws(() => parseCompilerPackageEntrypointBinding(manifest(value)), invalid, value);
    assert.throws(() => parseCompilerPackageEntrypointBinding(manifest('./src/cli.ts', `./dist/${value.slice(2)}`)), invalid, value);
  }
});

test('runtime entrypoint parsing keeps explicit relative prefixes and valid backslash normalization', () => {
  const binding = parseCompilerPackageEntrypointBinding(manifest('./src\\cli.ts', './dist\\index.js'));
  assert.deepEqual(binding, { source: 'src/cli.ts', artifact: 'dist/index.js', command: 'sec' });
  assert.equal(Object.isFrozen(binding), true);
  for (const value of ['src/cli.ts', '/src/cli.ts', null, 1]) {
    assert.throws(() => parseCompilerPackageEntrypointBinding(manifest(value)), invalid);
  }
});

test('runtime entrypoints retain ordinary Unicode and dot-prefixed directory names', () => {
  assert.deepEqual(parseCompilerPackageEntrypointBinding(manifest('./..source/文件.ts', './..dist/é.js')),
    { source: '..source/文件.ts', artifact: '..dist/é.js', command: 'sec' });
});

test('runtime artifact root and exact source launcher constraints remain enforced', () => {
  assert.throws(() => parseCompilerPackageEntrypointBinding(manifest('./src/cli.ts', './index.js')), invalid);
  assert.throws(() => parseCompilerPackageEntrypointBinding({ ...manifest(), scripts: { sec: 'bun ./other.ts' } }), invalid);
  assert.throws(() => parseCompilerPackageEntrypointBinding({ ...manifest(), bin: { first: './dist/a.js', second: './dist/b.js' } }), invalid);
});

test('real package-file layout resolution rejects a parent entrypoint before publishing a CLI path', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sec-layout-path-'));
  const moduleUrl = pathToFileURL(path.join(root, SOURCE_RUNTIME_MODULE_RELATIVE_PATH)).href;
  try {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest('./..')));
    assert.throws(() => resolveCompilerRuntimeLayout(moduleUrl), invalid);
    writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest()));
    const layout = resolveCompilerRuntimeLayout(moduleUrl);
    assert.equal(layout.packageRoot, root);
    assert.equal(layout.cliEntrypointPath, path.join(root, 'src', 'cli.ts'));
    assert.equal(layout.mode, 'source');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
