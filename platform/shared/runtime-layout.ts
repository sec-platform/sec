import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CompilerError } from './errors.ts';

export const SOURCE_RUNTIME_MODULE_RELATIVE_PATH = path.join(
  'platform',
  'shared',
  'runtime-layout.ts'
);
export const RELEASE_ENTRYPOINT_RELATIVE_PATH = path.join('dist', 'index.js');
export const RELEASE_RUNTIME_ASSET_ROOT_RELATIVE_PATH = 'dist';
export const COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS = Object.freeze({
  composeTemplates: path.join('platform', 'compiler', 'compose', 'templates'),
  localViewTemplates: path.join('platform', 'compiler', 'emit', 'templates'),
  officialPolicies: path.join('platform', 'policies', 'official'),
  officialRegistry: path.join('platform', 'registry', 'official')
});

export interface CompilerRuntimeLayout {
  readonly dependencyRoot: string;
  readonly executableModulePath: string;
  readonly mode: 'bundle' | 'source';
  readonly packageRoot: string;
  readonly repositorySourceRoot: string | null;
  readonly runtimeAssetRoot: string;
}

export type CompilerRuntimeResourceName =
  keyof typeof COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS;
export type CompilerRuntimeResourceMap<Value> = Readonly<
  Record<CompilerRuntimeResourceName, Value>
>;
export type CompilerRuntimeResources = CompilerRuntimeResourceMap<string>;

function mapCompilerRuntimeResourcePaths<Value>(
  mapper: (relativePath: string, name: CompilerRuntimeResourceName) => Value
): CompilerRuntimeResourceMap<Value> {
  const entries = Object.entries(COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS) as [
    CompilerRuntimeResourceName,
    string
  ][];
  return Object.freeze(Object.fromEntries(entries.map(([name, relativePath]) => [
    name,
    mapper(relativePath, name)
  ]))) as CompilerRuntimeResourceMap<Value>;
}

export const COMPILER_RUNTIME_RESOURCE_POSIX_PATHS = mapCompilerRuntimeResourcePaths(
  (relativePath) => relativePath.replaceAll('\\', '/')
);

function runtimeLayoutError(message: string, details: Record<string, unknown> = {}): never {
  throw new CompilerError('RUNTIME-LAYOUT-001', message, details);
}

function equalPath(left: string, right: string): boolean {
  const normalizedLeft = path.normalize(left);
  const normalizedRight = path.normalize(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function freezeLayout(layout: CompilerRuntimeLayout): Readonly<CompilerRuntimeLayout> {
  return Object.freeze(layout);
}

export function resolveCompilerRuntimeResources(
  layout: Pick<CompilerRuntimeLayout, 'runtimeAssetRoot'>
): Readonly<CompilerRuntimeResources> {
  return mapCompilerRuntimeResourcePaths(
    (relativePath) => path.join(layout.runtimeAssetRoot, relativePath)
  );
}

export function resolveCompilerRuntimeLayout(
  executableModuleUrl: string
): Readonly<CompilerRuntimeLayout> {
  let url: URL;
  try {
    url = new URL(executableModuleUrl);
  } catch {
    return runtimeLayoutError('SEC runtime module location must be a valid file URL', {
      executableModuleUrl
    });
  }
  if (url.protocol !== 'file:') {
    return runtimeLayoutError('SEC runtime module location must use a file URL', {
      executableModuleUrl
    });
  }

  const executableModulePath = path.normalize(fileURLToPath(url));
  const sourcePackageRoot = path.resolve(path.dirname(executableModulePath), '../..');
  if (equalPath(
    executableModulePath,
    path.join(sourcePackageRoot, SOURCE_RUNTIME_MODULE_RELATIVE_PATH)
  )) {
    return freezeLayout({
      dependencyRoot: sourcePackageRoot,
      executableModulePath,
      mode: 'source',
      packageRoot: sourcePackageRoot,
      repositorySourceRoot: sourcePackageRoot,
      runtimeAssetRoot: sourcePackageRoot
    });
  }

  const bundlePackageRoot = path.resolve(path.dirname(executableModulePath), '..');
  if (equalPath(
    executableModulePath,
    path.join(bundlePackageRoot, RELEASE_ENTRYPOINT_RELATIVE_PATH)
  )) {
    return freezeLayout({
      dependencyRoot: bundlePackageRoot,
      executableModulePath,
      mode: 'bundle',
      packageRoot: bundlePackageRoot,
      repositorySourceRoot: null,
      runtimeAssetRoot: path.join(
        bundlePackageRoot,
        RELEASE_RUNTIME_ASSET_ROOT_RELATIVE_PATH
      )
    });
  }

  return runtimeLayoutError('Unsupported SEC runtime module layout', {
    executableModulePath
  });
}

export const compilerRuntimeLayout = resolveCompilerRuntimeLayout(import.meta.url);
export const compilerRuntimeResources = resolveCompilerRuntimeResources(compilerRuntimeLayout);
