import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { devCommandObservationExitCode, requireCommandExitCode, type DevCommandObservation } from '../../src/adapters/self-hosting/development/runner/command-outcome.ts';

const observation = (exitCode: number): DevCommandObservation => ({ schema: 'sec-dev-command-observation-v1',
  effectiveArgv: ['bun'], terminal: { kind: 'exited', exitCode }, observationIntegrity: { kind: 'complete' },
  durationMs: 0, stdoutTail: '', stderrTail: '' });

test('zero alone is successful and existing integer failure codes retain their value', () => {
  for (const value of [0, 1, 255, -1]) assert.equal(devCommandObservationExitCode(observation(value)), value);
});

test('absent, nonnumeric and noninteger results never become a zero exit', () => {
  for (const value of [undefined, null, false, true, '', '0', NaN, Infinity, 1.5, {}, 2 ** 53]) {
    assert.throws(() => requireCommandExitCode(value, 'test'), TypeError);
    assert.throws(() => devCommandObservationExitCode(observation(value as number)), TypeError);
  }
});

test('incomplete observation or non-exit terminal state remains failure even with an apparent zero', () => {
  assert.equal(devCommandObservationExitCode({ ...observation(0), observationIntegrity: { kind: 'failed', error: 'lost' } }), 1);
  assert.equal(devCommandObservationExitCode({ ...observation(0), terminal: { kind: 'signaled', signal: 'SIGTERM' } }), 1);
  assert.equal(devCommandObservationExitCode({ ...observation(0), terminal: { kind: 'unresolved', reason: 'close-without-status' } }), 1);
  assert.equal(devCommandObservationExitCode({ ...observation(0), observationIntegrity: { kind: 'unknown' } as never }), 1);
});
