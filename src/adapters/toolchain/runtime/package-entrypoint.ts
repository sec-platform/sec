import path from 'node:path';

import { CodedFailure } from '../../../contracts/failure.ts';
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
export const PACKAGE_SOURCE_IMPORT = '#gift/cli';

export interface CompilerPackageEntrypointBinding {
  readonly artifact: string;
  readonly command: string;
  readonly source: string | null;
}

export interface CompilerPackageModuleLayout {
  readonly mode: 'bundle' | 'source';
  readonly cliEntrypointRelativePath: string;
  readonly artifactRootRelativePath: string;
}

export function runtimeLayoutError(
  message: string,
  details: Record<string, unknown> = {}
): never {
  throw new CodedFailure('RUNTIME-LAYOUT-001', message, details);
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

export function packageArtifactLauncherScript(artifactRelativePath: string): string {
  const artifact = entrypointRelativePath(`./${artifactRelativePath}`, 'artifact launcher');
  return `\"$npm_execpath\" ./${artifact}`;
}

/** Interprets only the supplied package declaration. Importing this owner does
 * not read a host package or initialize the current process's runtime layout. */
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
  if (Object.hasOwn(manifest, 'source')) {
    return runtimeLayoutError('SEC package source field is retired; declare imports["#gift/cli"]');
  }
  if (manifest.imports !== undefined && (typeof manifest.imports !== 'object'
    || manifest.imports === null || Array.isArray(manifest.imports))) {
    return runtimeLayoutError('SEC package imports must be one mapping');
  }
  const rawSource = (manifest.imports as Record<string, unknown> | undefined)?.[PACKAGE_SOURCE_IMPORT];
  const source = rawSource === undefined
    ? null
    : entrypointRelativePath(rawSource, `imports["${PACKAGE_SOURCE_IMPORT}"]`);
  if (typeof rawSource === 'string' && (/[\\%?#*]/u.test(rawSource)
    || source?.split('/').includes('node_modules'))) {
    return runtimeLayoutError('SEC package source import must be one direct portable file address');
  }
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

/** The caller supplies the observed nearest package and module coordinate.
 * This decision neither searches ancestors nor proves target membership. */
export function selectCompilerPackageModuleLayout(
  binding: Readonly<CompilerPackageEntrypointBinding>,
  executableModuleRelativePath: string,
  pathCaseMode: 'sensitive' | 'insensitive'
): Readonly<CompilerPackageModuleLayout> | null {
  const modulePath = executableModuleRelativePath.replaceAll('\\', '/');
  if (!isCanonicalPortableLogicalPath(modulePath)) return null;
  const equal = (left: string, right: string): boolean => pathCaseMode === 'insensitive'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
  const artifactRootRelativePath = path.posix.dirname(binding.artifact);
  if (equal(modulePath, SOURCE_RUNTIME_MODULE_RELATIVE_PATH.replaceAll('\\', '/'))) {
    if (binding.source === null) {
      return runtimeLayoutError('SEC source runtime requires one explicit source entrypoint');
    }
    return Object.freeze({
      mode: 'source',
      cliEntrypointRelativePath: binding.source,
      artifactRootRelativePath
    });
  }
  if (equal(modulePath, binding.artifact)) {
    return Object.freeze({
      mode: 'bundle',
      cliEntrypointRelativePath: binding.artifact,
      artifactRootRelativePath
    });
  }
  return null;
}
