import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canonicalEncodingChunks, rawSha256, sha256 } from './canonical.ts';
import { createContentIdentityRuntime } from '../bootstrap/content-identity-runtime.ts';
import { identityFrameHeader, parseIdentity } from './identity-profile.ts';
import { assertStructuredIdentityRuntime } from './structured-identity.ts';

const RUNTIME = createContentIdentityRuntime();
const { contentDigest } = RUNTIME.content;
const { structuredIdentity, verifyStructuredIdentity, migrateStructuredIdentity } = RUNTIME.identity;

test('structured identity hashes the exact independent frame-plus-payload preimage', () => {
  const value = { b: '😀', a: 1 };
  const frame = Buffer.concat([identityFrameHeader('evidence', 'record/v2'), Buffer.from('{"a":1,"b":"😀"}', 'utf8')]);
  assert.equal(structuredIdentity('evidence', 'record/v2', value).digest, contentDigest(frame));
});

test('equal payloads cannot cross domain, schema or raw-content boundaries', () => {
  const value = { a: 1 };
  const identity = structuredIdentity('evidence', 'record/v2', value);
  assert.notEqual(identity.digest, structuredIdentity('revision', 'record/v2', value).digest);
  assert.notEqual(identity.digest, structuredIdentity('evidence', 'record/v3', value).digest);
  assert.notEqual(identity.digest, contentDigest([...canonicalEncodingChunks(value)].join('')));
  assert.throws(() => parseIdentity(identity, 'revision', 'record/v2'), TypeError);
});

test('canonical key order and encoding remain shared rather than independently reimplemented', () => {
  assert.deepEqual(structuredIdentity('cache', 'key/v1', { z: 1, a: 2 }),
    structuredIdentity('cache', 'key/v1', { a: 2, z: 1 }));
  const value = `${'a'.repeat(8191)}😀`;
  const preimage = Buffer.concat([identityFrameHeader('cache', 'key/v1'), Buffer.from(JSON.stringify(value))]);
  assert.equal(structuredIdentity('cache', 'key/v1', value).digest, contentDigest(preimage));
});

test('verification distinguishes malformed metadata from mismatching content', () => {
  const identity = structuredIdentity('artifact', 'manifest/v2', { a: 1 });
  assert.equal(verifyStructuredIdentity(identity, 'artifact', 'manifest/v2', { a: 1 }), true);
  assert.equal(verifyStructuredIdentity(identity, 'artifact', 'manifest/v2', { a: 2 }), false);
  assert.throws(() => verifyStructuredIdentity({ ...identity, digest: rawSha256('bytes') },
    'artifact', 'manifest/v2', { a: 1 }), TypeError);
  assert.throws(() => verifyStructuredIdentity(identity, 'artifact', 'manifest/v1', { a: 1 }), TypeError);
});

test('serialization errors cannot return partial identities or poison future requests', () => {
  const circular: unknown[] = []; circular.push(circular);
  assert.throws(() => structuredIdentity('cache', 'key/v1', circular));
  assert.throws(() => structuredIdentity('cache', 'key/v1', { unsupported: undefined }));
  assert.equal(verifyStructuredIdentity(structuredIdentity('cache', 'key/v1', null), 'cache', 'key/v1', null), true);
});


test('structured migration verifies legacy SHA-256 and emits framed BLAKE3 from one payload traversal', () => {
  let reads = 0;
  const value: Record<string, unknown> = {};
  Object.defineProperty(value, 'a', {
    enumerable: true,
    get() {
      reads += 1;
      return 1;
    }
  });
  const previous = sha256({ a: 1 });
  const migrated = migrateStructuredIdentity(
    previous,
    'cache',
    'record/v2',
    value
  );
  assert.equal(reads, 1);
  assert.equal(migrated.previous, previous);
  assert.deepEqual(
    migrated.current,
    structuredIdentity('cache', 'record/v2', { a: 1 })
  );
  assert.equal(Object.isFrozen(migrated), true);
});

test('structured migration rejects wrong preimages and mixed generations before a new identity escapes', () => {
  assert.throws(
    () => migrateStructuredIdentity(
      sha256({ a: 2 }),
      'cache',
      'record/v2',
      { a: 1 }
    ),
    /preimage does not match/u
  );
  const current = structuredIdentity('cache', 'record/v2', { a: 1 });
  assert.throws(
    () => migrateStructuredIdentity(
      current.digest,
      'cache',
      'record/v2',
      { a: 1 }
    ),
    TypeError
  );
  assert.throws(
    () => migrateStructuredIdentity(
      sha256({ a: 1 }),
      'cache',
      'record/v2',
      { a: 1, b: 2 }
    ),
    /preimage does not match/u
  );
});


test('structured identity runtime origin cannot be reconstructed structurally', () => {
  assert.doesNotThrow(() => assertStructuredIdentityRuntime(RUNTIME.identity));
  assert.throws(
    () => assertStructuredIdentityRuntime({ ...RUNTIME.identity }),
    /owner-issued structured identity runtime/u
  );
});
