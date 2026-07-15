import { describe, expect, test } from 'bun:test';

import {
  createWorkspaceWithDeferredCleanup,
  removeWorkspaceDirectoryWithRetry,
  settleWorkspaceCallback,
  type WorkspaceDirectoryRemoveOptions
} from '../testkit/workspace-cleanup.ts';

function errnoFailure(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function cleanupHarness(options: {
  readonly failures?: readonly unknown[];
  readonly platform?: NodeJS.Platform;
} = {}) {
  const directory = 'C:\\workspace\\owned';
  const deferredCleanupDirs = new Set([directory]);
  const failures = [...(options.failures ?? [])];
  const removeOptions: WorkspaceDirectoryRemoveOptions[] = [];
  const delays: number[] = [];

  return {
    directory,
    deferredCleanupDirs,
    removeOptions,
    delays,
    request: {
      directory,
      deferredCleanupDirs,
      seam: {
        platform: options.platform ?? 'win32',
        removeDirectory: async (
          requestedDirectory: string,
          requestedOptions: WorkspaceDirectoryRemoveOptions
        ) => {
          expect(requestedDirectory).toBe(directory);
          removeOptions.push(requestedOptions);
          const failure = failures.shift();
          if (failure !== undefined) throw failure;
        },
        sleep: async (delayMs: number) => {
          delays.push(delayMs);
        }
      }
    }
  };
}

describe('testkit workspace cleanup', () => {
  test('registers a workspace for deferred cleanup immediately after creation', async () => {
    const deferredCleanupDirs = new Set<string>();
    const directory = 'C:\\workspace\\created';

    const result = await createWorkspaceWithDeferredCleanup(
      'C:\\workspace\\prefix-',
      deferredCleanupDirs,
      async (prefix) => {
        expect(prefix).toBe('C:\\workspace\\prefix-');
        expect(deferredCleanupDirs.size).toBe(0);
        return directory;
      }
    );

    expect(result).toBe(directory);
    expect(deferredCleanupDirs).toEqual(new Set([directory]));
  });

  test('retries EBUSY and EPERM without delegating retries to node rm', async () => {
    const harness = cleanupHarness({
      failures: [errnoFailure('EBUSY'), errnoFailure('EPERM')],
      platform: 'linux'
    });

    await removeWorkspaceDirectoryWithRetry(harness.request);

    expect(harness.delays).toEqual([100, 200]);
    expect(harness.removeOptions).toEqual([
      { recursive: true, force: true },
      { recursive: true, force: true },
      { recursive: true, force: true }
    ]);
    expect(harness.deferredCleanupDirs.size).toBe(0);
  });

  test('retries EACCES only on win32', async () => {
    const windowsHarness = cleanupHarness({ failures: [errnoFailure('EACCES')], platform: 'win32' });
    await removeWorkspaceDirectoryWithRetry(windowsHarness.request);
    expect(windowsHarness.delays).toEqual([100]);
    expect(windowsHarness.removeOptions).toHaveLength(2);
    expect(windowsHarness.deferredCleanupDirs.size).toBe(0);

    const posixFailure = errnoFailure('EACCES');
    const posixHarness = cleanupHarness({ failures: [posixFailure], platform: 'linux' });
    await expect(removeWorkspaceDirectoryWithRetry(posixHarness.request)).rejects.toBe(posixFailure);
    expect(posixHarness.delays).toEqual([]);
    expect(posixHarness.removeOptions).toHaveLength(1);
    expect(posixHarness.deferredCleanupDirs).toContain(posixHarness.directory);
  });

  test('performs at most six rm calls and retains terminal failures for deferred cleanup', async () => {
    const failures = Array.from({ length: 6 }, () => errnoFailure('EBUSY'));
    const terminalFailure = failures.at(-1)!;
    const harness = cleanupHarness({ failures });

    await expect(removeWorkspaceDirectoryWithRetry(harness.request)).rejects.toBe(terminalFailure);

    expect(harness.removeOptions).toHaveLength(6);
    expect(harness.delays).toEqual([100, 200, 300, 400, 500]);
    expect(harness.deferredCleanupDirs).toContain(harness.directory);
  });

  test('does not retry an unrelated cleanup failure', async () => {
    const failure = errnoFailure('ENOENT');
    const harness = cleanupHarness({ failures: [failure] });

    await expect(removeWorkspaceDirectoryWithRetry(harness.request)).rejects.toBe(failure);

    expect(harness.removeOptions).toHaveLength(1);
    expect(harness.delays).toEqual([]);
    expect(harness.deferredCleanupDirs).toContain(harness.directory);
  });

  test('preserves the original callback failure when cleanup also fails', async () => {
    const primary = new Error('primary');
    const cleanupFailure = new Error('cleanup');
    let cleanupCalls = 0;

    await expect(
      settleWorkspaceCallback(
        async () => {
          throw primary;
        },
        async () => {
          cleanupCalls += 1;
          throw cleanupFailure;
        }
      )
    ).rejects.toBe(primary);

    expect(cleanupCalls).toBe(1);
    expect(primary).not.toHaveProperty('cause');
  });

  test('retains forensic authority without cleanup after an opted-in callback failure', async () => {
    const directory = 'C:\\workspace\\retained';
    const deferredCleanupDirs = new Set([directory]);
    const primary = new Error('primary');
    let cleanupCalls = 0;

    await expect(
      settleWorkspaceCallback(
        async () => {
          throw primary;
        },
        async () => {
          cleanupCalls += 1;
        },
        {
          retainOnCallbackFailure: true,
          directory,
          deferredCleanupDirs
        }
      )
    ).rejects.toBe(primary);

    expect(cleanupCalls).toBe(0);
    expect(deferredCleanupDirs).not.toContain(directory);
  });

  test('fails with the original cleanup error when the callback succeeds', async () => {
    const cleanupFailure = new Error('cleanup');

    await expect(
      settleWorkspaceCallback(
        async () => 'result',
        async () => {
          throw cleanupFailure;
        }
      )
    ).rejects.toBe(cleanupFailure);
  });

  test('returns the callback result after successful cleanup', async () => {
    let cleanupCalls = 0;
    const result = await settleWorkspaceCallback(
      async () => ({ status: 'ok' as const }),
      async () => {
        cleanupCalls += 1;
      }
    );

    expect(result).toEqual({ status: 'ok' });
    expect(cleanupCalls).toBe(1);
  });
});
