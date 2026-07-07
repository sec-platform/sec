import { afterAll, expect } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  addBlock,
  compileWorkspace,
  initWorkspace,
  verifyWorkspace
} from '../../platform/orchestrator.ts';
import type { PipelineStageId } from '../../platform/shared/pipeline-types.ts';

const workspaceParent = path.join(process.cwd(), '.tmp', 'test-workspaces');
const templateParent = path.join(workspaceParent, '.templates');
const templateCacheVersion = 'v5-typescript-incremental-pruning';
const deferredCleanupDirs = new Set<string>();

export type WorkspaceTemplateKind =
  | 'empty-default'
  | 'resolved-default'
  | 'composed-default'
  | 'adapted-default'
  | 'verified-fast-default'
  | 'locked-default'
  | 'locked-all-default'
  | 'explained-all-default';
export type WorkspaceScenarioKind = WorkspaceTemplateKind;

afterAll(async () => {
  for (const directory of deferredCleanupDirs) {
    await removeWorkspaceDirectory(directory);
  }
}, 120000);

function sleepMs(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function removeWorkspaceDirectory(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(directory, { recursive: true, force: true });
      deferredCleanupDirs.delete(directory);
      return;
    } catch (error) {
      const failure = error as NodeJS.ErrnoException;
      if (failure.code !== 'EBUSY' && failure.code !== 'EPERM') {
        throw error;
      }
      await sleepMs(100 * (attempt + 1));
    }
  }
  await fs.rm(directory, { recursive: true, force: true });
  deferredCleanupDirs.delete(directory);
}

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
    await removeWorkspaceDirectory(workspaceRoot);
  }
}

type WorkspacePipelineFixtureOptions = {
  prefix?: string;
  blockIds?: string[];
};

function defaultWorkspaceOptions(options: WorkspacePipelineFixtureOptions): boolean {
  return (options.blockIds?.length ?? 0) === 0;
}

function templatePipelineTarget(target: WorkspaceTemplateKind): {
  through: PipelineStageId;
  verificationLane: 'fast' | 'all';
} | null {
  switch (target) {
    case 'empty-default':
      return null;
    case 'resolved-default':
      return { through: 'resolve', verificationLane: 'all' };
    case 'composed-default':
      return { through: 'compose', verificationLane: 'all' };
    case 'adapted-default':
      return { through: 'adapt', verificationLane: 'all' };
    case 'verified-fast-default':
      return { through: 'verify', verificationLane: 'fast' };
    case 'locked-default':
    case 'locked-all-default':
      return { through: 'lock', verificationLane: 'all' };
    case 'explained-all-default':
      return { through: 'emit', verificationLane: 'all' };
  }
}

async function prepareWorkspacePipeline(
  workspaceRoot: string,
  options: WorkspacePipelineFixtureOptions,
  target: WorkspaceTemplateKind
): Promise<void> {
  await initWorkspace(workspaceRoot, { reset: true });
  const pipelineTarget = templatePipelineTarget(target);
  if (!pipelineTarget) return;

  for (const blockId of options.blockIds ?? []) {
    await addBlock(workspaceRoot, blockId);
  }

  await compileWorkspace(workspaceRoot, {
    source: 'api',
    through: pipelineTarget.through,
    verificationLane: pipelineTarget.verificationLane
  });
}

