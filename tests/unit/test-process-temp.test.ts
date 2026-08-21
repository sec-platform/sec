import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createTestProcessTempRootV1 } from '../../platform/dev-runner/test-process-temp.ts';

function generation(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

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
