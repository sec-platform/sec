import { installGitHooks } from '../../scripts/install-git-hooks.ts';

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

export interface TestDependencyBootstrapResult extends DevDependencyBootstrapResult {
  readonly browserCachePath: string;
}

interface CompilerDependencyBootstrapOptions {
  readonly ensureCompilerDeps?: () => Promise<CompilerDepsReadyState>;
}

interface DevDependencyBootstrapOptions extends CompilerDependencyBootstrapOptions {
  readonly ensureHooks?: (repoRoot: string) => Promise<void>;
  readonly hookPolicy?: 'always' | 'if-installed' | 'never';
}

interface TestDependencyBootstrapOptions extends CompilerDependencyBootstrapOptions {
  readonly ensureBrowserCache?: (dependencyRoot: string) => Promise<PlaywrightBrowserCacheReadyState>;
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

export async function ensureDevDependencies(
  options: DevDependencyBootstrapOptions = {}
): Promise<DevDependencyBootstrapResult> {
  const ready = await (options.ensureCompilerDeps ?? (() => ensureCompilerDepsReady()))();
  if (options.hookPolicy !== 'never'
    && (options.hookPolicy !== 'if-installed' || ready.source === 'installed')) {
    await (options.ensureHooks ?? ensureManagedHooks)(ready.root);
  }
  return dependencyBootstrapResult(ready);
}

/**
 * Fast/affected tests are contract and unit closures. They need the exact compiler
 * dependency tree but must not materialize the conditional browser capability or
 * mutate the managed hook lifecycle.
 */
export async function ensureFastTestDependencies(
  options: CompilerDependencyBootstrapOptions = {}
): Promise<DevDependencyBootstrapResult> {
  return dependencyBootstrapResult(
    await (options.ensureCompilerDeps ?? (() => ensureCompilerDepsReady()))()
  );
}

export async function ensureTestDependencies(
  options: TestDependencyBootstrapOptions = {}
): Promise<TestDependencyBootstrapResult> {
  const ready = await (options.ensureCompilerDeps ?? (() => ensureCompilerDepsReady()))();
  const browser = await (options.ensureBrowserCache ?? ((dependencyRoot) =>
    ensurePlaywrightBrowserCacheReady({}, dependencyRoot)))(ready.root);
  return {
    ...dependencyBootstrapResult(ready),
    browserCachePath: browser.browserCachePath
  };
}