async function createTemplate(kind: WorkspaceTemplateKind): Promise<string> {
  await fs.mkdir(templateParent, { recursive: true });
  const templateRoot = path.join(templateParent, kind);
  const stagingRoot = path.join(templateParent, `${kind}.staging-${process.pid}-${Date.now()}`);
  await fs.rm(stagingRoot, { recursive: true, force: true });
  await fs.mkdir(stagingRoot, { recursive: true });
  try {
    await prepareWorkspacePipeline(stagingRoot, {}, kind);
    await pruneTransientWorkspaceState(stagingRoot);
    await fs.writeFile(path.join(stagingRoot, '.template-ready'), templateReadyMarker(kind), 'utf8');
    await fs.rm(templateRoot, { recursive: true, force: true });
    try {
      await fs.rename(stagingRoot, templateRoot);
    } catch {
      await fs.mkdir(templateRoot, { recursive: true });
      await fs.cp(stagingRoot, templateRoot, { recursive: true });
      await fs.rm(stagingRoot, { recursive: true, force: true });
    }
  } catch (error) {
    await fs.rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
  return templateRoot;
}

function templateReadyMarker(kind: WorkspaceTemplateKind): string {
  return `${kind}\n${templateCacheVersion}\n`;
}

async function templateIsReady(kind: WorkspaceTemplateKind, markerPath: string): Promise<boolean> {
  try {
    const marker = await fs.readFile(markerPath, 'utf8');
    return marker === templateReadyMarker(kind);
  } catch {
    return false;
  }
}

async function pruneTransientWorkspaceState(workspaceRoot: string): Promise<void> {
  await Promise.all([
    fs.rm(path.join(workspaceRoot, 'node_modules'), { recursive: true, force: true }),
    fs.rm(path.join(workspaceRoot, 'project', 'node_modules'), { recursive: true, force: true }),
    fs.rm(path.join(workspaceRoot, 'project', '.next'), { recursive: true, force: true }),
    fs.rm(path.join(workspaceRoot, 'project', 'tsconfig.tsbuildinfo'), { recursive: true, force: true }),
    fs.rm(path.join(workspaceRoot, 'project', 'test-results'), { recursive: true, force: true }),
    fs.rm(path.join(workspaceRoot, 'project', 'playwright-report'), { recursive: true, force: true }),
    fs.rm(path.join(workspaceRoot, 'project', 'coverage'), { recursive: true, force: true })
  ]);
}

async function withTemplateLock<T>(kind: WorkspaceTemplateKind, callback: () => Promise<T>): Promise<T> {
  await fs.mkdir(templateParent, { recursive: true });
  const lockPath = path.join(templateParent, `${kind}.lock`);
  const deadline = Date.now() + 120000;

  while (true) {
    try {
      await fs.mkdir(lockPath);
      break;
    } catch (error) {
      const failure = error as NodeJS.ErrnoException;
      if (failure.code !== 'EEXIST') throw error;
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for workspace template lock: ${kind}`);
      }
      await sleepMs(50);
    }
  }

  try {
    return await callback();
  } finally {
    await fs.rm(lockPath, { recursive: true, force: true });
  }
}

async function ensureTemplate(kind: WorkspaceTemplateKind): Promise<string> {
  const templateRoot = path.join(templateParent, kind);
  const markerPath = path.join(templateRoot, '.template-ready');
  if (await templateIsReady(kind, markerPath)) {
    return templateRoot;
  }

  return withTemplateLock(kind, async () => {
    if (await templateIsReady(kind, markerPath)) {
      return templateRoot;
    }
    return createTemplate(kind);
  });
}

function shouldCloneTemplatePath(source: string): boolean {
  const basename = path.basename(source);
  return basename !== '.template-ready' && !source.split(path.sep).includes('node_modules');
}

export async function cloneWorkspaceTemplate(
  kind: WorkspaceTemplateKind,
  prefix = `engineering-compiler-${kind}-`
): Promise<string> {
  const templateRoot = await ensureTemplate(kind);
  const workspaceRoot = await createWorkspace(prefix);
  await withTemplateLock(kind, async () => {
    await fs.cp(templateRoot, workspaceRoot, {
      recursive: true,
      filter: shouldCloneTemplatePath
    });
  });
  return workspaceRoot;
}

export async function prepareComposedWorkspace(options: WorkspacePipelineFixtureOptions = {}): Promise<string> {
  if (defaultWorkspaceOptions(options)) {
    return cloneWorkspaceTemplate('composed-default', options.prefix ?? 'engineering-compiler-composed-');
  }
  const workspaceRoot = await createWorkspace(options.prefix);
  await prepareWorkspacePipeline(workspaceRoot, options, 'composed-default');
  return workspaceRoot;
}

export async function prepareAdaptedWorkspace(options: WorkspacePipelineFixtureOptions = {}): Promise<string> {
  if (defaultWorkspaceOptions(options)) {
    return cloneWorkspaceTemplate('adapted-default', options.prefix ?? 'engineering-compiler-adapted-');
  }
  const workspaceRoot = await createWorkspace(options.prefix);
  await prepareWorkspacePipeline(workspaceRoot, options, 'adapted-default');
  return workspaceRoot;
}

export async function prepareLockedWorkspace(options: WorkspacePipelineFixtureOptions = {}): Promise<string> {
  if (defaultWorkspaceOptions(options)) {
    return cloneWorkspaceTemplate('locked-default', options.prefix ?? 'engineering-compiler-locked-');
  }
  const workspaceRoot = await createWorkspace(options.prefix);
  await prepareWorkspacePipeline(workspaceRoot, options, 'locked-default');
  return workspaceRoot;
}

export async function prepareVerifiedWorkspace(options: WorkspacePipelineFixtureOptions = {}): Promise<string> {
  if (defaultWorkspaceOptions(options)) {
    return cloneWorkspaceTemplate('verified-fast-default', options.prefix ?? 'engineering-compiler-verified-');
  }
  const workspaceRoot = await createWorkspace(options.prefix);
  await prepareWorkspacePipeline(workspaceRoot, options, 'verified-fast-default');
  return workspaceRoot;
}

export async function prepareEmptyWorkspace(prefix?: string): Promise<string> {
  return cloneWorkspaceTemplate('empty-default', prefix ?? 'engineering-compiler-empty-');
}

export async function prepareResolvedWorkspace(options: WorkspacePipelineFixtureOptions = {}): Promise<string> {
  if (defaultWorkspaceOptions(options)) {
    return cloneWorkspaceTemplate('resolved-default', options.prefix ?? 'engineering-compiler-resolved-');
  }
  const workspaceRoot = await createWorkspace(options.prefix);
  await prepareWorkspacePipeline(workspaceRoot, options, 'resolved-default');
  return workspaceRoot;
}

export async function withWorkspaceScenario<T>(
  kind: WorkspaceScenarioKind,
  callback: (workspaceRoot: string) => Promise<T>
): Promise<T> {
  const workspaceRoot = await cloneWorkspaceTemplate(kind, `engineering-compiler-${kind}-scenario-`);
  try {
    return await callback(workspaceRoot);
  } finally {
    await removeWorkspaceDirectory(workspaceRoot);
  }
}

export async function expectWorkspaceVerifies(
  workspaceRoot: string,
  options: { lane?: 'fast' | 'all' } = {}
): Promise<void> {
  const { report } = await verifyWorkspace(workspaceRoot, { lane: options.lane ?? 'fast' });
  expect(report.summary.status).toBe('passed');
}
