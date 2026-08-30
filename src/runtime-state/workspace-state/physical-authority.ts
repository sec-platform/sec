import { chmodSync, lstatSync } from 'node:fs';
import path from 'node:path';

import { assertPhysicallyDisjointDirectoryChains, assertSameNoFollowDirectoryIdentity, createNoFollowOrdinaryDirectoryChain, inspectExactNoFollowDirectoryPresence, inspectNoFollowDirectoryChain, physicallyContainsDirectoryChain, type PhysicalDirectoryChain, type PhysicalDirectoryIdentity } from '../physical/runtime/physical-no-follow.ts';
import {
  hardenExistingWindowsHostDirectoryAuthority,
  WindowsHostDirectoryAuthorityError,
  type WindowsHostDirectoryAuthority
} from '../physical/runtime/windows-host-filesystem-authority.ts';
import { resolveSecWorkspaceRuntimeRoots } from './paths.ts';

export interface SecRuntimeStatePhysicalAuthority {
  readonly stateRoot: PhysicalDirectoryIdentity;
  readonly cacheRoot: PhysicalDirectoryIdentity;
  readonly directory: (absolutePath: string) => PhysicalDirectoryIdentity;
  readonly directoryChain: (absolutePath: string) => PhysicalDirectoryChain;
  readonly assertCurrent: () => Promise<void>;
  readonly release: () => Promise<void>;
}

export interface SecRuntimeCachePhysicalAuthority {
  readonly cacheRoot: PhysicalDirectoryIdentity;
  readonly directory: (absolutePath: string) => PhysicalDirectoryIdentity;
  readonly assertCurrent: () => void;
}

type WindowsRuntimeStateAuthorityGeneration = {
  readonly key: string;
  readonly authority: Promise<WindowsHostDirectoryAuthority>;
  references: number;
  state: 'active' | 'retired';
  retirement?: Promise<void>;
};

type WindowsRuntimeStateAuthorityCapability = Readonly<{
  assertCurrent: () => Promise<void>;
  release: () => Promise<void>;
}>;

/**
 * Process-local reuse index only. The generation and its native session own
 * authority; every capability consumption revalidates that generation.
 */
const windowsRuntimeStateAuthorityGenerations =
  new Map<string, WindowsRuntimeStateAuthorityGeneration>();

function windowsRuntimeStateAuthorityKey(rootPath: string): string {
  return path.win32.resolve(rootPath).toLocaleLowerCase('en-US');
}

async function retireWindowsRuntimeStateAuthorityGeneration(
  generation: WindowsRuntimeStateAuthorityGeneration
): Promise<void> {
  if (generation.state === 'active') {
    generation.state = 'retired';
    if (windowsRuntimeStateAuthorityGenerations.get(generation.key) === generation) {
      windowsRuntimeStateAuthorityGenerations.delete(generation.key);
    }
    generation.retirement = generation.authority.then(
      (authority) => authority.release(),
      () => undefined
    );
  }
  await generation.retirement;
}

async function revalidateWindowsRuntimeStateAuthorityGeneration(
  generation: WindowsRuntimeStateAuthorityGeneration
): Promise<void> {
  if (generation.state !== 'active' ||
    windowsRuntimeStateAuthorityGenerations.get(generation.key) !== generation) {
    throw new WindowsHostDirectoryAuthorityError(
      'session-closed',
      'Windows Runtime State authority generation is retired'
    );
  }
  try {
    const authority = await generation.authority;
    if (generation.state !== 'active' ||
      windowsRuntimeStateAuthorityGenerations.get(generation.key) !== generation) {
      throw new WindowsHostDirectoryAuthorityError(
        'session-closed',
        'Windows Runtime State authority generation is retired'
      );
    }
    await authority.assertCurrent();
  } catch (error) {
    await retireWindowsRuntimeStateAuthorityGeneration(generation);
    throw error;
  }
}

