/**
 * SEC Worktree Settlement Contract (Issue #209 Phase A).
 *
 * Defines the settlement receipt type emitted by the non-destructive
 * worktree preflight. The preflight reads Git attributes, index/blob,
 * and worktree bytes to verify that the worktree is settled to canonical
 * bytes. Dirty/untracked or unsafe cases block (no reset/stash/overwrite).
 *
 * Git blob is the tracked source identity; worktree materialization must
 * match the .gitattributes policy before Frozen proof begins.
 */

export const WORKTREE_SETTLEMENT_SCHEMA = 'sec-worktree-settlement-v1' as const;

/**
 * Settlement status.
 *
 * - settled: worktree is clean and all governed text materializes to canonical bytes.
 * - dirty: working tree has staged or unstaged modifications; settlement blocked.
 * - untracked: working tree has untracked files; settlement blocked.
 * - materialization-drift: clean tree but some files materialize non-canonical bytes.
 * - unsafe: cannot prove safe settlement (e.g., git attributes missing, unknown encoding).
 */
export type WorktreeSettlementStatus =
  | 'settled'
  | 'dirty'
  | 'untracked'
  | 'materialization-drift'
  | 'unsafe';

/**
 * Materialization observation for a single governed file.
 */
export interface WorktreeMaterializationEntry {
  /** Repository-relative POSIX path. */
  path: string;
  /** .gitattributes declaration. */
  declared: 'lf' | 'crlf' | 'binary' | 'unspecified';
  /** Blob line-ending shape (from census). */
  blobLineEnding: 'lf' | 'crlf' | 'mixed' | 'none';
  /** Worktree line-ending shape (from worktree bytes). */
  worktreeLineEnding: 'lf' | 'crlf' | 'mixed' | 'none';
  /** True if worktree bytes differ from blob bytes in line endings only. */
  lineEndingOnlyDifference: boolean;
}

/**
 * Settlement receipt emitted by the preflight.
 */
export interface WorktreeSettlementReceipt {
  schema: typeof WORKTREE_SETTLEMENT_SCHEMA;
  /** ISO 8601 timestamp. */
  generatedAt: string;
  /** Absolute normalized repository root. */
  repositoryRoot: string;
  /** Settlement status. */
  status: WorktreeSettlementStatus;
  /** Observed git version (from `git --version`). */
  gitVersion: string;
  /** Observed core.autocrlf config value (global/system/local merged). */
  coreAutocrlf: string;
  /** Observed core.eol config value, if any. */
  coreEol: string;
  /** .gitattributes blob SHA at settlement time. */
  gitattributesBlobSha: string | null;
  /** Number of tracked files scanned. */
  totalFiles: number;
  /** Files with materialization drift (worktree CRLF but blob LF, etc.). */
  driftEntries: WorktreeMaterializationEntry[];
  /** Number of untracked files (if status is untracked). */
  untrackedCount: number;
  /** Number of dirty files (if status is dirty). */
  dirtyCount: number;
  /** Human-readable summary. */
  summary: string;
}

/**
 * Detect line-ending shape from raw bytes.
 */
export function detectLineEnding(bytes: Uint8Array): 'lf' | 'crlf' | 'mixed' | 'none' {
  let hasLf = false;
  let hasCrlf = false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0x0A) {
      if (i > 0 && bytes[i - 1] === 0x0D) {
        hasCrlf = true;
      } else {
        hasLf = true;
      }
    }
  }
  if (hasCrlf && hasLf) return 'mixed';
  if (hasCrlf) return 'crlf';
  if (hasLf) return 'lf';
  return 'none';
}

/**
 * Check if two byte arrays differ only in line endings (CRLF vs LF).
 */
export function differsOnlyInLineEnding(blobBytes: Uint8Array, worktreeBytes: Uint8Array): boolean {
  // Quick check: if lengths match, they are identical
  if (blobBytes.length === worktreeBytes.length) {
    return false;
  }
  // Normalize both to LF and compare
  const normalizeToLf = (bytes: Uint8Array): string => {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes).replaceAll('\r\n', '\n');
  };
  try {
    return normalizeToLf(blobBytes) === normalizeToLf(worktreeBytes);
  } catch {
    return false;
  }
}
