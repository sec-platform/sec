import { afterAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { setTimeout as sleepMs } from 'node:timers/promises';

import { addBlock, compileWorkspace, initWorkspace } from '../../src/compiler/orchestration/cli.ts';
import type { PipelineStageId } from '../../src/compiler/pipeline/types.ts';
import { getTestWorkspaceTemplateRoot, getTestWorkspaceTempRoot } from '../../src/development/runner/env-manager.ts';
import { createConcurrencyLimit } from '../../src/system-architecture/foundation/runtime/concurrency.ts';
import { getErrorCode } from '../../src/system-architecture/foundation/runtime/failure-inspection.ts';
import { copyWorkspaceFixture } from './workspace-files.ts';
import { createTemplatePreparation } from './template-preparation.ts';
import { getWorkspacePaths } from '../../src/workspace/runtime/paths.ts';
import { createWorkspaceWithDeferredCleanup, removeWorkspaceDirectoryWithRetry, settleWorkspaceCallback, settleWorkspaceCleanups } from './workspace-cleanup.ts';

export { copyWorkspaceFixture } from './workspace-files.ts';

const workspaceParent = getTestWorkspaceTempRoot();
const templateParent = path.join(getTestWorkspaceTemplateRoot(), `run-${process.pid}-${randomUUID()}`);
const deferredCleanupDirs = new Set<string>();
const deferredCleanupConcurrency = createConcurrencyLimit(Math.min(availableParallelism(), 16));

export type WorkspaceTemplateKind =
  | 'empty-default'
  | 'resolved-default'
  | 'composed-default'
  | 'verified-fast-default'
  | 'locked-default'
  | 'locked-all-default'
  | 'explained-all-default';
export type WorkspaceScenarioKind = WorkspaceTemplateKind;

export type WorkspaceCallbackOptions = {
  readonly retainOnCallbackFailure?: boolean;
};

afterAll(async () => {
  // All selected workspaces receive a cleanup attempt. A failed removal must
  // neither abandon its peers nor prevent retirement of the run template tree.
  await settleWorkspaceCallback(
    () => settleWorkspaceCleanups([...deferredCleanupDirs].map(directory =>
      () => deferredCleanupConcurrency(() => removeWorkspaceDirectory(directory)))),
    () => fs.rm(templateParent, { recursive: true, force: true })
  );
}, 120000);

async function removeWorkspaceDirectory(directory: string): Promise<void> {
  await removeWorkspaceDirectoryWithRetry({
    directory,
    deferredCleanupDirs,
    seam: {
      platform: process.platform,
      removeDirectory: fs.rm,
      sleep: sleepMs
    }
  });
}

async function runWorkspaceCallback<T>(
  workspaceRoot: string,
  callback: (workspaceRoot: string) => Promise<T>,
  options: WorkspaceCallbackOptions
): Promise<T> {
  return settleWorkspaceCallback(
    () => callback(workspaceRoot),
    () => removeWorkspaceDirectory(workspaceRoot),
    options.retainOnCallbackFailure === true
      ? {
          retainOnCallbackFailure: true,
          directory: workspaceRoot,
          deferredCleanupDirs
        }
      : undefined
  );
}

export async function createWorkspace(prefix = 'engineering-compiler-test-'): Promise<string> {
  await fs.mkdir(workspaceParent, { recursive: true });
  return createWorkspaceWithDeferredCleanup(path.join(workspaceParent, prefix), deferredCleanupDirs, fs.mkdtemp);
}

export async function withTempWorkspace<T>(
  callback: (workspaceRoot: string) => Promise<T>,
  prefix = 'engineering-compiler-test-',
  options: WorkspaceCallbackOptions = {}
): Promise<T> {
  const workspaceRoot = await createWorkspace(prefix);
  return runWorkspaceCallback(workspaceRoot, callback, options);
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
  await initWorkspace(workspaceRoot, { template: 'reference-customer' });
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
  const stagingRoot = await fs.mkdtemp(path.join(templateParent, `${kind}.staging-`));
  return settleWorkspaceCallback(async () => {
    await prepareWorkspacePipeline(stagingRoot, {}, kind);
    await pruneTransientWorkspaceState(stagingRoot);
    await fs.writeFile(path.join(stagingRoot, '.template-ready'), templateReadyMarker(kind), 'utf8');
    await assertTemplateComplete(stagingRoot, kind);
    await fs.rm(templateRoot, { recursive: true, force: true });
    // Source and destination share a run-owned parent. A failed rename is not
    // permission to publish a partially copied tree containing a ready marker.
    await fs.rename(stagingRoot, templateRoot);
    await assertTemplateComplete(templateRoot, kind);
    return templateRoot;
  }, () => fs.rm(stagingRoot, { recursive: true, force: true }));
}

async function assertTemplateComplete(templateRoot: string, kind: WorkspaceTemplateKind): Promise<void> {
  const markerPath = path.join(templateRoot, '.template-ready');
  if (!(await templateIsReady(kind, markerPath))) {
    throw new Error(`Template ${kind} incomplete: readiness marker missing or mismatched`);
  }
  // Validate canonical workspace content, not a legacy nested project layout.
  // A partially copied template may retain its marker while losing one of the
  // native model/source roots, so both roots are part of the readiness proof.
  const paths = getWorkspacePaths(templateRoot);
  for (const [label, directory] of [
    ['model', paths.modelRoot],
    ['source', paths.srcRoot]
  ] as const) {
    try {
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(`Template ${kind} incomplete: ${label} is not a physical directory`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Template ${kind} incomplete: ${label} directory missing`);
      }
      throw error;
    }
  }
}

function templateReadyMarker(kind: WorkspaceTemplateKind): string {
  return `${kind}\n`;
}

async function templateIsReady(kind: WorkspaceTemplateKind, markerPath: string): Promise<boolean> {
  try {
    const marker = await fs.readFile(markerPath, 'utf8');
    return marker === templateReadyMarker(kind);
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') return false;
    throw error;
  }
}

async function pruneTransientWorkspaceState(workspaceRoot: string): Promise<void> {
  const paths = getWorkspacePaths(workspaceRoot);
  await settleWorkspaceCleanups([
    path.join(workspaceRoot, 'node_modules'),
    path.join(workspaceRoot, 'tsconfig.tsbuildinfo'),
    path.join(paths.artifactsRoot, 'test-results'),
    path.join(paths.artifactsRoot, 'coverage')
  ].map(directory => () => fs.rm(directory, { recursive: true, force: true })));
}

// templateParent is unique to this module's process/run. Only simultaneous
// requests for one kind share preparation; no other process owns this namespace.
// File locks, PID probes, wall-clock expiry and stale-lock deletion add no
// coordination here and are deliberately removed rather than reimplemented.
const ensureTemplate = createTemplatePreparation<WorkspaceTemplateKind>(async kind => {
  const templateRoot = path.join(templateParent, kind);
  if (await templateIsReady(kind, path.join(templateRoot, '.template-ready'))) {
    await assertTemplateComplete(templateRoot, kind);
    return templateRoot;
  }
  return createTemplate(kind);
});

async function prepareOwnedWorkspace(
  prefix: string | undefined,
  prepare: (root: string) => Promise<void>
): Promise<string> {
  const root = await createWorkspace(prefix);
  try {
    await prepare(root);
    return root;
  } catch (error) {
    // Failed setup never returns its resource, so clean it now. The common
    // settlement owner preserves both setup and cleanup errors if both fail.
    return settleWorkspaceCallback(async () => { throw error; }, () => removeWorkspaceDirectory(root));
  }
}

export async function cloneWorkspaceTemplate(kind: WorkspaceTemplateKind, prefix = `engineering-compiler-${kind}-`): Promise<string> {
  const templateRoot = await ensureTemplate(kind);
  // The template remains run-owned; each caller receives independent files.
  // Copying is outside the same-kind preparation window.
  return prepareOwnedWorkspace(prefix, root => copyWorkspaceFixture(templateRoot, root));
}

export async function prepareComposedWorkspace(options: WorkspacePipelineFixtureOptions = {}): Promise<string> {
  if (defaultWorkspaceOptions(options)) {
    return cloneWorkspaceTemplate('composed-default', options.prefix ?? 'engineering-compiler-composed-');
  }
  const captured = { ...options, blockIds: [...(options.blockIds ?? [])] };
  return prepareOwnedWorkspace(captured.prefix, root => prepareWorkspacePipeline(root, captured, 'composed-default'));
}

export async function prepareLockedWorkspace(options: WorkspacePipelineFixtureOptions = {}): Promise<string> {
  if (defaultWorkspaceOptions(options)) {
    return cloneWorkspaceTemplate('locked-default', options.prefix ?? 'engineering-compiler-locked-');
  }
  const captured = { ...options, blockIds: [...(options.blockIds ?? [])] };
  return prepareOwnedWorkspace(captured.prefix, root => prepareWorkspacePipeline(root, captured, 'locked-default'));
}

export async function prepareVerifiedWorkspace(options: WorkspacePipelineFixtureOptions = {}): Promise<string> {
  if (defaultWorkspaceOptions(options)) {
    return cloneWorkspaceTemplate('verified-fast-default', options.prefix ?? 'engineering-compiler-verified-');
  }
  const captured = { ...options, blockIds: [...(options.blockIds ?? [])] };
  return prepareOwnedWorkspace(captured.prefix, root => prepareWorkspacePipeline(root, captured, 'verified-fast-default'));
}

export async function prepareEmptyWorkspace(prefix?: string): Promise<string> {
  return cloneWorkspaceTemplate('empty-default', prefix ?? 'engineering-compiler-empty-');
}

export async function prepareResolvedWorkspace(options: WorkspacePipelineFixtureOptions = {}): Promise<string> {
  if (defaultWorkspaceOptions(options)) {
    return cloneWorkspaceTemplate('resolved-default', options.prefix ?? 'engineering-compiler-resolved-');
  }
  const captured = { ...options, blockIds: [...(options.blockIds ?? [])] };
  return prepareOwnedWorkspace(captured.prefix, root => prepareWorkspacePipeline(root, captured, 'resolved-default'));
}

export async function withWorkspaceScenario<T>(
  kind: WorkspaceScenarioKind,
  callback: (workspaceRoot: string) => Promise<T>,
  options: WorkspaceCallbackOptions = {}
): Promise<T> {
  const workspaceRoot = await cloneWorkspaceTemplate(kind, `engineering-compiler-${kind}-scenario-`);
  return runWorkspaceCallback(workspaceRoot, callback, options);
}