async function acquireWindowsRuntimeStateAuthorityCapability(
  rootPath: string,
  knownNew: boolean
): Promise<WindowsRuntimeStateAuthorityCapability> {
  const key = windowsRuntimeStateAuthorityKey(rootPath);
  let generation = windowsRuntimeStateAuthorityGenerations.get(key);
  if (generation === undefined) {
    generation = {
      key,
      authority: hardenExistingWindowsHostDirectoryAuthority(rootPath, { knownNew }),
      references: 0,
      state: 'active'
    };
    windowsRuntimeStateAuthorityGenerations.set(key, generation);
    try {
      await generation.authority;
    } catch (error) {
      await retireWindowsRuntimeStateAuthorityGeneration(generation);
      throw error;
    }
  } else {
    await revalidateWindowsRuntimeStateAuthorityGeneration(generation);
  }
  const acquiredGeneration = generation;
  if (acquiredGeneration.state !== 'active' ||
    windowsRuntimeStateAuthorityGenerations.get(acquiredGeneration.key) !== acquiredGeneration) {
    throw new WindowsHostDirectoryAuthorityError(
      'session-closed',
      'Windows Runtime State authority generation retired during acquisition'
    );
  }
  acquiredGeneration.references += 1;

  let released = false;
  return Object.freeze({
    assertCurrent: async (): Promise<void> => {
      if (released) {
        throw new WindowsHostDirectoryAuthorityError(
          'session-closed',
          'Windows Runtime State authority capability is released'
        );
      }
      await revalidateWindowsRuntimeStateAuthorityGeneration(acquiredGeneration);
    },
    release: async (): Promise<void> => {
      if (released) return;
      released = true;
      acquiredGeneration.references -= 1;
      if (acquiredGeneration.references === 0) {
        await retireWindowsRuntimeStateAuthorityGeneration(acquiredGeneration);
      }
    }
  });
}

function assertPhysicallyDisjoint(
  left: PhysicalDirectoryChain,
  right: PhysicalDirectoryChain,
  label: string
): void {
  assertPhysicallyDisjointDirectoryChains(left, right, `SEC runtime state ${label}`);
}

type PhysicalDirectoryMaterializationPlan = Readonly<{
  targetPath: string;
  ancestor: PhysicalDirectoryIdentity;
  missingSegments: readonly string[];
}>;

function planPhysicalDirectoryMaterialization(
  absolutePath: string,
  physicalRoot: PhysicalDirectoryChain,
  label: string
): PhysicalDirectoryMaterializationPlan {
  const targetPath = path.resolve(absolutePath);
  const missingSegments: string[] = [];
  let cursor = targetPath;
  for (;;) {
    const presence = inspectExactNoFollowDirectoryPresence(cursor, label);
    if (presence.state === 'present') {
      if (cursor === targetPath) {
        assertPhysicallyDisjoint(physicalRoot, presence.directory, label);
      } else if (physicallyContainsDirectoryChain(physicalRoot, presence.directory)) {
        throw new Error(`SEC runtime ${label} is physically inside the repository.`);
      }
      return Object.freeze({
        targetPath,
        ancestor: presence.directory.target,
        missingSegments: Object.freeze(missingSegments)
      });
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      throw new Error(`SEC runtime ${label} has no existing physical ancestor.`);
    }
    missingSegments.unshift(path.basename(cursor));
    cursor = parent;
  }
}

function samePhysicalIdentity(
  left: PhysicalDirectoryIdentity,
  right: PhysicalDirectoryIdentity
): boolean {
  return left.device === right.device
    && left.inode === right.inode
    && left.objectId === right.objectId;
}

function bindMaterializedDirectory(
  expected: PhysicalDirectoryIdentity,
  targetPath: string,
  label: string
): PhysicalDirectoryChain {
  const readback = inspectNoFollowDirectoryChain(targetPath, label);
  if (!samePhysicalIdentity(expected, readback.target)) {
    throw new Error(`SEC runtime ${label} identity differs from the retained materialization capability.`);
  }
  return readback;
}

function materializePlannedPhysicalDirectory(
  plan: PhysicalDirectoryMaterializationPlan,
  label: string
): PhysicalDirectoryChain {
  const target = plan.missingSegments.length === 0
    ? assertSameNoFollowDirectoryIdentity(plan.ancestor, `${label} retained target`).target
    : createNoFollowOrdinaryDirectoryChain(plan.ancestor, plan.missingSegments);
  return bindMaterializedDirectory(target, plan.targetPath, `${label} readback`);
}

function materializeWithinPhysicalAuthority(
  authorityRoot: PhysicalDirectoryIdentity,
  absolutePath: string,
  label: string
): PhysicalDirectoryChain {
  const targetPath = path.resolve(absolutePath);
  if (!pathInside(targetPath, authorityRoot.path)) {
    throw new Error(`SEC runtime ${label} escapes its physical authority.`);
  }
  const relative = path.relative(authorityRoot.path, targetPath);
  const segments = relative === '' ? [] : relative.split(path.sep);
  const target = segments.length === 0
    ? assertSameNoFollowDirectoryIdentity(authorityRoot, `${label} authority root`).target
    : createNoFollowOrdinaryDirectoryChain(authorityRoot, segments);
  return bindMaterializedDirectory(target, targetPath, `${label} readback`);
}

