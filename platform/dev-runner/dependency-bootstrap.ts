import { installGitHooks } from '../../scripts/install-git-hooks.ts';
import {
  ensureCompilerDepsReady,
  type CompilerDepsReadyState
} from '../shared/project-runtime.ts';

export interface DevDependencyBootstrapResult {
  readonly manifestHash: string;
  readonly nodeModulesPath: string;
  readonly source: 'existing' | 'installed';
}

interface DevDependencyBootstrapOptions {
  readonly ensureCompilerDeps?: () => Promise<CompilerDepsReadyState>;
  readonly ensureHooks?: (repoRoot: string) => Promise<void>;
}

async function ensureManagedHooks(repoRoot: string): Promise<void> {
  if (process.env.CI === 'true' || process.env.CI === '1') return;
  const result = await installGitHooks({ repoRoot, lifecycle: true });
  if (result.status === 'conflict') console.warn(result.message);
}

export async function ensureDevDependencies(
  options: DevDependencyBootstrapOptions = {}
): Promise<DevDependencyBootstrapResult> {
  const ready = await (options.ensureCompilerDeps ?? (() => ensureCompilerDepsReady()))();
  await (options.ensureHooks ?? ensureManagedHooks)(ready.root);
  return {
    manifestHash: ready.manifestHash,
    nodeModulesPath: ready.nodeModulesPath,
    source: ready.source
  };
}
