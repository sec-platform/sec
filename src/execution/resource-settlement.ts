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
  // Fix membership before reading action metadata: getters on one action
  // must not truncate the list, append work or select an inherited slot.
  // Do not consult a caller-replaced iterator during mandatory closeout.
  const supplied = input.cleanup;
  if (!Array.isArray(supplied)) throw new TypeError('Resource cleanup must be an array');
  const entries: Array<
    { entry: Readonly<{ label: string; settle(): T }> } | { error: unknown }
  > = [];
  const length = supplied.length;
  for (let index = 0; index < length; index += 1) {
    try {
      const slot = Object.getOwnPropertyDescriptor(supplied, index);
      if (slot === undefined || !('value' in slot)) {
        throw new TypeError('Resource cleanup must contain dense own data slots');
      }
      entries.push({ entry: slot.value });
    } catch (error) {
      entries.push({ error });
    }
  }
  const cleanup = entries.map((selected, index) => {
    let label = `cleanup[${index}]`;
    try {
      if ('error' in selected) throw selected.error;
      const { entry } = selected;
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

export interface AcquiredResourceScope<Resource, Value> {
  readonly operationLabel: string;
  readonly resourceLabel: string;
  acquire(): Resource | PromiseLike<Resource>;
  use(resource: Resource): Value | PromiseLike<Value>;
  release(resource: Resource): void | PromiseLike<void>;
}

/**
 * Capture the lifecycle before acquisition. Failed acquisition remains the
 * acquiring provider's responsibility; every fulfilled acquisition transfers
 * one release obligation to this scope, including null/undefined resources.
 *
 * The result is not delivered until release settles. A single failure keeps
 * its exact identity; independent body/release failures retain both labels.
 * Nested scopes therefore close in dependency order. Returned values must
 * remain valid after release; this does not transfer an escaping borrow.
 * The callback must join
 * any work that can still use the resource: this is not a detached-task
 * detector, a permission grant or forced cancellation of a foreign provider.
 */
export async function withAcquiredResource<Resource, Value>(
  input: AcquiredResourceScope<Resource, Value>
): Promise<Value> {
  const { operationLabel, resourceLabel, acquire, use, release } = input;
  if (typeof operationLabel !== 'string' || operationLabel.length === 0 ||
      typeof resourceLabel !== 'string' || resourceLabel.length === 0 ||
      typeof acquire !== 'function' || typeof use !== 'function' || typeof release !== 'function') {
    throw new TypeError('Resource scope requires labels and callable acquire/use/release operations');
  }
  // Use the actual provider receiver, but never re-read its selected methods.
  const resource = await Reflect.apply(acquire, input, []);
  let outcome: { status: 'succeeded'; value: Value } | { status: 'failed'; error: unknown };
  try {
    outcome = { status: 'succeeded', value: await Reflect.apply(use, input, [resource]) };
  } catch (error) {
    outcome = { status: 'failed', error };
  }
  let releaseFailure: { error: unknown } | undefined;
  try {
    await Reflect.apply(release, input, [resource]);
  } catch (error) {
    releaseFailure = { error };
  }
  if (outcome.status === 'failed') {
    if (releaseFailure !== undefined) {
      throw new ResourceCompositeSettlementError([
        { label: operationLabel, error: outcome.error },
        { label: resourceLabel, error: releaseFailure.error }
      ]);
    }
    throw outcome.error;
  }
  if (releaseFailure !== undefined) throw releaseFailure.error;
  return outcome.value;
}
