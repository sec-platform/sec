import path from 'node:path';

import { sha256 } from './canonical-primitives.ts';

export const SEC_RUNTIME_STATE_LAYOUT_SCHEMA_V1 = 'sec-runtime-state-layout-v1' as const;
export const SEC_RUNTIME_CACHE_LAYOUT_SCHEMA_V1 = 'sec-runtime-cache-layout-v1' as const;
export const SEC_RUNTIME_CACHE_LAYOUT_VERSION_V1 = 'v1' as const;
export const SEC_RUNTIME_STATE_POLICY_V1 = Object.freeze({
  schema: 'sec-runtime-state-policy-v1',
  repositoryTreeOwnsRuntimeState: false,
  durableStateUnderRepositoryTree: false,
  contentAddressedContinuationObjects: true,
  stateAndCacheSeparated: true,
  workspaceStateUsesPhysicalWorkspaceIdentity: true
});

export type SecRuntimePlatformV1 = 'win32' | 'linux' | 'darwin';

export type SecRuntimeStateEnvironmentV1 = Readonly<{
  SEC_STATE_HOME?: string;
  SEC_CACHE_HOME?: string;
  LOCALAPPDATA?: string;
  XDG_STATE_HOME?: string;
  XDG_CACHE_HOME?: string;
  HOME?: string;
}>;

export interface SecRuntimeRootsV1 {
  readonly stateRoot: string;
  readonly cacheRoot: string;
  readonly workspaceLocatorRoot: string;
  readonly workspaceStateRoot: string;
  readonly workspaceLocatorKey: `sha256:${string}`;
}

export interface SecWorkspacePhysicalIdentityV1 {
  readonly device: string;
  readonly inode: string;
  readonly objectId: string;
}

export interface SecRuntimeStateLayoutV1 {
  readonly schema: typeof SEC_RUNTIME_STATE_LAYOUT_SCHEMA_V1;
  readonly stateRoot: string;
  readonly cacheRoot: string;
  readonly repositoryKey: `sha256:${string}`;
  readonly workspaceKey: `sha256:${string}`;
  readonly workspaceLocatorKey: `sha256:${string}`;
  readonly repositoryStateRoot: string;
  readonly workspaceStateRoot: string;
  readonly continuationObjectRoot: string;
  readonly continuationPointerPath: string;
  readonly verificationSessionJournalRoot: string;
  readonly verificationActionJournalRoot: string;
  /**
   * Durable semantic-owner locators for the repository-scoped dependency
   * cache lifecycle.  These are state records, not cache bytes and not
   * provider authority.  The physical cache provider may only project bytes
   * after the registration/current records exist.
   */
  readonly dependencyCacheRegistrationRoot: string;
  readonly dependencyCacheCurrentRoot: string;
  readonly dependencyCacheSettlementRoot: string;
  readonly dependencyCacheObjectRoot: string;
  readonly dependencyCachePhysicalRoot: string;
}

export interface SecRuntimeDependencyCacheLocatorsV2 {
  readonly birthPath: string;
  readonly registrationPath: string;
  readonly currentPath: string;
  readonly settlementPath: string;
  readonly objectPath: string;
  readonly cacheEntryPath: string;
  readonly cacheArchivePath: string;
  readonly cacheReceiptPath: string;
  readonly cacheMutationLeaseName: '.dependency-cache-build.lease';
}

/**
 * The one disposable Runtime Cache projection.  This is deliberately a
 * lexical layout contract only: it does not grant mutation, ownership or
 * cleanup authority.  Physical callers must still acquire the cache
 * authority from `runtime-state-authority.ts` before creating any child.
 *
 * Every rebuildable large object is placed below this versioned namespace.
 * Repository/workspace keys are content-addressed and therefore do not make
 * a path, display name or ambient cache directory an identity authority.
 */
export interface SecRuntimeCacheLayoutV1 {
  readonly schema: typeof SEC_RUNTIME_CACHE_LAYOUT_SCHEMA_V1;
  readonly version: typeof SEC_RUNTIME_CACHE_LAYOUT_VERSION_V1;
  readonly cacheRoot: string;
  readonly versionRoot: string;
  readonly environmentMaterializationRoot: string;
  readonly repositoryCacheRoot: string;
  readonly workspaceCacheRoot: string;
  readonly dependencyRoot: string;
  readonly providerRoot: string;
  readonly buildxRoot: string;
  readonly repositoryKey: `sha256:${string}`;
  readonly workspaceKey: `sha256:${string}`;
}

