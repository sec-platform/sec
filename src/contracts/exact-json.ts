import { isPlainObject } from './canonical.ts';
import { FailureError } from './failure.ts';

// BufferSource instances can shadow these public properties. Resource
// admission must read native view slots, not caller-selected accessors.
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')!.get!;
const typedArrayByteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')!.get!;
const typedArrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!.get!;

export type ExactJsonFailureKind =
  | 'depth-limit'
  | 'duplicate-key'
  | 'input-too-large'
  | 'invalid-json'
  | 'invalid-utf8';

export interface ExactJsonBytesAdmission {
  readonly maximumInputBytes: number;
  /** Maximum nested object/array containers, counting the root container as one. */
  readonly maximumDepth: number;
}

export interface ExactJsonContract {
  /** Exact root-object field set. Nested shape remains owned by the domain decoder. */
  readonly rootObjectKeys: readonly string[];
}

export class ExactJsonError extends FailureError {
  readonly kind: ExactJsonFailureKind;
  readonly offset: number;

  constructor(kind: ExactJsonFailureKind, message: string, offset: number, options?: ErrorOptions) {
    super('EXACT-JSON-001', message, { kind, offset }, options);
    this.name = 'ExactJsonError';
    this.kind = kind;
    this.offset = offset;
  }
}

/**
 * Parses one exact JSON document while preserving the information JSON.parse
 * discards: duplicate object keys. Domain schemas remain responsible for
 * exact fields, protocol identity and semantic invariants.
 */
export function parseExactJson(
  source: string,
  label = 'JSON document',
  contract?: ExactJsonContract,
  maximumDepth?: number
): unknown {
  if (typeof source !== 'string') {
    throw new ExactJsonError('invalid-json', `${label} must be UTF-8 text`, 0);
  }
  if (maximumDepth !== undefined &&
    (!Number.isSafeInteger(maximumDepth) || maximumDepth <= 0)) {
    throw new TypeError(`${label} maximumDepth must be one positive safe integer`);
  }
  let offset = 0;

  const fail = (kind: ExactJsonFailureKind, message: string, cause?: unknown): never => {
    throw new ExactJsonError(
      kind,
      `${label} ${message}`,
      offset,
      cause === undefined ? undefined : { cause }
    );
  };
  const skipWhitespace = (): void => {
    while (offset < source.length && /[\u0009\u000A\u000D\u0020]/u.test(source[offset]!)) offset += 1;
  };
  const readStringToken = (): string => {
    const start = offset;
    if (source[offset] !== '"') fail('invalid-json', `expected a string at offset ${offset}`);
    offset += 1;
    while (offset < source.length) {
      const character = source[offset]!;
      offset += 1;
      if (character === '"') return source.slice(start, offset);
      if (character === '\\') {
        if (offset >= source.length) fail('invalid-json', `has an incomplete escape at offset ${offset}`);
        offset += source[offset] === 'u' ? 5 : 1;
        continue;
      }
      if (character.charCodeAt(0) < 0x20) {
        fail('invalid-json', `has an unescaped control character at offset ${offset - 1}`);
      }
    }
    return fail('invalid-json', `has an unterminated string at offset ${start}`);
  };
  const parseObjectKey = (token: string, tokenOffset: number): string => {
    try {
      const parsed: unknown = JSON.parse(token);
      return typeof parsed === 'string'
        ? parsed
        : fail('invalid-json', `has a non-string key at offset ${tokenOffset}`);
    } catch (error) {
      if (error instanceof ExactJsonError) throw error;
      return fail('invalid-json', `has an invalid object key at offset ${tokenOffset}`, error);
    }
  };
  type ContainerFrame = {
    readonly kind: 'object';
    readonly keys: Set<string>;
    state: 'first' | 'next' | 'after';
  } | {
    readonly kind: 'array';
    state: 'first' | 'next' | 'after';
  };
  const frames: ContainerFrame[] = [];
  const readValue = (): void => {
    skipWhitespace();
    const character = source[offset];
    if (character === '{' || character === '[') {
      if (maximumDepth !== undefined && frames.length >= maximumDepth) {
        fail('depth-limit', `exceeds its maximum container depth of ${maximumDepth}`);
      }
      offset += 1;
      frames.push(character === '{'
        ? { kind: 'object', keys: new Set<string>(), state: 'first' }
        : { kind: 'array', state: 'first' });
      return;
    }
    if (character === '"') {
      readStringToken();
      return;
    }
    if (character === undefined) fail('invalid-json', `expected a value at offset ${offset}`);
    const start = offset;
    while (offset < source.length && !/[\u0009\u000A\u000D\u0020,\]}]/u.test(source[offset]!)) offset += 1;
    if (start === offset) fail('invalid-json', `expected a value at offset ${offset}`);
  };

  // The owner chooses maximumDepth. A valid large bound must not turn into
  // an unrelated JavaScript call-stack failure before that bound is reached.
  readValue();
  while (frames.length > 0) {
    const frame = frames[frames.length - 1]!;
    const end = frame.kind === 'object' ? '}' : ']';
    skipWhitespace();
    if (offset >= source.length && frame.state !== 'after') {
      fail('invalid-json', `has an unterminated ${frame.kind}`);
    }
    if (frame.state === 'after') {
      if (source[offset] === end) {
        offset += 1;
        frames.pop();
        continue;
      }
      if (source[offset] !== ',') {
        fail('invalid-json', `expected ',' or '${end}' at offset ${offset}`);
      }
      offset += 1;
      skipWhitespace();
      if (source[offset] === end) fail('invalid-json', `contains a trailing comma at offset ${offset}`);
      frame.state = 'next';
      continue;
    }
    if (frame.state === 'first' && source[offset] === end) {
      offset += 1;
      frames.pop();
      continue;
    }
    if (frame.kind === 'object') {
      const tokenOffset = offset;
      const token = readStringToken();
      const key = parseObjectKey(token, tokenOffset);
      if (frame.keys.has(key)) fail('duplicate-key', `contains duplicate key ${JSON.stringify(key)}`);
      frame.keys.add(key);
      skipWhitespace();
      if (source[offset] !== ':') fail('invalid-json', `expected ':' at offset ${offset}`);
      offset += 1;
    }
    frame.state = 'after';
    readValue();
  }
  skipWhitespace();
  if (offset !== source.length) fail('invalid-json', `contains trailing data at offset ${offset}`);
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    fail('invalid-json', 'is not valid JSON', error);
  }
  if (contract !== undefined) {
    const expectedKeys = [...contract.rootObjectKeys];
    if (
      expectedKeys.some((key) => typeof key !== 'string' || key.length === 0) ||
      new Set(expectedKeys).size !== expectedKeys.length
    ) {
      throw new TypeError(`${label} exact-key contract is invalid`);
    }
    const rootObject = isPlainObject(value)
      ? value
      : fail('invalid-json', 'must contain one root object');
    const actualKeys = Object.keys(rootObject);
    const expected = new Set(expectedKeys);
    const actual = new Set(actualKeys);
    const unexpectedKey = actualKeys.find((key) => !expected.has(key));
    if (unexpectedKey !== undefined) {
      fail('invalid-json', `contains unsupported root key ${JSON.stringify(unexpectedKey)}`);
    }
    const missingKey = expectedKeys.find((key) => !actual.has(key));
    if (missingKey !== undefined) {
      fail('invalid-json', `is missing required root key ${JSON.stringify(missingKey)}`);
    }
  }
  return value;
}

