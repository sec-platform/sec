import type { LockFile } from '../compiler/contract.ts';

export interface LockWorkspaceOperations {
  readLock(): LockFile;
  publishLock(lock: LockFile): void | PromiseLike<void>;
}

/** Coordinate one lock publication. Physical locking and commit fencing remain
 * injected; the application owns read-before-publish ordering and result identity. */
export async function lockWorkspaceResult(
  operations: LockWorkspaceOperations
): Promise<LockFile> {
  const { readLock, publishLock } = operations;
  if (typeof readLock !== 'function' || typeof publishLock !== 'function') {
    throw new TypeError('Workspace lock operations must be callable');
  }
  const lock = readLock.call(operations);
  await publishLock.call(operations, lock);
  return lock;
}
