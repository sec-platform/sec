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

const loadCiArtifacts = memoizedModule(() => import('../compiler/emit/ci-artifacts.ts'));
const loadManifest = memoizedModule(() => import('../compiler/parse/load-manifest.ts'));
const loadPlan = memoizedModule(() => import('../compiler/parse/load-plan.ts'));

const loadBlockOrchestrator = memoizedModule(() => import('../orchestrator/block-orchestrator.ts'));
const loadComposeOrchestrator = memoizedModule(() => import('../orchestrator/compose-orchestrator.ts'));
const loadEmitOrchestrator = memoizedModule(() => import('../orchestrator/emit-orchestrator.ts'));
const loadPipelineOrchestrator = memoizedModule(() => import('../orchestrator/pipeline-orchestrator.ts'));
const loadRepairOrchestrator = memoizedModule(() => import('../orchestrator/repair-orchestrator.ts'));
const loadUpgradeOrchestrator = memoizedModule(() => import('../orchestrator/upgrade-orchestrator.ts'));
const loadVerifyOrchestrator = memoizedModule(() => import('../orchestrator/verify-orchestrator.ts'));
const loadWorkbenchOrchestrator = memoizedModule(() => import('../orchestrator/workbench-orchestrator.ts'));
const loadWorkbenchServer = memoizedModule(() => import('../orchestrator/workbench-server-v2.ts'));
const loadWorkspaceOrchestrator = memoizedModule(() => import('../orchestrator/workspace-orchestrator.ts'));

// Temporary compatibility imports. PR #481 owns the provider-neutral tooling
// cutover; after that line enters main these loaders must point directly at
// tooling/sec-dev/** before the historical Codex adapters can be deleted.
const loadTextByteCensus = memoizedModule(() => import('../../scripts/codex/text-byte-census.ts'));
const loadWorktreeSettlement = memoizedModule(() => import('../../scripts/codex/worktree-settlement.ts'));

export const buildCiArtifactManifest = lazyFunction(loadCiArtifacts, 'buildCiArtifactManifest');
export const loadManifestById = lazyFunction(loadManifest, 'loadManifestById');
export const loadWorkspacePlan = lazyFunction(loadPlan, 'loadWorkspacePlan');

export const addBlock = lazyFunction(loadBlockOrchestrator, 'addBlock');
export const resolveWorkspace = lazyFunction(loadBlockOrchestrator, 'resolveWorkspace');
export const adaptWorkspace = lazyFunction(loadComposeOrchestrator, 'adaptWorkspace');
export const composeWorkspace = lazyFunction(loadComposeOrchestrator, 'composeWorkspace');
export const explainWorkspace = lazyFunction(loadEmitOrchestrator, 'explainWorkspace');
export const lockWorkspace = lazyFunction(loadEmitOrchestrator, 'lockWorkspace');
export const writeWorkspaceArtifacts = lazyFunction(loadEmitOrchestrator, 'writeWorkspaceArtifacts');
export const compileWorkspace = lazyFunction(loadPipelineOrchestrator, 'compileWorkspace');
export const repairWorkspace = lazyFunction(loadRepairOrchestrator, 'repairWorkspace');
export const upgradeWorkspace = lazyFunction(loadUpgradeOrchestrator, 'upgradeWorkspace');
export const verifyWorkspace = lazyFunction(loadVerifyOrchestrator, 'verifyWorkspace');
export const applyWorkbenchMutations = lazyFunction(loadWorkbenchOrchestrator, 'applyWorkbenchMutations');
export const startWorkbenchServer = lazyFunction(loadWorkbenchServer, 'startWorkbenchServer');
export const initWorkspace = lazyFunction(loadWorkspaceOrchestrator, 'initWorkspace');

export const runCensus = lazyFunction(loadTextByteCensus, 'runCensus');
export const runSettlement = lazyFunction(loadWorktreeSettlement, 'runSettlement');
