import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  consumeGeneratedStateCleanupObservation, createGeneratedStateCleanupOperationSession,
  GeneratedStateCleanupOperationExhaustedError, generatedStateCleanupOperationState
} from './cleanup-budget.ts';

test('cleanup admission preserves every deadline and abort-state observation', () => {
  for (const mode of ['before-clock', 'expired', 'live'] as const) {
    const controller = new AbortController();
    let clockCalls = 0;
    if (mode === 'before-clock') controller.abort();
    const session = createGeneratedStateCleanupOperationSession({ deadlineAtMonotonicMs: 100,
      signal: controller.signal, monotonicNowMs: () => {
        clockCalls++;
        return mode === 'expired' ? 100 : 1;
      } });
    const state = generatedStateCleanupOperationState(session)!;
    if (mode === 'live') {
      consumeGeneratedStateCleanupObservation(state, 1, 7);
      assert.deepEqual([state.observedEntries, state.observedBytes], [1, 7], mode);
    } else {
      assert.throws(
        () => consumeGeneratedStateCleanupObservation(state, 1, 7),
        GeneratedStateCleanupOperationExhaustedError,
        mode
      );
      assert.deepEqual([state.observedEntries, state.observedBytes], [0, 0], mode);
    }
    assert.equal(clockCalls, mode === 'before-clock' ? 0 : 1, mode);
  }
});
