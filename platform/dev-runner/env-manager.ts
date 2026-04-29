import fs from 'node:fs/promises';
import path from 'node:path';
import { compilerRoot } from '../shared/paths.ts';
import { pathExists } from '../shared/fs.ts';
import { ensureSharedDepsReady } from '../shared/project-runtime.ts';
export { pathEnvKey } from '../shared/process.ts';

export function getTestWorkspaceTempRoot(): string {
  return path.join(compilerRoot, '.tmp', 'test-workspaces');
}

export async function cleanTestWorkspaces(): Promise<void> {
  await fs.rm(getTestWorkspaceTempRoot(), { recursive: true, force: true });
}

export async function withRootDependencyBridge<T>(nodeModulesPath: string, callback: () => Promise<T>): Promise<T> {
  const rootNodeModulesPath = path.join(compilerRoot, 'node_modules');
  const hadRootNodeModules = await pathExists(rootNodeModulesPath);

  if (!hadRootNodeModules) {
    await fs.symlink(nodeModulesPath, rootNodeModulesPath, 'junction');
  }

  try {
    return await callback();
  } finally {
    if (!hadRootNodeModules) {
      await fs.rm(rootNodeModulesPath, { recursive: true, force: true });
    }
  }
}

export function commandPath(binPath: string, base: string): string {
  return path.join(binPath, process.platform === 'win32' ? `${base}.exe` : base);
}
