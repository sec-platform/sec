export function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values.filter((value) => value.length > 0))]
    .sort((left, right) => left.localeCompare(right));
}
