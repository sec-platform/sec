import { countBy, filter, sortBy, sum, uniq } from 'lodash-es';

type CountSummary<T extends string> = { id: T; count: number };

export function countPositiveValues(values: Iterable<number>): number {
  return sum([...values].map((v) => (v > 0 ? 1 : 0)));
}

export function countMatching<T>(values: Iterable<T>, predicate: (value: T) => boolean): number {
  return filter([...values], predicate).length;
}

export function mergeCountSummaries<T extends string>(entries: Iterable<CountSummary<T>>): Array<CountSummary<T>> {
  const arr = [...entries];
  const counts = countBy(arr, 'id') as Record<string, number>;
  return sortBy(
    Object.entries(counts).map(([id, count]) => ({ id: id as T, count })),
    'id'
  );
}

export function summarizeCounts<T extends string>(values: Iterable<T>): Array<CountSummary<T>> {
  const counts = countBy([...values]) as Record<string, number>;
  return sortBy(
    Object.entries(counts).map(([id, count]) => ({ id: id as T, count })),
    'id'
  );
}

export function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return sortBy(uniq(filter([...values], (v) => v.length > 0)));
}
