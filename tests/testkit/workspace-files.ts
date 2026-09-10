import type { Dirent } from 'node:fs';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const clonableCacheSnapshotNames = ['composition-baseline.json', 'project-baseline.json'] as const;

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
        `Workspace fixture contains case-colliding local-state paths under ${relativeRoot}: ` + `${existingName}, ${entry.name}`
      );
    }
    namesByFoldedName.set(foldedName, entry.name);
  }
}

function findCaseFoldedEntry(entries: readonly Dirent[], expectedName: string): Dirent | undefined {
  return entries.find((entry) => caseFoldFixtureSegment(entry.name) === caseFoldFixtureSegment(expectedName));
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

async function resolveLocalStateSnapshotPlan(sourceRoot: string): Promise<readonly LocalStateSnapshotPlanEntry[]> {
  const sourceEntries = await fs.readdir(sourceRoot, { withFileTypes: true });
  const localStateEntries = sourceEntries.filter((entry) => caseFoldFixtureSegment(entry.name) === '.sec');
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
    plan.push(snapshotPlanEntry(sourceRoot, [localStateEntry.name, pipelineJournalEntry.name], ['.sec', 'pipeline-journal.json']));
  }

  const artifactsEntry = findCaseFoldedEntry(localStateChildren, 'artifacts');
  if (artifactsEntry !== undefined) {
    assertPhysicalDirectory(artifactsEntry, '.sec/artifacts');
    await collectPhysicalSnapshotFiles(
      sourceRoot,
      [localStateEntry.name, artifactsEntry.name],
      ['.sec', 'artifacts'],
      plan
    );
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
    plan.push(snapshotPlanEntry(sourceRoot, [localStateEntry.name, cacheEntry.name, snapshotEntry.name], ['.sec', 'cache', snapshotName]));
  }
  return plan;
}

async function collectPhysicalSnapshotFiles(
  sourceRoot: string,
  sourceSegments: readonly string[],
  destinationSegments: readonly string[],
  plan: LocalStateSnapshotPlanEntry[]
): Promise<void> {
  const sourceDirectory = path.join(sourceRoot, ...sourceSegments);
  const entries = await fs.readdir(sourceDirectory, { withFileTypes: true });
  assertNoCaseCollisions(entries, destinationSegments.join('/'));
  for (const entry of entries) {
    const entrySourceSegments = [...sourceSegments, entry.name];
    const entryDestinationSegments = [...destinationSegments, entry.name];
    const relativePath = entryDestinationSegments.join('/');
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      await collectPhysicalSnapshotFiles(sourceRoot, entrySourceSegments, entryDestinationSegments, plan);
      continue;
    }
    assertPhysicalRegularFile(entry, relativePath);
    plan.push(snapshotPlanEntry(sourceRoot, entrySourceSegments, entryDestinationSegments));
  }
}

function shouldCloneOrdinaryWorkspaceFixturePath(sourceRoot: string, source: string): boolean {
  const relativeSegments = path.relative(sourceRoot, source).split(path.sep);
  const foldedSegments = relativeSegments.map(caseFoldFixtureSegment);
  if (caseFoldFixtureSegment(path.basename(source)) === '.template-ready' || foldedSegments.includes('node_modules')) {
    return false;
  }
  return foldedSegments[0] !== '.sec';
}

async function assertLocalStateDestinationAbsent(workspaceRoot: string): Promise<void> {
  let entries: readonly Dirent[];
  try {
    entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const localStateEntries = entries.filter((entry) => caseFoldFixtureSegment(entry.name) === '.sec');
  if (localStateEntries.length > 0) {
    throw new Error('Workspace fixture destination must not contain a case-equivalent local-state path');
  }
}

/** Ordinary fixture copying only. Node owns traversal, independent file copies
 * and symlink reproduction; SEC keeps only its local-state selection contract.
 * This is not retained/no-follow publication or an atomic workspace snapshot.
 */
export async function copyWorkspaceFixture(sourceRoot: string, workspaceRoot: string): Promise<void> {
  const cwd = process.cwd();
  sourceRoot = path.resolve(cwd, sourceRoot);
  workspaceRoot = path.resolve(cwd, workspaceRoot);
  const source = await fs.lstat(sourceRoot);
  if (!source.isDirectory() || source.isSymbolicLink()) {
    throw new Error('Workspace fixture source must be an ordinary directory');
  }
  const localStateSnapshotPlan = await resolveLocalStateSnapshotPlan(sourceRoot);
  await assertLocalStateDestinationAbsent(workspaceRoot);
  await fs.cp(sourceRoot, workspaceRoot, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
    mode: constants.COPYFILE_FICLONE,
    filter: (sourcePath) => sourcePath === sourceRoot || shouldCloneOrdinaryWorkspaceFixturePath(sourceRoot, sourcePath)
  });
  // A selected local-state snapshot is never merged into an existing state tree.
  await assertLocalStateDestinationAbsent(workspaceRoot);
  for (const entry of localStateSnapshotPlan) {
    const destinationPath = path.join(workspaceRoot, ...entry.destinationSegments);
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.writeFile(destinationPath, await fs.readFile(entry.sourcePath), { flag: 'wx' });
  }
}

