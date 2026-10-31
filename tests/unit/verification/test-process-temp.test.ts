import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';
import { settleResources, settleResourcesAsync } from '../../../src/execution/resource-settlement.ts';
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  PhysicalNoFollowError,
  inspectExactNoFollowDirectoryPresence,
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  scanNoFollowDirectoryDirectMetadata,
  scanNoFollowDirectoryTreeInventory
} from '../../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { resolveSecWorkspaceRuntimeRoots } from '../../../src/adapters/runtime-state/workspace-state/paths.ts';
import { DEFAULT_TEST_TIMEOUT_MS } from '../../../src/adapters/self-hosting/development/runner/test-execution-policy.ts';
import {
  consumeTestProcessTempAssignment,
  createTestInvocationRuntimeRoots,
  disposeRetainedTestInvocationRuntime,
  prepareTestInvocationRuntime,
  testInvocationRuntimeIsolationModeForPlatform,
  TestProcessTempLifecycleError
} from '../../../src/adapters/self-hosting/development/runner/test-process-temp.ts';

function generation(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function observeUnguardedFixturePreservation(
  input: Readonly<{ repositoryRoot: string; environment: NodeJS.ProcessEnv }>,
  directories: readonly string[]
): () => void {
  const roots = resolveSecWorkspaceRuntimeRoots(input);
  const leaseParent = inspectNoFollowDirectoryChain(roots.testProcessTempLeaseRoot, 'Fixture original lease parent').target;
  const leaseNames = scanNoFollowDirectoryDirectMetadata(leaseParent, {
    deadlineAtMs: performance.now() + 10_000, maximumEntries: 100
  }).filter(entry => entry.kind === 'file' && entry.relativePath.endsWith('.lease')).map(entry => entry.relativePath);
  expect(leaseNames.length).toBeGreaterThan(0);
  const observe = () => ({
    directories: directories.map(directory => {
      const presence = inspectExactNoFollowDirectoryPresence(directory, 'Fixture preserved generation');
      return presence.state === 'absent' ? { directory, state: 'absent' } : {
        directory, identity: presence.directory.target,
        inventory: scanNoFollowDirectoryTreeInventory(presence.directory.target, {
          deadlineAtMs: performance.now() + 10_000, maximumEntries: 1_000, maximumBytes: 1024 * 1024,
          includeByteDigest: true, includePermissionMode: true
        })
      };
    }),
    leases: leaseNames.map(name => ({ name, observation: inspectNoFollowOrdinaryFileEntry(leaseParent, name) }))
  });
  const before = observe();
  return () => expect(observe()).toEqual(before);
}

test('test invocation runtime advertises only platforms with retained physical authority', () => {
  expect(testInvocationRuntimeIsolationModeForPlatform('win32')).toBe('retained');
  expect(testInvocationRuntimeIsolationModeForPlatform('linux')).toBe('retained');
  expect(testInvocationRuntimeIsolationModeForPlatform('darwin')).toBe('unavailable');
});

for (const drift of ['none', 'binding', 'identity', 'cache-absent', 'tmp-absent', 'leases-absent', 'empty-state'] as const) {
  test.skipIf(process.platform !== 'win32')(`explicit disposable invocation discard preserves unknown history and rejects ${drift} drift`, async () => {
    const root = generation('sec-invocation-discard-');
    let rootMayBeRetired = true;
    await settleWorkspaceCallback(async () => {
      const repositoryRoot = path.join(root, 'repository');
      const hostTempRoot = path.join(root, 'host-temp');
      const environment = { SEC_STATE_HOME: path.join(root, 'state'), SEC_CACHE_HOME: path.join(root, 'cache') };
      mkdirSync(repositoryRoot);
      mkdirSync(hostTempRoot);
      // The original producer really creates these retained objects. The child
      // exiting does not certify its descendants or the historical attempt;
      // the subsequent callback authorizes disposal of this fixture today.
      const producer = new URL('../../../src/adapters/self-hosting/development/runner/test-process-temp.ts', import.meta.url).href;
      rootMayBeRetired = false;
      const child = spawnSync(process.execPath, ['--eval', `
        const { createTestInvocationRuntimeRoots } = await import(${JSON.stringify(producer)});
        const invocation = await createTestInvocationRuntimeRoots(${JSON.stringify({ repositoryRoot, hostTempRoot, environment })});
        const temporary = invocation.prepareProcessTemp({});
        console.log(JSON.stringify({ stateRoot: invocation.stateRoot, cacheRoot: invocation.cacheRoot, ...temporary }));
      `], { encoding: 'utf8', timeout: DEFAULT_TEST_TIMEOUT_MS, windowsHide: true });
      if (child.status !== 0) throw new Error(`Discard fixture producer failed: ${child.stderr}`, { cause: child.error });
      const temporary = JSON.parse(child.stdout.trim());
      const invocation = { stateRoot: temporary.stateRoot as string, cacheRoot: temporary.cacheRoot as string };
      writeFileSync(path.join(temporary.tempRoot, 'fixture.txt'), 'disposable fixture');
      const containerPath = path.dirname(temporary.processRoot);
      const bindingPath = path.join(invocation.stateRoot, 'temp-parent-binding.json');
      const bindingBytes = readFileSync(bindingPath);
      const binding = JSON.parse(bindingBytes.toString('utf8'));
      const leaseParent = inspectNoFollowDirectoryChain(resolveSecWorkspaceRuntimeRoots({ repositoryRoot, environment }).testProcessTempLeaseRoot,
        'Discard fixture lease parent').target;
      const lease = (prefix: string) => {
        const name = readdirSync(leaseParent.path).find(name => name.startsWith(prefix) && name.endsWith('.lease'))!;
        const entry = inspectNoFollowOrdinaryFileEntry(leaseParent, name)!;
        const bytes = Buffer.from(entry.bytes!);
        return { name, bytes, device: entry.device, inode: entry.inode, owner: JSON.parse(bytes.toString('utf8')).activeOwner };
      };
      const selection: Parameters<typeof disposeRetainedTestInvocationRuntime>[0]['selection'] = {
        invocationDigest: binding.invocationDigest, ownerDigest: binding.ownerDigest, bindingBytes,
        state: inspectNoFollowDirectoryChain(invocation.stateRoot, 'Discard fixture State').target,
        cache: inspectNoFollowDirectoryChain(invocation.cacheRoot, 'Discard fixture Cache').target,
        container: inspectNoFollowDirectoryChain(containerPath, 'Discard fixture TMP').target,
        runtimeLease: lease('runtime-'), invocationLease: lease('invocation-')
      };
      if (drift === 'binding') writeFileSync(bindingPath, Buffer.concat([bindingBytes, Buffer.from(' ')]));
      const selected = drift === 'identity' ? { ...selection, container: {
        ...selection.container!, inode: `${selection.container!.inode}0`
      } } : drift === 'cache-absent' ? { ...selection, cache: null }
        : drift === 'tmp-absent' ? { ...selection, container: null }
          : drift === 'empty-state' ? { ...selection, cache: null, container: null } : selection;
      if (drift === 'cache-absent') rmSync(invocation.cacheRoot, { recursive: true });
      if (drift === 'tmp-absent') rmSync(containerPath, { recursive: true });
      if (drift === 'empty-state') {
        rmSync(containerPath, { recursive: true });
        rmSync(invocation.cacheRoot, { recursive: true });
        rmSync(bindingPath);
      }
      if (drift === 'leases-absent' || drift === 'empty-state') for (const original of [selection.runtimeLease, selection.invocationLease]) {
        rmSync(path.join(leaseParent.path, original.name));
      }
      const discard = () => disposeRetainedTestInvocationRuntime({ repositoryRoot, environment, selection: selected,
        reviewDiscard: async () => ({ disposition: 'discard', reference: 'explicit fixture disposal by its test author' }) });
      if (drift === 'none' || drift === 'cache-absent' || drift === 'tmp-absent' || drift === 'leases-absent' || drift === 'empty-state') {
        const discarded = await discard();
        rootMayBeRetired = true;
        expect(discarded).toEqual({ retentionReleased: true, historicalAttempt: 'UNVERIFIED' });
        if (drift === 'empty-state') {
          rootMayBeRetired = false;
          const discardedAgain = await discard();
          rootMayBeRetired = true;
          expect(discardedAgain).toEqual({ retentionReleased: true, historicalAttempt: 'UNVERIFIED' });
        }
        for (const directory of [containerPath, invocation.cacheRoot, invocation.stateRoot]) expect(existsSync(directory)).toBe(false);
        for (const original of [selection.runtimeLease, selection.invocationLease]) expect(existsSync(path.join(leaseParent.path, original.name))).toBe(false);
      } else {
        await expect(discard()).rejects.toThrow();
        expect(readFileSync(path.join(temporary.tempRoot, 'fixture.txt'), 'utf8')).toBe('disposable fixture');
        for (const original of [selection.runtimeLease, selection.invocationLease]) expect(readFileSync(path.join(leaseParent.path, original.name))).toEqual(Buffer.from(original.bytes));
        // Restore only the fixture's own changed binding, then use the same
        // explicit discard owner with the actual original physical selection.
        if (drift === 'binding') writeFileSync(bindingPath, bindingBytes);
        await disposeRetainedTestInvocationRuntime({ repositoryRoot, environment, selection,
          reviewDiscard: async () => ({ disposition: 'discard', reference: 'explicit fixture disposal by its test author' }) });
        rootMayBeRetired = true;
      }
    }, async () => {
      if (!rootMayBeRetired) throw new Error(`Historical invocation disposal remains unresolved; fixture root retained: ${root}`);
      rmSync(root, { recursive: true, force: true });
    });
  }, DEFAULT_TEST_TIMEOUT_MS);
}

test.skipIf(process.platform !== 'win32')('test process temp rejects an unavailable Windows path budget before any generation effect', async () => {
  const repositoryRoot = generation('sec-temp-budget-repository-');
  let stateRoot: string | undefined;
  let cacheRoot: string | undefined;
  let admissionSettled = true;
  const hostTempRoot = path.join(tmpdir(), 'x'.repeat(200));
  await settleWorkspaceCallback(async () => {
    stateRoot = generation('sec-temp-budget-state-');
    cacheRoot = generation('sec-temp-budget-cache-');
    expect(existsSync(hostTempRoot)).toBe(false);
    admissionSettled = false;
    await expect(prepareTestInvocationRuntime({
      repositoryRoot,
      hostTempRoot,
      environment: { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot },
      pathBudget: 'canonical-test-runtime'
    })).rejects.toMatchObject({ code: 'TEST_PROCESS_TEMP_PATH_BUDGET_UNAVAILABLE' });
    admissionSettled = true;
    expect(existsSync(hostTempRoot)).toBe(false);
    expect(readdirSync(stateRoot)).toEqual([]);
    expect(readdirSync(cacheRoot)).toEqual([]);
  }, async () => {
    if (!admissionSettled) throw new Error(`Invocation admission remains unresolved; fixture roots retained: ${[repositoryRoot, stateRoot, cacheRoot].filter(target => target !== undefined).join(", ")}`);
    settleResources({ cleanup: [repositoryRoot, stateRoot, cacheRoot]
      .filter((target): target is string => target !== undefined)
      .map(target => ({ label: target, settle: () => rmSync(target, { recursive: true, force: true }) })) });
  });
});

test('test process temp rejects OS temp overlap before creating a generation', async () => {
  const root = generation('sec-temp-owner-overlap-');
  let admissionSettled = true;
  await settleWorkspaceCallback(async () => {
    const repositoryRoot = path.join(root, 'repository');
    const stateRoot = path.join(root, 'state');
    const cacheRoot = path.join(root, 'cache');
    mkdirSync(repositoryRoot);
    mkdirSync(stateRoot);
    mkdirSync(cacheRoot);
    const environment: NodeJS.ProcessEnv = { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot };
    const candidateParents = [repositoryRoot, stateRoot, cacheRoot];
    for (const hostTempRoot of candidateParents) {
      let unexpected: Awaited<ReturnType<typeof createTestInvocationRuntimeRoots>> | undefined;
      await settleWorkspaceCallback(async () => {
        admissionSettled = false;
        await expect(createTestInvocationRuntimeRoots({ repositoryRoot, hostTempRoot, environment })
          .then(runtime => { unexpected = runtime; return runtime; }))
          .rejects.toMatchObject({
            code: 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH',
            message: expect.stringContaining('must be physically disjoint')
          });
        admissionSettled = true;
        expect(candidateParents.map(parent => readdirSync(parent))).toEqual([[], [], []]);
      }, async () => {
        if (unexpected !== undefined) {
          await unexpected.cleanup();
          admissionSettled = true;
        }
      });
    }
  }, async () => {
    if (!admissionSettled) throw new Error(`Overlap admission remains unresolved; fixture root retained: ${root}`);
    rmSync(root, { recursive: true, force: true });
  });
});

test('test invocation runtime owns private roots, rejects aliases, and surfaces replacement-safe cleanup', async () => {
  const root = generation('sec-invocation-runtime-owner-');
  let owned: Awaited<ReturnType<typeof createTestInvocationRuntimeRoots>> | undefined;
  let replaced: Awaited<ReturnType<typeof createTestInvocationRuntimeRoots>> | undefined;
  let unexpectedAlias: Awaited<ReturnType<typeof createTestInvocationRuntimeRoots>> | undefined;
  let displaced: string | undefined;
  let replacementInstalled = false;
  let admissionSettled = true;
  await settleWorkspaceCallback(async () => {
    const repositoryRoot = path.join(root, 'repository');
    const hostTempRoot = path.join(root, 'host-temp');
    const stateAlias = path.join(root, 'state-alias');
    const stateRoot = path.join(root, 'state');
    const cacheRoot = path.join(root, 'cache');
    mkdirSync(repositoryRoot);
    mkdirSync(hostTempRoot);
    symlinkSync(repositoryRoot, stateAlias, process.platform === 'win32' ? 'junction' : 'dir');
    admissionSettled = false;
    await expect(createTestInvocationRuntimeRoots({
      repositoryRoot,
      hostTempRoot,
      environment: { SEC_STATE_HOME: stateAlias, SEC_CACHE_HOME: cacheRoot }
    }).then(runtime => { unexpectedAlias = runtime; return runtime; }, error => {
      // This local symlink is rejected by no-follow admission before a retained
      // authority is issued. An unrelated failure does not reopen the gate.
      admissionSettled = error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH';
      throw error;
    })).rejects.toThrow();
    if (!admissionSettled) throw new Error(`Alias admission remains unresolved; fixture root retained: ${root}`);
    expect(existsSync(path.join(repositoryRoot, 'test-invocation-runs'))).toBe(false);

    admissionSettled = false;
    owned = await createTestInvocationRuntimeRoots({
      repositoryRoot,
      hostTempRoot,
      environment: { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot }
    });
    admissionSettled = true;
    expect(owned.stateRoot).not.toBe(owned.cacheRoot);
    if (process.platform === 'linux') {
      expect(lstatSync(owned.stateRoot).mode & 0o077).toBe(0);
      expect(lstatSync(owned.cacheRoot).mode & 0o077).toBe(0);
    }
    writeFileSync(path.join(owned.stateRoot, 'state.json'), '{}');
    writeFileSync(path.join(owned.cacheRoot, 'cache.json'), '{}');
    await owned.cleanup();
    expect(existsSync(owned.stateRoot)).toBe(false);
    expect(existsSync(owned.cacheRoot)).toBe(false);

    if (process.platform === 'linux') {
      chmodSync(stateRoot, 0o755);
      chmodSync(cacheRoot, 0o755);
    }
    admissionSettled = false;
    replaced = await createTestInvocationRuntimeRoots({
      repositoryRoot,
      hostTempRoot,
      environment: { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot }
    });
    admissionSettled = true;
    if (process.platform === 'linux') {
      expect(lstatSync(stateRoot).mode & 0o077).toBe(0);
      expect(lstatSync(cacheRoot).mode & 0o077).toBe(0);
    }
    displaced = `${replaced.stateRoot}.displaced`;
    renameSync(replaced.stateRoot, displaced);
    mkdirSync(replaced.stateRoot);
    replacementInstalled = true;
    await expect(replaced.cleanup()).rejects.toMatchObject({
      code: 'TEST_PROCESS_TEMP_CLEANUP_FAILED',
      pendingRecovery: {
        ownerDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u)
      }
    });
    expect(existsSync(replaced.stateRoot)).toBe(true);
    expect(existsSync(displaced)).toBe(true);
    expect(existsSync(replaced.cacheRoot)).toBe(false);
  }, async () => {
    if (unexpectedAlias !== undefined) {
      await unexpectedAlias.cleanup();
      admissionSettled = true;
    }
    if (!admissionSettled) throw new Error(`Invocation admission remains unresolved; fixture root retained: ${root}`);
    if (replaced !== undefined && displaced !== undefined && existsSync(displaced)) {
      if (replacementInstalled) {
        rmSync(replaced.stateRoot, { recursive: true });
        replacementInstalled = false;
      } else if (existsSync(replaced.stateRoot)) {
        throw new Error(`Replacement namespace is unresolved; fixture root retained: ${root}`);
      }
      renameSync(displaced, replaced.stateRoot);
    }
    await settleResourcesAsync({ cleanup: [
      { label: 'replacement invocation', settle: async () => { await replaced?.cleanup(); } },
      { label: 'original invocation', settle: async () => { await owned?.cleanup(); } }
    ] });
    rmSync(root, { recursive: true, force: true });
  });
});

