import {
  ensureCanonicalWorkspaceArtifactParents,
  ensureProjectBase
} from '../../adapters/workspace/project-base.ts';
import { ensureDir } from '../../adapters/filesystem/files.ts';
import type { CommitFence } from '../../contracts/commit-fence.ts';
import { getWorkspacePaths } from '../../adapters/workspace-context.ts';
import type { WorkspaceCreateTemplate } from '../../application/workspace-create.ts';

/** Materialize only the host filesystem surface selected by the prepared use case. */
export async function materializeWorkspaceCreateTemplate(
  workspaceRoot: string,
  template: WorkspaceCreateTemplate,
  commitFence?: CommitFence
): Promise<void> {
  if (template === 'reference-customer') {
    await ensureProjectBase(workspaceRoot, commitFence);
    return;
  }

  const paths = getWorkspacePaths(workspaceRoot);
  const nativeWorkspaceDirectories = [
    paths.modelRoot,
    paths.modelBlocksRoot,
    paths.policiesRoot,
    paths.overridesRoot,
    paths.privateRegistryRoot,
    paths.srcRoot,
    paths.testsRoot,
    paths.prismaRoot,
    paths.secRoot,
    paths.artifactsRoot,
    paths.cacheRoot,
    paths.workspaceWriteLeaseRoot
  ];
  for (const directory of nativeWorkspaceDirectories) {
    await ensureDir(directory, commitFence);
  }
  await ensureCanonicalWorkspaceArtifactParents(workspaceRoot, commitFence);
}
