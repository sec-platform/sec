import { expect, test } from 'bun:test';

import {
  createSecWorkspaceLocatorKeyV1,
  encodeSecRuntimeOpaquePathTokenV1,
  encodeSecRuntimeSha256PathTokenV1,
  resolveSecRuntimeCacheLayoutV1,
  resolveSecRuntimeCacheRootV1,
  resolveSecRuntimeDependencyCacheLocatorsV2,
  resolveSecRuntimeRootsV1,
  resolveSecRuntimeStateLayoutV1
} from '../../platform/shared/sec-runtime-state-contract.ts';

test('runtime path tokens preserve complete 128-bit and SHA-256 inputs in the retained segment grammar', () => {
  const token128 = encodeSecRuntimeOpaquePathTokenV1(Uint8Array.from({ length: 16 }, (_, index) => index));
  const token256 = encodeSecRuntimeSha256PathTokenV1(`sha256:${'ab'.repeat(32)}`);
  expect(encodeSecRuntimeOpaquePathTokenV1(new Uint8Array(16))).toBe('a'.repeat(26));
  expect(encodeSecRuntimeOpaquePathTokenV1(new Uint8Array(32))).toBe('a'.repeat(52));
  expect(token128).toMatch(/^[a-z2-7]{26}$/u);
  expect(token256).toMatch(/^[a-z2-7]{52}$/u);
  expect(encodeSecRuntimeSha256PathTokenV1(`sha256:${'ac'.repeat(32)}`)).not.toBe(token256);
  expect(() => encodeSecRuntimeOpaquePathTokenV1(new Uint8Array(15))).toThrow();
  expect(() => encodeSecRuntimeSha256PathTokenV1('sha256:invalid')).toThrow();
});

const WORKSPACE_IDENTITY = Object.freeze({
  device: 'device-1',
  inode: 'inode-1',
  objectId: 'object-1'
});

test('Linux runtime state follows XDG defaults and separates repository/runtime/cache domains', () => {
  const layout = resolveSecRuntimeStateLayoutV1({
    platform: 'linux',
    environment: { HOME: '/home/sec' },
    repository: 'sec-platform/sec',
    repositoryRoot: '/work/sec',
    workspacePhysicalIdentity: WORKSPACE_IDENTITY
  });
  expect(layout.stateRoot).toBe('/home/sec/.local/state/sec');
  expect(layout.cacheRoot).toBe('/home/sec/.cache/sec');
  expect(layout.workspaceStateRoot).toMatch(/^\/home\/sec\/\.local\/state\/sec\/workspaces\/v1\/[0-9a-f]{64}$/u);
  expect(layout.repositoryStateRoot).toMatch(/^\/home\/sec\/\.local\/state\/sec\/repositories\/[0-9a-f]{64}$/u);
  expect(layout.continuationObjectRoot).toContain('/objects/continuation-v1');
  expect(layout.continuationPointerPath).toContain('/workspaces/v1/');
  expect(layout.verificationSessionJournalRoot).toContain('/verification-sessions/v2');
  expect(layout.verificationActionJournalRoot).toContain('/verification-actions/v2');
  const locators = resolveSecRuntimeDependencyCacheLocatorsV2({
    layout,
    identityDigest: `sha256:${'ab'.repeat(32)}`,
    resourceId: `sha256:${'cd'.repeat(32)}`
  });
  expect(locators.birthPath).toContain('/dependency-cache/v2/registrations/');
  expect(locators.birthPath).toEndWith('.birth.json');
  expect(locators.registrationPath).toContain('/dependency-cache/v2/registrations/');
  expect(locators.currentPath).toContain('/dependency-cache/v2/current/');
  expect(locators.settlementPath).toContain('/dependency-cache/v2/settlements/');
  expect(locators.cacheEntryPath).toMatch(/\/trusted-bootstrap\/[a-z2-7]{52}$/u);
  expect(locators.cacheArchivePath).toBe(`${locators.cacheEntryPath}/dependencies.tar`);
  expect(locators.cacheReceiptPath).toBe(`${locators.cacheEntryPath}/receipt.json`);
  expect(layout.repositoryStateRoot.startsWith('/work/sec/')).toBe(false);
});

