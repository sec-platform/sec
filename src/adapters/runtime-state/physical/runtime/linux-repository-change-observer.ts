import { closeSync } from 'node:fs';
import path from 'node:path';

import { sha256 } from '../../../../contracts/canonical.ts';
import {
  consumeSecOperationRequirementBindingContext,
  type SecOperationRequirementBindingContext
} from '../../../../execution/operation/requirement-binding-context.ts';
import {
  assertSecSemanticOperationProjection,
  compileSecCapabilityBinding,
  type SecBoundSemanticOperation,
  type SecOperationDigest
} from '../../../../execution/operation/semantic.ts';
import {
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  scanNoFollowDirectoryTreeMetadata,
  type RetainedNoFollowChildProcessDirectory
} from './physical-no-follow.ts';
import {
  linuxAddRepositoryMutationWatch,
  linuxClassifyRepositoryMutationEvent,
  linuxIdentity,
  linuxOpenRepositoryMutationWitness,
  linuxOpenRetainedAbsoluteDirectory,
  linuxReadRepositoryMutationEvents,
  linuxRemoveRepositoryMutationWatch
} from './physical-no-follow-native.ts';
import {
  REPOSITORY_CHANGE_OBSERVER_MAXIMUM_DIRECTORY_ENTRIES,
  REPOSITORY_CHANGE_OBSERVER_MAXIMUM_EVENTS,
  REPOSITORY_CHANGE_OBSERVER_MAXIMUM_ROOTS,
  RETAINED_REPOSITORY_CHANGE_OBSERVER_CONTRACT_DIGEST,
  RETAINED_REPOSITORY_CHANGE_OBSERVER_REQUIREMENT_ID,
  type PreparedRepositoryChangeObserver,
  type RepositoryChangeEvent,
  type RepositoryChangeObserver,
  type RepositoryChangeObserverSettlement,
  type RepositoryChangeObserverUnavailableReason
} from './repository-change-observer-contract.ts';

const MAXIMUM_OBSERVATION_MS = 5 * 60_000;
const observerBrand: unique symbol = Symbol('linux-repository-change-observer');
const preparedObserverBrand: unique symbol = Symbol('prepared-linux-repository-change-observer');

export interface LinuxRepositoryChangeObserver extends RepositoryChangeObserver {
  readonly [observerBrand]: never;
}

export interface PreparedLinuxRepositoryChangeObserver extends PreparedRepositoryChangeObserver {
  readonly [preparedObserverBrand]: never;
}

export type LinuxRepositoryChangeObserverResolution =
  | Readonly<{ status: 'ready'; observer: LinuxRepositoryChangeObserver }>
  | Readonly<{
    status: 'unavailable';
    reason: RepositoryChangeObserverUnavailableReason;
  }>;

type DirectoryProjection = Readonly<{
  relativePath: string;
  device: string;
  inode: string;
}>;

type WatchBinding = Readonly<{
  rootIndex: number;
  relativePath: string;
}>;

type RootWitness = Readonly<{
  fd: number;
  watches: ReadonlyMap<number, WatchBinding>;
}>;

type PreparedObserverState = Readonly<{
  retainedRoots: readonly RetainedNoFollowChildProcessDirectory[];
  roots: readonly string[];
  rootIdentityDigest: `sha256:${string}`;
}>;

type LiveObserver = {
  readonly retainedRoots: readonly RetainedNoFollowChildProcessDirectory[];
  readonly witnesses: readonly RootWitness[];
  readonly rootIdentityDigest: `sha256:${string}`;
  settled: boolean;
};

const preparedObservers = new WeakMap<object, PreparedObserverState>();
const activatedPreparedObservers = new WeakMap<object, LinuxRepositoryChangeObserver>();
const liveObservers = new WeakMap<object, LiveObserver>();

