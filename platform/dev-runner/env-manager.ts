import fs from 'node:fs/promises';
import path from 'node:path';
import { pathExists } from '../shared/fs.ts';
import { compilerRoot } from '../shared/paths.ts';
export { pathEnvKey } from '../shared/process.ts';

const TEST_WORKSPACE_NAMESPACE_ENV = 'SEC_TEST_WORKSPACE_NAMESPACE';

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
