import path from 'node:path';
import YAML from 'yaml';
import { withWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../adapters/filesystem/write-lease.ts';
import { getWorkspacePaths, officialRegistryRelativePath, resolveWorkspaceArtifactPath } from '../../adapters/workspace-context.ts';
import { publishWorkspaceCreate } from '../../adapters/workspace/create-publication.ts';
import { assertWorkspaceCreateSurfaceEmpty, buildMinimalWorkspaceTemplate, ensureWorkspaceCreateRoot } from '../../adapters/workspace/create-surface.ts';
import { buildProjectBaseTemplate } from '../../adapters/workspace/project-base.ts';
import { prepareWorkspaceCreate, type WorkspaceCreateTemplate } from '../../application/workspace-create.ts';
import { initializePreparedWorkspace } from '../../application/workspace-initialize.ts';
import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { requireLockFileSchema } from '../../compiler/contract/lock-schema.ts';
import { formatJsonFile } from '../../contracts/json-text.ts';

export interface WorkspaceInitOptions {
  /** Explicit creation template. Ordinary init defaults to the minimal template. */
  readonly template?: WorkspaceCreateTemplate;
}

export async function initWorkspace(
  workspaceRoot = process.cwd(),
  options: WorkspaceInitOptions = {},
  workspaceWriteLease?: WorkspaceWriteLeaseToken
): Promise<{ planPath: string; lockPath: string }> {
  workspaceRoot = path.resolve(workspaceRoot);
  const prepared = prepareWorkspaceCreate(options.template, { officialRegistryRelativePath });
  if (workspaceWriteLease === undefined) {
    await ensureWorkspaceCreateRoot(workspaceRoot);
    // Acquisition remains the sole owner of live/stale writer recovery.
    await assertWorkspaceCreateSurfaceEmpty(workspaceRoot, undefined);
  }
  return withWorkspaceWriteLease(workspaceRoot, workspaceWriteLease, async token => {
    const { workspaceConfigPath: planPath } = getWorkspacePaths(workspaceRoot);
    const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
    await initializePreparedWorkspace(prepared, {
      publish: async (template, plan, lock) => {
        const material = template === 'reference-customer'
          ? await buildProjectBaseTemplate(workspaceRoot)
          : buildMinimalWorkspaceTemplate(workspaceRoot);
        await publishWorkspaceCreate({ workspaceRoot, token, template, material: {
          directories: material.directories,
          files: [...material.files,
            { relativePath: path.relative(workspaceRoot, planPath).split(path.sep).join('/'), bytes: Buffer.from(YAML.stringify(plan, { indent: 2 })) },
            { relativePath: CI_ARTIFACT_FILES.graphLock, bytes: Buffer.from(formatJsonFile(requireLockFileSchema(lock, 'workspace Create'))) },
            { relativePath: CI_ARTIFACT_FILES.verificationReport, bytes: Buffer.from(formatJsonFile({ summary: { status: 'pending' } })) }
          ]
        } });
      }
    });
    return { planPath, lockPath };
  });
}
