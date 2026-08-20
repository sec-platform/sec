import { sha256 } from './canonical-primitives.ts';

export const CONTINUATION_INVALIDATION_DECISION_SCHEMA_V1 =
  'sec-continuation-invalidation-decision-v1' as const;

export const CONTINUATION_EXTERNAL_BOUNDARIES_V1 = [
  'none',
  'review',
  'main-health',
  'authorization',
  'merge',
  'closeout'
] as const;

export type ContinuationExternalBoundaryV1 = typeof CONTINUATION_EXTERNAL_BOUNDARIES_V1[number];

export type ContinuationLocalStateV1 =
  | 'exact-snapshot'
  | 'local-candidate-diverged'
  | 'control-drift';

export interface ContinuationInvalidationInputV1 {
  readonly checkpointDigest: `sha256:${string}`;
  readonly localState: ContinuationLocalStateV1;
  readonly externalChangeKnown: boolean;
  readonly externalBoundary: ContinuationExternalBoundaryV1;
  readonly sessionTerminal: boolean;
}

export interface ContinuationInvalidationDecisionV1 {
  readonly schema: typeof CONTINUATION_INVALIDATION_DECISION_SCHEMA_V1;
  readonly checkpointDigest: `sha256:${string}`;
  readonly disposition:
    | 'reuse-zero-remote'
    | 'reuse-local-only'
    | 'refresh-live-owner'
    | 'invalidate-control'
    | 'gc-eligible';
  readonly remoteOwners: readonly (
    | 'repository-orientation'
    | 'review'
    | 'main-health'
    | 'integration-authorization'
    | 'merge-readback'
    | 'closeout'
  )[];
  readonly checkpointLifecycle: 'active' | 'stale' | 'terminal';
  readonly reasonCodes: readonly string[];
  readonly decisionDigest: `sha256:${string}`;
}

function digest(value: unknown): `sha256:${string}` {
  return sha256(value) as `sha256:${string}`;
}

function checkpointDigest(value: unknown): `sha256:${string}` {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error('Continuation invalidation checkpointDigest is invalid.');
  }
  return value as `sha256:${string}`;
}

function boundary(value: unknown): ContinuationExternalBoundaryV1 {
  if (typeof value !== 'string'
      || !CONTINUATION_EXTERNAL_BOUNDARIES_V1.includes(value as ContinuationExternalBoundaryV1)) {
    throw new Error('Continuation invalidation externalBoundary is invalid.');
  }
  return value as ContinuationExternalBoundaryV1;
}

function localState(value: unknown): ContinuationLocalStateV1 {
  if (value !== 'exact-snapshot' && value !== 'local-candidate-diverged' && value !== 'control-drift') {
    throw new Error('Continuation invalidation localState is invalid.');
  }
  return value;
}

function ownerForBoundary(value: Exclude<ContinuationExternalBoundaryV1, 'none'>): ContinuationInvalidationDecisionV1['remoteOwners'][number] {
  return value === 'review' ? 'review'
    : value === 'main-health' ? 'main-health'
      : value === 'authorization' ? 'integration-authorization'
        : value === 'merge' ? 'merge-readback'
          : 'closeout';
}

export function compileContinuationInvalidationV1(
  raw: ContinuationInvalidationInputV1
): ContinuationInvalidationDecisionV1 {
  const input = Object.freeze({
    checkpointDigest: checkpointDigest(raw.checkpointDigest),
    localState: localState(raw.localState),
    externalChangeKnown: raw.externalChangeKnown === true,
    externalBoundary: boundary(raw.externalBoundary),
    sessionTerminal: raw.sessionTerminal === true
  });
  let disposition: ContinuationInvalidationDecisionV1['disposition'];
  let checkpointLifecycle: ContinuationInvalidationDecisionV1['checkpointLifecycle'];
  let remoteOwners: ContinuationInvalidationDecisionV1['remoteOwners'];
  const reasonCodes: string[] = [];

  if (input.sessionTerminal) {
    disposition = 'gc-eligible';
    checkpointLifecycle = 'terminal';
    remoteOwners = Object.freeze([]);
    reasonCodes.push('session-terminal');
  } else if (input.localState === 'control-drift') {
    disposition = 'invalidate-control';
    checkpointLifecycle = 'stale';
    remoteOwners = Object.freeze(['repository-orientation']);
    reasonCodes.push('local-control-drift');
  } else if (input.externalChangeKnown) {
    disposition = 'refresh-live-owner';
    checkpointLifecycle = 'stale';
    remoteOwners = Object.freeze(input.externalBoundary === 'none'
      ? ['repository-orientation']
      : [ownerForBoundary(input.externalBoundary)]);
    reasonCodes.push('external-change-known');
  } else if (input.externalBoundary !== 'none') {
    disposition = 'refresh-live-owner';
    checkpointLifecycle = 'active';
    remoteOwners = Object.freeze([ownerForBoundary(input.externalBoundary)]);
    reasonCodes.push(`external-boundary-${input.externalBoundary}`);
  } else if (input.localState === 'local-candidate-diverged') {
    disposition = 'reuse-local-only';
    checkpointLifecycle = 'active';
    remoteOwners = Object.freeze([]);
    reasonCodes.push('local-candidate-diverged-no-external-boundary');
  } else {
    disposition = 'reuse-zero-remote';
    checkpointLifecycle = 'active';
    remoteOwners = Object.freeze([]);
    reasonCodes.push('exact-local-snapshot-no-external-boundary');
  }

  const semantic = Object.freeze({
    schema: CONTINUATION_INVALIDATION_DECISION_SCHEMA_V1,
    checkpointDigest: input.checkpointDigest,
    disposition,
    remoteOwners,
    checkpointLifecycle,
    reasonCodes: Object.freeze(reasonCodes)
  });
  return Object.freeze({ ...semantic, decisionDigest: digest(semantic) });
}
