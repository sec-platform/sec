import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { inspectNoFollowDirectoryChain } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { RetainedCommandTransportError } from '../../../runtime-state/physical/runtime/process.ts';
import { openRetainedRuntimeStateDirectoryAtOwnerIssuedRoot } from '../../../runtime-state/physical/runtime/retained-runtime-state-directory.ts';
import {
  issueRuntimeGenerationCensusReceiptForTests,
  observeRuntimeEndpointResidueCandidatesForTests,
  runtimeEndpointAccessFailureObservationForTests,
  type RuntimeEndpointResidueReceipt
} from '../../../runtime-state/physical/runtime/runtime-endpoint-residue.ts';
import { DockerDaemonAvailabilityFailure } from '../contract/daemon.ts';
import {
  ensureDockerDaemonStartedWithCommand,
  observeDockerDaemonWithCommand,
  type DockerDaemonCommandResult
} from './daemon-algorithm.ts';

const endpointHost = 'npipe:////./pipe/dockerDesktopLinuxEngine';
const unavailable = Object.freeze({ code: 1, stdout: '', stderr: '' });
const available = Object.freeze({ code: 0, stdout: '{"ID":"daemon"}', stderr: '' });
const commandDeadlineAtUnixMs = (): number => Date.now() + 9_000;
const residueProviderIdentityDigest = `sha256:${'b'.repeat(64)}` as const;
const ensureStartedAuthority = Object.freeze({
  providerAuthorityIdentityDigest: residueProviderIdentityDigest,
  providerIdentityDigest: residueProviderIdentityDigest,
  censusRuntimeGenerations: () => issueRuntimeGenerationCensusReceiptForTests({
    providerIdentityDigest: residueProviderIdentityDigest,
    states: ['active', 'absent']
  })
});

function expectReason(error: unknown, reason: DockerDaemonAvailabilityFailure['reason']): void {
  expect(error).toBeInstanceOf(DockerDaemonAvailabilityFailure);
  expect((error as DockerDaemonAvailabilityFailure).reason).toBe(reason);
}

async function withIssuedResidueReceipt<T>(
  operation: (input: Readonly<{
    endpointPath: string;
    observe(providerEvidence: string): RuntimeEndpointResidueReceipt | null;
  }>) => Promise<T>
): Promise<T> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'docker-runtime-receipt-'));
  const parentPath = path.join(rootPath, 'arbitrary-owner');
  await mkdir(parentPath);
  const endpointPath = path.join(parentPath, 'unlisted.endpoint');
  await writeFile(endpointPath, 'endpoint-preimage');
  const retained = openRetainedRuntimeStateDirectoryAtOwnerIssuedRoot({
    childDescriptor: 58,
    mode: 'open-existing',
    root: inspectNoFollowDirectoryChain(rootPath, 'Docker typed residue test root')
  });
  try {
    return await operation({
      endpointPath,
      observe: (providerEvidence) => observeRuntimeEndpointResidueCandidatesForTests({
        admittedGenerationRoots: [
          inspectNoFollowDirectoryChain(parentPath, 'Docker admitted generation root').target
        ],
        providerIdentityDigest: residueProviderIdentityDigest,
        providerEvidence,
        roots: [retained],
        probe: ({ candidatePath }) => runtimeEndpointAccessFailureObservationForTests({
          candidatePath
        })
      })
    });
  } finally {
    retained.close();
    await rm(rootPath, { recursive: true, force: true });
  }
}

