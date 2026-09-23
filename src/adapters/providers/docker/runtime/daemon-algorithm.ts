import { RetainedCommandTransportError } from '../../../runtime-state/physical/runtime/process.ts';
import { RetainedRuntimeStateDirectoryError } from '../../../runtime-state/physical/runtime/retained-runtime-state-directory.ts';
import {
  assertRuntimeEndpointResidueReceipt,
  assertRuntimeGenerationCensusReceipt,
  type RuntimeEndpointResidueReceipt,
  type RuntimeGenerationCensusReceipt
} from '../../../runtime-state/physical/runtime/runtime-endpoint-residue.ts';
import { WindowsKnownFolderError } from '../../../runtime-state/physical/runtime/windows-known-folders.ts';
import {
  DockerDaemonAvailabilityFailure,
  type DockerDaemonAvailabilityFailurePhase,
  type DockerDaemonAvailabilityFailureReason
} from '../contract/daemon.ts';
import { isDockerDesktopManagedEndpoint } from '../contract/windows-runtime-state.ts';

export interface DockerDaemonCommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

type DockerDaemonCommand = (input: Readonly<{
  args: readonly string[];
  cwd: string;
  deadlineAtUnixMs: number;
  lifecycle: 'observe' | 'start';
}>) => Promise<DockerDaemonCommandResult>;

type DockerDaemonLauncher = (input: Readonly<{
  readonly args: readonly string[];
  readonly deadlineAtUnixMs: number;
}>) => Promise<DockerDaemonLauncherResult>;

export type DockerDaemonLauncherResult = DockerDaemonCommandResult & Readonly<{
  readonly physicalDisposition: 'settled' | 'unknown';
  readonly transportFailure?: RetainedCommandTransportError;
  readonly transportFailureStatus?: RetainedCommandTransportError['outcome']['status'];
}>;

/**
 * Preserves every started retained-command failure for the domain's mandatory
 * final endpoint readback. Physical settlement proves only resource closure;
 * it never erases the transport or identity failure.
 */
export function projectStartedDockerDaemonLauncherFailure(
  error: RetainedCommandTransportError
): DockerDaemonLauncherResult {
  if (!error.outcome.started) throw error;
  return Object.freeze({
    code: error.outcome.exitCode ?? 1,
    stdout: '',
    stderr: error.message,
    physicalDisposition: error.outcome.termination.treeClosed
      && error.outcome.termination.streamsDrained
      ? 'settled'
      : 'unknown',
    transportFailure: error,
    transportFailureStatus: error.outcome.status
  });
}

export interface DockerDaemonObservationInput {
  readonly commandDeadlineAtUnixMs: () => number;
  readonly cwd: string;
  readonly deadlineAtUnixMs: number;
  readonly endpointHost: string;
  readonly observeRuntimeEndpointResidue?: (
    providerEvidence: string
  ) => RuntimeEndpointResidueReceipt | null;
  readonly run: DockerDaemonCommand;
}

/**
 * Runs one operation while holding the launcher identity selected by the
 * physical owner. A null result means the exact launcher is already owned;
 * callers must not poll or start another launcher.
 */
type DockerDaemonLauncherLock = <T>(operation: () => Promise<T>) => Promise<T | null>;

export interface DockerDaemonEnsureStartedInput extends DockerDaemonObservationInput {
  readonly beforeLaunch?: () => Promise<void> | void;
  readonly censusRuntimeGenerations: () => RuntimeGenerationCensusReceipt;
  readonly platform?: NodeJS.Platform;
  readonly providerAuthorityIdentityDigest: `sha256:${string}`;
  readonly providerIdentityDigest: `sha256:${string}`;
  readonly launch: DockerDaemonLauncher;
  readonly observeLaunchSettlement?: (
    result: Awaited<ReturnType<DockerDaemonLauncher>>
  ) => Promise<void> | void;
  readonly withLauncherLock: DockerDaemonLauncherLock;
}

function fail(
  endpointHost: string,
  reason: DockerDaemonAvailabilityFailureReason,
  phase: DockerDaemonAvailabilityFailurePhase,
  providerEvidence = '',
  cause?: unknown
): never {
  throw new DockerDaemonAvailabilityFailure({
    endpointHost,
    reason,
    phase,
    providerEvidence
  }, cause === undefined ? undefined : { cause });
}

function originalFailure(error: unknown): unknown {
  return error instanceof Error && error.cause !== undefined ? error.cause : error;
}

function combinedFailureCause(failures: readonly unknown[]): unknown {
  if (failures.length === 0) return undefined;
  if (failures.length === 1) return failures[0];
  return new AggregateError(failures, 'Docker Desktop startup produced multiple failures.');
}

