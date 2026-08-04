import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { compilerRoot } from '../shared/paths.ts';
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

function appendOutputTail(current: Buffer, chunk: unknown): Buffer {
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
  const execution = new Promise<number | DevCommandObservation>((resolve, reject) => {
    const observed = options?.observe === true;
    const startedAt = Date.now();
    const effectiveArgs = applyDefaultFastTestConcurrency(
      command,
      args,
      DEFAULT_FAST_TEST_MAX_CONCURRENCY
    );
    const effectiveArgv = Object.freeze([command, ...effectiveArgs]);
    let stdoutTail: Buffer = Buffer.alloc(0);
    let stderrTail: Buffer = Buffer.alloc(0);
    let observationIntegrityError: string | null = null;
    let settled = false;

    const observedOutcome = (terminal: DevCommandTerminalOutcome): DevCommandObservation => Object.freeze({
      schema: 'sec-dev-command-observation-v1',
      effectiveArgv,
      terminal: Object.freeze(terminal),
      observationIntegrity: Object.freeze(observationIntegrityError === null
        ? { kind: 'complete' as const }
        : { kind: 'failed' as const, error: observationIntegrityError }),
      durationMs: Math.max(0, Date.now() - startedAt),
      stdoutTail: boundedUtf8TextTail(stdoutTail, DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES),
      stderrTail: boundedUtf8TextTail(stderrTail, DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES)
    });

    const finalize = (terminal: DevCommandTerminalOutcome, legacyError?: unknown): void => {
      if (settled) return;
      settled = true;
      if (observed) {
        resolve(observedOutcome(terminal));
        return;
      }
      if (terminal.kind === 'spawn-failed') {
        reject(legacyError ?? new Error(terminal.error));
        return;
      }
      resolve(terminal.kind === 'exited' ? terminal.exitCode : 1);
    };

    let child: ChildProcess;
    try {
      child = spawn(command, effectiveArgs, {
        cwd: compilerRoot,
        env: Object.fromEntries(
          Object.entries({
            ...process.env,
            ...env
          }).filter(([, value]) => value !== undefined)
        ) as NodeJS.ProcessEnv,
        shell: false,
        stdio: observed ? (['inherit', 'pipe', 'pipe'] as const) : 'inherit'
      });
    } catch (error) {
      finalize({ kind: 'spawn-failed', error: errorMessage(error) }, error);
      return;
    }

    if (observed) {
      const observeChunk = (stream: 'stdout' | 'stderr', chunk: unknown): void => {
        if (stream === 'stdout') stdoutTail = appendOutputTail(stdoutTail, chunk);
        else stderrTail = appendOutputTail(stderrTail, chunk);
        try {
          (stream === 'stdout' ? process.stdout : process.stderr).write(chunk as Uint8Array);
        } catch (error) {
          observationIntegrityError ??= `${stream} forwarding failed: ${errorMessage(error)}`;
        }
      };
      child.stdout?.on('data', (chunk) => observeChunk('stdout', chunk));
      child.stderr?.on('data', (chunk) => observeChunk('stderr', chunk));
      child.stdout?.on('error', (error) => {
        observationIntegrityError ??= `stdout observation failed: ${errorMessage(error)}`;
      });
      child.stderr?.on('error', (error) => {
        observationIntegrityError ??= `stderr observation failed: ${errorMessage(error)}`;
      });
    }

    child.on('error', (error) => {
      finalize({ kind: 'spawn-failed', error: errorMessage(error) }, error);
    });
    child.on('close', (code, signal) => {
      if (code !== null && signal === null) {
        finalize({ kind: 'exited', exitCode: code });
        return;
      }
      if (code === null && signal !== null) {
        finalize({ kind: 'signaled', signal });
        return;
      }
      finalize({
        kind: 'unresolved',
        reason: code === null ? 'close-without-status' : 'contradictory-close-status'
      });
    });
  });
  return execution as Promise<DevCommandResult<TOptions>>;
}
