import { chmodSync, lstatSync } from 'node:fs';
import path from 'node:path';

import { ResourceCompositeSettlementError } from '../../../execution/resource-settlement.ts';

import {
  assertPhysicallyDisjointDirectoryChains,
  assertSameNoFollowDirectoryIdentity,
  createNoFollowOrdinaryDirectoryChain,
  inspectExactNoFollowDirectoryPresence,
  inspectNoFollowDirectoryChain,
  physicallyContainsDirectoryChain,
  type PhysicalDirectoryChain,
  type PhysicalDirectoryIdentity
} from '../physical/runtime/physical-no-follow.ts';
import {
  hardenExistingWindowsHostDirectoryAuthority,
  WindowsHostDirectoryAuthorityError,
  type WindowsHostDirectoryAuthority
} from '../physical/runtime/windows-host-filesystem-authority.ts';
import {
  migrateRuntimeStateDirectoryGenerations,
  runtimeStateRootGenerationMigrations,
  runtimeStateWorkspaceGenerationMigrations,
  type RuntimeStateDirectoryMigrationSpec
} from './layout-migration.ts';
import { resolveWorkspaceRuntimeRoots } from './paths.ts';

export interface RuntimeStatePhysicalAuthority {
  readonly stateRoot: PhysicalDirectoryIdentity;
  readonly cacheRoot: PhysicalDirectoryIdentity;
  readonly directory: (absolutePath: string) => PhysicalDirectoryIdentity;
  readonly directoryChain: (absolutePath: string) => PhysicalDirectoryChain;
  /** Stable root/file-id proof that remains valid across owner-authorized child mutation. */
  readonly assertRootIdentityCurrent: () => void;
  readonly assertCurrent: (input?: Readonly<{ deadlineAtUnixMs?: number }>) => Promise<void>;
  readonly release: (input?: Readonly<{ deadlineAtUnixMs?: number }>) => Promise<void>;
}

export interface RuntimeCachePhysicalAuthority {
  readonly cacheRoot: PhysicalDirectoryIdentity;
  readonly directory: (absolutePath: string) => PhysicalDirectoryIdentity;
  readonly assertCurrent: () => void;
}

const issuedRuntimeStatePhysicalAuthorities = new WeakSet<object>();

async function settleWindowsHostDirectoryAuthorities(input: Readonly<{
  authorities: readonly WindowsRuntimeStateAuthorityCapability[];
  releaseInput?: Readonly<{ deadlineAtUnixMs?: number }>;
  primary?: Readonly<{ label: string; error: unknown }>;
}>): Promise<void> {
  const failures: Array<Readonly<{ label: string; error: unknown }>> = [];
  if (input.primary !== undefined) failures.push(input.primary);
  for (const [index, authority] of input.authorities.entries()) {
    try {
      await authority.release(input.releaseInput);
    } catch (error) {
      failures.push(Object.freeze({
        label: `windows-host-directory-authority[${index}]`,
        error
      }));
    }
  }
  if (failures.length === 0) return;
  if (failures.length === 1) throw failures[0]!.error;
  throw new ResourceCompositeSettlementError(failures);
}

class RuntimeStateAuthorityDeadlineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeStateAuthorityDeadlineError';
  }
}

function isRequestScopedAuthorityFailure(error: unknown): boolean {
  return error instanceof RuntimeStateAuthorityDeadlineError
    || (error instanceof WindowsHostDirectoryAuthorityError
      && (error.failure === 'deadline-exhausted' || error.failure === 'aborted'));
}

export function assertRuntimeStatePhysicalAuthority(authority: RuntimeStatePhysicalAuthority): void {
  if (!issuedRuntimeStatePhysicalAuthorities.has(authority)) {
    throw new Error('SEC Runtime State physical authority is not owner-issued.');
  }
}

type WindowsRuntimeStateAuthorityGeneration = {
  readonly key: string;
  readonly repositoryRoot: PhysicalDirectoryChain;
  readonly stateRoot: PhysicalDirectoryChain;
  readonly cacheRoot: PhysicalDirectoryChain;
  readonly directoryChains: Map<string, PhysicalDirectoryChain>;
  authority: Promise<WindowsHostDirectoryAuthority>;
  operationTail: Promise<void>;
  pendingOperations: number;
  references: number;
  state: 'active' | 'settling' | 'retired';
  retirement?: Promise<void>;
};

