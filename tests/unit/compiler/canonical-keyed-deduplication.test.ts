import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { normalizeAttributes } from '../../../src/compiler/ir/ir-normalization.ts';
import { CanonicalKeyConflictError, uniqueSortedByKey } from '../../../src/contracts/canonical.ts';

const conflict = (error: unknown): boolean => error instanceof CanonicalKeyConflictError
  && error.code === 'CANONICAL-KEY-CONFLICT';

// Small ordinary-data observations only: no process, repository or compiler fixture.
test('keyed deduplication folds canonical-equal duplicates and sorts unique keys', () => {
  const first = { id: 'b', payload: { z: 2, a: 1 } };
  const equal = { payload: { a: 1, z: 2 }, id: 'b' };
  const other = { id: 'a', payload: { a: 3, z: 4 } };
  for (const values of [[first, equal, other], [equal, other, first], [other, first, equal]]) {
    const before = [...values];
    const actual = uniqueSortedByKey(values, value => value.id);
    assert.deepEqual(actual, [other, first]);
    assert.deepEqual(values, before);
  }
});

test('entity attributes retain one value per key or reject competing values', () => {
  const a = { key: 'mode', value: 'safe' };
  const b = { key: 'name', value: 'subject' };
  assert.deepEqual(normalizeAttributes([b, a, { ...a }]), [a, b]);
  assert.throws(() => normalizeAttributes([a, { key: 'mode', value: 'unsafe' }]), conflict);
});

test('conflicting duplicate keys reject every ordering without leaking values', () => {
  const first = { id: 'private-key', value: 'private-first' };
  const second = { id: 'private-key', value: 'private-second' };
  for (const values of [[first, second], [second, first], [first, first, second], [second, first, first]]) {
    assert.throws(() => uniqueSortedByKey(values, value => value.id), error => {
      assert.ok(conflict(error));
      for (const privateData of ['private-key', 'private-first', 'private-second']) {
        assert.equal((error as Error).message.includes(privateData), false);
      }
      return true;
    });
  }
});
