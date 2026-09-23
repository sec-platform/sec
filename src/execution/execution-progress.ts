const processStartedAtMonotonicMs = performance.now();
const processStartedAtUnixMs = Date.now();
let progressEnabled = false;
const phaseStarts = new Map<string, number>();

export type ExecutionProgressState = 'start' | 'complete' | 'failed';

/** Activated only by a real CLI entrypoint; imported library tests stay quiet. */
export function enableExecutionProgress(): void {
  progressEnabled = true;
}

export function reportExecutionProgress(input: Readonly<{
  command: string;
  phase: string;
  state: ExecutionProgressState;
  detail?: Readonly<Record<string, unknown>>;
  elapsedMs?: number;
}>): void {
  if (!progressEnabled) return;
  const observedAtMonotonicMs = performance.now();
  const phaseKey = JSON.stringify([input.command, input.phase]);
  let phaseDurationMs: number | undefined;
  if (input.state === 'start') {
    phaseStarts.set(phaseKey, observedAtMonotonicMs);
  } else {
    const startedAt = phaseStarts.get(phaseKey);
    if (startedAt !== undefined) {
      phaseDurationMs = Math.max(0, observedAtMonotonicMs - startedAt);
      phaseStarts.delete(phaseKey);
    }
  }
  const record = Object.freeze({
    schema: 'sec-execution-progress-v1' as const,
    command: input.command,
    phase: input.phase,
    state: input.state,
    startedAt: new Date(processStartedAtUnixMs).toISOString(),
    observedAt: new Date().toISOString(),
    elapsedMs: Math.max(0, input.elapsedMs ?? (observedAtMonotonicMs - processStartedAtMonotonicMs)),
    ...(phaseDurationMs === undefined ? {} : { phaseDurationMs }),
    processId: process.pid,
    ...(input.detail === undefined ? {} : { detail: input.detail })
  });
  process.stderr.write(`[sec-progress] ${JSON.stringify(record)}\n`);
}

/** One bounded phase emits its terminal timing even when the underlying owner throws. */
export async function observeExecutionProgressPhase<T>(
  command: string,
  phase: string,
  run: () => T | Promise<T>
): Promise<T> {
  reportExecutionProgress({ command, phase, state: 'start' });
  try {
    const result = await run();
    reportExecutionProgress({ command, phase, state: 'complete' });
    return result;
  } catch (error) {
    reportExecutionProgress({ command, phase, state: 'failed' });
    throw error;
  }
}