test('direct test invocation binds and retires one State Cache and TMP generation then restores environment', async () => {
  const root = generation('sec-direct-test-runtime-');
  let runtime: Awaited<ReturnType<typeof prepareTestInvocationRuntime>> | undefined;
  let admissionSettled = true;
  let cleanupAttempted = false;
  let cleanupSettled = false;
  await settleWorkspaceCallback(async () => {
    const repositoryRoot = path.join(root, 'repository');
    const hostTempRoot = path.join(root, 'host-temp');
    const stateRoot = path.join(root, 'state');
    const cacheRoot = path.join(root, 'cache');
    for (const directory of [repositoryRoot, hostTempRoot]) mkdirSync(directory);
    const environment: NodeJS.ProcessEnv = {
      SEC_STATE_HOME: stateRoot,
      SEC_CACHE_HOME: cacheRoot,
      TMP: 'original-tmp',
      TEMP: 'original-temp'
    };
    admissionSettled = false;
    runtime = await prepareTestInvocationRuntime({ repositoryRoot, hostTempRoot, environment });
    admissionSettled = true;
    expect(runtime.ownership).toBe('direct');
    expect(environment.SEC_STATE_HOME).toBe(runtime.stateRoot);
    expect(environment.SEC_CACHE_HOME).toBe(runtime.cacheRoot);
    expect(environment.TMP).toBe(runtime.tempRoot);
    expect(environment.TEMP).toBe(runtime.tempRoot);
    expect(environment.TMPDIR).toBe(runtime.tempRoot);
    expect(runtime.tempRoot).toBe(path.join(runtime.processRoot, 'tmp'));
    expect(existsSync(runtime.processRoot)).toBe(true);
    cleanupAttempted = true;
    await runtime.cleanup();
    cleanupSettled = true;
    expect(existsSync(runtime.processRoot)).toBe(false);
    expect(existsSync(runtime.stateRoot)).toBe(false);
    expect(existsSync(runtime.cacheRoot)).toBe(false);
    expect(existsSync(hostTempRoot)).toBe(true);
    expect(environment).toEqual({
      SEC_STATE_HOME: stateRoot,
      SEC_CACHE_HOME: cacheRoot,
      TMP: 'original-tmp',
      TEMP: 'original-temp'
    });
  }, async () => {
    if (runtime !== undefined && !cleanupAttempted) {
      cleanupAttempted = true;
      await runtime.cleanup();
      cleanupSettled = true;
    }
    if (!admissionSettled || (runtime !== undefined && !cleanupSettled)) {
      throw new Error(`Invocation admission or retirement remains unresolved; fixture root retained: ${root}`);
    }
    rmSync(root, { recursive: true, force: true });
  });
});

