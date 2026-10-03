import path from 'node:path';
import YAML from 'yaml';
import { withWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../adapters/filesystem/write-lease.ts';
import { getWorkspacePaths, officialRegistryRelativePath, resolveWorkspaceArtifactPath } from '../../adapters/workspace-context.ts';
import { publishWorkspaceCreateGeneration } from '../../adapters/workspace/create-generation.ts';
import { assertWorkspaceCreateSurfaceEmpty, buildMinimalWorkspaceTemplate, ensureWorkspaceCreateRoot } from '../../adapters/workspace/create-surface.ts';
import { buildProjectBaseTemplate, type WorkspaceTemplateBlueprint, type WorkspaceTemplateFile } from '../../adapters/workspace/project-base.ts';
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
    let blueprint: WorkspaceTemplateBlueprint = { directories: [], files: [] };
    const initialFiles: WorkspaceTemplateFile[] = [];
    await initializePreparedWorkspace(prepared, {
      assertEmpty: () => {},
      materialize: async template => {
        blueprint = template === 'reference-customer'
          ? await buildProjectBaseTemplate(workspaceRoot)
          : buildMinimalWorkspaceTemplate(workspaceRoot);
      },
      writePlan: plan => { initialFiles.push({ relativePath: path.basename(planPath), bytes: Buffer.from(YAML.stringify(plan, { indent: 2 })) }); },
      writeLock: lock => { initialFiles.push({ relativePath: CI_ARTIFACT_FILES.graphLock, creationMode: 0o600, bytes: Buffer.from(formatJsonFile(requireLockFileSchema(lock, 'workspace initializer'))) }); },
      writePendingVerification: () => { initialFiles.push({ relativePath: CI_ARTIFACT_FILES.verificationReport, bytes: Buffer.from(formatJsonFile({ summary: { status: 'pending' } })) }); }
    });
    await publishWorkspaceCreateGeneration({ workspaceRoot, template: prepared.template, token,
      blueprint: { directories: blueprint.directories, files: [...blueprint.files, ...initialFiles] } });
    return { planPath, lockPath };
  });
}
