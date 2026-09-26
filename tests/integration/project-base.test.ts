import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { expect, test } from 'bun:test';

import { readJson } from "../../src/adapters/filesystem/files.ts";
import { loadRuntimeDependencySpec } from '../../src/adapters/toolchain/dependencies/contract/runtime-dependency-spec.ts';
import { getWorkspacePaths } from "../../src/adapters/workspace-context.ts";
import { ensureProjectBase, RUNTIME_DATABASE_TEMPLATE_PATH } from '../../src/adapters/workspace/project-base.ts';
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
    const generatedDatabasePath = path.join(paths.srcRoot, 'runtime', 'database.ts');
    const [generatedDatabaseBytes, templateBytes] = await Promise.all([
      readFile(generatedDatabasePath),
      readFile(RUNTIME_DATABASE_TEMPLATE_PATH)
    ]);
    const generatedDatabase = await import(pathToFileURL(generatedDatabasePath).href) as {
      createDatabase(): Record<string, unknown>;
      createRuntimeStore(persistence?: string): {
        persistence: string;
        database: Record<string, unknown>;
      };
    };

    expect(projectPackage.dependencies).toEqual(runtimeSpec.dependencies);
    expect(projectPackage.devDependencies).toEqual(runtimeSpec.devDependencies);
    expect(projectPackage.scripts['verify:runtime']).toBe('bun run test:unit');
    expect(projectPackage.scripts['verify:runtime:full']).toBeUndefined();
    expect(projectPackage.scripts['test:host']).toBe('node --test --experimental-test-isolation=none');
    expect(projectPackage.scripts['test:fast']).toBeUndefined();
    expect(projectPackage.scripts.dev).toBeUndefined();
    expect(projectPackage.scripts.build).toBeUndefined();
    expect(generatedDatabaseBytes).toEqual(templateBytes);
    expect(generatedDatabase.createDatabase()).toMatchObject({
      nextCustomerId: 1,
      customers: [],
      nextTicketId: 1,
      tickets: [],
      nextWorklogId: 1,
      worklogs: []
    });
    expect(generatedDatabase.createRuntimeStore('postgres-contract')).toMatchObject({
      persistence: 'postgres-contract',
      database: { customers: [], tickets: [], worklogs: [] }
    });
  }, 'engineering-compiler-runtime-library-');
});
