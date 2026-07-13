import { expect, test } from 'bun:test';
import { mkdir, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { pathExists } from '../../platform/shared/fs.ts';
import {
  WorkspaceWriteLeaseError,
  createWorkspaceWriteLeaseManager,
  type WorkspaceWriteLeaseToken
} from '../../platform/shared/workspace-write-lease.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function ids(prefix: string): () => string {
  let next = 0;
  return () => `${prefix}-${next += 1}`;
}

test('workspace writer lease is exclusive, exactly reentrant, and rejects mismatched release', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const manager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 10_000,
      staleAfterMs: 20_000,
      hostname: 'lease-test-host',
      pid: 100,
      processNonce: 'process:one',
      createId: ids('one'),
      processAlive: () => 'alive'
    });
    const contender = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 10_000,
      staleAfterMs: 20_000,
      hostname: 'lease-test-host',
      pid: 200,
      processNonce: 'process:two',
      createId: ids('two'),
      processAlive: () => 'alive'
    });
    const lease = await manager.acquire(workspaceRoot);
    await expect(contender.acquire(workspaceRoot)).rejects.toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-001'
    });

    let observed: WorkspaceWriteLeaseToken | undefined;
    await manager.withLease(workspaceRoot, lease.token, async (token) => {
      observed = token;
      await manager.assertOwned(workspaceRoot, token);
    });
    expect(observed).toEqual(lease.token);

    await contender.assertOwned(workspaceRoot, lease.token);
    await expect(contender.withLease(workspaceRoot, lease.token, async () => undefined)).rejects.toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-002'
    });
    await expect(contender.release(workspaceRoot, lease.token)).rejects.toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-002'
    });
    await lease.assertOwned();

    const forged = { ...lease.token, leaseId: 'forged' };
    await expect(manager.release(workspaceRoot, forged)).rejects.toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-002'
    });
    await lease.assertOwned();
    await lease.release();
    await expect(lease.assertOwned()).rejects.toBeInstanceOf(WorkspaceWriteLeaseError);
  }, 'engineering-compiler-workspace-lease-exclusive-');
});

test('same-host dead stale lease is quarantined while live, foreign, and unknown owners fail closed', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    let clock = 1_000;
    const original = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 1_000,
      staleAfterMs: 2_000,
      hostname: 'lease-test-host',
      pid: 100,
      processNonce: 'process:original',
      now: () => clock,
      createId: ids('original'),
      processAlive: () => 'alive'
    });
    const abandoned = await original.acquire(workspaceRoot);
    clock = 4_000;

    const liveContender = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 1_000,
      staleAfterMs: 2_000,
      hostname: 'lease-test-host',
      pid: 200,
      processNonce: 'process:live',
      now: () => clock,
      createId: ids('live'),
      processAlive: () => 'alive'
    });
    await expect(liveContender.acquire(workspaceRoot)).rejects.toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-001'
    });

    const foreignContender = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 1_000,
      staleAfterMs: 2_000,
      hostname: 'foreign-host',
      pid: 300,
      processNonce: 'process:foreign',
      now: () => clock,
      createId: ids('foreign'),
      processAlive: () => 'dead'
    });
    await expect(foreignContender.acquire(workspaceRoot)).rejects.toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-003'
    });

    const unknownContender = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 1_000,
      staleAfterMs: 2_000,
      hostname: 'lease-test-host',
      pid: 400,
      processNonce: 'process:unknown',
      now: () => clock,
      createId: ids('unknown'),
      processAlive: () => 'unknown'
    });
    await expect(unknownContender.acquire(workspaceRoot)).rejects.toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-003'
    });

    const deadContender = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 1_000,
      staleAfterMs: 2_000,
      hostname: 'lease-test-host',
      pid: 500,
      processNonce: 'process:dead',
      now: () => clock,
      createId: ids('dead'),
      processAlive: () => 'dead'
    });
    const replacement = await deadContender.acquire(workspaceRoot);
    await replacement.assertOwned();
    await expect(abandoned.assertOwned()).rejects.toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-002'
    });
    await replacement.release();
  }, 'engineering-compiler-workspace-lease-reclaim-');
});

