import { lstat, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { CompilerError } from '../../compiler/errors.ts';
import type { CommitFence } from '../../contracts/commit-fence.ts';
import { ensureDir } from '../filesystem/files.ts';
import { WORKSPACE_WRITE_LEASE_DIRECTORY_NAME, WorkspaceWriteLeaseError, type WorkspaceWriteLeaseToken } from '../filesystem/write-lease.ts';
import { getWorkspacePaths } from '../workspace-context.ts';
import { ensureCanonicalWorkspaceArtifactParents } from './project-base.ts';

function nativeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code.toUpperCase() : undefined;
}

export async function ensureWorkspaceCreateRoot(workspaceRoot: string): Promise<'created' | 'existing'> {
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

export async function assertWorkspaceCreateSurfaceEmpty(
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

/** Materialize the minimal native surface under the caller's existing fence. */
export async function materializeMinimalWorkspace(
  workspaceRoot: string,
  commitFence?: CommitFence
): Promise<void> {
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
