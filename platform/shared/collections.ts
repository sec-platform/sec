export function countPositiveValues(values: Iterable<number>): number {
  let count = 0;
  for (const value of values) {
    if (value > 0) {
      count += 1;
    }
  }
  return count;
}

export function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values.filter((value) => value.length > 0))]
    .sort((left, right) => left.localeCompare(right));
}
