import * as environment from './application/dependency-environment.ts';

export type {
  DependencyCleanOptions,
  DependencyEntryKind,
  DependencyEntryStatus,
  DependencyEnvironmentMode,
  DependencyEnvironmentStatus,
  DoctorCheck,
  DoctorCheckStatus,
  DoctorReport
} from './application/dependency-environment.ts';

export {
  formatBytes,
  formatDependencyEnvironmentStatus,
  formatDoctorReport,
  formatEntryStatus
} from './application/dependency-environment.ts';

export async function getDependencyEnvironmentStatus(
  workspaceRoot = process.cwd()
): Promise<environment.DependencyEnvironmentStatus> {
  return environment.getDependencyEnvironmentStatus(workspaceRoot);
}

export async function getDoctorReport(
  workspaceRoot = process.cwd()
): Promise<environment.DoctorReport> {
  return environment.getDoctorReport(workspaceRoot);
}

export async function warmupDependencyEnvironment(
  workspaceRoot = process.cwd()
): Promise<environment.DependencyEnvironmentStatus> {
  return environment.warmupDependencyEnvironment(workspaceRoot);
}

export async function relinkProjectDependencies(
  workspaceRoot = process.cwd()
): Promise<environment.DependencyEnvironmentStatus> {
  return environment.relinkProjectDependencies(workspaceRoot);
}

export async function cleanDependencyEnvironment(
  workspaceRoot: string,
  clean: environment.DependencyCleanOptions
): Promise<string[]> {
  return environment.cleanDependencyEnvironment(workspaceRoot, clean);
}
