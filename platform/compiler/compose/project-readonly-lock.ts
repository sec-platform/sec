import fs from 'node:fs/promises';
import path from 'node:path';
import { globby } from 'globby';
import { pathExists } from '../../shared/fs.ts';

export async function setFileWritable(filePath: string, writable: boolean): Promise<void> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return;
    const currentMode = stat.mode;
    let newMode = currentMode;
    if (writable) {
      // Add write permissions for owner (at least 0o600 or 0o200)
      newMode = currentMode | 0o200;
    } else {
      // Remove write permissions (owner, group, others)
      newMode = currentMode & ~0o222;
    }
    if (newMode !== currentMode) {
      await fs.chmod(filePath, newMode);
    }
  } catch (err) {
    // Ignore permissions/file-not-found errors
  }
}

/**
 * Locks or unlocks all files in the projectRoot recursively,
 * except for slot files, files in node_modules, and directories.
 */
export async function setProjectReadOnlyLock(
  projectRoot: string,
  writable: boolean,
  slotTargets: string[] = []
): Promise<void> {
  if (!(await pathExists(projectRoot))) return;

  // Resolve absolute paths for slots
  const absoluteSlots = new Set(
    slotTargets.map((target) => path.resolve(projectRoot, target))
  );

  // Glob everything in projectRoot, including dotfiles, excluding node_modules
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
      // Slot files must ALWAYS be writable
      await setFileWritable(file, true);
    } else {
      await setFileWritable(file, writable);
    }
  }
}
