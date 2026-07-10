import { expect, test } from 'bun:test';

import { renderStateTransitionMapSource } from '../../platform/compiler/semantic-lowering.ts';
import { ticketLoadedContract, ticketSemanticGeneratorTask } from '../testkit/semantic.ts';

const task = ticketSemanticGeneratorTask();
const transitions = [
  { from: 'open', to: 'in_progress', by: 'transitionTicketStatus' },
  { from: 'in_progress', to: 'closed', by: 'transitionTicketStatus' },
  { from: 'closed', to: 'open', by: 'transitionTicketStatus' }
];

test('semantic transition renderer emits deterministic typed runtime source', () => {
  const source = renderStateTransitionMapSource(
    task,
    ticketLoadedContract(['open', 'closed', 'in_progress'], transitions)
  );
  const reversed = renderStateTransitionMapSource(
    task,
    ticketLoadedContract(['in_progress', 'closed', 'open'], [...transitions].reverse())
  );

  expect(source).toBe(reversed);
  expect(source).toContain('export const TICKET_STATUS_VALUES');
  expect(source).toContain('export const TICKET_STATUS_TRANSITIONS');
  expect(source).toContain('export const NEXT_TICKET_STATUS');
  expect(source).toContain('satisfies Record<TicketStatus, TicketStatus>');
  expect(source).toMatch(/["']?closed["']?:\s*["']open["']/);
  expect(source).toMatch(/["']?in_progress["']?:\s*["']closed["']/);
  expect(source).toMatch(/["']?open["']?:\s*["']in_progress["']/);
});

test('semantic transition renderer rejects an unavailable state', () => {
  expect(() => renderStateTransitionMapSource(
    { ...task, stateId: 'missing-state' },
    ticketLoadedContract(['open'], [])
  )).toThrow('State "missing-state" is unavailable');
});
