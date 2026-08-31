import { buildReferenceWorkspacePlan } from '../../reference/reference-workspace-template.ts';
import { ensureDir, type CommitFence } from '../../workspace/files.ts';
import { getWorkspacePaths, officialRegistryRelativePath, posixPath, privateRegistryRelativePath } from '../../workspace/paths.ts';
import { ensureProjectBase } from '../../workspace/project.ts';
import type { PlanFile } from '../contract.ts';
import { SUPPORTED_STACK } from '../contract.ts';

export type WorkspaceCreateTemplate = 'minimal' | 'reference-customer';

export function buildMinimalWorkspacePlan(): PlanFile {
  return {
    app: {
      id: 'app',
      name: 'app',
      stack: SUPPORTED_STACK,
      packageManager: 'pnpm',
      mode: 'single-tenant'
    },
    registry: {
      sources: [
        {
          id: 'official',
          kind: 'official',
          location: 'compiler',
          path: posixPath(officialRegistryRelativePath)
        },
        {
          id: 'private',
          kind: 'private',
          location: 'workspace',
          path: posixPath(privateRegistryRelativePath)
        }
      ]
    },
    blocks: [],
    slots: [],
    acceptance: []
  };
}

export function buildWorkspaceCreatePlan(template: WorkspaceCreateTemplate): PlanFile {
  return template === 'reference-customer'
    ? buildReferenceWorkspacePlan()
    : buildMinimalWorkspacePlan();
}

/**
 * Create only the template-owned initial filesystem surface.
 *
 * The minimal template owns the native model/source/test and SEC artifact
 * roots but no runnable machine-oriented scaffold. This keeps registry and
 * control operations available without silently manufacturing Customer/Ticket
 * application code.
 * The historical Customer demo scaffold remains available only through the
 * explicit reference template.
 */
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
    paths.slotsRoot,
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
}
