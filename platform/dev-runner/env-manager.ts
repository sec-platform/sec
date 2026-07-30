import fs from 'node:fs/promises';
import path from 'node:path';
import { compilerRoot } from '../shared/paths.ts';
export { pathEnvKey } from '../shared/process.ts';

export const TEST_WORKSPACE_NAMESPACE_ENV = 'SEC_TEST_WORKSPACE_NAMESPACE';

export function resolveTestWorkspaceNamespace(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const namespace = env[TEST_WORKSPACE_NAMESPACE_ENV]?.trim();
  if (!namespace) return undefined;
  if (namespace === '.' || namespace === '..' || !/^[A-Za-z0-9._-]+$/u.test(namespace)) {
    throw new Error(`${TEST_WORKSPACE_NAMESPACE_ENV} must be a safe single path segment`);
  }
  return namespace;
}

export function getTestWorkspaceTempRoot(env: NodeJS.ProcessEnv = process.env): string {
  const root = path.join(compilerRoot, '.tmp', 'test-workspaces');
  const namespace = resolveTestWorkspaceNamespace(env);
  return namespace ? path.join(root, namespace) : root;
}

export function getTestWorkspaceTemplateRoot(): string {
  return path.join(compilerRoot, '.tmp', 'test-workspaces', '.templates');
}

export async function cleanTestWorkspaces(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const root = getTestWorkspaceTempRoot(env);
  try {
    await fs.access(root);
  } catch {
    return;
  }
  await fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  });
}

export function commandPath(binPath: string, base: string): string {
  return path.join(binPath, process.platform === 'win32' ? `${base}.exe` : base);
}

const STALE_DIR_THRESHOLD = 500;
const STALE_MTIME_MS = 30 * 60 * 1000;
const CLEANUP_TTL_MS = 5 * 60 * 1000;

/**
 * Clean stale workspace directories and orphan staging, preserving .templates/.
 * Uses mkdir lock for serialization across concurrent processes.
 * Triggered when: directory count exceeds threshold, or orphan staging exists.
 * Throttled by marker file — no repeated readdir+stat within CLEANUP_TTL_MS.
 *
 * Called once by runFastTests before spawning shards, replacing the previous
 * per-subprocess preload call that caused redundant I/O in every bun test child.
 */
export async function cleanStaleTestWorkspaces(): Promise<void> {
  const tempRoot = path.join(compilerRoot, '.tmp', 'test-workspaces');
  const markerPath = path.join(tempRoot, '.last-cleanup');
  try {
    const markerStat = await fs.stat(markerPath);
    if (Date.now() - markerStat.mtimeMs < CLEANUP_TTL_MS) return;
  } catch { /* marker absent — proceed */ }

  const lockPath = path.join(tempRoot, '.cleanup-lock');
  try {
    await fs.mkdir(lockPath);
  } catch {
    return; // another process is cleaning
  }

  try {
    const entries = await fs.readdir(tempRoot, { withFileTypes: true });
    const staleDirs: string[] = [];
    let activeCount = 0;
    const now = Date.now();

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.templates' || entry.name === '.cleanup-lock') continue;
      activeCount++;
      const entryPath = path.join(tempRoot, entry.name);
      try {
        const stat = await fs.stat(entryPath);
        if (now - stat.mtimeMs > STALE_MTIME_MS) {
          staleDirs.push(entryPath);
        }
      } catch { /* skip */ }
    }

    const templatesDir = path.join(tempRoot, '.templates');
    try {
      const templateEntries = await fs.readdir(templatesDir, { withFileTypes: true });
      for (const entry of templateEntries) {
        if (entry.isDirectory() && entry.name.includes('.staging-')) {
          staleDirs.push(path.join(templatesDir, entry.name));
        }
      }
    } catch { /* skip */ }

    const hasOrphanStaging = staleDirs.some((d) => d.includes('.staging-'));
    const shouldClean = staleDirs.length > 0 && (activeCount > STALE_DIR_THRESHOLD || hasOrphanStaging);

    if (shouldClean) {
      for (const dir of staleDirs) {
        try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* skip */ }
      }
    }

    try { await fs.writeFile(markerPath, String(Date.now())); } catch { /* skip */ }
  } finally {
    try { await fs.rm(lockPath, { recursive: true, force: true }); } catch { /* skip */ }
  }
}
