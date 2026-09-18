import { lstat, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { writeJson } from "../../adapters/filesystem/files.ts";
import { assertWorkspaceWriteLease, withWorkspaceWriteLease, WORKSPACE_WRITE_LEASE_DIRECTORY_NAME, WorkspaceWriteLeaseError, type WorkspaceWriteLeaseToken } from '../../adapters/filesystem/write-lease.ts';
import { getWorkspacePaths, officialRegistryRelativePath, resolveWorkspaceArtifactPath } from "../../adapters/workspace-context.ts";
import { writeYaml } from '../../adapters/workspace/yaml.ts';
import { LOCK_FILE_FORMAT_VERSION, type LockFile } from '../../compiler/contract.ts';
import { CompilerError } from '../../compiler/errors.ts';
import { prepareWorkspaceCreate, type WorkspaceCreateTemplate } from '../../application/workspace-create.ts';
import { saveLock } from "../../adapters/workspace/lock.ts";
import { PASS_STATUS_PENDING } from '../../adapters/compilation/pipeline/defaults.ts';
import { materializeWorkspaceCreateTemplate } from './workspace-create-template.ts';

export interface WorkspaceInitOptions {
  /** Explicit creation template. Ordinary init defaults to the minimal template. */
  readonly template?: WorkspaceCreateTemplate;
}

function nativeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code.toUpperCase() : undefined;
}

async function bootstrapWorkspaceRoot(workspaceRoot: string): Promise<'created' | 'existing'> {
  const absoluteRoot = path.resolve(workspaceRoot);
  try {
    await mkdir(absoluteRoot);
    return 'created';
  } catch (error) {
    const code = nativeErrorCode(error);
    if (code === 'EEXIST') {
      const metadata = await lstat(absoluteRoot);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-004',
          'Workspace root is not one physical directory',
          { operation: 'initialize', phase: 'workspace-root-bootstrap', reason: 'not-directory' }
        );
      }
      return 'existing';
    }
    const reason = code === 'ENOENT'
      ? 'missing-parent'
      : code === 'ENOTDIR'
        ? 'not-directory'
        : code === 'EACCES' || code === 'EPERM'
          ? 'inaccessible'
          : 'unknown';
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace root could not be initialized',
      { operation: 'initialize', phase: 'workspace-root-bootstrap', reason }
    );
  }
}

async function assertWorkspaceCreateSurfaceEmpty(
  workspaceRoot: string,
  suppliedLease: WorkspaceWriteLeaseToken | undefined
): Promise<void> {
  const entries = await readdir(workspaceRoot, { withFileTypes: true });
  if (suppliedLease === undefined) {
    if (entries.length === 0) return;
    const localStateEntry = entries.find((entry) => entry.name === '.sec');
    if (localStateEntry !== undefined && !localStateEntry.isSymbolicLink()
        && localStateEntry.isDirectory()) {
      const localStateEntries = await readdir(path.join(workspaceRoot, '.sec'), {
        withFileTypes: true
      });
      const leaseEntry = localStateEntries.find(
        (entry) => entry.name === WORKSPACE_WRITE_LEASE_DIRECTORY_NAME
      );
      if (leaseEntry !== undefined && !leaseEntry.isSymbolicLink()
          && leaseEntry.isDirectory()) {
        // The canonical acquisition path is the only owner allowed to decide
        // whether this namespace is live, stale/dead, or malformed. Other
        // workspace content does not let this preflight relabel active writer
        // contention as a lifecycle conflict; the callback still validates
        // the complete create surface after authority acquisition.
        return;
      }
    }
    throw new CompilerError(
      'WORKSPACE-INIT-001',
      'Workspace initialization requires an empty root; existing content must be adopted or managed by an explicit lifecycle operation',
      { entries: entries.map((entry) => entry.name).sort() }
    );
  }

  const localStateEntry = entries.find((entry) => entry.name === '.sec');
  const unexpectedRootEntries = entries.filter((entry) => entry.name !== '.sec');
  if (
    unexpectedRootEntries.length > 0 ||
    localStateEntry === undefined ||
    localStateEntry.isSymbolicLink() ||
    !localStateEntry.isDirectory()
  ) {
    throw new CompilerError(
      'WORKSPACE-INIT-001',
      'Workspace initialization with an existing writer lease requires an otherwise empty root',
      { entries: entries.map((entry) => entry.name).sort() }
    );
  }

  const localStateEntries = await readdir(path.join(workspaceRoot, '.sec'), { withFileTypes: true });
  if (
    localStateEntries.length !== 1 ||
    localStateEntries[0]?.name !== WORKSPACE_WRITE_LEASE_DIRECTORY_NAME
  ) {
    throw new CompilerError(
      'WORKSPACE-INIT-001',
      'Workspace initialization cannot overwrite existing local/control state',
      { localStateEntries: localStateEntries.map((entry) => entry.name).sort() }
    );
  }
}

export async function initWorkspace(
  workspaceRoot = process.cwd(),
  options: WorkspaceInitOptions = {},
  workspaceWriteLease?: WorkspaceWriteLeaseToken
): Promise<{ planPath: string; lockPath: string }> {
  workspaceRoot = path.resolve(workspaceRoot);
  const prepared = prepareWorkspaceCreate(options.template, { officialRegistryRelativePath });
  const { template, plan, initialGeneratedPaths } = prepared;
  if (workspaceWriteLease === undefined) {
    await bootstrapWorkspaceRoot(workspaceRoot);
    // No caller authority exists yet. Admit only an empty root or the exact
    // canonical lease namespace; acquisition below owns live/stale recovery.
    await assertWorkspaceCreateSurfaceEmpty(workspaceRoot, undefined);
  }

  return withWorkspaceWriteLease(workspaceRoot, workspaceWriteLease, async (token) => {
    // Reentrant tokens are proven by withWorkspaceWriteLease before this
    // callback. Only now may a supplied-lease path inspect the create surface.
    const commitFence = () => assertWorkspaceWriteLease(workspaceRoot, token);
    const { workspaceConfigPath } = getWorkspacePaths(workspaceRoot);
    const planPath = workspaceConfigPath;
    const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
    const verificationReportPath = resolveWorkspaceArtifactPath(
      workspaceRoot,
      CI_ARTIFACT_FILES.verificationReport
    );
    await assertWorkspaceCreateSurfaceEmpty(workspaceRoot, token);

    await materializeWorkspaceCreateTemplate(workspaceRoot, template, commitFence);
    await writeYaml(planPath, plan, commitFence);
    const initialLock: LockFile = {
      formatVersion: LOCK_FILE_FORMAT_VERSION,
      app: {
        id: plan.app.id,
        name: plan.app.name,
        stack: plan.app.stack,
        mode: plan.app.mode
      },
      resolvedBlocks: [],
      resolvedCapabilities: [],
      installPlan: [],
      generatedPaths: [...initialGeneratedPaths],
      acceptancePlan: plan.acceptance.map((entry) => entry.id),
      passStatus: { ...PASS_STATUS_PENDING }
    };
    await saveLock(workspaceRoot, initialLock, commitFence);
    await writeJson(verificationReportPath, { summary: { status: 'pending' } }, commitFence);
    return { planPath, lockPath };
  });
}
