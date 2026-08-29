import { compilerRoot } from '../../workspace/paths.ts';
import { runObservedCommand, type ObservedCommandOutcome } from '../../runtime-state/physical/runtime/observed-process.ts';
import { DEFAULT_FAST_TEST_MAX_CONCURRENCY } from './fast-test-policy.ts';
import { applyDefaultFastTestConcurrency } from './test-concurrency-policy.ts';

export const DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES = 8 * 1024;

export function boundedUtf8TextTail(
  value: string | Uint8Array,
  maximumBytes: number
): string {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new Error('UTF-8 text tail maximum must be a non-negative safe integer.');
  }
  if (maximumBytes === 0) return '';

  const normalized = typeof value === 'string'
    ? Buffer.from(value, 'utf8').toString('utf8')
    : (() => {
        const bytes = Buffer.from(value);
        let firstCodePointBoundary = 0;
        while (
          firstCodePointBoundary < bytes.byteLength &&
          (bytes[firstCodePointBoundary] & 0xc0) === 0x80
        ) {
          firstCodePointBoundary += 1;
        }
        return bytes.subarray(firstCodePointBoundary).toString('utf8');
      })();
  if (Buffer.byteLength(normalized, 'utf8') <= maximumBytes) return normalized;

  let retainedBytes = 0;
  let retainedStart = normalized.length;
  while (retainedStart > 0) {
    let characterStart = retainedStart - 1;
    const finalCodeUnit = normalized.charCodeAt(characterStart);
    if (
      finalCodeUnit >= 0xdc00 &&
      finalCodeUnit <= 0xdfff &&
      characterStart > 0
    ) {
      const precedingCodeUnit = normalized.charCodeAt(characterStart - 1);
      if (precedingCodeUnit >= 0xd800 && precedingCodeUnit <= 0xdbff) {
        characterStart -= 1;
      }
    }

    const characterBytes = Buffer.byteLength(
      normalized.slice(characterStart, retainedStart),
      'utf8'
    );
    if (retainedBytes + characterBytes > maximumBytes) break;
    retainedBytes += characterBytes;
    retainedStart = characterStart;
  }
  return normalized.slice(retainedStart);
}

export type DevCommandTerminalOutcome =
  | { readonly kind: 'exited'; readonly exitCode: number }
  | { readonly kind: 'signaled'; readonly signal: NodeJS.Signals }
  | { readonly kind: 'spawn-failed'; readonly error: string }
  | {
      readonly kind: 'unresolved';
      readonly reason: 'close-without-status' | 'contradictory-close-status';
    };

export type DevCommandObservationIntegrity =
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

export interface ObserveDevCommandOptions {
  readonly observe: true;
}

type DevCommandResult<TOptions extends ObserveDevCommandOptions | undefined> =
  TOptions extends ObserveDevCommandOptions ? DevCommandObservation : number;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function appendOutputTail(current: Buffer<ArrayBufferLike>, chunk: unknown): Buffer<ArrayBufferLike> {
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
  if (bytes.byteLength >= DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES) {
    return Buffer.from(bytes.subarray(bytes.byteLength - DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES));
  }
  const retainedCurrent = current.subarray(Math.max(
    0,
    current.byteLength + bytes.byteLength - DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES
  ));
  return Buffer.concat([retainedCurrent, bytes]);
}

const DEV_COMMAND_FORWARD_OUTPUT_MAX_BYTES = Number.MAX_SAFE_INTEGER;

function physicalOutcomeTerminal(outcome: ObservedCommandOutcome): DevCommandTerminalOutcome {
  if (outcome.status === 'spawn-failed') {
    return { kind: 'spawn-failed', error: 'canonical observed command transport failed to spawn' };
  }
  if (outcome.exitCode !== null && outcome.signal !== null) {
    return { kind: 'unresolved', reason: 'contradictory-close-status' };
  }
  if (outcome.signal !== null) {
    return { kind: 'signaled', signal: outcome.signal };
  }
  if (outcome.exitCode !== null) {
    return { kind: 'exited', exitCode: outcome.exitCode };
  }
  return {
    kind: 'unresolved',
    reason: outcome.exitCode === null && outcome.signal === null
      ? 'close-without-status'
      : 'contradictory-close-status'
  };
}

