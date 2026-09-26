import path from 'node:path';

import { sha256 } from '../../../contracts/canonical.ts';

const RUNTIME_STATE_LAYOUT_SCHEMA = 'sec-runtime-state-layout-v1' as const;

export type RuntimePlatform = 'win32' | 'linux' | 'darwin';

export type RuntimeStateEnvironment = Readonly<{
  SEC_STATE_HOME?: string;
  SEC_CACHE_HOME?: string;
  LOCALAPPDATA?: string;
  XDG_STATE_HOME?: string;
  XDG_CACHE_HOME?: string;
  HOME?: string;
}>;

export interface RuntimeRoots {
  readonly stateRoot: string;
  readonly cacheRoot: string;
  readonly workspaceCollectionRoot: string;
  readonly workspaceLocatorRoot: string;
  readonly workspaceStateRoot: string;
  readonly workspaceLocatorKey: `sha256:${string}`;
  readonly processDiagnosticObjectRoot: string;
  readonly testProcessTempLeaseRoot: string;
}

export interface WorkspacePhysicalIdentity {
  readonly device: string;
  readonly inode: string;
  readonly objectId: string;
}

export interface RuntimeStateLayout {
  readonly schema: typeof RUNTIME_STATE_LAYOUT_SCHEMA;
  readonly stateRoot: string;
  readonly cacheRoot: string;
  readonly repositoryKey: `sha256:${string}`;
  readonly workspaceKey: `sha256:${string}`;
  readonly workspaceLocatorKey: `sha256:${string}`;
  readonly repositoryStateRoot: string;
  readonly workspaceCollectionRoot: string;
  readonly workspaceStateRoot: string;
  readonly continuationObjectRoot: string;
  readonly continuationPointerPath: string;
  readonly durableLocalExecutionJournalRoot: string;
  readonly verificationSessionJournalRoot: string;
  readonly processDiagnosticObjectRoot: string;
}

export function currentRuntimePlatform(
  platform: NodeJS.Platform = process.platform
): RuntimePlatform {
  if (platform !== 'win32' && platform !== 'linux' && platform !== 'darwin') {
    fail(`does not support platform ${platform}.`);
  }
  return platform;
}

export function runtimeStateEnvironment(
  source: NodeJS.ProcessEnv = process.env
): RuntimeStateEnvironment {
  const result: Record<string, string> = {};
  for (const name of [
    'SEC_STATE_HOME', 'SEC_CACHE_HOME', 'LOCALAPPDATA',
    'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'HOME'
  ]) {
    const value = source[name];
    if (typeof value === 'string' && value.length > 0) result[name] = value;
  }
  return Object.freeze(result as RuntimeStateEnvironment);
}

function fail(message: string): never {
  throw new Error(`SEC runtime state ${message}`);
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

function flavor(platform: RuntimePlatform): typeof path.win32 | typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix;
}

function requireAbsolute(value: string, platform: RuntimePlatform, label: string): string {
  const api = flavor(platform);
  if (!api.isAbsolute(value)) fail(`${label} must be absolute.`);
  return api.normalize(value);
}

