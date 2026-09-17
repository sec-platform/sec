import {
  ensureCanonicalWorkspaceArtifactParents,
  ensureProjectBase
} from '../../adapters/workspace/project-base.ts';
import { ensureDir } from "../../adapters/filesystem/files.ts";
import { type CommitFence } from "../../contracts/commit-fence.ts";
import { getWorkspacePaths, officialRegistryRelativePath, privateRegistryRelativePath } from "../../adapters/workspace-context.ts";
import { posixPath } from '../../contracts/relative-path.ts';
import type { PlanFile } from '../../compiler/contract.ts';
import { SUPPORTED_STACK } from '../../compiler/contract.ts';

export type WorkspaceCreateTemplate = 'minimal' | 'reference-customer';

const REFERENCE_ACCEPTANCE: readonly PlanFile['acceptance'][number][] = Object.freeze([
  { id: 'user_can_login' },
  { id: 'user_can_create_customer' },
  { id: 'user_can_list_customers' },
  { id: 'tenant_only_sees_own_customers' }
]);

/** Explicit Customer/Tenant/Auth example selected only by the reference template. */
export function buildReferenceWorkspacePlan(): PlanFile {
  return {
    app: {
      id: 'customer-admin',
      name: 'customer-admin',
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
    blocks: [
      { id: 'auth/basic-session', version: '0.1.0' },
      { id: 'tenant/basic-workspace', version: '0.1.0' },
      { id: 'entity/customer-basic', version: '0.1.0' }
    ],
    acceptance: [...REFERENCE_ACCEPTANCE]
  };
}

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