test('two direct invocations in one workspace own independent concurrent lifecycle generations', async () => {
  const root = generation('sec-direct-test-runtime-concurrent-');
  const repositoryRoot = path.join(root, 'repository');
  const hostTempRoot = path.join(root, 'host-temp');
  const stateRoot = path.join(root, 'state');
  const cacheRoot = path.join(root, 'cache');
  const leftEnvironment: NodeJS.ProcessEnv = { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot };
  const rightEnvironment: NodeJS.ProcessEnv = { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot };
  let left: Awaited<ReturnType<typeof prepareTestInvocationRuntime>> | undefined;
  let right: Awaited<ReturnType<typeof prepareTestInvocationRuntime>> | undefined;
  let third: Awaited<ReturnType<typeof prepareTestInvocationRuntime>> | undefined;
  let admissionSettled = true;
  await settleWorkspaceCallback(async () => {
    for (const directory of [repositoryRoot, hostTempRoot]) mkdirSync(directory);
    admissionSettled = false;
    left = await prepareTestInvocationRuntime({ repositoryRoot, hostTempRoot, environment: leftEnvironment });
    admissionSettled = true;
    admissionSettled = false;
    right = await prepareTestInvocationRuntime({ repositoryRoot, hostTempRoot, environment: rightEnvironment });
    admissionSettled = true;
    expect(left.ownership).toBe('direct');
    expect(right.ownership).toBe('direct');
    expect(left.processRoot).not.toBe(right.processRoot);
    expect(existsSync(left.processRoot)).toBe(true);
    expect(existsSync(right.processRoot)).toBe(true);
    const thirdEnvironment: NodeJS.ProcessEnv = { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot };
    admissionSettled = false;
    const [thirdStart, leftClose] = await Promise.allSettled([
      prepareTestInvocationRuntime({ repositoryRoot, hostTempRoot, environment: thirdEnvironment }),
      left.cleanup()
    ]);
    if (thirdStart.status === 'fulfilled') { third = thirdStart.value; admissionSettled = true; }
    const failures = [leftClose, thirdStart].flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'Concurrent invocation admission and retirement failed');
    expect(existsSync(right.processRoot)).toBe(true);
  }, async () => {
    await settleResourcesAsync({ cleanup: [
      { label: 'third invocation', settle: async () => { await third?.cleanup(); } },
      { label: 'left invocation', settle: async () => { await left?.cleanup(); } },
      { label: 'right invocation', settle: async () => { await right?.cleanup(); } }
    ] });
    if (!admissionSettled) throw new Error(`Invocation admission remains unresolved; fixture root retained: ${root}`);
    rmSync(root, { recursive: true, force: true });
  });
  expect(rightEnvironment).toEqual({ SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot });
});