function defaultStateRoot(platform: RuntimePlatform, env: RuntimeStateEnvironment): string {
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

function defaultCacheRoot(platform: RuntimePlatform, env: RuntimeStateEnvironment): string {
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

export function resolveRuntimeCacheRoot(input: Readonly<{
  platform: RuntimePlatform;
  environment: RuntimeStateEnvironment;
  repositoryRoot: string;
}>): string {
  const repositoryRoot = requireAbsolute(input.repositoryRoot, input.platform, 'repositoryRoot');
  const cacheRoot = defaultCacheRoot(input.platform, input.environment);
  if (isSameOrInside(cacheRoot, repositoryRoot, input.platform)) {
    fail('cache root must remain outside the repository worktree.');
  }
  return cacheRoot;
}

function workspacePhysicalIdentity(
  value: WorkspacePhysicalIdentity
): WorkspacePhysicalIdentity {
  const result = Object.freeze({
    device: boundedText(value.device, 'workspace physical device'),
    inode: boundedText(value.inode, 'workspace physical inode'),
    objectId: boundedText(value.objectId, 'workspace physical objectId')
  });
  return result;
}

function isSameOrInside(candidate: string, parent: string, platform: RuntimePlatform): boolean {
  const api = flavor(platform);
  const left = platform === 'win32' ? api.normalize(candidate).toLowerCase() : api.normalize(candidate);
  const right = platform === 'win32' ? api.normalize(parent).toLowerCase() : api.normalize(parent);
  const relative = api.relative(right, left);
  return relative === '' || (!relative.startsWith(`..${api.sep}`) && relative !== '..' && !api.isAbsolute(relative));
}

export function createWorkspaceLocatorKey(input: Readonly<{
  workspacePhysicalIdentity: WorkspacePhysicalIdentity;
}>): `sha256:${string}` {
  return digest(Object.freeze({
    schema: 'sec-workspace-locator-key-v1',
    workspacePhysicalIdentity: workspacePhysicalIdentity(input.workspacePhysicalIdentity)
  }));
}

export function resolveRuntimeRoots(input: Readonly<{
  platform: RuntimePlatform;
  environment: RuntimeStateEnvironment;
  repositoryRoot: string;
  workspacePhysicalIdentity: WorkspacePhysicalIdentity;
}>): RuntimeRoots {
  const repositoryRoot = requireAbsolute(input.repositoryRoot, input.platform, 'repositoryRoot');
  const stateRoot = defaultStateRoot(input.platform, input.environment);
  const cacheRoot = resolveRuntimeCacheRoot({
    platform: input.platform,
    environment: input.environment,
    repositoryRoot
  });
  if (isSameOrInside(stateRoot, repositoryRoot, input.platform)) {
    fail('durable state root must remain outside the repository worktree.');
  }
  if (isSameOrInside(stateRoot, cacheRoot, input.platform)
      || isSameOrInside(cacheRoot, stateRoot, input.platform)) {
    fail('durable state and disposable cache roots must be physically disjoint.');
  }
  const api = flavor(input.platform);
  const workspaceLocatorKey = createWorkspaceLocatorKey({
    workspacePhysicalIdentity: input.workspacePhysicalIdentity
  });
  const workspaceCollectionRoot = api.join(stateRoot, 'workspaces', 'records');
  const workspaceStateRoot = api.join(workspaceCollectionRoot, workspaceLocatorKey.slice(7));
  return Object.freeze({
    stateRoot,
    cacheRoot,
    workspaceCollectionRoot,
    workspaceLocatorRoot: api.join(stateRoot, 'workspace-locators', 'records'),
    workspaceStateRoot,
    workspaceLocatorKey,
    processDiagnosticObjectRoot: api.join(workspaceStateRoot, 'objects', 'process-diagnostics'),
    testProcessTempLeaseRoot: api.join(workspaceStateRoot, 'test-process-temp', 'leases')
  });
}

export function resolveRuntimeStateLayout(input: Readonly<{
  platform: RuntimePlatform;
  environment: RuntimeStateEnvironment;
  repository: string;
  repositoryRoot: string;
  workspacePhysicalIdentity: WorkspacePhysicalIdentity;
}>): RuntimeStateLayout {
  const repositoryIdentity = repository(input.repository);
  const repositoryRoot = requireAbsolute(input.repositoryRoot, input.platform, 'repositoryRoot');
  const roots = resolveRuntimeRoots({
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
  return Object.freeze({
    schema: RUNTIME_STATE_LAYOUT_SCHEMA,
    stateRoot: roots.stateRoot,
    cacheRoot: roots.cacheRoot,
    repositoryKey,
    workspaceKey,
    workspaceLocatorKey: roots.workspaceLocatorKey,
    repositoryStateRoot,
    workspaceCollectionRoot: roots.workspaceCollectionRoot,
    workspaceStateRoot: roots.workspaceStateRoot,
    continuationObjectRoot: api.join(repositoryStateRoot, 'objects', 'continuation'),
    continuationPointerPath: api.join(roots.workspaceStateRoot, 'active-continuation.json'),
    durableLocalExecutionJournalRoot: api.join(
      roots.workspaceStateRoot, 'durable-local-executions'
    ),
    verificationSessionJournalRoot: api.join(roots.workspaceStateRoot, 'verification-sessions', 'journal'),
    processDiagnosticObjectRoot: roots.processDiagnosticObjectRoot
  });
}
