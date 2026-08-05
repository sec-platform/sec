import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureTestDependencies } from '../../platform/dev-runner/dependency-bootstrap.ts';
import {
  cleanGeneratedState,
  registerCurrentTestProcessGeneratedState
} from '../../platform/dev-runner/generated-state.ts';

async function configureTestTempRoot(): Promise<void> {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const tempRoot = path.join(repoRoot, '.tmp', 'test-workspaces');
  await fs.mkdir(tempRoot, { recursive: true });
  process.env.TMPDIR = tempRoot;
  process.env.TMP = tempRoot;
  process.env.TEMP = tempRoot;
  if (!process.env.LOG_LEVEL) process.env.LOG_LEVEL = 'warn';
  await registerCurrentTestProcessGeneratedState(process.env, { repositoryRoot: repoRoot });
}

/**
 * Compatibility projection for callers that imported the historical preload
 * cleaner. The stale-directory algorithm now has one owner in generated-state.
 *
 * Historical implementation anchor removed from execution:
 * `await fs.rm(lockPath, { recursive: true, force: true });`
 */
export async function cleanStaleWorkspaces(tempRoot: string): Promise<void> {
  const resolvedTempRoot = path.resolve(tempRoot);
  if (path.basename(resolvedTempRoot) !== 'test-workspaces' || path.basename(path.dirname(resolvedTempRoot)) !== '.tmp') {
    throw new Error('Legacy stale-workspace cleanup root must be <repository>/.tmp/test-workspaces.');
  }
  const repositoryRoot = path.dirname(path.dirname(resolvedTempRoot));
  const receipt = await cleanGeneratedState({
    repositoryRoot,
    profile: 'automatic',
    deepInventory: false
  });
  if (receipt.status === 'blocked' || receipt.status === 'residue') {
    throw new Error(`Generated-state automatic cleanup failed: ${receipt.status}`);
  }
}

export default async function prewarmSharedRuntimeDeps(): Promise<void> {
  if (process.env.SEC_SKIP_RUNTIME_DEPS_SETUP !== '1') {
    const dependencies = await ensureTestDependencies();
    process.env.PLAYWRIGHT_BROWSERS_PATH = dependencies.browserCachePath;
  }
  await configureTestTempRoot();
}

await prewarmSharedRuntimeDeps();
