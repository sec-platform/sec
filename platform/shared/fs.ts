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

// 进程内已创建目录缓存，避免 writeText/writeJson 每次都调用 fs.mkdir。
// removeDir 会失效相关条目以保持一致性。
const createdDirs = new Set<string>();

export async function ensureDir(dirPath: string, commitFence?: CommitFence): Promise<void> {
  await commitFence?.();
  if (createdDirs.has(dirPath)) return;
  await fs.mkdir(dirPath, { recursive: true });
  createdDirs.add(dirPath);
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
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
  return (await pathExists(filePath)) ? readJson<T>(filePath) : null;
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
  // 失效缓存：被删除的目录及其子目录不再存在，需从缓存中移除以免 ensureDir 跳过重建。
  const targetWithSep = targetPath.endsWith(path.sep) ? targetPath : targetPath + path.sep;
  for (const cached of createdDirs) {
    if (cached === targetPath || cached.startsWith(targetWithSep)) {
      createdDirs.delete(cached);
    }
  }
}

export async function copyRecursive(
  source: string,
  target: string,
  commitFence?: CommitFence
): Promise<void> {
  const stat = await fs.stat(source);
  if (stat.isDirectory()) {
    await ensureDir(target, commitFence);
    const entries = await fs.readdir(source);
    // 并行拷贝目录内各条目（互相独立），用 concurrency limit 控制并发句柄数。
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
  if (!(await pathExists(rootDir))) return [];
  const { globby } = await import('globby');
  return globby('**/*', { cwd: rootDir, absolute: true, dot: false, onlyFiles: true });
}

export async function readText(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf8');
}

export async function writeText(filePath: string, text: string, commitFence?: CommitFence): Promise<void> {
  await ensureDir(path.dirname(filePath), commitFence);
  await commitFence?.();
  // Copy-on-write: if the file has multiple hard links (e.g. from workspace
  // template cloning via fs.link), break the link by unlinking before writing
  // to avoid corrupting the shared template inode.
  try {
    const existing = await fs.stat(filePath);
    if (existing.nlink > 1) {
      await fs.unlink(filePath);
    }
  } catch {
    // File doesn't exist yet — no link to break.
  }
  await fs.writeFile(filePath, text, 'utf8');
}
