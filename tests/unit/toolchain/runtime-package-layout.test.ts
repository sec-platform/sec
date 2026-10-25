import { describe, expect, test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS,
  compilerCliEntrypoint,
  compilerRuntimeLayout,
  PACKAGE_SOURCE_LAUNCHER_SCRIPT,
  packageArtifactLauncherScript,
  resolveCompilerRuntimeLayout,
  resolveCompilerRuntimeResources,
  SOURCE_RUNTIME_MODULE_RELATIVE_PATH
} from '../../../src/adapters/toolchain/runtime.ts';
import { CodedFailure } from '../../../src/contracts/failure.ts';
import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';

const FIXTURE_ENTRYPOINT = Object.freeze({
  artifact: 'output/cli.js',
  command: 'fixture',
  source: 'source/cli.ts'
});

async function withPackageFixture<T>(
  run: (packageRoot: string) => Promise<T>,
  form: 'bundle' | 'source' = 'source'
): Promise<T> {
  const packageRoot = await mkdtemp(path.join(tmpdir(), 'sec-runtime-layout-'));
  return settleWorkspaceCallback(async () => {
    await writeFile(path.join(packageRoot, 'package.json'), `${JSON.stringify({
      ...(form === 'source' ? { source: `./${FIXTURE_ENTRYPOINT.source}` } : {}),
      bin: { [FIXTURE_ENTRYPOINT.command]: `./${FIXTURE_ENTRYPOINT.artifact}` },
      scripts: {
        [FIXTURE_ENTRYPOINT.command]: form === 'source'
          ? PACKAGE_SOURCE_LAUNCHER_SCRIPT
          : packageArtifactLauncherScript(FIXTURE_ENTRYPOINT.artifact)
      }
    })}\n`, 'utf8');
    return run(packageRoot);
  }, () => rm(packageRoot, { recursive: true, force: true }));
}

describe('compiler runtime layout', () => {
  test('source mode derives the CLI and release entrypoints from its package manifest', async () => {
    return withPackageFixture(async packageRoot => {
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
    });
  });

  test('bundle mode derives its executable and asset root from the same package manifest', async () => {
    return withPackageFixture(async packageRoot => {
      const modulePath = path.join(packageRoot, ...FIXTURE_ENTRYPOINT.artifact.split('/'));
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
    }, 'bundle');
  });

  test('unknown module locations and non-file URLs fail closed', async () => {
    return withPackageFixture(async packageRoot => {
      expect(() => resolveCompilerRuntimeLayout(
        pathToFileURL(path.join(packageRoot, 'lib/runtime-layout.js')).href
      )).toThrow('Unsupported SEC runtime module layout');
      expect(() => resolveCompilerRuntimeLayout('https://example.com/output/cli.js')).toThrow(
        'file URL'
      );
    });
  });

  test('the live source module resolves the current package and CLI entrypoint', () => {
    const packageRoot = path.resolve(import.meta.dir, '../../..');

    expect(compilerRuntimeLayout.mode).toBe('source');
    expect(compilerRuntimeLayout.packageRoot).toBe(packageRoot);
    expect(compilerRuntimeLayout.runtimeAssetRoot).toBe(packageRoot);
    expect(compilerRuntimeLayout.repositorySourceRoot).toBe(packageRoot);
    expect(compilerCliEntrypoint).toBe(compilerRuntimeLayout.cliEntrypointPath);
  });
});

test('real package-file layout resolution rejects a parent entrypoint before publishing a CLI path', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-layout-path-'));
  const moduleUrl = pathToFileURL(path.join(root, SOURCE_RUNTIME_MODULE_RELATIVE_PATH)).href;
  try {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ source: './..', bin: { sec: './dist/index.js' }, scripts: { sec: PACKAGE_SOURCE_LAUNCHER_SCRIPT } }));
    assert.throws(() => resolveCompilerRuntimeLayout(moduleUrl),
      (error: unknown) => error instanceof CodedFailure && error.code === 'RUNTIME-LAYOUT-001');
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ source: './src/cli.ts', bin: { sec: './dist/index.js' }, scripts: { sec: PACKAGE_SOURCE_LAUNCHER_SCRIPT } }));
    const layout = resolveCompilerRuntimeLayout(moduleUrl);
    assert.equal(layout.packageRoot, root);
    assert.equal(layout.cliEntrypointPath, path.join(root, 'src', 'cli.ts'));
    assert.equal(layout.mode, 'source');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