type WindowsRuntimeStateAuthorityCapability = Readonly<{
  assertCurrent: (input?: Readonly<{ deadlineAtUnixMs?: number }>) => Promise<void>;
  admitDirectories: (
    absolutePaths: readonly string[],
    input?: Readonly<{ deadlineAtUnixMs?: number }>
  ) => Promise<
    Readonly<{
      directories: ReadonlyMap<string, PhysicalDirectoryIdentity>;
      directoryChains: ReadonlyMap<string, PhysicalDirectoryChain>;
    }>
  >;
  release: (input?: Readonly<{ deadlineAtUnixMs?: number }>) => Promise<void>;
}>;

/**
 * Process-local reuse index only. The generation and its native session own
 * authority; every capability consumption revalidates that generation.
 */
const windowsRuntimeStateAuthorityGenerations = new Map<string, WindowsRuntimeStateAuthorityGeneration>();

/** Reuse is valid only for one exact hardening operation and physical root tuple. */
function windowsRuntimeStateAuthorityKey(
  rootPath: string,
  roots: Readonly<{
    repository: PhysicalDirectoryChain;
    state: PhysicalDirectoryChain;
    cache: PhysicalDirectoryChain;
  }>
): string {
  const identity = (directory: PhysicalDirectoryIdentity) => Object.freeze({
    device: directory.device,
    inode: directory.inode,
    objectId: directory.objectId
  });
  return JSON.stringify(Object.freeze({
    schema: 'sec-windows-runtime-state-authority-generation-key-v1',
    operation: path.win32.resolve(rootPath).toLocaleLowerCase('en-US'),
    repositoryRoot: identity(roots.repository.target),
    stateRoot: identity(roots.state.target),
    cacheRoot: identity(roots.cache.target)
  }));
}

async function settleWindowsRuntimeStateAuthorityGeneration(
  generation: WindowsRuntimeStateAuthorityGeneration,
  deadlineAtUnixMs?: number
): Promise<void> {
  if (generation.state === 'retired') return;
  if (deadlineAtUnixMs !== undefined
      && (!Number.isSafeInteger(deadlineAtUnixMs)
        || deadlineAtUnixMs <= Date.now()
        || generation.pendingOperations !== 0)) {
    throw new RuntimeStateAuthorityDeadlineError('Windows Runtime State authority cannot settle within its bounded deadline.');
  }
  if (generation.retirement !== undefined) {
    await generation.retirement;
    return;
  }
  // The last-reference owner changes state before its first await. Existing
  // admitted operations may finish; new joins and operations fail closed.
  generation.state = 'settling';
  const retirement = (async () => {
    await generation.operationTail;
    const authority = await generation.authority;
    await authority.release();
    generation.state = 'retired';
    if (windowsRuntimeStateAuthorityGenerations.get(generation.key) === generation) {
      windowsRuntimeStateAuthorityGenerations.delete(generation.key);
    }
  })();
  generation.retirement = retirement;
  try {
    await retirement;
  } catch (error) {
    // Keep the same generation and reference as the only recovery owner.
    // A retry starts another settlement attempt; no replacement generation
    // may join while this generation remains settling.
    if (generation.retirement === retirement) generation.retirement = undefined;
    throw error;
  }
}

function assertWindowsRuntimeStateAuthorityGenerationActive(generation: WindowsRuntimeStateAuthorityGeneration): void {
  if (generation.state !== 'active' || windowsRuntimeStateAuthorityGenerations.get(generation.key) !== generation) {
    throw new WindowsHostDirectoryAuthorityError('session-closed', 'Windows Runtime State authority generation is retired');
  }
}

