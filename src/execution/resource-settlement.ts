export interface ResourceSettlementFailure {
  readonly label: string;
  readonly error: unknown;
}

export class ResourceCompositeSettlementError extends AggregateError {
  readonly failures: readonly ResourceSettlementFailure[];

  constructor(failures: readonly ResourceSettlementFailure[]) {
    const captured = Object.freeze(
      Array.from(failures, ({ label, error }) => Object.freeze({ label, error }))
    );
    super(captured.map(({ error }) => error), 'Resource composite settlement failed.');
    this.name = 'ResourceCompositeSettlementError';
    this.failures = captured;
  }
}

export interface ResourceSettlementTerminal {
  readonly status: 'settled';
  readonly attemptedLabels: readonly string[];
}

function throwSettlementFailures(
  failures: readonly ResourceSettlementFailure[],
  primary: ResourceSettlementFailure | undefined
): void {
  if (failures.length === 0) return;
  if (failures.length === 1 && primary !== undefined) throw primary.error;
  throw new ResourceCompositeSettlementError(failures);
}

function captureSettlement<T>(input: Readonly<{
  primary?: ResourceSettlementFailure;
  cleanup: readonly Readonly<{ label: string; settle(): T }>[];
}>) {
  const primaryInput = input.primary;
  const primary = primaryInput === undefined ? undefined : Object.freeze({
    label: primaryInput.label,
    error: primaryInput.error
  });
  const cleanup = Array.from(input.cleanup, (entry, index) => {
    let label = `cleanup[${index}]`;
    try {
      const selectedLabel = entry.label;
      if (typeof selectedLabel !== 'string') {
        throw new TypeError('Resource cleanup label must be a string');
      }
      label = selectedLabel;
      const settle = entry.settle;
      if (typeof settle !== 'function') {
        throw new TypeError('Resource cleanup settlement must be callable');
      }
      return Object.freeze({
        label,
        settle: () => Reflect.apply(settle, entry, []) as T
      });
    } catch (error) {
      return Object.freeze({
        label,
        settle: (): T => { throw error; }
      });
    }
  });
  return { primary, cleanup };
}

/** Settle every supplied resource even when an earlier settlement fails. */
export function settleResources(input: Readonly<{
  primary?: ResourceSettlementFailure;
  cleanup: readonly Readonly<{ label: string; settle(): void }>[];
}>): void {
  const captured = captureSettlement(input);
  const failures: ResourceSettlementFailure[] = [];
  if (captured.primary !== undefined) failures.push(captured.primary);
  for (const cleanup of captured.cleanup) {
    try {
      cleanup.settle();
    } catch (error) {
      failures.push(Object.freeze({ label: cleanup.label, error }));
    }
  }
  throwSettlementFailures(failures, captured.primary);
}

/** Settle asynchronous resources in caller order while attempting every action. */
export async function settleResourcesAsync(input: Readonly<{
  primary?: ResourceSettlementFailure;
  cleanup: readonly Readonly<{ label: string; settle(): void | Promise<void> }>[];
}>): Promise<ResourceSettlementTerminal> {
  const captured = captureSettlement(input);
  const failures: ResourceSettlementFailure[] = [];
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
  throwSettlementFailures(failures, captured.primary);
  return Object.freeze({
    status: 'settled',
    attemptedLabels: Object.freeze(attemptedLabels)
  });
}
