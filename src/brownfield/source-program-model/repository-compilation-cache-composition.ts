import type { ContentAddressedWorkspaceCacheSessionReceipt } from '../../runtime-state/workspace-state/content-addressed-workspace-cache.ts';

import { createRepositoryCompilationCacheProvider } from './repository-compilation-cache-provider.ts';
import { openRepositoryCompilationCacheSession } from './repository-compilation-cache-session.ts';
import {
  compileRepositorySourceProgramCompilation,
  type RepositorySourceProgramCompilationReceipt
} from './repository-compilation.ts';
import type {
  PhysicalWorkspaceSourceSnapshot,
  WorkspaceTypeScriptProjectInput
} from './workspace-source-snapshot.ts';

export type RepositoryCompilationCacheConsumption = Readonly<{
  compilation: RepositorySourceProgramCompilationReceipt;
  cacheSession: ContentAddressedWorkspaceCacheSessionReceipt;
}>;

/**
 * The sole production composition of Source Program semantic compilation and
 * its disposable Runtime State cache. Cache bytes never escape this boundary
 * and the physical session always settles before the compilation is consumed.
 */
export function compileRepositorySourceProgramCompilationWithCache(input: Readonly<{
  repositoryRoot: string;
  deadlineAtUnixMs: number;
  workspaceSnapshot: PhysicalWorkspaceSourceSnapshot;
  projectInput: WorkspaceTypeScriptProjectInput;
}>): RepositoryCompilationCacheConsumption {
  const session = openRepositoryCompilationCacheSession({
    repositoryRoot: input.repositoryRoot,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    workspaceSnapshot: input.workspaceSnapshot
  });
  let compilation: RepositorySourceProgramCompilationReceipt | null = null;
  let cacheSession: ContentAddressedWorkspaceCacheSessionReceipt | null = null;
  try {
    compilation = compileRepositorySourceProgramCompilation({
      workspaceSnapshot: input.workspaceSnapshot,
      projectInput: input.projectInput,
      cacheProvider: createRepositoryCompilationCacheProvider({ session }),
      repositoryRoot: input.repositoryRoot
    });
  } finally {
    cacheSession = session.close();
  }
  if (compilation === null || cacheSession === null) {
    throw new Error('Repository compilation cache composition returned without a settled compilation.');
  }
  return Object.freeze({ compilation, cacheSession });
}
