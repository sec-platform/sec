import { setTimeout as delay } from 'node:timers/promises';

/** Stable retry classification owned by the lease provider, not its prose. */
export class HeavyVerificationGateBusyError extends Error {
  readonly code = 'HEAVY_GATE_BUSY';
  readonly reason: 'active' | 'initializing';
  constructor(reason: 'active' | 'initializing', message: string) {
    super(message); this.name = 'HeavyVerificationGateBusyError'; this.reason = reason;
  }
}

type ReleasableGateLease = { release: () => PromiseLike<void> | void };

/** Release exactly once, retaining both operation and release failures. */
export async function withAcquiredHeavyVerificationGateLease<T>(
  lease: ReleasableGateLease,
  execute: () => T | PromiseLike<T>
): Promise<T> {
  const release = lease.release;
  if (typeof release !== 'function') throw new TypeError('Heavy gate lease must have a release operation');
  let primary: { reason: unknown } | undefined;
  let result!: T;
  try { result = await execute(); } catch (reason) { primary = { reason }; }
  try { await Reflect.apply(release, lease, []); }
  catch (secondary) {
    if (primary !== undefined) throw new AggregateError([primary.reason, secondary],
      'Heavy gate operation and release both failed', { cause: primary.reason });
    throw secondary;
  }
  if (primary !== undefined) throw primary.reason;
  return result;
}

/** Memoize the release outcome, including rejection; concurrent callers cannot
 * duplicate a physical release or turn its previous failure into success. */
export function onceHeavyVerificationGateRelease(release: () => Promise<void>): () => Promise<void> {
  let outcome: Promise<void> | undefined;
  return () => outcome ??= Promise.resolve().then(release);
}

/** The wait budget uses one monotonic clock. Ownership, reclamation and actual
 * acquisition remain with acquire; only typed contention is retryable. */
export async function waitForHeavyVerificationGateLease<T extends ReleasableGateLease>(
  acquire: () => Promise<T>, waitTimeoutMs: number
): Promise<T> {
  if (!Number.isSafeInteger(waitTimeoutMs) || waitTimeoutMs < 0) throw new TypeError('Gate wait timeout must be a non-negative safe integer');
  const deadline = performance.now() + waitTimeoutMs;
  for (;;) {
    try {
      const lease = await acquire();
      if (waitTimeoutMs > 0 && performance.now() >= deadline) {
        return await withAcquiredHeavyVerificationGateLease(lease, () => { throw new Error('Heavy gate acquisition exceeded its wait deadline'); });
      }
      return lease;
    } catch (error) {
      if (!(error instanceof HeavyVerificationGateBusyError)) throw error;
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw error;
      await delay(Math.min(25, remaining));
      if (performance.now() >= deadline) throw error;
    }
  }
}
