/** Ordered proof sequences are dense own data, never a caller-supplied .every
 * implementation or a prototype-provided slot. This is a shape check, not proof
 * that the represented stages actually ran. */
export function samePipelineSequence(left: unknown, right: readonly unknown[]): boolean {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  for (let index = 0; index < right.length; index++) {
    const a = Object.getOwnPropertyDescriptor(left, index);
    const b = Object.getOwnPropertyDescriptor(right, index);
    if (!a || !b || !('value' in a) || !('value' in b) || a.value !== b.value) return false;
  }
  return true;
}

/** Capture the proof's exact record before digest or semantic checks. Accessors,
 * symbol extensions and non-enumerable fields cannot hide a second payload.
 * Only one-level arrays occur in this protocol; domain evidence is not cloned. */
export function capturePipelineProofRecord(
  value: unknown,
  expected: readonly string[],
  label: string
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an exact data object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) throw new Error(`${label} must be a plain data object`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length || keys.some(key => typeof key !== 'string' || !expected.includes(key))) {
    throw new Error(`${label} does not match the exact schema`);
  }
  const captured: Record<string, unknown> = Object.create(null);
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error(`${label}.${key} must be own enumerable data`);
    let entry: unknown = descriptor.value;
    if (Array.isArray(entry)) {
      if (Reflect.ownKeys(entry).length !== entry.length + 1) throw new Error(`${label}.${key} must be a dense data array`);
      const array: unknown[] = [];
      for (let index = 0; index < entry.length; index++) {
        const item = Object.getOwnPropertyDescriptor(entry, index);
        if (!item?.enumerable || !('value' in item)) throw new Error(`${label}.${key} must be a dense data array`);
        array.push(item.value);
      }
      entry = Object.freeze(array);
    }
    captured[key] = entry;
  }
  return Object.freeze(captured);
}
