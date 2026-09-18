import path from 'node:path';
import { resolvePathInside } from '../contracts/relative-path.ts';

import type { RegistryLocation } from '../contracts/registry-source.ts';
import { encodeCanonicalBlockPhysicalKey } from '../semantics/identity/block.ts';
import {
  COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS,
  compilerRuntimeLayout
} from './toolchain/runtime/layout.ts';
import {
  CI_ARTIFACT_FILES,
  CI_ARTIFACT_ROOT_RELATIVE_PATH,
  isCanonicalCiArtifactPath,
  requireCanonicalCiArtifactPath
} from '../assurance/verification/ci-artifacts/contract/manifest.ts';
import { resolveWorkspaceLocalStateRoot } from '../workspace/contract/local-state.ts';
import type { WorkspacePaths } from '../workspace/contract/types.ts';
import { modelRelativePath } from '../workspace/contract/types.ts';
import {
  cacheRelativePath,
  modelBlocksRelativePath,
  overridesRelativePath,
  packageJsonRelativePath,
  policiesRelativePath,
  prismaRelativePath,
  privateRegistryRelativePath,
  srcRelativePath,
  testsRelativePath,
  tsconfigRelativePath,
  workspaceConfigRelativePath,
  workspaceWriteLeaseRelativePath
} from '../workspace/paths.ts';
export {
  cacheRelativePath,
  modelBlocksRelativePath,
  overridesRelativePath,
  packageJsonRelativePath,
  policiesRelativePath,
  prismaRelativePath,
  privateRegistryRelativePath,
  secRelativePath,
  srcRelativePath,
  testsRelativePath,
  tsconfigRelativePath,
  workspaceConfigRelativePath,
  workspaceWriteLeaseRelativePath
} from '../workspace/paths.ts';

export { localStateRelativePath } from '../workspace/contract/local-state.ts';

export const compilerRoot = compilerRuntimeLayout.packageRoot;

export const artifactsRelativePath = CI_ARTIFACT_ROOT_RELATIVE_PATH;

/** Compiler-owned resources are outside the target workspace layout. */
export const officialPoliciesRelativePath =
  COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS.officialPolicies;
export const officialRegistryRelativePath =
  COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS.officialRegistry;

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
  requireCanonicalCiArtifactPath(artifactPath);
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
