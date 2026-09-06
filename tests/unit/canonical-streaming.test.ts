import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'bun:test';
import { canonicalJson, canonicalEquals, sha256 } from '../../src/system-architecture/foundation/runtime/canonical.ts';

const reference = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(canonicalJson(value))).digest('hex')}`;

test('canonical hashes preserve exact historical bytes for structured and scalar data', () => {
  const samples: unknown[] = [null, false, true, 0, -0, 1.2e30, '', '𝄞\ud800\n', [], new Array(3),
    { '11': 3, '2': 4, z: 2, a: 1 }, JSON.parse('{"__proto__":{"value":1}}')];
  let seed = 521;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let i = 0; i < 1000; i++) samples.push({ [String(next() % 30)]: next(), z: [next() % 2 === 0, `${next()}𝄞`], a: { value: next() / 1000 } });
  for (const value of samples) assert.equal(sha256(value), reference(value));
});

test('hashing and equality reach a 30000-container input without native recursion', () => {
  let first: unknown = 7, second: unknown = 7;
  for (let i = 0; i < 30000; i++) { first = [first]; second = [second]; }
  const expected = `sha256:${createHash('sha256').update('['.repeat(30000) + '7' + ']'.repeat(30000)).digest('hex')}`;
  assert.equal(sha256(first), expected);
  assert.equal(canonicalEquals(first, second), true);
});

test('canonical equality preserves normalized object order, holes, numbers and shared subtrees', () => {
  assert.ok(canonicalEquals({ z: -0, a: new Array(2) }, { a: [null, null], z: 0 }));
  const shared = { a: 1 };
  assert.equal(sha256([shared, shared]), reference([{ a: 1 }, { a: 1 }]));
  assert.equal(canonicalEquals({ a: 1 }, { a: 2 }), false);
  assert.equal(canonicalEquals([1], [1, 2]), false);
});

test('all inputs are normalized before equality can short-circuit', () => {
  assert.throws(() => canonicalEquals({ a: 1 }, { a: 2, z: undefined }));
  const cycle: unknown[] = []; cycle.push(cycle);
  assert.throws(() => sha256(cycle), /circular/);
  for (const value of [undefined, 1n, NaN, Infinity, () => 1, new Date()]) assert.throws(() => sha256(value));
});

test('ambient toJSON hooks cannot rewrite normalized canonical hashes', () => {
  const expected = sha256({ a: [1, 2] });
  const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
  let calls = 0;
  Object.defineProperty(Object.prototype, 'toJSON', { configurable: true, value() { calls++; return 'replaced'; } });
  try { assert.equal(sha256({ a: [1, 2] }), expected); assert.equal(calls, 0); }
  finally { if (prior) Object.defineProperty(Object.prototype, 'toJSON', prior); else Reflect.deleteProperty(Object.prototype, 'toJSON'); }
});

test('hash coalescing never corrupts supplementary Unicode at byte batch boundaries', () => {
  for (const length of [8190, 8191, 8192, 8193, 16383]) {
    const value = { a: 'x'.repeat(length) + '𝄞', b: ['🦢', '\ud800', '\udfff'] };
    assert.equal(sha256(value), reference(value));
  }
});
