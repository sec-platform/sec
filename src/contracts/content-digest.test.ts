import { settleResources, type ResourceSettlementFailure } from '../execution/resource-settlement.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createContentIdentityRuntime } from '../bootstrap/content-identity-runtime.ts';

import { rawSha256 } from './canonical.ts';
import { parseContentDigest } from './content-digest.ts';

const vectors = JSON.parse(readFileSync(new URL('../../tests/fixtures/identity/blake3-256-vectors.json', import.meta.url), 'utf8')) as {
  cases: Array<{ inputBytes: number; hex: string }>;
};
function input(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => i % 251);
}

const CONTENT = createContentIdentityRuntime().content;
const {
  contentDigest,
  createContentHasher,
  migrateContentDigest
} = CONTENT;

test('bootstrap binds the adopted single-thread WASM/SIMD execution profile', () => {
  assert.equal(CONTENT.provider.algorithm, 'blake3-256');
  assert.equal(CONTENT.provider.outputBytes, 32);
  assert.equal(CONTENT.provider.streaming, true);
  assert.equal(CONTENT.provider.updateInputLifetime, 'call-only');
  assert.equal(CONTENT.provider.backend, 'wasm-simd');
  assert.equal(CONTENT.provider.parallelism, 'single-thread');
});

for (const vector of vectors.cases) {
  test(`BLAKE3 official unkeyed 256-bit vector: ${vector.inputBytes} bytes`, () => {
    assert.equal(contentDigest(input(vector.inputBytes)), `blake3:${vector.hex}`);
  });
}

test('streaming is invariant around compression and tree-chunk boundaries', () => {
  // One-shot vectors above own algorithm conformance. Keep the multi-chunk
  // adapter witness at every partition size without their Cartesian product.
  const { inputBytes, hex } = vectors.cases.find(vector => vector.inputBytes === 4097)!;
  const bytes = input(inputBytes);
  for (const chunkSize of [1, 7, 63, 64, 65, 1023, 1024, 1025, 4096]) {
    const hash = createContentHasher();
    let fixtureFailure1: ResourceSettlementFailure | undefined;
    try {
      hash.update(new Uint8Array());
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        hash.update(bytes.subarray(offset, offset + chunkSize));
      }
      assert.equal(hash.finish(), `blake3:${hex}`);
    } catch (error) {
      fixtureFailure1 = { label: 'fixture operation', error };
    } finally {
      settleResources({
        primary: fixtureFailure1,
        cleanup: [{ label: 'fixture cleanup', settle: () => { hash.dispose(); } }]
      });
    }
  }
});

test('offset views, Buffer and cross-realm Uint8Array preserve actual bytes', () => {
  const bytes = input(1025);
  const expected = contentDigest(bytes);
  const source = Buffer.concat([Buffer.from([255, 255, 255]), Buffer.from(bytes), Buffer.from([255])]);
  const offset = new Uint8Array(source.buffer, source.byteOffset + 3, 1025);
  assert.equal(contentDigest(offset), expected);
  assert.equal(contentDigest(Buffer.from(bytes)), expected);
  assert.equal(contentDigest(runInNewContext('new Uint8Array([0, 1, 2])')), contentDigest(input(3)));
  Object.defineProperty(offset, 'byteLength', { get() { throw new Error('shadow getter'); } });
  Object.defineProperty(offset, Symbol.iterator, { get() { throw new Error('shadow iterator'); } });
  assert.equal(contentDigest(offset), expected);
});

test('updates own their partial block bytes and do not share computation state', () => {
  const a = createContentHasher(), b = createContentHasher();
  const bytes = input(63);
  a.update(bytes); bytes.fill(255);
  b.update('other');
  assert.equal(a.finish(), contentDigest(input(63)));
  assert.equal(b.finish(), contentDigest('other'));
});

test('finish and dispose are terminal', () => {
  const hash = createContentHasher();
  hash.finish();
  assert.throws(() => hash.finish(), /no longer open/u);
  assert.throws(() => hash.update('more'), /no longer open/u);
  hash.dispose(); hash.dispose();
  const abandoned = createContentHasher();
  abandoned.update('partial'); abandoned.dispose();
  assert.throws(() => abandoned.finish(), /no longer open/u);
});

test('invalid, shared and detached byte inputs fail closed and terminate the computation', () => {
  const detached = new Uint8Array(8);
  structuredClone(detached.buffer, { transfer: [detached.buffer] });
  const invalid = [{}, new Uint16Array(2), new DataView(new ArrayBuffer(8)),
    new Uint8Array(new SharedArrayBuffer(8)), detached, new Proxy(new Uint8Array(2), {})];
  for (const value of invalid) {
    const hash = createContentHasher();
    assert.throws(() => hash.update(value as Uint8Array), TypeError);
    assert.throws(() => hash.finish(), /no longer open/u);
  }
});

test('strings use UTF-8, with no key, length or algorithm setting exposed', () => {
  assert.equal(contentDigest('é😀'), contentDigest(Buffer.from('é😀', 'utf8')));
  assert.match(contentDigest(''), /^blake3:[0-9a-f]{64}$/u);
  assert.throws(() => parseContentDigest(rawSha256('')), TypeError);
});

test('migration verifies the same raw bytes before exposing the new digest', () => {
  const bytes = input(4097);
  const previous = rawSha256(bytes);
  const current = contentDigest(bytes);
  const migrated = migrateContentDigest(previous, [bytes.subarray(0, 1023), bytes.subarray(1023)]);
  assert.deepEqual(migrated, { previous, current });
  assert.throws(() => migrateContentDigest(current, [bytes]), TypeError);
  assert.throws(() => migrateContentDigest(previous, [Buffer.from(previous)]), /preimage does not match/u);
});

test('migration has one input traversal, closes on iterator failure, and handles empty bytes', () => {
  let reads = 0, closes = 0;
  function* chunks() {
    try { reads += 1; yield input(64); throw new Error('source failed'); }
    finally { closes += 1; }
  }
  assert.throws(() => migrateContentDigest(rawSha256(input(64)), chunks()), /source failed/u);
  assert.equal(reads, 1); assert.equal(closes, 1);
  assert.equal(migrateContentDigest(rawSha256(''), []).current, contentDigest(''));
});
