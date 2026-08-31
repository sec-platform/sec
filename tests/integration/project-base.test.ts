import { expect, test } from 'bun:test';

import { loadRuntimeDependencySpec } from '../../src/toolchain/dependencies/spec.ts';
import { readJson } from '../../src/workspace/files.ts';
import { getWorkspacePaths } from '../../src/workspace/paths.ts';
import { ensureProjectBase } from '../../src/workspace/project.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

type RuntimePackageJson = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
};

test('project base emits the canonical TypeScript runtime package', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await ensureProjectBase(workspaceRoot);
    const runtimeSpec = await loadRuntimeDependencySpec();
    const paths = getWorkspacePaths(workspaceRoot);
    const projectPackage = await readJson<RuntimePackageJson>(paths.packageJsonPath);

    expect(projectPackage.dependencies).toEqual(runtimeSpec.dependencies);
    expect(projectPackage.devDependencies).toEqual(runtimeSpec.devDependencies);
    expect(projectPackage.scripts['verify:runtime:full']).toBe('bun run test:unit');
    expect(projectPackage.scripts.dev).toBeUndefined();
    expect(projectPackage.scripts.build).toBeUndefined();
  }, 'engineering-compiler-runtime-library-');
});
