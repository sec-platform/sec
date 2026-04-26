import fs from 'node:fs/promises';
import path from 'node:path';
import { compilerRoot, getWorkspacePaths } from './paths.ts';
import { pathExists, removeDir } from './fs.ts';
import { ensureProjectDependencies, ensureSharedDepsReady, readRuntimeDepsStamp } from './project-runtime.ts';
import { loadRuntimeDependencySpec } from './runtime-dependency-spec.ts';

export type DependencyEnvironmentMode = 'cold' | 'warm-shared' | 'warm-project' | 'dirty' | 'stale';
export type DependencyEntryKind = 'missing' | 'physical' | 'link';

export interface DependencyEntryStatus {
  path: string;
  exists: boolean;
  kind: DependencyEntryKind;
  sizeBytes: number;
  target?: string;
}

export interface DependencyEnvironmentStatus {
  mode: DependencyEnvironmentMode;
  manifestHash: string;
  sharedStampHash?: string;
  projectStampHash?: string;
  rootNodeModules: DependencyEntryStatus;
  sharedNodeModules: DependencyEntryStatus;
  projectNodeModules: DependencyEntryStatus;
  npmCache: DependencyEntryStatus;
  recommendedAction: string;
}

export interface DependencyCleanOptions {
  project?: boolean;
  shared?: boolean;
  npmCache?: boolean;
  all?: boolean;
}

export interface DependencyEnvironmentOptions {
  sharedDepsRoot?: string;
}

async function safeRealpath(targetPath: string): Promise<string | undefined> {
  try {
    return await fs.realpath(targetPath);
  } catch {
    return undefined;
  }
}

async function entrySize(targetPath: string): Promise<number> {
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(targetPath);
  } catch {
    return 0;
  }

  if (stat.isSymbolicLink()) {
    return 0;
  }

  if (!stat.isDirectory()) {
    return stat.size;
  }

  let total = 0;
  let entries: Array<import('node:fs').Dirent>;
  try {
    entries = await fs.readdir(targetPath, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name);
    const entryStat = await fs.lstat(entryPath).catch(() => null);
    total += entryStat?.size ?? 0;
  }

  return total;
}

async function readEntryStatus(targetPath: string): Promise<DependencyEntryStatus> {
  if (!(await pathExists(targetPath))) {
    return {
      path: targetPath,
      exists: false,
      kind: 'missing',
      sizeBytes: 0
    };
  }

  const stat = await fs.lstat(targetPath);
  const target = await safeRealpath(targetPath);
  return {
    path: targetPath,
    exists: true,
    kind: stat.isSymbolicLink() ? 'link' : 'physical',
    sizeBytes: await entrySize(targetPath),
    target
  };
}

function defaultSharedDepsRoot(): string {
  return path.join(compilerRoot, '.shared-deps');
}

function npmCacheRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.npm-cache');
}

function projectStampPath(projectRoot: string): string {
  return path.join(projectRoot, '.runtime-deps.stamp.json');
}

function sharedStampPath(sharedDepsRoot: string): string {
  return path.join(sharedDepsRoot, 'runtime-deps.stamp.json');
}

function classifyStatus(status: DependencyEnvironmentStatus): DependencyEnvironmentMode {
  const sharedMatches = status.sharedStampHash === status.manifestHash;
  const projectMatches = status.projectStampHash === status.manifestHash;

  if (!status.sharedNodeModules.exists || !status.sharedStampHash) {
    return 'cold';
  }

  if (!sharedMatches || (status.projectStampHash && !projectMatches)) {
    return 'stale';
  }

  if (!status.projectNodeModules.exists) {
    return 'warm-shared';
  }

  if (status.projectNodeModules.kind === 'physical' && status.sharedNodeModules.exists) {
    return 'dirty';
  }

  if (projectMatches) {
    return 'warm-project';
  }

  return 'warm-shared';
}

function recommendAction(mode: DependencyEnvironmentMode): string {
  switch (mode) {
    case 'cold':
      return 'platform deps warmup';
    case 'warm-shared':
      return 'platform deps relink project';
    case 'dirty':
      return 'platform deps relink project';
    case 'stale':
      return 'platform deps warmup';
    case 'warm-project':
      return 'none';
  }
}

