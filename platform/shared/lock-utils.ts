import { uniqueSorted } from './collections.ts';
import { readJson, writeJson } from './fs.ts';
import type { LockFile, PassState, PassStatus } from './lock-types.ts';
import { getWorkspacePaths, resolveWorkspaceLockPath } from './paths.ts';

export function addGeneratedPaths(lock: Pick<LockFile, 'generatedPaths'>, paths: readonly string[]): void {
  lock.generatedPaths = uniqueSorted([...lock.generatedPaths, ...paths]);
}

export function assertPassStatus(lock: LockFile, pass: keyof PassStatus, state: PassState, error: Error, mode: 'equals' | 'differs' = 'equals'): void {
  if ((lock.passStatus[pass] === state) !== (mode === 'equals')) throw error;
}

export async function readLockFile(workspaceRoot: string): Promise<LockFile> {
  return readJson<LockFile>(await resolveWorkspaceLockPath(workspaceRoot));
}

export async function saveLock(workspaceRoot: string, lock: LockFile): Promise<void> {
  const { lockPath } = getWorkspacePaths(workspaceRoot);
  await writeJson(lockPath, lock);
}

export async function writeLockWithGeneratedPaths(
  lockPath: string,
  lock: LockFile,
  paths: readonly string[]
): Promise<void> {
  addGeneratedPaths(lock, paths);
  await writeJson(lockPath, lock);
}

export async function writeGeneratedArtifactWithLock<T>(
  lockPath: string,
  lock: LockFile,
  paths: readonly string[],
  writeArtifact: () => Promise<T>
): Promise<T> {
  addGeneratedPaths(lock, paths);
  const artifact = await writeArtifact();
  await writeJson(lockPath, lock);
  return artifact;
}
