import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * Canonical comparison, hashing and normalization primitives.
 *
 * This file is the single canonical owner for byte-stable comparison and
 * hashing across every SEC platform layer. Other modules import the public
 * `platform/foundation/canonical.ts` capability instead of redefining or
 * re-exporting this implementation.
 *
 * Invariants:
 * - Ordering is performed via UTF-16 code unit comparison
 *   (`String#<` / `String#>`), which is locale-independent and ICU-stable.
 * - `sha256` always normalizes its input through `canonicalJson` so that
 *   logically-equal values produce identical digests regardless of key
 *   insertion order or locale.
 * - `canonicalJson` recursively sorts object keys and rejects unsupported
 *   value kinds (`undefined`, `bigint`, `function`, `symbol`, non-finite
 *   numbers, non-plain prototypes).
 * - `uniqueSortedByKey` deduplicates by key (matching its `unique` prefix).
 */

export function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizedArtifactTarget(target: string): string {
  return path.posix.normalize(target.replaceAll('\\', '/'));
}

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function canonicalJson(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON numbers must be finite');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!isPlainObject(value)) throw new Error('Canonical JSON only accepts arrays and plain objects');
  return Object.fromEntries(Object.keys(value)
    .sort(compareCodeUnits)
    .map((key) => {
      const entry = value[key];
      if (entry === undefined || typeof entry === 'bigint' || typeof entry === 'function' || typeof entry === 'symbol') {
        throw new Error(`Canonical JSON rejects unsupported value at key "${key}"`);
      }
      return [key, canonicalJson(entry)];
    }));
}

export function sha256(value: unknown): string {
  return `sha256:${digest(JSON.stringify(canonicalJson(value)))}`;
}

export function uniqueSorted<Value extends string>(values: readonly Value[]): Value[] {
  return [...new Set(values)].sort(compareCodeUnits);
}

export function uniqueSortedByKey<Value>(
  values: readonly Value[],
  keyOf: (value: Value) => string
): Value[] {
  const byKey = new Map<string, Value>();
  for (const value of values) byKey.set(keyOf(value), value);
  return [...byKey.entries()]
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([, value]) => value);
}

export function stableById<Value extends { id: string }>(values: readonly Value[]): Value[] {
  return [...values].sort((left, right) => compareCodeUnits(left.id, right.id));
}

export function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  Object.freeze(value);
  return value;
}

export function cloneAndDeepFreeze<Value>(value: Value): Value {
  return deepFreeze(structuredClone(value));
}

/**
 * Raw SHA-256 digest with `sha256:` prefix, without canonical JSON normalization.
 * Use this for raw byte/string inputs where key-order normalization is not needed.
 * For structured values, use `sha256` instead.
 */
export function rawSha256(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${digest(value)}`;
}

/**
 * Compare two values for canonical equality (key-order independent).
 */
export function canonicalEquals(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

/**
 * Return object keys sorted via canonical comparison.
 */
export function sortedKeys(record: Record<string, unknown>): string[] {
  return Object.keys(record).sort(compareCodeUnits);
}

/**
 * Sort values by a key function without deduplication
 * (unlike `uniqueSortedByKey` which deduplicates).
 */
export function sortByKey<Value>(
  values: readonly Value[],
  keyOf: (value: Value) => string
): Value[] {
  return [...values].sort((left, right) => compareCodeUnits(keyOf(left), keyOf(right)));
}

/**
 * Assert that an array of `{ id: string }` is canonically sorted and unique.
 */
export function assertSortedUnique(
  values: readonly { id: string }[],
  collection: string,
  rejectBlank = true
): void {
  for (let index = 0; index < values.length; index += 1) {
    const id = values[index]!.id;
    const previous = values[index - 1]?.id;
    if (rejectBlank && !id.trim()) {
      throw new Error(`Canonical collection "${collection}" contains blank id at index ${index}`);
    }
    if (previous !== undefined && compareCodeUnits(previous, id) >= 0) {
      throw new Error(`Canonical collection "${collection}" must be unique and canonically ordered`);
    }
  }
}
