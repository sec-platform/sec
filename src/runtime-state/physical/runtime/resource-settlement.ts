export interface PhysicalResourceSettlementFailure {
  readonly label: string;
  readonly error: unknown;
}

export class PhysicalResourceCompositeSettlementError extends AggregateError {
  readonly failures: readonly PhysicalResourceSettlementFailure[];

  constructor(failures: readonly PhysicalResourceSettlementFailure[]) {
    super(
      failures.map(({ error }) => error),
      'Physical resource composite settlement failed.'
    );
    this.name = 'PhysicalResourceCompositeSettlementError';
    this.failures = Object.freeze([...failures]);
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

/**
 * Settles every supplied physical resource even when an earlier settlement
 * fails. When an operation is already unwinding, the primary failure remains
 * first and is rethrown unchanged unless cleanup adds typed failure evidence.
 */
export function settlePhysicalResources(input: Readonly<{
  primary?: PhysicalResourceSettlementFailure;
  cleanup: readonly Readonly<{ label: string; settle(): void }>[];
}>): void {
  const failures: PhysicalResourceSettlementFailure[] = [];
  if (input.primary !== undefined) failures.push(input.primary);
  for (const cleanup of input.cleanup) {
    try {
      cleanup.settle();
    } catch (error) {
      failures.push(Object.freeze({ label: cleanup.label, error }));
    }
  }
  throwPhysicalResourceSettlementFailures(failures, input.primary);
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
  const failures: PhysicalResourceSettlementFailure[] = [];
  const attemptedLabels: string[] = [];
  if (input.primary !== undefined) failures.push(input.primary);
  for (const cleanup of input.cleanup) {
    attemptedLabels.push(cleanup.label);
    try {
      await cleanup.settle();
    } catch (error) {
      failures.push(Object.freeze({ label: cleanup.label, error }));
    }
  }
  throwPhysicalResourceSettlementFailures(failures, input.primary);
  return Object.freeze({
    status: 'settled',
    attemptedLabels: Object.freeze(attemptedLabels)
  });
}
