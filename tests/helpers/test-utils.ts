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
import { readJson } from '../../platform/shared/fs.ts';
import { compilerRoot } from '../../platform/shared/paths.ts';
import type { PolicyReport } from '../../platform/shared/types.ts';

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

const compilerFileCache = new Map<string, string>();

export async function readCompilerFile(relativePath: string): Promise<string> {
  const cached = compilerFileCache.get(relativePath);
  if (cached !== undefined) return cached;

  const absolutePath = path.join(compilerRoot, relativePath);
  const content = await fs.readFile(absolutePath, 'utf8');
  compilerFileCache.set(relativePath, content);
  return content;
}

interface CompilerPackage {
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

let cachedRootPackage: CompilerPackage | null = null;

export async function readCompilerPackageJson(): Promise<CompilerPackage> {
  if (cachedRootPackage) return cachedRootPackage;
  cachedRootPackage = await readJson<CompilerPackage>(path.join(compilerRoot, 'package.json'));
  return cachedRootPackage;
}

export function emptyPolicyScopeReport(): PolicyReport['project'] {
  return {
    policies: [],
    sources: [],
    violations: []
  };
}