test('Windows runtime state uses LOCALAPPDATA with case-insensitive physical workspace identity', () => {
  const environment = { LOCALAPPDATA: 'C:\\Users\\Sec\\AppData\\Local' };
  const first = resolveSecRuntimeStateLayoutV1({
    platform: 'win32',
    environment,
    repository: 'sec-platform/sec',
    repositoryRoot: 'D:\\Project\\SEC',
    workspacePhysicalIdentity: WORKSPACE_IDENTITY
  });
  const second = resolveSecRuntimeStateLayoutV1({
    platform: 'win32',
    environment,
    repository: 'sec-platform/sec',
    repositoryRoot: 'd:\\project\\sec',
    workspacePhysicalIdentity: WORKSPACE_IDENTITY
  });
  expect(first.stateRoot).toBe('C:\\Users\\Sec\\AppData\\Local\\SEC\\state');
  expect(first.cacheRoot).toBe('C:\\Users\\Sec\\AppData\\Local\\SEC\\cache');
  expect(first.workspaceLocatorKey).toBe(second.workspaceLocatorKey);
  expect(first.workspaceKey).toBe(second.workspaceKey);
});

test('recreated workspace identity cannot inherit an earlier path locator or journal namespace', () => {
  const common = {
    platform: 'linux' as const,
    environment: { HOME: '/home/sec' },
    repository: 'sec-platform/sec',
    repositoryRoot: '/work/sec'
  };
  const original = resolveSecRuntimeStateLayoutV1({
    ...common,
    workspacePhysicalIdentity: WORKSPACE_IDENTITY
  });
  const replacement = resolveSecRuntimeStateLayoutV1({
    ...common,
    workspacePhysicalIdentity: { ...WORKSPACE_IDENTITY, inode: 'inode-2', objectId: 'object-2' }
  });
  expect(replacement.workspaceLocatorKey).not.toBe(original.workspaceLocatorKey);
  expect(replacement.workspaceKey).not.toBe(original.workspaceKey);
  expect(replacement.workspaceStateRoot).not.toBe(original.workspaceStateRoot);
});

test('explicit SEC roots are deterministic and workspace locator identity does not depend on repository name', () => {
  const roots = resolveSecRuntimeRootsV1({
    platform: 'linux',
    environment: { SEC_STATE_HOME: '/runtime/sec-state', SEC_CACHE_HOME: '/runtime/sec-cache' },
    repositoryRoot: '/work/sec',
    workspacePhysicalIdentity: WORKSPACE_IDENTITY
  });
  expect(roots.stateRoot).toBe('/runtime/sec-state');
  expect(roots.cacheRoot).toBe('/runtime/sec-cache');
  expect(roots.workspaceLocatorKey).toBe(createSecWorkspaceLocatorKeyV1({
    workspacePhysicalIdentity: WORKSPACE_IDENTITY
  }));
  const left = resolveSecRuntimeStateLayoutV1({
    platform: 'linux', environment: { SEC_STATE_HOME: '/runtime/sec-state', SEC_CACHE_HOME: '/runtime/sec-cache' },
    repository: 'sec-platform/sec', repositoryRoot: '/work/sec',
    workspacePhysicalIdentity: WORKSPACE_IDENTITY
  });
  const right = resolveSecRuntimeStateLayoutV1({
    platform: 'linux', environment: { SEC_STATE_HOME: '/runtime/sec-state', SEC_CACHE_HOME: '/runtime/sec-cache' },
    repository: 'other/repository', repositoryRoot: '/work/sec',
    workspacePhysicalIdentity: WORKSPACE_IDENTITY
  });
  expect(left.workspaceLocatorKey).toBe(right.workspaceLocatorKey);
  expect(left.workspaceStateRoot).toBe(right.workspaceStateRoot);
  expect(left.repositoryKey).not.toBe(right.repositoryKey);
});