export function currentSecRuntimePlatformV1(
  platform: NodeJS.Platform = process.platform
): SecRuntimePlatformV1 {
  if (platform !== 'win32' && platform !== 'linux' && platform !== 'darwin') {
    fail(`does not support platform ${platform}.`);
  }
  return platform;
}

export function secRuntimeStateEnvironmentV1(
  source: NodeJS.ProcessEnv = process.env
): SecRuntimeStateEnvironmentV1 {
  const result: Record<string, string> = {};
  for (const name of [
    'SEC_STATE_HOME', 'SEC_CACHE_HOME', 'LOCALAPPDATA',
    'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'HOME'
  ]) {
    const value = source[name];
    if (typeof value === 'string' && value.length > 0) result[name] = value;
  }
  return Object.freeze(result as SecRuntimeStateEnvironmentV1);
}

function fail(message: string): never {
  throw new Error(`SEC runtime state ${message}`);
}

const SEC_RUNTIME_OPAQUE_PATH_ALPHABET_V1 = 'abcdefghijklmnopqrstuvwxyz234567';

/**
 * Encodes the complete input bit string into the lowercase RFC 4648 base32
 * alphabet accepted by retained SEC namespace creation. No padding or bit
 * truncation is permitted, so this is a compact locator encoding rather than
 * a weaker identity.
 */
export function encodeSecRuntimeOpaquePathTokenV1(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array) || (bytes.length !== 16 && bytes.length !== 32)) {
    fail('opaque path token input must contain exactly 128 or 256 bits.');
  }
  let accumulator = 0;
  let bitCount = 0;
  let result = '';
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      result += SEC_RUNTIME_OPAQUE_PATH_ALPHABET_V1[(accumulator >>> bitCount) & 31];
      accumulator &= bitCount === 0 ? 0 : (1 << bitCount) - 1;
    }
  }
  if (bitCount > 0) {
    result += SEC_RUNTIME_OPAQUE_PATH_ALPHABET_V1[(accumulator << (5 - bitCount)) & 31];
  }
  return result;
}

export function encodeSecRuntimeSha256PathTokenV1(value: string): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail('SHA-256 path token input is invalid.');
  }
  const hex = value.slice('sha256:'.length);
  const bytes = Uint8Array.from(
    Array.from({ length: 32 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16))
  );
  return encodeSecRuntimeOpaquePathTokenV1(bytes);
}

function digest(value: unknown): `sha256:${string}` {
  return sha256(value) as `sha256:${string}`;
}

function boundedText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096
      || value.includes('\0') || value.trim() !== value) {
    fail(`${label} must be bounded non-empty text.`);
  }
  return value;
}

function repository(value: unknown): string {
  const result = boundedText(value, 'repository');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(result)) {
    fail('repository must be owner/name.');
  }
  return result;
}

function flavor(platform: SecRuntimePlatformV1): typeof path.win32 | typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix;
}

function requireAbsolute(value: string, platform: SecRuntimePlatformV1, label: string): string {
  const api = flavor(platform);
  if (!api.isAbsolute(value)) fail(`${label} must be absolute.`);
  return api.normalize(value);
}

function defaultStateRoot(platform: SecRuntimePlatformV1, env: SecRuntimeStateEnvironmentV1): string {
  const api = flavor(platform);
  if (env.SEC_STATE_HOME !== undefined) return requireAbsolute(env.SEC_STATE_HOME, platform, 'SEC_STATE_HOME');
  if (platform === 'win32') {
    if (env.LOCALAPPDATA === undefined) fail('LOCALAPPDATA is required on Windows when SEC_STATE_HOME is unset.');
    return api.join(requireAbsolute(env.LOCALAPPDATA, platform, 'LOCALAPPDATA'), 'SEC', 'state');
  }
  if (env.XDG_STATE_HOME !== undefined) {
    return api.join(requireAbsolute(env.XDG_STATE_HOME, platform, 'XDG_STATE_HOME'), 'sec');
  }
  if (env.HOME === undefined) fail('HOME is required when SEC_STATE_HOME and XDG_STATE_HOME are unset.');
  const home = requireAbsolute(env.HOME, platform, 'HOME');
  return platform === 'darwin'
    ? api.join(home, 'Library', 'Application Support', 'SEC', 'state')
    : api.join(home, '.local', 'state', 'sec');
}