function canonicalRootPaths(values: readonly string[]): readonly string[] | null {
  if (!Array.isArray(values) || values.length === 0
      || values.length > REPOSITORY_CHANGE_OBSERVER_MAXIMUM_ROOTS) return null;
  const canonical = values.map((value) => {
    if (typeof value !== 'string' || !path.isAbsolute(value)) return null;
    const resolved = path.resolve(value);
    if (path.parse(resolved).root === resolved) return null;
    return resolved;
  });
  if (canonical.some((value) => value === null)) return null;
  const roots = canonical as string[];
  roots.sort((left, right) => left.localeCompare(right));
  if (new Set(roots).size !== roots.length) return null;
  return Object.freeze(roots);
}

function rootIdentityProjection(root: ReturnType<typeof inspectNoFollowDirectoryChain>) {
  return Object.freeze({
    target: Object.freeze({
      path: root.target.path,
      finalPath: root.target.finalPath,
      device: root.target.device,
      inode: root.target.inode,
      objectId: root.target.objectId
    }),
    ancestors: Object.freeze(root.ancestors.map((entry) => Object.freeze({
      path: entry.path,
      finalPath: entry.finalPath,
      device: entry.device,
      inode: entry.inode,
      objectId: entry.objectId
    })))
  });
}

function disposeRoots(roots: readonly RetainedNoFollowChildProcessDirectory[]): boolean {
  let success = true;
  for (const root of [...roots].reverse()) {
    try { root.dispose(); } catch { success = false; }
  }
  return success;
}

function unavailable(
  reason: RepositoryChangeObserverUnavailableReason
): LinuxRepositoryChangeObserverResolution {
  return Object.freeze({ status: 'unavailable', reason });
}

function monotonicDeadline(deadlineAtUnixMs: number): number {
  const remaining = deadlineAtUnixMs - Date.now();
  if (!Number.isSafeInteger(deadlineAtUnixMs) || remaining < 1) {
    throw new Error('Linux repository observer deadline is invalid.');
  }
  return performance.now() + remaining;
}

function directoryProjection(
  rootPath: string,
  deadlineAtUnixMs: number
): readonly DirectoryProjection[] {
  const root = inspectNoFollowDirectoryChain(rootPath, 'Linux repository observer root');
  const entries = scanNoFollowDirectoryTreeMetadata(root.target, {
    deadlineAtMs: monotonicDeadline(deadlineAtUnixMs),
    maximumEntries: REPOSITORY_CHANGE_OBSERVER_MAXIMUM_DIRECTORY_ENTRIES
  });
  return Object.freeze([
    Object.freeze({
      relativePath: '',
      device: root.target.device,
      inode: root.target.inode
    }),
    ...entries
      .filter(({ kind }) => kind === 'directory')
      .map(({ relativePath, device, inode }) => Object.freeze({
        relativePath,
        device,
        inode
      }))
  ]);
}

function sameDirectoryProjection(
  left: readonly DirectoryProjection[],
  right: readonly DirectoryProjection[]
): boolean {
  return sha256(left) === sha256(right);
}

function closeOpenedDirectory(
  opened: Readonly<{ filesystemRootFd: number; directoryFd: number }>
): void {
  if (opened.directoryFd !== opened.filesystemRootFd) closeSync(opened.directoryFd);
  closeSync(opened.filesystemRootFd);
}

