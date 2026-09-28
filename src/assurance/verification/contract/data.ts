import { isProxy } from 'node:util/types';

export type VerificationDataSnapshot =
  | null
  | boolean
  | number
  | string
  | VerificationDataSnapshot[]
  | { [key: string]: VerificationDataSnapshot };

type OrdinaryDataDescriptor = PropertyDescriptor & { value: unknown };

function assertNotVerificationProxy(value: unknown, label: string): void {
  if (isProxy(value)) throw new Error(`${label} must not contain Proxy values.`);
}

function assertCanonicalVerificationDataPrototype(
  value: object,
  label: string,
  isArray: boolean
): void {
  const prototype = Object.getPrototypeOf(value) as object | null;
  const canonicalPrototype = isArray ? Array.prototype : Object.prototype;
  if (prototype !== canonicalPrototype) {
    throw new Error(
      `${label} must use the canonical ${isArray ? 'Array' : 'Object'} prototype.`
    );
  }
  if (Object.getOwnPropertyDescriptor(value, 'toJSON') !== undefined
      || (isArray && Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON') !== undefined)
      || Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON') !== undefined) {
    throw new Error(`${label} must not define or inherit toJSON.`);
  }
}

function ordinaryDataDescriptor(
  value: object,
  key: PropertyKey,
  label: string
): OrdinaryDataDescriptor {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
    throw new Error(`${label} must be an ordinary own data field.`);
  }
  if (!descriptor.enumerable) {
    throw new Error(`${label} must be an enumerable own data field.`);
  }
  return descriptor as OrdinaryDataDescriptor;
}


/**
 * Read only one ordinary record layer without cloning nested authority objects.
 * The returned record contains original nested values, but no candidate getter,
 * Proxy trap, prototype hook, iterator, or toJSON hook is executed.
 */
export function readVerificationDataRecord(
  value: unknown,
  label: string = 'Verification data'
): Record<string, unknown> {
  assertNotVerificationProxy(value, label);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be one ordinary object.`);
  }
  assertCanonicalVerificationDataPrototype(value, label, false);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === 'symbol')) {
    throw new Error(`${label} must not contain symbol fields.`);
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of ownKeys as string[]) {
    Object.defineProperty(snapshot, key, {
      value: ordinaryDataDescriptor(value, key, `${label}.${key}`).value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  return snapshot;
}

function snapshotStrictVerificationData(
  value: unknown,
  label: string,
  ancestors: WeakSet<object>
): VerificationDataSnapshot {
  assertNotVerificationProxy(value, label);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} must contain only finite numbers.`);
    return value;
  }
  if (typeof value !== 'object') {
    throw new Error(`${label} must contain only JSON-compatible data fields.`);
  }
  if (ancestors.has(value)) throw new Error(`${label} must not contain a cycle.`);
  ancestors.add(value);
  try {
    const isArray = Array.isArray(value);
    assertCanonicalVerificationDataPrototype(value, label, isArray);
    if (isArray) {
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.some((key) => typeof key === 'symbol')) {
        throw new Error(`${label} must not contain symbol fields.`);
      }
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      if (!lengthDescriptor || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
          || lengthDescriptor.enumerable || lengthDescriptor.configurable
          || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
        throw new Error(`${label}.length must be the canonical array length field.`);
      }
      const length = lengthDescriptor.value as number;
      if (ownKeys.length !== length + 1) {
        throw new Error(`${label} must be dense and contain no extra own fields.`);
      }
      const descriptors: OrdinaryDataDescriptor[] = [];
      for (let index = 0; index < length; index += 1) {
        descriptors.push(ordinaryDataDescriptor(value, String(index), `${label}[${index}]`));
      }
      const snapshot: VerificationDataSnapshot[] = [];
      for (let index = 0; index < length; index += 1) {
        snapshot.push(snapshotStrictVerificationData(
          descriptors[index]!.value,
          `${label}[${index}]`,
          ancestors
        ));
      }
      return snapshot;
    }

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key === 'symbol')) {
      throw new Error(`${label} must not contain symbol fields.`);
    }
    const descriptors = ownKeys.map((key) => ({
      key: key as string,
      descriptor: ordinaryDataDescriptor(value, key, `${label}.${String(key)}`)
    }));
    const snapshot: { [key: string]: VerificationDataSnapshot } = {};
    for (const { key, descriptor } of descriptors) {
      Object.defineProperty(snapshot, key, {
        value: snapshotStrictVerificationData(descriptor.value, `${label}.${key}`, ancestors),
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
    return snapshot;
  } finally {
    ancestors.delete(value);
  }
}

export function snapshotVerificationData(
  value: unknown,
  label: string = 'Verification data'
): VerificationDataSnapshot {
  return snapshotStrictVerificationData(value, label, new WeakSet<object>());
}

function snapshotsEqual(
  left: VerificationDataSnapshot,
  right: VerificationDataSnapshot
): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  const leftIsArray = Array.isArray(left);
  if (leftIsArray !== Array.isArray(right)) return false;
  if (leftIsArray) {
    const leftArray = left as VerificationDataSnapshot[];
    const rightArray = right as VerificationDataSnapshot[];
    if (leftArray.length !== rightArray.length) return false;
    for (let index = 0; index < leftArray.length; index += 1) {
      if (!snapshotsEqual(leftArray[index]!, rightArray[index]!)) return false;
    }
    return true;
  }
  const leftRecord = left as { [key: string]: VerificationDataSnapshot };
  const rightRecord = right as { [key: string]: VerificationDataSnapshot };
  const leftKeys = Reflect.ownKeys(leftRecord).map(String).sort();
  const rightKeys = Reflect.ownKeys(rightRecord).map(String).sort();
  if (leftKeys.length !== rightKeys.length
      || leftKeys.some((key, index) => key !== rightKeys[index])) {
    return false;
  }
  return leftKeys.every((key) => snapshotsEqual(leftRecord[key]!, rightRecord[key]!));
}

export function verificationDataEqual(left: unknown, right: unknown): boolean {
  return snapshotsEqual(
    snapshotVerificationData(left, 'left verification data'),
    snapshotVerificationData(right, 'right verification data')
  );
}
