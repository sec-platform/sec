import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { loadRuntimeDependencySpec } from '../../src/toolchain/dependencies/spec.ts';
import { pathExists, readJson } from '../../src/workspace/files.ts';
import { getWorkspacePaths } from '../../src/workspace/paths.ts';
import { ensureProjectBase } from '../../src/workspace/project.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

type RuntimePackageJson = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
};

type RuntimeTsConfig = {
  compilerOptions: {
    lib?: string[];
    types?: string[];
  };
  include?: string[];
};

test('project base emits a browser-free TypeScript runtime library', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await ensureProjectBase(workspaceRoot);
    const runtimeSpec = await loadRuntimeDependencySpec();
    const { projectPackagePath, projectRoot } = getWorkspacePaths(workspaceRoot);
    const projectPackage = await readJson<RuntimePackageJson>(projectPackagePath);
    const tsconfig = JSON.parse(
      await fs.readFile(path.join(projectRoot, 'tsconfig.json'), 'utf8')
    ) as RuntimeTsConfig;

    expect(projectPackage.dependencies).toEqual(runtimeSpec.dependencies);
    expect(projectPackage.devDependencies).toEqual(runtimeSpec.devDependencies);
    expect(projectPackage.scripts['verify:runtime:full']).toBe('bun run test:unit');
    expect(projectPackage.scripts.dev).toBeUndefined();
    expect(projectPackage.scripts.build).toBeUndefined();
    expect(tsconfig.compilerOptions.lib ?? []).not.toContain('DOM');
    expect(tsconfig.compilerOptions.types ?? []).not.toEqual(
      expect.arrayContaining(['react', 'react-dom', 'next'])
    );
    expect(tsconfig.include ?? []).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/\.tsx$/u)])
    );
    for (const retired of [
      'app',
      'components',
      'next.config.mjs',
      'next-env.d.ts',
      'playwright.config.ts',
      'tests/runtime/acceptance'
    ]) {
      expect(await pathExists(path.join(projectRoot, ...retired.split('/')))).toBe(false);
    }
  }, 'engineering-compiler-runtime-library-');
});
