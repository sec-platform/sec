import { expect, test } from 'bun:test';

import {
  createSecWorkspaceLocatorKeyV1,
  resolveSecRuntimeRootsV1,
  resolveSecRuntimeStateLayoutV1
} from '../../platform/shared/sec-runtime-state-contract.ts';

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
