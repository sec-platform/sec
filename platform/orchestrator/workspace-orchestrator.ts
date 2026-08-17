import { lstat, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

import { buildReferenceWorkspacePlan } from '../reference/reference-workspace-template.ts';
import { CI_ARTIFACT_FILES } from '../shared/ci-artifact-contract.ts';
import { PASS_STATUS_PENDING } from '../shared/constants.ts';
import { CompilerError } from '../shared/errors.ts';
import { writeJson } from '../shared/fs.ts';
import { getWorkspacePaths } from '../shared/paths.ts';
import { ensureProjectBase } from '../shared/project-base.ts';
import {
  assertWorkspaceWriteLease,
  inspectWorkspaceWriteLease,
  withWorkspaceWriteLease,
  WORKSPACE_WRITE_LEASE_DIRECTORY_NAME,
  WorkspaceWriteLeaseError,
  type WorkspaceWriteLeaseToken
} from '../shared/workspace-write-lease.ts';
import { writeYaml } from '../shared/yaml.ts';

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

async function assertNoActiveWorkspaceWriter(workspaceRoot: string): Promise<void> {
  const leaseRoot = path.join(workspaceRoot, '.sec', WORKSPACE_WRITE_LEASE_DIRECTORY_NAME);
  try {
    const metadata = await lstat(leaseRoot);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) return;
  } catch (error) {
    if (nativeErrorCode(error) === 'ENOENT') return;
    throw error;
  }
  const inspection = await inspectWorkspaceWriteLease(workspaceRoot);
  if (inspection.state === 'active') {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-001',
      'Workspace writer lease already held',
      { operation: 'initialize', phase: 'pre-create-inspection' }
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
  options: { reset?: boolean } = {},
  workspaceWriteLease?: WorkspaceWriteLeaseToken
): Promise<{ planPath: string; lockPath: string }> {
  void options.reset;
  if (workspaceWriteLease === undefined) {
    await bootstrapWorkspaceRoot(workspaceRoot);
    await assertNoActiveWorkspaceWriter(workspaceRoot);
  }
  await assertWorkspaceCreateSurfaceEmpty(workspaceRoot, workspaceWriteLease);

  return withWorkspaceWriteLease(workspaceRoot, workspaceWriteLease, async (token) => {
    const commitFence = () => assertWorkspaceWriteLease(workspaceRoot, token);
    const { planPath, lockPath, verificationReportPath } = getWorkspacePaths(workspaceRoot);
    await assertWorkspaceCreateSurfaceEmpty(workspaceRoot, token);

    const plan = buildReferenceWorkspacePlan();
    await ensureProjectBase(workspaceRoot, commitFence);
    await writeYaml(planPath, plan, commitFence);
    await writeJson(lockPath, {
      formatVersion: '1',
      app: {
        id: plan.app.id,
        name: plan.app.name,
        stack: plan.app.stack,
        mode: plan.app.mode,
        ...(plan.app.target ? { target: plan.app.target } : {})
      },
      resolvedBlocks: [],
      resolvedCapabilities: [],
      installPlan: [],
      slotTasks: [],
      generatedPaths: [
        'generated/routes.ts',
        CI_ARTIFACT_FILES.blockUsageMap,
        CI_ARTIFACT_FILES.installManifest,
        CI_ARTIFACT_FILES.verificationReport
      ],
      acceptancePlan: plan.acceptance.map((entry) => entry.id),
      passStatus: { ...PASS_STATUS_PENDING }
    }, commitFence);
    await writeJson(verificationReportPath, { summary: { status: 'pending' } }, commitFence);
    return { planPath, lockPath };
  });
}
