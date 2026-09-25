import path from 'node:path';
import type {
  GeneratedStateDomainOwnerOperation,
  GeneratedStateDomainOwnerPlan
} from '../../runtime-state/generated-state/operation.ts';
import { captureRuntimeDependencyInstallRequest, type RuntimeDependencyInstallRequest } from './contract/install-request.ts';
import * as runtime from './runtime/project-runtime.ts';

export type {
  CompilerDependencyExecutionGenerationAuthority,
  CompilerDependencyMaterializationDigest,
  CompilerDependencyMaterializationInputProjection, CompilerDependencyReadGenerationRetirementReceipt, CompilerDepsReadyState,
  DependencyAuthorityPaths, RetainedCompilerDependencyExecutionGeneration, RetainedCompilerDependencyReadGeneration, RuntimeDependencySourceGeneration,
  RuntimeDependencyTargetIdentity,
  RuntimeDepsStamp,
  DependencyMaterializationReadyState
} from './runtime/project-runtime.ts';

export {
  assertCompilerDependencyExecutionGenerationAuthority,
  assertCompilerDependencyExecutionRetirementReceipt, assertCompilerDependencyReadGenerationRetirementReceipt, assertRetainedCompilerDependencyReadGeneration, COMPILER_DEPENDENCY_EXECUTION_RETENTION_POLICY,
  projectCompilerDepsReadyState, retainCompilerDependencyExecutionGeneration, retainCompilerDependencyReadGeneration
} from './runtime/project-runtime.ts';

/**
 * Production callers may narrow one dependency operation, but cannot replace
 * its process transport, lifecycle owner, clock, sleep, filesystem effects or
 * provider-private Runtime Cache location. Fault injection lives under dependencies/test/**.
 */
export interface RuntimeDependencyInstallOptions extends Readonly<RuntimeDependencyInstallRequest> {}


/** Null means no compatible current authority, not necessarily an absent locator. */
export async function observeCompilerDependencyExecutionGenerationAuthority(
  options: RuntimeDependencyInstallOptions = {},
  compilerDependencyRoot?: string
): Promise<runtime.CompilerDependencyExecutionGenerationAuthority | null> {
  compilerDependencyRoot = compilerDependencyRoot === undefined ? undefined : path.resolve(compilerDependencyRoot);
  return runtime.observeCompilerDependencyExecutionGenerationAuthorityInternal(
    captureRuntimeDependencyInstallRequest(options),
    compilerDependencyRoot
  );
}

export const dependencyAuthorityPaths = runtime.dependencyAuthorityPaths;
export const compilerDependencyLocatorWorktreeRetirementProvider =
  runtime.compilerDependencyLocatorWorktreeRetirementProvider;

const issuedCompilerDependencyGeneratedStatePlans = new WeakSet<object>();

/**
 * Public composition capability for generated-state orchestration.  The
 * facade exposes one owner operation, not dependency journal or physical
 * cleanup primitives; only plans issued by this process-local owner can be
 * settled.
 */
export const compilerDependencyGeneratedStateSettlementOwner:
GeneratedStateDomainOwnerOperation = Object.freeze({
  owner: 'compiler-dependency-runtime',
  plan(input: Parameters<GeneratedStateDomainOwnerOperation['plan']>[0]) {
    const plan = runtime.planCompilerDependencyGeneratedStateSettlement(input);
    issuedCompilerDependencyGeneratedStatePlans.add(plan);
    return plan;
  },
  async settle(plan: GeneratedStateDomainOwnerPlan) {
    if (!issuedCompilerDependencyGeneratedStatePlans.has(plan)) {
      throw new Error('Compiler dependency generated-state plan was not issued by this owner.');
    }
    return runtime.settleCompilerDependencyGeneratedState(
      plan as runtime.CompilerDependencyGeneratedStateSettlementPlan
    );
  }
});

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

export async function ensureCompilerDepsReady(
  options: RuntimeDependencyInstallOptions = {},
  compilerDependencyRoot?: string
): Promise<runtime.CompilerDepsReadyState> {
  compilerDependencyRoot = compilerDependencyRoot === undefined ? undefined : path.resolve(compilerDependencyRoot);
  return runtime.ensureCompilerDepsReady(captureRuntimeDependencyInstallRequest(options), compilerDependencyRoot);
}

export async function ensureDependencyMaterializationReady(
  options: RuntimeDependencyInstallOptions = {}
): Promise<runtime.DependencyMaterializationReadyState> {
  return runtime.ensureDependencyMaterializationReady(captureRuntimeDependencyInstallRequest(options));
}

export async function ensureProjectDependencies(
  projectRoot: string,
  options: RuntimeDependencyInstallOptions = {}
): Promise<void> {
  projectRoot = path.resolve(projectRoot);
  return runtime.ensureProjectDependencies(projectRoot, captureRuntimeDependencyInstallRequest(options));
}