export async function getDependencyEnvironmentStatus(
  workspaceRoot = process.cwd(),
  options: DependencyEnvironmentOptions = {}
): Promise<DependencyEnvironmentStatus> {
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const sharedRoot = options.sharedDepsRoot ?? defaultSharedDepsRoot();
  const runtimeSpec = await loadRuntimeDependencySpec();
  const [rootNodeModules, sharedNodeModules, projectNodeModules, npmCache, sharedStamp, projectStamp] = await Promise.all([
    readEntryStatus(path.join(compilerRoot, 'node_modules')),
    readEntryStatus(path.join(sharedRoot, 'node_modules')),
    readEntryStatus(path.join(projectRoot, 'node_modules')),
    readEntryStatus(npmCacheRoot(workspaceRoot)),
    readRuntimeDepsStamp(sharedStampPath(sharedRoot)),
    readRuntimeDepsStamp(projectStampPath(projectRoot))
  ]);

  const statusWithoutMode = {
    manifestHash: runtimeSpec.manifestHash,
    sharedStampHash: sharedStamp?.manifestHash,
    projectStampHash: projectStamp?.manifestHash,
    rootNodeModules,
    sharedNodeModules,
    projectNodeModules,
    npmCache
  };
  const mode = classifyStatus({
    ...statusWithoutMode,
    mode: 'cold',
    recommendedAction: 'none'
  });

  return {
    ...statusWithoutMode,
    mode,
    recommendedAction: recommendAction(mode)
  };
}

export async function warmupDependencyEnvironment(
  workspaceRoot = process.cwd(),
  options: DependencyEnvironmentOptions = {}
): Promise<DependencyEnvironmentStatus> {
  await ensureSharedDepsReady({ sharedDepsRoot: options.sharedDepsRoot });
  return getDependencyEnvironmentStatus(workspaceRoot, options);
}

export async function relinkProjectDependencies(
  workspaceRoot = process.cwd(),
  options: DependencyEnvironmentOptions = {}
): Promise<DependencyEnvironmentStatus> {
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  await ensureProjectDependencies(projectRoot, { sharedDepsRoot: options.sharedDepsRoot });
  return getDependencyEnvironmentStatus(workspaceRoot, options);
}

export async function cleanDependencyEnvironment(
  workspaceRoot = process.cwd(),
  options: DependencyCleanOptions,
  environmentOptions: DependencyEnvironmentOptions = {}
): Promise<string[]> {
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const targets: string[] = [];

  if (options.all || options.project) {
    targets.push(path.join(projectRoot, 'node_modules'));
    targets.push(projectStampPath(projectRoot));
  }
  if (options.all || options.shared) {
    targets.push(environmentOptions.sharedDepsRoot ?? defaultSharedDepsRoot());
  }
  if (options.all || options.npmCache) {
    targets.push(npmCacheRoot(workspaceRoot));
  }

  for (const target of targets) {
    await removeDir(target);
  }

  return targets;
}

export function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  for (const unit of units) {
    if (size < 1024) {
      return `${size.toFixed(1)} ${unit}`;
    }
    size /= 1024;
  }
  return `${size.toFixed(1)} PB`;
}

export function formatDependencyEnvironmentStatus(status: DependencyEnvironmentStatus): string {
  const lines = [
    'Runtime dependency status',
    `Mode: ${status.mode}`,
    `Manifest hash: ${status.manifestHash}`,
    `Root node_modules: ${status.rootNodeModules.kind}, ${formatBytes(status.rootNodeModules.sizeBytes)}`,
    `Shared deps: ${status.sharedNodeModules.kind}, ${formatBytes(status.sharedNodeModules.sizeBytes)}`,
    `Project node_modules: ${status.projectNodeModules.kind}, ${formatBytes(status.projectNodeModules.sizeBytes)}`,
    `NPM cache: ${status.npmCache.kind}, ${formatBytes(status.npmCache.sizeBytes)}`,
    `Recommended action: ${status.recommendedAction}`
  ];

  if (status.projectNodeModules.target && status.projectNodeModules.kind === 'link') {
    lines.splice(6, 0, `Project node_modules target: ${status.projectNodeModules.target}`);
  }

  return `${lines.join('\n')}\n`;
}
