import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SecError } from '../../../../contracts/failure.ts';
import type { RuntimeDependencyGeneratedStateLifecycle } from "../../../../execution/generated-state/dependency-lifecycle.ts";
import { isFileNotFoundError, pathExists } from "../../../filesystem/files.ts";
import { resolveSecWorkspaceRuntimeRoots } from '../../../runtime-state/workspace-state/paths.ts';
import { compilerRoot, getWorkspacePaths, resolveWorkspacePlanPath } from "../../../workspace-context.ts";
import { loadRuntimeDependencySpec } from '../contract/runtime-dependency-spec.ts';
import { classifyDependencyEnvironment, observeDependencyEntry, sameObservedDependencyDirectory, type DependencyEntryStatus, type DependencyEnvironmentMode } from './environment-observation.ts';
import { sameHostPath } from './host-path.ts';
import {
  observeCompilerDependencyExecutionGenerationAuthority,
  readRuntimeDepsStamp,
} from './project-runtime.ts';
export type { DependencyEntryKind, DependencyEntryStatus, DependencyEnvironmentMode } from './environment-observation.ts';

export type DoctorCheckStatus = 'ok' | 'warn' | 'fail';

export interface DependencyEnvironmentStatus {
  mode: DependencyEnvironmentMode;
  manifestHash: string;
  projectStampHash?: string;
  rootNodeModules: DependencyEntryStatus;
  projectNodeModules: DependencyEntryStatus;
  bunCache: DependencyEntryStatus;
  recommendedAction: string;
}

export type { DependencyCleanOptions } from '../../../../execution/dependency-environment.ts';

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
    throw new SecError('RUNTIME-DEPS-003', 'Shared dependency root must be a nonempty path');
  }
  return Object.freeze({ sharedDepsRoot: path.resolve(cwd, selected ?? defaultSharedDepsRoot()) });
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

function bunCacheRoot(): string {
  return path.join(resolveSecWorkspaceRuntimeRoots({ repositoryRoot: compilerRoot, environment: process.env }).cacheRoot, 'bun-install');
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
        message: 'Runtime dependencies are warm and project dependencies use the compiler generation.'
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
  _options: DependencyEnvironmentOptions = {}
): Promise<DependencyEnvironmentStatus> {
  const cwd = process.cwd();
  const { workspaceRoot: targetWorkspaceRoot } = getWorkspacePaths(path.resolve(cwd, workspaceRoot));
  const [runtimeSpec, compilerAuthority, rootNodeModules, projectNodeModules, bunCache, projectStamp] = await Promise.all([
    loadRuntimeDependencySpec(),
    observeCompilerDependencyExecutionGenerationAuthority(),
    observeDependencyEntry(path.join(compilerRoot, 'node_modules')),
    observeDependencyEntry(path.join(targetWorkspaceRoot, 'node_modules')),
    observeDependencyEntry(bunCacheRoot()),
    readRuntimeDepsStamp(projectStampPath(targetWorkspaceRoot))
  ]);

  const statusWithoutMode = {
    manifestHash: runtimeSpec.manifestHash,
    compilerReady: compilerAuthority !== null,
    projectStampHash: projectStamp?.manifestHash,
    rootNodeModules: rootNodeModules.entry,
    projectNodeModules: projectNodeModules.entry,
    bunCache: bunCache.entry
  };
  // The compiler workspace is itself the dependency-generation owner. Its
  // node_modules locator is the compiler generation, not a project bridge,
  // and therefore has no project projection stamp to validate.
  const mode = sameHostPath(targetWorkspaceRoot, compilerRoot)
    ? compilerAuthority !== null &&
        sameObservedDependencyDirectory(rootNodeModules, projectNodeModules)
      ? 'warm-project'
      : classifyDependencyEnvironment(statusWithoutMode, rootNodeModules, projectNodeModules)
    : classifyDependencyEnvironment(statusWithoutMode, rootNodeModules, projectNodeModules);

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
