import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll } from 'vitest';
import {
  adaptWorkspace,
  addBlock,
  composeWorkspace,
  initWorkspace,
  lockWorkspace,
  resolveWorkspace,
  verifyWorkspace
} from '../../platform/orchestrator.ts';

const workspaceParent = path.join(process.cwd(), '.tmp', 'test-workspaces');
const deferredCleanupDirs = new Set<string>();

afterAll(async () => {
  for (const directory of deferredCleanupDirs) {
    try {
      await fs.rm(directory, { recursive: true, force: true });
    } catch {}
  }
}, 120000);

export async function createWorkspace(prefix = 'engineering-compiler-test-'): Promise<string> {
  await fs.mkdir(workspaceParent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(workspaceParent, prefix));
  deferredCleanupDirs.add(directory);
  return directory;
}

export async function withTempWorkspace<T>(
  callback: (workspaceRoot: string) => Promise<T>,
  prefix = 'engineering-compiler-test-'
): Promise<T> {
  await fs.mkdir(workspaceParent, { recursive: true });
  const workspaceRoot = await fs.mkdtemp(path.join(workspaceParent, prefix));
  try {
    return await callback(workspaceRoot);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

type WorkspacePipelineFixtureOptions = {
  prefix?: string;
  blockIds?: string[];
};

export async function prepareComposedWorkspace(options: WorkspacePipelineFixtureOptions = {}): Promise<string> {
  const workspaceRoot = await createWorkspace(options.prefix);
  await initWorkspace(workspaceRoot, { reset: true });
  for (const blockId of options.blockIds ?? []) {
    await addBlock(workspaceRoot, blockId);
  }
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  return workspaceRoot;
}

export async function prepareAdaptedWorkspace(options: WorkspacePipelineFixtureOptions = {}): Promise<string> {
  const workspaceRoot = await prepareComposedWorkspace(options);
  await adaptWorkspace(workspaceRoot);
  return workspaceRoot;
}

export async function prepareLockedWorkspace(options: WorkspacePipelineFixtureOptions = {}): Promise<string> {
  const workspaceRoot = await prepareAdaptedWorkspace(options);
  await verifyWorkspace(workspaceRoot);
  await lockWorkspace(workspaceRoot);
  return workspaceRoot;
}
