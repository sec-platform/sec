import path from 'node:path';
import type { WorkspaceWriteLeaseToken } from '../../adapters/filesystem/write-lease.ts';
import { linkedWorktreeDependencyOwnerRoot } from '../../adapters/toolchain/dependencies/runtime/linked-worktree-owner.ts';
import { runtimeDependencyOperationContext, runtimeDependencyOperationOptions } from '../../adapters/toolchain/dependencies/runtime/operation-context.ts';
import * as native from '../../adapters/toolchain/dependencies/runtime/project-runtime.ts';
import { RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES, RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES } from '../../adapters/toolchain/dependencies/runtime/source-generation.ts';
import { compilerRoot } from '../../adapters/workspace-context.ts';
import { settleCompilerDependencyGeneratedState } from '../../application/dependency-generated-state.ts';
import { ensureProjectDependencyEnvironment } from '../../application/project-dependency-preparation.ts';
import { SecError } from '../../contracts/failure.ts';
import { planCompilerDependencyGeneratedStateSettlement, type CompilerDependencyGeneratedStateSettlementPlan } from '../../execution/dependency-generated-state.ts';
import { captureRuntimeDependencyInstallRequest, type RuntimeDependencyInstallRequest } from '../../execution/dependency-install-request.ts';
import type { DependencyProjectLifecycleAdmission } from '../../execution/dependency-materialization.ts';
import { createGeneratedStateCleanupOperationSession } from '../../execution/generated-state/cleanup-budget.ts';
import type { RuntimeDependencyGeneratedStateLifecycle, RuntimeDependencyLifecycleFactory } from '../../execution/generated-state/dependency-lifecycle.ts';
import type { GeneratedStateDomainOwnerOperation, GeneratedStateDomainOwnerPlan } from '../../execution/generated-state/operation-port.ts';
import { createGeneratedStateRegistrationBootstrap } from '../runtime-state/generated-state.ts';

/** The actual composition root retains internal capabilities separately from
 * caller decisions. Public request capture remains the single DTO owner. */