function armRootWitness(
  rootPath: string,
  rootIndex: number,
  deadlineAtUnixMs: number
): RootWitness {
  const before = directoryProjection(rootPath, deadlineAtUnixMs);
  const witnessFd = linuxOpenRepositoryMutationWitness(
    `Linux repository observer root[${rootIndex}]`
  );
  const watches = new Map<number, WatchBinding>();
  try {
    for (const entry of before) {
      const absolute = entry.relativePath.length === 0
        ? rootPath
        : path.join(rootPath, ...entry.relativePath.split('/'));
      const opened = linuxOpenRetainedAbsoluteDirectory(
        absolute,
        `Linux repository observer directory ${entry.relativePath || '<root>'}`
      );
      try {
        const current = linuxIdentity(opened.directoryFd, absolute);
        if (current.device !== entry.device || current.inode !== entry.inode) {
          throw new Error('Linux repository observer directory identity changed before watch binding.');
        }
        const watchDescriptor = linuxAddRepositoryMutationWatch(
          witnessFd,
          opened.directoryFd,
          `Linux repository observer directory ${entry.relativePath || '<root>'}`
        );
        if (watches.has(watchDescriptor)) {
          throw new Error('Linux repository observer reused one watch descriptor for distinct directories.');
        }
        watches.set(watchDescriptor, Object.freeze({
          rootIndex,
          relativePath: entry.relativePath
        }));
      } finally {
        closeOpenedDirectory(opened);
      }
    }

    const afterWatch = directoryProjection(rootPath, deadlineAtUnixMs);
    if (!sameDirectoryProjection(before, afterWatch)) {
      throw new Error('Linux repository observer directory set changed while recursive watches were armed.');
    }

    const preBarrierEvents = linuxReadRepositoryMutationEvents(
      witnessFd,
      `Linux repository observer root[${rootIndex}] pre-barrier`
    );
    if (preBarrierEvents.some((event) => {
      const classification = linuxClassifyRepositoryMutationEvent(event.mask);
      return classification === 'overflow'
        || classification === 'discontinuous'
        || classification === 'ignored';
    })) {
      throw new Error('Linux repository observer continuity was lost while establishing its barrier.');
    }

    const barrierReadback = directoryProjection(rootPath, deadlineAtUnixMs);
    if (!sameDirectoryProjection(afterWatch, barrierReadback)) {
      throw new Error('Linux repository observer directory set changed at its readiness barrier.');
    }

    return Object.freeze({
      fd: witnessFd,
      watches
    });
  } catch (error) {
    try { closeSync(witnessFd); } catch { /* preserve primary admission failure */ }
    throw error;
  }
}

function eventPath(binding: WatchBinding, name: string): string {
  if (name.length === 0) return binding.relativePath;
  if (name.includes('/') || name.includes('\0')) {
    throw new Error('Linux repository observer emitted a non-canonical entry name.');
  }
  return binding.relativePath.length === 0
    ? name
    : `${binding.relativePath}/${name}`;
}

function settleRootWitness(
  witness: RootWitness
): Readonly<{
  events: readonly RepositoryChangeEvent[];
  overflow: boolean;
  discontinuous: boolean;
}> {
  let discontinuous = false;
  let overflow = false;
  const removed = new Set<number>();
  const events: RepositoryChangeEvent[] = [];
  let observed: ReturnType<typeof linuxReadRepositoryMutationEvents> = Object.freeze([]);
  try {
    for (const watchDescriptor of witness.watches.keys()) {
      try {
        linuxRemoveRepositoryMutationWatch(
          witness.fd,
          watchDescriptor,
          'Linux repository observer terminal watch removal'
        );
        removed.add(watchDescriptor);
      } catch {
        discontinuous = true;
      }
    }

    try {
      observed = linuxReadRepositoryMutationEvents(
        witness.fd,
        'Linux repository observer terminal readback'
      );
    } catch {
      discontinuous = true;
    }
    for (const event of observed) {
      const classification = linuxClassifyRepositoryMutationEvent(event.mask);
      if (classification === 'overflow') {
        overflow = true;
        continue;
      }
      if (classification === 'ignored') {
        if (!removed.has(event.watchDescriptor)) discontinuous = true;
        continue;
      }
      if (classification === 'discontinuous') {
        discontinuous = true;
        continue;
      }
      const binding = witness.watches.get(event.watchDescriptor);
      if (binding === undefined) {
        discontinuous = true;
        continue;
      }
      let observedPath: string;
      try {
        observedPath = eventPath(binding, event.name);
      } catch {
        discontinuous = true;
        continue;
      }
      events.push(Object.freeze({
        rootIndex: binding.rootIndex,
        path: observedPath,
        action: classification
      }));
      if (events.length > REPOSITORY_CHANGE_OBSERVER_MAXIMUM_EVENTS) {
        overflow = true;
        break;
      }
    }
  } finally {
    try { closeSync(witness.fd); } catch { discontinuous = true; }
  }
  return Object.freeze({
    events: Object.freeze(events),
    overflow,
    discontinuous
  });
}

