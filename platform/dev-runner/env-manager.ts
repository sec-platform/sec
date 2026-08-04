import fs from 'node:fs/promises';
import path from 'node:path';
import { compilerRoot } from '../shared/paths.ts';
import type { GeneratedStateCleanupReceipt } from '../shared/generated-state-contract.ts';
import {
  cleanGeneratedState,
  getGeneratedStateRoot
} from './generated-state.ts';
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
  const root = path.join(getGeneratedStateRoot(compilerRoot), 'test-workspaces');
  const namespace = resolveTestWorkspaceNamespace(env);
  return namespace ? path.join(root, namespace) : root;
}

export function getTestWorkspaceTemplateRoot(): string {
  return path.join(getGeneratedStateRoot(compilerRoot), 'test-workspaces', '.templates');
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Exact compatibility projection for the historical clean-test-workspaces API.
 * A namespaced call authorizes only that namespace. An unscoped call performs
 * the generated-state safe profile and preserves templates and hot caches.
 */
export async function cleanTestWorkspaces(
  env: NodeJS.ProcessEnv = process.env
): Promise<GeneratedStateCleanupReceipt> {
  const namespace = resolveTestWorkspaceNamespace(env);
  const relativePath = namespace ? `test-workspaces/${namespace}` : undefined;
  const receipt = await cleanGeneratedState({
    profile: 'safe',
    deepInventory: false,
    ...(relativePath ? { explicitRelativePaths: [relativePath], onlyExplicit: true } : {})
  });
  if (namespace && await pathExists(getTestWorkspaceTempRoot(env))) {
    throw new Error(
      `Generated-state cleanup did not settle test workspace namespace ${namespace}; status=${receipt.status}`
    );
  }
  if (receipt.status === 'blocked' || receipt.status === 'residue') {
    throw new Error(`Generated-state cleanup failed: ${receipt.status}`);
  }
  return receipt;
}

/**
 * Reap only workspaces whose registered owners are provably dead. Legacy
 * unowned directories are never time-deleted by the automatic path.
 */
export async function cleanStaleTestWorkspaces(): Promise<GeneratedStateCleanupReceipt> {
  const receipt = await cleanGeneratedState({ profile: 'automatic', deepInventory: false });
  if (receipt.status === 'blocked' || receipt.status === 'residue') {
    console.warn(`SEC_GENERATED_STATE_CLEANUP_RECEIPT ${JSON.stringify(receipt)}`);
    throw new Error(`Generated-state automatic cleanup failed: ${receipt.status}; receipt=${receipt.digest}`);
  }
  return receipt;
}

