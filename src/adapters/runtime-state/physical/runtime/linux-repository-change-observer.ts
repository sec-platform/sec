import { closeSync, lstatSync, readdirSync } from 'node:fs';
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
  type SecCapabilityBinding,
  type SecOperationDigest
} from '../../../../execution/operation/semantic.ts';
import {
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  type RetainedNoFollowChildProcessDirectory
} from './physical-no-follow.ts';
import {
  LINUX_IN_ATTRIB,
  LINUX_IN_CLOSE_WRITE,
  LINUX_IN_CREATE,
  LINUX_IN_DELETE,
  LINUX_IN_DELETE_SELF,
  LINUX_IN_IGNORED,
  LINUX_IN_MODIFY,
  LINUX_IN_MOVED_FROM,
  LINUX_IN_MOVED_TO,
  LINUX_IN_MOVE_SELF,
  LINUX_IN_ONLYDIR,
  LINUX_IN_Q_OVERFLOW,
  linuxAddDirectoryMutationWatch,
  linuxIdentity,
  linuxOpenAt,
  linuxOpenDirectoryMutationWitness,
  linuxReadDirectoryMutationEvents,
  type LinuxDirectoryCreateWitness,
  type LinuxDirectoryMutationEvent
} from './physical-no-follow-native.ts';
import {
  REPOSITORY_CHANGE_OBSERVER_MAXIMUM_EVENTS,
  REPOSITORY_CHANGE_OBSERVER_MAXIMUM_OBSERVATION_MS,
  REPOSITORY_CHANGE_OBSERVER_MAXIMUM_ROOTS,
  REPOSITORY_CHANGE_OBSERVER_MAXIMUM_WATCHES,
  RETAINED_REPOSITORY_CHANGE_OBSERVER_CONTRACT_DIGEST,
  RETAINED_REPOSITORY_CHANGE_OBSERVER_REQUIREMENT_ID,
  type RepositoryChangeAction,
  type RepositoryChangeEvent,
  type RepositoryChangeObserverSettlement,
  type RepositoryChangeObserverUnavailableReason
} from './repository-change-observer-contract.ts';

const LINUX_REPOSITORY_CHANGE_WATCH_MASK =
  LINUX_IN_MODIFY
  | LINUX_IN_ATTRIB
  | LINUX_IN_CLOSE_WRITE
  | LINUX_IN_CREATE
  | LINUX_IN_DELETE
  | LINUX_IN_MOVED_FROM
  | LINUX_IN_MOVED_TO
  | LINUX_IN_DELETE_SELF
  | LINUX_IN_MOVE_SELF
  | LINUX_IN_ONLYDIR;

const observerBrand: unique symbol = Symbol('linux-repository-change-observer');
const preparedObserverBrand: unique symbol = Symbol('prepared-linux-repository-change-observer');

export interface LinuxRepositoryChangeObserver {
  readonly [observerBrand]: never;
  readonly rootIdentityDigest: `sha256:${string}`;
}

export interface PreparedLinuxRepositoryChangeObserver {
  readonly [preparedObserverBrand]: never;
  readonly providerBinding: SecCapabilityBinding;
  readonly rootIdentityDigest: `sha256:${string}`;
}

export type LinuxRepositoryChangeObserverResolution =
  | Readonly<{ status: 'ready'; observer: LinuxRepositoryChangeObserver }>
  | Readonly<{ status: 'unavailable'; reason: RepositoryChangeObserverUnavailableReason }>;

type WatchBinding =
  | Readonly<{
    scope: 'tree';
    rootIndex: number;
    relativeDirectory: string;
  }>
  | Readonly<{
    scope: 'root-entry';
    rootIndex: number;
    filterName: string;
  }>;

type PreparedObserverState = Readonly<{
  retainedRoots: readonly RetainedNoFollowChildProcessDirectory[];
  roots: readonly string[];
  rootIdentityDigest: `sha256:${string}`;
}>;

type LiveObserverState = Readonly<{
  retainedRoots: readonly RetainedNoFollowChildProcessDirectory[];
  witnessFd: number;
  bindings: ReadonlyMap<number, readonly WatchBinding[]>;
  rootIdentityDigest: `sha256:${string}`;
  deadlineAtUnixMs: number;
}> & { settled: boolean };

const preparedObservers = new WeakMap<object, PreparedObserverState>();
const activatedPreparedObservers = new WeakMap<object, LinuxRepositoryChangeObserver>();
const liveObservers = new WeakMap<object, LiveObserverState>();

