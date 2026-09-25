import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { resolveWorkspaceRuntimeRoots } from '../../../runtime-state/workspace-state/paths.ts';
import type { RuntimeStateEnvironment } from '../../../runtime-state/workspace-state/layout.ts';
import { acquireRuntimeCachePhysicalAuthority, type RuntimeCachePhysicalAuthority } from '../../../runtime-state/workspace-state/physical-authority.ts';
import { inspectExactNoFollowDirectoryPresence, retireNoFollowDirectoryTree, scanNoFollowDirectoryTreeMetadata } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { compilerRoot } from '../../../workspace-context.ts';

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;

export interface DependencyMaterializationLocations {
  readonly bunPackageCacheRoot: string;
  readonly cacheRoot: string;
  readonly collectionRoot: string;
  readonly workspaceLocatorKey: `sha256:${string}`;
}

/**
 * Physical locations belong to the dependency provider and Runtime Cache.
 * Callers consume generation identities, never a repository-local cache path.
 */
export function dependencyMaterializationLocations(
  repositoryRoot = compilerRoot,
  environment: NodeJS.ProcessEnv | RuntimeStateEnvironment = process.env
): Readonly<DependencyMaterializationLocations> {
  const root = path.resolve(repositoryRoot);
  const runtime = resolveWorkspaceRuntimeRoots({ repositoryRoot: root, environment });
  const workspaceKey = runtime.workspaceLocatorKey.slice('sha256:'.length);
  return Object.freeze({
    bunPackageCacheRoot: path.join(runtime.cacheRoot, 'dependency-provider-cache', 'bun'),
    cacheRoot: runtime.cacheRoot,
    collectionRoot: path.join(runtime.cacheRoot, 'dependency-materializations', workspaceKey),
    workspaceLocatorKey: runtime.workspaceLocatorKey
  });
}

export function dependencyMaterializationGenerationRoot(
  repositoryRoot: string,
  revision: `sha256:${string}`,
  environment: NodeJS.ProcessEnv | RuntimeStateEnvironment = process.env
): string {
  if (!SHA256_DIGEST.test(revision)) {
    throw new Error('Dependency materialization revision must be one SHA-256 digest.');
  }
  const locations = dependencyMaterializationLocations(repositoryRoot, environment);
  return path.join(locations.collectionRoot, revision.slice('sha256:'.length));
}


export interface DependencyProviderCacheAuthority {
  readonly authority: RuntimeCachePhysicalAuthority;
  readonly bunPackageCacheRoot: string;
}

export interface DependencyMaterializationGenerationAuthority {
  readonly authority: RuntimeCachePhysicalAuthority;
  readonly bindingRevision: `sha256:${string}`;
  readonly nodeModulesPath: string;
  readonly root: string;
}

export function acquireDependencyProviderCacheAuthority(
  repositoryRoot = compilerRoot,
  environment: NodeJS.ProcessEnv | RuntimeStateEnvironment = process.env
): Readonly<DependencyProviderCacheAuthority> {
  const root = path.resolve(repositoryRoot);
  const locations = dependencyMaterializationLocations(root, environment);
  const authority = acquireRuntimeCachePhysicalAuthority({
    repositoryRoot: root,
    cacheRoot: locations.cacheRoot,
    requiredDirectories: [locations.bunPackageCacheRoot]
  });
  authority.assertCurrent();
  return Object.freeze({ authority, bunPackageCacheRoot: locations.bunPackageCacheRoot });
}

export function acquireDependencyMaterializationGenerationAuthority(
  repositoryRoot: string,
  revision: `sha256:${string}`,
  environment: NodeJS.ProcessEnv | RuntimeStateEnvironment = process.env
): Readonly<DependencyMaterializationGenerationAuthority> {
  const root = path.resolve(repositoryRoot);
  const locations = dependencyMaterializationLocations(root, environment);
  const generationRoot = dependencyMaterializationGenerationRoot(root, revision, environment);
  const authority = acquireRuntimeCachePhysicalAuthority({
    repositoryRoot: root,
    cacheRoot: locations.cacheRoot,
    requiredDirectories: [locations.collectionRoot, generationRoot]
  });
  authority.assertCurrent();
  return Object.freeze({
    authority,
    bindingRevision: revision,
    nodeModulesPath: path.join(generationRoot, 'node_modules'),
    root: generationRoot
  });
}


const DEPENDENCY_CACHE_RETIREMENT_BUDGET_MS = 30_000;
const DEPENDENCY_CACHE_RETIREMENT_MAXIMUM_ENTRIES = 300_000;

function retireDependencyCacheTree(
  repositoryRoot: string,
  targetRoot: string,
  parentRoot: string,
  environment: NodeJS.ProcessEnv | RuntimeStateEnvironment
): boolean {
  const presence = inspectExactNoFollowDirectoryPresence(
    targetRoot,
    'Dependency Runtime Cache retirement target'
  );
  if (presence.state === 'absent') return false;
  const locations = dependencyMaterializationLocations(repositoryRoot, environment);
  const authority = acquireRuntimeCachePhysicalAuthority({
    repositoryRoot: path.resolve(repositoryRoot),
    cacheRoot: locations.cacheRoot,
    requiredDirectories: [parentRoot]
  });
  authority.assertCurrent();
  const root = presence.directory.target;
  const parent = authority.directory(parentRoot);
  if (path.dirname(root.path) !== parent.path) {
    throw new Error('Dependency Runtime Cache retirement target is not an exact owner child.');
  }
  const deadlineAtMonotonicMs = performance.now() + DEPENDENCY_CACHE_RETIREMENT_BUDGET_MS;
  const inventory = scanNoFollowDirectoryTreeMetadata(root, {
    deadlineAtMs: deadlineAtMonotonicMs,
    maximumEntries: DEPENDENCY_CACHE_RETIREMENT_MAXIMUM_ENTRIES
  });
  authority.assertCurrent();
  const receipt = retireNoFollowDirectoryTree({
    deadlineAtMonotonicMs,
    inventory,
    parent,
    root,
    restoreOwnerPermissions: process.platform === 'linux'
  });
  authority.assertCurrent();
  if (receipt.status !== 'physically-absent') {
    throw new Error('Dependency Runtime Cache retirement did not reach physical absence.');
  }
  return true;
}

export function disposeDependencyMaterializationCollection(
  repositoryRoot = compilerRoot,
  environment: NodeJS.ProcessEnv | RuntimeStateEnvironment = process.env
): boolean {
  const locations = dependencyMaterializationLocations(repositoryRoot, environment);
  return retireDependencyCacheTree(
    repositoryRoot,
    locations.collectionRoot,
    path.dirname(locations.collectionRoot),
    environment
  );
}

export function disposeDependencyProviderCache(
  repositoryRoot = compilerRoot,
  environment: NodeJS.ProcessEnv | RuntimeStateEnvironment = process.env
): boolean {
  const locations = dependencyMaterializationLocations(repositoryRoot, environment);
  return retireDependencyCacheTree(
    repositoryRoot,
    locations.bunPackageCacheRoot,
    path.dirname(locations.bunPackageCacheRoot),
    environment
  );
}
