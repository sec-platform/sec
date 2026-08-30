import fs from 'node:fs/promises';
import path from 'node:path';

import { inspectExactNoFollowDirectoryPresence, scanNoFollowDirectoryTreeMetadata } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { createConcurrencyLimit } from '../../system-architecture/foundation/runtime/concurrency.ts';
import {
  ensureDir,
  prepareOrdinaryFileWrite,
  type CommitFence
} from './files.ts';

const WORKSPACE_FILE_DISCOVERY_LIMITS = Object.freeze({
  durationMs: 30_000,
  maximumEntries: 100_000,
  maximumBytes: 1_073_741_824
});

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
  const absoluteRoot = path.resolve(rootDir);
  const presence = inspectExactNoFollowDirectoryPresence(
    absoluteRoot,
    'Workspace recursive file discovery root'
  );
  if (presence.state === 'absent') return [];
  const inventory = scanNoFollowDirectoryTreeMetadata(presence.directory.target, {
    deadlineAtMs: performance.now() + WORKSPACE_FILE_DISCOVERY_LIMITS.durationMs,
    maximumEntries: WORKSPACE_FILE_DISCOVERY_LIMITS.maximumEntries,
    maximumBytes: WORKSPACE_FILE_DISCOVERY_LIMITS.maximumBytes
  });
  const unsafeEntry = inventory.find((entry) => entry.kind === 'link');
  if (unsafeEntry !== undefined) {
    throw new Error(`Refusing linked workspace discovery entry: ${unsafeEntry.relativePath}`);
  }
  return inventory
    .filter((entry) => entry.kind === 'file')
    .map((entry) => path.join(absoluteRoot, ...entry.relativePath.split('/')));
}
