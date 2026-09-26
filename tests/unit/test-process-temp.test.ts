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

import { inspectNoFollowDirectoryChain } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import type { FastTestBatchExecutionAdmission } from '../../src/adapters/self-hosting/development/runner/test-execution-policy.ts';
import {
  consumeTestProcessTempAssignment,
  createTestInvocationRuntimeRoots,
  createTestProcessTempRoot,
  prepareTestInvocationRuntime,
  testInvocationRuntimeIsolationModeForPlatform,
  TestProcessTempLifecycleError
} from '../../src/adapters/self-hosting/development/runner/test-process-temp.ts';

function generation(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

test('test invocation runtime advertises only platforms with retained physical authority', () => {
  expect(testInvocationRuntimeIsolationModeForPlatform('win32')).toBe('retained');
  expect(testInvocationRuntimeIsolationModeForPlatform('linux')).toBe('retained');
  expect(testInvocationRuntimeIsolationModeForPlatform('darwin')).toBe('unavailable');
});

test('test invocation runtime rejects a reconstructed fast-batch deadline before physical effects', async () => {
  const root = generation('sec-invocation-runtime-forged-budget-');
  const repositoryRoot = path.join(root, 'repository');
  const hostTempRoot = path.join(root, 'host-temp');
  const stateRoot = path.join(root, 'state');
  const cacheRoot = path.join(root, 'cache');
  mkdirSync(repositoryRoot);
  mkdirSync(hostTempRoot);
  try {
    await expect(createTestInvocationRuntimeRoots({
      repositoryRoot,
      hostTempRoot,
      environment: { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot },
      fastTestBatchAdmission: Object.freeze({}) as FastTestBatchExecutionAdmission
    })).rejects.toThrow('owner-issued admission');
    expect(existsSync(stateRoot)).toBe(false);
    expect(existsSync(cacheRoot)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('direct test runtime temp supports a native child-process working directory', () => {
  const repository = mkdtempSync(path.join(tmpdir(), 'sec-child-process-cwd-'));
  try {
    const result = spawnSync('git', ['init', '--quiet'], {
      cwd: repository,
      encoding: 'utf8',
      env: process.env,
      windowsHide: true
    });
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test('test process temp owns one disjoint generation and removes only that generation', async () => {
  const repositoryRoot = generation('sec-temp-owner-repository-');
  const hostTempRoot = generation('sec-temp-owner-host-');
  const stateRoot = generation('sec-temp-owner-state-');
  const cacheRoot = generation('sec-temp-owner-cache-');
  try {
    const environment: NodeJS.ProcessEnv = { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot };
    const owned = await createTestProcessTempRoot({ repositoryRoot, hostTempRoot, environment });
    expect(environment.TMP).toBe(owned.tempRoot);
    expect(environment.TEMP).toBe(owned.tempRoot);
    expect(environment.TMPDIR).toBe(owned.tempRoot);
    expect(owned.tempRoot).toBe(path.join(owned.processRoot, 'tmp'));
    expect(existsSync(owned.processRoot)).toBe(true);
    await owned.cleanup();
    expect(existsSync(owned.processRoot)).toBe(false);
    expect(existsSync(hostTempRoot)).toBe(true);
  } finally {
    for (const target of [repositoryRoot, hostTempRoot, stateRoot, cacheRoot]) {
      rmSync(target, { recursive: true, force: true });
    }
  }
});

test('test process temp rejects an unavailable Windows path budget before any generation effect', async () => {
  if (process.platform !== 'win32') return;
  const repositoryRoot = generation('sec-temp-budget-repository-');
  const stateRoot = generation('sec-temp-budget-state-');
  const cacheRoot = generation('sec-temp-budget-cache-');
  const hostTempRoot = path.join(tmpdir(), 'x'.repeat(200));
  try {
    expect(existsSync(hostTempRoot)).toBe(false);
    await expect(prepareTestInvocationRuntime({
      repositoryRoot,
      hostTempRoot,
      environment: { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot },
      pathBudget: 'canonical-test-runtime'
    })).rejects.toMatchObject({ code: 'TEST_PROCESS_TEMP_PATH_BUDGET_UNAVAILABLE' });
    expect(existsSync(hostTempRoot)).toBe(false);
    expect(readdirSync(stateRoot)).toEqual([]);
    expect(readdirSync(cacheRoot)).toEqual([]);
  } finally {
    for (const target of [repositoryRoot, stateRoot, cacheRoot]) {
      rmSync(target, { recursive: true, force: true });
    }
  }
});

test('test process temp rejects OS temp overlap before creating a generation', async () => {
  const root = generation('sec-temp-owner-overlap-');
  const repositoryRoot = path.join(root, 'repository');
  const stateRoot = path.join(root, 'state');
  const cacheRoot = path.join(root, 'cache');
  mkdirSync(repositoryRoot);
  mkdirSync(stateRoot);
  mkdirSync(cacheRoot);
  try {
    const environment: NodeJS.ProcessEnv = { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot };
    const candidateParents = [repositoryRoot, stateRoot, cacheRoot];
    const generations = (): readonly string[] => candidateParents.flatMap((parent) =>
      readdirSync(parent)
        .filter((entry) => entry.startsWith('sec-test-process-'))
        .map((entry) => path.join(parent, entry)));
    const before = generations();
    for (const hostTempRoot of candidateParents) {
      await expect(createTestProcessTempRoot({ repositoryRoot, hostTempRoot, environment }))
        .rejects.toThrow('must be disjoint');
    }
    expect(generations()).toEqual(before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('test invocation runtime owns private roots, rejects aliases, and surfaces replacement-safe cleanup', async () => {
  const root = generation('sec-invocation-runtime-owner-');
  const repositoryRoot = path.join(root, 'repository');
  const hostTempRoot = path.join(root, 'host-temp');
  const stateAlias = path.join(root, 'state-alias');
  const stateRoot = path.join(root, 'state');
  const cacheRoot = path.join(root, 'cache');
  mkdirSync(repositoryRoot);
  mkdirSync(hostTempRoot);
  symlinkSync(repositoryRoot, stateAlias, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    await expect(createTestInvocationRuntimeRoots({
      repositoryRoot,
      hostTempRoot,
      environment: { SEC_STATE_HOME: stateAlias, SEC_CACHE_HOME: cacheRoot }
    })).rejects.toThrow();
    expect(existsSync(path.join(repositoryRoot, 'test-invocation-runs'))).toBe(false);

    const owned = await createTestInvocationRuntimeRoots({
      repositoryRoot,
      hostTempRoot,
      environment: { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot }
    });
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
    const replaced = await createTestInvocationRuntimeRoots({
      repositoryRoot,
      hostTempRoot,
      environment: { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot }
    });
    if (process.platform === 'linux') {
      expect(lstatSync(stateRoot).mode & 0o077).toBe(0);
      expect(lstatSync(cacheRoot).mode & 0o077).toBe(0);
    }
    const displaced = `${replaced.stateRoot}.displaced`;
    renameSync(replaced.stateRoot, displaced);
    mkdirSync(replaced.stateRoot);
    await expect(replaced.cleanup()).rejects.toMatchObject({
      code: 'TEST_PROCESS_TEMP_CLEANUP_FAILED',
      pendingRecovery: {
        ownerDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u)
      }
    });
    expect(existsSync(replaced.stateRoot)).toBe(true);
    expect(existsSync(displaced)).toBe(true);
    expect(existsSync(replaced.cacheRoot)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('direct test invocation binds and retires one State Cache and TMP generation then restores environment', async () => {
  const root = generation('sec-direct-test-runtime-');
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
  try {
    const runtime = await prepareTestInvocationRuntime({ repositoryRoot, hostTempRoot, environment });
    expect(runtime.ownership).toBe('direct');
    expect(environment.SEC_STATE_HOME).toBe(runtime.stateRoot);
    expect(environment.SEC_CACHE_HOME).toBe(runtime.cacheRoot);
    expect(environment.TMP).toBe(runtime.tempRoot);
    expect(environment.TEMP).toBe(runtime.tempRoot);
    expect(environment.TMPDIR).toBe(runtime.tempRoot);
    expect(existsSync(runtime.processRoot)).toBe(true);
    await runtime.cleanup();
    expect(existsSync(runtime.processRoot)).toBe(false);
    expect(existsSync(runtime.stateRoot)).toBe(false);
    expect(existsSync(runtime.cacheRoot)).toBe(false);
    expect(environment).toEqual({
      SEC_STATE_HOME: stateRoot,
      SEC_CACHE_HOME: cacheRoot,
      TMP: 'original-tmp',
      TEMP: 'original-temp'
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('direct test invocation settles its complete runtime after a failed test body', async () => {
  const root = generation('sec-direct-test-runtime-failure-');
  const repositoryRoot = path.join(root, 'repository');
  const hostTempRoot = path.join(root, 'host-temp');
  const stateRoot = path.join(root, 'state');
  const cacheRoot = path.join(root, 'cache');
  for (const directory of [repositoryRoot, hostTempRoot]) mkdirSync(directory);
  const environment: NodeJS.ProcessEnv = { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot };
  let runtime: Awaited<ReturnType<typeof prepareTestInvocationRuntime>> | null = null;
  let failure: unknown;
  try {
    runtime = await prepareTestInvocationRuntime({ repositoryRoot, hostTempRoot, environment });
    try {
      throw new Error('synthetic test body failure');
    } catch (error) {
      failure = error;
    } finally {
      await runtime.cleanup();
    }
    expect(failure).toEqual(new Error('synthetic test body failure'));
    expect(existsSync(runtime.processRoot)).toBe(false);
    expect(existsSync(runtime.stateRoot)).toBe(false);
    expect(existsSync(runtime.cacheRoot)).toBe(false);
    expect(environment).toEqual({ SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('two direct invocations in one workspace own independent concurrent lifecycle generations', async () => {
  const root = generation('sec-direct-test-runtime-concurrent-');
  const repositoryRoot = path.join(root, 'repository');
  const hostTempRoot = path.join(root, 'host-temp');
  const stateRoot = path.join(root, 'state');
  const cacheRoot = path.join(root, 'cache');
  for (const directory of [repositoryRoot, hostTempRoot]) mkdirSync(directory);
  const leftEnvironment: NodeJS.ProcessEnv = { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot };
  const rightEnvironment: NodeJS.ProcessEnv = { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot };
  const left = await prepareTestInvocationRuntime({ repositoryRoot, hostTempRoot, environment: leftEnvironment });
  const right = await prepareTestInvocationRuntime({ repositoryRoot, hostTempRoot, environment: rightEnvironment });
  try {
    expect(left.ownership).toBe('direct');
    expect(right.ownership).toBe('direct');
    expect(left.processRoot).not.toBe(right.processRoot);
    expect(existsSync(left.processRoot)).toBe(true);
    expect(existsSync(right.processRoot)).toBe(true);
    await left.cleanup();
    expect(existsSync(right.processRoot)).toBe(true);
  } finally {
    await left.cleanup();
    await right.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test('runner-assigned test invocation adopts parent roots without creating a nested runtime generation', async () => {
  const root = generation('sec-assigned-test-runtime-');
  const repositoryRoot = path.join(root, 'repository');
  const hostTempRoot = path.join(root, 'host-temp');
  const stateRoot = path.join(root, 'state');
  const cacheRoot = path.join(root, 'cache');
  for (const directory of [repositoryRoot, hostTempRoot]) mkdirSync(directory);
  const parent = await createTestInvocationRuntimeRoots({
    repositoryRoot,
    hostTempRoot,
    environment: { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot }
  });
  const environment = {
    SEC_STATE_HOME: path.join(parent.stateRoot, 'invocation-runtime', 'assigned'),
    SEC_CACHE_HOME: path.join(parent.cacheRoot, 'invocation-runtime', 'assigned')
  } satisfies NodeJS.ProcessEnv;
  const child = parent.prepareProcessTemp(environment);
  try {
    const runtime = await prepareTestInvocationRuntime({ repositoryRoot, hostTempRoot, environment });
    expect(runtime.ownership).toBe('parent-assigned');
    expect(runtime.stateRoot).toBe(environment.SEC_STATE_HOME);
    expect(runtime.cacheRoot).toBe(environment.SEC_CACHE_HOME);
    expect(runtime.processRoot).toBe(child.processRoot);
    expect(existsSync(path.join(parent.stateRoot, 'test-invocation-runs'))).toBe(false);
    expect(existsSync(path.join(parent.cacheRoot, 'test-invocation-runs'))).toBe(false);
    await runtime.cleanup();
    expect(existsSync(child.processRoot)).toBe(true);
    await child.cleanup();
    expect(existsSync(child.processRoot)).toBe(false);
  } finally {
    await parent.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test('parent supervisor owns child temp cleanup and retires a junction leaf without touching its target', async () => {
  const root = generation('sec-process-temp-parent-owner-');
  const repositoryRoot = path.join(root, 'repository');
  const hostTempRoot = path.join(root, 'host-temp');
  const stateRoot = path.join(root, 'state');
  const cacheRoot = path.join(root, 'cache');
  const externalTarget = path.join(root, 'external-target');
  for (const directory of [repositoryRoot, hostTempRoot, externalTarget]) mkdirSync(directory);
  const runtime = await createTestInvocationRuntimeRoots({
    repositoryRoot,
    hostTempRoot,
    environment: { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot }
  });
  try {
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
  } finally {
    await runtime.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test('successor supervisor reclaims a timed-out child generation only after exact dead-owner readback', async () => {
  const root = generation('sec-process-temp-lost-handle-');
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
  const abandoned = await createTestInvocationRuntimeRoots({
    repositoryRoot,
    hostTempRoot,
    environment: { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot },
    invocationKey,
    testOnlyOwnerPid: abandonedOwnerPid,
    testOnlyProcessAlive: () => 'alive',
    testOnlyProcessNonce: '20000000-0000-4000-8000-000000000001'
  });
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
  const successor = await createTestInvocationRuntimeRoots({
    repositoryRoot,
    hostTempRoot: successorTempRoot,
    environment: { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot },
    invocationKey,
    testOnlyOwnerPid: 41_002,
    testOnlyProcessAlive: (pid) => pid === abandonedOwnerPid ? 'dead' : 'alive',
    testOnlyProcessNonce: '20000000-0000-4000-8000-000000000002'
  });
  try {
    expect(existsSync(lostHandle.processRoot)).toBe(false);
    expect(existsSync(path.dirname(lostHandle.processRoot))).toBe(false);
    expect(existsSync(abandonedStateRoot)).toBe(false);
    expect(existsSync(abandonedCacheRoot)).toBe(false);
    expect(existsSync(successor.stateRoot)).toBe(true);
    expect(existsSync(successor.cacheRoot)).toBe(true);
  } finally {
    await successor.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test('failed temp retirement retains the invocation identity for dead-owner recovery', async () => {
  const root = generation('sec-temp-failed-retirement-');
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
  let successor: Awaited<ReturnType<typeof createTestInvocationRuntimeRoots>> | undefined;
  try {
    const abandoned = await createTestInvocationRuntimeRoots({
      ...input,
      testOnlyOwnerPid: 41_003,
      testOnlyProcessAlive: () => 'alive',
      testOnlyProcessNonce: '20000000-0000-4000-8000-000000000003'
    });
    const owned = abandoned.prepareProcessTemp({});
    const displaced = `${owned.processRoot}.displaced`;
    renameSync(owned.processRoot, displaced);
    mkdirSync(owned.processRoot);
    await expect(abandoned.cleanup()).rejects.toMatchObject({ code: 'TEST_PROCESS_TEMP_CLEANUP_FAILED' });
    expect(existsSync(displaced)).toBe(true);
    rmSync(owned.processRoot, { recursive: true });
    renameSync(displaced, owned.processRoot);
    successor = await createTestInvocationRuntimeRoots({
      ...input,
      testOnlyOwnerPid: 41_004,
      testOnlyProcessAlive: pid => pid === 41_003 ? 'dead' : 'alive',
      testOnlyProcessNonce: '20000000-0000-4000-8000-000000000004'
    });
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
  } finally {
    await successor?.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test('failed successor reclaim restores the original owner for a later successor', async () => {
  const root = generation('sec-temp-failed-successor-reclaim-');
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
  try {
    const abandoned = await createTestInvocationRuntimeRoots({
      ...input,
      testOnlyOwnerPid: 41_005,
      testOnlyProcessAlive: () => 'alive',
      testOnlyProcessNonce: '20000000-0000-4000-8000-000000000005'
    });
    const owned = abandoned.prepareProcessTemp({});
    const displaced = `${owned.processRoot}.displaced`;
    renameSync(owned.processRoot, displaced);
    mkdirSync(owned.processRoot);

    await expect(createTestInvocationRuntimeRoots({
      ...input,
      testOnlyOwnerPid: 41_006,
      testOnlyProcessAlive: pid => pid === 41_005 ? 'dead' : 'alive',
      testOnlyProcessNonce: '20000000-0000-4000-8000-000000000006'
    })).rejects.toMatchObject({ code: 'TEST_PROCESS_TEMP_RESIDUE_UNKNOWN' });

    rmSync(owned.processRoot, { recursive: true });
    renameSync(displaced, owned.processRoot);
    const successor = await createTestInvocationRuntimeRoots({
      ...input,
      testOnlyOwnerPid: 41_007,
      testOnlyProcessAlive: pid => pid === 41_005 ? 'dead' : 'alive',
      testOnlyProcessNonce: '20000000-0000-4000-8000-000000000007'
    });
    try {
      expect(existsSync(owned.processRoot)).toBe(false);
    } finally {
      await successor.cleanup();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.each(['missing-state', 'changed-binding'] as const)(
  'runtime recovery preserves its original owner after %s', async (fault) => {
    const root = generation('sec-runtime-recovery-binding-');
    const repositoryRoot = path.join(root, 'repository');
    const hostTempRoot = path.join(root, 'host-temp');
    mkdirSync(repositoryRoot);
    mkdirSync(hostTempRoot);
    const input = {
      repositoryRoot,
      hostTempRoot,
      environment: { SEC_STATE_HOME: path.join(root, 'state'), SEC_CACHE_HOME: path.join(root, 'cache') }
    };
    try {
      const abandoned = await createTestInvocationRuntimeRoots({
        ...input,
        testOnlyOwnerPid: 41_011,
        testOnlyProcessAlive: () => 'alive',
        testOnlyProcessNonce: '20000000-0000-4000-8000-000000000011'
      });
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
      await expect(createTestInvocationRuntimeRoots({
        ...recovery,
        testOnlyOwnerPid: 41_012,
        testOnlyProcessNonce: '20000000-0000-4000-8000-000000000012'
      })).rejects.toMatchObject({ code: 'TEST_PROCESS_TEMP_RESIDUE_UNKNOWN' });
      expect(existsSync(owned.processRoot)).toBe(true);
      expect(existsSync(foreignContainer)).toBe(true);
      if (fault === 'missing-state') {
        renameSync(path.join(root, 'displaced-state'), abandoned.stateRoot);
        renameSync(path.join(root, 'displaced-cache'), abandoned.cacheRoot);
      } else writeFileSync(bindingPath, original);
      const successor = await createTestInvocationRuntimeRoots({
        ...recovery,
        testOnlyOwnerPid: 41_013,
        testOnlyProcessNonce: '20000000-0000-4000-8000-000000000013'
      });
      try {
        expect(existsSync(owned.processRoot)).toBe(false);
        expect(existsSync(foreignContainer)).toBe(true);
      } finally {
        await successor.cleanup();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test('test process temp lease and generations are isolated by exact workspace identity', async () => {
  const root = generation('sec-process-temp-workspace-isolation-');
  const leftRepository = path.join(root, 'left-repository');
  const rightRepository = path.join(root, 'right-repository');
  const hostTempRoot = path.join(root, 'host-temp');
  const stateRoot = path.join(root, 'state');
  const cacheRoot = path.join(root, 'cache');
  for (const directory of [leftRepository, rightRepository, hostTempRoot]) mkdirSync(directory);
  const environment = { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot };
  const invocationKey = '30000000-0000-4000-8000-000000000001';
  const left = await createTestInvocationRuntimeRoots({
    repositoryRoot: leftRepository,
    hostTempRoot,
    environment,
    invocationKey
  });
  const right = await createTestInvocationRuntimeRoots({
    repositoryRoot: rightRepository,
    hostTempRoot,
    environment,
    invocationKey
  });
  try {
    const leftTemp = left.prepareProcessTemp({});
    const rightTemp = right.prepareProcessTemp({});
    expect(leftTemp.processRoot).not.toBe(rightTemp.processRoot);
    await leftTemp.cleanup();
    expect(existsSync(rightTemp.processRoot)).toBe(true);
    await rightTemp.cleanup();
  } finally {
    await left.cleanup();
    await right.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test('successor preserves a live owner and rejects generation ABA as typed unknown', async () => {
  const root = generation('sec-process-temp-aba-');
  const repositoryRoot = path.join(root, 'repository');
  const hostTempRoot = path.join(root, 'host-temp');
  const stateRoot = path.join(root, 'state');
  const cacheRoot = path.join(root, 'cache');
  mkdirSync(repositoryRoot);
  mkdirSync(hostTempRoot);
  const ownerPid = 42_001;
  const invocationKey = '40000000-0000-4000-8000-000000000001';
  const owner = await createTestInvocationRuntimeRoots({
    repositoryRoot,
    hostTempRoot,
    environment: { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot },
    invocationKey,
    testOnlyOwnerPid: ownerPid,
    testOnlyProcessAlive: () => 'alive',
    testOnlyProcessNonce: '50000000-0000-4000-8000-000000000001'
  });
  const processGeneration = owner.prepareProcessTemp({});
  await expect(createTestInvocationRuntimeRoots({
    repositoryRoot,
    hostTempRoot,
    environment: { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot },
    invocationKey,
    testOnlyOwnerPid: 42_002,
    testOnlyProcessAlive: () => 'alive',
    testOnlyProcessNonce: '50000000-0000-4000-8000-000000000002'
  })).rejects.toMatchObject({ code: 'TEST_PROCESS_TEMP_OWNED' });
  expect(existsSync(processGeneration.processRoot)).toBe(true);

  const displaced = `${processGeneration.processRoot}.displaced`;
  renameSync(processGeneration.processRoot, displaced);
  mkdirSync(processGeneration.processRoot);
  let blocked: unknown;
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
  expect((blocked as TestProcessTempLifecycleError).code).toBe('TEST_PROCESS_TEMP_RESIDUE_UNKNOWN');
  expect(existsSync(processGeneration.processRoot)).toBe(true);
  expect(existsSync(displaced)).toBe(true);
  rmSync(root, { recursive: true, force: true });
});

test.skipIf(process.platform !== 'linux')(
  'owned runtime cleanup retires read-only descendants without changing a linked foreign tree', async () => {
    const root = generation('sec-runtime-readonly-retirement-');
    const repositoryRoot = path.join(root, 'repository');
    const hostTempRoot = path.join(root, 'host-temp');
    const external = path.join(root, 'external');
    for (const directory of [repositoryRoot, hostTempRoot, external]) mkdirSync(directory);
    writeFileSync(path.join(external, 'keep.txt'), 'foreign bytes');
    const before = lstatSync(external).mode;
    const runtime = await createTestInvocationRuntimeRoots({
      repositoryRoot, hostTempRoot,
      environment: { SEC_STATE_HOME: path.join(root, 'state'), SEC_CACHE_HOME: path.join(root, 'cache') }
    });
    const child = runtime.prepareProcessTemp({});
    try {
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
    } finally {
      await runtime.cleanup();
      rmSync(root, { recursive: true, force: true });
    }
  }
);
