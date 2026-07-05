import { expect, test } from 'bun:test';

import { renderStateTransitionMapSource } from '../../platform/compiler/semantic-lowering.ts';
import type { LoadedSemanticContract } from '../../platform/shared/semantic-contract-types.ts';
import type { SemanticGeneratorTask } from '../../platform/shared/semantic-generator-types.ts';

const task: SemanticGeneratorTask = {
  id: 'generator:ticket/basic:ticket-status-runtime-contract',
  blockId: 'ticket/basic',
  generatorId: 'ticket-status-runtime-contract',
  kind: 'generate-state-transition-map',
  contractId: 'ticket-core',
  contractPath: 'platform/registry/official/ticket.basic/contracts/ticket.yaml',
  contractNamespace: 'ticket',
  stateId: 'ticket-status',
  target: 'src/installed/ticket/ticket-semantic-contract.ts',
  consumes: ['state', 'transition'],
  produces: 'typescript-runtime-contract',
  typeBinding: {
    name: 'TicketStatus',
    importFrom: '../../runtime/database.ts'
  },
  verification: ['ticket_status_can_transition', 'typecheck'],
  registrySourceId: 'official',
  registryKind: 'official',
  registryLocation: 'compiler',
  registryPath: 'platform/registry/official/ticket.basic',
  status: 'pending'
};

function loadedContract(values: string[], transitions: Array<{ from: string; to: string; by: string }>): LoadedSemanticContract {
  return {
    blockId: 'ticket/basic',
    contractPath: task.contractPath,
    contract: {
      formatVersion: '1',
      id: 'ticket-core',
      namespace: 'ticket',
      entities: [],
      states: [{
        id: 'ticket-status',
        entity: 'Ticket',
        field: 'status',
        owner: 'TicketStateMachine',
        values,
        transitions
      }],
      responsibilities: [],
      operations: [],
      events: [],
      policies: [],
      permissions: [],
      effects: [],
      scenarios: []
    }
  };
}

const transitions = [
  { from: 'open', to: 'in_progress', by: 'transitionTicketStatus' },
  { from: 'in_progress', to: 'closed', by: 'transitionTicketStatus' },
  { from: 'closed', to: 'open', by: 'transitionTicketStatus' }
];

test('semantic transition renderer emits deterministic typed runtime source', () => {
  const source = renderStateTransitionMapSource(
    task,
    loadedContract(['open', 'closed', 'in_progress'], transitions)
  );
  const reversed = renderStateTransitionMapSource(
    task,
    loadedContract(['in_progress', 'closed', 'open'], [...transitions].reverse())
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
    loadedContract(['open'], [])
  )).toThrow('State "missing-state" is unavailable');
});
