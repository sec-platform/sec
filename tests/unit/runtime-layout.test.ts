import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS,
  compilerCliEntrypoint,
  compilerRuntimeLayout,
  PACKAGE_SOURCE_IMPORT,
  PACKAGE_SOURCE_LAUNCHER_SCRIPT,
  packageArtifactLauncherScript,
  parseCompilerPackageEntrypointBinding,
  resolveCompilerRuntimeLayout,
  resolveCompilerRuntimeResources,
  SOURCE_RUNTIME_MODULE_RELATIVE_PATH
} from '../../src/adapters/toolchain/runtime.ts';

const FIXTURE_ENTRYPOINT = Object.freeze({
  artifact: 'output/cli.js',
  command: 'fixture',
  source: 'source/cli.ts'
});

async function createPackageFixture(form: 'bundle' | 'source' = 'source'): Promise<string> {
  const packageRoot = await mkdtemp(path.join(tmpdir(), 'sec-runtime-layout-'));
  await writeFile(path.join(packageRoot, 'package.json'), `${JSON.stringify({
    ...(form === 'source'
      ? { imports: { [PACKAGE_SOURCE_IMPORT]: `./${FIXTURE_ENTRYPOINT.source}` } }
      : {}),
    bin: { [FIXTURE_ENTRYPOINT.command]: `./${FIXTURE_ENTRYPOINT.artifact}` },
    scripts: {
      [FIXTURE_ENTRYPOINT.command]: form === 'source'
        ? PACKAGE_SOURCE_LAUNCHER_SCRIPT
        : packageArtifactLauncherScript(FIXTURE_ENTRYPOINT.artifact)
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
    const packageRoot = await createPackageFixture('bundle');
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
        sourceEntrypointRelativePath: null
      });
      expect(Object.isFrozen(resolveCompilerRuntimeResources(layout))).toBe(true);
    } finally {
      await rm(packageRoot, { force: true, recursive: true });
    }
  });

  test('manifest mismatches, unknown layouts and non-file URLs fail closed', async () => {
    expect(() => parseCompilerPackageEntrypointBinding({
      imports: { [PACKAGE_SOURCE_IMPORT]: './source/cli.ts' },
      bin: { fixture: './output/cli.js' },
      scripts: { fixture: 'bun ./other.ts' }
    })).toThrow('must use the exact launcher for its package form');
    expect(() => parseCompilerPackageEntrypointBinding({
      imports: { [PACKAGE_SOURCE_IMPORT]: './source/cli.ts' },
      bin: { fixture: './output/cli.js' },
      scripts: { fixture: '"$npm_execpath" ./source/cli.ts' }
    })).toThrow('must use the exact launcher for its package form');
    expect(parseCompilerPackageEntrypointBinding({
      bin: { fixture: './output/cli.js' },
      scripts: { fixture: packageArtifactLauncherScript('output/cli.js') }
    })).toEqual({ artifact: 'output/cli.js', command: 'fixture', source: null });
    expect(() => parseCompilerPackageEntrypointBinding({
      imports: { [PACKAGE_SOURCE_IMPORT]: '../other/cli.ts' },
      bin: { fixture: './output/cli.js' },
      scripts: { fixture: PACKAGE_SOURCE_LAUNCHER_SCRIPT }
    })).toThrow('must be one explicit package-relative path');

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

  test('a nearer manifest cannot be skipped in favor of a valid ancestor package', async () => {
    const packageRoot = await createPackageFixture();
    const modulePath = path.join(packageRoot, SOURCE_RUNTIME_MODULE_RELATIVE_PATH);
    const moduleUrl = pathToFileURL(modulePath).href;
    const nearerRoot = path.join(packageRoot, 'src');
    const nearerManifest = path.join(nearerRoot, 'package.json');
    try {
      await mkdir(nearerRoot);
      expect(resolveCompilerRuntimeLayout(moduleUrl).packageRoot).toBe(packageRoot);
      await writeFile(nearerManifest, JSON.stringify({
        imports: { [PACKAGE_SOURCE_IMPORT]: './other/cli.ts' },
        bin: { nested: './build/cli.js' },
        scripts: { nested: PACKAGE_SOURCE_LAUNCHER_SCRIPT }
      }));
      let rejected: unknown;
      try {
        resolveCompilerRuntimeLayout(moduleUrl);
      } catch (error) {
        rejected = error;
      }
      expect(rejected).toMatchObject({
        code: 'RUNTIME-LAYOUT-001',
        details: { executableModulePath: modulePath, packageRoot: nearerRoot }
      });
      await writeFile(nearerManifest, '{');
      expect(() => resolveCompilerRuntimeLayout(moduleUrl))
        .toThrow('manifest is not readable canonical JSON');
      await rm(nearerManifest);
      expect(resolveCompilerRuntimeLayout(moduleUrl).cliEntrypointPath)
        .toBe(path.join(packageRoot, 'source', 'cli.ts'));
    } finally {
      await rm(packageRoot, { force: true, recursive: true });
    }
  });

  test('a bundle module keeps its target even when the package also carries source metadata', async () => {
    const packageRoot = await createPackageFixture();
    try {
      const modulePath = path.join(packageRoot, 'output', 'cli.js');
      const layout = resolveCompilerRuntimeLayout(pathToFileURL(modulePath).href);
      expect(layout).toMatchObject({
        mode: 'bundle',
        cliEntrypointPath: modulePath,
        repositorySourceRoot: null,
        runtimeAssetRoot: path.join(packageRoot, 'output'),
        sourceEntrypointRelativePath: 'source/cli.ts'
      });
    } finally {
      await rm(packageRoot, { force: true, recursive: true });
    }
  });
});