test('runner-assigned test invocation adopts parent roots without creating a nested runtime generation', async () => {
  const root = generation('sec-assigned-test-runtime-');
  let parent: Awaited<ReturnType<typeof createTestInvocationRuntimeRoots>> | undefined;
  let runtime: Awaited<ReturnType<typeof prepareTestInvocationRuntime>> | undefined;
  let admissionSettled = true;
  let runtimeCleanupAttempted = false;
  let runtimeCleanupSettled = false;
  await settleWorkspaceCallback(async () => {
    const repositoryRoot = path.join(root, 'repository');
    const hostTempRoot = path.join(root, 'host-temp');
    const stateRoot = path.join(root, 'state');
    const cacheRoot = path.join(root, 'cache');
    for (const directory of [repositoryRoot, hostTempRoot]) mkdirSync(directory);
    admissionSettled = false;
    parent = await createTestInvocationRuntimeRoots({
      repositoryRoot,
      hostTempRoot,
      environment: { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot }
    });
    admissionSettled = true;
    const environment = {
      SEC_STATE_HOME: path.join(parent.stateRoot, 'invocation-runtime', 'assigned'),
      SEC_CACHE_HOME: path.join(parent.cacheRoot, 'invocation-runtime', 'assigned')
    } satisfies NodeJS.ProcessEnv;
    const child = parent.prepareProcessTemp(environment);
    admissionSettled = false;
    runtime = await prepareTestInvocationRuntime({ repositoryRoot, hostTempRoot, environment });
    admissionSettled = true;
    expect(runtime.ownership).toBe('parent-assigned');
    expect(runtime.stateRoot).toBe(environment.SEC_STATE_HOME);
    expect(runtime.cacheRoot).toBe(environment.SEC_CACHE_HOME);
    expect(runtime.processRoot).toBe(child.processRoot);
    expect(existsSync(path.join(parent.stateRoot, 'test-invocation-runs'))).toBe(false);
    expect(existsSync(path.join(parent.cacheRoot, 'test-invocation-runs'))).toBe(false);
    runtimeCleanupAttempted = true;
    await runtime.cleanup();
    runtimeCleanupSettled = true;
    expect(existsSync(child.processRoot)).toBe(true);
    await child.cleanup();
    expect(existsSync(child.processRoot)).toBe(false);
  }, async () => {
    if (!admissionSettled) throw new Error(`Assigned invocation admission remains unresolved; fixture root retained: ${root}`);
    if (runtime !== undefined && !runtimeCleanupAttempted) {
      runtimeCleanupAttempted = true;
      await runtime.cleanup();
      runtimeCleanupSettled = true;
    }
    if (runtime !== undefined && !runtimeCleanupSettled) {
      throw new Error(`Assigned invocation retirement remains unresolved; fixture root retained: ${root}`);
    }
    await parent?.cleanup();
    rmSync(root, { recursive: true, force: true });
  });
});

