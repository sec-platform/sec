type WorktreeSettlementDriftView = Readonly<{
  path: string;
  declared: 'lf' | 'crlf' | 'binary' | 'unspecified';
  blobLineEnding: 'lf' | 'crlf' | 'mixed' | 'none';
  worktreeLineEnding: 'lf' | 'crlf' | 'mixed' | 'none';
}>;

export type WorktreeSettlementView = Readonly<{
  status: string;
  totalFiles: number;
  dirtyCount: number;
  untrackedCount: number;
  driftEntries: readonly WorktreeSettlementDriftView[];
  coreAutocrlf: string;
  coreEol: string;
  summary: string;
}>;

export function projectWorktreeSettlementReceipt(
  receipt: WorktreeSettlementView
): WorktreeSettlementView {
  return {
    status: receipt.status,
    totalFiles: receipt.totalFiles,
    dirtyCount: receipt.dirtyCount,
    untrackedCount: receipt.untrackedCount,
    driftEntries: receipt.driftEntries.map((entry) => ({
      path: entry.path,
      declared: entry.declared,
      blobLineEnding: entry.blobLineEnding,
      worktreeLineEnding: entry.worktreeLineEnding
    })),
    coreAutocrlf: receipt.coreAutocrlf,
    coreEol: receipt.coreEol,
    summary: receipt.summary
  };
}
