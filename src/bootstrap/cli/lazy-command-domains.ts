type AnyFunction = (...args: never[]) => unknown;
type LazyFacade<Fn extends AnyFunction> = (
  ...args: Parameters<Fn>
) => Promise<Awaited<ReturnType<Fn>>>;
type FunctionKey<Module extends object> = {
  [Key in keyof Module]: Module[Key] extends AnyFunction ? Key : never
}[keyof Module];

function memoizedModule<Module extends object>(
  load: () => Promise<Module>
): () => Promise<Module> {
  let pending: Promise<Module> | undefined;
  return () => {
    pending ??= load();
    return pending;
  };
}

function lazyFunction<Module extends object, Key extends FunctionKey<Module>>(
  load: () => Promise<Module>,
  key: Key
): LazyFacade<Extract<Module[Key], AnyFunction>> {
  type Fn = Extract<Module[Key], AnyFunction>;
  return ((...args: Parameters<Fn>) => load().then((module) => {
    const fn = module[key];
    if (typeof fn !== 'function') {
      throw new Error(`Lazy CLI domain export ${String(key)} is not callable`);
    }
    return Reflect.apply(fn, undefined, args) as ReturnType<Fn>;
  })) as LazyFacade<Fn>;
}

const loadBlockOrchestrator = memoizedModule(() => import('../engineering/block-orchestrator.ts'));
const loadComposeOrchestrator = memoizedModule(() => import('../engineering/compose-orchestrator.ts'));
const loadEmitOrchestrator = memoizedModule(() => import('../engineering/emit-orchestrator.ts'));
const loadRepairOrchestrator = memoizedModule(() => import('../engineering/repair-orchestrator.ts'));
const loadUpgradeOrchestrator = memoizedModule(() => import('../upgrade/orchestration.ts'));
const loadVerifyOrchestrator = memoizedModule(() => import('../engineering/verify-orchestrator.ts'));
const loadWorkspaceOrchestrator = memoizedModule(() => import('../engineering/workspace-orchestrator.ts'));
const loadLocalContainerEngineReadiness = memoizedModule(
  () => import('../../adapters/providers/docker/runtime/readiness.ts')
);

// These modules mix command-owned observation/effects with synchronous formatting.
// Expose the memoized module boundary rather than converting their synchronous
// projection helpers into Promise-returning public facades.
export const loadDependencyEnvironmentDomain = memoizedModule(() => import('../../adapters/toolchain/dependencies/environment.ts'));
export const loadProjectOverviewDomain = memoizedModule(() => import('./project-overview.ts'));
export const loadReferenceCheckDomain = memoizedModule(() => import('../reference/check.ts'));
export const loadTestBudgetDomain = memoizedModule(() => import('../../adapters/verification/platform/test-impact/contract/budget.ts'));

// Provider-neutral SEC development tooling is the canonical execution owner;
// the CLI exposes only lazy facades and does not route through provider adapters.
const loadTextByteCensus = memoizedModule(() => import('../../adapters/self-hosting/development/tooling/text/text-byte-census.ts'));
const loadWorktreeSettlement = memoizedModule(() => import('../../adapters/self-hosting/development/tooling/workspace/worktree-settlement.ts'));

export const addBlock = lazyFunction(loadBlockOrchestrator, 'addBlock');
export const resolveWorkspace = lazyFunction(loadBlockOrchestrator, 'resolveWorkspace');
export const composeWorkspace = lazyFunction(loadComposeOrchestrator, 'composeWorkspace');
export const explainWorkspace = lazyFunction(loadEmitOrchestrator, 'explainWorkspace');
export const lockWorkspace = lazyFunction(loadEmitOrchestrator, 'lockWorkspace');
export const observeWorkspaceArtifacts = lazyFunction(loadEmitOrchestrator, 'observeWorkspaceArtifacts');
export const writeWorkspaceArtifacts = lazyFunction(loadEmitOrchestrator, 'writeWorkspaceArtifacts');
export const repairWorkspace = lazyFunction(loadRepairOrchestrator, 'repairWorkspace');
export const upgradeWorkspace = lazyFunction(loadUpgradeOrchestrator, 'upgradeWorkspace');
export const verifyWorkspace = lazyFunction(loadVerifyOrchestrator, 'verifyWorkspace');
export const initWorkspace = lazyFunction(loadWorkspaceOrchestrator, 'initWorkspace');
export const observeLocalContainerEngineReadiness = lazyFunction(
  loadLocalContainerEngineReadiness,
  'observeLocalContainerEngineReadiness'
);

export const runCensus = lazyFunction(loadTextByteCensus, 'runCensus');
export const runSettlement = lazyFunction(loadWorktreeSettlement, 'runSettlement');