describe('Docker daemon lifecycle algorithm', () => {
  test('observe is pure and never acquires the launcher lock', async () => {
    const calls: string[][] = [];
    const result = await observeDockerDaemonWithCommand({
      commandDeadlineAtUnixMs,
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
    const commands: string[][] = [];
    let observations = 0;
    let lockEntries = 0;
    const result = await ensureDockerDaemonStartedWithCommand({
      ...ensureStartedAuthority,
      commandDeadlineAtUnixMs,
      cwd: process.cwd(),
      deadlineAtUnixMs: Date.now() + 10_000,
      endpointHost,
      platform: 'win32',
      withLauncherLock: async (operation) => {
        lockEntries += 1;
        return await operation();
      },
      run: async ({ args, lifecycle }) => {
        commands.push([...args]);
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
    expect(commands[2]!.slice(0, 3)).toEqual(['desktop', 'start', '--timeout']);
  });

  test('ensure-started returns an initial ready observation without lock or start', async () => {
    let lockEntries = 0;
    const lifecycles: string[] = [];
    const result = await ensureDockerDaemonStartedWithCommand({
      ...ensureStartedAuthority,
      commandDeadlineAtUnixMs,
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
        return available;
      }
    });
    expect(result).toBe(available);
    expect(lockEntries).toBe(0);
    expect(lifecycles).toEqual(['observe']);
  });

  test('ensure-started reuses readiness observed after lock acquisition', async () => {
    const lifecycles: string[] = [];
    let observations = 0;
    await ensureDockerDaemonStartedWithCommand({
      ...ensureStartedAuthority,
      commandDeadlineAtUnixMs,
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
        ...ensureStartedAuthority,
        commandDeadlineAtUnixMs,
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
        ...ensureStartedAuthority,
        commandDeadlineAtUnixMs,
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

  test('pre-start generation census blocks typed residue and unknown states before launcher spawn', async () => {
    for (const vector of [
      { state: 'stale-residue' as const, reason: 'runtime-endpoint-residue' as const },
      { state: 'inaccessible-residue' as const, reason: 'runtime-endpoint-residue' as const },
      { state: 'unknown' as const, reason: 'desktop-environment-unavailable' as const }
    ]) {
      const lifecycles: string[] = [];
      try {
        await ensureDockerDaemonStartedWithCommand({
          ...ensureStartedAuthority,
          censusRuntimeGenerations: () => issueRuntimeGenerationCensusReceiptForTests({
            providerIdentityDigest: residueProviderIdentityDigest,
            states: [vector.state]
          }),
          commandDeadlineAtUnixMs,
          cwd: process.cwd(),
          deadlineAtUnixMs: Date.now() + 10_000,
          endpointHost,
          platform: 'win32',
          withLauncherLock: async (operation) => await operation(),
          run: async ({ lifecycle }) => {
            lifecycles.push(lifecycle);
            return unavailable;
          }
        });
        throw new Error('expected generation census blocker');
      } catch (error) {
        expectReason(error, vector.reason);
      }
      expect(lifecycles).toEqual(['observe', 'observe']);
    }
  });

  test('provider launcher text alone cannot mint a launcher-path terminal', async () => {
    const lifecycles: string[] = [];
    let observations = 0;
    const result = await ensureDockerDaemonStartedWithCommand({
      ...ensureStartedAuthority,
      commandDeadlineAtUnixMs,
      cwd: process.cwd(),
      deadlineAtUnixMs: Date.now() + 10_000,
      endpointHost,
      platform: 'win32',
      withLauncherLock: async (operation) => await operation(),
      run: async ({ lifecycle }) => {
        lifecycles.push(lifecycle);
        if (lifecycle === 'start') return {
          code: 0,
          stdout: '',
          stderr: 'Error: acquiring launcher lock: open : The system cannot find the file specified.'
        };
        observations += 1;
        return observations < 3 ? unavailable : available;
      }
    });
    expect(result).toBe(available);
    expect(lifecycles).toEqual(['observe', 'observe', 'start', 'observe']);
  });

  test('consumes a physical-owner runtime endpoint residue receipt', async () => {
    await withIssuedResidueReceipt(async ({ endpointPath, observe }) => {
      try {
        await ensureDockerDaemonStartedWithCommand({
          ...ensureStartedAuthority,
          commandDeadlineAtUnixMs,
          cwd: process.cwd(),
          deadlineAtUnixMs: Date.now() + 10_000,
          endpointHost,
          observeRuntimeEndpointResidue: observe,
          platform: 'win32',
          withLauncherLock: async (operation) => await operation(),
          run: async ({ lifecycle }) => lifecycle === 'start'
            ? {
              code: 1,
              stdout: '',
              stderr: `remove ${endpointPath}: provider presentation`
            }
            : unavailable
        });
        throw new Error('expected runtime endpoint residue blocker');
      } catch (error) {
        expectReason(error, 'runtime-endpoint-residue');
        expect((error as DockerDaemonAvailabilityFailure).phase).toBe('desktop-start');
      }
    });
  });

  test('reboot and Win32 presentation without physical receipt is non-authoritative', async () => {
    let observations = 0;
    const result = await ensureDockerDaemonStartedWithCommand({
      ...ensureStartedAuthority,
      commandDeadlineAtUnixMs,
      cwd: process.cwd(),
      deadlineAtUnixMs: Date.now() + 10_000,
      endpointHost,
      observeRuntimeEndpointResidue: () => null,
      platform: 'win32',
      withLauncherLock: async (operation) => await operation(),
      run: async ({ lifecycle }) => {
        if (lifecycle === 'start') return {
          code: 0,
          stdout: '',
          stderr: 'arbitrary.endpoint Win32 1920; restart Windows is required'
        };
        observations += 1;
        return observations < 3 ? unavailable : available;
      }
    });
    expect(result).toBe(available);
  });

  test('classifies retained child settlement failure separately from endpoint state', async () => {
    try {
      await observeDockerDaemonWithCommand({
        commandDeadlineAtUnixMs,
        cwd: process.cwd(),
        deadlineAtUnixMs: Date.now() + 10_000,
        endpointHost,
        run: async () => {
          throw new RetainedCommandTransportError('typed retained settlement failure', {
            status: 'termination-unproven',
            started: true,
            exitCode: 0,
            signal: null,
            durationMs: 1,
            stdout: { bytes: 0, digest: 'sha256:stdout', observerTruncated: false },
            stderr: { bytes: 0, digest: 'sha256:stderr', observerTruncated: false },
            termination: {
              requested: true,
              gracefulAttempted: true,
              forcedAttempted: true,
              childCloseObserved: false,
              streamsDrained: false,
              treeClosed: false
            }
          });
        }
      });
      throw new Error('expected process settlement blocker');
    } catch (error) {
      expectReason(error, 'process-settlement-failed');
      expect((error as DockerDaemonAvailabilityFailure).phase).toBe('process-settlement');
    }
  });

  test('ensure-started rejects an exhausted operation before observation or lock acquisition', async () => {
    let commands = 0;
    let locks = 0;
    try {
      await ensureDockerDaemonStartedWithCommand({
        ...ensureStartedAuthority,
        commandDeadlineAtUnixMs,
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
});
