import { expect, test } from 'bun:test';

import {
  chunkBlobEntries,
  chunkByCount,
  type GitTreeBlobEntry
} from '../../src/adapters/self-hosting/development/tooling/git/git-read.ts';

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

test('blob batching rejects one object larger than the declared byte ceiling', () => {
  const entries = [
    blob('oversized.bin', 120, 'a'),
    blob('small-a.ts', 10, 'b')
  ];

  expect(() => chunkBlobEntries(entries, { maxBytes: 80, maxItems: 2 }))
    .toThrow(/oversized\.bin exceeds the 80-byte observation batch limit/u);
});

test('blob batching also has an item ceiling', () => {
  const entries = [
    blob('small-a.ts', 10, 'a'),
    blob('small-b.ts', 10, 'b'),
    blob('small-c.ts', 10, 'c')
  ];

  expect(chunkBlobEntries(entries, { maxBytes: 80, maxItems: 2 }).map((batch) =>
    batch.map((entry) => entry.path)
  )).toEqual([
    ['small-a.ts', 'small-b.ts'],
    ['small-c.ts']
  ]);
});

test('count batching covers every input exactly once', () => {
  expect(chunkByCount([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  expect(() => chunkByCount([1], 0)).toThrow('positive safe integer');
});
