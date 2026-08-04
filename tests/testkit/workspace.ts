import { afterAll, expect } from 'bun:test';
import type { BigIntStats, Dirent } from 'node:fs';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';

import {
  getTestWorkspaceTemplateRoot,
  getTestWorkspaceTempRoot
} from '../../platform/dev-runner/env-manager.ts';
import {
  addBlock,
  compileWorkspace,
  initWorkspace,
  verifyWorkspace
} from '../../platform/orchestrator.ts';
import { createConcurrencyLimit } from '../../platform/shared/concurrency.ts';
import type { PipelineStageId } from '../../platform/shared/pipeline-types.ts';
import {
  createWorkspaceWithDeferredCleanup,
  removeWorkspaceDirectoryWithRetry,
  settleWorkspaceCallback
} from './workspace-cleanup.ts';

const workspaceParent = getTestWorkspaceTempRoot();
const templateParent = getTestWorkspaceTemplateRoot();
const templateCacheVersion = 'v5-typescript-incremental-pruning';
const deferredCleanupDirs = new Set<string>();
const deferredCleanupConcurrency = createConcurrencyLimit(Math.min(availableParallelism(), 16));

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

export type WorkspaceCallbackOptions = {
  readonly retainOnCallbackFailure?: boolean;
};

afterAll(async () => {
  // Parallelize workspace cleanup with bounded concurrency to avoid
  // exhausting the 120s afterAll budget on Windows where directory removal
  // is slow. Each directory is distinct, so concurrent removal is safe;
  // EBUSY/EPERM retries are handled by removeWorkspaceDirectoryWithRetry.
  await Promise.all(
    [...deferredCleanupDirs].map((directory) =>
      deferredCleanupConcurrency(() => removeWorkspaceDirectory(directory))
    )
  );
}, 120000);

function sleepMs(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

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
  return createWorkspaceWithDeferredCleanup(
    path.join(workspaceParent, prefix),
    deferredCleanupDirs,
    fs.mkdtemp
  );
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
  await assertTemplateComplete(templateRoot, kind);
  return templateRoot;
}

