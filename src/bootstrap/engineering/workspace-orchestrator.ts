import path from 'node:path';
import YAML from 'yaml';
import { withWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../adapters/filesystem/write-lease.ts';
import { getWorkspacePaths, officialRegistryRelativePath, resolveWorkspaceArtifactPath } from '../../adapters/workspace-context.ts';
import { openWorkspaceCreateSession } from '../../adapters/workspace/create-generation.ts';
import { assertWorkspaceCreateSurfaceEmpty, buildMinimalWorkspaceTemplate, ensureWorkspaceCreateRoot } from '../../adapters/workspace/create-surface.ts';
import { buildProjectBaseTemplate } from '../../adapters/workspace/project-base.ts';
import { prepareWorkspaceCreate } from '../../application/workspace-create.ts';
import { initializePreparedWorkspace } from '../../application/workspace-initialize.ts';
import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { requireLockFileSchema } from '../../compiler/contract/lock-schema.ts';
import { formatJsonFile } from '../../contracts/json-text.ts';
import type { WorkspaceCreateTemplate } from '../../execution/workspace-create.ts';
import { workspaceConfigRelativePath } from '../../workspace/paths.ts';

export interface WorkspaceInitOptions {
  readonly template?: WorkspaceCreateTemplate;
}

/** Bind concrete providers. Application owns initial intent and lifecycle. */
export async function initWorkspace(
  workspaceRoot = process.cwd(),
  options: WorkspaceInitOptions = {},
  workspaceWriteLease?: WorkspaceWriteLeaseToken
): Promise<{ planPath: string; lockPath: string }> {
  workspaceRoot = path.resolve(workspaceRoot);
  const prepared = prepareWorkspaceCreate(options.template, { officialRegistryRelativePath });
  if (workspaceWriteLease === undefined) {
    await ensureWorkspaceCreateRoot(workspaceRoot);
    // Existing canonical lease namespaces proceed to their sole acquisition
    // owner. Foreign roots still fail before a new writer namespace is born.
    await assertWorkspaceCreateSurfaceEmpty(workspaceRoot, undefined);
  }
  return withWorkspaceWriteLease(workspaceRoot, workspaceWriteLease, async token => {
    await initializePreparedWorkspace(prepared, {
      loadTemplate: template => template === 'reference-customer'
        ? buildProjectBaseTemplate(workspaceRoot)
        : buildMinimalWorkspaceTemplate(workspaceRoot),
      renderControls: (plan, lock) => ({
        directories: [],
        files: [
          { relativePath: workspaceConfigRelativePath, bytes: Buffer.from(YAML.stringify(plan, { indent: 2 })) },
          { relativePath: CI_ARTIFACT_FILES.graphLock, creationMode: 0o600,
            bytes: Buffer.from(formatJsonFile(requireLockFileSchema(lock, 'workspace initializer'))) },
          { relativePath: CI_ARTIFACT_FILES.verificationReport,
            bytes: Buffer.from(formatJsonFile({ summary: { status: 'pending' } })) }
        ]
      }),
      openSession: () => openWorkspaceCreateSession({ workspaceRoot, token })
    });
    return {
      planPath: getWorkspacePaths(workspaceRoot).workspaceConfigPath,
      lockPath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock)
    };
  });
}
