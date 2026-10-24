import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { snapshotByteTail } from '../../../src/contracts/byte-snapshot.ts';

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

test('a diagnostic tail owns its selected bytes independently of the caller', () => {
  const bytes = Uint8Array.of(1, 2, 3, 71, 72);
  const result = snapshotByteTail(bytes, 2);
  bytes.fill(0);
  assert.deepEqual([...result], [71, 72]);
});
