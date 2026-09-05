import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * Canonical comparison, hashing and normalization primitives.
 *
 * This file is the single canonical owner for byte-stable comparison and
 * hashing across every SEC platform layer. Other modules import the public
 * `src/system-architecture/foundation/runtime/canonical.ts` owner instead of redefining or
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
  // Only the active ancestry identifies cycles; shared acyclic inputs still
  // produce independent normalized subtrees. Frames replace native recursion.
  const ancestors = new WeakSet<object>();
  type Frame = {
    kind: 'array'; input: unknown[]; output: unknown[]; length: number; cursor: number;
  } | {
    kind: 'object'; input: Record<string, unknown>; output: Record<string, unknown>;
    keys: string[]; cursor: number;
  };
  const pending: Frame[] = [];

  function normalize(entry: unknown): unknown {
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return entry;
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) throw new Error('Canonical JSON numbers must be finite');
      return Object.is(entry, -0) ? 0 : entry;
    }
    if (!Array.isArray(entry) && !isPlainObject(entry)) {
      throw new Error('Canonical JSON only accepts arrays and plain objects');
    }
    if (ancestors.has(entry)) throw new Error('Canonical JSON rejects circular references');
    ancestors.add(entry);
    if (Array.isArray(entry)) {
      // Do not dispatch input.map or ArraySpeciesCreate: input hooks must not
      // choose the normalized value or its digest. Retain length/hole semantics.
      const output = new Array<unknown>(entry.length);
      pending.push({ kind: 'array', input: entry, output, length: output.length, cursor: 0 });
      return output;
    }
    const output: Record<string, unknown> = {};
    pending.push({ kind: 'object', input: entry, output, keys: Object.keys(entry).sort(compareCodeUnits), cursor: 0 });
    return output;
  }

  const result = normalize(value);
  while (pending.length > 0) {
    const frame = pending[pending.length - 1]!;
    if (frame.cursor >= (frame.kind === 'array' ? frame.length : frame.keys.length)) {
      ancestors.delete(frame.input);
      pending.pop();
      continue;
    }
    const index = frame.cursor++;
    if (frame.kind === 'array') {
      if (index in frame.input) frame.output[index] = normalize(frame.input[index]);
      continue;
    }
    const key = frame.keys[index]!;
    const nested = frame.input[key];
    if (nested === undefined || typeof nested === 'bigint' || typeof nested === 'function' || typeof nested === 'symbol') {
      throw new Error(`Canonical JSON rejects unsupported value at key "${key}"`);
    }
    // Define data properties so __proto__ stays data rather than a setter.
    Object.defineProperty(frame.output, key, {
      value: normalize(nested), enumerable: true, configurable: true, writable: true
    });
  }
  return result;
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

/**
 * Freeze the reachable own-data-property graph without invoking accessors.
 * A shallow-frozen container is not evidence that its descendants are frozen.
 * Functions and collection internal slots retain their existing semantics;
 * this does not turn Map/Set/Date instances into immutable value types.
 */
export function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object') return value;
  const visited = new WeakSet<object>();
  const pending: Array<{ value: object; childrenVisited: boolean }> = [
    { value, childrenVisited: false }
  ];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.childrenVisited) {
      Object.freeze(current.value);
      continue;
    }
    if (visited.has(current.value)) continue;
    visited.add(current.value);
    // Postorder preserves child-before-parent freezing on acyclic edges;
    // already visited cycle back-edges must not schedule another traversal.
    pending.push({ value: current.value, childrenVisited: true });
    const keys = Reflect.ownKeys(current.value);
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const descriptor = Object.getOwnPropertyDescriptor(current.value, keys[index]!);
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) continue;
      const nested: unknown = descriptor.value;
      if (nested !== null && typeof nested === 'object' && !visited.has(nested)) {
        pending.push({ value: nested, childrenVisited: false });
      }
    }
  }
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
