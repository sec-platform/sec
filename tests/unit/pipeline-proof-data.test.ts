import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { capturePipelineProofRecord, samePipelineSequence } from '../../src/compiler/pipeline/proof-data.ts';

for (const count of [0, 1, 6]) {
  test(`dense own sequences compare all ${count} positions`, () => {
    const values = Array.from({ length: count }, (_, i) => `stage:${i}`);
    assert.ok(samePipelineSequence(values, [...values]));
    assert.equal(samePipelineSequence(values, [...values, 'extra']), false);
    assert.equal(samePipelineSequence({ ...values, length: count }, values), false);
  });
}

test('holes and inherited slots cannot satisfy a proof closure', () => {
  const expected = ['resolve', 'semantic', 'compose'];
  for (let index = 0; index < expected.length; index++) {
    const sparse = [...expected]; delete sparse[index];
    assert.equal(samePipelineSequence(sparse, expected), false);
    Object.setPrototypeOf(sparse, { [index]: expected[index] });
    assert.equal(samePipelineSequence(sparse, expected), false);
  }
});

test('caller array methods and element accessors do not participate in proof comparison', () => {
  const values = ['forged'];
  // @ts-expect-error Deliberately replaces an overloaded array method with a hostile implementation.
  values.every = () => true;
  assert.equal(samePipelineSequence(values, ['actual']), false);
  const getter = [1]; Object.defineProperty(getter, 0, { get() { assert.fail('element getter'); } });
  assert.equal(samePipelineSequence(getter, [1]), false);
});

test('proof fields and sequence data are captured without invoking getters or proxy get traps', () => {
  const original = { id: 'proof', stages: ['resolve'] };
  const proxy = new Proxy(original, { get() { assert.fail('get trap'); } });
  const captured = capturePipelineProofRecord(proxy, ['id', 'stages'], 'Proof');
  assert.equal(captured.id, 'proof'); assert.deepEqual(captured.stages, ['resolve']);
  original.id = 'changed'; original.stages[0] = 'emit';
  assert.equal(captured.id, 'proof'); assert.deepEqual(captured.stages, ['resolve']);
  assert.ok(Object.isFrozen(captured)); assert.ok(Object.isFrozen(captured.stages));
});

for (const kind of ['getter', 'hidden', 'symbol', 'extra', 'missing', 'prototype']) {
  test(`proof root rejects ${kind} extensions or non-data fields`, () => {
    const value: Record<string | symbol, unknown> = { id: 'proof' };
    if (kind === 'getter') Object.defineProperty(value, 'id', { get() { assert.fail('getter'); } });
    if (kind === 'hidden') Object.defineProperty(value, 'id', { value: 'proof', enumerable: false });
    if (kind === 'symbol') value[Symbol('extra')] = 7;
    if (kind === 'extra') value.extra = 7;
    if (kind === 'missing') delete value.id;
    if (kind === 'prototype') Object.setPrototypeOf(value, { extension: true });
    assert.throws(() => capturePipelineProofRecord(value, ['id'], 'Proof'));
  });
}

for (const kind of ['hole', 'getter', 'extra', 'hidden']) {
  test(`proof arrays reject ${kind} state before payload hashing`, () => {
    const array: unknown[] = [1];
    if (kind === 'hole') delete array[0];
    if (kind === 'getter') Object.defineProperty(array, 0, { get() { assert.fail('getter'); } });
    if (kind === 'extra') Object.defineProperty(array, 'toJSON', { value() { assert.fail('toJSON'); } });
    if (kind === 'hidden') Object.defineProperty(array, 0, { value: 1, enumerable: false });
    assert.throws(() => capturePipelineProofRecord({ stages: array }, ['stages'], 'Proof'));
  });
}

test('null-prototype exact records stay valid data', () => {
  const value = Object.assign(Object.create(null), { id: 'proof', stages: [] });
  assert.equal(capturePipelineProofRecord(value, ['id', 'stages'], 'Proof').id, 'proof');
});
