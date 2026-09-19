// Observation cadence is not a lease duration and cannot extend lease authority.
const LEASE_OBSERVATION_INTERVAL_MS = 250;

/** Monitor a read-only lease assertion. The assertion owner decides validity;
 * Execution owns observation cadence, cancellation and closeout ordering. */
export async function withLeaseObservationMonitor<T>(
  assertLease: () => Promise<void>,
  execute: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  let phase: 'starting' | 'active' | 'closing' | 'closed' = 'starting';
  let failure: Readonly<{ reason: unknown }> | undefined;
  let pending: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const stopTicks = (): void => {
    if (timer !== undefined) { clearInterval(timer); timer = undefined; }
  };
  const observeFailure = (reason: unknown): void => {
    if (phase === 'closed' || failure !== undefined) return;
    failure = Object.freeze({ reason });
    controller.abort();
  };
  const tick = (): void => {
    if (phase !== 'active' || failure !== undefined || pending !== undefined) return;
    const observation = Promise.resolve()
      .then(assertLease)
      .then(undefined, observeFailure);
    pending = observation;
    void observation.then(() => {
      if (pending === observation) pending = undefined;
    });
  };

  try {
    await assertLease();
    phase = 'active';
    timer = setInterval(tick, LEASE_OBSERVATION_INTERVAL_MS);
    const result = await execute(controller.signal);
    phase = 'closing';
    stopTicks();
    await pending;
    if (failure !== undefined) throw failure.reason;
    await assertLease();
    return result;
  } catch (error) {
    if (failure !== undefined) throw failure.reason;
    throw error;
  } finally {
    phase = 'closed';
    stopTicks();
  }
}
