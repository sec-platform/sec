type CountSummary<T extends string> = { id: T; count: number };

export function countPositiveValues(values: Iterable<number>): number {
  let count = 0;
  for (const value of values) {
    if (value > 0) count += 1;
  }
  return count;
}

export function countMatching<T>(values: Iterable<T>, predicate: (value: T) => boolean): number {
  let count = 0;
  for (const value of values) {
    if (predicate(value)) count += 1;
  }
  return count;
}

export function mergeCountSummaries<T extends string>(entries: Iterable<CountSummary<T>>): Array<CountSummary<T>> {
  return summarizeCounts([...entries].map((entry) => entry.id));
}

export function summarizeCounts<T extends string>(values: Iterable<T>): Array<CountSummary<T>> {
  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([id, count]) => ({ id, count }));
}

export function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values.filter((value) => value.length > 0))]
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

export function uniqueSortedLines(value: string): string[] {
  return uniqueSorted(value.split(/\r?\n/u).map((line) => line.trim()));
}

export function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n');
}