async function withWindowsRuntimeStateAuthorityOperation<T>(
  generation: WindowsRuntimeStateAuthorityGeneration,
  operation: () => Promise<T>,
  deadlineAtUnixMs?: number
): Promise<T> {
  assertWindowsRuntimeStateAuthorityGenerationActive(generation);
  if (deadlineAtUnixMs !== undefined
      && (!Number.isSafeInteger(deadlineAtUnixMs) || deadlineAtUnixMs <= Date.now())) {
    throw new RuntimeStateAuthorityDeadlineError('Windows Runtime State authority operation deadline is invalid or expired.');
  }
  generation.pendingOperations += 1;
  const predecessor = generation.operationTail;
  let cancelled = false;
  let operationStarted = false;
  let cancellationFailure: RuntimeStateAuthorityDeadlineError | undefined;
  const execution = predecessor.then(async () => {
    if (cancelled) throw cancellationFailure;
    operationStarted = true;
    if (deadlineAtUnixMs !== undefined && Date.now() >= deadlineAtUnixMs) {
      throw new RuntimeStateAuthorityDeadlineError('Windows Runtime State authority operation deadline expired.');
    }
    if (generation.state === 'retired') {
      throw new WindowsHostDirectoryAuthorityError('session-closed', 'Windows Runtime State authority generation is retired');
    }
    const result = await operation();
    if (deadlineAtUnixMs !== undefined && Date.now() >= deadlineAtUnixMs) {
      throw new RuntimeStateAuthorityDeadlineError('Windows Runtime State authority operation settled after its deadline.');
    }
    return result;
  }).finally(() => {
    generation.pendingOperations -= 1;
  });
  generation.operationTail = execution.then(
    () => undefined,
    () => undefined
  );
  if (deadlineAtUnixMs === undefined) return execution;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      execution,
      new Promise<never>((_resolve, reject) => {
        deadlineTimer = setTimeout(() => {
          if (operationStarted) return;
          cancellationFailure = new RuntimeStateAuthorityDeadlineError(
            'Windows Runtime State authority operation deadline expired while queued.'
          );
          cancelled = true;
          reject(cancellationFailure);
        }, Math.max(0, deadlineAtUnixMs - Date.now()));
      })
    ]);
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
  }
}

async function revalidateWindowsRuntimeStateAuthorityGeneration(
  generation: WindowsRuntimeStateAuthorityGeneration,
  deadlineAtUnixMs?: number
): Promise<void> {
  try {
    await withWindowsRuntimeStateAuthorityOperation(generation, async () => {
      assertSameNoFollowDirectoryIdentity(generation.repositoryRoot.target, 'SEC repository stable root identity');
      assertSameNoFollowDirectoryIdentity(generation.stateRoot.target, 'SEC Runtime State stable root identity');
      assertSameNoFollowDirectoryIdentity(generation.cacheRoot.target, 'SEC Runtime Cache stable root identity');
      assertPhysicallyDisjoint(generation.repositoryRoot, generation.stateRoot, 'durable state root and repository');
      assertPhysicallyDisjoint(generation.repositoryRoot, generation.cacheRoot, 'cache root and repository');
      assertPhysicallyDisjoint(generation.stateRoot, generation.cacheRoot, 'durable state and cache roots');
      await (await generation.authority).assertCurrent(
        deadlineAtUnixMs === undefined ? undefined : { deadlineAtMs: deadlineAtUnixMs }
      );
    }, deadlineAtUnixMs);
  } catch (error) {
    if (isRequestScopedAuthorityFailure(error)) throw error;
    await settleWindowsRuntimeStateAuthorityGeneration(generation);
    throw error;
  }
}

