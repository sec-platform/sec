import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { decodeTrackedProjectPathInventory } from '../../src/workspace/runtime/tracked-path-inventory.ts';
const decode = (source: string) => decodeTrackedProjectPathInventory(Buffer.from(source), () => {});

test('actual record count is admitted before identical index-stage paths coalesce', () => {
  const counts: number[] = [];
  assert.deepEqual(decodeTrackedProjectPathInventory(Buffer.from('b.ts\0a.ts\0a.ts\0'), n => { counts.push(n); }), ['a.ts', 'b.ts']);
  assert.deepEqual(counts, [3]);
  assert.deepEqual(decodeTrackedProjectPathInventory(Buffer.alloc(0), n => { counts.push(n); }), []);
  assert.deepEqual(counts, [3, 0]);
});

for (const source of ['a', 'a\0\0', '\0', '../a\0', 'src\\a\0', '/a\0', 'A.ts\0a.ts\0', 'aux.txt\0']) {
  test(`malformed or nonportable Git inventory ${JSON.stringify(source)} cannot rename files`, () => { assert.throws(() => decode(source)); });
}

test('invalid UTF-8 is rejected and an actual filename BOM is preserved', () => {
  assert.throws(() => decodeTrackedProjectPathInventory(Uint8Array.of(0xff, 0), () => {}), /UTF-8/);
  assert.deepEqual(decode('\ufefffile.ts\0'), ['\ufefffile.ts']);
});

test('budget failure is preserved before materializing path strings', () => {
  const reason = Object.freeze({ exhausted: true });
  assert.throws(() => decodeTrackedProjectPathInventory(Uint8Array.of(0xff, 0), count => {
    assert.equal(count, 1); throw reason;
  }), error => error === reason);
});

test('a budget callback cannot rewrite the accepted byte inventory', () => {
  const bytes = Buffer.from('a.ts\0');
  assert.deepEqual(decodeTrackedProjectPathInventory(bytes, () => { bytes.fill(0); }), ['a.ts']);
});

test('typed-array shadow fields and iterators do not change the admitted view', () => {
  const bytes = Buffer.from('a.ts\0');
  Object.defineProperties(bytes, { length: { value: 0 }, byteLength: { value: 0 }, buffer: { get() { assert.fail('buffer getter'); } },
    [Symbol.iterator]: { value() { assert.fail('iterator'); } } });
  assert.deepEqual(decodeTrackedProjectPathInventory(bytes, () => {}), ['a.ts']);
});