test('runtime state and cache roots inside the repository are rejected', () => {
  expect(() => resolveSecRuntimeStateLayoutV1({
    platform: 'linux',
    environment: { SEC_STATE_HOME: '/work/sec/.state', SEC_CACHE_HOME: '/runtime/cache' },
    repository: 'sec-platform/sec',
    repositoryRoot: '/work/sec',
    workspacePhysicalIdentity: WORKSPACE_IDENTITY
  })).toThrow('outside the repository worktree');
  expect(() => resolveSecRuntimeStateLayoutV1({
    platform: 'linux',
    environment: { SEC_STATE_HOME: '/runtime/state', SEC_CACHE_HOME: '/work/sec/.cache' },
    repository: 'sec-platform/sec',
    repositoryRoot: '/work/sec',
    workspacePhysicalIdentity: WORKSPACE_IDENTITY
  })).toThrow('outside the repository worktree');
});

test('durable state and disposable cache roots must be physically disjoint', () => {
  for (const environment of [
    { SEC_STATE_HOME: '/runtime/sec', SEC_CACHE_HOME: '/runtime/sec' },
    { SEC_STATE_HOME: '/runtime/sec', SEC_CACHE_HOME: '/runtime/sec/cache' },
    { SEC_STATE_HOME: '/runtime/sec/state', SEC_CACHE_HOME: '/runtime/sec' }
  ]) {
    expect(() => resolveSecRuntimeStateLayoutV1({
      platform: 'linux',
      environment,
      repository: 'sec-platform/sec',
      repositoryRoot: '/work/sec',
      workspacePhysicalIdentity: WORKSPACE_IDENTITY
    })).toThrow('physically disjoint');
  }
});

test('cache layout is one versioned, repository/workspace-addressed namespace', () => {
  const layout = resolveSecRuntimeCacheLayoutV1({
    platform: 'linux',
    environment: {
      SEC_STATE_HOME: '/runtime/sec-state',
      SEC_CACHE_HOME: '/runtime/sec-cache'
    },
    repository: 'sec-platform/sec',
    repositoryRoot: '/work/sec',
    workspacePhysicalIdentity: WORKSPACE_IDENTITY
  });
  expect(layout.schema).toBe('sec-runtime-cache-layout-v1');
  expect(layout.version).toBe('v1');
  expect(layout.versionRoot).toBe('/runtime/sec-cache/v1');
  expect(layout.environmentMaterializationRoot).toBe('/runtime/sec-cache/v1/environment-materialization');
  expect(layout.repositoryCacheRoot).toMatch(/^\/runtime\/sec-cache\/v1\/repositories\/[0-9a-f]{64}$/u);
  expect(layout.workspaceCacheRoot).toMatch(
    /^\/runtime\/sec-cache\/v1\/repositories\/[0-9a-f]{64}\/workspaces\/[0-9a-f]{64}$/u
  );
  expect(layout.dependencyRoot).toBe(`${layout.repositoryCacheRoot}/dependencies`);
  expect(layout.providerRoot).toBe(`${layout.repositoryCacheRoot}/providers`);
  expect(layout.buildxRoot).toBe(`${layout.repositoryCacheRoot}/buildx`);
  expect(layout.versionRoot.startsWith('/work/sec/')).toBe(false);

  const replacement = resolveSecRuntimeCacheLayoutV1({
    platform: 'linux',
    environment: {
      SEC_STATE_HOME: '/runtime/sec-state',
      SEC_CACHE_HOME: '/runtime/sec-cache'
    },
    repository: 'sec-platform/sec',
    repositoryRoot: '/work/sec',
    workspacePhysicalIdentity: { ...WORKSPACE_IDENTITY, inode: 'inode-2' }
  });
  expect(replacement.repositoryCacheRoot).toBe(layout.repositoryCacheRoot);
  expect(replacement.workspaceCacheRoot).not.toBe(layout.workspaceCacheRoot);
});

