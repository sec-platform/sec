import path from 'node:path';

import { expandCiGeneratedArtifactPaths } from './ci-artifact-contract.ts';
import { uniqueSorted } from './collections.ts';
import { formatJsonFile, type CommitFence } from './fs.ts';
import type { LockFile, PassState, PassStatus } from './lock-types.ts';
import { getWorkspacePaths } from './paths.ts';
import {
  createNoFollowDirectoryChainV1,
  inspectNoFollowDirectoryChainV1,
  PhysicalNoFollowError,
  readNoFollowOrdinaryFileV1,
  replaceDurableCanonicalFileV1,
  type PhysicalDirectoryIdentityV1
} from './physical-no-follow.ts';

export function addGeneratedPaths(lock: Pick<LockFile, 'generatedPaths'>, paths: readonly string[]): void {
  lock.generatedPaths = uniqueSorted([...lock.generatedPaths, ...paths]);
}

export function assertPassStatus(lock: LockFile, pass: keyof PassStatus, state: PassState, error: Error, mode: 'equals' | 'differs' = 'equals'): void {
  if ((lock.passStatus[pass] === state) !== (mode === 'equals')) throw error;
}

function decodeExactLockJson(bytes: Uint8Array, filePath: string): LockFile {
  let raw: string;
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`Lock file at "${filePath}" is not exact UTF-8`, { cause: error });
  }
  return JSON.parse(raw) as LockFile;
}

function readOptionalLockAtPath(filePath: string): LockFile | null {
  const absolutePath = path.resolve(filePath);
  try {
    const parent = inspectNoFollowDirectoryChainV1(
      path.dirname(absolutePath),
      'Lock parent directory'
    ).target;
    const bytes = readNoFollowOrdinaryFileV1(parent, path.basename(absolutePath));
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
  const { lockPath, legacyLockPath } = getWorkspacePaths(workspaceRoot);
  const canonical = readOptionalLockAtPath(lockPath);
  if (canonical !== null) return canonical;
  const legacy = readOptionalLockAtPath(legacyLockPath);
  if (legacy !== null) return legacy;
  throw missingLockError(lockPath);
}

function canonicalWorkspaceRootForLockPath(lockPath: string): string {
  const absolutePath = path.resolve(lockPath);
  const stateRoot = path.dirname(absolutePath);
  const controlRoot = path.dirname(stateRoot);
  const workspaceRoot = path.dirname(controlRoot);
  const expectedLockPath = path.resolve(getWorkspacePaths(workspaceRoot).lockPath);
  if (absolutePath !== expectedLockPath) {
    throw new Error(`Refusing non-canonical Lock publication path: ${absolutePath}`);
  }
  return workspaceRoot;
}

async function retainedLockParent(
  lockPath: string,
  commitFence?: CommitFence
): Promise<PhysicalDirectoryIdentityV1> {
  const absolutePath = path.resolve(lockPath);
  const workspaceRoot = canonicalWorkspaceRootForLockPath(absolutePath);
  const parentPath = path.dirname(absolutePath);
  try {
    return inspectNoFollowDirectoryChainV1(parentPath, 'Lock parent directory').target;
  } catch (error) {
    if (!(error instanceof PhysicalNoFollowError) || error.code !== 'PHYSICAL_NO_FOLLOW_ABSENT') {
      throw error;
    }
  }

  const workspace = inspectNoFollowDirectoryChainV1(workspaceRoot, 'Lock workspace root').target;
  await commitFence?.();
  return createNoFollowDirectoryChainV1(workspace, ['control', 'state']);
}

async function publishLockAtPath(
  lockPath: string,
  lock: LockFile,
  commitFence?: CommitFence
): Promise<void> {
  const parent = await retainedLockParent(lockPath, commitFence);
  const bytes = Buffer.from(formatJsonFile(lock), 'utf8');
  await commitFence?.();
  replaceDurableCanonicalFileV1({
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
  const { lockPath } = getWorkspacePaths(workspaceRoot);
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
