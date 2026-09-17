import path from 'node:path';
import { createNoFollowDirectoryChain, inspectNoFollowDirectoryChain, PhysicalNoFollowError, readNoFollowOrdinaryFile, replaceDurableCanonicalFile, type PhysicalDirectoryIdentity } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { CI_ARTIFACT_FILES, expandCiGeneratedArtifactPaths } from '../../verification/ci-artifacts/contract/manifest.ts';
import { formatJsonFile } from "../../contracts/json-text.ts";
import { type CommitFence } from "../../contracts/commit-fence.ts";
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../workspace-context.ts";
import type { LockFile } from '../../compiler/contract.ts';
import { addGeneratedPaths, requireLockFileSchema } from '../../compiler/contract/lock-schema.ts';

function decodeExactLockJson(bytes: Uint8Array, filePath: string): LockFile {
  let raw: string;
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`Lock file at "${filePath}" is not exact UTF-8`, { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Lock file at "${filePath}" is not valid JSON`, { cause: error });
  }
  if (formatJsonFile(parsed) !== raw) {
    throw new Error(`Lock file at "${filePath}" is not canonical JSON`);
  }
  return requireLockFileSchema(parsed, `"${filePath}"`);
}

function readOptionalLockAtPath(filePath: string): LockFile | null {
  const absolutePath = path.resolve(filePath);
  try {
    const parent = inspectNoFollowDirectoryChain(
      path.dirname(absolutePath),
      'Lock parent directory'
    ).target;
    const bytes = readNoFollowOrdinaryFile(parent, path.basename(absolutePath));
    return bytes === null ? null : decodeExactLockJson(bytes, absolutePath);
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') {
      return null;
    }
    throw error;
  }
}

function missingLockError(lockPath: string): NodeJS.ErrnoException {
  const absolutePath = path.resolve(lockPath);
  const error = new Error(`Lock file not found: ${absolutePath}`) as NodeJS.ErrnoException;
  error.code = 'ENOENT';
  error.path = absolutePath;
  return error;
}

/** Retained Lock observation is synchronous; publication remains asynchronous. */
export function readLockFile(workspaceRoot: string): LockFile {
  const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
  const canonical = readOptionalLockAtPath(lockPath);
  if (canonical !== null) return canonical;
  throw missingLockError(lockPath);
}

function canonicalWorkspaceRootForLockPath(lockPath: string): string {
  const absolutePath = path.resolve(lockPath);
  const artifactSegments = CI_ARTIFACT_FILES.graphLock.split('/');
  let workspaceRoot = absolutePath;
  for (let index = 0; index < artifactSegments.length; index += 1) {
    workspaceRoot = path.dirname(workspaceRoot);
  }
  const expectedLockPath = path.resolve(
    resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock)
  );
  if (absolutePath !== expectedLockPath) {
    throw new Error(`Refusing non-canonical Lock publication path: ${absolutePath}`);
  }
  return workspaceRoot;
}

async function retainedLockParent(
  lockPath: string,
  commitFence?: CommitFence
): Promise<PhysicalDirectoryIdentity> {
  const absolutePath = path.resolve(lockPath);
  const workspaceRoot = canonicalWorkspaceRootForLockPath(absolutePath);
  const parentPath = path.dirname(absolutePath);
  try {
    return inspectNoFollowDirectoryChain(parentPath, 'Lock parent directory').target;
  } catch (error) {
    if (!(error instanceof PhysicalNoFollowError) || error.code !== 'PHYSICAL_NO_FOLLOW_ABSENT') {
      throw error;
    }
  }

  const secRoot = inspectNoFollowDirectoryChain(
    getWorkspacePaths(workspaceRoot).secRoot,
    'Lock SEC root'
  ).target;
  await commitFence?.();
  return createNoFollowDirectoryChain(
    secRoot,
    CI_ARTIFACT_FILES.graphLock.split('/').slice(1, -1)
  );
}

async function publishLockAtPath(
  lockPath: string,
  lock: LockFile,
  commitFence?: CommitFence
): Promise<void> {
  const validatedLock = requireLockFileSchema(lock, 'the compiler producer');
  const parent = await retainedLockParent(lockPath, commitFence);
  const bytes = Buffer.from(formatJsonFile(validatedLock), 'utf8');
  await commitFence?.();
  replaceDurableCanonicalFile({
    parent,
    name: 'graph.lock.json',
    bytes,
    validate: (current) => {
      if (!Buffer.from(current).equals(bytes)) {
        throw new Error('Lock readback differs from canonical JSON bytes');
      }
    }
  });
}

export async function saveLock(
  workspaceRoot: string,
  lock: LockFile,
  commitFence?: CommitFence
): Promise<void> {
  const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
  await publishLockAtPath(lockPath, lock, commitFence);
}

export async function writeLockWithGeneratedPaths(
  lockPath: string,
  lock: LockFile,
  paths: readonly string[],
  commitFence?: CommitFence
): Promise<void> {
  const previousGeneratedPaths = [...lock.generatedPaths];
  addGeneratedPaths(lock, paths);
  try {
    await publishLockAtPath(lockPath, lock, commitFence);
  } catch (error) {
    lock.generatedPaths = previousGeneratedPaths;
    throw error;
  }
}

export async function writeGeneratedArtifactWithLock<T>(
  lockPath: string,
  lock: LockFile,
  paths: readonly string[],
  writeArtifact: () => Promise<T>,
  commitFence?: CommitFence
): Promise<T> {
  const previousGeneratedPaths = [...lock.generatedPaths];
  addGeneratedPaths(lock, expandCiGeneratedArtifactPaths(paths));
  try {
    const artifact = await writeArtifact();
    await publishLockAtPath(lockPath, lock, commitFence);
    return artifact;
  } catch (error) {
    lock.generatedPaths = previousGeneratedPaths;
    throw error;
  }
}
