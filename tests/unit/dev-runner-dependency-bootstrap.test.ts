import { expect, test } from 'bun:test';

import {
  ensureDevDependencies,
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
        browserExecutablePath: 'canonical-browser-executable'
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
