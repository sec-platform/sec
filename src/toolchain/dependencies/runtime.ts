import type { CommitFence } from '../../workspace/files.ts';
import * as runtime from './runtime/project-runtime.ts';

export type {
  CompilerDepsReadyState,
  DependencyAuthorityPaths,
  RuntimeDependencySourceGeneration,
  RuntimeDependencyTargetIdentity,
  RuntimeDepsStamp,
  SharedDepsReadyState
} from './runtime/project-runtime.ts';

export { SHARED_DEPENDENCY_FORBIDDEN_AUTHORITY_FILES } from './runtime/project-runtime.ts';

/**
 * Production callers may narrow one dependency operation, but cannot replace
 * its process transport, lifecycle owner, clock, sleep, filesystem effects or
 * canonical shared root. Fault injection lives under dependencies/test/**.
 */
export interface RuntimeDependencyInstallOptions {
  readonly beforeCommit?: CommitFence;
  readonly installMode?: 'allow' | 'offline-copy-only' | 'prebound-only';
  readonly lockTimeoutMs?: number;
  readonly rematerialize?: boolean;
  readonly signal?: AbortSignal;
  readonly skipSharedDepsWarmup?: boolean;
}

function dependencyInstallOptions(
  options: RuntimeDependencyInstallOptions
): runtime.RuntimeDependencyInstallOptions {
  return {
    beforeCommit: options.beforeCommit,
    installMode: options.installMode,
    lockTimeoutMs: options.lockTimeoutMs,
    rematerialize: options.rematerialize,
    signal: options.signal,
    skipSharedDepsWarmup: options.skipSharedDepsWarmup
  };
}

export const dependencyAuthorityPaths = runtime.dependencyAuthorityPaths;
export const compilerDependencyLocatorWorktreeRetirementProvider =
  runtime.compilerDependencyLocatorWorktreeRetirementProvider;

/**
 * Explicit owner operation for the one-way durable dependency-journal
 * migration. Normal readers never parse the legacy grammar.
 */
export async function migrateDependencyTransitionJournal(
  ownerRoot: string,
  options: RuntimeDependencyInstallOptions = {}
): Promise<void> {
  return runtime.migrateDependencyTransitionJournal(
    ownerRoot,
    dependencyInstallOptions(options)
  );
}

export async function withProjectDependencyBridge<T>(
  projectRoot: string,
  callback: () => Promise<T>,
  options: RuntimeDependencyInstallOptions = {}
): Promise<T> {
  return runtime.withProjectDependencyBridge(projectRoot, callback, dependencyInstallOptions(options));
}

export async function ensureCompilerDepsReady(
  options: RuntimeDependencyInstallOptions = {},
  compilerDependencyRoot?: string
): Promise<runtime.CompilerDepsReadyState> {
  return runtime.ensureCompilerDepsReady(dependencyInstallOptions(options), compilerDependencyRoot);
}

export async function ensureSharedDepsReady(
  options: RuntimeDependencyInstallOptions = {}
): Promise<runtime.SharedDepsReadyState> {
  return runtime.ensureSharedDepsReady(dependencyInstallOptions(options));
}

export async function ensureProjectDependencies(
  projectRoot: string,
  options: RuntimeDependencyInstallOptions = {}
): Promise<void> {
  return runtime.ensureProjectDependencies(projectRoot, dependencyInstallOptions(options));
}
