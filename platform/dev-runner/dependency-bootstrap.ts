import { installGitHooks } from '../../scripts/install-git-hooks.ts';
import {
  assertSecOperationDemandGraphV1,
  type SecOperationDemandGraphV1
} from '../shared/operation-demand-contract.ts';
import {
  ensureCompilerDepsReady,
  ensurePlaywrightBrowserCacheReady,
  type CompilerDepsReadyState,
  type PlaywrightBrowserCacheReadyState
} from '../shared/project-runtime.ts';

export interface DevDependencyBootstrapResult {
  readonly manifestHash: string;
  readonly nodeModulesPath: string;
  readonly source: 'existing' | 'installed';
}

export interface DependencyTransitionBootstrapResultV1 extends DevDependencyBootstrapResult {
  readonly requiresFreshProcess: boolean;
  readonly transitionDigest: `sha256:${string}`;
}

export interface OperationDependencyBootstrapResult extends DevDependencyBootstrapResult {
  readonly browserCachePath: string | null;
}

export interface MaterializedOperationDependencyBootstrapResultV1
  extends OperationDependencyBootstrapResult, DependencyTransitionBootstrapResultV1 {}

const materializedOperationDemands = new WeakMap<
  OperationDependencyBootstrapResult,
  SecOperationDemandGraphV1
>();

interface CompilerDependencyBootstrapOptions {
  readonly ensureCompilerDeps?: () => Promise<CompilerDepsReadyState>;
}

interface OperationDependencyBootstrapOptions extends CompilerDependencyBootstrapOptions {
  readonly ensureBrowserCache?: (dependencyRoot: string) => Promise<PlaywrightBrowserCacheReadyState>;
  readonly ensureHooks?: (repoRoot: string) => Promise<void>;
}

async function ensureManagedHooks(repoRoot: string): Promise<void> {
  if (process.env.CI === 'true' || process.env.CI === '1') return;
  const result = await installGitHooks({ repoRoot, lifecycle: true });
  if (result.status === 'conflict') console.warn(result.message);
}

function dependencyBootstrapResult(ready: CompilerDepsReadyState): DependencyTransitionBootstrapResultV1 {
  return {
    manifestHash: ready.manifestHash,
    nodeModulesPath: ready.nodeModulesPath,
    requiresFreshProcess: ready.requiresFreshProcess,
    source: ready.source,
    transitionDigest: ready.transitionDigest
  };
}

export const DEV_RUNNER_FRESH_PROCESS_TRANSITION_ENV_V1 =
  'SEC_DEV_RUNNER_FRESH_PROCESS_TRANSITION_V1' as const;

export type DependencyFreshProcessHandoffV1 = Readonly<{
  schema: 'sec-dependency-fresh-process-handoff-v1';
  transitionDigest: `sha256:${string}`;
}>;

/**
 * A dependency locator/generation transition invalidates module resolution in
 * the process that observed the old filesystem epoch. The exact transition
 * may hand off once; a child that observes another transition fails closed
 * instead of recursively spawning.
 */
export function createDependencyFreshProcessHandoffV1(
  result: DependencyTransitionBootstrapResultV1,
  environment: Readonly<Record<string, string | undefined>> = process.env
): DependencyFreshProcessHandoffV1 | null {
  if (!/^sha256:[0-9a-f]{64}$/u.test(result.transitionDigest)) {
    throw new Error('Dependency bootstrap transition digest is invalid.');
  }
  if (!result.requiresFreshProcess) return null;
  const predecessor = environment[DEV_RUNNER_FRESH_PROCESS_TRANSITION_ENV_V1];
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
  demandGraph: SecOperationDemandGraphV1,
  result: MaterializedOperationDependencyBootstrapResultV1
): MaterializedOperationDependencyBootstrapResultV1 {
  const published = Object.freeze(result);
  materializedOperationDemands.set(published, demandGraph);
  return published;
}

export function reuseOperationDependenciesV1(
  result: OperationDependencyBootstrapResult,
  demandGraph: SecOperationDemandGraphV1
): OperationDependencyBootstrapResult {
  assertSecOperationDemandGraphV1(demandGraph);
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
 * operation-demand graph. There is intentionally no fast/browser convenience
 * entrypoint: an ambient caller cannot select a dependency effect by function
 * name, installed package, cache presence or environment state.
 */
export async function ensureOperationDependencies(
  demandGraph: SecOperationDemandGraphV1,
  options: OperationDependencyBootstrapOptions = {}
): Promise<MaterializedOperationDependencyBootstrapResultV1> {
  assertSecOperationDemandGraphV1(demandGraph);
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
  if (!demandGraph.capabilityDemands.includes('browser-runtime')) {
    return publishOperationDependencyResult(demandGraph, {
      ...dependencyBootstrapResult(ready),
      browserCachePath: null
    });
  }
  const browser = await (options.ensureBrowserCache ?? ((dependencyRoot) =>
    ensurePlaywrightBrowserCacheReady({}, dependencyRoot)))(ready.root);
  return publishOperationDependencyResult(demandGraph, {
    ...dependencyBootstrapResult(ready),
    browserCachePath: browser.browserCachePath
  });
}
