import { expect, test } from 'bun:test';

import {
  PACKAGE_SOURCE_IMPORT,
  PACKAGE_SOURCE_LAUNCHER_SCRIPT,
  packageArtifactLauncherScript,
  parseCompilerPackageEntrypointBinding,
  selectCompilerPackageModuleLayout
} from './package-entrypoint.ts';

const sourceRuntime = 'src/adapters/toolchain/runtime/layout.ts';

function sourceBinding(source: string, artifact = 'build/cli.js') {
  return parseCompilerPackageEntrypointBinding({
    imports: { [PACKAGE_SOURCE_IMPORT]: `./${source}` },
    bin: { example: `./${artifact}` },
    scripts: { example: PACKAGE_SOURCE_LAUNCHER_SCRIPT }
  });
}

test('package module decisions follow each supplied source and retain bundle interpretation', () => {
  for (const source of ['author/first.ts', 'replacement/second.ts']) {
    const binding = sourceBinding(source);
    const selected = selectCompilerPackageModuleLayout(binding, sourceRuntime, 'sensitive');
    expect(selected).toEqual({
      mode: 'source',
      cliEntrypointRelativePath: source,
      artifactRootRelativePath: 'build'
    });
    expect(Object.isFrozen(selected)).toBe(true);
    expect(selectCompilerPackageModuleLayout(binding, 'build/cli.js', 'sensitive')).toEqual({
      mode: 'bundle',
      cliEntrypointRelativePath: 'build/cli.js',
      artifactRootRelativePath: 'build'
    });
  }
});

test('source packages have one direct declaration and reject competing or implicit routes', () => {
  const manifest = {
    imports: { [PACKAGE_SOURCE_IMPORT]: './source/cli.ts' },
    bin: { example: './build/cli.js' },
    scripts: { example: PACKAGE_SOURCE_LAUNCHER_SCRIPT }
  };
  for (const source of ['./old/cli.ts', './source/cli.ts', undefined]) {
    expect(() => parseCompilerPackageEntrypointBinding({ ...manifest, source }))
      .toThrow('source field is retired');
  }
  for (const route of [
    { types: './source/types.d.ts', default: './source/cli.ts' },
    ['./source/cli.ts'], null, './source/*.ts', './source/cli.ts?mode=1',
    './source/cli.ts#fragment', './source/%63li.ts', './source\\cli.ts',
    './node_modules/example/cli.ts'
  ]) {
    expect(() => parseCompilerPackageEntrypointBinding({
      ...manifest, imports: { [PACKAGE_SOURCE_IMPORT]: route }
    })).toThrow();
  }
  expect(() => parseCompilerPackageEntrypointBinding({ ...manifest, imports: {} }))
    .toThrow('exact launcher');
});

test('a bundle declaration does not supply a source runtime entrypoint', () => {
  const binding = parseCompilerPackageEntrypointBinding({
    bin: { example: './build/cli.js' },
    scripts: { example: packageArtifactLauncherScript('build/cli.js') }
  });
  expect(selectCompilerPackageModuleLayout(binding, 'build/cli.js', 'sensitive')?.mode).toBe('bundle');
  expect(() => selectCompilerPackageModuleLayout(binding, sourceRuntime, 'sensitive'))
    .toThrow('source runtime requires one explicit source entrypoint');
});

test('module path comparison uses the supplied case semantics with canonical separators', () => {
  const binding = sourceBinding('author/first.ts');
  expect(selectCompilerPackageModuleLayout(binding, sourceRuntime.toUpperCase(), 'sensitive')).toBeNull();
  expect(selectCompilerPackageModuleLayout(binding, sourceRuntime.toUpperCase(), 'insensitive')?.mode)
    .toBe('source');
  expect(selectCompilerPackageModuleLayout(binding, 'BUILD/CLI.JS', 'sensitive')).toBeNull();
  expect(selectCompilerPackageModuleLayout(binding, 'BUILD/CLI.JS', 'insensitive')?.mode).toBe('bundle');
  expect(selectCompilerPackageModuleLayout(binding, sourceRuntime.replaceAll('/', '\\'), 'sensitive')?.mode)
    .toBe('source');
});

test('module coordinates cannot escape or normalize into a supported entrypoint', () => {
  const binding = sourceBinding('author/first.ts');
  for (const relativePath of [
    '', '.', '../build/cli.js', '/build/cli.js', 'build//cli.js',
    './build/cli.js', 'other/../build/cli.js', 'C:/build/cli.js', 'lib/other.js'
  ]) {
    expect(selectCompilerPackageModuleLayout(binding, relativePath, 'sensitive')).toBeNull();
  }
});

test('the source runtime interpretation takes precedence when artifact coordinates coincide', () => {
  const binding = sourceBinding('author/first.ts', sourceRuntime);
  expect(selectCompilerPackageModuleLayout(binding, sourceRuntime, 'sensitive')).toEqual({
    mode: 'source',
    cliEntrypointRelativePath: 'author/first.ts',
    artifactRootRelativePath: 'src/adapters/toolchain/runtime'
  });
});
