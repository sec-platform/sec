import fs from 'node:fs/promises';
import path from 'node:path';

import { globby } from 'globby';

import { pathExists } from '../../shared/fs.ts';
import { defaultLogger } from '../../shared/logger.ts';
import { checkProjectWriteBoundary } from '../../shared/project-write-boundary.ts';

function isIgnorableChmodError(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) return false;
  const code = (error as { code?: string }).code;
  return code === 'ENOENT' || code === 'EPERM' || code === 'EACCES';
}

export async function setFileWritable(filePath: string, writable: boolean): Promise<void> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return;
    const currentMode = stat.mode;
    let newMode = currentMode;
    if (writable) {
      newMode = currentMode | 0o200;
    } else {
      newMode = currentMode & ~0o222;
    }
    if (newMode !== currentMode) {
      await fs.chmod(filePath, newMode);
    }
  } catch (err) {
    if (!isIgnorableChmodError(err)) {
      defaultLogger.warn('Failed to chmod project file', { filePath, writable, error: err });
    }
  }
}

export async function setProjectReadOnlyLock(
  projectRoot: string,
  writable: boolean,
  slotTargets: string[] = []
): Promise<void> {
  if (writable) {
    await checkProjectWriteBoundary(path.dirname(projectRoot));
  }
  if (!(await pathExists(projectRoot))) return;

  const absoluteSlots = new Set(
    slotTargets.map((target) => path.resolve(projectRoot, target))
  );

  const files = await globby('**/*', {
    cwd: projectRoot,
    absolute: true,
    dot: true,
    onlyFiles: true,
    ignore: ['**/node_modules/**']
  });

  for (const file of files) {
    const isSlot = absoluteSlots.has(path.resolve(file));
    if (isSlot) {
      await setFileWritable(file, true);
    } else {
      await setFileWritable(file, writable);
    }
  }
}
