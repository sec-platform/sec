import { expect, test } from 'bun:test';

import {
  ensureDevDependencies,
  ensureFastTestDependencies,
  ensureTestDependencies
} from '../../platform/dev-runner/dependency-bootstrap.ts';

for (const source of ['existing', 'installed'] as const) {
  test(`dependency bootstrap exposes the manifest-bound compiler tree (${source})`, async () => {
    const hookRoots: string[] = [];
    const result = await ensureDevDependencies({
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
    await ensureDevDependencies({
      ensureCompilerDeps: async () => ({
        manifestHash: 'manifest-hash',
        nodeModulesPath: 'compiler-node-modules',
        packageManager: 'bun',
        root: 'compiler-root',
        source
      }),
      ensureHooks: async (repoRoot) => {
        hookRoots.push(repoRoot);
      },
      hookPolicy: 'if-installed'
    });

    expect(hookRoots).toEqual(source === 'installed' ? ['compiler-root'] : []);
  });
}

for (const source of ['existing', 'installed'] as const) {
  test(`active Git hook execution never recursively installs hooks (${source})`, async () => {
    const hookRoots: string[] = [];
    await ensureDevDependencies({
      ensureCompilerDeps: async () => ({
        manifestHash: 'manifest-hash',
        nodeModulesPath: 'compiler-node-modules',
        packageManager: 'bun',
        root: 'compiler-root',
        source
      }),
      ensureHooks: async (repoRoot) => {
        hookRoots.push(repoRoot);
      },
      hookPolicy: 'never'
    });

    expect(hookRoots).toEqual([]);
  });
}

test('test dependency bootstrap composes compiler and browser readiness without hook lifecycle', async () => {
  const calls: string[] = [];
  const result = await ensureTestDependencies({
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

test('fast dependency bootstrap proves compiler readiness with zero browser or hook effect', async () => {
  const calls: string[] = [];
  const result = await ensureFastTestDependencies({
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
    manifestHash: 'manifest-hash',
    nodeModulesPath: 'compiler-node-modules',
    source: 'existing'
  });
  expect(calls).toEqual(['compiler']);
});
