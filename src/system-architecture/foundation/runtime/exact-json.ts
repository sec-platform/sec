import { SecError } from '../contract/failure.ts';
import { isPlainObject } from './canonical.ts';

export type ExactJsonFailureKind = 'duplicate-key' | 'invalid-json';

export interface ExactJsonContract {
  /** Exact root-object field set. Nested shape remains owned by the domain decoder. */
  readonly rootObjectKeys: readonly string[];
}

export class ExactJsonError extends SecError {
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
  contract?: ExactJsonContract
): unknown {
  if (typeof source !== 'string') {
    throw new ExactJsonError('invalid-json', `${label} must be UTF-8 text`, 0);
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
  const readValue = (): void => {
    skipWhitespace();
    const character = source[offset];
    if (character === '{') {
      readObject();
      return;
    }
    if (character === '[') {
      readArray();
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
  const readObject = (): void => {
    offset += 1;
    skipWhitespace();
    const keys = new Set<string>();
    if (source[offset] === '}') {
      offset += 1;
      return;
    }
    while (offset < source.length) {
      skipWhitespace();
      const tokenOffset = offset;
      const token = readStringToken();
      const key = parseObjectKey(token, tokenOffset);
      if (keys.has(key)) fail('duplicate-key', `contains duplicate key ${JSON.stringify(key)}`);
      keys.add(key);
      skipWhitespace();
      if (source[offset] !== ':') fail('invalid-json', `expected ':' at offset ${offset}`);
      offset += 1;
      readValue();
      skipWhitespace();
      if (source[offset] === '}') {
        offset += 1;
        return;
      }
      if (source[offset] !== ',') fail('invalid-json', `expected ',' or '}' at offset ${offset}`);
      offset += 1;
      skipWhitespace();
      if (source[offset] === '}') fail('invalid-json', `contains a trailing comma at offset ${offset}`);
    }
    fail('invalid-json', 'has an unterminated object');
  };
  const readArray = (): void => {
    offset += 1;
    skipWhitespace();
    if (source[offset] === ']') {
      offset += 1;
      return;
    }
    while (offset < source.length) {
      readValue();
      skipWhitespace();
      if (source[offset] === ']') {
        offset += 1;
        return;
      }
      if (source[offset] !== ',') fail('invalid-json', `expected ',' or ']' at offset ${offset}`);
      offset += 1;
      skipWhitespace();
      if (source[offset] === ']') fail('invalid-json', `contains a trailing comma at offset ${offset}`);
    }
    fail('invalid-json', 'has an unterminated array');
  };

  readValue();
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
