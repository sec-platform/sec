import { expect, test } from 'bun:test';

import {
  ensureOperationDependencies,
  reuseOperationDependenciesV1
} from '../../platform/dev-runner/dependency-bootstrap.ts';
import { compileSecOperationDemandGraphV1 } from '../../platform/shared/operation-demand-contract.ts';

for (const source of ['existing', 'installed'] as const) {
  test(`dependency bootstrap exposes the manifest-bound compiler tree (${source})`, async () => {
    const hookRoots: string[] = [];
    const result = await ensureOperationDependencies(compileSecOperationDemandGraphV1({
      operation: 'dependency-setup',
      terminalWorkIds: [],
      hookPolicy: 'always'
    }), {
      ensureCompilerDeps: async () => ({
        manifestHash: 'manifest-hash',
        nodeModulesPath: 'compiler-node-modules',
        packageManager: 'bun',
        root: 'compiler-root',
        source
      }),
      ensureHooks: async (repoRoot) => {
        hookRoots.push(repoRoot);
      }
    });

    expect(result).toEqual({
      browserCachePath: null,
      manifestHash: 'manifest-hash',
      nodeModulesPath: 'compiler-node-modules',
      source
    });
    expect(hookRoots).toEqual(['compiler-root']);
  });
}

for (const source of ['existing', 'installed'] as const) {
  test(`warmed hook policy only closes hooks after compiler installation (${source})`, async () => {
    const hookRoots: string[] = [];
    await ensureOperationDependencies(compileSecOperationDemandGraphV1({
      operation: 'dependency-setup',
      terminalWorkIds: [],
      hookPolicy: 'if-installed'
    }), {
      ensureCompilerDeps: async () => ({
        manifestHash: 'manifest-hash',
        nodeModulesPath: 'compiler-node-modules',
        packageManager: 'bun',
        root: 'compiler-root',
        source
      }),
      ensureHooks: async (repoRoot) => {
        hookRoots.push(repoRoot);
      }
    });

    expect(hookRoots).toEqual(source === 'installed' ? ['compiler-root'] : []);
  });
}

for (const source of ['existing', 'installed'] as const) {
  test(`active Git hook execution never recursively installs hooks (${source})`, async () => {
    const hookRoots: string[] = [];
    await ensureOperationDependencies(compileSecOperationDemandGraphV1({
      operation: 'dependency-setup',
      terminalWorkIds: [],
      hookPolicy: 'never'
    }), {
      ensureCompilerDeps: async () => ({
        manifestHash: 'manifest-hash',
        nodeModulesPath: 'compiler-node-modules',
        packageManager: 'bun',
        root: 'compiler-root',
        source
      }),
      ensureHooks: async (repoRoot) => {
        hookRoots.push(repoRoot);
      }
    });

    expect(hookRoots).toEqual([]);
  });
}

test('operation demand materializes compiler and browser readiness without hook lifecycle', async () => {
  const calls: string[] = [];
  const result = await ensureOperationDependencies(compileSecOperationDemandGraphV1({
    operation: 'test-slow',
    terminalWorkIds: []
  }), {
    ensureCompilerDeps: async () => {
      calls.push('compiler');
      return {
        manifestHash: 'manifest-hash',
        nodeModulesPath: 'compiler-node-modules',
        packageManager: 'bun',
        root: 'compiler-root',
        source: 'existing'
      };
    },
    ensureBrowserCache: async (dependencyRoot) => {
      calls.push(`browser:${dependencyRoot}`);
      return {
        browserCachePath: 'canonical-browser-cache',
        browserExecutablePath: 'canonical-browser-executable',
        browserExecutableRelativePath: 'canonical-browser-executable',
        externalNode: {
          executablePath: 'canonical-node',
          version: '24.15.0'
        },
        playwrightPackageClosure: {
          packages: [
            { manifestSha256: 'a'.repeat(64), name: '@playwright/test', version: '1.59.1' },
            { manifestSha256: 'b'.repeat(64), name: 'playwright', version: '1.59.1' },
            { manifestSha256: 'c'.repeat(64), name: 'playwright-core', version: '1.59.1' }
          ],
          release: '1.59.1',
          revision: `sha256:${'d'.repeat(64)}`
        }
      };
    }
  });

  expect(result).toEqual({
    browserCachePath: 'canonical-browser-cache',
    manifestHash: 'manifest-hash',
    nodeModulesPath: 'compiler-node-modules',
    source: 'existing'
  });
  expect(calls).toEqual(['compiler', 'browser:compiler-root']);
});

test('operation demand proves compiler readiness with zero unrequested browser or hook effect', async () => {
  const calls: string[] = [];
  const result = await ensureOperationDependencies(compileSecOperationDemandGraphV1({
    operation: 'test-fast',
    terminalWorkIds: []
  }), {
    ensureCompilerDeps: async () => {
      calls.push('compiler');
      return {
        manifestHash: 'manifest-hash',
        nodeModulesPath: 'compiler-node-modules',
        packageManager: 'bun',
        root: 'compiler-root',
        source: 'existing'
      };
    }
  });

  expect(result).toEqual({
    browserCachePath: null,
    manifestHash: 'manifest-hash',
    nodeModulesPath: 'compiler-node-modules',
    source: 'existing'
  });
  expect(calls).toEqual(['compiler']);
});

test('dependency bootstrap rejects a valid graph that does not demand compiler dependencies', async () => {
  await expect(ensureOperationDependencies(compileSecOperationDemandGraphV1({
    operation: 'work-selection-observe',
    terminalWorkIds: []
}))).rejects.toThrow('requires an operation demand for compiler-dependency-tree');
});

test('one process-local materialization is reusable only for a covered demand closure', async () => {
  const fastGraph = compileSecOperationDemandGraphV1({
    operation: 'test-fast',
    terminalWorkIds: []
  });
  const result = await ensureOperationDependencies(fastGraph, {
    ensureCompilerDeps: async () => ({
      manifestHash: 'manifest-hash',
      nodeModulesPath: 'compiler-node-modules',
      packageManager: 'bun',
      root: 'compiler-root',
      source: 'existing'
    })
  });

  expect(reuseOperationDependenciesV1(result, fastGraph)).toBe(result);
  expect(() => reuseOperationDependenciesV1(result, compileSecOperationDemandGraphV1({
    operation: 'test-slow',
    terminalWorkIds: []
  }))).toThrow('does not cover the requested capability closure');
  expect(() => reuseOperationDependenciesV1({ ...result }, fastGraph))
    .toThrow('was not materialized by this process');
});
