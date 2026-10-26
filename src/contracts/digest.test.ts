import { settleResources, type ResourceSettlementFailure } from '../execution/resource-settlement.ts';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { digest, rawSha256, sha256 } from './canonical.ts';
import { createSha256Hasher, isDigest, isDigestHex, parseDigest, type Digest } from './digest.ts';

const abc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

test('digest grammar requires an explicit supported algorithm and exact lowercase bytes', () => {
  for (const algorithm of ['sha256', 'blake3'] as const) {
    const value = `${algorithm}:${abc}`;
    assert.equal(parseDigest(value, algorithm), value);
    assert.equal(isDigest(value, algorithm), true);
    assert.equal(isDigest(value, algorithm === 'sha256' ? 'blake3' : 'sha256'), false);
  }
  const shaValue = `sha256:${abc}`;
  for (const invalid of [null, undefined, 1, {}, new String(shaValue), shaValue.toUpperCase(),
    ` ${shaValue}`, `${shaValue}\n`, `${shaValue}\r`, `${shaValue}\u2028`, shaValue.slice(0, -1), `${shaValue}0`,
    shaValue.replace(':', '：'), `sha256:${'g'.repeat(64)}`, abc]) {
    assert.equal(isDigest(invalid, 'sha256'), false);
  }
  assert.throws(() => parseDigest(shaValue.slice(0, -1), 'sha256'), TypeError);
  assert.equal(isDigest(`sha256:${abc}`, '__proto__' as never), false);
  assert.equal(isDigest(`sha256:${abc}`, 'sha1' as never), false);
  assert.equal(isDigestHex(abc), true);
  assert.equal(isDigestHex(`${'a'.repeat(63)}\n`), false);
  assert.equal(isDigestHex(`sha256:${abc}`), false);
  const value = parseDigest(`sha256:${abc}`, 'sha256');
  const sha: Digest<'sha256'> = value;
  // @ts-expect-error algorithm is part of the type, not just a shared 32-byte payload
  const b3: Digest<'blake3'> = value;
  void sha; void b3;
});

test('legacy raw SHA-256 still hashes bytes, not JSON strings', () => {
  assert.equal(digest('abc'), abc);
  assert.equal(rawSha256('abc'), `sha256:${abc}`);
  assert.equal(rawSha256(''), 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.notEqual(sha256('abc'), rawSha256('abc'));
  assert.equal(sha256({ b: 2, a: 1 }), 'sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777');
});

test('incremental hash is independent of binary chunk boundaries and source offsets', () => {
  const source = Buffer.alloc(4099);
  for (let i = 0; i < source.length; i += 1) source[i] = i % 251;
  const bytes = new Uint8Array(source.buffer, source.byteOffset + 3, 4093);
  const expected = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  assert.equal(rawSha256(bytes), expected);
  const hash = createSha256Hasher();
  let fixtureFailure1: ResourceSettlementFailure | undefined;
  try {
    hash.update(new Uint8Array());
    for (let offset = 0; offset < bytes.length; offset += 63) {
      hash.update(bytes.subarray(offset, Math.min(offset + 63, bytes.length)));
    }
    assert.equal(hash.finish(), expected);
  } catch (error) {
    fixtureFailure1 = { label: 'fixture operation', error };
  } finally {
    settleResources({
      primary: fixtureFailure1,
      cleanup: [{ label: 'fixture cleanup', settle: () => { hash.dispose(); } }]
    });
  }
});

test('separate computations never share incremental state', () => {
  const left = createSha256Hasher(), right = createSha256Hasher();
  left.update('a'); right.update('x'); left.update('bc'); right.update('yz');
  assert.equal(left.finish(), rawSha256('abc'));
  assert.equal(right.finish(), rawSha256('xyz'));
});

test('finish, failure and explicit disposal are terminal', () => {
  const finished = createSha256Hasher();
  finished.finish();
  assert.throws(() => finished.update('later'), /no longer open/u);
  assert.throws(() => finished.finish(), /no longer open/u);
  finished.dispose(); finished.dispose();
  const failed = createSha256Hasher();
  assert.throws(() => failed.update({} as Uint8Array), TypeError);
  assert.throws(() => failed.finish(), /no longer open/u);
  const disposed = createSha256Hasher();
  disposed.dispose();
  assert.throws(() => disposed.update('later'), /no longer open/u);
});

test('canonical errors do not poison subsequent computations', () => {
  const cyclic: unknown[] = []; cyclic.push(cyclic);
  assert.throws(() => sha256(cyclic));
  assert.equal(sha256({ a: 1 }), rawSha256('{"a":1}'));
});
