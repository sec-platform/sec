import { sha256 } from '../../../../contracts/canonical.ts';
import type { SecOperationDigest } from '../../../../execution/operation/semantic.ts';

export const REPOSITORY_CHANGE_OBSERVER_MAXIMUM_ROOTS = 8;
export const REPOSITORY_CHANGE_OBSERVER_MAXIMUM_EVENTS = 100_000;
export const REPOSITORY_CHANGE_OBSERVER_MAXIMUM_WATCHES = 100_000;
export const REPOSITORY_CHANGE_OBSERVER_MAXIMUM_OBSERVATION_MS = 5 * 60_000;

export const RETAINED_REPOSITORY_CHANGE_OBSERVER_REQUIREMENT_ID =
  'runtime-state.repository-change-observer.retained' as const;

export const RETAINED_REPOSITORY_CHANGE_OBSERVER_CONTRACT_DIGEST = sha256({
  domain: 'runtime-state.repository-change-observer.retained',
  provider: 'platform-native-recursive-change-observer-v1',
  supportedProviders: Object.freeze([
    'linux-inotify',
    'windows-read-directory-changes'
  ]),
  duration: 'operation-bound-duration',
  maximumRoots: REPOSITORY_CHANGE_OBSERVER_MAXIMUM_ROOTS,
  maximumEvents: REPOSITORY_CHANGE_OBSERVER_MAXIMUM_EVENTS,
  maximumWatches: REPOSITORY_CHANGE_OBSERVER_MAXIMUM_WATCHES
}) as SecOperationDigest;

export type RepositoryChangeAction =
  | 'added'
  | 'removed'
  | 'modified'
  | 'renamed-from'
  | 'renamed-to';

export interface RepositoryChangeEvent {
  readonly rootIndex: number;
  readonly path: string;
  readonly action: RepositoryChangeAction;
}

export type RepositoryChangeObserverUnavailableReason =
  | 'unsupported-platform'
  | 'unsupported-architecture'
  | 'invalid-input'
  | 'root-unavailable'
  | 'native-provider-unavailable'
  | 'arm-failed'
  | 'deadline-exhausted';

export type RepositoryChangeObserverSettlement =
  | Readonly<{
    status: 'zero-events';
    rootIdentityDigest: `sha256:${string}`;
    observationDigest: `sha256:${string}`;
  }>
  | Readonly<{
    status: 'events';
    rootIdentityDigest: `sha256:${string}`;
    events: readonly RepositoryChangeEvent[];
    observationDigest: `sha256:${string}`;
  }>
  | Readonly<{
    status: 'overflow' | 'discontinuous' | 'identity-changed' | 'deadline-exhausted';
    rootIdentityDigest: `sha256:${string}`;
  }>;
