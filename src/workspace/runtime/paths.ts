import path from 'node:path';

import type { RegistryLocation } from '../../compiler/registry/contract/types.ts';
import { encodeCanonicalBlockPhysicalKey } from '../../semantic/identity/contract/block.ts';
import {
  COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS,
  compilerRuntimeLayout
} from '../../toolchain/runtime/layout.ts';
import {
  CI_ARTIFACT_FILES,
  CI_ARTIFACT_ROOT_RELATIVE_PATH,
  isCanonicalCiArtifactPath
} from '../../verification/ci-artifacts/contract/manifest.ts';
import {
  localStateRelativePath,
  resolveWorkspaceLocalStateRoot
} from '../contract/local-state.ts';
import type { WorkspacePaths } from '../contract/types.ts';
import { modelRelativePath } from '../contract/types.ts';

export { localStateRelativePath };

export const compilerRoot = compilerRuntimeLayout.packageRoot;

/** Native target-workspace roots. */
export const workspaceConfigRelativePath = 'sec.yaml' as const;
export const srcRelativePath = 'src' as const;
export const testsRelativePath = 'tests' as const;
export const packageJsonRelativePath = 'package.json' as const;
export const tsconfigRelativePath = 'tsconfig.json' as const;
export const prismaRelativePath = 'prisma' as const;
export const secRelativePath = localStateRelativePath;
export const artifactsRelativePath = CI_ARTIFACT_ROOT_RELATIVE_PATH;
export const cacheRelativePath = path.join(secRelativePath, 'cache');
export const workspaceWriteLeaseRelativePath = path.join(secRelativePath, 'workspace-write-lease');
export const modelBlocksRelativePath = path.join(modelRelativePath, 'blocks');
export const privateRegistryRelativePath = path.join(modelBlocksRelativePath, 'private');
export const policiesRelativePath = path.join(modelRelativePath, 'policies');
export const overridesRelativePath = path.join(modelRelativePath, 'patches');

/** Compiler-owned resources are outside the target workspace layout. */
export const officialPoliciesRelativePath =
  COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS.officialPolicies;
export const officialRegistryRelativePath =
  COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS.officialRegistry;

export function posixPath(value: string): string {
  return value.replaceAll('\\', '/');
}

export function relativePosixPath(from: string, to: string): string {
  return posixPath(path.relative(from, to));
}

export function isSafeRelativePath(value: string, options: { allowEmpty?: boolean } = {}): boolean {
  if (value.length === 0) {
    return options.allowEmpty === true;
  }
  const normalized = posixPath(value);
  if (value.includes('\0') || path.isAbsolute(value) || /^[A-Za-z]:/.test(value) || normalized.startsWith('//')) {
    return false;
  }
  return !normalized.split('/').includes('..');
}

export function isPathInside(root: string, targetPath: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  // This is lexical containment, not symlink/reparse-point admission. Only
  // a complete parent segment escapes; a child named '..cache' does not.
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export function resolvePathInside(root: string, relativePath: string, options: { allowEmpty?: boolean } = {}): string | null {
  if (!isSafeRelativePath(relativePath, options)) {
    return null;
  }
  const resolvedPath = path.resolve(root, relativePath);
  return isPathInside(root, resolvedPath) ? resolvedPath : null;
}

/**
 * Artifact paths are already workspace-relative identities emitted by the
 * artifact owner. No implicit root, legacy alias, or path normalization is
 * applied here.
 */
export function isCanonicalWorkspaceArtifactPath(value: string): boolean {
  return isCanonicalCiArtifactPath(value);
}

export function getWorkspacePaths(workspaceRoot = process.cwd()): WorkspacePaths {
  const root = path.resolve(workspaceRoot);
  const secRoot = resolveWorkspaceLocalStateRoot(root);
  const artifactsRoot = path.join(root, ...CI_ARTIFACT_ROOT_RELATIVE_PATH.split('/'));
  const modelRoot = path.join(root, modelRelativePath);
  const srcRoot = path.join(root, srcRelativePath);

  return Object.freeze({
    workspaceRoot: root,
    workspaceConfigPath: path.join(root, workspaceConfigRelativePath),
    modelRoot,
    modelBlocksRoot: path.join(root, modelBlocksRelativePath),
    privateRegistryRoot: path.join(root, privateRegistryRelativePath),
    policiesRoot: path.join(root, policiesRelativePath),
    overridesRoot: path.join(root, overridesRelativePath),
    srcRoot,
    testsRoot: path.join(root, testsRelativePath),
    packageJsonPath: path.join(root, packageJsonRelativePath),
    tsconfigPath: path.join(root, tsconfigRelativePath),
    prismaRoot: path.join(root, prismaRelativePath),
    secRoot,
    artifactsRoot,
    cacheRoot: path.join(root, cacheRelativePath),
    workspaceWriteLeaseRoot: path.join(root, workspaceWriteLeaseRelativePath)
  });
}

export async function resolveWorkspacePlanPath(workspaceRoot = process.cwd()): Promise<string> {
  return getWorkspacePaths(workspaceRoot).workspaceConfigPath;
}

export async function resolveWorkspaceLockPath(workspaceRoot = process.cwd()): Promise<string> {
  return resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
}

export async function resolveWorkspaceProvenancePath(workspaceRoot = process.cwd()): Promise<string> {
  return resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance);
}

export function resolveWorkspaceArtifactPath(workspaceRoot: string, artifactPath: string): string {
  const { artifactsRoot } = getWorkspacePaths(workspaceRoot);
  if (!isCanonicalWorkspaceArtifactPath(artifactPath)) {
    throw new Error(`Workspace artifact path "${artifactPath}" is not a canonical .sec/artifacts path`);
  }
  if (artifactPath === CI_ARTIFACT_ROOT_RELATIVE_PATH) {
    return artifactsRoot;
  }
  const relativeArtifactPath = artifactPath.slice(`${CI_ARTIFACT_ROOT_RELATIVE_PATH}/`.length);
  const resolvedPath = resolvePathInside(artifactsRoot, relativeArtifactPath);
  if (!resolvedPath) {
    throw new Error(`Workspace artifact path "${artifactPath}" escapes its allowed root`);
  }
  return resolvedPath;
}

export function toWorkspaceArtifactPath(artifactPath: string): string {
  if (!isCanonicalWorkspaceArtifactPath(artifactPath)) {
    throw new Error(`Workspace artifact path "${artifactPath}" is not a canonical .sec/artifacts path`);
  }
  return artifactPath;
}

export function blockDirName(blockId: string): string {
  return encodeCanonicalBlockPhysicalKey(blockId);
}

export function resolveRegistryRoot(
  workspaceRoot: string,
  location: RegistryLocation,
  registryPath: string
): string {
  const baseRoot = location === 'compiler'
    ? compilerRuntimeLayout.runtimeAssetRoot
    : path.resolve(workspaceRoot);
  const resolvedPath = resolvePathInside(baseRoot, registryPath);
  if (!resolvedPath) {
    throw new Error(`Registry path "${registryPath}" escapes its allowed root`);
  }
  return resolvedPath;
}
