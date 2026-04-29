import { uniqueSorted } from './collections.ts';
import type { LockFile } from './lock-types.ts';

export function addGeneratedPaths(lock: Pick<LockFile, 'generatedPaths'>, paths: readonly string[]): void {
  lock.generatedPaths = uniqueSorted([...lock.generatedPaths, ...paths]);
}
