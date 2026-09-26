import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FailureError } from '../../../../contracts/failure.ts';
import { isFileNotFoundError, pathExists, removeDir } from "../../../filesystem/files.ts";
import { compilerRoot, getWorkspacePaths, resolveWorkspacePlanPath } from "../../../workspace-context.ts";
import { loadRuntimeDependencySpec } from '../contract/runtime-dependency-spec.ts';
import { classifyDependencyEnvironment, observeDependencyEntry, type DependencyEntryStatus, type DependencyEnvironmentMode } from '../runtime/environment-observation.ts';
import { sameHostPath } from '../runtime/host-path.ts';
import type { RuntimeDependencyGeneratedStateLifecycle } from '../runtime/lifecycle-capabilities.ts';
import {
  disposeCanonicalSharedDependencies,
  ensureProjectDependencies,
  ensureSharedDepsReady,
  readRuntimeDepsStamp,
} from '../runtime/project-runtime.ts';
export type { DependencyEntryKind, DependencyEntryStatus, DependencyEnvironmentMode } from '../runtime/environment-observation.ts';

export type DoctorCheckStatus = 'ok' | 'warn' | 'fail';

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
  generatedStateLifecycle?: RuntimeDependencyGeneratedStateLifecycle;
  sharedDepsRoot?: string;
}

/** Bind the location once; read-only observations never acquire lifecycle methods. */
function environmentLocation(options: DependencyEnvironmentOptions, cwd: string): Readonly<{
  sharedDepsRoot: string;
}> {
  const selected = options.sharedDepsRoot;
  if (selected !== undefined && (typeof selected !== 'string' || selected.length === 0)) {
    throw new FailureError('RUNTIME-DEPS-003', 'Shared dependency root must be a nonempty path');
  }
  return Object.freeze({ sharedDepsRoot: path.resolve(cwd, selected ?? defaultSharedDepsRoot()) });
}

function environmentExecutionOptions(options: DependencyEnvironmentOptions, cwd: string): Readonly<DependencyEnvironmentOptions> {
  const location = environmentLocation(options, cwd);
  const generatedStateLifecycle = options.generatedStateLifecycle;
  return Object.freeze({ ...location, generatedStateLifecycle });
}

