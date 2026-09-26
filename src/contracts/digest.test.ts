import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { rawSha256Hex, rawSha256, sha256 } from './canonical.ts';
import { createSha256Hasher, isDigest, isDigest256Hex, parseDigest, type Digest } from './digest.ts';

const abc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

test('digest grammar requires an explicit supported algorithm and exact lowercase bytes', () => {
  for (const algorithm of ['sha256', 'blake3'] as const) {
    const value = `${algorithm}:${abc}`;
    assert.equal(parseDigest(value, algorithm), value);
    assert.equal(isDigest(value, algorithm), true);
    for (const invalid of [null, undefined, 1, {}, new String(value), value.toUpperCase(),
      ` ${value}`, `${value}\n`, `${value}\r`, `${value}\u2028`, value.slice(0, -1), `${value}0`,
      value.replace(':', '：'), `${algorithm}:${'g'.repeat(64)}`, abc]) {
      assert.equal(isDigest(invalid, algorithm), false);
      assert.throws(() => parseDigest(invalid, algorithm), TypeError);
    }
    assert.equal(isDigest(value, algorithm === 'sha256' ? 'blake3' : 'sha256'), false);
  }
  assert.equal(isDigest(`sha256:${abc}`, '__proto__' as never), false);
  assert.equal(isDigest(`sha256:${abc}`, 'sha1' as never), false);
  assert.equal(isDigest256Hex(abc), true);
  assert.equal(isDigest256Hex(`${'a'.repeat(63)}\n`), false);
  assert.equal(isDigest256Hex(`sha256:${abc}`), false);
});

test('legacy raw SHA-256 still hashes bytes, not JSON strings', () => {
  assert.equal(rawSha256Hex('abc'), abc);
  assert.equal(rawSha256('abc'), `sha256:${abc}`);
  assert.equal(rawSha256(''), 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.notEqual(sha256('abc'), rawSha256('abc'));
});

test('incremental hash is independent of binary chunk boundaries and source offsets', () => {
  const source = Buffer.alloc(4099);
  for (let i = 0; i < source.length; i += 1) source[i] = i % 251;
  const bytes = new Uint8Array(source.buffer, source.byteOffset + 3, 4093);
  const expected = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  assert.equal(rawSha256(bytes), expected);
  for (const size of [1, 7, 63, 64, 65, 1023, 1024, 1025, 4096]) {
    const hash = createSha256Hasher();
    try {
      hash.update(new Uint8Array());
      for (let offset = 0; offset < bytes.length; offset += size) {
        hash.update(bytes.subarray(offset, Math.min(offset + size, bytes.length)));
      }
      assert.equal(hash.finish(), expected);
    } finally {
      hash.dispose();
    }
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
  assert.equal(Object.isFrozen(disposed), true);
});

test('canonical hashing preserves scalar, key-order, sparse-array and Unicode encoding', () => {
  const cases: Array<readonly [unknown, string]> = [
    [null, 'null'], [-0, '0'], [true, 'true'], ['é😀', '"é😀"'],
    [{ b: 2, a: 1 }, '{"a":1,"b":2}'],
    [{ '10': 'ten', '2': 'two', a: 1 }, '{"2":"two","10":"ten","a":1}'],
    [new Array(3), '[null,null,null]'],
    [JSON.parse('{"__proto__":{"b":2,"a":1},"x":0}'), '{"__proto__":{"a":1,"b":2},"x":0}']
  ];
  for (const [input, encoded] of cases) {
    assert.equal(sha256(input), rawSha256(encoded));
  }
  assert.equal(sha256({ b: 2, a: 1 }), 'sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777');
  const str = `${'x'.repeat(8190)}😀${'y'.repeat(8190)}`;
  assert.equal(sha256([str, str]), rawSha256(JSON.stringify([str, str])));
});

test('canonical errors do not poison subsequent computations', () => {
  const cyclic: unknown[] = []; cyclic.push(cyclic);
  for (const value of [undefined, NaN, Infinity, 1n, () => 1, Symbol(), new Date(), cyclic]) {
    assert.throws(() => sha256(value));
  }
  assert.equal(sha256({ a: 1 }), rawSha256('{"a":1}'));
});

test('canonical hashing remains stack-safe and preserves shared acyclic values', () => {
  const shared = { z: 1 };
  assert.equal(sha256([shared, shared]), rawSha256('[{"z":1},{"z":1}]'));
  let deep: unknown = null;
  for (let index = 0; index < 20_000; index += 1) deep = [deep];
  assert.equal(sha256(deep), rawSha256(`${'['.repeat(20_000)}null${']'.repeat(20_000)}`));
});

test('algorithm brands are not interchangeable', () => {
  const value = parseDigest(`sha256:${abc}`, 'sha256');
  const sha: Digest<'sha256'> = value;
  // @ts-expect-error algorithm is part of the type, not just a shared 32-byte payload
  const b3: Digest<'blake3'> = value;
  void sha; void b3;
});
