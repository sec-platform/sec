import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  canonicalEquals, canonicalJson, sha256
} from '../../../src/contracts/canonical.ts';

test('canonical array hooks cannot choose normalized data, hashes or equality', () => {
  const input = [1, { z: 2, a: 3 }];
  let calls = 0;
  Object.defineProperty(input, 'map', { value: () => { calls++; return ['forged']; } });
  assert.deepEqual(canonicalJson(input), [1, { a: 3, z: 2 }]);
  assert.equal(sha256(input), sha256([1, { a: 3, z: 2 }]));
  assert.equal(canonicalEquals(input, [1, { a: 3, z: 2 }]), true);
  assert.equal(canonicalEquals(input, ['forged']), false);
  assert.equal(calls, 0);

  // An own map accessor can have effects on read, even without method invocation.
  {
    const input = [1];
    let calls = 0;
    Object.defineProperty(input, 'map', { get() { calls++; throw new Error('must not execute'); } });
    assert.deepEqual(canonicalJson(input), [1]);
    assert.equal(calls, 0);
  }
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

  // Subclasses and own constructor hooks share the array-construction trust boundary.
  {
    let calls = 0;
    class InputArray extends Array<number> {}
    Object.defineProperty(InputArray, Symbol.species, {
      get() { calls++; throw new Error('must not invoke species'); }
    });
    const actual = canonicalJson(new InputArray(1, 2));
    assert.deepEqual(actual, [1, 2]);
    assert.equal(calls, 0);
    assert.strictEqual(Object.getPrototypeOf(actual), Array.prototype);
  }
});



test('canonical arrays reject own index getters without invoking them', () => {
  const input: unknown[] = [0, 1, 2];
  let calls = 0;
  Object.defineProperty(input, '0', {
    get() { calls++; throw new Error('getter must not execute'); }
  });
  assert.throws(() => canonicalJson(input), /accessor array elements/u);
  assert.equal(calls, 0);
});

test('canonical arrays treat inherited values as missing and explicitly normalize holes', () => {
  const input = new Array<unknown>(3);
  const prototype = Object.create(Array.prototype) as Record<string, unknown>;
  prototype[1] = { b: 2, a: 1 };
  Object.setPrototypeOf(input, prototype);
  const actual = canonicalJson(input) as unknown[];
  assert.deepEqual(actual, [null, null, null]);
  assert.equal(canonicalEquals(input, [null, null, null]), true);

  // Inherited data and inherited accessors must both be ignored as array members.
  {
    let reads = 0;
    const array = new Array<unknown>(2);
    const prototype = Object.create(Array.prototype) as Record<string, unknown>;
    Object.defineProperty(prototype, '1', {
      get() { reads++; throw new Error('inherited getter must not run'); }
    });
    Object.setPrototypeOf(array, prototype);
    assert.deepEqual(canonicalJson(array), [null, null]);
    assert.equal(reads, 0);
  }
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
