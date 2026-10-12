import type { GeneratedStateCleanupOperationState } from './cleanup-budget.ts';
import type { GeneratedStatePhysicalIdentity } from './contract.ts';
import type { GeneratedStateDirectoryObservation } from './registration-port.ts';

export interface GeneratedStateTreeEntry {
  readonly relativePath: string;
  readonly kind: 'directory' | 'file' | 'link';
  readonly device: string;
  readonly inode: string;
  readonly size: number;
  readonly linkTarget: string | null;
}
export interface GeneratedStateRootObservation {
  readonly kind: 'directory' | 'file' | 'link' | 'missing';
  readonly identity: GeneratedStatePhysicalIdentity | null;
  readonly directory: GeneratedStateDirectoryObservation | null;
  readonly linkTarget: string | null;
}
export interface GeneratedStatePhysicalObservationBackend {
  observeWorkspace(): GeneratedStateDirectoryObservation;
  observeRoot(relativePath: string): GeneratedStateRootObservation;
  observeExactDirectory(targetPath: string): GeneratedStateDirectoryObservation | null;
  listDirectoryChildren(relativeParent: string): readonly string[];
  observeTree(target: GeneratedStateDirectoryObservation, budget: GeneratedStateCleanupOperationState | null): readonly GeneratedStateTreeEntry[];
}

export interface GeneratedStateGitWorktreeObservation {
  readonly path: string; readonly headSha: string | null; readonly branch: string | null;
  readonly detached: boolean; readonly bare: boolean; readonly locked: boolean; readonly prunable: boolean;
}
export interface GeneratedStateGitStatusObservation {
  readonly index: string; readonly worktree: string; readonly path: string; readonly originalPath: string | null;
}
export interface GeneratedStateGitObservationBackend {
  observeWorktrees(): Promise<Readonly<{ state: 'unavailable' }> | Readonly<{ state: 'observed'; worktrees: readonly GeneratedStateGitWorktreeObservation[] }>>;
  observeWorktreeTree(): Promise<Readonly<{ state: 'unavailable' }> | Readonly<{ state: 'observed'; treeSha: string }>>;
  observeWorktreeStatus(): Promise<Readonly<{ state: 'unavailable' }> | Readonly<{ state: 'observed'; records: readonly GeneratedStateGitStatusObservation[] }>>;
}