test('parent supervisor owns child temp cleanup and retires a junction leaf without touching its target', async () => {
  const root = generation('sec-process-temp-parent-owner-');
  let runtime: Awaited<ReturnType<typeof createTestInvocationRuntimeRoots>> | undefined;
  let admissionSettled = true;
  await settleWorkspaceCallback(async () => {
    const repositoryRoot = path.join(root, 'repository');
    const hostTempRoot = path.join(root, 'host-temp');
    const stateRoot = path.join(root, 'state');
    const cacheRoot = path.join(root, 'cache');
    const externalTarget = path.join(root, 'external-target');
    for (const directory of [repositoryRoot, hostTempRoot, externalTarget]) mkdirSync(directory);
    admissionSettled = false;
    runtime = await createTestInvocationRuntimeRoots({
      repositoryRoot,
      hostTempRoot,
      environment: { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot }
    });
    admissionSettled = true;
    const environment: NodeJS.ProcessEnv = {};
    const generation = runtime.prepareProcessTemp(environment);
    const adopted = consumeTestProcessTempAssignment({ environment });
    expect(adopted?.processRoot).toBe(generation.processRoot);
    symlinkSync(externalTarget, path.join(generation.tempRoot, 'retained-link'),
      process.platform === 'win32' ? 'junction' : 'dir');
    writeFileSync(path.join(externalTarget, 'preserved.txt'), 'preserved');
    await generation.cleanup();
    expect(existsSync(generation.processRoot)).toBe(false);
    expect(existsSync(path.join(externalTarget, 'preserved.txt'))).toBe(true);
  }, async () => {
    if (!admissionSettled) throw new Error(`Invocation admission remains unresolved; fixture root retained: ${root}`);
    await runtime?.cleanup();
    rmSync(root, { recursive: true, force: true });
  });
});

test('new invocation preserves unguarded predecessor bytes and native identities despite a dead PID claim', async () => {
  const root = generation('sec-process-temp-lost-handle-');
  let abandoned: Awaited<ReturnType<typeof createTestInvocationRuntimeRoots>> | undefined;
  let successor: Awaited<ReturnType<typeof createTestInvocationRuntimeRoots>> | undefined;
  let preserved: (() => void) | undefined;
  let admissionSettled = true;
  await settleWorkspaceCallback(async () => {
    const repositoryRoot = path.join(root, 'repository');
    const hostTempRoot = path.join(root, 'host-temp');
    const successorTempRoot = path.join(root, 'successor-temp');
    const stateRoot = path.join(root, 'state');
    const cacheRoot = path.join(root, 'cache');
    mkdirSync(repositoryRoot);
    mkdirSync(hostTempRoot);
    mkdirSync(successorTempRoot);
    const abandonedOwnerPid = 41_001;
    const invocationKey = '10000000-0000-4000-8000-000000000001';
    admissionSettled = false;
    abandoned = await createTestInvocationRuntimeRoots({
      repositoryRoot,
      hostTempRoot,
      environment: { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot },
      invocationKey,
      testOnlyOwnerPid: abandonedOwnerPid,
      testOnlyProcessAlive: () => 'alive',
      testOnlyProcessNonce: '20000000-0000-4000-8000-000000000001'
    });
    admissionSettled = true;
    const lostHandle = abandoned.prepareProcessTemp({});
    const abandonedStateRoot = abandoned.stateRoot;
    const abandonedCacheRoot = abandoned.cacheRoot;
    writeFileSync(path.join(lostHandle.tempRoot, 'timeout-residue.txt'), 'residue');
    if (process.platform === 'linux') {
      for (const ownerRoot of [abandonedStateRoot, abandonedCacheRoot, lostHandle.tempRoot]) {
        const sealed = path.join(ownerRoot, 'readonly-package');
        mkdirSync(sealed);
        writeFileSync(path.join(sealed, 'lib.d.ts'), 'dead-owner residue');
        chmodSync(path.join(sealed, 'lib.d.ts'), 0o444);
        chmodSync(sealed, 0o555);
      }
    }
    preserved = observeUnguardedFixturePreservation({ repositoryRoot,
      environment: { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot }
    }, [abandonedStateRoot, abandonedCacheRoot, lostHandle.processRoot]);
    admissionSettled = false;
    successor = await createTestInvocationRuntimeRoots({
      repositoryRoot,
      hostTempRoot: successorTempRoot,
      environment: { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot },
      invocationKey,
      testOnlyOwnerPid: 41_002,
      testOnlyProcessAlive: (pid) => pid === abandonedOwnerPid ? 'dead' : 'alive',
      testOnlyProcessNonce: '20000000-0000-4000-8000-000000000002'
    });
    admissionSettled = true;
    preserved();
    expect(existsSync(successor.stateRoot)).toBe(true);
    expect(existsSync(successor.cacheRoot)).toBe(true);
  }, async () => {
    await settleResourcesAsync({ cleanup: [
      { label: 'successor invocation', settle: async () => { await successor?.cleanup(); } },
      { label: 'original history readback', settle: () => preserved?.() },
      // Only the original live capability settles its fixture, not the PID claim.
      { label: 'original invocation', settle: async () => { await abandoned?.cleanup(); } }
    ] });
    if (!admissionSettled) throw new Error(`Invocation admission remains unresolved; fixture root retained: ${root}`);
    rmSync(root, { recursive: true, force: true });
  });
});