test('lease errors expose stable safe details without workspace paths', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const manager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 10_000,
      staleAfterMs: 20_000,
      hostname: 'lease-test-host',
      pid: 100,
      processNonce: 'process:safe',
      createId: ids('safe'),
      processAlive: () => 'alive'
    });
    const lease = await manager.acquire(workspaceRoot);
    try {
      await manager.acquire(workspaceRoot);
      throw new Error('Expected lease contention');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceWriteLeaseError);
      expect(JSON.stringify(error)).not.toContain(workspaceRoot);
      expect((error as WorkspaceWriteLeaseError).details).toEqual({ retryable: true });
    }
    await lease.release();
  }, 'engineering-compiler-workspace-lease-safe-diagnostic-');
});

test('an existing empty fixed lease directory is never replaced by candidate publish', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const localState = path.join(workspaceRoot, '.sec');
    const fixedLease = path.join(localState, 'workspace-write-lease');
    await mkdir(fixedLease, { recursive: true });
    const manager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 10_000,
      staleAfterMs: 20_000,
      hostname: 'lease-test-host',
      pid: 100,
      processNonce: 'process:empty-fixed',
      createId: ids('empty-fixed'),
      processAlive: () => 'dead'
    });

    await expect(manager.acquire(workspaceRoot)).rejects.toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-003'
    });
    expect(await readdir(fixedLease)).toEqual([]);
    expect(await readdir(localState)).toEqual(['workspace-write-lease']);
  }, 'engineering-compiler-workspace-lease-empty-fixed-');
});

test('native local-state filesystem failures become typed diagnostics without absolute paths', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const localState = path.join(workspaceRoot, '.sec');
    await writeFile(localState, 'not-a-directory', 'utf8');
    const manager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 10_000,
      staleAfterMs: 20_000,
      hostname: 'lease-test-host',
      pid: 100,
      processNonce: 'process:native-failure',
      createId: ids('native-failure'),
      processAlive: () => 'alive'
    });

    let failure: unknown;
    try {
      await manager.acquire(workspaceRoot);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(WorkspaceWriteLeaseError);
    expect(failure).toMatchObject({ code: 'WORKSPACE-WRITE-LEASE-004' });
    expect(String(failure)).not.toContain(workspaceRoot);
    expect(JSON.stringify(failure)).not.toContain(workspaceRoot);
  }, 'engineering-compiler-workspace-lease-native-failure-');
});

test('generic lease acquisition keeps a missing workspace fail closed with path-free identity details', async () => {
  await withTempWorkspace(async (outerRoot) => {
    const workspaceRoot = path.join(outerRoot, 'missing-workspace');
    const manager = createWorkspaceWriteLeaseManager({
      hostname: 'lease-test-host',
      pid: 100,
      processNonce: 'process:missing-workspace',
      createId: ids('missing-workspace'),
      processAlive: () => 'alive'
    });

    let failure: unknown;
    try {
      await manager.acquire(workspaceRoot);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(WorkspaceWriteLeaseError);
    expect(failure).toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-004',
      details: {
        operation: 'acquire',
        phase: 'workspace-identity',
        reason: 'missing'
      }
    });
    expect(String(failure)).not.toContain(workspaceRoot);
    expect(JSON.stringify(failure)).not.toContain(workspaceRoot);
    expect(await pathExists(workspaceRoot)).toBe(false);
  }, 'engineering-compiler-workspace-lease-missing-root-');
});

test('lease authority rejects a local-state junction that escapes the canonical workspace', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const outside = path.join(path.dirname(workspaceRoot), `${path.basename(workspaceRoot)}-outside`);
    const localState = path.join(workspaceRoot, '.sec');
    await mkdir(outside, { recursive: true });
    await symlink(outside, localState, process.platform === 'win32' ? 'junction' : 'dir');
    const manager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 10_000,
      staleAfterMs: 20_000,
      hostname: 'lease-test-host',
      pid: 100,
      processNonce: 'process:escaped-parent',
      createId: ids('escaped-parent'),
      processAlive: () => 'alive'
    });
    try {
      await expect(manager.acquire(workspaceRoot)).rejects.toMatchObject({
        code: 'WORKSPACE-WRITE-LEASE-004'
      });
    } finally {
      await unlink(localState).catch(() => undefined);
      await rm(outside, { recursive: true, force: true });
    }
  }, 'engineering-compiler-workspace-lease-escaped-parent-');
});
