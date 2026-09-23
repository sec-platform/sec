export type DevCommandTerminalOutcome =
  | { readonly kind: 'exited'; readonly exitCode: number }
  | { readonly kind: 'signaled'; readonly signal: NodeJS.Signals }
  | { readonly kind: 'spawn-failed'; readonly error: string }
  | { readonly kind: 'unresolved'; readonly reason: 'close-without-status' | 'contradictory-close-status' };

type DevCommandObservationIntegrity =
  | { readonly kind: 'complete' }
  | { readonly kind: 'failed'; readonly error: string };

export interface DevCommandObservation {
  readonly schema: 'sec-dev-command-observation-v1';
  readonly effectiveArgv: readonly string[];
  readonly terminal: DevCommandTerminalOutcome;
  readonly observationIntegrity: DevCommandObservationIntegrity;
  readonly durationMs: number;
  readonly stdoutTail: string;
  readonly stderrTail: string;
}

/** An integer completion value is required; only zero means success. Do not
 * coerce undefined/null/booleans/strings into a successful process exit status.
 * Negative nonzero owner failure codes remain failures, not a new errno policy.
 */
export function requireCommandExitCode(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`${label} did not return an integer exit code`);
  }
  return value;
}

export function devCommandObservationExitCode(observation: DevCommandObservation): number {
  if (observation.observationIntegrity.kind !== 'complete') return 1;
  return observation.terminal.kind === 'exited'
    ? requireCommandExitCode(observation.terminal.exitCode, 'Dev command observation') : 1;
}
