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

export interface OperationDependencyBootstrapResult extends DevDependencyBootstrapResult {
  readonly browserCachePath: string | null;
}

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

function dependencyBootstrapResult(ready: CompilerDepsReadyState): DevDependencyBootstrapResult {
  return {
    manifestHash: ready.manifestHash,
    nodeModulesPath: ready.nodeModulesPath,
    source: ready.source
  };
}

function publishOperationDependencyResult(
  demandGraph: SecOperationDemandGraphV1,
  result: OperationDependencyBootstrapResult
): OperationDependencyBootstrapResult {
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
): Promise<OperationDependencyBootstrapResult> {
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
