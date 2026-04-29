export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))]
    .sort((left, right) => left.localeCompare(right));
}
