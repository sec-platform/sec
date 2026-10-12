import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { expect, test } from 'bun:test';

import { generateRuntimeLibraryScaffold } from '../../src/adapters/compilation/compose/generate-runtime-library.ts';
import { copyRecursive } from '../../src/adapters/filesystem/discovery.ts';
import { readJson } from "../../src/adapters/filesystem/files.ts";
import { loadRuntimeDependencySpec } from '../../src/adapters/toolchain/dependencies/contract/runtime-dependency-spec.ts';
import { compilerRuntimeResources } from '../../src/adapters/toolchain/runtime/layout.ts';
import { getWorkspacePaths } from "../../src/adapters/workspace-context.ts";
import { ensureProjectBase, RUNTIME_DATABASE_TEMPLATE_PATH } from '../../src/adapters/workspace/project-base.ts';
import type { LockFile } from '../../src/compiler/contract.ts';
import { createRawTestExecutableFixture } from '../testkit/raw-process.ts';
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
    expect(projectPackage.scripts['verify:runtime:full']).toBe('bun run test:unit');
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

    // Exercise the installed catalog assertion through the generated package
    // command, not a copy of its expected registration source.
    await copyRecursive(path.join(compilerRuntimeResources.officialRegistry, 'infra.postgres', 'files'), workspaceRoot);
    const runtimeRoot = path.join(paths.testsRoot, 'runtime', 'unit');
    await mkdir(runtimeRoot, { recursive: true });
    await writeFile(path.join(runtimeRoot, 'not-fast.test.ts'), "throw new Error('runtime tests must not enter test:fast');\n");
    const acceptanceRoot = path.join(paths.testsRoot, 'acceptance', 'nested');
    await mkdir(acceptanceRoot, { recursive: true });
    await writeFile(path.join(acceptanceRoot, 'customer # % flow.test.ts'),
      "export async function runSuite() { await Promise.resolve(); console.log('native-acceptance-called'); }\n");
    const generatedPaths = await generateRuntimeLibraryScaffold(workspaceRoot, { resolvedBlocks: [] } as unknown as LockFile);
    expect(generatedPaths).toContain('tests/fast.test.ts');
    const executable = createRawTestExecutableFixture();
    const runFast = async () => {
      const child = Bun.spawn([executable.command, 'run', 'test:fast'], {
        cwd: workspaceRoot, stdout: 'pipe', stderr: 'pipe'
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()
      ]);
      return { code, stdout, stderr };
    };
    try {
      const passed = await runFast();
      expect(passed.code, passed.stdout + passed.stderr).toBe(0);
      expect(passed.stdout.split('native-acceptance-called')).toHaveLength(2);
      const contractPath = path.join(paths.srcRoot, 'installed', 'infra', 'postgres-contract.ts');
      const source = await readFile(contractPath, 'utf8');
      await writeFile(contractPath, source.replace("provider: 'postgres'", "provider: 'broken-provider'"));
      const failed = await runFast();
      expect(failed.code).not.toBe(0);
      expect(failed.stdout + failed.stderr).toContain('broken-provider');
      await writeFile(path.join(paths.testsRoot, 'unit', 'postgres-contract.test.ts'), 'export {};\n');
      const missing = await runFast();
      expect(missing.code).not.toBe(0);
      expect(missing.stdout + missing.stderr).toContain('runSuite');
    } finally {
      executable.dispose();
    }
  }, 'engineering-compiler-runtime-library-');
});
