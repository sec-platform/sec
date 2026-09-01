import { expect, test } from 'bun:test';

import { createSecWorkspaceLocatorKey, resolveSecRuntimeRoots, resolveSecRuntimeStateLayout } from '../../src/runtime-state/workspace-state/layout.ts';

const WORKSPACE_IDENTITY = Object.freeze({
  device: 'device-1',
  inode: 'inode-1',
  objectId: 'object-1'
});

test('Linux runtime state follows XDG defaults and separates repository/runtime/cache domains', () => {
  const layout = resolveSecRuntimeStateLayout({
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
  expect(layout.repositoryStateRoot.startsWith('/work/sec/')).toBe(false);
});

test('Windows runtime state uses LOCALAPPDATA with case-insensitive physical workspace identity', () => {
  const environment = { LOCALAPPDATA: 'C:\\Users\\Sec\\AppData\\Local' };
  const first = resolveSecRuntimeStateLayout({
    platform: 'win32',
    environment,
    repository: 'sec-platform/sec',
    repositoryRoot: 'D:\\Project\\SEC',
    workspacePhysicalIdentity: WORKSPACE_IDENTITY
  });
  const second = resolveSecRuntimeStateLayout({
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
  const original = resolveSecRuntimeStateLayout({
    ...common,
    workspacePhysicalIdentity: WORKSPACE_IDENTITY
  });
  const replacement = resolveSecRuntimeStateLayout({
    ...common,
    workspacePhysicalIdentity: { ...WORKSPACE_IDENTITY, inode: 'inode-2', objectId: 'object-2' }
  });
  expect(replacement.workspaceLocatorKey).not.toBe(original.workspaceLocatorKey);
  expect(replacement.workspaceKey).not.toBe(original.workspaceKey);
  expect(replacement.workspaceStateRoot).not.toBe(original.workspaceStateRoot);
});

test('explicit SEC roots are deterministic and workspace locator identity does not depend on repository name', () => {
  const roots = resolveSecRuntimeRoots({
    platform: 'linux',
    environment: { SEC_STATE_HOME: '/runtime/sec-state', SEC_CACHE_HOME: '/runtime/sec-cache' },
    repositoryRoot: '/work/sec',
    workspacePhysicalIdentity: WORKSPACE_IDENTITY
  });
  expect(roots.stateRoot).toBe('/runtime/sec-state');
  expect(roots.cacheRoot).toBe('/runtime/sec-cache');
  expect(roots.testProcessTempLeaseRoot).toBe(
    `/runtime/sec-state/workspaces/v1/${roots.workspaceLocatorKey.slice(7)}/test-process-temp/v1`
  );
  expect(roots.workspaceLocatorKey).toBe(createSecWorkspaceLocatorKey({
    workspacePhysicalIdentity: WORKSPACE_IDENTITY
  }));
  const left = resolveSecRuntimeStateLayout({
    platform: 'linux', environment: { SEC_STATE_HOME: '/runtime/sec-state', SEC_CACHE_HOME: '/runtime/sec-cache' },
    repository: 'sec-platform/sec', repositoryRoot: '/work/sec',
    workspacePhysicalIdentity: WORKSPACE_IDENTITY
  });
  const right = resolveSecRuntimeStateLayout({
    platform: 'linux', environment: { SEC_STATE_HOME: '/runtime/sec-state', SEC_CACHE_HOME: '/runtime/sec-cache' },
    repository: 'other/repository', repositoryRoot: '/work/sec',
    workspacePhysicalIdentity: WORKSPACE_IDENTITY
  });
  expect(left.workspaceLocatorKey).toBe(right.workspaceLocatorKey);
  expect(left.workspaceStateRoot).toBe(right.workspaceStateRoot);
  expect(left.repositoryKey).not.toBe(right.repositoryKey);
});

test('runtime state and cache roots inside the repository are rejected', () => {
  expect(() => resolveSecRuntimeStateLayout({
    platform: 'linux',
    environment: { SEC_STATE_HOME: '/work/sec/.state', SEC_CACHE_HOME: '/runtime/cache' },
    repository: 'sec-platform/sec',
    repositoryRoot: '/work/sec',
    workspacePhysicalIdentity: WORKSPACE_IDENTITY
  })).toThrow('outside the repository worktree');
  expect(() => resolveSecRuntimeStateLayout({
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
    expect(() => resolveSecRuntimeStateLayout({
      platform: 'linux',
      environment,
      repository: 'sec-platform/sec',
      repositoryRoot: '/work/sec',
      workspacePhysicalIdentity: WORKSPACE_IDENTITY
    })).toThrow('physically disjoint');
  }
});
