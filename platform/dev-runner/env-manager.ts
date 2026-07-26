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
  await fs.rm(getTestWorkspaceTempRoot(env), {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  });
}

export function commandPath(binPath: string, base: string): string {
  return path.join(binPath, process.platform === 'win32' ? `${base}.exe` : base);
}