function defaultCacheRoot(platform: SecRuntimePlatformV1, env: SecRuntimeStateEnvironmentV1): string {
  const api = flavor(platform);
  if (env.SEC_CACHE_HOME !== undefined) return requireAbsolute(env.SEC_CACHE_HOME, platform, 'SEC_CACHE_HOME');
  if (platform === 'win32') {
    if (env.LOCALAPPDATA === undefined) fail('LOCALAPPDATA is required on Windows when SEC_CACHE_HOME is unset.');
    return api.join(requireAbsolute(env.LOCALAPPDATA, platform, 'LOCALAPPDATA'), 'SEC', 'cache');
  }
  if (env.XDG_CACHE_HOME !== undefined) {
    return api.join(requireAbsolute(env.XDG_CACHE_HOME, platform, 'XDG_CACHE_HOME'), 'sec');
  }
  if (env.HOME === undefined) fail('HOME is required when SEC_CACHE_HOME and XDG_CACHE_HOME are unset.');
  const home = requireAbsolute(env.HOME, platform, 'HOME');
  return platform === 'darwin'
    ? api.join(home, 'Library', 'Caches', 'SEC')
    : api.join(home, '.cache', 'sec');
}

export function resolveSecRuntimeCacheRootV1(input: Readonly<{
  platform: SecRuntimePlatformV1;
  environment: SecRuntimeStateEnvironmentV1;
  repositoryRoot: string;
}>): string {
  return resolveSecRuntimeRootPairV1(input).cacheRoot;
}

function workspacePhysicalIdentity(
  value: SecWorkspacePhysicalIdentityV1
): SecWorkspacePhysicalIdentityV1 {
  const result = Object.freeze({
    device: boundedText(value.device, 'workspace physical device'),
    inode: boundedText(value.inode, 'workspace physical inode'),
    objectId: boundedText(value.objectId, 'workspace physical objectId')
  });
  return result;
}

function isSameOrInside(candidate: string, parent: string, platform: SecRuntimePlatformV1): boolean {
  const api = flavor(platform);
  const left = platform === 'win32' ? api.normalize(candidate).toLowerCase() : api.normalize(candidate);
  const right = platform === 'win32' ? api.normalize(parent).toLowerCase() : api.normalize(parent);
  const relative = api.relative(right, left);
  return relative === '' || (!relative.startsWith(`..${api.sep}`) && relative !== '..' && !api.isAbsolute(relative));
}

type SecRuntimeRootPairV1 = Readonly<{
  readonly stateRoot: string;
  readonly cacheRoot: string;
}>;

/**
 * Resolve and validate the one runtime root pair used by every projection.
 *
 * Every cache capability must first derive the canonical durable state root.
 * A partial synthetic environment is therefore rejected by `defaultStateRoot`
 * instead of returning a cache path that cannot prove the state/cache
 * disjointness invariant.
 */
function resolveSecRuntimeRootPairV1(input: Readonly<{
  platform: SecRuntimePlatformV1;
  environment: SecRuntimeStateEnvironmentV1;
  repositoryRoot: string;
}>): SecRuntimeRootPairV1 {
  const repositoryRoot = requireAbsolute(input.repositoryRoot, input.platform, 'repositoryRoot');
  const cacheRoot = defaultCacheRoot(input.platform, input.environment);
  const stateRoot = defaultStateRoot(input.platform, input.environment);
  if (isSameOrInside(cacheRoot, repositoryRoot, input.platform)) {
    fail('cache root must remain outside the repository worktree.');
  }
  if (isSameOrInside(stateRoot, repositoryRoot, input.platform)) {
    fail('durable state root must remain outside the repository worktree.');
  }
  if (isSameOrInside(stateRoot, cacheRoot, input.platform)
      || isSameOrInside(cacheRoot, stateRoot, input.platform)) {
    fail('durable state and disposable cache roots must be physically disjoint.');
  }
  return Object.freeze({ stateRoot, cacheRoot });
}

export function createSecWorkspaceLocatorKeyV1(input: Readonly<{
  workspacePhysicalIdentity: SecWorkspacePhysicalIdentityV1;
}>): `sha256:${string}` {
  return digest(Object.freeze({
    schema: 'sec-workspace-locator-key-v1',
    workspacePhysicalIdentity: workspacePhysicalIdentity(input.workspacePhysicalIdentity)
  }));
}

