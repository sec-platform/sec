import { expect } from 'bun:test';

export function expectNonEmptyArray<T>(value: T[] | undefined, label: string): asserts value is T[] {
  expect(Array.isArray(value)).toBe(true);
  expect(value?.length ?? 0).toBeGreaterThan(0);
}

export function expectSortedUnique(values: string[]): void {
  expect(values).toEqual([...values].sort((left, right) => left.localeCompare(right)));
  expect(new Set(values).size).toBe(values.length);
}

export function expectNoPathPrefix(values: string[], prefix: string): void {
  expect(values.some((value) => value.startsWith(prefix))).toBe(false);
}
