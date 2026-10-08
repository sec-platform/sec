import path from 'node:path';
import { captureRuntimeDependencyInstallRequest, type RuntimeDependencyInstallRequest } from '../../../execution/dependency-install-request.ts';
import * as runtime from './runtime/project-runtime.ts';

export type {
  CompilerDependencyExecutionGenerationAuthority,
  CompilerDependencyMaterializationDigest,
  CompilerDependencyMaterializationInputProjection, CompilerDependencyReadGenerationRetirementReceipt, CompilerDepsReadyState,
  DependencyAuthorityPaths, RetainedCompilerDependencyExecutionGeneration, RetainedCompilerDependencyReadGeneration, RuntimeDependencySourceGeneration,
  RuntimeDependencyTargetIdentity,
  RuntimeDepsStamp
} from './runtime/project-runtime.ts';

export {
  assertCompilerDependencyExecutionGenerationAuthority,
  assertCompilerDependencyExecutionRetirementReceipt, assertCompilerDependencyReadGenerationRetirementReceipt, assertRetainedCompilerDependencyReadGeneration, COMPILER_DEPENDENCY_EXECUTION_RETENTION_POLICY,
  projectCompilerDepsReadyState, retainCompilerDependencyExecutionGeneration, retainCompilerDependencyReadGeneration
} from './runtime/project-runtime.ts';


/**
 * Production callers may narrow one dependency operation, but cannot replace
 * its process transport, lifecycle owner, clock, sleep, filesystem effects or
 * canonical shared root. Fault injection lives under dependencies/test/**.
 */
export interface RuntimeDependencyInstallOptions extends Readonly<RuntimeDependencyInstallRequest> {}


/** Null means no compatible current authority, not necessarily an absent locator. */
export async function observeCompilerDependencyExecutionGenerationAuthority(
  options: RuntimeDependencyInstallOptions = {},
  compilerDependencyRoot?: string
): Promise<runtime.CompilerDependencyExecutionGenerationAuthority | null> {
  compilerDependencyRoot = compilerDependencyRoot === undefined ? undefined : path.resolve(compilerDependencyRoot);
  return runtime.observeCompilerDependencyExecutionGenerationAuthority(
    captureRuntimeDependencyInstallRequest(options),
    compilerDependencyRoot
  );
}

export const dependencyAuthorityPaths = runtime.dependencyAuthorityPaths;
export const compilerDependencyLocatorWorktreeRetirementProvider =
  runtime.compilerDependencyLocatorWorktreeRetirementProvider;

/** Owner-issued closeout for terminal compiler staging journals. */
export async function retireSettledCompilerDependencyStageIntents(
  ownerRoot: string,
  options: RuntimeDependencyInstallOptions = {}
): Promise<runtime.CompilerDependencyStageIntentRetirementReceipt> {
  return runtime.retireSettledCompilerDependencyStageIntents(
    path.resolve(ownerRoot),
    captureRuntimeDependencyInstallRequest(options)
  );
}

/**
 * Explicit owner operation for the one-way durable dependency-journal
 * migration. Normal readers never parse the legacy grammar.
 */
export async function migrateDependencyTransitionJournal(
  ownerRoot: string,
  options: RuntimeDependencyInstallOptions = {}
): Promise<void> {
  ownerRoot = path.resolve(ownerRoot);
  return runtime.migrateDependencyTransitionJournal(
    ownerRoot,
    captureRuntimeDependencyInstallRequest(options)
  );
}

export async function withProjectDependencyBridge<T>(
  projectRoot: string,
  callback: () => Promise<T>,
  options: RuntimeDependencyInstallOptions = {}
): Promise<T> {
  projectRoot = path.resolve(projectRoot);
  if (typeof callback !== 'function') throw new TypeError('Dependency bridge callback must be callable');
  return runtime.withProjectDependencyBridge(projectRoot, callback, captureRuntimeDependencyInstallRequest(options));
}

/** Pure dependency-owner observation; performs no dependency materialization Effect. */
export async function observeCompilerDependencyMaterializationInput(
  compilerDependencyRoot?: string
): Promise<runtime.CompilerDependencyMaterializationInputProjection> {
  return runtime.observeCompilerDependencyMaterializationInput(compilerDependencyRoot);
}

/** Keep a compatible target, otherwise reuse this exact owner-admitted source generation. */
export async function ensureCompilerDepsReadyFromGeneration(
  authority: runtime.CompilerDependencyExecutionGenerationAuthority,
  options: RuntimeDependencyInstallOptions = {},
  compilerDependencyRoot?: string
): Promise<runtime.CompilerDepsReadyState> {
  compilerDependencyRoot = compilerDependencyRoot === undefined ? undefined : path.resolve(compilerDependencyRoot);
  return runtime.ensureCompilerDepsReadyFromGeneration(
    authority,
    captureRuntimeDependencyInstallRequest(options),
    compilerDependencyRoot
  );
}

export async function ensureCompilerDepsReady(
  options: RuntimeDependencyInstallOptions = {},
  compilerDependencyRoot?: string
): Promise<runtime.CompilerDepsReadyState> {
  compilerDependencyRoot = compilerDependencyRoot === undefined ? undefined : path.resolve(compilerDependencyRoot);
  return runtime.ensureCompilerDepsReady(captureRuntimeDependencyInstallRequest(options), compilerDependencyRoot);
}

export async function ensureProjectDependencies(
  projectRoot: string,
  options: RuntimeDependencyInstallOptions = {}
): Promise<void> {
  projectRoot = path.resolve(projectRoot);
  return runtime.ensureProjectDependencies(projectRoot, captureRuntimeDependencyInstallRequest(options));
}
