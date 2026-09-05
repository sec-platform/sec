import assert from 'node:assert/strict';
import { test } from 'bun:test';

import { uniqueSorted } from '../../src/system-architecture/foundation/runtime/canonical.ts';
import { countMatching, countPositiveValues, mergeCountSummaries, normalizeNewlines, summarizeCounts, uniqueSortedLines } from '../../src/system-architecture/foundation/runtime/collections.ts';

test('collection counting and newline normalization retain their value contracts', () => {
  assert.equal(countPositiveValues([-2, 0, 1, 3, Number.NaN]), 2);
  assert.equal(countMatching(['a', 'bb', 'ccc'], (value) => value.length > 1), 2);
  assert.deepEqual(mergeCountSummaries([
    { id: 'b', count: 99 },
    { id: 'a', count: 7 },
    { id: 'b', count: 0 }
  ]), [
    { id: 'a', count: 1 },
    { id: 'b', count: 2 }
  ]);
  assert.deepEqual(summarizeCounts(['b', 'a', 'b']), [
    { id: 'a', count: 1 },
    { id: 'b', count: 2 }
  ]);
  assert.equal(normalizeNewlines('a\r\nb\n'), 'a\nb\n');
});

test('canonical sorting preserves empty strings as string identities', () => {
  // The historical display helper filtered empty strings. The canonical
  // primitive imported here has a different domain: it removes duplicates,
  // not values. Keep that distinction rather than changing identity semantics.
  const input = ['b', '', 'a', 'b'];
  const output = uniqueSorted(input);
  assert.deepEqual(output, ['', 'a', 'b']);
  assert.deepEqual(new Set(output), new Set(input));
  assert.deepEqual(uniqueSorted([' ', '', ' ', '']), ['', ' ']);
  assert.deepEqual(input, ['b', '', 'a', 'b']);
});

test('presentation line normalization still trims and removes blank lines', () => {
  assert.deepEqual(uniqueSortedLines(' b\r\n a\n\n b '), ['a', 'b']);
  assert.deepEqual(uniqueSortedLines(' \r\n\t\n'), []);
});
