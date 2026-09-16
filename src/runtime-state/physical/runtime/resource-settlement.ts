export interface PhysicalResourceSettlementFailure {
  readonly label: string;
  readonly error: unknown;
}

export class PhysicalResourceCompositeSettlementError extends AggregateError {
  readonly failures: readonly PhysicalResourceSettlementFailure[];

  constructor(failures: readonly PhysicalResourceSettlementFailure[]) {
    const captured = Object.freeze(Array.from(failures, ({ label, error }) => Object.freeze({ label, error })));
    super(captured.map(({ error }) => error), 'Physical resource composite settlement failed.');
    this.name = 'PhysicalResourceCompositeSettlementError';
    this.failures = captured;
  }
}

export interface PhysicalResourceSettlementTerminal {
  readonly status: 'settled';
  readonly attemptedLabels: readonly string[];
}

function throwPhysicalResourceSettlementFailures(
  failures: readonly PhysicalResourceSettlementFailure[],
  primary: PhysicalResourceSettlementFailure | undefined
): void {
  if (failures.length === 0) return;
  if (failures.length === 1 && primary !== undefined) throw primary.error;
  throw new PhysicalResourceCompositeSettlementError(failures);
}

/** Bind a valid declared cleanup plan before any of its effects. The caller
 * still owns action ordering, resource permissions and all deadline decisions.
 * Do not let one cleanup remove a later action, relabel its failure or replace
 * its method. Providers keep their actual receiver; Error values remain exact.
 */
function captureSettlement<T>(input: Readonly<{
  primary?: PhysicalResourceSettlementFailure;
  cleanup: readonly Readonly<{ label: string; settle(): T }>[];
}>) {
  const primaryInput = input.primary;
  const primary = primaryInput === undefined ? undefined : Object.freeze({
    label: primaryInput.label, error: primaryInput.error
  });
  const cleanup = Array.from(input.cleanup, (entry, index) => {
    let label = `cleanup[${index}]`;
    try {
      const selectedLabel = entry.label;
      if (typeof selectedLabel !== 'string') throw new TypeError('Physical resource cleanup label must be a string');
      label = selectedLabel;
      const settle = entry.settle;
      if (typeof settle !== 'function') throw new TypeError('Physical resource cleanup settlement must be callable');
      return Object.freeze({ label, settle: () => Reflect.apply(settle, entry, []) as T });
    } catch (error) {
      // A malformed selected action is a failed cleanup attempt. It must not
      // discard the primary error or prevent the other known actions running.
      return Object.freeze({ label, settle: (): T => { throw error; } });
    }
  });
  return { primary, cleanup };
}

/**
 * Settles every supplied physical resource even when an earlier settlement
 * fails. When an operation is already unwinding, the primary failure remains
 * first and is rethrown unchanged unless cleanup adds typed failure evidence.
 */
export function settlePhysicalResources(input: Readonly<{
  primary?: PhysicalResourceSettlementFailure;
  cleanup: readonly Readonly<{ label: string; settle(): void }>[];
}>): void {
  const captured = captureSettlement(input);
  const failures: PhysicalResourceSettlementFailure[] = [];
  if (captured.primary !== undefined) failures.push(captured.primary);
  for (const cleanup of captured.cleanup) {
    try {
      cleanup.settle();
    } catch (error) {
      failures.push(Object.freeze({ label: cleanup.label, error }));
    }
  }
  throwPhysicalResourceSettlementFailures(failures, captured.primary);
}

/**
 * Settles an asynchronous physical-resource closure in caller order. Every
 * settlement is awaited before the next begins, and every settlement is
 * attempted even when an earlier one fails. The caller's operation owns the
 * deadline and retry policy; settlement never opens a replacement budget.
 */
export async function settlePhysicalResourcesAsync(input: Readonly<{
  primary?: PhysicalResourceSettlementFailure;
  cleanup: readonly Readonly<{ label: string; settle(): void | Promise<void> }>[];
}>): Promise<PhysicalResourceSettlementTerminal> {
  const captured = captureSettlement(input);
  const failures: PhysicalResourceSettlementFailure[] = [];
  const attemptedLabels: string[] = [];
  if (captured.primary !== undefined) failures.push(captured.primary);
  for (const cleanup of captured.cleanup) {
    attemptedLabels.push(cleanup.label);
    try {
      await cleanup.settle();
    } catch (error) {
      failures.push(Object.freeze({ label: cleanup.label, error }));
    }
  }
  throwPhysicalResourceSettlementFailures(failures, captured.primary);
  return Object.freeze({
    status: 'settled',
    attemptedLabels: Object.freeze(attemptedLabels)
  });
}
