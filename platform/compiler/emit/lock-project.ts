import fs from 'node:fs/promises';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { CompilerError } from '../../shared/errors.ts';
import type { LockFile } from '../../shared/types.ts';

export async function lockProject(workspaceRoot: string, lock: LockFile): Promise<LockFile> {
  const { lockPath } = getWorkspacePaths(workspaceRoot);

  if (lock.passStatus.verify !== 'succeeded') {
    throw new CompilerError('LOCK-BLOCKED-001', 'verify must succeed before lock');
  }

  lock.passStatus.lock = 'succeeded';
  lock.passStatus.emit = 'succeeded';
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  return lock;
}
