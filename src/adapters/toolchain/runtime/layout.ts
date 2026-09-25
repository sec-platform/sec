import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POLICY_SOURCE_PATHS } from '../../../workspace/contract/policy-source-paths.ts';

import { FailureError } from '../../../contracts/failure.ts';
import { isCanonicalPortableLogicalPath } from '../../../contracts/logical-path.ts';

export const SOURCE_RUNTIME_MODULE_RELATIVE_PATH = path.join(
  'src',
  'adapters',
  'toolchain',
  'runtime',
  'layout.ts'
);
export const PACKAGE_SOURCE_LAUNCHER_RELATIVE_PATH = path.join(
  'src',
  'adapters',
  'toolchain',
  'runtime',
  'package-source-launcher.ts'
);
export const PACKAGE_SOURCE_LAUNCHER_SCRIPT =
  `\"$npm_execpath\" ./${PACKAGE_SOURCE_LAUNCHER_RELATIVE_PATH.replaceAll('\\', '/')}`;
export function packageArtifactLauncherScript(artifactRelativePath: string): string {
  const artifact = entrypointRelativePath(`./${artifactRelativePath}`, 'artifact launcher');
  return `\"$npm_execpath\" ./${artifact}`;
}
export const COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS = Object.freeze({
  composeTemplates: path.join('src', 'adapters', 'compilation', 'compose', 'templates'),
  officialPolicies: path.join(...POLICY_SOURCE_PATHS.official.split('/')),
  officialRegistry: path.join('catalog', 'registry', 'official')
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

export interface CompilerPackageEntrypointBinding {
  readonly artifact: string;
  readonly command: string;
  readonly source: string | null;
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

function runtimeLayoutError(message: string, details: Record<string, unknown> = {}): never {
  throw new FailureError('RUNTIME-LAYOUT-001', message, details);
}

function entrypointRelativePath(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.startsWith('./')) {
    return runtimeLayoutError(`SEC package ${field} must be one explicit package-relative path`);
  }
  const relativePath = value.slice(2).replaceAll('\\', '/');
  if (!isCanonicalPortableLogicalPath(relativePath)) {
    return runtimeLayoutError(`SEC package ${field} is not one canonical relative path`, { value });
  }
  return relativePath;
}

export function parseCompilerPackageEntrypointBinding(
  input: unknown
): Readonly<CompilerPackageEntrypointBinding> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return runtimeLayoutError('SEC package manifest must be one JSON object');
  }
  const manifest = input as Record<string, unknown>;
  if (typeof manifest.bin !== 'object' || manifest.bin === null || Array.isArray(manifest.bin)) {
    return runtimeLayoutError('SEC package bin must be one command mapping');
  }
  const binEntries = Object.entries(manifest.bin as Record<string, unknown>);
  if (binEntries.length !== 1 || typeof binEntries[0]?.[0] !== 'string') {
    return runtimeLayoutError('SEC package must expose exactly one executable command');
  }
  const [command, rawArtifact] = binEntries[0]!;
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(command)) {
    return runtimeLayoutError('SEC package command is not canonical', { command });
  }
  const artifact = entrypointRelativePath(rawArtifact, `bin.${command}`);
  if (path.posix.dirname(artifact) === '.') {
    return runtimeLayoutError(`SEC package bin.${command} must be published inside one artifact root`);
  }
  const source = manifest.source === undefined
    ? null
    : entrypointRelativePath(manifest.source, 'source');
  const expectedScript = source === null
    ? packageArtifactLauncherScript(artifact)
    : PACKAGE_SOURCE_LAUNCHER_SCRIPT;
  if (typeof manifest.scripts !== 'object'
    || manifest.scripts === null
    || Array.isArray(manifest.scripts)
    || (manifest.scripts as Record<string, unknown>)[command] !== expectedScript) {
    return runtimeLayoutError(
      `SEC package script ${command} must use the exact launcher for its package form`
    );
  }
  return Object.freeze({ artifact, command, source });
}

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

/**
 * Resolves the CLI that belongs to the already-loaded SEC runtime. Callers
 * must execute this absolute entrypoint directly instead of using `bun run`
 * package-script discovery, which can walk into an unrelated parent package
 * and silently change the workspace being operated on.
 */
export function resolveCompilerCliEntrypoint(
  layout: Pick<CompilerRuntimeLayout, 'cliEntrypointPath'>
): string {
  return layout.cliEntrypointPath;
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
      const sourceRuntimeModulePath = path.join(candidateRoot, SOURCE_RUNTIME_MODULE_RELATIVE_PATH);
      const artifactEntrypointPath = path.join(
        candidateRoot,
        ...binding.artifact.split('/')
      );
      if (equalPath(executableModulePath, sourceRuntimeModulePath)) {
        if (binding.source === null) {
          return runtimeLayoutError('SEC source runtime requires one explicit source entrypoint');
        }
        return freezeLayout({
          artifactEntrypointRelativePath: binding.artifact,
          artifactRoot: path.join(candidateRoot, path.posix.dirname(binding.artifact)),
          cliEntrypointPath: path.join(candidateRoot, ...binding.source.split('/')),
          command: binding.command,
          dependencyRoot: candidateRoot,
          executableModulePath,
          mode: 'source',
          packageRoot: candidateRoot,
          repositorySourceRoot: candidateRoot,
          runtimeAssetRoot: candidateRoot,
          sourceEntrypointRelativePath: binding.source
        });
      }
      if (equalPath(executableModulePath, artifactEntrypointPath)) {
        return freezeLayout({
          artifactEntrypointRelativePath: binding.artifact,
          artifactRoot: path.join(candidateRoot, path.posix.dirname(binding.artifact)),
          cliEntrypointPath: artifactEntrypointPath,
          command: binding.command,
          dependencyRoot: candidateRoot,
          executableModulePath,
          mode: 'bundle',
          packageRoot: candidateRoot,
          repositorySourceRoot: null,
          runtimeAssetRoot: path.join(candidateRoot, path.posix.dirname(binding.artifact)),
          sourceEntrypointRelativePath: binding.source
        });
      }
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
export const compilerCliEntrypoint = resolveCompilerCliEntrypoint(compilerRuntimeLayout);
export const compilerRuntimeResources = resolveCompilerRuntimeResources(compilerRuntimeLayout);
