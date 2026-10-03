import * as environment from './application/dependency-environment.ts';
export { getDependencyFreshness } from './application/dependency-freshness.ts';

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