/**
 * Admits one bounded byte document before JSON syntax or domain validation.
 * The caller/domain owns the concrete resource limits and semantic schema.
 */
export function parseExactJsonBytes(
  bytes: Uint8Array,
  label: string,
  admission: ExactJsonBytesAdmission,
  contract?: ExactJsonContract
): unknown {
  if (!(bytes instanceof Uint8Array) || !ArrayBuffer.isView(bytes)) {
    throw new TypeError(`${label} bytes must be one Uint8Array`);
  }
  const maximumInputBytes = admission.maximumInputBytes;
  if (!Number.isSafeInteger(maximumInputBytes) || maximumInputBytes <= 0) {
    throw new TypeError(`${label} maximumInputBytes must be one positive safe integer`);
  }
  const maximumDepth = admission.maximumDepth;
  if (!Number.isSafeInteger(maximumDepth) || maximumDepth <= 0) {
    throw new TypeError(`${label} maximumDepth must be one positive safe integer`);
  }
  const byteLength: number = typedArrayByteLength.call(bytes);
  if (byteLength > maximumInputBytes) {
    throw new ExactJsonError(
      'input-too-large',
      `${label} exceeds its maximum input size of ${maximumInputBytes} bytes`,
      0
    );
  }

  let source: string;
  try {
    // Preserve a leading BOM in the decoded source so JSON syntax rejects it.
    // Fix the admitted view length even for a growable backing buffer.
    const admittedBytes = new Uint8Array(
      typedArrayBuffer.call(bytes), typedArrayByteOffset.call(bytes), byteLength
    );
    source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(admittedBytes);
  } catch (error) {
    throw new ExactJsonError(
      'invalid-utf8',
      `${label} is not exact UTF-8`,
      0,
      { cause: error }
    );
  }
  return parseExactJson(source, label, contract, maximumDepth);
}
