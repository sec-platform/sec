export type SourceProgramCompilationPhase =
  | 'admission'
  | 'cache-read'
  | 'program-materialization'
  | 'required-api-closure'
  | 'file-semantics'
  | 'declaration-index'
  | 'return-provenance'
  | 'semantic-observations'
  | 'fact-shard-assembly'
  | 'test-observations'
  | 'baseline-test-evidence'
  | 'test-value'
  | 'owner-intent'
  | 'supersession-evidence'
  | 'supersession-receipt'
  | 'test-retirement'
  | 'reduction-plan'
  | 'repository-projection'
  | 'cache-publish'
  | 'settlement';

/** Canonical ceiling for one physical repository compilation, including cache publication. */
export const SOURCE_PROGRAM_COMPILATION_MAX_DURATION_MS = 300_000;

export type SourceProgramCompilationPhaseEvent = Readonly<{
  phase: SourceProgramCompilationPhase;
  state: 'start' | 'complete';
  elapsedMs: number;
}>;

const sourceProgramCompilationOperationBrand: unique symbol = Symbol(
  'source-program-compilation-operation'
);

export type SourceProgramCompilationOperation = Readonly<{
  readonly [sourceProgramCompilationOperationBrand]: true;
  readonly deadlineAtUnixMs: number;
}>;

type SourceProgramCompilationOperationState = {
  readonly deadlineAtMonotonicMs: number;
  readonly signal: AbortSignal | null;
  readonly startedAtMonotonicMs: number;
  readonly events: SourceProgramCompilationPhaseEvent[];
  readonly observePhase: ((event: SourceProgramCompilationPhaseEvent) => void) | null;
};

const sourceProgramCompilationOperationStates = new WeakMap<
  object,
  SourceProgramCompilationOperationState
>();

export interface SourceProgramCompilationControl {
  readonly deadlineAtUnixMs: number;
  readonly observePhase?: (event: SourceProgramCompilationPhaseEvent) => void;
  readonly signal?: AbortSignal;
}

export class SourceProgramCompilationInterruptedError extends Error {
  readonly code: 'source-program-compilation-cancelled' | 'source-program-compilation-deadline-exhausted';
  readonly phase: SourceProgramCompilationPhase;
  readonly phaseEvents: readonly SourceProgramCompilationPhaseEvent[];

  constructor(
    code: SourceProgramCompilationInterruptedError['code'],
    phase: SourceProgramCompilationPhase,
    phaseEvents: readonly SourceProgramCompilationPhaseEvent[]
  ) {
    super(`${code}:${phase}`);
    this.name = 'SourceProgramCompilationInterruptedError';
    this.code = code;
    this.phase = phase;
    this.phaseEvents = Object.freeze([...phaseEvents]);
  }
}

function issueSourceProgramCompilationOperation(
  control: SourceProgramCompilationControl | null
): SourceProgramCompilationOperation {
  // Omission selects this owner's finite ceiling, never an unbounded route.
  // Read caller fields once; callbacks cannot extend the admitted operation.
  const requestedDeadline = control?.deadlineAtUnixMs;
  const signal = control?.signal ?? null;
  const observePhase = control?.observePhase ?? null;
  if (control !== null && (!Number.isSafeInteger(requestedDeadline)
      || requestedDeadline! <= 0)) {
    throw new Error('Source Program compilation deadline must be a positive safe Unix timestamp');
  }
  const startedAtUnixMs = Date.now();
  const startedAtMonotonicMs = performance.now();
  const deadlineAtUnixMs = Math.min(
    requestedDeadline ?? Number.MAX_SAFE_INTEGER,
    startedAtUnixMs + SOURCE_PROGRAM_COMPILATION_MAX_DURATION_MS
  );
  const operation = Object.freeze({
    [sourceProgramCompilationOperationBrand]: true as const,
    deadlineAtUnixMs
  });
  sourceProgramCompilationOperationStates.set(operation, {
    deadlineAtMonotonicMs: startedAtMonotonicMs + Math.max(0, deadlineAtUnixMs - startedAtUnixMs),
    signal,
    startedAtMonotonicMs,
    events: [],
    observePhase
  });
  return operation;
}

/** Issue one bounded operation; callers cannot forge or reset its deadline. */
export function createSourceProgramCompilationOperation(
  control: SourceProgramCompilationControl
): SourceProgramCompilationOperation {
  return issueSourceProgramCompilationOperation(control);
}

function sourceProgramCompilationOperationState(
  operation: SourceProgramCompilationOperation
): SourceProgramCompilationOperationState {
  const state = sourceProgramCompilationOperationStates.get(operation);
  if (state === undefined) {
    throw new Error('Source Program compilation operation is not owner-issued');
  }
  return state;
}

export function sourceProgramCompilationCheckpoint(
  operation: SourceProgramCompilationOperation,
  phase: SourceProgramCompilationPhase,
  state?: SourceProgramCompilationPhaseEvent['state']
): void {
  const operationState = sourceProgramCompilationOperationState(operation);
  const now = performance.now();
  if (operationState.signal?.aborted === true) {
    throw new SourceProgramCompilationInterruptedError(
      'source-program-compilation-cancelled',
      phase,
      operationState.events
    );
  }
  if (now >= operationState.deadlineAtMonotonicMs) {
    throw new SourceProgramCompilationInterruptedError(
      'source-program-compilation-deadline-exhausted',
      phase,
      operationState.events
    );
  }
  if (state !== undefined) {
    const event = Object.freeze({
      phase,
      state,
      elapsedMs: now - operationState.startedAtMonotonicMs
    });
    operationState.events.push(event);
    try {
      operationState.observePhase?.(event);
    } catch {
      // Process-local telemetry cannot alter compilation semantics.
    }
  }
}

export function sourceProgramCompilationPhaseEvents(
  operation: SourceProgramCompilationOperation
): readonly SourceProgramCompilationPhaseEvent[] {
  return Object.freeze([...sourceProgramCompilationOperationState(operation).events]);
}

/** Reuse the admitted operation unchanged, or issue the finite owner default. */
export function resolveSourceProgramCompilationOperation(
  operation?: SourceProgramCompilationOperation
): SourceProgramCompilationOperation {
  if (operation === undefined) return issueSourceProgramCompilationOperation(null);
  sourceProgramCompilationOperationState(operation);
  return operation;
}
