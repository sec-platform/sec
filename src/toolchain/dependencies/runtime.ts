import type {
  GeneratedStateDomainOwnerOperation,
  GeneratedStateDomainOwnerPlan
} from '../../runtime-state/generated-state/operation.ts';
import type { CommitFence } from '../../workspace/files.ts';
import type { RuntimeDependencyInstallOptions as RuntimeDependencyInternalOptions } from './runtime/operation-context.ts';
import * as runtime from './runtime/project-runtime.ts';

export type {
  CompilerDependencyExecutionGenerationAuthority,
  CompilerDependencyMaterializationDigest,
  CompilerDependencyMaterializationInputProjection,
  CompilerDepsReadyState,
  DependencyAuthorityPaths, RetainedCompilerDependencyExecutionGeneration, RetainedCompilerDependencyReadGeneration, RuntimeDependencySourceGeneration,
  RuntimeDependencyTargetIdentity,
  RuntimeDepsStamp,
  SharedDepsReadyState
} from './runtime/project-runtime.ts';

export {
  assertCompilerDependencyExecutionGenerationAuthority,
  assertCompilerDependencyExecutionRetirementReceipt,
  COMPILER_DEPENDENCY_EXECUTION_RETENTION_POLICY,
  projectCompilerDepsReadyState, retainCompilerDependencyExecutionGeneration, retainCompilerDependencyReadGeneration
} from './runtime/project-runtime.ts';

export { SHARED_DEPENDENCY_FORBIDDEN_AUTHORITY_FILES } from './runtime/project-runtime.ts';

/**
 * Production callers may narrow one dependency operation, but cannot replace
 * its process transport, lifecycle owner, clock, sleep, filesystem effects or
 * canonical shared root. Fault injection lives under dependencies/test/**.
 */
export interface RuntimeDependencyInstallOptions {
  readonly beforeCommit?: CommitFence;
  readonly deadlineAtUnixMs?: number;
  readonly installMode?: 'allow' | 'offline-copy-only' | 'prebound-only';
  readonly lockTimeoutMs?: number;
  readonly rematerialize?: boolean;
  readonly signal?: AbortSignal;
  readonly skipSharedDepsWarmup?: boolean;
}

function dependencyInstallOptions(
  options: RuntimeDependencyInstallOptions
): RuntimeDependencyInternalOptions {
  return {
    beforeCommit: options.beforeCommit,
    deadlineAtUnixMs: options.deadlineAtUnixMs,
    installMode: options.installMode,
    lockTimeoutMs: options.lockTimeoutMs,
    rematerialize: options.rematerialize,
    signal: options.signal,
    skipSharedDepsWarmup: options.skipSharedDepsWarmup
  };
}

export async function observeCompilerDependencyExecutionGenerationAuthority(
  options: RuntimeDependencyInstallOptions = {},
  compilerDependencyRoot?: string
): Promise<runtime.CompilerDependencyExecutionGenerationAuthority | null> {
  return runtime.observeCompilerDependencyExecutionGenerationAuthority(
    dependencyInstallOptions(options),
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