function unavailable(
  reason: RepositoryChangeObserverUnavailableReason
): LinuxRepositoryChangeObserverResolution {
  return Object.freeze({ status: 'unavailable', reason });
}

function canonicalRootPaths(values: readonly string[]): readonly string[] | null {
  if (!Array.isArray(values) || values.length === 0
      || values.length > REPOSITORY_CHANGE_OBSERVER_MAXIMUM_ROOTS) return null;
  const roots = values.map((value) => {
    if (typeof value !== 'string' || !path.isAbsolute(value)) return null;
    const resolved = path.resolve(value);
    if (path.parse(resolved).root === resolved) return null;
    return resolved;
  });
  if (roots.some((value) => value === null)) return null;
  const canonical = roots as string[];
  canonical.sort((left, right) => left.localeCompare(right, 'en-US'));
  if (new Set(canonical).size !== canonical.length) return null;
  return Object.freeze(canonical);
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

function retainRoots(roots: readonly string[]): PreparedObserverState {
  const retainedRoots: RetainedNoFollowChildProcessDirectory[] = [];
  const projections = [];
  try {
    for (const [index, root] of roots.entries()) {
      const chain = inspectNoFollowDirectoryChain(root, `repository change root[${index}]`);
      projections.push(rootIdentityProjection(chain));
      retainedRoots.push(retainNoFollowDirectoryForChildProcess(
        chain,
        40 + index,
        `repository change root[${index}]`
      ));
    }
    return Object.freeze({
      retainedRoots: Object.freeze(retainedRoots),
      roots,
      rootIdentityDigest: sha256(Object.freeze(projections)) as `sha256:${string}`
    });
  } catch (error) {
    disposeRoots(retainedRoots);
    throw error;
  }
}

function addBinding(
  bindings: Map<number, WatchBinding[]>,
  watchDescriptor: number,
  binding: WatchBinding
): void {
  const existing = bindings.get(watchDescriptor);
  if (existing === undefined) bindings.set(watchDescriptor, [binding]);
  else existing.push(binding);
}

function watchDirectoryTree(input: Readonly<{
  witnessFd: number;
  directoryFd: number;
  absolutePath: string;
  rootIndex: number;
  relativeDirectory: string;
  bindings: Map<number, WatchBinding[]>;
  visited: Set<string>;
  watchCount: { value: number };
}>): void {
  const identity = linuxIdentity(input.directoryFd, input.absolutePath);
  const physicalKey = `${identity.device}:${identity.inode}`;
  const watchDescriptor = linuxAddDirectoryMutationWatch(
    input.witnessFd,
    input.directoryFd,
    `repository change tree[${input.rootIndex}] ${input.relativeDirectory || '.'}`,
    LINUX_REPOSITORY_CHANGE_WATCH_MASK
  );
  addBinding(input.bindings, watchDescriptor, Object.freeze({
    scope: 'tree' as const,
    rootIndex: input.rootIndex,
    relativeDirectory: input.relativeDirectory
  }));
  input.watchCount.value += 1;
  if (input.watchCount.value > REPOSITORY_CHANGE_OBSERVER_MAXIMUM_WATCHES) {
    throw new Error('Linux repository observer watch inventory exceeded its bound.');
  }
  if (input.visited.has(physicalKey)) return;
  input.visited.add(physicalKey);

  const directoryView = `/proc/self/fd/${input.directoryFd}`;
  const entries = readdirSync(directoryView, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, 'en-US'));
  for (const entry of entries) {
    if (entry.name.length === 0 || entry.name === '.' || entry.name === '..'
        || entry.name.includes('/') || entry.name.includes('\0')) {
      throw new Error('Linux repository observer encountered a non-canonical directory entry.');
    }
    const entryView = path.join(directoryView, entry.name);
    const metadata = lstatSync(entryView);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) continue;
    const childFd = linuxOpenAt(
      input.directoryFd,
      entry.name,
      `repository change descendant ${entry.name}`
    );
    const childAbsolute = path.join(input.absolutePath, entry.name);
    const childRelative = input.relativeDirectory.length === 0
      ? entry.name
      : `${input.relativeDirectory}/${entry.name}`;
    try {
      watchDirectoryTree({
        ...input,
        directoryFd: childFd,
        absolutePath: childAbsolute,
        relativeDirectory: childRelative
      });
    } finally {
      closeSync(childFd);
    }
  }
}