export function resolveSecRuntimeRootsV1(input: Readonly<{
  platform: SecRuntimePlatformV1;
  environment: SecRuntimeStateEnvironmentV1;
  repositoryRoot: string;
  workspacePhysicalIdentity: SecWorkspacePhysicalIdentityV1;
}>): SecRuntimeRootsV1 {
  const repositoryRoot = requireAbsolute(input.repositoryRoot, input.platform, 'repositoryRoot');
  const roots = resolveSecRuntimeRootPairV1({
    platform: input.platform,
    environment: input.environment,
    repositoryRoot
  });
  const stateRoot = roots.stateRoot;
  const cacheRoot = roots.cacheRoot;
  const api = flavor(input.platform);
  const workspaceLocatorKey = createSecWorkspaceLocatorKeyV1({
    workspacePhysicalIdentity: input.workspacePhysicalIdentity
  });
  return Object.freeze({
    stateRoot,
    cacheRoot,
    workspaceLocatorRoot: api.join(stateRoot, 'workspace-locators', 'v1'),
    workspaceStateRoot: api.join(stateRoot, 'workspaces', 'v1', workspaceLocatorKey.slice(7)),
    workspaceLocatorKey
  });
}

export function resolveSecRuntimeStateLayoutV1(input: Readonly<{
  platform: SecRuntimePlatformV1;
  environment: SecRuntimeStateEnvironmentV1;
  repository: string;
  repositoryRoot: string;
  workspacePhysicalIdentity: SecWorkspacePhysicalIdentityV1;
}>): SecRuntimeStateLayoutV1 {
  const repositoryIdentity = repository(input.repository);
  const repositoryRoot = requireAbsolute(input.repositoryRoot, input.platform, 'repositoryRoot');
  const roots = resolveSecRuntimeRootsV1({
    platform: input.platform,
    environment: input.environment,
    repositoryRoot,
    workspacePhysicalIdentity: input.workspacePhysicalIdentity
  });
  const api = flavor(input.platform);
  const repositoryKey = digest(Object.freeze({ schema: 'sec-repository-runtime-key-v1', repository: repositoryIdentity }));
  const workspaceKey = digest(Object.freeze({
    schema: 'sec-workspace-runtime-key-v1',
    repository: repositoryIdentity,
    workspacePhysicalIdentity: workspacePhysicalIdentity(input.workspacePhysicalIdentity)
  }));
  const repositoryStateRoot = api.join(roots.stateRoot, 'repositories', repositoryKey.slice(7));
  const cacheLayout = resolveSecRuntimeCacheLayoutV1({
    platform: input.platform,
    environment: input.environment,
    repositoryRoot,
    repository: repositoryIdentity,
    workspacePhysicalIdentity: input.workspacePhysicalIdentity
  });
  return Object.freeze({
    schema: SEC_RUNTIME_STATE_LAYOUT_SCHEMA_V1,
    stateRoot: roots.stateRoot,
    cacheRoot: roots.cacheRoot,
    repositoryKey,
    workspaceKey,
    workspaceLocatorKey: roots.workspaceLocatorKey,
    repositoryStateRoot,
    workspaceStateRoot: roots.workspaceStateRoot,
    continuationObjectRoot: api.join(repositoryStateRoot, 'objects', 'continuation-v1'),
    continuationPointerPath: api.join(roots.workspaceStateRoot, 'active-continuation-v1.json'),
    verificationSessionJournalRoot: api.join(roots.workspaceStateRoot, 'verification-sessions', 'v2'),
    verificationActionJournalRoot: api.join(roots.workspaceStateRoot, 'verification-actions', 'v2'),
    dependencyCacheRegistrationRoot: api.join(repositoryStateRoot, 'dependency-cache', 'v2', 'registrations'),
    dependencyCacheCurrentRoot: api.join(repositoryStateRoot, 'dependency-cache', 'v2', 'current'),
    dependencyCacheSettlementRoot: api.join(repositoryStateRoot, 'dependency-cache', 'v2', 'settlements'),
    dependencyCacheObjectRoot: api.join(repositoryStateRoot, 'dependency-cache', 'v2', 'objects'),
    dependencyCachePhysicalRoot: api.join(cacheLayout.dependencyRoot, 'trusted-bootstrap')
  });
}

function requireSha256LocatorDigest(value: string, label: string): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail(`${label} must be a SHA-256 digest.`);
  }
  return value;
}

/**
 * Derive the four durable semantic-owner locators for one repository cache
 * identity.  No cache directory is created here; this function is pure and
 * cannot grant physical mutation authority.
 */