function captureCleanupSelection(options: DependencyCleanOptions): Readonly<DependencyCleanOptions> {
  const { project, shared, bunCache, all, force } = options;
  for (const [field, value] of Object.entries({ project, shared, bunCache, all, force })) {
    if (value !== undefined && typeof value !== 'boolean') {
      throw new FailureError('RUNTIME-DEPS-003', `Dependency cleanup ${field} must be boolean`);
    }
  }
  // force remains a compatibility input, never a permission to bypass an owner.
  return Object.freeze({ project, shared, bunCache, all, force });
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

async function executableCheck(id: string, executableName: string, optional: boolean, pathEntries: readonly string[]): Promise<DoctorCheck> {
  const candidates = process.platform === 'win32'
    ? [`${executableName}.cmd`, `${executableName}.exe`, executableName]
    : [executableName];

  for (const pathEntry of pathEntries) {
    for (const candidate of candidates) {
      const candidatePath = path.join(pathEntry, candidate);
      let available = false;
      try {
        const metadata = await fs.stat(candidatePath);
        if (metadata.isFile()) {
          await fs.access(candidatePath, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
          available = true;
        }
      } catch (error) {
        if (!isFileNotFoundError(error) && !['ENOTDIR', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      }
      if (available) {
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
  const cwd = process.cwd();
  const { workspaceRoot: targetWorkspaceRoot } = getWorkspacePaths(path.resolve(cwd, workspaceRoot));
  const { sharedDepsRoot: sharedRoot } = environmentLocation(options, cwd);
  const [runtimeSpec, rootNodeModules, sharedNodeModules, projectNodeModules, bunCache, sharedStamp, projectStamp] = await Promise.all([
    loadRuntimeDependencySpec(),
    observeDependencyEntry(path.join(compilerRoot, 'node_modules')),
    observeDependencyEntry(path.join(sharedRoot, 'node_modules')),
    observeDependencyEntry(path.join(targetWorkspaceRoot, 'node_modules')),
    observeDependencyEntry(bunCacheRoot(sharedRoot)),
    readRuntimeDepsStamp(sharedStampPath(sharedRoot)),
    readRuntimeDepsStamp(projectStampPath(targetWorkspaceRoot))
  ]);

  const statusWithoutMode = {
    manifestHash: runtimeSpec.manifestHash,
    sharedStampHash: sharedStamp?.manifestHash,
    projectStampHash: projectStamp?.manifestHash,
    rootNodeModules: rootNodeModules.entry,
    sharedNodeModules: sharedNodeModules.entry,
    projectNodeModules: projectNodeModules.entry,
    bunCache: bunCache.entry
  };
  const mode = classifyDependencyEnvironment(statusWithoutMode, sharedNodeModules, projectNodeModules);

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
  const cwd = process.cwd();
  workspaceRoot = path.resolve(cwd, workspaceRoot);
  const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
    .map(entry => path.resolve(cwd, entry));
  const location = environmentLocation(options, cwd);
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
    getDependencyEnvironmentStatus(workspaceRoot, location),
    workspacePlanExists,
    executableCheck('bun', 'bun', true, pathEntries),
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
  const cwd = process.cwd();
  workspaceRoot = path.resolve(cwd, workspaceRoot);
  const selected = environmentExecutionOptions(options, cwd);
  await ensureSharedDepsReady(selected);
  return getDependencyEnvironmentStatus(workspaceRoot, selected);
}

export async function relinkProjectDependencies(
  workspaceRoot = process.cwd(),
  options: DependencyEnvironmentOptions = {}
): Promise<DependencyEnvironmentStatus> {
  const cwd = process.cwd();
  workspaceRoot = path.resolve(cwd, workspaceRoot);
  const { workspaceRoot: targetWorkspaceRoot } = getWorkspacePaths(workspaceRoot);
  const selected = environmentExecutionOptions(options, cwd);
  await ensureProjectDependencies(targetWorkspaceRoot, { ...selected, rematerialize: true });
  return getDependencyEnvironmentStatus(workspaceRoot, selected);
}

export async function cleanDependencyEnvironment(
  workspaceRoot = process.cwd(),
  options: DependencyCleanOptions,
  environmentOptions: DependencyEnvironmentOptions = {}
): Promise<string[]> {
  const cwd = process.cwd();
  const { workspaceRoot: targetWorkspaceRoot } = getWorkspacePaths(path.resolve(cwd, workspaceRoot));
  const selection = captureCleanupSelection(options);
  if (!selection.all && !selection.project && !selection.shared && !selection.bunCache) return [];
  const { sharedDepsRoot: sharedRoot } = environmentLocation(environmentOptions, cwd);
  const targets = new Set<string>();
  if (selection.all || selection.project) {
    targets.add(path.join(targetWorkspaceRoot, 'node_modules'));
    targets.add(projectStampPath(targetWorkspaceRoot));
  }
  if (selection.all || selection.shared) targets.add(sharedRoot);
  else if (selection.bunCache) targets.add(bunCacheRoot(sharedRoot));

  // Complete all lexical owner/target checks before the first deletion.
  // Previously an invalid shared root could be discovered only after the
  // project targets had already been removed. Physical owner admission remains
  // with disposeCanonicalSharedDependencies; this is not an atomic cleanup batch.
  const plan = [...targets].map(target => ({ target, shared: sameHostPath(target, sharedRoot) }));
  const hasSharedSettlement = plan.some(step => step.shared);
  if (hasSharedSettlement && !sameHostPath(sharedRoot, defaultSharedDepsRoot())) {
    throw new FailureError('IMPORT-AUTHORITY-004',
      'Custom shared dependency roots cannot be retired through the public cleanup projection without owner-issued lifecycle authority');
  }
  const settlementOptions = hasSharedSettlement
    ? Object.freeze({ sharedDepsRoot: sharedRoot, generatedStateLifecycle: environmentOptions.generatedStateLifecycle })
    : undefined;
  for (const step of plan) {
    if (step.shared) await disposeCanonicalSharedDependencies(settlementOptions!);
    else await removeDir(step.target);
  }
  return [...targets];
}