import path from 'node:path';
import { assertGeneratedStateWorktreeRetirement, type GeneratedStateWorktreeRetirement } from './contract.ts';
import type { GeneratedStatePhysicalObservationBackend } from './physical-port.ts';
export interface GeneratedStateWorktreeRetirementInput {
  readonly repositoryRoot: string; readonly workspaceRoot: string;
  readonly expectedBranch: string; readonly expectedHeadSha: string; readonly expectedTreeSha: string;
}
export function assertGeneratedStateWorktreeRetirementEffectStart(input: GeneratedStateWorktreeRetirementInput &
  Readonly<{ receipt: GeneratedStateWorktreeRetirement }>, physical: GeneratedStatePhysicalObservationBackend): GeneratedStateWorktreeRetirement {
  const receipt = assertGeneratedStateWorktreeRetirement(input.receipt);
  if (path.resolve(input.repositoryRoot) !== receipt.repositoryRoot || path.resolve(input.workspaceRoot) !== receipt.workspacePath ||
      input.expectedBranch !== receipt.worktree.branch || input.expectedHeadSha !== receipt.worktree.headSha ||
      input.expectedTreeSha !== receipt.worktree.treeSha || receipt.terminal !== 'completed') throw new Error('Worktree retirement Effect-start binding changed.');
  const same = (left: { device: string; inode: string; objectId: string }, right: typeof left) =>
    left.device === right.device && left.inode === right.inode && left.objectId === right.objectId;
  const retention = receipt.retentionRoot === null ? null : physical.observeExactDirectory(receipt.retentionRoot.path);
  if (receipt.retentionRoot !== null && (retention === null || !same(retention, receipt.retentionRoot))) throw new Error('Worktree retirement retention root changed.');
  for (const entry of receipt.entries) {
    if (physical.observeRoot(entry.relativePath).kind !== 'missing') throw new Error(`Worktree retirement source reappeared: ${entry.relativePath}.`);
    if (entry.action === 'domain-retired') continue;
    const retained = retention === null ? null : physical.observeExactDirectory(path.join(retention.path, entry.destinationName));
    if (retained === null || !same(retained, entry.retained) || !same(entry.source, entry.retained)) throw new Error('Worktree preserved root changed.');
  }
  return receipt;
}
