import fs from 'node:fs/promises';
import path from 'node:path';
import { SecError } from '../../../system-architecture/foundation/contract/failure.ts';
import { isFileNotFoundError, pathExists, removeDir } from '../../../workspace/files.ts';
import { compilerRoot, getWorkspacePaths, resolveWorkspacePlanPath } from '../../../workspace/runtime/paths.ts';
import { loadRuntimeDependencySpec } from '../contract/runtime-dependency-spec.ts';
import type { RuntimeDependencyInstallOptions } from '../runtime/operation-context.ts';
import {
  disposeCanonicalSharedDependencies,
  ensureProjectDependencies,
  ensureSharedDepsReady,
  readRuntimeDepsStamp,
} from '../runtime/project-runtime.ts';

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
  bunCache: DependencyEntryStatus;
  recommendedAction: string;
}

export interface DependencyCleanOptions {
  project?: boolean;
  shared?: boolean;
  bunCache?: boolean;
  all?: boolean;
  force?: boolean;
}

export interface DependencyEnvironmentOptions {
  generatedStateLifecycle?: RuntimeDependencyInstallOptions['generatedStateLifecycle'];
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
  } catch (error) {
    if (isFileNotFoundError(error)) return undefined;
    throw error;
  }
}

async function shallowEntryCount(targetPath: string): Promise<number | undefined> {
  try {
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    return entries.length;
  } catch (error) {
    if (isFileNotFoundError(error)) return undefined;
    throw error;
  }
}

async function readEntryStatus(targetPath: string): Promise<DependencyEntryStatus> {
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(targetPath);
  } catch (error) {
    if (!isFileNotFoundError(error)) throw error;
    return {
      path: targetPath,
      exists: false,
      kind: 'missing',
      sizeBytes: 0
    };
  }

  const [target, entryCount] = await Promise.all([
    safeRealpath(targetPath),
    stat.isDirectory() ? shallowEntryCount(targetPath) : Promise.resolve(undefined)
  ]);
  return {
    path: targetPath,
    exists: true,
    kind: stat.isSymbolicLink() ? 'link' : 'physical',
    sizeBytes: stat.size,
    entryCount,
    target
  };
}

function defaultSharedDepsRoot(): string {
  return path.join(compilerRoot, '.shared-deps');
}

