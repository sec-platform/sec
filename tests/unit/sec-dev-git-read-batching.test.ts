import { expect, test } from 'bun:test';

import {
  chunkBlobEntries,
  chunkByCount,
  type GitTreeBlobEntry
} from '../../tooling/sec-dev/git/git-read.ts';

function blob(path: string, byteSize: number, seed: string): GitTreeBlobEntry {
  return Object.freeze({
    mode: '100644',
    objectId: seed.repeat(40).slice(0, 40),
    byteSize,
    path
  });
}

test('blob batching is bounded by committed bytes before repository total size', () => {
  const batches = chunkBlobEntries([
    blob('a.ts', 40, 'a'),
    blob('b.ts', 40, 'b'),
    blob('c.ts', 40, 'c'),
    blob('d.ts', 10, 'd')
  ], { maxBytes: 80, maxItems: 10 });

  expect(batches.map((batch) => batch.map((entry) => entry.path)))
    .toEqual([['a.ts', 'b.ts'], ['c.ts', 'd.ts']]);
});

test('blob batching also has an item ceiling and never drops one oversized blob', () => {
  const entries = [
    blob('oversized.bin', 120, 'a'),
    blob('small-a.ts', 10, 'b'),
    blob('small-b.ts', 10, 'c'),
    blob('small-c.ts', 10, 'd')
  ];

  expect(chunkBlobEntries(entries, { maxBytes: 80, maxItems: 2 }).map((batch) =>
    batch.map((entry) => entry.path)
  )).toEqual([
    ['oversized.bin'],
    ['small-a.ts', 'small-b.ts'],
    ['small-c.ts']
  ]);
});

test('count batching covers every input exactly once', () => {
  expect(chunkByCount([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  expect(() => chunkByCount([1], 0)).toThrow('positive safe integer');
});