/** Retains exact repository roots and issues the Linux inotify provider binding
 * without yet starting any mutation watch. */
export function prepareLinuxRepositoryChangeObserver(input: Readonly<{
  roots: readonly string[];
}>): PreparedLinuxRepositoryChangeObserver {
  const roots = canonicalRootPaths(input.roots);
  if (process.platform !== 'linux' || roots === null) {
    throw new Error('Linux repository observer preparation is unavailable.');
  }
  const retainedRoots: RetainedNoFollowChildProcessDirectory[] = [];
  try {
    const projections = [];
    for (const [index, root] of roots.entries()) {
      const chain = inspectNoFollowDirectoryChain(root, `repository change root[${index}]`);
      projections.push(rootIdentityProjection(chain));
      retainedRoots.push(retainNoFollowDirectoryForChildProcess(
        chain,
        40 + index,
        `repository change root[${index}]`
      ));
    }
    const rootIdentityDigest = sha256(Object.freeze(projections)) as `sha256:${string}`;
    const providerIdentityDigest = sha256({
      domain: 'linux-repository-change-observer.physical-provider',
      provider: 'inotify-retained-recursive-directory-set-v1',
      rootIdentityDigest
    }) as SecOperationDigest;
    const prepared = Object.freeze({
      [preparedObserverBrand]: undefined as never,
      providerBinding: compileSecCapabilityBinding({
        requirementId: RETAINED_REPOSITORY_CHANGE_OBSERVER_REQUIREMENT_ID,
        contractDigest: RETAINED_REPOSITORY_CHANGE_OBSERVER_CONTRACT_DIGEST,
        providerIdentityDigest
      }),
      rootIdentityDigest
    }) as PreparedLinuxRepositoryChangeObserver;
    preparedObservers.set(prepared, Object.freeze({
      retainedRoots: Object.freeze(retainedRoots),
      roots,
      rootIdentityDigest
    }));
    return prepared;
  } catch (error) {
    disposeRoots(retainedRoots);
    throw error;
  }
}

