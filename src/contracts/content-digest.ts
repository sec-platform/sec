import { borrowByteView } from './byte-snapshot.ts';
import {
  captureContentHashProvider,
  type ContentHashProvider,
  type ContentHashProviderDescriptor
} from './content-hash-provider.ts';
import { createSha256Hasher, parseDigest, type Digest, type Hasher } from './digest.ts';

/** Raw, unkeyed BLAKE3-256 over content bytes. This is not a structured
 * identity, Git object name, signature, or authority to replace stored data. */
declare const contentBrand: unique symbol;
export type ContentDigest = Digest<'blake3'> & { readonly [contentBrand]: 'content' };
export interface ContentHasher extends Hasher<'blake3'> {
  finish(): ContentDigest;
}

export interface ContentDigestMigration {
  readonly previous: Digest<'sha256'>;
  readonly current: ContentDigest;
}

export type ContentDigestRuntime = Readonly<{
  readonly provider: ContentHashProviderDescriptor;
  createContentHasher(): ContentHasher;
  contentDigest(value: string | Uint8Array): ContentDigest;
  migrateContentDigest(
    previous: unknown,
    chunks: Iterable<Uint8Array>
  ): ContentDigestMigration;
}>;

const ISSUED_CONTENT_DIGEST_RUNTIMES = new WeakSet<object>();

/** Parse a representation only; verification still requires the preimage. */
export function parseContentDigest(value: unknown): ContentDigest {
  return parseDigest(value, 'blake3') as ContentDigest;
}

function contentBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string'
    ? Buffer.from(value, 'utf8')
    : borrowByteView(value, 'Content digest input');
}

/** Ordinary synchronous identity hashing deliberately admits only a provider
 * that consumes one CPU thread and does not retain caller bytes after update.
 * Parallel or threaded providers require a separate execution-owned resource
 * grant; they cannot be smuggled into this zero-scheduler path. */
export function createContentDigestRuntime(
  candidate: ContentHashProvider
): ContentDigestRuntime {
  const provider = captureContentHashProvider(candidate);
  if (provider.descriptor.parallelism !== 'single-thread') {
    throw new Error(
      'Synchronous content identity requires a single-thread provider; managed parallelism belongs to execution admission'
    );
  }

  const createContentHasher = (): ContentHasher => {
    let engine: ReturnType<typeof provider.create> | undefined = provider.create();
    let consumed = 0;
    function open(): NonNullable<typeof engine> {
      if (engine === undefined) throw new Error('Content hasher is no longer open');
      return engine;
    }
    function dispose(): void {
      const current = engine;
      engine = undefined;
      current?.destroy();
    }
    return Object.freeze({
      update(value: string | Uint8Array): void {
        const current = open();
        try {
          const bytes = contentBytes(value);
          if (bytes.byteLength > Number.MAX_SAFE_INTEGER - consumed) {
            throw new RangeError(
              'Content hash exceeds the exact JavaScript byte-counter limit'
            );
          }
          current.update(bytes);
          consumed += bytes.byteLength;
        } catch (error) {
          dispose();
          throw error;
        }
      },
      finish(): ContentDigest {
        const current = open();
        engine = undefined;
        try {
          const bytes = current.digest();
          if (bytes.byteLength !== provider.descriptor.outputBytes) {
            throw new Error('BLAKE3 provider returned an invalid output length');
          }
          return parseContentDigest(
            `blake3:${Buffer.from(bytes).toString('hex')}`
          );
        } finally {
          current.destroy();
        }
      },
      dispose
    });
  };

  const contentDigest = (value: string | Uint8Array): ContentDigest => {
    const hash = createContentHasher();
    try {
      hash.update(value);
      return hash.finish();
    } finally {
      hash.dispose();
    }
  };

  const migrateContentDigest = (
    previous: unknown,
    chunks: Iterable<Uint8Array>
  ): ContentDigestMigration => {
    const expected = parseDigest(previous, 'sha256');
    const legacy = createSha256Hasher();
    let current: ContentHasher | undefined;
    try {
      current = createContentHasher();
      for (const chunk of chunks) {
        const bytes = borrowByteView(chunk, 'Content migration chunk');
        legacy.update(bytes);
        current.update(bytes);
      }
      if (legacy.finish() !== expected) {
        throw new Error(
          'Content migration preimage does not match the retained SHA-256'
        );
      }
      return Object.freeze({ previous: expected, current: current.finish() });
    } finally {
      legacy.dispose();
      current?.dispose();
    }
  };

  const runtime = Object.freeze({
    provider: provider.descriptor,
    createContentHasher,
    contentDigest,
    migrateContentDigest
  });
  ISSUED_CONTENT_DIGEST_RUNTIMES.add(runtime);
  return runtime;
}

export function assertContentDigestRuntime(
  value: unknown
): asserts value is ContentDigestRuntime {
  if (value === null || typeof value !== 'object'
      || !ISSUED_CONTENT_DIGEST_RUNTIMES.has(value)) {
    throw new TypeError(
      'Structured identity requires a content digest runtime issued by its contract owner'
    );
  }
}
