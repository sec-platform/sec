import { describe, expect, test } from 'bun:test';

import { formatWorktreeSettlement } from '../../src/entry/cli/worktree-settlement.ts';

describe('worktree settlement presentation boundary', () => {
  test('entry formats the receipt without mutating it', () => {
    const receipt = Object.freeze({
      status: 'materialization-drift',
      totalFiles: 42,
      dirtyCount: 0,
      untrackedCount: 0,
      coreAutocrlf: 'false',
      coreEol: 'lf',
      summary: '1 governed file drifted',
      driftEntries: Object.freeze([Object.freeze({
        path: 'src/example.ts',
        declared: 'lf',
        blobLineEnding: 'lf',
        worktreeLineEnding: 'crlf'
      })])
    });

    const text = formatWorktreeSettlement(receipt);
    for (const meaning of [
      /\bstatus[\s:]+materialization-drift(?=$|[\s;,])/u,
      /\btotalFiles[\s:]+42(?=$|[\s;,])/u,
      /\bdirty[\s:]+0(?=$|[\s;,])/u,
      /\buntracked[\s:]+0(?=$|[\s;,])/u,
      /\bdrift[\s:]+1(?=$|[\s;,])/u,
      /core\.autocrlf\W+false(?=$|[\s;,])/u,
      /core\.eol\W+lf(?=$|[\s;,])/u,
      /src\/example\.ts(?=$|[\s\[])[^\n]*declared=lf(?=$|[\s;,\]])/u,
      /src\/example\.ts(?=$|[\s\[])[^\n]*blob=lf(?=$|[\s;,\]])/u,
      /src\/example\.ts(?=$|[\s\[])[^\n]*worktree=crlf(?=$|[\s;,\]])/u
    ]) expect(text).toMatch(meaning);
  });

  test('entry caps drift detail without changing the receipt count', () => {
    const driftEntries = Array.from({ length: 22 }, (_, index) => ({
      path: `src/${index}.ts`,
      declared: 'lf' as const,
      blobLineEnding: 'lf' as const,
      worktreeLineEnding: 'crlf' as const
    }));
    const text = formatWorktreeSettlement({
      status: 'materialization-drift',
      totalFiles: 22,
      dirtyCount: 0,
      untrackedCount: 0,
      coreAutocrlf: 'false',
      coreEol: 'lf',
      summary: 'drift',
      driftEntries
    });
    expect(text).toMatch(/\bdrift[\s:]+22(?=$|[\s;,])/u);
    expect(text).toMatch(/\b2 more(?=$|[\s;,])/u);
    expect(text).not.toContain('src/20.ts');
  });
});