function remainingMs(input: DockerDaemonObservationInput): number {
  const remaining = input.deadlineAtUnixMs - Date.now();
  if (!Number.isSafeInteger(input.deadlineAtUnixMs) || remaining < 1) {
    fail(input.endpointHost, 'deadline-exhausted', 'admission');
  }
  return remaining;
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
    if (Date.now() >= input.deadlineAtUnixMs) {
      fail(input.endpointHost, 'deadline-exhausted', phase, message, error);
    }
    if (error instanceof WindowsKnownFolderError
        || error instanceof RetainedRuntimeStateDirectoryError) {
      fail(input.endpointHost, 'desktop-environment-unavailable', phase, message, error);
    }
    if (error instanceof RetainedCommandTransportError) {
      if (error.outcome.status === 'timed-out' || error.outcome.status === 'aborted') {
        fail(input.endpointHost, 'deadline-exhausted', phase, message, error);
      }
      fail(input.endpointHost, 'process-settlement-failed', 'process-settlement', message, error);
    }
    fail(input.endpointHost, failureReason, phase, message, error);
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
      || !isDockerDesktopManagedEndpoint(input.endpointHost)) {
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
    let census: RuntimeGenerationCensusReceipt;
    try {
      census = input.censusRuntimeGenerations();
    } catch (error) {
      if (error instanceof DockerDaemonAvailabilityFailure) throw error;
      fail(
        input.endpointHost,
        'desktop-environment-unavailable',
        'admission',
        error instanceof Error ? error.message : String(error)
      );
    }
    assertRuntimeGenerationCensusReceipt(census);
    if (census.providerIdentityDigest !== input.providerAuthorityIdentityDigest) {
      fail(input.endpointHost, 'desktop-environment-unavailable', 'admission');
    }
    const censusEvidence = census.entries.map(({ id, state }) => `${id}:${state}`).join('\n');
    if (census.entries.some(({ state }) => state === 'unknown')) {
      fail(input.endpointHost, 'desktop-environment-unavailable', 'admission', censusEvidence);
    }
    let start: Awaited<ReturnType<DockerDaemonLauncher>>;
    try {
      remainingMs(input);
      await input.beforeLaunch?.();
      const commandDeadlineAtUnixMs = Math.min(
        input.deadlineAtUnixMs,
        input.commandDeadlineAtUnixMs()
      );
      const commandRemainingMs = commandDeadlineAtUnixMs - Date.now();
      if (!Number.isSafeInteger(commandRemainingMs) || commandRemainingMs < 1) {
        fail(input.endpointHost, 'deadline-exhausted', 'desktop-start');
      }
      const timeoutSeconds = Math.floor(commandRemainingMs / 1_000);
      if (timeoutSeconds < 1) {
        fail(input.endpointHost, 'deadline-exhausted', 'desktop-start');
      }
      start = await input.launch({
        args: Object.freeze([
          'desktop', 'start', '--timeout', String(timeoutSeconds)
        ]),
        deadlineAtUnixMs: commandDeadlineAtUnixMs
      });
    } catch (error) {
      if (error instanceof DockerDaemonAvailabilityFailure) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (Date.now() >= input.deadlineAtUnixMs) {
        fail(input.endpointHost, 'deadline-exhausted', 'desktop-start', message);
      }
      fail(input.endpointHost, 'desktop-start-failed', 'desktop-start', message);
    }
    let observerFailed = false;
    let observerFailure: unknown;
    try {
      await input.observeLaunchSettlement?.(start);
    } catch (error) {
      observerFailed = true;
      observerFailure = error;
    }
    const providerEvidence = `${start.stdout}\n${start.stderr}`;
    let finalReadback: DockerDaemonCommandResult | undefined;
    let finalReadbackFailed = false;
    let finalReadbackFailure: unknown;
    try {
      finalReadback = await run(
        input,
        infoArgs(input.endpointHost),
        'observe',
        'endpoint-unavailable',
        'final-readback'
      );
    } catch (error) {
      finalReadbackFailed = true;
      finalReadbackFailure = error;
    }
    const readbackEvidence = finalReadback === undefined
      ? finalReadbackFailure instanceof Error
        ? finalReadbackFailure.message
        : String(finalReadbackFailure)
      : finalReadback.stderr;
    const precedingFailures = (): unknown[] => [
      ...(start.transportFailure === undefined ? [] : [start.transportFailure]),
      ...(observerFailed ? [observerFailure] : []),
      ...(finalReadbackFailed ? [originalFailure(finalReadbackFailure)] : [])
    ];
    if (start.physicalDisposition === 'unknown') {
      fail(
        input.endpointHost,
        'desktop-launcher-settlement-unknown',
        'final-readback',
        `${providerEvidence}\n${readbackEvidence}`,
        combinedFailureCause(precedingFailures())
      );
    }
    if (start.transportFailure !== undefined) {
      fail(
        input.endpointHost,
        'process-settlement-failed',
        'process-settlement',
        `${providerEvidence}\n${readbackEvidence}`,
        combinedFailureCause(precedingFailures())
      );
    }
    if (observerFailed) {
      fail(
        input.endpointHost,
        'process-settlement-failed',
        'process-settlement',
        `${providerEvidence}\n${readbackEvidence}`,
        combinedFailureCause(precedingFailures())
      );
    }
    if (finalReadbackFailed) throw finalReadbackFailure;
    if (finalReadback === undefined) {
      throw new Error('Docker daemon final readback did not produce a result.');
    }
    if (finalReadback.code !== 0) {
      let residue: RuntimeEndpointResidueReceipt | null;
      try {
        residue = input.observeRuntimeEndpointResidue?.(providerEvidence) ?? null;
        if (residue !== null) {
          assertRuntimeEndpointResidueReceipt(residue);
          if (residue.providerIdentityDigest !== input.providerIdentityDigest) {
            fail(input.endpointHost, 'desktop-environment-unavailable', 'final-readback');
          }
        }
      } catch (error) {
        if (error instanceof DockerDaemonAvailabilityFailure) throw error;
        fail(
          input.endpointHost,
          'desktop-environment-unavailable',
          'final-readback',
          error instanceof Error ? error.message : String(error)
        );
      }
      fail(
        input.endpointHost,
        residue !== null
            ? 'runtime-endpoint-residue'
            : start.code !== 0
              ? 'desktop-start-failed'
          : 'endpoint-unavailable',
        'final-readback',
        residue !== null || start.code !== 0
          ? `${providerEvidence}\n${finalReadback.stderr}`
          : finalReadback.stderr
      );
    }
    return finalReadback;
  });
  if (settled === null) fail(input.endpointHost, 'desktop-launcher-busy', 'admission');
  return settled;
}
