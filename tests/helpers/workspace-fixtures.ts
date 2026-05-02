import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll } from 'bun:test';
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
const templateParent = path.join(workspaceParent, '.templates');
const deferredCleanupDirs = new Set<string>();

export type WorkspaceTemplateKind = 'composed-default' | 'adapted-default' | 'locked-default';

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

function defaultWorkspaceOptions(options: WorkspacePipelineFixtureOptions): boolean {
  return (options.blockIds?.length ?? 0) === 0;
}

async function prepareWorkspacePipeline(
  workspaceRoot: string,
  options: WorkspacePipelineFixtureOptions,
  target: WorkspaceTemplateKind
): Promise<void> {
  await initWorkspace(workspaceRoot, { reset: true });
  for (const blockId of options.blockIds ?? []) {
    await addBlock(workspaceRoot, blockId);
  }
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  if (target === 'composed-default') return;

  await adaptWorkspace(workspaceRoot);
  if (target === 'adapted-default') return;

  await verifyWorkspace(workspaceRoot);
  await lockWorkspace(workspaceRoot);
}

async function createTemplate(kind: WorkspaceTemplateKind): Promise<string> {
  await fs.mkdir(templateParent, { recursive: true });
  const templateRoot = path.join(templateParent, kind);
  await fs.rm(templateRoot, { recursive: true, force: true });
  await fs.mkdir(templateRoot, { recursive: true });
  await prepareWorkspacePipeline(templateRoot, {}, kind);
  return templateRoot;
}

async function ensureTemplate(kind: WorkspaceTemplateKind): Promise<string> {
  const templateRoot = path.join(templateParent, kind);
  const markerPath = path.join(templateRoot, '.template-ready');
  try {
    await fs.access(markerPath);
    return templateRoot;
  } catch {}

  const createdRoot = await createTemplate(kind);
  await fs.writeFile(markerPath, `${kind}\n`, 'utf8');
  return createdRoot;
}

export async function cloneWorkspaceTemplate(
  kind: WorkspaceTemplateKind,
  prefix = `engineering-compiler-${kind}-`
): Promise<string> {
  const templateRoot = await ensureTemplate(kind);
  const workspaceRoot = await createWorkspace(prefix);
  await fs.cp(templateRoot, workspaceRoot, {
    recursive: true,
    filter: (source) => path.basename(source) !== '.template-ready'
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
