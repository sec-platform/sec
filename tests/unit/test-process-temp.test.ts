import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  consumeTestProcessTempAssignmentV1,
  createTestInvocationRuntimeRoots,
  createTestProcessTempRootV1,
  prepareTestInvocationRuntime,
  testInvocationRuntimeIsolationModeForPlatform,
  TestProcessTempLifecycleError
} from '../../src/development/runner/test-process-temp.ts';

function generation(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

test('test invocation runtime advertises only platforms with retained physical authority', () => {
  expect(testInvocationRuntimeIsolationModeForPlatform('win32')).toBe('retained');
  expect(testInvocationRuntimeIsolationModeForPlatform('linux')).toBe('retained');
  expect(testInvocationRuntimeIsolationModeForPlatform('darwin')).toBe('unavailable');
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
    const owned = await createTestProcessTempRootV1({ repositoryRoot, hostTempRoot, environment });
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
      await expect(createTestProcessTempRootV1({ repositoryRoot, hostTempRoot, environment }))
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
    expect(path.basename(owned.stateRoot)).toBe(path.basename(owned.cacheRoot));
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
    await expect(replaced.cleanup()).rejects.toThrow('runtime cleanup failed');
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
    const adopted = consumeTestProcessTempAssignmentV1({ environment });
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
  const stateRoot = path.join(root, 'state');
  const cacheRoot = path.join(root, 'cache');
  mkdirSync(repositoryRoot);
  mkdirSync(hostTempRoot);
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
  writeFileSync(path.join(lostHandle.tempRoot, 'timeout-residue.txt'), 'residue');
  const successor = await createTestInvocationRuntimeRoots({
    repositoryRoot,
    hostTempRoot,
    environment: { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot },
    invocationKey,
    testOnlyOwnerPid: 41_002,
    testOnlyProcessAlive: (pid) => pid === abandonedOwnerPid ? 'dead' : 'alive',
    testOnlyProcessNonce: '20000000-0000-4000-8000-000000000002'
  });
  try {
    expect(existsSync(lostHandle.processRoot)).toBe(false);
  } finally {
    await successor.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

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
