import { lstatSync } from 'node:fs';
import path from 'node:path';

import {
  assertPhysicallyDisjointDirectoryChainsV1,
  assertSameNoFollowDirectoryIdentityV1,
  createNoFollowOrdinaryDirectoryChainV1,
  hardenRetainedNoFollowDirectoryModeV1,
  inspectExactNoFollowDirectoryPresenceV1,
  inspectNoFollowDirectoryChainV1,
  type PhysicalDirectoryChainV1,
  type PhysicalDirectoryIdentityV1
} from '../../platform/shared/physical-no-follow.ts';
import {
  hardenExistingWindowsHostDirectoryAuthorityV1,
  type WindowsHostDirectoryAuthority
} from '../../platform/shared/windows-host-filesystem-authority.ts';
import { resolveSecWorkspaceRuntimeRootsV1 } from './runtime-state-paths.ts';

export interface SecRuntimeStatePhysicalAuthorityV1 {
  readonly stateRoot: PhysicalDirectoryIdentityV1;
  readonly cacheRoot: PhysicalDirectoryIdentityV1;
  readonly directory: (absolutePath: string) => PhysicalDirectoryIdentityV1;
  readonly assertCurrent: () => Promise<void>;
}

export interface SecRuntimeCachePhysicalAuthorityV1 {
  readonly cacheRoot: PhysicalDirectoryIdentityV1;
  readonly directory: (absolutePath: string) => PhysicalDirectoryIdentityV1;
  readonly assertCurrent: () => void;
}

const windowsRuntimeStateAuthorities = new Map<string, Promise<WindowsHostDirectoryAuthority>>();

function assertPhysicallyDisjoint(
  left: PhysicalDirectoryChainV1,
  right: PhysicalDirectoryChainV1,
  label: string
): void {
  assertPhysicallyDisjointDirectoryChainsV1(left, right, `SEC runtime state ${label}`);
}

function materializePhysicalDirectory(absolutePath: string): PhysicalDirectoryChainV1 {
  const target = path.resolve(absolutePath);
  const missing: string[] = [];
  let cursor = target;
  for (;;) {
    const presence = inspectExactNoFollowDirectoryPresenceV1(cursor, 'SEC runtime directory');
    if (presence.state === 'present') {
      if (missing.length > 0) {
        createNoFollowOrdinaryDirectoryChainV1(presence.directory.target, missing);
      }
      return inspectNoFollowDirectoryChainV1(target, 'SEC runtime directory readback');
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      throw new Error('SEC runtime directory has no existing physical ancestor.');
    }
    missing.unshift(path.basename(cursor));
    cursor = parent;
  }
}

function hardenPosixDirectory(directory: PhysicalDirectoryIdentityV1): PhysicalDirectoryIdentityV1 {
  const current = hardenRetainedNoFollowDirectoryModeV1(
    directory,
    0o700,
    'SEC runtime private directory'
  );
  const metadata = lstatSync(current.path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw new Error('SEC runtime private directory must be owner-only.');
  }
  return current;
}

function pathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!path.isAbsolute(relative)
    && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

/**
 * Acquires only disposable Runtime Cache authority. This is intentionally
 * separate from durable Runtime State issuance: short-lived read-only tools
 * must not create the state root or pay the Windows state-DACL issuance cost.
 */
