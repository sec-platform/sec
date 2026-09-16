import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  canonicalEquals,
  canonicalJson,
  cloneAndDeepFreeze,
  deepFreeze,
  sha256
} from '../../src/system-architecture/foundation/runtime/canonical.ts';

function rejectsCycle(value: unknown): void {
  assert.throws(() => canonicalJson(value), (error: unknown) =>
    error instanceof Error && !(error instanceof RangeError) &&
    error.message === 'Canonical JSON rejects circular references');
}

test('canonical JSON retains nested ordering, primitive values, and negative-zero normalization', () => {
  assert.deepEqual(canonicalJson({ z: [-0, true, null], a: { y: 2, b: 'value' } }), {
    a: { b: 'value', y: 2 }, z: [0, true, null]
  });
  assert.equal(JSON.stringify(canonicalJson({ z: 1, a: 2 })), '{"a":2,"z":1}');
  assert.equal(Object.is(canonicalJson(-0), -0), false);
});

test('canonical JSON accepts shared acyclic objects without preserving mutable aliases', () => {
  const shared = { z: [1, 2], a: 'shared' };
  const actual = canonicalJson({ right: shared, left: shared }) as { left: object; right: object };
  assert.deepEqual(actual.left, actual.right);
  assert.notStrictEqual(actual.left, actual.right);
  assert.notStrictEqual(actual.left, shared);
});

test('canonical JSON rejects an object self-cycle as a contract error', () => {
  const value: Record<string, unknown> = {};
  value.self = value;
  rejectsCycle(value);
});

test('canonical JSON rejects an array self-cycle as a contract error', () => {
  const value: unknown[] = [];
  value.push(value);
  rejectsCycle(value);
});

test('canonical JSON rejects a mixed object/array cycle', () => {
  const array: unknown[] = [];
  const value = { array };
  array.push(value);
  rejectsCycle(value);
});

test('canonical JSON still detects cycles after traversing a shared acyclic branch', () => {
  const shared = { n: 1 };
  const value: Record<string, unknown> = { a: shared, b: shared };
  value.z = { back: value };
  rejectsCycle(value);
});

test('a failed canonical JSON call cannot poison another normalization', () => {
  const cyclic: unknown[] = [];
  cyclic.push(cyclic);
  rejectsCycle(cyclic);
  assert.deepEqual(canonicalJson({ okay: [1] }), { okay: [1] });
});

for (const [name, value] of [
  ['undefined', undefined], ['bigint', 1n], ['function', () => 1],
  ['symbol', Symbol('value')], ['NaN', NaN], ['infinity', Infinity],
  ['date', new Date(0)], ['map', new Map()], ['set', new Set()],
  ['typed array', new Uint8Array([1])]
] as const) {
  test(`canonical JSON continues rejecting unsupported root: ${name}`, () => {
    assert.throws(() => canonicalJson(value));
  });
}

test('canonical JSON retains unsupported-property diagnostics', () => {
  for (const value of [undefined, 1n, () => 1, Symbol('value')]) {
    assert.throws(() => canonicalJson({ key: value }), /unsupported value at key "key"/u);
  }
});

