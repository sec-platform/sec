import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readonlyMapSnapshot } from '../../src/contracts/collections.ts';

test('snapshot preserves insertion order and SameValueZero lookup without sharing membership', () => {
  const key = {}, value = { value: 1 };
  const source = new Map<unknown, unknown>([[key, value], [NaN, 'nan'], [-0, 'zero']]);
  const view = readonlyMapSnapshot(source);
  source.clear();
  assert.equal(view.size, 3); assert.equal(view.get(key), value);
  assert.equal(view.get(NaN), 'nan'); assert.equal(view.get(0), 'zero');
  assert.deepEqual([...view.keys()], [key, NaN, 0]); assert.deepEqual([...view.values()], [value, 'nan', 'zero']);
  assert.deepEqual([...view], [[key, value], [NaN, 'nan'], [0, 'zero']]);
});

test('no mutation interface or native Map receiver can change the snapshot', () => {
  const view = readonlyMapSnapshot([['a', 1]]);
  assert.ok(Object.isFrozen(view));
  for (const name of ['set', 'delete', 'clear']) assert.equal((view as unknown as Record<string, unknown>)[name], undefined);
  assert.throws(() => Map.prototype.clear.call(view), TypeError);
  assert.equal(Reflect.set(view, 'size', 0), false); assert.equal(view.get('a'), 1);
});

test('forEach provides the readonly view rather than leaking its backing map', () => {
  const view = readonlyMapSnapshot([['a', 1], ['b', 2]]), receiver = {};
  const entries: Array<[string, number]> = [];
  view.forEach(function(this: object, value, key, map) {
    assert.equal(this, receiver); assert.equal(map, view);
    assert.throws(() => Map.prototype.delete.call(map, key), TypeError);
    entries.push([key, value]);
  }, receiver);
  assert.deepEqual(entries, [...view]);
});

test('entry iterators do not expose a mutable pair stored in the map', () => {
  const view = readonlyMapSnapshot([['a', 1]]);
  const entry = view.entries().next().value!; entry[0] = 'other'; entry[1] = 9;
  assert.equal(view.get('a'), 1); assert.equal(view.has('other'), false);
});

test('value identity and mutability remain with the value owner', () => {
  const value = { counter: 0 }, view = readonlyMapSnapshot([['a', value]]);
  value.counter++; assert.equal(view.get('a'), value); assert.equal(view.get('a')!.counter, 1);
  assert.equal(Object.isFrozen(value), false);
});

test('an empty view still rejects an invalid forEach callback', () => {
  const view = readonlyMapSnapshot<string, number>([]);
  assert.equal(view.size, 0); assert.deepEqual([...view], []);
  assert.throws(() => view.forEach(undefined as never), TypeError);
});

test('callback failures are preserved without changing the snapshot', () => {
  const view = readonlyMapSnapshot([['a', 1]]), failure = {};
  assert.throws(() => view.forEach(() => { throw failure; }), error => error === failure);
  assert.deepEqual([...view], [['a', 1]]);
});

test('snapshot consumes the provider once and keeps last-value duplicate-key semantics', () => {
  let reads = 0;
  const view = readonlyMapSnapshot((function* () { reads++; yield ['a', 1] as const; yield ['a', 2] as const; })());
  assert.equal(reads, 1); assert.equal(view.size, 1); assert.equal(view.get('a'), 2);
});
