import { types as nativeTypes } from 'node:util';

import { parseDigest, type Digest } from './digest.ts';

/** The profile fixes algorithm, output length, mode, framing and encoding.
 * It does NOT select a library/backend or grant semantic/effect authority.
 * canonical-json-v1 names canonical.ts's retained encoding, NOT RFC 8785.
 */
export const IDENTITY_PROFILE = 'blake3-256-canonical-json-v1' as const;
declare const identityBrand: unique symbol;
export type Identity<Domain extends string = string, Schema extends string = string> = Readonly<{
  profile: typeof IDENTITY_PROFILE;
  domain: Domain;
  schema: Schema;
  digest: Digest<'blake3'>;
  [identityBrand]: readonly [Domain, Schema];
}>;

const PREFIX = Buffer.from('sec.identity\0\x01', 'utf8');
const NON_NAMESPACE_BYTE = /[^a-z0-9._/-]/u;
const IDENTITY_KEYS = ['profile', 'domain', 'schema', 'digest'] as const;

function requireNamespace(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128
      || value[0]! < 'a' || value[0]! > 'z' || NON_NAMESPACE_BYTE.test(value)) {
    throw new TypeError(`${label} must be a canonical ASCII namespace of 1..128 bytes`);
  }
}

/** Frame grammar (all lengths are unsigned 16-bit big-endian):
 * UTF8("sec.identity") || 00 || 01 || len(domain) || ASCII(domain)
 * || len(schema) || ASCII(schema) || UTF8(canonical-json-v1(payload)).
 *
 * The payload is the last field and ends at end-of-input; therefore it needs
 * neither a total-length pre-pass nor chunk markers. Transport chunk size
 * never enters the preimage. Domain/schema names are protocol identifiers,
 * not file paths. This constructor returns ONLY the header; the canonical
 * owner supplies the payload without changing its existing value encoding.
 */
export function identityFrameHeader(domain: string, schema: string): Uint8Array {
  requireNamespace(domain, 'Identity domain');
  requireNamespace(schema, 'Identity schema');
  const header = Buffer.alloc(PREFIX.length + 4 + domain.length + schema.length);
  let offset = PREFIX.copy(header);
  header.writeUInt16BE(domain.length, offset); offset += 2;
  offset += header.write(domain, offset, 'ascii');
  header.writeUInt16BE(schema.length, offset); offset += 2;
  header.write(schema, offset, 'ascii');
  return header;
}

/** Capture exact own data rather than invoking caller getters/proxy traps.
 * Expected domain/schema come from the consuming owner, never from this
 * untrusted record. Parsing establishes representation, not preimage truth.
 */
export function parseIdentity<Domain extends string, Schema extends string>(
  value: unknown,
  domain: Domain,
  schema: Schema
): Identity<Domain, Schema> {
  requireNamespace(domain, 'Identity domain');
  requireNamespace(schema, 'Identity schema');
  if (value === null || typeof value !== 'object' || nativeTypes.isProxy(value) || Array.isArray(value)) {
    throw new TypeError('Identity must be one ordinary data object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) throw new TypeError('Identity must be one ordinary data object');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== IDENTITY_KEYS.length || keys.some(key => !IDENTITY_KEYS.includes(key as typeof IDENTITY_KEYS[number]))) {
    throw new TypeError('Identity contains missing or unknown fields');
  }
  const fields: unknown[] = [];
  for (const key of IDENTITY_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      throw new TypeError('Identity fields must be enumerable own data');
    }
    fields.push(descriptor.value);
  }
  if (fields[0] !== IDENTITY_PROFILE || fields[1] !== domain || fields[2] !== schema) {
    throw new TypeError('Identity profile, domain or schema does not match its consumer');
  }
  const digest = parseDigest(fields[3], 'blake3');
  return Object.freeze({ profile: IDENTITY_PROFILE, domain, schema, digest }) as Identity<Domain, Schema>;
}
