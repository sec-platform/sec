import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  createEnvironmentDependencyCacheIdentityV1,
  createEnvironmentDependencyClosureV1
} from '../../platform/shared/environment-materialization-contract.ts';
import { openEnvironmentDependencyCacheLifecycleV2 } from '../../tooling/sec-dev/environment-cache-lifecycle.ts';

const digest = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}` as const;

function identity() {
  return createEnvironmentDependencyCacheIdentityV1({
    closure: createEnvironmentDependencyClosureV1({
      environmentSpecDigest: digest('a'),
      lockDigest: digest('b'),
      toolchainDigest: digest('c'),
      providerRevision: 'test-provider-v2',
      authority: [
        { path: '.bun-version', bytesDigest: digest('c') },
        { path: 'bun.lock', bytesDigest: digest('b') }
      ]
    })
  });
}

test('dependency cache owner persists birth before publication and settles exact consumers', async () => {
  if (process.platform !== 'linux' || process.arch !== 'x64') return;
  const root = mkdtempSync(path.join(tmpdir(), 'sec-environment-cache-lifecycle-'));
  const repositoryRoot = path.join(root, 'repository');
  mkdirSync(repositoryRoot);
  const environment = {
    SEC_STATE_HOME: path.join(root, 'state'),
    SEC_CACHE_HOME: path.join(root, 'cache')
  } as NodeJS.ProcessEnv;
  try {
    const owner = await openEnvironmentDependencyCacheLifecycleV2({
      repository: 'example/sec',
      repositoryRoot,
      identity: identity(),
      providerRevision: 'test-provider-v2',
      platform: 'linux/amd64',
      now: '2026-08-25T01:02:03.000Z',
      environment
    });
    expect(owner.current().phase).toBe('registered');
    expect(owner.beginMaterialization('2026-08-25T01:02:04.000Z').phase).toBe('materializing');
    const archiveBytes = Buffer.from('exact dependency archive\n', 'utf8');
    mkdirSync(owner.locators.cacheEntryPath, { recursive: true });
    writeFileSync(owner.locators.cacheArchivePath, archiveBytes, { flag: 'wx' });
    chmodSync(owner.locators.cacheArchivePath, 0o444);
    expect(owner.publishPhysical({
      sourceSnapshotDigest: digest('e'),
      archiveProjectionDigest: digest('f'),
      now: '2026-08-25T01:02:05.000Z'
    }).phase).toBe('published');
    const acquired = owner.acquire({
      consumerId: 'verification:one',
      now: '2026-08-25T01:02:06.000Z'
    });
    expect(acquired.current.activeConsumers).toHaveLength(1);
    expect(acquired.handle.acquireCredentialDigest).not.toBeNull();
    const released = owner.release({
      consumerId: 'verification:one',
      acquireCredentialDigest: acquired.handle.acquireCredentialDigest!,
      now: '2026-08-25T01:02:07.000Z'
    });
    expect(released.current.activeConsumers).toHaveLength(0);
    expect(released.releaseCredentialDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    const retiredResourceId = released.current.resourceId;
    const settlement = owner.retire({ now: '2026-08-25T01:02:08.000Z' });
    expect(settlement.resourceId).toBe(retiredResourceId);
    expect(settlement.archiveAbsent).toBe(true);
    expect(existsSync(owner.locators.cacheEntryPath)).toBe(false);

    const reopened = await openEnvironmentDependencyCacheLifecycleV2({
      repository: 'example/sec',
      repositoryRoot,
      identity: identity(),
      providerRevision: 'test-provider-v2',
      platform: 'linux/amd64',
      now: '2026-08-25T01:02:09.000Z',
      environment
    });
    expect(reopened.current().phase).toBe('registered');
    expect(reopened.current().resourceId).not.toBe(retiredResourceId);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