function armRetainedState(
  state: PreparedObserverState,
  deadlineAtUnixMs: number
): LinuxRepositoryChangeObserverResolution {
  if (process.platform !== 'linux') return unavailable('unsupported-platform');
  const now = Date.now();
  if (!Number.isSafeInteger(deadlineAtUnixMs) || deadlineAtUnixMs <= now
      || deadlineAtUnixMs - now > REPOSITORY_CHANGE_OBSERVER_MAXIMUM_OBSERVATION_MS) {
    return unavailable('invalid-input');
  }
  let witnessFd: number | null = null;
  try {
    witnessFd = linuxOpenDirectoryMutationWitness('Linux repository change observer');
    const bindings = new Map<number, WatchBinding[]>();
    const visited = new Set<string>();
    const watchCount = { value: 0 };
    for (const [rootIndex, retainedRoot] of state.retainedRoots.entries()) {
      retainedRoot.assertCurrent();
      const rootFd = retainedRoot.stdioSourceDescriptor;
      if (rootFd === null || !Number.isSafeInteger(rootFd) || rootFd < 0) {
        throw new Error('Linux repository observer retained root descriptor is unavailable.');
      }

      const parentPath = path.dirname(state.roots[rootIndex]!);
      const parentChain = inspectNoFollowDirectoryChain(
        parentPath,
        `repository change root parent[${rootIndex}]`
      );
      const retainedParent = retainNoFollowDirectoryForChildProcess(
        parentChain,
        60,
        `repository change root parent[${rootIndex}]`
      );
      try {
        const parentFd = retainedParent.stdioSourceDescriptor;
        if (parentFd === null || !Number.isSafeInteger(parentFd) || parentFd < 0) {
          throw new Error('Linux repository observer retained parent descriptor is unavailable.');
        }
        const parentWatch = linuxAddDirectoryMutationWatch(
          witnessFd,
          parentFd,
          `repository change root entry[${rootIndex}]`,
          LINUX_REPOSITORY_CHANGE_WATCH_MASK
        );
        addBinding(bindings, parentWatch, Object.freeze({
          scope: 'root-entry' as const,
          rootIndex,
          filterName: path.basename(state.roots[rootIndex]!)
        }));
        watchCount.value += 1;
        if (watchCount.value > REPOSITORY_CHANGE_OBSERVER_MAXIMUM_WATCHES) {
          throw new Error('Linux repository observer watch inventory exceeded its bound.');
        }
        retainedParent.assertCurrent();
      } finally {
        retainedParent.dispose();
      }

      watchDirectoryTree({
        witnessFd,
        directoryFd: rootFd,
        absolutePath: state.roots[rootIndex]!,
        rootIndex,
        relativeDirectory: '',
        bindings,
        visited,
        watchCount
      });
      retainedRoot.assertCurrent();
    }

    const baseline = classifyEvents(
      Object.freeze({
        fd: witnessFd,
        watchDescriptor: -1,
        ancestorEdges: new Map<number, string>()
      }),
      bindings
    );
    if (baseline.status !== 'zero-events') {
      closeSync(witnessFd);
      witnessFd = null;
      disposeRoots(state.retainedRoots);
      return unavailable('arm-failed');
    }
    for (const root of state.retainedRoots) root.assertCurrent();

    const observer = Object.freeze({
      [observerBrand]: undefined as never,
      rootIdentityDigest: state.rootIdentityDigest
    }) as LinuxRepositoryChangeObserver;
    liveObservers.set(observer, {
      retainedRoots: state.retainedRoots,
      witnessFd,
      bindings: new Map([...bindings].map(([key, values]) => [
        key,
        Object.freeze([...values])
      ])),
      rootIdentityDigest: state.rootIdentityDigest,
      deadlineAtUnixMs,
      settled: false
    });
    witnessFd = null;
    return Object.freeze({ status: 'ready', observer });
  } catch {
    if (witnessFd !== null) {
      try { closeSync(witnessFd); } catch { /* settlement below remains fail-closed */ }
    }
    disposeRoots(state.retainedRoots);
    return unavailable(Date.now() >= deadlineAtUnixMs ? 'deadline-exhausted' : 'arm-failed');
  }
}

function eventAction(mask: number): RepositoryChangeAction | null {
  if ((mask & LINUX_IN_MOVED_FROM) !== 0) return 'renamed-from';
  if ((mask & LINUX_IN_MOVED_TO) !== 0) return 'renamed-to';
  if ((mask & LINUX_IN_CREATE) !== 0) return 'added';
  if ((mask & LINUX_IN_DELETE) !== 0 || (mask & LINUX_IN_DELETE_SELF) !== 0) return 'removed';
  if ((mask & LINUX_IN_MOVE_SELF) !== 0) return 'renamed-from';
  if ((mask & (LINUX_IN_MODIFY | LINUX_IN_ATTRIB | LINUX_IN_CLOSE_WRITE)) !== 0) return 'modified';
  return null;
}

