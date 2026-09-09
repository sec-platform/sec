import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { formatCountRecord, formatCounts } from '../../src/interface/cli/format-utils.ts';

test('pre-aggregated count display matches occurrence expansion for ordinary inputs', () => {
  for (let seed = 0; seed < 300; seed++) {
    const counts = { z: seed % 7, a: (seed * 17) % 13, '2': seed % 3 };
    const expanded = Object.entries(counts).flatMap(([name, count]) => Array(count).fill(name));
    assert.equal(formatCountRecord(counts), formatCounts(expanded));
  }
  assert.equal(formatCountRecord({ z: 0, a: -0 }), 'none');
});

test('count magnitude is not expanded into array storage or truncated to array length limits', () => {
  assert.equal(formatCountRecord({ z: Number.MAX_SAFE_INTEGER, a: 2 ** 40 }), `a=${2 ** 40}, z=${Number.MAX_SAFE_INTEGER}`);
});

for (const count of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid count ${String(count)} is refused explicitly`, () => {
    assert.throws(() => formatCountRecord({ value: count }), RangeError);
  });
}

test('count display does not mutate source or count inherited entries', () => {
  const counts = Object.assign(Object.create({ inherited: 99 }), { b: 3, a: 2 });
  Object.freeze(counts);
  assert.equal(formatCountRecord(counts), 'a=2, b=3');
  assert.deepEqual(Object.keys(counts), ['b', 'a']);
});
