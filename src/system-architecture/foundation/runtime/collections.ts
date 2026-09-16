import { compareCodeUnits, uniqueSorted } from './canonical.ts';

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
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([id, count]) => ({ id, count }));
}

export function uniqueSortedLines(value: string): string[] {
  return uniqueSorted(value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean));
}

export function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

/** Own a stable map snapshot without exporting any mutator or its backing Map.
 * Keys/values retain their identity; their immutability belongs to their owner.
 */
export function readonlyMapSnapshot<K, V>(source: Iterable<readonly [K, V]>): ReadonlyMap<K, V> {
  const entries = new Map<K, V>(source);
  const view: ReadonlyMap<K, V> = Object.freeze({
    size: entries.size,
    get: (key: K) => entries.get(key),
    has: (key: K) => entries.has(key),
    keys: () => entries.keys(),
    values: () => entries.values(),
    entries: () => entries.entries(),
    [Symbol.iterator]: () => entries[Symbol.iterator](),
    forEach: (callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown) => {
      if (typeof callback !== 'function') throw new TypeError('Readonly map callback must be callable');
      entries.forEach((value, key) => Reflect.apply(callback, thisArg, [value, key, view]));
    }
  });
  return view;
}
