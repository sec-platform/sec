import { expect, test } from 'bun:test';
import {
  consumeGeneratedStateCleanupObservation, createGeneratedStateCleanupOperationSession,
  GeneratedStateCleanupOperationExhaustedError, generatedStateCleanupOperationState
} from './cleanup-budget.ts';

for (const mode of ['before-clock', 'during-clock', 'expired', 'live'] as const) {
  test(`cleanup admission ${mode} keeps rejected observation counters unchanged`, () => {
    const controller = new AbortController();
    let clockCalls = 0;
    if (mode === 'before-clock') controller.abort();
    const session = createGeneratedStateCleanupOperationSession({ deadlineAtMonotonicMs: 100,
      signal: controller.signal, monotonicNowMs: () => {
        clockCalls++;
        if (mode === 'during-clock') controller.abort();
        return mode === 'expired' ? 100 : 1;
      } });
    const state = generatedStateCleanupOperationState(session)!;
    if (mode === 'live') {
      consumeGeneratedStateCleanupObservation(state, 1, 7);
      expect([state.observedEntries, state.observedBytes]).toEqual([1, 7]);
    } else {
      expect(() => consumeGeneratedStateCleanupObservation(state, 1, 7))
        .toThrow(GeneratedStateCleanupOperationExhaustedError);
      expect([state.observedEntries, state.observedBytes]).toEqual([0, 0]);
    }
    expect(clockCalls).toBe(mode === 'before-clock' ? 0 : 1);
  });
}
