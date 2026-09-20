import fs from 'node:fs/promises';
import path from 'node:path';
import { snapshotByteView } from '../../contracts/byte-snapshot.ts';
import { formatJsonFile } from '../../contracts/json-text.ts';
import type { CommitFence } from '../../contracts/commit-fence.ts';


function assertCommitFence(commitFence: CommitFence | undefined): void {
  if (commitFence !== undefined && typeof commitFence !== 'function') {
    throw new TypeError('File operation commit fence must be callable');
  }
}


async function readLstatOrNull(targetPath: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | null> {
  try {
    return await fs.lstat(targetPath);
  } catch (error) {
    if (isFileNotFoundError(error)) return null;
    throw error;
  }
}

export async function prepareOrdinaryFileWrite(
  targetPath: string,
  commitFence?: CommitFence
): Promise<void> {
  targetPath = path.resolve(targetPath);
  assertCommitFence(commitFence);
  const metadata = await readLstatOrNull(targetPath);
  if (metadata === null) return;
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Refusing to write through non-ordinary target: ${targetPath}`);
  }
  if (metadata.nlink > 1) {
    await commitFence?.();
    await fs.unlink(targetPath);
  }
}

/**
 * Directory existence is physical state, not process-local cache state.
 * Recursive mkdir is idempotent; always re-observing the final directory keeps
 * correctness under external cleanup and long-lived host processes.
 * This primitive rejects a symbolic-link/non-directory final entry before and
 * after creation. Callers that need race-free ancestor containment must use the
 * retained physical-no-follow primitives instead of treating this helper as a
 * security capability.
 */
export async function ensureDir(dirPath: string, commitFence?: CommitFence): Promise<void> {
  dirPath = path.resolve(dirPath);
  assertCommitFence(commitFence);
  const before = await readLstatOrNull(dirPath);
  if (before !== null) {
    if (before.isSymbolicLink() || !before.isDirectory()) {
      throw new Error(`Refusing to use non-ordinary directory target: ${dirPath}`);
    }
    return;
  }

  await commitFence?.();
  await fs.mkdir(dirPath, { recursive: true });

  const after = await fs.lstat(dirPath);
  if (after.isSymbolicLink() || !after.isDirectory()) {
    throw new Error(`Directory target changed into a non-ordinary path: ${dirPath}`);
  }
}

/**
 * Reports whether a directory entry exists without dereferencing the final
 * symbolic link. Use this for authority/fallback selection, where a dangling
 * canonical entry must still prevent a legacy path from silently taking over.
 * This does not make a subsequent read no-follow; security-sensitive readers
 * must retain and validate their own physical path capability.
 */
export async function pathEntryExists(targetPath: string): Promise<boolean> {
  return (await readLstatOrNull(targetPath)) !== null;
}

/** Reports whether the target is reachable through normal filesystem lookup. */
export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch (error) {
    if (isFileNotFoundError(error)) return false;
    throw error;
  }
}

export function isFileNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as { code?: string }).code === 'ENOENT';
}

export async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

export async function readOptionalJson<T>(filePath: string): Promise<T | null> {
  try {
    return await readJson<T>(filePath);
  } catch (error) {
    if (isFileNotFoundError(error)) return null;
    throw error;
  }
}

export async function writeBuffer(
  filePath: string,
  bytes: Uint8Array,
  commitFence?: CommitFence
): Promise<void> {
  filePath = path.resolve(filePath);
  assertCommitFence(commitFence);
  const snapshot = snapshotByteView(bytes, 'File write bytes');
  await writeOwnedBuffer(filePath, snapshot, commitFence);
}

/** The caller has already fixed the absolute path and privately owns these
 * bytes. Text/JSON enter here to avoid copying their newly encoded buffer twice.
 * These ordinary-file mechanics are not retained/no-follow or atomic publish. */
async function writeOwnedBuffer(filePath: string, bytes: Uint8Array, commitFence?: CommitFence): Promise<void> {
  await ensureDir(path.dirname(filePath), commitFence);
  await prepareOrdinaryFileWrite(filePath, commitFence);
  await commitFence?.();
  await fs.writeFile(filePath, bytes);
}

export async function writeJson(
  filePath: string,
  value: unknown,
  commitFence?: CommitFence
): Promise<void> {
  // Fix the destination before a legitimate toJSON callback can change cwd.
  filePath = path.resolve(filePath);
  assertCommitFence(commitFence);
  const bytes = Buffer.from(formatJsonFile(value), 'utf8');
  await writeOwnedBuffer(filePath, bytes, commitFence);
}

export async function removeDir(targetPath: string, commitFence?: CommitFence): Promise<void> {
  targetPath = path.resolve(targetPath);
  assertCommitFence(commitFence);
  await commitFence?.();
  await fs.rm(targetPath, { recursive: true, force: true });
}

export async function readText(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf8');
}

export async function writeText(filePath: string, text: string, commitFence?: CommitFence): Promise<void> {
  filePath = path.resolve(filePath);
  assertCommitFence(commitFence);
  if (typeof text !== 'string') throw new TypeError('File write text must be a string');
  await writeOwnedBuffer(filePath, Buffer.from(text, 'utf8'), commitFence);
}
