import { expect, test } from 'bun:test';

import {
  countMatching,
  countPositiveValues,
  mergeCountSummaries,
  normalizeNewlines,
  summarizeCounts,
  uniqueSorted,
  uniqueSortedLines
} from '../../platform/shared/collections.ts';

test('native collection primitives preserve canonical lodash-era value semantics', () => {
  expect(countPositiveValues([-2, 0, 1, 3, Number.NaN])).toBe(2);
  expect(countMatching(['a', 'bb', 'ccc'], (value) => value.length > 1)).toBe(2);
  expect(mergeCountSummaries([
    { id: 'b', count: 99 },
    { id: 'a', count: 7 },
    { id: 'b', count: 0 }
  ])).toEqual([
    { id: 'a', count: 1 },
    { id: 'b', count: 2 }
  ]);
  expect(summarizeCounts(['b', 'a', 'b'])).toEqual([
    { id: 'a', count: 1 },
    { id: 'b', count: 2 }
  ]);
  expect(uniqueSorted(['b', '', 'a', 'b'])).toEqual(['a', 'b']);
  expect(uniqueSortedLines(' b\r\n a\n\n b ')).toEqual(['a', 'b']);
  expect(normalizeNewlines('a\r\nb\n')).toBe('a\nb\n');
});