export function resolveSecRuntimeDependencyCacheLocatorsV2(input: Readonly<{
  layout: SecRuntimeStateLayoutV1;
  identityDigest: string;
  resourceId: string;
}>): SecRuntimeDependencyCacheLocatorsV2 {
  const identityDigest = requireSha256LocatorDigest(input.identityDigest, 'dependency cache identityDigest');
  const resourceId = requireSha256LocatorDigest(input.resourceId, 'dependency cache resourceId');
  const identityToken = encodeSecRuntimeSha256PathTokenV1(identityDigest);
  const resourceToken = encodeSecRuntimeSha256PathTokenV1(resourceId);
  const api = /^(?:[A-Za-z]:[\\/]|\\\\)/u.test(input.layout.repositoryStateRoot)
    ? path.win32
    : path.posix;
  const cacheEntryPath = api.join(input.layout.dependencyCachePhysicalRoot, resourceToken);
  return Object.freeze({
    birthPath: api.join(input.layout.dependencyCacheRegistrationRoot, `${identityToken}.birth.json`),
    registrationPath: api.join(input.layout.dependencyCacheRegistrationRoot, `${resourceToken}.json`),
    currentPath: api.join(input.layout.dependencyCacheCurrentRoot, `${identityToken}.json`),
    settlementPath: api.join(input.layout.dependencyCacheSettlementRoot, `${resourceToken}.json`),
    objectPath: api.join(input.layout.dependencyCacheObjectRoot, resourceToken),
    cacheEntryPath,
    cacheArchivePath: api.join(cacheEntryPath, 'dependencies.tar'),
    cacheReceiptPath: api.join(cacheEntryPath, 'receipt.json'),
    cacheMutationLeaseName: '.dependency-cache-build.lease'
  });
}

function normalizedScopePath(value: string, platform: SecRuntimePlatformV1): string {
  const normalized = requireAbsolute(value, platform, 'scopeRoot');
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Resolve the canonical disposable-cache layout for a repository/workspace.
 * The optional repository and physical identity make the function usable by
 * pure callers that only have an exact workspace path while preserving the
 * stronger physical identity key whenever a host observer has one.
 */
export function resolveSecRuntimeCacheLayoutV1(input: Readonly<{
  platform: SecRuntimePlatformV1;
  environment: SecRuntimeStateEnvironmentV1;
  repositoryRoot: string;
  repository?: string;
  workspacePhysicalIdentity?: SecWorkspacePhysicalIdentityV1;
}>): SecRuntimeCacheLayoutV1 {
  const repositoryRoot = requireAbsolute(input.repositoryRoot, input.platform, 'repositoryRoot');
  const cacheRoot = resolveSecRuntimeRootPairV1({
    platform: input.platform,
    environment: input.environment,
    repositoryRoot
  }).cacheRoot;
  const api = flavor(input.platform);
  const versionRoot = api.join(cacheRoot, SEC_RUNTIME_CACHE_LAYOUT_VERSION_V1);
  const repositoryKey = digest(Object.freeze({
    schema: 'sec-runtime-cache-repository-key-v1',
    repository: input.repository === undefined
      ? null
      : repository(input.repository),
    scopeRoot: normalizedScopePath(repositoryRoot, input.platform)
  }));
  const workspaceKey = digest(Object.freeze({
    schema: 'sec-runtime-cache-workspace-key-v1',
    repositoryKey,
    workspacePhysicalIdentity: input.workspacePhysicalIdentity === undefined
      ? null
      : workspacePhysicalIdentity(input.workspacePhysicalIdentity),
    scopeRoot: normalizedScopePath(repositoryRoot, input.platform)
  }));
  const environmentMaterializationRoot = api.join(versionRoot, 'environment-materialization');
  const repositoryCacheRoot = api.join(versionRoot, 'repositories', repositoryKey.slice(7));
  const workspaceCacheRoot = api.join(repositoryCacheRoot, 'workspaces', workspaceKey.slice(7));
  return Object.freeze({
    schema: SEC_RUNTIME_CACHE_LAYOUT_SCHEMA_V1,
    version: SEC_RUNTIME_CACHE_LAYOUT_VERSION_V1,
    cacheRoot,
    versionRoot,
    environmentMaterializationRoot,
    repositoryCacheRoot,
    workspaceCacheRoot,
    dependencyRoot: api.join(repositoryCacheRoot, 'dependencies'),
    providerRoot: api.join(repositoryCacheRoot, 'providers'),
    buildxRoot: api.join(repositoryCacheRoot, 'buildx'),
    repositoryKey,
    workspaceKey
  });
}

/** Repository-scoped alias for callers that already use the state naming. */
export const resolveSecRuntimeCacheLayoutForRepositoryV1 = resolveSecRuntimeCacheLayoutV1;