function hardenPosixDirectory(directory: PhysicalDirectoryIdentity): PhysicalDirectoryIdentity {
  const before = assertSameNoFollowDirectoryIdentity(
    directory,
    'SEC runtime private directory before permission hardening'
  ).target;
  chmodSync(directory.path, 0o700);
  const current = inspectNoFollowDirectoryChain(
    directory.path,
    'SEC runtime private directory readback'
  ).target;
  // Linux objectId includes mutable mode material. chmod is the authorized
  // transition here; the stable filesystem object must remain dev/inode exact.
  if (before.device !== current.device || before.inode !== current.inode) {
    throw new Error('SEC runtime private directory identity changed during permission hardening.');
  }
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
export function acquireSecRuntimeCachePhysicalAuthority(input: Readonly<{
  repositoryRoot: string;
  cacheRoot: string;
  requiredDirectories: readonly string[];
}>): SecRuntimeCachePhysicalAuthority {
  const repository = inspectNoFollowDirectoryChain(
    path.resolve(input.repositoryRoot),
    'SEC runtime repository root'
  );
  const cachePlan = planPhysicalDirectoryMaterialization(
    input.cacheRoot, repository, 'cache root planned location'
  );
  let cache = materializePlannedPhysicalDirectory(cachePlan, 'cache root materialization');
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

  const directories = new Map<string, PhysicalDirectoryIdentity>();
  const cacheRootPath = path.resolve(input.cacheRoot);
  for (const directoryPath of requested.sort((left, right) =>
    left.split(path.sep).length - right.split(path.sep).length || left.localeCompare(right))) {
    const authorityRoot = directories.get(cacheRootPath) ?? cache.target;
    let directory = materializeWithinPhysicalAuthority(authorityRoot, directoryPath, 'cache directory');
    assertPhysicallyDisjoint(repository, directory, `cache directory ${directoryPath} and repository`);
    let target = directory.target;
    if (process.platform === 'linux') {
      target = hardenPosixDirectory(target);
    } else if (process.platform === 'win32') {
      target = inspectNoFollowDirectoryChain(
        target.path,
        'SEC runtime Windows cache directory readback'
      ).target;
    } else {
      throw new Error('SEC runtime cache physical authority is unavailable on this platform.');
    }
    const directoryChain = bindMaterializedDirectory(
      target, directoryPath, 'cache directory authority'
    );
    directories.set(path.resolve(directoryPath), directoryChain.target);
  }

  cache = inspectNoFollowDirectoryChain(path.resolve(input.cacheRoot), 'SEC runtime cache root');
  assertPhysicallyDisjoint(repository, cache, 'cache root and repository');
  const assertCurrent = (): void => {
    for (const [directoryPath, expected] of directories) {
      const observed = assertSameNoFollowDirectoryIdentity(
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
    directory: (absolutePath: string): PhysicalDirectoryIdentity => {
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
export async function acquireSecRuntimeStatePhysicalAuthority(input: Readonly<{
  repositoryRoot: string;
  stateRoot: string;
  cacheRoot: string;
  requiredDirectories: readonly string[];
}>): Promise<SecRuntimeStatePhysicalAuthority> {
  const stateRootWasPresent = inspectExactNoFollowDirectoryPresence(
    path.resolve(input.stateRoot),
    'SEC runtime state root before materialization'
  ).state === 'present';
  const repository = inspectNoFollowDirectoryChain(
    path.resolve(input.repositoryRoot),
    'SEC runtime repository root'
  );
  const statePlan = planPhysicalDirectoryMaterialization(
    input.stateRoot, repository, 'state root planned location'
  );
  const cachePlan = planPhysicalDirectoryMaterialization(
    input.cacheRoot, repository, 'cache root planned location'
  );
  let state = materializePlannedPhysicalDirectory(statePlan, 'state root materialization');
  let cache = materializePlannedPhysicalDirectory(cachePlan, 'cache root materialization');
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

  const directories = new Map<string, PhysicalDirectoryIdentity>();
  const directoryChains = new Map<string, PhysicalDirectoryChain>();
  const stateRootPath = path.resolve(input.stateRoot);
  const cacheRootPath = path.resolve(input.cacheRoot);
  const windowsAuthorities: WindowsRuntimeStateAuthorityCapability[] = [];
  try {
    for (const directoryPath of requested.sort((left, right) =>
      left.split(path.sep).length - right.split(path.sep).length || left.localeCompare(right))) {
      const authorityRoot = pathInside(directoryPath, stateRootPath)
        ? directories.get(stateRootPath) ?? state.target
        : directories.get(cacheRootPath) ?? cache.target;
      let directory = materializeWithinPhysicalAuthority(
        authorityRoot, directoryPath, 'state/cache directory'
      ).target;
      if (process.platform === 'win32' && directoryPath === path.resolve(input.stateRoot)) {
        windowsAuthorities.push(await acquireWindowsRuntimeStateAuthorityCapability(
          directory.path,
          !stateRootWasPresent
        ));
        directory = inspectNoFollowDirectoryChain(
          directory.path,
          'SEC runtime Windows authority readback'
        ).target;
      } else if (process.platform === 'win32') {
        directory = inspectNoFollowDirectoryChain(
          directory.path,
          'SEC runtime Windows descendant readback'
        ).target;
      } else if (process.platform === 'linux') {
        directory = hardenPosixDirectory(directory);
      } else {
        throw new Error('SEC runtime physical authority is unavailable on this platform.');
      }
      const directoryChain = bindMaterializedDirectory(
        directory, directoryPath, 'state/cache directory authority'
      );
      directories.set(path.resolve(directoryPath), directoryChain.target);
      directoryChains.set(path.resolve(directoryPath), directoryChain);
    }

    state = inspectNoFollowDirectoryChain(path.resolve(input.stateRoot), 'SEC runtime state root');
    cache = inspectNoFollowDirectoryChain(path.resolve(input.cacheRoot), 'SEC runtime cache root');
    assertPhysicallyDisjoint(repository, state, 'durable state root and repository');
    assertPhysicallyDisjoint(repository, cache, 'cache root and repository');
    assertPhysicallyDisjoint(state, cache, 'durable state and cache roots');

    let released = false;
    const current = async (): Promise<void> => {
      if (released) {
        throw new WindowsHostDirectoryAuthorityError(
          'session-closed',
          'SEC Runtime State physical authority is released'
        );
      }
      for (const [directoryPath, expected] of directories) {
        const observed = assertSameNoFollowDirectoryIdentity(
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
      for (const authority of windowsAuthorities) {
        await authority.assertCurrent();
      }
    };

    const release = async (): Promise<void> => {
      if (released) return;
      released = true;
      for (const authority of windowsAuthorities) {
        await authority.release();
      }
    };

    return Object.freeze({
      stateRoot: directories.get(path.resolve(input.stateRoot))!,
      cacheRoot: directories.get(path.resolve(input.cacheRoot))!,
      directory: (absolutePath: string): PhysicalDirectoryIdentity => {
        if (released) {
          throw new WindowsHostDirectoryAuthorityError(
            'session-closed',
            'SEC Runtime State physical authority is released'
          );
        }
        const value = directories.get(path.resolve(absolutePath));
        if (value === undefined) {
          throw new Error('SEC runtime directory is outside the acquired physical authority.');
        }
        return value;
      },
      directoryChain: (absolutePath: string): PhysicalDirectoryChain => {
        if (released) {
          throw new WindowsHostDirectoryAuthorityError(
            'session-closed',
            'SEC Runtime State physical authority is released'
          );
        }
        const value = directoryChains.get(path.resolve(absolutePath));
        if (value === undefined) {
          throw new Error('SEC runtime directory chain is outside the acquired physical authority.');
        }
        return value;
      },
      assertCurrent: current,
      release
    });
  } catch (error) {
    for (const authority of windowsAuthorities) {
      await authority.release();
    }
    throw error;
  }
}

/** Acquires the one shared physical root used by both durable journal families. */
export async function acquireSecRuntimeJournalAuthority(input: Readonly<{
  repositoryRoot: string;
  environment?: NodeJS.ProcessEnv;
}>): Promise<SecRuntimeStatePhysicalAuthority> {
  const roots = resolveSecWorkspaceRuntimeRoots({
    repositoryRoot: input.repositoryRoot,
    environment: input.environment ?? process.env
  });
  return acquireSecRuntimeStatePhysicalAuthority({
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