function eventPath(binding: WatchBinding, event: LinuxDirectoryMutationEvent): string | null {
  if (binding.scope === 'root-entry') {
    return event.name === binding.filterName ? '.' : null;
  }
  if (event.name.length === 0) return binding.relativeDirectory || '.';
  return binding.relativeDirectory.length === 0
    ? event.name
    : `${binding.relativeDirectory}/${event.name}`;
}

function classifyEvents(
  witness: LinuxDirectoryCreateWitness,
  bindings: ReadonlyMap<number, readonly WatchBinding[]>
): RepositoryChangeObserverSettlement {
  let raw: readonly LinuxDirectoryMutationEvent[];
  try {
    raw = linuxReadDirectoryMutationEvents(witness, 'Linux repository change observer');
  } catch {
    return Object.freeze({
      status: 'discontinuous' as const,
      rootIdentityDigest: 'sha256:' + '0'.repeat(64) as `sha256:${string}`
    });
  }
  if (raw.some((event) => (event.mask & LINUX_IN_Q_OVERFLOW) !== 0)) {
    return Object.freeze({
      status: 'overflow' as const,
      rootIdentityDigest: 'sha256:' + '0'.repeat(64) as `sha256:${string}`
    });
  }
  if (raw.some((event) => (event.mask & LINUX_IN_IGNORED) !== 0)) {
    return Object.freeze({
      status: 'discontinuous' as const,
      rootIdentityDigest: 'sha256:' + '0'.repeat(64) as `sha256:${string}`
    });
  }
  const events: RepositoryChangeEvent[] = [];
  for (const event of raw) {
    const logicalBindings = bindings.get(event.watchDescriptor);
    if (logicalBindings === undefined || logicalBindings.length === 0) {
      return Object.freeze({
        status: 'discontinuous' as const,
        rootIdentityDigest: 'sha256:' + '0'.repeat(64) as `sha256:${string}`
      });
    }
    const action = eventAction(event.mask);
    if (action === null) {
      return Object.freeze({
        status: 'discontinuous' as const,
        rootIdentityDigest: 'sha256:' + '0'.repeat(64) as `sha256:${string}`
      });
    }
    for (const binding of logicalBindings) {
      const observedPath = eventPath(binding, event);
      if (observedPath === null) continue;
      events.push(Object.freeze({
        rootIndex: binding.rootIndex,
        path: observedPath,
        action
      }));
      if (events.length > REPOSITORY_CHANGE_OBSERVER_MAXIMUM_EVENTS) {
        return Object.freeze({
          status: 'overflow' as const,
          rootIdentityDigest: 'sha256:' + '0'.repeat(64) as `sha256:${string}`
        });
      }
    }
  }
  if (events.length === 0) {
    const canonical = Object.freeze({ status: 'zero-events' as const });
    return Object.freeze({
      ...canonical,
      rootIdentityDigest: 'sha256:' + '0'.repeat(64) as `sha256:${string}`,
      observationDigest: sha256(canonical) as `sha256:${string}`
    });
  }
  const canonical = Object.freeze({
    status: 'events' as const,
    events: Object.freeze(events)
  });
  return Object.freeze({
    ...canonical,
    rootIdentityDigest: 'sha256:' + '0'.repeat(64) as `sha256:${string}`,
    observationDigest: sha256(canonical) as `sha256:${string}`
  });
}

function bindRootDigest(
  settlement: RepositoryChangeObserverSettlement,
  rootIdentityDigest: `sha256:${string}`
): RepositoryChangeObserverSettlement {
  if (settlement.status === 'zero-events') {
    const canonical = Object.freeze({ status: settlement.status, rootIdentityDigest });
    return Object.freeze({
      ...canonical,
      observationDigest: sha256(canonical) as `sha256:${string}`
    });
  }
  if (settlement.status === 'events') {
    const canonical = Object.freeze({
      status: settlement.status,
      rootIdentityDigest,
      events: settlement.events
    });
    return Object.freeze({
      ...canonical,
      observationDigest: sha256(canonical) as `sha256:${string}`
    });
  }
  return Object.freeze({ status: settlement.status, rootIdentityDigest });
}

