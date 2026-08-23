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
  readonly requiresProcessRelaunch: boolean;
  readonly root: string;
  readonly source: 'existing' | 'installed';
}

export interface BrowserTestDependencyBootstrapResult extends DevDependencyBootstrapResult {
  readonly browserCachePath: string;
}

interface CompilerDependencyBootstrapOptions {
  readonly ensureCompilerDeps?: () => Promise<CompilerDepsReadyState>;
}

interface DevDependencyBootstrapOptions extends CompilerDependencyBootstrapOptions {
  readonly ensureHooks?: (repoRoot: string) => Promise<void>;
  readonly hookPolicy?: 'always' | 'if-installed' | 'never';
}

interface BrowserTestDependencyBootstrapOptions extends CompilerDependencyBootstrapOptions {
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
    requiresProcessRelaunch: ready.requiresProcessRelaunch,
    root: ready.root,
    source: ready.source
  };
}

function ensureCanonicalCompilerDependencies(): Promise<CompilerDepsReadyState> {
  return ensureCompilerDepsReady();
}

export async function ensureDevDependencies(
  options: DevDependencyBootstrapOptions = {}
): Promise<DevDependencyBootstrapResult> {
  const ready = await (options.ensureCompilerDeps ?? ensureCanonicalCompilerDependencies)();
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
    await (options.ensureCompilerDeps ?? ensureCanonicalCompilerDependencies)()
  );
}

/**
 * Materializes the optional browser capability. The explicit name is part of
 * the demand boundary: Core/CLI/unit callers cannot accidentally pay for
 * Playwright by asking for generic "test dependencies".
 */
export async function ensureBrowserTestDependencies(
  options: BrowserTestDependencyBootstrapOptions = {}
): Promise<BrowserTestDependencyBootstrapResult> {
  const ready = await (options.ensureCompilerDeps ?? ensureCanonicalCompilerDependencies)();
  const browser = await (options.ensureBrowserCache ?? ((dependencyRoot) =>
    ensurePlaywrightBrowserCacheReady({}, dependencyRoot)))(ready.root);
  return {
    ...dependencyBootstrapResult(ready),
    browserCachePath: browser.browserCachePath
  };
}
