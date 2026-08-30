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
 * The minimal template owns the generic SEC authoring/control skeleton but no
 * runnable machine-oriented scaffold. This keeps Registry/Control operations
 * available without silently manufacturing Customer/Ticket application code.
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
  const genericWorkspaceDirectories = [
    paths.developerSourceRoot,
    paths.sourceCodeRoot,
    paths.sourceModelRoot,
    paths.sourceBlocksRoot,
    paths.sourcePatchesRoot,
    paths.sourceSlotsRoot,
    paths.sourcePoliciesRoot,
    paths.sourceAcceptanceRoot,
    paths.sourceAssetsRoot,
    paths.sourceEnvRoot,
    paths.privateRegistryRoot,
    paths.controlRoot,
    paths.controlStateRoot,
    paths.controlEvidenceRoot,
    paths.controlProvenanceRoot,
    paths.controlGraphRoot,
    paths.controlWorkflowRoot,
    paths.controlAuditRoot,
    paths.controlCiRoot,
    paths.localStateRoot
  ];
  for (const directory of genericWorkspaceDirectories) {
    await ensureDir(directory, commitFence);
  }
}
