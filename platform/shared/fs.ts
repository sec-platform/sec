import fs from 'node:fs/promises';
import path from 'node:path';

export type CommitFence = () => Promise<void>;

// Minimal inline concurrency limiter for parallel copyRecursive.
// Inlined here to avoid expanding the TCB runtime closure with concurrency.ts.
function createConcurrencyLimit(concurrency: number) {
  const queue: Array<() => void> = [];
  let active = 0;
  const next = (): void => {
    if (active >= concurrency || queue.length === 0) return;
    active += 1;
    const run = queue.shift()!;
    run();
  };
  return <T>(task: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    const exec = (): void => { task().then(resolve, reject).finally(() => { active -= 1; next(); }); };
    if (active < concurrency) { active += 1; exec(); }
    else queue.push(exec);
  });
}

/**
 * Directory existence is physical state, not process-local cache state.
 * Recursive mkdir is idempotent; always performing it keeps correctness under
 * external cleanup, workspace replacement, and long-lived Workbench processes.
 */
export async function ensureDir(dirPath: string, commitFence?: CommitFence): Promise<void> {
  await commitFence?.();
  await fs.mkdir(dirPath, { recursive: true });
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
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

export function formatJsonFile(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function writeJson(
  filePath: string,
  value: unknown,
  commitFence?: CommitFence
): Promise<void> {
  await ensureDir(path.dirname(filePath), commitFence);
  await commitFence?.();
  await fs.writeFile(filePath, formatJsonFile(value), 'utf8');
}

export async function removeDir(targetPath: string, commitFence?: CommitFence): Promise<void> {
  await commitFence?.();
  await fs.rm(targetPath, { recursive: true, force: true });
}

export async function copyRecursive(
  source: string,
  target: string,
  commitFence?: CommitFence
): Promise<void> {
  const stat = await fs.stat(source);
  if (stat.isDirectory()) {
    await ensureDir(target, commitFence);
    const entries = (await fs.readdir(source)).sort();
    const limit = createConcurrencyLimit(8);
    await Promise.all(
      entries.map((entry) =>
        limit(() => copyRecursive(path.join(source, entry), path.join(target, entry), commitFence))
      )
    );
    return;
  }
  await ensureDir(path.dirname(target), commitFence);
  await commitFence?.();
  await fs.copyFile(source, target);
}

export async function listFilesRecursive(rootDir: string): Promise<string[]> {
  try {
    const metadata = await fs.stat(rootDir);
    if (!metadata.isDirectory()) return [];
  } catch (error) {
    if (isFileNotFoundError(error)) return [];
    throw error;
  }
  const { globby } = await import('globby');
  return (await globby('**/*', { cwd: rootDir, absolute: true, dot: false, onlyFiles: true })).sort();
}

export async function readText(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf8');
}

export async function writeText(filePath: string, text: string, commitFence?: CommitFence): Promise<void> {
  await ensureDir(path.dirname(filePath), commitFence);
  await commitFence?.();
  // Copy-on-write: if the file has multiple hard links (e.g. from workspace
  // template cloning via fs.link), break the link before writing so a project
  // edit cannot mutate the shared template inode. Non-ENOENT stat failures are
  // real errors and must never be reclassified as "file absent".
  try {
    const existing = await fs.stat(filePath);
    if (existing.nlink > 1) {
      await fs.unlink(filePath);
    }
  } catch (error) {
    if (!isFileNotFoundError(error)) throw error;
  }
  await commitFence?.();
  await fs.writeFile(filePath, text, 'utf8');
}
