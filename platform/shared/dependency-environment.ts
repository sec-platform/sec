import fs from 'node:fs/promises';
import path from 'node:path';
import { compilerRoot, getWorkspacePaths, resolveWorkspacePlanPath } from './paths.ts';
import { pathExists, removeDir } from './fs.ts';
import { ensureProjectDependencies, ensureSharedDepsReady, readRuntimeDepsStamp } from './project-runtime.ts';
import { loadRuntimeDependencySpec } from './runtime-dependency-spec.ts';

export type DependencyEnvironmentMode = 'cold' | 'warm-shared' | 'warm-project' | 'dirty' | 'stale';
export type DependencyEntryKind = 'missing' | 'physical' | 'link';
export type DoctorCheckStatus = 'ok' | 'warn' | 'fail';

export interface DependencyEntryStatus {
  path: string;
  exists: boolean;
  kind: DependencyEntryKind;
  sizeBytes: number;
  entryCount?: number;
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
  force?: boolean;
}

export interface DependencyEnvironmentOptions {
  sharedDepsRoot?: string;
}

export interface DoctorCheck {
  id: string;
  status: DoctorCheckStatus;
  message: string;
}

export interface DoctorReport {
  status: DoctorCheckStatus;
  checkCount: number;
  checks: DoctorCheck[];
  dependencies: DependencyEnvironmentStatus;
}

async function safeRealpath(targetPath: string): Promise<string | undefined> {
  try {
    return await fs.realpath(targetPath);
  } catch {
    return undefined;
  }
}

async function shallowEntryCount(targetPath: string): Promise<number | undefined> {
  try {
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    return entries.length;
  } catch {
    return undefined;
  }
}

async function readEntryStatus(targetPath: string): Promise<DependencyEntryStatus> {
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(targetPath);
  } catch {
    return {
      path: targetPath,
      exists: false,
      kind: 'missing',
      sizeBytes: 0
    };
  }

  const target = await safeRealpath(targetPath);
  return {
    path: targetPath,
    exists: true,
    kind: stat.isSymbolicLink() ? 'link' : 'physical',
    sizeBytes: stat.size,
    entryCount: stat.isDirectory() ? await shallowEntryCount(targetPath) : undefined,
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

function combineDoctorStatus(checks: DoctorCheck[]): DoctorCheckStatus {
  if (checks.some((check) => check.status === 'fail')) {
    return 'fail';
  }
  if (checks.some((check) => check.status === 'warn')) {
    return 'warn';
  }
  return 'ok';
}

function dependencyDoctorCheck(status: DependencyEnvironmentStatus): DoctorCheck {
  if (status.mode === 'warm-project') {
    return {
      id: 'runtime-dependencies',
      status: 'ok',
      message: 'Runtime dependencies are warm and project dependencies use the shared cache.'
    };
  }

  if (status.mode === 'dirty' || status.mode === 'stale') {
    return {
      id: 'runtime-dependencies',
      status: 'warn',
      message: `Runtime dependencies are ${status.mode}; run ${status.recommendedAction}.`
    };
  }

  return {
    id: 'runtime-dependencies',
    status: 'warn',
    message: `Runtime dependencies are ${status.mode}; run ${status.recommendedAction}.`
  };
}

async function executableCheck(id: string, executableName: string, optional: boolean): Promise<DoctorCheck> {
  const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const candidates = process.platform === 'win32'
    ? [`${executableName}.cmd`, `${executableName}.exe`, executableName]
    : [executableName];

  for (const pathEntry of pathEntries) {
    for (const candidate of candidates) {
      if (await pathExists(path.join(pathEntry, candidate))) {
        return {
          id,
          status: 'ok',
          message: `${executableName} is available.`
        };
      }
    }
  }

  return {
    id,
    status: optional ? 'warn' : 'fail',
    message: `${executableName} is ${optional ? 'not available; fallback paths may be slower.' : 'required but not available.'}`
  };
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

export async function getDoctorReport(
  workspaceRoot = process.cwd(),
  options: DependencyEnvironmentOptions = {}
): Promise<DoctorReport> {
  const paths = getWorkspacePaths(workspaceRoot);
  const dependencies = await getDependencyEnvironmentStatus(workspaceRoot, options);
  const workspacePlanPath = await resolveWorkspacePlanPath(workspaceRoot);
  const workspacePlanExists = await pathExists(workspacePlanPath);
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  const checks: DoctorCheck[] = [
    {
      id: 'node-version',
      status: nodeMajor >= 22 ? 'ok' : 'fail',
      message: `Node.js ${process.versions.node} detected; Node.js 22 or newer is required.`
    },
    await executableCheck('bun', 'bun', true),
    {
      id: 'workspace-plan',
      status: workspacePlanExists ? 'ok' : 'warn',
      message: workspacePlanExists
        ? 'Workspace plan exists.'
        : 'Workspace plan is missing; run platform init before product development.'
    },
    {
      id: 'project-package',
      status: (await pathExists(paths.projectPackagePath)) ? 'ok' : 'warn',
      message: (await pathExists(paths.projectPackagePath))
        ? 'Project package manifest exists.'
        : 'Project package manifest is missing; run platform compose or platform verify when runtime checks are needed.'
    },
    dependencyDoctorCheck(dependencies)
  ];

  return {
    status: combineDoctorStatus(checks),
    checkCount: checks.length,
    checks,
    dependencies
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
  await removeDir(path.join(projectRoot, 'node_modules'));
  await removeDir(projectStampPath(projectRoot));
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

export function formatEntryStatus(status: DependencyEntryStatus): string {
  const base = `${status.kind}, metadata ${formatBytes(status.sizeBytes)}`;
  return status.entryCount === undefined ? base : `${base}, ${status.entryCount} top-level entries`;
}

export function formatDependencyEnvironmentStatus(status: DependencyEnvironmentStatus): string {
  const lines = [
    'Runtime dependency status',
    `Mode: ${status.mode}`,
    `Manifest hash: ${status.manifestHash}`,
    `Root node_modules: ${formatEntryStatus(status.rootNodeModules)}`,
    `Shared deps: ${formatEntryStatus(status.sharedNodeModules)}`,
    `Project node_modules: ${formatEntryStatus(status.projectNodeModules)}`,
    `NPM cache: ${formatEntryStatus(status.npmCache)}`,
    `Recommended action: ${status.recommendedAction}`
  ];

  if (status.projectNodeModules.target && status.projectNodeModules.kind === 'link') {
    lines.splice(6, 0, `Project node_modules target: ${status.projectNodeModules.target}`);
  }

  return `${lines.join('\n')}\n`;
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [
    'Developer environment doctor',
    `Status: ${report.status}`,
    `Checks: ${report.checkCount}`,
    ...report.checks.map((check) => `[${check.status}] ${check.id}: ${check.message}`),
    '',
    formatDependencyEnvironmentStatus(report.dependencies).trimEnd()
  ];

  return `${lines.join('\n')}\n`;
}