async function acquireWindowsRuntimeStateAuthorityCapability(
  rootPath: string,
  knownNew: boolean,
  roots: Readonly<{
    repository: PhysicalDirectoryChain;
    state: PhysicalDirectoryChain;
    cache: PhysicalDirectoryChain;
  }>,
  deadlineAtUnixMs?: number
): Promise<WindowsRuntimeStateAuthorityCapability> {
  const key = windowsRuntimeStateAuthorityKey(rootPath, roots);
  let generation = windowsRuntimeStateAuthorityGenerations.get(key);
  if (generation === undefined) {
    generation = {
      key,
      repositoryRoot: roots.repository,
      stateRoot: roots.state,
      cacheRoot: roots.cache,
      directoryChains: new Map([
        [path.resolve(roots.state.target.path), roots.state],
        [path.resolve(roots.cache.target.path), roots.cache]
      ]),
      authority: hardenExistingWindowsHostDirectoryAuthority(rootPath, {
        knownNew,
        ...(deadlineAtUnixMs === undefined ? {} : { deadlineAtMs: deadlineAtUnixMs })
      }),
      operationTail: Promise.resolve(),
      pendingOperations: 0,
      references: 0,
      state: 'active'
    };
    windowsRuntimeStateAuthorityGenerations.set(key, generation);
    generation.references += 1;
    try {
      await generation.authority;
    } catch (error) {
      generation.references -= 1;
      generation.state = 'retired';
      if (windowsRuntimeStateAuthorityGenerations.get(key) === generation) {
        windowsRuntimeStateAuthorityGenerations.delete(key);
      }
      throw error;
    }
  } else {
    if (
      !samePhysicalIdentity(generation.repositoryRoot.target, roots.repository.target) ||
      !samePhysicalIdentity(generation.stateRoot.target, roots.state.target) ||
      !samePhysicalIdentity(generation.cacheRoot.target, roots.cache.target)
    ) {
      throw new WindowsHostDirectoryAuthorityError(
        'physical-identity-changed',
        'Windows Runtime State repository/state/cache root identity changed during acquisition'
      );
    }
    assertWindowsRuntimeStateAuthorityGenerationActive(generation);
    generation.references += 1;
  }
  const acquiredGeneration = generation;

  let released = false;
  let releasing = false;
  return Object.freeze({
    assertCurrent: async (input?: Readonly<{ deadlineAtUnixMs?: number }>): Promise<void> => {
      if (released || releasing) {
        throw new WindowsHostDirectoryAuthorityError('session-closed', 'Windows Runtime State authority capability is released');
      }
      await revalidateWindowsRuntimeStateAuthorityGeneration(acquiredGeneration, input?.deadlineAtUnixMs);
    },
    admitDirectories: async (absolutePaths, input) => {
      if (released || releasing) {
        throw new WindowsHostDirectoryAuthorityError('session-closed', 'Windows Runtime State authority capability is released');
      }
      try {
        return await withWindowsRuntimeStateAuthorityOperation(acquiredGeneration, async () => {
          assertSameNoFollowDirectoryIdentity(
            acquiredGeneration.repositoryRoot.target,
            'SEC repository root before Runtime State closure admission'
          );
          assertSameNoFollowDirectoryIdentity(acquiredGeneration.stateRoot.target, 'SEC Runtime State root before closure admission');
          assertSameNoFollowDirectoryIdentity(acquiredGeneration.cacheRoot.target, 'SEC Runtime Cache root before closure admission');
          const previousAuthority = await acquiredGeneration.authority;
          await previousAuthority.assertCurrent(
            input?.deadlineAtUnixMs === undefined ? undefined : { deadlineAtMs: input.deadlineAtUnixMs }
          );
          const nextDirectoryChains = new Map(acquiredGeneration.directoryChains);
          let stateMembershipChanged = false;
          const canonicalPaths = [...new Set(absolutePaths.map((entry) => path.resolve(entry)))].sort(
            (left, right) => left.split(path.sep).length - right.split(path.sep).length || left.localeCompare(right)
          );
          for (const directoryPath of canonicalPaths) {
            const stateDescendant = pathInside(directoryPath, acquiredGeneration.stateRoot.target.path);
            const cacheDescendant = pathInside(directoryPath, acquiredGeneration.cacheRoot.target.path);
            if (!stateDescendant && !cacheDescendant) {
              throw new Error('SEC runtime required directory escapes state/cache authority.');
            }
            const existing = nextDirectoryChains.get(directoryPath);
            if (existing !== undefined) {
              const readback = bindMaterializedDirectory(existing.target, directoryPath, 'Windows Runtime State admitted directory');
              nextDirectoryChains.set(directoryPath, readback);
              continue;
            }
            const presence = inspectExactNoFollowDirectoryPresence(
              directoryPath,
              'SEC Runtime State delta directory before owner materialization'
            );
            const authorityRoot = stateDescendant ? acquiredGeneration.stateRoot.target : acquiredGeneration.cacheRoot.target;
            const directoryChain =
              presence.state === 'present'
                ? bindMaterializedDirectory(presence.directory.target, directoryPath, 'Windows Runtime State existing delta directory')
                : materializeWithinPhysicalAuthority(authorityRoot, directoryPath, 'Windows Runtime State delta directory');
            if (stateDescendant && presence.state !== 'present') {
              stateMembershipChanged = true;
            }
            nextDirectoryChains.set(directoryPath, directoryChain);
          }
          if (stateMembershipChanged) {
            const replacementAuthority = await hardenExistingWindowsHostDirectoryAuthority(acquiredGeneration.stateRoot.target.path, {
              knownNew: false,
              ...(input?.deadlineAtUnixMs === undefined ? {} : { deadlineAtMs: input.deadlineAtUnixMs })
            });
            acquiredGeneration.authority = Promise.resolve(replacementAuthority);
            await previousAuthority.release();
          }
          acquiredGeneration.directoryChains.clear();
          for (const [directoryPath, directoryChain] of nextDirectoryChains) {
            acquiredGeneration.directoryChains.set(directoryPath, directoryChain);
          }
          const admittedDirectoryChains = new Map<string, PhysicalDirectoryChain>();
          const admittedDirectories = new Map<string, PhysicalDirectoryIdentity>();
          for (const directoryPath of canonicalPaths) {
            const directoryChain = acquiredGeneration.directoryChains.get(directoryPath)!;
            admittedDirectoryChains.set(directoryPath, directoryChain);
            admittedDirectories.set(directoryPath, directoryChain.target);
          }
          return Object.freeze({
            directories: admittedDirectories,
            directoryChains: admittedDirectoryChains
          });
        }, input?.deadlineAtUnixMs);
      } catch (error) {
        if (isRequestScopedAuthorityFailure(error)) throw error;
        await settleWindowsRuntimeStateAuthorityGeneration(acquiredGeneration);
        throw error;
      }
    },
    release: async (input?: Readonly<{ deadlineAtUnixMs?: number }>): Promise<void> => {
      if (released) return;
      if (releasing) {
        throw new WindowsHostDirectoryAuthorityError('session-closed', 'Windows Runtime State authority release is already in progress');
      }
      const deadlineAtUnixMs = input?.deadlineAtUnixMs;
      if (deadlineAtUnixMs !== undefined
          && (!Number.isSafeInteger(deadlineAtUnixMs) || deadlineAtUnixMs <= Date.now())) {
        throw new RuntimeStateAuthorityDeadlineError('Windows Runtime State authority settlement deadline is invalid or expired.');
      }
      if (deadlineAtUnixMs !== undefined && acquiredGeneration.pendingOperations !== 0) {
        throw new RuntimeStateAuthorityDeadlineError('Windows Runtime State authority still has operations pending at bounded settlement.');
      }
      releasing = true;
      try {
        if (acquiredGeneration.references === 1) {
          await settleWindowsRuntimeStateAuthorityGeneration(acquiredGeneration, deadlineAtUnixMs);
        } else if (deadlineAtUnixMs === undefined) {
          const admittedOperations = acquiredGeneration.operationTail;
          await admittedOperations;
        }
        acquiredGeneration.references -= 1;
        released = true;
      } finally {
        releasing = false;
      }
    }
  });
}

