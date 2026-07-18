import { expect, test } from 'bun:test';

import { ensureDevDependencies } from '../../platform/dev-runner/dependency-bootstrap.ts';

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
