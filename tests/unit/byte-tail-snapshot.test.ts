import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { snapshotByteTail, snapshotByteView } from '../../src/system-architecture/foundation/runtime/byte-snapshot.ts';

test('suffix selection matches an independent array slice for sizes and nonzero offsets', () => {
  for (const length of [0, 1, 5, 127, 4096]) {
    const storage = Uint8Array.from({ length: length + 13 }, (_, i) => i % 251);
    const view = new Uint8Array(storage.buffer, 7, length);
    for (const maximum of [0, 1, 8, length, length + 1]) {
      const expected = Array.from(view).slice(Math.max(0, length - maximum));
      assert.deepEqual(Array.from(snapshotByteTail(view, maximum)), expected);
    }
  }
});

test('a bounded diagnostic tail does not copy or retain a large discarded prefix', () => {
  const bytes = new Uint8Array(16 * 1024 * 1024); bytes.fill(71, bytes.length - 8192);
  const original = Buffer.from;
  const copied: number[] = [];
  Buffer.from = ((value: unknown, ...rest: unknown[]) => {
    if (ArrayBuffer.isView(value)) copied.push(value.byteLength);
    return Reflect.apply(original, Buffer, [value, ...rest]);
  }) as typeof Buffer.from;
  let result: Uint8Array;
  try { result = snapshotByteTail(bytes, 8192); } finally { Buffer.from = original; }
  assert.deepEqual(copied, [8192]);
  assert.notEqual(result.buffer, bytes.buffer);
  bytes.fill(0); assert.equal(result.length, 8192); assert.ok(result.every(byte => byte === 71));
});

test('tail projection does not read caller array properties, iterators or subclass species', () => {
  class Bytes extends Uint8Array { static get [Symbol.species]() { assert.fail('species'); throw new Error('unreachable'); } }
  const bytes = new Bytes([1, 2, 3]);
  Object.defineProperties(bytes, {
    byteLength: { get() { assert.fail('byteLength'); } },
    byteOffset: { get() { assert.fail('byteOffset'); } },
    buffer: { get() { assert.fail('buffer'); } },
    length: { get() { assert.fail('length'); } },
    subarray: { value() { assert.fail('subarray'); } },
    [Symbol.iterator]: { value() { assert.fail('iterator'); } }
  });
  assert.deepEqual([...snapshotByteTail(bytes, 2)], [2, 3]);
});

test('full-input admission still rejects oversize while diagnostic projection intentionally selects a suffix', () => {
  const source = Uint8Array.of(1, 2, 3);
  assert.throws(() => snapshotByteView(source, 'full input', 2), RangeError);
  assert.deepEqual([...snapshotByteView(source, 'full input', 3)], [1, 2, 3]);
  assert.deepEqual([...snapshotByteTail(source, 2)], [2, 3]);
  for (const value of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => snapshotByteTail(source, value), TypeError);
  }
});

test('detached, shared and wrong-kind memory cannot become a successful ordinary snapshot', () => {
  assert.throws(() => snapshotByteTail(new Uint8Array(new SharedArrayBuffer(8)), 1), TypeError);
  assert.throws(() => snapshotByteTail(new Uint16Array(4) as never, 1), TypeError);
  const source = Uint8Array.of(1, 2); structuredClone(source, { transfer: [source.buffer] });
  assert.throws(() => snapshotByteTail(source, 1));
});
