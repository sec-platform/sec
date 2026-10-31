import { expect, test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  PACKAGE_SOURCE_LAUNCHER_SCRIPT,
  packageArtifactLauncherScript,
  parseCompilerPackageEntrypointBinding
} from '../../../src/adapters/toolchain/runtime/layout.ts';
import { CodedFailure } from '../../../src/contracts/failure.ts';

function manifest(source: unknown = './src/cli.ts', artifact: unknown = './dist/index.js') {
  return { source, bin: { sec: artifact }, scripts: { sec: PACKAGE_SOURCE_LAUNCHER_SCRIPT } };
}
const invalid = (error: unknown): boolean => error instanceof CodedFailure && error.code === 'RUNTIME-LAYOUT-001';

test('runtime entrypoint parsing keeps explicit relative prefixes and valid backslash normalization', () => {
  const binding = parseCompilerPackageEntrypointBinding(manifest('./..source\\文件.ts', './..dist\\é.js'));
  assert.deepEqual(binding, { source: '..source/文件.ts', artifact: '..dist/é.js', command: 'sec' });
  assert.equal(Object.isFrozen(binding), true);
  // Source and artifact each reach the shared portable-path owner.
  assert.throws(() => parseCompilerPackageEntrypointBinding(manifest('./bad\0.ts')), invalid);
  assert.throws(() => parseCompilerPackageEntrypointBinding(manifest('./src/cli.ts', './dist/bad\0.ts')), invalid);
  for (const value of ['src/cli.ts', '/src/cli.ts', null, 1]) {
    assert.throws(() => parseCompilerPackageEntrypointBinding(manifest(value)), invalid);
  }
});

test('runtime package entrypoints enforce artifact roots, command cardinality and exact launchers', () => {
  expect(() => parseCompilerPackageEntrypointBinding({
    source: './source/cli.ts',
    bin: { fixture: './output/cli.js' },
    scripts: { fixture: 'bun ./other.ts' }
  })).toThrow('must use the exact launcher for its package form');
  expect(() => parseCompilerPackageEntrypointBinding({
    source: './source/cli.ts',
    bin: { fixture: './output/cli.js' },
    scripts: { fixture: '"$npm_execpath" ./source/cli.ts' }
  })).toThrow('must use the exact launcher for its package form');
  expect(parseCompilerPackageEntrypointBinding({
    bin: { fixture: './output/cli.js' },
    scripts: { fixture: packageArtifactLauncherScript('output/cli.js') }
  })).toEqual({ artifact: 'output/cli.js', command: 'fixture', source: null });
  expect(() => parseCompilerPackageEntrypointBinding({
    source: '../other/cli.ts',
    bin: { fixture: './output/cli.js' },
    scripts: { fixture: PACKAGE_SOURCE_LAUNCHER_SCRIPT }
  })).toThrow('source must be one explicit package-relative path');

  assert.throws(() => parseCompilerPackageEntrypointBinding(manifest('./src/cli.ts', './index.js')), invalid);
  assert.throws(() => parseCompilerPackageEntrypointBinding({ ...manifest(), bin: { first: './dist/a.js', second: './dist/b.js' } }), invalid);
});
