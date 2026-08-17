type AnyFunction = (...args: never[]) => unknown;
type LazyFacade<Fn extends AnyFunction> = (
  ...args: Parameters<Fn>
) => Promise<Awaited<ReturnType<Fn>>>;
type FunctionKey<Module extends object> = {
  [Key in keyof Module]: Module[Key] extends AnyFunction ? Key : never
}[keyof Module];

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
    return Reflect.apply(fn, module, args) as ReturnType<Fn>;
  })) as LazyFacade<Fn>;
}

type CompilerModule = typeof import('../compiler/index.ts');
type OrchestratorModule = typeof import('../orchestrator.ts');
type TextByteCensusModule = typeof import('../../scripts/codex/text-byte-census.ts');
type WorktreeSettlementModule = typeof import('../../scripts/codex/worktree-settlement.ts');

let compilerModulePromise: Promise<CompilerModule> | undefined;
let orchestratorModulePromise: Promise<OrchestratorModule> | undefined;
let textByteCensusModulePromise: Promise<TextByteCensusModule> | undefined;
let worktreeSettlementModulePromise: Promise<WorktreeSettlementModule> | undefined;

function loadCompilerDomain(): Promise<CompilerModule> {
  compilerModulePromise ??= import('../compiler/index.ts');
  return compilerModulePromise;
}

function loadOrchestratorDomain(): Promise<OrchestratorModule> {
  orchestratorModulePromise ??= import('../orchestrator.ts');
  return orchestratorModulePromise;
}

function loadTextByteCensusDomain(): Promise<TextByteCensusModule> {
  textByteCensusModulePromise ??= import('../../scripts/codex/text-byte-census.ts');
  return textByteCensusModulePromise;
}

function loadWorktreeSettlementDomain(): Promise<WorktreeSettlementModule> {
  worktreeSettlementModulePromise ??= import('../../scripts/codex/worktree-settlement.ts');
  return worktreeSettlementModulePromise;
}

export const buildCiArtifactManifest = lazyFunction(loadCompilerDomain, 'buildCiArtifactManifest');
export const loadManifestById = lazyFunction(loadCompilerDomain, 'loadManifestById');
export const loadWorkspacePlan = lazyFunction(loadCompilerDomain, 'loadWorkspacePlan');

export const adaptWorkspace = lazyFunction(loadOrchestratorDomain, 'adaptWorkspace');
export const addBlock = lazyFunction(loadOrchestratorDomain, 'addBlock');
export const applyWorkbenchMutations = lazyFunction(loadOrchestratorDomain, 'applyWorkbenchMutations');
export const composeWorkspace = lazyFunction(loadOrchestratorDomain, 'composeWorkspace');
export const explainWorkspace = lazyFunction(loadOrchestratorDomain, 'explainWorkspace');
export const initWorkspace = lazyFunction(loadOrchestratorDomain, 'initWorkspace');
export const lockWorkspace = lazyFunction(loadOrchestratorDomain, 'lockWorkspace');
export const repairWorkspace = lazyFunction(loadOrchestratorDomain, 'repairWorkspace');
export const resolveWorkspace = lazyFunction(loadOrchestratorDomain, 'resolveWorkspace');
export const startWorkbenchServer = lazyFunction(loadOrchestratorDomain, 'startWorkbenchServer');
export const upgradeWorkspace = lazyFunction(loadOrchestratorDomain, 'upgradeWorkspace');
export const verifyWorkspace = lazyFunction(loadOrchestratorDomain, 'verifyWorkspace');
export const writeWorkspaceArtifacts = lazyFunction(loadOrchestratorDomain, 'writeWorkspaceArtifacts');

export const runCensus = lazyFunction(loadTextByteCensusDomain, 'runCensus');
export const runSettlement = lazyFunction(loadWorktreeSettlementDomain, 'runSettlement');