test('failed temp retirement blocks unguarded successor takeover until original-owner settlement', async () => {
  const root = generation('sec-temp-failed-retirement-');
  let abandoned: Awaited<ReturnType<typeof createTestInvocationRuntimeRoots>> | undefined;
  let successor: Awaited<ReturnType<typeof createTestInvocationRuntimeRoots>> | undefined;
  let admissionSettled = true;
  await settleWorkspaceCallback(async () => {
    const repositoryRoot = path.join(root, 'repository');
    const hostTempRoot = path.join(root, 'host-temp');
    mkdirSync(repositoryRoot);
    mkdirSync(hostTempRoot);
    const input = {
      repositoryRoot,
      hostTempRoot,
      environment: { SEC_STATE_HOME: path.join(root, 'state'), SEC_CACHE_HOME: path.join(root, 'cache') },
      invocationKey: '10000000-0000-4000-8000-000000000002'
    };
    admissionSettled = false;
    abandoned = await createTestInvocationRuntimeRoots({
      ...input,
      testOnlyOwnerPid: 41_003,
      testOnlyProcessAlive: () => 'alive',
      testOnlyProcessNonce: '20000000-0000-4000-8000-000000000003'
    });
    admissionSettled = true;
    const owned = abandoned.prepareProcessTemp({});
    const displaced = `${owned.processRoot}.displaced`;
    renameSync(owned.processRoot, displaced);
    mkdirSync(owned.processRoot);
    await expect(abandoned.cleanup()).rejects.toMatchObject({ code: 'TEST_PROCESS_TEMP_CLEANUP_FAILED' });
    expect(existsSync(displaced)).toBe(true);
    const preserved = observeUnguardedFixturePreservation(input,
      [abandoned.stateRoot, abandoned.cacheRoot, owned.processRoot, displaced]);
    admissionSettled = false;
    await expect(createTestInvocationRuntimeRoots({
      ...input,
      testOnlyOwnerPid: 41_004,
      testOnlyProcessAlive: pid => pid === 41_003 ? 'dead' : 'alive',
      testOnlyProcessNonce: '20000000-0000-4000-8000-000000000004'
    })).rejects.toMatchObject({ code: 'TEST_PROCESS_TEMP_OWNED' });
    admissionSettled = true;
    preserved();
    rmSync(owned.processRoot, { recursive: true });
    renameSync(displaced, owned.processRoot);
    await abandoned.cleanup();
    admissionSettled = false;
    successor = await createTestInvocationRuntimeRoots({
      ...input,
      testOnlyOwnerPid: 41_004,
      testOnlyProcessAlive: pid => pid === 41_003 ? 'dead' : 'alive',
      testOnlyProcessNonce: '20000000-0000-4000-8000-000000000004'
    });
    admissionSettled = true;
    expect(existsSync(owned.processRoot)).toBe(false);
    const next = successor.prepareProcessTemp({});
    const nextDisplaced = `${next.processRoot}.displaced`;
    renameSync(next.processRoot, nextDisplaced);
    mkdirSync(next.processRoot);
    await expect(successor.cleanup()).rejects.toMatchObject({ code: 'TEST_PROCESS_TEMP_CLEANUP_FAILED' });
    expect(() => successor!.prepareProcessTemp({})).toThrow();
    rmSync(next.processRoot, { recursive: true });
    renameSync(nextDisplaced, next.processRoot);
    await successor.cleanup();
    expect(existsSync(next.processRoot)).toBe(false);
  }, async () => {
    if (!admissionSettled) throw new Error(`Shared invocation admission remains unresolved; fixture root retained: ${root}`);
    await settleResourcesAsync({ cleanup: [
      { label: 'successor invocation', settle: async () => { await successor?.cleanup(); } },
      { label: 'original invocation', settle: async () => { await abandoned?.cleanup(); } }
    ] });
    rmSync(root, { recursive: true, force: true });
  });
});

test('unguarded successor remains blocked after generation restoration until original-owner settlement', async () => {
  const root = generation('sec-temp-failed-successor-reclaim-');
  let abandoned: Awaited<ReturnType<typeof createTestInvocationRuntimeRoots>> | undefined;
  let successor: Awaited<ReturnType<typeof createTestInvocationRuntimeRoots>> | undefined;
  let admissionSettled = true;
  await settleWorkspaceCallback(async () => {
    const repositoryRoot = path.join(root, 'repository');
    const hostTempRoot = path.join(root, 'host-temp');
    mkdirSync(repositoryRoot);
    mkdirSync(hostTempRoot);
    const input = {
      repositoryRoot,
      hostTempRoot,
      environment: { SEC_STATE_HOME: path.join(root, 'state'), SEC_CACHE_HOME: path.join(root, 'cache') },
      invocationKey: '10000000-0000-4000-8000-000000000003'
    };
    admissionSettled = false;
    abandoned = await createTestInvocationRuntimeRoots({
      ...input,
      testOnlyOwnerPid: 41_005,
      testOnlyProcessAlive: () => 'alive',
      testOnlyProcessNonce: '20000000-0000-4000-8000-000000000005'
    });
    admissionSettled = true;
    const owned = abandoned.prepareProcessTemp({});
    const displaced = `${owned.processRoot}.displaced`;
    renameSync(owned.processRoot, displaced);
    mkdirSync(owned.processRoot);
    const preserved = observeUnguardedFixturePreservation(input,
      [abandoned.stateRoot, abandoned.cacheRoot, owned.processRoot, displaced]);

    admissionSettled = false;
    await expect(createTestInvocationRuntimeRoots({
      ...input,
      testOnlyOwnerPid: 41_006,
      testOnlyProcessAlive: pid => pid === 41_005 ? 'dead' : 'alive',
      testOnlyProcessNonce: '20000000-0000-4000-8000-000000000006'
    })).rejects.toMatchObject({ code: 'TEST_PROCESS_TEMP_OWNED' });
    admissionSettled = true;
    preserved();

    rmSync(owned.processRoot, { recursive: true });
    renameSync(displaced, owned.processRoot);
    const restored = observeUnguardedFixturePreservation(input,
      [abandoned.stateRoot, abandoned.cacheRoot, owned.processRoot]);
    admissionSettled = false;
    await expect(createTestInvocationRuntimeRoots({
      ...input,
      testOnlyOwnerPid: 41_007,
      testOnlyProcessAlive: pid => pid === 41_005 ? 'dead' : 'alive',
      testOnlyProcessNonce: '20000000-0000-4000-8000-000000000007'
    })).rejects.toMatchObject({ code: 'TEST_PROCESS_TEMP_OWNED' });
    admissionSettled = true;
    restored();
    await abandoned.cleanup();
    admissionSettled = false;
    successor = await createTestInvocationRuntimeRoots(input);
    admissionSettled = true;
    expect(existsSync(owned.processRoot)).toBe(false);
    await successor.cleanup();
  }, async () => {
    if (!admissionSettled) throw new Error(`Shared invocation admission remains unresolved; fixture root retained: ${root}`);
    await settleResourcesAsync({ cleanup: [
      { label: 'successor invocation', settle: async () => { await successor?.cleanup(); } },
      { label: 'original invocation', settle: async () => { await abandoned?.cleanup(); } }
    ] });
    rmSync(root, { recursive: true, force: true });
  });
});

