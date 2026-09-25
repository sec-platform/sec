import {
  semanticMutationStateRoot,
  type SemanticMutationStateLayout
} from '../../workspace/contract/semantic-mutation/state-layout.ts';
import {
  inspectExactNoFollowDirectoryPresence,
  relocateRetainedNoFollowDirectory
} from '../runtime-state/physical/runtime/physical-no-follow.ts';
import type { SemanticMutationCommitFence } from './transaction-identity.ts';

export type SemanticMutationStateLayoutStatus = 'absent' | 'current' | 'legacy' | 'ambiguous';
export type SemanticMutationStateLayoutMigration = 'absent' | 'current' | 'migrated';

function layoutPresence(workspaceRoot: string, layout: SemanticMutationStateLayout) {
  return inspectExactNoFollowDirectoryPresence(
    semanticMutationStateRoot(workspaceRoot, layout),
    `Semantic Mutation ${layout} state root`
  );
}

export function inspectSemanticMutationStateLayoutStatus(
  workspaceRoot: string
): SemanticMutationStateLayoutStatus {
  const current = layoutPresence(workspaceRoot, 'current');
  const legacy = layoutPresence(workspaceRoot, 'legacy');
  if (current.state === 'present' && legacy.state === 'present') return 'ambiguous';
  if (current.state === 'present') return 'current';
  if (legacy.state === 'present') return 'legacy';
  return 'absent';
}

/**
 * Atomically cuts the historical numeric journal root over to the semantic
 * `journal` owner. The whole journal directory moves in one same-parent rename,
 * so transactions, terminal order, and recovery records cannot split across
 * layouts after interruption.
 */
export async function migrateSemanticMutationStateLayout(
  workspaceRoot: string,
  commitFence: SemanticMutationCommitFence
): Promise<SemanticMutationStateLayoutMigration> {
  const initialCurrent = layoutPresence(workspaceRoot, 'current');
  const initialLegacy = layoutPresence(workspaceRoot, 'legacy');
  if (initialCurrent.state === 'present' && initialLegacy.state === 'present') {
    throw new Error('Semantic Mutation current and legacy state roots both exist');
  }
  if (initialLegacy.state === 'absent') {
    return initialCurrent.state === 'present' ? 'current' : 'absent';
  }

  await commitFence();
  const current = layoutPresence(workspaceRoot, 'current');
  const legacy = layoutPresence(workspaceRoot, 'legacy');
  if (current.state === 'present') {
    if (legacy.state === 'present') {
      throw new Error('Semantic Mutation state layout changed to an ambiguous dual root');
    }
    return 'current';
  }
  if (legacy.state === 'absent') return 'absent';
  if (legacy.directory.target.device !== initialLegacy.directory.target.device ||
      legacy.directory.target.inode !== initialLegacy.directory.target.inode ||
      legacy.directory.target.objectId !== initialLegacy.directory.target.objectId) {
    throw new Error('Semantic Mutation legacy state root changed before migration');
  }

  const moved = relocateRetainedNoFollowDirectory({
    directory: legacy.directory.target,
    tombstoneName: 'journal'
  });
  await commitFence();

  const legacyReadback = layoutPresence(workspaceRoot, 'legacy');
  const currentReadback = layoutPresence(workspaceRoot, 'current');
  if (legacyReadback.state !== 'absent' || currentReadback.state !== 'present' ||
      currentReadback.directory.target.device !== moved.device ||
      currentReadback.directory.target.inode !== moved.inode ||
      currentReadback.directory.target.objectId !== moved.objectId) {
    throw new Error('Semantic Mutation state layout migration readback failed');
  }
  return 'migrated';
}
