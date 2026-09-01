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

export type DockerDaemonCommand = (input: Readonly<{
  args: readonly string[];
  cwd: string;
  deadlineAtUnixMs: number;
  lifecycle: 'observe' | 'start';
}>) => Promise<DockerDaemonCommandResult>;

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
export type DockerDaemonLauncherLock = <T>(operation: () => Promise<T>) => Promise<T | null>;

export interface DockerDaemonEnsureStartedInput extends DockerDaemonObservationInput {
  readonly censusRuntimeGenerations: () => RuntimeGenerationCensusReceipt;
  readonly platform?: NodeJS.Platform;
  readonly providerAuthorityIdentityDigest: `sha256:${string}`;
  readonly providerIdentityDigest: `sha256:${string}`;
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
      fail(input.endpointHost, 'deadline-exhausted', phase, message);
    }
    if (error instanceof WindowsKnownFolderError
        || error instanceof RetainedRuntimeStateDirectoryError) {
      fail(input.endpointHost, 'desktop-environment-unavailable', phase, message);
    }
    if (error instanceof RetainedCommandTransportError) {
      if (error.outcome.status === 'timed-out' || error.outcome.status === 'aborted') {
        fail(input.endpointHost, 'deadline-exhausted', phase, message);
      }
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
    if (census.entries.some(({ state }) => (
      state === 'stale-residue' || state === 'inaccessible-residue'
    ))) {
      fail(input.endpointHost, 'runtime-endpoint-residue', 'desktop-start', censusEvidence);
    }
    if (census.entries.some(({ state }) => state === 'unknown')) {
      fail(input.endpointHost, 'desktop-environment-unavailable', 'admission', censusEvidence);
    }
    const commandRemainingMs = Math.min(
      remainingMs(input),
      input.commandDeadlineAtUnixMs() - Date.now()
    );
    if (!Number.isSafeInteger(commandRemainingMs) || commandRemainingMs < 1) {
      fail(input.endpointHost, 'deadline-exhausted', 'desktop-start');
    }
    const start = await run(input, Object.freeze([
      'desktop', 'start', '--timeout', String(Math.max(1, Math.floor(commandRemainingMs / 1_000)))
    ]), 'start', 'desktop-start-failed', 'desktop-start');
    const providerEvidence = `${start.stdout}\n${start.stderr}`;
    let residue: RuntimeEndpointResidueReceipt | null;
    try {
      residue = input.observeRuntimeEndpointResidue?.(providerEvidence) ?? null;
    } catch (error) {
      fail(
        input.endpointHost,
        'desktop-environment-unavailable',
        'admission',
        error instanceof Error ? error.message : String(error)
      );
    }
    if (residue !== null) {
      assertRuntimeEndpointResidueReceipt(residue);
      if (residue.providerIdentityDigest !== input.providerIdentityDigest) {
        fail(input.endpointHost, 'desktop-environment-unavailable', 'admission');
      }
      fail(
        input.endpointHost,
        'runtime-endpoint-residue',
        'desktop-start',
        providerEvidence
      );
    }
    if (start.code !== 0) {
      fail(input.endpointHost, 'desktop-start-failed', 'desktop-start', providerEvidence);
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