test('canonical JSON retains sparse array behavior without accepting explicit undefined', () => {
  const sparse: unknown[] = new Array(3);
  sparse[1] = 'middle';
  const actual = canonicalJson(sparse) as unknown[];
  assert.equal(actual.length, 3);
  assert.equal(Object.hasOwn(actual, 0), false);
  assert.equal(Object.hasOwn(actual, 2), false);
  assert.equal(JSON.stringify(actual), '[null,"middle",null]');
  assert.throws(() => canonicalJson([undefined]));
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

test('canonical hashes and equality retain key-order invariance and shared-value equivalence', () => {
  const shared = { z: 1, a: [true, null] };
  const first = { b: shared, a: shared };
  const second = { a: { a: [true, null], z: 1 }, b: { z: 1, a: [true, null] } };
  assert.equal(canonicalEquals(first, second), true);
  assert.equal(sha256(first), sha256(second));
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

test('deepFreeze freezes a self-cycle without recursive stack growth', () => {
  const value: Record<string, unknown> = {};
  value.self = value;
  assert.strictEqual(deepFreeze(value), value);
  assert.equal(Object.isFrozen(value), true);
  assert.strictEqual(value.self, value);
});

test('deepFreeze freezes mixed cyclic and shared graphs', () => {
  const first: Record<string, unknown> = {};
  const second: unknown[] = [first];
  const shared = { leaf: {} };
  first.second = second;
  first.shared = shared;
  second.push(shared);
  deepFreeze(first);
  for (const value of [first, second, shared, shared.leaf]) assert.equal(Object.isFrozen(value), true);
});

test('deepFreeze traverses descendants of a shallow-frozen root', () => {
  const leaf = {};
  const child = { leaf };
  const root = Object.freeze({ child });
  deepFreeze(root);
  assert.equal(Object.isFrozen(child), true);
  assert.equal(Object.isFrozen(leaf), true);
});

test('deepFreeze traverses a shallow-frozen intermediate node', () => {
  const leaf = {};
  const intermediate = Object.freeze({ leaf });
  const root = { intermediate };
  deepFreeze(root);
  assert.equal(Object.isFrozen(root), true);
  assert.equal(Object.isFrozen(leaf), true);
});

test('deepFreeze handles already shallow-frozen cycles', () => {
  const root: Record<string, unknown> = {};
  const child = { root };
  root.child = child;
  Object.freeze(root);
  deepFreeze(root);
  assert.equal(Object.isFrozen(child), true);
});

test('deepFreeze follows symbol and non-enumerable data properties', () => {
  const key = Symbol('child');
  const hidden = { leaf: {} };
  const symbolChild = {};
  const root = { [key]: symbolChild };
  Object.defineProperty(root, 'hidden', { value: hidden, enumerable: false, configurable: true });
  deepFreeze(root);
  for (const value of [root, hidden, hidden.leaf, symbolChild]) assert.equal(Object.isFrozen(value), true);
});

test('deepFreeze never invokes own getters', () => {
  let reads = 0;
  const root = {};
  Object.defineProperty(root, 'computed', {
    enumerable: true,
    configurable: true,
    get() { reads += 1; throw new Error('Getter must not run'); }
  });
  deepFreeze(root);
  assert.equal(reads, 0);
  assert.equal(Object.isFrozen(root), true);
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

test('deepFreeze preserves child-before-parent freezing for an acyclic graph', () => {
  const order: string[] = [];
  const child = new Proxy({}, {
    preventExtensions(target) { order.push('child'); return Reflect.preventExtensions(target); }
  });
  const root = new Proxy({ child }, {
    preventExtensions(target) { order.push('root'); return Reflect.preventExtensions(target); }
  });
  deepFreeze(root);
  assert.deepEqual(order, ['child', 'root']);
});

test('deepFreeze is idempotent and keeps shared-node identity', () => {
  const child = {};
  const root = { a: child, b: child };
  assert.strictEqual(deepFreeze(root), root);
  assert.strictEqual(deepFreeze(root), root);
  assert.strictEqual(root.a, root.b);
  assert.equal(Object.isFrozen(child), true);
});

test('cloneAndDeepFreeze freezes a cyclic clone without mutating the input', () => {
  const root: Record<string, unknown> = {};
  const shared = { n: 1 };
  root.self = root;
  root.a = shared;
  root.b = shared;
  const copy = cloneAndDeepFreeze(root);
  assert.notStrictEqual(copy, root);
  assert.strictEqual(copy.self, copy);
  assert.strictEqual(copy.a, copy.b);
  assert.notStrictEqual(copy.a, shared);
  assert.equal(Object.isFrozen(copy), true);
  assert.equal(Object.isFrozen(copy.a), true);
  assert.equal(Object.isFrozen(root), false);
  assert.equal(Object.isFrozen(shared), false);
});
