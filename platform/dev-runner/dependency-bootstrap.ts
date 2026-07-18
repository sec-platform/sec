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
}

export async function ensureDevDependencies(
  options: DevDependencyBootstrapOptions = {}
): Promise<DevDependencyBootstrapResult> {
  const ready = await (options.ensureCompilerDeps ?? (() => ensureCompilerDepsReady()))();
  return {
    manifestHash: ready.manifestHash,
    nodeModulesPath: ready.nodeModulesPath,
    source: ready.source
  };
}
