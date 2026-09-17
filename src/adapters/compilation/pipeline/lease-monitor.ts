// Observation cadence is not a lease duration and cannot extend lease authority.
const LEASE_OBSERVATION_INTERVAL_MS = 250;

/** Monitor a read-only lease assertion. The assertion's owner still decides
 * validity; this lifecycle neither issues a lease nor confirms physical work
 * termination. At most one periodic assertion is in flight. */
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
    // A check that settles after a failed operation has returned remains
    // observed, but cannot mutate or abort that operation's retired signal.
    if (phase === 'closed' || failure !== undefined) return;
    failure = Object.freeze({ reason });
    controller.abort();
  };
  const tick = (): void => {
    if (phase !== 'active' || failure !== undefined || pending !== undefined) return;
    const observation = Promise.resolve().then(assertLease).then(undefined, observeFailure);
    pending = observation;
    void observation.then(() => { if (pending === observation) pending = undefined; });
  };

  try {
    // Do not start a periodic check concurrently with admission.
    await assertLease();
    phase = 'active';
    timer = setInterval(tick, LEASE_OBSERVATION_INTERVAL_MS);
    const result = await execute(controller.signal);
    phase = 'closing';
    stopTicks();
    // A pre-completion check is not the fresh post-completion assertion.
    // Settle it before starting that assertion, so they never overlap.
    await pending;
    if (failure !== undefined) throw failure.reason;
    await assertLease();
    return result;
  } catch (error) {
    // The presence of a failed observation is separate from its thrown value;
    // rejecting with undefined, null, false or zero still invalidates the run.
    if (failure !== undefined) throw failure.reason;
    throw error;
  } finally {
    phase = 'closed';
    stopTicks();
  }
}
