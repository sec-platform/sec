import type {
  SecBoundSemanticOperation,
  SecCapabilityBinding
} from '../../../../execution/operation/semantic.ts';
import type {
  SecOperationRequirementBindingContext
} from '../../../../execution/operation/requirement-binding-context.ts';
import {
  armLinuxRepositoryChangeObserver,
  armPreparedLinuxRepositoryChangeObserver,
  disposePreparedLinuxRepositoryChangeObserver,
  prepareLinuxRepositoryChangeObserver,
  settleLinuxRepositoryChangeObserver,
  settlePreparedLinuxRepositoryChangeObserver,
  type LinuxRepositoryChangeObserver,
  type PreparedLinuxRepositoryChangeObserver
} from './linux-repository-change-observer.ts';
import {
  armPreparedWindowsRepositoryChangeObserver,
  armWindowsRepositoryChangeObserver,
  disposePreparedWindowsRepositoryChangeObserver,
  prepareWindowsRepositoryChangeObserver,
  settlePreparedWindowsRepositoryChangeObserver,
  settleWindowsRepositoryChangeObserver,
  type PreparedWindowsRepositoryChangeObserver,
  type WindowsRepositoryChangeObserver
} from './windows-repository-change-observer.ts';
import type {
  RepositoryChangeObserverSettlement,
  RepositoryChangeObserverUnavailableReason
} from './repository-change-observer-contract.ts';

export {
  RETAINED_REPOSITORY_CHANGE_OBSERVER_CONTRACT_DIGEST,
  RETAINED_REPOSITORY_CHANGE_OBSERVER_REQUIREMENT_ID
} from './repository-change-observer-contract.ts';
export type {
  RepositoryChangeAction,
  RepositoryChangeEvent,
  RepositoryChangeObserverSettlement,
  RepositoryChangeObserverUnavailableReason
} from './repository-change-observer-contract.ts';

const preparedBrand: unique symbol = Symbol('repository-change-observer-prepared');
const observerBrand: unique symbol = Symbol('repository-change-observer');

export interface PreparedRepositoryChangeObserver {
  readonly [preparedBrand]: never;
  readonly providerBinding: SecCapabilityBinding;
  readonly rootIdentityDigest: `sha256:${string}`;
}

export interface RepositoryChangeObserver {
  readonly [observerBrand]: never;
  readonly rootIdentityDigest: `sha256:${string}`;
}

export type RepositoryChangeObserverResolution =
  | Readonly<{ status: 'ready'; observer: RepositoryChangeObserver }>
  | Readonly<{ status: 'unavailable'; reason: RepositoryChangeObserverUnavailableReason }>;

type PreparedBackend =
  | Readonly<{ platform: 'linux'; observer: PreparedLinuxRepositoryChangeObserver }>
  | Readonly<{ platform: 'win32'; observer: PreparedWindowsRepositoryChangeObserver }>;

type LiveBackend =
  | Readonly<{ platform: 'linux'; observer: LinuxRepositoryChangeObserver }>
  | Readonly<{ platform: 'win32'; observer: WindowsRepositoryChangeObserver }>;

const preparedBackends = new WeakMap<object, PreparedBackend>();
const activatedPrepared = new WeakMap<object, RepositoryChangeObserver>();
const liveBackends = new WeakMap<object, LiveBackend>();

function wrapPrepared(backend: PreparedBackend): PreparedRepositoryChangeObserver {
  const source = backend.observer;
  const prepared = Object.freeze({
    [preparedBrand]: undefined as never,
    providerBinding: source.providerBinding,
    rootIdentityDigest: source.rootIdentityDigest
  }) as PreparedRepositoryChangeObserver;
  preparedBackends.set(prepared, backend);
  return prepared;
}

function wrapLive(backend: LiveBackend): RepositoryChangeObserver {
  const source = backend.observer;
  const observer = Object.freeze({
    [observerBrand]: undefined as never,
    rootIdentityDigest: source.rootIdentityDigest
  }) as RepositoryChangeObserver;
  liveBackends.set(observer, backend);
  return observer;
}

function unsupported(): RepositoryChangeObserverResolution {
  return Object.freeze({ status: 'unavailable', reason: 'unsupported-platform' });
}