async function assertTemplateComplete(templateRoot: string, kind: WorkspaceTemplateKind): Promise<void> {
  const markerPath = path.join(templateRoot, '.template-ready');
  if (!(await templateIsReady(kind, markerPath))) {
    throw new Error(`Template ${kind} incomplete: readiness marker missing or mismatched`);
  }
  // Validate that the project directory physically exists — a partially copied
  // template (e.g. interrupted fs.cp) may have the marker but lack project content.
  const projectDir = path.join(templateRoot, 'project');
  try {
    const stat = await fs.lstat(projectDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Template ${kind} incomplete: project is not a physical directory`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Template ${kind} incomplete: project directory missing`);
    }
    throw error;
  }
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
  const ownerFile = path.join(lockPath, 'owner.json');
  const deadline = Date.now() + 120000;

  while (true) {
    try {
      await fs.mkdir(lockPath);
      await fs.writeFile(ownerFile, JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }), 'utf8');
      break;
    } catch (error) {
      const failure = error as NodeJS.ErrnoException;
      if (failure.code !== 'EEXIST') throw error;
      // Stale lock recovery: if the owner process is dead or the lock is very old,
      // reclaim it so a crashed predecessor does not block all subsequent template builds.
      if (await isStaleTemplateLock(ownerFile)) {
        await fs.rm(lockPath, { recursive: true, force: true });
        continue;
      }
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

async function isStaleTemplateLock(ownerFile: string): Promise<boolean> {
  try {
    const ownerData = JSON.parse(await fs.readFile(ownerFile, 'utf8')) as { pid: number; acquiredAt: number };
    // Owner process is dead → stale
    if (typeof ownerData.pid === 'number' && !processAlive(ownerData.pid)) {
      return true;
    }
    // Safety net: lock older than 5 minutes is stale regardless
    if (typeof ownerData.acquiredAt === 'number' && Date.now() - ownerData.acquiredAt > 300000) {
      return true;
    }
    return false;
  } catch {
    // Cannot read owner file — treat as stale to avoid permanent blockage
    return true;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
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

const clonableCacheSnapshotNames = [
  'composition-baseline.json',
  'project-baseline.json'
] as const;

type LocalStateSnapshotPlanEntry = {
  readonly destinationSegments: readonly string[];
  readonly relativePath: string;
  readonly sourcePath: string;
};

function caseFoldFixtureSegment(segment: string): string {
  return segment.toLowerCase();
}

function assertNoCaseCollisions(entries: readonly Dirent[], relativeRoot: string): void {
  const namesByFoldedName = new Map<string, string>();
  for (const entry of entries) {
    const foldedName = caseFoldFixtureSegment(entry.name);
    const existingName = namesByFoldedName.get(foldedName);
    if (existingName !== undefined && existingName !== entry.name) {
      throw new Error(
        `Workspace fixture contains case-colliding local-state paths under ${relativeRoot}: `
        + `${existingName}, ${entry.name}`
      );
    }
    namesByFoldedName.set(foldedName, entry.name);
  }
}

function findCaseFoldedEntry(entries: readonly Dirent[], expectedName: string): Dirent | undefined {
  return entries.find(
    (entry) => caseFoldFixtureSegment(entry.name) === caseFoldFixtureSegment(expectedName)
  );
}

function assertPhysicalDirectory(entry: Dirent, relativePath: string): void {
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new Error(`Workspace fixture ${relativePath} must be a physical directory`);
  }
}

function assertPhysicalRegularFile(entry: Dirent, relativePath: string): void {
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new Error(`Workspace fixture ${relativePath} must be a physical regular file`);
  }
}

function snapshotPlanEntry(
  sourceRoot: string,
  sourceSegments: readonly string[],
  destinationSegments: readonly string[]
): LocalStateSnapshotPlanEntry {
  return {
    destinationSegments,
    relativePath: destinationSegments.join('/'),
    sourcePath: path.join(sourceRoot, ...sourceSegments)
  };
}

async function resolveLocalStateSnapshotPlan(
  sourceRoot: string
): Promise<readonly LocalStateSnapshotPlanEntry[]> {
  const sourceEntries = await fs.readdir(sourceRoot, { withFileTypes: true });
  const localStateEntries = sourceEntries.filter(
    (entry) => caseFoldFixtureSegment(entry.name) === '.sec'
  );
  assertNoCaseCollisions(localStateEntries, '.');
  if (localStateEntries.length === 0) return [];

  const localStateEntry = localStateEntries[0]!;
  assertPhysicalDirectory(localStateEntry, '.sec');
  const localStateRoot = path.join(sourceRoot, localStateEntry.name);
  const localStateChildren = await fs.readdir(localStateRoot, { withFileTypes: true });
  assertNoCaseCollisions(localStateChildren, '.sec');

  const plan: LocalStateSnapshotPlanEntry[] = [];
  const pipelineJournalEntry = findCaseFoldedEntry(localStateChildren, 'pipeline-journal.json');
  if (pipelineJournalEntry !== undefined) {
    assertPhysicalRegularFile(pipelineJournalEntry, '.sec/pipeline-journal.json');
    plan.push(snapshotPlanEntry(
      sourceRoot,
      [localStateEntry.name, pipelineJournalEntry.name],
      ['.sec', 'pipeline-journal.json']
    ));
  }

  const cacheEntry = findCaseFoldedEntry(localStateChildren, 'cache');
  if (cacheEntry === undefined) return plan;
  assertPhysicalDirectory(cacheEntry, '.sec/cache');
  const cacheRoot = path.join(localStateRoot, cacheEntry.name);
  const cacheChildren = await fs.readdir(cacheRoot, { withFileTypes: true });
  assertNoCaseCollisions(cacheChildren, '.sec/cache');
  for (const snapshotName of clonableCacheSnapshotNames) {
    const snapshotEntry = findCaseFoldedEntry(cacheChildren, snapshotName);
    if (snapshotEntry === undefined) continue;
    const relativePath = `.sec/cache/${snapshotName}`;
    assertPhysicalRegularFile(snapshotEntry, relativePath);
    plan.push(snapshotPlanEntry(
      sourceRoot,
      [localStateEntry.name, cacheEntry.name, snapshotEntry.name],
      ['.sec', 'cache', snapshotName]
    ));
  }
  return plan;
}

function shouldCloneOrdinaryWorkspaceFixturePath(sourceRoot: string, source: string): boolean {
  const relativeSegments = path.relative(sourceRoot, source).split(path.sep);
  const foldedSegments = relativeSegments.map(caseFoldFixtureSegment);
  if (
    caseFoldFixtureSegment(path.basename(source)) === '.template-ready'
    || foldedSegments.includes('node_modules')
  ) {
    return false;
  }
  return foldedSegments[0] !== '.sec';
}

function samePhysicalFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameSnapshotState(left: BigIntStats, right: BigIntStats): boolean {
  return samePhysicalFile(left, right)
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

async function readPhysicalSnapshotFile(entry: LocalStateSnapshotPlanEntry): Promise<Buffer> {
  // Template is immutable after ensureTemplate returns (staging + atomic rename +
  // .template-ready marker). The 3x stat verification is unnecessary for an
  // immutable source — a single readFile suffices.
  return fs.readFile(entry.sourcePath);
}

async function assertLocalStateDestinationAbsent(workspaceRoot: string): Promise<void> {
  let entries: readonly Dirent[];
  try {
    entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const localStateEntries = entries.filter(
    (entry) => caseFoldFixtureSegment(entry.name) === '.sec'
  );
  if (localStateEntries.length > 0) {
    throw new Error(
      'Workspace fixture destination must not contain a case-equivalent local-state path'
    );
  }
}

/**
 * Recursively materialize a mutable workspace with independent regular files.
 * COPYFILE_FICLONE requests filesystem copy-on-write cloning when available and
 * falls back to an ordinary copy when unavailable. Both modes keep a distinct
 * file identity, so direct host writes cannot mutate the template or a sibling
 * workspace and product authorities continue to observe nlink === 1.
 * Symlinks are recreated; directories are mkdir'd.
 */
async function copyTreeWithIndependentFiles(
  sourceRoot: string,
  source: string,
  target: string
): Promise<void> {
  const entries = await fs.readdir(source, { withFileTypes: true });
  await fs.mkdir(target, { recursive: true });
  await Promise.all(entries.map(async (entry) => {
    const sourcePath = path.join(source, entry.name);
    if (!shouldCloneOrdinaryWorkspaceFixturePath(sourceRoot, sourcePath)) return;
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyTreeWithIndependentFiles(sourceRoot, sourcePath, targetPath);
    } else if (entry.isSymbolicLink()) {
      const linkTarget = await fs.readlink(sourcePath);
      await fs.symlink(linkTarget, targetPath);
    } else {
      await fs.copyFile(sourcePath, targetPath, constants.COPYFILE_FICLONE);
    }
  }));
}

export async function copyWorkspaceFixture(sourceRoot: string, workspaceRoot: string): Promise<void> {
  const localStateSnapshotPlan = await resolveLocalStateSnapshotPlan(sourceRoot);
  await assertLocalStateDestinationAbsent(workspaceRoot);
  await copyTreeWithIndependentFiles(sourceRoot, sourceRoot, workspaceRoot);
  // No post-copy assertLocalStateDestinationAbsent needed: the independent-file copy
  // filter already excludes .sec paths, so the destination cannot contain one.
  for (const entry of localStateSnapshotPlan) {
    const destinationPath = path.join(workspaceRoot, ...entry.destinationSegments);
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.writeFile(destinationPath, await readPhysicalSnapshotFile(entry), { flag: 'wx' });
  }
}

export async function cloneWorkspaceTemplate(
  kind: WorkspaceTemplateKind,
  prefix = `engineering-compiler-${kind}-`
): Promise<string> {
  const templateRoot = await ensureTemplate(kind);
  const workspaceRoot = await createWorkspace(prefix);
  // Template is immutable after ensureTemplate returns: templateCacheVersion
  // is a hardcoded constant, so the .template-ready marker never becomes
  // stale within a single run, and createTemplate uses staging + atomic rename.
  // Concurrent independent copies from the read-only template to distinct targets are safe
  // and do not need the creation lock — holding it here serialized all clones
  // of the same kind, defeating --concurrent --max-concurrency.
  await copyWorkspaceFixture(templateRoot, workspaceRoot);
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
  callback: (workspaceRoot: string) => Promise<T>,
  options: WorkspaceCallbackOptions = {}
): Promise<T> {
  const workspaceRoot = await cloneWorkspaceTemplate(kind, `engineering-compiler-${kind}-scenario-`);
  return runWorkspaceCallback(workspaceRoot, callback, options);
}

export async function expectWorkspaceVerifies(
  workspaceRoot: string,
  options: { lane?: 'fast' | 'all' } = {}
): Promise<void> {
  const { report } = await verifyWorkspace(workspaceRoot, { lane: options.lane ?? 'fast' });
  expect(report.summary.status).toBe('passed');
}