export function acquireSecRuntimeCachePhysicalAuthorityV1(input: Readonly<{
  repositoryRoot: string;
  cacheRoot: string;
  requiredDirectories: readonly string[];
}>): SecRuntimeCachePhysicalAuthorityV1 {
  const repository = inspectNoFollowDirectoryChainV1(
    path.resolve(input.repositoryRoot),
    'SEC runtime repository root'
  );
  let cache = materializePhysicalDirectory(input.cacheRoot);
  assertPhysicallyDisjoint(repository, cache, 'cache root and repository');

  const requested = [...new Set([
    path.resolve(input.cacheRoot),
    ...input.requiredDirectories.map((entry) => path.resolve(entry))
  ])];
  for (const directoryPath of requested) {
    if (!pathInside(directoryPath, input.cacheRoot)) {
      throw new Error('SEC runtime required directory escapes cache authority.');
    }
  }

  const directories = new Map<string, PhysicalDirectoryIdentityV1>();
  for (const directoryPath of requested.sort((left, right) =>
    left.split(path.sep).length - right.split(path.sep).length || left.localeCompare(right))) {
    let directory = materializePhysicalDirectory(directoryPath);
    assertPhysicallyDisjoint(repository, directory, `cache directory ${directoryPath} and repository`);
    let target = directory.target;
    if (process.platform === 'linux') {
      target = hardenPosixDirectory(target);
    } else if (process.platform === 'win32') {
      target = inspectNoFollowDirectoryChainV1(
        target.path,
        'SEC runtime Windows cache directory readback'
      ).target;
    } else {
      throw new Error('SEC runtime cache physical authority is unavailable on this platform.');
    }
    directories.set(path.resolve(directoryPath), target);
  }

  cache = inspectNoFollowDirectoryChainV1(path.resolve(input.cacheRoot), 'SEC runtime cache root');
  assertPhysicallyDisjoint(repository, cache, 'cache root and repository');
  const assertCurrent = (): void => {
    for (const [directoryPath, expected] of directories) {
      const observed = assertSameNoFollowDirectoryIdentityV1(
        expected,
        `SEC runtime cache directory ${directoryPath}`
      ).target;
      if (process.platform === 'linux') {
        const metadata = lstatSync(observed.path);
        if ((metadata.mode & 0o077) !== 0) {
          throw new Error('SEC runtime private cache directory permissions changed.');
        }
      }
    }
  };

  return Object.freeze({
    cacheRoot: directories.get(path.resolve(input.cacheRoot))!,
    directory: (absolutePath: string): PhysicalDirectoryIdentityV1 => {
      const value = directories.get(path.resolve(absolutePath));
      if (value === undefined) {
        throw new Error('SEC runtime directory is outside the acquired cache authority.');
      }
      return value;
    },
    assertCurrent
  });
}

/**
 * Binds lexical Runtime State layout to physical, non-reparse directories and
 * owner-only permissions before any state read or write. The pure path
 * contract deliberately remains effect-free; this tooling owner is its sole
 * host-filesystem authority.
 */
