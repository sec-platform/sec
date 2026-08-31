import {
  DockerDaemonAvailabilityFailure,
  type DockerDaemonAvailabilityFailurePhase,
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
  lifecycle: 'observe' | 'start';
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

function fail(
  endpointHost: string,
  reason: DockerDaemonAvailabilityFailureReason,
  phase: DockerDaemonAvailabilityFailurePhase,
  providerEvidence = ''
): never {
  throw new DockerDaemonAvailabilityFailure({
    endpointHost,
    reason,
    phase,
    providerEvidence
  });
}

function remainingMs(input: DockerDaemonObservationInput): number {
  const remaining = input.deadlineAtUnixMs - Date.now();
  if (!Number.isSafeInteger(input.deadlineAtUnixMs) || remaining < 1) {
    fail(input.endpointHost, 'deadline-exhausted', 'admission');
  }
  return remaining;
}

function startFailureReason(result: DockerDaemonCommandResult):
DockerDaemonAvailabilityFailureReason {
  const evidence = `${result.stdout}\n${result.stderr}`;
  if (/acquiring\s+launcher\s+lock[\s\S]*\bopen\b[\s\S]*system\s+cannot\s+find/iu
    .test(evidence)) return 'desktop-launcher-path-unavailable';
  return /access\s+is\s+denied|access\s+denied|permission\s+denied|requires?\s+administrator/iu
    .test(evidence)
    ? 'service-permission-required'
    : 'desktop-start-failed';
}

async function run(
  input: DockerDaemonObservationInput,
  args: readonly string[],
  lifecycle: Parameters<DockerDaemonCommand>[0]['lifecycle'],
  failureReason: DockerDaemonAvailabilityFailureReason,
  phase: DockerDaemonAvailabilityFailurePhase
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
      fail(input.endpointHost, 'deadline-exhausted', phase, message);
    }
    if (/\b(?:known folder|LOCALAPPDATA|APPDATA|PROGRAMDATA)\b/iu.test(message)) {
      fail(input.endpointHost, 'desktop-environment-unavailable', phase, message);
    }
    if (/retained command|process[-\s]settlement|treeClosed|streamsDrained/iu.test(message)) {
      fail(input.endpointHost, 'process-settlement-failed', 'process-settlement', message);
    }
    fail(input.endpointHost, failureReason, phase, message);
  }
}

function infoArgs(endpointHost: string): readonly string[] {
  return Object.freeze(['--host', endpointHost, 'info', '--format', '{{json .}}']);
}

/** Pure availability observation: it never starts, stops, repairs, or renames provider state. */
export async function observeDockerDaemonWithCommand(
  input: DockerDaemonObservationInput
): Promise<DockerDaemonCommandResult> {
  const observed = await run(
    input,
    infoArgs(input.endpointHost),
    'observe',
    'endpoint-unavailable',
    'endpoint-observe'
  );
  if (observed.code !== 0) {
    fail(input.endpointHost, 'endpoint-unavailable', 'endpoint-observe', observed.stderr);
  }
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
  const initial = await run(
    input,
    infoArgs(input.endpointHost),
    'observe',
    'endpoint-unavailable',
    'endpoint-observe'
  );
  if (initial.code === 0) return initial;
  if ((input.platform ?? process.platform) !== 'win32'
      || !/^npipe:\/{4}\.\/pipe\/dockerDesktop[A-Za-z0-9_.-]*$/u.test(input.endpointHost)) {
    fail(input.endpointHost, 'endpoint-unavailable', 'endpoint-observe', initial.stderr);
  }
  const settled = await input.withLauncherLock(async () => {
    // The endpoint may have become ready between the initial observation and
    // lock acquisition. Re-observe once, then issue at most one start intent.
    const lockedObservation = await run(
      input,
      infoArgs(input.endpointHost),
      'observe',
      'endpoint-unavailable',
      'endpoint-observe'
    );
    if (lockedObservation.code === 0) return lockedObservation;
    const start = await run(input, Object.freeze([
      'desktop', 'start', '--timeout', String(Math.max(1, Math.floor(remainingMs(input) / 1_000)))
    ]), 'start', 'desktop-start-failed', 'desktop-start');
    const startReason = startFailureReason(start);
    if (start.code !== 0 || startReason === 'desktop-launcher-path-unavailable') {
      fail(
        input.endpointHost,
        startReason,
        'desktop-start',
        `${start.stdout}\n${start.stderr}`
      );
    }
    const finalReadback = await run(
      input,
      infoArgs(input.endpointHost),
      'observe',
      'endpoint-unavailable',
      'final-readback'
    );
    if (finalReadback.code !== 0) {
      fail(
        input.endpointHost,
        'endpoint-unavailable',
        'final-readback',
        finalReadback.stderr
      );
    }
    return finalReadback;
  });
  if (settled === null) fail(input.endpointHost, 'desktop-launcher-busy', 'admission');
  return settled;
}
