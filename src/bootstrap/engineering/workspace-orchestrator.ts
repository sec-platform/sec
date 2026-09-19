import path from 'node:path';
import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { prepareWorkspaceCreate, type WorkspaceCreateTemplate } from '../../application/workspace-create.ts';
import { initializePreparedWorkspace } from '../../application/workspace-initialize.ts';
import { writeJson } from '../../adapters/filesystem/files.ts';
import { assertWorkspaceWriteLease, withWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../adapters/filesystem/write-lease.ts';
import { getWorkspacePaths, officialRegistryRelativePath, resolveWorkspaceArtifactPath } from '../../adapters/workspace-context.ts';
import { assertWorkspaceCreateSurfaceEmpty, ensureWorkspaceCreateRoot, materializeMinimalWorkspace } from '../../adapters/workspace/create-surface.ts';
import { ensureProjectBase } from '../../adapters/workspace/project-base.ts';
import { writeYaml } from '../../adapters/workspace/yaml.ts';
import { saveLock } from '../../adapters/workspace/lock.ts';

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
    const commitFence = () => assertWorkspaceWriteLease(workspaceRoot, token);
    const { workspaceConfigPath: planPath } = getWorkspacePaths(workspaceRoot);
    const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
    const verificationReportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.verificationReport);
    await initializePreparedWorkspace(prepared, {
      assertEmpty: () => assertWorkspaceCreateSurfaceEmpty(workspaceRoot, token),
      materialize: template => template === 'reference-customer'
        ? ensureProjectBase(workspaceRoot, commitFence)
        : materializeMinimalWorkspace(workspaceRoot, commitFence),
      writePlan: plan => writeYaml(planPath, plan, commitFence),
      writeLock: lock => saveLock(workspaceRoot, lock, commitFence),
      writePendingVerification: () => writeJson(verificationReportPath, { summary: { status: 'pending' } }, commitFence)
    });
    return { planPath, lockPath };
  });
}