export async function armPreparedLinuxRepositoryChangeObserver(input: Readonly<{
  prepared: PreparedLinuxRepositoryChangeObserver;
  operation: SecBoundSemanticOperation;
  requirementBindingContext: SecOperationRequirementBindingContext;
}>): Promise<LinuxRepositoryChangeObserverResolution> {
  const state = preparedObservers.get(input.prepared);
  if (state === undefined || process.platform !== 'linux') return unavailable('invalid-input');
  assertSecSemanticOperationProjection(input.operation);
  const context = consumeSecOperationRequirementBindingContext(input.requirementBindingContext);
  const requirement = input.operation.plan.execution.requirements.find(
    ({ id }) => id === RETAINED_REPOSITORY_CHANGE_OBSERVER_REQUIREMENT_ID
  );
  const binding = input.operation.bindings.find(
    ({ requirementId }) => requirementId === RETAINED_REPOSITORY_CHANGE_OBSERVER_REQUIREMENT_ID
  );
  const durationCeiling = context.resourceCeilings.find(({ resource }) => resource === 'duration-ms');
  const observedAtUnixMs = Date.now();
  const ceilingDeadlineAtUnixMs = durationCeiling === undefined
    ? Number.NaN
    : observedAtUnixMs + durationCeiling.maximum;
  const deadlineAtUnixMs = Math.min(
    input.operation.plan.attempt.deadlineAtUnixMs,
    context.absoluteDeadlineAtUnixMs,
    ceilingDeadlineAtUnixMs
  );
  if (requirement?.contractDigest !== RETAINED_REPOSITORY_CHANGE_OBSERVER_CONTRACT_DIGEST
      || binding?.bindingDigest !== input.prepared.providerBinding.bindingDigest
      || context.operationIdentityDigest !== input.operation.plan.identity.identityDigest
      || context.boundAttemptDigest !== input.operation.boundAttemptDigest
      || context.requirementId !== RETAINED_REPOSITORY_CHANGE_OBSERVER_REQUIREMENT_ID
      || context.providerBindingDigest !== input.prepared.providerBinding.bindingDigest
      || durationCeiling === undefined || durationCeiling.maximum < 1
      || !Number.isSafeInteger(deadlineAtUnixMs)
      || deadlineAtUnixMs <= observedAtUnixMs) {
    return unavailable('invalid-input');
  }

  const witnesses: RootWitness[] = [];
  try {
    for (const root of state.retainedRoots) root.assertCurrent();
    for (const [rootIndex, rootPath] of state.roots.entries()) {
      witnesses.push(armRootWitness(rootPath, rootIndex, deadlineAtUnixMs));
    }
    for (const root of state.retainedRoots) root.assertCurrent();
    const observer = Object.freeze({
      [observerBrand]: undefined as never,
      rootIdentityDigest: state.rootIdentityDigest
    }) as LinuxRepositoryChangeObserver;
    liveObservers.set(observer, {
      retainedRoots: state.retainedRoots,
      witnesses: Object.freeze(witnesses),
      rootIdentityDigest: state.rootIdentityDigest,
      settled: false
    });
    preparedObservers.delete(input.prepared);
    activatedPreparedObservers.set(input.prepared, observer);
    return Object.freeze({ status: 'ready', observer });
  } catch {
    for (const witness of witnesses.reverse()) {
      try { closeSync(witness.fd); } catch { /* fail closed below */ }
    }
    preparedObservers.delete(input.prepared);
    disposeRoots(state.retainedRoots);
    return unavailable(Date.now() >= deadlineAtUnixMs ? 'deadline-exhausted' : 'arm-failed');
  }
}

export async function settleLinuxRepositoryChangeObserver(
  observer: LinuxRepositoryChangeObserver
): Promise<RepositoryChangeObserverSettlement> {
  const live = liveObservers.get(observer);
  if (live === undefined || live.settled) {
    return Object.freeze({
      status: 'discontinuous',
      rootIdentityDigest: observer.rootIdentityDigest
    });
  }
  live.settled = true;
  liveObservers.delete(observer);

  let identityChanged = false;
  for (const root of live.retainedRoots) {
    try { root.assertCurrent(); } catch { identityChanged = true; }
  }

  const events: RepositoryChangeEvent[] = [];
  let overflow = false;
  let discontinuous = false;
  for (const witness of live.witnesses) {
    const result = settleRootWitness(witness);
    events.push(...result.events);
    overflow ||= result.overflow;
    discontinuous ||= result.discontinuous;
  }

  for (const root of live.retainedRoots) {
    try { root.assertCurrent(); } catch { identityChanged = true; }
  }
  if (!disposeRoots(live.retainedRoots)) discontinuous = true;

  if (identityChanged) {
    return Object.freeze({
      status: 'identity-changed',
      rootIdentityDigest: live.rootIdentityDigest
    });
  }
  if (overflow || events.length > REPOSITORY_CHANGE_OBSERVER_MAXIMUM_EVENTS) {
    return Object.freeze({
      status: 'overflow',
      rootIdentityDigest: live.rootIdentityDigest
    });
  }
  if (discontinuous) {
    return Object.freeze({
      status: 'discontinuous',
      rootIdentityDigest: live.rootIdentityDigest
    });
  }
  if (events.length > 0) {
    const frozenEvents = Object.freeze(events);
    return Object.freeze({
      status: 'events',
      rootIdentityDigest: live.rootIdentityDigest,
      events: frozenEvents,
      observationDigest: sha256({
        provider: 'linux-inotify',
        rootIdentityDigest: live.rootIdentityDigest,
        events: frozenEvents
      }) as `sha256:${string}`
    });
  }
  return Object.freeze({
    status: 'zero-events',
    rootIdentityDigest: live.rootIdentityDigest,
    observationDigest: sha256({
      provider: 'linux-inotify',
      rootIdentityDigest: live.rootIdentityDigest,
      events: []
    }) as `sha256:${string}`
  });
}