export function prepareRepositoryChangeObserver(input: Readonly<{
  roots: readonly string[];
}>): PreparedRepositoryChangeObserver {
  if (process.platform === 'linux') {
    return wrapPrepared(Object.freeze({
      platform: 'linux' as const,
      observer: prepareLinuxRepositoryChangeObserver(input)
    }));
  }
  if (process.platform === 'win32') {
    return wrapPrepared(Object.freeze({
      platform: 'win32' as const,
      observer: prepareWindowsRepositoryChangeObserver(input)
    }));
  }
  throw new Error(`Repository change observer preparation is unavailable on ${process.platform}.`);
}

export async function armPreparedRepositoryChangeObserver(input: Readonly<{
  prepared: PreparedRepositoryChangeObserver;
  operation: SecBoundSemanticOperation;
  requirementBindingContext: SecOperationRequirementBindingContext;
}>): Promise<RepositoryChangeObserverResolution> {
  const backend = preparedBackends.get(input.prepared);
  if (backend === undefined) {
    return Object.freeze({ status: 'unavailable', reason: 'invalid-input' });
  }
  let live: LiveBackend;
  if (backend.platform === 'linux') {
    const result = await armPreparedLinuxRepositoryChangeObserver({
      prepared: backend.observer,
      operation: input.operation,
      requirementBindingContext: input.requirementBindingContext
    });
    if (result.status !== 'ready') return result;
    live = Object.freeze({ platform: 'linux' as const, observer: result.observer });
  } else {
    const result = await armPreparedWindowsRepositoryChangeObserver({
      prepared: backend.observer,
      operation: input.operation,
      requirementBindingContext: input.requirementBindingContext
    });
    if (result.status !== 'ready') return result;
    live = Object.freeze({ platform: 'win32' as const, observer: result.observer });
  }
  const observer = wrapLive(live);
  activatedPrepared.set(input.prepared, observer);
  return Object.freeze({ status: 'ready', observer });
}

export async function settlePreparedRepositoryChangeObserver(
  prepared: PreparedRepositoryChangeObserver
): Promise<RepositoryChangeObserverSettlement> {
  const backend = preparedBackends.get(prepared);
  if (backend === undefined) {
    return Object.freeze({
      status: 'discontinuous',
      rootIdentityDigest: prepared.rootIdentityDigest
    });
  }
  const activated = activatedPrepared.get(prepared);
  const settlement = backend.platform === 'linux'
    ? await settlePreparedLinuxRepositoryChangeObserver(backend.observer)
    : await settlePreparedWindowsRepositoryChangeObserver(backend.observer);
  if (activated !== undefined) {
    activatedPrepared.delete(prepared);
    liveBackends.delete(activated);
    preparedBackends.delete(prepared);
  }
  return settlement;
}

export function disposePreparedRepositoryChangeObserver(
  prepared: PreparedRepositoryChangeObserver
): void {
  const backend = preparedBackends.get(prepared);
  if (backend === undefined) return;
  preparedBackends.delete(prepared);
  if (backend.platform === 'linux') disposePreparedLinuxRepositoryChangeObserver(backend.observer);
  else disposePreparedWindowsRepositoryChangeObserver(backend.observer);
}

export async function armRepositoryChangeObserver(input: Readonly<{
  roots: readonly string[];
  deadlineAtUnixMs: number;
}>): Promise<RepositoryChangeObserverResolution> {
  if (process.platform === 'linux') {
    const result = await armLinuxRepositoryChangeObserver(input);
    if (result.status !== 'ready') return result;
    return Object.freeze({
      status: 'ready',
      observer: wrapLive(Object.freeze({ platform: 'linux', observer: result.observer }))
    });
  }
  if (process.platform === 'win32') {
    const result = await armWindowsRepositoryChangeObserver(input);
    if (result.status !== 'ready') return result;
    return Object.freeze({
      status: 'ready',
      observer: wrapLive(Object.freeze({ platform: 'win32', observer: result.observer }))
    });
  }
  return unsupported();
}

export async function settleRepositoryChangeObserver(
  observer: RepositoryChangeObserver
): Promise<RepositoryChangeObserverSettlement> {
  const backend = liveBackends.get(observer);
  if (backend === undefined) {
    return Object.freeze({
      status: 'discontinuous',
      rootIdentityDigest: observer.rootIdentityDigest
    });
  }
  liveBackends.delete(observer);
  return backend.platform === 'linux'
    ? settleLinuxRepositoryChangeObserver(backend.observer)
    : settleWindowsRepositoryChangeObserver(backend.observer);
}