test('cache-only resolution requires and validates the canonical state/cache pair', () => {
  const completeEnvironment = {
    SEC_STATE_HOME: '/runtime/sec-state',
    SEC_CACHE_HOME: '/runtime/sec-cache'
  };
  const layout = resolveSecRuntimeCacheLayoutV1({
    platform: 'linux',
    environment: completeEnvironment,
    repository: 'sec-platform/sec',
    repositoryRoot: '/work/sec'
  });
  expect(layout.cacheRoot).toBe('/runtime/sec-cache');
  expect(resolveSecRuntimeCacheRootV1({
    platform: 'linux',
    environment: completeEnvironment,
    repositoryRoot: '/work/sec'
  })).toBe('/runtime/sec-cache');

  expect(() => resolveSecRuntimeCacheLayoutV1({
    platform: 'linux',
    environment: { SEC_CACHE_HOME: '/runtime/sec-cache' },
    repositoryRoot: '/work/sec'
  })).toThrow('HOME is required when SEC_STATE_HOME and XDG_STATE_HOME are unset');
  expect(() => resolveSecRuntimeCacheRootV1({
    platform: 'win32',
    environment: { SEC_CACHE_HOME: 'C:\\runtime\\sec-cache', HOME: 'C:\\Users\\Sec' },
    repositoryRoot: 'D:\\Project\\sec'
  })).toThrow('LOCALAPPDATA is required on Windows when SEC_STATE_HOME is unset');
});

test('cache-only resolution rejects equal and nested state/cache roots in both directions', () => {
  const base = {
    platform: 'linux' as const,
    repository: 'sec-platform/sec',
    repositoryRoot: '/work/sec'
  };
  for (const environment of [
    { SEC_STATE_HOME: '/runtime/sec', SEC_CACHE_HOME: '/runtime/sec' },
    { SEC_STATE_HOME: '/runtime/sec', SEC_CACHE_HOME: '/runtime/sec/cache' },
    { SEC_STATE_HOME: '/runtime/sec/state', SEC_CACHE_HOME: '/runtime/sec' }
  ]) {
    expect(() => resolveSecRuntimeCacheLayoutV1({ ...base, environment })).toThrow('physically disjoint');
    expect(() => resolveSecRuntimeCacheRootV1({
      platform: base.platform,
      environment,
      repositoryRoot: base.repositoryRoot
    })).toThrow('physically disjoint');
  }
});

test('Windows cache-only root validation is case-insensitive and normalizes equivalent or nested paths', () => {
  const base = {
    platform: 'win32' as const,
    repository: 'sec-platform/sec',
    repositoryRoot: 'D:\\Project\\sec'
  };
  const valid = resolveSecRuntimeCacheLayoutV1({
    ...base,
    environment: {
      SEC_STATE_HOME: 'C:\\Runtime\\SEC\\state\\..\\State',
      SEC_CACHE_HOME: 'c:\\runtime\\sec\\cache'
    }
  });
  expect(valid.cacheRoot).toBe('c:\\runtime\\sec\\cache');

  for (const environment of [
    {
      SEC_STATE_HOME: 'C:\\Runtime\\SEC\\state\\..\\State',
      SEC_CACHE_HOME: 'c:\\runtime\\sec\\STATE'
    },
    {
      SEC_STATE_HOME: 'C:\\Runtime\\SEC\\State',
      SEC_CACHE_HOME: 'c:\\runtime\\sec\\state\\cache'
    },
    {
      SEC_STATE_HOME: 'C:\\Runtime\\SEC\\State\\nested',
      SEC_CACHE_HOME: 'c:\\runtime\\sec\\state'
    }
  ]) {
    expect(() => resolveSecRuntimeCacheLayoutV1({ ...base, environment })).toThrow('physically disjoint');
  }
});
