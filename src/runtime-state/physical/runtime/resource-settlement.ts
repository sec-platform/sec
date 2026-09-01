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
  if (failures.length === 0) return;
  if (failures.length === 1 && input.primary !== undefined) {
    throw input.primary.error;
  }
  throw new PhysicalResourceCompositeSettlementError(failures);
}
