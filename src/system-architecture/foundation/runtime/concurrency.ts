import pLimit, { type LimitFunction } from 'p-limit';

const DEFAULT_CONCURRENCY = 10;

export function createConcurrencyLimit(concurrency: number = DEFAULT_CONCURRENCY): LimitFunction {
  return pLimit(concurrency);
}

// Export the provider itself: a callable wrapper is not a LimitFunction and
// loses queue state, map/clearQueue and the live concurrency setter. Creating
// this idle queue starts no tasks, timers or I/O.
export const defaultLimit: LimitFunction = createConcurrencyLimit();

export function getDefaultLimit(): LimitFunction {
  return defaultLimit;
}
