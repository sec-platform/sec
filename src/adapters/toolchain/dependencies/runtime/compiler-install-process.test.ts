import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runBunInstall } from './compiler-install-process.ts';
import { issueRuntimeDependencyTestMaterialization } from './materialization-fixture-capability.ts';

test('compiler install delegates deterministic materialization without exposing process transport', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-compiler-install-process-'));
  try {
    let fenceCount = 0;
    const observed: Array<Readonly<{ args: readonly string[]; cwd: string; timeoutMs: number }>> = [];
    const result = await runBunInstall(root, {
      beforeCommit: async () => { fenceCount += 1; },
      lockTimeoutMs: 5_000,
      testMaterialization: issueRuntimeDependencyTestMaterialization(async (request) => {
        observed.push(request);
        return { code: 0, stderr: '', stdout: 'materialized' };
      })
    }, ['install', '--frozen-lockfile']);

    expect(result).toEqual({
      packageManager: 'bun',
      result: { code: 0, stderr: '', stdout: 'materialized' }
    });
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      args: ['install', '--frozen-lockfile'],
      cwd: root
    });
    expect(observed[0]!.timeoutMs).toBeGreaterThan(0);
    expect(observed[0]!.timeoutMs).toBeLessThanOrEqual(5_000);
    expect(fenceCount).toBeGreaterThan(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
