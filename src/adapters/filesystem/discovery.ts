import fs from 'node:fs/promises';
import path from 'node:path';
import { isPathInside } from "../../contracts/relative-path.ts";

import { inspectExactNoFollowDirectoryPresence, scanNoFollowDirectoryTreeMetadata } from '../runtime-state/physical/runtime/physical-no-follow.ts';
import { createTaskGroupEffectFence, mapTaskGroup } from '../../execution/task-group.ts';
import { throwIfNativeAborted } from '../../contracts/native-abort.ts';
import { ensureDir, prepareOrdinaryFileWrite } from "./files.ts";
import { type CommitFence } from "../../contracts/commit-fence.ts";

const WORKSPACE_FILE_DISCOVERY_LIMITS = Object.freeze({
  durationMs: 30_000,
  maximumEntries: 100_000,
  maximumBytes: 1_073_741_824
});
const COPY_CONCURRENCY = 8;

type CopyEntry = Readonly<{
  source: string;
  target: string;
  device: bigint;
  inode: bigint;
  size: bigint;
  modifiedAtNs: bigint;
  kind: 'directory' | 'file';
}>;

async function assertCopySourceCurrent(entry: CopyEntry): Promise<void> {
  const current = await fs.lstat(entry.source, { bigint: true });
  if (current.isSymbolicLink() || current.dev !== entry.device || current.ino !== entry.inode
      || (entry.kind === 'directory' ? !current.isDirectory()
        : !current.isFile() || current.size !== entry.size || current.mtimeNs !== entry.modifiedAtNs)) {
    throw new Error(`Copy source identity changed after planning: ${entry.source}`);
  }
}

/** Ordinary filesystem copy, not a retained path capability or atomic tree
 * publication. Plan structural inputs before effects; one group owns all file
 * callbacks, instead of multiplying independent queues at each directory.
 */
export async function copyRecursive(
  source: string,
  target: string,
  commitFence?: CommitFence,
  signal?: AbortSignal
): Promise<void> {
  const cwd = process.cwd();
  source = path.resolve(cwd, source);
  target = path.resolve(cwd, target);
  throwIfNativeAborted(signal);
  if (commitFence !== undefined && typeof commitFence !== 'function') throw new TypeError('Copy commit fence must be callable');
  // Copying into the source can recursively discover its own output. Copying
  // onto an ancestor can overwrite source entries that have not been read yet.
  if (isPathInside(source, target) || isPathInside(target, source)) {
    throw new Error('Recursive copy source and destination must not overlap');
  }
  const directories: CopyEntry[] = [];
  const files: CopyEntry[] = [];
  const pending = [{ source, target }];
  while (pending.length > 0) {
    throwIfNativeAborted(signal);
    const next = pending.pop()!;
    const metadata = await fs.lstat(next.source, { bigint: true });
    throwIfNativeAborted(signal);
    if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
      throw new Error(`Refusing to copy non-ordinary or symbolic-link source: ${next.source}`);
    }
    const entry: CopyEntry = Object.freeze({ ...next, device: metadata.dev, inode: metadata.ino,
      kind: metadata.isDirectory() ? 'directory' : 'file', size: metadata.size, modifiedAtNs: metadata.mtimeNs });
    if (entry.kind === 'file') { files.push(entry); continue; }
    directories.push(entry);
    const names = (await fs.readdir(entry.source)).sort();
    await assertCopySourceCurrent(entry);
    for (let index = names.length - 1; index >= 0; index--) {
      pending.push({ source: path.join(entry.source, names[index]!), target: path.join(entry.target, names[index]!) });
    }
  }
  const directoryFence: CommitFence = async () => {
    throwIfNativeAborted(signal);
    await commitFence?.();
    throwIfNativeAborted(signal);
  };
  // Parent-first and sequential: no directory task can outlive a failed copy.
  for (const directory of directories) {
    await directoryFence();
    await assertCopySourceCurrent(directory);
    await ensureDir(directory.target, directoryFence);
  }
  await mapTaskGroup(files, async (entry, _index, childSignal) => {
    const fence = createTaskGroupEffectFence(childSignal, commitFence);
    await assertCopySourceCurrent(entry);
    await ensureDir(path.dirname(entry.target), fence);
    await prepareOrdinaryFileWrite(entry.target, fence);
    await fence();
    await assertCopySourceCurrent(entry);
    throwIfNativeAborted(childSignal);
    await fs.copyFile(entry.source, entry.target);
    // These observations detect substitutions; they cannot close every OS-level
    // check/use race against a writer outside the caller's authority protocol.
    await assertCopySourceCurrent(entry);
    throwIfNativeAborted(childSignal);
  }, { concurrency: COPY_CONCURRENCY, signal });
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
