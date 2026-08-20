import { expect, test } from 'bun:test';

import { compileContinuationInvalidationV1 } from '../../platform/shared/continuation-invalidation-contract.ts';

const CHECKPOINT = `sha256:${'a'.repeat(64)}` as const;

function decide(overrides: Partial<Parameters<typeof compileContinuationInvalidationV1>[0]> = {}) {
  return compileContinuationInvalidationV1({
    checkpointDigest: CHECKPOINT,
    localState: 'exact-snapshot',
    externalChangeKnown: false,
    externalBoundary: 'none',
    sessionTerminal: false,
    ...overrides
  });
}

test('exact snapshot and local candidate edits do not trigger remote census by themselves', () => {
  expect(decide()).toMatchObject({
    disposition: 'reuse-zero-remote',
    remoteOwners: [],
    checkpointLifecycle: 'active'
  });
  expect(decide({ localState: 'local-candidate-diverged' })).toMatchObject({
    disposition: 'reuse-local-only',
    remoteOwners: [],
    checkpointLifecycle: 'active'
  });
});

test('each external authority boundary refreshes exactly its canonical owner', () => {
  const expected = {
    review: 'review',
    'main-health': 'main-health',
    authorization: 'integration-authorization',
    merge: 'merge-readback',
    closeout: 'closeout'
  } as const;
  for (const [boundary, owner] of Object.entries(expected)) {
    expect(decide({ externalBoundary: boundary as keyof typeof expected })).toMatchObject({
      disposition: 'refresh-live-owner',
      remoteOwners: [owner],
      checkpointLifecycle: 'active'
    });
  }
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

test('same normalized invalidation input has a stable content digest', () => {
  expect(decide().decisionDigest).toBe(decide().decisionDigest);
  expect(decide({ externalBoundary: 'review' }).decisionDigest)
    .not.toBe(decide({ externalBoundary: 'main-health' }).decisionDigest);
});