export async function settlePreparedLinuxRepositoryChangeObserver(
  prepared: PreparedLinuxRepositoryChangeObserver
): Promise<RepositoryChangeObserverSettlement> {
  const observer = activatedPreparedObservers.get(prepared);
  if (observer === undefined) {
    return Object.freeze({
      status: 'discontinuous',
      rootIdentityDigest: prepared.rootIdentityDigest
    });
  }
  activatedPreparedObservers.delete(prepared);
  return settleLinuxRepositoryChangeObserver(observer);
}

export function disposePreparedLinuxRepositoryChangeObserver(
  prepared: PreparedLinuxRepositoryChangeObserver
): void {
  const state = preparedObservers.get(prepared);
  if (state === undefined) return;
  preparedObservers.delete(prepared);
  if (!disposeRoots(state.retainedRoots)) {
    throw new Error('Prepared Linux repository observer roots did not settle.');
  }
}

export async function armLinuxRepositoryChangeObserver(input: Readonly<{
  roots: readonly string[];
  deadlineAtUnixMs: number;
}>): Promise<LinuxRepositoryChangeObserverResolution> {
  if (process.platform !== 'linux') return unavailable('unsupported-platform');
  if (process.arch !== 'x64' && process.arch !== 'arm64') {
    return unavailable('unsupported-architecture');
  }
  const roots = canonicalRootPaths(input.roots);
  const now = Date.now();
  if (roots === null || !Number.isSafeInteger(input.deadlineAtUnixMs)
      || input.deadlineAtUnixMs <= now
      || input.deadlineAtUnixMs - now > MAXIMUM_OBSERVATION_MS) {
    return unavailable('invalid-input');
  }
  const prepared = prepareLinuxRepositoryChangeObserver({ roots });
  // Standalone callers do not carry a semantic operation binding. Mirror the
  // Windows provider's direct path by arming the same physical watcher without
  // synthesizing semantic authority.
  const state = preparedObservers.get(prepared);
  if (state === undefined) return unavailable('invalid-input');
  const witnesses: RootWitness[] = [];
  try {
    for (const root of state.retainedRoots) root.assertCurrent();
    for (const [rootIndex, rootPath] of state.roots.entries()) {
      witnesses.push(armRootWitness(rootPath, rootIndex, input.deadlineAtUnixMs));
    }
    for (const root of state.retainedRoots) root.assertCurrent();
    const observer = Object.freeze({
      [observerBrand]: undefined as never,
      rootIdentityDigest: state.rootIdentityDigest
    }) as LinuxRepositoryChangeObserver;
    liveObservers.set(observer, {
      retainedRoots: state.retainedRoots,
      witnesses: Object.freeze(witnesses),
      rootIdentityDigest: state.rootIdentityDigest,
      settled: false
    });
    preparedObservers.delete(prepared);
    return Object.freeze({ status: 'ready', observer });
  } catch {
    for (const witness of witnesses.reverse()) {
      try { closeSync(witness.fd); } catch { /* fail closed below */ }
    }
    preparedObservers.delete(prepared);
    disposeRoots(state.retainedRoots);
    return unavailable(Date.now() >= input.deadlineAtUnixMs ? 'deadline-exhausted' : 'arm-failed');
  }
}

export type {
  RepositoryChangeObserverResolution,
  RepositoryChangeObserverSettlement
} from './repository-change-observer-contract.ts';
