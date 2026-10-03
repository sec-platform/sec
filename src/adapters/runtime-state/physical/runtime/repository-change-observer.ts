import type { SecOperationRequirementBindingContext } from '../../../../execution/operation/requirement-binding-context.ts';
import type { SecBoundSemanticOperation, SecCapabilityBinding } from '../../../../execution/operation/semantic.ts';
import { settleResources } from '../../../../execution/resource-settlement.ts';
import {
  armLinuxImmutableRepositoryInput, armStandaloneLinuxImmutableRepositoryInput,
  disposeLinuxImmutableRepositoryInput, linuxImmutableRepositoryInputPrerequisites,
  prepareLinuxImmutableRepositoryInput, settleLinuxImmutableRepositoryInput,
  type LinuxImmutableRepositoryInput, type LinuxImmutableRepositoryInputSettlement
} from './linux-immutable-repository-input.ts';
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

export type RepositoryChangeObserverSettlement = WindowsRepositoryChangeObserverSettlement | LinuxImmutableRepositoryInputSettlement;
export type RepositoryChangeObserverUnavailableReason = WindowsRepositoryChangeObserverUnavailableReason;

/** Enforcement and observation keep different evidence kinds while proving
 * the same no-write interval. Neither caller DTOs nor final-state equality
 * reach this boundary; settlement only consumes private owner-issued objects. */
export function repositoryInputZeroWritesProven(value: RepositoryChangeObserverSettlement):
  value is Extract<RepositoryChangeObserverSettlement, { status: 'zero-events' | 'immutable-input' }> {
  return value.status === 'zero-events' || value.status === 'immutable-input';
}

const preparedBrand: unique symbol = Symbol('prepared-repository-change-observer');
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

type PreparedState = ({ readonly kind: 'windows'; readonly provider: PreparedWindowsRepositoryChangeObserver }
  | { readonly kind: 'linux-immutable'; readonly provider: LinuxImmutableRepositoryInput }) & { disposed: boolean };
const preparedProviders = new WeakMap<object, PreparedState>();
type ObserverState = { readonly kind: 'windows'; readonly provider: WindowsRepositoryChangeObserver }
  | { readonly kind: 'linux-immutable'; readonly provider: LinuxImmutableRepositoryInput; readonly ownsDisposal: boolean; settled: boolean; disposed: boolean };
const observerProviders = new WeakMap<object, ObserverState>();

function unavailable(reason: RepositoryChangeObserverUnavailableReason): Unavailable {
  return Object.freeze({ status: 'unavailable', reason });
}

function issuedObserver(state: ObserverState): RepositoryChangeObserver {
  const observer = Object.freeze({
    [observerBrand]: undefined as never,
    rootIdentityDigest: state.provider.rootIdentityDigest
  });
  observerProviders.set(observer, state);
  return observer;
}

/**
 * Selects an implemented physical observer on this host. Unsupported means the
 * strict capability is absent: it never selects snapshots, polling or a weaker
 * event stream. A qualified immutable tmpfs uses actual kernel prevention,
 * retaining a distinct settlement kind. Location/DTOs do not select success.
 * The selected physical owner keeps native identity, coverage and cleanup.
 */
export function prepareRepositoryChangeObserver(input: Readonly<{
  roots: readonly string[];
}>): PreparedRepositoryChangeObserverResolution {
  if (process.platform === 'linux') {
    if (!linuxImmutableRepositoryInputPrerequisites()) return unavailable('unsupported-platform');
    let provider: LinuxImmutableRepositoryInput;
    try { provider = prepareLinuxImmutableRepositoryInput(input.roots); }
    catch (error) { if (error instanceof AggregateError) throw error; return unavailable('root-unavailable'); }
    const prepared = Object.freeze({ [preparedBrand]: undefined as never,
      providerBinding: provider.providerBinding, rootIdentityDigest: provider.rootIdentityDigest });
    preparedProviders.set(prepared, { kind: 'linux-immutable', provider, disposed: false });
    return Object.freeze({ status: 'ready', prepared });
  }
  if (process.platform !== 'win32') return unavailable('unsupported-platform');
  if (process.arch !== 'x64' && process.arch !== 'arm64') return unavailable('unsupported-architecture');
  const provider = prepareWindowsRepositoryChangeObserver(input);
  const prepared = Object.freeze({
    [preparedBrand]: undefined as never,
    // Preserve the physical owner's exact requirement, contract and identity.
    providerBinding: provider.providerBinding,
    rootIdentityDigest: provider.rootIdentityDigest
  });
  preparedProviders.set(prepared, { kind: 'windows', provider, disposed: false });
  return Object.freeze({ status: 'ready', prepared });
}

/** Caller fields cannot select or reconstruct the physical provider binding. */
export function repositoryChangeObserverBinding(
  prepared: PreparedRepositoryChangeObserver
): SecCapabilityBinding {
  const state = preparedProviders.get(prepared);
  if (state === undefined || state.disposed) {
    throw new Error('Repository observation requires a live owner-issued prepared capability.');
  }
  return state.provider.providerBinding;
}

/** Provider-owned actual Effect closure; callers cannot erase the Linux
 * process-wide namespace fence while binding only a filesystem observation. */
