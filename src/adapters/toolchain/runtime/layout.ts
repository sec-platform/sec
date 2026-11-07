import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POLICY_SOURCE_PATHS } from '../../../workspace/contract/policy-source-paths.ts';

import { BUILTIN_OFFICIAL_REGISTRY_RELATIVE_PATH } from '../../../contracts/registry-source.ts';
import {
  type CompilerPackageEntrypointBinding,
  parseCompilerPackageEntrypointBinding,
  runtimeLayoutError,
  selectCompilerPackageModuleLayout
} from './package-entrypoint.ts';

export {
  PACKAGE_SOURCE_IMPORT,
  PACKAGE_SOURCE_LAUNCHER_RELATIVE_PATH,
  PACKAGE_SOURCE_LAUNCHER_SCRIPT,
  packageArtifactLauncherScript,
  parseCompilerPackageEntrypointBinding,
  SOURCE_RUNTIME_MODULE_RELATIVE_PATH, type CompilerPackageEntrypointBinding
} from './package-entrypoint.ts';
export const COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS = Object.freeze({
  composeTemplates: path.join('src', 'adapters', 'compilation', 'compose', 'templates'),
  officialPolicies: path.join(...POLICY_SOURCE_PATHS.official.split('/')),
  officialRegistry: path.join(...BUILTIN_OFFICIAL_REGISTRY_RELATIVE_PATH.split('/'))
});

export interface CompilerRuntimeLayout {
  readonly artifactEntrypointRelativePath: string;
  readonly artifactRoot: string;
  readonly cliEntrypointPath: string;
  readonly command: string;
  readonly dependencyRoot: string;
  readonly executableModulePath: string;
  readonly mode: 'bundle' | 'source';
  readonly packageRoot: string;
  readonly repositorySourceRoot: string | null;
  readonly runtimeAssetRoot: string;
  readonly sourceEntrypointRelativePath: string | null;
}

type CompilerRuntimeResourceName =
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

function readCompilerPackageEntrypointBinding(
  packageRoot: string
): Readonly<CompilerPackageEntrypointBinding> | null {
  const manifestPath = path.join(packageRoot, 'package.json');
  if (!existsSync(manifestPath)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return runtimeLayoutError('SEC package manifest is not readable canonical JSON', {
      manifestPath,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  return parseCompilerPackageEntrypointBinding(parsed);
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
  let candidateRoot = path.dirname(executableModulePath);
  while (true) {
    const binding = readCompilerPackageEntrypointBinding(candidateRoot);
    if (binding !== null) {
      const selected = selectCompilerPackageModuleLayout(
        binding,
        path.relative(candidateRoot, executableModulePath),
        process.platform === 'win32' ? 'insensitive' : 'sensitive'
      );
      if (selected !== null) {
        const artifactRoot = path.join(candidateRoot, selected.artifactRootRelativePath);
        return Object.freeze({
          artifactEntrypointRelativePath: binding.artifact,
          artifactRoot,
          cliEntrypointPath: path.join(candidateRoot, ...selected.cliEntrypointRelativePath.split('/')),
          command: binding.command,
          dependencyRoot: candidateRoot,
          executableModulePath,
          mode: selected.mode,
          packageRoot: candidateRoot,
          repositorySourceRoot: selected.mode === 'source' ? candidateRoot : null,
          runtimeAssetRoot: selected.mode === 'source' ? candidateRoot : artifactRoot,
          sourceEntrypointRelativePath: binding.source
        });
      }
      // The nearest package manifest owns this module's layout.  An unrelated
      // ancestor package must not reinterpret a module outside its entrypoints.
      return runtimeLayoutError('Unsupported SEC runtime module layout', {
        executableModulePath,
        packageRoot: candidateRoot
      });
    }
    const parent = path.dirname(candidateRoot);
    if (parent === candidateRoot) break;
    candidateRoot = parent;
  }

  return runtimeLayoutError('Unsupported SEC runtime module layout', {
    executableModulePath
  });
}

export const compilerRuntimeLayout = resolveCompilerRuntimeLayout(import.meta.url);
/**
 * Resolves the CLI that belongs to the already-loaded SEC runtime. Callers
 * must execute this absolute entrypoint directly instead of using `bun run`
 * package-script discovery, which can walk into an unrelated parent package
 * and silently change the workspace being operated on.
 */
export const compilerCliEntrypoint = compilerRuntimeLayout.cliEntrypointPath;
export const compilerRuntimeResources = resolveCompilerRuntimeResources(compilerRuntimeLayout);
