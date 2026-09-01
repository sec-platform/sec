import { lstat, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { digest } from '../../../system-architecture/foundation/runtime/canonical.ts';

import {
  assertCompilerDependencyExecutionRetirementReceipt,
  observeCompilerDependencyExecutionGenerationAuthority,
  retainCompilerDependencyExecutionGeneration,
  type RetainedCompilerDependencyExecutionGeneration
} from '../runtime/project-runtime.ts';
import {
  issueCompilerDependencyFixtureOperation,
  rematerializeCompilerDependencyFixtureOperation,
  retireCompilerDependencyFixtureOperation,
  settleCompilerDependencyFixtureOperation
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
  try {
    const operation = await issueCompilerDependencyFixtureOperation(
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

    await retireCompilerDependencyFixtureOperation(operation);
    await expect(settleCompilerDependencyFixtureOperation(operation))
      .rejects.toThrow('operation is retired');
  } finally {
    if (retainedGeneration !== null) await retainedGeneration.retire();
    await rm(ownerRoot, { recursive: true, force: true });
  }
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