test.each(['missing-state', 'changed-binding'] as const)(
  'new invocation preserves unguarded original binding and native identities after %s', async (fault) => {
    const root = generation('sec-runtime-recovery-binding-');
    let abandoned: Awaited<ReturnType<typeof createTestInvocationRuntimeRoots>> | undefined;
    let independent: Awaited<ReturnType<typeof createTestInvocationRuntimeRoots>> | undefined;
    let successor: Awaited<ReturnType<typeof createTestInvocationRuntimeRoots>> | undefined;
    let admissionSettled = true;
    await settleWorkspaceCallback(async () => {
      const repositoryRoot = path.join(root, 'repository');
      const hostTempRoot = path.join(root, 'host-temp');
      mkdirSync(repositoryRoot);
      mkdirSync(hostTempRoot);
      const input = {
        repositoryRoot,
        hostTempRoot,
        environment: { SEC_STATE_HOME: path.join(root, 'state'), SEC_CACHE_HOME: path.join(root, 'cache') }
      };
      admissionSettled = false;
      abandoned = await createTestInvocationRuntimeRoots({
        ...input,
        testOnlyOwnerPid: 41_011,
        testOnlyProcessAlive: () => 'alive',
        testOnlyProcessNonce: '20000000-0000-4000-8000-000000000011'
      });
      admissionSettled = true;
      const owned = abandoned.prepareProcessTemp({});
      const bindingPath = path.join(abandoned.stateRoot, 'temp-parent-binding.json');
      const original = readFileSync(bindingPath);
      const foreignParent = path.join(root, 'foreign-temp');
      const foreignContainer = path.join(foreignParent, path.basename(path.dirname(owned.processRoot)));
      mkdirSync(foreignContainer, { recursive: true });
      if (fault === 'missing-state') {
        renameSync(abandoned.stateRoot, path.join(root, 'displaced-state'));
        renameSync(abandoned.cacheRoot, path.join(root, 'displaced-cache'));
      } else {
        const binding = JSON.parse(original.toString('utf8'));
        binding.hostTemp = inspectNoFollowDirectoryChain(foreignParent, 'foreign recovery parent').target;
        binding.container = inspectNoFollowDirectoryChain(foreignContainer, 'foreign recovery container').target;
        writeFileSync(bindingPath, `${JSON.stringify(binding)}\n`);
      }
      const recovery = {
        ...input,
        testOnlyProcessAlive: (pid: number) => pid === 41_011 ? 'dead' as const : 'alive' as const
      };
      const preserved = observeUnguardedFixturePreservation(input, [
        abandoned.stateRoot, abandoned.cacheRoot, owned.processRoot, foreignContainer,
        ...(fault === 'missing-state' ? [path.join(root, 'displaced-state'), path.join(root, 'displaced-cache')] : [])
      ]);
      admissionSettled = false;
      independent = await createTestInvocationRuntimeRoots({
        ...recovery,
        testOnlyOwnerPid: 41_012,
        testOnlyProcessNonce: '20000000-0000-4000-8000-000000000012'
      });
      admissionSettled = true;
      await settleWorkspaceCallback(async () => { preserved(); }, async () => { await independent!.cleanup(); });
      preserved();
      if (fault === 'missing-state') {
        renameSync(path.join(root, 'displaced-state'), abandoned.stateRoot);
        renameSync(path.join(root, 'displaced-cache'), abandoned.cacheRoot);
      } else writeFileSync(bindingPath, original);
      await abandoned.cleanup();
      admissionSettled = false;
      successor = await createTestInvocationRuntimeRoots({
        ...recovery,
        testOnlyOwnerPid: 41_013,
        testOnlyProcessNonce: '20000000-0000-4000-8000-000000000013'
      });
      admissionSettled = true;
      expect(existsSync(owned.processRoot)).toBe(false);
      expect(existsSync(foreignContainer)).toBe(true);
      await successor.cleanup();
    }, async () => {
      if (!admissionSettled) throw new Error(`Recovery admission remains unresolved; fixture root retained: ${root}`);
      await settleResourcesAsync({ cleanup: [
        { label: 'successor invocation', settle: async () => { await successor?.cleanup(); } },
        { label: 'independent invocation', settle: async () => { await independent?.cleanup(); } },
        { label: 'original invocation', settle: async () => { await abandoned?.cleanup(); } }
      ] });
      rmSync(root, { recursive: true, force: true });
    });
  }
);

test('test process temp lease and generations are isolated by exact workspace identity', async () => {
  const root = generation('sec-process-temp-workspace-isolation-');
  const leftRepository = path.join(root, 'left-repository');
  const rightRepository = path.join(root, 'right-repository');
  const hostTempRoot = path.join(root, 'host-temp');
  const stateRoot = path.join(root, 'state');
  const cacheRoot = path.join(root, 'cache');
  const environment = { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot };
  const invocationKey = '30000000-0000-4000-8000-000000000001';
  let left: Awaited<ReturnType<typeof createTestInvocationRuntimeRoots>> | undefined;
  let right: Awaited<ReturnType<typeof createTestInvocationRuntimeRoots>> | undefined;
  let admissionSettled = true;
  await settleWorkspaceCallback(async () => {
    for (const directory of [leftRepository, rightRepository, hostTempRoot]) mkdirSync(directory);
    admissionSettled = false;
    left = await createTestInvocationRuntimeRoots({
      repositoryRoot: leftRepository,
      hostTempRoot,
      environment,
      invocationKey
    });
    admissionSettled = true;
    admissionSettled = false;
    right = await createTestInvocationRuntimeRoots({
      repositoryRoot: rightRepository,
      hostTempRoot,
      environment,
      invocationKey
    });
    admissionSettled = true;
    const leftTemp = left.prepareProcessTemp({});
    const rightTemp = right.prepareProcessTemp({});
    expect(leftTemp.processRoot).not.toBe(rightTemp.processRoot);
    await leftTemp.cleanup();
    expect(existsSync(rightTemp.processRoot)).toBe(true);
    await rightTemp.cleanup();
  }, async () => {
    await settleResourcesAsync({ cleanup: [
      { label: 'left workspace invocation', settle: async () => { await left?.cleanup(); } },
      { label: 'right workspace invocation', settle: async () => { await right?.cleanup(); } }
    ] });
    if (!admissionSettled) throw new Error(`Invocation admission remains unresolved; fixture root retained: ${root}`);
    rmSync(root, { recursive: true, force: true });
  });
});

