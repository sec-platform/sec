import { SecError } from '../../../system-architecture/foundation/contract/failure.ts';
import {
  runtimeDependencyOperationContext,
  type RuntimeDependencyOperationOptions
} from './operation-context.ts';

export type RuntimeDependencyOperationPhase =
  | 'identity'
  | 'lease-wait'
  | 'recovery'
  | 'source-scan'
  | 'install'
  | 'publication'
  | 'validation'
  | 'cleanup';

export type RuntimeDependencyOperationPhaseOutcome =
  | 'completed'
  | 'aborted'
  | 'deadline-exhausted'
  | 'failed';

export interface RuntimeDependencyOperationTelemetry {
  readonly authority: 'none-diagnostic-only';
  readonly operationId: string;
  readonly deadlineAtUnixMs: number;
  readonly initialBudgetMs: number;
  readonly phases: readonly Readonly<{
    readonly phase: RuntimeDependencyOperationPhase;
    readonly count: number;
    readonly durationMs: number;
    readonly outcomes: Readonly<Record<RuntimeDependencyOperationPhaseOutcome, number>>;
  }>[];
}

type MutablePhaseTelemetry = {
  count: number;
  durationMs: number;
  outcomes: Record<RuntimeDependencyOperationPhaseOutcome, number>;
};

const runtimeDependencyOperationTelemetry = new WeakMap<
  object,
  Map<RuntimeDependencyOperationPhase, MutablePhaseTelemetry>
>();

function phaseOutcome(error: unknown, signalAborted: boolean): RuntimeDependencyOperationPhaseOutcome {
  if (signalAborted) return 'aborted';
  if (error instanceof SecError && error.code === 'RUNTIME-DEPS-003' &&
      error.message.toLocaleLowerCase('en-US').includes('deadline')) {
    return 'deadline-exhausted';
  }
  if (error instanceof Error && error.name === 'AbortError') return 'aborted';
  return 'failed';
}

function recordRuntimeDependencyOperationPhase(
  options: RuntimeDependencyOperationOptions,
  phase: RuntimeDependencyOperationPhase,
  startedAtMonotonicMs: number,
  outcome: RuntimeDependencyOperationPhaseOutcome
): void {
  const context = runtimeDependencyOperationContext(options);
  const completedAtMonotonicMs = context.monotonicNowMs();
  const durationMs = Math.max(0, completedAtMonotonicMs - startedAtMonotonicMs);
  let phases = runtimeDependencyOperationTelemetry.get(context.telemetryKey);
  if (phases === undefined) {
    phases = new Map();
    runtimeDependencyOperationTelemetry.set(context.telemetryKey, phases);
  }
  const current = phases.get(phase) ?? {
    count: 0,
    durationMs: 0,
    outcomes: {
      completed: 0,
      aborted: 0,
      'deadline-exhausted': 0,
      failed: 0
    }
  };
  current.count += 1;
  current.durationMs += durationMs;
  current.outcomes[outcome] += 1;
  phases.set(phase, current);
}

export function measureRuntimeDependencyOperationPhase<T>(
  options: RuntimeDependencyOperationOptions,
  phase: RuntimeDependencyOperationPhase,
  action: () => T
): T {
  const startedAtMonotonicMs = runtimeDependencyOperationContext(options).monotonicNowMs();
  try {
    const result = action();
    recordRuntimeDependencyOperationPhase(options, phase, startedAtMonotonicMs, 'completed');
    return result;
  } catch (error) {
    recordRuntimeDependencyOperationPhase(
      options,
      phase,
      startedAtMonotonicMs,
      phaseOutcome(error, runtimeDependencyOperationContext(options).signal?.aborted === true)
    );
    throw error;
  }
}

export async function measureRuntimeDependencyOperationPhaseAsync<T>(
  options: RuntimeDependencyOperationOptions,
  phase: RuntimeDependencyOperationPhase,
  action: () => Promise<T>
): Promise<T> {
  const startedAtMonotonicMs = runtimeDependencyOperationContext(options).monotonicNowMs();
  try {
    const result = await action();
    recordRuntimeDependencyOperationPhase(options, phase, startedAtMonotonicMs, 'completed');
    return result;
  } catch (error) {
    recordRuntimeDependencyOperationPhase(
      options,
      phase,
      startedAtMonotonicMs,
      phaseOutcome(error, runtimeDependencyOperationContext(options).signal?.aborted === true)
    );
    throw error;
  }
}

export function readRuntimeDependencyOperationTelemetry(
  options: RuntimeDependencyOperationOptions
): RuntimeDependencyOperationTelemetry {
  const context = runtimeDependencyOperationContext(options);
  const phases = runtimeDependencyOperationTelemetry.get(context.telemetryKey) ?? new Map();
  return Object.freeze({
    authority: 'none-diagnostic-only' as const,
    operationId: context.operationId,
    deadlineAtUnixMs: context.deadlineAtUnixMs,
    initialBudgetMs: context.initialBudgetMs,
    phases: Object.freeze([...phases.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([phase, value]) => Object.freeze({
        phase,
        count: value.count,
        durationMs: value.durationMs,
        outcomes: Object.freeze({ ...value.outcomes })
      })))
  });
}
