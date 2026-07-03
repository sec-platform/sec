import pLimit, { type LimitFunction } from 'p-limit';

const DEFAULT_CONCURRENCY = 10;

export function createConcurrencyLimit(concurrency: number = DEFAULT_CONCURRENCY): LimitFunction {
  return pLimit(concurrency);
}

let _defaultLimit: LimitFunction | null = null;

export function getDefaultLimit(): LimitFunction {
  if (_defaultLimit === null) {
    _defaultLimit = createConcurrencyLimit();
  }
  return _defaultLimit;
}

export const defaultLimit: LimitFunction = ((...args: Parameters<LimitFunction>) => getDefaultLimit()(...args)) as LimitFunction;
