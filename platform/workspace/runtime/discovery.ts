import fs from 'node:fs/promises';
import path from 'node:path';

import { createConcurrencyLimit } from '../../foundation/concurrency.ts';
import {
  ensureDir,
  isFileNotFoundError,
  prepareOrdinaryFileWrite,
  type CommitFence
} from './files.ts';

export async function copyRecursive(
  source: string,
  target: string,
  commitFence?: CommitFence
): Promise<void> {
  const sourceMetadata = await fs.lstat(source);
  if (sourceMetadata.isSymbolicLink()) {
    throw new Error(`Refusing to copy symbolic-link source: ${source}`);
  }
  if (sourceMetadata.isDirectory()) {
    await ensureDir(target, commitFence);
    const entries = (await fs.readdir(source)).sort();
    const limit = createConcurrencyLimit(8);
    await Promise.all(entries.map((entry) => limit(() => copyRecursive(
      path.join(source, entry),
      path.join(target, entry),
      commitFence
    ))));
    return;
  }
  if (!sourceMetadata.isFile()) {
    throw new Error(`Refusing to copy non-ordinary source: ${source}`);
  }
  await ensureDir(path.dirname(target), commitFence);
  await prepareOrdinaryFileWrite(target, commitFence);
  await commitFence?.();
  await fs.copyFile(source, target);
}

export async function listFilesRecursive(rootDir: string): Promise<string[]> {
  try {
    const metadata = await fs.lstat(rootDir);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Refusing to enumerate symbolic-link root: ${rootDir}`);
    }
    if (!metadata.isDirectory()) return [];
  } catch (error) {
    if (isFileNotFoundError(error)) return [];
    throw error;
  }
  const { globby } = await import('globby');
  return (await globby('**/*', {
    cwd: rootDir,
    absolute: true,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false
  })).sort();
}
