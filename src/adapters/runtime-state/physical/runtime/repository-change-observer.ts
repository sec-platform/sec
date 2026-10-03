import type { OperationRequirementBindingContext } from '../../../../execution/operation/requirement-binding-context.ts';
import type { BoundSemanticOperation, CapabilityBinding } from '../../../../execution/operation/semantic.ts';
import {
  armPreparedWindowsRepositoryChangeObserver,
  armWindowsRepositoryChangeObserver,
  disposePreparedWindowsRepositoryChangeObserver,
  prepareWindowsRepositoryChangeObserver,
  settlePreparedWindowsRepositoryChangeObserver,
  settleWindowsRepositoryChangeObserver,
  type PreparedWindowsRepositoryChangeObserver,
  type WindowsRepositoryChangeObserver,
  type WindowsRepositoryChangeObserverSettlement,
  type WindowsRepositoryChangeObserverUnavailableReason
} from './windows-repository-change-observer.ts';

export type RepositoryChangeObserverSettlement = WindowsRepositoryChangeObserverSettlement;
export type RepositoryChangeObserverUnavailableReason = WindowsRepositoryChangeObserverUnavailableReason;

const preparedBrand: unique symbol = Symbol('prepared-repository-change-observer');
const observerBrand: unique symbol = Symbol('repository-change-observer');

export interface PreparedRepositoryChangeObserver {
  readonly [preparedBrand]: never;
  readonly providerBinding: CapabilityBinding;
  readonly rootIdentityDigest: `sha256:${string}`;
}

export interface RepositoryChangeObserver {
  readonly [observerBrand]: never;
  readonly rootIdentityDigest: `sha256:${string}`;
}

type Unavailable = Readonly<{
  status: 'unavailable';
  reason: RepositoryChangeObserverUnavailableReason;
}>;
export type RepositoryChangeObserverResolution =
  | Readonly<{ status: 'ready'; observer: RepositoryChangeObserver }>
  | Unavailable;
export type PreparedRepositoryChangeObserverResolution =
  | Readonly<{ status: 'ready'; prepared: PreparedRepositoryChangeObserver }>
  | Unavailable;

type PreparedState = {
  readonly provider: PreparedWindowsRepositoryChangeObserver;
  disposed: boolean;
};
const preparedProviders = new WeakMap<object, PreparedState>();
const observerProviders = new WeakMap<object, WindowsRepositoryChangeObserver>();

function unavailable(reason: RepositoryChangeObserverUnavailableReason): Unavailable {
  return Object.freeze({ status: 'unavailable', reason });
}

function issuedObserver(provider: WindowsRepositoryChangeObserver): RepositoryChangeObserver {
  const observer = Object.freeze({
    [observerBrand]: undefined as never,
    rootIdentityDigest: provider.rootIdentityDigest
  });
  observerProviders.set(observer, provider);
  return observer;
}

/**
 * Selects an implemented physical observer on this host. Unsupported means the
 * strict capability is absent: it never selects snapshots, polling or a weaker
 * event stream. No runner location or remote topology participates in selection.
 * The selected provider continues to own native identity, coverage and cleanup.
 */
export function prepareRepositoryChangeObserver(input: Readonly<{
  roots: readonly string[];
}>): PreparedRepositoryChangeObserverResolution {
  if (process.platform !== 'win32') return unavailable('unsupported-platform');
  if (process.arch !== 'x64' && process.arch !== 'arm64') return unavailable('unsupported-architecture');
  const provider = prepareWindowsRepositoryChangeObserver(input);
  const prepared = Object.freeze({
    [preparedBrand]: undefined as never,
    // Preserve the physical owner's exact requirement, contract and identity.
    providerBinding: provider.providerBinding,
    rootIdentityDigest: provider.rootIdentityDigest
  });
  preparedProviders.set(prepared, { provider, disposed: false });
  return Object.freeze({ status: 'ready', prepared });
}

/** Caller fields cannot select or reconstruct the physical provider binding. */
export function repositoryChangeObserverBinding(
  prepared: PreparedRepositoryChangeObserver
): CapabilityBinding {
  const state = preparedProviders.get(prepared);
  if (state === undefined || state.disposed) {
    throw new Error('Repository observation requires a live owner-issued prepared capability.');
  }
  return state.provider.providerBinding;
}

export async function armRepositoryChangeObserver(input: Readonly<{
  roots: readonly string[];
  deadlineAtUnixMs: number;
}>): Promise<RepositoryChangeObserverResolution> {
  if (process.platform !== 'win32') return unavailable('unsupported-platform');
  const resolution = await armWindowsRepositoryChangeObserver(input);
  if (resolution.status !== 'ready') return resolution;
  return Object.freeze({ status: 'ready', observer: issuedObserver(resolution.observer) });
}

export async function armPreparedRepositoryChangeObserver(input: Readonly<{
  prepared: PreparedRepositoryChangeObserver;
  operation: BoundSemanticOperation;
  requirementBindingContext: OperationRequirementBindingContext;
}>): Promise<RepositoryChangeObserverResolution> {
  const state = preparedProviders.get(input.prepared);
  if (state === undefined || state.disposed) return unavailable('invalid-input');
  const resolution = await armPreparedWindowsRepositoryChangeObserver({
    ...input,
    prepared: state.provider
  });
  if (resolution.status !== 'ready') return resolution;
  return Object.freeze({ status: 'ready', observer: issuedObserver(resolution.observer) });
}

export async function settleRepositoryChangeObserver(
  observer: RepositoryChangeObserver
): Promise<RepositoryChangeObserverSettlement> {
  const provider = observerProviders.get(observer);
  if (provider === undefined) throw new Error('Repository observation requires an owner-issued observer.');
  return settleWindowsRepositoryChangeObserver(provider);
}

export async function settlePreparedRepositoryChangeObserver(
  prepared: PreparedRepositoryChangeObserver
): Promise<RepositoryChangeObserverSettlement> {
  const state = preparedProviders.get(prepared);
  if (state === undefined) throw new Error('Repository observation requires an owner-issued prepared capability.');
  return settlePreparedWindowsRepositoryChangeObserver(state.provider);
}

export function disposePreparedRepositoryChangeObserver(prepared: PreparedRepositoryChangeObserver): void {
  const state = preparedProviders.get(prepared);
  if (state === undefined) throw new Error('Repository observation requires an owner-issued prepared capability.');
  if (state.disposed) return;
  // Mark disposed only after the physical owner accepts settlement. Its
  // unresolved worker/root recovery responsibility must survive a failed close.
  disposePreparedWindowsRepositoryChangeObserver(state.provider);
  state.disposed = true;
}
