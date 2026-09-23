import { types as nativeTypes } from 'node:util';

export const CONTENT_HASH_ALGORITHM = 'blake3-256' as const;
export const CONTENT_HASH_OUTPUT_BYTES = 32 as const;

const CONTENT_HASH_PROVIDER_PARALLELISM = Object.freeze([
  'single-thread',
  'caller-bounded',
  'provider-unbounded'
] as const);

export type ContentHashProviderParallelism =
  (typeof CONTENT_HASH_PROVIDER_PARALLELISM)[number];

export type ContentHashProviderDescriptor = Readonly<{
  providerId: string;
  algorithm: typeof CONTENT_HASH_ALGORITHM;
  outputBytes: typeof CONTENT_HASH_OUTPUT_BYTES;
  streaming: true;
  updateInputLifetime: 'call-only';
  backend: string;
  parallelism: ContentHashProviderParallelism;
}>;

type ContentHashEngine = Readonly<{
  update(bytes: Uint8Array): void;
  digest(): Uint8Array;
  destroy(): void;
}>;

export type ContentHashProvider = Readonly<{
  descriptor: ContentHashProviderDescriptor;
  create(): ContentHashEngine;
}>;

const PROVIDER_KEYS = Object.freeze(['descriptor', 'create'] as const);
const DESCRIPTOR_KEYS = Object.freeze([
  'providerId',
  'algorithm',
  'outputBytes',
  'streaming',
  'updateInputLifetime',
  'backend',
  'parallelism'
] as const);
const ENGINE_KEYS = Object.freeze(['update', 'digest', 'destroy'] as const);
const PROVIDER_ID = /^[@a-z0-9][@a-z0-9._/+:-]{0,127}$/u;
const BACKEND_ID = /^[a-z][a-z0-9._-]{0,63}$/u;

function ordinaryRecord(value: unknown, label: string): Record<PropertyKey, unknown> {
  if (value === null || typeof value !== 'object' || nativeTypes.isProxy(value)
      || Array.isArray(value)) {
    throw new TypeError(`${label} must be one ordinary data object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be one ordinary data object`);
  }
  return value as Record<PropertyKey, unknown>;
}

function ownData(
  record: Record<PropertyKey, unknown>,
  key: PropertyKey,
  label: string
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')
      || !descriptor.enumerable) {
    throw new TypeError(`${label} must be enumerable own data`);
  }
  return descriptor.value;
}

function exactKeys(
  record: Record<PropertyKey, unknown>,
  expected: readonly string[],
  label: string
): void {
  const keys = Reflect.ownKeys(record);
  if (keys.length !== expected.length
      || keys.some((key) => typeof key !== 'string' || !expected.includes(key))) {
    throw new TypeError(`${label} contains missing or unknown fields`);
  }
}

function captureDescriptor(value: unknown): ContentHashProviderDescriptor {
  const record = ordinaryRecord(value, 'Content hash provider descriptor');
  exactKeys(record, DESCRIPTOR_KEYS, 'Content hash provider descriptor');
  const providerId = ownData(record, 'providerId', 'Content hash provider id');
  const algorithm = ownData(record, 'algorithm', 'Content hash algorithm');
  const outputBytes = ownData(record, 'outputBytes', 'Content hash output length');
  const streaming = ownData(record, 'streaming', 'Content hash streaming capability');
  const updateInputLifetime = ownData(
    record,
    'updateInputLifetime',
    'Content hash input lifetime'
  );
  const backend = ownData(record, 'backend', 'Content hash backend');
  const parallelism = ownData(record, 'parallelism', 'Content hash parallelism');
  if (typeof providerId !== 'string' || !PROVIDER_ID.test(providerId)
      || algorithm !== CONTENT_HASH_ALGORITHM
      || outputBytes !== CONTENT_HASH_OUTPUT_BYTES
      || streaming !== true
      || updateInputLifetime !== 'call-only'
      || typeof backend !== 'string' || !BACKEND_ID.test(backend)
      || !CONTENT_HASH_PROVIDER_PARALLELISM.includes(
        parallelism as ContentHashProviderParallelism
      )) {
    throw new TypeError('Content hash provider descriptor is not canonical');
  }
  return Object.freeze({
    providerId,
    algorithm,
    outputBytes,
    streaming: true,
    updateInputLifetime: 'call-only',
    backend,
    parallelism: parallelism as ContentHashProviderParallelism
  });
}

function captureEngine(value: unknown): ContentHashEngine {
  const record = ordinaryRecord(value, 'Content hash engine');
  exactKeys(record, ENGINE_KEYS, 'Content hash engine');
  const update = ownData(record, 'update', 'Content hash engine update');
  const digest = ownData(record, 'digest', 'Content hash engine digest');
  const destroy = ownData(record, 'destroy', 'Content hash engine destroy');
  if (typeof update !== 'function' || typeof digest !== 'function'
      || typeof destroy !== 'function') {
    throw new TypeError('Content hash engine operations must be callable');
  }
  return Object.freeze({
    update(bytes: Uint8Array): void {
      Reflect.apply(update, record, [bytes]);
    },
    digest(): Uint8Array {
      const result = Reflect.apply(digest, record, []);
      if (!nativeTypes.isUint8Array(result)) {
        throw new TypeError('Content hash engine digest must return Uint8Array data');
      }
      return result;
    },
    destroy(): void {
      Reflect.apply(destroy, record, []);
    }
  });
}

/** Capture one implementation binding. This validates representation and
 * execution-shape claims; algorithm correctness remains the provider's
 * qualification obligation and is checked against official vectors. */
export function captureContentHashProvider(value: unknown): ContentHashProvider {
  const record = ordinaryRecord(value, 'Content hash provider');
  exactKeys(record, PROVIDER_KEYS, 'Content hash provider');
  const descriptor = captureDescriptor(
    ownData(record, 'descriptor', 'Content hash provider descriptor')
  );
  const create = ownData(record, 'create', 'Content hash provider create');
  if (typeof create !== 'function') {
    throw new TypeError('Content hash provider create must be callable');
  }
  return Object.freeze({
    descriptor,
    create(): ContentHashEngine {
      return captureEngine(Reflect.apply(create, undefined, []));
    }
  });
}
