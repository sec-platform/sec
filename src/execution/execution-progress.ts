const processStartedAtMonotonicMs = performance.now();
const processStartedAtUnixMs = Date.now();
let progressEnabled = false;
const phaseStarts = new Map<string, Readonly<{ command: string; phase: string; at: number }>>();

export type ExecutionProgressState = 'start' | 'running' | 'complete' | 'failed';
const PROGRESS_HEARTBEAT_INTERVAL_MS = 10_000;

/** Activated only by a real CLI entrypoint; imported library tests stay quiet. */
export function enableExecutionProgress(): void {
  if (progressEnabled) return;
  progressEnabled = true;
  const heartbeat = setInterval(() => {
    for (const { command, phase } of phaseStarts.values()) {
      try {
        reportExecutionProgress({ command, phase, state: 'running' });
      } catch {
        // Progress is a diagnostic projection, never an execution prerequisite.
      }
    }
  }, PROGRESS_HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();
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
    phaseStarts.set(phaseKey, { command: input.command, phase: input.phase, at: observedAtMonotonicMs });
  } else {
    const startedAt = phaseStarts.get(phaseKey);
    if (startedAt !== undefined) {
      phaseDurationMs = Math.max(0, observedAtMonotonicMs - startedAt.at);
      if (input.state !== 'running') phaseStarts.delete(phaseKey);
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
