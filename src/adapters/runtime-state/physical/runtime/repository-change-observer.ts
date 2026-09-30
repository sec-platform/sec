import type { SecOperationRequirementBindingContext } from '../../../../execution/operation/requirement-binding-context.ts';
import type { SecBoundSemanticOperation } from '../../../../execution/operation/semantic.ts';

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
  PreparedRepositoryChangeObserver,
  RepositoryChangeObserver,
  RepositoryChangeObserverResolution,
  RepositoryChangeObserverSettlement
} from './repository-change-observer-contract.ts';

type Provider = 'linux' | 'win32';
const preparedProviders = new WeakMap<object, Provider>();
const liveProviders = new WeakMap<object, Provider>();

function unavailable(reason: 'unsupported-platform' | 'invalid-input'): RepositoryChangeObserverResolution {
  return Object.freeze({ status: 'unavailable', reason });
}

export function prepareRepositoryChangeObserver(input: Readonly<{
  roots: readonly string[];
}>): PreparedRepositoryChangeObserver {
  if (process.platform === 'linux') {
    const prepared = prepareLinuxRepositoryChangeObserver(input);
    preparedProviders.set(prepared, 'linux');
    return prepared;
  }
  if (process.platform === 'win32') {
    const prepared = prepareWindowsRepositoryChangeObserver(input);
    preparedProviders.set(prepared, 'win32');
    return prepared;
  }
  throw new Error(`Repository change observer preparation is unavailable on ${process.platform}.`);
}

export async function armPreparedRepositoryChangeObserver(input: Readonly<{
  prepared: PreparedRepositoryChangeObserver;
  operation: SecBoundSemanticOperation;
  requirementBindingContext: SecOperationRequirementBindingContext;
}>): Promise<RepositoryChangeObserverResolution> {
  const provider = preparedProviders.get(input.prepared);
  if (provider === undefined) return unavailable('invalid-input');
  const resolution = provider === 'linux'
    ? await armPreparedLinuxRepositoryChangeObserver({
        ...input,
        prepared: input.prepared as PreparedLinuxRepositoryChangeObserver
      })
    : await armPreparedWindowsRepositoryChangeObserver({
        ...input,
        prepared: input.prepared as PreparedWindowsRepositoryChangeObserver
      });
  if (resolution.status === 'ready') {
    liveProviders.set(resolution.observer, provider);
  }
  return resolution;
}

export async function settlePreparedRepositoryChangeObserver(
  prepared: PreparedRepositoryChangeObserver
): Promise<RepositoryChangeObserverSettlement> {
  const provider = preparedProviders.get(prepared);
  preparedProviders.delete(prepared);
  if (provider === 'linux') {
    return settlePreparedLinuxRepositoryChangeObserver(
      prepared as PreparedLinuxRepositoryChangeObserver
    );
  }
  if (provider === 'win32') {
    return settlePreparedWindowsRepositoryChangeObserver(
      prepared as PreparedWindowsRepositoryChangeObserver
    );
  }
  return Object.freeze({
    status: 'discontinuous',
    rootIdentityDigest: prepared.rootIdentityDigest
  });
}

export function disposePreparedRepositoryChangeObserver(
  prepared: PreparedRepositoryChangeObserver
): void {
  const provider = preparedProviders.get(prepared);
  preparedProviders.delete(prepared);
  if (provider === 'linux') {
    disposePreparedLinuxRepositoryChangeObserver(
      prepared as PreparedLinuxRepositoryChangeObserver
    );
  } else if (provider === 'win32') {
    disposePreparedWindowsRepositoryChangeObserver(
      prepared as PreparedWindowsRepositoryChangeObserver
    );
  }
}

export async function armRepositoryChangeObserver(input: Readonly<{
  roots: readonly string[];
  deadlineAtUnixMs: number;
}>): Promise<RepositoryChangeObserverResolution> {
  const provider: Provider | null = process.platform === 'linux'
    ? 'linux'
    : process.platform === 'win32' ? 'win32' : null;
  if (provider === null) return unavailable('unsupported-platform');
  const resolution = provider === 'linux'
    ? await armLinuxRepositoryChangeObserver(input)
    : await armWindowsRepositoryChangeObserver(input);
  if (resolution.status === 'ready') {
    liveProviders.set(resolution.observer, provider);
  }
  return resolution;
}

export async function settleRepositoryChangeObserver(
  observer: RepositoryChangeObserver
): Promise<RepositoryChangeObserverSettlement> {
  const provider = liveProviders.get(observer);
  liveProviders.delete(observer);
  if (provider === 'linux') {
    return settleLinuxRepositoryChangeObserver(observer as LinuxRepositoryChangeObserver);
  }
  if (provider === 'win32') {
    return settleWindowsRepositoryChangeObserver(observer as WindowsRepositoryChangeObserver);
  }
  return Object.freeze({
    status: 'discontinuous',
    rootIdentityDigest: observer.rootIdentityDigest
  });
}

export type {
  PreparedRepositoryChangeObserver,
  RepositoryChangeEvent,
  RepositoryChangeObserver,
  RepositoryChangeObserverResolution,
  RepositoryChangeObserverSettlement,
  RepositoryChangeObserverUnavailableReason
} from './repository-change-observer-contract.ts';
export {
  RETAINED_REPOSITORY_CHANGE_OBSERVER_CONTRACT_DIGEST,
  RETAINED_REPOSITORY_CHANGE_OBSERVER_REQUIREMENT_ID
} from './repository-change-observer-contract.ts';