export function repositoryChangeObserverEffectKinds(prepared: PreparedRepositoryChangeObserver): readonly ('filesystem' | 'process')[] {
  repositoryChangeObserverBinding(prepared);
  return preparedProviders.get(prepared)!.kind === 'windows'
    ? Object.freeze(['filesystem'] as const) : Object.freeze(['filesystem', 'process'] as const);
}

export async function armRepositoryChangeObserver(input: Readonly<{
  roots: readonly string[];
  deadlineAtUnixMs: number;
}>): Promise<RepositoryChangeObserverResolution> {
  if (process.platform === 'linux') {
    if (!linuxImmutableRepositoryInputPrerequisites()) return unavailable('unsupported-platform');
    let provider: LinuxImmutableRepositoryInput | undefined;
    try {
      provider = prepareLinuxImmutableRepositoryInput(input.roots);
      armStandaloneLinuxImmutableRepositoryInput(provider, input.deadlineAtUnixMs);
      return Object.freeze({ status: 'ready', observer: issuedObserver({
        kind: 'linux-immutable', provider, ownsDisposal: true, settled: false, disposed: false }) });
    } catch (error) {
      if (provider === undefined) {
        // A compound preparation error includes retained-root settlement
        // responsibility. It cannot be downgraded to capability absence.
        if (error instanceof AggregateError) throw error;
        return unavailable('root-unavailable');
      }
      settleResources({ primary: { label: 'immutable-input-arm', error }, cleanup: [{
        label: 'immutable-input-retained-roots', settle: () => disposeLinuxImmutableRepositoryInput(provider!)
      }] });
      throw new Error('Unreachable immutable input arm settlement state.');
    }
  }
  if (process.platform !== 'win32') return unavailable('unsupported-platform');
  const resolution = await armWindowsRepositoryChangeObserver(input);
  if (resolution.status !== 'ready') return resolution;
  return Object.freeze({ status: 'ready', observer: issuedObserver({ kind: 'windows', provider: resolution.observer }) });
}

export async function armPreparedRepositoryChangeObserver(input: Readonly<{
  prepared: PreparedRepositoryChangeObserver;
  operation: SecBoundSemanticOperation;
  requirementBindingContext: SecOperationRequirementBindingContext;
}>): Promise<RepositoryChangeObserverResolution> {
  const state = preparedProviders.get(input.prepared);
  if (state === undefined || state.disposed) return unavailable('invalid-input');
  if (state.kind === 'linux-immutable') {
    try {
      armLinuxImmutableRepositoryInput({ ...input, prepared: state.provider });
      return Object.freeze({ status: 'ready', observer: issuedObserver({ kind: 'linux-immutable',
        provider: state.provider, ownsDisposal: false, settled: false, disposed: false }) });
    } catch { return unavailable('arm-failed'); }
  }
  const resolution = await armPreparedWindowsRepositoryChangeObserver({
    ...input,
    prepared: state.provider
  });
  if (resolution.status !== 'ready') return resolution;
  return Object.freeze({ status: 'ready', observer: issuedObserver({ kind: 'windows', provider: resolution.observer }) });
}

export async function settleRepositoryChangeObserver(
  observer: RepositoryChangeObserver
): Promise<RepositoryChangeObserverSettlement> {
  const state = observerProviders.get(observer);
  if (state === undefined) throw new Error('Repository observation requires an owner-issued observer.');
  if (state.kind === 'windows') return settleWindowsRepositoryChangeObserver(state.provider);
  const dispose = () => {
    if (state.ownsDisposal && !state.disposed) {
      disposeLinuxImmutableRepositoryInput(state.provider);
      state.disposed = true;
    }
  };
  if (state.settled) {
    dispose();
    return Object.freeze({ status: 'discontinuous', rootIdentityDigest: observer.rootIdentityDigest });
  }
  state.settled = true;
  let result: LinuxImmutableRepositoryInputSettlement | undefined;
  let primary: Readonly<{ label: string; error: unknown }> | undefined;
  try { result = settleLinuxImmutableRepositoryInput(state.provider); }
  catch (error) { primary = { label: 'immutable-input-observation-settlement', error }; }
  settleResources({ primary, cleanup: [{ label: 'immutable-input-retained-roots', settle: dispose }] });
  return result!;
}

export async function settlePreparedRepositoryChangeObserver(
  prepared: PreparedRepositoryChangeObserver
): Promise<RepositoryChangeObserverSettlement> {
  const state = preparedProviders.get(prepared);
  if (state === undefined) throw new Error('Repository observation requires an owner-issued prepared capability.');
  if (state.kind === 'linux-immutable') return settleLinuxImmutableRepositoryInput(state.provider);
  return settlePreparedWindowsRepositoryChangeObserver(state.provider);
}

export function disposePreparedRepositoryChangeObserver(prepared: PreparedRepositoryChangeObserver): void {
  const state = preparedProviders.get(prepared);
  if (state === undefined) throw new Error('Repository observation requires an owner-issued prepared capability.');
  if (state.disposed) return;
  // Mark disposed only after the physical owner accepts settlement. Its
  // unresolved worker/root recovery responsibility must survive a failed close.
  if (state.kind === 'linux-immutable') disposeLinuxImmutableRepositoryInput(state.provider);
  else disposePreparedWindowsRepositoryChangeObserver(state.provider);
  state.disposed = true;
}
