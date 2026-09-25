import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FailureError } from '../../../../contracts/failure.ts';
import { isFileNotFoundError, pathExists, removeDir } from "../../../filesystem/files.ts";
import { compilerRoot, getWorkspacePaths, resolveWorkspacePlanPath } from "../../../workspace-context.ts";
import { loadRuntimeDependencySpec } from '../contract/runtime-dependency-spec.ts';
import { classifyDependencyEnvironment, observeDependencyEntry, type DependencyEntryStatus, type DependencyEnvironmentMode } from '../runtime/environment-observation.ts';
import {
  ensureCompilerDepsReady,
  ensureProjectDependencies,
  readRuntimeDepsStamp,
} from '../runtime/project-runtime.ts';
import {
  dependencyMaterializationLocations,
  disposeDependencyMaterializationCollection,
  disposeDependencyProviderCache
} from '../runtime/materialization-location.ts';
export type { DependencyEntryKind, DependencyEntryStatus, DependencyEnvironmentMode } from '../runtime/environment-observation.ts';

export type DoctorCheckStatus = 'ok' | 'warn' | 'fail';

export interface DependencyEnvironmentStatus {
  mode: DependencyEnvironmentMode;
  manifestHash: string;
  projectStampHash?: string;
  compilerNodeModules: DependencyEntryStatus;
  projectNodeModules: DependencyEntryStatus;
  bunPackageCache: DependencyEntryStatus;
  recommendedAction: string;
}

export interface DependencyCleanOptions {
  project?: boolean;
  materializations?: boolean;
  bunCache?: boolean;
  all?: boolean;
  force?: boolean;
}

function captureCleanupSelection(options: DependencyCleanOptions): Readonly<DependencyCleanOptions> {
  const { project, materializations, bunCache, all, force } = options;
  for (const [field, value] of Object.entries({ project, materializations, bunCache, all, force })) {
    if (value !== undefined && typeof value !== 'boolean') {
      throw new FailureError('RUNTIME-DEPS-003', `Dependency cleanup ${field} must be boolean`);
    }
  }
  return Object.freeze({ project, materializations, bunCache, all, force });
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



function projectStampPath(projectRoot: string): string {
  return path.join(projectRoot, '.runtime-deps.stamp.json');
}


function recommendAction(mode: DependencyEnvironmentMode): string {
  switch (mode) {
    case 'cold':
      return 'platform deps warmup';
    case 'warm-compiler':
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
        message: 'Runtime dependencies are warm and project dependencies project the canonical compiler generation.'
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
  workspaceRoot = process.cwd()
): Promise<DependencyEnvironmentStatus> {
  const cwd = process.cwd();
  const { workspaceRoot: targetWorkspaceRoot } = getWorkspacePaths(path.resolve(cwd, workspaceRoot));
  const locations = dependencyMaterializationLocations(compilerRoot);
  const [runtimeSpec, compilerNodeModules, projectNodeModules, bunPackageCache, projectStamp] = await Promise.all([
    loadRuntimeDependencySpec(),
    observeDependencyEntry(path.join(compilerRoot, 'node_modules')),
    observeDependencyEntry(path.join(targetWorkspaceRoot, 'node_modules')),
    observeDependencyEntry(locations.bunPackageCacheRoot),
    readRuntimeDepsStamp(projectStampPath(targetWorkspaceRoot))
  ]);

  const statusWithoutMode = {
    manifestHash: runtimeSpec.manifestHash,
    projectStampHash: projectStamp?.manifestHash,
    compilerNodeModules: compilerNodeModules.entry,
    projectNodeModules: projectNodeModules.entry,
    bunPackageCache: bunPackageCache.entry
  };
  const mode = classifyDependencyEnvironment(
    { manifestHash: runtimeSpec.manifestHash, projectStampHash: projectStamp?.manifestHash },
    compilerNodeModules,
    projectNodeModules
  );

  return {
    ...statusWithoutMode,
    mode,
    recommendedAction: recommendAction(mode)
  };
}

export async function getDoctorReport(
  workspaceRoot = process.cwd()
): Promise<DoctorReport> {
  const cwd = process.cwd();
  workspaceRoot = path.resolve(cwd, workspaceRoot);
  const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
    .map(entry => path.resolve(cwd, entry));
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
    getDependencyEnvironmentStatus(workspaceRoot),
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
  workspaceRoot = process.cwd()
): Promise<DependencyEnvironmentStatus> {
  workspaceRoot = path.resolve(process.cwd(), workspaceRoot);
  await ensureCompilerDepsReady();
  return getDependencyEnvironmentStatus(workspaceRoot);
}

export async function relinkProjectDependencies(
  workspaceRoot = process.cwd()
): Promise<DependencyEnvironmentStatus> {
  workspaceRoot = path.resolve(process.cwd(), workspaceRoot);
  const { workspaceRoot: targetWorkspaceRoot } = getWorkspacePaths(workspaceRoot);
  await ensureProjectDependencies(targetWorkspaceRoot, { rematerialize: true });
  return getDependencyEnvironmentStatus(workspaceRoot);
}

export async function cleanDependencyEnvironment(
  workspaceRoot = process.cwd(),
  options: DependencyCleanOptions
): Promise<string[]> {
  const cwd = process.cwd();
  const { workspaceRoot: targetWorkspaceRoot } = getWorkspacePaths(path.resolve(cwd, workspaceRoot));
  const selection = captureCleanupSelection(options);
  if (!selection.all && !selection.project && !selection.materializations && !selection.bunCache) return [];
  const locations = dependencyMaterializationLocations(compilerRoot);
  const removed: string[] = [];
  if (selection.all || selection.project) {
    const projectTargets = [
      path.join(targetWorkspaceRoot, 'node_modules'),
      projectStampPath(targetWorkspaceRoot)
    ];
    for (const target of projectTargets) {
      if (await pathExists(target)) {
        await removeDir(target);
        removed.push(target);
      }
    }
  }
  if ((selection.all || selection.materializations) &&
      disposeDependencyMaterializationCollection(compilerRoot)) {
    removed.push(locations.collectionRoot);
  }
  if ((selection.all || selection.bunCache) && disposeDependencyProviderCache(compilerRoot)) {
    removed.push(locations.bunPackageCacheRoot);
  }
  return removed;
}