function physicalOutcomeFailure(outcome: ObservedCommandOutcome): string | null {
  return outcome.status === 'exited'
    ? null
    : `canonical observed command transport ended with ${outcome.status}`;
}

export function devCommandObservationExitCode(observation: DevCommandObservation): number {
  if (observation.observationIntegrity.kind === 'failed') return 1;
  return observation.terminal.kind === 'exited' ? observation.terminal.exitCode : 1;
}

export function runDevCommand<TOptions extends ObserveDevCommandOptions | undefined = undefined>(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  options?: TOptions
): Promise<DevCommandResult<TOptions>> {
  const observed = options?.observe === true;
  const effectiveArgs = applyDefaultFastTestConcurrency(
    command,
    args,
    DEFAULT_FAST_TEST_MAX_CONCURRENCY
  );
  const effectiveArgv = Object.freeze([command, ...effectiveArgs]);
  let stdoutTail: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let stderrTail: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let observationIntegrityError: string | null = null;

  const execute = async (): Promise<number | DevCommandObservation> => {
    let outcome: ObservedCommandOutcome;
    try {
      outcome = await runObservedCommand(command, effectiveArgs, {
        cwd: compilerRoot,
        env,
        stdio: observed ? (['inherit', 'pipe', 'pipe'] as const) : 'inherit',
        ...(observed
          ? {
              // The public DevCommand contract forwards the complete live
              // stream while retaining only bounded tails. The canonical
              // process owner performs the physical lifecycle accounting;
              // this observer remains bounded by appendOutputTail.
              maxObservedOutputBytes: DEV_COMMAND_FORWARD_OUTPUT_MAX_BYTES,
              onOutput: (stream: 'stdout' | 'stderr', chunk: Uint8Array): void => {
                if (stream === 'stdout') stdoutTail = appendOutputTail(stdoutTail, chunk);
                else stderrTail = appendOutputTail(stderrTail, chunk);
                try {
                  (stream === 'stdout' ? process.stdout : process.stderr).write(chunk);
                } catch (error) {
                  observationIntegrityError ??= `${stream} forwarding failed: ${errorMessage(error)}`;
                }
              }
            }
          : {})
      });
    } catch (error) {
      if (!observed) throw error;
      outcome = Object.freeze({
        status: 'spawn-failed' as const,
        started: false,
        exitCode: null,
        signal: null,
        durationMs: 0,
        stdout: Object.freeze({ bytes: 0, digest: 'sha256:' as const, observerTruncated: false }),
        stderr: Object.freeze({ bytes: 0, digest: 'sha256:' as const, observerTruncated: false }),
        termination: Object.freeze({
          requested: false,
          gracefulAttempted: false,
          forcedAttempted: false,
          childCloseObserved: false,
          streamsDrained: true,
          treeClosed: true
        })
      });
      observationIntegrityError ??= errorMessage(error);
    }

    if (!observed) {
      if (outcome.status === 'spawn-failed') {
        throw new Error(`Command "${command}" failed to spawn through the canonical process owner.`);
      }
      return outcome.status === 'exited' ? outcome.exitCode ?? 1 : 1;
    }

    const physicalFailure = physicalOutcomeFailure(outcome);
    const integrityError = observationIntegrityError ?? physicalFailure;
    return Object.freeze({
      schema: 'sec-dev-command-observation-v1' as const,
      effectiveArgv,
      terminal: Object.freeze(physicalOutcomeTerminal(outcome)),
      observationIntegrity: Object.freeze(integrityError === null
        ? { kind: 'complete' as const }
        : { kind: 'failed' as const, error: integrityError }),
      durationMs: Math.max(0, outcome.durationMs),
      stdoutTail: boundedUtf8TextTail(stdoutTail, DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES),
      stderrTail: boundedUtf8TextTail(stderrTail, DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES)
    });
  };

  return execute() as Promise<DevCommandResult<TOptions>>;
}