export function createDependencyOperation(input: Readonly<{ workspaceRoot: string; environment?: NodeJS.ProcessEnv;
  workspaceWriteLease?: WorkspaceWriteLeaseToken }>) {
  input = Object.freeze({ ...input, environment: Object.freeze({ ...(input.environment ?? process.env) }) });
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const bind = (request: RuntimeDependencyInstallRequest = {}) => {
    const controls = runtimeDependencyOperationOptions(captureRuntimeDependencyInstallRequest(request));
    const context = runtimeDependencyOperationContext(controls);
    const cleanupOperation = createGeneratedStateCleanupOperationSession({ deadlineAtMonotonicMs: context.deadlineAtMonotonicMs,
      maximumBytes: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES, maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
      monotonicNowMs: context.monotonicNowMs, signal: context.signal });
    const sessions = new Map<string, RuntimeDependencyGeneratedStateLifecycle>();
    const factory: RuntimeDependencyLifecycleFactory = Object.freeze({ forWorkspace: rootInput => {
      const root = path.resolve(rootInput);
      if (root !== workspaceRoot && root !== path.resolve(compilerRoot)) {
        const owner = linkedWorktreeDependencyOwnerRoot(workspaceRoot);
        try {
          if (owner === null || path.resolve(owner.ownerRoot) !== root) throw new Error('Dependency producer workspace is outside this bound operation.');
          owner.assertCurrent();
        } finally { owner?.dispose(); }
      }
      const existing = sessions.get(root); if (existing !== undefined) return existing;
      const stateRoot = native.observeCompilerDependencyLifecycleStateRoot(root);
      const environment = stateRoot === null ? input.environment : Object.freeze({ ...(input.environment ?? process.env), SEC_STATE_HOME: stateRoot });
      const session = createGeneratedStateRegistrationBootstrap({ workspaceRoot: root, environment, cleanupOperation,
        ...(root === workspaceRoot ? { reentrantToken: input.workspaceWriteLease } : {}),
        worktreeRetirementProviders: [native.compilerDependencyLocatorWorktreeRetirementProvider] }).createProducerHooks(root);
      sessions.set(root, session); return session;
    } });
    return runtimeDependencyOperationOptions({ ...controls, generatedStateLifecycleFactory: factory }) as
      ReturnType<typeof runtimeDependencyOperationOptions> & Readonly<{ generatedStateLifecycleFactory: RuntimeDependencyLifecycleFactory }>;
  };
  const generatedStatePlans = new WeakSet<object>();
  const ensureProject = (projectRoot:string, request:RuntimeDependencyInstallRequest = {}) => ensureProjectDependencyOperation(projectRoot,bind(request));
  const settleOwnedGeneratedState = (plan: CompilerDependencyGeneratedStateSettlementPlan, request: RuntimeDependencyInstallRequest = {}) => {
    const options = bind(request);
    const lifecycle = options.generatedStateLifecycleFactory!.forWorkspace(plan.workspaceRoot);
    return settleCompilerDependencyGeneratedState(plan, {
      inspect: () => lifecycle.inspect!(),
      observeWorkspace: native.observeDependencyGeneratedStateWorkspace,
      migrateJournal: root => native.migrateDependencyTransitionJournal(root, options)
    });
  };
  const generatedStateOwner: GeneratedStateDomainOwnerOperation = Object.freeze({ owner: 'compiler-dependency-runtime',
    plan: (request: Parameters<GeneratedStateDomainOwnerOperation['plan']>[0]) => {
      const plan = planCompilerDependencyGeneratedStateSettlement({ ...request, workspaceIdentity: native.observeDependencyGeneratedStateWorkspace(request.workspaceRoot) }); generatedStatePlans.add(plan); return plan;
    },
    settle: (plan: GeneratedStateDomainOwnerPlan) => {
      if (!generatedStatePlans.has(plan)) throw new Error('Dependency generated-state plan was not issued by this bound operation owner.');
      return settleOwnedGeneratedState(plan as CompilerDependencyGeneratedStateSettlementPlan);
    } });
  return Object.freeze({
    generatedStateOwner,
    ensureCompilerDepsReady: (request: RuntimeDependencyInstallRequest = {}, root = workspaceRoot) => native.ensureCompilerDepsReady(bind(request), root),
    ensureProjectDependencies: ensureProject,
    withProjectDependencyBridge: <Value>(projectRoot: string, use: () => Promise<Value>, request: RuntimeDependencyInstallRequest = {}) =>
      native.withProjectDependencyBridge(projectRoot, use, bind(request)),
    migrateDependencyTransitionJournal: (root = workspaceRoot, request: RuntimeDependencyInstallRequest = {}) => native.migrateDependencyTransitionJournal(root, bind(request)),
    retireSettledCompilerDependencyStageIntents: (root = workspaceRoot, request: RuntimeDependencyInstallRequest = {}) => native.retireSettledCompilerDependencyStageIntents(root, bind(request)),
    disposeCompilerDependencyEnvironment: (root = workspaceRoot, request: RuntimeDependencyInstallRequest = {}) => native.disposeCompilerDependencyEnvironment(root, bind(request)),
    disposeCanonicalSharedDependencies: (request: RuntimeDependencyInstallRequest = {}, outcome?: string, root = workspaceRoot) => native.disposeCanonicalSharedDependencies(bind(request), outcome, root),
    settleCompilerDependencyGeneratedState: (plan: CompilerDependencyGeneratedStateSettlementPlan, request: RuntimeDependencyInstallRequest = {}) =>
      settleOwnedGeneratedState(plan, request)
  });
}

export async function ensureProjectDependencyOperation(projectRoot:string, options:NonNullable<Parameters<typeof native.ensureProjectDependencies>[1]> & DependencyProjectLifecycleAdmission) {
    const operationOptions = runtimeDependencyOperationOptions(options);
    return ensureProjectDependencyEnvironment({
      installMode: operationOptions.installMode,
      readPreboundTarget: () => native.ensureProjectDependencies(projectRoot, operationOptions),
      readCanonicalPaths: native.observeProjectCanonicalDependencyPaths,
      readRuntimeSpec: native.readProjectDependencyRuntimeSpec,
      observeCompilerReady: () => native.observeProjectCompilerDependencySource(operationOptions),
      ensureCompilerReady: () => native.ensureCompilerDepsReady(operationOptions, compilerRoot),
      readSourceGeneration: (binding, ownerRoot, sourcePath) => native.readProjectDependencySourceGeneration(binding, ownerRoot, sourcePath, operationOptions),
      verifyIsolatedSource: native.verifyIsolatedProjectDependencySource,
      publishTarget: source => {
        const lifecycle = operationOptions.generatedStateLifecycle ?? operationOptions.generatedStateLifecycleFactory?.forWorkspace(projectRoot);
        if (lifecycle === undefined) throw new SecError('IMPORT-AUTHORITY-004', 'Project dependency target operation has no bound producer lifecycle');
        return native.ensureProjectDependencies(projectRoot, runtimeDependencyOperationOptions({ ...operationOptions,
          generatedStateLifecycle: lifecycle }), source);
      }
    });
  }
