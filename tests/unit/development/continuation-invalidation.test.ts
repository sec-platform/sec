import { expect, test } from 'bun:test';

import { compileContinuationInvalidation } from '../../../src/adapters/self-hosting/control/continuation/invalidation.ts';

const CHECKPOINT = `sha256:${'a'.repeat(64)}` as const;

function decide(overrides: Partial<Parameters<typeof compileContinuationInvalidation>[0]> = {}) {
  return compileContinuationInvalidation({
    checkpointDigest: CHECKPOINT,
    localState: 'exact-snapshot',
    externalChangeKnown: false,
    externalBoundary: 'none',
    sessionTerminal: false,
    ...overrides
  });
}

test('exact snapshot and local candidate edits do not trigger remote census by themselves', () => {
  const original = decide();
  expect(original).toMatchObject({
    disposition: 'reuse-zero-remote',
    remoteOwners: [],
    checkpointLifecycle: 'active'
  });
  expect(decide({ localState: 'local-candidate-diverged' })).toMatchObject({
    disposition: 'reuse-local-only',
    remoteOwners: [],
    checkpointLifecycle: 'active'
  });
  expect(original.decisionDigest).toBe(decide().decisionDigest);
  const nextCheckpoint = `sha256:${'b'.repeat(64)}` as const;
  const rebound = decide({ checkpointDigest: nextCheckpoint });
  expect(original.checkpointDigest).toBe(CHECKPOINT);
  expect(rebound.checkpointDigest).toBe(nextCheckpoint);
  expect(rebound).toMatchObject({
    disposition: 'reuse-zero-remote',
    remoteOwners: [],
    checkpointLifecycle: 'active'
  });
  expect(rebound.decisionDigest).not.toBe(original.decisionDigest);
});

test('each external authority boundary refreshes exactly its canonical owner', () => {
  const expected = {
    review: 'review',
    'main-health': 'main-health',
    authorization: 'integration-authorization',
    merge: 'merge-readback',
    closeout: 'closeout'
  } as const;
  const decisions = Object.fromEntries(Object.entries(expected).map(([boundary, owner]) => {
    const decision = decide({ externalBoundary: boundary as keyof typeof expected });
    expect(decision).toMatchObject({
      disposition: 'refresh-live-owner',
      remoteOwners: [owner],
      checkpointLifecycle: 'active'
    });
    return [boundary, decision];
  }));
  expect(decisions.review!.decisionDigest).not.toBe(decisions['main-health']!.decisionDigest);
});

test('known external change stales the snapshot while local control drift requires orientation', () => {
  expect(decide({ externalChangeKnown: true })).toMatchObject({
    disposition: 'refresh-live-owner',
    remoteOwners: ['repository-orientation'],
    checkpointLifecycle: 'stale'
  });
  expect(decide({ localState: 'control-drift' })).toMatchObject({
    disposition: 'invalidate-control',
    remoteOwners: ['repository-orientation'],
    checkpointLifecycle: 'stale'
  });
});

test('terminal session retires continuation without inventing a remote read', () => {
  expect(decide({ sessionTerminal: true })).toMatchObject({
    disposition: 'gc-eligible',
    remoteOwners: [],
    checkpointLifecycle: 'terminal',
    reasonCodes: ['session-terminal']
  });
});
