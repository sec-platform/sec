import path from 'node:path';

import { CodedFailure } from '../../../../contracts/failure.ts';
import {
  assertPhysicallyDisjointDirectoryChains,
  inspectNoFollowDirectoryChain,
  physicallyContainsDirectoryChain
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { resolveSecWorkspaceRuntimeRoots } from '../../../runtime-state/workspace-state/paths.ts';

/** Location only: qualification remains bound to the real engineering owner. */
export function compilerDependencyStoragePaths(ownerRoot: string) {
  ownerRoot = path.resolve(ownerRoot);
  const roots = resolveSecWorkspaceRuntimeRoots({ repositoryRoot: ownerRoot });
  const cachePartition = path.join(roots.cacheRoot, 'workspaces', 'v1', roots.workspaceLocatorKey.slice(7), 'compiler-dependencies');
  const statePartition = path.join(roots.workspaceStateRoot, 'compiler-dependencies');
  const legacyBackupRoot = path.join(ownerRoot, '.tmp', 'dependency-installs', 'compiler-backups');
  return Object.freeze({
    generationRoot: path.join(cachePartition, 'generations'),
    stageParent: path.join(cachePartition, 'stages'),
    journalRoot: path.join(statePartition, 'journal-v2'),
    proofRoot: path.join(statePartition, 'read-only-generations'),
    legacyRelocationsRoot: path.join(statePartition, 'legacy-relocations'),
    stageIntentRoot: path.join(statePartition, 'stage-intents'),
    legacyBackupRoot,
    legacyJournalRoot: path.join(legacyBackupRoot, '.dependency-transition-v2')
  });
}

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

export function compilerDependencySourcePathIsInScope(ownerRoot: string, sourcePath: string): boolean {
  ownerRoot = path.resolve(ownerRoot);
  sourcePath = path.resolve(sourcePath);
  if (within(ownerRoot, sourcePath)) return true;
  const paths = compilerDependencyStoragePaths(ownerRoot);
  return within(paths.generationRoot, sourcePath) || within(paths.stageParent, sourcePath);
}

/** Lexical selection never replaces physical ancestry and separation checks. */
export function assertCompilerDependencySourceScope(ownerRoot: string, sourcePath: string): void {
  ownerRoot = path.resolve(ownerRoot);
  sourcePath = path.resolve(sourcePath);
  if (!compilerDependencySourcePathIsInScope(ownerRoot, sourcePath)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Dependency source is outside its exact owner cache partition');
  }
  const owner = inspectNoFollowDirectoryChain(ownerRoot, 'Dependency source engineering owner');
  const source = inspectNoFollowDirectoryChain(sourcePath, 'Dependency source no-follow chain');
  if (within(ownerRoot, sourcePath)) {
    if (sourcePath !== ownerRoot && !physicallyContainsDirectoryChain(owner, source)) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Dependency source has no physical engineering owner ancestry');
    }
    return;
  }
  const roots = resolveSecWorkspaceRuntimeRoots({ repositoryRoot: ownerRoot });
  const cache = inspectNoFollowDirectoryChain(roots.cacheRoot, 'Dependency source cache root');
  assertPhysicallyDisjointDirectoryChains(owner, cache, 'Dependency cache and engineering owner');
  if (!physicallyContainsDirectoryChain(cache, source)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Dependency source has no physical cache ancestry');
  }
}
