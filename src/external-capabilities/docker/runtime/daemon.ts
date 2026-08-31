import { inspectNoFollowDirectoryChain } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { runCommand } from '../../../runtime-state/physical/runtime/process.ts';
import { resolveWindowsKnownFolderPath } from '../../../runtime-state/physical/runtime/windows-known-folders.ts';
import { DockerDaemonAvailabilityFailure } from '../contract/daemon.ts';
import type { DockerDaemonCommandResult } from './daemon-algorithm.ts';
import {
  ensureDockerDaemonStartedWithCommand,
  observeDockerDaemonWithCommand,
  repairDockerDaemonDestructivelyWithCommand
} from './daemon-algorithm.ts';
import { withDockerDesktopLauncherLockAtOwnerIssuedDirectory } from './launcher-lock.ts';

const DOCKER_COMMAND_ENVIRONMENT_KEYS = Object.freeze([
  'HOME', 'PATH', 'PROGRAMFILES', 'SYSTEMROOT', 'USERPROFILE', 'WINDIR'
] as const);

function projectedEnvironment(
  keys: readonly string[],
  source: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const expected of keys) {
    const actual = Object.keys(source).find((candidate) => candidate.toUpperCase() === expected);
    if (actual !== undefined && source[actual] !== undefined) environment[actual] = source[actual];
  }
  return environment;
}

async function dockerDesktopLifecycleEnvironment(): Promise<NodeJS.ProcessEnv> {
  const [localAppData, appData, programData] = await Promise.all([
    resolveWindowsKnownFolderPath('local-app-data'),
    resolveWindowsKnownFolderPath('roaming-app-data'),
    resolveWindowsKnownFolderPath('program-data')
  ]);
  for (const [label, directory] of Object.entries({ localAppData, appData, programData })) {
    inspectNoFollowDirectoryChain(directory, `Docker Desktop ${label} known folder`);
  }
  return {
    ...projectedEnvironment(DOCKER_COMMAND_ENVIRONMENT_KEYS, process.env),
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    PROGRAMDATA: programData,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP
  };
}

async function runDockerDaemonCommand(input: Readonly<{
  args: readonly string[];
  cwd: string;
  deadlineAtUnixMs: number;
  lifecycle:
    | 'destructive-repair-start'
    | 'destructive-repair-stop'
    | 'observe'
    | 'start';
}>): Promise<DockerDaemonCommandResult> {
  const timeoutMs = input.deadlineAtUnixMs - Date.now();
  if (!Number.isSafeInteger(input.deadlineAtUnixMs) || timeoutMs < 1) {
    throw new Error('Docker daemon command deadline is exhausted');
  }
  return await runCommand('docker', [...input.args], {
    cwd: input.cwd,
    env: input.lifecycle === 'observe'
      ? projectedEnvironment(DOCKER_COMMAND_ENVIRONMENT_KEYS, process.env)
      : await dockerDesktopLifecycleEnvironment(),
    envMode: 'replace',
    maxStderrBytes: 1024 * 1024,
    maxStdoutBytes: 1024 * 1024,
    timeoutMs
  });
}

async function withDockerDesktopLauncherLock<T>(
  input: Readonly<{ deadlineAtUnixMs: number; endpointHost: string }>,
  operation: () => Promise<T>
): Promise<T | null> {
  const remaining = input.deadlineAtUnixMs - Date.now();
  if (!Number.isSafeInteger(input.deadlineAtUnixMs) || remaining < 1) {
    throw new DockerDaemonAvailabilityFailure({
      endpointHost: input.endpointHost,
      reason: 'deadline-exhausted'
    });
  }
  try {
    // The lock parent comes only from the current Windows token's Known Folder
    // owner. No ambient environment value or caller-authored filesystem path
    // participates in launcher serialization.
    const localAppData = await resolveWindowsKnownFolderPath('local-app-data');
    const parent = inspectNoFollowDirectoryChain(
      localAppData,
      'Docker Desktop launcher lock Known Folder'
    ).target;
    return await withDockerDesktopLauncherLockAtOwnerIssuedDirectory({
      deadlineAtUnixMs: input.deadlineAtUnixMs,
      endpointHost: input.endpointHost,
      operation,
      parent,
    });
  } catch (error) {
    if (error instanceof DockerDaemonAvailabilityFailure) throw error;
    throw new DockerDaemonAvailabilityFailure({
      endpointHost: input.endpointHost,
      reason: 'desktop-environment-unavailable'
    });
  }
}

export async function observeDockerDaemon(input: Readonly<{
  cwd: string;
  deadlineAtUnixMs: number;
  endpointHost: string;
}>): Promise<DockerDaemonCommandResult> {
  return await observeDockerDaemonWithCommand({ ...input, run: runDockerDaemonCommand });
}

export async function ensureDockerDaemonStarted(input: Readonly<{
  cwd: string;
  deadlineAtUnixMs: number;
  endpointHost: string;
}>): Promise<DockerDaemonCommandResult> {
  return await ensureDockerDaemonStartedWithCommand({
    ...input,
    run: runDockerDaemonCommand,
    withLauncherLock: async (operation) => await withDockerDesktopLauncherLock(input, operation)
  });
}

/**
 * Destructive repair is deliberately a separate entrypoint. The relocation
 * callback must come from the operation's destructive owner; ordinary daemon
 * observation and ensure-started cannot reach it.
 */
export async function repairDockerDaemonDestructively(input: Readonly<{
  cwd: string;
  deadlineAtUnixMs: number;
  endpointHost: string;
  relocateStoppedSocketEpochs: () => number | Promise<number>;
}>): Promise<DockerDaemonCommandResult> {
  return await repairDockerDaemonDestructivelyWithCommand({
    ...input,
    run: runDockerDaemonCommand,
    withLauncherLock: async (operation) => await withDockerDesktopLauncherLock(input, operation)
  });
}