export function prepareLinuxRepositoryChangeObserver(input: Readonly<{
  roots: readonly string[];
}>): PreparedLinuxRepositoryChangeObserver {
  const roots = canonicalRootPaths(input.roots);
  if (process.platform !== 'linux' || roots === null) {
    throw new Error('Test suite Linux repository observer preparation is unavailable.');
  }
  const state = retainRoots(roots);
  const providerIdentityDigest = sha256({
    domain: 'linux-repository-change-observer.physical-provider',
    rootIdentityDigest: state.rootIdentityDigest
  }) as SecOperationDigest;
  const prepared = Object.freeze({
    [preparedObserverBrand]: undefined as never,
    providerBinding: compileSecCapabilityBinding({
      requirementId: RETAINED_REPOSITORY_CHANGE_OBSERVER_REQUIREMENT_ID,
      contractDigest: RETAINED_REPOSITORY_CHANGE_OBSERVER_CONTRACT_DIGEST,
      providerIdentityDigest
    }),
    rootIdentityDigest: state.rootIdentityDigest
  }) as PreparedLinuxRepositoryChangeObserver;
  preparedObservers.set(prepared, state);
  return prepared;
}

export async function armPreparedLinuxRepositoryChangeObserver(input: Readonly<{
  prepared: PreparedLinuxRepositoryChangeObserver;
  operation: SecBoundSemanticOperation;
  requirementBindingContext: SecOperationRequirementBindingContext;
}>): Promise<LinuxRepositoryChangeObserverResolution> {
  const state = preparedObservers.get(input.prepared);
  if (state === undefined) return unavailable('invalid-input');
  assertSecSemanticOperationProjection(input.operation);
  const context = consumeSecOperationRequirementBindingContext(input.requirementBindingContext);
  const requirement = input.operation.plan.execution.requirements.find(
    ({ id }) => id === RETAINED_REPOSITORY_CHANGE_OBSERVER_REQUIREMENT_ID
  );
  const binding = input.operation.bindings.find(
    ({ requirementId }) => requirementId === RETAINED_REPOSITORY_CHANGE_OBSERVER_REQUIREMENT_ID
  );
  const durationCeiling = context.resourceCeilings.find(({ resource }) => resource === 'duration-ms');
  const operationDeadlineAtUnixMs = input.operation.plan.attempt.deadlineAtUnixMs;
  const now = Date.now();
  const ceilingDeadlineAtUnixMs = durationCeiling === undefined
    ? Number.NaN
    : now + durationCeiling.maximum;
  const deadlineAtUnixMs = Math.min(
    operationDeadlineAtUnixMs,
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
      || !Number.isSafeInteger(operationDeadlineAtUnixMs)
      || !Number.isSafeInteger(context.absoluteDeadlineAtUnixMs)
      || !Number.isSafeInteger(ceilingDeadlineAtUnixMs)
      || now >= deadlineAtUnixMs) {
    return unavailable('invalid-input');
  }
  preparedObservers.delete(input.prepared);
  const resolution = armRetainedState(state, deadlineAtUnixMs);
  if (resolution.status === 'ready') {
    activatedPreparedObservers.set(input.prepared, resolution.observer);
  }
  return resolution;
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
  const roots = canonicalRootPaths(input.roots);
  if (roots === null) return unavailable('invalid-input');
  let state: PreparedObserverState;
  try {
    state = retainRoots(roots);
  } catch {
    return unavailable('root-unavailable');
  }
  return armRetainedState(state, input.deadlineAtUnixMs);
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
  let identityCurrent = true;
  try {
    for (const root of live.retainedRoots) root.assertCurrent();
  } catch {
    identityCurrent = false;
  }

  const observed = classifyEvents(Object.freeze({
    fd: live.witnessFd,
    watchDescriptor: -1,
    ancestorEdges: new Map<number, string>()
  }), live.bindings);

  try { closeSync(live.witnessFd); } catch { identityCurrent = false; }
  try {
    for (const root of live.retainedRoots) root.assertCurrent();
  } catch {
    identityCurrent = false;
  }
  if (!disposeRoots(live.retainedRoots)) identityCurrent = false;
  liveObservers.delete(observer);

  if (!identityCurrent) {
    return Object.freeze({
      status: 'identity-changed',
      rootIdentityDigest: live.rootIdentityDigest
    });
  }
  if (Date.now() >= live.deadlineAtUnixMs) {
    return Object.freeze({
      status: 'deadline-exhausted',
      rootIdentityDigest: live.rootIdentityDigest
    });
  }
  return bindRootDigest(observed, live.rootIdentityDigest);
}