function bunCacheRoot(sharedDepsRoot: string): string {
  return path.join(sharedDepsRoot, '.bun-cache');
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
      return 'platform deps relink';
    case 'dirty':
      return 'platform deps relink';
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

async function workspaceRootsDoctorCheck(paths: ReturnType<typeof getWorkspacePaths>): Promise<DoctorCheck> {
  const roots = [
    { id: 'workspace', path: paths.workspaceRoot },
    { id: 'model', path: paths.modelRoot },
    { id: 'src', path: paths.srcRoot },
    { id: '.sec', path: paths.secRoot }
  ];
  const missingRoots = (await Promise.all(
    roots.map(async (root) => ({
      id: root.id,
      exists: await pathExists(root.path)
    }))
  ))
    .filter((root) => !root.exists)
    .map((root) => root.id);

  return {
    id: 'workspace-roots',
    status: missingRoots.length === 0 ? 'ok' : 'warn',
    message: missingRoots.length === 0
      ? 'Workspace roots exist: workspace, model, src, .sec.'
      : `Workspace roots missing: ${missingRoots.join(', ')}; run platform init.`
  };
}

function dependencyDoctorCheck(status: DependencyEnvironmentStatus): DoctorCheck {
  return status.mode === 'warm-project'
    ? {
        id: 'runtime-dependencies',
        status: 'ok',
        message: 'Runtime dependencies are warm and project dependencies use the shared cache.'
      }
    : {
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
  const { workspaceRoot: targetWorkspaceRoot } = getWorkspacePaths(workspaceRoot);
  const sharedRoot = options.sharedDepsRoot ?? defaultSharedDepsRoot();
  const [runtimeSpec, rootNodeModules, sharedNodeModules, projectNodeModules, bunCache, sharedStamp, projectStamp] = await Promise.all([
    loadRuntimeDependencySpec(),
    readEntryStatus(path.join(compilerRoot, 'node_modules')),
    readEntryStatus(path.join(sharedRoot, 'node_modules')),
    readEntryStatus(path.join(targetWorkspaceRoot, 'node_modules')),
    readEntryStatus(bunCacheRoot(sharedRoot)),
    readRuntimeDepsStamp(sharedStampPath(sharedRoot)),
    readRuntimeDepsStamp(projectStampPath(targetWorkspaceRoot))
  ]);

  const statusWithoutMode = {
    manifestHash: runtimeSpec.manifestHash,
    sharedStampHash: sharedStamp?.manifestHash,
    projectStampHash: projectStamp?.manifestHash,
    rootNodeModules,
    sharedNodeModules,
    projectNodeModules,
    bunCache
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
  const workspacePlanExists = resolveWorkspacePlanPath(workspaceRoot).then((workspacePlanPath) =>
    pathExists(workspacePlanPath)
  );
  const [
    dependencies,
    planExists,
    bunCheck,
    rootsCheck,
    projectPackageExists
  ] = await Promise.all([
    getDependencyEnvironmentStatus(workspaceRoot, options),
    workspacePlanExists,
    executableCheck('bun', 'bun', true),
    workspaceRootsDoctorCheck(paths),
    pathExists(paths.packageJsonPath)
  ]);
  const checks: DoctorCheck[] = [
    bunCheck,
    rootsCheck,
    {
      id: 'workspace-plan',
      status: planExists ? 'ok' : 'warn',
      message: planExists
        ? 'Workspace plan exists.'
        : 'Workspace plan is missing; run platform init before product development.'
    },
    {
      id: 'project-package',
      status: projectPackageExists ? 'ok' : 'warn',
      message: projectPackageExists
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
  await ensureSharedDepsReady({
    generatedStateLifecycle: options.generatedStateLifecycle,
    sharedDepsRoot: options.sharedDepsRoot
  });
  return getDependencyEnvironmentStatus(workspaceRoot, options);
}

export async function relinkProjectDependencies(
  workspaceRoot = process.cwd(),
  options: DependencyEnvironmentOptions = {}
): Promise<DependencyEnvironmentStatus> {
  const { workspaceRoot: targetWorkspaceRoot } = getWorkspacePaths(workspaceRoot);
  await ensureProjectDependencies(targetWorkspaceRoot, {
    generatedStateLifecycle: options.generatedStateLifecycle,
    rematerialize: true,
    sharedDepsRoot: options.sharedDepsRoot
  });
  return getDependencyEnvironmentStatus(workspaceRoot, options);
}

export async function cleanDependencyEnvironment(
  workspaceRoot = process.cwd(),
  options: DependencyCleanOptions,
  environmentOptions: DependencyEnvironmentOptions = {}
): Promise<string[]> {
  const { workspaceRoot: targetWorkspaceRoot } = getWorkspacePaths(workspaceRoot);
  const sharedRoot = environmentOptions.sharedDepsRoot ?? defaultSharedDepsRoot();
  const targets = new Set<string>();

  if (options.all || options.project) {
    targets.add(path.join(targetWorkspaceRoot, 'node_modules'));
    targets.add(projectStampPath(targetWorkspaceRoot));
  }
  if (options.all || options.shared) {
    targets.add(sharedRoot);
  }
  if (!(options.all || options.shared) && options.bunCache) {
    targets.add(bunCacheRoot(sharedRoot));
  }

  for (const target of targets) {
    if (path.resolve(target) === path.resolve(sharedRoot)) {
      if (path.resolve(sharedRoot) !== path.resolve(defaultSharedDepsRoot())) {
        throw new SecError(
          'IMPORT-AUTHORITY-004',
          'Custom shared dependency roots cannot be retired through the public cleanup projection without owner-issued lifecycle authority'
        );
      }
      await disposeCanonicalSharedDependencies(environmentOptions);
    } else {
      await removeDir(target);
    }
  }

  return [...targets];
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
    `Bun cache: ${formatEntryStatus(status.bunCache)}`,
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
