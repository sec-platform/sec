type CountSummary<T extends string> = { id: T; count: number };

function countValues<T extends string>(values: Iterable<T>): Map<T, number> {
  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function sortedCountSummaries<T extends string>(counts: ReadonlyMap<T, number>): Array<CountSummary<T>> {
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function countPositiveValues(values: Iterable<number>): number {
  let count = 0;
  for (const value of values) {
    if (value > 0) {
      count += 1;
    }
  }
  return count;
}

export function countMatching<T>(values: Iterable<T>, predicate: (value: T) => boolean): number {
  let count = 0;
  for (const value of values) {
    if (predicate(value)) {
      count += 1;
    }
  }
  return count;
}

export function mergeCountSummaries<T extends string>(
  entries: Iterable<CountSummary<T>>
): Array<CountSummary<T>> {
  const counts = new Map<T, number>();
  for (const entry of entries) {
    counts.set(entry.id, (counts.get(entry.id) ?? 0) + entry.count);
  }
  return sortedCountSummaries(counts);
}

export function summarizeCounts<T extends string>(
  values: Iterable<T>
): Array<CountSummary<T>> {
  return sortedCountSummaries(countValues(values));
}

export function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values.filter((value) => value.length > 0))]
    .sort((left, right) => left.localeCompare(right));
}
