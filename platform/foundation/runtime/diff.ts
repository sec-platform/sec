import { diffLines } from 'diff';

export interface LineDiffCounts {
  added: number;
  removed: number;
}

export function countLineDiff(oldText: string, newText: string): LineDiffCounts {
  return diffLines(oldText, newText, { ignoreNewlineAtEof: true }).reduce<LineDiffCounts>(
    (counts, change) => ({
      added: counts.added + (change.added ? (change.count ?? 0) : 0),
      removed: counts.removed + (change.removed ? (change.count ?? 0) : 0)
    }),
    { added: 0, removed: 0 }
  );
}
