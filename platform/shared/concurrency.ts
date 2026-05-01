import pLimit, { type LimitFunction } from 'p-limit';

const DEFAULT_CONCURRENCY = 10;

export function createConcurrencyLimit(concurrency: number = DEFAULT_CONCURRENCY): LimitFunction {
  return pLimit(concurrency);
}

export const defaultLimit = createConcurrencyLimit();
