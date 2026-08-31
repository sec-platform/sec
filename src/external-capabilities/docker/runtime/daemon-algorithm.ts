import {
  DockerDaemonAvailabilityFailure,
  type DockerDaemonAvailabilityFailureReason
} from '../contract/daemon.ts';

export interface DockerDaemonCommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type DockerDaemonCommand = (input: Readonly<{
  args: readonly string[];
  cwd: string;
  deadlineAtUnixMs: number;
  lifecycle:
    | 'destructive-repair-start'
    | 'destructive-repair-stop'
    | 'observe'
    | 'start';
}>) => Promise<DockerDaemonCommandResult>;

export interface DockerDaemonObservationInput {
  readonly cwd: string;
  readonly deadlineAtUnixMs: number;
  readonly endpointHost: string;
  readonly run: DockerDaemonCommand;
}

/**
 * Runs one operation while holding the launcher identity selected by the
 * physical owner. A null result means the exact launcher is already owned;
 * callers must not poll or start another launcher.
 */
export type DockerDaemonLauncherLock = <T>(operation: () => Promise<T>) => Promise<T | null>;

export interface DockerDaemonEnsureStartedInput extends DockerDaemonObservationInput {
  readonly platform?: NodeJS.Platform;
  readonly withLauncherLock: DockerDaemonLauncherLock;
}

export interface DockerDaemonDestructiveRepairInput extends DockerDaemonEnsureStartedInput {
  /** Explicit destructive owner; never used by observe or ensure-started. */
  readonly relocateStoppedSocketEpochs: () => number | Promise<number>;
}

function fail(
  endpointHost: string,
  reason: DockerDaemonAvailabilityFailureReason
): never {
  throw new DockerDaemonAvailabilityFailure({ endpointHost, reason });
}

function remainingMs(input: DockerDaemonObservationInput): number {
  const remaining = input.deadlineAtUnixMs - Date.now();
  if (!Number.isSafeInteger(input.deadlineAtUnixMs) || remaining < 1) {
    fail(input.endpointHost, 'deadline-exhausted');
  }
  return remaining;
}

function startFailureReason(result: DockerDaemonCommandResult):
DockerDaemonAvailabilityFailureReason {
  return /access\s+is\s+denied|access\s+denied|permission\s+denied|requires?\s+administrator/iu
    .test(`${result.stdout}\n${result.stderr}`)
    ? 'service-permission-required'
    : 'desktop-start-failed';
}

async function run(
  input: DockerDaemonObservationInput,
  args: readonly string[],
  lifecycle: Parameters<DockerDaemonCommand>[0]['lifecycle'],
  failureReason: DockerDaemonAvailabilityFailureReason
): Promise<DockerDaemonCommandResult> {
  remainingMs(input);
  try {
    return await input.run({
      args,
      cwd: input.cwd,
      deadlineAtUnixMs: input.deadlineAtUnixMs,
      lifecycle
    });
  } catch (error) {
    if (error instanceof DockerDaemonAvailabilityFailure) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (Date.now() >= input.deadlineAtUnixMs || /\b(?:abort|deadline|timeout)\b/iu.test(message)) {
      fail(input.endpointHost, 'deadline-exhausted');
    }
    if (/\b(?:known folder|LOCALAPPDATA|APPDATA|PROGRAMDATA)\b/iu.test(message)) {
      fail(input.endpointHost, 'desktop-environment-unavailable');
    }
    fail(input.endpointHost, failureReason);
  }
}

function infoArgs(endpointHost: string): readonly string[] {
  return Object.freeze(['--host', endpointHost, 'info', '--format', '{{json .}}']);
}

/** Pure availability observation: it never starts, stops, repairs, or renames provider state. */
export async function observeDockerDaemonWithCommand(
  input: DockerDaemonObservationInput
): Promise<DockerDaemonCommandResult> {
  const observed = await run(input, infoArgs(input.endpointHost), 'observe', 'endpoint-unavailable');
  if (observed.code !== 0) fail(input.endpointHost, 'endpoint-unavailable');
  return observed;
}

