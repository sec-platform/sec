import { describe, expect, test } from 'bun:test';

import { projectWorktreeSettlementReceipt } from '../../src/application/worktree-settlement.ts';
import { formatWorktreeSettlement } from '../../src/entry/cli/worktree-settlement.ts';

describe('worktree settlement presentation boundary', () => {
  test('application projects only finite presentation data and entry preserves the CLI contract', () => {
    const projected = projectWorktreeSettlementReceipt({
      status: 'materialization-drift',
      totalFiles: 42,
      dirtyCount: 0,
      untrackedCount: 0,
      coreAutocrlf: 'false',
      coreEol: 'lf',
      summary: '1 governed file drifted',
      driftEntries: [{
        path: 'src/example.ts',
        declared: 'lf',
        blobLineEnding: 'lf',
        worktreeLineEnding: 'crlf'
      }]
    });

    expect(projected).toEqual({
      status: 'materialization-drift',
      totalFiles: 42,
      dirtyCount: 0,
      untrackedCount: 0,
      coreAutocrlf: 'false',
      coreEol: 'lf',
      summary: '1 governed file drifted',
      driftEntries: [{
        path: 'src/example.ts',
        declared: 'lf',
        blobLineEnding: 'lf',
        worktreeLineEnding: 'crlf'
      }]
    });
    expect(formatWorktreeSettlement(projected)).toBe([
      'Worktree Settlement',
      '  status: materialization-drift',
      '  totalFiles: 42',
      '  dirty: 0, untracked: 0, drift: 1',
      '  core.autocrlf: false, core.eol: lf',
      '  summary: 1 governed file drifted',
      '  drift:',
      '    src/example.ts [declared=lf blob=lf worktree=crlf]'
    ].join('\n'));
  });

  test('entry caps drift detail without changing the projected count', () => {
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
    expect(text).toContain('drift: 22');
    expect(text).toContain('    ... and 2 more');
    expect(text).not.toContain('src/20.ts');
  });
});
