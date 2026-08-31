import { expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { inspectNoFollowDirectoryChain } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  dockerDesktopLauncherLeaseName,
  withDockerDesktopLauncherLockAtOwnerIssuedDirectory
} from './launcher-lock.ts';

test('Docker launcher lock exists only beneath the owner-issued directory', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-docker-launcher-lock-'));
  const endpointHost = 'npipe:////./pipe/dockerDesktopLinuxEngine';
  try {
    const parent = inspectNoFollowDirectoryChain(root, 'test-owned Docker launcher lock root').target;
    let observedNames: string[] = [];
    const result = await withDockerDesktopLauncherLockAtOwnerIssuedDirectory({
      deadlineAtUnixMs: Date.now() + 10_000,
      endpointHost,
      parent,
      operation: async () => {
        observedNames = readdirSync(root);
        const contender = await withDockerDesktopLauncherLockAtOwnerIssuedDirectory({
          deadlineAtUnixMs: Date.now() + 10_000,
          endpointHost,
          parent,
          operation: async () => 'unexpected'
        });
        expect(contender).toBeNull();
        return 'settled';
      }
    });
    expect(result).toBe('settled');
    expect(observedNames).toEqual([dockerDesktopLauncherLeaseName(endpointHost)]);
    expect(readdirSync(root)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