/**
 * One bounded availability transition. It may issue exactly one official
 * Docker Desktop start intent, then performs one final daemon readback. It
 * never stops the desktop, renames socket epochs, or retries a failed start.
 */
export async function ensureDockerDaemonStartedWithCommand(
  input: DockerDaemonEnsureStartedInput
): Promise<DockerDaemonCommandResult> {
  const initial = await run(input, infoArgs(input.endpointHost), 'observe', 'endpoint-unavailable');
  if (initial.code === 0) return initial;
  if ((input.platform ?? process.platform) !== 'win32'
      || !/^npipe:\/{4}\.\/pipe\/dockerDesktop[A-Za-z0-9_.-]*$/u.test(input.endpointHost)) {
    fail(input.endpointHost, 'endpoint-unavailable');
  }
  const settled = await input.withLauncherLock(async () => {
    // The endpoint may have become ready between the initial observation and
    // lock acquisition. Re-observe once, then issue at most one start intent.
    const lockedObservation = await run(
      input,
      infoArgs(input.endpointHost),
      'observe',
      'endpoint-unavailable'
    );
    if (lockedObservation.code === 0) return lockedObservation;
    const start = await run(input, Object.freeze([
      'desktop', 'start', '--timeout', String(Math.max(1, Math.floor(remainingMs(input) / 1_000)))
    ]), 'start', 'desktop-start-failed');
    if (start.code !== 0) fail(input.endpointHost, startFailureReason(start));
    return await observeDockerDaemonWithCommand(input);
  });
  if (settled === null) fail(input.endpointHost, 'desktop-launcher-busy');
  return settled;
}

/**
 * Explicit destructive lifecycle. This is the only Docker daemon API allowed
 * to stop Desktop or relocate stopped socket epochs. It never retries a failed
 * start and issues at most one start intent for this repair operation.
 */
export async function repairDockerDaemonDestructivelyWithCommand(
  input: DockerDaemonDestructiveRepairInput
): Promise<DockerDaemonCommandResult> {
  remainingMs(input);
  if ((input.platform ?? process.platform) !== 'win32'
      || !/^npipe:\/{4}\.\/pipe\/dockerDesktop[A-Za-z0-9_.-]*$/u.test(input.endpointHost)) {
    fail(input.endpointHost, 'endpoint-unavailable');
  }
  const settled = await input.withLauncherLock(async () => {
    const current = await run(
      input,
      infoArgs(input.endpointHost),
      'observe',
      'endpoint-unavailable'
    );
    if (current.code === 0) return current;
    const stop = await run(input, Object.freeze([
      'desktop', 'stop', '--force', '--timeout',
      String(Math.max(1, Math.floor(remainingMs(input) / 1_000)))
    ]), 'destructive-repair-stop', 'desktop-stop-failed');
    if (stop.code !== 0) {
      const reason = startFailureReason(stop);
      fail(input.endpointHost, reason === 'service-permission-required'
        ? reason
        : 'desktop-stop-failed');
    }
    let recovered: number;
    try {
      recovered = await input.relocateStoppedSocketEpochs();
    } catch {
      fail(input.endpointHost, 'host-socket-recovery-unavailable');
    }
    if (!Number.isSafeInteger(recovered) || recovered < 1) {
      fail(input.endpointHost, 'host-socket-recovery-unavailable');
    }
    const start = await run(input, Object.freeze([
      'desktop', 'start', '--timeout', String(Math.max(1, Math.floor(remainingMs(input) / 1_000)))
    ]), 'destructive-repair-start', 'desktop-start-failed');
    if (start.code !== 0) fail(input.endpointHost, startFailureReason(start));
    return await observeDockerDaemonWithCommand(input);
  });
  if (settled === null) fail(input.endpointHost, 'desktop-launcher-busy');
  return settled;
}
