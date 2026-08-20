import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS,
  compilerCliEntrypoint,
  compilerRuntimeLayout,
  RELEASE_ENTRYPOINT_RELATIVE_PATH,
  RELEASE_RUNTIME_ASSET_ROOT_RELATIVE_PATH,
  resolveCompilerCliEntrypoint,
  resolveCompilerRuntimeLayout,
  resolveCompilerRuntimeResources,
  SOURCE_CLI_ENTRYPOINT_RELATIVE_PATH,
  SOURCE_RUNTIME_MODULE_RELATIVE_PATH
} from '../../platform/shared/runtime-layout.ts';

describe('compiler runtime layout', () => {
  test('source mode separates the executable module while retaining the repository source root', () => {
    const packageRoot = path.resolve('C:/sec-source-fixture');
    const modulePath = path.join(packageRoot, SOURCE_RUNTIME_MODULE_RELATIVE_PATH);
    const layout = resolveCompilerRuntimeLayout(pathToFileURL(modulePath).href);

    expect(layout).toEqual({
      dependencyRoot: packageRoot,
      executableModulePath: modulePath,
      mode: 'source',
      packageRoot,
      repositorySourceRoot: packageRoot,
      runtimeAssetRoot: packageRoot
    });
    expect(Object.isFrozen(layout)).toBe(true);
    expect(resolveCompilerCliEntrypoint(layout)).toBe(
      path.join(packageRoot, SOURCE_CLI_ENTRYPOINT_RELATIVE_PATH)
    );
    expect(resolveCompilerRuntimeResources(layout)).toEqual({
      composeTemplates: path.join(
        packageRoot,
        COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS.composeTemplates
      ),
      localViewTemplates: path.join(
        packageRoot,
        COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS.localViewTemplates
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

  test('bundle mode resolves package dependencies above dist and assets inside dist', () => {
    const packageRoot = path.resolve('C:/sec-package-fixture');
    const modulePath = path.join(packageRoot, RELEASE_ENTRYPOINT_RELATIVE_PATH);
    const layout = resolveCompilerRuntimeLayout(pathToFileURL(modulePath).href);

    expect(layout).toEqual({
      dependencyRoot: packageRoot,
      executableModulePath: modulePath,
      mode: 'bundle',
      packageRoot,
      repositorySourceRoot: null,
      runtimeAssetRoot: path.join(packageRoot, RELEASE_RUNTIME_ASSET_ROOT_RELATIVE_PATH)
    });
    expect(resolveCompilerCliEntrypoint(layout)).toBe(modulePath);
    const runtimeAssetRoot = path.join(packageRoot, RELEASE_RUNTIME_ASSET_ROOT_RELATIVE_PATH);
    expect(resolveCompilerRuntimeResources(layout)).toEqual({
      composeTemplates: path.join(
        runtimeAssetRoot,
        COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS.composeTemplates
      ),
      localViewTemplates: path.join(
        runtimeAssetRoot,
        COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS.localViewTemplates
      ),
      officialPolicies: path.join(
        runtimeAssetRoot,
        COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS.officialPolicies
      ),
      officialRegistry: path.join(
        runtimeAssetRoot,
        COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS.officialRegistry
      )
    });
    expect(Object.isFrozen(resolveCompilerRuntimeResources(layout))).toBe(true);
  });

  test('unknown module layouts and non-file URLs fail closed', () => {
    expect(() => resolveCompilerRuntimeLayout(
      pathToFileURL(path.resolve('C:/sec-package-fixture/lib/runtime-layout.js')).href
    )).toThrow('Unsupported SEC runtime module layout');
    expect(() => resolveCompilerRuntimeLayout('https://example.com/dist/index.js')).toThrow(
      'file URL'
    );
  });

  test('the live source module resolves the current package without caller cwd inference', () => {
    const sourceModulePath = fileURLToPath(
      new URL('../../platform/shared/runtime-layout.ts', import.meta.url)
    );
    const packageRoot = path.resolve(path.dirname(sourceModulePath), '../..');

    expect(compilerRuntimeLayout.mode).toBe('source');
    expect(compilerRuntimeLayout.packageRoot).toBe(packageRoot);
    expect(compilerRuntimeLayout.runtimeAssetRoot).toBe(packageRoot);
    expect(compilerRuntimeLayout.repositorySourceRoot).toBe(packageRoot);
    expect(compilerCliEntrypoint).toBe(
      path.join(packageRoot, SOURCE_CLI_ENTRYPOINT_RELATIVE_PATH)
    );
  });
});
