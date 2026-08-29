import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS,
  compilerCliEntrypoint,
  compilerRuntimeLayout,
  parseCompilerPackageEntrypointBinding,
  resolveCompilerCliEntrypoint,
  resolveCompilerRuntimeLayout,
  resolveCompilerRuntimeResources,
  SOURCE_RUNTIME_MODULE_RELATIVE_PATH
} from '../../src/toolchain/runtime.ts';

const FIXTURE_ENTRYPOINT = Object.freeze({
  artifact: 'output/cli.js',
  command: 'fixture',
  source: 'source/cli.ts'
});

async function createPackageFixture(): Promise<string> {
  const packageRoot = await mkdtemp(path.join(tmpdir(), 'sec-runtime-layout-'));
  await writeFile(path.join(packageRoot, 'package.json'), `${JSON.stringify({
    source: `./${FIXTURE_ENTRYPOINT.source}`,
    bin: { [FIXTURE_ENTRYPOINT.command]: `./${FIXTURE_ENTRYPOINT.artifact}` },
    scripts: {
      [FIXTURE_ENTRYPOINT.command]: `bun ./${FIXTURE_ENTRYPOINT.source}`
    }
  })}\n`, 'utf8');
  return packageRoot;
}

describe('compiler runtime layout', () => {
  test('source mode derives the CLI and release entrypoints from its package manifest', async () => {
    const packageRoot = await createPackageFixture();
    try {
      const modulePath = path.join(packageRoot, SOURCE_RUNTIME_MODULE_RELATIVE_PATH);
      const layout = resolveCompilerRuntimeLayout(pathToFileURL(modulePath).href);

      expect(layout).toMatchObject({
        artifactEntrypointRelativePath: FIXTURE_ENTRYPOINT.artifact,
        artifactRoot: path.join(packageRoot, 'output'),
        cliEntrypointPath: path.join(packageRoot, ...FIXTURE_ENTRYPOINT.source.split('/')),
        command: FIXTURE_ENTRYPOINT.command,
        dependencyRoot: packageRoot,
        executableModulePath: modulePath,
        mode: 'source',
        packageRoot,
        repositorySourceRoot: packageRoot,
        runtimeAssetRoot: packageRoot,
        sourceEntrypointRelativePath: FIXTURE_ENTRYPOINT.source
      });
      expect(Object.isFrozen(layout)).toBe(true);
      expect(resolveCompilerCliEntrypoint(layout)).toBe(layout.cliEntrypointPath);
      expect(resolveCompilerRuntimeResources(layout)).toEqual({
        composeTemplates: path.join(
          packageRoot,
          COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS.composeTemplates
        ),
        officialPolicies: path.join(
          packageRoot,
          COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS.officialPolicies
        ),
        officialRegistry: path.join(
          packageRoot,
          COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS.officialRegistry
        )
      });
    } finally {
      await rm(packageRoot, { force: true, recursive: true });
    }
  });

  test('bundle mode derives its executable and asset root from the same package manifest', async () => {
    const packageRoot = await createPackageFixture();
    try {
      const modulePath = path.join(packageRoot, ...FIXTURE_ENTRYPOINT.artifact.split('/'));
      await mkdir(path.dirname(modulePath), { recursive: true });
      const layout = resolveCompilerRuntimeLayout(pathToFileURL(modulePath).href);
      const runtimeAssetRoot = path.dirname(modulePath);

      expect(layout).toMatchObject({
        artifactEntrypointRelativePath: FIXTURE_ENTRYPOINT.artifact,
        artifactRoot: runtimeAssetRoot,
        cliEntrypointPath: modulePath,
        command: FIXTURE_ENTRYPOINT.command,
        dependencyRoot: packageRoot,
        executableModulePath: modulePath,
        mode: 'bundle',
        packageRoot,
        repositorySourceRoot: null,
        runtimeAssetRoot,
        sourceEntrypointRelativePath: FIXTURE_ENTRYPOINT.source
      });
      expect(resolveCompilerCliEntrypoint(layout)).toBe(modulePath);
      expect(Object.isFrozen(resolveCompilerRuntimeResources(layout))).toBe(true);
    } finally {
      await rm(packageRoot, { force: true, recursive: true });
    }
  });

  test('manifest mismatches, unknown layouts and non-file URLs fail closed', async () => {
    expect(() => parseCompilerPackageEntrypointBinding({
      source: './source/cli.ts',
      bin: { fixture: './output/cli.js' },
      scripts: { fixture: 'bun ./other.ts' }
    })).toThrow('must execute its declared source entrypoint');

    const packageRoot = await createPackageFixture();
    try {
      expect(() => resolveCompilerRuntimeLayout(
        pathToFileURL(path.join(packageRoot, 'lib/runtime-layout.js')).href
      )).toThrow('Unsupported SEC runtime module layout');
      expect(() => resolveCompilerRuntimeLayout('https://example.com/output/cli.js')).toThrow(
        'file URL'
      );
    } finally {
      await rm(packageRoot, { force: true, recursive: true });
    }
  });

  test('the live source module resolves the current package without caller cwd inference', () => {
    const packageRoot = path.resolve(import.meta.dir, '../..');

    expect(compilerRuntimeLayout.mode).toBe('source');
    expect(compilerRuntimeLayout.packageRoot).toBe(packageRoot);
    expect(compilerRuntimeLayout.runtimeAssetRoot).toBe(packageRoot);
    expect(compilerRuntimeLayout.repositorySourceRoot).toBe(packageRoot);
    expect(compilerCliEntrypoint).toBe(compilerRuntimeLayout.cliEntrypointPath);
  });
});
