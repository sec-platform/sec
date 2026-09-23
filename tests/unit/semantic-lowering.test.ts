import { expect, test } from 'bun:test';

import { renderStateTransitionMapSource } from '../../src/adapters/targets/typescript/semantic-lowering.ts';
import { assertStateTransitionFunctions } from '../../src/compiler/state-transition-plan.ts';
import { ticketSemanticGeneratorTask } from '../testkit/semantic.ts';

const task = ticketSemanticGeneratorTask();
test('semantic transition renderer emits deterministic typed runtime source', () => {
  const source = renderStateTransitionMapSource(task);
  const reversed = renderStateTransitionMapSource({
    ...task,
    stateValues: [...task.stateValues].reverse(),
    transitions: [...task.transitions].reverse()
  });

  expect(source).toBe(reversed);
  expect(source).toContain('export const TICKET_STATUS_VALUES');
  expect(source).toContain('export const TICKET_STATUS_TRANSITIONS');
  expect(source).toContain('export const NEXT_TICKET_STATUS');
  expect(source).toContain('satisfies Record<TicketStatus, TicketStatus>');
  expect(source).toMatch(/["']?closed["']?:\s*["']open["']/);
  expect(source).toMatch(/["']?in_progress["']?:\s*["']closed["']/);
  expect(source).toMatch(/["']?open["']?:\s*["']in_progress["']/);
});

test('IR-derived transition plan rejects states without exactly one outgoing transition', () => {
  expect(() => assertStateTransitionFunctions([{
    ...task,
    stateValues: ['open'],
    transitions: []
  }])).toThrow('State "ticket-status" requires exactly one outgoing transition from "open"');
});
