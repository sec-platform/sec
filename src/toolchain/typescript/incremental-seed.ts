import { rawSha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import { snapshotByteView } from '../../system-architecture/foundation/runtime/byte-snapshot.ts';

// This cache family owns its layout and capacities. No caller override or new
// generation policy is introduced; the existing 64 MiB payload ceiling stays.
export const BUILD_INFO_FILE_NAME = 'tsconfig.tsbuildinfo' as const;
export const BUILD_INFO_MAXIMUM_BYTES = 64 * 1024 * 1024;
export const STABLE_SEED_MAXIMUM_BYTES = Math.ceil(BUILD_INFO_MAXIMUM_BYTES * 4 / 3) + 1024;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;

export function assertSeedBindingDigest(value: unknown): asserts value is `sha256:${string}` {
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    throw new TypeError('TypeScript incremental seed binding must be one canonical digest.');
  }
}

function seedEnvelope(payloadBase64: string, payloadDigest: `sha256:${string}`, bindingDigest: `sha256:${string}`) {
  return { schema: 'sec-typescript-incremental-seed-v1' as const, bindingDigest, payloadDigest, payloadBase64 };
}

function canonicalSeedBytes(envelope: ReturnType<typeof seedEnvelope>): Buffer {
  return Buffer.from(`${JSON.stringify(envelope)}\n`, 'utf8');
}

/** A disposable cache encoding, not an execution receipt. Hash and encode the
 * same owned bytes; caller iterators and public byteLength fields are not data. */
export function encodeStableSeed(payload: Uint8Array, bindingDigest: `sha256:${string}`): Buffer {
  assertSeedBindingDigest(bindingDigest);
  const bytes = snapshotByteView(payload, 'TypeScript incremental payload', BUILD_INFO_MAXIMUM_BYTES);
  return canonicalSeedBytes(seedEnvelope(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'), rawSha256(bytes), bindingDigest));
}

/** Invalid cache data selects cold execution. JSON and base64 decoding use
 * native implementations; exact canonical re-encoding rejects duplicate keys,
 * ignored whitespace, alternate base64 spellings and other lossy acceptance.
 * The byte ceiling is checked before each allocation controlled by this owner.
 */
export function parseStableSeed(bytes: Uint8Array, expectedBindingDigest: `sha256:${string}`): Buffer | null {
  assertSeedBindingDigest(expectedBindingDigest);
  let source: Uint8Array;
  let parsed: unknown;
  try {
    source = snapshotByteView(bytes, 'TypeScript incremental seed', STABLE_SEED_MAXIMUM_BYTES);
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(source));
  } catch { return null; }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== 'bindingDigest,payloadBase64,payloadDigest,schema'
      || value.schema !== 'sec-typescript-incremental-seed-v1'
      || value.bindingDigest !== expectedBindingDigest
      || typeof value.payloadBase64 !== 'string'
      || typeof value.payloadDigest !== 'string' || !DIGEST.test(value.payloadDigest)) return null;
  const encoded = value.payloadBase64;
  // Canonical base64 uses complete groups of four. Compute its declared byte
  // length before native decoding, then still require an exact round trip.
  if (encoded.length % 4 !== 0) return null;
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const declaredBytes = encoded.length / 4 * 3 - padding;
  if (declaredBytes < 0 || declaredBytes > BUILD_INFO_MAXIMUM_BYTES) return null;
  const payload = Buffer.from(encoded, 'base64');
  if (payload.byteLength !== declaredBytes || payload.toString('base64') !== encoded
      || rawSha256(payload) !== value.payloadDigest) return null;
  const canonical = canonicalSeedBytes(seedEnvelope(encoded, value.payloadDigest as `sha256:${string}`, expectedBindingDigest));
  return Buffer.from(source.buffer, source.byteOffset, source.byteLength).equals(canonical) ? payload : null;
}
