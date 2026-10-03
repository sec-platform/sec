import path from 'node:path';
import { getDependencyFreshness } from '../../adapters/toolchain/dependencies/application/dependency-freshness.ts';
import { removeDependencyProjectProjection } from '../../adapters/toolchain/dependencies/runtime/environment-projection.ts';
import * as observations from '../../adapters/toolchain/dependencies/runtime/environment-status.ts';
import { compilerRoot } from '../../adapters/workspace-context.ts';
import { cleanDependencyEnvironment as clean, relinkProjectDependencies as relink, warmupDependencyEnvironment as warmup } from '../../application/dependency-environment.ts';
import { createDependencyOperation } from './dependency-operation.ts';

export { getDependencyFreshness };
export const getDoctorReport = observations.getDoctorReport;
export const getDependencyEnvironmentStatus = observations.getDependencyEnvironmentStatus;

function operation(workspaceRoot: string) {
  const native = createDependencyOperation({ workspaceRoot });
  return Object.freeze({ ...native, compilerRoot, canonicalSharedRoot: path.join(compilerRoot, '.shared-deps'),
    ensureCompilerDepsReady: () => native.ensureCompilerDepsReady({}, compilerRoot),
    getStatus: (root: string, sharedDepsRoot: string) => observations.getDependencyEnvironmentStatus(root, { sharedDepsRoot }),
    removeProjectProjection: removeDependencyProjectProjection });
}
export function warmupDependencyEnvironment(workspaceRoot = process.cwd()) { return warmup(workspaceRoot, operation(workspaceRoot)); }
export function relinkProjectDependencies(workspaceRoot = process.cwd()) { return relink(workspaceRoot, operation(workspaceRoot)); }
export function cleanDependencyEnvironment(workspaceRoot: string, request: Parameters<typeof clean>[1]) {
  return clean(workspaceRoot, request, operation(workspaceRoot));
}