function assertPhysicallyDisjoint(left: PhysicalDirectoryChain, right: PhysicalDirectoryChain, label: string): void {
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

function samePhysicalIdentity(left: PhysicalDirectoryIdentity, right: PhysicalDirectoryIdentity): boolean {
  return left.device === right.device && left.inode === right.inode && left.objectId === right.objectId;
}

function bindMaterializedDirectory(expected: PhysicalDirectoryIdentity, targetPath: string, label: string): PhysicalDirectoryChain {
  const readback = inspectNoFollowDirectoryChain(targetPath, label);
  if (!samePhysicalIdentity(expected, readback.target)) {
    throw new Error(`SEC runtime ${label} identity differs from the retained materialization capability.`);
  }
  return readback;
}

function materializePlannedPhysicalDirectory(plan: PhysicalDirectoryMaterializationPlan, label: string): PhysicalDirectoryChain {
  const target =
    plan.missingSegments.length === 0
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
  const target =
    segments.length === 0
      ? assertSameNoFollowDirectoryIdentity(authorityRoot, `${label} authority root`).target
      : createNoFollowOrdinaryDirectoryChain(authorityRoot, segments);
  return bindMaterializedDirectory(target, targetPath, `${label} readback`);
}

function hardenPosixDirectory(directory: PhysicalDirectoryIdentity): PhysicalDirectoryIdentity {
  const before = assertSameNoFollowDirectoryIdentity(directory, 'SEC runtime private directory before permission hardening').target;
  chmodSync(directory.path, 0o700);
  const current = inspectNoFollowDirectoryChain(directory.path, 'SEC runtime private directory readback').target;
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
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

/**
 * Acquires only disposable Runtime Cache authority. This is intentionally
 * separate from durable Runtime State issuance: short-lived read-only tools
 * must not create the state root or pay the Windows state-DACL issuance cost.
 */
export function acquireRuntimeCachePhysicalAuthority(
  input: Readonly<{
    repositoryRoot: string;
    cacheRoot: string;
    requiredDirectories: readonly string[];
  }>
): RuntimeCachePhysicalAuthority {
  const repository = inspectNoFollowDirectoryChain(path.resolve(input.repositoryRoot), 'SEC runtime repository root');
  const cachePlan = planPhysicalDirectoryMaterialization(input.cacheRoot, repository, 'cache root planned location');
  let cache = materializePlannedPhysicalDirectory(cachePlan, 'cache root materialization');
  assertPhysicallyDisjoint(repository, cache, 'cache root and repository');

  const requested = [...new Set([path.resolve(input.cacheRoot), ...input.requiredDirectories.map((entry) => path.resolve(entry))])];
  for (const directoryPath of requested) {
    if (!pathInside(directoryPath, input.cacheRoot)) {
      throw new Error('SEC runtime required directory escapes cache authority.');
    }
  }

  const directories = new Map<string, PhysicalDirectoryIdentity>();
  const cacheRootPath = path.resolve(input.cacheRoot);
  for (const directoryPath of requested.sort(
    (left, right) => left.split(path.sep).length - right.split(path.sep).length || left.localeCompare(right)
  )) {
    const authorityRoot = directories.get(cacheRootPath) ?? cache.target;
    let directory = materializeWithinPhysicalAuthority(authorityRoot, directoryPath, 'cache directory');
    assertPhysicallyDisjoint(repository, directory, `cache directory ${directoryPath} and repository`);
    let target = directory.target;
    if (process.platform === 'linux') {
      target = hardenPosixDirectory(target);
    } else if (process.platform === 'win32') {
      target = inspectNoFollowDirectoryChain(target.path, 'SEC runtime Windows cache directory readback').target;
    } else {
      throw new Error('SEC runtime cache physical authority is unavailable on this platform.');
    }
    const directoryChain = bindMaterializedDirectory(target, directoryPath, 'cache directory authority');
    directories.set(path.resolve(directoryPath), directoryChain.target);
  }

  cache = inspectNoFollowDirectoryChain(path.resolve(input.cacheRoot), 'SEC runtime cache root');
  assertPhysicallyDisjoint(repository, cache, 'cache root and repository');
  const assertCurrent = (): void => {
    for (const [directoryPath, expected] of directories) {
      const observed = assertSameNoFollowDirectoryIdentity(expected, `SEC runtime cache directory ${directoryPath}`).target;
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
export async function acquireRuntimeStatePhysicalAuthority(
  input: Readonly<{
    repositoryRoot: string;
    stateRoot: string;
    cacheRoot: string;
    requiredDirectories: readonly string[];
    directoryMigrations?: readonly RuntimeStateDirectoryMigrationSpec[];
    deadlineAtUnixMs?: number;
  }>
): Promise<RuntimeStatePhysicalAuthority> {
  if (input.deadlineAtUnixMs !== undefined
      && (!Number.isSafeInteger(input.deadlineAtUnixMs) || input.deadlineAtUnixMs <= Date.now())) {
    throw new Error('SEC Runtime State physical authority admission deadline is invalid or expired.');
  }
  const stateRootWasPresent =
    inspectExactNoFollowDirectoryPresence(path.resolve(input.stateRoot), 'SEC runtime state root before materialization').state ===
    'present';
  const repository = inspectNoFollowDirectoryChain(path.resolve(input.repositoryRoot), 'SEC runtime repository root');
  const statePlan = planPhysicalDirectoryMaterialization(input.stateRoot, repository, 'state root planned location');
  const cachePlan = planPhysicalDirectoryMaterialization(input.cacheRoot, repository, 'cache root planned location');
  let state = materializePlannedPhysicalDirectory(statePlan, 'state root materialization');
  let cache = materializePlannedPhysicalDirectory(cachePlan, 'cache root materialization');
  assertPhysicallyDisjoint(repository, state, 'durable state root and repository');
  assertPhysicallyDisjoint(repository, cache, 'cache root and repository');
  assertPhysicallyDisjoint(state, cache, 'durable state and cache roots');

  const requested = [
    ...new Set([
      path.resolve(input.stateRoot),
      path.resolve(input.cacheRoot),
      ...input.requiredDirectories.map((entry) => path.resolve(entry))
    ])
  ];
  for (const directoryPath of requested) {
    if (!pathInside(directoryPath, input.stateRoot) && !pathInside(directoryPath, input.cacheRoot)) {
      throw new Error('SEC runtime required directory escapes state/cache authority.');
    }
  }

  const directories = new Map<string, PhysicalDirectoryIdentity>();
  const directoryChains = new Map<string, PhysicalDirectoryChain>();
  const stateRootPath = path.resolve(input.stateRoot);
  const cacheRootPath = path.resolve(input.cacheRoot);
  const windowsAuthorities: WindowsRuntimeStateAuthorityCapability[] = [];
  try {
    if (process.platform === 'win32') {
      // Root/ACL authority must exist before any required durable child is
      // created. Subsequent owner child creation explicitly refreshes this
      // proof generation without changing the stable root capability.
      windowsAuthorities.push(
        await acquireWindowsRuntimeStateAuthorityCapability(
          stateRootPath,
          !stateRootWasPresent,
          Object.freeze({ repository, state, cache }),
          input.deadlineAtUnixMs
        )
      );
      migrateRuntimeStateDirectoryGenerations([
        ...runtimeStateRootGenerationMigrations(stateRootPath),
        ...(input.directoryMigrations ?? [])
      ]);
      const admission = await windowsAuthorities[0]!.admitDirectories(
        requested,
        input.deadlineAtUnixMs === undefined ? undefined : { deadlineAtUnixMs: input.deadlineAtUnixMs }
      );
      for (const [directoryPath, directory] of admission.directories) {
        directories.set(directoryPath, directory);
      }
      for (const [directoryPath, directoryChain] of admission.directoryChains) {
        directoryChains.set(directoryPath, directoryChain);
      }
    } else {
      migrateRuntimeStateDirectoryGenerations([
        ...runtimeStateRootGenerationMigrations(stateRootPath),
        ...(input.directoryMigrations ?? [])
      ]);
      for (const directoryPath of requested.sort(
        (left, right) => left.split(path.sep).length - right.split(path.sep).length || left.localeCompare(right)
      )) {
        const authorityRoot = pathInside(directoryPath, stateRootPath)
          ? (directories.get(stateRootPath) ?? state.target)
          : (directories.get(cacheRootPath) ?? cache.target);
        let directory = materializeWithinPhysicalAuthority(authorityRoot, directoryPath, 'state/cache directory').target;
        if (process.platform === 'linux') {
          directory = hardenPosixDirectory(directory);
        } else {
          throw new Error('SEC runtime physical authority is unavailable on this platform.');
        }
        const directoryChain = bindMaterializedDirectory(directory, directoryPath, 'state/cache directory authority');
        directories.set(path.resolve(directoryPath), directoryChain.target);
        directoryChains.set(path.resolve(directoryPath), directoryChain);
      }
    }

    state = inspectNoFollowDirectoryChain(path.resolve(input.stateRoot), 'SEC runtime state root');
    cache = inspectNoFollowDirectoryChain(path.resolve(input.cacheRoot), 'SEC runtime cache root');
    assertPhysicallyDisjoint(repository, state, 'durable state root and repository');
    assertPhysicallyDisjoint(repository, cache, 'cache root and repository');
    assertPhysicallyDisjoint(state, cache, 'durable state and cache roots');

    let released = false;
    let releasing = false;
    const assertRootIdentityCurrent = (): void => {
      if (released) {
        throw new WindowsHostDirectoryAuthorityError('session-closed', 'SEC Runtime State physical authority is released');
      }
      for (const [directoryPath, expected] of directories) {
        const observed = assertSameNoFollowDirectoryIdentity(expected, `SEC runtime directory ${directoryPath}`).target;
        if (process.platform === 'linux') {
          const metadata = lstatSync(observed.path);
          if ((metadata.mode & 0o077) !== 0) {
            throw new Error('SEC runtime private directory permissions changed.');
          }
        }
      }
    };

    const current = async (currentInput?: Readonly<{ deadlineAtUnixMs?: number }>): Promise<void> => {
      assertRootIdentityCurrent();
      for (const authority of windowsAuthorities) {
        await authority.assertCurrent(currentInput);
      }
    };

    const release = async (input?: Readonly<{ deadlineAtUnixMs?: number }>): Promise<void> => {
      if (released) return;
      if (releasing) throw new Error('SEC Runtime State physical authority release is already in progress.');
      const deadlineAtUnixMs = input?.deadlineAtUnixMs;
      if (deadlineAtUnixMs !== undefined
          && (!Number.isSafeInteger(deadlineAtUnixMs) || deadlineAtUnixMs <= Date.now())) {
        throw new Error('SEC Runtime State physical authority settlement deadline is invalid or expired.');
      }
      releasing = true;
      try {
        await settleWindowsHostDirectoryAuthorities({
          authorities: windowsAuthorities,
          ...(input === undefined ? {} : { releaseInput: input })
        });
        released = true;
      } finally {
        releasing = false;
      }
    };

    const authority = Object.freeze({
      stateRoot: directories.get(path.resolve(input.stateRoot))!,
      cacheRoot: directories.get(path.resolve(input.cacheRoot))!,
      directory: (absolutePath: string): PhysicalDirectoryIdentity => {
        if (released) {
          throw new WindowsHostDirectoryAuthorityError('session-closed', 'SEC Runtime State physical authority is released');
        }
        const value = directories.get(path.resolve(absolutePath));
        if (value === undefined) {
          throw new Error('SEC runtime directory is outside the acquired physical authority.');
        }
        return value;
      },
      directoryChain: (absolutePath: string): PhysicalDirectoryChain => {
        if (released) {
          throw new WindowsHostDirectoryAuthorityError('session-closed', 'SEC Runtime State physical authority is released');
        }
        const value = directoryChains.get(path.resolve(absolutePath));
        if (value === undefined) {
          throw new Error('SEC runtime directory chain is outside the acquired physical authority.');
        }
        return value;
      },
      assertRootIdentityCurrent,
      assertCurrent: current,
      release
    });
    issuedRuntimeStatePhysicalAuthorities.add(authority);
    return authority;
  } catch (error) {
    await settleWindowsHostDirectoryAuthorities({
      authorities: windowsAuthorities,
      primary: Object.freeze({
        label: 'sec-runtime-state-physical-authority-acquisition',
        error
      })
    });
    throw error;
  }
}

/** Acquires the one shared physical root used by both durable journal families. */
export async function acquireRuntimeJournalAuthority(
  input: Readonly<{
    repositoryRoot: string;
    environment?: NodeJS.ProcessEnv;
  }>
): Promise<RuntimeStatePhysicalAuthority> {
  const roots = resolveWorkspaceRuntimeRoots({
    repositoryRoot: input.repositoryRoot,
    environment: input.environment ?? process.env
  });
  return acquireRuntimeStatePhysicalAuthority({
    repositoryRoot: input.repositoryRoot,
    stateRoot: roots.stateRoot,
    cacheRoot: roots.cacheRoot,
    requiredDirectories: [
      roots.workspaceStateRoot,
      path.join(roots.workspaceStateRoot, 'verification-actions', 'terminal-bound'),
      path.join(roots.workspaceStateRoot, 'verification-sessions', 'journal'),
      roots.processDiagnosticObjectRoot
    ],
    directoryMigrations: runtimeStateWorkspaceGenerationMigrations(roots.workspaceStateRoot)
  });
}
