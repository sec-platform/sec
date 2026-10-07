type WorktreeSettlementDriftView = Readonly<{
  path: string;
  declared: 'lf' | 'crlf' | 'binary' | 'unspecified';
  blobLineEnding: 'lf' | 'crlf' | 'mixed' | 'none';
  worktreeLineEnding: 'lf' | 'crlf' | 'mixed' | 'none';
}>;

type WorktreeSettlementView = Readonly<{
  status: string;
  totalFiles: number;
  dirtyCount: number;
  untrackedCount: number;
  driftEntries: readonly WorktreeSettlementDriftView[];
  coreAutocrlf: string;
  coreEol: string;
  summary: string;
}>;

export function formatWorktreeSettlement(view: WorktreeSettlementView): string {
  const lines: string[] = [];
  lines.push('Worktree Settlement');
  lines.push(`  status: ${view.status}`);
  lines.push(`  totalFiles: ${view.totalFiles}`);
  lines.push(`  dirty: ${view.dirtyCount}, untracked: ${view.untrackedCount}, drift: ${view.driftEntries.length}`);
  lines.push(`  core.autocrlf: ${view.coreAutocrlf}, core.eol: ${view.coreEol}`);
  lines.push(`  summary: ${view.summary}`);
  if (view.driftEntries.length > 0) {
    lines.push('  drift:');
    const maxShow = Math.min(view.driftEntries.length, 20);
    for (let i = 0; i < maxShow; i += 1) {
      const entry = view.driftEntries[i]!;
      lines.push(`    ${entry.path} [declared=${entry.declared} blob=${entry.blobLineEnding} worktree=${entry.worktreeLineEnding}]`);
    }
    if (view.driftEntries.length > maxShow) {
      lines.push(`    ... and ${view.driftEntries.length - maxShow} more`);
    }
  }
  return lines.join('\n');
}
