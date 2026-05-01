import { globby } from 'globby';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
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

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, formatJsonFile(value), 'utf8');
}

export async function removeDir(targetPath: string): Promise<void> {
  await fs.rm(targetPath, { recursive: true, force: true });
}

export async function copyRecursive(source: string, target: string): Promise<void> {
  const stat = await fs.stat(source);
  if (stat.isDirectory()) {
    await ensureDir(target);
    const entries = await fs.readdir(source);
    for (const entry of entries) {
      await copyRecursive(path.join(source, entry), path.join(target, entry));
    }
    return;
  }
  await ensureDir(path.dirname(target));
  await fs.copyFile(source, target);
}

export async function listFilesRecursive(rootDir: string): Promise<string[]> {
  if (!(await pathExists(rootDir))) return [];
  return globby('**/*', { cwd: rootDir, absolute: true, dot: false, onlyFiles: true });
}

export async function readText(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf8');
}

export async function writeText(filePath: string, text: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, text, 'utf8');
}
