import { lstat, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { settlePhysicalResourcesAsync } from '../../../runtime-state/physical/runtime/resource-settlement.ts';
import { digest } from '../../../system-architecture/foundation/runtime/canonical.ts';

import {
  assertCompilerDependencyExecutionRetirementReceipt,
  assertCompilerDependencyReadGenerationRetirementReceipt,
  observeCompilerDependencyExecutionGenerationAuthority,
  retainCompilerDependencyExecutionGeneration,
  retainCompilerDependencyReadGeneration,
  type RetainedCompilerDependencyExecutionGeneration
} from '../runtime/project-runtime.ts';
import {
  issueCompilerDependencyFixtureOperation,
  rematerializeCompilerDependencyFixtureOperation,
  retireCompilerDependencyFixtureOperation,
  settleCompilerDependencyFixtureOperation,
  withCompilerDependencyFixtureOperation
} from './compiler-dependency-fixture.ts';

function fixtureDescriptor(dependencyRootPath: string) {
  return {
    dependencies: { yaml: '2.9.0' },
    dependencyRootPath,
    devDependencies: {
      '@types/bun': '1.4.0',
      '@types/node': '26.4.0',
      '@typescript/native': 'npm:typescript@7.0.2',
      typescript: '6.0.3'
    },
    lockfileBytes: 'fixture-lock-v1\n',
    packages: [{
      dependencies: { 'bun-types': '1.4.0' },
      name: '@types/bun',
      version: '1.4.0'
    }, {
      name: '@types/node',
      version: '26.4.0'
    }, {
      name: 'typescript',
      packagePath: '@typescript/native',
      version: '7.0.2'
    }, {
      name: 'bun-types',
      version: '1.4.0'
    }, {
      main: './lib/typescript.js',
      name: 'typescript',
      version: '6.0.3'
    }, {
      name: 'yaml',
      version: '2.9.0'
    }]
  } as const;
}

test('dependency fixture operation owns lifecycle-backed publication and retirement', async () => {
  const ownerRoot = await mkdtemp(path.join(tmpdir(), 'sec-dependency-fixture-owner-'));
  let retainedGeneration: RetainedCompilerDependencyExecutionGeneration | null = null;
  let operation: Awaited<ReturnType<typeof issueCompilerDependencyFixtureOperation>> | null = null;
  let operationRetirementAttempted = false;
  let operationRetired = false;
  let primary: Readonly<{ label: string; error: unknown }> | undefined;
  try {
    operation = await issueCompilerDependencyFixtureOperation(
      fixtureDescriptor(path.join(ownerRoot, 'dependencies'))
    );
    await expect(settleCompilerDependencyFixtureOperation({ ...operation }))
      .rejects.toThrow('was not issued by the dependency test owner');

    expect(await observeCompilerDependencyExecutionGenerationAuthority(
      { deadlineAtUnixMs: Date.now() + 30_000 },
      path.join(ownerRoot, 'dependencies')
    )).toBeNull();
    await expect(lstat(path.join(ownerRoot, 'dependencies', '.tmp')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    const foreignNodeModules = path.join(ownerRoot, 'dependencies', 'node_modules');
    await mkdir(foreignNodeModules);
    await expect(observeCompilerDependencyExecutionGenerationAuthority(
      { deadlineAtUnixMs: Date.now() + 30_000 },
      path.join(ownerRoot, 'dependencies')
    )).rejects.toThrow('present without an exact owner binding');
    await rm(foreignNodeModules, { recursive: true });

    const first = await settleCompilerDependencyFixtureOperation(operation);
    const observedAuthority = await observeCompilerDependencyExecutionGenerationAuthority(
      { deadlineAtUnixMs: Date.now() + 30_000 },
      path.join(ownerRoot, 'dependencies')
    );
    expect(observedAuthority).not.toBeNull();
    const firstGeneration = await retainCompilerDependencyExecutionGeneration(
      observedAuthority!,
      { deadlineAtUnixMs: Date.now() + 30_000 }
    );
    retainedGeneration = firstGeneration;
    const readGeneration = await retainCompilerDependencyReadGeneration(
      observedAuthority!,
      { deadlineAtUnixMs: Date.now() + 30_000 }
    );
    expect(readGeneration.generationDigest).toBe(observedAuthority!.generationDigest);
    const readRetirement = await readGeneration.retire();
    expect(await readGeneration.retire()).toBe(readRetirement);
    assertCompilerDependencyReadGenerationRetirementReceipt(
      readRetirement,
      observedAuthority!.generationDigest
    );
    expect(() => assertCompilerDependencyReadGenerationRetirementReceipt(
      { ...readRetirement },
      observedAuthority!.generationDigest
    )).toThrow('was not issued for the expected generation');
    expect(firstGeneration.directRootResolution).toEqual({
      entries: [{
        declaredName: '@types/bun',
        packageName: '@types/bun',
        resolvedVersion: '1.4.0'
      }, {
        declaredName: '@types/node',
        packageName: '@types/node',
        resolvedVersion: '26.4.0'
      }, {
        declaredName: '@typescript/native',
        packageName: 'typescript',
        resolvedVersion: '7.0.2'
      }, {
        declaredName: 'typescript',
        packageName: 'typescript',
        resolvedVersion: '6.0.3'
      }, {
        declaredName: 'yaml',
        packageName: 'yaml',
        resolvedVersion: '2.9.0'
      }],
      lockDigest: `sha256:${digest(Buffer.from('fixture-lock-v1\n'))}`
    });
    const firstGenerationPath = firstGeneration.physicalGeneration.root.path;
    const second = await rematerializeCompilerDependencyFixtureOperation(
      operation,
      'fixture-lock-v2\n'
    );
    expect(first.nodeModulesPath).toBe(second.nodeModulesPath);
    expect(second.executionGenerationAuthority).not.toBe(first.executionGenerationAuthority);
    expect((await lstat(firstGenerationPath)).isDirectory()).toBeTrue();

    const retirement = await firstGeneration.retire();
    expect(await firstGeneration.retire()).toBe(retirement);
    assertCompilerDependencyExecutionRetirementReceipt(retirement);
    expect(() => assertCompilerDependencyExecutionRetirementReceipt({ ...retirement }))
      .toThrow('was not issued by its owner');
    await expect(lstat(firstGenerationPath)).rejects.toMatchObject({ code: 'ENOENT' });

    const repeated = await settleCompilerDependencyFixtureOperation(operation);
    expect(repeated.nodeModulesPath).toBe(second.nodeModulesPath);
    await expect(lstat(firstGenerationPath)).rejects.toMatchObject({ code: 'ENOENT' });

    operationRetirementAttempted = true;
    await retireCompilerDependencyFixtureOperation(operation);
    operationRetired = true;
    await expect(settleCompilerDependencyFixtureOperation(operation))
      .rejects.toThrow('operation is retired');
  } catch (error) {
    primary = Object.freeze({
      label: 'compiler-dependency-fixture-test',
      error
    });
  } finally {
    await settlePhysicalResourcesAsync({
      ...(primary === undefined ? {} : { primary }),
      cleanup: [{
        label: 'compiler-dependency-fixture-retained-generation',
        settle: async () => {
          if (retainedGeneration !== null) await retainedGeneration.retire();
        }
      }, {
        label: 'compiler-dependency-fixture-operation',
        settle: async () => {
          if (operation === null || operationRetirementAttempted) return;
          operationRetirementAttempted = true;
          await retireCompilerDependencyFixtureOperation(operation);
          operationRetired = true;
        }
      }, {
        label: 'compiler-dependency-fixture-owner-root',
        settle: async () => {
          if (operation !== null && !operationRetired) return;
          await rm(ownerRoot, { recursive: true, force: true });
        }
      }]
    });
  }
}, 90_000);

test('dependency fixture finally retires generated state without replacing its primary failure', async () => {
  const ownerRoot = await mkdtemp(path.join(tmpdir(), 'sec-dependency-fixture-primary-'));
  const dependencyRoot = path.join(ownerRoot, 'dependencies');
  const primary = new Error('fixture primary failure');
  let observed: unknown;
  try {
    await withCompilerDependencyFixtureOperation(
      fixtureDescriptor(dependencyRoot),
      async (operation) => {
        await settleCompilerDependencyFixtureOperation(operation);
        throw primary;
      }
    );
  } catch (error) {
    observed = error;
  }
  expect(observed).toBe(primary);
  await expect(lstat(path.join(dependencyRoot, 'node_modules')))
    .rejects.toMatchObject({ code: 'ENOENT' });
  await rm(ownerRoot, { recursive: true, force: true });
}, 90_000);

test('dependency fixture rejects noncanonical package materialization before publication', async () => {
  const ownerRoot = await mkdtemp(path.join(tmpdir(), 'sec-dependency-fixture-invalid-'));
  try {
    await expect(issueCompilerDependencyFixtureOperation({
      ...fixtureDescriptor(path.join(ownerRoot, 'dependencies')),
      packages: [{ name: '../foreign', version: '1.0.0' }]
    })).rejects.toThrow('package name is noncanonical');
  } finally {
    await rm(ownerRoot, { recursive: true, force: true });
  }
});
