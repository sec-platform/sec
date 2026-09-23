import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  acquireWorkspaceWriteLease,
  issueWindowsAppContainerExecutionCapability
} from '../../src/adapters/filesystem/write-lease.ts';
import {
  assertWindowsAppContainerExecutionCapability,
  issueWindowsAppContainerExecutionCapability as issuePhysicalWindowsAppContainerExecutionCapability,
  WindowsAppContainerExecutionCapabilityError
} from '../../src/adapters/runtime-state/physical/contract/windows-appcontainer-execution-capability.ts';

function operationDeadline(timeoutMs: number): Readonly<{
  deadlineAtUnixMs: number;
  deadlineAtMonotonicMs: number;
}> {
  const observedAtMonotonicMs = performance.now();
  const observedAtUnixMs = Date.now();
  return Object.freeze({
    deadlineAtUnixMs: observedAtUnixMs + timeoutMs,
    deadlineAtMonotonicMs: observedAtMonotonicMs + timeoutMs
  });
}

async function withCapabilityWorkspace(
  run: (input: Readonly<{ workspaceRoot: string; stagingRoot: string }>) => Promise<void>
): Promise<void> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), '.tmp-appcontainer-capability-'));
  const stagingRoot = path.join(workspaceRoot, 'staging');
  await mkdir(stagingRoot);
  try {
    await run(Object.freeze({ workspaceRoot, stagingRoot }));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  }
}

test('workspace owner issues one live capability bound to its exact staging root', async () => {
  await withCapabilityWorkspace(async ({ workspaceRoot, stagingRoot }) => {
    const lease = await acquireWorkspaceWriteLease(workspaceRoot);
    try {
      const capability = await issueWindowsAppContainerExecutionCapability({
        workspaceRoot,
        stagingRoot,
        workspaceWriteLease: lease.token,
        ...operationDeadline(10_000)
      });
      const receipt = await assertWindowsAppContainerExecutionCapability(capability, stagingRoot);
      expect(receipt).toMatchObject({
        stagingRoot,
        authorityBindingDigest: lease.token.workspaceIdentityDigest
      });
      expect(Object.keys(capability)).toEqual([]);
    } finally {
      await lease.release();
    }
  });
});

test('plain objects and foreign staging roots cannot substitute a capability', async () => {
  await withCapabilityWorkspace(async ({ workspaceRoot, stagingRoot }) => {
    const foreignStagingRoot = path.join(workspaceRoot, 'foreign');
    await mkdir(foreignStagingRoot);
    const lease = await acquireWorkspaceWriteLease(workspaceRoot);
    try {
      const capability = await issueWindowsAppContainerExecutionCapability({
        workspaceRoot,
        stagingRoot,
        workspaceWriteLease: lease.token,
        ...operationDeadline(10_000)
      });
      await expect(assertWindowsAppContainerExecutionCapability(
        {} as never,
        stagingRoot
      )).rejects.toBeInstanceOf(WindowsAppContainerExecutionCapabilityError);
      await expect(assertWindowsAppContainerExecutionCapability(
        capability,
        foreignStagingRoot
      )).rejects.toBeInstanceOf(WindowsAppContainerExecutionCapabilityError);
    } finally {
      await lease.release();
    }
  });
});

test('expired capabilities fail before their upstream fence can authorize another effect', async () => {
  await withCapabilityWorkspace(async ({ stagingRoot }) => {
    let fenceCalls = 0;
    const deadline = operationDeadline(20);
    const capability = await issuePhysicalWindowsAppContainerExecutionCapability({
      stagingRoot,
      authorityBindingDigest: `sha256:${'1'.repeat(64)}`,
      ...deadline,
      assertCurrent: async () => {
        fenceCalls += 1;
      }
    });
    const issueFenceCalls = fenceCalls;
    while (performance.now() <= deadline.deadlineAtMonotonicMs) await Bun.sleep(1);
    await expect(assertWindowsAppContainerExecutionCapability(
      capability,
      stagingRoot
    )).rejects.toBeInstanceOf(WindowsAppContainerExecutionCapabilityError);
    expect(fenceCalls).toBe(issueFenceCalls);
  });
});
