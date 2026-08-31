import { describe, expect, test } from 'bun:test';

import { DockerDaemonAvailabilityFailure } from '../contract/daemon.ts';
import {
  ensureDockerDaemonStartedWithCommand,
  observeDockerDaemonWithCommand,
  repairDockerDaemonDestructivelyWithCommand,
  type DockerDaemonCommandResult
} from './daemon-algorithm.ts';

const endpointHost = 'npipe:////./pipe/dockerDesktopLinuxEngine';
const unavailable = Object.freeze({ code: 1, stdout: '', stderr: '' });
const available = Object.freeze({ code: 0, stdout: '{"ID":"daemon"}', stderr: '' });

function expectReason(error: unknown, reason: DockerDaemonAvailabilityFailure['reason']): void {
  expect(error).toBeInstanceOf(DockerDaemonAvailabilityFailure);
  expect((error as DockerDaemonAvailabilityFailure).reason).toBe(reason);
}

describe('Docker daemon lifecycle algorithm', () => {
  test('observe is pure and never acquires the launcher lock', async () => {
    const calls: string[][] = [];
    const result = await observeDockerDaemonWithCommand({
      cwd: process.cwd(),
      deadlineAtUnixMs: Date.now() + 10_000,
      endpointHost,
      run: async ({ args, lifecycle }) => {
        calls.push([...args]);
        expect(lifecycle).toBe('observe');
        return available;
      }
    });
    expect(result).toBe(available);
    expect(calls).toEqual([[
      '--host', endpointHost, 'info', '--format', '{{json .}}'
    ]]);
  });

  test('ensure-started issues at most one official start and no destructive command', async () => {
    const lifecycles: string[] = [];
    let observations = 0;
    let lockEntries = 0;
    const result = await ensureDockerDaemonStartedWithCommand({
      cwd: process.cwd(),
      deadlineAtUnixMs: Date.now() + 10_000,
      endpointHost,
      platform: 'win32',
      withLauncherLock: async (operation) => {
        lockEntries += 1;
        return await operation();
      },
      run: async ({ lifecycle }) => {
        lifecycles.push(lifecycle);
        if (lifecycle === 'observe') {
          observations += 1;
          return observations < 3 ? unavailable : available;
        }
        return available;
      }
    });
    expect(result).toBe(available);
    expect(lockEntries).toBe(1);
    expect(lifecycles).toEqual(['observe', 'observe', 'start', 'observe']);
    expect(lifecycles.filter((value) => value === 'start')).toHaveLength(1);
    expect(lifecycles.some((value) => value.includes('stop'))).toBe(false);
  });

  test('ensure-started reuses readiness observed after lock acquisition', async () => {
    const lifecycles: string[] = [];
    let observations = 0;
    await ensureDockerDaemonStartedWithCommand({
      cwd: process.cwd(),
      deadlineAtUnixMs: Date.now() + 10_000,
      endpointHost,
      platform: 'win32',
      withLauncherLock: async (operation) => await operation(),
      run: async ({ lifecycle }) => {
        lifecycles.push(lifecycle);
        observations += 1;
        return observations === 1 ? unavailable : available;
      }
    });
    expect(lifecycles).toEqual(['observe', 'observe']);
  });

  test('ensure-started does not poll or start when the launcher is already owned', async () => {
    const lifecycles: string[] = [];
    try {
      await ensureDockerDaemonStartedWithCommand({
        cwd: process.cwd(),
        deadlineAtUnixMs: Date.now() + 10_000,
        endpointHost,
        platform: 'win32',
        withLauncherLock: async () => null,
        run: async ({ lifecycle }) => {
          lifecycles.push(lifecycle);
          return unavailable;
        }
      });
      throw new Error('expected launcher ownership blocker');
    } catch (error) {
      expectReason(error, 'desktop-launcher-busy');
    }
    expect(lifecycles).toEqual(['observe']);
  });

  test('ensure-started preserves a failed start without stop, repair, or retry', async () => {
    const lifecycles: string[] = [];
    try {
      await ensureDockerDaemonStartedWithCommand({
        cwd: process.cwd(),
        deadlineAtUnixMs: Date.now() + 10_000,
        endpointHost,
        platform: 'win32',
        withLauncherLock: async (operation) => await operation(),
        run: async ({ lifecycle }): Promise<DockerDaemonCommandResult> => {
          lifecycles.push(lifecycle);
          return lifecycle === 'start'
            ? { code: 1, stdout: '', stderr: 'failed' }
            : unavailable;
        }
      });
      throw new Error('expected start blocker');
    } catch (error) {
      expectReason(error, 'desktop-start-failed');
    }
    expect(lifecycles).toEqual(['observe', 'observe', 'start']);
  });

  test('ensure-started rejects an exhausted operation before observation or lock acquisition', async () => {
    let commands = 0;
    let locks = 0;
    try {
      await ensureDockerDaemonStartedWithCommand({
        cwd: process.cwd(),
        deadlineAtUnixMs: Date.now() - 1,
        endpointHost,
        platform: 'win32',
        withLauncherLock: async (operation) => {
          locks += 1;
          return await operation();
        },
        run: async () => {
          commands += 1;
          return available;
        }
      });
      throw new Error('expected exhausted operation blocker');
    } catch (error) {
      expectReason(error, 'deadline-exhausted');
    }
    expect(commands).toBe(0);
    expect(locks).toBe(0);
  });

  test('destructive repair is one explicit stop-relocate-start lifecycle', async () => {
    const lifecycles: string[] = [];
    let relocations = 0;
    const result = await repairDockerDaemonDestructivelyWithCommand({
      cwd: process.cwd(),
      deadlineAtUnixMs: Date.now() + 10_000,
      endpointHost,
      platform: 'win32',
      relocateStoppedSocketEpochs: () => {
        relocations += 1;
        return 1;
      },
      withLauncherLock: async (operation) => await operation(),
      run: async ({ lifecycle }) => {
        lifecycles.push(lifecycle);
        return lifecycle === 'observe' && lifecycles.length === 1 ? unavailable : available;
      }
    });
    expect(result).toBe(available);
    expect(relocations).toBe(1);
    expect(lifecycles).toEqual([
      'observe', 'destructive-repair-stop', 'destructive-repair-start', 'observe'
    ]);
  });

  test('destructive repair fails closed before restart when relocation has no receipt', async () => {
    const lifecycles: string[] = [];
    try {
      await repairDockerDaemonDestructivelyWithCommand({
        cwd: process.cwd(),
        deadlineAtUnixMs: Date.now() + 10_000,
        endpointHost,
        platform: 'win32',
        relocateStoppedSocketEpochs: () => 0,
        withLauncherLock: async (operation) => await operation(),
        run: async ({ lifecycle }) => {
          lifecycles.push(lifecycle);
          return lifecycle === 'observe' ? unavailable : available;
        }
      });
      throw new Error('expected destructive repair blocker');
    } catch (error) {
      expectReason(error, 'host-socket-recovery-unavailable');
    }
    expect(lifecycles).toEqual(['observe', 'destructive-repair-stop']);
  });
});
