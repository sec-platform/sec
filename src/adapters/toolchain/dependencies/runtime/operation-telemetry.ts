import { FailureError } from '../../../../contracts/failure.ts';
import { isNativeAborted } from '../../../../contracts/native-abort.ts';
import {
  runtimeDependencyOperationContext,
  type BoundRuntimeDependencyOperationControls,
  type RuntimeDependencyOperationContext
} from './operation-controls.ts';

export type RuntimeDependencyOperationPhase =
  | 'identity'
  | 'lease-wait'
  | 'recovery'
  | 'source-scan'
  | 'install'
  | 'publication'
  | 'validation'
  | 'cleanup';

type RuntimeDependencyOperationPhaseOutcome =
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
    /** Sum of measured durations only; missing measurements are counted separately. */
    readonly durationMs: number;
    readonly unmeasuredCount: number;
    readonly outcomes: Readonly<Record<RuntimeDependencyOperationPhaseOutcome, number>>;
  }>[];
}

type MutablePhaseTelemetry = {
  count: number;
  durationMs: number;
  unmeasuredCount: number;
  outcomes: Record<RuntimeDependencyOperationPhaseOutcome, number>;
};

const runtimeDependencyOperationTelemetry = new WeakMap<
  object,
  Map<RuntimeDependencyOperationPhase, MutablePhaseTelemetry>
>();

function phaseOutcome(error: unknown, context: RuntimeDependencyOperationContext): RuntimeDependencyOperationPhaseOutcome {
  // Classification is diagnostic. A getter or revoked Proxy on a thrown
  // value must not replace the failure that the action actually produced.
  try {
    if (isNativeAborted(context.signal)) return 'aborted';
    if (error instanceof FailureError && error.code === 'RUNTIME-DEPS-003') {
      const message = error.message;
      if (typeof message === 'string' && message.toLowerCase().includes('deadline')) {
        return 'deadline-exhausted';
      }
    }
    if (error instanceof Error && error.name === 'AbortError') return 'aborted';
  } catch { /* Unclassifiable thrown values remain failures. */ }
  return 'failed';
}

function recordRuntimeDependencyOperationPhase(
  context: RuntimeDependencyOperationContext,
  phase: RuntimeDependencyOperationPhase,
  startedAtMonotonicMs: number,
  outcome: RuntimeDependencyOperationPhaseOutcome
): void {
  let durationMs: number | undefined;
  try {
    const elapsed = context.monotonicNowMs() - startedAtMonotonicMs;
    if (Number.isFinite(elapsed) && elapsed >= 0) durationMs = elapsed;
  } catch { /* Completion timing cannot change an already-produced result. */ }
  let phases = runtimeDependencyOperationTelemetry.get(context.telemetryKey);
  if (phases === undefined) {
    phases = new Map();
    runtimeDependencyOperationTelemetry.set(context.telemetryKey, phases);
  }
  const current = phases.get(phase) ?? {
    count: 0,
    durationMs: 0,
    unmeasuredCount: 0,
    outcomes: {
      completed: 0,
      aborted: 0,
      'deadline-exhausted': 0,
      failed: 0
    }
  };
  current.count += 1;
  if (durationMs === undefined) current.unmeasuredCount += 1;
  else current.durationMs += durationMs;
  current.outcomes[outcome] += 1;
  phases.set(phase, current);
}

export function measureRuntimeDependencyOperationPhase<T>(
  options: BoundRuntimeDependencyOperationControls,
  phase: RuntimeDependencyOperationPhase,
  action: () => T
): T {
  const context = runtimeDependencyOperationContext(options);
  const startedAtMonotonicMs = context.monotonicNowMs();
  let result: T;
  try {
    result = action();
  } catch (error) {
    recordRuntimeDependencyOperationPhase(context, phase, startedAtMonotonicMs, phaseOutcome(error, context));
    throw error;
  }
  recordRuntimeDependencyOperationPhase(context, phase, startedAtMonotonicMs, 'completed');
  return result;
}

export async function measureRuntimeDependencyOperationPhaseAsync<T>(
  options: BoundRuntimeDependencyOperationControls,
  phase: RuntimeDependencyOperationPhase,
  action: () => Promise<T>
): Promise<T> {
  const context = runtimeDependencyOperationContext(options);
  const startedAtMonotonicMs = context.monotonicNowMs();
  let result: T;
  try {
    result = await action();
  } catch (error) {
    recordRuntimeDependencyOperationPhase(context, phase, startedAtMonotonicMs, phaseOutcome(error, context));
    throw error;
  }
  recordRuntimeDependencyOperationPhase(context, phase, startedAtMonotonicMs, 'completed');
  return result;
}

export function readRuntimeDependencyOperationTelemetry(
  options: BoundRuntimeDependencyOperationControls
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
        unmeasuredCount: value.unmeasuredCount,
        outcomes: Object.freeze({ ...value.outcomes })
      })))
  });
}
