import path from 'node:path';
import { CodedFailure } from '../contracts/failure.ts';
import type { DependencyCleanOptions } from '../execution/dependency-environment.ts';
import type { DependencyProjectOperation } from '../execution/dependency-materialization.ts';
export interface DependencyEnvironmentOperation<Status> extends DependencyProjectOperation {
  readonly compilerRoot: string;
  readonly canonicalSharedRoot: string;
  getStatus(workspaceRoot: string, sharedRoot: string): Promise<Status>;
  ensureCompilerDepsReady(): Promise<unknown>;
  disposeCanonicalSharedDependencies(): Promise<unknown>;
  removeProjectProjection(workspaceRoot: string): Promise<readonly string[]>;
}

export async function warmupDependencyEnvironment<Status>(workspaceRoot: string,
  operation: DependencyEnvironmentOperation<Status>, sharedRoot = operation.canonicalSharedRoot): Promise<Status> {
  await operation.ensureCompilerDepsReady();
  return operation.getStatus(path.resolve(workspaceRoot), sharedRoot);
}

export async function relinkProjectDependencies<Status>(workspaceRoot: string,
  operation: DependencyEnvironmentOperation<Status>, sharedRoot = operation.canonicalSharedRoot): Promise<Status> {
  const root = path.resolve(workspaceRoot);
  if (path.relative(root, operation.compilerRoot) === '') await operation.ensureCompilerDepsReady();
  else await operation.ensureProjectDependencies(root, { rematerialize: true });
  return operation.getStatus(root, sharedRoot);
}

export async function cleanDependencyEnvironment<Status>(workspaceRoot: string, input: DependencyCleanOptions,
  operation: DependencyEnvironmentOperation<Status>, sharedRoot = operation.canonicalSharedRoot): Promise<string[]> {
  const { project, shared, bunCache, all, force } = input;
  for (const [field, value] of Object.entries({ project, shared, bunCache, all, force })) {
    if (value !== undefined && typeof value !== 'boolean') throw new CodedFailure('RUNTIME-DEPS-003', `Dependency cleanup ${field} must be boolean`);
  }
  if (!all && !project && !shared && !bunCache) return [];
  if (all || bunCache) throw new CodedFailure('IMPORT-AUTHORITY-004',
    'Bun cache cleanup requires Runtime Cache owner authority shared with compiler installation');
  if (shared && path.relative(path.resolve(sharedRoot), operation.canonicalSharedRoot) !== '') throw new CodedFailure('IMPORT-AUTHORITY-004',
    'Custom shared dependency roots cannot be retired through the public cleanup projection without owner-issued lifecycle authority');
  const removed: string[] = [];
  if (project) removed.push(...await operation.removeProjectProjection(path.resolve(workspaceRoot)));
  if (shared) { await operation.disposeCanonicalSharedDependencies(); removed.push(sharedRoot); }
  return removed;
}
