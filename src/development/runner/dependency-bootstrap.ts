import {
  assertSecOperationDemandGraph,
  type SecOperationDemandGraph
} from '../../control/operation/demand.ts';
import {
  ensureCompilerDepsReady,
  type CompilerDepsReadyState
} from '../../toolchain/dependencies/runtime.ts';

export interface DevDependencyBootstrapResult {
  readonly manifestHash: string;
  readonly nodeModulesPath: string;
  readonly source: 'existing' | 'installed';
}

export interface DependencyTransitionBootstrapResult extends DevDependencyBootstrapResult {
  readonly requiresFreshProcess: boolean;
  readonly transitionDigest: `sha256:${string}`;
}

export interface OperationDependencyBootstrapResult extends DependencyTransitionBootstrapResult {}

export interface MaterializedOperationDependencyBootstrapResult
  extends OperationDependencyBootstrapResult, DependencyTransitionBootstrapResult {}

const materializedOperationDemands = new WeakMap<
  OperationDependencyBootstrapResult,
  SecOperationDemandGraph
>();

interface CompilerDependencyBootstrapOptions {
  readonly ensureCompilerDeps?: () => Promise<CompilerDepsReadyState>;
}

interface OperationDependencyBootstrapOptions extends CompilerDependencyBootstrapOptions {
  readonly ensureHooks?: (repoRoot: string) => Promise<void>;
}

async function ensureManagedHooks(repoRoot: string): Promise<void> {
  if (process.env.CI === 'true' || process.env.CI === '1') return;
  // Hook installation is downstream of compiler dependency readiness. Keeping
  // this import inside the demanded branch prevents the bootstrap entrypoint
  // from loading Git/provider packages before it has materialized them.
  const { installGitHooks } = await import('../hooks/install.ts');
  const result = await installGitHooks({ repoRoot, lifecycle: true });
  if (result.status === 'conflict') console.warn(result.message);
}

function dependencyBootstrapResult(ready: CompilerDepsReadyState): DependencyTransitionBootstrapResult {
  return {
    manifestHash: ready.manifestHash,
    nodeModulesPath: ready.nodeModulesPath,
    requiresFreshProcess: ready.requiresFreshProcess,
    source: ready.source,
    transitionDigest: ready.transitionDigest
  };
}

export const DEV_RUNNER_FRESH_PROCESS_TRANSITION_ENV =
  'SEC_DEV_RUNNER_FRESH_PROCESS_TRANSITION_V1' as const;

export type DependencyFreshProcessHandoff = Readonly<{
  schema: 'sec-dependency-fresh-process-handoff-v1';
  transitionDigest: `sha256:${string}`;
}>;

/**
 * A dependency locator/generation transition invalidates module resolution in
 * the process that observed the old filesystem epoch. The exact transition
 * may hand off once; a child that observes another transition fails closed
 * instead of recursively spawning.
 */
export function createDependencyFreshProcessHandoff(
  result: DependencyTransitionBootstrapResult,
  environment: Readonly<Record<string, string | undefined>> = process.env
): DependencyFreshProcessHandoff | null {
  if (!/^sha256:[0-9a-f]{64}$/u.test(result.transitionDigest)) {
    throw new Error('Dependency bootstrap transition digest is invalid.');
  }
  if (!result.requiresFreshProcess) return null;
  const predecessor = environment[DEV_RUNNER_FRESH_PROCESS_TRANSITION_ENV];
  if (predecessor !== undefined) {
    throw new Error(
      predecessor === result.transitionDigest
        ? 'Dependency bootstrap repeated the same fresh-process transition.'
        : 'Dependency bootstrap attempted more than one fresh-process transition.'
    );
  }
  return Object.freeze({
    schema: 'sec-dependency-fresh-process-handoff-v1' as const,
    transitionDigest: result.transitionDigest
  });
}

function publishOperationDependencyResult(
  demandGraph: SecOperationDemandGraph,
  result: MaterializedOperationDependencyBootstrapResult
): MaterializedOperationDependencyBootstrapResult {
  const published = Object.freeze(result);
  materializedOperationDemands.set(published, demandGraph);
  return published;
}

export function reuseOperationDependencies(
  result: OperationDependencyBootstrapResult,
  demandGraph: SecOperationDemandGraph
): OperationDependencyBootstrapResult {
  assertSecOperationDemandGraph(demandGraph);
  const materializedDemand = materializedOperationDemands.get(result);
  if (materializedDemand === undefined) {
    throw new Error('Operation dependency result was not materialized by this process.');
  }
  if (demandGraph.capabilityDemands.some(
    (capability) => !materializedDemand.capabilityDemands.includes(capability)
  )) {
    throw new Error('Operation dependency result does not cover the requested capability closure.');
  }
  return result;
}

function ensureCanonicalCompilerDependencies(): Promise<CompilerDepsReadyState> {
  return ensureCompilerDepsReady();
}

/**
 * Materializes exactly the capability closure compiled by the canonical
 * operation-demand graph. There is intentionally no test-specific convenience
 * entrypoint: an ambient caller cannot select a dependency effect by function
 * name, installed package, cache presence or environment state.
 */
export async function ensureOperationDependencies(
  demandGraph: SecOperationDemandGraph,
  options: OperationDependencyBootstrapOptions = {}
): Promise<MaterializedOperationDependencyBootstrapResult> {
  assertSecOperationDemandGraph(demandGraph);
  if (!demandGraph.capabilityDemands.includes('compiler-dependency-tree')) {
    throw new Error('Dependency bootstrap requires an operation demand for compiler-dependency-tree.');
  }
  const ready = await (options.ensureCompilerDeps ?? ensureCanonicalCompilerDependencies)();
  if (demandGraph.capabilityDemands.includes('managed-git-hooks')) {
    if (demandGraph.input.operation !== 'dependency-setup') {
      throw new Error('Managed Git hook demand must originate from dependency-setup.');
    }
    if (demandGraph.input.hookPolicy !== 'if-installed' || ready.source === 'installed') {
      await (options.ensureHooks ?? ensureManagedHooks)(ready.root);
    }
  }
  return publishOperationDependencyResult(demandGraph, {
    ...dependencyBootstrapResult(ready)
  });
}
