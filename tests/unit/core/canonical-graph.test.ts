import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  canonicalJson,
  deepFreeze,
  sha256
} from '../../../src/contracts/canonical.ts';

test('canonical JSON rejects a mixed cycle after shared acyclic traversal without poisoning later calls', () => {
  const shared = { n: 1 };
  const value: Record<string, unknown> = { a: shared, b: shared };
  value.z = [{ back: value }];
  assert.throws(() => canonicalJson(value), (error: unknown) =>
    error instanceof Error && !(error instanceof RangeError) &&
    error.message === 'Canonical JSON rejects circular references');
  assert.deepEqual(canonicalJson({ okay: [1] }), { okay: [1] });
});

for (const [name, value] of [
  ['undefined', undefined], ['NaN', NaN], ['date', new Date(0)]
] as const) {
  test(`canonical JSON continues rejecting unsupported root: ${name}`, () => {
    assert.throws(() => canonicalJson(value));
  });
}

test('canonical JSON rejects object accessors without invoking them or changing later hash authority', () => {
  let calls = 0;
  const bad = Object.defineProperty({ okay: 2 }, 'bad', {
    enumerable: true,
    get() { calls++; throw new Error('must not execute a getter'); }
  });
  assert.throws(() => canonicalJson(bad), /accessor or unstable property at key "bad"/u);
  assert.throws(() => sha256(bad), /accessor or unstable property at key "bad"/u);
  assert.equal(calls, 0);
  assert.deepEqual(canonicalJson({ okay: 2 }), { okay: 2 });
});

test('canonical JSON rejects Proxy containers before invoking their traps', () => {
  let traps = 0;
  for (const proxied of [new Proxy({ value: 1 }, {
    ownKeys() { traps++; throw new Error('ownKeys must not run'); }
  }), new Proxy([1], { get() { traps++; throw new Error('get must not run'); } })]) {
    assert.throws(() => canonicalJson(proxied), /rejects proxies/u);
  }
  assert.equal(traps, 0);
});

test('canonical JSON treats __proto__ and constructor as data keys', () => {
  const source: unknown = JSON.parse('{"__proto__":{"safe":true},"constructor":"value"}');
  const actual = canonicalJson(source) as Record<string, unknown>;
  assert.strictEqual(Object.getPrototypeOf(actual), Object.prototype);
  assert.equal(Object.hasOwn(actual, '__proto__'), true);
  assert.deepEqual(actual.__proto__, { safe: true });
  assert.equal(actual.constructor, 'value');
  assert.equal(Object.hasOwn(Object.prototype, 'safe'), false);
});


test('canonical normalization does not mutate frozen inputs', () => {
  const input = Object.freeze({ b: Object.freeze([2, 1]), a: Object.freeze({ n: -0 }) });
  assert.deepEqual(canonicalJson(input), { a: { n: 0 }, b: [2, 1] });
  assert.equal(Object.is(input.a.n, -0), true);
});

test('deepFreeze preserves primitive identity and the existing function boundary', () => {
  for (const value of [undefined, null, true, 'text', 1, 1n, Symbol('value')]) {
    assert.strictEqual(deepFreeze(value), value);
  }
  const fn = () => 1;
  assert.strictEqual(deepFreeze(fn), fn);
  assert.equal(Object.isFrozen(fn), false);
});

test('deepFreeze freezes mixed cyclic and shared own-data graphs without invoking getters', () => {
  const first: Record<string, unknown> = {};
  const second: unknown[] = [first];
  const shared = { leaf: {} };
  first.self = first;
  first.second = second;
  first.shared = shared;
  second.push(shared);
  const key = Symbol('child'), hidden = { leaf: {} }, symbolChild = {};
  let reads = 0;
  Object.defineProperty(first, key, { value: symbolChild, enumerable: true, configurable: true, writable: true });
  Object.defineProperty(first, 'hidden', { value: hidden, enumerable: false, configurable: true });
  Object.defineProperty(first, 'computed', {
    enumerable: true, configurable: true,
    get() { reads += 1; throw new Error('Getter must not run'); }
  });
  assert.strictEqual(deepFreeze(first), first);
  assert.strictEqual(first.self, first);
  for (const value of [first, second, shared, shared.leaf, hidden, hidden.leaf, symbolChild]) {
    assert.equal(Object.isFrozen(value), true);
  }
  assert.equal(reads, 0);
});

test('deepFreeze handles shallow-frozen roots and intermediates in a cycle', () => {
  const root: Record<string, unknown> = {};
  const leaf = {};
  const child = Object.freeze({ root, leaf });
  root.child = child;
  Object.freeze(root);
  deepFreeze(root);
  assert.equal(Object.isFrozen(leaf), true);
});

test('deepFreeze handles a 50000-edge chain with bounded native stack use', () => {
  const root: { child?: object } = {};
  let cursor = root;
  for (let index = 0; index < 50_000; index += 1) {
    const child = {};
    cursor.child = child;
    cursor = child;
  }
  deepFreeze(root);
  let current: { child?: object } | undefined = root;
  let count = 0;
  while (current !== undefined) {
    assert.equal(Object.isFrozen(current), true);
    current = current.child;
    count += 1;
  }
  assert.equal(count, 50_001);
});
