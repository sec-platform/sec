import { createHash } from 'node:crypto';

/** Algorithms admitted by the digest grammar, not a caller-selected identity
 * profile. Git object names belong to git-object-id.ts, never this namespace. */
export type DigestAlgorithm = 'sha256' | 'blake3';

declare const digestBrand: unique symbol;
export type Digest<Algorithm extends DigestAlgorithm = DigestAlgorithm> =
  `${Algorithm}:${string}` & { readonly [digestBrand]: Algorithm };

const NON_LOWERCASE_HEX = /[^0-9a-f]/u;

/** Exact 256-bit hexadecimal representation. This does not assert provenance,
 * algorithm, a preimage, authenticity, or the existence of an object. */
export function isDigest256Hex(value: unknown): value is string {
  return typeof value === 'string' && value.length === 64 && !NON_LOWERCASE_HEX.test(value);
}

/** No trimming, case folding, algorithm guessing, or implicit upgrading. */
export function isDigest<Algorithm extends DigestAlgorithm>(
  value: unknown,
  algorithm: Algorithm
): value is Digest<Algorithm> {
  if (algorithm !== 'sha256' && algorithm !== 'blake3') return false;
  return typeof value === 'string' && value.startsWith(`${algorithm}:`)
    && value.length === algorithm.length + 65
    && isDigest256Hex(value.slice(algorithm.length + 1));
}

export function parseDigest<Algorithm extends DigestAlgorithm>(
  value: unknown,
  algorithm: Algorithm
): Digest<Algorithm> {
  if (!isDigest(value, algorithm)) throw new TypeError('Digest does not match its required algorithm and canonical encoding');
  return value;
}

/** A single-owner incremental computation, never an IO or authority handle.
 * finish is terminal; dispose is idempotent. A failed update is terminal too.
 * No key, output-length, reset, serialization, or mutable provider is exposed. */
export interface Hasher<Algorithm extends DigestAlgorithm> {
  update(value: string | Uint8Array): void;
  finish(): Digest<Algorithm>;
  dispose(): void;
}

/** Fixed legacy/external SHA-256 provider. The BLAKE3 spelling accepted by the
 * parser above is NOT evidence that a BLAKE3 provider has been installed.
 * Strings are UTF-8 writes; callers must not split a surrogate pair between
 * writes. Binary chunk boundaries have no effect on the result. */
export function createSha256Hasher(): Hasher<'sha256'> {
  let hash: ReturnType<typeof createHash> | undefined = createHash('sha256');
  function takeOpenHash(): ReturnType<typeof createHash> {
    if (hash === undefined) throw new Error('Hasher is no longer open');
    return hash;
  }
  function dispose(): void {
    // node:crypto owns native cleanup. Drop our reference; do not claim this
    // is a key-erasure guarantee or acquire stream/IO lifecycle semantics.
    hash = undefined;
  }
  return Object.freeze({
    update(value: string | Uint8Array): void {
      const current = takeOpenHash();
      try {
        current.update(value);
      } catch (error) {
        dispose();
        throw error;
      }
    },
    finish(): Digest<'sha256'> {
      const current = takeOpenHash();
      dispose();
      return parseDigest(`sha256:${current.digest('hex')}`, 'sha256');
    },
    dispose
  });
}
