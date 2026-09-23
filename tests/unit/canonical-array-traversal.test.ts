import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  canonicalEquals, canonicalJson, sha256
} from '../../src/contracts/canonical.ts';

test('canonical array traversal never dispatches an own map method', () => {
  const input = [1, { z: 2, a: 3 }];
  let calls = 0;
  Object.defineProperty(input, 'map', { value: () => { calls++; return ['forged']; } });
  assert.deepEqual(canonicalJson(input), [1, { a: 3, z: 2 }]);
  assert.equal(calls, 0);
});

test('canonical array traversal does not read a map accessor', () => {
  const input = [1];
  let calls = 0;
  Object.defineProperty(input, 'map', { get() { calls++; throw new Error('must not execute'); } });
  assert.deepEqual(canonicalJson(input), [1]);
  assert.equal(calls, 0);
});

test('canonical arrays do not consult constructors or Symbol.species', () => {
  const input = [1, 2];
  let calls = 0;
  Object.defineProperty(input, 'constructor', {
    get() { calls++; throw new Error('must not construct from the input'); }
  });
  const actual = canonicalJson(input);
  assert.deepEqual(actual, [1, 2]);
  assert.equal(calls, 0);
  assert.strictEqual(Object.getPrototypeOf(actual), Array.prototype);
});

test('canonical array subclasses produce ordinary arrays without invoking species', () => {
  let calls = 0;
  class InputArray extends Array<number> {}
  Object.defineProperty(InputArray, Symbol.species, {
    get() { calls++; throw new Error('must not invoke species'); }
  });
  const actual = canonicalJson(new InputArray(1, 2));
  assert.deepEqual(actual, [1, 2]);
  assert.equal(calls, 0);
  assert.strictEqual(Object.getPrototypeOf(actual), Array.prototype);
});

test('canonical array hooks cannot select the digest or equality result', () => {
  const input = [1];
  Object.defineProperty(input, 'map', { value: () => [2] });
  assert.equal(sha256(input), sha256([1]));
  assert.equal(canonicalEquals(input, [1]), true);
  assert.equal(canonicalEquals(input, [2]), false);
});

test('canonical arrays capture length once while observing indices in order', () => {
  const input: unknown[] = [0, 1, 2];
  Object.defineProperty(input, '0', {
    get() { input.push(3); delete input[1]; return 0; }
  });
  const actual = canonicalJson(input) as unknown[];
  assert.equal(actual.length, 3);
  assert.equal(Object.hasOwn(actual, 1), false);
  assert.deepEqual(actual, [0, , 2]);
});

test('canonical arrays retain inherited-index and sparse-array semantics', () => {
  const input = new Array<unknown>(3);
  const prototype = Object.create(Array.prototype) as Record<string, unknown>;
  prototype[1] = { b: 2, a: 1 };
  Object.setPrototypeOf(input, prototype);
  const actual = canonicalJson(input) as unknown[];
  assert.deepEqual(actual, [, { a: 1, b: 2 }, ,]);
  assert.equal(Object.hasOwn(actual, 0), false);
  assert.equal(Object.hasOwn(actual, 2), false);
});

test('iterative canonical traversal preserves sorted depth-first reads', () => {
  const order: string[] = [];
  const input = {
    get z() { order.push('z'); return 3; },
    get a() {
      order.push('a');
      return { get n() { order.push('a.n'); return 2; } };
    }
  };
  assert.deepEqual(canonicalJson(input), { a: { n: 2 }, z: 3 });
  assert.deepEqual(order, ['a', 'a.n', 'z']);
});

test('canonical normalization handles a 50000-edge object chain without the native call stack', () => {
  const root: { child?: object } = {};
  let source = root;
  for (let index = 0; index < 50_000; index++) {
    const child = {};
    source.child = child;
    source = child;
  }
  let actual = canonicalJson(root) as { child?: object };
  let depth = 0;
  while (actual.child !== undefined) {
    actual = actual.child;
    depth++;
  }
  assert.equal(depth, 50_000);
  assert.notStrictEqual(actual, source);
});

test('canonical normalization handles a deep array chain', () => {
  let input: unknown = 7;
  for (let index = 0; index < 20_000; index++) input = [input];
  let actual: unknown = canonicalJson(input);
  for (let index = 0; index < 20_000; index++) {
    assert.ok(Array.isArray(actual));
    actual = actual[0];
  }
  assert.equal(actual, 7);
});

test('deep back-edges retain the circular-reference diagnostic rather than stack overflow', () => {
  const root: { child?: object } = {};
  let source = root;
  for (let index = 0; index < 20_000; index++) {
    const child = {};
    source.child = child;
    source = child;
  }
  source.child = root;
  assert.throws(() => canonicalJson(root), (error: unknown) =>
    error instanceof Error && !(error instanceof RangeError) &&
    error.message === 'Canonical JSON rejects circular references');
});

test('array hooks cannot hide a cycle or an unsupported element', () => {
  const cyclic: unknown[] = [];
  cyclic.push(cyclic);
  Object.defineProperty(cyclic, 'map', { value: () => [] });
  assert.throws(() => canonicalJson(cyclic), /circular references/u);
  const unsupported = [undefined];
  Object.defineProperty(unsupported, 'map', { value: () => [] });
  assert.throws(() => canonicalJson(unsupported), /only accepts/u);
});