export async function acquireSecRuntimeStatePhysicalAuthorityV1(input: Readonly<{
  repositoryRoot: string;
  stateRoot: string;
  cacheRoot: string;
  requiredDirectories: readonly string[];
}>): Promise<SecRuntimeStatePhysicalAuthorityV1> {
  const stateRootWasPresent = inspectExactNoFollowDirectoryPresenceV1(
    path.resolve(input.stateRoot),
    'SEC runtime state root before materialization'
  ).state === 'present';
  const repository = inspectNoFollowDirectoryChainV1(
    path.resolve(input.repositoryRoot),
    'SEC runtime repository root'
  );
  let state = materializePhysicalDirectory(input.stateRoot);
  let cache = materializePhysicalDirectory(input.cacheRoot);
  assertPhysicallyDisjoint(repository, state, 'durable state root and repository');
  assertPhysicallyDisjoint(repository, cache, 'cache root and repository');
  assertPhysicallyDisjoint(state, cache, 'durable state and cache roots');

  const requested = [...new Set([
    path.resolve(input.stateRoot),
    path.resolve(input.cacheRoot),
    ...input.requiredDirectories.map((entry) => path.resolve(entry))
  ])];
  for (const directoryPath of requested) {
    if (!pathInside(directoryPath, input.stateRoot)
      && !pathInside(directoryPath, input.cacheRoot)) {
      throw new Error('SEC runtime required directory escapes state/cache authority.');
    }
  }

  const directories = new Map<string, PhysicalDirectoryIdentityV1>();
  const windowsAuthorities: WindowsHostDirectoryAuthority[] = [];
  for (const directoryPath of requested.sort((left, right) =>
    left.split(path.sep).length - right.split(path.sep).length || left.localeCompare(right))) {
    let directory = materializePhysicalDirectory(directoryPath).target;
    if (process.platform === 'win32' && directoryPath === path.resolve(input.stateRoot)) {
      const cached = windowsRuntimeStateAuthorities.get(directory.path);
      if (cached !== undefined) {
        windowsAuthorities.push(await cached);
      } else {
        const pending = hardenExistingWindowsHostDirectoryAuthorityV1(
          directory.path,
          { knownNew: !stateRootWasPresent }
        )
          .catch((error) => {
            windowsRuntimeStateAuthorities.delete(directory.path);
            throw error;
          });
        windowsRuntimeStateAuthorities.set(directory.path, pending);
        const authority = await pending;
        windowsAuthorities.push(authority);
      }
      directory = inspectNoFollowDirectoryChainV1(
        directory.path,
        'SEC runtime Windows authority readback'
      ).target;
    } else if (process.platform === 'win32') {
      directory = inspectNoFollowDirectoryChainV1(
        directory.path,
        'SEC runtime Windows descendant readback'
      ).target;
    } else if (process.platform === 'linux') {
      directory = hardenPosixDirectory(directory);
    } else {
      throw new Error('SEC runtime physical authority is unavailable on this platform.');
    }
    directories.set(path.resolve(directoryPath), directory);
  }

  state = inspectNoFollowDirectoryChainV1(path.resolve(input.stateRoot), 'SEC runtime state root');
  cache = inspectNoFollowDirectoryChainV1(path.resolve(input.cacheRoot), 'SEC runtime cache root');
  assertPhysicallyDisjoint(repository, state, 'durable state root and repository');
  assertPhysicallyDisjoint(repository, cache, 'cache root and repository');
  assertPhysicallyDisjoint(state, cache, 'durable state and cache roots');

  const current = async (): Promise<void> => {
    for (const [directoryPath, expected] of directories) {
      const observed = assertSameNoFollowDirectoryIdentityV1(
        expected,
        `SEC runtime directory ${directoryPath}`
      ).target;
      if (process.platform === 'linux') {
        const metadata = lstatSync(observed.path);
        if ((metadata.mode & 0o077) !== 0) {
          throw new Error('SEC runtime private directory permissions changed.');
        }
      }
    }
    // The issued Windows DACL admits only the current owner, SYSTEM and local
    // administrators as capability writers. Those principals can already
    // mutate this process and its files, so repeated PowerShell startup cannot
    // strengthen the boundary; retained physical identity is the live check.
    // ACL drift by an untrusted principal is impossible without first crossing
    // the proved DACL. A new process proves/hardens the root again at issuance.
    void windowsAuthorities;
  };

  return Object.freeze({
    stateRoot: directories.get(path.resolve(input.stateRoot))!,
    cacheRoot: directories.get(path.resolve(input.cacheRoot))!,
    directory: (absolutePath: string): PhysicalDirectoryIdentityV1 => {
      const value = directories.get(path.resolve(absolutePath));
      if (value === undefined) {
        throw new Error('SEC runtime directory is outside the acquired physical authority.');
      }
      return value;
    },
    assertCurrent: current
  });
}

/** Acquires the one shared physical root used by both durable journal families. */
export async function acquireSecRuntimeJournalAuthorityV1(input: Readonly<{
  repositoryRoot: string;
  environment?: NodeJS.ProcessEnv;
}>): Promise<SecRuntimeStatePhysicalAuthorityV1> {
  const roots = resolveSecWorkspaceRuntimeRootsV1({
    repositoryRoot: input.repositoryRoot,
    environment: input.environment ?? process.env
  });
  return acquireSecRuntimeStatePhysicalAuthorityV1({
    repositoryRoot: input.repositoryRoot,
    stateRoot: roots.stateRoot,
    cacheRoot: roots.cacheRoot,
    requiredDirectories: [
      roots.workspaceStateRoot,
      path.join(roots.workspaceStateRoot, 'verification-actions', 'v2'),
      path.join(roots.workspaceStateRoot, 'verification-sessions', 'v2')
    ]
  });
}
