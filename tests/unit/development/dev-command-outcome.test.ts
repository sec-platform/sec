import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { devCommandObservationExitCode, type DevCommandObservation } from '../../../src/adapters/self-hosting/development/runner/command-outcome.ts';

const observation = (exitCode: number): DevCommandObservation => ({ schema: 'sec-dev-command-observation-v1',
  effectiveArgv: ['bun'], terminal: { kind: 'exited', exitCode }, observationIntegrity: { kind: 'complete' },
  durationMs: 0, stdoutTail: '', stderrTail: '' });

test('zero alone is successful and existing integer failure codes retain their value', () => {
  for (const value of [0, 255, -1]) assert.equal(devCommandObservationExitCode(observation(value)), value);
});

test('incomplete observation remains failure even with an apparent zero', () => {
  assert.equal(devCommandObservationExitCode({ ...observation(0), observationIntegrity: { kind: 'failed', error: 'lost' } }), 1);
});
