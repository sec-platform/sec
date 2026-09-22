import { canonicalEncodingChunks } from './canonical.ts';
import { createSha256Hasher, parseDigest, type Digest } from './digest.ts';
import {
  assertContentDigestRuntime,
  type ContentDigestRuntime
} from './content-digest.ts';
import {
  IDENTITY_PROFILE,
  identityFrameHeader,
  parseIdentity,
  type Identity
} from './identity-profile.ts';

export type StructuredIdentityMigration<
  Domain extends string,
  Schema extends string
> = Readonly<{
  previous: Digest<'sha256'>;
  current: Identity<Domain, Schema>;
}>;

const ISSUED_STRUCTURED_IDENTITY_RUNTIMES = new WeakSet<object>();

export type StructuredIdentityRuntime = Readonly<{
  structuredIdentity<Domain extends string, Schema extends string>(
    domain: Domain,
    schema: Schema,
    value: unknown
  ): Identity<Domain, Schema>;
  verifyStructuredIdentity<Domain extends string, Schema extends string>(
    identity: unknown,
    domain: Domain,
    schema: Schema,
    value: unknown
  ): boolean;
  migrateStructuredIdentity<Domain extends string, Schema extends string>(
    previous: unknown,
    domain: Domain,
    schema: Schema,
    value: unknown
  ): StructuredIdentityMigration<Domain, Schema>;
}>;

/** Bind structured identity to one already-qualified content runtime. Provider
 * selection is a bootstrap concern and cannot vary per identity call. */
export function createStructuredIdentityRuntime(
  content: ContentDigestRuntime
): StructuredIdentityRuntime {
  assertContentDigestRuntime(content);

  const structuredIdentity = <Domain extends string, Schema extends string>(
    domain: Domain,
    schema: Schema,
    value: unknown
  ): Identity<Domain, Schema> => {
    const header = identityFrameHeader(domain, schema);
    const hash = content.createContentHasher();
    try {
      hash.update(header);
      for (const chunk of canonicalEncodingChunks(value)) hash.update(chunk);
      return parseIdentity({
        profile: IDENTITY_PROFILE,
        domain,
        schema,
        digest: hash.finish()
      }, domain, schema);
    } finally {
      hash.dispose();
    }
  };

  const verifyStructuredIdentity = <Domain extends string, Schema extends string>(
    identity: unknown,
    domain: Domain,
    schema: Schema,
    value: unknown
  ): boolean => {
    const captured = parseIdentity(identity, domain, schema);
    return captured.digest === structuredIdentity(domain, schema, value).digest;
  };

  const migrateStructuredIdentity = <
    Domain extends string,
    Schema extends string
  >(
    previous: unknown,
    domain: Domain,
    schema: Schema,
    value: unknown
  ): StructuredIdentityMigration<Domain, Schema> => {
    const expected = parseDigest(previous, 'sha256');
    const legacy = createSha256Hasher();
    const current = content.createContentHasher();
    try {
      current.update(identityFrameHeader(domain, schema));
      // One canonical traversal is shared by both algorithms. A caller getter,
      // mutable object or concurrent producer cannot supply two different
      // payloads to the legacy verification and the replacement identity.
      for (const chunk of canonicalEncodingChunks(value)) {
        legacy.update(chunk);
        current.update(chunk);
      }
      const observed = legacy.finish();
      if (observed !== expected) {
        throw new Error(
          'Structured identity migration preimage does not match the retained SHA-256'
        );
      }
      const identity = parseIdentity({
        profile: IDENTITY_PROFILE,
        domain,
        schema,
        digest: current.finish()
      }, domain, schema);
      return Object.freeze({ previous: expected, current: identity });
    } finally {
      legacy.dispose();
      current.dispose();
    }
  };

  const runtime = Object.freeze({
    structuredIdentity,
    verifyStructuredIdentity,
    migrateStructuredIdentity
  });
  ISSUED_STRUCTURED_IDENTITY_RUNTIMES.add(runtime);
  return runtime;
}


export function assertStructuredIdentityRuntime(
  value: unknown
): asserts value is StructuredIdentityRuntime {
  if (value === null || typeof value !== 'object'
      || !ISSUED_STRUCTURED_IDENTITY_RUNTIMES.has(value)) {
    throw new TypeError(
      'Structured identity issuance requires an owner-issued structured identity runtime'
    );
  }
}