test('unguarded successor preserves live and PID-dead owners across generation ABA', async () => {
  const root = generation('sec-process-temp-aba-');
  let owner: Awaited<ReturnType<typeof createTestInvocationRuntimeRoots>> | undefined;
  let processRoot: string | undefined;
  let displaced: string | undefined;
  let admissionSettled = true;
  await settleWorkspaceCallback(async () => {
    const repositoryRoot = path.join(root, 'repository');
    const hostTempRoot = path.join(root, 'host-temp');
    const stateRoot = path.join(root, 'state');
    const cacheRoot = path.join(root, 'cache');
    mkdirSync(repositoryRoot);
    mkdirSync(hostTempRoot);
    const ownerPid = 42_001;
    const invocationKey = '40000000-0000-4000-8000-000000000001';
    admissionSettled = false;
    owner = await createTestInvocationRuntimeRoots({
      repositoryRoot,
      hostTempRoot,
      environment: { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot },
      invocationKey,
      testOnlyOwnerPid: ownerPid,
      testOnlyProcessAlive: () => 'alive',
      testOnlyProcessNonce: '50000000-0000-4000-8000-000000000001'
    });
    admissionSettled = true;
    const processGeneration = owner.prepareProcessTemp({});
    processRoot = processGeneration.processRoot;
    admissionSettled = false;
    await expect(createTestInvocationRuntimeRoots({
      repositoryRoot,
      hostTempRoot,
      environment: { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot },
      invocationKey,
      testOnlyOwnerPid: 42_002,
      testOnlyProcessAlive: () => 'alive',
      testOnlyProcessNonce: '50000000-0000-4000-8000-000000000002'
    })).rejects.toMatchObject({ code: 'TEST_PROCESS_TEMP_OWNED' });
    admissionSettled = true;
    expect(existsSync(processGeneration.processRoot)).toBe(true);

    displaced = `${processGeneration.processRoot}.displaced`;
    renameSync(processGeneration.processRoot, displaced);
    mkdirSync(processGeneration.processRoot);
    const preserved = observeUnguardedFixturePreservation({ repositoryRoot,
      environment: { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot }
    }, [owner.stateRoot, owner.cacheRoot, processGeneration.processRoot, displaced]);
    let blocked: unknown;
    admissionSettled = false;
    try {
      await createTestInvocationRuntimeRoots({
        repositoryRoot,
        hostTempRoot,
        environment: { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot },
        invocationKey,
        testOnlyOwnerPid: 42_003,
        testOnlyProcessAlive: (pid) => pid === ownerPid ? 'dead' : 'alive',
        testOnlyProcessNonce: '50000000-0000-4000-8000-000000000003'
      });
    } catch (error) {
      blocked = error;
    }
    expect(blocked).toBeInstanceOf(TestProcessTempLifecycleError);
    expect((blocked as TestProcessTempLifecycleError).code).toBe('TEST_PROCESS_TEMP_OWNED');
    admissionSettled = true;
    preserved();
    expect(existsSync(processGeneration.processRoot)).toBe(true);
    expect(existsSync(displaced)).toBe(true);
    rmSync(processGeneration.processRoot, { recursive: true });
    renameSync(displaced, processGeneration.processRoot);
  }, async () => {
    if (!admissionSettled) throw new Error(`Invocation admission remains unresolved; fixture root retained: ${root}`);
    // Restoration and owner retirement must both succeed before deleting their parent.
    if (displaced !== undefined && processRoot !== undefined && existsSync(displaced)) {
      rmSync(processRoot, { recursive: true, force: true });
      renameSync(displaced, processRoot);
    }
    await owner?.cleanup();
    rmSync(root, { recursive: true, force: true });
  });
});

test.skipIf(process.platform !== 'linux')(
  'owned runtime cleanup retires read-only descendants without changing a linked foreign tree', async () => {
    const root = generation('sec-runtime-readonly-retirement-');
    let runtime: Awaited<ReturnType<typeof createTestInvocationRuntimeRoots>> | undefined;
    let admissionSettled = true;
    await settleWorkspaceCallback(async () => {
      const repositoryRoot = path.join(root, 'repository');
      const hostTempRoot = path.join(root, 'host-temp');
      const external = path.join(root, 'external');
      for (const directory of [repositoryRoot, hostTempRoot, external]) mkdirSync(directory);
      writeFileSync(path.join(external, 'keep.txt'), 'foreign bytes');
      const before = lstatSync(external).mode;
      admissionSettled = false;
      runtime = await createTestInvocationRuntimeRoots({
        repositoryRoot, hostTempRoot,
        environment: { SEC_STATE_HOME: path.join(root, 'state'), SEC_CACHE_HOME: path.join(root, 'cache') }
      });
      admissionSettled = true;
      const child = runtime.prepareProcessTemp({});
      for (const ownerRoot of [runtime.stateRoot, runtime.cacheRoot, child.tempRoot]) {
        const sealed = path.join(ownerRoot, 'readonly-package');
        mkdirSync(sealed);
        writeFileSync(path.join(sealed, 'lib.d.ts'), 'sealed bytes');
        symlinkSync(external, path.join(sealed, 'foreign'));
        chmodSync(path.join(sealed, 'lib.d.ts'), 0o444);
        chmodSync(sealed, 0o555);
      }
      await child.cleanup();
      await runtime.cleanup();
      await runtime.cleanup();
      expect(existsSync(child.processRoot)).toBe(false);
      expect(existsSync(runtime.stateRoot)).toBe(false);
      expect(existsSync(runtime.cacheRoot)).toBe(false);
      expect(readFileSync(path.join(external, 'keep.txt'), 'utf8')).toBe('foreign bytes');
      expect(lstatSync(external).mode).toBe(before);
    }, async () => {
      if (!admissionSettled) throw new Error(`Invocation admission remains unresolved; fixture root retained: ${root}`);
      await runtime?.cleanup();
      rmSync(root, { recursive: true, force: true });
    });
  }
);
