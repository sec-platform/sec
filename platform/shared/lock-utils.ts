import { uniqueSorted } from './collections.ts';
import { writeJson } from './fs.ts';
import type { LockFile } from './lock-types.ts';

export function addGeneratedPaths(lock: Pick<LockFile, 'generatedPaths'>, paths: readonly string[]): void {
  lock.generatedPaths = uniqueSorted([...lock.generatedPaths, ...paths]);
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
