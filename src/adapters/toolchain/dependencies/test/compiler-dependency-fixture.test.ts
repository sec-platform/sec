import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { digest } from '../../../../contracts/canonical.ts';
import { settleResourcesAsync as settlePhysicalResourcesAsync } from '../../../../execution/resource-settlement.ts';
import { resolveSecWorkspaceRuntimeRoots } from '../../../runtime-state/workspace-state/paths.ts';

import { advanceDependencyTransition, beginDependencyTransition, compilerTransitionBackupPath } from '../runtime/dependency-transition/operation.ts';
import { runtimeDependencyOperationOptions } from '../runtime/operation-context.ts';
import { readRuntimeDependencyOperationTelemetry } from '../runtime/operation-telemetry.ts';
import {
  assertCompilerDependencyExecutionRetirementReceipt,
  assertCompilerDependencyReadGenerationRetirementReceipt,
  assertRetainedCompilerDependencyReadGeneration,
  observeCompilerDependencyExecutionGenerationAuthority,
  projectCompilerDepsReadyState,
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

async function removeFixtureRuntimeState(dependencyRoot: string): Promise<void> {
  if (!existsSync(dependencyRoot)) return;
  const runtimeRoots = resolveSecWorkspaceRuntimeRoots({ repositoryRoot: dependencyRoot });
  await rm(runtimeRoots.workspaceStateRoot, { recursive: true, force: true });
}

test('dependency fixture operation owns lifecycle-backed publication and retirement', async () => {
  const ownerRoot = await mkdtemp(path.join(tmpdir(), 'sec-dependency-fixture-owner-'));
  const dependencyRoot = path.join(ownerRoot, 'dependencies');
  let retainedGeneration: RetainedCompilerDependencyExecutionGeneration | null = null;
  let operation: Awaited<ReturnType<typeof issueCompilerDependencyFixtureOperation>> | null = null;
  let operationRetirementAttempted = false;
  let operationRetired = false;
  let primary: Readonly<{ label: string; error: unknown }> | undefined;
  try {
    operation = await issueCompilerDependencyFixtureOperation(
      fixtureDescriptor(dependencyRoot)
    );
    await expect(settleCompilerDependencyFixtureOperation({ ...operation }))
      .rejects.toThrow('was not issued by the dependency test owner');

    expect(await observeCompilerDependencyExecutionGenerationAuthority(
      { deadlineAtUnixMs: Date.now() + 30_000 },
      dependencyRoot
    )).toBeNull();
    await expect(lstat(path.join(dependencyRoot, '.tmp')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    const foreignNodeModules = path.join(dependencyRoot, 'node_modules');
    await mkdir(foreignNodeModules);
    await expect(observeCompilerDependencyExecutionGenerationAuthority(
      { deadlineAtUnixMs: Date.now() + 30_000 },
      dependencyRoot
    )).rejects.toThrow('present without an exact owner binding');
    await rm(foreignNodeModules, { recursive: true });

    const first = await settleCompilerDependencyFixtureOperation(operation);
    const observationOptions = runtimeDependencyOperationOptions({
      deadlineAtUnixMs: Date.now() + 30_000
    });
    const observedAuthority = await observeCompilerDependencyExecutionGenerationAuthority(
      observationOptions,
      dependencyRoot
    );
    expect(observedAuthority).not.toBeNull();
    expect(readRuntimeDependencyOperationTelemetry(observationOptions).phases
      .some(({ phase }) => phase === 'source-scan')).toBeFalse();
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
    expect(() => assertRetainedCompilerDependencyReadGeneration(readGeneration)).not.toThrow();
    expect(() => assertRetainedCompilerDependencyReadGeneration({ ...readGeneration }))
      .toThrow('not owner-issued');
    expect(() => assertRetainedCompilerDependencyReadGeneration({
      ...readGeneration,
      generationDigest: `sha256:${digest(Buffer.from('foreign-generation'))}`
    })).toThrow('not owner-issued');
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
    expect((await lstat(firstGenerationPath)).isDirectory()).toBeTrue();

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
    const runtimeRoots = resolveSecWorkspaceRuntimeRoots({ repositoryRoot: dependencyRoot });
    expect(await readdir(path.join(
      runtimeRoots.workspaceStateRoot,
      'compiler-dependency-coordination',
      'v1',
      'consumers'
    ))).toEqual([]);

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
        label: 'compiler-dependency-fixture-runtime-state',
        settle: async () => {
          if (operation !== null && !operationRetired) return;
          await removeFixtureRuntimeState(dependencyRoot);
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
  await removeFixtureRuntimeState(dependencyRoot);
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


test('explicit same-input generations serve two compiler consumers without materialization and retain the source owner lifetime', async () => {
  const ownerRoot = await mkdtemp(path.join(tmpdir(), 'sec-explicit-compiler-generation-'));
  const roots = ['source', 'reader', 'executor'].map((name) => path.join(ownerRoot, name));
  const operations = await Promise.all(roots.map((root) => issueCompilerDependencyFixtureOperation(fixtureDescriptor(root))));
  const retained: Array<{ retire: () => Promise<unknown> }> = [];
  const retiredOperations = new Set<typeof operations[number]>();
  let primary: Readonly<{ label: string; error: unknown }> | undefined;
  try {
    const source = await settleCompilerDependencyFixtureOperation(operations[0]!);
    const generationPath = await realpath(source.nodeModulesPath);
    const before = await lstat(generationPath, { bigint: true });
    for (const operation of operations.slice(1)) {
      const ready = await settleCompilerDependencyFixtureOperation(operation, source.executionGenerationAuthority);
      expect(await realpath(ready.nodeModulesPath)).toBe(generationPath);
      const current = await lstat(await realpath(ready.nodeModulesPath), { bigint: true });
      expect([current.dev, current.ino]).toEqual([before.dev, before.ino]);
    }
    // A completed compiler-locator transition is accepted by the actual read
    // and execution generation consumers, unlike a runtime callback bridge.
    const observed = await Promise.all(roots.slice(1).map((root) =>
      observeCompilerDependencyExecutionGenerationAuthority({}, root)));
    expect(observed.every((authority) => authority !== null)).toBeTrue();
    const reader = await retainCompilerDependencyReadGeneration(observed[0]!, {
      deadlineAtUnixMs: Date.now() + 60_000
    });
    retained.push(reader);
    const executor = await retainCompilerDependencyExecutionGeneration(observed[1]!, {
      deadlineAtUnixMs: Date.now() + 60_000
    });
    retained.push(executor);
    const repeated = await settleCompilerDependencyFixtureOperation(operations[1]!, source.executionGenerationAuthority);
    expect(await realpath(repeated.nodeModulesPath)).toBe(generationPath);
    expect(projectCompilerDepsReadyState(repeated.executionGenerationAuthority).requiresFreshProcess).toBeFalse();

    await rematerializeCompilerDependencyFixtureOperation(operations[0]!, 'fixture-lock-v2\n');
    expect((await lstat(generationPath)).isDirectory()).toBeTrue();
    await reader.assertAuthorityCurrent();
    await executor.physicalGeneration.assertAuthorityCurrent();
    await reader.retire();
    await settleCompilerDependencyFixtureOperation(operations[0]!);
    expect((await lstat(generationPath)).isDirectory()).toBeTrue();
    await executor.retire();
    await settleCompilerDependencyFixtureOperation(operations[0]!);
    await expect(lstat(generationPath)).rejects.toMatchObject({ code: 'ENOENT' });
  } catch (error) {
    primary = { label: 'explicit-compiler-generation-reuse', error };
  } finally {
    await settlePhysicalResourcesAsync({
      ...(primary === undefined ? {} : { primary }),
      cleanup: [
        ...retained.map((generation) => ({ label: 'retained-consumer', settle: async () => { await generation.retire(); } })),
        ...[...operations].reverse().map((operation) => ({ label: 'fixture-operation', settle: async () => {
          await retireCompilerDependencyFixtureOperation(operation);
          retiredOperations.add(operation);
        } })),
        { label: 'fixture-runtime-state', settle: async () => {
          for (const [index, root] of roots.entries()) {
            if (retiredOperations.has(operations[index]!)) await removeFixtureRuntimeState(root);
          }
        } },
        { label: 'fixture-root', settle: async () => {
          if (retiredOperations.size === operations.length) await rm(ownerRoot, { recursive: true, force: true });
        } }
      ]
    });
  }
}, 90_000);

test('explicit compiler generation reuse rejects forged, incompatible, stale and nonterminal source authority', async () => {
  const ownerRoot = await mkdtemp(path.join(tmpdir(), 'sec-explicit-compiler-rejection-'));
  const sourceRoot = path.join(ownerRoot, 'source');
  const borrowerRoot = path.join(ownerRoot, 'borrower');
  const descendantRoot = path.join(ownerRoot, 'descendant');
  const sourceOperation = await issueCompilerDependencyFixtureOperation(fixtureDescriptor(sourceRoot));
  const borrowerOperation = await issueCompilerDependencyFixtureOperation(fixtureDescriptor(borrowerRoot));
  const descendantOperation = await issueCompilerDependencyFixtureOperation(fixtureDescriptor(descendantRoot));
  const fixtureEntries = [[descendantRoot, descendantOperation], [borrowerRoot, borrowerOperation],
    [sourceRoot, sourceOperation]] as const;
  const retiredOperations = new Set<typeof sourceOperation>();
  let pending: Awaited<ReturnType<typeof beginDependencyTransition>> | undefined;
  const options = runtimeDependencyOperationOptions({});
  let primary: Readonly<{ label: string; error: unknown }> | undefined;
  try {
    const ready = await settleCompilerDependencyFixtureOperation(sourceOperation);
    const authority = ready.executionGenerationAuthority;
    await expect(settleCompilerDependencyFixtureOperation(borrowerOperation, { ...authority }))
      .rejects.toThrow('was not issued by its owner');
    await writeFile(path.join(borrowerRoot, 'bun.lock'), 'incompatible-lock\n');
    await expect(settleCompilerDependencyFixtureOperation(borrowerOperation, authority))
      .rejects.toThrow('incompatible canonical inputs');
    await writeFile(path.join(borrowerRoot, 'bun.lock'), 'fixture-lock-v1\n');
    await writeFile(path.join(sourceRoot, 'bun.lock'), 'stale-source-lock\n');
    await expect(settleCompilerDependencyFixtureOperation(borrowerOperation, authority))
      .rejects.toThrow('no longer current');
    await writeFile(path.join(sourceRoot, 'bun.lock'), 'fixture-lock-v1\n');
    const borrower = await settleCompilerDependencyFixtureOperation(borrowerOperation, authority);
    const current = await observeCompilerDependencyExecutionGenerationAuthority({}, sourceRoot);
    const generation = projectCompilerDepsReadyState(current!).sourceGeneration!;
    pending = await beginDependencyTransition({
      kind: 'compiler-locator', ownerRoot: sourceRoot,
      destinationPath: path.join(sourceRoot, 'node_modules'), stagePath: null,
      backupPath: compilerTransitionBackupPath(sourceRoot, 'locator-preimage', generation),
      sourceGeneration: generation, bindingDigest: generation.bindingDigest, options
    });
    await expect(settleCompilerDependencyFixtureOperation(descendantOperation, authority))
      .rejects.toThrow('blocked by nonterminal recovery state');
    // The borrower journal remains terminal, but cannot hide its physical
    // generation owner's nonterminal recovery state from another consumer.
    await expect(settleCompilerDependencyFixtureOperation(descendantOperation, borrower.executionGenerationAuthority))
      .rejects.toThrow('blocked by nonterminal recovery state');
    // A previously issued authority is re-admitted under source coordination;
    // the unlocked observation from before this journal cannot skip recovery.
    await expect(retainCompilerDependencyReadGeneration(authority, {
      deadlineAtUnixMs: Date.now() + 30_000
    })).rejects.toThrow('blocked by nonterminal recovery state');
    await expect(retainCompilerDependencyExecutionGeneration(authority, {
      deadlineAtUnixMs: Date.now() + 30_000
    })).rejects.toThrow('blocked by nonterminal recovery state');
    await expect(retainCompilerDependencyReadGeneration(borrower.executionGenerationAuthority, {
      deadlineAtUnixMs: Date.now() + 30_000
    })).rejects.toThrow('blocked by nonterminal recovery state');
    await expect(retainCompilerDependencyExecutionGeneration(borrower.executionGenerationAuthority, {
      deadlineAtUnixMs: Date.now() + 30_000
    })).rejects.toThrow('blocked by nonterminal recovery state');
    await expect(lstat(path.join(descendantRoot, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' });
    await advanceDependencyTransition(pending, { phase: 'rolled-back' }, options);
    pending = undefined;
    await settleCompilerDependencyFixtureOperation(descendantOperation, borrower.executionGenerationAuthority);
  } catch (error) {
    primary = { label: 'explicit-compiler-generation-rejections', error };
  } finally {
    await settlePhysicalResourcesAsync({
      ...(primary === undefined ? {} : { primary }),
      cleanup: [
        { label: 'pending-transition', settle: async () => { if (pending !== undefined) await advanceDependencyTransition(pending, { phase: 'rolled-back' }, options); } },
        ...fixtureEntries.map(([, operation]) => ({ label: 'fixture-operation', settle: async () => {
          await retireCompilerDependencyFixtureOperation(operation);
          retiredOperations.add(operation);
        } })),
        { label: 'fixture-runtime-state', settle: async () => {
          for (const [root, operation] of fixtureEntries) {
            if (retiredOperations.has(operation)) await removeFixtureRuntimeState(root);
          }
        } },
        { label: 'fixture-root', settle: async () => {
          if (retiredOperations.size === fixtureEntries.length) await rm(ownerRoot, { recursive: true, force: true });
        } }
      ]
    });
  }
}, 90_000);
