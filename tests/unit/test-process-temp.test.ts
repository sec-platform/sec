import { expect, test } from 'bun:test';
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
  createTestInvocationRuntimeRootsV1,
  createTestProcessTempRootV1,
  testInvocationRuntimeIsolationModeForPlatformV1
} from '../../platform/dev-runner/test-process-temp.ts';

function generation(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

test('test invocation runtime advertises only platforms with retained physical authority', () => {
  expect(testInvocationRuntimeIsolationModeForPlatformV1('win32')).toBe('retained');
  expect(testInvocationRuntimeIsolationModeForPlatformV1('linux')).toBe('retained');
  expect(testInvocationRuntimeIsolationModeForPlatformV1('darwin')).toBe('unavailable');
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
    expect(existsSync(owned.processRoot)).toBe(true);
    owned.cleanup();
    expect(existsSync(owned.processRoot)).toBe(false);
    expect(existsSync(hostTempRoot)).toBe(true);
  } finally {
    for (const target of [repositoryRoot, hostTempRoot, stateRoot, cacheRoot]) {
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
  const stateAlias = path.join(root, 'state-alias');
  const stateRoot = path.join(root, 'state');
  const cacheRoot = path.join(root, 'cache');
  mkdirSync(repositoryRoot);
  symlinkSync(repositoryRoot, stateAlias, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    await expect(createTestInvocationRuntimeRootsV1({
      repositoryRoot,
      environment: { SEC_STATE_HOME: stateAlias, SEC_CACHE_HOME: cacheRoot }
    })).rejects.toThrow();
    expect(existsSync(path.join(repositoryRoot, 't'))).toBe(false);

    const owned = await createTestInvocationRuntimeRootsV1({
      repositoryRoot,
      environment: { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot }
    });
    expect(owned.stateRoot).not.toBe(owned.cacheRoot);
    expect(path.basename(owned.stateRoot)).toBe(path.basename(owned.cacheRoot));
    expect(path.basename(owned.stateRoot)).toMatch(/^r-[a-z2-7]{26}$/u);
    if (process.platform === 'linux') {
      expect(lstatSync(owned.stateRoot).mode & 0o077).toBe(0);
      expect(lstatSync(owned.cacheRoot).mode & 0o077).toBe(0);
    }
    writeFileSync(path.join(owned.stateRoot, 'state.json'), '{}');
    writeFileSync(path.join(owned.cacheRoot, 'cache.json'), '{}');
    owned.cleanup();
    expect(existsSync(owned.stateRoot)).toBe(false);
    expect(existsSync(owned.cacheRoot)).toBe(false);

    if (process.platform === 'linux') {
      chmodSync(stateRoot, 0o755);
      chmodSync(cacheRoot, 0o755);
    }
    const replaced = await createTestInvocationRuntimeRootsV1({
      repositoryRoot,
      environment: { SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot }
    });
    if (process.platform === 'linux') {
      expect(lstatSync(stateRoot).mode & 0o077).toBe(0);
      expect(lstatSync(cacheRoot).mode & 0o077).toBe(0);
    }
    const displaced = `${replaced.stateRoot}.displaced`;
    renameSync(replaced.stateRoot, displaced);
    mkdirSync(replaced.stateRoot);
    expect(() => replaced.cleanup()).toThrow('runtime cleanup failed');
    expect(existsSync(replaced.stateRoot)).toBe(true);
    expect(existsSync(displaced)).toBe(true);
    expect(existsSync(replaced.cacheRoot)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
